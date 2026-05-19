# Xuân Tôi — Feature Audit & Roadmap

> Source of truth for feature status, current roadmap, and next feature PR selection.
> Code on `main` remains the final source of truth for runtime behavior.

## 1. Current Product State

- Xuân Tôi is past prototype stage. The repo has a playable web/PWA MUD core: auth, onboarding, character, cultivation, missions, dungeon/combat, inventory/equipment, boss, mail, market, social, and admin/liveops surfaces.
- The playable core is mostly present, but the first-session player journey is not yet clear enough. Players can do many things, but the game does not always explain which action matters next.
- The biggest weakness is UX orchestration: too many strong systems are split across many routes and hubs.
- Current priority should be polish and beta proof, not new large gameplay modules.

## 2. Feature Status Matrix

| Feature Group | Status | Current Evidence | Missing / Weak Point | Priority | Next Action |
|---|---|---|---|---|---|
| Auth / Account | DONE | `apps/api/src/modules/auth`, `apps/web/src/views/AuthView.vue`, `SettingsView.vue` | OAuth/2FA can wait | High | Maintain, do not rebuild |
| Character | DONE | `apps/api/src/modules/character`, `CharacterView.vue`, `CharacterView.test.ts` | Minor CTA/copy polish | Medium | Keep as stable profile source |
| Cultivation | DONE | `apps/api/src/modules/cultivation`, `CultivationHubView.vue`, `HomeView.vue`, `DailyLoopPanel.vue` | Tick timing and next-step UX can be clearer | High | Improve first-session guidance |
| Spiritual Root | PARTIAL | `spiritual-root.service.ts`, `SpiritualRootView.vue`, `packages/shared/src/spiritual-root.ts` | Positive reroll smoke and clearer elemental impact | Medium | Add UX explanation and positive smoke later |
| Body Cultivation | DONE | `apps/api/src/modules/body-cultivation`, `BodyCultivationView.vue`, `packages/shared/src/body-cultivation.ts` | Needs better home/dashboard integration | Medium | Surface as daily/progression option |
| Breakthrough | PARTIAL | `BreakthroughView.vue`, breakthrough API/client/tests | Success-path smoke needs seeded peak state | High | Add core loop smoke proof |
| Tribulation | PARTIAL | `tribulation.service.ts`, `tribulation-mini-battle.service.ts`, `TribulationView.vue`, `TribulationMiniBattlePanel.vue` | Mini-battle gating/availability clarity | Medium | Role hint + cross-nav added; mini-battle gating clarity next |
| Skill / Công pháp / Kỹ năng | PARTIAL | `character-skill.service.ts`, `SkillBookView.vue`, `skill-templates.ts`, `combat.ts` | Skill book drop/consume/evolution deferred | Medium | Do not expand until core UX is clearer |
| Inventory | DONE | `apps/api/src/modules/inventory`, `InventoryView.vue`, `apps/web/src/api/inventory.ts` | UX can be simplified | High | Align with equipment flow |
| Equipment | PARTIAL | `EquipmentView.vue`, `EquipmentUpgradePanel.vue`, `equipment.service.ts`, `equipment-economy.service.ts` | Badges + upgrade CTA added; full upgrade still in inventory | Medium | Combat Entry Consolidation |
| Alchemy | DONE | `alchemy.service.ts`, `AlchemyView.vue`, `packages/shared/src/alchemy.ts` | Material source onboarding can improve | Medium | Keep stable; polish later |
| Dungeon / Combat | DONE | `combat.controller.ts`, `combat.service.ts`, `DungeonView.vue`, `DungeonRunView.vue`, `CombatHubView.vue` | Entry points are fragmented | High | Combat Entry Consolidation |
| Boss | DONE | `boss.service.ts`, `BossView.vue`, `BossHubView.vue`, `packages/shared/src/boss.ts` | Active boss notification/visibility | Medium | Boss Notification Integration |
| Party | DONE | `apps/api/src/modules/party`, `PartyHubView.vue`, `PartyPanel.vue` | Invite/member gating polish | Medium | Party Membership / Invite Polish ✅ |
| Party Dungeon | PARTIAL | `apps/api/src/modules/party-dungeon`, `PartyDungeonView.vue`, `PartyDungeonPanel.vue` | Membership gating and reward clarity | Medium | Role hint + cross-nav added; polish reward clarity next |
| Co-op Boss | PARTIAL | `apps/api/src/modules/coop-boss`, `CoopBossView.vue`, `CoopBossPanel.vue` | Contribution UX needs clarity | Medium | Role hint + cross-nav added; polish contribution UX next |
| Quest / Mission | PARTIAL | `apps/api/src/modules/quest`, `apps/api/src/modules/mission`, `QuestView.vue`, `MissionView.vue`, `missions.ts`, `quests.ts` | Mission/quest/story distinction and positive claim smoke gaps | High | Quest/Mission/Story Labeling Polish |
| Story / NPC | PARTIAL | `story-v2`, `story-dialogue`, `story-dungeon`, `npc-affinity`, `NpcView.vue`, `StoryV2View.vue` | Some objective wiring is still deferred | Medium | Keep scoped; polish labels/gates |
| Sect | PARTIAL | `sect`, `sect-war`, `sect-season`, `territory`, `SectView.vue`, `SectWarView.vue` | Positive create/join/contribute smoke gaps | Medium | Role hint + cross-nav added; positive smoke gaps remain |
| Chat / Social / Friend | DONE | `chat`, `social`, `chat-private`, `chat-group`, `SocialView.vue`, `ChatPanel.vue` | Voice chat is intentionally out of scope | Low | Maintain |
| Market / Auction | PARTIAL | `market`, `market-v2`, `MarketView.vue`, `MarketV2View.vue`, `market-v2.ts` | Market V2 gated; player UX polished (card layout, time remaining, status badges, role hint, cross-nav, claim box source descriptions, i18n parity); positive smoke and abuse workflow remain | Medium | Positive smoke + abuse workflow polish |
| Monetization / Topup / Wallet | PARTIAL | `topup`, `monetization`, `WalletView.vue`, `MonetizationView.vue`, `TopupView.vue` | Policy review needed before expansion | Medium | Keep conservative |
| Notification / Mail | DONE | `notification`, `mail`, `NotificationCenterView.vue`, `MailView.vue`, `NotificationBell.vue` | More gameplay trigger wiring | Medium | Boss Notification Integration |
| Daily Loop / Onboarding | PARTIAL | `DailyLoopPanel.vue`, `OnboardingView.vue`, `OnboardingQuestView.vue`, `onboarding-quest` | Daily Loop polished (sorted, i18n, CTAs); onboarding quest flow remains | Medium | Boss Notification Integration |
| Events / LiveOps | PARTIAL | `liveops-*`, `event-builder`, `AdminEventBuilderView.vue`, `EventsView.vue` | Some cron/reward automation remains operator-driven | Medium | Polish after beta UX |
| Admin | DONE | `admin`, `admin-control-center`, many admin panels/tests | Reload guard fixed; Control Center polished (hero, role hint, cross-nav, stat color coding, data-testid, pull-to-refresh) | High | Maintain |
| Backup / Deploy / Ops | DONE | `backup`, `AdminBackupPanel.vue`, `docs/DEPLOY.md`, `docs/BACKUP_RESTORE.md`, `scripts/restore-drill.mjs`, `docs/RUNBOOK.md` | Restore drill automated; operator runbook enhanced with drill procedure + pre-deploy checklist | High | Maintain; run drill monthly |
| Testing / Smoke / E2E | DONE | `docs/QA_CHECKLIST.md`, `apps/web/e2e/golden.spec.ts`, smoke scripts/docs | Core loop positive paths covered (breakthrough, mission, spiritual-root, sect contribute/join, market post/buy/cancel) | High | Maintain; add more smoke as features mature |
| Mobile / PWA / i18n | DONE | PWA/i18n docs, `LocaleSwitcher`, `vi.json`, `en.json` | Top routes verified mobile-compatible; MissionView responsive fix | Medium | Mobile Top Routes QA Pass ✅ |

