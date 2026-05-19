# Xuân Tôi — Feature Progress Tracker

## Purpose

File này dùng để theo dõi các chức năng cần phát triển/hoàn thiện. AI/dev sau mỗi PR phải cập nhật file này để người sau biết việc gì đã xong và việc gì làm tiếp.

## Update Rules

- Cập nhật file này trong mọi PR có thay đổi feature, UX, gameplay, test, smoke, admin, liveops hoặc docs roadmap.
- Khi bắt đầu làm PR: đổi task từ TODO sang IN_PROGRESS.
- Khi PR xong/merged: đổi task sang DONE, ghi PR number/branch/commit nếu biết.
- Nếu không làm được: đổi sang BLOCKED và ghi lý do.
- Nếu task không nên làm nữa: đổi sang DEFERRED và ghi lý do.
- Sau khi hoàn thành một task, chọn task TODO ưu tiên cao nhất tiếp theo.
- Không xóa task cũ; chỉ chuyển xuống phần Completed nếu quá dài.

## Status Legend

| Status | Meaning |
|---|---|
| TODO | Chưa làm |
| IN_PROGRESS | Đang làm |
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

## Current Recommended Next Task

`Content Depth — Realm Tier Expansion` or `Market V2 Abuse Workflow` or `Admin Control Center Polish (task #13)`

## Active Task Template

### Active Task

- Task: (none — pick next from Priority Queue)
- Branch: —
- Started: —
- Owner: —
- Status: —

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

## Deferred / Do Not Build

- Real-time PvP
- Gacha / pet gacha
- NFT / blockchain
- Real-money player trade
- Voice chat
- Native mobile app
- Multi-region sharding
