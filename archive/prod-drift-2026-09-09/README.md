# Production box artifacts, preserved 2026-09-09

Source: production EC2 (3.133.43.231), `/home/ubuntu/app` and `/home/ubuntu`, read on 2026-09-09 and exported 2026-09-10.
Working tree on the box: master at cab18b5, `git diff` empty. None of the files below is a live edit to the
running code; they are leftovers from earlier work, kept here so they live in a branch instead of on a server.

| File | Origin | What it is |
|---|---|---|
| `stash0-feat-gcs-backend-b5ce1f8.patch` | `git stash@{0}`, 2026-05-06 | WIP on feat/gcs-backend at b5ce1f8 (frontend api.ts and types, 7 files) |
| `stash1-master-ba08abe-3dviewer.patch` | `git stash@{1}`, 2026-03-25 | WIP on master at ba08abe, 3D viewer close-up work (23 files, includes package-lock) |
| `stash-list.txt`, `stash0-meta.txt`, `stash1-meta.txt` | `git stash list`, `git log -1` | Stash identities as they were on the box |
| `records-page.tsx.hotfix-backup` | `/home/ubuntu`, 2026-06-10 | Copy of the records page taken before the June merge; predates cab18b5 |
| `viewer-page-uncommitted-20260715-175543.patch` | `/home/ubuntu`, 2026-07-15 | Patch against `frontend/app/(dashboard)/digital-twin/viewer/page.tsx`, a path master has since moved to `app/[org]` |
| `viewer-page.tsx.uncommitted` | `/home/ubuntu/deploy-backup-94ea32b`, 2026-07-22 | The viewer page file as it stood before the 94ea32b pull |
| `dashboard-dir-pre-pull.tgz` | `/home/ubuntu/deploy-backup-94ea32b`, 2026-07-22 | Tarball of the dashboard directory taken before the same pull |

Not included: nightly database dumps under `/home/ubuntu/backups` (customer data, stay on the box and in the backup
schedule) and `deleted_test_missions_backup.json` (test data export, not code).

The stashes stay on the box untouched until this branch is merged; nothing here was applied, deleted or modified on the server.
