from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    try:
        import sentry_sdk
        sentry_sdk.set_user({"id": str(user.id), "username": getattr(user, "username", None)})
    except Exception:
        pass
    return user


def require_review_flow() -> None:
    """Router-level guard for the Engineer Review flow. Off means the
    endpoints do not exist as far as clients can tell (404), which is the
    rollback behaviour: no partial flow, no half-open state."""
    from app.core.config import settings

    if not settings.REVIEW_FLOW_ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Engineer review is not enabled")
