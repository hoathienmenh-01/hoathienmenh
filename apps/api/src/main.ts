import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import {
  assertProductionSecrets,
  corsConfig,
  helmetConfig,
} from './bootstrap-config';
import { getLogger } from './observability/logger';
import { PinoNestLogger } from './observability/nest-logger.adapter';
import { createRequestLoggerMiddleware } from './observability/request-logger.middleware';
import { createRequestMetricsMiddleware } from './modules/metrics/request-metrics.middleware';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  // Sentry phải init TRƯỚC NestFactory để cover lỗi bootstrap. No-op nếu
  // SENTRY_DSN_API trống hoặc SENTRY_ENABLED=false.
  initSentry();

  assertProductionSecrets();
  const app = await NestFactory.create(AppModule, {
    cors: corsConfig(),
    bufferLogs: true,
  });
  app.useLogger(new PinoNestLogger(getLogger()));
  app.use(helmet(helmetConfig()));
  app.use(cookieParser());
  // Request logger phải sau cookieParser (cookie redact qua Pino) +
  // trước global prefix để gắn requestId cho mọi request.
  app.use(createRequestLoggerMiddleware());
  // Phase 17.5 — Request metrics middleware (singleton in-memory
  // counter cho `/admin/metrics`). Gắn SAU request-logger để reuse
  // requestId nếu cần debug; skip healthz/readyz/admin/metrics để
  // không count poll noise.
  app.use(createRequestMetricsMiddleware());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  getLogger().info({ port }, '[xuantoi/api] listening');
}

bootstrap();