## 3. What Is Good Enough

Do not rebuild these systems from scratch:

- Auth/session/password/account basics.
- Character profile and core character state.
- Cultivation core tick and cultivation hub.
- Inventory core, item ledger, equip/unequip backend.
- Solo dungeon/combat and boss base loops.
- Mail and notification center foundation.
- Daily login, mission list, quest list, and claim surfaces.
- Admin core panels, audit, liveops foundations.
- Chat/social/friend foundations.
- Shared catalogs for realms, items, skills, monsters, dungeons, bosses, missions, quests, events, alchemy, and progression.

## 4. What Still Needs Work

### 4.1 Gameplay gaps

- Skill book drop/consume/evolution remains deferred.
- Story V2 has deeper kill/collect/objective wiring still marked as deferred in service comments.
- ~~Breakthrough success path needs practical smoke proof with seeded peak state.~~ ✅
- ~~Spiritual-root positive reroll needs seeded item/admin helper.~~ ✅
- Some onboarding/returner auto-track hooks are partial.

### 4.2 Backend exists but UI needs polish

- Equipment economy and upgrade actions exist; EquipmentView now shows progression badges and upgrade CTA, but full upgrade (reforge/enchant) remains in InventoryView.
- ~~Market V2 auction/claim box backend exists but player UI is utilitarian and gated.~~ ✅ Polished (card layout, time remaining, status badges, role hint, cross-nav, claim box source descriptions).
- Backup/admin ops exists but needs clearer production operator workflow.
- Party/party dungeon/co-op boss APIs exist; hub flow and membership/invite UX improved (role hint + cross-nav added to all surfaces).

