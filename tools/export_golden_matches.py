"""Export deterministic Python matcher cases for the browser port."""

from __future__ import annotations

import argparse
import base64
import json
import hashlib
import sys
import shutil
import tempfile
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
import librosa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.core.audio_matcher import AudioMatcher, REFERENCE_DIR, _SOS  # noqa: E402

DEFAULT_OUTPUT = ROOT / "mobile" / "tests" / "golden-matches.json"


def write_variant(source: Path, output: Path) -> tuple[int, float]:
    audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1) * 0.35
    leading = np.zeros(round(sample_rate * 0.1), dtype=np.float32)
    trailing = np.zeros(round(sample_rate * 0.2), dtype=np.float32)
    variant = np.concatenate((leading, mono, trailing))
    sf.write(output, variant, sample_rate, subtype="PCM_16")
    return sample_rate, len(variant) / sample_rate


def classify_case(matcher: AudioMatcher, path: Path, name: str, variant: str,
                  sample_rate: int, duration: float, output_audio_dir: Path) -> dict:
    result = matcher.match(path)
    if result is None:
        category, confidence = None, 0.0
    else:
        category, confidence = result
    audio_path = output_audio_dir / f"{name.replace(':', '-')}.wav"
    if path != audio_path:
        shutil.copyfile(path, audio_path)
    source_audio, source_rate = sf.read(path, dtype="float32", always_2d=True)
    source_mono = source_audio.mean(axis=1, dtype=np.float32)
    resampled, _ = librosa.load(str(path), sr=22050, mono=True)
    samples = matcher._load(path)
    events = matcher._split_events(samples)
    query_event = matcher._select_event(events) if events else None
    query_mfcc = matcher._mfcc(query_event).tolist() if query_event is not None else None
    event_samples = (
        base64.b64encode(np.asarray(query_event, dtype="<f4").tobytes()).decode("ascii")
        if query_event is not None else None
    )
    return {
        "id": name,
        "variant": variant,
        "input_wav": f"audio/{audio_path.name}",
        "sample_rate": sample_rate,
        "duration_seconds": round(duration, 6),
        "expected_category": category,
        "expected_confidence": confidence,
        "sha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
        "source_sample_rate": source_rate,
        "source_mono_f32le_base64": base64.b64encode(
            np.asarray(source_mono, dtype="<f4").tobytes()
        ).decode("ascii"),
        "python_resampled_f32le_base64": base64.b64encode(
            np.asarray(resampled, dtype="<f4").tobytes()
        ).decode("ascii"),
        "python_filtered_f32le_base64": base64.b64encode(
            np.asarray(samples, dtype="<f4").tobytes()
        ).decode("ascii"),
        "query_event_f32le_base64": event_samples,
        "query_mfcc": query_mfcc,
    }


def build_cases(matcher: AudioMatcher, output_audio_dir: Path) -> list[dict]:
    cases = []
    output_audio_dir.mkdir(parents=True, exist_ok=True)
    for source in sorted(REFERENCE_DIR.glob("*.wav")):
        with wave.open(str(source), "rb") as wav:
            sample_rate = wav.getframerate()
            duration = wav.getnframes() / sample_rate
        cases.append(classify_case(
            matcher, source, f"{source.stem}:reference", "reference",
            sample_rate, duration, output_audio_dir,
        ))

        variant_path = output_audio_dir / f"{source.stem}-padded-attenuated.wav"
        variant_rate, variant_duration = write_variant(source, variant_path)
        cases.append(classify_case(
            matcher, variant_path, f"{source.stem}:padded-attenuated",
            "padded-attenuated", variant_rate, variant_duration, output_audio_dir,
        ))

    silence_path = output_audio_dir / "silence-one-second.wav"
    sf.write(silence_path, np.zeros(22050, dtype=np.float32), 22050, subtype="PCM_16")
    cases.append(classify_case(
        matcher, silence_path, "silence:one-second", "silence",
        22050, 1.0, output_audio_dir,
    ))
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="audio-feature-cache-") as cache_dir:
        matcher = AudioMatcher(cache_dir=Path(cache_dir))
        payload = {
            "schema_version": 1,
            "pipeline_version": 9,
            "sample_rate": 22050,
            "mfcc_count": 20,
            "band_hz": [70, 8000],
            "mfcc": {
                "fft_size": 2048,
                "hop_size": 512,
                "mel_bands": 128,
                "window": "hann-periodic",
                "power": 2,
                "mel_scale": "slaney",
                "mel_norm": "slaney-area",
                "dct_type": 2,
                "dct_norm": "ortho",
                "center": True,
                "pad_mode": "constant",
            },
            "butterworth_sos": _SOS.tolist(),
            "mel_filterbank_f32le_base64": base64.b64encode(
                librosa.filters.mel(
                    sr=22050, n_fft=2048, n_mels=128, fmin=0.0,
                    fmax=11025.0, htk=False, norm="slaney", dtype=np.float32,
                ).astype("<f4", copy=False).tobytes()
            ).decode("ascii"),
            "matcher_options": {
                "score_temperature": 0.3,
                "original_penalty": 0.2,
                "save_penalty_max": 1.0,
                "save_weight": 0.5,
                "radius": 1,
            },
            "confidence_tolerance": 0.00001,
            "notes": [
                "Reference self-matches are regression checks, not a measure of generalization accuracy.",
                "Padded-attenuated cases add 100 ms leading and 200 ms trailing silence and scale to 0.35.",
                "The silence case must return no category.",
            ],
            "reference_features": {
                category: {
                    tier: [feature.tolist() for feature in features]
                    for tier, features in tiers.items()
                }
                for category, tiers in matcher._features.items()
            },
            "cases": build_cases(matcher, args.output.parent / "audio"),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['cases'])} cases to {args.output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()