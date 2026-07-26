import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.NODE_ENV === 'production' ? required('JWT_SECRET') : (process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  runCron: process.env.RUN_CRON !== 'false',
  storage: {
    // Falls back to local disk when R2 isn't configured, so the API is runnable
    // out of the box without cloud credentials.
    driver: process.env.R2_BUCKET ? 'r2' : 'local',
    localDir: process.env.UPLOAD_DIR ?? 'uploads',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    r2: {
      bucket: process.env.R2_BUCKET,
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      publicUrl: process.env.R2_PUBLIC_URL,
    },
  },
};
