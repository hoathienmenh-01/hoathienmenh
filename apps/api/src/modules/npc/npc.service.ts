import { Injectable, Optional } from '@nestjs/common';
import {
  DIALOGUES,
  NPCS,
  npcByKey,
  realmByKey,
  type DialogueLineDef,
  type DialogueChoiceDef,
  type NpcDef,
  type NpcFaction,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';

/**
 * Phase 12 Story PR-4 — NPC dialogue UI runtime.
 *
 * Service consume `NPCS` + `DIALOGUES` static catalog (PR-1 #425) + `QuestProgress`
 * runtime (PR-2 #426) để render dialogue đúng theo realm + quest status của character
 * hiện tại. Tất cả logic filter / pick branch chạy server-side — FE chỉ render.
 *
 * Endpoint kèm controller (`npc.controller.ts`):
 *   - `GET /npcs/me` — list NPC visible (gate `realmGateOrder <= character.realmOrder`).
 *   - `GET /npcs/:npcKey/dialogue` — pick dialogue line phù hợp + annotate choices.
 *
 * Branch picker order (specific → general):
 *   1. `quest_status` (cụ thể nhất — phụ thuộc QuestProgress).
 *   2. `realm_min` (cao xuống thấp).
 *   3. `faction_member` — placeholder (chưa có Character.faction; PR sau wire).
 *   4. `always` (fallback).
 *
 * Wire điểm quan trọng: dialogue UI KHÔNG tự cộng quest progress / cộng reward —
 * choice với `acceptQuestKey` chỉ là HINT cho FE gọi `POST /quests/accept` (server-
 * authoritative). Modal sẽ refetch sau accept để cập nhật choice availability.
 */

export class NpcError extends Error {
  constructor(
    public code: 'NO_CHARACTER' | 'NPC_UNKNOWN' | 'NPC_LOCKED_REALM' | 'NO_DIALOGUE',
  ) {
    super(code);
  }
}

/** Status snapshot của 1 quest mà choice đang reference (`acceptQuestKey`). */
export type ChoiceQuestStatus =
  | 'NOT_STARTED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED'
  | 'LOCKED';

export interface NpcDialogueChoiceView {
  key: string;
  label: string;
  /** Dialogue id để navigate tiếp (hiện tại catalog chưa dùng — reserved). */
  nextDialogueId: string | null;
  /** Quest key NPC giao khi click — server sẽ POST /quests/accept. */
  acceptQuestKey: string | null;
  /**
   * Status của quest tại lúc list — FE dùng để hide / disable choice
   * tránh accept lần 2. `null` nếu choice không có acceptQuestKey.
   */
  acceptQuestStatus: ChoiceQuestStatus | null;
  closeDialogue: boolean;
}

export interface NpcDialogueView {
  dialogueId: string;
  speakerNpcKey: string;
  text: string;
  choices: NpcDialogueChoiceView[];
}

export interface NpcView {
  key: string;
  name: string;
  faction: NpcFaction | null;
  realmGateOrder: number;
  description: string;
  loreSummary: string;
  /** `questCount` để FE hiển thị badge "X quest". */
  questCount: number;
  /** Default dialogue khi NPC này click vào — đã filter realm + quest status. */
  dialogue: NpcDialogueView | null;
}

interface CharCtx {
  characterId: string;
  realmOrder: number;
  faction: NpcFaction | null;
  questStatusByKey: Map<string, ChoiceQuestStatus>;
}

function specificityScore(line: DialogueLineDef): number {
  switch (line.condition.kind) {
    case 'quest_status':
      return 4;
    case 'realm_min':
      return 3 + line.condition.realmOrder * 0.01;
    case 'faction_member':
      return 2;
    case 'always':
      return 1;
  }
}

function questProgressStatusFromRow(
  status: string | null | undefined,
): ChoiceQuestStatus {
  if (!status) return 'NOT_STARTED';
  switch (status) {
    case 'LOCKED':
    case 'AVAILABLE':
    case 'ACCEPTED':
    case 'COMPLETED':
    case 'CLAIMED':
      return status;
    default:
      return 'NOT_STARTED';
  }
}

function dialogueQuestStatusMatches(
  cond: { status: 'available' | 'accepted' | 'completed' | 'claimed' },
  current: ChoiceQuestStatus,
): boolean {
  switch (cond.status) {
    case 'available':
      return current === 'AVAILABLE' || current === 'NOT_STARTED';
    case 'accepted':
      return current === 'ACCEPTED';
    case 'completed':
      return current === 'COMPLETED';
    case 'claimed':
      return current === 'CLAIMED';
  }
}

function lineMatches(line: DialogueLineDef, ctx: CharCtx): boolean {
  switch (line.condition.kind) {
    case 'always':
      return true;
    case 'realm_min':
      return ctx.realmOrder >= line.condition.realmOrder;
    case 'quest_status': {
      const cur = ctx.questStatusByKey.get(line.condition.questKey) ?? 'NOT_STARTED';
      return dialogueQuestStatusMatches(line.condition, cur);
    }
    case 'faction_member':
      // `Character.faction` chưa tồn tại — return false để fallback sang line khác.
      // Khi faction state có (Phase 13?), update logic ở đây.
      return ctx.faction !== null && ctx.faction === line.condition.faction;
  }
}

function annotateChoice(
  choice: DialogueChoiceDef,
  ctx: CharCtx,
): NpcDialogueChoiceView {
  const acceptKey = choice.acceptQuestKey ?? null;
  return {
    key: choice.key,
    label: choice.label,
    nextDialogueId: choice.nextDialogueId ?? null,
    acceptQuestKey: acceptKey,
    acceptQuestStatus: acceptKey
      ? (ctx.questStatusByKey.get(acceptKey) ?? 'NOT_STARTED')
      : null,
    closeDialogue: choice.closeDialogue ?? false,
  };
}

@Injectable()
export class NpcService {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 44.2 — Onboarding auto-track NPC_TALK. Optional inject — legacy
    // test bootstrap không có OnboardingQuestModule sẽ skip silent.
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  /**
   * List tất cả NPC mà character đang thấy (realmGateOrder <= character.realmOrder),
   * đính kèm `dialogue` đã filter branch theo realm + quest status.
   */
  async listForUser(userId: string): Promise<NpcView[]> {
    const ctx = await this.loadCtx(userId);
    const visible = NPCS.filter((n) => n.realmGateOrder <= ctx.realmOrder);
    return visible.map((n) => this.buildView(n, ctx));
  }

  /**
   * Pick dialogue đang áp dụng cho NPC. Throw `NPC_UNKNOWN` nếu key sai;
   * `NPC_LOCKED_REALM` nếu character chưa đạt realmGateOrder; `NO_DIALOGUE`
   * nếu catalog không có line nào match (lý thuyết không xảy ra với current
   * catalog vì mỗi NPC có ít nhất 1 line `always` hoặc `realm_min` thoả).
   */
  async getDialogueForNpc(userId: string, npcKey: string): Promise<NpcDialogueView> {
    const npc = npcByKey(npcKey);
    if (!npc) throw new NpcError('NPC_UNKNOWN');
    const ctx = await this.loadCtx(userId);
    if (npc.realmGateOrder > ctx.realmOrder) {
      throw new NpcError('NPC_LOCKED_REALM');
    }
    const dialogue = this.pickDialogue(npc, ctx);
    if (!dialogue) throw new NpcError('NO_DIALOGUE');
    // Phase 44.2 — Onboarding auto-track NPC_TALK. Fire-and-forget;
    // recordAction wrap try-catch nội bộ nên upstream KHÔNG fail.
    if (this.onboarding) {
      void this.onboarding.notifyAction(ctx.characterId, 'NPC_TALK');
    }
    return dialogue;
  }

  private buildView(npc: NpcDef, ctx: CharCtx): NpcView {
    return {
      key: npc.key,
      name: npc.name,
      faction: npc.faction,
      realmGateOrder: npc.realmGateOrder,
      description: npc.description,
      loreSummary: npc.loreSummary,
      questCount: npc.questKeys.length,
      dialogue: this.pickDialogue(npc, ctx),
    };
  }

  private pickDialogue(npc: NpcDef, ctx: CharCtx): NpcDialogueView | null {
    const candidates = DIALOGUES.filter((d) => d.speakerNpcKey === npc.key);
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => specificityScore(b) - specificityScore(a));
    const line = sorted.find((d) => lineMatches(d, ctx));
    if (!line) return null;
    return {
      dialogueId: line.id,
      speakerNpcKey: line.speakerNpcKey,
      text: line.text,
      choices: line.choices.map((c) => annotateChoice(c, ctx)),
    };
  }

  private async loadCtx(userId: string): Promise<CharCtx> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new NpcError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;

    // Quest status map — chỉ load những questKey có trong dialogue choices /
    // dialogue conditions để tiết kiệm. Catalog nhỏ (4 NPC, 6 dialogue) — load
    // hết một phát đơn giản hơn.
    const rows = await this.prisma.questProgress.findMany({
      where: { characterId: char.id },
      select: { questKey: true, status: true },
    });
    const questStatusByKey = new Map<string, ChoiceQuestStatus>();
    for (const r of rows) questStatusByKey.set(r.questKey, questProgressStatusFromRow(r.status));

    return {
      characterId: char.id,
      realmOrder,
      // `Character.faction` chưa tồn tại — placeholder null. Phase faction
      // sau sẽ inject từ `Character.factionKey` hoặc tương đương.
      faction: null,
      questStatusByKey,
    };
  }
}
