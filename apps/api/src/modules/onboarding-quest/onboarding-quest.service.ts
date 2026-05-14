import { Injectable, Logger, Optional } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  ONBOARDING_DAYS,
  ONBOARDING_TASKS,
  onboardingDayByNumber,
  onboardingTaskByKey,
  onboardingTasksForDay,
  type OnboardingDayDef,
  type OnboardingTaskDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { TitleService } from '../character/title.service';

/**
 * Phase 44.1 — Onboarding auto-track action types. Hook callsites trong
 * gameplay (cultivation start/tick, combat win, dungeon enter/clear, mail
 * open, ...) gọi `recordAction(characterId, type)` hoặc `notifyAction(...)`
 * → auto-flip task AVAILABLE → COMPLETED. Best-effort, fail-soft.
 *
 * Naming convention: UPPERCASE_SNAKE_CASE — phù hợp convention thành
 * viên `Action` enum khác trong codebase (ledger reason, mission action,
 * ...). Lowercase alias giữ lại để backwards-compat nếu có caller cũ.
 *
 * Mapping `OnboardingActionType` → `taskKey[]` ở const dưới.
 */
export type OnboardingActionType =
  | 'DAILY_LOGIN_CLAIM'
  | 'INVENTORY_OPEN'
  | 'CULTIVATION_START'
  | 'CULTIVATION_TICK'
  | 'QUEST_VIEW'
  | 'QUEST_COMPLETE_TUTORIAL'
  | 'REALM_VIEW'
  | 'EQUIP_WEAPON'
  | 'SPIRITUAL_ROOT_VIEW'
  | 'COMBAT_WIN'
  | 'DUNGEON_ENTER'
  | 'DUNGEON_CLEAR'
  | 'LOOT_COLLECT'
  | 'STORY_VIEW'
  | 'STORY_PROGRESS'
  | 'NPC_TALK'
  | 'SECT_VIEW'
  | 'CHAT_OPEN'
  | 'MAIL_OPEN'
  | 'ARTIFACT_VIEW'
  | 'ELEMENTAL_VIEW'
  | 'MATERIAL_COLLECT'
  | 'DASHBOARD_VIEW'
  | 'NEXT_ACTION_VIEW'
  | 'PROFILE_OPEN';

const ONBOARDING_ACTION_TO_TASKS: Record<OnboardingActionType, string[]> = {
  DAILY_LOGIN_CLAIM: ['d1_claim_daily_login'],
  INVENTORY_OPEN: ['d1_open_inventory'],
  CULTIVATION_START: ['d1_first_cultivation'],
  CULTIVATION_TICK: ['d2_cultivate_30min'],
  QUEST_VIEW: ['d1_view_quest'],
  QUEST_COMPLETE_TUTORIAL: ['d1_finish_tutorial_quest'],
  REALM_VIEW: ['d2_check_realm'],
  EQUIP_WEAPON: ['d2_equip_weapon'],
  SPIRITUAL_ROOT_VIEW: ['d2_check_spiritual_root'],
  COMBAT_WIN: ['d3_first_combat_win'],
  DUNGEON_ENTER: ['d3_enter_dungeon'],
  DUNGEON_CLEAR: ['d3_clear_dungeon'],
  LOOT_COLLECT: ['d3_check_drop_loot'],
  STORY_VIEW: ['d4_open_story_v2'],
  STORY_PROGRESS: ['d4_complete_story_step'],
  NPC_TALK: ['d4_talk_npc'],
  SECT_VIEW: ['d5_view_sect_list'],
  CHAT_OPEN: ['d5_check_chat'],
  MAIL_OPEN: ['d5_check_mail'],
  ARTIFACT_VIEW: ['d6_view_artifact'],
  ELEMENTAL_VIEW: ['d6_check_elemental'],
  MATERIAL_COLLECT: ['d6_collect_material'],
  DASHBOARD_VIEW: ['d7_review_dashboard'],
  NEXT_ACTION_VIEW: ['d7_check_next_action'],
  // PROFILE_OPEN — 1 trigger 2 task (xem profile lúc đầu ≡ review realm +
  // dashboard panel). Day-gating guả rằng task LOCKED sẽ không flip.
  PROFILE_OPEN: ['d2_check_realm', 'd7_review_dashboard'],
};

