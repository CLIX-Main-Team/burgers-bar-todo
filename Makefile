# Front door for local development (ADR-0010). A fresh clone reaches a running,
# migratable system with `make setup`.
#
# Infrastructure (Postgres, mailpit) runs in docker compose; the API and web run
# on the host across split origins so CORS and the bearer path are exercised in dev.

SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup up down reset dev dev-api dev-web generate migrate seed logs

help: ## List the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

setup: ## Fresh clone to a running, migratable system: install, infra up, migrate, seed
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example — review it.")
	@test -f apps/web/.env.local || (cp apps/web/.env.example apps/web/.env.local && echo "Created apps/web/.env.local.")
	npm install
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed

up: ## Start infrastructure (Postgres, mailpit) and wait for health; keeps the volume
	$(COMPOSE) up -d --wait

down: ## Stop infrastructure; the database volume is kept
	$(COMPOSE) down

reset: ## Clean-slate DB: drop the volume, bring infra back up, migrate, seed
	$(COMPOSE) down -v
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed

dev: ## Run API and web dev servers concurrently on split origins (infra must be up)
	$(MAKE) up
	npm run dev:api & npm run dev:web & wait

dev-api: ## Run only the API dev server
	npm run dev:api

dev-web: ## Run only the web dev server
	npm run dev:web

generate: ## Generate a new migration from the Drizzle schema (drizzle-kit generate)
	npm run db:generate

migrate: ## Apply committed migrations to the database
	npm run db:migrate

seed: ## Seed the first admin (idempotent, env-driven; ADR-0005). Safe to re-run.
	npm run seed

logs: ## Tail infrastructure logs
	$(COMPOSE) logs -f
