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
