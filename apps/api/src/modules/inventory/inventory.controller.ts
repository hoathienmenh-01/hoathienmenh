import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { EquipSlot } from '@prisma/client';
import { z } from 'zod';
import { InventoryService, type InventoryView } from './inventory.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

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

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
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
    return { ok: true, data: { items } };
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
        fail(code, HttpStatus.CONFLICT);
      // eslint-disable-next-line no-fallthrough
      default:
        throw e;
    }
  }
}
