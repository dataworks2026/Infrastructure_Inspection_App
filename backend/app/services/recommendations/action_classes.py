"""LIB-3, Stage 2 decision (V&V matrix, OI-7): action_class was free text
through Stage 1 because the domain was guessed. The starter library
(scripts/recommendations/starter_rules_v1.csv) is the first real rule set,
and these are the eight classes it uses. From here on a rule has to carry
one of them, so the library, the CSV import and the report section all
speak the same words.

Adding a class is a deliberate change to this list, not a typo in a form.
"""

ACTION_CLASSES: tuple[str, ...] = (
    "cleaning",
    "coating",
    "concrete repair",
    "crack repair",
    "monitoring",
    "replacement",
    "structural assessment",
    "structural repair",
)


def normalize_action_class(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def check_action_class(value: str) -> str:
    normalized = normalize_action_class(value)
    if normalized not in ACTION_CLASSES:
        raise ValueError(
            f"action_class {value!r} is not one of the library's action classes: {', '.join(ACTION_CLASSES)}"
        )
    return normalized
