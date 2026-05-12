# Phase 21 — Story / Quest Content Expansion Plan

## Status

- Branch: `feat/phase-21-story-quest-content-expansion`
- PR target: Draft PR `feat(content): Phase 21 Story Quest Content Expansion Mega PR`
- Source audit: complete for Phase 21 planning; content below must keep following the cited canon.
- Official scope update: Phase 21 is now a mega content expansion targeting at
  least 8 gated chapters, 120 main quests, 160 side quests, 64 branch quests,
  40 hidden quests, 30 daily templates, 20 weekly templates, 100
  achievements/titles, 600 dialogue entries, and a 30–60 minute guided new
  player path. If the PR reaches minimums but not high targets, follow-up is
  **Phase 21B — Additional Story Content Pack**.

## Guardrails

- Use `docs/archive/original-docx/TuTienLo_Story_Bible.docx` and `docs/story/TU_TIEN_LO_STORY_BIBLE.md` as primary lore sources.
- Preserve established NPC, faction, realm, sect, Ngũ Hành, dungeon, boss, and twist canon.
- Expand content only where it follows the story bible and existing system constraints.
- Keep rewards bounded by current balance/economy models.
- Commit and push each checkpoint to the same Draft PR.

## Checkpoints

1. Story source audit.
2. Main story chapter catalog.
3. Main quest chains.
4. Side quest expansion.
5. NPC dialogue and affinity content.
6. Hidden quests and dungeon/boss lore.
7. Daily/weekly quests and achievements.
8. Story/Quest Journal UI.
9. Catalog integrity tests.
10. Docs and handoff.

## Story Source Audit

### Sources read

- `docs/archive/original-docx/TuTienLo_Story_Bible.docx` — owner-provided source archive. Extracted locally for audit only; not committed.
- `docs/story/TU_TIEN_LO_STORY_BIBLE.md` — canonical markdown story/design source for NPC, quest, reward, and world tone.
- `docs/story/PHASE12_STORY_PROGRESS.md` — implementation progress source; code on `main` remains runtime truth.
- `docs/START_HERE.md`, `docs/AI_WORKFLOW_RULES.md`, `docs/AI_HANDOFF_REPORT.md`, `docs/GAME_DESIGN_BIBLE.md`, `docs/CONTENT_PIPELINE.md`, `docs/BALANCE_MODEL.md`, `docs/ECONOMY_MODEL.md`, `docs/API.md`, `docs/RUNBOOK.md`, `docs/CHANGELOG.md`.

### World context

Tu Tiên Lộ is a long-form tu tiên path from Phàm Nhân to Hư Không Chí Tôn. The emotional center is Hoa Thiên Môn: an ancient, fallen sect that still protects the inheritance used to “mend heavenly dao”. The player begins as a mortal outer disciple, grows through realm progression, restores sect foundations, reconnects with NPCs, faces moral branches, ascends through larger world tiers, and ultimately confronts threats outside normal heavenly law.

### Main line

The main story begins in Nhân Gian Giới with Hoa Thiên Môn accepting a weak mortal disciple. The early arc must establish: entry into Hoa Thiên Môn, spiritual-root awakening, first cultivation, sect duties, the first traces of Tịch Linh khí, the seed/legacy hidden in the back mountain, and the first Ngũ Hành-coded dungeon/boss conflicts. Later escalation reveals Tịch Thiên Điện’s plan to lock cultivation paths and monopoly-control the great dao.

### Factions

- **Hoa Thiên Môn**: player’s home sect; poor and weakened but keeper of heavenly-mending inheritance.
- **Tịch Thiên Điện**: main antagonist faction; uses Tịch Linh Chủng, seals, infiltrators, and corrupted heavenly law.
- **Huyền Kiếm Tông**: rival sword sect; can become ally or enemy through Hàn Dạ.
- **Vạn Bảo Thương Hội**: neutral economic power; escort, market, auction, trade secrets.
- **Huyết Hà Ma Tông**: demonic-path faction; contains real evil and outcasts rejected by righteous sects.
- **Tiên Đình Bạch Đế**: later immortal-realm authority tied to Tịch Thiên.

