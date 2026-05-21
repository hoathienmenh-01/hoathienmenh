import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Optional,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { EquipSlot } from '@prisma/client';
import { z } from 'zod';
import {
  applyInventoryQolView,
  INVENTORY_QOL_FILTER_BUCKETS,
  INVENTORY_QOL_SORT_KEYS,
  type InventoryQolFilterBucket,
  type InventoryQolSortKey,
} from '@xuantoi/shared';
import { InventoryService, type InventoryView } from './inventory.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';

const QolQueryInput = z.object({
  sort: z.enum(INVENTORY_QOL_SORT_KEYS).optional(),
  bucket: z.enum(INVENTORY_QOL_FILTER_BUCKETS).optional(),
  search: z.string().max(64).optional(),
});

const ACCESS_COOKIE = 'xt_access';

const EquipInput = z.object({ inventoryItemId: z.string().min(1) });
const UnequipInput = z.object({
  slot: z.enum([
    'WEAPON',
    'ARMOR',
    'BELT',
    'BOOTS',
    'HAT',
    'TRAM',
    'ARTIFACT_1',
    'ARTIFACT_2',
    'ARTIFACT_3',
  ]),
});
const UseInput = z.object({ inventoryItemId: z.string().min(1) });
const LockBatchInput = z.object({
  inventoryItemIds: z
    .array(z.string().min(1))
    .min(1, { message: 'INVENTORY_ITEM_IDS_EMPTY' })
    .max(100, { message: 'INVENTORY_ITEM_IDS_TOO_MANY' }),
  lock: z.boolean(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  private async requireCharacter(req: Request): Promise<{ userId: string; characterId: string }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return { userId, characterId: c.id };
  }

  @Get()
  async list(@Req() req: Request): Promise<{ ok: true; data: { items: InventoryView[] } }> {
    const { characterId } = await this.requireCharacter(req);
    const items = await this.inv.list(characterId);
    // Phase 44.2 — Onboarding auto-track INVENTORY_OPEN. Fire-and-forget.
    if (this.onboarding) void this.onboarding.notifyAction(characterId, 'INVENTORY_OPEN');
    return { ok: true, data: { items } };
  }

  /**
   * Phase 34.3 — Inventory Auto-sort / Lock QoL view.
   *
   * Server-side wrapper around `list()` that applies the same sort + filter
   * util shared with the FE (`applyInventoryQolView`). Useful for mobile UI
   * that wants to render only the active bucket without round-tripping the
   * full inventory.
   *
   * Query params:
   *  - `sort`  ∈ `INVENTORY_QOL_SORT_KEYS` (default `'default'`).
   *  - `bucket` ∈ `INVENTORY_QOL_FILTER_BUCKETS` (default `'all'`).
   *  - `search` free-text, case-insensitive on `itemKey` + `name`.
   */
  @Get('qol/v1/items')
  async listQol(
    @Req() req: Request,
  ): Promise<{
    ok: true;
    data: {
      items: InventoryView[];
      total: number;
      filtered: number;
      sort: InventoryQolSortKey;
      bucket: InventoryQolFilterBucket;
    };
  }> {
    const { characterId } = await this.requireCharacter(req);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const parsed = QolQueryInput.safeParse({
      sort: query.sort,
      bucket: query.bucket,
      search: query.search,
    });
    if (!parsed.success) fail('INVALID_INPUT');
    const items = await this.inv.list(characterId);
    const sort: InventoryQolSortKey = parsed.data.sort ?? 'default';
    const bucket: InventoryQolFilterBucket = parsed.data.bucket ?? 'all';
    const out = applyInventoryQolView(
      items.map((r) => ({
        id: r.id,
        itemKey: r.itemKey,
        qty: r.qty,
        equippedSlot: r.equippedSlot,
        locked: r.locked,
        createdAt: r.createdAt,
        item: r.item,
      })),
      { sort, bucket, search: parsed.data.search },
    );
    const filtered = out.map((row) => items.find((i) => i.id === row.id)!);
    return {
      ok: true,
      data: {
        items: filtered,
        total: items.length,
        filtered: filtered.length,
        sort,
        bucket,
      },
    };
  }

  @Post('equip')
  @HttpCode(200)
  async equip(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.requireCharacter(req);
    const parsed = EquipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const items = await this.inv.equip(userId, parsed.data.inventoryItemId);
      return { ok: true, data: { items } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('unequip')
  @HttpCode(200)
  async unequip(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.requireCharacter(req);
    const parsed = UnequipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const items = await this.inv.unequip(userId, parsed.data.slot as EquipSlot);
      return { ok: true, data: { items } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('build')
  async build(@Req() req: Request) {
    const { characterId } = await this.requireCharacter(req);
    const summary = await this.inv.equipmentBuildSummary(characterId);
    if (!summary) {
      return { ok: true, data: { summary: null } };
    }
    // Serialize: convert Map to object so JSON works.
    return {
      ok: true,
      data: {
        summary: {
          pieceCount: summary.pieceCount,
          mainElement: summary.mainElement,
          elementDistribution: summary.elementDistribution,
          activeSets: summary.activeSets.map((s) => ({
            setKey: s.setKey,
            pieceCount: s.pieceCount,
            missingSlots: s.missingSlots,
            totalRatio: s.totalRatio,
            activeTiers: s.activeTiers.map((t) => ({
              pieces: t.pieces,
              bonusRatio: t.bonusRatio,
              description: t.description,
              descriptionVi: t.descriptionVi,
              cooldownSec: t.cooldownSec,
            })),
            set: {
              setKey: s.set.setKey,
              name: s.set.name,
              nameVi: s.set.nameVi,
              description: s.set.description,
              descriptionVi: s.set.descriptionVi,
              elementAffinity: s.set.elementAffinity,
              allowedTiers: s.set.allowedTiers,
              requiredRealmOrder: s.set.requiredRealmOrder,
              requiredSlots: s.set.requiredSlots,
              tags: s.set.tags,
              bonusCap: s.set.bonusCap,
            },
          })),
          activeSetCount: summary.activeSetCount,
          resonance: {
            pieceCount: summary.resonance.pieceCount,
            dominantElement: summary.resonance.dominantElement,
            elementDistribution: summary.resonance.elementDistribution,
            totalRatio: summary.resonance.totalRatio,
            active: summary.resonance.active.map((e) => ({
              kind: e.kind,
              key: e.key,
              ratio: e.ratio,
              description: e.description,
              descriptionVi: e.descriptionVi,
              meta: e.meta ?? null,
            })),
          },
          totalBonusRatio: summary.totalBonusRatio,
          totalPowerScore: summary.totalPowerScore,
          resonanceTier: summary.resonanceTier,
        },
      },
    };
  }

  @Post('use')
  @HttpCode(200)
  async use(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.requireCharacter(req);
    const parsed = UseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const items = await this.inv.use(userId, parsed.data.inventoryItemId);
      return { ok: true, data: { items } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase QOL-1 — lock 1 inventory item (idempotent). Trang bị khóa sẽ
   * bị `use()` từ chối. Còn equip/unequip vẫn OK (UX: tránh consume
   * nhầm món quan trọng, còn sử dụng ngoài thống nhất).
   */
  @Post(':id/lock')
  @HttpCode(200)
  async lockItem(@Req() req: Request, @Param('id') id: string) {
    const { userId } = await this.requireCharacter(req);
    if (!id || id.length < 1) fail('INVALID_INPUT');
    try {
      const item = await this.inv.lock(userId, id);
      return { ok: true, data: { item } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/unlock')
  @HttpCode(200)
  async unlockItem(@Req() req: Request, @Param('id') id: string) {
    const { userId } = await this.requireCharacter(req);
    if (!id || id.length < 1) fail('INVALID_INPUT');
    try {
      const item = await this.inv.unlock(userId, id);
      return { ok: true, data: { item } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase QOL-1 — batch lock/unlock. Tối đa 100 row mỗi call. Atomic:
   * nếu 1 row không thuộc character → toàn bộ rollback.
   */
  @Post('lock/batch')
  @HttpCode(200)
  async lockBatch(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.requireCharacter(req);
    const parsed = LockBatchInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.inv.lockBatch(
        userId,
        parsed.data.inventoryItemIds,
        parsed.data.lock,
      );
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case 'NO_CHARACTER':
      case 'INVENTORY_ITEM_NOT_FOUND':
      case 'ITEM_NOT_FOUND':
        fail(code, HttpStatus.NOT_FOUND);
      // eslint-disable-next-line no-fallthrough
      case 'NOT_EQUIPPABLE':
      case 'NOT_USABLE':
      case 'WRONG_SLOT':
      case 'ALREADY_USED':
      case 'EQUIPMENT_REALM_LOCKED':
      case 'INVENTORY_ITEM_LOCKED':
        fail(code, HttpStatus.CONFLICT);
      // eslint-disable-next-line no-fallthrough
      default:
        throw e;
    }
  }
}
