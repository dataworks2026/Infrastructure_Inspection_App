from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.core.roles import VIEWER_WRITE_ALLOWED, WRITE_METHODS, can_administer, is_read_only
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # A viewer reads; every request that would change something is refused
    # here, once, instead of on each router.
    if is_read_only(user.role) and request.method in WRITE_METHODS and request.url.path not in VIEWER_WRITE_ALLOWED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your role is read only")
    try:
        import sentry_sdk
        sentry_sdk.set_user({"id": str(user.id), "username": getattr(user, "username", None)})
    except Exception:
        pass
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not can_administer(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an organisation admin can do this")
    return current_user
