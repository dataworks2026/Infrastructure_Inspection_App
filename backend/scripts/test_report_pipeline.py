"""Smoke-test the new report pipeline against the live RDS database.

Skips uvicorn entirely. Connects to whatever DATABASE_URL points to in
backend/.env (currently the RDS instance), lists inspections, picks one
with detections, runs the full pipeline, and writes a PDF to disk.

Run from backend/ directory:
    venv/Scripts/python.exe scripts/test_report_pipeline.py
    venv/Scripts/python.exe scripts/test_report_pipeline.py <inspection_id>
"""
import os
import sys
from collections import Counter
from pathlib import Path

# Make `app.*` imports work when running outside uvicorn
HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)  # so storage/ etc. paths resolve

from app.database import SessionLocal
from app.models.detection import Detection
from app.models.image import Image
from app.models.inspection import Inspection
from app.services.reports.db_loader import load_inspection_records
from app.services.reports.metrics import calculate_metrics
from app.services.reports.narrative import generate_narrative
from app.services.reports.pdf_report import generate_pdf
from app.services.reports.report_builder import build_report_data


def pick_inspection(db, override_id: str | None):
    if override_id:
        i = db.query(Inspection).filter(Inspection.id == override_id).first()
        if not i:
            sys.exit(f"Inspection {override_id!r} not found.")
        return i

    # Pick the first inspection that has at least one detection.
    candidates = (
        db.query(Inspection)
        .order_by(Inspection.created_at.desc())
        .limit(50)
        .all()
    )
    print(f"Scanning {len(candidates)} most recent inspections for detections...")
    for insp in candidates:
        n = (
            db.query(Detection)
            .join(Image, Detection.image_id == Image.id)
            .filter(Image.inspection_id == insp.id)
            .count()
        )
        if n > 0:
            print(f"  → {insp.id}  '{insp.name}'  ({n} detections)")
            return insp
    sys.exit("No inspections in RDS have any detections.")


def main():
    override_id = sys.argv[1] if len(sys.argv) > 1 else None
    db = SessionLocal()
    try:
        print("Connecting to:", os.environ.get("DATABASE_URL", "<from .env>")
              .split("@")[-1] if "@" in os.environ.get("DATABASE_URL", "")
              else "(see .env)")
        print()

        insp = pick_inspection(db, override_id)
        org_id = insp.organization_id  # use the inspection's org as the scope

        print("\n--- Calling load_inspection_records ---")
        records, meta = load_inspection_records(db, insp.id, org_id)
        print(f"records returned: {len(records)}")
        print(f"meta keys: {sorted(meta.keys())}")
        print()

        # Diagnostic: what do the real field values look like?
        damage_vals = Counter(r["defect_type"] for r in records)
        sev_vals    = Counter(r["severity"]    for r in records)
        comp_vals   = Counter(r["component_type"] for r in records)
        conf_low    = sum(1 for r in records if r["confidence"] == 0.0)

        print("--- Diagnostic: real field shapes ---")
        print(f"defect_type counts ({len(damage_vals)} distinct):")
        for k, v in damage_vals.most_common(10):
            print(f"  {k!r:<35} {v}")
        print(f"severity counts ({len(sev_vals)} distinct):")
        for k, v in sev_vals.most_common():
            print(f"  {k!r:<10} {v}")
        print(f"component_type counts ({len(comp_vals)} distinct):")
        for k, v in comp_vals.most_common(8):
            print(f"  {k!r:<25} {v}")
        print(f"detections with confidence == 0.0: {conf_low}/{len(records)}")
        print()

        print("--- Running metrics ---")
        m = calculate_metrics(records)
        print(f"total_detections:   {m['total_detections']}")
        print(f"image_count:        {m['image_count']}")
        print(f"top_3_defects:      {m['top_3_defects']}")
        print(f"avg_confidence:     {m['avg_confidence']:.3f}")
        print(f"risk_level_counts:  {m['risk_level_counts']}")
        print(f"overall_risk_score: {m['overall_risk_score']}/100")
        print()

        print("--- Running narrative ---")
        n = generate_narrative(m)
        print(f"risk_assessment: {n['risk_assessment']}")
        print(f"executive_summary:\n  {n['executive_summary']}")
        print()

        print("--- Building report data + PDF ---")
        rd = build_report_data(records, meta, n)
        print(f"matrix rows w/ data: "
              f"{sum(1 for r in rd['summary']['matrix'] if r['total'] > 0)}/8")
        print(f"column totals: {rd['summary']['column_totals']}")
        print(f"image_findings: {len(rd['image_findings'])}")
        print()

        # Warn if everything mapped to 'Unknown' — the concern #2 case
        unknown = sum(
            sum(1 for d in f["detections"] if d["damage_code"] == "Unknown")
            for f in rd["image_findings"]
        )
        if unknown == len(records) and len(records) > 0:
            print("WARN: every detection mapped to 'Unknown' damage_code.")
            print("      Detection.damage_type strings in your DB don't match")
            print("      Andrew's DAMAGE_TYPE_TO_CODE keys. Need to map via")
            print("      Detection.damage_type_id → damage_types table.")
            print()

        pdf = generate_pdf(rd)
        out = BACKEND / "scripts" / "test_report.pdf"
        out.write_bytes(pdf)
        print(f"PDF: {len(pdf):,} bytes → {out}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
