import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database/database';
import { Worker } from './workers/worker';

@Module({ providers: [Database, Worker] })
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1; });
