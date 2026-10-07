"""Recommendation engine — authoring input.

Ported from Tahya's Phase-1 ``EntryWrite`` (service/app/schemas.py). This
is the one schema Stage 1 needs: ``authoring.create_entry``/``edit_entry``
take it directly, exactly as her services.py did, and it validates the
same way whether or not an HTTP router sits in front of it yet (Stage 3).
The other schemas from her API layer (DispositionRequest, RecordOut,
OutputOut, ...) are deferred to the stage that actually builds routers --
``workflow.py``/``output.py`` take plain scalar parameters, not a whole
schema object, so nothing here is blocking on them.
"""

from typing import Optional

from pydantic import BaseModel, field_validator


def _normalize_class(value: str) -> str:
    return " ".join(value.split()).strip().lower()


class EntryWrite(BaseModel):
    actor: str
    # the model family whose vocabulary this rule is written against; the
    # authoring service resolves it to the current vocabulary version
    producer: str = "coastal"
    detection_class: str
    severity: int
    asset_type: Optional[str] = None
    asset_id: Optional[str] = None
    recommendation_text: str
    action_class: str
    tier_override: Optional[int] = None

    @field_validator("actor", "recommendation_text", "action_class")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @field_validator("producer")
    @classmethod
    def _normalize_producer(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("must not be blank")
        return normalized

    @field_validator("detection_class")
    @classmethod
    def _normalize_detection_class(cls, value: str) -> str:
        normalized = _normalize_class(value)
        if not normalized:
            raise ValueError("must not be blank")
        return normalized

    @field_validator("severity")
    @classmethod
    def _severity_in_domain(cls, value: int) -> int:
        if value not in (1, 2, 3, 4):
            raise ValueError("severity must be 1-4")
        return value

    @field_validator("tier_override")
    @classmethod
    def _tier_in_domain(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value not in (1, 2, 3):
            raise ValueError("tier_override must be 1-3")
        return value

    @field_validator("asset_type")
    @classmethod
    def _blank_asset_type_is_none(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not value.strip():
            return None
        return value
