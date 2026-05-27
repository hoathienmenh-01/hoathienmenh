# AI Quick Start — Xuân Tôi

## Purpose
Quick startup guide for Claude/AI sessions with minimal token usage.

## First commands
```bash
pwd
git branch --show-current
git status --short
```

## Minimal read order
For low-token sessions, read:
1. `CLAUDE.md` — hard rules + quality gates
2. `docs/AI_HANDOFF_SNAPSHOT.md` — current state snapshot
3. `docs/ai-memory/00_current_context.md` — current context
4. `docs/ai-memory/11_next_tasks.md` — next task recommendation
5. `docs/TASK_CONTEXT_MAP.md` — task-specific docs to read

Only open long docs when the current task requires them.

## Task selection
- If working tree has changes: audit them first, continue that task.
- If on a feature branch: finish the branch task first.
- If clean: use Current Recommended Next Task from tracker/snapshot.
- If tracker and handoff disagree: trust git status + code first, then update docs.

## What not to read by default
- Do not read every docs file at session start.
- Do not read `docs/ARCHIVE_HANDOFF.md` unless debugging history.
- Do not read DOCX/archive files unless task asks.
- Do not cat full large docs if only one section is needed.
- Use `rg` to find relevant sections.

## Quality gates
**Docs-only:**
```bash
git diff --check
```

**Code tasks** must follow CLAUDE.md quality gates:
```bash
pnpm --filter @xuantoi/shared build    # shared MUST build first
pnpm typecheck                          # all workspaces
pnpm lint                               # eslint all
pnpm build                              # all workspaces
```

Tests per workspace when touched:
```bash
pnpm --filter @xuantoi/api test        # needs Postgres + Redis
pnpm --filter @xuantoi/web test        # Vitest + happy-dom
pnpm --filter @xuantoi/shared test
```

## Hard rules
- No push to `main`.
- No commit unless user explicitly asks.
- No secrets.
- No fake test pass.
- No disabling tests/CI.
- No schema/economy/balance changes unless task requires.
- No new roadmap if tracker already defines task flow.
- All schema changes MUST be additive (no field deletion, only deprecation).
- All currency/item mutations go through `CurrencyService`/`ItemService` + ledger row.

## Final report
Report:
- Branch
- Files changed
- Summary
- Checks run
- Pass/fail
- Docs updated
- Next task

## Token budget tips
- Read snapshot files first (30-50 lines each).
- Use `rg` to find sections in large docs.
- Only read full docs when task requires.
- Update memory files after important tasks.
