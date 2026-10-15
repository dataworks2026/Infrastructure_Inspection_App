"""Roles inside an organisation.

admin     runs the organisation: adds people, changes roles, can do everything
engineer  does the work: upload, analysis, engineer review, reports
analyst   the historical role on every existing user; same rights as engineer
viewer    the client's seat: reads dashboards, inspections and reports, changes nothing

The viewer rule is enforced in one place, app.core.deps.get_current_user, on
the request method, so no screen or router can forget it.
"""

ADMIN = "admin"
ENGINEER = "engineer"
ANALYST = "analyst"
VIEWER = "viewer"

ROLES = (ADMIN, ENGINEER, ANALYST, VIEWER)
ROLE_LABELS = {
    ADMIN: "Admin",
    ENGINEER: "Engineer",
    ANALYST: "Analyst",
    VIEWER: "Viewer (read only)",
}

# request methods a viewer may not send, and the few paths every signed in
# user may always write to (their own password)
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
VIEWER_WRITE_ALLOWED = ("/api/v1/auth/me/password",)


def is_valid_role(role: str) -> bool:
    return role in ROLES


def is_read_only(role: str) -> bool:
    return role == VIEWER


def can_administer(role: str) -> bool:
    return role == ADMIN
