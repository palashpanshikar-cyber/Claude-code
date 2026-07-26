import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export const ALLOWED_IMAGE_MIME = Object.keys(EXT_BY_MIME);

const SIGNED_URL_TTL_SECONDS = 60 * 60;

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (!s3Client) {
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
 * Persists a completion photo and returns its storage key.
 *
 * The key — not a URL — is what gets stored on the completion, so that photos
 * survive a bucket or CDN domain change and can be served from a private
 * bucket via presigned URLs.
 */
export async function storePhoto({
  buffer,
  mimetype,
  userId,
  prefix = 'completions',
}: {
  buffer: Buffer;
  mimetype: string;
  userId: string;
  prefix?: string;
}): Promise<string> {
  const ext = EXT_BY_MIME[mimetype];
  if (!ext) {
    throw Object.assign(new Error(`Unsupported image type: ${mimetype}`), { status: 400 });
  }

  const key = `${prefix}/${userId}/${randomUUID()}.${ext}`;

  if (config.storage.driver === 'r2') {
    await getS3().send(
      new PutObjectCommand({
        Bucket: config.storage.r2.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    return key;
  }

  const filePath = path.join(config.storage.localDir, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return key;
}

/**
 * Turns a stored key into a URL the client can load.
 *
 * Public bucket → a plain CDN URL. Private bucket → a short-lived presigned
 * URL, which is why these are resolved at read time rather than baked into
 * the row at write time.
 */
export async function photoUrlFor(key: string): Promise<string> {
  if (config.storage.driver === 'local') {
    return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/uploads/${key}`;
  }

  if (config.storage.r2.publicUrl) {
    return `${config.storage.r2.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: config.storage.r2.bucketName, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

/** Removes a stored object. Missing objects are not an error. */
export async function deleteObject(key: string): Promise<void> {
  if (config.storage.driver === 'r2') {
    await getS3().send(new DeleteObjectCommand({ Bucket: config.storage.r2.bucketName, Key: key }));
    return;
  }

  await rm(path.join(config.storage.localDir, key), { force: true });
}
