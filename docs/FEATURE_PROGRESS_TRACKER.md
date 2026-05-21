# Xuân Tôi — Feature Progress Tracker

## Purpose

File này dùng để theo dõi các chức năng cần phát triển/hoàn thiện. AI/dev sau mỗi PR phải cập nhật file này để người sau biết việc gì đã xong và việc gì làm tiếp.

## Update Rules

- Cập nhật file này trong mọi PR có thay đổi feature, UX, gameplay, test, smoke, admin, liveops hoặc docs roadmap.
- Khi bắt đầu làm PR: đổi task từ TODO sang IN_PROGRESS.
- Khi PR xong/merged: đổi task sang DONE, ghi PR number/branch/commit nếu biết.
- Nếu task hoàn thành một phần (hết scope PR nhưng còn task con chưa xong): đổi sang PARTIAL, liệt kê phần còn lại trong Done Criteria hoặc Note.
- Nếu không làm được: đổi sang BLOCKED và ghi lý do.
- Nếu task không nên làm nữa: đổi sang DEFERRED và ghi lý do.
- Sau khi hoàn thành một task, chọn task TODO ưu tiên cao nhất tiếp theo.
- Không xóa task cũ; chỉ chuyển xuống phần Completed nếu quá dài.

## Status Legend

| Status | Meaning |
|---|---|
| TODO | Chưa làm |
| IN_PROGRESS | Đang làm |
| PARTIAL | Hoàn thành một phần — còn task con chưa xong |
| DONE | Đã xong |
| BLOCKED | Bị chặn |
| DEFERRED | Hoãn/chưa nên làm |

## Priority Queue

