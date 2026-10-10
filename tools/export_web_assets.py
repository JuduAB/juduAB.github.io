"""Package local matcher data as one JavaScript asset for file:// pages."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
import wave
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
DATA_DIR = ROOT / "data"
REFERENCE_DIR = DATA_DIR / "original_ audio"
MAP_DIR = DATA_DIR / "json_map"
DEFAULT_OUTPUT = ROOT / "mobile" / "data" / "audio-assets.js"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    from src.core.audio_matcher import AudioMatcher, _PARAMS, _SOS

    with tempfile.TemporaryDirectory(prefix="web-audio-cache-") as cache_dir:
        matcher = AudioMatcher(cache_dir=Path(cache_dir))
        features = {
            category: {
                tier: [feature.astype(np.float32).tolist() for feature in values]
                for tier, values in tiers.items()
            }
            for category, tiers in matcher._features.items()
        }

    mel_bank = librosa.filters.mel(
        sr=22050,
        n_fft=2048,
        n_mels=128,
        fmin=0.0,
        fmax=11025.0,
        htk=False,
        norm="slaney",
        dtype=np.float32,
    )
    maps = {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(MAP_DIR.glob("*.json"))
    }
    reference_audio = {}
    for path in sorted(REFERENCE_DIR.glob("*.wav")):
        with wave.open(str(path), "rb") as audio:
            params = audio.getparams()
        reference_audio[path.stem] = {
            "mime": "audio/wav",
            "base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            "sample_rate": params.framerate,
            "channels": params.nchannels,
        }

    payload = {
        "schemaVersion": 1,
        "pipelineVersion": _PARAMS["pipeline"],
        "matcherOptions": {
            "scoreTemperature": 0.3,
            "originalPenalty": 0.2,
            "savePenaltyMax": 1.0,
            "saveWeight": 0.5,
            "radius": 1,
        },
        "mfccOptions": {
            "sampleRate": 22050,
            "fftSize": 2048,
            "hopSize": 512,
            "melBands": 128,
            "coefficientCount": 20,
            "amin": 1e-10,
            "topDb": 80,
            "cmvnEpsilon": 1e-9,
        },
        "butterworthSos": _SOS.tolist(),
        "melBankF32leBase64": base64.b64encode(
            mel_bank.astype("<f4", copy=False).tobytes()
        ).decode("ascii"),
        "features": features,
        "maps": maps,
        "referenceAudio": reference_audio,
    }
    output = "globalThis.AUDIO_WEB_ASSETS = " + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ) + ";\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8")
    print(f"Wrote local browser assets: {args.output.relative_to(ROOT)} ({len(output.encode('utf-8')):,} bytes)")


if __name__ == "__main__":
    main()