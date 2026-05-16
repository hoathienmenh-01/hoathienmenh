# LiveOps Maintenance Runbook — Phase 15.8

> Operational notes for the **Phase 15.8 — LiveOps Maintenance Polish Bundle**:
> cron health tracking, champion membership snapshot, admin Hall of Fame view.
>
> Pair docs:
> - `docs/RUNBOOK.md` — production incident playbook (see §2.2 for cron miss).
> - `docs/LIVE_OPS_MODEL.md` — long-term live-ops blueprint.
> - `docs/ADMIN_GUIDE.md` — admin endpoint reference.

---

## 1. Cron health metric + staleness alert

### 1.1 What it does

Phase 15.8 introduces `LiveOpsCronHealth`, a small DB-backed record per cron
job key. Each cron run (success or failure) calls
`LiveOpsCronHealthService.recordRun()` which upserts the row with:

- `jobKey` (UNIQUE — e.g. `liveops.weekly`, `territory.weekly`, `sect-season.weekly`)
- `lastRunAt` (timestamp of the latest invocation)
- `lastStatus` (`OK` / `FAIL`)
- `lastDurationMs`
- `lastError` (truncated 1KB, only when `FAIL`)
- `consecutiveFailures` (reset to 0 on `OK`, increment on `FAIL`)

The shared helper `packages/shared/src/liveops-cron-health.ts` exposes the
`evaluateCronStaleness()` pure function used by both the API service and the
admin response — same thresholds, same enum (`OK`, `STALE`, `OVERDUE`, `NEVER_RAN`).

### 1.2 Staleness thresholds

| Cadence  | Healthy window | Stale | Overdue |
|---|---|---|---|
| `weekly` (territory weekly cron, sect-season weekly settlement) | < 7 days | 7–14 days | > 14 days |
| `daily`  (mission reset, daily-login reset, future jobs) | < 24h | 24–48h | > 48h |

`NEVER_RAN` = no `LiveOpsCronHealth` row yet for the job key.

> **Why not configurable env?** Phase 15.8 keeps the gate small and idempotent;
> thresholds live in shared code so the FE and API agree. If liveops needs
> dial later, add `LIVEOPS_CRON_*_THRESHOLD_HOURS` env wired through
> `evaluateCronStaleness()` (additive, no schema change).

### 1.3 Admin endpoint

- `GET /admin/liveops/cron-health` — read-only, `@RequireAdmin()`.
- Response shape: `{ ok: true, data: { checkedAt, jobs: AdminLiveOpsCronHealthEntry[] } }`.
- Each entry: `jobKey`, `cadence`, `lastRunAt`, `lastStatus`, `lastDurationMs`,
  `consecutiveFailures`, `staleness` (`OK | STALE | OVERDUE | NEVER_RAN`),
  `staleSinceMs`.

The admin UI for cron health is folded into the existing
`/admin/system-status` view (cron section). Hall of Fame is a separate view —
see §3.

### 1.4 Triage flow when cron `STALE` / `OVERDUE` / `NEVER_RAN`

1. **Verify Redis / BullMQ alive** — see `docs/RUNBOOK.md` §2.2:
   ```bash
   docker exec -it xuantoi-redis redis-cli ping             # PONG?
   docker exec -it xuantoi-redis redis-cli LLEN bull:liveops:active
   ```
2. **Inspect cron health row** for context:
   ```sql
   SELECT * FROM "LiveOpsCronHealth"
   WHERE "jobKey" = 'sect-season.weekly';
   ```
   Look at `lastStatus`, `lastError`, `consecutiveFailures`.
3. **If Redis was down → cron missed window**:
   ```
   POST /api/admin/liveops/run-weekly-cycle
   POST /api/admin/territory/cron/run-now
   POST /api/admin/sect-season/cron/run-now
   ```
   All three are idempotent (DB UNIQUE keys on per-week settlement rows).
4. **If cron `FAIL` from app logic** (e.g. Prisma error):
   - Read `lastError` for clue.
   - Roll back the offending commit OR cherry-pick a hotfix.
   - Re-run the admin force-run endpoint above.
5. **If `NEVER_RAN`** (new job key after deploy):
   - Wait one cron tick.
   - If still missing, check `apps/api/src/cron/*.module.ts` registers the job
     and `LiveOpsCronHealthService.recordRun()` is called inside the handler.

### 1.5 What does NOT trigger an alert

