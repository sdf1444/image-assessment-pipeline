import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RowDataPacket } from 'mysql2';
import { assessImage } from '../assessment/mock';
import { settings } from '../config/config';
import { Database } from '../database/database';
import { log } from '../common/log';

interface Job extends RowDataPacket {
  id: string;
  image_path: string;
  image_hash: string;
  attempts: number;
  max_attempts: number;
  simulate_failure: number;
}

@Injectable()
export class Worker implements OnModuleInit, OnApplicationShutdown {
  private stopping = false;
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(@Inject(Database) private readonly db: Database) {}
  onModuleInit(): void {
    log('worker_started', { modelVersion: settings.modelVersion });
    this.schedule(0);
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }
  private schedule(ms: number): void {
    if (!this.stopping) this.timer = setTimeout(() => {
      this.active = this.tick().catch(error => log('worker_error', { error: String(error) }))
        .finally(() => this.schedule(1000));
    }, ms);
  }
  private async tick(): Promise<void> {
    const connection = await this.db.pool.getConnection();
    let job: Job | undefined;
    const lease = randomUUID();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE jobs SET status = 'failed', lease_token = NULL, lease_until = NULL,
         last_error = 'Worker lease expired after final attempt'
         WHERE status = 'processing' AND lease_until < UTC_TIMESTAMP(3) AND attempts >= max_attempts`);
      const [rows] = await connection.query<Job[]>(
        `SELECT * FROM jobs WHERE attempts < max_attempts AND
         ((status = 'queued' AND available_at <= UTC_TIMESTAMP(3)) OR
          (status = 'processing' AND lease_until < UTC_TIMESTAMP(3)))
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      job = rows[0];
      if (job) {
        await connection.execute(
          `UPDATE jobs SET status = 'processing', attempts = attempts + 1,
           lease_token = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 SECOND) WHERE id = ?`, [lease, job.id]);
        job.attempts++;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (!job) return;
    log('job_claimed', { jobId: job.id, attempt: job.attempts });
    try {
      if (job.simulate_failure && job.attempts === 1) throw new Error('Simulated transient worker failure');
      const image = await readFile(job.image_path);
      if (createHash('sha256').update(image).digest('hex') !== job.image_hash) throw new Error('Image integrity check failed');
      const result = assessImage(image);
      await this.complete(job, lease, result);
    } catch (error) {
      const message = error instanceof Error && error.message === 'Simulated transient worker failure'
        ? error.message : 'Assessment processing failed';
      log('processing_error', { jobId: job.id, attempt: job.attempts, error: String(error) });
      await this.fail(job, lease, message);
    }
  }
  private async complete(job: Job, lease: string, result: { score: number; outcome: string }): Promise<void> {
    const connection = await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM jobs WHERE id = ? AND status = 'processing' AND lease_token = ?
         AND lease_until > UTC_TIMESTAMP(3) FOR UPDATE`, [job.id, lease]);
      if (!rows.length) {
        await connection.rollback();
        log('lease_lost', { jobId: job.id, attempt: job.attempts });
        return;
      }
      await connection.execute(
        'INSERT INTO assessments (id, job_id, model_version, outcome, score) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), job.id, settings.modelVersion, result.outcome, result.score]);
      await connection.execute(
        `UPDATE jobs SET status = 'completed', lease_token = NULL, lease_until = NULL, last_error = NULL WHERE id = ?`, [job.id]);
      await connection.commit();
      log('job_completed', { jobId: job.id, attempt: job.attempts, modelVersion: settings.modelVersion });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  private async fail(job: Job, lease: string, message: string): Promise<void> {
    const failed = job.attempts >= job.max_attempts;
    const [result] = await this.db.pool.execute<import('mysql2').ResultSetHeader>(
      `UPDATE jobs SET status = ?, last_error = ?, lease_token = NULL, lease_until = NULL,
       available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
       WHERE id = ? AND status = 'processing' AND lease_token = ? AND lease_until > UTC_TIMESTAMP(3)`,
      [failed ? 'failed' : 'queued', message.slice(0, 255), Math.min(2 ** job.attempts, 30), job.id, lease]);
    log(result.affectedRows ? (failed ? 'job_failed' : 'job_retry_scheduled') : 'lease_lost',
      { jobId: job.id, attempt: job.attempts, error: message });
  }
}
