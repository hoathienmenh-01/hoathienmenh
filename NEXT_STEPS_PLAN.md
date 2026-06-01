# Kế Hoạch Tiếp Theo — XuânTôi Tu Tiên Game

> **Ngày:** 2026-05-31
> **Trạng thái:** v1.0 roadmap achieved. 50/50 tasks DONE.
> **Dựa trên:** CODE_REVIEW_FINAL_REPORT.md + FEATURE_PROGRESS_TRACKER.md

---

## Phase A: Code Quality Hardening (Tuần 1)

### A1. Merge Review Fixes vào main
- Tạo branch `fix/code-review-hardening`
- Cherry-pick tất cả 20 files đã sửa (typecheck ✅, lint ✅)
- Chạy full test suite: `pnpm test` + `pnpm smoke:all`
- Merge PR
- **Effort:** 2 giờ (review + merge)

### A2. Boss.service.ts Roguelike Cross-guard
- Thêm 5 dòng cross-guard (`roguelikeRun.findFirst`) vào `boss.service.ts` `attack()` method
- **Effort:** 15 phút

### A3. API Test Suite với Postgres + Redis
- `pnpm infra:up` → `pnpm --filter @xuantoi/api test`
- Fix bất kỳ test failures nào do cross-guard changes
- **Effort:** 1-2 giờ

---

## Phase B: Beta Launch Prep (Tuần 1-2)

### B1. Smoke Test Full Suite
```bash
pnpm infra:up
pnpm dev
pnpm smoke:all  # 24 suites
```
- Verify tất cả 24 smoke scripts pass
- **Effort:** 1 giờ

### B2. Beta Checklist
- [ ] Verify all smoke tests pass
- [ ] Verify i18n parity (VI/EN)
- [ ] Verify PWA install flow
- [ ] Verify push notifications
- [ ] Verify admin panel access
- [ ] Create beta user accounts
- [ ] Prepare beta feedback form

### B3. Deploy Staging
- Docker Compose production-ready config
- Environment variables (.env.production)
- Database migration
- **Effort:** 2-3 giờ

### B4. Closed Beta (10-20 testers)
- Invite testers
- Monitor error rates (Sentry)
- Collect feedback daily
- **Duration:** 1-2 tuần

---

## Phase C: Performance & Scalability (Tuần 2-3)

### C1. Redis Caching Layer
- Cache character stats (TTL 30s)
- Cache boss state (TTL 5s)
- Cache shop catalog (TTL 60s)
- **Effort:** 1 ngày

### C2. Database Query Optimization
- Add indexes cho frequent queries:
  - `Encounter(characterId, status)`
  - `DungeonRun(characterId, status)`
  - `WorldBoss(status, regionKey)`
- **Effort:** 2 giờ

### C3. Rate Limiting Review
- Verify all endpoints có rate limiting
- Add rate limiting cho missing endpoints
- **Effort:** 2 giờ

---

## Phase D: Content Expansion (Tuần 3-4)

### D1. New Dungeon Content
- Thêm 3-5 dungeons mới cho mid-game (luyenkhi → truc_co realm)
- Thêm 10-15 monsters mới
- **Effort:** 2-3 ngày

### D2. New Boss Events
- Thêm 2-3 boss cho LiveOps events
- Balance rewards
- **Effort:** 1 ngày

### D3. New Alchemy Recipes
- Thêm 5-10 recipes cho mid-game
- Thêm 3-5 new pills
- **Effort:** 1 ngày

---

## Phase E: Post-Beta Improvements (Tháng 2)

### E1. Character Module Refactoring
- Tách character mega-module (30+ services) thành modules riêng:
  - `alchemy/` (alchemy.service, alchemy.controller)
  - `equipment/` (equipment.service, equipment-economy.service)
  - `talent/` (talent.service)
  - `tribulation/` (tribulation.service, tribulation-mini-battle.service)
- **Effort:** 3-5 ngày

### E2. API Versioning
- Thêm `/v1/` prefix cho tất cả routes
- Backward-compatible redirects
- **Effort:** 1 ngày

### E3. Load Testing
- Artillery/k6 scripts cho critical paths:
  - Combat action
  - Boss attack
  - Shop buy
  - Cultivation tick
- **Effort:** 1-2 ngày

---

## Ưu Tiên Thực Hiện

| # | Task | Priority | Effort | Dependencies |
|---|------|----------|--------|--------------|
| 1 | A1. Merge review fixes | 🔴 P0 | 2h | None |
| 2 | A2. Boss roguelike guard | 🔴 P0 | 15m | None |
| 3 | A3. API tests | 🔴 P0 | 2h | A1 |
| 4 | B1. Smoke tests | 🔴 P0 | 1h | A1 |
| 5 | B3. Deploy staging | 🟡 P1 | 3h | A1, B1 |
| 6 | B4. Closed beta | 🟡 P1 | 2w | B3 |
| 7 | C1. Redis caching | 🟡 P2 | 1d | B4 |
| 8 | D1-D3. Content | 🟡 P2 | 5d | B4 |
| 9 | E1. Module refactor | 🟢 P3 | 5d | B4 |
| 10 | E2. API versioning | 🟢 P3 | 1d | B4 |

---

## Commands Reference

```bash
# Development
pnpm install
pnpm infra:up
pnpm dev

# Quality gates
pnpm --filter @xuantoi/shared build
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @xuantoi/api test
pnpm --filter @xuantoi/web test

# Smoke tests
pnpm smoke:all

# Deploy
pnpm infra:up
pnpm --filter @xuantoi/api prisma:migrate
pnpm --filter @xuantoi/api bootstrap