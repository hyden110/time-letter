import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(env.port);
  Logger.log(
    `TimeLetter API 已启动：http://localhost:${env.port}（payment_enabled=${env.paymentEnabled}）`,
    'Bootstrap',
  );
}

void bootstrap();
