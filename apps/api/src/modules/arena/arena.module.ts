/**
 * Phase 14.1.B — Async Arena module.
 *
 * Wire `ArenaService` + `ArenaController`. Phụ thuộc `AuthModule` cho cookie
 * resolve. Không depend `CharacterModule` ở mức module — chỉ đọc/ghi qua
 * `PrismaService` (avoid forwardRef cycle với CharacterModule heavy graph).
 */
import { Module } from '@nestjs/common';
import { ArenaController } from './arena.controller';
import { ArenaService } from './arena.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ArenaController],
  providers: [ArenaService, PrismaService],
  exports: [ArenaService],
})
export class ArenaModule {}
