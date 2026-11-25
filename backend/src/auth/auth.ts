import {
  Body, CanActivate, Controller, ExecutionContext, Inject, Injectable, OnModuleInit,
  Post, Req, UnauthorizedException, BadRequestException, HttpCode, UseGuards,
} from '@nestjs/common';
import { randomBytes, randomUUID, scrypt as callbackScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Request } from 'express';
import { RowDataPacket } from 'mysql2';
import { Database } from '../database/database';
import { settings } from '../config/config';
import { log } from '../common/log';

const scrypt = promisify(callbackScrypt);
type Role = 'user' | 'admin';
export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; role: Role };
  tokenHash: string;
}
interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  role: Role;
  password_hash: string;
}
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(@Inject(Database) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword(randomBytes(32).toString('hex'));
    if (settings.adminEmail && settings.userEmail &&
        settings.adminEmail.trim().toLowerCase() === settings.userEmail.trim().toLowerCase()) {
      throw new Error('Bootstrap admin and user emails must be different');
    }
    for (const [email, password, role] of [
      [settings.adminEmail, settings.adminPassword, 'admin'],
      [settings.userEmail, settings.userPassword, 'user'],
    ] as const) {
      if (!email && !password) continue;
      if (!email || !password || password.length < 12 || password.length > 128) {
        throw new Error(`Bootstrap ${role} requires an email and a 12–128 character password`);
      }
      const normalizedEmail = email.trim().toLowerCase();
      const [existing] = await this.db.pool.execute<UserRow[]>('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
      if (!existing.length) {
        await this.db.pool.execute('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [randomUUID(), normalizedEmail, await hashPassword(password), role]);
        log('user_bootstrapped', { role });
      }
    }
  }

  async login(email: unknown, password: unknown, ip: string) {
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) {
      throw new BadRequestException('Invalid credentials');
    }
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const limit = this.attempts.get(ip) || { count: 0, until: now + 60_000 };
    if (limit.count >= 10) throw new UnauthorizedException('Too many login attempts; try again later');
    limit.count++;
    this.attempts.set(ip, limit);
    const [users] = await this.db.pool.execute<UserRow[]>(
      'SELECT id, email, role, password_hash FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    const user = users[0];
    const valid = await verifyPassword(password, user?.password_hash || this.dummyHash);
    if (!user || !valid) {
      log('login_failed');
      throw new UnauthorizedException('Invalid credentials');
    }
    this.attempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    await this.db.pool.execute(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR))',
      [tokenHash(token), user.id]);
    log('login_succeeded', { userId: user.id });
    return { token, user: { id: user.id, email: user.email, role: user.role } };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!match) throw new UnauthorizedException();
    const hash = tokenHash(match[1]);
    const [rows] = await this.db.pool.execute<UserRow[]>(
      `SELECT u.id, u.email, u.role FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)`, [hash]);
    if (!rows[0]) throw new UnauthorizedException();
    req.user = { id: rows[0].id, email: rows[0].email, role: rows[0].role };
    req.tokenHash = hash;
    return true;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Database) private readonly db: Database) {}
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: unknown; password?: unknown }, @Req() req: Request) {
    return this.auth.login(body?.email, body?.password, req.ip || 'unknown');
  }
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.db.pool.execute('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
  }
}
