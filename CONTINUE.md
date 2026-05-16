# CONTINUE — Phase 15.8 LiveOps Maintenance Polish Bundle

Branch: `devin/20260516-182312-phase-15-8-liveops-maintenance-polish`
Base: `main` của `hoathienmenh-01/xuantoi`.

Mục tiêu: vận hành beta/liveops an toàn — cron health metric +
staleness alert, champion membership snapshot cho audit, admin Hall of
Fame view xem lịch sử top sect / MVP qua mùa giải, runbook hướng dẫn
ops. KHÔNG mở scope mới (Alchemy V2, NPC Romance / Marriage, Arena V2,
Sect War, Spirit Vein Territory, Real-time PvP đều defer).

> Lịch sử PR trước (Beta Safe Integration & Ops Sweep — branch
> `devin/20260516-153244-beta-safe-integration-ops`) đã merge `main`
> (PR #617, commit `8ab1baf2`). Mục lưu trữ tham khảo dưới phần "PR
> trước" cuối file.

---

## TỔNG QUAN

| Commit | Phase | Summary |
|---|---|---|
| `82fdfdc4` | 1 | `LiveOpsCronHealth` model + service + shared `evaluateCronStaleness()` + admin endpoint |
| `c2109033` | 2 | `SectSeasonChampionSnapshot` + `SectSeasonChampionSnapshotMember` + settlement wire + idempotent upsert |
| `3ca8c0e7` | 3 (API) | `getAdminHallOfFame()` service + `GET /admin/sect-season/hall-of-fame` (`@RequireAdmin()`) + tests |
| `7b57f82e` | 3 (web) | `adminSectSeason.ts` client + `AdminHallOfFameView.vue` + route `/admin/hall-of-fame` + i18n VI/EN + 7 component tests |
| `<docs>` | 4 | `docs/runbooks/liveops-maintenance.md` + update `CONTINUE.md` + `docs/AI_HANDOFF_REPORT.md` |

---

## PHASE LOG

### Phase 1 — Cron health metric + staleness alert (`82fdfdc4`)

- `packages/shared/src/liveops-cron-health.ts`: pure
  `evaluateCronStaleness({ cadence, lastRunAt, now })` trả `OK | STALE
  | OVERDUE | NEVER_RAN`. Thresholds shared (FE+API):
  - `weekly`: stale ≥ 7d, overdue ≥ 14d.
  - `daily`: stale ≥ 24h, overdue ≥ 48h.
- `LiveOpsCronHealth` Prisma model (UNIQUE `jobKey`, `lastRunAt`,
  `lastStatus`, `lastDurationMs`, `lastError` truncated 1KB,
  `consecutiveFailures` reset-on-OK / inc-on-FAIL).
- `LiveOpsCronHealthService.recordRun()` upsert sau mỗi cron tick,
  wired vào `LiveOpsCronService.runWeeklyCycle()`, territory weekly,
  sect-season weekly settlement.
- `GET /admin/liveops/cron-health` (`@RequireAdmin()`) — read-only,
  return per-job `staleness` + `staleSinceMs` + last-run + last-status
  + consecutiveFailures.
- Tests: shared threshold matrix
  (`packages/shared/src/liveops-cron-health.test.ts`) + admin
  controller guard / payload shape
  (`apps/api/src/modules/liveops-cron/admin-liveops-cron.controller.test.ts`).

### Phase 2 — Champion membership snapshot (`c2109033`)

- Prisma additive:
  - `SectSeasonChampionSnapshot` (UNIQUE `(seasonId, sectId)`, `rank`,
    `memberCount`, `createdAt`, `updatedAt`).
  - `SectSeasonChampionSnapshotMember` (FK + UNIQUE `(snapshotId,
    characterId)`, `userId`, `characterName`, `role`, `contribution`,
    `power`, `joinedAt`).
- Cap: `SECT_SEASON_CHAMPION_MEMBER_CAP = 100` (enforce ở write
  path).
- Idempotent: `upsert` snapshot + `createMany skipDuplicates`
  members. Chạy settlement 2 lần → cùng state, KHÔNG duplicate, KHÔNG
  re-grant (`SectSeasonRewardGrant` UNIQUE vẫn là source of truth).
- Member rời sect SAU settlement → snapshot KHÔNG bị xoá (decoupled
  khỏi `Membership`).
- Legacy seasons trước Phase 15.8 không có snapshot → admin endpoint
  trả `snapshotMissing: true` (UI hiển thị badge "snapshot missing
  (legacy or not yet finalized)"), KHÔNG backfill.

### Phase 3 — Admin Hall of Fame view (`3ca8c0e7` API + `7b57f82e` web)

API (`3ca8c0e7`):
- `SectSeasonHistoryService.getAdminHallOfFame()` join:
  - `SectSeasonSnapshot` (finalized seasons, sort `finalizedAt` DESC).
  - `SectSeasonSectRank` (top sect / score per season).
  - `SectSeasonTopMember` (MVP per season).
  - `SectSeasonRewardGrant` aggregate (count + max(createdAt) grouped
    by `seasonId` × `kind` = CHAMPION / MVP).
  - `SectSeasonChampionSnapshot` (member count + createdAt).
  - Existing `getHallOfFame()` aggregate (top sects / members across
    all seasons + totalSeasonsFinalized).
- New TS types: `AdminSectSeasonRewardStatus`,
  `AdminSectSeasonChampionSnapshotMeta`, `AdminSectSeasonSummary`,
  `AdminSectSeasonHallOfFameView`.
- `GET /admin/sect-season/hall-of-fame` (`@RequireAdmin()`,
  read-only). Non-admin → `FORBIDDEN`.
- No sensitive data exposed: chỉ character names, points, sect
  names, timestamps đã có public trên hall-of-fame panel của player.
  Reward AMOUNTS và per-grant ledger rows KHÔNG expose — chỉ count +
  last-at.

Web (`7b57f82e`):
- `apps/web/src/api/adminSectSeason.ts` — client wrapper
  `getAdminSectSeasonHallOfFame()` + types parity với API DTO.
- `apps/web/src/views/AdminHallOfFameView.vue` — Cửu Thiên Mộng admin
  view, ADMIN-only (MOD cũng forbidden ở 15.8). Non-admin → endpoint
  KHÔNG được gọi.
  - Filter bar (client-side substring): season key / sect / MVP +
    Clear + count badge `visible/total`.
  - Per-season cards: champion + score, MVP + points, reward grant
    counts + last-at, snapshot member count, snapshot-missing badge
    cho legacy.
  - Aggregate Hall of Fame: top sects / top members / total seasons.
- Route `/admin/hall-of-fame` lazy-loaded.
- i18n parity: `adminHallOfFame.*` `vi.json` + `en.json`.
- 7 component tests: forbidden cho PLAYER / MOD (endpoint NOT
  called), empty, populated, filter season / MVP / sect, clear.

### Phase 4 — Docs / runbook

- New: `docs/runbooks/liveops-maintenance.md` — runbook tập trung:
  cron health flow + thresholds + triage, champion snapshot purpose +
  verification SQL probes, admin Hall of Fame route + access control,
  test evidence, defer list.
- Updated `CONTINUE.md` (file này) + `docs/AI_HANDOFF_REPORT.md`
  executive summary entry cho Phase 15.8.

---

## RISK NOTES

- **Cron health thresholds**: `weekly` 7d/14d, `daily` 24h/48h
  hard-coded trong shared module — đảm bảo FE+API in sync. Future
  tuning qua env additive (signature đã nhận `{ cadence }`). KHÔNG
  paging ở 15.8; state là read-only trong admin view. Operator
  action khi STALE / OVERDUE → xem
  `docs/runbooks/liveops-maintenance.md` §1.4.
- **Snapshot idempotency**: `SectSeasonChampionSnapshot` upsert keyed
  `(seasonId, sectId)`; members `createMany skipDuplicates` keyed
  `(snapshotId, characterId)`. Chạy settlement 2 lần → identical
  state, KHÔNG re-grant (`SectSeasonRewardGrant` UNIQUE vẫn
  authoritative). Member-cap = 100 enforce ở write time, KHÔNG
  retroactively prune.
- **Admin Hall of Fame access control**: `@RequireAdmin()` reject
  non-ADMIN (MOD included) với `FORBIDDEN`. FE double-guard (MOD
  thấy not-admin empty state và request KHÔNG fire). Endpoint
  read-only — không mutation, không rewrite history. Ledger details
  per-grant KHÔNG expose; chỉ count + last-grant-at.
- **No Prisma migration drift**: chỉ additive tables / indexes
  (Phase 1 `LiveOpsCronHealth`, Phase 2 `SectSeasonChampionSnapshot`
  + `SectSeasonChampionSnapshotMember`). Rollback strategy
  `docs/RUNBOOK.md` §1.5.7 áp dụng — soft revert by removing code
  path is safe, hard drop chỉ sau soak.

---

## TEST EVIDENCE (local)

| Workspace | Result |
|---|---|
| `pnpm -C apps/api lint` | pass |
| `pnpm -C apps/api test` | new suites pass (cron health, sect-season history admin, admin controller); pre-existing unrelated flakes ở rate-limiter / maintenance-window — KHÔNG trong scope 15.8 |
| `pnpm -C apps/web lint` (max-warnings 0) | pass |
| `pnpm -C apps/web typecheck` | pass |
| `pnpm -C apps/web test` | 234 files / 2493 tests pass |
| Han gate `[\u4e00-\u9fff]` over `apps/web/src` | 0 match |

New tests Phase 15.8:
- `packages/shared/src/liveops-cron-health.test.ts` — threshold matrix
  per cadence + null / NEVER_RAN.
- `apps/api/src/modules/liveops-cron/admin-liveops-cron.controller.test.ts`
  — admin guard + payload shape + mixed staleness.
- `apps/api/src/modules/sect-season/admin-sect-season.controller.test.ts`
  — Hall of Fame endpoint guard + shape.
- `apps/api/src/modules/sect-season/sect-season-history.service.test.ts`
  — `getAdminHallOfFame` multi-season aggregation, reward grant
  status, snapshot meta, sort descending.
- `apps/web/src/views/__tests__/AdminHallOfFameView.test.ts` — 7 cases
  (forbidden cho PLAYER + MOD, empty, populated render, filter
  season / MVP / sect, clear).

---

## CỐ Ý KHÔNG LÀM (defer)

- Alchemy V2.
- NPC Romance / Marriage Path.
- Arena V2 follow-up (season reward / ELO curve).
- Sect War foundation.
- Spirit Vein Territory.
- Real-time PvP.
- Real-time alerting / paging on cron failures (state surfaced trong
  admin view; paging là follow-up phase).
- Mutating endpoint trên Admin Hall of Fame (read-only by design).
- Reward settlement logic change (snapshot là audit-only, grant gate
  KHÔNG đổi).

---

## QUY TẮC CỨNG (đã tuân thủ)

- KHÔNG push thẳng `main`. Branch đã push GitHub TRƯỚC khi code.
- KHÔNG giữ code local: mỗi phase commit + push ngay (`82fdfdc4` →
  `c2109033` → `3ca8c0e7` → `7b57f82e` → docs).
- KHÔNG tách PR — 1 PR duy nhất trên branch hiện hành.
- KHÔNG mở hệ thống lớn ngoài scope (xem defer list).
- KHÔNG disable / xoá test. KHÔNG fake green.
- KHÔNG commit secret.
- KHÔNG bypass `ECONOMY_MODEL` invariant.
- KHÔNG grant Tiên Ngọc qua admin bypass.
- KHÔNG đổi Prisma schema / migration ngoài UNIQUE / additive đã
  ship.
- KHÔNG phá i18n parity, KHÔNG thêm chữ Hán (`[\u4e00-\u9fff]`) vào
  `apps/web/src`.
- KHÔNG phá admin guard — `@RequireAdmin()` enforce ở mọi endpoint
  mới + FE double-guard.
- KHÔNG phá reward settlement — `SectSeasonRewardGrant` UNIQUE vẫn
  source of truth; snapshot chỉ là audit layer.
