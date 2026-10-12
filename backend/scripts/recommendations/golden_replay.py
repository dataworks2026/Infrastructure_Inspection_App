"""Stage 2 gate: the golden replay (V&V matrix Summary, hash 1ed642b1f0873c5c).

Replays the Phase 1 data package export (tahya-data-package/dataset) through
the ported engine on a scratch SQLite database, against the signed
vocabulary v1 and the starter rule library, and prints the MAT-6
reconciliation:

    matched + unmatched + dismissed + skipped = rows consumed

Nothing here touches a real database. The vocabulary file is re-hashed with
the signed method and the run refuses to start if it does not come out as
1ed642b1f0873c5c, so the replay is always against the signed list.

    python scripts/recommendations/golden_replay.py [--package PATH] [--out FILE]
"""
import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  (registers every table on Base)
from app.models.organization import Organization  # noqa: E402
from app.models.recommendation import (  # noqa: E402
    RecommendationClassVocabulary,
    RecommendationPriorityTier,
    RecommendationSeverity,
    RecommendationVocabulary,
)
from app.schemas.recommendation import EntryWrite  # noqa: E402
from app.services.recommendations import authoring, engine  # noqa: E402
from app.services.recommendations.detection_feed import SEVERITY_TO_INT, normalize_class  # noqa: E402
from app.services.recommendations.tiers import TIER_LABELS  # noqa: E402
from app.services.recommendations.types import MatchableDetection  # noqa: E402

SIGNED_HASH = "1ed642b1f0873c5c"
VOCABULARY_FILE = HERE.with_name("vocabulary_v1.json")
STARTER_RULES = HERE.with_name("starter_rules_v1.csv")
DEFAULT_PACKAGE = Path(r"C:\Users\IT\Mira\tahya-data-package\dataset")
ACTOR = "golden-replay"
ORG_ID = "golden-replay-org"


def vocabulary_hash(classes: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(classes), sort_keys=True).encode("utf-8")).hexdigest()[:16]


def scratch_session():
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def seed(db, vocab: dict) -> RecommendationVocabulary:
    db.add(Organization(organization_id=ORG_ID, name="Golden replay", slug="golden-replay"))
    for s in (1, 2, 3, 4):
        db.add(RecommendationSeverity(severity=s, label=str(s)))
    for tier, label in TIER_LABELS.items():
        db.add(RecommendationPriorityTier(tier=tier, label=label))
    v = RecommendationVocabulary(
        producer=vocab["producer"], weights_sha256=vocab["weights_sha256"], version=int(vocab["vocabulary_version"]),
        vocabulary_hash=vocab["vocabulary_hash"], status="signed", signed_by=vocab["signed_by"],
        signed_at=datetime.fromisoformat(vocab["signed_at"]),
    )
    db.add(v)
    db.flush()
    for c in vocab["vocabulary"]:
        db.add(RecommendationClassVocabulary(vocabulary_id=v.id, class_value=c))
    db.commit()
    return v


def load_rules(db) -> int:
    n = 0
    with STARTER_RULES.open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            authoring.create_entry(db, ORG_ID, EntryWrite(
                actor=ACTOR, producer=row.get("producer") or "coastal",
                detection_class=row["detection_class"], severity=int(row["severity"]),
                asset_type=row.get("asset_type") or None, asset_id=row.get("asset_id") or None,
                recommendation_text=row["recommendation_text"], action_class=row["action_class"],
                tier_override=int(row["tier_override"]) if row.get("tier_override") else None,
            ))
            n += 1
    return n


