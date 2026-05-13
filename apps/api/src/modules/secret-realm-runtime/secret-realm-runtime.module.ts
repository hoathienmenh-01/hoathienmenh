import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { PrismaService } from '../../common/prisma.service';
import { SecretRealmRuntimeController } from './secret-realm-runtime.controller';
import { SecretRealmRuntimeService } from './secret-realm-runtime.service';

/**
 * Phase 34.2 — Secret Realm / Bí Cảnh Runtime Module.
 *
 * Wires `SECRET_REALMS` catalog (shared) into runtime
 * `CharacterSecretRealmRun` rows + currency/exp grant on claim.
 */
@Module({
  imports: [AuthModule, CharacterModule],
  controllers: [SecretRealmRuntimeController],
  providers: [SecretRealmRuntimeService, PrismaService],
  exports: [SecretRealmRuntimeService],
})
export class SecretRealmRuntimeModule {}
