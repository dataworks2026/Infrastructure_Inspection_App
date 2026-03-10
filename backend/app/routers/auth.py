import re, uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User
from app.models.organization import Organization
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse, UpdateMeRequest

router = APIRouter()


def _make_slug(email: str) -> str:
    """Derive a URL-safe slug from an email address."""
    local = email.split("@")[0]
    return re.sub(r"[^a-z0-9]+", "-", local.lower()).strip("-")


@router.post("/register", response_model=TokenResponse)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == request.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # ── Auto-create an organization for the new user ─────────────────────
    slug = _make_slug(request.email)
    if db.query(Organization).filter(Organization.slug == slug).first():
        slug = f"{slug}-{_uuid.uuid4().hex[:6]}"

    org = Organization(
        name=request.organization_name,
        slug=slug,
    )
    db.add(org)
    db.flush()  # get org.organization_id before committing

    user = User(
        email=request.email,
        hashed_password=hash_password(request.password),
        full_name=request.full_name,
        role="analyst",
        organization_id=org.organization_id,
        organization=request.organization_name,  # keep legacy field in sync
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token, user_id=user.id,
        email=user.email, full_name=user.full_name, role=user.role,
        organization_id=org.organization_id,
        organization_name=org.name,
    )

@router.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    org = db.query(Organization).filter(Organization.organization_id == user.organization_id).first() if user.organization_id else None
    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token, user_id=user.id,
        email=user.email, full_name=user.full_name, role=user.role,
        organization_id=user.organization_id,
        organization_name=org.name if org else None,
    )

@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org = db.query(Organization).filter(Organization.organization_id == current_user.organization_id).first() if current_user.organization_id else None
    return UserResponse(
        id=current_user.id, email=current_user.email,
        full_name=current_user.full_name, role=current_user.role,
        is_active=current_user.is_active,
        organization_id=current_user.organization_id,
        organization_name=org.name if org else None,
    )

@router.patch("/me", response_model=UserResponse)
def update_me(data: UpdateMeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Update user fields
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.username is not None:
        existing = db.query(User).filter(User.username == data.username, User.id != current_user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = data.username

    # Update organization name in both users.organization (legacy) and organizations.name
    org = None
    if data.organization_name is not None and current_user.organization_id:
        org = db.query(Organization).filter(Organization.organization_id == current_user.organization_id).first()
        if org:
            org.name = data.organization_name
            current_user.organization = data.organization_name  # keep legacy field in sync

    db.commit()
    db.refresh(current_user)
    if org:
        db.refresh(org)
    else:
        org = db.query(Organization).filter(Organization.organization_id == current_user.organization_id).first() if current_user.organization_id else None

    return UserResponse(
        id=current_user.id, email=current_user.email,
        full_name=current_user.full_name, role=current_user.role,
        is_active=current_user.is_active,
        organization_id=current_user.organization_id,
        organization_name=org.name if org else None,
    )
