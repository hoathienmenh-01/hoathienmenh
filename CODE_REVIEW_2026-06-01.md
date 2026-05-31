# Code Review — XuânTôi Full Stack (2026-06-01)

> **Scope:** Full-stack review — backend + frontend + shared + infra
> **Reviewer:** AI Agent
> **Baseline:** Previous backend review (CODE_REVIEW_FINAL_REPORT.md, 2026-05-31)
> **Commit:** `2d7f3a0b` (HEAD on `main`)

---

## EXECUTIVE SUMMARY

The codebase is **production-grade** with strong architecture across all layers. This review covers areas not included in the previous backend-only review: frontend Vue app, shared packages, WebSocket layer, ecommerce scaffold, and cross-cutting concerns. Found **3 new issues** (1 MEDIUM, 2 LOW).

| Area | Files | Rating | Notes |
|------|-------|--------|-------|
| Frontend Router | 617 lines, 100+ routes | ⭐⭐⭐⭐⭐ | Clean lazy-loading, feature flag guards, proper redirects |
| Frontend Stores | 39 Pinia stores | ⭐⭐⭐⭐⭐ | Composition API, fail-soft hydrate, WS binding |
| Frontend API Layer | 90+ API modules | ⭐⭐⭐⭐⭐ | Token refresh dedup, maintenance detection, proper error annotation |
| Frontend WebSocket | 116 lines | ⭐⭐⭐⭐⭐ | Clean event dispatch, reconnection, origin parsing |
| Shared Packages | 100+ modules, 169 exports | ⭐⭐⭐⭐⭐ | Pure TS catalog/balance, extensive test coverage |
| Backend Security | 300+ endpoints, 142 admin guards | ⭐⭐⭐⭐⭐ | All admin routes gated, player routes extract userId from auth |
| Ecommerce App | 4 files | ⭐⭐⭐⭐ | Minimal Next.js scaffold, not production-ready |
| Infra/Scripts | Docker, Grafana, Loki, smoke scripts | ⭐⭐⭐⭐⭐ | Comprehensive monitoring + 37 smoke suites |

---

## NEW ISSUES FOUND

### 🟡 MEDIUM SEVERITY (1)