def matchable(package: Path, signed: set[str]) -> list[MatchableDetection]:
    detections = json.loads((package / "detections.json").read_text(encoding="utf-8"))
    assets = {a["id"]: a for a in json.loads((package / "assets.json").read_text(encoding="utf-8"))}
    out = []
    for d in detections:
        cls = normalize_class(d.get("class"))
        severity = SEVERITY_TO_INT.get(d.get("severity") or "", 0)
        reason = None
        if severity == 0:
            reason = f"severity out of domain: {d.get('severity')!r}"
        elif cls not in signed:
            reason = f"unvetted class: {d.get('class')!r}"
        asset = assets.get(d.get("asset_id") or "")
        loc = d.get("back_projected_location") or None
        out.append(MatchableDetection(
            id=d["id"], chain_key=d["id"], detection_class=cls, severity=severity,
            confidence=float(d.get("confidence") or 0.0), image_id=d.get("image_id"),
            asset_id=d.get("asset_id"), asset_type=(asset or {}).get("type"), inspection_id=d.get("mission_id"),
            location={"lat": loc["lat"], "lng": loc["lng"]} if loc else None,
            dismissed=bool(d.get("reviewed") and d.get("review_action") == "rejected"),
            skip_reason=reason,
        ))
    return out


def replay(package: Path) -> dict:
    vocab = json.loads(VOCABULARY_FILE.read_text(encoding="utf-8"))
    recomputed = vocabulary_hash(vocab["vocabulary"])
    if recomputed != SIGNED_HASH or vocab["vocabulary_hash"] != SIGNED_HASH:
        raise SystemExit(f"vocabulary hash {recomputed} is not the signed {SIGNED_HASH}; replay refused")

    db = scratch_session()
    seed(db, vocab)
    rules = load_rules(db)
    signed = set(vocab["vocabulary"])
    dets = matchable(package, signed)
    run = engine.run_resolution(db, ORG_ID, None, dets, "asset", ACTOR, producer=vocab["producer"])
    records = engine.get_records_for_run(db, run.id)

    by_status = Counter(r.status for r in records)
    skipped_reasons = Counter((d.skip_reason or "").split(":")[0] for d in dets if d.skip_reason)
    unvetted = sorted({d.detection_class for d in dets if d.skip_reason and d.skip_reason.startswith("unvetted")})
    return {
        "package": str(package),
        "vocabulary_hash": recomputed,
        "weights_sha256": vocab["weights_sha256"],
        "rules_loaded": rules,
        "rows_in_export": len(dets),
        "consumed": run.total_detections,
        "matched": run.total_matched,
        "unmatched": run.total_unmatched,
        "dismissed": run.total_dismissed,
        "skipped": run.total_skipped,
        "skipped_by_reason": dict(skipped_reasons),
        "unvetted_classes": unvetted,
        "records_by_status": dict(by_status),
        "records": [
            {"status": r.status, "class": engine.get_detection_classes(db, r.id), "entry": r.matched_entry_id, "version": r.matched_entry_version}
            for r in records
        ],
        "reconciles": run.total_matched + run.total_unmatched + run.total_dismissed + run.total_skipped == run.total_detections,
    }


def render(result: dict) -> str:
    lines = [
        f"Golden replay, {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"Package: {result['package']}",
        f"Vocabulary: coastal v1, hash {result['vocabulary_hash']} (signed), weights sha256 {result['weights_sha256'][:12]}...",
        f"Rules loaded from the starter library: {result['rules_loaded']}",
        "",
        f"Rows in the export: {result['rows_in_export']}",
        f"Consumed by the run: {result['consumed']}",
        f"  matched    {result['matched']}",
        f"  unmatched  {result['unmatched']}  (vetted class and severity, no rule yet)",
        f"  dismissed  {result['dismissed']}",
        f"  skipped    {result['skipped']}  {result['skipped_by_reason']}",
        f"  {result['matched']} + {result['unmatched']} + {result['dismissed']} + {result['skipped']} = {result['consumed']}  "
        f"{'OK' if result['reconciles'] else 'DOES NOT RECONCILE'}",
        "",
        f"Records by status: {result['records_by_status']}",
        f"Classes skipped as unvetted (not in the signed seven): {', '.join(result['unvetted_classes']) or 'none'}",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    parser.add_argument("--out", type=Path, default=None, help="also write the printout to this file")
    args = parser.parse_args()
    result = replay(args.package)
    text = render(result)
    print(text)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    sys.exit(0 if result["reconciles"] else 1)