| Rank | Task / PR | Status | Why It Matters | Scope | Main Files / Modules | Done Criteria | Last Updated |
|---|---|---|---|---|---|---|---|
| 1 | Daily Loop First Session Polish | DONE | New players need a clear first-session path; this is the highest-impact beta polish. | Improve priority, copy, reward hints, completion states, and CTAs on home/daily loop. | `DailyLoopPanel.vue`, `HomeView.vue`, `NextActionPanel.vue`, optional `player-dashboard` | Fresh character sees 3-5 best actions with route, state, and reward hint; completed actions de-prioritized. | 2026-05-19 |
| 2 | Equipment Flow Cleanup | DONE | Equipment is core progression, but the current path is split across inventory/equipment/upgrade surfaces. | Make equip/unequip/upgrade entry points coherent. | `EquipmentView.vue`, `InventoryView.vue`, `EquipmentUpgradePanel.vue`, `apps/web/src/api/inventory.ts` | Player can understand equipped slots, available gear, unequip, and upgrade route from one flow. | 2026-05-19 |
| 3 | Core Loop Smoke Proof Pack | DONE | Beta needs proof that the core progression loop works end-to-end. | Add positive smoke for breakthrough success and mission claim; optionally spiritual-root reroll if seed exists. | `scripts/smoke-*.mjs`, `breakthrough`, `mission`, `admin`, docs checklist | Smoke passes for breakthrough success and mission claim with no duplicate reward. | 2026-05-19 |
| 4 | Combat Entry Consolidation | DONE | Combat has several entry routes and can confuse players. | Route players from combat hub to the best available combat action. | `CombatHubView.vue`, `DungeonView.vue`, `DungeonRunView.vue`, router | One obvious combat CTA for fresh and returning players; no broken route loops. | 2026-05-19 |
| 5 | Quest/Mission/Story Labeling Polish | DONE | Players need to understand mission vs quest vs story progression. | Clarify labels, tabs, status, and CTAs. | `QuestView.vue`, `MissionView.vue`, `StoryV2View.vue`, i18n | Each surface explains its role through labels and status without long tutorial text. | 2026-05-19 |
| 6 | Boss Notification Integration | DONE | Active bosses are strong daily-return content but need visibility. | Wire active boss cues into notifications/daily loop where backend supports it. | `boss`, `notification`, `web-push`, `DailyLoopPanel.vue` | Active boss appears in daily loop/notification with correct route and safe fallback. | 2026-05-19 |
| 7 | Party Membership / Invite Polish | DONE | Party/co-op systems exist but need clearer social entry. | Improve create/invite/member state and co-op entry gating. | `party`, `PartyHubView.vue`, `PartyPanel.vue` | Player can create/join/invite or understand why unavailable; co-op routes respect party state. | 2026-05-19 |
| 8 | Admin Reload Guard Fix | DONE | Admin direct reload is a known UX bug for beta operators. | Ensure auth hydrate finishes before admin role redirect. | `AdminControlCenterView.vue`, auth store/router guard | Direct reload of `/admin/control-center` works for admin and still blocks non-admin. | 2026-05-19 |
| 9 | Beta Checklist Refresh | DONE | Current beta docs are partially stale versus code. | Sync beta/QA docs with current code and tracker. | `docs/BETA_CHECKLIST.md`, `docs/QA_CHECKLIST.md`, `docs/FEATURE_AUDIT_AND_ROADMAP.md`, this file | Checklist reflects current DONE/PARTIAL/DEFERRED state and next smoke gaps. | 2026-05-19 |
| 10 | Mobile Top Routes QA Pass | DONE | Closed beta users are likely mobile-heavy. | QA top routes on mobile and fix obvious layout blockers. | App shell, `/home`, `/combat`, `/equipment`, `/missions`, `/inventory`, `/mail`, `/admin` | Top routes are usable at common mobile widths; issues documented or fixed. | 2026-05-19 |
| 11 | Production Ops Polish | DONE | Ops infra exists but restore drill, operator runbook, and drill tracking gaps remain. | Restore drill script, runbook enhancement, drill log, smoke integration. | `scripts/restore-drill.mjs`, `docs/RUNBOOK.md`, `docs/BACKUP_RESTORE.md`, `scripts/smoke-all.mjs` | Restore drill passes end-to-end; runbook has drill procedure + pre-deploy checklist; drill log template exists. | 2026-05-19 |
| 12 | Market V2 Player UX Polish | DONE | Market V2 (Auction House + Claim Box) is functional but utilitarian — raw table layout, no time remaining, no status badges. | Card layout, time remaining, status badges, role hint, cross-nav, better empty states, i18n keys. | `MarketV2View.vue`, `vi.json`, `en.json`, `MarketV2View.test.ts` | Card layout with time remaining + status badges; role hint + cross-nav; claim box with source descriptions; 7/7 tests pass. | 2026-05-19 |
| 13 | Admin Control Center Polish | DONE | Admin CC is functional but utilitarian — no luxury hero, no role hint, no cross-navigation, plain stat cards. | XTLuxHero, role hint, cross-nav, overview stat color coding, data-testid, XTPullRefresh. | `AdminControlCenterView.vue`, `vi.json`, `en.json`, `AdminControlCenterView.test.ts` | Hero + role hint + cross-nav rendered; overview stats color-coded; data-testid on all key elements; 10/10 tests pass. | 2026-05-19 |
| 14 | Co-op & Social Views Polish | DONE | Party Dungeon, Co-op Boss, Sect, Tribulation all have XTLuxHero but lack role hint + cross-navigation — inconsistent with every other polished view. | Add roleHint + crossNav to all 4 views; i18n parity; fix data-testid; update tests. | `PartyDungeonView.vue`, `CoopBossView.vue`, `SectView.vue`, `TribulationView.vue`, `vi.json`, `en.json`, 4 test files | Each view has role hint + cross-nav rendered; i18n keys in vi+en; data-testid on all key elements; all tests pass. | 2026-05-19 |
| 15 | Views UX Polish Pack | DONE | 12 views still missing roleHint + crossNav; 3 also missing XTLuxHero. All other polished views have this pattern. | Add XTLuxHero (3 views), roleHint + crossNav (12 views), i18n parity, update tests. | `AlchemyView`, `BreakthroughView`, `DungeonView`, `SpiritualRootView`, `BodyCultivationView`, `DungeonRunView`, `BossView`, `BossHubView`, `InventoryView`, `CharacterView`, `AchievementView`, `ArenaView`, `vi.json`, `en.json`, 12 test files | Each view has XTLuxHero + roleHint + crossNav; i18n keys in vi+en; 245 test files / 2647 tests pass. | 2026-05-19 |
| 16 | Sect & Market Positive-Path Smoke | DONE | Existing sect/market smoke only cover negative paths. Positive paths (sect contribute, market post/buy/cancel) need admin seed endpoints to verify end-to-end happy path. | Add positive-path smoke scripts using admin grant-currency + grant-item seed. Sect: contribute + join. Market: post + buy + cancel + anti-FE-self-grant. | `scripts/smoke-sect-positive.mjs`, `scripts/smoke-market-positive.mjs`, `smoke-all.mjs`, `package.json` | Both scripts pass with 0 failures; anti-FE-self-grant invariants verified; added to smoke-all as opt-in. | 2026-05-19 |
| 17 | Cross-Navigation Polish Pack | DONE | 6 player-facing views (Market, Social, Mail, Leaderboard, SkillBook, Loadout) missing roleHint + crossNav — inconsistent with all other polished views. | Add roleHint + crossNav to all 6 views; i18n parity vi+en; update tests. | `MarketView.vue`, `SocialView.vue`, `MailView.vue`, `LeaderboardView.vue`, `SkillBookView.vue`, `LoadoutView.vue`, `vi.json`, `en.json`, 6 test files | Each view has roleHint + crossNav rendered; i18n keys in vi+en; all tests pass. | 2026-05-19 |
| 18 | UX Polish Pack — Batch 1 | DONE | 40 remaining views missing roleHint + crossNav. After tasks #14, #15, #17, these are the last batch to reach 100% cross-nav coverage. | Add roleHint + crossNav to all 40 views; i18n parity vi+en (40 namespaces); fix namespace mismatches (cosmetics, dacQuyen, etc.); fix GiftCodeView test selector; update tests. | 40 view files, `vi.json`, `en.json`, `GiftCodeView.test.ts` | All 40 views have roleHint + crossNav; i18n keys in 40 namespaces vi+en; 246 test files / 2659 tests pass. | 2026-05-19 |
| 19 | Market V2 Abuse Workflow | DONE | Market V2 anomaly types defined in shared + admin list/resolve endpoints exist, but no code actually detects + logs anomalies during auction lifecycle. | Wire anomaly detection into AuctionService: PRICE_TOO_LOW/HIGH on create, LARGE_VALUE_TRANSFER on bid, EXCESSIVE_CANCEL_RELIST on cancel, RAPID_RESALE on finalize. | `auction.service.ts`, `market-v2.service.test.ts` | Anomaly records created for each detection scenario; 4 new tests pass; typecheck + lint + build clean. | 2026-05-19 |
| 20 | Content Depth — Farm Map Expansion | DONE | Khu 4-9 only had 1 farm map each (placeholder). Need 3 maps per khu for consistent world content depth. | Add 12 new farm maps (2 per khu for Khu 4-9). Khu 4-6 enabled with full monster pools; Khu 7-8 enabled with monsters; Khu 9 disabled placeholder (no Hoá Thần monsters yet). | `packages/shared/src/farm-maps.ts`, `packages/shared/src/farm-maps.test.ts` | All 9 regions have ≥ 3 farm maps; 27 total maps; Khu 4-6 + 7-8 enabled with monster pools; 148 test files / 4178 tests pass. | 2026-05-20 |
| 21 | Content Depth — Monster Catalog for Cửu La Điện | DONE | Khu 9 (Cửu La Điện) farm maps were disabled — no Hoá Thần-tier monsters existed. | Add 4 monsters (cuu_la_ma_quan, cuu_la_tam_ma_binh, cuu_la_dao_anh, cuu_la_thien_de_an) with regionKey cuu_la_dien. Enable 3 farm maps with monster pools. Update cuu_la_dien dungeon to use new monsters. | `packages/shared/src/combat.ts`, `packages/shared/src/farm-maps.ts` | 4 new monsters in combat.ts; 3 cuu_la_dien farm maps enabled with pools; dungeon cuu_la_dien updated; typecheck + lint + build + tests pass. | 2026-05-20 |
| 22 | XTLuxHero for Remaining Views | DONE | 6 player-facing views still missing XTLuxHero + roleHint + crossNav — inconsistent with all other polished views. | Add XTLuxHero + roleHint + crossNav to ArtifactV2View, CultivationMethodView, EventsView, InventoryAutoSortView, PetsView, TalentCatalogView. i18n parity vi+en. | 6 view files, `vi.json`, `en.json` | All 6 views have XTLuxHero + roleHint + crossNav; i18n keys in vi+en; typecheck + lint + build + Han gate + 246 test files (2659 tests) pass. | 2026-05-20 |
| 23 | Test Coverage for 10 Views Missing Test Files | DONE | 10 views with XTLuxHero + roleHint + crossNav but no test file — test coverage gap. | Add lightweight test files for CultivationMethodV2View, EncounterView, EventsView, InventoryAutoSortView, MonetizationShopView, NpcView, PetsView, PlayerLogsView, SecretRealmView, WalletView. Each tests hero + roleHint + crossNav rendering. | 10 test files in `apps/web/src/views/__tests__/` | All 10 test files pass (30 tests); typecheck + lint + build + Han gate + 256 test files (2689 tests) pass. | 2026-05-20 |
| 24 | Admin Event Builder UI Polish | DONE | AdminEventBuilderView has no XTLuxHero, roleHint, or crossNav — inconsistent with AdminCC and all other polished views. | Add XTLuxHero (tone=seal, watermark=E), roleHint, crossNav (→adminCC, systemStatus); i18n parity vi+en; add test file. | `AdminEventBuilderView.vue`, `vi.json`, `en.json`, `AdminEventBuilderView.test.ts` | Hero + roleHint + crossNav rendered; i18n keys in vi+en; 3/3 tests pass; typecheck + lint + build + Han gate + 257 test files (2692 tests) pass. | 2026-05-20 |
| 25 | EffectsPreviewView UX Polish | DONE | EffectsPreviewView (admin-only dev tool) has no XTLuxHero, roleHint, crossNav, or i18n — hardcoded Vietnamese text. | Add XTLuxHero (tone=seal, watermark=V), roleHint, crossNav (→adminCC, settings); add i18n namespace `effectsPreview` vi+en; replace hardcoded text; add 3 UX tests to existing test file. | `EffectsPreviewView.vue`, `vi.json`, `en.json`, `EffectsPreviewView.test.ts` | Hero + roleHint + crossNav rendered; i18n keys in vi+en; 6/6 tests pass; typecheck + lint + build + Han gate + 257 test files (2695 tests) pass. | 2026-05-20 |
| 26 | XTLuxHero for Final 3 Views | DONE | LeaderboardView, LoadoutView, SkillBookView have roleHint + crossNav but missing XTLuxHero — 75/76 views polished, 3 gaps remain. | Add XTLuxHero to LeaderboardView (tone=seal, watermark=L), LoadoutView (tone=gold, watermark=T), SkillBookView (tone=jade, watermark=P); add luxHero i18n keys vi+en; add hero tests; update audit doc. | `LeaderboardView.vue`, `LoadoutView.vue`, `SkillBookView.vue`, `vi.json`, `en.json`, 3 test files | Each view has XTLuxHero rendered; luxHero i18n keys in vi+en; all tests pass; typecheck + lint + build + Han gate + 257 test files (2698 tests) pass. | 2026-05-20 |
| 27 | Equipment Upgrade Hub | DONE | Equipment upgrade UI (refine/reforge/enchant) buried in InventoryView — players must navigate away from EquipmentView to upgrade gear. | Consolidate upgrade UI into EquipmentView with inline upgrade hub; extract RefinePanel; add tab bar (refine/reforge/enchant); add i18n keys; update tests. | `EquipmentView.vue`, `vi.json`, `en.json`, `EquipmentView.test.ts` | "Nâng cấp" button opens inline upgrade hub; refine/reforge/enchant tabs work; i18n keys in vi+en; all tests pass; typecheck + lint + build + Han gate + 257 test files (2698 tests) pass. | 2026-05-20 |
| 28 | Functional Test Coverage for 6 Views | DONE | 6 views (CultivationMethodV2View, EventsView, PetsView, InventoryAutoSortView, WalletView, MonetizationShopView) had only UX polish tests — no functional test coverage. | Add functional tests for all 6 views: API calls, data rendering, user interactions, error handling. Each view gets 5-10 functional tests. | 6 test files in `apps/web/src/views/__tests__/` | All 6 test files expanded with functional tests; 257 test files / 2729 tests pass; typecheck + lint + build + Han gate pass. | 2026-05-20 |
| 29 | Story V2 — World Objective Deep Wire | DONE | Story V2 `track()` only supported `kill` and `collect` step kinds. Boss defeat and dungeon clear hooks were missing. Collect tracking not wired at loot grant sites. | Extend `track()` to accept `dungeon_clear` and `boss_defeat` kinds. Wire boss defeat tracking in BossService. Wire collect tracking in combat and dungeon-run loot grants. Wire dungeon clear tracking in DungeonRunService. Add tests. | `story-v2.service.ts`, `boss.service.ts`, `boss.module.ts`, `combat.service.ts`, `dungeon-run.service.ts`, `story-v2.service.test.ts` | `track()` accepts all 4 auto-track kinds; boss defeat hook fires on boss kill; collect hook fires on loot grant; dungeon clear hook fires on run completion; typecheck + lint + build + web tests (257 files / 2698 tests) pass. | 2026-05-20 |
| 30 | Story V2 — Daily/Weekly Quest Reset Scheduler | DONE | 19 daily + 19 weekly quests existed in catalog but once claimed, stayed CLAIMED forever — no reset mechanism. | Add BullMQ scheduler (10-min interval) to reset CLAIMED daily/weekly quests when windowEnd expires. Prisma migration: windowStart/windowEnd columns. Service: resetExpiredQuests() + claimReward() window setting. | `story-v2.service.ts`, `story-v2-reset.queue.ts`, `story-v2-reset.scheduler.ts`, `story-v2-reset.processor.ts`, `story-v2.module.ts`, `schema.prisma`, 3 test files | Daily quests reset at next UTC midnight; weekly at next UTC Monday; scheduler runs every 10 min; 11 new tests pass; typecheck + lint + build pass. | 2026-05-20 |
| 31 | Test Coverage for 6 Admin/Placeholder Views | DONE | 6 views (AdminAchievementReputationView, AdminCodexView, AdminMarketV2View, AdminPetsView, AdminSystemStatusView, XianxiaPlaceholderView) had no test files. | Add test files for all 6 views: mock API/stores/router, verify title rendering, key elements, data-testid, loading/forbidden states. | 6 test files in `apps/web/src/views/__tests__/` | All 6 test files pass (25 tests); 263 test files / 2754 tests pass; typecheck + lint + build + Han gate pass. | 2026-05-21 |
| 32 | Sect 2.0 — Roles & Member Table | DONE | Sect membership tracked via `Character.sectId` direct FK — no role hierarchy, no join date, no proper join table. | Add `SectRole` enum + `SectMember` model. Backfill from Character.sectId + Sect.leaderId. Update SectService create/join/leave/detail. Add role to SectMemberView. | `schema.prisma`, `sect.service.ts`, `sect.service.test.ts`, migration | SectMember table exists with role + joinedAt; create→LEADER, join→MEMBER, leave deletes row; detail reads from SectMember; typecheck + lint + build + tests pass. | 2026-05-21 |
| 33 | Sect Permission Guards + Audit Log | DONE | Sect system has roles + permission guards but missing: SectBoss content, sect war contribution tracking with role-aware queries, and elder promotion UI for player-facing role management. | Add promote/demote/kick methods with role checks. SectAuditLog model. Controller endpoints. Tests for all permission paths. | `sect.service.ts`, `sect.controller.ts`, `sect.service.test.ts`, `schema.prisma`, migration | promote/demote/kick work with correct role guards; SectAuditLog records all mutations; 11 new tests pass; typecheck + lint + build pass. | 2026-05-21 |
| 34 | Sect Epic — Boss, War Contribution & Elder UI | DONE | Sect system has roles + permission guards but missing: SectBoss content, sect war contribution tracking with role-aware queries, and elder promotion UI for player-facing role management. | Add SectBoss catalog + service + controller. Add sect war contribution tracking with role-aware aggregation. Add elder promotion UI in SectView. | `packages/shared/src/sect-content.ts`, `sect-boss.service.ts`, `sect-boss.controller.ts`, `sect-war-contribution.service.ts`, `SectView.vue`, `sect*.test.ts`, `schema.prisma`, migration | SectBossDef catalog entries; SectBoss spawn/fight/claim endpoints; sect war contribution tracked per-member with role-aware leaderboard; elder can promote/demote via UI; 12 boss tests + 9 war-contribution tests pass; migration 20460503000000; typecheck + lint + build pass. | 2026-05-22 |

