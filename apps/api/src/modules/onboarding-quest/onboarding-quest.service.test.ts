import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_DAYS,
  ONBOARDING_TASKS,
  onboardingTasksForDay,
} from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  OnboardingQuestError,
  OnboardingQuestService,
} from './onboarding-quest.service';
import {
  TEST_DATABASE_URL,
  makeOnboardingQuestService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let onboarding: OnboardingQuestService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  ({ onboarding } = makeOnboardingQuestService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY_1_FIRST = 'd1_claim_daily_login';
const DAY_1_TASKS = onboardingTasksForDay(1).map((t) => t.taskKey);
const DAY_2_FIRST = 'd2_check_realm';
const DAY_7_FINAL = 'd7_complete_onboarding';

describe('OnboardingQuestService.getProgress', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(onboarding.getProgress('no-such-user')).rejects.toThrow(
      new OnboardingQuestError('NO_CHARACTER'),
    );
  });

  it('lazy-create progress rows lần đầu — Day 1 AVAILABLE, Day 2-7 LOCKED', async () => {
    const { userId } = await makeUserChar(prisma);
    const progress = await onboarding.getProgress(userId);

    expect(progress.totalDays).toBe(7);
    expect(progress.totalTasks).toBe(ONBOARDING_TASKS.length);
    expect(progress.completedTasks).toBe(0);
    expect(progress.claimedTasks).toBe(0);
    expect(progress.days).toHaveLength(7);
    expect(progress.days[0].status).toBe('AVAILABLE');
    for (let i = 1; i < 7; i++) {
      expect(progress.days[i].status).toBe('LOCKED');
    }
  });

  it('Day 1 tasks all AVAILABLE, Day 2 tasks all LOCKED lần đầu', async () => {
    const { userId } = await makeUserChar(prisma);
    const progress = await onboarding.getProgress(userId);
    const day1 = progress.days.find((d) => d.dayNumber === 1)!;
    const day2 = progress.days.find((d) => d.dayNumber === 2)!;
    for (const t of day1.tasks) expect(t.status).toBe('AVAILABLE');
    for (const t of day2.tasks) expect(t.status).toBe('LOCKED');
  });

  it('idempotent — re-call không tạo duplicate row', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    await onboarding.getProgress(userId);
    await onboarding.getProgress(userId);
    const dayRows = await prisma.characterOnboardingProgress.findMany({
      where: { characterId },
    });
    const taskRows = await prisma.characterOnboardingTaskProgress.findMany({
      where: { characterId },
    });
    expect(dayRows).toHaveLength(7);
    expect(taskRows).toHaveLength(ONBOARDING_TASKS.length);
  });
});

describe('OnboardingQuestService.getDay', () => {
  it('throws ONBOARDING_DAY_UNKNOWN cho day không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(onboarding.getDay(userId, 99)).rejects.toThrow(
      new OnboardingQuestError('ONBOARDING_DAY_UNKNOWN'),
    );
  });

  it('trả về detail của day có tasks đúng order', async () => {
    const { userId } = await makeUserChar(prisma);
    const day = await onboarding.getDay(userId, 1);
    expect(day.dayNumber).toBe(1);
    expect(day.totalTasks).toBe(DAY_1_TASKS.length);
    expect(day.tasks.map((t) => t.taskKey)).toEqual(DAY_1_TASKS);
  });
});