### 4.3 UI exists but needs real data/action/gating

- ~~CombatHub is useful, but should better route players to the single best available combat action.~~ ✅ Consolidated with recommended action panel.
- Party surfaces need stronger membership/invite gating.
- ~~Notification center needs more visible gameplay triggers, especially boss/activity notifications.~~ ✅ Boss notification integrated into daily loop + notification dropdown.

### 4.4 UX is confusing

- ~~Combat routes are fragmented: `/combat`, `/dungeon`, `/dungeon-run`, `/world/dungeons`, `/boss`, `/world/bosses`.~~ ✅ Combat hub now routes to best available action.
- Equipment view now has progression badges + upgrade CTA; inventory has cross-link. Full upgrade panels still in inventory.
- ~~Quest, mission, story, onboarding quest, and story dungeon labels are easy to confuse.~~ ✅ Role hint + cross-nav added; labels clarified.
- There are many advanced systems before the first-session path is fully polished.

### 4.6 UX Polish Gap Analysis (2026-05-19 audit)

**Scope**: 97 total `.vue` files in `apps/web/src/views/`. Excluding 13 admin views, 6 auth/utility views (AuthView, ForgotPasswordView, ResetPasswordView, NotFoundView, OnboardingView, XianxiaPlaceholderView), and 2 home/dashboard views → **76 player-facing views**.

**Fully polished (XTLuxHero + roleHint + crossNav)**: 28 views
AchievementView, AlchemyView, ArenaView, BodyCultivationView, BossHubView, BossView, BreakthroughView, CharacterView, CoopBossView, DungeonRunView, DungeonView, InventoryView, LeaderboardView, LoadoutView, MailView, MarketV2View, MarketView, MissionView, PartyDungeonView, PartyHubView, QuestView, SectView, SkillBookView, SocialView, SpiritualRootView, StoryV2View, TribulationView, AdminControlCenterView.

**Have XTLuxHero but missing roleHint + crossNav**: 38 views
ActivityView, CodexView, CombatHubView, CosmeticView, CultivationHubView, CultivationMethodV2View, DungeonHubV2View, EncounterView, EquipmentView, FarmMapView, FeedbackView, GiftCodeView, MentorView, MonetizationDacQuyenView, MonetizationShopView, MonetizationView, NotificationCenterView, NotificationSettingsView, NpcView, OnboardingQuestView, PlayerLogsView, ProfileView, PvpView, ReportPlayerView, ReputationView, ReturnerView, RoguelikeView, SeasonsView, SecretRealmView, SectContentView, SectWarView, SettingsView, ShopPacksView, ShopView, StoryDungeonView, TerritoryView, TitleView, TopupView, TrialTowerView, WalletView, WorldContentView.

**Missing XTLuxHero entirely**: 7 player-facing views
ArtifactV2View, CultivationMethodView, EffectsPreviewView, EventsView, InventoryAutoSortView, PetsView, TalentCatalogView.

**Missing test files**: 10 player-facing views
CultivationMethodV2View, EncounterView, EventsView, InventoryAutoSortView, MonetizationShopView, NpcView, PetsView, PlayerLogsView, SecretRealmView, WalletView.

**Coverage**: 28/76 player views fully polished (37%). 67/76 have XTLuxHero (88%). All 28 polished views have test files.

### 4.5 Missing beta proof / smoke tests

