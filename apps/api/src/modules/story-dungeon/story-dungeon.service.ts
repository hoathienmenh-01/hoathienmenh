import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  bossByKey,
  monsterByKey,
  realmByKey,
  STORY_DUNGEONS,
  storyDungeonByKey,
  computeStoryDungeonStatus,
  type BossDef,
  type MonsterDef,
  type QuestStateForStoryDungeon,
  type StoryDungeonAvailabilityStatus,
  type StoryDungeonRewardHint,
  type StoryDungeonTemplateDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 12.8.A — Story Dungeon read-only API service.
 *
 * Trách nhiệm:
 *   - Trả về catalog snapshot `STORY_DUNGEONS` (filter `enabled=true`).
 *   - Compute status `locked / available / cleared` per template từ
 *     `QuestProgress` (read-only) + `Character.realmKey` (qua `realmByKey`).
 *   - Hydrate boss/monster preview cho FE list (kèm tên + element + rarity).
 *
 * KHÔNG làm trong Phase 12.8.A:
 *   - KHÔNG mutate runtime (start / advance / claim) — phase 12.8.B sẽ wire.
 *   - KHÔNG re-enter `QuestService` / `DungeonRunService`.
 *   - KHÔNG ghi `RewardLedger` — `rewardHint` chỉ là catalog hint.
 *
 * Server-authoritative invariants:
 *   - Auth: caller phải có `Character` row (controller resolve `userId`
 *     qua cookie `xt_access`, service lookup `prisma.character.findUnique`).
 *     Throw `StoryDungeonError('NO_CHARACTER')` nếu không có.
 *   - Status compute: dựa thuần vào `QuestProgress.status` + step progress
 *     (`stepProgress` JSON) + `Character.realmKey.order`. KHÔNG cộng/trừ
 *     state phía service.
 *   - Filter `enabled=false` ngay từ list (FE không thấy template tắt).
 *     `getByKey` vẫn return template `enabled=false` với 404 (`DUNGEON_NOT_FOUND`)
 *     — invariant thống nhất với pattern catalog flag (admin-only).
 */

export class StoryDungeonError extends Error {
  constructor(public code: 'NO_CHARACTER' | 'DUNGEON_NOT_FOUND') {
    super(code);
  }
}

export interface StoryDungeonMonsterPreview {
  key: string;
  name: string;
  element?: string | null;
  level?: number | null;
}

export interface StoryDungeonBossPreview {
  key: string;
  name: string;
  recommendedRealm: string;
  regionKey?: string | null;
}

export interface StoryDungeonView {
  key: string;
  titleI18nKey: string;
  descriptionI18nKey: string;
  titleVi: string;
  descriptionVi: string;
  requiredQuestKey: string;
  requiredQuestStep: string | null;
  regionKey: string;
  recommendedRealm: string;
  minRealmKey: string | null;
  npcKey: string | null;
  entryDialogueKey: string | null;
  clearDialogueKey: string | null;
  monsters: StoryDungeonMonsterPreview[];
  boss: StoryDungeonBossPreview | null;
  rewardHint: StoryDungeonRewardHint | null;
  oneTime: boolean;
  status: StoryDungeonAvailabilityStatus;
}

interface CharCtx {
  characterId: string;
  realmOrder: number;
  questStateByKey: Map<string, QuestStateForStoryDungeon>;
  questStepProgressByKey: Map<string, Record<string, number>>;
}

function readStepProgressJson(raw: Prisma.JsonValue | null | undefined): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = Math.floor(v);
    }
  }
  return out;
}

function monsterPreview(m: MonsterDef): StoryDungeonMonsterPreview {
  return {
    key: m.key,
    name: m.name,
    element: m.element ?? null,
    level: typeof m.level === 'number' ? m.level : null,
  };
}

function bossPreview(b: BossDef): StoryDungeonBossPreview {
  return {
    key: b.key,
    name: b.name,
    recommendedRealm: b.recommendedRealm,
    regionKey: b.regionKey ?? null,
  };
}

function buildView(
  template: StoryDungeonTemplateDef,
  status: StoryDungeonAvailabilityStatus,
): StoryDungeonView {
  const monsters: StoryDungeonMonsterPreview[] = [];
  for (const mk of template.monsterKeys) {
    const m = monsterByKey(mk);
    if (m) monsters.push(monsterPreview(m));
  }
  const boss = template.bossKey ? bossByKey(template.bossKey) : undefined;
  return {
    key: template.key,
    titleI18nKey: template.titleI18nKey,
    descriptionI18nKey: template.descriptionI18nKey,
    titleVi: template.titleVi,
    descriptionVi: template.descriptionVi,
    requiredQuestKey: template.requiredQuestKey,
    requiredQuestStep: template.requiredQuestStep ?? null,
    regionKey: template.regionKey,
    recommendedRealm: template.recommendedRealm,
    minRealmKey: template.minRealmKey ?? null,
    npcKey: template.npcKey ?? null,
    entryDialogueKey: template.entryDialogueKey ?? null,
    clearDialogueKey: template.clearDialogueKey ?? null,
    monsters,
    boss: boss ? bossPreview(boss) : null,
    rewardHint: template.rewardHint ?? null,
    oneTime: template.oneTime,
    status,
  };
}

@Injectable()
export class StoryDungeonService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<StoryDungeonView[]> {
    const ctx = await this.loadCtx(userId);
    return STORY_DUNGEONS.filter((t) => t.enabled).map((t) =>
      buildView(t, this.computeStatus(t, ctx)),
    );
  }

  async getByKey(userId: string, key: string): Promise<StoryDungeonView> {
    const template = storyDungeonByKey(key);
    if (!template || !template.enabled) {
      throw new StoryDungeonError('DUNGEON_NOT_FOUND');
    }
    const ctx = await this.loadCtx(userId);
    return buildView(template, this.computeStatus(template, ctx));
  }

  private computeStatus(
    template: StoryDungeonTemplateDef,
    ctx: CharCtx,
  ): StoryDungeonAvailabilityStatus {
    return computeStoryDungeonStatus(template, {
      realmOrder: ctx.realmOrder,
      questStateByKey: ctx.questStateByKey,
      questStepProgress: ctx.questStepProgressByKey,
    });
  }

  private async loadCtx(userId: string): Promise<CharCtx> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new StoryDungeonError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;
    const rows = await this.prisma.questProgress.findMany({
      where: { characterId: char.id },
      select: { questKey: true, status: true, stepProgress: true },
    });
    const questStateByKey = new Map<string, QuestStateForStoryDungeon>();
    const questStepProgressByKey = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const status = r.status as string;
      // Map Prisma `QuestStatus` (LOCKED|AVAILABLE|ACCEPTED|COMPLETED|CLAIMED)
      // → `QuestStateForStoryDungeon` (NOT_STARTED|AVAILABLE|ACCEPTED|COMPLETED|CLAIMED).
      // `LOCKED` collapse vào NOT_STARTED (compute coi như chưa qualify).
      switch (status) {
        case 'AVAILABLE':
        case 'ACCEPTED':
        case 'COMPLETED':
        case 'CLAIMED':
          questStateByKey.set(r.questKey, status);
          break;
        default:
          questStateByKey.set(r.questKey, 'NOT_STARTED');
      }
      questStepProgressByKey.set(r.questKey, readStepProgressJson(r.stepProgress));
    }
    return {
      characterId: char.id,
      realmOrder,
      questStateByKey,
      questStepProgressByKey,
    };
  }
}
