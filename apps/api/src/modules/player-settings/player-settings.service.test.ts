import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import {
  PlayerSettingsError,
  PlayerSettingsService,
} from './player-settings.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: PlayerSettingsService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new PlayerSettingsService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('PlayerSettingsService — Phase 41.0', () => {
  it('returns default settings when no row exists yet', async () => {
    const u = await makeUserChar(prisma);
    const got = await svc.getSettings(u.userId);
    expect(got.characterId).toBe(u.characterId);
    expect(got.settings.fontSize).toBe('normal');
    expect(got.settings.appearance).toBe('system');
  });

  it('updates fontSize to a valid value', async () => {
    const u = await makeUserChar(prisma);
    const after = await svc.patchSettings(u.userId, { fontSize: 'large' });
    expect(after.settings.fontSize).toBe('large');
    const again = await svc.getSettings(u.userId);
    expect(again.settings.fontSize).toBe('large');
  });

  it('rejects an invalid fontSize value', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.patchSettings(u.userId, { fontSize: 'humongous' }),
    ).rejects.toBeInstanceOf(PlayerSettingsError);
  });

  it('reset returns settings to default', async () => {
    const u = await makeUserChar(prisma);
    await svc.patchSettings(u.userId, { fontSize: 'large' });
    const after = await svc.resetSettings(u.userId);
    expect(after.settings.fontSize).toBe('normal');
  });

  it('NO_CHARACTER when user lacks character row', async () => {
    const user = await prisma.user.create({
      data: { email: `nochar-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    await expect(svc.getSettings(user.id)).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });
});