### Key NPCs

- **Lăng Vân Sinh**: Hoa Thiên Môn master; gentle, poor, deep; keeper of the last inheritance fragment.
- **Mộc Thanh Y**: senior sister; strict and warm; Tịch Linh Chủng corruption drives a long rescue arc.
- **Hàn Dạ**: Huyền Kiếm rival; honor-bound sword cultivator; friendship/rivalry/enmity branch.
- **Tô Nguyệt Ly**: exiled Hoa Thiên descendant; knows erased inheritance history and hidden relic paths.
- **Huyết La Sát**: rejected demonic cultivator and former Hoa Thiên disciple; moral-choice bridge into dark truths.
- **Vạn Kim Nương**: Vạn Bảo operator; sharp, practical, and tied to market/escort information.
- **Bạch Đế Tử**: false-noble immortal guide; later antagonist linked to Tịch Thiên.
- **Hoa Thiên Đạo Tổ**: ancient founder whose seal blocks Vô Đạo Chủng.
- **Tịch Thiên Đạo Chủ**: final philosophical antagonist who locks dao because he believes beings will self-destroy.

### Antagonists and twist material

Tịch Thiên Điện is not a simple monster faction; it carries a philosophical conflict about whether beings should be allowed to pursue dao freely. Early traces appear as Tịch Linh khí and Tịch Linh Chủng corruption in fields, roots, NPC memories, dungeons, and boss identities. The larger twist is that Hoa Thiên’s erased branches, Huyết La Sát’s past, Bạch Đế Tử’s false guidance, and Hoa Thiên Đạo Tổ’s living seal all point to a hidden war over who gets to define heavenly law.

### Chapter milestones for Phase 21

Phase 21 should focus on the first 30–60 minute and early-to-mid mortal-realm path:

1. **Phàm Nhân Nhập Đạo** — onboarding, Hoa Thiên admission, guided path, first daily/quest rhythm.
2. **Linh Căn Thức Tỉnh** — spiritual-root discovery, first cultivation method/skill, Mộc Thanh Y tutorial pressure.
3. **Tông Môn Sơ Khởi** — sect duties, contribution, first social/party introduction.
4. **Bí Cảnh Huyết Nguyệt** — hidden well/old village branch, Ngũ Hành puzzle, dungeon/boss lore.
5. **Ma Tu Xuất Thế** — Huyết La Sát moral-choice line, righteous/demonic ambiguity, hidden quest unlocks.
6. **Ngũ Hành Thiên Mệnh** — elemental identity, co-op/party escalation, Tịch Thiên signal revealed.

### Existing runtime/code baseline

Current `main` already has static shared catalogs and runtime for quests, NPCs, story dialogue, story dungeons, missions, achievements, titles, party/co-op, boss, dungeon-run, and reward services. Phase 21 should reuse these instead of rewriting systems:

- `packages/shared/src/quests.ts` currently has early story quest definitions and `QuestDef`.
- `apps/api/src/modules/quest/*` exposes `GET /quests/me`, `POST /quests/accept`, `POST /quests/progress`, `POST /quests/claim`.
- `packages/shared/src/story-dialogues.ts`, `npcs.ts`, `npc-affinity.ts`, `npc-hidden-unlocks.ts`, and `npc-relationship-quest-chains.ts` already model NPC, dialogue, affinity, and hidden unlock foundations.
- `packages/shared/src/story-dungeons.ts`, `combat.ts`, `boss.ts`, `missions.ts`, `achievements.ts`, and `titles.ts` are the safest Phase 21 extension points.

### Conflicts / follow-ups

