import re, uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User
from app.models.organization import Organization
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse

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
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token, user_id=user.id,
        email=user.email, full_name=user.full_name, role=user.role
    )

@router.post("/login", response_model=TokenResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token, user_id=user.id,
        email=user.email, full_name=user.full_name, role=user.role
    )

@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id, email=current_user.email,
        full_name=current_user.full_name, role=current_user.role,
        is_active=current_user.is_active
    )
