import { ZodError } from 'zod';
import { config } from '../lib/config.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  // Multer surfaces upload problems (size, field name) with a code.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Photo is too large (max 10MB)' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field — send the photo as "photo"' });
  }

  const status = err.status ?? 500;
  if (status >= 500 && config.env !== 'test') {
    console.error(err);
  }

  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}
