# SkillPilot

All seven stages are functional with 38 lessons, stage diagnostics, topic practice and reassessment, evidence-based recommendations, a returning dashboard and local progress. Each topic has 50 questions: 1,900 total. Topic cycles use 20/20/10 non-overlapping questions; the final remainder is insufficient for mastery. Existing AI Foundations history is preserved by a validated local-progress migration. See [all-stage implementation report](docs/28-all-stage-implementation-report.md).

## Run the complete app locally

From the project root, run:

```sh
sh run-local.sh
```

Open **http://127.0.0.1:8000**. The launcher builds the frontend and starts FastAPI using `backend/.venv`; FastAPI serves both the app and API at the same origin. Keep this terminal running. Press Ctrl+C to stop. No separate frontend server is needed for this mode. Re-run the launcher after frontend changes.

If dependencies are missing, run `npm install` in `frontend/` and install `backend/requirements.txt` using the backend virtual environment as shown below.

For a backend-only command from the project root, use `backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`. Running `app.main:app` from the root without `--app-dir backend` cannot resolve the app module. Avoid running Uvicorn's installed `__main__.py` directly from the editor.

## Development with frontend hot reload

Backend, from `backend/`:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend, from `frontend/`:

```sh
npm install
npm run dev -- --host 127.0.0.1
```

Open the Vite URL printed in the terminal. The development proxy sends `/api` requests to the local backend. Production hosting requires the same-origin `/api` routing to FastAPI; deployment is outside this increment.

## Verify

From `backend/`, run `.venv/bin/python -m unittest discover -s tests -v` (requires `httpx2` for FastAPI TestClient). From `frontend/`, run `npm test`, `npm run build` and `npm run lint`. Install backend test dependencies with `.venv/bin/pip install -r requirements-dev.txt`.

The backend validates the mandatory seven-stage catalog and topic hierarchy before delivery. Frontend validates delivery again, selects stages locally and shows retry on failed loads. JSON lives in `backend/data/curriculum.json`. Assessment delivery/scoring routes are documented in `docs/features/04-assessment-engine.md`. Keys and explanations remain backend-only before submission. No public bank route exists.

See [readiness and approvals](docs/10-readiness-review.md) and [increment report](docs/12-increment-1-report.md). Topic approval does not approve mastery thresholds, diagnostic coverage, interruption behavior or practice/reassessment history sharing.

Assessment checks: see [Increment 3 report](docs/15-increment-3-report.md). The app creates an owner-only signing secret under `backend/.local/`; preserve it to resume receipts across restarts. Use a stable `SKILLPILOT_SIGNING_SECRET` of at least 32 characters to override it. Never commit or serve the secret.

Increment 4 adds server-recomputed mastery evidence and explained next actions. The historical development sample was insufficient for mastery; the current full 20-question reassessments qualify under the unchanged evidence rules. See [Increment 4 report](docs/16-increment-4-report.md).

Current release: [all-stage implementation report](docs/28-all-stage-implementation-report.md). The [AI Foundations integration report](docs/26-fifty-question-integration-report.md) records the previous bank expansion. Bank version changes preserve old attempts and the initial baseline; starting a current-version topic cycle requires the existing acknowledgment.


## Assignment documentation

See the [project overview, architecture, prompt record and complete Markdown inventory](docs/32-assignment-submission.md). The [high-level architecture picture](docs/assets/skillpilot-architecture.png) is a single PNG for inclusion in Google Docs or an assignment submission. The report distinguishes current requirements from historical proposals and identifies remaining verification evidence.
