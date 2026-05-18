# Xuân Tôi — Universal AI Agent Instructions

## Purpose

These instructions are for Codex, Claude, Copilot/Cursor, Devin, Replit Agent,
and other AI coding agents working in this repository.

Use this file to:

- choose the next task,
- avoid reading unnecessary files,
- follow the project workflow,
- run the right tests,
- update progress docs after each PR.

## Source of Truth

Current code on `main` is the final source of truth.

Docs may be stale. Verify important claims against code before changing behavior.

## Read Order

Before choosing or starting work, read only:

1. `CLAUDE.md`
2. `docs/START_HERE.md`
3. `docs/FEATURE_PROGRESS_TRACKER.md`
4. Top section of `docs/AI_HANDOFF_REPORT.md`

Read `docs/FEATURE_AUDIT_AND_ROADMAP.md` only when feature status, roadmap, or priority context is needed.

Read deeper docs only when the task requires them.

## Token-Saving Rules

- Use `rg` before opening files.
- Do not scan the whole repo.
- Do not read archive/DOCX files unless explicitly asked.
- Do not read long roadmap/checklist docs unless required.
- For frontend tasks, inspect router + target view/component + related API/store/test only.
- For backend tasks, inspect target module + shared contracts/catalog + relevant tests only.
- For docs-only tasks, do not run full app tests.

## Next Task Rule

If the user does not specify a task:

1. Open `docs/FEATURE_PROGRESS_TRACKER.md`.
2. Pick the highest-rank task with status `TODO`.
3. If that task is `BLOCKED`, choose the next `TODO`.
4. Prefer UX/core-loop polish before new large systems.
5. Do not invent a new roadmap if the tracker already has a clear next task.

The tracker is the source of truth for the current recommended next task.

## Progress Update Rule

Every PR that changes feature, UX, gameplay, test, smoke, admin, liveops, or roadmap docs must update:

- `docs/FEATURE_PROGRESS_TRACKER.md`
- `docs/AI_HANDOFF_REPORT.md`

If feature status changes, also update:

- `docs/FEATURE_AUDIT_AND_ROADMAP.md`

When starting a tracked task, set task status to `IN_PROGRESS`.

When completing a tracked task, set task status to `DONE`, record branch/PR/commit if known, and update `Current Recommended Next Task` to the next highest-rank `TODO`.

Do not rewrite long docs unless the task is specifically docs maintenance.

## Do Not Build Unless Explicitly Requested

- Real-time PvP
- Gacha / pet gacha
- NFT / blockchain
- Real-money player trade
- Voice chat
- Native mobile app
- Multi-region sharding

## Scope Rules

- Prefer small or medium PRs.
- Do not create large modules if the current tracker task is polish.
- Do not create migrations unless schema changes are required and justified.
- Do not change economy/balance unless the task requires it.
- Do not remove tests, disable CI, weaken validation, or fake green results.
- Never push directly to `main`.

## Branch Naming

Use clear branch names: `feat/...`, `fix/...`, `docs/...`, `test/...`, or `chore/...`.

## Test Fast Path

### Docs-only

Run:

```bash
git diff --check
```

Run markdown lint only if the repo has a markdown lint script. Do not run full app tests for docs-only changes unless docs generation or executable code examples changed.

### Frontend-only

Run targeted web checks:

```bash
pnpm --filter @xuantoi/web test
pnpm --filter @xuantoi/web build
```

Run Playwright smoke if touching `/auth`, `/onboarding`, `/home`, `/missions`, `/inventory`, `/equipment`, `/dungeon`, `/combat`, `/mail`, or `/settings`.

### Backend-only

Run targeted API checks:

```bash
pnpm --filter @xuantoi/api test
pnpm --filter @xuantoi/api build
```

Run relevant smoke scripts if touching gameplay, economy, admin, mail, combat, mission, market, or websocket behavior.

### Shared catalog / contracts

Run:

```bash
pnpm --filter @xuantoi/shared test
pnpm --filter @xuantoi/shared build
```

Also inspect content/balance docs when changing catalog values.

### Cross-module / economy / schema

Run broader gates:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run smoke scripts for affected runtime flows.

## Final Response Checklist

In final responses, report files changed, summary, tests/checks run, current recommended next task when relevant, and PR link or manual PR link if pushed.
