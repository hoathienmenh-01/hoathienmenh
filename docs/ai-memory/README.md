# AI Memory — Xuân Tôi

## Purpose
Short memory files for Claude/AI sessions to reduce token usage.

## Rules
- This folder does not replace `CLAUDE.md`.
- This folder does not replace `docs/FEATURE_PROGRESS_TRACKER.md`.
- This folder does not replace `docs/AI_HANDOFF_REPORT.md`.
- Keep files short (target: 50-150 lines per file).
- Link to source docs instead of copying long content.
- Update only relevant memory files after a task.
- Do not create memory for every small function.

## Recommended startup read
1. `docs/AI_QUICK_START.md`
2. `docs/AI_HANDOFF_SNAPSHOT.md`
3. `docs/ai-memory/00_current_context.md`
4. `docs/ai-memory/11_next_tasks.md`
5. One domain memory file based on task type (see `docs/TASK_CONTEXT_MAP.md`)

## Memory types

### Global memory (read first)
- `00_current_context.md` — current branch, task, blockers
- `11_next_tasks.md` — current recommended next task
- `10_known_issues.md` — active blockers

### Domain memory (read when task touches domain)
- `01_architecture.md` — repo structure, stack, boundaries
- `02_web.md` — apps/web (Vue 3 frontend)
- `03_api.md` — apps/api (NestJS backend)
- `04_shared_contracts.md` — packages/shared (catalog/types)
- `05_economy_ledger.md` — currency/item/reward/ledger invariants
- `06_gameplay_systems.md` — cultivation/combat/missions/sect/boss
- `07_content_balance.md` — items/skills/monsters/balance
- `08_testing_ci.md` — test commands, smoke, E2E
- `09_decisions.md` — key decisions log

### Feature memory (only for large multi-session features)
- `features/_template.md` — template for feature memory
- `features/<feature-name>.md` — created only when needed

## Update rules
- Update `00_current_context.md` after completing major tasks.
- Update `11_next_tasks.md` when recommended task changes.
- Update domain memory when learning new patterns/invariants.
- Update `09_decisions.md` when making architectural decisions.
- Update `10_known_issues.md` when discovering/resolving blockers.

## Anti-patterns
- ❌ Do not copy code into memory files.
- ❌ Do not copy long logs into memory files.
- ❌ Do not create memory for every small function.
- ❌ Do not duplicate content from CLAUDE.md or tracker.
- ❌ Do not let memory files grow beyond 200 lines.
