# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo mục đích (state / vision / roadmap / economy / content / balance / live ops).

> **Cấu trúc post-compact 2026-05-05** (PR `docs(handoff): split archive section into ARCHIVE_HANDOFF.md để giảm token cost mỗi session`): 6 section live ở đầu file (~200 dòng) + Archive được TÁCH RA file riêng [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) giữ toàn bộ lịch sử (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan). Theo HANDOFF REPORT STRUCTURE RULE ở [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md): Executive Summary ≤ 30 dòng, Recent Changes 10 PR gần nhất, total file < 3000 dòng. **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần (không đọc mỗi session). **Không thông tin nào bị xoá** — chỉ tách file để giảm token/quota.

---

## 1. Current Executive Summary

- **Current `main` commit**: post PR #419 merged (Phase 11 nâng cao §5 PR3 FE — BreakthroughView `/breakthrough` view + Pinia store + api client + i18n + 48 web test). **In-flight this PR**: Phase 11 nâng cao §5 PR3 E2E — Playwright golden-path spec #20 cho `/breakthrough` flow (Small PR, FE-only). Adds `adminSeedBreakthroughPeak` helper (admin login + `POST /admin/users/:id/grant-exp` 200000 → auto-advance luyenkhi stage 1→9 + residual exp ≥ cost(9), reuse PR #383 admin seed harness) trong `apps/web/e2e/helpers.ts` + new spec (`breakthrough attempt → outcome banner + history row appended`) trong `golden.spec.ts`: register fresh char → seed peak → navigate `/breakthrough` → atPeak gate satisfied + history empty → click `breakthrough-attempt-btn` → wait outcome banner (`breakthrough-outcome-success` OR `-fail` prefix locator, RNG non-deterministic via Math.random) → verify transition `luyenkhi/9` + attemptIndex `#1` + breakdown summary visible → assert exactly 1 `breakthrough-history-row` → reload → outcome banner gone (session-only Pinia state) nhưng history row persist (server-authoritative `BreakthroughAttemptLog`). Server-authoritative invariant: spec KHÔNG mock RNG / KHÔNG bypass server — outcome + log đều round-trip qua `/character/breakthrough/attempt` + `/character/breakthrough/log`.
- **Current phase**: Phase 10 Content scale **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅ (catalog 11/11 + runtime persistence 10/10 + UI E2E spec #19 merged via #394). **Phase 11 nâng cao** (post-Phase-11 polish — 6 modules): §6 Balance dial **CLOSED** ✅ (PR #398). §3 Elemental Combat MVP **CLOSED** ✅ (PR #399). §2 Skill Ngũ Hành expansion **CLOSED** ✅ (PR #400). **Phase 11.6.C Spiritual Root × Tribulation element resist wire CLOSED** ✅ (PR #401). **Phase 11.1.E Cultivation Method element affinity wire CLOSED** ✅ (PR #405 backend + PR #408 FE badge). **Phase 11.6.D Talent passive element_resist wire CLOSED** ✅ (PR #409). **Phase 11.6.E Equipment elemental resist runtime CLOSED** ✅ (PR #411). **Phase 11.6.E FE tooltip render CLOSED** ✅ (PR #412). **Phase 11 nâng cao §5 PR1 CLOSED** ✅ (PR #413). **Phase 11 nâng cao §5 PR2 prep CLOSED** ✅ (PR #414). **Phase 11 nâng cao §5 PR2 wire CLOSED** ✅ (PR #415). **Phase 11 nâng cao §5 PR2 smoke negative-path CLOSED** ✅ (PR #416). **Phase 11 nâng cao §5 PR2 smoke RNG positive-path CLOSED** ✅ (PR #417). **Phase 11 nâng cao §5 PR3 backend prep CLOSED** ✅ (PR #418). **Phase 11 nâng cao §5 PR3 FE CLOSED** ✅ (PR #419 — BreakthroughView + Pinia store + i18n + 48 web test). **Phase 11 nâng cao §5 PR3 E2E IN-FLIGHT** (this PR — golden-path spec #20). Phase 12 World Map & Dungeon **OPEN** — Phase 12.1 catalog **CLOSED** via #397; Phase 12.2 DungeonTemplate/DungeonRun runtime is next sau §5 PR3 E2E land. Admin seed harness đầy đủ 8 endpoint. Smoke scripts **26 module** complete. Detail ở `## 3. Current Phase Status`.
- **Test baseline (post PR #419 merged + breakthrough E2E spec this PR)**: shared **1276/1276** (unchanged) + api **1813/1813** (unchanged — E2E spec không touch BE) + web **1082/1082** (unchanged — E2E spec ở `apps/web/e2e/golden.spec.ts` ngoài Vitest matrix, gated by `E2E_FULL=1`). E2E golden-path **20/20 spec** (19 baseline + this PR spec #20 breakthrough). 5 redis-dependent test (rate-limiter + health controller) cần Redis local — pass khi Redis container up. Smoke scripts **26 module** complete; `smoke:breakthrough` 34/34 OK deterministic. Detail ở `## 5. Tests`.
- **Open PR / pending branch**: 1 in-flight E2E Small PR (this PR — golden-path spec #20 breakthrough flow + `adminSeedBreakthroughPeak` helper). PR #419 + #418 + #417 + #416 + #415 + #414 + #413 + #412 + #411 + #410 đã merged. Older docs/audit in-flight chưa rebase — xem GitHub PR list ở `https://github.com/hoathienmenh-01/xuantoi/pulls`.
- **Known blocker live**: **0 Critical** hiện tại. **Medium còn open**: M7 CSP production deploy chưa test với CDN/asset domain khác, M10 Shop không có daily limit/rate-limit (closed beta acceptable). **Low còn open**: L1 (đã resolve PR F audit i18n nhưng remain identical en≡vi cho universal terms — đúng intent). Detail ở `## 4. Known Issues / Risks`.
- **Phase 9 readiness** (snapshot session 9r-9): **11/15 Done**, **3 Partial** (cultivation breakthrough end-to-end, mission claim flow, mail UI — mail UI partial gap closed by PR #391 mail claim end-to-end runtime smoke; daily-login partial gap closed by in-flight seedDailyLoginStreak smoke multi-day positive). Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) §"Phase 9 readiness audit".
- **Immediate next task** (3-5 ưu tiên cao nhất theo SESSION PR LIMIT + GOM TRƯỚC KHI TÁCH 4b — Medium PR > Hotfix > Large):
  1. **Phase 11 nâng cao §5 PR3 E2E this PR land** (in-flight) — golden-path spec #20 breakthrough flow + `adminSeedBreakthroughPeak` helper. Closes §5 PR3 chain.
  2. **Phase 12.2 DungeonTemplate + DungeonRun runtime** — Medium PR, Template C. Prisma model `DungeonTemplate` + `DungeonRun` + service `startRun`/`nextEncounter`/`claimRun` happy-path + Prisma migration. **Risk**: Prisma migration + new module.
  3. **smoke:daily-login multi-day positive** — Small PR, Template B. Cần admin advance-day hoặc set-streak (Prisma migration nhỏ thêm field hoặc service helper). Verify streak=7 reward = 100 LT delta + ledger DAILY_LOGIN_CLAIM.
  4. **Concurrency tests** (Low) — Inventory `Promise.all` race, Cultivation multi-instance lock, Chat Redis failover branch, Boss spawn cron auto, Realtime ban during connection.
- **Anti-duplicate guard** (per NEXT TASK AUTO-SELECTION rule): trước khi pick task, MUST `git fetch origin main && git log --oneline -15` đối chiếu commit message với keyword task — vd "smoke:daily-login positive", "Phase 12.2 DungeonTemplate", "admin advance-day". Match → SKIP, pick task khác.
- **Do NOT build yet** (anti-feature-creep): Real-time PvP (Phase 14), party/co-op dungeon (Phase 12 — wait for Phase 11 ≥ 95%), pet/wife gacha (Phase 16), voice chat, video streaming. Full list ở [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). Detail đầy đủ từng PR (scope/files/tests/risk note) ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| (in-flight) | `test(web/e2e): Phase 11 nâng cao §5 PR3 E2E — golden-path spec #20 breakthrough flow + adminSeedBreakthroughPeak helper (admin grant-exp 200000 peak seed → click attempt → outcome banner success/fail RNG branch + history row reload-persist)` | small E2E spec |
| [#419](https://github.com/hoathienmenh-01/xuantoi/pull/419) | `feat(web): Phase 11 nâng cao §5 PR3 FE — BreakthroughView UI history view consume GET /breakthrough/log + POST /breakthrough/attempt + Pinia store + i18n + 48 test` | medium FE feature |
| [#418](https://github.com/hoathienmenh-01/xuantoi/pull/418) | `feat(api): Phase 11 nâng cao §5 PR3 backend prep — GET /character/breakthrough/log endpoint + listBreakthroughAttemptLogs service + 4 test + smoke +3 step` | small backend endpoint |
| [#417](https://github.com/hoathienmenh-01/xuantoi/pull/417) | `test(smoke): smoke:breakthrough — RNG positive-path /breakthrough/attempt qua admin grant-exp peak seed (truc_co stage 9 → kim_dan or fail+tam_ma_light) +6 step` | smoke positive-path |
| [#416](https://github.com/hoathienmenh-01/xuantoi/pull/416) | `test(smoke): smoke:breakthrough — extend cover POST /character/breakthrough/attempt (Phase 11 nâng cao §5 PR2 RNG endpoint) +6 mirror negative-path step` | hotfix smoke extension |
| [#415](https://github.com/hoathienmenh-01/xuantoi/pull/415) | `feat(api): Phase 11 nâng cao §5 PR2 wire — CharacterService.attemptBreakthrough + POST /character/breakthrough/attempt + CultivationProcessor cultivationRateMul wire` | medium api wire + tests |
| [#414](https://github.com/hoathienmenh-01/xuantoi/pull/414) | `feat(shared,api): Phase 11 nâng cao §5 PR2 prep — tam_ma_light buff catalog + cultivation_rate_mul effect + evaluateBreakthroughOutcome + BreakthroughAttemptLog Prisma model` | medium shared+Prisma prep + tests |
| [#413](https://github.com/hoathienmenh-01/xuantoi/pull/413) | `feat(shared): Phase 11 nâng cao §5 PR1 — breakthrough chance formula (computeBreakthroughChance) + 4 balance dial mới` | shared helper + balance dials + tests |
| [#412](https://github.com/hoathienmenh-01/xuantoi/pull/412) | `feat(web): Phase 11.6.E FE — render bonuses.elementResist tooltip line trong InventoryView (huyen_giap_phong_<elem> armor)` | small FE feature + tests + i18n |
| [#411](https://github.com/hoathienmenh-01/xuantoi/pull/411) | `feat(api,shared): Phase 11.6.E — Equipment elemental tribulation resist wire (huyen_giap_phong_<elem> armor + composer + InventoryService.equipElementResistMods + TribulationService 3-layer compose)` | medium feature + tests |
| [#410](https://github.com/hoathienmenh-01/xuantoi/pull/410) | `docs(handoff): split archive section into ARCHIVE_HANDOFF.md để giảm token cost mỗi session` | docs compact |


### PR #33 → #396 — tóm tắt theo phase

Mỗi phase 2-3 dòng tổng kết. Detail PR-by-PR ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Recent Changes Legacy / § Snapshots.

| Phase | PR range (~) | # PR | Tóm tắt |
|---|---|---|---|
| **0–8** Foundation | #1 → #32 | ~32 | Schema + auth + core gameplay: cultivation, combat, inventory, market, sect, chat, boss, admin, topup, giftcode, mail, mission, ledger, idempotency. **Done.** Full feature catalog ở `ARCHIVE_HANDOFF.md` § Completed Features (snapshot main @ 81706a9). |
| **9** Beta readiness | #33 → ~#220 | ~120 | Closed-beta polish (Phase 9.A→9.E sub-phases): smoke E2E expand 16 spec golden path, admin economy alerts thresholds, audit-ledger CLI `--json` flag, password reset email service, daily-login + giftcode race tests, web vitest UI atoms (MButton/MToast/SkeletonBlock), i18n parity, Settings logout-all M9 trade-off, profile rate-limiter PROFILE_RATE_LIMITER, MOD vs ADMIN guard split, +50 issues resolved (M6/M8/M9/M11 etc). **11/15 Done, 3 Partial** (cultivation breakthrough end-to-end, mission claim flow, mail UI — mail closed by PR #391). |
| **10** Content scale | ~#220 → ~#310 | ~50 | Boss tier 2/3 + dungeon expand + market matchmaking + economy stress + admin batch ops. **5/5 CLOSED.** All sub-tracks merged. |
| **11** Progression Depth | ~#310 → ~#370 | ~60 | Cultivation method / talent / spiritual root / skill mastery / tribulation / refine / achievement / alchemy / pets / cosmetics / titles. **catalog 11/11 + runtime 10/10 + UI tracks merged.** Phase 11.X UI E2E **UNGATED** post PR #389 admin seed harness extension. |
| **11.X** Smoke HTTP coverage | #371 → #385 | ~14 | 14 smoke HTTP scripts gameplay modules: auth, sect, market, achievement, mission, giftcode, mail, leaderboard, next-action, daily-login, skill, cultivation-method, spiritual-root, breakthrough, topup, cultivation, shop. Mỗi script ~13-17 step, deterministic 2 lần liên tiếp. **Done.** |
| **11.X** Smoke positive-path batch | #385 → #396 | ~12 | smoke positive-path qua admin seed harness (PR #383 grant-exp/grant-item/grant-spiritual-root + PR #389 grant-talent-point/set-realm/grant-currency + PR #395 grant-method + PR #396 seedDailyLoginStreak): inventory, skill book learn, spiritual-root reroll, skill upgrade-mastery, shop buy, mail claim, cultivation-method switch, daily-login multi-day. **Done.** |

---

## 3. Current Phase Status

| Phase | Title | Status | Note |
|---|---|---|---|
| 0–8 | Foundation: schema + auth + core gameplay (cultivation/combat/inventory/market/sect/chat/boss/admin/topup/giftcode/mail/mission) | **Done** ✅ | Full feature catalog ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Completed Features (snapshot main @ 81706a9). |
| 9 | Beta readiness (Phase 9.A→9.E sub-phases polish + smoke E2E + admin economy alerts + audit ledger CLI) | **11/15 Done, 3 Partial** | Partial: cultivation breakthrough end-to-end, mission claim flow, mail UI (mail gap closed by PR #391 mail claim runtime smoke). Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md). |
| 10 | Content scale (boss tier 2/3 + dungeon expand + market matchmaking + economy stress) | **5/5 CLOSED** ✅ | All sub-tracks merged. |
| 11 | Progression Depth (cultivation method / talent / spiritual root / skill mastery / tribulation / refine / achievement / alchemy / pets / cosmetics / titles) | **catalog 11/11 + runtime 10/10 + UI tracks merged** | Phase 11.X UI E2E **UNGATED** post PR #389 admin seed harness extension. |
| 11.X | UI E2E smoke Playwright (talent learn → cast → cooldown badge) | **Ready to start** | Cần `E2E_FULL=1` PG+Redis+API+Web stack. Foundation đủ. |
| 12 | Party / co-op dungeon | **Not started — Blocked** | Wait Phase 11 ≥ 95%. Catalog foundation per [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §12 entry criteria. |
| 13+ | Real-time PvP / pet gacha / voice / video streaming | **Not started** | Per LONG_TERM_ROADMAP §0 — explicitly DO NOT build yet. |

**Smoke coverage** (post PR #394, 25 module): admin (4 entry: BE seed-harness #383+#389+#394 + audit filter #382 + role/ban/topup/inventory/mail-broadcast/users-csv #377→#382), auth #384, achievement, beta, boss, breakthrough, chat, combat, cultivation-method #394 (positive), cultivation, daily-login, economy, giftcode, inventory #385, leaderboard, mail #391 (positive), market, mission, next-action, sect, shop #390 (positive), skill #390 (positive) #388 (skill book), spiritual-root #386 (positive), topup, ws.

**Positive-path coverage** post-#394: 8 module có cả negative + positive HTTP path coverage (skill, shop, mail, inventory, spiritual-root, breakthrough, auth, **cultivation-method**). Còn defer: daily-login multi-day positive — pending admin advance-day endpoint hoặc service helper extension.

---

## 4. Known Issues / Risks

### Live (Open) — cần action

| # | Severity | Issue | Status / Plan |
|---|---|---|---|
| M7 | Medium | CSP production-ready nhưng chưa test deploy với CDN/asset domain khác. | **Open** — khi deploy cần review `script-src`, `connect-src`. |
| M10 | Medium | Shop không có rate-limit + stock infinite + không daily limit. | **Open** — closed beta acceptable; sau beta thêm `dailyLimit` config. |

### Resolved (5 ví dụ gần nhất — full list ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md))

- ~~M9 Settings logout-all không bump `passwordVersion`~~ → Resolved PR #154/#155 (intentional trade-off documented `docs/SECURITY.md §1`, regression guard test trong `auth.service.test.ts`).
- ~~M11 `GET /character/profile/:id` không có rate-limit riêng~~ → Resolved PR #62 (`PROFILE_RATE_LIMITER`, 120 req/IP/15min).
- ~~M8 Admin guard MOD có quyền broad gần ADMIN~~ → Resolved PR E (`@RequireAdmin()` decorator + reflector trong AdminGuard, ADMIN-only cho grant/role-set/approve-topup/reject-topup/giftcode-create/giftcode-revoke/mail-send/mail-broadcast/boss-admin-spawn).
- ~~M6 LogsModule (G3 cũ) chưa build~~ → Resolved PR #88 BE + PR #91 FE (`/logs/me?type=currency|item&limit=20&cursor=<opaque>` keyset pagination + `ActivityView.vue` + 24 ledger reason i18n).
- ~~C-TSNARROW-RESOLVEFN main typecheck đỏ vue-tsc narrow `let resolveFn`~~ → Resolved session 9j task A (đổi pattern sang `resolveHolder: { current: ... }` ref-holder).

> **Full historical issues** (Critical / High / Medium / Low + tất cả ~50 entries Resolved) ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Section 16 Known Issues / Risks.

---

## 5. Tests

### Baseline (post PR #419 merged on main + Phase 11 nâng cao §5 PR3 E2E this PR)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **1813 vitest** | No delta — E2E-spec-only PR, không touch BE. Baseline carryover từ PR #418. |
| `packages/shared` | **1276 vitest** | No delta — E2E-spec-only PR. Baseline carryover từ PR #414. |
| `apps/web` | **1082 vitest** | No delta — E2E spec ở `apps/web/e2e/golden.spec.ts` ngoài Vitest matrix. Baseline carryover từ PR #419 (1034 → 1082 add 48 breakthrough FE test). |
| `apps/web/e2e` | **20/20 spec** (gated `E2E_FULL=1`) | +1 spec #20 this PR (`breakthrough attempt → outcome banner + history row appended (success/fail RNG branch) — Phase 11 nâng cao §5 PR3 UI E2E`) trên baseline 19 spec. CI `e2e-smoke` job chỉ chạy spec #1 AuthView smoke (không gate). Full suite chạy local với `E2E_FULL=1` + stack live. |
| **Total Vitest** | **4171 vitest** | All green trên main + this PR locally. |

### Smoke Scripts (Node 20 native fetch, không nằm trong CI matrix — manual verify qua `pnpm smoke:*`)

25 smoke scripts, ~15 step trung bình, 4 endpoint coverage trung bình per module. Yêu cầu local stack: `pnpm infra:up` (PG+Redis+MinIO+MailHog) + `pnpm --filter @xuantoi/api exec prisma migrate deploy` + `pnpm --filter @xuantoi/api run bootstrap` + `pnpm --filter @xuantoi/api dev`.

| Module | Script | Step count | Negative | Positive | Notes |
|---|---|---|---|---|---|
| achievement | `smoke:achievement` | ~12 | ✅ | ⚠️ partial | claim flow positive defer (cần admin grant achievement progress) |
| admin | `smoke:admin` | ~32 (5 entry) | ✅ | ✅ | full admin surface (role/ban/topup/inventory/mail-broadcast/users-csv/economy-audit) |
| auth | `smoke:auth` | 9 | ✅ | ✅ | PR #384 |
| beta | `smoke:beta` | ~10 | ✅ | — | beta gating endpoints |
| boss | `smoke:boss` | ~14 | ✅ | ⚠️ partial | boss attack positive defer (cần spawn admin) |
| **breakthrough** | `smoke:breakthrough` | **19** | ✅ | ✅ | **already DONE positive** (commit 1c1dcd2: admin grant-exp 200000 → realm auto-advance stage=9 + exp >= cost(9)=23613 → POST /character/breakthrough → 200 ok advance luyenkhi → truc_co stage=1 + exp deducted; doc cũ defer là stale) |
| chat | `smoke:chat` | ~12 | ✅ | ✅ | world/sect chat with rate limit verify |
| combat | `smoke:combat` | ~14 | ✅ | ⚠️ partial | encounter positive defer (cần grant-item dungeon key hoặc unlock) |
| **cultivation-method** | `smoke:cultivation-method` | **19** | ✅ | ✅ | **PR #394 positive (admin set-realm truc_co + grant-spiritual-root than/kim + grant-method cuu_cuc_kim_cuong_quyet → player equip + switch back to starter, idempotent grant-method P2002 catch)** |
| cultivation | `smoke:cultivation` | ~14 | ✅ | ✅ | toggle on/off + 30s tick verify |
| **daily-login** | `smoke:daily-login` | **26** | ✅ | ✅ | **in-flight PR positive** (admin seedDailyLoginStreak days=6 → audit verify + idempotent → player /me streak=6 → POST /claim newStreak=7 delta=100 → linhThach='100' anti-FE-grant) |
| economy | `smoke:economy` | ~14 | ✅ | ✅ | admin audit filter (PR #382) |
| giftcode | `smoke:giftcode` | ~14 | ✅ | ✅ | redeem flow + admin create/revoke |
| inventory | `smoke:inventory` | ~22 | ✅ | ✅ | PR #385 use/equip/unequip via admin grant-item |
| leaderboard | `smoke:leaderboard` | ~10 | ✅ | ✅ | top-50 by realm + power |
| **mail** | `smoke:mail` | **26** | ✅ | ✅ | **PR #391 positive (admin send 150 LT + huyet_chi_dan x2 → claim → ledger MAIL_CLAIM + ALREADY_CLAIMED retry)** |
| market | `smoke:market` | ~14 | ✅ | ✅ | post/buy/cancel + 5% fee |
| mission | `smoke:mission` | ~14 | ✅ | ✅ | track/claim flow |
| next-action | `smoke:next-action` | ~8 | ✅ | ✅ | derived suggestions verify |
| sect | `smoke:sect` | ~12 | ✅ | ✅ | join/leave/contribute |
| **shop** | `smoke:shop` | **21** | ✅ | ✅ | **PR #390 positive (admin grant 25 LT → buy huyet_chi_dan qty=1 + ledger SHOP_BUY)** |
| **skill** | `smoke:skill` | **33** | ✅ | ✅ | **PR #388 book learn + PR #390 upgrade-mastery (200 LT → kim_quang_tram L1→L2 + INSUFFICIENT_FUNDS rollback)** |
| spiritual-root | `smoke:spiritual-root` | 24 | ✅ | ✅ | PR #386 reroll positive (admin grant linh_can_dan x2) |
| topup | `smoke:topup` | ~14 | ✅ | ✅ | createOrder + admin approve/reject |
| ws | `smoke:ws` | ~6 | ✅ | ✅ | WS auth + emit verify |

### E2E (Playwright)

- `apps/web/e2e/golden.spec.ts` — 20 spec golden path (auth smoke + 19 full-stack spec gated `E2E_FULL=1`): register/onboard, cultivate toggle, daily-login claim, mission tabs, shop browse + buy LT + ledger, inventory empty + equip, chat WORLD, leaderboard, profile public, logout, mail UI, dungeon, settings, spiritual-root reroll, skill-book, talent catalog, **#19 talent learn → cast → cooldown badge** (`golden.spec.ts:756-845`), **#20 breakthrough attempt → outcome banner + history row reload-persist** (`golden.spec.ts:895-981` this PR).
- CI job `e2e-smoke` (matrix postgres+redis, build api+web, run `E2E_SMOKE=1`) — chạy spec #1 AuthView smoke mỗi PR.
- `E2E_FULL=1` gate cho 19 full-stack spec (talent learn→cast→cooldown #19, breakthrough attempt+history #20) **chưa wire CI** — runtime manual test với `pnpm infra:up` + `pnpm --filter @xuantoi/api dev` + `pnpm --filter @xuantoi/web dev`.

### Còn thiếu (priority order)

1. **smoke:daily-login multi-day positive** — defer pending admin endpoint extension. **breakthrough positive DONE qua scripts/smoke-breakthrough.mjs:411-513**, **cultivation-method DONE qua PR #394**.
2. **Phase 11.X UI E2E talent learn → cast → cooldown badge — DONE** qua `apps/web/e2e/golden.spec.ts:756-845` (#19, `E2E_FULL=1` gate test).
3. **Phase 11 nâng cao §5 PR3 UI E2E breakthrough — DONE** qua `apps/web/e2e/golden.spec.ts:895-981` (#20, `E2E_FULL=1` gate test) **this PR**.
4. **Concurrency tests**: `Inventory Promise.all race`, `Cultivation multi-instance lock`, `Chat Redis failover branch`, `Boss spawn cron auto`, `Realtime ban during connection` — Low priority.

---

## 6. Recommended Next Roadmap

Per [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) §SESSION PR LIMIT (1-3 PR/session) + §GOM TRƯỚC KHI TÁCH 4b (cùng loại → batch trong 1 PR). Ưu tiên Medium PR > Hotfix > Large.

### Top priority — next session

> **Stale-doc correction (2 lượt)**: roadmap cũ liệt kê §5 PR2 Tâm Ma debuff + §5 PR3 Breakthrough UI history là top priority — cả 2 đã DONE:
> - §5 PR2 Tâm Ma debuff wire DONE qua PR #415 (`CharacterService.attemptBreakthrough` + `POST /character/breakthrough/attempt` + `tam_ma_light` buff apply on fail).
> - §5 PR3 chain DONE qua PR #418 (BE log endpoint) + PR #419 (FE BreakthroughView) + this PR (E2E spec #20).
> - smoke:tribulation HTTP coverage DONE qua `scripts/smoke-tribulation.mjs` (935 dòng existing).
>
> Do đó top priority chuyển sang Phase 12.2 DungeonTemplate runtime + smoke:daily-login multi-day positive + concurrency tests.

1. **Phase 12.2 DungeonTemplate + DungeonRun runtime** — Medium PR, Template C (Prisma + service). Prisma model `DungeonTemplate` + `DungeonRun` + service `startRun`/`nextEncounter`/`claimRun` happy-path + Prisma migration. **Risk**: Prisma migration + new module — yêu cầu pre-migration backup snapshot + smoke:dungeon-template extend ≥ 12 step. Phase 12.1 catalog đã CLOSED qua #397 — runtime là next phase work.

2. **smoke:daily-login multi-day positive** — Small PR, Template B. Cần admin advance-day hoặc set-streak (Prisma migration nhỏ thêm field hoặc service helper). Verify streak=7 reward = 100 LT delta + ledger DAILY_LOGIN_CLAIM.

3. **Concurrency tests** — Small PR, Template B per scenario. Inventory `Promise.all` race (item dup), Cultivation multi-instance lock (Redis lease), Chat Redis failover branch, Boss spawn cron auto, Realtime ban during connection. Mỗi scenario ~50-150 LOC test. Có thể batch 2-3 cùng module nếu scope chặt.

4. **CSP production verify** (M7 medium issue) — Hotfix PR khi deploy production. Test `script-src` / `connect-src` với CDN domain khác (vd assets.xuantoi.io). Hiện chưa block beta.

5. **Shop daily limit + rate-limit per user** (M10 medium issue) — Medium PR, Template C. Add `dailyLimit` config trong shop catalog + rate-limit redis key `rl:shop-buy:<userId>`. Defer post-beta theo handoff §4.

### Backlog (low priority, an toàn nếu credit còn)

- **Concurrency tests** (Low): Inventory `Promise.all` race, Cultivation multi-instance lock, Chat Redis failover branch, Boss spawn cron auto, Realtime ban during connection.
- **Doc compaction maintenance** (Low): khi Recent Changes vượt 10 entry → đẩy entry cũ nhất xuống [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Recent Changes Legacy. Khi total file `AI_HANDOFF_REPORT.md` vượt 3000 dòng → compact thêm theo HANDOFF REPORT STRUCTURE RULE.
- **CSP production verify** (M7): khi deploy production cần test với CDN domain khác — review `script-src` / `connect-src`.
- **Shop daily limit** (M10): post-beta thêm `dailyLimit` config + rate-limit per user.

### Anti-feature-creep (DO NOT BUILD YET)

Per [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0:
- Real-time PvP (Phase 14)
- Party / co-op dungeon (Phase 12 — wait Phase 11 ≥ 95%)
- Pet / wife gacha (Phase 16)
- Voice chat
- Video streaming

---

## 7. Archive (đã tách file riêng)

Toàn bộ Archive (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan) đã được tách ra file riêng để giảm token cost mỗi session AI.

Chi tiết lịch sử PR #33→#396: xem [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md).
