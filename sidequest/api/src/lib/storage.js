import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export const ALLOWED_IMAGE_MIME = Object.keys(EXT_BY_MIME);

let s3Client = null;

async function getS3() {
  if (!s3Client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.storage.r2.accessKeyId,
        secretAccessKey: config.storage.r2.secretAccessKey,
      },
    });
  }
  return s3Client;
}

/**
 * Persists a completion photo and returns its public URL.
 * Uses Cloudflare R2 when configured, otherwise the local uploads dir.
 */
export async function storePhoto({ buffer, mimetype, userId }) {
  const ext = EXT_BY_MIME[mimetype];
  if (!ext) {
    const err = new Error(`Unsupported image type: ${mimetype}`);
    err.status = 400;
    throw err;
  }

  const key = `completions/${userId}/${randomUUID()}.${ext}`;

  if (config.storage.driver === 'r2') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    return `${config.storage.r2.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  const filePath = path.join(config.storage.localDir, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
}
