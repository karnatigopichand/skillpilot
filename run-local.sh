#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$PROJECT_DIR/backend/.venv/bin/python" ]; then
  echo 'Backend environment missing. Run the setup commands in README.md.' >&2
  exit 1
fi
cd "$PROJECT_DIR/frontend"
npm run build
cd "$PROJECT_DIR"
exec "$PROJECT_DIR/backend/.venv/bin/python" -m uvicorn app.main:app --app-dir "$PROJECT_DIR/backend" --host 127.0.0.1 --port 8000
