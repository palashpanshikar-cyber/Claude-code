process.env.NODE_ENV = 'test';
process.env.RUN_CRON = 'false';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/sidequest_test';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/tmp/sidequest-test-uploads';

const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/lib/prisma.js');

export { prisma };
export const app = createApp();

export async function resetDb() {
  await prisma.miniAssignment.deleteMany();
  await prisma.completion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.quest.deleteMany();
  await prisma.miniQuest.deleteMany();
}

export async function seedQuests(n = 3, overrides = {}) {
  const categories = ['ADVENTURE', 'FOOD_DRINK', 'CULTURE', 'NATURE', 'FITNESS', 'CREATIVE'];
  const quests = [];
  for (let i = 0; i < n; i += 1) {
    quests.push(
      await prisma.quest.create({
        data: {
          title: `Test quest ${i}`,
          description: `Description ${i}`,
          category: categories[i % categories.length],
          city: null,
          ...overrides,
        },
      }),
    );
  }
  return quests;
}

export async function seedMinis(n = 20) {
  for (let slot = 0; slot < n; slot += 1) {
    await prisma.miniQuest.create({
      data: { slot, title: `Mini ${slot}`, prompt: `Do mini ${slot}`, category: 'ADVENTURE' },
    });
  }
}

let counter = 0;

export async function registerUser(request, overrides = {}) {
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
  return { ...res.body, payload };
}

// A 1x1 PNG — smallest valid image multer will accept.
export const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