## Current Recommended Next Task

`Next task: choose from TODO queue — all sect tasks #32-34 DONE. Recommended: next highest-rank TODO in tracker.`

## Active Task Template

### Active Task

- Task: (none — task #34 completed)
- Branch: feat/sect-epic-boss-war-elder
- Started: 2026-05-21
- Owner: AI
- Status: DONE

## Completed Tasks

| # | Task | PR | Branch | Date |
|---|---|---|---|---|
| 1 | Daily Loop First Session Polish | #637 | feat/daily-loop-first-session-polish | 2026-05-19 |
| 2 | Equipment Flow Cleanup | — | feat/equipment-flow-cleanup | 2026-05-19 |
| 3 | Core Loop Smoke Proof Pack | — | feat/core-loop-smoke-proof-pack | 2026-05-19 |
| 4 | Combat Entry Consolidation | #640 | feat/combat-entry-consolidation | 2026-05-19 |
| 5 | Quest/Mission/Story Labeling Polish | #641 | feat/quest-mission-story-labeling | 2026-05-19 |
| 6 | Boss Notification Integration | #642 | feat/boss-notification-integration | 2026-05-19 |
| 7 | Party Membership / Invite Polish | — | feat/beta-polish-pack | 2026-05-19 |
| 8 | Admin Reload Guard Fix | — | feat/beta-polish-pack | 2026-05-19 |
| 9 | Beta Checklist Refresh | — | feat/beta-polish-pack | 2026-05-19 |
| 10 | Mobile Top Routes QA Pass | — | feat/beta-polish-pack | 2026-05-19 |
| 11 | Production Ops Polish | — | feat/production-ops-polish | 2026-05-19 |
| 12 | Market V2 Player UX Polish | #645 | feat/market-v2-ux-polish | 2026-05-19 |
| 13 | Admin Control Center Polish | #646 | feat/admin-cc-polish | 2026-05-19 |
| 14 | Co-op & Social Views Polish | — | feat/coop-social-ux-polish | 2026-05-19 |
| 15 | Views UX Polish Pack | #648 | feat/views-ux-polish-pack | 2026-05-19 |
| 16 | Sect & Market Positive-Path Smoke | — | feat/sect-market-positive-smoke | 2026-05-19 |
| 17 | Cross-Navigation Polish Pack | #650 | feat/cross-nav-polish-pack | 2026-05-19 |
| 18 | UX Polish Pack — Batch 1 | #652 | feat/ux-polish-batch-1 | 2026-05-19 |
| 19 | Market V2 Abuse Workflow | — | feat/market-v2-abuse-workflow | 2026-05-19 |
| 20 | Content Depth — Farm Map Expansion | #655 | feat/content-depth-farm-map-expansion | 2026-05-20 |
| 21 | Content Depth — Monster Catalog for Cửu La Điện | #656 | feat/content-depth-cuu-la-dien-monsters | 2026-05-20 |
| 22 | XTLuxHero for Remaining Views | — | feat/xt-lux-hero-remaining-views | 2026-05-20 |
| 23 | Test Coverage for 10 Views Missing Test Files | #658 | feat/test-coverage-10-views | 2026-05-20 |
| 24 | Admin Event Builder UI Polish | #659 | feat/admin-event-builder-polish | 2026-05-20 |
| 25 | EffectsPreviewView UX Polish | #660 | feat/effects-preview-polish | 2026-05-20 |
| 26 | XTLuxHero for Final 3 Views | #661 | feat/xt-lux-hero-final-3-views | 2026-05-20 |
| 27 | Equipment Upgrade Hub | #662 | feat/equipment-upgrade-hub | 2026-05-20 |
| 28 | Functional Test Coverage for 6 Views | #663 | feat/test-coverage-functional | 2026-05-20 |
| 29 | Story V2 — World Objective Deep Wire | — | feat/story-v2-deep-wire | 2026-05-20 |
| 30 | Story V2 — Daily/Weekly Quest Reset Scheduler | — | feat/story-v2-daily-weekly-reset | 2026-05-20 |
| 31 | Test Coverage for 6 Admin/Placeholder Views | — | feat/test-coverage-6-admin-views | 2026-05-21 |
| 32 | Sect 2.0 — Roles & Member Table | #667 | feat/sect-2-roles-member-table | 2026-05-21 |
| 33 | Sect Permission Guards + Audit Log | #668 | feat/sect-permission-guards | 2026-05-21 |

## Deferred / Do Not Build

- Real-time PvP
- Gacha / pet gacha
- NFT / blockchain
- Real-money player trade
- Voice chat
- Native mobile app
- Multi-region sharding
