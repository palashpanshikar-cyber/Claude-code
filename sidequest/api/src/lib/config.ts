import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  jwtSecret: isProd
    ? required('JWT_SECRET')
    : (process.env.JWT_SECRET ?? 'dev-secret-change-in-production'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  enableCron: process.env.ENABLE_CRON !== 'false',
  // Enable behind a reverse proxy so rate limiting sees real client IPs.
  trustProxy: process.env.TRUST_PROXY === 'true',
  storage: {
    // Falls back to local disk when R2 isn't configured, so the API is runnable
    // out of the box without cloud credentials.
    driver: (process.env.R2_ACCOUNT_ID ? 'r2' : 'local') as 'r2' | 'local',
    localDir: process.env.UPLOAD_DIR ?? 'uploads',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    r2: {
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucketName: process.env.R2_BUCKET_NAME ?? 'sidequest-uploads',
      // Blank means the bucket isn't public — photo URLs get presigned instead.
      publicUrl: process.env.R2_PUBLIC_URL ?? '',
    },
  },
} as const;

/**
 * Warns about settings that are fine in development and dangerous in production.
 *
 * Deliberately warnings rather than a hard exit: a misconfigured deploy that
 * still serves traffic is recoverable, one that refuses to boot at 2am is not.
 * The exception is JWT_SECRET, which `required()` already makes fatal above.
 */
export function checkProductionConfig(log: (msg: string) => void = console.warn): string[] {
  if (config.env !== 'production') return [];

  const warnings: string[] = [];

  if (config.storage.driver === 'local') {
    warnings.push(
      'R2 is not configured, so photos are on local disk and served with no authorisation. Uploads will also be lost on redeploy.',
    );
  }
  if (config.corsOrigin === '*') {
    warnings.push('CORS_ORIGIN is "*". Restrict it to your own origins.');
  }
  if (!config.trustProxy) {
    warnings.push(
      'TRUST_PROXY is false. Behind a load balancer every request looks like one IP, so rate limiting protects nobody.',
    );
  }
  if (config.jwtSecret.length < 32) {
    warnings.push(
      'JWT_SECRET is shorter than 32 characters. Generate one with: openssl rand -hex 32',
    );
  }

  for (const warning of warnings) log(`[config] ${warning}`);
  return warnings;
}
