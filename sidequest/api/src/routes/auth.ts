import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isValidTimezone } from '../lib/day.js';
import { signToken } from '../middleware/auth.js';
import { publicUser } from '../lib/serialize.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
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

authRouter.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);

    const clash = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { email: true, username: true },
    });
    if (clash) {
      const field = clash.email === input.email ? 'Email' : 'Username';
      res.status(409).json({ error: `${field} already taken` });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        timezone: input.timezone,
        city: input.city ?? null,
        passwordHash: await bcrypt.hash(input.password, 10),
      },
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string(),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Same response for unknown email and wrong password — no account enumeration.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});
