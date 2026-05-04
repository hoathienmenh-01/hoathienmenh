import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma, Role, TopupStatus } from '@prisma/client';
import {
  ELEMENTS,
  SPIRITUAL_ROOT_GRADES,
  expCostForStage,
  getSpiritualRootGradeDef,
  itemByKey,
  type ElementKey,
  type SpiritualRootGrade,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyError, CurrencyService } from '../character/currency.service';
import { TopupService, type TopupOrderView } from '../topup/topup.service';
import { RealtimeService } from '../realtime/realtime.service';
import { InventoryService } from '../inventory/inventory.service';
import { auditLedger, auditResultToJson, type AuditResultJson } from './ledger-audit';
import {
  queryEconomyAlerts,
  type EconomyAlertsResult,
} from './economy-alerts-query';

export class AdminError extends Error {
  constructor(
    public code:
      | 'NOT_FOUND'
      | 'INVALID_INPUT'
      | 'FORBIDDEN'
      | 'ALREADY_PROCESSED'
      | 'CANNOT_TARGET_SELF',
  ) {
    super(code);
  }
}

const MAX_GRANT_LINH_THACH = 1_000_000_000n; // 1 tỷ
const MAX_GRANT_TIEN_NGOC = 1_000_000;
const MAX_REVOKE_QTY = 999; // chặn admin gõ nhầm lệnh revoke số khổng lồ
const MAX_GRANT_QTY = 999; // mirror revoke cap cho admin grant item
const MAX_GRANT_EXP = 10n ** 18n; // 10^18 — đủ cho mọi cảnh giới + buffer; chặn nhập sai BigInt
const PAGE_SIZE = 30;

export interface AdminUserRow {
  id: string;
  email: string;
  role: Role;
  banned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  character: {
    id: string;
    name: string;
    realmKey: string;
    realmStage: number;
    linhThach: string;
    tienNgoc: number;
  } | null;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chars: CharacterService,
    private readonly topup: TopupService,
    private readonly realtime: RealtimeService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- users ----------

