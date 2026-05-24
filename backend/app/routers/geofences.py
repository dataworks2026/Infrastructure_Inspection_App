"""D-5: Geofence CRUD endpoints."""
from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.geofence import Geofence
from app.models.user import User
from app.schemas.gcs import GeofenceCreate, GeofenceUpdate, GeofenceRead, NoFlyZone

router = APIRouter()


def _to_read(g: Geofence) -> GeofenceRead:
    no_fly = None
    if g.no_fly_zones:
        no_fly = [NoFlyZone(**z) for z in g.no_fly_zones]
    return GeofenceRead(
        id=g.id,
        name=g.name,
        site_id=g.site_id or "",
        polygon=g.polygon,
        max_alt_agl=g.max_alt_agl,
        no_fly_zones=no_fly,
        notes=g.notes,
    )


@router.get("/", response_model=List[GeofenceRead])
def list_geofences(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return [_to_read(g) for g in db.query(Geofence).all()]


@router.get("/{geofence_id}", response_model=GeofenceRead)
def get_geofence(
    geofence_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    g = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Geofence not found")
    return _to_read(g)


@router.post("/", response_model=GeofenceRead, status_code=201)
def create_geofence(
    payload: GeofenceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    g = Geofence(
        name=payload.name,
        site_id=payload.site_id,
        polygon=payload.polygon,
        max_alt_agl=payload.max_alt_agl,
        no_fly_zones=(
            [z.model_dump(by_alias=True) for z in payload.no_fly_zones]
            if payload.no_fly_zones else None
        ),
        notes=payload.notes,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _to_read(g)


@router.patch("/{geofence_id}", response_model=GeofenceRead)
def update_geofence(
    geofence_id: str,
    payload: GeofenceUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    g = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Geofence not found")

    if payload.name is not None:
        g.name = payload.name
    if payload.site_id is not None:
        g.site_id = payload.site_id
    if payload.polygon is not None:
        g.polygon = payload.polygon
    if payload.max_alt_agl is not None:
        g.max_alt_agl = payload.max_alt_agl
    if payload.no_fly_zones is not None:
        g.no_fly_zones = [z.model_dump(by_alias=True) for z in payload.no_fly_zones]
    if payload.notes is not None:
        g.notes = payload.notes

    db.commit()
    db.refresh(g)
    return _to_read(g)


@router.delete("/{geofence_id}", status_code=204)
def delete_geofence(
    geofence_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    g = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Geofence not found")
    db.delete(g)
    db.commit()
