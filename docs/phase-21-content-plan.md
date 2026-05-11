# Phase 21 — Story / Quest Content Expansion Plan

## Status

- Branch: `feat/phase-21-story-quest-content-expansion`
- PR target: Draft PR `feat(content): Phase 21 Story Quest Content Expansion Mega PR`
- Source audit: complete for Phase 21 planning; content below must keep following the cited canon.

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
