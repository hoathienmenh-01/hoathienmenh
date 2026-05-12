# Phase 22.1 — Ngũ Hành Build Depth Expansion

## Status

- Branch: `feat/phase-22-1-elemental-build-depth`
- PR target: Draft PR `feat(elemental): Phase 22.1 Ngũ Hành Build Depth Expansion`
- Scope: deepen Ngũ Hành gameplay build logic without expanding Book II–V story content.

## Guardrails

- Keep Phase 21 Book I story content intact.
- Do not add large Book II–V quest/chapter content in this PR.
- Keep elemental modifiers moderate; no element should auto-win.
- Keep spiritual-root/VIP root balance non-P2W.
- Avoid destructive migrations and full gem/socket/set-bonus implementation.

## Checkpoints

1. Audit current Ngũ Hành systems.
2. Shared elemental relationship rules.
3. Build recommendation helpers.
4. Skill combo/synergy rules.
5. Dungeon/boss resistance metadata.
6. Equipment elemental affinity hooks.
7. Elemental build guidance UI with vi/en parity.
8. Tests for rules, recommendation, boss resistance, synergy, and i18n parity.
9. Docs, changelog, and handoff.

## Design target

Phase 22.1 turns Ngũ Hành from static flavor into a shared meta-build layer:

- Kim: crit, armor pierce, precise burst.
- Mộc: healing, growth, poison/regen, sustain.
- Thủy: control, slow, debuff, evasion.
- Hỏa: burst damage, burn, damage over time.
- Thổ: shield, defense, reflect, endurance.

## Checkpoint 1 — Current Ngũ Hành audit

### Sources read

- `docs/START_HERE.md`, `docs/AI_WORKFLOW_RULES.md`, `docs/AI_HANDOFF_REPORT.md`.
- `docs/GAME_DESIGN_BIBLE.md`, `docs/BALANCE_MODEL.md`, `docs/ECONOMY_MODEL.md`, `docs/CONTENT_PIPELINE.md`, `docs/CHANGELOG.md`.
- `docs/story/TU_TIEN_LO_STORY_BIBLE.md`, `docs/phase-21-content-plan.md`.
- `packages/shared/src/elemental.ts`, `elemental-identity.ts`, `elemental-skills.ts`, `spiritual-root.ts`, `combat.ts`, `boss.ts`, `items.ts`.
- `apps/api/prisma/schema.prisma`, `apps/api/src/modules/character/*`, `apps/api/src/modules/dungeon-run/*`, `apps/api/src/modules/boss/*`.
- `apps/web/src/views/SpiritualRootView.vue`, `DungeonRunView.vue`, `BossView.vue`, `InventoryView.vue`, `SkillBookView.vue`.
- `apps/web/src/components/ElementBadge.vue`, `ElementIdentityPanel.vue`, `BossElementTooltip.vue`, `SkillTagBadge.vue`.
- `apps/web/src/i18n/vi.json`, `apps/web/src/i18n/en.json`.

### Existing implementation snapshot

- Shared already has `ElementKey = kim | moc | thuy | hoa | tho` and `ELEMENTS` in `combat.ts`.
- `elemental.ts` has `ElementType`, converters, `elementalAdvantage`, `elementalMultiplier`, monster resist composition, equipment elemental attack bonus composition, and capped combat adjustment.
- `balance-dials.ts` is the numeric source of truth for relation multipliers: counter `1.30`, generate `1.20`, same `0.90`, generated `0.85`, countered `0.70`, neutral `1.00`.
- `spiritual-root.ts` already models grade, primary element, secondary elements, purity, roll weights, affinity bonus, and the base relation functions `elementGenerates` / `elementOvercomes`.
- `elemental-skills.ts` already defines 5 element identities and skill tags for HEAL/DOT/BURST/SHIELD/CRIT/CONTROL.
- `elemental-identity.ts` already derives dungeon and boss element profiles plus player warnings.
- `combat.ts` / `boss.ts` / `items.ts` already include optional elemental metadata: dungeon/monster/boss element, boss weakness/resist hints, item `elementalAtkBonus`, and tribulation `elementResist`.
- Web already has reusable `ElementBadge`, `ElementIdentityPanel`, `BossElementTooltip`, and skill tag UI. Spiritual Root view shows root grade and element matrix, but does not yet provide complete build guidance.

### Gaps for Phase 22.1

- Required helper names are not all present yet: `ElementRelationship`, `getGeneratingElement`, `getGeneratedByElement`, `getCounterElement`, `getCounteredByElement`, `computeElementAdvantage`, `computeElementDamageModifier`, `computeElementResistanceModifier`, and `classifyElementMatchup`.
- There is no single build recommendation helper returning `mainElement`, `secondaryElement`, skill/stat recommendations, equipment element suggestion, and boss/dungeon counter warnings.
- Skill synergy currently exists as tags/identity only; there is no sequence/combo rule layer for same-element, generating, counter, and hybrid paths.
- Boss/dungeon element profiles are UI-friendly, but Phase 22.1 needs explicit shared resistance/weakness behavior helpers that recommendation can consume.
- Equipment has elemental attack/resist bonus fields, but no explicit optional `equipmentElement` affinity hook or recommendation helper.
- UI needs one consolidated Elemental Build Guidance panel with loading/empty/error states and vi/en parity.
