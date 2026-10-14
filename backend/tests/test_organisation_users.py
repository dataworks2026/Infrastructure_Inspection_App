"""Organisation users and roles: the organisation creator is its admin, an
admin adds people by email with a role, a viewer can read and change
nothing but their own password, and an organisation never loses its last
admin. The viewer guard lives in get_current_user, so these tests go
through real tokens, not the overridden user fixture."""
import uuid

import pytest

from app.core.security import create_access_token, hash_password
from app.models.organization import Organization
from app.models.user import User


def _org(db, name="Roles Org"):
    org = Organization(organization_id=str(uuid.uuid4()), name=name, slug=f"roles-{uuid.uuid4().hex[:6]}")
    db.add(org)
    db.commit()
    return org


def _user(db, org, email, role, active=True):
    u = User(email=email, hashed_password=hash_password("pass-word-1"), role=role, organization_id=org.organization_id, is_active=active)
    db.add(u)
    db.commit()
    return u


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': user.id})}"}


@pytest.fixture
def org_with_admin(db_session):
    org = _org(db_session)
    admin = _user(db_session, org, "admin@roles-example.com", "admin")
    return org, admin


def test_registering_creates_an_admin(unauthed_client):
    r = unauthed_client.post("/api/v1/auth/register", json={
        "email": "founder@roles-example.com", "password": "pass-word-1", "full_name": "Founder", "organization_name": "Founder Org",
    })
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"


def test_admin_adds_engineer_and_viewer_and_lists_them(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    r = unauthed_client.post("/api/v1/organizations/users", headers=_h(admin), json={
        "email": "eng@roles-example.com", "full_name": "Eng", "role": "engineer", "password": "temp-pass-1",
    })
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "engineer" and r.json()["is_active"] is True
    r = unauthed_client.post("/api/v1/organizations/users", headers=_h(admin), json={
        "email": "client@roles-example.com", "role": "viewer", "password": "temp-pass-2",
    })
    assert r.status_code == 201, r.text

    listed = unauthed_client.get("/api/v1/organizations/users", headers=_h(admin))
    assert listed.status_code == 200
    assert sorted(u["email"] for u in listed.json()) == ["admin@roles-example.com", "client@roles-example.com", "eng@roles-example.com"]
    assert {u["role"] for u in listed.json()} == {"admin", "engineer", "viewer"}

    # the new people log in with the temporary password and land in the same organisation
    login = unauthed_client.post("/api/v1/auth/login", json={"email": "eng@roles-example.com", "password": "temp-pass-1"})
    assert login.status_code == 200, login.text
    assert login.json()["organization_id"] == org.organization_id

    dup = unauthed_client.post("/api/v1/organizations/users", headers=_h(admin), json={
        "email": "eng@roles-example.com", "role": "viewer", "password": "temp-pass-3",
    })
    assert dup.status_code == 400
    bad_role = unauthed_client.post("/api/v1/organizations/users", headers=_h(admin), json={
        "email": "x@roles-example.com", "role": "owner", "password": "temp-pass-3",
    })
    assert bad_role.status_code == 422


def test_only_an_admin_manages_users(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    eng = _user(db_session, org, "eng2@roles-example.com", "engineer")
    assert unauthed_client.get("/api/v1/organizations/users", headers=_h(eng)).status_code == 403
    r = unauthed_client.post("/api/v1/organizations/users", headers=_h(eng), json={
        "email": "y@roles-example.com", "role": "viewer", "password": "temp-pass-9",
    })
    assert r.status_code == 403


def test_viewer_reads_but_cannot_write(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    viewer = _user(db_session, org, "viewer@roles-example.com", "viewer")
    assert unauthed_client.get("/api/v1/auth/me", headers=_h(viewer)).status_code == 200
    assert unauthed_client.get("/api/v1/inspections", headers=_h(viewer)).status_code == 200
    assert unauthed_client.get("/api/v1/dashboard/overview", headers=_h(viewer)).status_code == 200

    created = unauthed_client.post("/api/v1/inspections", headers=_h(viewer), json={"asset_id": "none", "name": "x"})
    assert created.status_code == 403
    assert "read only" in created.json()["detail"]
    assert unauthed_client.delete("/api/v1/inspections/anything", headers=_h(viewer)).status_code == 403
    assert unauthed_client.patch("/api/v1/auth/me", headers=_h(viewer), json={"full_name": "x"}).status_code == 403
    assert unauthed_client.post("/api/v1/inspections/anything/start-review", headers=_h(viewer)).status_code == 403

    # the one write a viewer may do: their own password
    changed = unauthed_client.post("/api/v1/auth/me/password", headers=_h(viewer), json={
        "current_password": "pass-word-1", "new_password": "new-pass-word-2",
    })
    assert changed.status_code == 204, changed.text
    assert unauthed_client.post("/api/v1/auth/login", json={"email": "viewer@roles-example.com", "password": "new-pass-word-2"}).status_code == 200


def test_engineer_can_write(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    eng = _user(db_session, org, "eng3@roles-example.com", "engineer")
    r = unauthed_client.patch("/api/v1/auth/me", headers=_h(eng), json={"full_name": "Engineer Three"})
    assert r.status_code == 200 and r.json()["full_name"] == "Engineer Three"


def test_wrong_current_password_is_refused(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    r = unauthed_client.post("/api/v1/auth/me/password", headers=_h(admin), json={
        "current_password": "nope", "new_password": "new-pass-word-2",
    })
    assert r.status_code == 400


def test_role_change_deactivation_and_last_admin(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    eng = _user(db_session, org, "eng4@roles-example.com", "engineer")

    # the only admin cannot demote or deactivate themself
    r = unauthed_client.patch(f"/api/v1/organizations/users/{admin.id}", headers=_h(admin), json={"role": "viewer"})
    assert r.status_code == 409
    r = unauthed_client.patch(f"/api/v1/organizations/users/{admin.id}", headers=_h(admin), json={"is_active": False})
    assert r.status_code == 409

    # promote the engineer, then the first admin may step down
    r = unauthed_client.patch(f"/api/v1/organizations/users/{eng.id}", headers=_h(admin), json={"role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    r = unauthed_client.patch(f"/api/v1/organizations/users/{admin.id}", headers=_h(admin), json={"role": "engineer"})
    assert r.status_code == 200 and r.json()["role"] == "engineer"

    # a deactivated seat cannot log in or use an old token
    r = unauthed_client.patch(f"/api/v1/organizations/users/{admin.id}", headers=_h(eng), json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert unauthed_client.post("/api/v1/auth/login", json={"email": "admin@roles-example.com", "password": "pass-word-1"}).status_code == 401
    assert unauthed_client.get("/api/v1/auth/me", headers=_h(admin)).status_code == 401


def test_users_of_another_organisation_are_invisible(unauthed_client, db_session, org_with_admin):
    org, admin = org_with_admin
    other = _org(db_session, "Other Org")
    stranger = _user(db_session, other, "stranger@roles-example.com", "engineer")
    listed = unauthed_client.get("/api/v1/organizations/users", headers=_h(admin)).json()
    assert "stranger@roles-example.com" not in {u["email"] for u in listed}
    r = unauthed_client.patch(f"/api/v1/organizations/users/{stranger.id}", headers=_h(admin), json={"role": "viewer"})
    assert r.status_code == 404
