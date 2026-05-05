# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo mục đích (state / vision / roadmap / economy / content / balance / live ops).

> **Cấu trúc post-compact 2026-05-05** (PR `docs(handoff): split archive section into ARCHIVE_HANDOFF.md để giảm token cost mỗi session`): 6 section live ở đầu file (~200 dòng) + Archive được TÁCH RA file riêng [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) giữ toàn bộ lịch sử (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan). Theo HANDOFF REPORT STRUCTURE RULE ở [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md): Executive Summary ≤ 30 dòng, Recent Changes 10 PR gần nhất, total file < 3000 dòng. **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần (không đọc mỗi session). **Không thông tin nào bị xoá** — chỉ tách file để giảm token/quota.

---

## 1. Current Executive Summary

- **Current `main` commit**: `e7bd6a7` post PR #415 merged (Phase 11 nâng cao §5 PR2 wire — `CharacterService.attemptBreakthrough(userId, rng?, now?, idempotencyKey?)` method + new endpoint `POST /character/breakthrough/attempt` + `CultivationProcessor.cultivationRateMul` wire ×0.7 sau talentExpMul). Pre-PR `32675b3` post #414 (Phase 11 nâng cao §5 PR2 prep — `tam_ma_light` buff catalog + `evaluateBreakthroughOutcome` + `BreakthroughAttemptLog` Prisma model). Pre-pre-PR `c98a465` post #413 (Phase 11 nâng cao §5 PR1 — `computeBreakthroughChance` formula). **In-flight this PR**: smoke gap fill — `scripts/smoke-breakthrough.mjs` extend từ 19 step → 25 step (+6 mirror negative-path) cover endpoint mới `/breakthrough/attempt`: 401 UNAUTH pre-register + 404 NO_CHARACTER pre-onboard + 409 NOT_AT_PEAK fresh char + state-unchanged anti-FE-self-grant verify + 409 NOT_AT_PEAK post-advance (truc_co stage 1) + 401 UNAUTH post-logout. Pure additive smoke; KHÔNG runtime/schema change. Verify peak gate share giữa `/breakthrough` (deterministic) và `/breakthrough/attempt` (RNG) — cùng `BreakthroughError` enum thrown.
- **Current phase**: Phase 10 Content scale **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅ (catalog 11/11 + runtime persistence 10/10 + UI E2E spec #19 merged via #394). **Phase 11 nâng cao** (post-Phase-11 polish — 6 modules theo `XuanToi_Phase11_NangCao_Report.docx`): §6 Balance dial registry **CLOSED** ✅ (PR #398). §3 Elemental Combat MVP **CLOSED** ✅ (PR #399). §2 Skill Ngũ Hành expansion **CLOSED** ✅ (PR #400). **Phase 11.6.C Spiritual Root × Tribulation element resist wire CLOSED** ✅ (PR #401). **Phase 11.1.E Cultivation Method element affinity wire CLOSED** ✅ (PR #405 backend + PR #408 FE badge). **Phase 11.6.D Talent passive element_resist wire CLOSED** ✅ (PR #409). **Phase 11.6.E Equipment elemental resist runtime CLOSED** ✅ (PR #411). **Phase 11.6.E FE tooltip render CLOSED** ✅ (PR #412). **Phase 11 nâng cao §5 PR1 CLOSED** ✅ (PR #413). **Phase 11 nâng cao §5 PR2 prep CLOSED** ✅ (PR #414). **Phase 11 nâng cao §5 PR2 wire CLOSED** ✅ (PR #415 — `CharacterService.attemptBreakthrough` method + `POST /character/breakthrough/attempt` endpoint + `CultivationProcessor.cultivationRateMul` wire). **Phase 11 nâng cao §5 PR2 smoke gap IN-FLIGHT** (this PR — extend `smoke:breakthrough` cover endpoint mới `/breakthrough/attempt` 6 mirror negative-path). Phase 12 World Map & Dungeon **OPEN** — Phase 12.1 catalog **CLOSED** via #397; Phase 12.2 DungeonTemplate/DungeonRun runtime is next. Admin seed harness đầy đủ 8 endpoint. Smoke scripts **26 module** complete. Detail ở `## 3. Current Phase Status`.
- **Test baseline (post PR #415 merged + smoke extension this PR)**: shared **1276/1276** (unchanged) + api **1809/1809** (unchanged — chat.service.test.ts:134 rate-limit timing flake passes in isolation, không liên quan smoke change) + web **1034/1034** (unchanged — không touch FE). 5 redis-dependent test (rate-limiter + health controller) cần Redis local — pass khi Redis container up. Smoke scripts **26 module** complete; `smoke:breakthrough` 25/25 OK (19 → 25 step). Detail ở `## 5. Tests`.
- **Open PR / pending branch**: 1 in-flight smoke gap PR (this PR — `scripts/smoke-breakthrough.mjs` only). PR #415 + #414 + #413 + #412 + #411 + #410 + #409 + #408 + #407 + #406 đã merged. Older docs/audit in-flight (session 5/6 + 5/7) chưa rebase — xem GitHub PR list ở `https://github.com/hoathienmenh-01/xuantoi/pulls`.
- **Known blocker live**: **0 Critical** hiện tại. **Medium còn open**: M7 CSP production deploy chưa test với CDN/asset domain khác, M10 Shop không có daily limit/rate-limit (closed beta acceptable). **Low còn open**: L1 (đã resolve PR F audit i18n nhưng remain identical en≡vi cho universal terms — đúng intent). Detail ở `## 4. Known Issues / Risks`.
- **Phase 9 readiness** (snapshot session 9r-9): **11/15 Done**, **3 Partial** (cultivation breakthrough end-to-end, mission claim flow, mail UI — mail UI partial gap closed by PR #391 mail claim end-to-end runtime smoke; daily-login partial gap closed by in-flight seedDailyLoginStreak smoke multi-day positive). Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) §"Phase 9 readiness audit".
- **Immediate next task** (3-5 ưu tiên cao nhất theo SESSION PR LIMIT + GOM TRƯỚC KHI TÁCH 4b — Medium PR > Hotfix > Large):
  1. **Phase 11 nâng cao §5 PR2 smoke gap this PR land** (in-flight) — extend `smoke:breakthrough` cover endpoint mới `/breakthrough/attempt` 6 mirror negative-path step; verify peak gate share + state-unchanged anti-FE-self-grant.
  2. **Phase 11 nâng cao §5 PR3 — Breakthrough UI history** — Medium PR, Template B. Cultivation view → "Đột phá" button toggle giữa endpoint cũ/mới (RNG-attempt mode) + chance breakdown tooltip + history list từ `BreakthroughAttemptLog`. E2E spec verify success/fail/Tâm Ma debuff visible.
  3. **Phase 11 nâng cao §5 PR2 RNG positive-path smoke** — Small PR. Sau peak admin grant-exp seed, POST `/breakthrough/attempt` verify shape `{success, breakdown.{baseChance,...,finalChance}, rngRoll∈[0,1), attemptIndex≥1, debuff:{applied, key, expiresAt}}`. Branch theo outcome — fail: assert char unchanged + tam_ma_light buff applied; success: assert char advanced + debuff.applied=false. Optional: `BreakthroughAttemptLog` row count via admin audit.
  4. **Phase 12.2 DungeonTemplate + DungeonRun runtime** — Medium PR, Template C. Prisma model `DungeonTemplate` + `DungeonRun` + service `startRun`/`nextEncounter`/`claimRun` happy-path + Prisma migration. **Risk**: Prisma migration + new module.
- **Anti-duplicate guard** (per NEXT TASK AUTO-SELECTION rule): trước khi pick task, MUST `git fetch origin main && git log --oneline -15` đối chiếu commit message với keyword task — vd "smoke:cultivation-method positive", "Phase 11.X E2E", "admin seed harness". Match → SKIP, pick task khác.
- **Do NOT build yet** (anti-feature-creep): Real-time PvP (Phase 14), party/co-op dungeon (Phase 12 — wait for Phase 11 ≥ 95%), pet/wife gacha (Phase 16), voice chat, video streaming. Full list ở [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). Detail đầy đủ từng PR (scope/files/tests/risk note) ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| (in-flight) | `test(smoke): smoke:breakthrough — extend cover POST /character/breakthrough/attempt (Phase 11 nâng cao §5 PR2 RNG endpoint) +6 mirror negative-path step` | hotfix smoke extension |
| [#415](https://github.com/hoathienmenh-01/xuantoi/pull/415) | `feat(api): Phase 11 nâng cao §5 PR2 wire — CharacterService.attemptBreakthrough + POST /character/breakthrough/attempt + CultivationProcessor cultivationRateMul wire` | medium api wire + tests |
| [#414](https://github.com/hoathienmenh-01/xuantoi/pull/414) | `feat(shared,api): Phase 11 nâng cao §5 PR2 prep — tam_ma_light buff catalog + cultivation_rate_mul effect + evaluateBreakthroughOutcome + BreakthroughAttemptLog Prisma model` | medium shared+Prisma prep + tests |
| [#413](https://github.com/hoathienmenh-01/xuantoi/pull/413) | `feat(shared): Phase 11 nâng cao §5 PR1 — breakthrough chance formula (computeBreakthroughChance) + 4 balance dial mới` | shared helper + balance dials + tests |
| [#412](https://github.com/hoathienmenh-01/xuantoi/pull/412) | `feat(web): Phase 11.6.E FE — render bonuses.elementResist tooltip line trong InventoryView (huyen_giap_phong_<elem> armor)` | small FE feature + tests + i18n |
| [#411](https://github.com/hoathienmenh-01/xuantoi/pull/411) | `feat(api,shared): Phase 11.6.E — Equipment elemental tribulation resist wire (huyen_giap_phong_<elem> armor + composer + InventoryService.equipElementResistMods + TribulationService 3-layer compose)` | medium feature + tests |
| [#410](https://github.com/hoathienmenh-01/xuantoi/pull/410) | `docs(handoff): split archive section into ARCHIVE_HANDOFF.md để giảm token cost mỗi session` | docs compact |
| [#409](https://github.com/hoathienmenh-01/xuantoi/pull/409) | `feat(api,shared,web): Phase 11.6.D — Talent passive element_resist wire vào TribulationService + 5 talent_*_thien_giap catalog` | medium feature + tests |
| [#408](https://github.com/hoathienmenh-01/xuantoi/pull/408) | `feat(web): Phase 11.1.E FE — render +10%/+5% Method element affinity badge trên CultivationMethodView` | small FE feature + tests + i18n |
| [#407](https://github.com/hoathienmenh-01/xuantoi/pull/407) | `ci(api,web): dập 2 text-level warning — eslint typeless + Vue router-link stubs` | hotfix CI/test infra |
| [#406](https://github.com/hoathienmenh-01/xuantoi/pull/406) | `ci(workflows): bump 5 GitHub Actions @v4 → @v5 (Node 24 runtime)` | hotfix CI workflow |


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

### Baseline (post PR #412 merged on main + Phase 11 nâng cao §5 PR1 this PR)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **1812 vitest** | No delta — shared-only PR, không API thay đổi. Baseline carryover từ PR #411. |
| `packages/shared` | **1251 vitest** | +34 Phase 11 nâng cao §5 PR1 this PR (`breakthrough-chance.test.ts` 33 spec gate NOT_AT_PEAK / INSUFFICIENT_EXP / OK + base + root-purity bonus monotonic + method-affinity primary/secondary/no-match + item-clamp [0..MAX] + final clamp [MIN..MAX] + composability audit + `balance-dials.test.ts` 56→59 tests +2 BREAKTHROUGH ordering & envelope + +1 ratio range) trên baseline 1217. |
| `apps/web` | **1034 vitest** | No delta — shared-only PR. Baseline carryover từ PR #412. |
| **Total** | **4097 vitest** | All green trên main + this PR locally. |

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

- `apps/web/e2e/golden.spec.ts` — 16 spec golden path (register/onboard, mission VN tz, shop buy + ledger, settings change-password + logout-all, profile public, admin boss spawn, inventory↔ledger, dungeon, mail UI, settings).
- CI job `e2e-smoke` (matrix postgres+redis, build api+web, run `E2E_SMOKE=1`) — chạy mỗi PR.
- `E2E_FULL=1` gate cho full Phase 11.X UI E2E (talent learn → cast → cooldown) **chưa wire CI** — runtime manual test.

### Còn thiếu (priority order)

1. **Phase 11 nâng cao §5 PR2 — Tâm Ma debuff wire** vào BreakthroughService — top priority next (consume `computeBreakthroughChance` shared formula đã land).
2. **Smoke positive-path** cho daily-login multi-day — defer pending admin endpoint extension. **breakthrough positive DONE qua scripts/smoke-breakthrough.mjs:411-513**, **cultivation-method DONE qua PR #394**.
3. **Phase 11.X UI E2E talent learn → cast → cooldown badge — DONE** qua `apps/web/e2e/golden.spec.ts:754-843` (`E2E_FULL=1` gate test).
4. **Concurrency tests**: `Inventory Promise.all race`, `Cultivation multi-instance lock`, `Chat Redis failover branch`, `Boss spawn cron auto`, `Realtime ban during connection` — Low priority.

---

## 6. Recommended Next Roadmap

Per [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) §SESSION PR LIMIT (1-3 PR/session) + §GOM TRƯỚC KHI TÁCH 4b (cùng loại → batch trong 1 PR). Ưu tiên Medium PR > Hotfix > Large.

### Top priority — next session

> **Stale-doc correction**: roadmap cũ list "Phase 11.X UI E2E talent learn→cast→cooldown" + "smoke:breakthrough positive" là top priority — nhưng cả 2 đã DONE từ PR cũ:
> - `apps/web/e2e/golden.spec.ts:754-843` (test `talent learn → cast (combat) → cooldown badge — full Phase 11.X UI E2E`) covers full flow.
> - `scripts/smoke-breakthrough.mjs:411-513` (steps 11-19 admin grant-exp 200000 → advance stage 9 + cost → POST /character/breakthrough → truc_co stage=1).
>
> Do đó top priority chuyển sang Phase 11 nâng cao §5 chain (Đột phá nâng cao + Tâm Ma).

1. **Phase 11 nâng cao §5 PR2 — Tâm Ma debuff wire** — Medium PR, Template C (Prisma migration + service). Wire `BreakthroughService.attempt()` consume `computeBreakthroughChance` (this PR) + deterministic RNG (per-character seed) → success advance realm; fail apply `tam_ma_light` buff (`BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC=300`s + `BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY=0.7` cultivation rate). New Prisma migration `BreakthroughAttemptLog` + `Buff` extension. Idempotency key per attempt. Anti-FE-self-grant: KHÔNG để FE quyết success/fail.

2. **Phase 11 nâng cao §5 PR3 — Breakthrough UI history** — Medium PR, Template B (FE + E2E). Cultivation view → "Đột phá" button + chance breakdown tooltip (display `computeBreakthroughChance` breakdown từ /character/breakthrough/preview endpoint) + history list từ `BreakthroughAttemptLog`. E2E spec verify success/fail/Tâm Ma debuff visible, history reflect last attempt.

3. **smoke:tribulation HTTP coverage** — Small PR, Template B. 19-step negative-path smoke cho `POST /api/character/tribulation` + `GET /api/character/tribulation/log` mirror pattern `smoke:breakthrough`. KHÔNG cần admin seed (gate fail trước khi simulation). Verify post-fail state immutable (anti-FE-self-grant).

4. **smoke:daily-login multi-day positive** — Small PR, Template B. Cần admin advance-day hoặc set-streak (Prisma migration nhỏ thêm field hoặc service helper). Verify streak=7 reward = 100 LT delta + ledger DAILY_LOGIN_CLAIM.

5. **Phase 12.2 DungeonTemplate + DungeonRun runtime** — Medium PR, Template C (Prisma + service). Prisma model `DungeonTemplate` + `DungeonRun` + service `startRun`/`nextEncounter`/`claimRun` happy-path + Prisma migration. **Risk**: Prisma migration + new module.

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
