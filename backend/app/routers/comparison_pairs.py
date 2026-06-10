from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Column, String, JSON, DateTime, UniqueConstraint, text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Dict

from app.database import Base
from app.core.deps import get_db
from app.routers.auth import get_current_user
from app.models import User

router = APIRouter(prefix="/comparison-pairs", tags=["comparison-pairs"])


class ComparisonPair(Base):
    __tablename__ = "comparison_pairs"
    id                   = Column(String(36), primary_key=True)
    organization_id      = Column(String(36), nullable=False)
    before_inspection_id = Column(String(36), nullable=False)
    after_inspection_id  = Column(String(36), nullable=False)
    pairs                = Column(JSON, nullable=False, default=dict)
    created_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at           = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (
        UniqueConstraint("organization_id", "before_inspection_id", "after_inspection_id"),
    )


class SavePairsRequest(BaseModel):
    before_inspection_id: str
    after_inspection_id: str
    pairs: Dict[str, int]  # { "afterImageIdx": beforeImageIdx }


@router.get("")
def get_pairs(
    before_inspection_id: str,
    after_inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(ComparisonPair).filter_by(
        organization_id=current_user.organization_id,
        before_inspection_id=before_inspection_id,
        after_inspection_id=after_inspection_id,
    ).first()
    return {"pairs": row.pairs if row else {}}


@router.put("")
def save_pairs(
    body: SavePairsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(ComparisonPair).filter_by(
        organization_id=current_user.organization_id,
        before_inspection_id=body.before_inspection_id,
        after_inspection_id=body.after_inspection_id,
    ).first()

    if row:
        row.pairs = body.pairs
        row.updated_at = datetime.utcnow()
    else:
        row = ComparisonPair(
            id=str(__import__('uuid').uuid4()),
            organization_id=current_user.organization_id,
            before_inspection_id=body.before_inspection_id,
            after_inspection_id=body.after_inspection_id,
            pairs=body.pairs,
        )
        db.add(row)

    db.commit()
    return {"pairs": row.pairs}
