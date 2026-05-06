/**
 * Inventory concurrency regression tests — Phase 12.X (concurrency hardening).
 *
 * Cover các race condition khi 2 request HTTP đến cùng `inventoryItemId`
 * (player double-click trên FE / network retry / bot grind):
 *
 *  1. **`use()` qty=2 → Promise.all([use, use])** — kỳ vọng:
 *     - Cả 2 call cùng succeed (player có 2 lượt dùng đan).
 *     - InventoryItem.qty kết thúc = 0 (row bị delete) hoặc qty=0.
 *     - 2 ItemLedger row 'USE' với qtyDelta=-1 mỗi.
 *     - Bug cũ (`data: { qty: inv.qty - 1 }` capture JS variable trước tx):
 *       cả 2 thread đọc qty=2 → cả 2 update qty=1 → row vẫn còn 1 đan
 *       (item duplication, EXPLOITABLE).
 *
 *  2. **`use()` qty=1 → Promise.all([use, use])** — kỳ vọng:
 *     - Đúng 1 call succeed (consume đan), đúng 1 call fail
 *       INVENTORY_ITEM_NOT_FOUND (row đã delete).
 *     - InventoryItem row delete (không còn row).
 *     - 1 ItemLedger row 'USE' qtyDelta=-1.
 *     - Bug cũ: cả 2 thread thấy qty=1 → cả 2 thử delete → 1 thành công +
 *       1 P2025 unhandled crash → 500 ISE (không user-friendly).
 *
 *  3. **`revoke()` qty=N → Promise.all([revoke half, revoke half])** —
 *     verify atomic decrement không under-revoke. Bug cũ tương tự `use()`:
 *     `data: { qty: r.qty - take }` JS capture race. Phase 12.X concurrency
 *     phase 2 (admin double-revoke race) thêm 3.A (split revoke 5+5 trên
 *     qty=10 — ledger sum invariant) + 3.B (over-subscribe revoke 7+7 trên
 *     qty=10 — exactly 1 succeed + 1 INSUFFICIENT_QTY). Fix dùng
 *     `updateMany` + `deleteMany` guarded với filter `qty: { gte: take }` /
 *     `qty: take` (parity với `use()` atomic decrement).
 *
 * Pattern test: dùng real PG fixtures (TEST_DATABASE_URL) + Promise.all
 * concurrent — KHÔNG mock prisma. Thread interleaving non-deterministic
 * theo PG isolation (default ReadCommitted) — loop `IT` lần để pump race
 * window probability.
 *
 * Lưu ý — race char.hp (Math.min(hpMax, hp + delta) → 2 thread đọc hp cũ
 * → cả 2 ghi cùng cap) là known issue Low priority — under-applied effect
 * (player consume 2 đan nhưng chỉ heal 1 pill amount). KHÔNG exploitable
 * (player thiệt) → defer fix sang separate PR cần raw `LEAST()` SQL hoặc
 * pessimistic char-row lock. Test này KHÔNG assert char.hp delta cụ thể.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, InventoryError } from './inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let inv: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inv = new InventoryService(prisma, realtime, chars);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Resolve cả ok-result và rejection cho Promise.all concurrent — wrap qua
 * `allSettled` thay vì `Promise.all` (which fail-fast khi 1 throw).
 */
async function runConcurrent<T>(
  fn: () => Promise<T>,
  count: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; err: unknown }>> {
  const settled = await Promise.allSettled(Array.from({ length: count }, fn));
  return settled.map((s) =>
    s.status === 'fulfilled'
      ? { ok: true as const, value: s.value }
      : { ok: false as const, err: s.reason },
  );
}

