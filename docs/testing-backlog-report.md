# Testing Backlog Report — Xuân Tôi

**Date**: 2026-05-13
**Repo state**: `main` @ `4771ba8` (post-merge: #557 → #566)
**Tester reporting**: Devin
**Session**: https://app.devin.ai/sessions/a92b9681f3db401d9a3ca573628e4c5b

> Mục tiêu: liệt kê **những gì còn phải test** (chia theo priority) sau khi đã hoàn thành QA regression PR #562 + fix PR #566. KHÔNG liệt kê lại những thứ đã PASS — chỉ tập trung vào gap.

---

## TL;DR — Top 3 việc cần làm ngay

1. **Re-run full regression trên `main` mới (`4771ba8`)** — regression QA gần nhất chạy trên commit `b1683e83` (trước khi PR #561 Social/Retention + PR #564 Phase 33 Story Expansion merge). Hiện chưa có ai chạy lại full automated + manual matrix sau merge.
2. **Manual test PR #561 (Phase 31 Social & Retention) trên main** — module Mentor / Returner / SystemGift / AdminMail / Mail extend chỉ có unit + integration test, **chưa có manual end-to-end + recording** từ góc nhìn người chơi và admin.
3. **Verify finding mới `INTERNAL_ERROR` ở `/api/admin/control-center/overview`** (phát hiện trong test PR #566 hôm nay) — cần xác định là dev-env Prisma connection-pool issue hay là regression server-side thực sự (root cause: stale API processes giữ postgres connections từ session cũ).

---

## Mục lục priority

- **P0 — Blocker beta**: gap có thể block closed beta nếu không clear.
- **P1 — High**: nên xong trước beta, hậu quả nếu không làm là UX/data risk.
- **P2 — Medium**: làm trong beta hoặc post-beta sớm.
- **P3 — Low / Nice-to-have**: post-beta polish.

---

## P0 — Blocker beta

### P0.1 — Full regression trên `main` mới `4771ba8` post-#561 + #564 + #566

**Tình trạng**: regression PR #562 chạy trên `b1683e83` (excluded #561 #564 #566).
**Phải test**:
- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` — full root recursive.
- [ ] `pnpm --filter @xuantoi/api prisma migrate deploy` — verify Phase 31 migration `20290101000000_phase_31_0_social_retention` applies clean.
- [ ] `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` — verify 23/23 spec vẫn xanh sau merge #561 + #564.
- [ ] Smoke matrix: `economy.mjs` + `combat.mjs` + `ws.mjs` + `admin.mjs` (sau khi Redis flush) — verify ledger / drop / chat / admin grant không regression.
**Pass criteria**: ≥ 9.5k vitest pass, 0 lint/typecheck error, build OK, E2E full 23/23, smoke economy 20/20.
**Owner**: QA Lead / Devin re-run.

### P0.2 — Phase 31 Social/Retention manual end-to-end QA (PR #561 đã merge nhưng chưa manual test)

**Tình trạng**: 4 module Mentor / Returner / SystemGift / AdminMail + Mail extend đã merge, chỉ có **unit + integration test**, chưa có user-perspective manual run + recording. Phase 31 hard cap (`tienNgoc=0` server-side cho mọi auto pipeline) chưa được verify bằng eye-test trên UI.
**Phải test (Manual + recording)**:
- [ ] **Mentor flow**:
  - [ ] Login user tier ≥ 9 (mentor candidate) → tab `/social/mentor` → register as mentor → verify cap 5 students/mentor.
  - [ ] Login user tier ≤ 6 (student candidate) → search mentor → request → mentor accept → CAS race-safe (test 2 mentor cùng accept 1 request — chỉ 1 thành công).
  - [ ] Verify tier gap ≥ 3 enforce server-side (tier 5 student vs tier 6 mentor → reject).
  - [ ] Verify forbidden reward + tier-clamp khi mentor grant.
- [ ] **Returner flow**:
  - [ ] Login user → set `lastSeenAt = now() - 8 days` qua admin → check `/social/returner` → resolve tier `SHORT` (inactiveDays ≥ 7).
  - [ ] Claim returner reward → verify idempotent per-day-per-tier (`buildReturnerCycleKey = userId:tier:YYYY-MM-DD` UTC).
  - [ ] Claim twice cùng ngày → reject `ALREADY_CLAIMED_TODAY`.
  - [ ] Verify reward filter forbidden item + tier-clamp ≤ playerTier.
- [ ] **System Gift flow**:
  - [ ] Admin tạo SystemGift với target rule `REALM_RANGE: 1–5` → fan-out → verify cap 50k targets.
  - [ ] Verify Mail row inserted cho mỗi target qua `MailService.sendToCharacter`.
  - [ ] Re-run gift cùng `giftKey` → UNIQUE `(giftKey, characterId)` skip duplicate.
  - [ ] Target rule edge case: `SECT_MEMBERS` (load test với 1 sect 1k+ members), `EVENT_PARTICIPANTS` (hợp lệ với event đang chạy).
- [ ] **Admin Mail flow**:
  - [ ] Admin send-one → AdminMailLog row tạo, preview hiển thị đúng before send.
  - [ ] Admin send-bulk (10 user) + send-global (all players) → audit log `recipientsSnapshot.slice(0,50)` cap.
  - [ ] Verify `tienNgoc = 0` hard cap trên admin grant (cố tình send mail với attachment `TIEN_NGOC=100` phải reject).
- [ ] **Mail extend flow**:
  - [ ] Claim-all 10+ mail → idempotent (re-call không double).
  - [ ] Soft-delete mail → `deletedAt` set, UI hide.
  - [ ] MailType enum filter: SYSTEM / ADMIN / REWARD / EVENT / MAINTENANCE / PURCHASE / SECT / FRIEND / RETURNER / PVP.
- [ ] **Mobile responsive 360px** cho `/social/mentor`, `/social/returner`, `/mail` extend.
- [ ] **i18n VI ↔ EN** trên tất cả Phase 31 view (không leak key).

**Pass criteria**: Tất cả flow trên không 500, không leak `tienNgoc > 0`, audit log có entry cho mọi admin action, UI render đúng VI/EN.

### P0.3 — Verify finding `INTERNAL_ERROR` ở `/api/admin/control-center/overview`

**Tình trạng**: Phát hiện trong test PR #566 hôm nay. Login admin → `/admin/control-center` load page (guard pass do PR #566 fix), nhưng tab Overview show `Tải dữ liệu thất bại (INTERNAL_ERROR)`. Server log: `PrismaClientInitializationError: Too many database connections opened: FATAL: sorry, too many clients already`.
**Root cause suspect**: Stale API processes từ prior dev sessions giữ postgres connection pool. **Có thể là dev-env hygiene, không phải bug production**. Cần verify.
**Phải test**:
- [ ] **Fresh env reproduce**: stop tất cả API process, `docker compose restart postgres`, start lại API single instance, login admin, navigate `/admin/control-center` → expect Overview load thành công với stats.
- [ ] **If reproduce trên fresh env**: là regression thực sự → investigate `AdminControlCenterService.getOverview()` query plan, có thể là N+1 connection leak.
- [ ] **CI verify**: kiểm tra E2E `golden.spec.ts` có spec touch admin control-center không. Nếu không có → add spec mới cover admin overview load.
- [ ] **Server log check**: trên staging/production, verify max postgres connection setting (`max_connections = 100` default) đủ cho prod load.

---

## P1 — High priority (nên xong trước open beta)

### P1.1 — PR #564 (Phase 33 Story Quest Expansion Quyển II–IV) manual test

**Tình trạng**: Merged vào main. Catalog thêm Quyển II/III/IV story chapter + NPC + quest. Hiện chỉ có shared catalog test, **chưa có manual playthrough** end-to-end story arc.
**Phải test**:
- [ ] Login player tier đủ để vào Quyển II (typically tier 4+) → start story chapter Ch9 → complete main quest → unlock branch → claim reward.
- [ ] Verify NPC affinity gate cho branch quest (BRANCH kind chỉ unlock qua NPC affinity).
- [ ] Verify reward không grant tier cao hơn `requiredRealmOrder` (cap enforcement).
- [ ] Verify duplicate claim fail (`QuestClaim` idempotent).
- [ ] Trial Tower (nếu có wire trong Phase 33) — chạy 5 floor, verify first-clear reward unique.
- [ ] i18n VI ↔ EN trên story dialogue (Quyển II/III/IV — chapter title, NPC name, quest description).

### P1.2 — Equipment / Pháp Bảo V2 manual UI test (chỉ catalog tested)

**Tình trạng**: Shared catalog + API service tests pass. **Manual UI flow chưa được walk through full**.
**Phải test**:
- [ ] **Equipment**: trang `/inventory` + drag-drop equip slot → verify 9 slot (WEAPON/HEAD/CHEST/...), tier 1–10 mapping với realm.
- [ ] **Cường hóa** (Phase 23.4 upgrade economy): material consume đúng, success rate visible, fail → safe-fallback giữ tier.
- [ ] **Khảm ngọc** (`character/gem.service`): inject ngọc vào slot, verify stat preview chuẩn.
- [ ] **Tẩy luyện**: re-roll bonus, verify ledger consume + ItemLedger qty delta.
- [ ] **Ghép phẩm**: PHAM → LINH → HUYEN → TIEN → THAN, verify cross-tier không cho (chỉ trong cùng `equipmentTier`).
- [ ] **Set bonus** (Phase 23.3): mặc 2/4/6 piece cùng setKey → verify bonus apply qua `equipment-resonance.service`.
- [ ] **Pháp Bảo Star-up + Awaken** (Phase 23.7): craft → equip → star-up → awaken, verify combat/cultivation stat cap không bypass.
- [ ] **Visual tier effect** (Phase 23.6): icon aura quality match phẩm cấp.
- [ ] **Mobile 360px**: trang `/inventory` không tràn ngang, drag-drop hoạt động trên touch.

### P1.3 — Trial Tower manual + dedicated runtime test

**Tình trạng**: QA report ghi "covered via shared catalog tests + api boss/dungeon tests; **no dedicated trial-tower service tests** beyond shared content. **Manual UI verification deferred**."
**Phải test**:
- [ ] Vào `/trial-tower` (nếu route tồn tại; xác nhận trong sidebar).
- [ ] Start floor 1 → fight → claim → progress floor 2.
- [ ] Verify daily attempt cap (typically 3/day).
- [ ] Verify first-clear reward idempotent + milestone reward unique.
- [ ] Verify realm/power gate cho floor cao.
- [ ] **Backend test add**: tạo `trial-tower.service.test.ts` cover claim idempotent + cap.

### P1.4 — Mobile responsive full sweep (chỉ spot-check trước đó)

**Tình trạng**: PR #562 manual QA chỉ spot-check `/pvp` ở 360×740 và visual inspect `/home /events /pvp /monetization`. **Chưa sweep toàn bộ 30+ view**.
**Phải test mobile 360px / 390px / 414px**:
- [ ] `/home`, `/auth`, `/onboarding`, `/inventory`, `/equipment`, `/cultivation`, `/cultivation-method-v2`, `/dungeon`, `/dungeon-run`, `/story-dungeons`, `/sect`, `/boss`, `/talents`, `/alchemy`, `/body-cultivation`, `/spiritual-root`, `/skill-book`, `/tribulation`, `/breakthrough`, `/achievements`, `/titles`, `/npcs`, `/quests`, `/social`, `/missions`, `/mail`, `/giftcode`, `/leaderboard`, `/topup`, `/monetization`, `/shop-packs`, `/cosmetics`, `/activity`, `/settings`, `/events`, `/admin`, `/admin/control-center`, `/admin/event-builder`, `/admin/pvp`.
- [ ] Verify: hamburger menu replace sidebar, không horizontal scroll body, CTA tappable ≥ 44px tap target, modal/confirm không overflow viewport.

### P1.5 — i18n VI/EN gap audit (post Phase 31 + 33)

**Tình trạng**: BETA_CHECKLIST.md ghi "EN gap audit: grep `t(` keys không có trong `en.json`" — chưa thực hiện. Phase 31 + Phase 33 thêm content mới có thể có missing EN.
**Phải test**:
- [ ] `grep -roh "t('[^']\+'" apps/web/src --include='*.vue' --include='*.ts' | sort -u > /tmp/keys.txt`.
- [ ] Compare vs `en.json` + `vi.json`, list missing keys.
- [ ] Toggle EN trên các view Phase 31 + 33 → screenshot leak (key hiện thẳng raw `t('something.untranslated')`).

### P1.6 — `QA-003` follow-up: smoke rate-limit flusher

**Tình trạng**: open. `scripts/smoke-*.mjs` share host IP, exhaust `AUTH_REGISTER` 5/IP/15min. Suggested fix: add `pnpm smoke:flush-rate-limits` CLI.
**Phải làm**:
- [ ] Implement `scripts/flush-auth-rate-limits.mjs` reuse `RATE_LIMIT_PATTERNS` từ `apps/web/e2e/helpers.ts`.
- [ ] Add script entry `"smoke:flush-rate-limits": "node scripts/flush-auth-rate-limits.mjs"` ở root `package.json`.
- [ ] Doc usage trong `docs/QA_CHECKLIST.md §A` + `docs/RUN_LOCAL.md`.

---

## P2 — Medium priority (làm trong beta)

### P2.1 — Concurrency / race condition stress tests

**Tình trạng**: Có unit test CAS race-safe (e.g. Mentor accept, LimitedShop purchase) nhưng **không có load test thực sự**.
**Phải test**:
- [ ] 100 user simultaneously claim 1 limited daily reward → verify chỉ N người (theo cap) thành công, không double-grant.
- [ ] 50 user concurrent equip cùng 1 item → verify chỉ owner pass, không duplicate.
- [ ] 100 chat msg/s từ 50 socket → verify rate-limit chat không crash, message order intact.
- [ ] Tool suggestion: `artillery`, `k6`, hoặc custom node script.

### P2.2 — WebSocket reconnect / disconnect edge cases

**Tình trạng**: Có `realtime.service.test.ts` 23 ✓ + `cookie auth` cover. Chưa test **rolling deploy / connection drop mid-tick**.
**Phải test**:
- [ ] Connect socket → kill API process → restart → verify client reconnect tự động trong ≤ 5s.
- [ ] Cultivate tick đang chạy → drop socket → verify EXP vẫn được lưu DB (BullMQ separate worker), reconnect xong client read state fresh.
- [ ] WS rate-limit khi mass-disconnect-reconnect: 50 socket connect/disconnect/connect trong 5s → verify không deny chính đáng connection.

### P2.3 — Anti-cheat anomaly classifier coverage

**Tình trạng**: 8 anomaly type defined trong `pvp.ts` + `classifyPvpAnomaly()`. Có shared test.
**Phải test**:
- [ ] Manual cheat scenario:
  - [ ] `PVP_POWER_JUMP_BEFORE_MATCH`: equip → unequip → equip cùng item 5 lần trong 30s before PvP queue → verify anomaly logged.
  - [ ] `ARENA_TARGET_FARMING`: challenge cùng target 6 lần (cap 5 same-target/day) → verify rejected + anomaly.
  - [ ] `SECT_WAR_SCORE_OUTLIER`: simulate score delta > 3 std dev → verify anomaly tag + admin invalidate option.
  - [ ] `SEASON_REWARD_DOUBLE_CLAIM`: claim season reward 2x → verify idempotent + anomaly.
- [ ] Verify `AdminInvalidateAudit` row tạo cho mỗi anomaly resolution.

### P2.4 — Backup / Restore drill

**Tình trạng**: BETA_CHECKLIST.md unticked. Chỉ có `pnpm infra:up` cho dev, **chưa có backup script + restore drill**.
**Phải test**:
- [ ] Implement `scripts/backup-db.sh` (pg_dump + gzip + S3 upload).
- [ ] Implement `scripts/restore-db.sh` (download + gunzip + psql restore).
- [ ] Drill: backup → wipe DB → restore → verify ledger sum + user count + character count match.
- [ ] Schedule daily backup cron trên staging.

### P2.5 — Sentry / error tracking + structured logs

**Tình trạng**: `SENTRY_DSN_API empty → Sentry disabled` (verified from API log today). BETA_CHECKLIST.md unticked.
**Phải làm**:
- [ ] Provision Sentry DSN (BE + FE) → store as secret.
- [ ] Wire `SENTRY_DSN_API` + `SENTRY_DSN_WEB` qua env.
- [ ] Trigger test error → verify event arrive Sentry dashboard.
- [ ] Add `pino` structured logger (BE) + ship to Loki / CloudWatch.

### P2.6 — Daily Login multi-day positive smoke

**Tình trạng**: BETA_CHECKLIST.md ghi "defer: daily-login multi-day positive — pending admin advance-day endpoint".
**Phải test**:
- [ ] Implement admin endpoint `POST /api/admin/dev/advance-time` (dev/staging only, behind feature flag).
- [ ] Smoke: claim day 1 → advance 24h → claim day 2 → ... → claim day 7 → verify reward escalate đúng catalog.

### P2.7 — Drop economy V2 production simulation

**Tình trạng**: Shared + smoke test cover invariant. **Chưa có long-running simulation** verify drop rate đúng catalog distribution.
**Phải test**:
- [ ] Simulate 10000 dungeon clear cho player tier 5 trên map tier 5 → verify drop rate match `dropEconomyCatalog` weighted distribution (chi-square test).
- [ ] Simulate 10000 farm map tier 1 cho player tier 7 → verify drop tier = T1 (không leak T7 item).
- [ ] Daily/weekly cap reached → verify drop fall back to consolation rewards.

---

## P3 — Low / Nice-to-have (post-beta polish)

### P3.1 — Build chunk size warning (`index-CasaaE4d.js` 2.37 MB raw, 431 KB gzip)

**Tình trạng**: Pre-existing chunking warning, không phải regression.
**Phải làm**:
- [ ] Vite manual chunk split: vendor / pinia / vue-i18n / charts vào separate chunk.
- [ ] Lazy-load admin views (chỉ admin user dùng) qua `defineAsyncComponent`.

### P3.2 — Performance: inventory với 1000+ item, aura/glow effect lag

**Tình trạng**: BETA_CHECKLIST scope. Chưa có lab test.
**Phải test**:
- [ ] Bootstrap test user với 1000 item qua admin grant → mở `/inventory` → measure scroll FPS với DevTools Performance tab.
- [ ] Mở 10 item có aura PHAM/LINH/HUYEN/TIEN/THAN simultaneous → verify no lag.

### P3.3 — Achievement / Title system gameplay flow

**Tình trạng**: BETA_CHECKLIST ghi "thành tựu mốc tiến độ. Có ledger reason `ACHIEVEMENT` placeholder, **chưa có gameplay flow**".
**Phải làm**:
- [ ] Phase X: implement achievement trigger detector (event-based).
- [ ] UI: `/achievements` tab show progress.

### P3.4 — Buff system (item + sect + event rate ×N)

**Tình trạng**: "đã có model field, chưa có gameplay flow".
**Phải làm**:
- [ ] Wire buff vào `cultivationRateForRealm` calculation.
- [ ] UI: buff icon trên topbar khi active.

### P3.5 — Refresh token revoke chain admin tab

**Tình trạng**: Có reuse-detection. Chưa expose admin tab.

### P3.6 — E2E_FULL wire vào CI matrix

**Tình trạng**: `E2E_FULL=1` 19 spec full-stack **chưa wire CI**. Manual chỉ.
**Phải làm**:
- [ ] `e2e-full.yml` workflow đã có (theo `QA_CHECKLIST.md §A`). Verify nó thực sự gắn vào path filter `apps/web/`, `apps/api/`, `packages/shared/`.
- [ ] Nếu chưa: add `E2E_FULL=1` step vào workflow.

---

## Bug findings outstanding (chưa fix)

### Open

| ID | Severity | Area | Status |
|---|---|---|---|
| QA-003 | medium | Smoke rate-limit | open — see P1.6 |
| **NEW** Overview INTERNAL_ERROR | unknown | `/api/admin/control-center/overview` | need-verification — see P0.3 |

### Fixed

| ID | Fixed in | Date |
|---|---|---|
| QA-001 | PR #562 | 2026-05-13 |
| QA-002 | PR #562 | 2026-05-13 |
| QA-004 | PR #566 | 2026-05-13 |

---

## Recommended next session

1. **Test session #1 (4-6h)**: chạy P0.1 (full regression `4771ba8`) + P0.3 (verify INTERNAL_ERROR fresh env). Cut 1 PR QA mới `test/full-regression-4771ba8` recording đầy đủ.
2. **Test session #2 (4-6h)**: chạy P0.2 (Phase 31 Social/Retention manual E2E + recording) + P1.1 (Phase 33 Story Quyển II–IV manual playthrough).
3. **Test session #3 (3-4h)**: P1.2 Equipment/Pháp Bảo manual + P1.3 Trial Tower + P1.4 mobile sweep.

Sau 3 session trên → 90% confidence ready for **closed beta 50 users**. Tiếp tục P2 trong beta, P3 post-beta.

---

## Notes

- **Không claim bất kỳ mục nào PASS trừ khi đã chạy thật + có evidence (recording / log / screenshot)**.
- **Không skip test cũ** để pass. Nếu test cũ fail post-merge → debug fix, không xóa.
- **Không gộp scope**. Mỗi P0 / P1 nên là 1 PR riêng theo `AI_WORKFLOW_RULES.md` SESSION PR LIMIT.
- Reference: `docs/full-project-regression-qa-report.md`, `docs/BETA_CHECKLIST.md`, `docs/QA_CHECKLIST.md`, `docs/AI_HANDOFF_REPORT.md`.