- ~~Positive breakthrough success smoke.~~ ✅
- ~~Positive mission claim smoke.~~ ✅
- ~~Positive spiritual-root reroll smoke.~~ ✅
- ~~Positive market post/buy/cancel smoke.~~ ✅
- ~~Positive sect create/join/contribute smoke.~~ ✅
- ~~Mobile top-route QA pass.~~ ✅
- ~~Current beta docs are partly stale and should be refreshed against code.~~ ✅

## 5. Top 10 Recommended PRs

| Rank | PR Name | Goal | Main Files / Modules | Risk | Size | Status |
|---|---|---|---|---|---|---|
| 1 | Daily Loop First Session Polish | Make `/home` clearly tell a new player what to do next | `DailyLoopPanel.vue`, `HomeView.vue`, `NextActionPanel.vue`, `player-dashboard` | Low | Medium | DONE |
| 2 | Equipment Flow Cleanup | Make equip/unequip/upgrade paths understandable from equipment and inventory | `EquipmentView.vue`, `InventoryView.vue`, `EquipmentUpgradePanel.vue`, `apps/web/src/api/inventory.ts` | Medium | Medium | DONE |
| 3 | Core Loop Smoke Proof Pack | Add beta proof for breakthrough success and mission claim | smoke scripts, `breakthrough`, `mission`, `admin` | Medium | Small | DONE |
| 4 | Combat Entry Consolidation | Reduce route confusion and route players to the right combat surface | `CombatHubView.vue`, `DungeonView.vue`, `DungeonRunView.vue`, router | Low | Medium | DONE |
| 5 | Quest/Mission/Story Labeling Polish | Clarify what is a quest, mission, story chapter, and story dungeon | `QuestView.vue`, `MissionView.vue`, `StoryV2View.vue`, i18n | Low | Medium | DONE |
| 6 | Boss Notification Integration | Surface active boss events in daily loop/notifications | `boss`, `notification`, `web-push`, `DailyLoopPanel.vue` | Medium | Medium | DONE |
| 7 | Party Membership / Invite Polish | Make party creation, invite, member state, and co-op entry clearer | `party`, `PartyHubView.vue`, `PartyPanel.vue` | Medium | Medium | DONE |
| 8 | Admin Reload Guard Fix | Prevent admin direct reload from redirecting before auth hydrate | `AdminControlCenterView.vue`, auth store/router guard | Low | Small | DONE |
| 9 | Beta Checklist Refresh | Sync beta readiness docs with current code and this tracker | `docs/BETA_CHECKLIST.md`, `docs/QA_CHECKLIST.md`, this file | Low | Small | DONE |
| 10 | Mobile Top Routes QA Pass | Verify top routes on mobile and fix obvious layout blockers | App shell, `/home`, `/combat`, `/equipment`, `/missions`, `/inventory`, `/mail`, `/admin` | Medium | Medium | DONE |

## 6. Next 3 PR Plan

### PR 1: Daily Loop First Session Polish ✅ DONE

- Goal: make the first session self-directed without asking the player to understand the whole route map.
- Scope: improve priority ordering, labels, completion states, and route CTAs on the home/daily loop surface.
- Files touched: `apps/web/src/components/DailyLoopPanel.vue`, `apps/web/src/i18n/vi.json`, `apps/web/src/i18n/en.json`, `apps/web/src/components/__tests__/DailyLoopPanel.test.ts`, `docs/FEATURE_PROGRESS_TRACKER.md`, `docs/FEATURE_AUDIT_AND_ROADMAP.md`, `docs/AI_HANDOFF_REPORT.md`.
- Tests run: typecheck ✅, lint ✅, build ✅, DailyLoopPanel 17/17 ✅, Han gate 0 ✅.
- Done criteria met: activities sorted by priority (claimable → active → available → completed), priority numbers shown, per-activity CTA labels, i18n keys in vi.json+en.json, reward hints improved.
- What was not touched: no backend changes, no balance changes, no new gameplay module.

### PR 2: Equipment Flow Cleanup ✅ DONE

- Goal: make equipment management feel like one coherent flow.
- Scope: add progression badges (refine/enchant/substats) on equipped items, add Upgrade CTA per slot, add cross-navigation between EquipmentView and InventoryView, add i18n keys.
- Files touched: `apps/web/src/views/EquipmentView.vue`, `apps/web/src/views/InventoryView.vue`, `apps/web/src/i18n/vi.json`, `apps/web/src/i18n/en.json`, `apps/web/src/views/__tests__/EquipmentView.test.ts`.
- Tests run: typecheck ✅, lint ✅, build ✅, EquipmentView 9/9 ✅, Han gate 0 ✅.
- Done criteria met: equipped items show refine/enchant/substats badges, Upgrade button navigates to inventory, "View Full Equipment" button in inventory sidebar, full i18n parity.
- What was not touched: no new equipment backend, no schema migration, no balance/stat formula changes.

