# Phase 34 Campaign Plan — Onboarding + Daily Encounter + Secret Realm + Inventory QoL + Loadout Preset

> **Status**: planning. Created on branch `feat/phase-34-campaign-plan` to land
> as a docs-only PR before any code branches are cut. After this plan PR
> merges, each Phase 34.x is implemented in its own branch (NOT stacked, NOT
> a mega-PR).

---

## 1. Context — Post Phase 33

Tu Tiên Lộ Quyển II–IV catalog + runtime + UI + deep-wire đã merge:

- **PR #564 (Phase 33.0)** — catalog foundation 19 chapter / 209 quest /
  2014 dialogue, 7 NPC mới, doc series Quyển II–IV.
- **PR #567 (Phase 33.0B+0C)** — catalog hardening 722 quest (16 main / 11
  side / 6 branch / 3 hidden / 1 daily / 1 weekly per chapter) + core
  dialogue core (~2000 entry).
- **PR #573 (Phase 33.1+33.2+33.3)** — Prisma additive (3 bảng
  `CharacterStoryV2*`) + `Phase33StoryService` 8 method + 7 endpoint
  `/story/v2/*` + Vue3 `StoryV2View.vue` + i18n VI/EN + combat/dungeon deep
  wire fail-soft hook.

**Phase 34** mở 5 hệ thống retention / QoL độc lập, không phá Story Runtime.

## 2. Goals

| Phase | Goal | Player Value |
|-------|------|--------------|
| 34.0 | 7-Day Onboarding Questline | New-player friction giảm; teach feature dần. |
| 34.1 | Daily Random Encounter (Kỳ Ngộ) | Daily login retention; small surprise/decision moment. |
| 34.2 | Secret Realm Runtime (Bí Cảnh) | Mid/late-game dungeon variety; nền cho pet/pháp bảo drop. |
| 34.3 | Inventory Auto-sort + Lock | Tránh bán/phân giải nhầm; QoL cho high-stack inventory. |
| 34.4 | Loadout Preset (PvE/PvP/Boss) | Quick-swap build; combat/PvP convenience. |

## 3. PR Order (NOT stacked — each branched from latest `main`)

Per user mandate "Không gộp tất cả vào 1 PR khổng lồ":

```
main
  ├── feat/phase-34-campaign-plan         (this PR — docs only)
  ├── feat/phase-34-0-onboarding-7-day    (PR 34.0)
  ├── feat/phase-34-3-inventory-autosort-lock  (PR 34.3)
  ├── feat/phase-34-4-loadout-preset      (PR 34.4)
  ├── feat/phase-34-1-daily-random-encounter   (PR 34.1)
  └── feat/phase-34-2-secret-realm-runtime     (PR 34.2)
```

**Priority** (per Phase 34 prompt — nếu credit/time chỉ đủ một phần):

1. **34.0 Onboarding** — highest new-player impact.
2. **34.3 Inventory QoL** — universal benefit, low risk.
3. **34.4 Loadout** — combat convenience, additive.
4. **34.1 Kỳ Ngộ** — daily retention.
5. **34.2 Bí Cảnh** — depends on dungeon/world wire maturity.

Each PR rebased onto latest `main` at branch creation to avoid stacking on
the previous Phase 34 branch (so order can flex if a PR stalls).

## 4. Risk / Conflict Matrix

| PR | Module touched | Risk | Phase 12/33 conflict |
|----|---------------|------|----------------------|
| 34.0 | `onboarding/*` new module + `character/*` (read tier/realm) | 🟢 low — additive module, no quest table mutation | None — no `QuestProgress` write; if quest gating needed, READ only via `Phase33StoryService.listQuestsForChapter`. |
| 34.1 | `encounters/*` new module + `world-map/*` (read region) | 🟢 low — additive table + idempotent dateKey | None — does NOT mutate story flag (encounter journal stored in own `CharacterDailyEncounter.journalJson`). |
| 34.2 | `secret-realm/*` new module + `dungeon-run/*` (optional ref) + `boss/*` (optional ref) | 🟡 med — overlaps `DungeonRunService` if boss ref shared | Mitigation: `secretRealmKey` field on `BossDef` is **optional**; if missing → `UNWIRED` flag, not crash. |
| 34.3 | `inventory/*` extend + `CharacterInventoryItemLock` table | 🟢 low — additive table, no migration on `CharacterInventoryItem` | None — sell/disassemble already checks `lockedAt`; just enforce via service. |
| 34.4 | `loadout/*` new module + `equipment/*` (read item ownership) | 🟡 med — `apply` mutates `CharacterEquipment` slots | Mitigation: apply transactional + validate ownership/realm; if combat snapshot consumes loadout, gate behind feature flag in this PR. |

## 5. Reward / Economy Guardrails

Per repo policy + Phase 34 prompt:

- **NO direct currency mutation** — every reward goes through `CurrencyService.applyTx()` with explicit ledger reason.
- **NO `tienNgoc` mint** — premium hard currency stays 0 in all Phase 34 reward grants (`tienNgoc = 0` enforced server-side).
- **NO endgame item grant** — `FORBIDDEN_REWARD_ITEM_KEYS` enforcement preserved.
- **NO inventory direct insert** — every item grant through `InventoryService.grantTx()`.
- **Quest/story-important item** auto-`bind: true` if schema supports.
- **Reward cap per realm/tier** — clamp via existing `getStoryRewardBudgetForChapter()` pattern.
- **Idempotency** — all `claim` endpoints use CAS `updateMany({status:'COMPLETED'})` → `CLAIMED` (mirror Phase 33 pattern).
- **Anti double-click** — controller validates `submittingKey` server-side (defense in depth alongside FE disable).

