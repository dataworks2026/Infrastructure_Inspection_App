"""Rename the display names of every image in one inspection to <prefix>_<number>, keeping the
current order. Run inside the backend container:

    python scripts/rename_inspection_images.py <inspection_id> <prefix> [--pad 3] [--dry-run]

Example: python scripts/rename_inspection_images.py a46a5a04-... Seawall  ->  Seawall_001.jpg ...
Only the display name changes; the file on disk keeps its uuid name, so nothing else is touched.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.models.image import Image  # noqa: E402
from app.models.inspection import Inspection  # noqa: E402


def number_in(name: str) -> int:
    m = re.search(r"_(\d+)\.[A-Za-z0-9]+$", name or "")
    return int(m.group(1)) if m else 10**9


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inspection_id")
    ap.add_argument("prefix")
    ap.add_argument("--pad", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = SessionLocal()
    try:
        insp = db.query(Inspection).filter(Inspection.id == a.inspection_id).first()
        if insp is None:
            print(f"no inspection {a.inspection_id}")
            return 1
        images = db.query(Image).filter(Image.inspection_id == insp.id, Image.deleted_at.is_(None)).all()
        images.sort(key=lambda i: (number_in(i.filename), i.filename or ""))
        print(f"inspection {insp.name!r}: {len(images)} images")
        changed = 0
        for n, img in enumerate(images, 1):
            m = re.search(r"(\.[A-Za-z0-9]+)$", img.filename or "")
            ext = (m.group(1) if m else ".jpg").lower()
            new = f"{a.prefix}_{n:0{a.pad}d}{ext}"
            if img.filename == new:
                continue
            if n <= 3 or n == len(images):
                print(f"  {img.filename} -> {new}")
            if not a.dry_run:
                img.filename = new
                img.original_filename = new
            changed += 1
        if not a.dry_run:
            db.commit()
        print(f"{'would rename' if a.dry_run else 'renamed'} {changed} images")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