### PR 3: Core Loop Smoke Proof Pack ✅ DONE

- Goal: close beta-proof gaps in the core progression loop.
- Scope: add positive smoke for mission claim via admin seed (`POST /admin/users/:id/mission-track`); extend `smoke-all.mjs` to include breakthrough, mission, spiritual-root suites.
- Files touched: `apps/api/src/modules/admin/admin.service.ts`, `apps/api/src/modules/admin/admin.controller.ts`, `apps/api/src/modules/admin/admin.module.ts`, `scripts/smoke-mission.mjs`, `scripts/smoke-all.mjs`, `docs/FEATURE_PROGRESS_TRACKER.md`, `docs/FEATURE_AUDIT_AND_ROADMAP.md`, `docs/AI_HANDOFF_REPORT.md`.
- Tests run: typecheck ✅, lint ✅, build ✅, Han gate 0 ✅.
- Done criteria met: mission positive claim smoke passes (admin seed → player claim → rewards applied → ALREADY_CLAIMED idempotent); smoke-all now includes breakthrough + mission + spiritual-root suites.
- What was not touched: no gameplay logic changes, no migration, no balance changes, no new frontend code.

### PR 4: Beta Polish Pack (Tasks #7–#10) ✅ DONE

- Goal: batch 4 small polish tasks into one non-conflicting PR for beta readiness.
- Scope: (1) Party Hub — role hint + cross-navigation bar + i18n keys for PartyHubView; (2) Admin Reload Guard — add `await auth.hydrate()` to 8 admin views missing it; (3) Beta Checklist Refresh — update test counts and status in BETA_CHECKLIST.md; (4) Mobile QA — responsive fix on MissionView right column.
- Files touched: `apps/web/src/views/PartyHubView.vue`, `apps/web/src/i18n/vi.json`, `apps/web/src/i18n/en.json`, `apps/web/src/views/AdminHallOfFameView.vue`, `apps/web/src/views/AdminFeedbackView.vue`, `apps/web/src/views/AdminReportsView.vue`, `apps/web/src/views/AdminSystemStatusView.vue`, `apps/web/src/views/AdminCodexView.vue`, `apps/web/src/views/AdminPetsView.vue`, `apps/web/src/views/AdminPvpCenterView.vue`, `apps/web/src/views/AdminMarketV2View.vue`, `apps/web/src/views/MissionView.vue`, `apps/web/src/views/__tests__/AdminHallOfFameView.test.ts`, `apps/web/src/views/__tests__/AdminPvpCenterView.test.ts`, `docs/BETA_CHECKLIST.md`, `docs/FEATURE_PROGRESS_TRACKER.md`, `docs/FEATURE_AUDIT_AND_ROADMAP.md`, `docs/AI_HANDOFF_REPORT.md`.
- Tests run: typecheck ✅, lint ✅, build ✅, tests 245/245 files (2605/2605) ✅, Han gate 0 ✅.
- Done criteria met: PartyHubView has role hint + cross-nav + full i18n; 8 admin views have auth hydrate guard; beta checklist reflects current test counts; MissionView responsive at 375px.
- What was not touched: no backend changes, no schema migration, no new gameplay module, no balance changes.

### PR 5: Views UX Polish Pack (Task #15) ✅ DONE

- Goal: Add XTLuxHero + roleHint + crossNav to 12 views missing the standard UX pattern.
- Scope: (1) XTLuxHero added to 3 views (AlchemyView, BreakthroughView, DungeonView); (2) roleHint + crossNav added to all 12 views; (3) i18n keys in vi+en for all 12 namespaces; (4) 2 tests per file (24 new tests total).
- Files touched: 12 view files, 12 test files, `vi.json`, `en.json`, 3 doc files.
- Tests run: typecheck ✅, lint ✅, build ✅, tests 245/245 files (2647/2647) ✅, Han gate 0 ✅.
- Done criteria met: all 12 views have XTLuxHero + roleHint + crossNav; i18n parity; all tests pass.
- What was not touched: no backend changes, no schema migration, no new gameplay module, no balance changes.

### PR 6: Cross-Navigation Polish Pack (Task #17) ✅ DONE

