import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  npcByKey,
  questByKey,
  realmByKey,
  STORY_DIALOGUES,
  STORY_DIALOGUE_REWARD_CAP,
  storyDialogueNodeById,
  storyDialogueNodeSpecificity,
  type QuestDef,
  type StoryDialogueChoiceDef,
  type StoryDialogueCondition,
  type StoryDialogueEffect,
  type StoryDialogueNodeDef,
  type StoryFlagValue,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';

/**
 * Phase 12 Story Dialogue Foundation — branching dialogue runtime.
 *
 * Service kết nối static catalog (`STORY_DIALOGUES`) với character runtime
 * (`storyDialogueSeen`, `storyFlags`, `QuestProgress`, `linhThach`, `exp`)
 * để cho FE 1 layer hội thoại nhánh thật:
 *
 *   - `getDialogue(userId, npcKey)` — pick node visible cao specificity nhất.
 *   - `applyChoice(userId, npcKey, nodeId, choiceKey)` — chạy effects atomic
 *     trong 1 `$transaction`, sau đó pick node tiếp (nếu choice có nextNodeId)
 *     hoặc node default cho NPC (nếu không) hoặc null (đóng modal).
 *
 * Server-authoritative invariants:
 *   - Choice condition phải pass (vd `quest_status`, `flag_equals`) — fail =
 *     `INVALID_CHOICE` (test #4).
 *   - `advance_quest_step` reject nếu các step trước cùng quest chưa done
 *     (test #5: cannot skip locked quest step).
 *   - `give_reward` cap STORY_DIALOGUE_REWARD_CAP — caller nào vượt → rollback.
 *   - Idempotency: nếu node đã seen + choice có effect grant
 *     (`give_reward`/`advance_quest_step`) → reject `ALREADY_APPLIED` để KHÔNG
 *     farm dialog. Choice thuần `set_flag` / `mark_seen` / navigation vẫn re-run.
 *
 * Ledger: `give_reward` linhThach đi qua `CurrencyService.applyTx` với reason
 * `STORY_DIALOGUE_REWARD` (LedgerReason mới — wire trong currency.service.ts).
 * Exp grant trực tiếp `tx.character.update({ exp: { increment } })` (không có
 * ledger riêng — pattern giống MissionService).
 *
 * Quest advance: gọi inline `tx.questProgress.update` (KHÔNG re-enter
 * QuestService) để mọi tác dụng nằm trong cùng transaction. Re-validate step
 * kind ∈ talk/explore/choice (mirror QuestService.progress invariant).
 */

export type StoryFlagMap = Readonly<Record<string, StoryFlagValue>>;

export class StoryDialogueError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NPC_UNKNOWN'
      | 'NPC_LOCKED_REALM'
      | 'NO_DIALOGUE'
      | 'NODE_UNKNOWN'
      | 'NODE_NPC_MISMATCH'
      | 'CHOICE_UNKNOWN'
      | 'INVALID_CHOICE'
      | 'ALREADY_APPLIED'
      | 'QUEST_NOT_ACCEPTED'
      | 'QUEST_STEP_KIND_MISMATCH'
      | 'QUEST_STEP_LOCKED',
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface StoryDialogueChoiceView {
  key: string;
  label: string;
  labelEn?: string;
  /** Server đánh giá — false = render disabled (chưa thoả conditions). */
  available: boolean;
  /** Cảnh báo cho FE biết vì sao disabled (debug + tooltip). */
  unavailableReason: string | null;
  /** Sẽ navigate tiếp tới node này (nếu có). */
  nextNodeId: string | null;
  /**
   * Choice từng được chạy effects (node parent đã seen + effect grant đã apply).
   * FE highlight "đã chọn" để player không quay lại pick lại.
   */
  alreadyApplied: boolean;
}

export interface StoryDialogueNodeView {
  nodeId: string;
  npcKey: string;
  questKey: string | null;
  text: string;
  textEn?: string;
  /** Đã từng pick choice ở node này (mark_seen đã chạy). */
  seen: boolean;
  choices: StoryDialogueChoiceView[];
}

