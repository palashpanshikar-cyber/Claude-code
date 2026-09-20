import { randomBytes } from 'node:crypto';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${v}"`);
  }
  return parsed;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

const authSecretFromEnv = process.env.AUTH_SECRET;
if (isProduction && !authSecretFromEnv) {
  throw new Error('AUTH_SECRET must be set when NODE_ENV=production');
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: num('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  databasePath: str('DATABASE_PATH', './data/flowatl.db'),
  /** Random per-boot secret in dev keeps tokens from leaking between machines. */
  authSecret: authSecretFromEnv ?? randomBytes(32).toString('hex'),
  sessionTtlMs: num('SESSION_TTL_HOURS', 720) * 60 * 60 * 1000,
  corsOrigins: str('CORS_ORIGINS', '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  fleetSize: num('FLEET_SIZE', 6),
  shuttleCapacity: num('SHUTTLE_CAPACITY', 12),
  shuttleSpeedMph: num('SHUTTLE_SPEED_MPH', 11),
  stopDwellSeconds: num('STOP_DWELL_SECONDS', 30),
  tickMs: num('TICK_MS', 1000),
  timeScale: num('TIME_SCALE', 1),
  simSeed: num('SIM_SEED', 20260920),
  /** The network runs on Atlanta time — the impact day rolls over at local midnight. */
  timezone: str('TIMEZONE', 'America/New_York'),
} as const;

export type Config = typeof config;