- Goal: Add roleHint + crossNav to 6 remaining player-facing views missing the standard UX pattern.
- Scope: (1) roleHint + crossNav added to MarketView, SocialView, MailView, LeaderboardView, SkillBookView, LoadoutView; (2) i18n keys in vi+en for all 6 namespaces; (3) 2 tests per file (12 new tests total); (4) created SocialView.test.ts.
- Files touched: 6 view files, 6 test files (5 existing + 1 new), `vi.json`, `en.json`, 3 doc files.
- Tests run: typecheck ✅, lint ✅, build ✅, tests 246/246 files (2659/2659) ✅, Han gate 0 ✅.
- Done criteria met: all 6 views have roleHint + crossNav; i18n parity; all tests pass.
- What was not touched: no backend changes, no schema migration, no new gameplay module, no balance changes.

### Short term: 1-2 weeks

- ~~Daily Loop First Session Polish.~~ ✅
- ~~Equipment Flow Cleanup.~~ ✅
- ~~Core Loop Smoke Proof Pack.~~ ✅
- ~~Admin Reload Guard Fix.~~ ✅
- ~~Beta Checklist Refresh.~~ ✅
- ~~Production ops polish: restore drill, observability, operator runbook.~~ ✅

### Medium term: 1-2 months

- ~~Combat Entry Consolidation.~~ ✅
- ~~Quest/Mission/Story Labeling Polish.~~ ✅
- ~~Boss Notification Integration.~~ ✅
- ~~Party Membership / Invite Polish.~~ ✅
- ~~Mobile Top Routes QA Pass.~~ ✅
- ~~Market V2 player UX polish.~~ ✅
- ~~Sect create/join/contribute positive smoke.~~ ✅
- UX Polish Pack — roleHint + crossNav for remaining 38 views (batch into ~3 PRs of 12-14 views each).
- XTLuxHero for 7 remaining views (ArtifactV2View, CultivationMethodView, EffectsPreviewView, EventsView, InventoryAutoSortView, PetsView, TalentCatalogView).
- Test coverage for 10 views missing test files.

### Long term: after beta / commercialization

- More realm-tier content depth after UX is stable.
- Async PvP seasons only after economy and anti-wintrade proof.
- Market V2 expansion after abuse controls and beta feedback.
- Monetization expansion only after policy/legal review.
- Deeper story/NPC systems after current objective wiring is reliable.

## 8. Do Not Build Now

- Real-time PvP: async PvP must be validated first.
- Gacha / pet gacha: loot-box and policy risk.
- NFT / blockchain: not part of the product direction.
- Real-money player trade: legal and economy risk.
- Voice chat: conflicts with lightweight social design.
- Native mobile app: PWA is enough before v1.0.
- Multi-region sharding: wait until real scale justifies it.

## 9. Beta Readiness Score

| Area | Score | Notes |
|---|---:|---|
| Playable core | 8.5/10 | All core loops have positive smoke proof |
| New player UX | 7/10 | Daily loop polished; first-session guidance improved |
| Daily loop | 8/10 | Sorted, i18n, CTAs, boss notification integrated |
| Combat loop | 9/10 | Combat hub consolidated; recommended action panel |
| Economy safety | 8/10 | Anti-FE-self-grant verified; ledger invariants intact |
| Admin/LiveOps | 8/10 | Reload guard fixed; Control Center polished |
| Test/CI/Smoke | 8.5/10 | 246 test files / 2659 tests; 6 positive smoke scripts |
| Mobile/PWA | 8/10 | Top routes verified; MissionView responsive fix |
| Content depth | 7.5/10 | Stable; no new content modules needed for beta |
| Monetization readiness | 5.5/10 | Policy review needed before expansion |
| UX consistency | 5/10 | 28/76 views polished (37%); 38 views still need roleHint + crossNav |

## 10. Decision Rule For Future AI

- If you do not know what to do next, read `docs/FEATURE_PROGRESS_TRACKER.md`.
- If the top-ranked task in `docs/FEATURE_PROGRESS_TRACKER.md` has status `TODO` and is not `BLOCKED`, do that task.
- Prefer UX polish and core-loop beta proof before building large new modules.
- Do not build `DEFERRED` features unless the PM/user explicitly asks for them.
- After every PR that changes feature status, UX, gameplay, tests, smoke, admin, liveops, or roadmap docs, update `docs/FEATURE_PROGRESS_TRACKER.md`.