- The owner asked to read the DOCX source directly. Repo docs normally say the markdown story bible is sufficient and the DOCX is archive-only. For this PR, the DOCX was read as requested; the markdown bible remains the working source because it mirrors the DOCX and links to implementation progress.
- The PR template recommends large PRs stay ≤35 files / ≤1800 lines, while the owner explicitly requested a Phase 21 mega PR. This PR will remain one Draft PR, but each checkpoint is a separate commit/push to keep reviewable.
- Existing runtime `QuestDef` does not yet have explicit `chapterKey`, `previousQuestKey`, or `nextQuestKey` fields. Phase 21 should add additive metadata/catalog helpers rather than destructive schema changes.

## Phase 21 Expanded Gate + Reward Balance Addendum

### Canon source labels

- `CANON_FROM_STORY_BIBLE`: Hoa Thiên Môn as home sect; Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ, Tô Nguyệt Ly, Huyết La Sát, Tịch Thiên Điện, Huyết Hà Ma Tông, Tiên Đình Bạch Đế, Hoa Thiên Đạo Tổ, Tịch Thiên Đạo Chủ, Tịch Linh Chủng, Hạt Giống Vô Danh, Ngũ Hành, Bí Cảnh Huyết Nguyệt, and the moral tension around locking or freeing đại đạo.
- `AI_EXPANDED_LORE`: extra branch quests, hidden triggers, minor relics, extra dungeon beats, extra achievement/title names, and filler NPC-facing incidents used to reach Phase 21 content targets. These expansions must not change the role of canon NPCs or reorder the six canon early chapters.
- If AI-expanded content introduces a new relic/secret/dungeon, it must cite the canon anchor it extends, for example: Hoa Thiên poverty, Tịch Linh corruption, Ngũ Hành rite, Huyết Hà moral ambiguity, or erased Hoa Thiên inheritance.

### AI-expanded lore ledger

All entries below are additive and exist to turn canon beats into playable
long-form content without changing canon roles, villains, or chapter order:

| AI_EXPANDED_LORE content | Why needed | Canon anchor | Gameplay opened |
|---|---|---|---|
| Outer-court poverty incidents, ration ledgers, broken sword sheaths, debt tablets | Give side quests human stakes beyond kill/fetch loops | Hoa Thiên Môn is poor but keeps dao inheritance | Side quests, NPC affinity, early guided path |
| Minor Ngũ Hành relic shards and resonance choices | Let each element appear before late-game systems | Linh căn / Ngũ Hành awakening | Branch quests, hidden triggers, dialogue state |
| Huyết Nguyệt aftermath memories and village ghost debts | Expand the Blood Moon arc without changing the dungeon’s core mystery | Bí Cảnh Huyết Nguyệt and erased Hoa Thiên history | Hidden quests, lore fragments, boss aftermath |
| Hàn Dạ duel etiquette and Huyền Kiếm messenger disputes | Add moral/sect branching around rival righteous sects | Hàn Dạ + Huyền Kiếm Tông rivalry | Branch quests, NPC affinity, title unlocks |
| Vạn Bảo caravan rumors and capped market errands | Add economy-flavored quests without monetization or trade/gift systems | Vạn Bảo Thương Hội neutrality | Side quests, daily/weekly templates |
| Huyết Hà witness testimonies and false accusations | Turn demonic-path ambiguity into choices | Huyết La Sát and Huyết Hà Ma Tông | Branch/hidden quests, đạo tâm flags |
| Tịch Linh probe events and corrupted field symptoms | Foreshadow the main antagonist through repeatable but capped content | Tịch Thiên Điện / Tịch Linh Chủng | Main gates, daily/weekly templates, integrity tests |
| A Linh onboarding hints | Ensure first 30–60 minutes are self-explanatory | Game bible: A Linh onboarding fantasy | Guided path, dialogue, quest journal |

### Chapter gate model

Chapters must not unlock only because the previous quest is complete. Each chapter should have a static `unlockGate` catalog entry that combines story and power conditions:

