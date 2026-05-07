import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getBuffDef } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { BuffError, BuffService } from './buff.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: BuffService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new BuffService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('BuffService.applyBuff', () => {
  it('apply non-stackable buff → tạo row mới với stacks=1, expiresAt = now + def.durationSec', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');
    const def = getBuffDef('pill_atk_buff_t1')!;

    const result = await svc.applyBuff(
      ctx.characterId,
      'pill_atk_buff_t1',
      'pill',
      now,
    );

    expect(result.buffKey).toBe('pill_atk_buff_t1');
    expect(result.stacks).toBe(1);
    expect(result.source).toBe('pill');
    expect(result.expiresAt.getTime()).toBe(
      now.getTime() + def.durationSec * 1000,
    );

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].buffKey).toBe('pill_atk_buff_t1');
    expect(rows[0].stacks).toBe(1);
  });

  it('apply non-stackable lần 2 → refresh expiresAt, stacks giữ nguyên 1', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now1 = new Date('2026-05-02T00:00:00Z');
    const now2 = new Date('2026-05-02T00:00:30Z'); // 30s sau

    await svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill', now1);
    const result2 = await svc.applyBuff(
      ctx.characterId,
      'pill_atk_buff_t1',
      'pill',
      now2,
    );

    expect(result2.stacks).toBe(1); // non-stackable
    const def = getBuffDef('pill_atk_buff_t1')!;
    expect(result2.expiresAt.getTime()).toBe(
      now2.getTime() + def.durationSec * 1000,
    );

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1); // Vẫn 1 row.
  });

  it('apply stackable buff lần 2 → stacks=2, refresh expiresAt', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');

    const r1 = await svc.applyBuff(
      ctx.characterId,
      'debuff_burn_hoa',
      'skill',
      now,
    );
    expect(r1.stacks).toBe(1);

    const r2 = await svc.applyBuff(
      ctx.characterId,
      'debuff_burn_hoa',
      'skill',
      now,
    );
    expect(r2.stacks).toBe(2);

    const r3 = await svc.applyBuff(
      ctx.characterId,
      'debuff_burn_hoa',
      'skill',
      now,
    );
    expect(r3.stacks).toBe(3); // cap maxStacks=3
  });

  it('apply stackable buff vượt maxStacks → stacks giữ ở maxStacks (3)', async () => {
    const ctx = await makeUserChar(prisma, {});
    for (let i = 0; i < 5; i++) {
      await svc.applyBuff(ctx.characterId, 'debuff_burn_hoa', 'skill');
    }
    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId, buffKey: 'debuff_burn_hoa' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].stacks).toBe(3); // catalog maxStacks=3
  });

  it('throws BUFF_NOT_FOUND khi buffKey không có trong catalog', async () => {
    const ctx = await makeUserChar(prisma, {});
    await expect(
      svc.applyBuff(ctx.characterId, 'nonexistent_buff', 'pill'),
    ).rejects.toMatchObject({ code: 'BUFF_NOT_FOUND' });
  });

  it('throws CHARACTER_NOT_FOUND khi characterId không tồn tại', async () => {
    await expect(
      svc.applyBuff('char-does-not-exist', 'pill_atk_buff_t1', 'pill'),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});

describe('BuffService.applyBuffTx (Phase 11.8.D-1 tx-aware variant)', () => {
  it('applyBuffTx atomic trong tx outer: success commit → row insert', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');
    const def = getBuffDef('pill_atk_buff_t1')!;

    const result = await prisma.$transaction(async (tx) => {
      return svc.applyBuffTx(
        tx,
        ctx.characterId,
        'pill_atk_buff_t1',
        'pill',
        now,
      );
    });

    expect(result.buffKey).toBe('pill_atk_buff_t1');
    expect(result.stacks).toBe(1);
    expect(result.source).toBe('pill');
    expect(result.expiresAt.getTime()).toBe(
      now.getTime() + def.durationSec * 1000,
    );

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
  });

  it('applyBuffTx atomic trong tx outer: rollback toàn bộ nếu sibling op throw → KHÔNG insert row', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');

    await expect(
      prisma.$transaction(async (tx) => {
        await svc.applyBuffTx(
          tx,
          ctx.characterId,
          'pill_atk_buff_t1',
          'pill',
          now,
        );
        // Sibling op throw → rollback toàn bộ tx (bao gồm applyBuffTx insert).
        throw new Error('SIBLING_FAIL');
      }),
    ).rejects.toThrow('SIBLING_FAIL');

    // Row KHÔNG được insert vì tx rollback.
    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('applyBuffTx idempotent stackable trong cùng tx: 2 calls liên tiếp → stacks=2', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');

    const result = await prisma.$transaction(async (tx) => {
      await svc.applyBuffTx(
        tx,
        ctx.characterId,
        'debuff_burn_hoa',
        'skill',
        now,
      );
      return svc.applyBuffTx(
        tx,
        ctx.characterId,
        'debuff_burn_hoa',
        'skill',
        now,
      );
    });

    expect(result.stacks).toBe(2);

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].stacks).toBe(2);
  });

  it('applyBuffTx throws BUFF_NOT_FOUND trong tx → tx rollback, KHÔNG insert row', async () => {
    const ctx = await makeUserChar(prisma, {});

    await expect(
      prisma.$transaction(async (tx) =>
        svc.applyBuffTx(tx, ctx.characterId, 'nonexistent_buff', 'pill'),
      ),
    ).rejects.toMatchObject({ code: 'BUFF_NOT_FOUND' });

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('applyBuffTx throws CHARACTER_NOT_FOUND trong tx', async () => {
    await expect(
      prisma.$transaction(async (tx) =>
        svc.applyBuffTx(tx, 'char-does-not-exist', 'pill_atk_buff_t1', 'pill'),
      ),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });

  it('applyBuff (wrapper) vẫn hoạt động sau refactor: gọi applyBuffTx qua $transaction', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');
    const def = getBuffDef('debuff_taoma')!;

    const result = await svc.applyBuff(
      ctx.characterId,
      'debuff_taoma',
      'tribulation',
      now,
    );

    expect(result.buffKey).toBe('debuff_taoma');
    expect(result.source).toBe('tribulation');
    expect(result.expiresAt.getTime()).toBe(
      now.getTime() + def.durationSec * 1000,
    );

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(1);
  });

  // Phase 13.0 audit pass #4 — Bug #8: pre-fix applyBuffTx dùng
  // findUnique-then-create pattern; 2 tx outer concurrent với cùng
  // (characterId, buffKey) → both see no existing → both call create →
  // race loser hits P2002 + tx aborts ở Postgres level. Caller (boss reward
  // hook) try/catch swallowed P2002 nhưng tx vẫn aborted → subsequent ops
  // (currency/inventory grant) cũng fail. Fix: refactor sang `createMany`
  // với `skipDuplicates: true` (dịch sang `INSERT … ON CONFLICT DO NOTHING`
  // ở Postgres — đúng atomic, không throw P2002), kèm UPDATE branch khi
  // count=0 (existing row). Prisma's `upsert` KHÔNG atomic
  // (find-then-create) nên không dùng được cho race-safe path.
  it('applyBuffTx race-safe: 2 wrappers concurrent cùng (char, buffKey) → cả 2 commit, không throw P2002', async () => {
    const ctx = await makeUserChar(prisma, {});
    const now = new Date('2026-05-02T00:00:00Z');

    // 2 concurrent wrappers (mỗi wrapper là tx riêng) — pre-fix: 1 trong 2
    // throw P2002. Post-fix: cả 2 succeed (idempotent upsert).
    const [r1, r2] = await Promise.all([
      svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill', now),
      svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill', now),
    ]);

    expect(r1.buffKey).toBe('pill_atk_buff_t1');
    expect(r2.buffKey).toBe('pill_atk_buff_t1');

    // Cuối cùng chỉ có 1 row (composite UNIQUE).
    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId, buffKey: 'pill_atk_buff_t1' },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('BuffService.removeBuff', () => {
  it('xóa buff đã apply → return true; row không còn', async () => {
    const ctx = await makeUserChar(prisma, {});
    await svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill');

    const removed = await svc.removeBuff(ctx.characterId, 'pill_atk_buff_t1');
    expect(removed).toBe(true);

    const rows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('xóa buff không tồn tại → return false (idempotent, không throw)', async () => {
    const ctx = await makeUserChar(prisma, {});
    const removed = await svc.removeBuff(ctx.characterId, 'pill_atk_buff_t1');
    expect(removed).toBe(false);
  });
});

describe('BuffService.listActive + pruneExpired', () => {
  it('listActive auto-prune buff đã expired → chỉ return active', async () => {
    const ctx = await makeUserChar(prisma, {});
    const past = new Date('2026-05-02T00:00:00Z');
    const futureCheck = new Date('2026-05-02T01:00:00Z'); // 1h sau

    // pill_atk_buff_t1 durationSec=60 → applied at past expires at past+60s,
    // tức < futureCheck → expired tại futureCheck.
    await svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill', past);

    // event_double_exp durationSec=3600 → applied at past expires at past+3600s
    // tức = futureCheck. Tại đúng futureCheck → expiresAt > now (gt:now).
    await svc.applyBuff(ctx.characterId, 'event_double_exp', 'event', past);

    // Apply 1 buff với now=futureCheck để chắc chắn 1 buff active.
    await svc.applyBuff(
      ctx.characterId,
      'sect_aura_kim',
      'sect_aura',
      futureCheck,
    );

    const active = await svc.listActive(ctx.characterId, futureCheck);
    const keys = active.map((a) => a.buffKey).sort();
    expect(keys).toContain('sect_aura_kim');
    expect(keys).not.toContain('pill_atk_buff_t1'); // expired

    // Pill row đã bị prune khỏi DB.
    const allRows = await prisma.characterBuff.findMany({
      where: { characterId: ctx.characterId },
    });
    const allKeys = allRows.map((r) => r.buffKey).sort();
    expect(allKeys).not.toContain('pill_atk_buff_t1');
  });

  it('pruneExpired() batch không truyền charId → quét toàn DB', async () => {
    const a = await makeUserChar(prisma, {});
    const b = await makeUserChar(prisma, {});
    const past = new Date('2026-05-02T00:00:00Z');
    const future = new Date('2026-05-02T01:00:00Z');

    await svc.applyBuff(a.characterId, 'pill_atk_buff_t1', 'pill', past);
    await svc.applyBuff(b.characterId, 'pill_def_buff_t1', 'pill', past);

    const pruned = await svc.pruneExpired(undefined, future);
    expect(pruned).toBe(2);

    const all = await prisma.characterBuff.findMany({});
    expect(all).toHaveLength(0);
  });

  it('pruneExpired(characterId) chỉ quét buff của 1 character', async () => {
    const a = await makeUserChar(prisma, {});
    const b = await makeUserChar(prisma, {});
    const past = new Date('2026-05-02T00:00:00Z');
    const future = new Date('2026-05-02T01:00:00Z');

    await svc.applyBuff(a.characterId, 'pill_atk_buff_t1', 'pill', past);
    await svc.applyBuff(b.characterId, 'pill_def_buff_t1', 'pill', past);

    const pruned = await svc.pruneExpired(a.characterId, future);
    expect(pruned).toBe(1);

    const remaining = await prisma.characterBuff.findMany({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].characterId).toBe(b.characterId);
  });
});

describe('BuffService.getMods', () => {
  it('không có buff active → return identity mods (atkMul=1, ...)', async () => {
    const ctx = await makeUserChar(prisma, {});
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.cultivationBlocked).toBe(false);
  });

  it('apply pill_atk_buff_t1 → atkMul tăng (catalog stat_mod 1.12)', async () => {
    const ctx = await makeUserChar(prisma, {});
    await svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.atkMul).toBeGreaterThan(1.0);
    expect(mods.atkMul).toBeCloseTo(1.12, 5);
  });

  it('apply debuff_taoma → cultivationBlocked=true + atkMul giảm', async () => {
    const ctx = await makeUserChar(prisma, {});
    await svc.applyBuff(ctx.characterId, 'debuff_taoma', 'tribulation');
    const mods = await svc.getMods(ctx.characterId);
    expect(mods.cultivationBlocked).toBe(true);
    expect(mods.atkMul).toBeCloseTo(0.9, 5);
  });

  it('expired buff không count vào mods (auto-prune)', async () => {
    const ctx = await makeUserChar(prisma, {});
    const past = new Date('2026-05-02T00:00:00Z');
    const future = new Date('2026-05-02T01:00:00Z');

    // pill_atk_buff_t1 durationSec=60 → expired tại future.
    await svc.applyBuff(ctx.characterId, 'pill_atk_buff_t1', 'pill', past);
    const mods = await svc.getMods(ctx.characterId, future);
    expect(mods.atkMul).toBe(1); // Identity — buff đã prune.
  });

  it('stack-able stacks=2 → effect compound (1.10^2 = 1.21)', async () => {
    const ctx = await makeUserChar(prisma, {});
    // debuff_burn_hoa stackable. Catalog effect là DOT, không stat_mod, nên
    // dùng dotPerTickFlat thay vì atkMul. Test dot scale:
    await svc.applyBuff(ctx.characterId, 'debuff_burn_hoa', 'skill');
    await svc.applyBuff(ctx.characterId, 'debuff_burn_hoa', 'skill');
    const mods = await svc.getMods(ctx.characterId);
    // catalog: dot value 8 per stack. stacks=2 → 16.
    expect(mods.dotPerTickFlat).toBe(16);
  });
});

describe('BuffService — cross-character isolation', () => {
  it('apply / remove / list cho Char A KHÔNG ảnh hưởng Char B', async () => {
    const a = await makeUserChar(prisma, {});
    const b = await makeUserChar(prisma, {});

    await svc.applyBuff(a.characterId, 'pill_atk_buff_t1', 'pill');
    await svc.applyBuff(b.characterId, 'pill_def_buff_t1', 'pill');

    const aActive = await svc.listActive(a.characterId);
    const bActive = await svc.listActive(b.characterId);

    expect(aActive).toHaveLength(1);
    expect(aActive[0].buffKey).toBe('pill_atk_buff_t1');
    expect(bActive).toHaveLength(1);
    expect(bActive[0].buffKey).toBe('pill_def_buff_t1');

    // Remove cho A không ảnh hưởng B.
    await svc.removeBuff(a.characterId, 'pill_atk_buff_t1');
    const bAfter = await svc.listActive(b.characterId);
    expect(bAfter).toHaveLength(1);
  });
});

describe('BuffService — error class', () => {
  it('throws BuffError instance khi buffKey invalid (không leak Prisma)', async () => {
    const ctx = await makeUserChar(prisma, {});
    try {
      await svc.applyBuff(ctx.characterId, 'nope_nope', 'pill');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BuffError);
      expect((e as BuffError).code).toBe('BUFF_NOT_FOUND');
    }
  });
});
