import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import { settings } from '../config/config';

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool = createPool({
    host: settings.dbHost,
    port: settings.dbPort,
    user: 'assessment',
    password: settings.dbPassword,
    database: 'assessment',
    connectionLimit: 10,
    timezone: 'Z',
  });

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
