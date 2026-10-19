"""Take an inspection out of review mode and back to 'completed' (the state before Start Review).

    python scripts/cancel_review.py <inspection_id> [--discard] [--dry-run]

Without --discard it refuses if any review work exists (submitted reviews or engineer added
findings), so nothing is lost by accident. With --discard that work is removed the same way the
platform's own reopen does, then the inspection goes back to 'completed' with the CV findings
unlocked. Run inside the backend container. Written 2026-10-19 because the platform has no way
out of review mode other than finishing it.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.models.detection import Detection  # noqa: E402
from app.models.detection_review import DetectionReview  # noqa: E402
from app.models.image import Image  # noqa: E402
from app.models.inspection import Inspection  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inspection_id")
    ap.add_argument("--discard", action="store_true", help="also remove submitted reviews and engineer added findings")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = SessionLocal()
    try:
        insp = db.query(Inspection).filter(Inspection.id == a.inspection_id).first()
        if insp is None:
            print(f"no inspection {a.inspection_id}")
            return 1
        image_ids = [r[0] for r in db.query(Image.id).filter(Image.inspection_id == insp.id).all()]
        reviews = db.query(DetectionReview).filter(DetectionReview.image_id.in_(image_ids)).count() if image_ids else 0
        added = db.query(Detection).filter(Detection.image_id.in_(image_ids), Detection.source == "engineer_added").count() if image_ids else 0
        locked = db.query(Detection).filter(Detection.image_id.in_(image_ids), Detection.is_locked.is_(True)).count() if image_ids else 0
        print(f"inspection {insp.name!r}: status {insp.status}, {len(image_ids)} images, "
              f"{reviews} submitted review records, {added} engineer added findings, {locked} locked CV findings")
        if insp.status not in ("pending_review", "review_completed"):
            print("not in review mode, nothing to do")
            return 0
        if (reviews or added) and not a.discard:
            print("refusing: review work exists. Rerun with --discard to throw it away, or finish the review instead.")
            return 1
        if a.dry_run:
            print("dry run: would " + ("discard that work, " if a.discard else "") + "unlock the CV findings and set status back to completed")
            return 0
        if a.discard and image_ids:
            db.query(DetectionReview).filter(DetectionReview.image_id.in_(image_ids)).delete(synchronize_session=False)
            db.query(Detection).filter(Detection.image_id.in_(image_ids), Detection.source == "engineer_added").delete(synchronize_session=False)
        if image_ids:
            db.query(Detection).filter(Detection.image_id.in_(image_ids)).update(
                {Detection.is_locked: False, Detection.reviewed: False, Detection.reviewed_by: None, Detection.review_date: None},
                synchronize_session=False,
            )
        insp.status = "completed"
        db.commit()
        print(f"done: {insp.name!r} is back to 'completed', CV findings unlocked")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