/**
 * Phase 34.0 — 7-Day Onboarding Questline Service.
 *
 * Wire catalog `ONBOARDING_TASKS` + `ONBOARDING_DAYS` (shared) vào runtime:
 *   - Lazy-create day rows (LOCKED/AVAILABLE) + task rows (AVAILABLE) khi
 *     `GET /onboarding-quest/v1/progress` được gọi.
 *   - Task complete = player click "Done" trên FE (self-acknowledge — KHÔNG
 *     hook vào CombatService/CultivationService trong PR này để tránh đụng
 *     Phase 12 / Phase 33 service path).
 *   - Task claim = grant linhThach + exp + (optional) cosmetic title.
 *   - Day-level unlock dựa trên previous day all tasks COMPLETED/CLAIMED.
 *
 * Forbidden Phase 34.0:
 *   - KHÔNG sửa Phase 33 `Phase33StoryService` hoặc Phase 12 `QuestService`.
 *   - KHÔNG mint Tien Ngoc — chỉ linh thạch + exp + (cosmetic) title.
 *   - KHÔNG grant endgame item.
 *   - KHÔNG hook auto-track vào combat/cultivation/story service (defer
 *     thành PR sau nếu cần auto-tracking).
 *
 * Idempotency:
 *   - Task complete CAS via `updateMany({status:'AVAILABLE'})` → `COMPLETED`.
 *   - Task claim CAS via `updateMany({status:'COMPLETED'})` → `CLAIMED` +
 *     `CurrencyService.applyTx` trong cùng `$transaction`.
 *   - Re-call sau khi đã CLAIMED trả về current state, KHÔNG cộng reward.
 */

export type OnboardingTaskRuntimeStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'COMPLETED'
  | 'CLAIMED';

export type OnboardingDayRuntimeStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export class OnboardingQuestError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'ONBOARDING_TASK_UNKNOWN'
      | 'ONBOARDING_DAY_UNKNOWN'
      | 'ONBOARDING_TASK_LOCKED'
      | 'ONBOARDING_TASK_NOT_COMPLETED'
      | 'ONBOARDING_TASK_ALREADY_CLAIMED',
  ) {
    super(code);
  }
}

export interface OnboardingTaskView {
  taskKey: string;
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  actionRoute: string;
  category: OnboardingTaskDef['category'];
  status: OnboardingTaskRuntimeStatus;
  completedAt: string | null;
  claimedAt: string | null;
  reward: {
    linhThach: number;
    exp: number;
    titleKey?: string;
  };
}

export interface OnboardingDayView {
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  status: OnboardingDayRuntimeStatus;
  unlockedAt: string | null;
  completedAt: string | null;
  totalTasks: number;
  completedTasks: number;
  claimedTasks: number;
  tasks: OnboardingTaskView[];
}

export interface OnboardingProgressView {
  totalDays: number;
  totalTasks: number;
  completedTasks: number;
  claimedTasks: number;
  days: OnboardingDayView[];
}

export interface OnboardingClaimResult {
  taskKey: string;
  status: OnboardingTaskRuntimeStatus;
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  titleKey?: string;
}

@Injectable()
export class OnboardingQuestService {
  private readonly logger = new Logger(OnboardingQuestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    // Phase 44.1 — TitleService optional inject. Khi reward.titleKey present
    // (Day 7 final task), gọi `unlockTitle(characterId, titleKey, 'onboarding')`
    // để wire vào hệ Title (Phase 11.9.B). Optional cho legacy test bootstrap.
    @Optional() private readonly titles?: TitleService,
  ) {}

