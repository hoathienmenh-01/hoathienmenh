/**
 * Phase 44.2 — Onboarding `recordAction` caller wiring.
 *
 * Smoke-coverage cho 3 caller mới wire ở Phase 44.2:
 *   - InventoryService.equip(WEAPON) → recordAction('EQUIP_WEAPON')
 *   - MailService.markRead → recordAction('MAIL_OPEN')
 *   - NpcService.getDialogueForNpc → recordAction('NPC_TALK')
 *
 * Mỗi test:
 *   1. tạo character + bootstrap onboarding (lazy-create progress rows),
 *   2. xác minh task `AVAILABLE`,
 *   3. trigger action thật (equip / markRead / getDialogueForNpc),
 *   4. wait microtask (fire-and-forget),
 *   5. assert task chuyển sang `COMPLETED`.
 *
 * Không test reward grant — đó là responsibility của onboarding claim path
 * (đã cover ở `onboarding-quest.service.test.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NPCS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { CurrencyService } from '../character/currency.service';
import { WebPushService } from '../web-push/web-push.service';
import { MailService } from '../mail/mail.service';
import { NpcService } from '../npc/npc.service';
import { OnboardingQuestService } from './onboarding-quest.service';
import { TitleService } from '../character/title.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let onboarding: OnboardingQuestService;
let inventory: InventoryService;
let mail: MailService;
let npc: NpcService;

/**
 * Track all in-flight `notifyAction` promises kicked off by `void
 * onboarding.notifyAction(...)` in production callers (mail/npc/inventory).
 * `flushFireAndForget` drains this queue deterministically — replaces the
 * earlier `setTimeout(0)` x2 race which flaked under CI load.
 */
const pendingNotifies: Promise<void>[] = [];

/**
 * Drain all queued `notifyAction` promises. Loops until the queue is empty
 * because awaiting one notify can chain further work (defensive — current
 * impl is single-step but cheap to guard).
 */
