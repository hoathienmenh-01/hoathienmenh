# Decisions Memory

> **Last updated:** 2026-05-27

## Format
Use this format for recording key decisions:

```
## YYYY-MM-DD — Decision title
- **Decision:** What was decided
- **Reason:** Why this decision was made
- **Source:** Who/what/where (PR, discussion, doc)
- **Impact:** What this affects
```

---

## 2026-05-27 — AI Memory System + Quick Context Docs
- **Decision:** Add AI memory system (`docs/ai-memory/`) + quick context docs (`AI_QUICK_START.md`, `AI_HANDOFF_SNAPSHOT.md`, `TASK_CONTEXT_MAP.md`) to reduce token usage for Claude sessions.
- **Reason:** Repo has 25+ docs files, some very large (ECONOMY_MODEL 68k, BALANCE_MODEL 242k, ARCHIVE_HANDOFF 1125 lines). AI sessions were reading too many docs at startup, wasting tokens/quota.
- **Source:** Branch `docs/ai-memory-system`, docs-only changes.
- **Impact:** Future Claude sessions should read snapshot files first (30-80 lines each) instead of full docs. Memory files provide domain summaries. Expected 80% token reduction at session start.

## 2026-05-27 — Loki + Grafana Logging Stack
- **Decision:** Add production-ready log aggregation infrastructure (Loki 2.9.3 + Grafana 10.2.3 + Promtail 2.9.3) for observability.
- **Reason:** Core Logger Package (PR #682) added structured logging, but no aggregation/visualization. Ops team needs centralized log viewing.
- **Source:** Branch `feat/setup-loki-grafana-logging`, follow-up to Core Logger Package.
- **Impact:** Infra-only changes (7 files, 560 insertions). Logs aggregated with 7-day retention. Grafana dashboard on port 3001. No runtime code changes.

## 2026-05-26 — Core Logger Package
- **Decision:** Add unified logging infrastructure package `@xuantoi/logger` with backend (Pino) and frontend (Console) implementations.
- **Reason:** Inconsistent logging across codebase. Need structured logging with sensitive data redaction for production.
- **Source:** PR #682 (merged).
- **Impact:** New package `packages/logger/` with 37 tests. API bootstrap migrated to new logger. Web app integrated. 31 sensitive paths redacted. No gameplay changes.

---

## Notes
- Keep this file focused on **architectural/technical decisions**, not task progress.
- For task progress, see `docs/FEATURE_PROGRESS_TRACKER.md` and `docs/AI_HANDOFF_REPORT.md`.
- For known issues, see `10_known_issues.md`.
