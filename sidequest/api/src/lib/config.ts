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
  jwtSecret: isProd ? required('JWT_SECRET') : (process.env.JWT_SECRET ?? 'dev-secret-change-in-production'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  enableCron: process.env.ENABLE_CRON !== 'false',
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
