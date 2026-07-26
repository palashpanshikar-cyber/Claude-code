process.env.NODE_ENV = 'test';
process.env.ENABLE_CRON = 'false';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/sidequest_test?schema=public';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/tmp/sidequest-test-uploads';

import type { Quest } from '@prisma/client';
import supertest from 'supertest';

const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');

export { prisma };
export const app = createApp();

export async function resetDb(): Promise<void> {
  await prisma.orphanedObject.deleteMany();
  await prisma.streakBreak.deleteMany();
  await prisma.miniAssignment.deleteMany();
  await prisma.completion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.quest.deleteMany();
  await prisma.miniQuest.deleteMany();
}

export async function seedQuests(n = 3, overrides: Partial<Quest> = {}): Promise<Quest[]> {
  const categories = [
    'ADVENTURE',
    'FOOD_DRINK',
    'CULTURE',
    'NATURE',
    'FITNESS',
    'CREATIVE',
  ] as const;
  const quests: Quest[] = [];
  for (let i = 0; i < n; i += 1) {
    quests.push(
      await prisma.quest.create({
        data: {
          title: `Test quest ${i}`,
          description: `Description ${i}`,
          category: categories[i % categories.length]!,
          city: null,
          ...overrides,
        },
      }),
    );
  }
  return quests;
}

export async function seedMinis(n = 20): Promise<void> {
  for (let slot = 0; slot < n; slot += 1) {
    await prisma.miniQuest.create({
      data: { slot, title: `Mini ${slot}`, prompt: `Do mini ${slot}`, category: 'ADVENTURE' },
    });
  }
}

let counter = 0;

export async function registerUser(
  request: typeof supertest,
  overrides: Record<string, unknown> = {},
) {
  counter += 1;
  const payload = {
    email: `user${counter}@test.dev`,
    username: `user${counter}`,
    password: 'password123',
    displayName: `User ${counter}`,
    timezone: 'UTC',
    ...overrides,
  };
  const res = await request(app).post('/auth/register').send(payload);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { ...res.body, payload } as {
    token: string;
    user: { id: string; currentStreak: number; passwordHash?: string };
    payload: typeof payload;
  };
}

// A 1x1 PNG — smallest valid image multer will accept.
export const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Marks a user as an admin — there is no endpoint for this, by design. */
export async function makeAdmin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { isAdmin: true } });
}

/** A real, large JPEG, for exercising the resize path rather than a 1x1 stub. */
export async function bigImage(width = 3000, height = 2000): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 180, b: 220 },
    },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
}
