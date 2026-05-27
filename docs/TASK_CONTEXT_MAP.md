# Task Context Map — Xuân Tôi

Use this file to decide what to read for each task type. Do not read the whole repo by default.

## Task Type → Docs Mapping

| Task type | Must read | Optional |
|---|---|---|
| **Docs-only** | Relevant docs, `git diff --check` | No runtime code needed |
| **Web/UI** | `apps/web` files related to task, web tests, i18n if touched | Design docs if needed |
| **API/backend** | `apps/api` controller/service/module files related to task | Prisma files only if schema/data changes |
| **Shared/contracts** | `packages/shared`, related tests | Feature docs |
| **Economy/currency/item/reward/ledger** | `docs/ai-memory/05_economy_ledger.md`, shared contracts, relevant api services | `docs/ECONOMY_MODEL.md` (68k chars — only read if deep changes) |
| **Gameplay systems** | `docs/ai-memory/06_gameplay_systems.md`, relevant shared/api/web files | Design bible if needed |
| **Content/balance** | `docs/ai-memory/07_content_balance.md`, shared catalog/balance files | `docs/BALANCE_MODEL.md` (242k chars — only read if formula changes), `docs/CONTENT_PIPELINE.md` (33k chars) |
| **Test/smoke/CI** | `docs/ai-memory/08_testing_ci.md`, `docs/QA_CHECKLIST.md`, `package.json` scripts | Troubleshooting docs |
| **E2E/Playwright** | E2E specs/config, QA checklist, current handoff | Full app docs only if needed |
| **Infra/local run** | `docs/RUN_LOCAL.md`, package scripts, infra docs | `docs/TROUBLESHOOTING.md` |
| **Handoff/update** | `docs/AI_HANDOFF_REPORT.md`, `docs/FEATURE_PROGRESS_TRACKER.md` | Roadmap only if feature status changes |
| **Story/Quest/NPC** | `docs/story/PHASE12_STORY_PROGRESS.md` (progress tracker), relevant shared/api files | `docs/story/TU_TIEN_LO_STORY_BIBLE.md` (design source — only if need lore) |
| **Admin/LiveOps** | `docs/ADMIN_GUIDE.md`, `docs/LIVE_OPS_MODEL.md`, relevant api files | Full admin docs only if needed |
| **Security/Auth** | Relevant api security modules, auth tests | Security docs if available |
| **Migration/Schema** | Prisma schema, migration files, relevant services | Schema design docs |

## Anti-patterns
- ❌ Do not read long archives by default.
- ❌ Do not read full design bible for small UI/test tasks.
- ❌ Do not run broad scans before using `rg`.
- ❌ Do not copy large logs into handoff or memory.
- ❌ Do not create memory for every tiny function.
- ❌ Do not read `docs/ARCHIVE_HANDOFF.md` (1125 lines) unless debugging old PR history.
- ❌ Do not read full `docs/ECONOMY_MODEL.md` (68k chars) for small tasks — read memory summary first.
- ❌ Do not read full `docs/BALANCE_MODEL.md` (242k chars) unless changing formulas — read memory summary first.

## Fast lookup patterns

**Find relevant code:**
```bash
rg -l "keyword" apps/api/src/
rg -l "keyword" apps/web/src/
rg -l "keyword" packages/shared/src/
```

**Find relevant docs section:**
```bash
rg -n "Section Name" docs/LONG_DOC.md
```

**Find test files:**
```bash
find apps/api/src -name "*.test.ts" | rg "module-name"
find apps/web/src -name "*.test.ts" | rg "component-name"
```

## Token budget tips
- Read snapshot files first (30-80 lines each).
- Use `rg` to find sections in large docs.
- Only read full docs when task requires deep understanding.
- Update memory files after learning new patterns.
