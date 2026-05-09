# Phase 14.0.D — Territory Weekly War Loop — HANDOFF

**Branch:** `devin/phase-14-0-d-territory-weekly-war-loop`
**Status:** WIP (~60%) — shared + API done, FE shell only, tests + PR pending.

## Đã làm xong

| Layer | File | Status |
|---|---|---|
| shared | `packages/shared/src/territory.ts` (period helpers + 7 view types) | ✅ DONE |
| shared | `packages/shared/src/territory-war.test.ts` (24 tests, all pass) | ✅ DONE |
| api | `apps/api/src/modules/territory/territory-war.service.ts` (~400 lines) | ✅ DONE |
| api | `apps/api/src/modules/territory/territory.module.ts` (provider + export) | ✅ DONE |
| api | `apps/api/src/modules/territory/territory.controller.ts` (3 public GET) | ✅ DONE |
| api | `apps/api/src/modules/territory/admin-territory.controller.ts` (POST settle-current) | ✅ DONE |
| api | `apps/api/src/modules/territory/admin-territory.controller.test.ts` (constructor stub) | ✅ DONE |
| web | `apps/web/src/api/territory.ts` (8 view types + 4 client funcs) | ✅ DONE |
| web | `apps/web/src/stores/territory.ts` (war state + 3 actions) | ✅ DONE |
| web | `apps/web/src/views/TerritoryView.vue` (`'war'` vào `ALL_TABS`, panel CHƯA viết) | ⚠️ SHELL |

**Verified:** `pnpm --filter @xuantoi/shared typecheck` (0 errors), `pnpm --filter @xuantoi/api typecheck` (0 errors), `pnpm --filter @xuantoi/api test -- --run admin-territory` (12 PASS).

## Cần làm tiếp (theo thứ tự)

### 1. Web — Render war panel trong TerritoryView (~150 lines template)

Thêm `<section v-else-if="tab === 'war'">` ngay trước `<section v-else-if="tab === 'me'">` (~ line 768) gồm:

- **Countdown panel:** dùng `setInterval(1000)` để tick `nowMs`, render `timeRemainingMs = warState.endsAt - now`. Cần `onBeforeUnmount(() => clearInterval(...))` (đã import sẵn). Hiển thị format `D ngày HH:MM:SS`.
- **Period header:** `warState.periodKey`, `warState.startsAt → endsAt`, badge `warState.previousPeriodKey`.
- **9 region cards với top 3 standings:** loop `warState.regions[]`. Mỗi card:
  - Region name + contested badge nếu `r.contested === true`
  - Owner name từ `r.currentOwnerSectName`
  - Top 3 standings: `r.topStandings[]` với `{rank, sectName, points, isLeader}`
  - Lead margin: `r.leadMargin` (chênh lệch leader vs runnerUp)
- **History panel:** loop `warHistory.entries[]`. Mỗi period 1 row, expand để xem `entry.snapshots[]`.
- **Admin button:** `v-if="isAdmin"`, button `@click="adminSettleCurrentWar()"`, disable khi `warSettleLoading`. Show `lastWarSettleResult`.

Hooks setup script (thêm vào `<script setup>`):

```ts
// Phase 14.0.D — countdown ticker
const nowMs = ref(Date.now());
let _tick: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  _tick = setInterval(() => { nowMs.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => { if (_tick) clearInterval(_tick); });

const warTimeRemainingMs = computed(() => {
  if (!territory.warState) return 0;
  const ends = new Date(territory.warState.endsAt).getTime();
  return Math.max(0, ends - nowMs.value);
});

function fmtCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
}
```

Watch `tab === 'war'` để fetch lazy:

```ts
watch(tab, async (next) => {
  if (next !== 'war') return;
  const tasks: Array<Promise<unknown>> = [];
  if (!territory.warState) tasks.push(territory.fetchWarCurrent());
  if (!territory.warHistory) tasks.push(territory.fetchWarHistory(8));
  if (tasks.length > 0) await Promise.all(tasks);
}, { immediate: true });
```

### 2. i18n — vi.json + en.json

Thêm key dưới `territory.war.*`:

```json
{
  "territory": {
    "tab": { "war": "Tranh Đoạt" },
    "war": {
      "title": "Tranh Đoạt Lãnh Địa Hàng Tuần",
      "subtitle": "Tông môn tranh đoạt vùng theo tuần. Cuối tuần chốt owner mới.",
      "countdownLabel": "Còn lại",
      "currentPeriod": "Tuần hiện tại: {period}",
      "previousPeriod": "Tuần trước: {period}",
      "windowFmt": "{from} → {to}",
      "regionContestedBadge": "Tranh chấp",
      "regionLeadMargin": "Hơn kém: {pts}",
      "regionNoContenders": "Chưa có tông môn tranh đoạt",
      "standingsTitle": "Top 3 đang dẫn đầu",
      "standingsRow": "#{rank} {sect} — {pts} điểm",
      "historyTitle": "Lịch sử tuần",
      "historyEmpty": "Chưa có dữ liệu lịch sử.",
      "historyRow": "{period} ({settled}): {wins} vùng đã chốt",
      "adminTitle": "Admin — Chốt Tuần Hiện Tại",
      "adminSubtitle": "Chốt owner ngay trong tuần (idempotent). Dùng cho test/manual.",
      "adminSettleButton": "Chốt Tuần Hiện Tại",
      "adminSettleRunning": "Đang chốt...",
      "adminLastResult": "Đã chốt {period}: {wins} vùng / {skip} bỏ qua"
    }
  }
}
```