describe('OnboardingQuestService.completeTask', () => {
  it('throws ONBOARDING_TASK_UNKNOWN cho taskKey không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(onboarding.completeTask(userId, 'bogus_task')).rejects.toThrow(
      new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN'),
    );
  });

  it('throws ONBOARDING_TASK_LOCKED cho Day 2 task khi Day 1 chưa xong', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(onboarding.completeTask(userId, DAY_2_FIRST)).rejects.toThrow(
      new OnboardingQuestError('ONBOARDING_TASK_LOCKED'),
    );
  });

  it('AVAILABLE → COMPLETED, ghi completedAt, day status IN_PROGRESS', async () => {
    const { userId } = await makeUserChar(prisma);
    const view = await onboarding.completeTask(userId, DAY_1_FIRST);
    expect(view.status).toBe('COMPLETED');
    expect(view.completedAt).toBeTruthy();

    const day = await onboarding.getDay(userId, 1);
    expect(day.status).toBe('IN_PROGRESS');
    expect(day.completedTasks).toBe(1);
  });

  it('idempotent — gọi 2 lần trên task đã COMPLETED không double-flip', async () => {
    const { userId } = await makeUserChar(prisma);
    const view1 = await onboarding.completeTask(userId, DAY_1_FIRST);
    const view2 = await onboarding.completeTask(userId, DAY_1_FIRST);
    expect(view2.status).toBe('COMPLETED');
    // completedAt phải giữ nguyên (KHÔNG được overwrite trên call 2).
    expect(view2.completedAt).toBe(view1.completedAt);
  });

  it('hoàn thành tất cả Day 1 tasks → Day 1 COMPLETED + Day 2 unlock', async () => {
    const { userId } = await makeUserChar(prisma);
    for (const tk of DAY_1_TASKS) {
      await onboarding.completeTask(userId, tk);
    }
    const progress = await onboarding.getProgress(userId);
    const d1 = progress.days.find((d) => d.dayNumber === 1)!;
    const d2 = progress.days.find((d) => d.dayNumber === 2)!;
    expect(d1.status).toBe('COMPLETED');
    expect(d2.status).toBe('AVAILABLE');
    for (const t of d2.tasks) expect(t.status).toBe('AVAILABLE');
  });
});

describe('OnboardingQuestService.claimTask', () => {
  async function setup() {
    const { userId, characterId } = await makeUserChar(prisma, {
      linhThach: 0n,
    });
    return { userId, characterId };
  }

  it('throws ONBOARDING_TASK_NOT_COMPLETED nếu chưa COMPLETED', async () => {
    const { userId } = await setup();
    await expect(onboarding.claimTask(userId, DAY_1_FIRST)).rejects.toThrow(
      new OnboardingQuestError('ONBOARDING_TASK_NOT_COMPLETED'),
    );
  });

  it('COMPLETED → CLAIMED, grant linh thach + exp + ghi ledger', async () => {
    const { userId, characterId } = await setup();
    await onboarding.completeTask(userId, DAY_1_FIRST);
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true, exp: true },
    });
    const expectedReward = ONBOARDING_TASKS.find(
      (t) => t.taskKey === DAY_1_FIRST,
    )!.reward;

    const result = await onboarding.claimTask(userId, DAY_1_FIRST);
    expect(result.claimed).toBe(true);
    expect(result.status).toBe('CLAIMED');
    expect(result.linhThachGranted).toBe(expectedReward.linhThach);
    expect(result.expGranted).toBe(expectedReward.exp);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true, exp: true },
    });
    expect(after.linhThach - before.linhThach).toBe(
      BigInt(expectedReward.linhThach),
    );
    expect(after.exp - before.exp).toBe(BigInt(expectedReward.exp));

    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        reason: 'ONBOARDING_TASK_CLAIM',
        refType: 'OnboardingTask',
        refId: DAY_1_FIRST,
      },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledger[0].delta).toBe(BigInt(expectedReward.linhThach));
  });

  it('idempotent — re-call claim không cộng tiền lần 2', async () => {
    const { userId, characterId } = await setup();
    await onboarding.completeTask(userId, DAY_1_FIRST);
    await onboarding.claimTask(userId, DAY_1_FIRST);
    const after1 = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true },
    });

    const result2 = await onboarding.claimTask(userId, DAY_1_FIRST);
    expect(result2.claimed).toBe(false);
    expect(result2.linhThachGranted).toBe(0);
    expect(result2.expGranted).toBe(0);

    const after2 = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true },
    });
    expect(after2.linhThach).toBe(after1.linhThach);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'ONBOARDING_TASK_CLAIM' },
    });
    expect(ledger).toHaveLength(1);
  });

  it('Day 7 final task claim trả về titleKey', async () => {
    const { userId } = await makeUserChar(prisma);
    // Force unlock all days by completing tasks Day 1-6.
    for (let day = 1; day <= 7; day++) {
      for (const tdef of onboardingTasksForDay(day)) {
        await onboarding.completeTask(userId, tdef.taskKey);
      }
    }
    const result = await onboarding.claimTask(userId, DAY_7_FINAL);
    expect(result.claimed).toBe(true);
    expect(result.titleKey).toBe('onboarding_novice_cultivator');
  });

  it('claim không grant Tien Ngoc dù catalog có set (defense in depth)', async () => {
    const { userId, characterId } = await setup();
    await onboarding.completeTask(userId, DAY_1_FIRST);
    await onboarding.claimTask(userId, DAY_1_FIRST);

    const tienNgocLedger = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        reason: 'ONBOARDING_TASK_CLAIM',
        currency: CurrencyKind.TIEN_NGOC,
      },
    });
    expect(tienNgocLedger).toHaveLength(0);

    const char = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { tienNgoc: true },
    });
    expect(char.tienNgoc).toBe(0);
  });
});