export interface StoryDialogueChoiceResult {
  /** Effects đã apply (cho FE hiển thị toast). */
  effectsApplied: ReadonlyArray<StoryDialogueEffect>;
  /** Tổng reward đã grant (nếu có give_reward effect). */
  granted: { linhThach: number; tienNgoc: number; exp: number };
  /** Flag map sau khi apply (snapshot, để FE update store). */
  flags: StoryFlagMap;
  /** Tập node id đã seen sau khi apply. */
  seen: ReadonlyArray<string>;
  /** Node tiếp theo (default cho npc nếu choice không có nextNodeId; null = đóng modal). */
  nextNode: StoryDialogueNodeView | null;
}

interface CharCtx {
  characterId: string;
  realmOrder: number;
  questStatusByKey: Map<
    string,
    'LOCKED' | 'AVAILABLE' | 'ACCEPTED' | 'COMPLETED' | 'CLAIMED' | 'NOT_STARTED'
  >;
  questStepProgressByKey: Map<string, Record<string, number>>;
  flags: StoryFlagMap;
  seen: ReadonlyArray<string>;
}

function readJsonArray(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function readJsonFlagMap(raw: Prisma.JsonValue | null | undefined): StoryFlagMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, StoryFlagValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
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

function questStatusMatchesCondition(
  cond: { status: 'available' | 'accepted' | 'completed' | 'claimed' },
  current: string,
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

function flagValueEquals(a: StoryFlagValue | undefined, b: StoryFlagValue): boolean {
  if (a === undefined) return false;
  return a === b;
}

function evaluateCondition(cond: StoryDialogueCondition, ctx: CharCtx): boolean {
  switch (cond.kind) {
    case 'always':
      return true;
    case 'realm_min':
      return ctx.realmOrder >= cond.realmOrder;
    case 'quest_status': {
      const cur = ctx.questStatusByKey.get(cond.questKey) ?? 'NOT_STARTED';
      return questStatusMatchesCondition(cond, cur);
    }
    case 'flag_equals':
      return flagValueEquals(ctx.flags[cond.flagKey], cond.value);
    case 'flag_set':
      return ctx.flags[cond.flagKey] !== undefined;
    case 'flag_unset':
      return ctx.flags[cond.flagKey] === undefined;
    case 'seen':
      return ctx.seen.includes(cond.nodeId);
    case 'not_seen':
      return !ctx.seen.includes(cond.nodeId);
  }
}

function evaluateAllConditions(
  conds: readonly StoryDialogueCondition[] | undefined,
  ctx: CharCtx,
): { ok: true } | { ok: false; failedCondition: StoryDialogueCondition } {
  if (!conds || conds.length === 0) return { ok: true };
  for (const c of conds) {
    if (!evaluateCondition(c, ctx)) return { ok: false, failedCondition: c };
  }
  return { ok: true };
}

function summarizeConditionForReason(cond: StoryDialogueCondition): string {
  switch (cond.kind) {
    case 'always':
      return 'always';
    case 'realm_min':
      return `realm_min:${cond.realmOrder}`;
    case 'quest_status':
      return `quest_status:${cond.questKey}=${cond.status}`;
    case 'flag_equals':
      return `flag_equals:${cond.flagKey}=${String(cond.value)}`;
    case 'flag_set':
      return `flag_set:${cond.flagKey}`;
    case 'flag_unset':
      return `flag_unset:${cond.flagKey}`;
    case 'seen':
      return `seen:${cond.nodeId}`;
    case 'not_seen':
      return `not_seen:${cond.nodeId}`;
  }
}

/**
 * Pick node visible cao specificity nhất cho NPC. Trả null nếu không node nào
 * match.
 */
function pickNodeForNpc(npcKey: string, ctx: CharCtx): StoryDialogueNodeDef | null {
  const candidates = STORY_DIALOGUES.filter((n) => n.npcKey === npcKey);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(
    (a, b) => storyDialogueNodeSpecificity(b) - storyDialogueNodeSpecificity(a),
  );
  for (const node of sorted) {
    const r = evaluateAllConditions(node.conditions, ctx);
    if (r.ok) return node;
  }
  return null;
}

function buildChoiceView(
  choice: StoryDialogueChoiceDef,
  parentNode: StoryDialogueNodeDef,
  ctx: CharCtx,
): StoryDialogueChoiceView {
  const condResult = evaluateAllConditions(choice.conditions, ctx);
  const hasGrantEffect = (choice.effects ?? []).some(
    (e) => e.kind === 'give_reward' || e.kind === 'advance_quest_step',
  );
  const parentSeen = ctx.seen.includes(parentNode.id);
  const alreadyApplied = parentSeen && hasGrantEffect;
  let available = condResult.ok && !alreadyApplied;
  let reason: string | null = null;
  if (!condResult.ok) {
    reason = summarizeConditionForReason(condResult.failedCondition);
  } else if (alreadyApplied) {
    reason = 'already_applied';
    available = false;
  }
  return {
    key: choice.key,
    label: choice.label,
    labelEn: choice.labelEn,
    available,
    unavailableReason: reason,
    nextNodeId: choice.nextNodeId ?? null,
    alreadyApplied,
  };
}

function buildNodeView(node: StoryDialogueNodeDef, ctx: CharCtx): StoryDialogueNodeView {
  return {
    nodeId: node.id,
    npcKey: node.npcKey,
    questKey: node.questKey ?? null,
    text: node.text,
    textEn: node.textEn,
    seen: ctx.seen.includes(node.id),
    choices: node.choices.map((c) => buildChoiceView(c, node, ctx)),
  };
}

@Injectable()
export class StoryDialogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async getDialogue(userId: string, npcKey: string): Promise<StoryDialogueNodeView> {
    const npc = npcByKey(npcKey);
    if (!npc) throw new StoryDialogueError('NPC_UNKNOWN');
    const ctx = await this.loadCtx(userId);
    if (npc.realmGateOrder > ctx.realmOrder) {
      throw new StoryDialogueError('NPC_LOCKED_REALM');
    }
    const node = pickNodeForNpc(npcKey, ctx);
    if (!node) throw new StoryDialogueError('NO_DIALOGUE');
    return buildNodeView(node, ctx);
  }

  /**
   * Server-authoritative apply: validate node + choice + conditions + effects,
   * commit atomic. Trả `nextNode` cho FE re-render modal.
   */
  async applyChoice(
    userId: string,
    npcKey: string,
    nodeId: string,
    choiceKey: string,
  ): Promise<StoryDialogueChoiceResult> {
    const npc = npcByKey(npcKey);
    if (!npc) throw new StoryDialogueError('NPC_UNKNOWN');

    const node = storyDialogueNodeById(nodeId);
    if (!node) throw new StoryDialogueError('NODE_UNKNOWN');
    if (node.npcKey !== npcKey) {
      throw new StoryDialogueError('NODE_NPC_MISMATCH', `${nodeId} belongs to ${node.npcKey}`);
    }
    const choice = node.choices.find((c) => c.key === choiceKey);
    if (!choice) throw new StoryDialogueError('CHOICE_UNKNOWN');

    const ctx = await this.loadCtx(userId);
    if (npc.realmGateOrder > ctx.realmOrder) {
      throw new StoryDialogueError('NPC_LOCKED_REALM');
    }

    // Re-validate node visibility (player có thể stale state).
    const nodeCondResult = evaluateAllConditions(node.conditions, ctx);
    if (!nodeCondResult.ok) {
      throw new StoryDialogueError(
        'INVALID_CHOICE',
        `node condition failed: ${summarizeConditionForReason(nodeCondResult.failedCondition)}`,
      );
    }

    // Re-validate choice condition.
    const choiceCondResult = evaluateAllConditions(choice.conditions, ctx);
    if (!choiceCondResult.ok) {
      throw new StoryDialogueError(
        'INVALID_CHOICE',
        `choice condition failed: ${summarizeConditionForReason(choiceCondResult.failedCondition)}`,
      );
    }

    // Idempotency guard for grant effects (give_reward / advance_quest_step).
    const hasGrantEffect = (choice.effects ?? []).some(
      (e) => e.kind === 'give_reward' || e.kind === 'advance_quest_step',
    );
    if (hasGrantEffect && ctx.seen.includes(node.id)) {
      throw new StoryDialogueError('ALREADY_APPLIED');
    }

    // Pre-flight cap check (defensive — catalog test invariant cũng verify).
    const totalReward = { linhThach: 0, tienNgoc: 0, exp: 0 };
    for (const e of choice.effects ?? []) {
      if (e.kind !== 'give_reward') continue;
      totalReward.linhThach += e.linhThach ?? 0;
      totalReward.tienNgoc += e.tienNgoc ?? 0;
      totalReward.exp += e.exp ?? 0;
    }
    if (
      totalReward.linhThach > STORY_DIALOGUE_REWARD_CAP.linhThach ||
      totalReward.tienNgoc > STORY_DIALOGUE_REWARD_CAP.tienNgoc ||
      totalReward.exp > STORY_DIALOGUE_REWARD_CAP.exp
    ) {
      throw new StoryDialogueError('INVALID_CHOICE', 'reward exceeds cap');
    }

    // Pre-flight: validate advance_quest_step (quest accepted, kind matches, not skipping).
    for (const e of choice.effects ?? []) {
      if (e.kind !== 'advance_quest_step') continue;
      const def = questByKey(e.questKey);
      if (!def) {
        throw new StoryDialogueError('INVALID_CHOICE', `unknown questKey ${e.questKey}`);
      }
      const status = ctx.questStatusByKey.get(e.questKey) ?? 'NOT_STARTED';
      if (status !== 'ACCEPTED') {
        throw new StoryDialogueError('QUEST_NOT_ACCEPTED', e.questKey);
      }
      const stepDef = def.steps.find((s) => s.id === e.stepId);
      if (!stepDef) {
        throw new StoryDialogueError('INVALID_CHOICE', `unknown stepId ${e.stepId}`);
      }
      if (stepDef.kind !== 'talk' && stepDef.kind !== 'explore' && stepDef.kind !== 'choice') {
        throw new StoryDialogueError('QUEST_STEP_KIND_MISMATCH', `${e.questKey}.${e.stepId}`);
      }
      // Cannot skip locked quest step — every preceding step must be done.
      const progress = ctx.questStepProgressByKey.get(e.questKey) ?? {};
      const idx = def.steps.findIndex((s) => s.id === e.stepId);
      for (let i = 0; i < idx; i++) {
        const prev = def.steps[i];
        if ((progress[prev.id] ?? 0) < prev.count) {
          throw new StoryDialogueError(
            'QUEST_STEP_LOCKED',
            `${e.questKey}.${prev.id} not done`,
          );
        }
      }
    }

    // Apply effects atomic.
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-load row fresh inside tx (for race-safe seen/flags update).
      const charRow = await tx.character.findUnique({
        where: { id: ctx.characterId },
        select: { id: true, storyDialogueSeen: true, storyFlags: true },
      });
      if (!charRow) throw new StoryDialogueError('NO_CHARACTER');
      const seen = new Set(readJsonArray(charRow.storyDialogueSeen));
      const flags: Record<string, StoryFlagValue> = { ...readJsonFlagMap(charRow.storyFlags) };
      const granted = { linhThach: 0, tienNgoc: 0, exp: 0 };
      const applied: StoryDialogueEffect[] = [];

      // Always mark node seen (mark_seen implicit + idempotent set semantics).
      seen.add(node.id);

      for (const e of choice.effects ?? []) {
        switch (e.kind) {
          case 'mark_seen':
            // Implicit already handled — keep effect in `applied` for FE log.
            applied.push(e);
            break;
          case 'set_flag':
            flags[e.flagKey] = e.value;
            applied.push(e);
            break;
          case 'give_reward': {
            if (e.linhThach && e.linhThach > 0) {
              await this.currency.applyTx(tx, {
                characterId: ctx.characterId,
                currency: CurrencyKind.LINH_THACH,
                delta: BigInt(e.linhThach),
                reason: 'STORY_DIALOGUE_REWARD',
                refType: 'StoryDialogueNode',
                refId: node.id,
                meta: { choiceKey: choice.key },
              });
              granted.linhThach += e.linhThach;
            }
            if (e.tienNgoc && e.tienNgoc > 0) {
              await this.currency.applyTx(tx, {
                characterId: ctx.characterId,
                currency: CurrencyKind.TIEN_NGOC,
                delta: BigInt(e.tienNgoc),
                reason: 'STORY_DIALOGUE_REWARD',
                refType: 'StoryDialogueNode',
                refId: node.id,
                meta: { choiceKey: choice.key },
              });
              granted.tienNgoc += e.tienNgoc;
            }
            if (e.exp && e.exp > 0) {
              await tx.character.update({
                where: { id: ctx.characterId },
                data: { exp: { increment: BigInt(e.exp) } },
              });
              granted.exp += e.exp;
            }
            applied.push(e);
            break;
          }
          case 'advance_quest_step': {
            const def = questByKey(e.questKey)!;
            const stepDef = def.steps.find((s) => s.id === e.stepId)!;
            const amount = Math.max(1, Math.floor(e.amount ?? 1));
            const row = await tx.questProgress.findUnique({
              where: {
                characterId_questKey: {
                  characterId: ctx.characterId,
                  questKey: def.key,
                },
              },
            });
            if (!row || row.status !== 'ACCEPTED') {
              throw new StoryDialogueError('QUEST_NOT_ACCEPTED', def.key);
            }
            const progress = readStepProgressJson(row.stepProgress);
            const cur = progress[stepDef.id] ?? 0;
            const next = Math.min(stepDef.count, cur + amount);
            if (next !== cur) {
              progress[stepDef.id] = next;
              await tx.questProgress.updateMany({
                where: { id: row.id, status: 'ACCEPTED' },
                data: { stepProgress: progress as Prisma.InputJsonValue },
              });
            }
            // Auto-complete khi tất cả step done.
            const allDone = def.steps.every((s) => (progress[s.id] ?? 0) >= s.count);
            if (allDone) {
              await tx.questProgress.updateMany({
                where: { id: row.id, status: 'ACCEPTED' },
                data: { status: 'COMPLETED', completedAt: new Date() },
              });
            }
            applied.push(e);
            break;
          }
        }
      }

      await tx.character.update({
        where: { id: ctx.characterId },
        data: {
          storyDialogueSeen: [...seen] as Prisma.InputJsonValue,
          storyFlags: flags as Prisma.InputJsonValue,
        },
      });

      return {
        applied,
        granted,
        flags: flags as StoryFlagMap,
        seen: [...seen],
      };
    });

    // Re-load context (post-mutation) for next-node picking.
    const ctxAfter = await this.loadCtx(userId);
    let nextNode: StoryDialogueNodeDef | null = null;
    if (choice.nextNodeId) {
      const explicit = storyDialogueNodeById(choice.nextNodeId);
      if (explicit) nextNode = explicit;
    } else {
      // Fallback: pick best-matching node for the same NPC after state change.
      // Nếu không còn node nào match (vd not_seen condition đã loại bỏ node hiện tại
      // và không có node fallback), trả null = đóng modal.
      nextNode = pickNodeForNpc(npcKey, ctxAfter);
      // KHÔNG return cùng node vừa apply nếu có grant effect — tránh loop.
      if (nextNode && nextNode.id === node.id) {
        nextNode = null;
      }
    }

    return {
      effectsApplied: result.applied,
      granted: result.granted,
      flags: result.flags,
      seen: result.seen,
      nextNode: nextNode ? buildNodeView(nextNode, ctxAfter) : null,
    };
  }

  /**
   * Convenience wrapper — list tất cả node visible cho NPC (debug / admin).
   * KHÔNG dùng trong FE chính (FE chỉ xem 1 node tại 1 thời điểm).
   */
  async listForNpc(userId: string, npcKey: string): Promise<StoryDialogueNodeView[]> {
    const ctx = await this.loadCtx(userId);
    const candidates = STORY_DIALOGUES.filter((n) => n.npcKey === npcKey);
    return candidates
      .filter((n) => evaluateAllConditions(n.conditions, ctx).ok)
      .map((n) => buildNodeView(n, ctx));
  }

  private async loadCtx(userId: string): Promise<CharCtx> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        realmKey: true,
        storyDialogueSeen: true,
        storyFlags: true,
      },
    });
    if (!char) throw new StoryDialogueError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;
    const rows = await this.prisma.questProgress.findMany({
      where: { characterId: char.id },
      select: { questKey: true, status: true, stepProgress: true },
    });
    const questStatusByKey = new Map<string, CharCtx['questStatusByKey'] extends Map<string, infer V> ? V : never>();
    const questStepProgressByKey = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const status = r.status as
        | 'LOCKED'
        | 'AVAILABLE'
        | 'ACCEPTED'
        | 'COMPLETED'
        | 'CLAIMED';
      questStatusByKey.set(r.questKey, status);
      questStepProgressByKey.set(r.questKey, readStepProgressJson(r.stepProgress));
    }
    return {
      characterId: char.id,
      realmOrder,
      questStatusByKey,
      questStepProgressByKey,
      flags: readJsonFlagMap(char.storyFlags),
      seen: readJsonArray(char.storyDialogueSeen),
    };
  }
}

// Re-export quest types unused elsewhere (silence unused-import lint if any).
export type { QuestDef };