async function flushFireAndForget(): Promise<void> {
  while (pendingNotifies.length > 0) {
    const batch = pendingNotifies.splice(0);
    await Promise.all(batch);
  }
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const title = new TitleService(prisma);
  onboarding = new OnboardingQuestService(prisma, currency, title);
  // Wrap `notifyAction` so every `void this.onboarding.notifyAction(...)`
  // call from production code registers its Promise in `pendingNotifies`.
  // Method lookup happens dynamically on the instance, so callers that
  // were constructed below pick up the wrapped impl automatically.
  const originalNotify = onboarding.notifyAction.bind(onboarding);
  onboarding.notifyAction = (
    characterId: string,
    actionType: Parameters<typeof originalNotify>[1],
  ): Promise<void> => {
    const p = originalNotify(characterId, actionType);
    pendingNotifies.push(p);
    return p;
  };
  inventory = new InventoryService(prisma, realtime, chars, undefined, onboarding);
  const webPush = new WebPushService(prisma);
  mail = new MailService(
    prisma,
    currency,
    inventory,
    realtime,
    webPush,
    undefined,
    onboarding,
  );
  npc = new NpcService(prisma, onboarding);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 44.2 — recordAction wiring', () => {
  describe('EQUIP_WEAPON via InventoryService.equip', () => {
    it('equip WEAPON slot flip task d2_equip_weapon → COMPLETED', async () => {
      const u = await makeUserChar(prisma, { realmKey: 'kim_dan' });
      // Bootstrap onboarding progress rows (lazy-create Day 1-7).
      await onboarding.getProgress(u.userId);
      // Day 2 unlocked nhờ task Day 1 nào đó flip → here we promote thẳng:
      // simulate Day 1 complete to flip Day 2 from LOCKED → AVAILABLE.
      // Solution đơn giản: directly set Day 2 task AVAILABLE để chỉ test
      // EQUIP_WEAPON wiring (không phải onboarding gate logic).
      await prisma.characterOnboardingTaskProgress.updateMany({
        where: { characterId: u.characterId, taskKey: 'd2_equip_weapon' },
        data: { status: 'AVAILABLE' },
      });

      await inventory.grant(
        u.characterId,
        [{ itemKey: 'so_kiem', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const item = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });

      await inventory.equip(u.userId, item.id);
      await flushFireAndForget();

      const taskRow = await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
        where: { characterId: u.characterId, taskKey: 'd2_equip_weapon' },
      });
      expect(taskRow.status).toBe('COMPLETED');
      expect(taskRow.completedAt).not.toBeNull();
    });

    it('equip non-WEAPON slot KHÔNG flip task d2_equip_weapon', async () => {
      const u = await makeUserChar(prisma, { realmKey: 'kim_dan' });
      await onboarding.getProgress(u.userId);
      await prisma.characterOnboardingTaskProgress.updateMany({
        where: { characterId: u.characterId, taskKey: 'd2_equip_weapon' },
        data: { status: 'AVAILABLE' },
      });

      // Grant armor (slot=ARMOR, KHÔNG phải WEAPON).
      await inventory.grant(
        u.characterId,
        [{ itemKey: 'pham_giap', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const item = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'pham_giap' },
      });

      await inventory.equip(u.userId, item.id);
      await flushFireAndForget();

      const taskRow = await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
        where: { characterId: u.characterId, taskKey: 'd2_equip_weapon' },
      });
      // ARMOR slot equip → no-op.
      expect(taskRow.status).toBe('AVAILABLE');
    });
  });

  describe('MAIL_OPEN via MailService.markRead', () => {
    it('markRead flip task d5_check_mail → COMPLETED', async () => {
      const u = await makeUserChar(prisma);
      await onboarding.getProgress(u.userId);
      await prisma.characterOnboardingTaskProgress.updateMany({
        where: { characterId: u.characterId, taskKey: 'd5_check_mail' },
        data: { status: 'AVAILABLE' },
      });

      const row = await prisma.mail.create({
        data: {
          recipientId: u.characterId,
          senderName: 'Hệ thống',
          subject: 'Phase 44.2 test mail',
          body: 'test body',
          mailType: 'SYSTEM',
        },
      });

      await mail.markRead(u.userId, row.id);
      await flushFireAndForget();

      const taskRow = await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
        where: { characterId: u.characterId, taskKey: 'd5_check_mail' },
      });
      expect(taskRow.status).toBe('COMPLETED');
      expect(taskRow.completedAt).not.toBeNull();
    });

    it('markRead idempotent — re-mark KHÔNG re-flip COMPLETED task', async () => {
      const u = await makeUserChar(prisma);
      await onboarding.getProgress(u.userId);
      await prisma.characterOnboardingTaskProgress.updateMany({
        where: { characterId: u.characterId, taskKey: 'd5_check_mail' },
        data: { status: 'AVAILABLE' },
      });

      const row = await prisma.mail.create({
        data: {
          recipientId: u.characterId,
          senderName: 'Hệ thống',
          subject: 'idempotent test',
          body: 'idempotent',
          mailType: 'SYSTEM',
        },
      });

      await mail.markRead(u.userId, row.id);
      await flushFireAndForget();
      const firstCompletedAt = (
        await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
          where: { characterId: u.characterId, taskKey: 'd5_check_mail' },
        })
      ).completedAt;

      await mail.markRead(u.userId, row.id);
      await flushFireAndForget();
      const secondCompletedAt = (
        await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
          where: { characterId: u.characterId, taskKey: 'd5_check_mail' },
        })
      ).completedAt;

      // updateMany filter `status: 'AVAILABLE'` → second call no-op,
      // completedAt KHÔNG đổi.
      expect(firstCompletedAt).toEqual(secondCompletedAt);
    });
  });

  describe('NPC_TALK via NpcService.getDialogueForNpc', () => {
    it('getDialogueForNpc flip task d4_talk_npc → COMPLETED', async () => {
      // Pick NPC realmGateOrder=0 (any starter realm satisfies).
      const starterNpc = NPCS.find((n) => n.realmGateOrder <= 1);
      if (!starterNpc) throw new Error('no NPC with realmGateOrder<=1 in catalog');

      const u = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
      await onboarding.getProgress(u.userId);
      await prisma.characterOnboardingTaskProgress.updateMany({
        where: { characterId: u.characterId, taskKey: 'd4_talk_npc' },
        data: { status: 'AVAILABLE' },
      });

      await npc.getDialogueForNpc(u.userId, starterNpc.key);
      await flushFireAndForget();

      const taskRow = await prisma.characterOnboardingTaskProgress.findFirstOrThrow({
        where: { characterId: u.characterId, taskKey: 'd4_talk_npc' },
      });
      expect(taskRow.status).toBe('COMPLETED');
      expect(taskRow.completedAt).not.toBeNull();
    });
  });
});
