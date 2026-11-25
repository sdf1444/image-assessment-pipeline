import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool, RowDataPacket } from 'mysql2/promise';

config({ path: resolve(__dirname, '../../.env') });
const base = 'http://127.0.0.1:3000/api';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');

async function login(email: string | undefined, password: string | undefined) {
  assert.ok(email && password, 'Configure both bootstrap accounts in .env');
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  return await response.json() as { token: string; user: { id: string } };
}
async function jobs(token: string) {
  const response = await fetch(`${base}/jobs`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  return await response.json() as Array<{ id: string; status: string; attempts: number; model_version: string | null }>;
}
test('roles, retry, result uniqueness, permanent failure, and logout', { timeout: 45000 }, async () => {
  assert.equal(process.env.DEMO_MODE, 'true', 'Set DEMO_MODE=true for this test');
  const db = createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: 'assessment', password: process.env.DB_PASSWORD, database: 'assessment',
  });
  try {
    assert.equal((await fetch(`${base}/jobs`)).status, 401);
    const user = await login(process.env.USER_EMAIL, process.env.USER_PASSWORD);
    const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    assert.equal((await fetch(`${base}/metrics`, { headers: { Authorization: `Bearer ${user.token}` } })).status, 403);
    assert.equal((await fetch(`${base}/metrics`, { headers: { Authorization: `Bearer ${admin.token}` } })).status, 200);
    const create = async (token: string, simulated: boolean): Promise<string> => {
      const form = new FormData();
      form.append('image', new Blob([png], { type: 'image/png' }), 'fixture.png');
      form.append('simulateFailure', String(simulated));
      const response = await fetch(`${base}/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      assert.equal(response.status, 201);
      return (await response.json() as { id: string }).id;
    };
    const userJobs = await Promise.all([create(user.token, true), create(user.token, false), create(user.token, false)]);
    const adminJob = await create(admin.token, false);
    const failedJob = randomUUID();
    await db.execute(
      `INSERT INTO jobs (id, user_id, filename, image_path, image_hash, max_attempts)
       VALUES (?, ?, 'missing.png', 'missing-integration-image', ?, 1)`,
      [failedJob, user.user.id, '0'.repeat(64)]);
    const recoveredJob = randomUUID();
    await db.execute(
      `INSERT INTO jobs (id, user_id, filename, image_path, image_hash, status, attempts, lease_token, lease_until)
       SELECT ?, user_id, filename, image_path, image_hash, 'processing', 1, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
       FROM jobs WHERE id = ?`, [recoveredJob, randomUUID(), userJobs[1]]);
    const exhaustedJob = randomUUID();
    await db.execute(
      `INSERT INTO jobs (id, user_id, filename, image_path, image_hash, status, attempts, max_attempts, lease_token, lease_until)
       SELECT ?, user_id, filename, image_path, image_hash, 'processing', 3, 3, ?, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
       FROM jobs WHERE id = ?`, [exhaustedJob, randomUUID(), userJobs[1]]);
    let rows = await jobs(user.token);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      rows = await jobs(user.token);
      if (userJobs.every(id => rows.some(row => row.id === id && row.status === 'completed')) &&
          rows.some(row => row.id === failedJob && row.status === 'failed') &&
          rows.some(row => row.id === recoveredJob && row.status === 'completed') &&
          rows.some(row => row.id === exhaustedJob && row.status === 'failed')) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(userJobs.every(id => rows.some(row => row.id === id && row.status === 'completed')));
    assert.equal(rows.find(row => row.id === userJobs[0])?.attempts, 2);
    assert.equal(rows.find(row => row.id === userJobs[0])?.model_version, process.env.MODEL_VERSION || 'mock-1.0.0');
    assert.equal(rows.find(row => row.id === failedJob)?.status, 'failed');
    assert.equal(rows.find(row => row.id === recoveredJob)?.status, 'completed');
    assert.equal(rows.find(row => row.id === recoveredJob)?.attempts, 2);
    assert.equal(rows.find(row => row.id === exhaustedJob)?.status, 'failed');
    assert.equal(rows.some(row => row.id === adminJob), false);
    assert.ok((await jobs(admin.token)).some(row => row.id === adminJob));
    const [results] = await db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM assessments WHERE job_id = ?', [userJobs[0]]);
    assert.equal(Number(results[0].count), 1);
    await assert.rejects(db.execute(
      `INSERT INTO assessments (id, job_id, model_version, outcome, score)
       VALUES (?, ?, 'duplicate', 'review', 0.5)`, [randomUUID(), userJobs[0]]),
    (error: unknown) => (error as { code?: string }).code === 'ER_DUP_ENTRY');
    assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` } })).status, 204);
    assert.equal((await fetch(`${base}/jobs`, { headers: { Authorization: `Bearer ${user.token}` } })).status, 401);
  } finally {
    await db.end();
  }
});
