import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  __xuantoiPrisma?: PrismaClient;
};

const getDefaultPrisma = (): PrismaClient => {
  const client = globalForPrisma.__xuantoiPrisma ?? new PrismaClient();
  globalForPrisma.__xuantoiPrisma = client;
  return client;
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Optional() options?: ConstructorParameters<typeof PrismaClient>[0]) {
    super(options);
    return (options ? new PrismaClient(options) : getDefaultPrisma()) as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
