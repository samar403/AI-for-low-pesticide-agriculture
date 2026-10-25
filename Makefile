.PHONY: install api web dev test build docker

install:            ## Python venv + npm packages
	python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
	cd frontend && npm install

api:                ## FastAPI on :8000 (reload)
	cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000

web:                ## Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && npm run dev

dev:                ## both, in one terminal
	$(MAKE) -j2 api web

test:               ## backend + frontend tests and type-check
	cd backend && ../.venv/bin/python -m pytest -q
	cd frontend && npm test && npm run typecheck

build:              ## production frontend bundle (served by FastAPI if present)
	cd frontend && npm run build

docker:             ## single-container build and run
	docker compose up --build
