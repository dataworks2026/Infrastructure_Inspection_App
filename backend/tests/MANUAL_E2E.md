# Predictive Analytics — Manual End-to-End Verification

This is the human-in-the-loop checklist that complements the
automated suites in `test_data_adapter.py` and `test_predictive_api.py`.
Run it once after merging the predictive analytics branches into
`master`, and again any time the pipeline, schemas, or UI panels
change in a non-trivial way.

The pytest suites verify the contracts of each layer in isolation;
this walk-through verifies that **everything wired together produces
the right numbers and renders the right pixels**.

---

## Prerequisites

- Backend running locally (`uvicorn app.main:app --port 8000`)
  with a DB you do not mind seeding.
- Frontend running locally (`npm run dev` — note: Mapbox GL v3 is
  not compatible with `--turbo`; either omit `--turbo` or skip
  `/map` for this checklist).
- `backend/scripts/seed_predictive_demo.py` runnable. Seed against
  an isolated DB so production data is not touched:
  ```bash
  DATABASE_URL=sqlite:///./mira_intel_analytics_demo.db \
  python backend/scripts/seed_predictive_demo.py
  ```
- Same `DATABASE_URL` exported when starting `uvicorn`.

---

## Walk-Through

### 1. Auth

- [ ] `POST /api/v1/auth/login` with the seeded credentials returns
      `200` and a Bearer token.
- [ ] Open <http://localhost:3000/login>, log in. Browser lands on
      `/dashboard`, sidebar renders, no console errors.

### 2. Sidebar nav

- [ ] **Analytics** entry is visible in the sidebar, second from the
      top, with the down-trend icon.
- [ ] Click it — URL becomes `/analytics`, page renders.

### 3. Empty state (only if running against an org with no past runs)

- [ ] Centered card appears: "No analytics runs yet" with a Run
      Analysis button.
- [ ] Click the button — spinner replaces the label, then the page
      transitions to the populated state.

### 4. Populated state — analytics dashboard

- [ ] Header shows "Predictive Analytics" + a one-line description.
- [ ] Top-right shows the **Run Analysis** button and a "Last run:
      {date} · N assets analysed" caption with the right count.
- [ ] Table has **8 columns**: Rank, Asset, Severity, Trend, Rate,
      Flag, Priority, TTI.
- [ ] Rows are sorted by `priority_rank` ascending.
- [ ] Severity badges use the SEV palette (S4 red, S3 orange,
      S2 yellow, S1 green).
- [ ] Trend uses arrow + label. Worsening/accelerating in red,
      stable in grey, improving in green, fluctuating in orange.
- [ ] Rate column shows signed values like `+0.84/yr`, `-0.15/yr`.
- [ ] Flag column shows a red flag icon only on rows with
      `has_anomaly` = true.
- [ ] Priority column shows score (e.g. `82.6`) plus a label badge
      (Critical/High/Medium/Low/Minimal) coloured to match.
- [ ] TTI column shows days for at-risk assets and `N/A` for
      stable / improving ones.

### 5. Run Analysis interaction

- [ ] Click Run Analysis a second time — button shows
      "Running analysis…" with a spinner; the table briefly does
      not update; once finished the timestamp caption updates.
- [ ] If the demo data is unchanged the rankings should be
      identical to the prior run (deterministic).

### 6. Asset detail panel

For each of the seeded assets in turn:

- [ ] Click the row — browser navigates to `/assets/{id}`.
- [ ] **Predictive Analytics** card appears between the asset info
      card and the inspections list.
- [ ] **Priority** section shows score (large), priority label badge,
      "Ranked #X in this run" caption.
- [ ] **Trend** section shows arrow + label, "Changing at X/yr"
      caption, and an "⚠️ Rate of worsening is increasing" line if
      the engine flagged acceleration.
- [ ] **TTI** section shows the days countdown (e.g. `0` for
      Immediate) plus the colored label, OR the engine's `tti_note`
      text for the Not-applicable case.
- [ ] **Anomaly banner** (orange) appears if and only if the asset
      has `has_anomaly` = true. Banner contains the engine's
      `anomaly_reason` text.
- [ ] **History sparkline** appears if the asset has ≥ 2 inspections.
      Y-axis 1..4, hovering a point shows "S{n}" tooltip with the
      inspection date.
- [ ] **Why this score?** list at the bottom always shows
      Deterioration + TTI + Current Severity rows; Anomaly row only
      when applicable. Each row has the category-coloured dot, code
      name, optional weight chip, and the engine's reason text.

### 7. Empty / 404 paths

- [ ] Asset that has no run yet — `/assets/{id}` shows "Predictive
      analytics not available for this asset yet" with a link to
      `/analytics`. No console error.
- [ ] Direct GET to `/api/v1/predictive/assets/some-bogus-id` via
      Swagger or curl returns `404` with a JSON `detail`.

### 8. Multi-tenant isolation (manual)

If you have access to a second user/org:

- [ ] Log out, log in as a user in a different org.
- [ ] `/analytics` shows that org's runs only — none of the seeded
      assets from the demo org leak in.
- [ ] Direct `GET /api/v1/predictive/runs/{run_id}` for a run that
      belongs to the other org returns `404`.

### 9. Failure path

- [ ] Stop the backend mid-run (kill the uvicorn process while
      `POST /run` is in flight). Restart, then `GET /runs` — the
      most recent run is in status `failed` with an `error_message`
      populated. Items / reasons for that run should not be present
      (they were rolled back).

### 10. Browser console

- [ ] Console has no red errors during a normal walk-through. The
      pre-existing `mapbox-gl` issue is the only acceptable noise
      and only appears if `/map` is visited.

---

## Sign-off

When every checkbox above is ticked, this build is ready to merge.
Drop a comment with the build sha and the date in the PR before
merging the predictive-* branches into `master`.