describe('OnboardingQuestService.acceptTask', () => {
  it('flip day AVAILABLE → IN_PROGRESS (cosmetic)', async () => {
    const { userId } = await makeUserChar(prisma);
    await onboarding.getProgress(userId);
    await onboarding.acceptTask(userId, DAY_1_FIRST);
    const day = await onboarding.getDay(userId, 1);
    expect(day.status).toBe('IN_PROGRESS');
  });

  it('throws ONBOARDING_TASK_LOCKED nếu task chưa unlock', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(onboarding.acceptTask(userId, DAY_2_FIRST)).rejects.toThrow(
      new OnboardingQuestError('ONBOARDING_TASK_LOCKED'),
    );
  });

  it('idempotent — gọi 2 lần không lỗi', async () => {
    const { userId } = await makeUserChar(prisma);
    await onboarding.getProgress(userId);
    const v1 = await onboarding.acceptTask(userId, DAY_1_FIRST);
    const v2 = await onboarding.acceptTask(userId, DAY_1_FIRST);
    expect(v1.status).toBe('AVAILABLE');
    expect(v2.status).toBe('AVAILABLE');
  });
});

describe('OnboardingQuestService.recompute', () => {
  it('recompute trả về progress đầy đủ', async () => {
    const { userId } = await makeUserChar(prisma);
    const progress = await onboarding.recompute(userId);
    expect(progress.totalDays).toBe(7);
    expect(progress.days[0].status).toBe('AVAILABLE');
  });

  it('recompute re-evaluate day status sau khi tasks complete', async () => {
    const { userId } = await makeUserChar(prisma);
    for (const tk of DAY_1_TASKS) {
      await onboarding.completeTask(userId, tk);
    }
    const after = await onboarding.recompute(userId);
    expect(after.days[0].status).toBe('COMPLETED');
    expect(after.days[1].status).toBe('AVAILABLE');
  });
});

describe('Phase 34.0 cap audit', () => {
  it('toàn bộ catalog có total linh thach ≤ 4500 (test mirror catalog test)', async () => {
    let total = 0;
    for (const t of ONBOARDING_TASKS) total += t.reward.linhThach;
    expect(total).toBeLessThanOrEqual(4500);
  });

  it('tổng số task = sum của day.taskKeys.length', async () => {
    const dayTaskSum = ONBOARDING_DAYS.reduce(
      (sum, d) => sum + d.taskKeys.length,
      0,
    );
    expect(dayTaskSum).toBe(ONBOARDING_TASKS.length);
  });
});