| Gate field | Current Phase 21 handling |
|---|---|
| `requiredRealmKey` / `requiredRealmOrder` | Use existing realm catalog. Required for every chapter. |
| `requiredCultivationStage` | Additive catalog metadata. Runtime enforcement can follow after cultivation stage is exposed to story APIs. |
| `requiredBattlePower` | Additive catalog metadata. Runtime enforcement follow-up if current APIs do not expose battle power in chapter list. |
| `requiredMainQuestKey` | Use `QuestDef` keys. Required from chapter 2 onward. |
| `previousChapterKey` | Additive catalog metadata for journal rendering and integrity tests. |
| `requiredStoryFlag` | Additive catalog metadata; generated from quest/dungeon/boss story beats. |
| `requiredDungeonClearKey` | Additive catalog metadata; points to `STORY_DUNGEONS[].key` when chapter depends on bí cảnh clear. |
| `requiredBossDefeatedKey` | Additive catalog metadata; points to `BOSSES[].key` when chapter depends on boss defeat. |
| `requiredSectRank` | Additive metadata for sect-heavy chapters; runtime follow-up if sect rank is not yet queryable. |
| `requiredElementalAffinity` | Additive metadata for Ngũ Hành chapters; runtime follow-up if elemental affinity is not yet tracked. |

Runtime rule target:

```text
chapter available =
  story prerequisite satisfied
  AND realm/cultivation gate satisfied
  AND battle-power gate satisfied when available
  AND linked dungeon/boss/sect/elemental gates satisfied when defined
```

If a gate cannot be runtime-enforced in this PR, the catalog and integrity tests must still define it, and docs/handoff must mark it as `catalog_seeded_runtime_follow_up`.

### Expanded content targets

The owner raised Phase 21 from a small early-content expansion to a mega content catalog. Targets for the final PR:

| Content type | Minimum | Target |
|---|---:|---:|
| Chapters | 8 | 8–10 |
| Main quests | 120 | 140–180 |
| Side quests | 160 | 200–320 |
| Branch quests | 64 | 80–120 |
| Hidden quests | 40 | 60–80 |
| Daily quest templates | 30 | 30+ |
| Weekly quest templates | 20 | 20+ |
| Achievements/titles | 100 | 100+ |
| NPC dialogue entries/nodes | 600 | 600+ |

Per-chapter content shape:

- 15–20 main quests.
- 20–40 side quests.
- 8–15 branch quests.
- 5–10 hidden quests.
- 3–5 achievements/titles.
- 1–3 dungeon/boss/story gates.

### Reward balance ratios

Phase 21 rewards use main quest reward as each chapter’s baseline:

| Quest/content type | Resource reward ratio | Reward identity |
|---|---:|---|
| Main quest | 100% baseline | cultivation EXP, moderate Linh Thạch, story item, skill fragment, chapter/dungeon/boss unlock. |
| Side quest | 25–45% | light EXP/Linh Thạch, common item, small sect contribution, NPC affinity, lore fragment. |
| Branch quest | 35–60% | choice flag, title hint, NPC affinity, dialogue/quest unlock, small utility item. |
| Hidden quest | 20–50% | achievement/title/lore/cosmetic-style reward first; low currency only. |
| Daily template | small capped | repeatable habit reward, never a primary farm source. |
| Weekly template | moderate capped | weekly checklist reward, below main-story pacing. |

Caps to enforce in tests for new Phase 21 content:

- Side/branch/hidden quest currency must stay below same-chapter main quest currency unless explicitly documented as a one-time rare exception.
- Hidden quest currency should be low; its value is discovery/title/lore.
- Daily/weekly templates must include reset cadence and cap metadata if the current mission system supports it; otherwise docs must flag follow-up.
- No quest should grant reward directly through ad-hoc runtime mutation; all runtime reward grants must continue using existing quest/mission reward services.

### Quality bar for generated expansion

Every new quest entry should encode:

1. why it appears,
2. the NPC/event/source,
3. the objective,
4. the completion consequence,
5. balanced reward intent,
6. chapter/NPC/lore/gameplay binding,
7. `CANON_FROM_STORY_BIBLE` or `AI_EXPANDED_LORE` source label in docs/tests where the catalog has no field for it.