describe('InventoryService — concurrency regression', () => {
  // ─────────────────────────────────────────────────────────────────────
  // Race 1 — `use()` qty=2 atomic decrement
  // ─────────────────────────────────────────────────────────────────────
  describe('use() race — qty=2 Promise.all', () => {
    it('2 concurrent use → cả 2 succeed, final qty=0 (atomic decrement)', async () => {
      const u = await makeUserChar(prisma, { hp: 1, hpMax: 1000 });
      // Grant qty=2 huyet_chi_dan (PILL_HP, effect.hp=60, stackable).
      await inv.grant(
        u.characterId,
        [{ itemKey: 'huyet_chi_dan', qty: 2 }],
        { reason: 'ADMIN_GRANT' },
      );
      const before = await inv.list(u.characterId);
      const pillRow = before.find((x) => x.itemKey === 'huyet_chi_dan');
      expect(pillRow?.qty).toBe(2);
      const invId = pillRow!.id;

      const results = await runConcurrent(
        () => inv.use(u.userId, invId),
        2,
      );
      const okCount = results.filter((r) => r.ok).length;
      const errCount = results.filter((r) => !r.ok).length;
      // Cả 2 use phải succeed — player có quyền dùng cả 2 đan.
      expect(okCount).toBe(2);
      expect(errCount).toBe(0);

      // Final qty = 0 (delete) hoặc row mất hẳn — atomic decrement (`{ decrement: 1 }`)
      // sẽ đếm chính xác. Bug cũ → row còn qty=1 (item duplication).
      const after = await inv.list(u.characterId);
      const remainingPill = after.find((x) => x.itemKey === 'huyet_chi_dan');
      // Row hoặc bị delete (qty=0), hoặc qty đúng=0.
      expect(remainingPill?.qty ?? 0).toBe(0);

      // 2 ItemLedger USE row qtyDelta=-1 mỗi (audit trail).
      const ledgerUse = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          itemKey: 'huyet_chi_dan',
          reason: 'USE',
        },
      });
      expect(ledgerUse).toHaveLength(2);
      expect(ledgerUse.every((l) => l.qtyDelta === -1)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 2 — `use()` qty=1 (last copy) — exactly-once semantics
  // ─────────────────────────────────────────────────────────────────────
  describe('use() race — qty=1 last copy', () => {
    it('2 concurrent use → 1 succeed + 1 INVENTORY_ITEM_NOT_FOUND, không crash 500', async () => {
      const u = await makeUserChar(prisma, { hp: 1, hpMax: 1000 });
      await inv.grant(
        u.characterId,
        [{ itemKey: 'huyet_chi_dan', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const before = await inv.list(u.characterId);
      const pillRow = before.find((x) => x.itemKey === 'huyet_chi_dan');
      expect(pillRow?.qty).toBe(1);
      const invId = pillRow!.id;

      const results = await runConcurrent(
        () => inv.use(u.userId, invId),
        2,
      );
      const okCount = results.filter((r) => r.ok).length;
      const errResults = results.filter((r) => !r.ok) as Array<{
        ok: false;
        err: unknown;
      }>;

      // Exactly 1 success — đan duy nhất chỉ tiêu được 1 lần.
      expect(okCount).toBe(1);
      expect(errResults).toHaveLength(1);

      // Lỗi phải translate thành domain InventoryError, KHÔNG raw Prisma P2025.
      const err = errResults[0].err;
      expect(err).toBeInstanceOf(InventoryError);
      expect((err as InventoryError).code).toBe('INVENTORY_ITEM_NOT_FOUND');

      // Inventory row đã delete (không còn).
      const after = await inv.list(u.characterId);
      expect(after.find((x) => x.itemKey === 'huyet_chi_dan')).toBeUndefined();

      // Đúng 1 ItemLedger USE row.
      const ledgerUse = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          itemKey: 'huyet_chi_dan',
          reason: 'USE',
        },
      });
      expect(ledgerUse).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 3 — `use()` qty=3 với 3 concurrent calls → tất cả succeed
  // ─────────────────────────────────────────────────────────────────────
  describe('use() race — qty=3 với 3 concurrent calls', () => {
    it('3 concurrent use trên qty=3 → cả 3 succeed, final qty=0', async () => {
      const u = await makeUserChar(prisma, { hp: 1, hpMax: 1000 });
      await inv.grant(
        u.characterId,
        [{ itemKey: 'huyet_chi_dan', qty: 3 }],
        { reason: 'ADMIN_GRANT' },
      );
      const before = await inv.list(u.characterId);
      const invId = before.find((x) => x.itemKey === 'huyet_chi_dan')!.id;

      const results = await runConcurrent(
        () => inv.use(u.userId, invId),
        3,
      );
      const okCount = results.filter((r) => r.ok).length;
      expect(okCount).toBe(3);

      const after = await inv.list(u.characterId);
      expect(
        after.find((x) => x.itemKey === 'huyet_chi_dan')?.qty ?? 0,
      ).toBe(0);

      const ledgerUse = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          itemKey: 'huyet_chi_dan',
          reason: 'USE',
        },
      });
      expect(ledgerUse).toHaveLength(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 4 — `use()` qty=2 với 4 concurrent (over-subscribe)
  // ─────────────────────────────────────────────────────────────────────
  describe('use() race — qty=2 với 4 concurrent (over-subscribe)', () => {
    it('4 concurrent use trên qty=2 → đúng 2 succeed + 2 INVENTORY_ITEM_NOT_FOUND', async () => {
      const u = await makeUserChar(prisma, { hp: 1, hpMax: 1000 });
      await inv.grant(
        u.characterId,
        [{ itemKey: 'huyet_chi_dan', qty: 2 }],
        { reason: 'ADMIN_GRANT' },
      );
      const before = await inv.list(u.characterId);
      const invId = before.find((x) => x.itemKey === 'huyet_chi_dan')!.id;

      const results = await runConcurrent(
        () => inv.use(u.userId, invId),
        4,
      );
      const okCount = results.filter((r) => r.ok).length;
      const errResults = results.filter((r) => !r.ok) as Array<{
        ok: false;
        err: unknown;
      }>;
      expect(okCount).toBe(2);
      expect(errResults).toHaveLength(2);
      // Mọi rejection phải là InventoryError 'INVENTORY_ITEM_NOT_FOUND'.
      for (const e of errResults) {
        expect(e.err).toBeInstanceOf(InventoryError);
        expect((e.err as InventoryError).code).toBe('INVENTORY_ITEM_NOT_FOUND');
      }

      const after = await inv.list(u.characterId);
      expect(
        after.find((x) => x.itemKey === 'huyet_chi_dan')?.qty ?? 0,
      ).toBe(0);

      const ledgerUse = await prisma.itemLedger.findMany({
        where: {
          characterId: u.characterId,
          itemKey: 'huyet_chi_dan',
          reason: 'USE',
        },
      });
      expect(ledgerUse).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 3.A — `revoke()` qty=N → Promise.all([revoke half, revoke half])
  // (Phase 12.X concurrency phase 2 — admin double-revoke race)
  //
  // Admin tool có thể trigger 2 `POST /admin/users/:id/revoke` song song
  // (network retry / double-click / 2 admin cùng session). Bug cũ:
  // `data: { qty: r.qty - take }` capture JS variable (đọc từ findMany
  // trước tx commit) — cả 2 thread đọc qty=10, both write qty=10-5=5 →
  // row giữ ở qty=5 (chỉ revoke 5 thật) NHƯNG ledger ghi 2 row -5 mỗi
  // (sum -10) → audit ledger lệch DB row delta. SAU fix (`updateMany`
  // guarded + `deleteMany` guarded): atomic, exactly N revoked.
  //
  // Invariant per round: |sum(ledger.qtyDelta)| === starting_qty -
  // remaining_row_qty. Không silent under-revoke.
  // ─────────────────────────────────────────────────────────────────────
  describe('revoke() race — qty=10 với 2× revoke(5) Promise.all', () => {
    /**
     * Stress loop pump race window — vitest single-shot có thể không
     * trigger PG row lock interleave. Loop 30 round, mỗi round wipe +
     * recreate fixtures + Promise.all([revoke 5, revoke 5]) trên 1 row
     * stackable qty=10. Bug cũ: row stays qty=5 + ledger -10 sum (audit
     * lệch). Sau fix: row deleted + ledger -10 sum (consistent), HOẶC
     * 1 fail INSUFFICIENT_QTY → row qty=5 + ledger -5 sum (consistent).
     */
    it('30× Promise.all([revoke 5, revoke 5]) on qty=10 → ledger sum khớp DB delta', async () => {
      const ROUNDS = 30;
      for (let i = 0; i < ROUNDS; i++) {
        await wipeAll(prisma);
        const u = await makeUserChar(prisma);
        // Grant qty=10 huyet_chi_dan stackable → 1 row qty=10.
        await inv.grant(
          u.characterId,
          [{ itemKey: 'huyet_chi_dan', qty: 10 }],
          { reason: 'ADMIN_GRANT' },
        );

        const results = await runConcurrent(
          () =>
            inv.revoke(u.characterId, 'huyet_chi_dan', 5, {
              actorUserId: 'admin-test',
            }),
          2,
        );
        const okCount = results.filter((r) => r.ok).length;
        // Sau fix: 2 succeed (row deleted) HOẶC 1 succeed + 1 fail
        // INSUFFICIENT_QTY (atomic guard detect concurrent → rollback).
        // Trước fix: 2 succeed nhưng row leak qty=5 (under-revoke).
        for (const r of results) {
          if (!r.ok) {
            expect(r.err).toBeInstanceOf(InventoryError);
            expect((r.err as InventoryError).code).toBe('INSUFFICIENT_QTY');
          }
        }

        // Audit invariant: ledger sum (negative) === DB delta (positive).
        const after = await prisma.inventoryItem.findMany({
          where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
        });
        const remainingRow = after.reduce((s, r) => s + r.qty, 0);
        const dbDelta = 10 - remainingRow;

        const ledgerRev = await prisma.itemLedger.findMany({
          where: {
            characterId: u.characterId,
            itemKey: 'huyet_chi_dan',
            reason: 'ADMIN_REVOKE',
          },
        });
        const ledgerSum = ledgerRev.reduce((s, l) => s + l.qtyDelta, 0);
        expect(
          -ledgerSum,
          `Round ${i + 1}: ledger=${ledgerSum} dbDelta=${dbDelta} ok=${okCount} remaining=${remainingRow} — ledger phải khớp DB delta (no under-revoke / over-revoke)`,
        ).toBe(dbDelta);

        // Range sanity: 5 ≤ dbDelta ≤ 10. Nếu cả 2 succeed → 10. Nếu 1
        // succeed + 1 fail → 5. KHÔNG được < 5 (1 succeed luôn revoke đủ
        // 5) và KHÔNG > 10 (over-revoke không thể vì atomic guard).
        expect(dbDelta).toBeGreaterThanOrEqual(5);
        expect(dbDelta).toBeLessThanOrEqual(10);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 3.B — `revoke()` qty=10 với 2× revoke(7) over-subscribe →
  // exactly-one succeed (cả 2 không thể succeed vì 14 > 10).
  // ─────────────────────────────────────────────────────────────────────
  describe('revoke() race — qty=10 với 2× revoke(7) over-subscribe', () => {
    /**
     * Stress loop — Promise.all([revoke 7, revoke 7]) trên row qty=10.
     * Total cần = 14 > 10 → KHÔNG thể cả 2 succeed. Bug cũ có thể cho
     * 2 succeed (under-revoke 7+7=14 nhưng row chỉ giảm 7). Sau fix:
     * exactly 1 succeed + 1 fail INSUFFICIENT_QTY (pre-check `total < qty`
     * hoặc per-row guard catch concurrent decrement).
     */
    it('30× Promise.all([revoke 7, revoke 7]) on qty=10 → exactly 1 succeed + 1 INSUFFICIENT_QTY', async () => {
      const ROUNDS = 30;
      for (let i = 0; i < ROUNDS; i++) {
        await wipeAll(prisma);
        const u = await makeUserChar(prisma);
        await inv.grant(
          u.characterId,
          [{ itemKey: 'huyet_chi_dan', qty: 10 }],
          { reason: 'ADMIN_GRANT' },
        );

        const results = await runConcurrent(
          () =>
            inv.revoke(u.characterId, 'huyet_chi_dan', 7, {
              actorUserId: 'admin-test',
            }),
          2,
        );
        const okCount = results.filter((r) => r.ok).length;
        const errCount = results.filter((r) => !r.ok).length;

        // Trước fix: có thể 2 succeed (cả 2 đọc total=10, both pass
        // pre-check, both decrement row 10→3 nhưng JS-capture race →
        // 1 thread overwrite → row stuck qty=3 với ledger -7+-7=-14 →
        // ledger lệch DB delta). Sau fix: per-row guard `qty >= take`
        // catch → 2nd thread throw → exactly 1 succeed.
        expect(
          okCount,
          `Round ${i + 1}: expected exactly 1 succeed, got ${okCount}`,
        ).toBe(1);
        expect(errCount).toBe(1);

        const failed = results.find((r) => !r.ok);
        expect(failed).toBeDefined();
        expect((failed as { err: unknown }).err).toBeInstanceOf(InventoryError);
        expect(((failed as { err: InventoryError }).err).code).toBe(
          'INSUFFICIENT_QTY',
        );

        // Audit ledger row count = 1 (đúng 1 ADMIN_REVOKE -7).
        const ledgerRev = await prisma.itemLedger.findMany({
          where: {
            characterId: u.characterId,
            itemKey: 'huyet_chi_dan',
            reason: 'ADMIN_REVOKE',
          },
        });
        expect(ledgerRev).toHaveLength(1);
        expect(ledgerRev[0].qtyDelta).toBe(-7);

        // DB delta = 7 → remaining row qty = 3.
        const after = await prisma.inventoryItem.findMany({
          where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
        });
        const remainingRow = after.reduce((s, r) => s + r.qty, 0);
        expect(remainingRow).toBe(3);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 5 — `equip()` concurrent on same slot — exactly-one invariant
  //
  // Player có 2 sword (sword A, sword B). Race khi Promise.all([equip(A),
  // equip(B)]) trên slot=WEAPON:
  //   - Trước fix: cả 2 thread findFirst trước commit → đều không thấy
  //     current weapon → cả 2 update equippedSlot=WEAPON → 2 sword cùng
  //     đeo → equipBonus() sum cả 2 → DOUBLE WEAPON STAT EXPLOIT.
  //   - Sau fix: SELECT FOR UPDATE on Character row serialize ops →
  //     chính xác 1 sword equipped, 1 sword unequipped.
  // ─────────────────────────────────────────────────────────────────────
  describe('equip() race — concurrent on same slot', () => {
    /**
     * Stress loop để pump race window probability — vitest single-shot có
     * thể không trigger race (PG row lock + Prisma fast-path). Loop 30 round
     * mỗi round wipe + recreate fixtures + Promise.all([equip A, equip B]).
     * Sau 30 round, slot uniqueness invariant phải giữ ở mọi round (không
     * round nào có 2 sword cùng equippedSlot=WEAPON).
     */
    it('30× Promise.all([equip(A), equip(B)]) → mọi round đúng 1 sword equipped (slot uniqueness)', async () => {
      const ROUNDS = 30;
      for (let i = 0; i < ROUNDS; i++) {
        await wipeAll(prisma);
        const u = await makeUserChar(prisma);
        // Grant 2 sword (so_kiem = WEAPON slot, non-stackable → 2 row).
        await inv.grant(
          u.characterId,
          [{ itemKey: 'so_kiem', qty: 1 }],
          { reason: 'ADMIN_GRANT' },
        );
        await inv.grant(
          u.characterId,
          [{ itemKey: 'so_kiem', qty: 1 }],
          { reason: 'ADMIN_GRANT' },
        );
        const before = await inv.list(u.characterId);
        const swords = before.filter((x) => x.itemKey === 'so_kiem');
        const [swA, swB] = swords;

        await Promise.allSettled([
          inv.equip(u.userId, swA.id),
          inv.equip(u.userId, swB.id),
        ]);

        // Slot uniqueness invariant: ≤ 1 sword có equippedSlot=WEAPON.
        // Trước fix: race có thể tạo 2 sword cùng slot=WEAPON → equipBonus
        // double-count → DOUBLE WEAPON STAT EXPLOIT. Sau fix: SELECT FOR
        // UPDATE on Character.id serialize ops → đúng 1 sword.
        const afterRows = await prisma.inventoryItem.findMany({
          where: { characterId: u.characterId, itemKey: 'so_kiem' },
        });
        const equipped = afterRows.filter((r) => r.equippedSlot === 'WEAPON');
        expect(
          equipped.length,
          `Round ${i + 1}: expected ≤ 1 sword equipped, got ${equipped.length}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  });
});
