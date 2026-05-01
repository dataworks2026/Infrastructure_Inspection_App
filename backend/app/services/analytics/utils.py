"""
Shared helpers for the analytics integration layer.

Lives outside the vendored engine code so app-side modules
(routers/predictive.py, services/analytics/result_mapper.py) can
share small bits of conversion logic without re-defining them.
"""

import math
from typing import Optional


def nan_to_none(value):
    """Coerce NaN floats into None so the value is JSON-serialisable
    and Pydantic Optional[...] validation passes. pandas uses NaN as
    the missing-value sentinel in numeric columns; that survives a
    JSONB round-trip and breaks downstream code if not stripped."""
    if value is None:
        return None
    try:
        if isinstance(value, float) and math.isnan(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def severity_label_to_int(label) -> Optional[int]:
    """Parse 'S1'..'S4' (or a raw int) into 1..4. Returns None on
    anything unrecognisable so the caller can choose to default or
    skip (the read path defaults to 0; the timeline builder skips)."""
    if label is None:
        return None
    try:
        return int(str(label).lstrip("S"))
    except (TypeError, ValueError):
        return None
