"""D-5: Pilot CRUD endpoints."""
from __future__ import annotations
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.pilot import Pilot
from app.models.user import User
from app.schemas.gcs import (
    PilotCreate, PilotUpdate, PilotRead, PilotLicense, PilotInsurance, PilotRole, LicenseKind,
)

router = APIRouter()


def _to_read(p: Pilot) -> PilotRead:
    insurance = None
    if p.insurance_carrier:
        insurance = PilotInsurance(
            carrier=p.insurance_carrier,
            coverage_usd=p.insurance_coverage_usd or 0.0,
            active_until=p.insurance_active_until.isoformat() if p.insurance_active_until else "",
        )
    return PilotRead(
        id=p.id,
        name=p.name,
        initials=p.initials,
        email=p.email,
        license=PilotLicense(
            kind=LicenseKind(p.license_kind),
            number=p.license_number,
            expires_at=p.license_expires_at.isoformat(),
        ),
        insurance=insurance,
        role=PilotRole(p.role),
        active=p.active,
    )


@router.get("/", response_model=List[PilotRead])
def list_pilots(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return [_to_read(p) for p in db.query(Pilot).all()]


@router.get("/{pilot_id}", response_model=PilotRead)
def get_pilot(
    pilot_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    p = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Pilot not found")
    return _to_read(p)


@router.post("/", response_model=PilotRead, status_code=201)
def create_pilot(
    payload: PilotCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    p = Pilot(
        name=payload.name,
        initials=payload.initials,
        email=payload.email,
        license_kind=payload.license.kind.value,
        license_number=payload.license.number,
        license_expires_at=datetime.fromisoformat(payload.license.expires_at),
        insurance_carrier=payload.insurance.carrier if payload.insurance else None,
        insurance_coverage_usd=payload.insurance.coverage_usd if payload.insurance else None,
        insurance_active_until=(
            datetime.fromisoformat(payload.insurance.active_until) if payload.insurance else None
        ),
        role=payload.role.value,
        active=payload.active,
        user_id=payload.user_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_read(p)


@router.patch("/{pilot_id}", response_model=PilotRead)
def update_pilot(
    pilot_id: str,
    payload: PilotUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    p = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Pilot not found")

    if payload.name is not None:
        p.name = payload.name
    if payload.initials is not None:
        p.initials = payload.initials
    if payload.role is not None:
        p.role = payload.role.value
    if payload.active is not None:
        p.active = payload.active
    if payload.license is not None:
        p.license_kind = payload.license.kind.value
        p.license_number = payload.license.number
        p.license_expires_at = datetime.fromisoformat(payload.license.expires_at)
    if payload.insurance is not None:
        p.insurance_carrier = payload.insurance.carrier
        p.insurance_coverage_usd = payload.insurance.coverage_usd
        p.insurance_active_until = datetime.fromisoformat(payload.insurance.active_until)

    db.commit()
    db.refresh(p)
    return _to_read(p)