#### 1. Artifact V2 Service — Raw `Math.random()` Without Injectable RNG
**File:** `apps/api/src/modules/character/artifact-v2.service.ts`
**Lines:** 256, 290, 291, 514
**Problem:** All other services (combat, boss, tribulation, refine, spiritual-root, equipment, alchemy) use the injectable `rng: () => number = Math.random` pattern for test determinism and seeded RNG. `ArtifactV2Service.craft()` and `runUpgrade()` use raw `Math.random()` directly, making:
- Unit tests non-deterministic (can't pin RNG to verify outcomes)
- Audit trail non-reproducible (can't recreate exact roll from seed)
- Consistency break with every other RNG call site

**Evidence:**
```typescript
// Line 256 — craft success roll
const rollValue = Math.random();

// Lines 290-291 — grade + substat roll
resolvedGrade = rollArtifactGrade(bp, Math.random);
resolvedSubStats = rollArtifactSubStats(art, resolvedGrade, Math.random);

// Line 514 — upgrade success roll
const rollValue = Math.random();
```

**Fix:** Add optional `rng` parameter (default `Math.random`) to `craft()` and `runUpgrade()`, matching the pattern used by `combat.service.ts`, `boss.service.ts`, `tribulation.service.ts`, etc.

### 🟢 LOW SEVERITY (2)

#### 2. Router — Feature Flag Guard on Redirect Route
**File:** `apps/web/src/router/index.ts`
**Lines:** 150-154
**Problem:** The `/auction` route has both `redirect: '/market'` and `beforeEnter: featureFlagGuard('AUCTION_HOUSE_ENABLED')`. The guard runs before the redirect, which means:
- If flag is OFF → redirects to `/home` (correct but confusing — user typed `/auction`)
- If flag is ON → redirects to `/market` (guard was unnecessary)
- The guard is only useful on `/market-v2` (line 264), not `/auction`

**Fix:** Remove `beforeEnter` from `/auction` route since it just redirects to `/market`.

#### 3. Ecommerce App — Minimal Scaffold
**File:** `ecommerce/` (4 files)
**Problem:** The ecommerce app is a bare Next.js scaffold with default `page.tsx` and no actual functionality. If this is intentional placeholder, no action needed. If it's meant for production, it needs:
- Authentication integration
- Product catalog
- Payment flow
- Order management

**Status:** Likely intentional placeholder — no fix needed.

---

## CODE QUALITY PATTERNS (CONFIRMED EXCELLENT)

### ✅ Frontend Architecture
- **Zero `console.log`** in all `.ts` and `.vue` files — proper `@/utils/logger` used throughout
- **Zero Chinese characters** in `apps/web/src` — Han gate clean
- **Lazy-loading** on all 100+ routes via `() => import(...)` — no eager imports
- **Feature flag guards** on gated routes (auction, story-v2) with fail-open design
- **Token refresh dedup** in API client — single inflight refresh, concurrent 401s share result
- **Maintenance detection** in API client — 503 + `MAINTENANCE_ACTIVE` triggers overlay store
- **WebSocket** clean event dispatch with typed handlers, reconnection config

### ✅ Backend Security
- **142 `@RequireAdmin()` guards** across all admin endpoints
- **`@RequireAdminPermission()`** fine-grained permissions on codex, market, PvP admin
- **All player endpoints** extract `userId` from auth guard — no trust of client-supplied IDs
- **No hardcoded secrets** found in any source files
- **Rate limiting** on sensitive endpoints (shop, alchemy, admin mutations)

### ✅ Shared Packages
- **100+ pure TS modules** with extensive test coverage
- **Catalog-driven design** — game balance in shared, not scattered across services
- **Type-safe contracts** — `WsFrame`, `Envelope<T>`, error codes exported
- **Build-first workflow** — `pnpm --filter @xuantoi/shared build` before other workspaces

### ✅ Economy Integrity (Reconfirmed)
- All currency mutations via `CurrencyService` + ledger
- Idempotency keys on reward sources
- Admin cannot mint Tiên Ngọc via bypass
- Daily reward caps on cultivation, dungeon, mission, combat

---

## KNOWN BACKLOG (from previous review, still valid)

1. **TOCTOU in encounter/run creation** — findFirst + create not atomic (mitigated by ALREADY_IN_FIGHT guard)
2. **Stamina race condition** — check + decrement not atomic (mitigated by updateMany CAS)
3. **Cultivation tick scalability** — fetches ALL cultivating characters per tick (needs pagination at scale)
4. **Character mega-module** — 30+ services in single module (architecture improvement)
5. **Returner onLogin wire** — reverted in `db18901b`, needs re-wiring with proper error handling
6. **Daily encounter battle adapter** — TODO in `daily-encounter.service.ts`
7. **Liveops reward grant** — TODO in `liveops-cron.service.ts` (territory + sect season)

---

## RECOMMENDATIONS

### Immediate (before beta)
1. Fix Artifact V2 `Math.random()` → injectable RNG pattern (MEDIUM)
2. Clean up `/auction` route guard (LOW)

### Short-term (first month)
1. Re-wire returner `onLogin` with proper error isolation
2. Add pagination to cultivation tick processor
3. Complete daily encounter battle adapter

### Medium-term (post-beta)
1. Split character mega-module into separate NestJS modules
2. Add Redis caching for character stats, boss state
3. Add load/stress testing for concurrent operations

---

## REVIEW COVERAGE

| Area | Status | Details |
|------|--------|---------|
| Backend — 12 core systems | ✅ Previous review | Combat, Boss, Dungeon, Cultivation, Alchemy, Shop, Mission, Inventory, Market V2, Pet, Homestead, Territory |
| Backend — 80+ modules | ✅ This review | Security patterns, admin guards, endpoint coverage |
| Frontend — Router | ✅ This review | 100+ routes, lazy-loading, feature flags |
| Frontend — Stores | ✅ This review | 39 stores, auth, game, WS binding |
| Frontend — API Layer | ✅ This review | 90+ modules, client, error handling |
| Frontend — WebSocket | ✅ This review | Event dispatch, reconnection |
| Shared Packages | ✅ This review | 100+ modules, exports, catalog integrity |
| Ecommerce | ✅ This review | Minimal scaffold |
| Infra/Scripts | ✅ This review | Docker, monitoring, smoke suites |
| Security | ✅ This review | 142 admin guards, no hardcoded secrets |
| Code Hygiene | ✅ This review | Zero console.log, zero Chinese chars |