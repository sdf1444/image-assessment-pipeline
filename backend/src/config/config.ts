import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const settings = {
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: Number(process.env.DB_PORT || 3306),
  dbPassword: required('DB_PASSWORD'),
  uploadDir: resolve(__dirname, '../../../uploads'),
  modelVersion: process.env.MODEL_VERSION || 'mock-1.0.0',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  userEmail: process.env.USER_EMAIL,
  userPassword: process.env.USER_PASSWORD,
};
