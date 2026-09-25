"""Ported from Tahya's Phase-1 service (tests/test_tiers.py). Pure logic,
no DB -- and unchanged by the port, since Matteo's Reconciliation 2 keeps
the three OI-4 tiers exactly as she built them.
"""

import pytest

from app.services.recommendations.tiers import derive_tier, effective_tier


def test_severity_4_is_tier_1_immediate():
    assert derive_tier(4) == 1


def test_severity_3_is_tier_2_planned():
    assert derive_tier(3) == 2


def test_severity_2_is_tier_3_monitor():
    assert derive_tier(2) == 3


def test_severity_1_is_tier_3_monitor():
    assert derive_tier(1) == 3


def test_out_of_range_severity_raises():
    with pytest.raises(ValueError):
        derive_tier(0)
    with pytest.raises(ValueError):
        derive_tier(5)


def test_no_override_uses_derived():
    assert effective_tier(2, None) == 2


def test_override_wins_when_present():
    assert effective_tier(2, 1) == 1
