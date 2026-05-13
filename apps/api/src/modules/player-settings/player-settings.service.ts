import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_PLAYER_SETTINGS,
  mergePlayerSettings,
  type PlayerSettings,
  type PlayerSettingsRow,
  validatePlayerSettings,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 41.0 — Player Settings service.
 *
 * Lazy-create row khi user chưa có settings; mọi PATCH merge stored JSON
 * + sanitized patch (validator). KHÔNG lưu raw user input — chỉ field
 * trong shape `PlayerSettings` (xem shared/player-experience.ts).
 *
 * Server-authoritative: validator chạy lại ngay cả khi đọc — guard
 * trường hợp DB row bị nhiễm payload cũ / migration sót.
 */
export class PlayerSettingsError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'PLAYER_SETTINGS_INVALID'
      | 'PLAYER_SETTINGS_PAYLOAD_TOO_LARGE',
    public detail?: readonly string[],
  ) {
    super(code);
  }
}

@Injectable()
export class PlayerSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async characterIdOf(userId: string): Promise<string> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) throw new PlayerSettingsError('NO_CHARACTER');
    return c.id;
  }

  async getSettings(userId: string): Promise<PlayerSettingsRow> {
    const characterId = await this.characterIdOf(userId);
    const row = await this.prisma.playerSettings.findUnique({
      where: { characterId },
    });
    if (!row) {
      const now = new Date();
      return {
        characterId,
        settings: { ...DEFAULT_PLAYER_SETTINGS },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    }
    return this.toRow(row);
  }

  async patchSettings(
    userId: string,
    patch: unknown,
  ): Promise<PlayerSettingsRow> {
    const characterId = await this.characterIdOf(userId);
    const v = validatePlayerSettings(patch);
    if (!v.ok) {
      if (v.errors.includes('PLAYER_SETTINGS_PAYLOAD_TOO_LARGE')) {
        throw new PlayerSettingsError(
          'PLAYER_SETTINGS_PAYLOAD_TOO_LARGE',
          v.errors,
        );
      }
      throw new PlayerSettingsError('PLAYER_SETTINGS_INVALID', v.errors);
    }
    const existing = await this.prisma.playerSettings.findUnique({
      where: { characterId },
    });
    const next = mergePlayerSettings(existing?.settingsJson ?? null, v.sanitized);
    const saved = await this.prisma.playerSettings.upsert({
      where: { characterId },
      create: {
        characterId,
        settingsJson: next as unknown as Prisma.InputJsonValue,
      },
      update: { settingsJson: next as unknown as Prisma.InputJsonValue },
    });
    return this.toRow(saved);
  }

  async resetSettings(userId: string): Promise<PlayerSettingsRow> {
    const characterId = await this.characterIdOf(userId);
    const next: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
    const saved = await this.prisma.playerSettings.upsert({
      where: { characterId },
      create: {
        characterId,
        settingsJson: next as unknown as Prisma.InputJsonValue,
      },
      update: { settingsJson: next as unknown as Prisma.InputJsonValue },
    });
    return this.toRow(saved);
  }

  private toRow(row: {
    characterId: string;
    settingsJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): PlayerSettingsRow {
    return {
      characterId: row.characterId,
      settings: mergePlayerSettings(row.settingsJson, undefined),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