(En version: dịch tương ứng.)

### 3. API tests — `apps/api/src/modules/territory/territory-war.service.test.ts`

Mock prisma. Test cases:
- `getCurrentTerritoryWarState()` empty DB → 9 region với `topStandings: []`, `contested: false`.
- `getCurrentTerritoryWarState()` 2 sect cùng region → standings sort DESC theo points, ASC theo sectId.
- `settleCurrentPeriod()` gọi 2 lần → idempotent (snapshot id giống nhau).
- `settleCurrentPeriod()` region không có influence → trong `skippedRegions[]`.
- `getRegionWarStatus('not_a_region')` → throw `REGION_INVALID`.
- `getWarHistory(limit)` → trả entries DESC theo `settledAt`, group theo `periodKey`.

Admin endpoint test (đã có harness `admin-territory.controller.test.ts`):
- `settleWarCurrent` ok với userId vào `settledBy`.
- `settleWarCurrent` propagate error.

### 4. Web tests — `apps/web/src/views/__tests__/TerritoryView.test.ts`

Dùng pattern existing test (mock pinia, vue-i18n). Tests:
- `data-test="territory-tab-war"` exist + clickable.
- Click war tab → `data-test="territory-war-content"` render.
- `data-test="territory-war-countdown"` render number > 0 khi `endsAt` future.
- `data-test="territory-war-region-card"` render 9 cards.
- `data-test="territory-war-region-standing"` top 3 rows.
- `data-test="territory-war-admin-settle"` chỉ render khi `auth.user.role === 'ADMIN'`.

### 5. Run all checks

```bash
pnpm --filter @xuantoi/shared typecheck
pnpm --filter @xuantoi/shared test -- --run territory
pnpm --filter @xuantoi/api typecheck
pnpm --filter @xuantoi/api test -- --run territory
pnpm --filter @xuantoi/api test -- --run admin
pnpm --filter @xuantoi/web typecheck
pnpm --filter @xuantoi/web test -- --run Territory
pnpm build
```

Tất cả phải PASS, không skip, không fake green.

### 6. Update docs

- `docs/AI_HANDOFF_REPORT.md`: add §Phase 14.0.D War Loop (≤ 30 dòng exec summary, ≤ 250 dòng total).
- `docs/API.md`: document 4 endpoints mới (request/response shape).
- `docs/BALANCE_MODEL.md`: add §11.19 Weekly War Loop (period rule, no-influence rule, tie-break).
- `docs/CHANGELOG.md`: add bullet line at top.
- **Xoá file này (`docs/PHASE_14_0_D_HANDOFF.md`) trước khi merge** — chỉ là handoff tạm.

### 7. Commit + push + PR

```bash
git add -A
git commit -m "feat(web,api,docs): Phase 14.0.D weekly war panel + tests + docs"
git push origin devin/phase-14-0-d-territory-weekly-war-loop
```

Tạo PR với `git_create_pr`:
- title: `feat(api,web,shared): Phase 14.0.D territory weekly war loop`
- base: `main`, head: `devin/phase-14-0-d-territory-weekly-war-loop`

PR body cần 10 sections:
1. Summary
2. Weekly period rule (UTC ISO week, Mon 00:00 reset)
3. Settlement behavior (idempotent UNIQUE `(regionKey, periodKey)`, tie-break `sectId.localeCompare()` ASC, no-influence rule)
4. API changes (4 endpoints + shape)
5. FE changes (war tab + countdown + history + admin button)
6. Tests (shared 24 + api N + web N)
7. Commands run (chuỗi pnpm trên)
8. Docs (4 file đã sync)
9. Risk / rollback (no DB migration; revert chỉ cần revert PR)
10. Next task: Phase 14.0.E (siege? auction? — recommend tuỳ user)

Wait CI: `git_pr_checks(wait_until_complete=true)`.

## Rule không được làm

- Không siege, không diplomacy, không PvP realtime, không auction.
- Không rewrite Territory foundation.
- Không cron không lock — admin trigger only.
- Không tự merge.

## File quan trọng đã sửa

- `packages/shared/src/territory.ts:550-810` — period helpers + war view types.
- `packages/shared/src/territory-war.test.ts` — 24 tests.
- `apps/api/src/modules/territory/territory-war.service.ts` — ~400 lines, 4 methods.
- `apps/api/src/modules/territory/territory.module.ts` — provider/export update.
- `apps/api/src/modules/territory/territory.controller.ts` — 3 public GET.
- `apps/api/src/modules/territory/admin-territory.controller.ts` — POST war/settle-current.
- `apps/api/src/modules/territory/admin-territory.controller.test.ts` — constructor stub fix.
- `apps/web/src/api/territory.ts:245-371` — war types + client.
- `apps/web/src/stores/territory.ts:240-386` — war state + 3 actions.
- `apps/web/src/views/TerritoryView.vue:28-33` — `'war'` vào `ALL_TABS`.

## Endpoint reference

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/territory/war/current` | public | `TerritoryWarStateView` (9 regions, top 3, countdown) |
| GET | `/territory/war/regions/:regionKey` | public | `TerritoryRegionWarStatusView` (top 10 + last 5 settlements) |
| GET | `/territory/war/history?limit=N` | public | `TerritoryWarHistoryView` (default 8, max 32) |
| POST | `/admin/territory/war/settle-current` | ADMIN | `TerritoryWarSettleCurrentResult` |
