"""Load the signed class vocabulary (vocabulary_v1.json) for one organization.

Idempotent: rows already present are left alone, so it can run again after a
partial load. Rows are written with provisional=False because v1 is signed;
the source column records the vocabulary hash so an audit can tie every row
back to the signed file.

    python scripts/recommendations/seed_vocabulary_v1.py --org <organization_id>
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import SessionLocal  # noqa: E402
from app.models.recommendation import RecommendationClassVocabulary  # noqa: E402

VOCABULARY_FILE = Path(__file__).with_name("vocabulary_v1.json")


def load_signed_vocabulary() -> dict:
    data = json.loads(VOCABULARY_FILE.read_text(encoding="utf-8"))
    recomputed = hashlib.sha256(json.dumps(sorted(data["vocabulary"]), sort_keys=True).encode("utf-8")).hexdigest()[:16]
    if recomputed != data["vocabulary_hash"]:
        raise SystemExit(f"vocabulary_v1.json hash mismatch: file says {data['vocabulary_hash']}, list hashes to {recomputed}")
    return data


def seed(organization_id: str) -> tuple[int, int]:
    data = load_signed_vocabulary()
    source = f"vocabulary_v{data['vocabulary_version']} {data['vocabulary_hash']} signed {data['signed_at']}"
    added = skipped = 0
    db = SessionLocal()
    try:
        for class_value in data["vocabulary"]:
            if db.get(RecommendationClassVocabulary, (organization_id, class_value)) is not None:
                skipped += 1
                continue
            db.add(
                RecommendationClassVocabulary(
                    organization_id=organization_id,
                    class_value=class_value,
                    provisional=False,
                    source=source,
                )
            )
            added += 1
        db.commit()
    finally:
        db.close()
    return added, skipped


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--org", required=True, help="organization_id to load the vocabulary for")
    args = parser.parse_args()
    added, skipped = seed(args.org)
    print(f"vocabulary v1 for {args.org}: {added} added, {skipped} already present")
