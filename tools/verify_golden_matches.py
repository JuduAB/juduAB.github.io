"""Verify the checked-in golden WAV cases against the current Python matcher."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.core.audio_matcher import AudioMatcher  # noqa: E402

GOLDEN_PATH = ROOT / "mobile" / "tests" / "golden-matches.json"


def main() -> None:
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    failures = []
    with tempfile.TemporaryDirectory(prefix="audio-golden-cache-") as cache_dir:
        matcher = AudioMatcher(cache_dir=Path(cache_dir))
        for case in golden["cases"]:
            wav_path = GOLDEN_PATH.parent / case["input_wav"]
            digest = hashlib.sha256(wav_path.read_bytes()).hexdigest()
            if digest != case["sha256"]:
                failures.append(f"{case['id']}: fixture SHA-256 mismatch")
                continue
            result = matcher.match(wav_path)
            category, confidence = result if result is not None else (None, 0.0)
            if category != case["expected_category"]:
                failures.append(
                    f"{case['id']}: category {category!r} != {case['expected_category']!r}"
                )
            elif abs(confidence - case["expected_confidence"]) > golden["confidence_tolerance"]:
                failures.append(
                    f"{case['id']}: confidence {confidence:.8f} != "
                    f"{case['expected_confidence']:.8f}"
                )

    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Verified {len(golden['cases'])} golden matcher cases.")


if __name__ == "__main__":
    main()