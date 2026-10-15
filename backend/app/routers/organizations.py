"""People in an organisation. An admin adds a person by email with a role
and a temporary password, changes a role, or deactivates a seat. Every
query is scoped to the admin's own organisation; a user id from another
organisation is simply not found.

There is no invitation email: the platform has no mail service. The admin
hands the temporary password over and the person changes it on first login
(POST /api/v1/auth/me/password).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.core.roles import ADMIN, ROLE_LABELS
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.schemas.org_users import OrgUserCreate, OrgUserOut, OrgUserUpdate

router = APIRouter()


def _out(u: User) -> OrgUserOut:
    return OrgUserOut(
        id=u.id, email=u.email, full_name=u.full_name, role=u.role,
        is_active=bool(u.is_active), last_login=u.last_login, created_at=u.created_at,
    )


def _org_user(db: Session, admin: User, user_id: str) -> User:
    u = db.query(User).filter(User.id == user_id, User.organization_id == admin.organization_id).first()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found in this organisation")
    return u


def _active_admins(db: Session, organization_id: str) -> int:
    return db.query(User).filter(
        User.organization_id == organization_id, User.role == ADMIN, User.is_active.is_(True)
    ).count()


@router.get("/roles")
def roles(_: User = Depends(require_admin)) -> list[dict]:
    return [{"value": value, "label": label} for value, label in ROLE_LABELS.items()]


@router.get("/users", response_model=list[OrgUserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> list[OrgUserOut]:
    rows = (
        db.query(User)
        .filter(User.organization_id == admin.organization_id)
        .order_by(User.created_at.asc(), User.email.asc())
        .all()
    )
    return [_out(u) for u in rows]


@router.post("/users", response_model=OrgUserOut, status_code=201)
def create_user(body: OrgUserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> OrgUserOut:
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    org = db.query(Organization).filter(Organization.organization_id == admin.organization_id).first()
    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=body.role,
        organization_id=admin.organization_id,
        organization=org.name if org else None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _out(user)


@router.patch("/users/{user_id}", response_model=OrgUserOut)
def update_user(user_id: str, body: OrgUserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> OrgUserOut:
    user = _org_user(db, admin, user_id)
    losing_admin = (
        user.role == ADMIN and user.is_active
        and ((body.role is not None and body.role != ADMIN) or body.is_active is False)
    )
    if losing_admin and _active_admins(db, admin.organization_id) <= 1:
        raise HTTPException(status_code=409, detail="This is the organisation's only admin; make someone else admin first")
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.full_name is not None:
        user.full_name = body.full_name
    db.commit()
    db.refresh(user)
    return _out(user)