### Ledger reasons (new, additive)

| Reason | Source | Caps |
|--------|--------|------|
| `ONBOARDING_DAY_REWARD_CLAIM` | PR 34.0 | per-day cap; cumulative ≤ 7 days |
| `DAILY_ENCOUNTER_REWARD_CLAIM` | PR 34.1 | per-day-per-character cap |
| `SECRET_REALM_RUN_REWARD_CLAIM` | PR 34.2 | per-run cap; cooldown-gated |

## 6. Prisma Migration Plan

Every PR additive only (no `ALTER` on Phase 12 / Phase 33 tables):

| PR | New tables | New enums |
|----|-----------|-----------|
| 34.0 | `CharacterOnboardingProgress`, `CharacterOnboardingTaskProgress` | `OnboardingTaskStatus` |
| 34.1 | `CharacterDailyEncounter` | `DailyEncounterStatus`, `DailyEncounterRarity` |
| 34.2 | `CharacterSecretRealmRun` | `SecretRealmRunStatus` |
| 34.3 | `CharacterInventoryItemLock` | none |
| 34.4 | `CharacterLoadoutPreset` | `LoadoutPresetType` |

Each migration follows existing additive pattern: `apps/api/prisma/migrations/<UTC_TS>_phase_34_<n>_<feature>/migration.sql`.

## 7. Tests Required Per PR

Per Test Fast Path Rule (`docs/QA_CHECKLIST.md` §A):

- **Shared catalog change** → `pnpm --filter @xuantoi/shared test`
- **API service/controller** → `pnpm --filter @xuantoi/api test`
- **Web view** → `pnpm --filter @xuantoi/web test`
- **Always** → `pnpm typecheck` + `pnpm lint` + `pnpm build`

Per-PR target test scope:

| PR | shared | api | web |
|----|--------|-----|-----|
| 34.0 | catalog onboarding day def | OnboardingService + controller + integration | OnboardingPanel smoke |
| 34.1 | encounter catalog | EncounterService + controller | encounter daily card |
| 34.2 | secret realm catalog | SecretRealmService + controller | secret realm list view |
| 34.3 | (none) | InventoryService lock extend + controller | InventoryView sort/lock |
| 34.4 | (none) | LoadoutService + controller | LoadoutPresetPanel |

## 8. CI Expectation

Every Phase 34 PR:
- Build / verify-deploy / e2e-smoke / Playwright golden path = 7/7 PASS (mirror Phase 33 baseline)
- Typecheck + lint clean
- No `it.skip` / `xdescribe` / `expect(true).toBe(true)` (no fake green)
- No `.github/workflows/*` change

## 9. Rollback Plan

| PR | Rollback path |
|----|---------------|
| 34.0 | revert + `prisma migrate resolve` drop `CharacterOnboardingProgress*` (no FK back to character mass tables) |
| 34.1 | revert + drop `CharacterDailyEncounter` |
| 34.2 | revert + drop `CharacterSecretRealmRun` |
| 34.3 | revert + drop `CharacterInventoryItemLock` (item rows unchanged) |
| 34.4 | revert + drop `CharacterLoadoutPreset` (equipment slots unchanged) |

All additive — no Phase 12 / Phase 33 data loss on revert.

## 10. Forbidden Actions (mirror Phase 33 mandate)

- NO push to `main`; NO force push outside own branch.
- NO skip pre-commit hooks (`--no-verify`).
- NO disabling CI / changing `.github/workflows/*`.
- NO rewriting `/story/v2/*` API or mutating `Phase33StoryService`.
- NO mutating `story-quest-expansion.ts` / `story-quest-dialogues.ts`
  catalog.
- NO direct currency / item mint outside `CurrencyService` / `InventoryService`.
- NO endgame item grant via onboarding / encounter / realm / loadout claim.
- NO premium `tienNgoc` mint in any Phase 34 reward grant.
- NO `it.skip` / `xdescribe` / no-op assertion to fake green.
- NO claim "Done" while CI pending or tests un-run.

## 11. Docs to Update Per PR

Mandatory in same commit:
- `docs/AI_HANDOFF_REPORT.md` (current entry → previous demote)
- `docs/API.md` (if endpoint added)
- Feature-specific doc:
  - `docs/onboarding-7-day.md`
  - `docs/random-encounter-ky-ngo.md`
  - `docs/secret-realm-runtime.md`
  - `docs/loadout-presets.md`
  - `docs/inventory-qol.md`

## 12. Done When

- 5 Phase 34 PRs merged (34.0 + 34.1 + 34.2 + 34.3 + 34.4) OR explicit user decision to defer remaining priority.
- No code/docs/tests local without push.
- 7/7 CI green per PR.
- `docs/AI_HANDOFF_REPORT.md` reflects final Phase 34 state.
- Phase 12 / Phase 33 regression: zero (verified by CI + spot-check).
