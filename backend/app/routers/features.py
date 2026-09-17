from fastapi import APIRouter, Depends

from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/features")
def get_features(current_user: User = Depends(get_current_user)) -> dict:
    """Feature switches the dashboard needs to know about. The backend is
    the authority (a switched-off flow answers 404); the UI only uses this
    to hide entry points."""
    return {"review_flow": settings.REVIEW_FLOW_ENABLED}
