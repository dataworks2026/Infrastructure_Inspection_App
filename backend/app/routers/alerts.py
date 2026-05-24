"""D-5: Alert CRUD + WS broadcast on creation."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.alert import Alert
from app.models.user import User
from app.schemas.gcs import AlertCreate, AlertRead, AlertTone, AlertCategory, AlertAction, WsAlertMessage
from app.services.ws_manager import alert_manager

router = APIRouter()


def _to_read(a: Alert) -> AlertRead:
    return AlertRead(
        id=a.id,
        tone=AlertTone(a.tone),
        category=AlertCategory(a.category),
        text=a.text,
        action=AlertAction(label=a.action_label, href=a.action_href),
        created_at=a.created_at.isoformat(),
        acknowledged_by=a.acknowledged_by,
        acknowledged_at=(a.acknowledged_at.isoformat() if a.acknowledged_at else None),
    )


@router.get("/", response_model=List[AlertRead])
def list_alerts(
    ack: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Alert)
    if not ack:
        q = q.filter(Alert.acknowledged_at.is_(None))
    return [_to_read(a) for a in q.order_by(Alert.created_at.desc()).all()]


@router.post("/", response_model=AlertRead, status_code=201)
async def create_alert(
    payload: AlertCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    a = Alert(
        tone=payload.tone.value,
        category=payload.category.value,
        text=payload.text,
        action_label=payload.action.label,
        action_href=payload.action.href,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    alert_read = _to_read(a)
    msg = WsAlertMessage(type="alert", data=alert_read)
    await alert_manager.broadcast(msg.model_dump(by_alias=True))
    return alert_read


@router.post("/{alert_id}/acknowledge", response_model=AlertRead)
def acknowledge_alert(
    alert_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    if a.acknowledged_at:
        raise HTTPException(status_code=409, detail="Alert already acknowledged")
    a.acknowledged_by = current_user.id
    a.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(a)
    return _to_read(a)
