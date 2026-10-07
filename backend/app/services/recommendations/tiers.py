"""OI-4, closed 2026-08-06 -- and reaffirmed by Matteo's Reconciliation 2
(2026-09-01): the library keeps these three tiers, derived from matched
severity. It does NOT adopt the platform's five-value
``immediate|urgent|scheduled|monitor|defer`` ladder -- that ladder is a
Stage 4 projection concern (the write-through into
``maintenance_recommendations``), applied only at that boundary. Changing
the enumeration below requires reopening OI-4 in writing.

Tier 1 is the most urgent, tier 3 the least -- the opposite direction
from severity (severity 4 is the worst damage but maps to tier 1).

severity 4 -> tier 1, immediate action
severity 3 -> tier 2, planned repair
severity 1 or 2 -> tier 3, monitor and maintain

An entry can override its tier, but only toward more urgency (a lower
tier number), never less.

Ported verbatim from Tahya's Phase-1 service (app/tiers.py) -- the
severity domain and the tier domain are both unaffected by anything
platform-specific, so nothing here changes in the port.
"""

from typing import Optional

TIER_LABELS = {
    1: "Immediate action",
    2: "Planned repair",
    3: "Monitor and maintain",
}


def derive_tier(severity: int) -> int:
    if severity == 4:
        return 1
    if severity == 3:
        return 2
    if severity in (1, 2):
        return 3
    raise ValueError(f"severity must be 1-4, got {severity}")


def effective_tier(derived_tier: int, tier_override: Optional[int]) -> int:
    return tier_override if tier_override is not None else derived_tier