  async listUsers(
    q: string | undefined,
    page: number,
    filters: {
      role?: Role;
      banned?: boolean;
      linhThachMin?: bigint;
      linhThachMax?: bigint;
      tienNgocMin?: number;
      tienNgocMax?: number;
      realmKey?: string;
    } = {},
  ): Promise<{
    rows: AdminUserRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions: Prisma.UserWhereInput[] = [];
    if (q) {
      conditions.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { character: { is: { name: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    if (filters.role !== undefined) conditions.push({ role: filters.role });
    if (filters.banned !== undefined) conditions.push({ banned: filters.banned });

    // Smart admin filter: range/realm trên character. User không có character (chưa
    // tạo) sẽ tự động bị loại khỏi kết quả khi bất kỳ filter character nào set.
    const charConditions: Prisma.CharacterWhereInput = {};
    const linhThachFilter: { gte?: bigint; lte?: bigint } = {};
    if (filters.linhThachMin !== undefined) linhThachFilter.gte = filters.linhThachMin;
    if (filters.linhThachMax !== undefined) linhThachFilter.lte = filters.linhThachMax;
    if (linhThachFilter.gte !== undefined || linhThachFilter.lte !== undefined) {
      charConditions.linhThach = linhThachFilter;
    }
    const tienNgocFilter: { gte?: number; lte?: number } = {};
    if (filters.tienNgocMin !== undefined) tienNgocFilter.gte = filters.tienNgocMin;
    if (filters.tienNgocMax !== undefined) tienNgocFilter.lte = filters.tienNgocMax;
    if (tienNgocFilter.gte !== undefined || tienNgocFilter.lte !== undefined) {
      charConditions.tienNgoc = tienNgocFilter;
    }
    if (filters.realmKey) charConditions.realmKey = filters.realmKey;
    if (Object.keys(charConditions).length > 0) {
      conditions.push({ character: { is: charConditions } });
    }

    const where: Prisma.UserWhereInput = conditions.length > 0 ? { AND: conditions } : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { character: true },
        orderBy: { createdAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      rows: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        banned: u.banned,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        character: u.character
          ? {
              id: u.character.id,
              name: u.character.name,
              realmKey: u.character.realmKey,
              realmStage: u.character.realmStage,
              linhThach: u.character.linhThach.toString(),
              tienNgoc: u.character.tienNgoc,
            }
          : null,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * Smart admin user export CSV (session 9i task E): trả về toàn bộ user khớp
   * filter (không pagination) để admin export ra CSV. Cap ở `MAX_EXPORT_ROWS`
   * để tránh hết RAM khi user-base lớn — admin nhận thông báo trong response
   * header `X-Export-Truncated` (set bởi controller).
   *
   * Reuse cùng filter logic với `listUsers` (single source of truth) — bất kỳ
   * filter nào hợp lệ ở `listUsers` đều hợp lệ ở đây.
   */
  async exportUsers(
    actorId: string,
    q: string | undefined,
    filters: {
      role?: Role;
      banned?: boolean;
      linhThachMin?: bigint;
      linhThachMax?: bigint;
      tienNgocMin?: number;
      tienNgocMax?: number;
      realmKey?: string;
    } = {},
  ): Promise<{ rows: AdminUserRow[]; truncated: boolean; total: number }> {
    const conditions: Prisma.UserWhereInput[] = [];
    if (q) {
      conditions.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { character: { is: { name: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    if (filters.role !== undefined) conditions.push({ role: filters.role });
    if (filters.banned !== undefined) conditions.push({ banned: filters.banned });

    const charConditions: Prisma.CharacterWhereInput = {};
    const linhThachFilter: { gte?: bigint; lte?: bigint } = {};
    if (filters.linhThachMin !== undefined) linhThachFilter.gte = filters.linhThachMin;
    if (filters.linhThachMax !== undefined) linhThachFilter.lte = filters.linhThachMax;
    if (linhThachFilter.gte !== undefined || linhThachFilter.lte !== undefined) {
      charConditions.linhThach = linhThachFilter;
    }
    const tienNgocFilter: { gte?: number; lte?: number } = {};
    if (filters.tienNgocMin !== undefined) tienNgocFilter.gte = filters.tienNgocMin;
    if (filters.tienNgocMax !== undefined) tienNgocFilter.lte = filters.tienNgocMax;
    if (tienNgocFilter.gte !== undefined || tienNgocFilter.lte !== undefined) {
      charConditions.tienNgoc = tienNgocFilter;
    }
    if (filters.realmKey) charConditions.realmKey = filters.realmKey;
    if (Object.keys(charConditions).length > 0) {
      conditions.push({ character: { is: charConditions } });
    }

    const where: Prisma.UserWhereInput = conditions.length > 0 ? { AND: conditions } : {};
    const MAX_EXPORT_ROWS = 5000;
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { character: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
      }),
      this.prisma.user.count({ where }),
    ]);
    const truncated = total > MAX_EXPORT_ROWS;
    // Stringify bigint filters cho audit JSON (Prisma JSON không serialize bigint).
    const filtersJson: Record<string, string | number | boolean | null> = {
      q: q ?? null,
      role: filters.role ?? null,
      banned: filters.banned ?? null,
      linhThachMin: filters.linhThachMin !== undefined ? filters.linhThachMin.toString() : null,
      linhThachMax: filters.linhThachMax !== undefined ? filters.linhThachMax.toString() : null,
      tienNgocMin: filters.tienNgocMin ?? null,
      tienNgocMax: filters.tienNgocMax ?? null,
      realmKey: filters.realmKey ?? null,
    };
    await this.audit(actorId, 'user.exportCsv', {
      total,
      exported: rows.length,
      truncated,
      filters: filtersJson,
    });
    return {
      rows: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        banned: u.banned,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        character: u.character
          ? {
              id: u.character.id,
              name: u.character.name,
              realmKey: u.character.realmKey,
              realmStage: u.character.realmStage,
              linhThach: u.character.linhThach.toString(),
              tienNgoc: u.character.tienNgoc,
            }
          : null,
      })),
      truncated,
      total,
    };
  }

  async setBanned(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    banned: boolean,
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new AdminError('NOT_FOUND');
    // Hierarchy: MOD chỉ thao tác lên PLAYER. Chỉ ADMIN mới ban được MOD/ADMIN.
    if (actorRole !== 'ADMIN' && target.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    await this.prisma.user.update({ where: { id: targetUserId }, data: { banned } });
    await this.audit(actorId, banned ? 'user.ban' : 'user.unban', { targetUserId });
  }

  async setRole(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    role: Role,
  ): Promise<void> {
    // Chỉ ADMIN mới được đổi role.
    if (actorRole !== 'ADMIN') throw new AdminError('FORBIDDEN');
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new AdminError('NOT_FOUND');
    await this.prisma.user.update({ where: { id: targetUserId }, data: { role } });
    await this.audit(actorId, 'user.setRole', { targetUserId, role });
  }

  /**
   * Cộng linh thạch / tiên ngọc (có thể âm để trừ).
   * Linh thạch dùng atomic { increment } trên BigInt (chuyển sang Number không an toàn).
   */
  async grant(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    deltaLinhThach: bigint,
    deltaTienNgoc: number,
    reason: string,
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    if (deltaLinhThach === 0n && deltaTienNgoc === 0) throw new AdminError('INVALID_INPUT');
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!targetUser) throw new AdminError('NOT_FOUND');
    if (actorRole !== 'ADMIN' && targetUser.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    if (deltaLinhThach > MAX_GRANT_LINH_THACH || deltaLinhThach < -MAX_GRANT_LINH_THACH) {
      throw new AdminError('INVALID_INPUT');
    }
    if (
      deltaTienNgoc > MAX_GRANT_TIEN_NGOC ||
      deltaTienNgoc < -MAX_GRANT_TIEN_NGOC
    ) {
      throw new AdminError('INVALID_INPUT');
    }

    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true, linhThach: true, tienNgoc: true },
    });
    if (!target) throw new AdminError('NOT_FOUND');

    // Áp dụng từng đồng tiền qua CurrencyService — mỗi đồng = 1 dòng ledger.
    // Bao trong $transaction để cả 2 cùng pass hoặc cùng rollback (tránh
    // tình huống cộng linh thạch ok nhưng tiên ngọc fail → state nửa vời).
    try {
      await this.prisma.$transaction(async (tx) => {
        if (deltaLinhThach !== 0n) {
          await this.currency.applyTx(tx, {
            characterId: target.id,
            currency: CurrencyKind.LINH_THACH,
            delta: deltaLinhThach,
            reason: 'ADMIN_GRANT',
            refType: 'User',
            refId: targetUserId,
            actorUserId: actorId,
            meta: { reason },
          });
        }
        if (deltaTienNgoc !== 0) {
          await this.currency.applyTx(tx, {
            characterId: target.id,
            currency: CurrencyKind.TIEN_NGOC,
            delta: BigInt(deltaTienNgoc),
            reason: 'ADMIN_GRANT',
            refType: 'User',
            refId: targetUserId,
            actorUserId: actorId,
            meta: { reason },
          });
        }
      });
    } catch (e) {
      if (
        e instanceof CurrencyError &&
        (e.code === 'INSUFFICIENT_FUNDS' || e.code === 'INVALID_INPUT')
      ) {
        throw new AdminError('INVALID_INPUT');
      }
      throw e;
    }

    await this.audit(actorId, 'user.grant', {
      targetUserId,
      deltaLinhThach: deltaLinhThach.toString(),
      deltaTienNgoc,
      reason,
    });

    const state = await this.chars.findByUser(targetUserId);
    if (state) this.realtime.emitToUser(targetUserId, 'state:update', state);
  }

  /**
   * Thu hồi item khỏi túi người chơi — admin tool.
   * Use-case: cấp nhầm, ban cheat, refund item giao dịch lỗi.
   *
   *  - MOD chỉ revoke được PLAYER; ADMIN revoke được MOD/ADMIN.
   *  - Không revoke chính mình (`CANNOT_TARGET_SELF`).
   *  - qty 1..999 — bảo vệ khỏi lệnh nhầm số lớn.
   *  - Không revoke được nếu tổng qty trong túi nhỏ hơn `qty` → `INVALID_INPUT`.
   *  - Ghi `ItemLedger` với `reason=ADMIN_REVOKE` + `actorUserId` + meta reason.
   *  - Ghi audit log `admin.inventory.revoke`.
   */
  async revokeInventory(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    itemKey: string,
    qty: number,
    reason: string,
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_REVOKE_QTY) {
      throw new AdminError('INVALID_INPUT');
    }
    if (!itemKey || itemKey.length > 80) throw new AdminError('INVALID_INPUT');
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!targetUser) throw new AdminError('NOT_FOUND');
    if (actorRole !== 'ADMIN' && targetUser.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true },
    });
    if (!target) throw new AdminError('NOT_FOUND');

    try {
      await this.inventory.revoke(target.id, itemKey, qty, {
        refType: 'User',
        refId: targetUserId,
        actorUserId: actorId,
        extra: { reason },
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ITEM_NOT_FOUND' || code === 'INSUFFICIENT_QTY') {
        throw new AdminError('INVALID_INPUT');
      }
      throw e;
    }

    await this.audit(actorId, 'admin.inventory.revoke', {
      targetUserId,
      itemKey,
      qty,
      reason,
    });

    const state = await this.chars.findByUser(targetUserId);
    if (state) this.realtime.emitToUser(targetUserId, 'state:update', state);
  }

  // ---------- seed harness (admin tooling cho QA / smoke positive-paths) ----------

  /**
   * Cộng EXP trực tiếp vào `Character.exp` — admin seed cho breakthrough
   * smoke / cultivation method test / mission completion test.
   *
   *  - Chỉ cho phép `delta > 0` (không bao giờ trừ EXP — có thể phá realm
   *    invariant nếu trừ xuống dưới 0).
   *  - Cap `MAX_GRANT_EXP = 10^18` (đủ buffer trên realm cao nhất, chặn
   *    nhập sai BigInt).
   *  - MOD chỉ grant cho PLAYER; ADMIN grant được mọi role (mirror
   *    `grant`/`revokeInventory` hierarchy).
   *  - KHÔNG ghi `CurrencyLedger` — EXP không phải currency, không có ledger
   *    schema. Audit duy nhất qua `AdminAuditLog action='admin.exp.grant'`.
   *  - Sau update emit `state:update` qua realtime để client refresh exp UI.
   */
  async grantExp(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    delta: bigint,
    reason: string,
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    if (delta <= 0n || delta > MAX_GRANT_EXP) throw new AdminError('INVALID_INPUT');
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!targetUser) throw new AdminError('NOT_FOUND');
    if (actorRole !== 'ADMIN' && targetUser.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true, exp: true, realmKey: true, realmStage: true },
    });
    if (!target) throw new AdminError('NOT_FOUND');

    // Auto-advance stage 1..8 trong cùng realm — mirror
    // `CultivationProcessor` line 134-140 logic. Bảo đảm grant-exp seed
    // KHÔNG bypass server authority: state cuối tương đương player tu luyện
    // tự nhiên đến khi exp = delta. Stage 9 PHẢI thủ công qua
    // `POST /character/breakthrough` (quy tắc gameplay: peak breakthrough
    // luôn manual). Auto-advance stop ở stage 9, exp tích luỹ tiếp như
    // cultivation tick natural behavior.
    let exp = target.exp + delta;
    let realmStage = target.realmStage;
    let cap = expCostForStage(target.realmKey, realmStage);
    while (cap !== null && exp >= cap && realmStage < 9) {
      exp -= cap;
      realmStage += 1;
      cap = expCostForStage(target.realmKey, realmStage);
    }

    await this.prisma.character.update({
      where: { id: target.id },
      data: { exp, realmStage },
    });

    await this.audit(actorId, 'admin.exp.grant', {
      targetUserId,
      characterId: target.id,
      deltaExp: delta.toString(),
      reason,
      realmStageAfter: realmStage,
      expAfter: exp.toString(),
    });

    const state = await this.chars.findByUser(targetUserId);
    if (state) this.realtime.emitToUser(targetUserId, 'state:update', state);
  }

  /**
   * Cấp item vào túi player — admin seed cho item-consume smokes (skill
   * book, linh_can_dan reroll, pill, equip).
   *
   *  - `qty` 1..999 — mirror revoke cap, chặn nhập sai số khổng lồ.
   *  - `itemKey` phải tồn tại trong shared catalog (`itemByKey`) — chống
   *    typo silent-noop (`InventoryService.grant` skip itemKey không có
   *    def → audit empty, hành vi khó debug).
   *  - MOD chỉ grant cho PLAYER; ADMIN grant được mọi role.
   *  - Reuse `inventory.grant()` → tự động ghi `ItemLedger` với
   *    `reason='ADMIN_GRANT'` + `actorUserId` + meta reason. Stackable
   *    item gộp qty, non-stackable tạo row mới.
   *  - Audit `AdminAuditLog action='admin.inventory.grant'`.
   */
  async grantItem(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    itemKey: string,
    qty: number,
    reason: string,
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_GRANT_QTY) {
      throw new AdminError('INVALID_INPUT');
    }
    if (!itemKey || itemKey.length > 80) throw new AdminError('INVALID_INPUT');
    if (!itemByKey(itemKey)) throw new AdminError('INVALID_INPUT');
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!targetUser) throw new AdminError('NOT_FOUND');
    if (actorRole !== 'ADMIN' && targetUser.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true },
    });
    if (!target) throw new AdminError('NOT_FOUND');

    await this.inventory.grant(target.id, [{ itemKey, qty }], {
      reason: 'ADMIN_GRANT',
      refType: 'User',
      refId: targetUserId,
      actorUserId: actorId,
      extra: { reason },
    });

    await this.audit(actorId, 'admin.inventory.grant', {
      targetUserId,
      itemKey,
      qty,
      reason,
    });

    const state = await this.chars.findByUser(targetUserId);
    if (state) this.realtime.emitToUser(targetUserId, 'state:update', state);
  }

  /**
   * Override Linh căn / Spiritual Root — admin seed cho combat element
   * smoke (kim/moc/thuy/hoa/tho controlled), spiritual root reroll smoke
   * (force grade=than max tier).
   *
   *  - `grade` ∈ SPIRITUAL_ROOT_GRADES (5-tier).
   *  - `primaryElement` ∈ ELEMENTS (5 ngũ hành).
   *  - `secondaryElements` (optional): subset ELEMENTS, không trùng primary,
   *    không duplicate, count phải khớp `secondaryElementCount` của grade
   *    (pham=0, linh=1, huyen=2, tien=3, than=4). Nếu omit, server tự
   *    derive theo thứ tự ELEMENTS skip primary (deterministic).
   *  - `purity` (optional 1-100): default 100 — admin override luôn lấy
   *    purity max trừ khi caller nói khác.
   *  - MOD chỉ override cho PLAYER; ADMIN override được mọi role.
   *  - Persist vào Character + insert `SpiritualRootRollLog` source='admin_grant'
   *    (audit immutable trail; previousGrade/Element fields snapshot).
   *  - Audit `AdminAuditLog action='admin.spiritualRoot.grant'`.
   */
  async grantSpiritualRoot(
    actorId: string,
    actorRole: Role,
    targetUserId: string,
    input: {
      grade: SpiritualRootGrade;
      primaryElement: ElementKey;
      secondaryElements?: ElementKey[];
      purity?: number;
      reason: string;
    },
  ): Promise<void> {
    if (actorId === targetUserId) throw new AdminError('CANNOT_TARGET_SELF');
    if (!SPIRITUAL_ROOT_GRADES.includes(input.grade)) {
      throw new AdminError('INVALID_INPUT');
    }
    if (!ELEMENTS.includes(input.primaryElement)) {
      throw new AdminError('INVALID_INPUT');
    }
    const purity = input.purity ?? 100;
    if (!Number.isInteger(purity) || purity < 1 || purity > 100) {
      throw new AdminError('INVALID_INPUT');
    }
    const def = getSpiritualRootGradeDef(input.grade);
    let secondary: ElementKey[];
    if (input.secondaryElements === undefined) {
      // Deterministic default — ELEMENTS order skip primary.
      secondary = ELEMENTS.filter((e) => e !== input.primaryElement).slice(
        0,
        def.secondaryElementCount,
      );
    } else {
      secondary = input.secondaryElements;
      if (secondary.length !== def.secondaryElementCount) {
        throw new AdminError('INVALID_INPUT');
      }
      const seen = new Set<ElementKey>();
      for (const el of secondary) {
        if (!ELEMENTS.includes(el)) throw new AdminError('INVALID_INPUT');
        if (el === input.primaryElement) throw new AdminError('INVALID_INPUT');
        if (seen.has(el)) throw new AdminError('INVALID_INPUT');
        seen.add(el);
      }
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!targetUser) throw new AdminError('NOT_FOUND');
    if (actorRole !== 'ADMIN' && targetUser.role !== 'PLAYER') {
      throw new AdminError('FORBIDDEN');
    }
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: {
        id: true,
        spiritualRootGrade: true,
        primaryElement: true,
        secondaryElements: true,
        rootPurity: true,
      },
    });
    if (!target) throw new AdminError('NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      await tx.character.update({
        where: { id: target.id },
        data: {
          spiritualRootGrade: input.grade,
          primaryElement: input.primaryElement,
          secondaryElements: secondary,
          rootPurity: purity,
        },
      });
      await tx.spiritualRootRollLog.create({
        data: {
          characterId: target.id,
          source: 'admin_grant',
          previousGrade: target.spiritualRootGrade,
          newGrade: input.grade,
          previousElement: target.primaryElement,
          newElement: input.primaryElement,
          previousSecondaryElements: target.secondaryElements,
          newSecondaryElements: secondary,
          previousPurity: target.spiritualRootGrade ? target.rootPurity : null,
          newPurity: purity,
        },
      });
    });

    await this.audit(actorId, 'admin.spiritualRoot.grant', {
      targetUserId,
      characterId: target.id,
      grade: input.grade,
      primaryElement: input.primaryElement,
      secondaryElements: secondary,
      purity,
      reason: input.reason,
    });

    const state = await this.chars.findByUser(targetUserId);
    if (state) this.realtime.emitToUser(targetUserId, 'state:update', state);
  }

  // ---------- topup ----------

  async listTopups(
    status: TopupStatus | null,
    page: number,
    filters: { fromDate?: Date; toDate?: Date; userEmail?: string } = {},
  ): Promise<{
    rows: (TopupOrderView & { userEmail: string })[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions: Prisma.TopupOrderWhereInput[] = [];
    if (status) conditions.push({ status });
    if (filters.fromDate || filters.toDate) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.fromDate) range.gte = filters.fromDate;
      if (filters.toDate) range.lte = filters.toDate;
      conditions.push({ createdAt: range });
    }
    if (filters.userEmail) {
      const matchUsers = await this.prisma.user.findMany({
        where: { email: { contains: filters.userEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      const ids = matchUsers.map((u) => u.id);
      conditions.push({ userId: { in: ids } });
    }
    const where: Prisma.TopupOrderWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};
    const [rows, total] = await Promise.all([
      this.prisma.topupOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.topupOrder.count({ where }),
    ]);
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.email]));
    const approverIds = rows
      .map((r) => r.approvedById)
      .filter((id): id is string => Boolean(id));
    const approvers = approverIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, email: true },
        })
      : [];
    const approverMap = new Map(approvers.map((u) => [u.id, u.email]));
    return {
      rows: rows.map((r) => ({
        ...this.topup.toView(
          r,
          r.approvedById ? approverMap.get(r.approvedById) ?? null : null,
        ),
        userEmail: userMap.get(r.userId) ?? '???',
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async approveTopup(actorId: string, orderId: string, note: string): Promise<void> {
    const order = await this.prisma.topupOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new AdminError('NOT_FOUND');
    if (order.status !== 'PENDING') throw new AdminError('ALREADY_PROCESSED');
    // Anti-fraud: admin/mod không được tự duyệt đơn của chính mình.
    if (order.userId === actorId) throw new AdminError('CANNOT_TARGET_SELF');

    await this.prisma.$transaction(async (tx) => {
      // Yêu cầu user đã onboard — nếu chưa có character thì không thể credit.
      // Refuse approve để admin không vô tình đánh dấu APPROVED mà không cộng
      // tiền (đơn vẫn ở PENDING, admin có thể chờ user onboard rồi duyệt lại,
      // hoặc reject rồi hoàn tiền ngoài hệ thống).
      const char = await tx.character.findUnique({ where: { userId: order.userId } });
      if (!char) throw new AdminError('NOT_FOUND');

      // Flip atomic.
      const flip = await tx.topupOrder.updateMany({
        where: { id: orderId, status: TopupStatus.PENDING },
        data: {
          status: TopupStatus.APPROVED,
          approvedById: actorId,
          approvedAt: new Date(),
          note,
        },
      });
      if (flip.count === 0) throw new AdminError('ALREADY_PROCESSED');

      await this.currency.applyTx(tx, {
        characterId: char.id,
        currency: CurrencyKind.TIEN_NGOC,
        delta: BigInt(order.tienNgocAmount),
        reason: 'ADMIN_TOPUP_APPROVE',
        refType: 'TopupOrder',
        refId: order.id,
        actorUserId: actorId,
        meta: { packageKey: order.packageKey, priceVND: order.priceVND },
      });
    });

    await this.audit(actorId, 'topup.approve', {
      orderId,
      userId: order.userId,
      tienNgoc: order.tienNgocAmount,
    });

    const state = await this.chars.findByUser(order.userId);
    if (state) this.realtime.emitToUser(order.userId, 'state:update', state);
  }

  async rejectTopup(actorId: string, orderId: string, note: string): Promise<void> {
    const order = await this.prisma.topupOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new AdminError('NOT_FOUND');
    if (order.status !== 'PENDING') throw new AdminError('ALREADY_PROCESSED');
    if (order.userId === actorId) throw new AdminError('CANNOT_TARGET_SELF');
    const flip = await this.prisma.topupOrder.updateMany({
      where: { id: orderId, status: TopupStatus.PENDING },
      data: {
        status: TopupStatus.REJECTED,
        approvedById: actorId,
        approvedAt: new Date(),
        note,
      },
    });
    if (flip.count === 0) throw new AdminError('ALREADY_PROCESSED');
    await this.audit(actorId, 'topup.reject', { orderId, note });
  }

  // ---------- audit ----------

  async listAudit(
    page: number,
    filters: { actionPrefix?: string; actorEmail?: string } = {},
  ): Promise<{
    rows: {
      id: string;
      actorUserId: string;
      actorEmail: string | null;
      action: string;
      meta: Prisma.JsonValue;
      createdAt: string;
    }[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions: Prisma.AdminAuditLogWhereInput[] = [];
    if (filters.actionPrefix) {
      conditions.push({ action: { startsWith: filters.actionPrefix } });
    }
    if (filters.actorEmail) {
      const matchUsers = await this.prisma.user.findMany({
        where: { email: { contains: filters.actorEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      const ids = matchUsers.map((u) => u.id);
      conditions.push({ actorUserId: { in: ids } });
    }
    const where: Prisma.AdminAuditLogWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId)));
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, email: true },
    });
    const actorMap = new Map(actors.map((u) => [u.id, u.email]));
    return {
      rows: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        actorEmail: actorMap.get(r.actorUserId) ?? null,
        action: r.action,
        meta: r.meta,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async stats(): Promise<{
    users: { total: number; banned: number; admins: number };
    characters: {
      total: number;
      cultivating: number;
      bySect: { sectId: string | null; name: string; count: number }[];
    };
    economy: {
      linhThachCirculating: string;
      tienNgocCirculating: string;
      topupPending: number;
      topupApproved: number;
      topupRejected: number;
    };
    activity: {
      last24hLogins: number;
      last7dRegistrations: number;
    };
  }> {
    const now = new Date();
    const d1 = new Date(now.getTime() - 24 * 3600 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const [
      usersTotal,
      usersBanned,
      usersAdmin,
      charsTotal,
      charsCultivating,
      bySectRaw,
      sumsRaw,
      topupPending,
      topupApproved,
      topupRejected,
      last24hLogins,
      last7dRegistrations,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { banned: true } }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.character.count(),
      this.prisma.character.count({ where: { cultivating: true } }),
      this.prisma.character.groupBy({
        by: ['sectId'],
        _count: { _all: true },
      }),
      this.prisma.character.aggregate({
        _sum: { linhThach: true, tienNgoc: true },
      }),
      this.prisma.topupOrder.count({ where: { status: TopupStatus.PENDING } }),
      this.prisma.topupOrder.count({ where: { status: TopupStatus.APPROVED } }),
      this.prisma.topupOrder.count({ where: { status: TopupStatus.REJECTED } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: d1 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    ]);

    const sectIds = bySectRaw
      .map((r) => r.sectId)
      .filter((s): s is string => s != null);
    const sects =
      sectIds.length > 0
        ? await this.prisma.sect.findMany({
            where: { id: { in: sectIds } },
            select: { id: true, name: true },
          })
        : [];
    const sectMap = new Map(sects.map((s) => [s.id, s.name]));
    const bySect = bySectRaw
      .map((r) => ({
        sectId: r.sectId ?? null,
        name: r.sectId ? (sectMap.get(r.sectId) ?? 'unknown') : 'none',
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const linhThachSum = sumsRaw._sum.linhThach ?? 0n;
    const tienNgocSum = sumsRaw._sum.tienNgoc ?? 0;

    return {
      users: { total: usersTotal, banned: usersBanned, admins: usersAdmin },
      characters: { total: charsTotal, cultivating: charsCultivating, bySect },
      economy: {
        linhThachCirculating: linhThachSum.toString(),
        tienNgocCirculating: tienNgocSum.toString(),
        topupPending,
        topupApproved,
        topupRejected,
      },
      activity: {
        last24hLogins,
        last7dRegistrations,
      },
    };
  }

  /**
   * Smart economy alerts cho admin/mod overview.
   *
   * Liệt kê các bất thường economy mà closed-beta cần phát hiện sớm:
   * - characters có currency âm (linhThach/tienNgoc/tienNgocKhoa < 0) — invariant violation.
   * - inventory items có qty < 1 — invariant violation (nên đã bị xoá khi qty=0).
   * - topup orders PENDING quá `staleHours` giờ (mặc định 24h) — admin lười duyệt.
   *
   * Read-only, không gây side-effect, MOD đọc được.
   */
  async getEconomyAlerts(staleHours = 24): Promise<EconomyAlertsResult> {
    return queryEconomyAlerts(this.prisma, staleHours);
  }

  /**
   * Smart economy safety: chạy ledger audit on-demand từ admin endpoint.
   *
   * Reuse pure logic `auditLedger()` từ `ledger-audit.ts` (cùng dùng với CLI script
   * `pnpm audit:ledger`). Verify SUM(CurrencyLedger.delta) per character + currency
   * khớp Character.linhThach/tienNgoc; SUM(ItemLedger.qtyDelta) khớp InventoryItem.qty.
   *
   * Read-only — không mutate DB. Discrepancies trả về để FE hiển thị, admin có thể
   * chuyển sang manual investigation flow.
   */
  async runLedgerAudit(): Promise<AuditResultJson> {
    const result = await auditLedger(this.prisma);
    return auditResultToJson(result);
  }

  /**
   * Smart economy report: top whales theo linhThach + tienNgoc + tổng circulation.
   *
   * Mục đích cho closed beta:
   *   - Admin thấy ai đang giàu nhất → xác định reward target / rebalance.
   *   - Tổng circulation = sanity check kinh tế (tăng đột biến = bot/exploit).
   *   - Số character đang cultivate / tổng character giúp đánh giá retention.
   *
   * Read-only, MOD đọc được. Top N = 10 (đủ overview, không quá nhiều rows trên UI).
   * BigInt linhThach serialize thành string để FE format an toàn.
   */
  async getEconomyReport(): Promise<{
    generatedAt: string;
    circulation: {
      linhThachTotal: string;
      tienNgocTotal: number;
      tienNgocKhoaTotal: number;
      characterCount: number;
      cultivatingCount: number;
    };
    topByLinhThach: {
      characterId: string;
      name: string;
      realmKey: string;
      realmStage: number;
      userEmail: string;
      linhThach: string;
    }[];
    topByTienNgoc: {
      characterId: string;
      name: string;
      realmKey: string;
      realmStage: number;
      userEmail: string;
      tienNgoc: number;
    }[];
  }> {
    const TOP_N = 10;

    const [sumsRaw, characterCount, cultivatingCount, topLinhRaw, topTienRaw] =
      await Promise.all([
        this.prisma.character.aggregate({
          _sum: { linhThach: true, tienNgoc: true, tienNgocKhoa: true },
        }),
        this.prisma.character.count(),
        this.prisma.character.count({ where: { cultivating: true } }),
        this.prisma.character.findMany({
          select: {
            id: true,
            name: true,
            realmKey: true,
            realmStage: true,
            linhThach: true,
            user: { select: { email: true } },
          },
          orderBy: { linhThach: 'desc' },
          take: TOP_N,
        }),
        this.prisma.character.findMany({
          select: {
            id: true,
            name: true,
            realmKey: true,
            realmStage: true,
            tienNgoc: true,
            user: { select: { email: true } },
          },
          orderBy: { tienNgoc: 'desc' },
          take: TOP_N,
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      circulation: {
        linhThachTotal: (sumsRaw._sum.linhThach ?? 0n).toString(),
        tienNgocTotal: sumsRaw._sum.tienNgoc ?? 0,
        tienNgocKhoaTotal: sumsRaw._sum.tienNgocKhoa ?? 0,
        characterCount,
        cultivatingCount,
      },
      topByLinhThach: topLinhRaw.map((c) => ({
        characterId: c.id,
        name: c.name,
        realmKey: c.realmKey,
        realmStage: c.realmStage,
        userEmail: c.user.email,
        linhThach: c.linhThach.toString(),
      })),
      topByTienNgoc: topTienRaw.map((c) => ({
        characterId: c.id,
        name: c.name,
        realmKey: c.realmKey,
        realmStage: c.realmStage,
        userEmail: c.user.email,
        tienNgoc: c.tienNgoc,
      })),
    };
  }

  private async audit(actorId: string, action: string, meta: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId: actorId, action, meta },
    });
  }
}
