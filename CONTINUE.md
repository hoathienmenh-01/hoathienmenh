# CONTINUE — Beta Safe Integration & Operations Sweep

Branch: `devin/20260516-153244-beta-safe-integration-ops`
Base: `main` của `hoathienmenh-01/xuantoi`.

Mục tiêu: vá các integration gap còn lại trước beta (feature flag wiring,
gameplay follow-up, backup runtime, smoke rate-limit, NPC gift timezone) mà
KHÔNG mở scope mới (Alchemy V2, NPC Romance/Marriage, Arena V2, Sect War,
Spirit Vein Territory, Admin Control Center V2 PR2-PR6, Real-time PvP đều
defer).

---

## TỔNG QUAN

PR = 7 commit + 1 docs commit:

| Commit | Phase | Summary |
|---|---|---|
| `1d8d8f3f` | 45.0 finish | Feature flag + remote config audit wiring |
| `719b397e` | 44.2 | Gameplay sweep (combat/inventory/mail/npc/onboarding) |
| `b0eef2f7` | 44.2 fix | `setTimeout` thay `setImmediate` cho lint |
| `7293cfd5` | 17.3 part 1 | Backup offsite + alert config foundation |
| `c0656c35` | 3.2–3.5 | Backup verification + offsite upload runtime + admin UI |
| `f6b3ea44` | 5 (QA-003) | Smoke flush auth rate-limit helper |
| `6574da19` | 6 | NPC gift daily bucket UTC → ICT (Asia/Ho_Chi_Minh) |
| `<docs>` | 7 | Update `CONTINUE.md` + `docs/AI_HANDOFF_REPORT.md` |

Phase 4 (QA-004 admin reload redirect) đã ship trong foundation commit
`e28f1e33` (đã merge `main`) — KHÔNG cần thêm code trong PR này.

---

## PHASE LOG

### Phase 45.0 finish — Feature flag wiring (`1d8d8f3f`)
- `VISUAL_EFFECTS_ENABLED`: AppShell skip `XTAmbientCanvas` layer (mesh +
  halo + motes) khi admin toggle off. Fail-open nếu store chưa hydrate.
- Admin remote-config audit history view: read-only endpoint
  `GET /admin/remote-config/audit` (filter: key / action / limit cap 200,
  hits `AdminAuditLog` scoped `ADMIN_REMOTE_CONFIG_*`, KHÔNG expose secret)
  + FE `AdminRemoteConfigHistoryPanel.vue` + i18n VI/EN parity.
- Mid-priority flag wired:
  - `AUCTION_HOUSE_ENABLED`: xtNav entry filtered khi off; `/auction` +
    `/market-v2` route gated qua `beforeEnter` guard.
  - `STORY_V2_ENABLED`: `/story-v2` route gated qua `beforeEnter` guard.
  - Cả 2 flag flip `public:true` để FE store đọc được.
- Guard fail-open khi fetch lỗi; server vẫn enforce `FEATURE_DISABLED` 503
  ở lớp cuối (defense-in-depth).

### Phase 44.2 — Gameplay integration sweep (`719b397e` + `b0eef2f7`)
- Combat: CombatModule import PetCombatModule; CombatService inject
  optional pet stat aggregator → wire pet combat bonus.
- Inventory: InventoryModule import NotificationModule; InventoryService
  trigger stamina-full passive notification khi player chạm cap.
- Mail: MailModule import OnboardingQuestModule để cascade quest action
  khi mail claim.
- NPC: NpcModule import OnboardingQuestModule (parity với mail) — gift /
  chat action `recordAction` cascade.
- Onboarding: regression test
  `onboarding-quest.recordaction-wire.test.ts` (~241 dòng) verify cascade
  end-to-end qua combat / inventory / mail / npc.
- Migration additive `phase_44_2_secret_realm_active_unique` (UNIQUE
  partial index `WHERE state IN ('ACTIVE','PENDING')` → chống duplicate
  active secret realm run per character).
- Lint fix: `setImmediate` không hợp lệ trong test runtime → swap sang
  `setTimeout(..., 0)`.

### Phase 17.3 part 1 — Backup config foundation (`7293cfd5`)
- `backup.config.ts`: thêm `offsiteUploadEnabled`
  (`BACKUP_OFFSITE_UPLOAD_ENABLED`, default `false`) +
  `alertConsecutiveFailures` (`BACKUP_ALERT_CONSECUTIVE_FAILURES`, default
  `3`). Cover bằng `backup.config.test.ts` (+29 dòng).
- `packages/shared/src/backup.ts`: thêm type `BackupOffsiteEntry` +
  `BackupAlertState`, mở rộng `BackupStatusResponse`.
- Chưa wire vào `BackupService` runtime (xong ở Phase 3.2–3.5).

### Phase 3.2–3.5 — Backup verification + offsite upload runtime (`c0656c35`)
- `BackupService` verify hardening: hash digest compare, size guard,
  schema sanity check; structured `BackupAlertState` (consecutive failure
  counter, last failure reason, last verified at).
- Offsite upload: gated qua flag; ghi `BackupOffsiteEntry` per snapshot
  (bucket / path / hash / size / timestamp). Lỗi không crash backup
  primary path — chỉ tăng counter + log alert.
- Admin UI: `AdminBackupPanel.vue` thêm offsite section + alert badge.
  i18n VI/EN parity (12 key mới).
