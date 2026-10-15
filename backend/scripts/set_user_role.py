"""Set the role of one user by email. For the deploy that introduces roles:
accounts created before it (the organisation creator included) carry the
old default role, so the person who should run an organisation is promoted
once, from inside the backend container:

    python scripts/set_user_role.py engineering@example.com admin

Prints what changed. Refuses an unknown role.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.roles import ROLES  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402


def main(email: str, role: str) -> int:
    role = role.strip().lower()
    if role not in ROLES:
        print(f"unknown role {role!r}; one of {', '.join(ROLES)}")
        return 2
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            print(f"no user with email {email}")
            return 1
        before = user.role
        user.role = role
        db.commit()
        print(f"{email}: {before} -> {role} (organisation {user.organization_id})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
