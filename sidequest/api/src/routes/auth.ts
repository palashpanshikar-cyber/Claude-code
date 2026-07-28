import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isValidTimezone } from '../lib/day.js';
import { signToken } from '../middleware/auth.js';
import { publicUser } from '../lib/serialize.js';
import { conflict, handle } from '../lib/http.js';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

/**
 * A real bcrypt hash of a throwaway value, compared against when no account
 * matches so that "unknown email" and "wrong password" take the same time.
 *
 * Without it, an unknown email returns in ~1ms and a real one in ~80ms, which
 * is a reliable account-enumeration oracle regardless of the identical
 * response body.
 */
const BCRYPT_ROUNDS = 12;

const DUMMY_HASH = bcrypt.hashSync('sidequest-timing-equaliser', BCRYPT_ROUNDS);

const registerSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'Letters, numbers and underscores only')
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(60),
  timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone').default('UTC'),
  // Clients that have no city yet may send null rather than omitting the key.
  city: z.string().max(80).nullable().optional(),
});

authRouter.post(
  '/register',
  registerLimiter,
  handle(async (req, res) => {
    const input = registerSchema.parse(req.body);

    // Checked up front so the common case gets a useful message naming the
    // field. The unique constraint below is what actually guarantees it — two
    // simultaneous signups both pass this check.
    const clash = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { email: true, username: true },
    });
    if (clash) {
      throw conflict(`${clash.email === input.email ? 'Email' : 'Username'} already taken`);
    }

    const user = await createUser(input);
    res.status(201).json({ token: signToken(user), user: await publicUser(user) });
  }),
);

/** Turns the unique-constraint race into the same 409 as the pre-check. */
async function createUser(input: z.infer<typeof registerSchema>) {
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        timezone: input.timezone,
        city: input.city ?? null,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      const fields = (err as { meta?: { target?: string[] } }).meta?.target ?? [];
      throw conflict(`${fields.includes('email') ? 'Email' : 'Username'} already taken`);
    }
    throw err;
  }
}

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
  password: z.string(),
});

authRouter.post(
  '/login',
  authLimiter,
  handle(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Always run a comparison, even with no user, so the response time does not
    // reveal whether the account exists.
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    // Same response for unknown email and wrong password — no account enumeration.
    if (!user || !passwordOk) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    res.json({ token: signToken(user), user: await publicUser(user) });
  }),
);
