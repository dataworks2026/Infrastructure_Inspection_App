"""Stage 2 adapter (detection_feed): the platform's reviewed findings become
MatchableDetection the way Rev B 8.3 says. Pure platform rows in, engine
input out; no engine run here.
"""
import pytest

from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection, InspectionStatus
from app.services.recommendations.detection_feed import (
    ReviewNotCompleted,
    load_matchable_detections,
    normalize_class,
    signed_classes,
)

VOCAB = {"corrosion", "spalling", "cracking", "biological growth", "decay", "loss", "coating failure"}


def _inspection(db, org_id, status=InspectionStatus.review_completed.value, suffix="a"):
    asset = Asset(id=f"asset-feed-{suffix}", organization_id=org_id, name="Feed Pier", infrastructure_type="coastal")
    insp = Inspection(id=f"insp-feed-{suffix}", organization_id=org_id, asset_id=asset.id, name="Feed inspection", status=status)
    img = Image(id=f"img-feed-{suffix}", organization_id=org_id, inspection_id=insp.id, filename="f.jpg",
                stored_path="nowhere/f.jpg", gps_lat=40.68, gps_lon=-74.01, analysis_status="completed")
    db.add_all([asset, insp, img]); db.flush()
    return insp, img


def _det(db, img, id, damage_type, severity, source="cv_model", conf=0.9):
    d = Detection(id=id, organization_id=img.organization_id, image_id=img.id, damage_type=damage_type,
                  severity=severity, confidence=conf, confidence_score=conf, source=source,
                  bbox_x1=1, bbox_y1=1, bbox_x2=2, bbox_y2=2)
    db.add(d); db.flush()
    return d


def _review(db, insp, img, action, cv=None, eng=None):
    r = DetectionReview(organization_id=insp.organization_id, image_id=img.id, inspection_id=insp.id,
                        cv_detection_id=cv, engineer_detection_id=eng, action=action, reviewed_by="eng@example.com")
    db.add(r); db.flush()
    return r


def test_normalize_class_matches_authoring():
    assert normalize_class("  Biological–Growth ") == "biological growth"
    assert normalize_class("Corrosion") == "corrosion"
    assert normalize_class(None) == ""


def test_signed_classes_come_from_the_vocabulary(db_session, test_org, rec_vocab):
    from tests.recommendations.conftest import TEST_PRODUCER
    classes = signed_classes(db_session, TEST_PRODUCER)
    assert set(rec_vocab) == classes


def test_accepted_rejected_modified_added(db_session, test_org):
    org = test_org.organization_id
    insp, img = _inspection(db_session, org)
    accepted = _det(db_session, img, "cv-acc", "Corrosion", "S4")
    rejected = _det(db_session, img, "cv-rej", "Spalling", "S3")
    original = _det(db_session, img, "cv-mod", "Cracking", "S2")
    corrected = _det(db_session, img, "eng-mod", "Cracking", "S4", source="engineer_added", conf=1.0)
    added = _det(db_session, img, "eng-add", "Decay", "S3", source="engineer_added", conf=1.0)
    _review(db_session, insp, img, "accepted", cv=accepted.id)
    _review(db_session, insp, img, "rejected", cv=rejected.id)
    _review(db_session, insp, img, "modified", cv=original.id, eng=corrected.id)
    _review(db_session, insp, img, "added", eng=added.id)

    dets, summary = load_matchable_detections(db_session, org, insp.id, VOCAB)
    by_id = {d.id: d for d in dets}

    assert summary.detections_read == 5 and summary.consumed == 4 and summary.replaced_by_modification == 1
    assert "cv-mod" not in by_id, "the modified CV row is replaced, never consumed twice"
    assert by_id["cv-acc"].severity == 4 and by_id["cv-acc"].chain_key == "cv-acc" and not by_id["cv-acc"].dismissed
    assert by_id["cv-rej"].dismissed and by_id["cv-rej"].skip_reason is None
    assert by_id["eng-mod"].chain_key == "cv-mod", "a correction keeps the chain identity of the original CV row"
    assert by_id["eng-mod"].severity == 4
    assert by_id["eng-add"].chain_key == "eng-add"
    assert by_id["cv-acc"].asset_id == "asset-feed-a" and by_id["cv-acc"].asset_type == "coastal"
    assert by_id["cv-acc"].location == {"lat": 40.68, "lng": -74.01, "alt": None}
    assert by_id["cv-acc"].inspection_id == insp.id


def test_out_of_domain_severity_and_unvetted_class_are_skipped_with_reasons(db_session, test_org):
    org = test_org.organization_id
    insp, img = _inspection(db_session, org, suffix="b")
    nulls = _det(db_session, img, "cv-null", "Corrosion", None)
    unvetted = _det(db_session, img, "cv-rust", "Rust Staining", "S2")
    for d in (nulls, unvetted):
        _review(db_session, insp, img, "accepted", cv=d.id)

    dets, _ = load_matchable_detections(db_session, org, insp.id, VOCAB)
    reasons = {d.id: d.skip_reason for d in dets}
    assert reasons["cv-null"] == "severity out of domain: None"
    assert reasons["cv-rust"] == "unvetted class: 'Rust Staining'"
    assert len(dets) == 2, "skipped rows are still consumed and counted"


def test_s0_cannot_be_written_but_would_be_skipped(db_session, test_org):
    # d9's CHECK keeps S0 out of the table (issue #16). The adapter still maps
    # it to a skip with the raw value, for legacy rows on a database older
    # than d9; exercised on a row that is never inserted.
    from app.services.recommendations.detection_feed import _matchable
    legacy = Detection(id="cv-s0", organization_id=test_org.organization_id, image_id="img-none",
                       damage_type="Corrosion", severity="S0", confidence=0.9, source="cv_model")
    m = _matchable(legacy, "cv-s0", None, None, {}, VOCAB)
    assert m.skip_reason == "severity out of domain: 'S0'" and m.severity == 0


def test_engineer_gate(db_session, test_org):
    org = test_org.organization_id
    insp, img = _inspection(db_session, org, status=InspectionStatus.completed.value, suffix="c")
    _det(db_session, img, "cv-unrev", "Corrosion", "S4")
    with pytest.raises(ReviewNotCompleted):
        load_matchable_detections(db_session, org, insp.id, VOCAB)
    dets, summary = load_matchable_detections(db_session, org, insp.id, VOCAB, require_review=False)
    assert [d.id for d in dets] == ["cv-unrev"] and dets[0].skip_reason is None
    assert summary.inspection_status == "completed"


def test_other_organizations_inspection_is_not_found(db_session, test_org, other_org):
    insp, img = _inspection(db_session, other_org.organization_id, suffix="d")
    with pytest.raises(LookupError):
        load_matchable_detections(db_session, test_org.organization_id, insp.id, VOCAB)
