import {
  BadRequestException, Controller, ForbiddenException, Get, Inject, Post, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowDataPacket } from 'mysql2';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth';
import { isSupportedImage } from '../assessment/mock';
import { settings } from '../config/config';
import { Database } from '../database/database';
import { log } from '../common/log';

@Controller('api')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Post('jobs')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async create(@UploadedFile() image: Express.Multer.File | undefined, @Req() req: AuthenticatedRequest) {
    if (!image || !isSupportedImage(image.buffer)) throw new BadRequestException('Upload a PNG or JPEG image (maximum 5 MB)');
    const simulated = req.body?.simulateFailure === 'true';
    if (simulated && process.env.DEMO_MODE !== 'true') throw new ForbiddenException('Failure simulation is disabled');
    const id = randomUUID();
    const path = join(settings.uploadDir, id);
    await mkdir(settings.uploadDir, { recursive: true });
    await writeFile(path, image.buffer, { flag: 'wx' });
    try {
      await this.db.pool.execute(
        'INSERT INTO jobs (id, user_id, filename, image_path, image_hash, simulate_failure) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.user.id, image.originalname.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'image',
          path, createHash('sha256').update(image.buffer).digest('hex'), simulated]);
    } catch (error) {
      await unlink(path).catch((cleanupError: unknown) => log('upload_cleanup_failed', { jobId: id, error: String(cleanupError) }));
      throw error;
    }
    log('job_created', { jobId: id, userId: req.user.id, simulated });
    return { id, status: 'queued' };
  }

  @Get('jobs')
  async list(@Req() req: AuthenticatedRequest) {
    const [rows] = await this.db.pool.execute<RowDataPacket[]>(
      `SELECT j.id, j.filename, j.status, j.attempts, j.max_attempts, j.last_error,
       j.created_at, j.updated_at, u.email AS owner, a.model_version, a.outcome, a.score
       FROM jobs j JOIN users u ON u.id = j.user_id
       LEFT JOIN assessments a ON a.job_id = j.id
       ${req.user.role === 'admin' ? '' : 'WHERE j.user_id = ?'}
       ORDER BY j.created_at DESC LIMIT 200`, req.user.role === 'admin' ? [] : [req.user.id]);
    return rows;
  }

  @Get('metrics')
  async metrics(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'admin') throw new ForbiddenException();
    const [rows] = await this.db.pool.query<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(GREATEST(attempts - 1, 0)), 0) AS retries
       FROM jobs GROUP BY status`);
    return { jobs: rows };
  }
}
