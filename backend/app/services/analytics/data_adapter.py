# Bridge between the app database and the analytics engine.
#
# The analytics engine was built as a standalone module that reads
# inspection history from a CSV file. In the real application that
# same data lives across four database tables:
#
#   assets -> inspections -> images -> detections
#
# This module queries those tables and assembles the result as a
# pandas DataFrame in the exact shape the engine expects as input.

from typing import Optional

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.asset      import Asset
from app.models.detection  import Detection
from app.models.image      import Image
from app.models.inspection import Inspection


# Column schema the analytics engine consumes. Matches the
# sample_input.csv that ships with the standalone module.
EXPECTED_COLUMNS = [
    "asset_id",
    "asset_name",
    "asset_type",
    "inspection_date",
    "severity_score",
]


def build_analytics_dataframe(
    db              : Session,
    organization_id : str,
    asset_id        : Optional[str] = None,
) -> pd.DataFrame:
    """
    Query the database and return a DataFrame in the format
    the analytics engine expects as input.

    Join path: assets -> inspections -> images -> detections.
    Only completed inspections and non-null severity values are used.
    Severity is aggregated to MAX per (asset, inspection_date) because
    a single inspection can contain many images, each with many
    detections — the worst-severity finding represents that inspection.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy session, typically supplied by the FastAPI
        get_db dependency.
    organization_id : str
        Organisation whose data should be returned. Required for
        multi-tenant data isolation — the query never crosses orgs.
    asset_id : str, optional
        If provided, restrict results to this single asset.

    Returns
    -------
    pd.DataFrame
        Columns: asset_id, asset_name, asset_type, inspection_date,
        severity_score. One row per (asset, inspection_date) with the
        maximum severity seen in that inspection. Empty DataFrame with
        the correct columns when no data is found.

    Raises
    ------
    ValueError
        If organization_id is missing or empty. This is a programmer
        error, not a data-not-found case, and must fail loudly to
        prevent accidental cross-org leakage.
    """

    # Fail fast on a missing org scope. An empty string here would
    # silently match no rows, which looks like a successful "no data"
    # result and could mask a real bug in the caller.
    if not organization_id:
        raise ValueError(
            "build_analytics_dataframe: organization_id is required; "
            "got %r" % (organization_id,)
        )

    # We pull inspection_date (DATE) and inspected_at (DATETIME) as
    # SEPARATE columns rather than using SQL COALESCE. Reason: in
    # SQLite, coalesce of DATE and DATETIME hands back a string like
    # '2026-02-11 00:00:00.000000', and SQLAlchemy's DATE column type
    # converter blows up on that with "Invalid isoformat string"
    # because date.fromisoformat only accepts 'YYYY-MM-DD'.
    # Coalescing in Python sidesteps the type-coercion issue.
    query = (
        db.query(
            Asset.id.label("asset_id"),
            Asset.name.label("asset_name"),
            Asset.infrastructure_type.label("asset_type"),
            Inspection.inspection_date.label("_inspection_date"),
            Inspection.inspected_at.label("_inspected_at"),
            Detection.severity.label("severity_score"),
        )
        .join(Inspection, Inspection.asset_id    == Asset.id)
        .join(Image,      Image.inspection_id    == Inspection.id)
        .join(Detection,  Detection.image_id     == Image.id)
        .filter(Asset.organization_id == organization_id)
        .filter(Inspection.status == "completed")
        .filter(Detection.severity.isnot(None))
    )

    if asset_id is not None:
        query = query.filter(Asset.id == asset_id)

    rows = query.all()

    if not rows:
        return pd.DataFrame(columns=EXPECTED_COLUMNS)

    # Coalesce in Python: prefer inspection_date (DATE), fall back to
    # inspected_at (DATETIME) coerced down to a plain date. Skip rows
    # where neither column is set — the engine cannot place an
    # inspection on the timeline without one.
    records = []
    for r in rows:
        d = r._inspection_date
        if d is None and r._inspected_at is not None:
            d = r._inspected_at.date()
        if d is None:
            continue
        records.append({
            "asset_id":        r.asset_id,
            "asset_name":      r.asset_name,
            "asset_type":      r.asset_type,
            "inspection_date": d,
            "severity_score":  r.severity_score,
        })

    if not records:
        return pd.DataFrame(columns=EXPECTED_COLUMNS)

    df = pd.DataFrame(records, columns=EXPECTED_COLUMNS)

    # Aggregate to MAX severity per (asset, inspection_date).
    # Severity strings S1..S4 are lexicographically ordered so pandas
    # string 'max' yields the correct worst-severity value.
    df = (
        df
        .groupby(
            ["asset_id", "asset_name", "asset_type", "inspection_date"],
            as_index=False,
            dropna=False,
        )
        .agg({"severity_score": "max"})
    )

    return df[EXPECTED_COLUMNS]
