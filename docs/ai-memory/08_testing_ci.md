# Testing & CI Memory

> **Last updated:** 2026-05-27

## Fast path (from CLAUDE.md)

### Docs-only
```bash
git diff --check
```

### Shared
```bash
pnpm --filter @xuantoi/shared test
pnpm --filter @xuantoi/shared build
```

### Web
```bash
pnpm --filter @xuantoi/web test        # Vitest + happy-dom
pnpm --filter @xuantoi/web build       # vue-tsc + vite build
```

### API
```bash
pnpm --filter @xuantoi/api test        # Vitest (needs Postgres + Redis)
pnpm --filter @xuantoi/api build       # nest build
```

### Cross-module / economy / schema
```bash
pnpm --filter @xuantoi/shared build    # MUST build first
pnpm typecheck                          # all workspaces
pnpm lint                               # eslint all
pnpm build                              # all workspaces
pnpm test                               # all workspaces
```

## Smoke tests
```bash
pnpm smoke:all                          # run all default smoke suites
pnpm smoke:economy                      # economy + ledger chain
pnpm smoke:combat                       # combat flow
pnpm smoke:mission                      # mission claim
pnpm smoke:ws                           # WebSocket
# ... see package.json for full list
```

## E2E tests
```bash
pnpm --filter @xuantoi/web e2e          # Playwright smoke (vite preview)
# E2E_FULL=1 pnpm --filter @xuantoi/web e2e   # full-stack 16+ specs (needs api+pg+redis)
```

## Test baselines (as of 2026-05-27)
- **Shared:** 4182 tests
- **API:** 4145 tests (needs Postgres + Redis)
- **Web:** 2754 tests
- **E2E:** 22 specs (golden path), only spec #1 runs in CI by default

## Rules
- **Do not fake pass** — no `expect(true).toBe(true)` or `it.skip` to bypass.
- **Do not disable tests** — fix failing tests, don't skip them.
- **If test cannot run due to environment, document exact reason.**
- **CI must be green before claiming task complete.**

## Known issues
- API build has 1228 pre-existing Prisma type errors (documented, not related to recent changes).
- Chat rate-limit test is flaky in CI (timing-dependent) — Task #39 to fix.
- E2E_FULL gate not wired in CI yet — Task #42 sub-gap 4.

## Source docs
- `CLAUDE.md` — quality gates
- `docs/QA_CHECKLIST.md` — QA checklist
- `docs/BETA_CHECKLIST.md` — beta readiness checklist
- `package.json` — smoke script list