- Test mới: `backup.service.test.ts` (+329 dòng) +
  `admin-backup.controller.test.ts` (+12 dòng) +
  `AdminBackupPanel.test.ts` (+93 dòng).

### Phase 5 (QA-003) — Smoke flush auth rate-limit (`f6b3ea44`)
- `scripts/flush-auth-rate-limits.mjs`: refactor để vừa chạy CLI vừa
  expose `flushAuthRateLimits()` programmatic API.
- `scripts/smoke-auth.mjs`: wire flush trước khi smoke register flow.
- `scripts/smoke-all.mjs`: import flush helper trước aggregator.
- `apps/api/src/ops/flush-rate-limits.test.ts`: 221 dòng regression
  coverage (Redis keyspace match, partial flush no-op safe, env override).
- Resolve open issue QA-003 trong `docs/AI_HANDOFF_REPORT.md`.

### Phase 6 — NPC gift daily bucket UTC → ICT (`6574da19`)
- `npc-affinity.service.ts`: `getDailyGiftBucket()` từ
  `new Date().toISOString().slice(0, 10)` (UTC) → format ICT
  (`Asia/Ho_Chi_Minh`) parity với mission / daily-login reset.
- Test: `npc-affinity.service.test.ts` thêm assertion cross-day boundary
  (23:30 UTC = ICT 06:30 hôm sau → cùng-day ICT bucket cũ vẫn còn 30 phút).
- Resolve impl-note "NPC Gift daily bucket reset 07:00 ICT bất tiện"
  trong `docs/AI_HANDOFF_REPORT.md`.

### Phase 7 — Docs + final gate
Commit này: update `CONTINUE.md` + `docs/AI_HANDOFF_REPORT.md` với log đầy
đủ rồi mở PR.

---

## RISK NOTES

- **Feature flag gating**: cả 3 flag (`VISUAL_EFFECTS_ENABLED`,
  `AUCTION_HOUSE_ENABLED`, `STORY_V2_ENABLED`) fail-open khi store chưa
  hydrate hoặc fetch lỗi. Server `FEATURE_DISABLED` 503 vẫn là lớp cuối
  ngăn truy cập runtime — KHÔNG dựa duy nhất vào FE guard.
- **Backup offsite**: mặc định OFF (`BACKUP_OFFSITE_UPLOAD_ENABLED=false`).
  Khi bật, lỗi upload không crash backup primary — chỉ tăng
  `BackupAlertState.consecutiveFailures` + log alert. Admin phải config
  bucket env trước khi enable.
- **Pet combat bonus**: optional inject — nếu PetCombatModule chưa load,
  CombatService fallback skip bonus aggregation (không throw).
- **Stamina-full notification**: debounce qua InventoryService internal
  flag → chỉ trigger 1 lần per breach point, không spam khi player tick
  liên tục ở cap.
- **Auth hydration admin route**: QA-004 fix đã ship trong foundation
  commit (`e28f1e33` merged `main`). PR này KHÔNG đụng lại.
- **NPC gift timezone**: chuyển UTC → ICT có thể cho player claim gift
  thêm 1 lượt nếu hôm trước claim lúc UTC bucket gần 17:00 ICT. Gift tier
  nhỏ (< 200 linh thạch/lượt), KHÔNG vi phạm econ.

---

## TEST EVIDENCE (local)

| Workspace | Result |
|---|---|
| `pnpm --filter @xuantoi/shared build` | ✅ pass |
| `pnpm --filter @xuantoi/shared test` | ✅ 4169/4169 |
| `pnpm -C apps/api lint` | ✅ pass |
| `pnpm -C apps/api test` | ⏳ chạy với Postgres + Redis up (Phase 7) |
| `pnpm -C apps/web lint` | ✅ pass |
| `pnpm -C apps/web typecheck` | ✅ pass |
| `pnpm -C apps/web test` | ✅ 2486/2486 |
| Han gate `rg '[\x{4e00}-\x{9fff}]' apps/web/src` | ✅ 0 match |

---

## CỐ Ý KHÔNG LÀM (defer)

- Alchemy V2 (Phase 26.1).
- NPC Romance / Marriage Path (Phase 12.10.E).
- Arena V2 follow-up (season reward / Hall of Fame / ELO curve).
- Sect War foundation (Phase 29.1).
- Spirit Vein Territory (Phase 29.2).
- Admin Control Center V2 PR2-PR6 (player support / editor UI /
  LiveOpsSchedule versioning / anti-cheat actions / runbook).
- Real-time PvP.

---

## QUY TẮC CỨNG (đã tuân thủ)

- KHÔNG push thẳng `main`.
- KHÔNG mở PR mới — finalize 1 PR duy nhất trên branch hiện hành.
- KHÔNG disable / xoá test để pass. KHÔNG fake green.
- KHÔNG commit secret.
- KHÔNG bypass `ECONOMY_MODEL` invariant.
- KHÔNG grant Tiên Ngọc qua admin bypass.
- KHÔNG đổi Prisma schema / migration ngoài UNIQUE additive đã ship.
- KHÔNG phá i18n parity, KHÔNG thêm chữ Hán (`[\u4e00-\u9fff]`) vào
  `apps/web/src`, KHÔNG phá `data-testid`.
