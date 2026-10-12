"""Load the signed class vocabulary (vocabulary_v1.json) for its producer.

One vocabulary per model weights file, global, signed once (CTO decision
2026-09-24). Idempotent: the vocabulary row is matched on the weights hash
and the class rows already present are left alone, so it can run again
after a partial load. The row is written signed only if the file reads
signed; a prepared file loads as provisional.

    python scripts/recommendations/seed_vocabulary_v1.py [--weights ml_models/coastal/coastal_best.pt]

With --weights the file on disk is hashed and must match the signed record;
the seed refuses to load a vocabulary against weights it was not signed for.
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import SessionLocal  # noqa: E402
from app.models.recommendation import RecommendationClassVocabulary, RecommendationVocabulary  # noqa: E402

VOCABULARY_FILE = Path(__file__).with_name("vocabulary_v1.json")


def load_signed_vocabulary() -> dict:
    data = json.loads(VOCABULARY_FILE.read_text(encoding="utf-8"))
    recomputed = hashlib.sha256(json.dumps(sorted(data["vocabulary"]), sort_keys=True).encode("utf-8")).hexdigest()[:16]
    if recomputed != data["vocabulary_hash"]:
        raise SystemExit(f"vocabulary_v1.json hash mismatch: file says {data['vocabulary_hash']}, list hashes to {recomputed}")
    return data


def check_weights(data: dict, weights: Path) -> None:
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    if digest != data["weights_sha256"]:
        raise SystemExit(
            f"{weights} hashes to {digest}, but the vocabulary was signed for {data['weights_sha256']}; "
            "a different weights file needs its own signed vocabulary version"
        )


def seed(data: dict) -> tuple[str, int, int]:
    signed = data.get("status") == "signed" and data.get("signed_by") and data.get("signed_at")
    db = SessionLocal()
    try:
        vocab = (
            db.query(RecommendationVocabulary)
            .filter(RecommendationVocabulary.weights_sha256 == data["weights_sha256"])
            .first()
        )
        if vocab is None:
            vocab = RecommendationVocabulary(
                producer=data["producer"],
                weights_sha256=data["weights_sha256"],
                version=int(data["vocabulary_version"]),
                vocabulary_hash=data["vocabulary_hash"],
                status="signed" if signed else "provisional",
                signed_by=data["signed_by"] if signed else None,
                signed_at=datetime.fromisoformat(data["signed_at"]) if signed else None,
            )
            db.add(vocab)
            db.flush()
        added = skipped = 0
        for class_value in data["vocabulary"]:
            if db.get(RecommendationClassVocabulary, (vocab.id, class_value)) is not None:
                skipped += 1
                continue
            db.add(RecommendationClassVocabulary(vocabulary_id=vocab.id, class_value=class_value))
            added += 1
        db.commit()
        return vocab.id, added, skipped
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", type=Path, default=None, help="weights file to verify against the signed record")
    args = parser.parse_args()
    data = load_signed_vocabulary()
    if args.weights is not None:
        check_weights(data, args.weights)
    vocab_id, added, skipped = seed(data)
    print(f"vocabulary {data['producer']} v{data['vocabulary_version']} ({data['status']}) id {vocab_id}: {added} classes added, {skipped} already present")
