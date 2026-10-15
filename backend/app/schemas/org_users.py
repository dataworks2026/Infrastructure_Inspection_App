from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.core.roles import ROLES


class OrgUserCreate(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    role: str
    # a temporary password the admin hands over; the person changes it on first login
    password: str

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if value not in ROLES:
            raise ValueError(f"role must be one of: {', '.join(ROLES)}")
        return value

    @field_validator("password")
    @classmethod
    def _password_length(cls, value: str) -> str:
        if len(value or "") < 8:
            raise ValueError("password must be at least 8 characters")
        return value


class OrgUserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    full_name: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip().lower()
        if value not in ROLES:
            raise ValueError(f"role must be one of: {', '.join(ROLES)}")
        return value


class OrgUserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    role: str
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password_length(cls, value: str) -> str:
        if len(value or "") < 8:
            raise ValueError("password must be at least 8 characters")
        return value