- A successful run that took longer than usual (no SLA on duration in 15.8).
- A `FAIL` with `consecutiveFailures = 1` and the next run is `OK` (recovered).
- A job that intentionally skips work (e.g. weekly settlement called on a
  non-cycle day still records `OK` with 0 work).

If you need real-time paging, wire `consecutiveFailures >= 3` into the
existing alert service in a future phase — Phase 15.8 only surfaces state in
the admin view.

---

## 2. Champion membership snapshot

### 2.1 What it does

When a sect-season finishes settlement, `SectSeasonHistoryService` writes
a **snapshot** of the champion sect's roster at the exact moment of
settlement into `SectSeasonChampionSnapshot` + `SectSeasonChampionSnapshotMember`.

Fields captured per member:
- `userId`, `characterId`, `characterName`
- `role` (`LEADER` / `ELDER` / `MEMBER` / etc. at the time of snapshot)
- `contribution`, `power`
- `joinedAt` (the member's `joinedAt` on the sect at snapshot time)

Snapshot meta:
- `seasonId`, `sectId`, `rank` (always 1 for champion in 15.8)
- `memberCount` (cap: `SECT_SEASON_CHAMPION_MEMBER_CAP = 100`)
- `createdAt`

### 2.2 Why it exists

Without a snapshot, if a member leaves the champion sect **after** settlement
but **before** the reward claim window closes, the history view would
either:
- Lose them (joining a different sect overwrites `Membership` row), or
- Miscount sect membership at the rewarded moment.

With a snapshot, the historical sect roster is **frozen at the rewarded
moment** for audit / Hall of Fame display. Reward grant itself is still
gated by the existing `SectSeasonRewardGrant` UNIQUE — snapshot does NOT
re-grant rewards, only records who *would have been* rewarded.

### 2.3 Idempotency

The settlement path:
```ts
await prisma.sectSeasonChampionSnapshot.upsert({
  where: { seasonId_sectId: { seasonId, sectId } },
  create: { seasonId, sectId, rank, memberCount },
  update: { rank, memberCount, updatedAt: new Date() },
});
```
Members are written with `createMany({ skipDuplicates: true })` keyed by
`(snapshotId, characterId)`. Running the settlement cron twice yields the
same state — no duplicate member rows, no double-grant.

### 2.4 How to verify a season snapshot

1. Find the season:
   ```sql
   SELECT id, "seasonKey", "finalizedAt"
   FROM "SectSeasonSnapshot"
   ORDER BY "finalizedAt" DESC LIMIT 5;
   ```
2. Confirm a snapshot exists:
   ```sql
   SELECT *
   FROM "SectSeasonChampionSnapshot"
   WHERE "seasonId" = '<id from step 1>';
   ```
3. Inspect the roster:
   ```sql
   SELECT "characterName", "role", "contribution", "power"
   FROM "SectSeasonChampionSnapshotMember"
   WHERE "snapshotId" = '<snapshot.id from step 2>'
   ORDER BY "contribution" DESC;
   ```
4. Or fetch via admin endpoint:
   ```
   GET /admin/sect-season/champion-snapshot?seasonKey=<seasonKey>
   ```
   (Phase 15.8 wires this through `getAdminChampionSnapshot()` in the same
   admin controller; ADMIN guard enforced.)

### 2.5 Missing snapshot for an old season

Legacy seasons settled before Phase 15.8 will not have a snapshot. The
admin Hall of Fame view shows `snapshotMissing: true` for those rows —
this is expected, NOT an error. Do **not** backfill manually: the source
data (historical `Membership` state) is already lost. The admin view
notes "snapshot missing (legacy or not yet finalized)" in the UI.

---

## 3. Admin Hall of Fame view

### 3.1 Where to find it

Route: **`/admin/hall-of-fame`** — view component `AdminHallOfFameView.vue`,
ADMIN role only (MOD is forbidden in 15.8). Non-admin users see the
`adminHallOfFame.notAdmin*` empty state and the endpoint is NOT called.

### 3.2 What it shows

- **Filter bar** (client-side `String.includes()` filters):
  - Season key substring.
  - Sect name substring (matches champion sect).
  - MVP character name substring.
  - "Clear" resets all three.
- **Per-season rows** (sorted by `finalizedAt` DESC):
  - Season key + finalized timestamp.
  - Champion sect + score.
  - Total sects / contributors / total points.
  - MVP character + their sect + their points.
  - Reward grant status: `championGrants`, `mvpGrants`,
    `lastChampionGrantAt`, `lastMvpGrantAt` (sourced from
    `SectSeasonRewardGrant`).
  - Champion snapshot member count + created-at, or "missing" badge.
- **Aggregate Hall of Fame** (sourced from existing public hall-of-fame
  aggregator):
  - Top sects (championships, podiums, appearances, best rank).
  - Top members (mvps, podiums, appearances, best rank).
  - Total finalized seasons.

### 3.3 Endpoint

`GET /admin/sect-season/hall-of-fame` — read-only, `@RequireAdmin()`.

Backed by `SectSeasonHistoryService.getAdminHallOfFame()` which joins:
- `SectSeasonSnapshot` (finalized seasons).
- `SectSeasonSectRank` (top sect per season).
- `SectSeasonTopMember` (MVP per season).
- `SectSeasonRewardGrant` aggregate (`count + max(createdAt)` grouped by
  `seasonId` × `kind`).
- `SectSeasonChampionSnapshot` (member count + createdAt).
- `getHallOfFame()` (aggregate top sects / members across all seasons).

No sensitive data exposed: only character names, points, sect names, and
timestamps already public on the player-facing Hall of Fame panel. Reward
**amounts** and individual grant ledger rows are NOT included — only counts.

### 3.4 Access control

- `@RequireAdmin()` guard rejects non-ADMIN with `FORBIDDEN`.
- FE component double-checks `user.role === 'ADMIN'` before calling the
  endpoint (MOD users get the not-admin empty state without firing the
  request).
- No mutation endpoints in 15.8 — view is purely read-only.

---

## 4. Quick reference — verify after deploy

```bash
# 1. Cron health smoke
curl -sS "${API}/admin/liveops/cron-health" -b "xt_access=$ADMIN_COOKIE" | jq '.data.jobs[] | {jobKey, staleness, lastStatus}'

# 2. Hall of Fame smoke (also exercises champion snapshot meta)
curl -sS "${API}/admin/sect-season/hall-of-fame" -b "xt_access=$ADMIN_COOKIE" | jq '.data | {checkedAt, seasonCount: (.seasons|length), totalSeasonsFinalized: .hallOfFame.totalSeasonsFinalized}'

# 3. DB row probes
psql "$DATABASE_URL" -c 'SELECT "jobKey", "lastStatus", "consecutiveFailures", "lastRunAt" FROM "LiveOpsCronHealth" ORDER BY "lastRunAt" DESC;'
psql "$DATABASE_URL" -c 'SELECT "seasonId", "sectId", "memberCount" FROM "SectSeasonChampionSnapshot" ORDER BY "createdAt" DESC LIMIT 5;'
```

---

## 5. Test evidence (Phase 15.8 local gate)

Commands run before opening the PR:

| Workspace | Result |
|---|---|
| `pnpm -C apps/api lint` | pass |
| `pnpm -C apps/api test` | pass (focused suite — see PR body for full count) |
| `pnpm -C apps/web lint` | pass (max-warnings 0) |
| `pnpm -C apps/web typecheck` | pass |
| `pnpm -C apps/web test` | 234 files / 2493 tests pass |
| Han gate (`[\u4e00-\u9fff]` over `apps/web/src`) | 0 match |

New tests added:
- `packages/shared/src/liveops-cron-health.test.ts` (threshold + cadence
  matrix).
- `apps/api/src/modules/liveops-cron/admin-liveops-cron.controller.test.ts`
  (admin guard + payload shape).
- `apps/api/src/modules/sect-season/admin-sect-season.controller.test.ts`
  (Hall of Fame endpoint guard + shape).
- `apps/api/src/modules/sect-season/sect-season-history.service.test.ts`
  (multi-season aggregation, reward grant status, snapshot meta).
- `apps/web/src/views/__tests__/AdminHallOfFameView.test.ts` (7 cases:
  forbidden for non-admin, empty, populated, filters, clear).

---

## 6. Deliberately NOT in Phase 15.8

- Alchemy V2.
- NPC Romance / Marriage Path.
- Arena V2 (season reward / ELO curve).
- Sect War foundation.
- Spirit Vein Territory.
- Real-time PvP.
- Real-time alerting / paging on cron failures (state is surfaced in the
  admin view; paging is a follow-up phase).
- Mutating endpoints on the admin Hall of Fame view (read-only by design).