  /**
   * Phase 44.1 — Auto-track hook. Gameplay callsites (cultivation start/tick,
   * combat win, dungeon enter/clear, mail open, ...) gọi method này
   * BEST-EFFORT. Bọc try/catch — KHÔNG throw để không phá flow upstream.
   *
   * Idempotent: CAS guard ở `updateMany({ status: 'AVAILABLE' })`. Nếu task
   * đã COMPLETED hoặc LOCKED → no-op. Day status promote (AVAILABLE →
   * IN_PROGRESS → COMPLETED) chạy chỉ khi có flip thật.
   *
   * Không grant reward ở đây — player phải call `claimTask(taskKey)` để
   * nhận. Auto-track chỉ flip status.
   *
   * @returns string[] danh sách taskKey vừa flip AVAILABLE → COMPLETED.
   *   Empty nếu không flip gì (task LOCKED, đã COMPLETED, hoặc progress
   *   rows chưa tồn tại).
   */
  async recordAction(
    characterId: string,
    actionType: OnboardingActionType,
  ): Promise<string[]> {
    try {
      const taskKeys = ONBOARDING_ACTION_TO_TASKS[actionType];
      if (!taskKeys || taskKeys.length === 0) return [];
      // Skip nếu chưa có progress rows (player chưa từng mở onboarding).
      const hasAny = await this.prisma.characterOnboardingTaskProgress.count({
        where: { characterId, taskKey: { in: taskKeys } },
      });
      if (hasAny === 0) return [];
      const now = new Date();
      const flipped: string[] = [];
      for (const taskKey of taskKeys) {
        const res = await this.prisma.characterOnboardingTaskProgress.updateMany({
          where: { characterId, taskKey, status: 'AVAILABLE' },
          data: { status: 'COMPLETED', completedAt: now },
        });
        if (res.count === 1) flipped.push(taskKey);
      }
      if (flipped.length === 0) return flipped;
      // Day promote: bất kỳ task flip → mark day IN_PROGRESS nếu chưa.
      const dayNumbers = new Set<number>();
      for (const taskKey of flipped) {
        const def = onboardingTaskByKey(taskKey);
        if (def) dayNumbers.add(def.dayNumber);
      }
      for (const dayNumber of dayNumbers) {
        await this.prisma.characterOnboardingProgress.updateMany({
          where: { characterId, dayNumber, status: 'AVAILABLE' },
          data: { status: 'IN_PROGRESS' },
        });
        await this.maybePromoteDayToCompleted(characterId, dayNumber, now);
      }
      // Cascade unlock day N+1 nếu day N vừa hết tasks.
      await this.ensureProgressRows(characterId);
      return flipped;
    } catch (e: unknown) {
      this.logger.warn(
        `recordAction characterId=${characterId} action=${actionType} failed: ${(e as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Phase 44.1 — Fire-and-forget alias of `recordAction` for callers that
   * only need the side-effect (auto-flip) and don't care which tasks moved.
   * Returning `void` keeps integration easier for non-test callers.
   */
  async notifyAction(
    characterId: string,
    actionType: OnboardingActionType,
  ): Promise<void> {
    await this.recordAction(characterId, actionType);
  }

  // ---------------------------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------------------------

  private async getCharacterIdByUser(userId: string): Promise<string> {
    const ch = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ch) throw new OnboardingQuestError('NO_CHARACTER');
    return ch.id;
  }

  /**
   * Compute unlock state cho mỗi day dựa trên task progress hiện tại:
   * - Day 1 luôn AVAILABLE.
   * - Day N (N≥2) AVAILABLE khi all tasks của Day N-1 ở status
   *   `COMPLETED` hoặc `CLAIMED`.
   */
  private computeDayUnlock(
    taskRows: Map<string, { status: string }>,
  ): Record<number, boolean> {
    const unlocked: Record<number, boolean> = { 1: true };
    for (let day = 2; day <= 7; day++) {
      const prev = onboardingDayByNumber(day - 1);
      if (!prev) {
        unlocked[day] = false;
        continue;
      }
      let allDone = true;
      for (const taskKey of prev.taskKeys) {
        const row = taskRows.get(taskKey);
        if (!row || (row.status !== 'COMPLETED' && row.status !== 'CLAIMED')) {
          allDone = false;
          break;
        }
      }
      unlocked[day] = allDone;
    }
    return unlocked;
  }

  /**
   * Compute day-level status dựa trên (unlocked + task progress):
   * - LOCKED nếu chưa unlocked.
   * - AVAILABLE nếu unlocked nhưng chưa có task nào ở status > AVAILABLE.
   * - IN_PROGRESS nếu có ≥1 task COMPLETED/CLAIMED nhưng chưa hết.
   * - COMPLETED nếu tất cả task của day đã COMPLETED hoặc CLAIMED.
   */
  private computeDayStatus(
    day: OnboardingDayDef,
    unlocked: boolean,
    taskRows: Map<string, { status: string }>,
  ): OnboardingDayRuntimeStatus {
    if (!unlocked) return 'LOCKED';
    let doneCount = 0;
    for (const tk of day.taskKeys) {
      const row = taskRows.get(tk);
      if (row && (row.status === 'COMPLETED' || row.status === 'CLAIMED')) {
        doneCount++;
      }
    }
    if (doneCount === 0) return 'AVAILABLE';
    if (doneCount === day.taskKeys.length) return 'COMPLETED';
    return 'IN_PROGRESS';
  }

  /**
   * Ensure mọi day/task row tồn tại (lazy-create) và status đồng bộ với
   * unlock rule hiện tại. Idempotent — re-call an toàn.
   *
   * Strategy:
   *   1. Tạo missing day rows (LOCKED default).
   *   2. Tạo missing task rows (LOCKED nếu day chưa unlock, AVAILABLE nếu
   *      day đã unlock).
   *   3. Update day status (LOCKED → AVAILABLE/IN_PROGRESS/COMPLETED) +
   *      task status (LOCKED → AVAILABLE) khi day mới unlock.
   *
   * KHÔNG transition COMPLETED → AVAILABLE hoặc CLAIMED → COMPLETED
   * (irreversible — bảo toàn audit).
   */
  private async ensureProgressRows(characterId: string): Promise<void> {
    // Read existing rows
    const [existingDays, existingTasks] = await Promise.all([
      this.prisma.characterOnboardingProgress.findMany({
        where: { characterId },
        select: { dayNumber: true, status: true },
      }),
      this.prisma.characterOnboardingTaskProgress.findMany({
        where: { characterId },
        select: { taskKey: true, status: true },
      }),
    ]);

    const existingDayMap = new Map<number, { status: string }>();
    for (const d of existingDays) {
      existingDayMap.set(d.dayNumber, { status: d.status });
    }
    const existingTaskMap = new Map<string, { status: string }>();
    for (const t of existingTasks) {
      existingTaskMap.set(t.taskKey, { status: t.status });
    }

    const unlocked = this.computeDayUnlock(existingTaskMap);

    // Lazy-create missing day rows
    const missingDays: Array<{
      characterId: string;
      dayNumber: number;
      status: string;
      unlockedAt: Date | null;
    }> = [];
    const now = new Date();
    for (const day of ONBOARDING_DAYS) {
      if (existingDayMap.has(day.dayNumber)) continue;
      const isUnlocked = unlocked[day.dayNumber] ?? false;
      const status = this.computeDayStatus(day, isUnlocked, existingTaskMap);
      missingDays.push({
        characterId,
        dayNumber: day.dayNumber,
        status,
        unlockedAt: isUnlocked ? now : null,
      });
    }
    if (missingDays.length > 0) {
      await this.prisma.characterOnboardingProgress.createMany({
        data: missingDays,
        skipDuplicates: true,
      });
    }

    // Lazy-create missing task rows
    const missingTasks: Array<{
      characterId: string;
      taskKey: string;
      dayNumber: number;
      status: string;
    }> = [];
    for (const task of ONBOARDING_TASKS) {
      if (existingTaskMap.has(task.taskKey)) continue;
      const isUnlocked = unlocked[task.dayNumber] ?? false;
      missingTasks.push({
        characterId,
        taskKey: task.taskKey,
        dayNumber: task.dayNumber,
        status: isUnlocked ? 'AVAILABLE' : 'LOCKED',
      });
    }
    if (missingTasks.length > 0) {
      await this.prisma.characterOnboardingTaskProgress.createMany({
        data: missingTasks,
        skipDuplicates: true,
      });
    }

    // Promote existing LOCKED tasks/days to AVAILABLE if day now unlocked
    for (const day of ONBOARDING_DAYS) {
      const isUnlocked = unlocked[day.dayNumber] ?? false;
      if (!isUnlocked) continue;
      const existingDay = existingDayMap.get(day.dayNumber);
      if (existingDay && existingDay.status === 'LOCKED') {
        await this.prisma.characterOnboardingProgress.updateMany({
          where: { characterId, dayNumber: day.dayNumber, status: 'LOCKED' },
          data: { status: 'AVAILABLE', unlockedAt: now },
        });
      }
      // Promote LOCKED tasks within this unlocked day to AVAILABLE.
      await this.prisma.characterOnboardingTaskProgress.updateMany({
        where: {
          characterId,
          dayNumber: day.dayNumber,
          status: 'LOCKED',
        },
        data: { status: 'AVAILABLE' },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /** GET /onboarding-quest/v1/progress — full 7-day overview. */
  async getProgress(userId: string): Promise<OnboardingProgressView> {
    const characterId = await this.getCharacterIdByUser(userId);
    await this.ensureProgressRows(characterId);

    const [dayRows, taskRows] = await Promise.all([
      this.prisma.characterOnboardingProgress.findMany({
        where: { characterId },
        select: {
          dayNumber: true,
          status: true,
          unlockedAt: true,
          completedAt: true,
        },
      }),
      this.prisma.characterOnboardingTaskProgress.findMany({
        where: { characterId },
        select: {
          taskKey: true,
          status: true,
          completedAt: true,
          claimedAt: true,
        },
      }),
    ]);

    const dayMap = new Map<
      number,
      {
        status: string;
        unlockedAt: Date | null;
        completedAt: Date | null;
      }
    >();
    for (const d of dayRows) {
      dayMap.set(d.dayNumber, {
        status: d.status,
        unlockedAt: d.unlockedAt,
        completedAt: d.completedAt,
      });
    }
    const taskMap = new Map<
      string,
      {
        status: string;
        completedAt: Date | null;
        claimedAt: Date | null;
      }
    >();
    for (const t of taskRows) {
      taskMap.set(t.taskKey, {
        status: t.status,
        completedAt: t.completedAt,
        claimedAt: t.claimedAt,
      });
    }

    const days: OnboardingDayView[] = ONBOARDING_DAYS.map((dayDef) => {
      const dayRow = dayMap.get(dayDef.dayNumber);
      const taskViews: OnboardingTaskView[] = onboardingTasksForDay(
        dayDef.dayNumber,
      ).map((tdef) => this.makeTaskView(tdef, taskMap.get(tdef.taskKey)));
      const completedTasks = taskViews.filter(
        (t) => t.status === 'COMPLETED' || t.status === 'CLAIMED',
      ).length;
      const claimedTasks = taskViews.filter((t) => t.status === 'CLAIMED')
        .length;
      return {
        dayNumber: dayDef.dayNumber,
        titleVi: dayDef.titleVi,
        titleEn: dayDef.titleEn,
        themeVi: dayDef.themeVi,
        themeEn: dayDef.themeEn,
        status: (dayRow?.status as OnboardingDayRuntimeStatus) ?? 'LOCKED',
        unlockedAt: dayRow?.unlockedAt?.toISOString() ?? null,
        completedAt: dayRow?.completedAt?.toISOString() ?? null,
        totalTasks: taskViews.length,
        completedTasks,
        claimedTasks,
        tasks: taskViews,
      };
    });

    let totalCompleted = 0;
    let totalClaimed = 0;
    for (const d of days) {
      totalCompleted += d.completedTasks;
      totalClaimed += d.claimedTasks;
    }
    return {
      totalDays: ONBOARDING_DAYS.length,
      totalTasks: ONBOARDING_TASKS.length,
      completedTasks: totalCompleted,
      claimedTasks: totalClaimed,
      days,
    };
  }

  /** GET /onboarding-quest/v1/days/:dayNumber — single day detail. */
  async getDay(userId: string, dayNumber: number): Promise<OnboardingDayView> {
    const dayDef = onboardingDayByNumber(dayNumber);
    if (!dayDef) throw new OnboardingQuestError('ONBOARDING_DAY_UNKNOWN');
    const progress = await this.getProgress(userId);
    const day = progress.days.find((d) => d.dayNumber === dayNumber);
    if (!day) throw new OnboardingQuestError('ONBOARDING_DAY_UNKNOWN');
    return day;
  }

  /**
   * POST /onboarding-quest/v1/tasks/:taskKey/accept
   *
   * Đánh dấu day chứa task này từ AVAILABLE → IN_PROGRESS (idempotent). Tasks
   * mặc định đã AVAILABLE từ ensureProgressRows nên accept chỉ là cosmetic
   * day-level state transition. Trả về task view hiện tại.
   */
  async acceptTask(userId: string, taskKey: string): Promise<OnboardingTaskView> {
    const taskDef = onboardingTaskByKey(taskKey);
    if (!taskDef) throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');
    const characterId = await this.getCharacterIdByUser(userId);
    await this.ensureProgressRows(characterId);

    const taskRow = await this.prisma.characterOnboardingTaskProgress.findUnique({
      where: {
        characterId_taskKey: { characterId, taskKey },
      },
      select: { status: true, completedAt: true, claimedAt: true },
    });
    if (!taskRow || taskRow.status === 'LOCKED') {
      throw new OnboardingQuestError('ONBOARDING_TASK_LOCKED');
    }

    // Flip day status AVAILABLE → IN_PROGRESS (idempotent)
    await this.prisma.characterOnboardingProgress.updateMany({
      where: {
        characterId,
        dayNumber: taskDef.dayNumber,
        status: 'AVAILABLE',
      },
      data: { status: 'IN_PROGRESS' },
    });

    return this.makeTaskView(taskDef, taskRow);
  }

  /**
   * POST /onboarding-quest/v1/tasks/:taskKey/complete
   *
   * CAS guard: chỉ flip AVAILABLE → COMPLETED. Re-call sau khi COMPLETED/
   * CLAIMED trả về current state, không double-flip.
   */
  async completeTask(
    userId: string,
    taskKey: string,
  ): Promise<OnboardingTaskView> {
    const taskDef = onboardingTaskByKey(taskKey);
    if (!taskDef) throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');
    const characterId = await this.getCharacterIdByUser(userId);
    await this.ensureProgressRows(characterId);

    const now = new Date();
    const result = await this.prisma.characterOnboardingTaskProgress.updateMany({
      where: { characterId, taskKey, status: 'AVAILABLE' },
      data: { status: 'COMPLETED', completedAt: now },
    });

    if (result.count === 1) {
      // Day status promote AVAILABLE → IN_PROGRESS nếu chưa.
      await this.prisma.characterOnboardingProgress.updateMany({
        where: {
          characterId,
          dayNumber: taskDef.dayNumber,
          status: 'AVAILABLE',
        },
        data: { status: 'IN_PROGRESS' },
      });
      // Re-evaluate day → có thể vừa hết tasks → COMPLETED.
      await this.maybePromoteDayToCompleted(characterId, taskDef.dayNumber, now);
      // Re-ensure cascade unlock cho day N+1 nếu day N vừa hết tasks.
      await this.ensureProgressRows(characterId);
    } else {
      // Already COMPLETED or CLAIMED — verify exists.
      const row = await this.prisma.characterOnboardingTaskProgress.findUnique({
        where: { characterId_taskKey: { characterId, taskKey } },
        select: { status: true },
      });
      if (!row) throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');
      if (row.status === 'LOCKED') {
        throw new OnboardingQuestError('ONBOARDING_TASK_LOCKED');
      }
    }

    const refreshed = await this.prisma.characterOnboardingTaskProgress.findUnique(
      {
        where: { characterId_taskKey: { characterId, taskKey } },
        select: { status: true, completedAt: true, claimedAt: true },
      },
    );
    return this.makeTaskView(taskDef, refreshed ?? undefined);
  }

  /**
   * POST /onboarding-quest/v1/tasks/:taskKey/claim
   *
   * Idempotent claim. CAS: COMPLETED → CLAIMED + grant reward atomic.
   *
   *   - Linh thach grant via `CurrencyService.applyTx('ONBOARDING_TASK_CLAIM')`.
   *   - Exp grant via `Character.exp` increment trong cùng `$transaction`.
   *   - Title cosmetic (chỉ Day 7 final task) trả về trong response, KHÔNG
   *     ghi `CharacterTitleUnlock` (defer — Phase 34.0 keep scope nhỏ).
   *
   * Race-safe: 2 request đồng thời → exactly one ghi `updateMany.count===1`,
   * cái kia trả về `claimed:false`.
   */
  async claimTask(
    userId: string,
    taskKey: string,
  ): Promise<OnboardingClaimResult> {
    const taskDef = onboardingTaskByKey(taskKey);
    if (!taskDef) throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');
    const characterId = await this.getCharacterIdByUser(userId);
    await this.ensureProgressRows(characterId);

    const linhThach = BigInt(taskDef.reward.linhThach);
    const exp = BigInt(taskDef.reward.exp);
    const now = new Date();

    let claimed = false;
    await this.prisma.$transaction(async (tx) => {
        const cas = await tx.characterOnboardingTaskProgress.updateMany({
          where: { characterId, taskKey, status: 'COMPLETED' },
          data: {
            status: 'CLAIMED',
            claimedAt: now,
            linhThachGranted: taskDef.reward.linhThach,
            expGranted: taskDef.reward.exp,
          },
        });
        if (cas.count !== 1) {
          // Already CLAIMED, or not COMPLETED yet — abort tx silently.
          return;
        }
        if (linhThach > 0n) {
          await this.currency.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: linhThach,
            reason: 'ONBOARDING_TASK_CLAIM',
            refType: 'OnboardingTask',
            refId: taskKey,
            meta: { dayNumber: taskDef.dayNumber, taskKey },
          });
        }
        if (exp > 0n) {
          await tx.character.update({
            where: { id: characterId },
            data: { exp: { increment: exp } },
          });
        }
        // Phase 44.1 — Title unlock làm fail-soft sau khi tx commit ở block
        // dưới (nếu titles service inject). Giữ in-tx scope chỉ cho các
        // reward tài chính (linh thạch + exp) — title cosmetic không đáng
        // rollback toàn bộ reward khi catalog miss.
        claimed = true;
    });

    // Verify status post-tx.
    const row = await this.prisma.characterOnboardingTaskProgress.findUnique({
      where: { characterId_taskKey: { characterId, taskKey } },
      select: { status: true },
    });
    if (!row) throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');

    if (!claimed) {
      // Either already CLAIMED (return current grant from row) or not yet
      // COMPLETED — distinguish via status.
      if (row.status !== 'CLAIMED') {
        throw new OnboardingQuestError('ONBOARDING_TASK_NOT_COMPLETED');
      }
    }

    // After claim, maybe promote day to COMPLETED.
    await this.maybePromoteDayToCompleted(characterId, taskDef.dayNumber, now);
    // Cascade unlock next day.
    await this.ensureProgressRows(characterId);

    // Phase 44.1 — Wire Title system (Phase 11.9.B) cho Day 7 final task.
    // CAS đã guarantee `claimed=true` chỉ chạy 1 lần per task → safe to call
    // unlockTitle (idempotent qua composite UNIQUE ở TitleService).
    // Fail-soft: title fail KHÔNG rollback reward (linh thạch/exp đã commit).
    if (claimed && taskDef.reward.titleKey && this.titles) {
      try {
        await this.titles.unlockTitle(
          characterId,
          taskDef.reward.titleKey,
          'onboarding',
        );
      } catch (e) {
        this.logger.warn(
          `onboarding title unlock failed characterId=${characterId} titleKey=${taskDef.reward.titleKey}: ${(e as Error).message}`,
        );
      }
    }

    return {
      taskKey,
      status: row.status as OnboardingTaskRuntimeStatus,
      claimed,
      linhThachGranted: claimed ? taskDef.reward.linhThach : 0,
      expGranted: claimed ? taskDef.reward.exp : 0,
      titleKey: claimed ? taskDef.reward.titleKey : undefined,
    };
  }

  /**
   * POST /onboarding-quest/v1/recompute — admin/debug: re-evaluate day
   * unlock state. Useful when player liên hệ support: "day 3 không unlock".
   */
  async recompute(userId: string): Promise<OnboardingProgressView> {
    const characterId = await this.getCharacterIdByUser(userId);
    await this.ensureProgressRows(characterId);
    // Re-evaluate day status post-task progress.
    const taskRows = await this.prisma.characterOnboardingTaskProgress.findMany({
      where: { characterId },
      select: { taskKey: true, status: true, dayNumber: true },
    });
    const taskMap = new Map<string, { status: string }>();
    for (const t of taskRows) taskMap.set(t.taskKey, { status: t.status });
    const now = new Date();
    for (const day of ONBOARDING_DAYS) {
      await this.maybePromoteDayToCompleted(characterId, day.dayNumber, now);
    }
    return this.getProgress(userId);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Promote day → COMPLETED nếu tất cả task của day đã COMPLETED/CLAIMED.
   * Idempotent.
   */
  private async maybePromoteDayToCompleted(
    characterId: string,
    dayNumber: number,
    now: Date,
  ): Promise<void> {
    const dayDef = onboardingDayByNumber(dayNumber);
    if (!dayDef) return;
    const tasks = await this.prisma.characterOnboardingTaskProgress.findMany({
      where: {
        characterId,
        taskKey: { in: dayDef.taskKeys },
      },
      select: { status: true },
    });
    if (tasks.length < dayDef.taskKeys.length) return;
    for (const t of tasks) {
      if (t.status !== 'COMPLETED' && t.status !== 'CLAIMED') return;
    }
    // All done — promote day to COMPLETED.
    await this.prisma.characterOnboardingProgress.updateMany({
      where: {
        characterId,
        dayNumber,
        status: { in: ['AVAILABLE', 'IN_PROGRESS'] },
      },
      data: { status: 'COMPLETED', completedAt: now },
    });
  }

  private makeTaskView(
    def: OnboardingTaskDef,
    row?: {
      status: string;
      completedAt: Date | null;
      claimedAt: Date | null;
    },
  ): OnboardingTaskView {
    return {
      taskKey: def.taskKey,
      dayNumber: def.dayNumber,
      titleVi: def.titleVi,
      titleEn: def.titleEn,
      descriptionVi: def.descriptionVi,
      descriptionEn: def.descriptionEn,
      actionRoute: def.actionRoute,
      category: def.category,
      status: ((row?.status as OnboardingTaskRuntimeStatus) ?? 'LOCKED'),
      completedAt: row?.completedAt?.toISOString() ?? null,
      claimedAt: row?.claimedAt?.toISOString() ?? null,
      reward: {
        linhThach: def.reward.linhThach,
        exp: def.reward.exp,
        titleKey: def.reward.titleKey,
      },
    };
  }
}
