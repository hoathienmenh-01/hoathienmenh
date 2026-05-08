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

async function bootstrap(): Promise<void> {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule, {
    cors: corsConfig(),
  });
  app.use(helmet(helmetConfig()));
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[xuantoi/api] listening on :${port}`);
}

bootstrap();
