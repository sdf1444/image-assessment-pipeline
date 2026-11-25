import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthController, AuthGuard, AuthService } from './auth/auth';
import { Database } from './database/database';
import { JobsController } from './jobs/jobs';

@Module({ controllers: [AuthController, JobsController], providers: [Database, AuthService, AuthGuard] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000, '127.0.0.1');
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1; });
