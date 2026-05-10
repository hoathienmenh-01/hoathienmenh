/**
 * Phase 14.1.C — Arena Season service integration tests.
 *
 * Coverage:
 *   - getOrCreateActiveSeason lazy-creates 1 row, idempotent on 2nd call.
 *   - getOrCreateStanding lazy-creates standing với default rating, tier.
 *   - applyMatchToStandings updates rating + counters cho cả 2 standing.
 *   - Match flow (createMatch) auto-updates standing per current season.
 *   - Leaderboard sort theo rating DESC, wins DESC tiebreak.
 *   - getMyStanding returns rank live khi standing chưa được settle.
 *   - getRewardPreview trả 5 tiers (Bronze..Immortal) khớp shared table.
 *   - settleSeason chốt rank, gửi reward mail (idempotent qua grant
 *     UNIQUE) — gọi lại không tạo grant trùng + không gửi mail trùng.
 *   - settleSeason no-participants safe.
 *   - createNextSeason tạo season tuần kế tiếp (key khác current).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ARENA_RATING_DEFAULT,
  ARENA_SEASON_REWARD_TABLE,
  arenaCurrentSeasonKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { ArenaService } from './arena.service';
import { ArenaSeasonService, ArenaSeasonServiceError } from './arena-season.service';
import { MailService } from '../mail/mail.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let arena: ArenaService;
let season: ArenaSeasonService;
let mail: MailService;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();

  // Build a real MailService — settleSeason calls sendToCharacter; mock
  // network bits ([RealtimeService.emit*) to no-op.
  const charSvc = new CharacterService(prisma);
  const invSvc = new InventoryService(prisma);
  const rtSvc = {
    emitToUser: () => undefined,
    emitMailNew: () => undefined,
    emitMailDelta: () => undefined,
    emitInventoryDelta: () => undefined,
  } as unknown as RealtimeService;
  mail = new MailService(prisma, charSvc, invSvc, rtSvc);

  season = new ArenaSeasonService(prisma, mail);
  arena = new ArenaService(prisma, season);
});

beforeEach(async () => {
  await wipeAll(prisma);
  delete process.env.ARENA_DAILY_LIMIT_PER_DAY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ArenaSeasonService.getOrCreateActiveSeason', () => {
  it('lazy-creates ACTIVE season for current week', async () => {
    const s = await season.getOrCreateActiveSeason();
    expect(s.status).toBe('ACTIVE');
    expect(s.seasonKey).toBe(arenaCurrentSeasonKey(new Date()));
    expect(s.startsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(s.endsAt.getTime()).toBeGreaterThan(s.startsAt.getTime());
  });

  it('idempotent — 2 calls return same row', async () => {
    const a = await season.getOrCreateActiveSeason();
    const b = await season.getOrCreateActiveSeason();
    expect(b.id).toBe(a.id);
    const count = await prisma.arenaSeason.count();
    expect(count).toBe(1);
  });
});

describe('ArenaSeasonService.getOrCreateStanding', () => {
  it('lazy-creates standing với default rating + tier mapping', async () => {
    const ctx = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    const st = await season.getOrCreateStanding(s.id, ctx.characterId, 1000);
    expect(st.rating).toBe(1000);
    expect(st.tier).toBe('SILVER'); // 1000 → SILVER
    expect(st.wins).toBe(0);
    expect(st.losses).toBe(0);
  });

  it('idempotent — keeps existing rating on 2nd call', async () => {
    const ctx = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    const a = await season.getOrCreateStanding(s.id, ctx.characterId, 1000);
    // Mutate row to verify upsert không reset.
    await prisma.arenaStanding.update({
      where: { id: a.id },
      data: { rating: 1500, tier: 'DIAMOND' },
    });
    const b = await season.getOrCreateStanding(s.id, ctx.characterId, 1000);
    expect(b.rating).toBe(1500);
    expect(b.tier).toBe('DIAMOND');
  });
});

describe('ArenaSeasonService — match → standing update', () => {
  it('createMatch auto-updates standing for attacker + defender', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'truc_co' });
    const b = await makeUserChar(prisma, { realmKey: 'truc_co' });
    await arena.getOrCreateProfile(a.characterId);
    await arena.getOrCreateProfile(b.characterId);

    const result = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
    });
    expect(result.outcome).toMatch(/ATTACKER_WIN|DEFENDER_WIN|DRAW/);

    const s = await season.getOrCreateActiveSeason();
    const sa = await prisma.arenaStanding.findUnique({
      where: { seasonId_characterId: { seasonId: s.id, characterId: a.characterId } },
    });
    const sb = await prisma.arenaStanding.findUnique({
      where: { seasonId_characterId: { seasonId: s.id, characterId: b.characterId } },
    });
    expect(sa).not.toBeNull();
    expect(sb).not.toBeNull();
    // Total wins/losses across cả 2 = 2 trận / 2 (1 attack, 1 defend) = 0..2.
    const total = (sa!.wins + sa!.losses + sb!.wins + sb!.losses);
    // DRAW outcome → cả 2 đều 0; nếu có winner → cả 2 sẽ có 1+1.
    expect(total === 0 || total === 2).toBe(true);
    // Rating không âm.
    expect(sa!.rating).toBeGreaterThanOrEqual(0);
    expect(sb!.rating).toBeGreaterThanOrEqual(0);
  });

  it('rating stays >= 0 (clamp ở Elo apply)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await arena.getOrCreateProfile(a.characterId);
    await arena.getOrCreateProfile(b.characterId);
    // Force defender rating to 0 — even if loses thêm thì standing vẫn >= 0.
    await prisma.arenaProfile.update({
      where: { characterId: b.characterId },
      data: { rating: 0 },
    });
    const s = await season.getOrCreateActiveSeason();
    await season.getOrCreateStanding(s.id, b.characterId, 0);
    await arena.createMatch(a.characterId, { defenderCharacterId: b.characterId });
    const sb = await prisma.arenaStanding.findUnique({
      where: { seasonId_characterId: { seasonId: s.id, characterId: b.characterId } },
    });
    expect(sb!.rating).toBeGreaterThanOrEqual(0);
  });
});

describe('ArenaSeasonService.getLeaderboard', () => {
  it('sorts by rating DESC, wins DESC tiebreak', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const c = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    await season.getOrCreateStanding(s.id, a.characterId, 1100);
    await season.getOrCreateStanding(s.id, b.characterId, 1300);
    await season.getOrCreateStanding(s.id, c.characterId, 1300);
    await prisma.arenaStanding.update({
      where: { seasonId_characterId: { seasonId: s.id, characterId: c.characterId } },
      data: { wins: 5 },
    });
    const lb = await season.getLeaderboard();
    expect(lb.entries.length).toBe(3);
    expect(lb.entries[0].characterId).toBe(c.characterId); // 1300, 5 wins
    expect(lb.entries[1].characterId).toBe(b.characterId); // 1300, 0 wins
    expect(lb.entries[2].characterId).toBe(a.characterId); // 1100
    expect(lb.entries[0].rank).toBe(1);
    expect(lb.entries[1].rank).toBe(2);
    expect(lb.entries[2].rank).toBe(3);
    expect(lb.total).toBe(3);
  });

  it('handles empty leaderboard', async () => {
    await season.getOrCreateActiveSeason();
    const lb = await season.getLeaderboard();
    expect(lb.entries).toEqual([]);
    expect(lb.total).toBe(0);
  });
});

describe('ArenaSeasonService.getMyStanding', () => {
  it('returns null-default standing nếu character chưa chơi', async () => {
    const ctx = await makeUserChar(prisma);
    const me = await season.getMyStanding(ctx.characterId);
    expect(me).not.toBeNull();
    expect(me!.rating).toBe(ARENA_RATING_DEFAULT);
    expect(me!.tier).toBe('SILVER');
    expect(me!.wins).toBe(0);
  });

  it('returns rank theo rating live order', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    await season.getOrCreateStanding(s.id, a.characterId, 1500);
    await season.getOrCreateStanding(s.id, b.characterId, 1000);
    const aMe = await season.getMyStanding(a.characterId);
    const bMe = await season.getMyStanding(b.characterId);
    expect(aMe!.rank).toBe(1);
    expect(bMe!.rank).toBe(2);
  });
});

describe('ArenaSeasonService.getRewardPreview', () => {
  it('returns 5 tiers (Bronze → Immortal)', async () => {
    const preview = await season.getRewardPreview();
    expect(preview.tiers.length).toBe(ARENA_SEASON_REWARD_TABLE.length);
    expect(preview.tiers.map((t) => t.tier)).toEqual([
      'BRONZE',
      'SILVER',
      'GOLD',
      'DIAMOND',
      'IMMORTAL',
    ]);
  });
});

describe('ArenaSeasonService.settleSeason', () => {
  it('settle creates reward mail for each participant + mark season SETTLED', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    await season.getOrCreateStanding(s.id, a.characterId, 1600);
    await season.getOrCreateStanding(s.id, b.characterId, 1100);

    const summary = await season.settleSeason();
    expect(summary.participants).toBe(2);
    expect(summary.newGrants).toBe(2);
    expect(summary.grants).toBe(2);

    const grants = await prisma.arenaSeasonRewardGrant.findMany({
      where: { seasonId: s.id },
      orderBy: { rank: 'asc' },
    });
    expect(grants.length).toBe(2);
    expect(grants[0].rank).toBe(1);
    expect(grants[0].characterId).toBe(a.characterId);
    expect(grants[0].tier).toBe('DIAMOND'); // 1600 → DIAMOND
    expect(grants[0].mailId).not.toBeNull();
    expect(grants[1].rank).toBe(2);
    expect(grants[1].characterId).toBe(b.characterId);
    expect(grants[1].tier).toBe('SILVER'); // 1100 → SILVER (1000-1199)

    // Mail row exists.
    const mailA = await prisma.mail.findUnique({ where: { id: grants[0].mailId! } });
    expect(mailA).not.toBeNull();

    const after = await prisma.arenaSeason.findUnique({ where: { id: s.id } });
    expect(after!.status).toBe('SETTLED');
    expect(after!.settledAt).not.toBeNull();
  });

  it('idempotent — double settle does not duplicate grants/mail', async () => {
    const a = await makeUserChar(prisma);
    const s = await season.getOrCreateActiveSeason();
    await season.getOrCreateStanding(s.id, a.characterId, 1200);

    const first = await season.settleSeason();
    expect(first.newGrants).toBe(1);

    const second = await season.settleSeason();
    expect(second.newGrants).toBe(0);
    expect(second.grants).toBe(1);

    const grantsCount = await prisma.arenaSeasonRewardGrant.count({
      where: { seasonId: s.id },
    });
    expect(grantsCount).toBe(1);
    const mails = await prisma.mail.count({
      where: { recipientId: a.characterId },
    });
    expect(mails).toBe(1);
  });

  it('safe khi no participants', async () => {
    const s = await season.getOrCreateActiveSeason();
    const summary = await season.settleSeason();
    expect(summary.participants).toBe(0);
    expect(summary.newGrants).toBe(0);
    const after = await prisma.arenaSeason.findUnique({ where: { id: s.id } });
    expect(after!.status).toBe('SETTLED');
  });

  it('throws SEASON_NOT_FOUND for unknown season key', async () => {
    await expect(
      season.settleSeason('arena_9999-W99'),
    ).rejects.toBeInstanceOf(ArenaSeasonServiceError);
  });
});

describe('ArenaSeasonService.createNextSeason', () => {
  it('creates next-week season with new key', async () => {
    const cur = await season.getOrCreateActiveSeason();
    const next = await season.createNextSeason();
    expect(next.seasonKey).not.toBe(cur.seasonKey);
    expect(next.status).toBe('ACTIVE');
  });
});
