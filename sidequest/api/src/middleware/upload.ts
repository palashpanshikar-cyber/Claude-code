import multer from 'multer';
import { ALLOWED_IMAGE_MIME } from '../lib/storage.js';
import { badRequest } from '../lib/http.js';

/** Phone photos are a few MB; 10 is generous without inviting abuse. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * One upload configuration for every image endpoint.
 *
 * Held in memory rather than written to a temp file: the buffer goes straight
 * into sharp and then to object storage, so touching the disk would only add a
 * cleanup problem.
 */
export function imageUpload(fieldName = 'photo') {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
        cb(badRequest('Photo must be JPEG, PNG, WebP or HEIC'));
        return;
      }
      cb(null, true);
    },
  }).single(fieldName);
}
