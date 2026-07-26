import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  app,
  prisma,
  resetDb,
  seedQuests,
  seedMinis,
  registerUser,
  PNG_FIXTURE,
} from './helpers.js';

interface FeedQuest {
  id: string;
  title: string;
  category: string;
}
interface FeedMini {
  assignmentId: string;
  id: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function completeQuest(
  token: string,
  questId: string,
  { rating = 5, review = 'Good' }: { rating?: number; review?: string } = {},
) {
  return request(app)
    .post('/completions')
    .set(auth(token))
    .field('questId', questId)
    .field('rating', String(rating))
    .field('review', review)
    .attach('photo', PNG_FIXTURE, 'photo.png');
}

before(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await resetDb();
  await prisma.$disconnect();
});

test('health check responds', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('register returns a token and rejects duplicate email', async () => {
  const { token, user } = await registerUser(request, { email: 'dup@test.dev' });
  assert.ok(token);
  assert.equal(user.currentStreak, 0);
  assert.equal(user.passwordHash, undefined);

  const again = await request(app).post('/auth/register').send({
    email: 'dup@test.dev',
    username: 'someoneelse',
    password: 'password123',
    displayName: 'Someone',
  });
  assert.equal(again.status, 409);
});

test('register validates its input', async () => {
  const res = await request(app)
    .post('/auth/register')
    .send({ email: 'nope', username: 'a', password: 'short', displayName: '' });
  assert.equal(res.status, 400);
  assert.ok(res.body.details.length >= 3);
});

test('register rejects an unknown timezone', async () => {
  const res = await request(app).post('/auth/register').send({
    email: 'tz@test.dev',
    username: 'tzuser',
    password: 'password123',
    displayName: 'TZ',
    timezone: 'Mars/Olympus',
  });
  assert.equal(res.status, 400);
});

test('login works and wrong password is rejected without leaking existence', async () => {
  const { payload } = await registerUser(request);

  const ok = await request(app)
    .post('/auth/login')
    .send({ email: payload.email, password: payload.password });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const bad = await request(app)
    .post('/auth/login')
    .send({ email: payload.email, password: 'wrongpassword' });
  const missing = await request(app)
    .post('/auth/login')
    .send({ email: 'nobody@test.dev', password: 'wrongpassword' });
  assert.equal(bad.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(bad.body.error, missing.body.error);
});

test('protected routes reject missing and malformed tokens', async () => {
  assert.equal((await request(app).get('/quests')).status, 401);
  assert.equal((await request(app).get('/quests').set(auth('garbage'))).status, 401);
  assert.equal((await request(app).get('/me/streak').set(auth('garbage'))).status, 401);
});

test('quest feed filters by category and city', async () => {
  const { token } = await registerUser(request, { city: 'Boston' });
  await seedQuests(2, { category: 'NATURE', city: null });
  await prisma.quest.create({
    data: { title: 'Boston only', description: 'x', category: 'CULTURE', city: 'Boston' },
  });
  await prisma.quest.create({
    data: { title: 'Lisbon only', description: 'x', category: 'CULTURE', city: 'Lisbon' },
  });

  const feed = await request(app).get('/quests').set(auth(token));
  assert.equal(feed.status, 200);
  const titles = feed.body.quests.map((q: FeedQuest) => q.title);
  assert.ok(titles.includes('Boston only'), 'city quests appear');
  assert.ok(titles.includes('Test quest 0'), 'everywhere quests appear');
  assert.ok(!titles.includes('Lisbon only'), 'other cities are filtered out');

  const nature = await request(app).get('/quests?category=NATURE').set(auth(token));
  assert.ok(nature.body.quests.every((q: FeedQuest) => q.category === 'NATURE'));

  const all = await request(app).get('/quests?city=all').set(auth(token));
  assert.ok(all.body.quests.map((q: FeedQuest) => q.title).includes('Lisbon only'));
});

test('quest feed rejects an unknown category', async () => {
  const { token } = await registerUser(request);
  const res = await request(app).get('/quests?category=NAPPING').set(auth(token));
  assert.equal(res.status, 400);
});

test('quest feed paginates with a stable cursor', async () => {
  const { token } = await registerUser(request);
  await seedQuests(5);

  const first = await request(app).get('/quests?limit=2').set(auth(token));
  assert.equal(first.body.quests.length, 2);
  assert.ok(first.body.nextCursor);

  const second = await request(app)
    .get(`/quests?limit=2&cursor=${first.body.nextCursor}`)
    .set(auth(token));
  assert.equal(second.body.quests.length, 2);

  const overlap = first.body.quests
    .map((q: FeedQuest) => q.id)
    .filter((id: string) => second.body.quests.some((q: FeedQuest) => q.id === id));
  assert.equal(overlap.length, 0, 'pages must not repeat quests');
});

test('completing a quest starts a streak and marks the quest completed', async () => {
  const { token } = await registerUser(request);
  const [quest] = await seedQuests(2);

  const res = await completeQuest(token, quest.id, { rating: 4, review: 'Worth it' });
  assert.equal(res.status, 201);
  assert.equal(res.body.completion.rating, 4);
  assert.ok(res.body.completion.photoUrl.includes('/uploads/completions/'));
  assert.equal(res.body.streak.currentStreak, 1);
  assert.equal(res.body.streak.longestStreak, 1);

  const detail = await request(app).get(`/quests/${quest.id}`).set(auth(token));
  assert.equal(detail.body.quest.completed, true);
  assert.equal(detail.body.stats.completions, 1);
  assert.equal(detail.body.stats.avgRating, 4);

  const hidden = await request(app).get('/quests?hideCompleted=true').set(auth(token));
  assert.ok(!hidden.body.quests.some((q: FeedQuest) => q.id === quest.id));
});

test('a second quest on the same day does not double the streak', async () => {
  const { token } = await registerUser(request);
  const [a, b] = await seedQuests(2);

  await completeQuest(token, a.id);
  const second = await completeQuest(token, b.id);
  assert.equal(second.status, 201);
  assert.equal(second.body.streak.currentStreak, 1);
});

test('the same quest cannot be completed twice', async () => {
  const { token } = await registerUser(request);
  const [quest] = await seedQuests(1);

  await completeQuest(token, quest.id);
  const dup = await completeQuest(token, quest.id);
  assert.equal(dup.status, 409);
});

test('a yesterday streak extends, a stale streak restarts', async () => {
  const { token, user } = await registerUser(request);
  const [a, b] = await seedQuests(2);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { currentStreak: 4, longestStreak: 9, lastActiveDay: yesterday },
  });

  const extended = await completeQuest(token, a.id);
  assert.equal(extended.body.streak.currentStreak, 5);
  assert.equal(extended.body.streak.longestStreak, 9, 'longest only moves when beaten');
  assert.equal(extended.body.streak.lastActiveDay, today);

  await prisma.user.update({
    where: { id: user.id },
    data: { currentStreak: 5, lastActiveDay: '2020-01-01' },
  });
  const restarted = await completeQuest(token, b.id);
  assert.equal(restarted.body.streak.currentStreak, 1);
});

test('completion requires a photo, a valid rating and a real quest', async () => {
  const { token } = await registerUser(request);
  const [quest] = await seedQuests(1);

  const noPhoto = await request(app)
    .post('/completions')
    .set(auth(token))
    .field('questId', quest.id)
    .field('rating', '5');
  assert.equal(noPhoto.status, 400);

  const badRating = await completeQuest(token, quest.id, { rating: 9 });
  assert.equal(badRating.status, 400);

  const missingQuest = await completeQuest(token, 'does-not-exist');
  assert.equal(missingQuest.status, 404);
});

test('completion rejects a non-image upload', async () => {
  const { token } = await registerUser(request);
  const [quest] = await seedQuests(1);

  const res = await request(app)
    .post('/completions')
    .set(auth(token))
    .field('questId', quest.id)
    .field('rating', '5')
    .attach('photo', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(res.status, 400);
});

test('the completion grid is scoped to the caller', async () => {
  const { token: mine } = await registerUser(request);
  const { token: theirs } = await registerUser(request);
  const [quest] = await seedQuests(1);

  await completeQuest(mine, quest.id);

  const own = await request(app).get('/me/completions').set(auth(mine));
  assert.equal(own.body.completions.length, 1);
  assert.equal(own.body.completions[0].quest.title, quest.title);

  const other = await request(app).get('/me/completions').set(auth(theirs));
  assert.equal(other.body.completions.length, 0);
});

test('streak endpoint reports history and profile stats', async () => {
  const { token } = await registerUser(request);
  const [a, b] = await seedQuests(2);
  await completeQuest(token, a.id);
  await completeQuest(token, b.id);

  const streak = await request(app).get('/me/streak').set(auth(token));
  assert.equal(streak.status, 200);
  assert.equal(streak.body.current, 1);
  assert.equal(streak.body.activeToday, true);
  assert.equal(streak.body.history.length, 1);
  assert.equal(streak.body.history[0].count, 2);

  const me = await request(app).get('/me').set(auth(token));
  assert.equal(me.body.stats.completions, 2);
  assert.equal(me.body.stats.categoriesExplored, 2);
});

test('daily minis return four and are stable within the day', async () => {
  const { token } = await registerUser(request);
  await seedMinis();

  const first = await request(app).get('/minis/today').set(auth(token));
  assert.equal(first.status, 200);
  assert.equal(first.body.minis.length, 4);
  assert.equal(first.body.completed, 0);

  const second = await request(app).get('/minis/today').set(auth(token));
  assert.deepEqual(
    second.body.minis.map((m: FeedMini) => m.id),
    first.body.minis.map((m: FeedMini) => m.id),
    'refreshing must not reshuffle the day',
  );

  const assignments = await prisma.miniAssignment.count();
  assert.equal(assignments, 4, 'assignments are created once, not per request');
});

test('completing a mini keeps the streak alive and cannot be repeated', async () => {
  const { token } = await registerUser(request);
  await seedMinis();

  const today = await request(app).get('/minis/today').set(auth(token));
  const target = today.body.minis[0];

  const done = await request(app)
    .post(`/minis/${target.assignmentId}/complete`)
    .set(auth(token))
    .send({ note: 'walked to the river' });
  assert.equal(done.status, 200);
  assert.ok(done.body.mini.completedAt);
  assert.equal(done.body.streak.currentStreak, 1);

  const again = await request(app)
    .post(`/minis/${target.assignmentId}/complete`)
    .set(auth(token))
    .send({});
  assert.equal(again.status, 409);

  const after = await request(app).get('/minis/today').set(auth(token));
  assert.equal(after.body.completed, 1);
});

test('a mini belonging to someone else is not completable', async () => {
  const { token: mine } = await registerUser(request);
  const { token: theirs } = await registerUser(request);
  await seedMinis();

  const today = await request(app).get('/minis/today').set(auth(mine));
  const res = await request(app)
    .post(`/minis/${today.body.minis[0].assignmentId}/complete`)
    .set(auth(theirs))
    .send({});
  assert.equal(res.status, 404);
});

test('yesterday leftover mini cannot backfill a missed day', async () => {
  const { token, user } = await registerUser(request);
  await seedMinis();

  const today = await request(app).get('/minis/today').set(auth(token));
  const target = today.body.minis[0];
  await prisma.miniAssignment.update({
    where: { id: target.assignmentId },
    data: { localDay: '2020-01-01' },
  });

  const res = await request(app)
    .post(`/minis/${target.assignmentId}/complete`)
    .set(auth(token))
    .send({});
  assert.equal(res.status, 410);

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.currentStreak, 0);
});

test('profile updates persist and drive the feed city', async () => {
  const { token } = await registerUser(request, { city: null });
  await prisma.quest.create({
    data: { title: 'Lisbon only', description: 'x', category: 'CULTURE', city: 'Lisbon' },
  });

  const patched = await request(app)
    .patch('/me')
    .set(auth(token))
    .send({ city: 'Lisbon', displayName: 'Renamed' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.user.city, 'Lisbon');
  assert.equal(patched.body.user.displayName, 'Renamed');

  const feed = await request(app).get('/quests').set(auth(token));
  assert.equal(feed.body.appliedCity, 'Lisbon');
  assert.ok(feed.body.quests.some((q: FeedQuest) => q.title === 'Lisbon only'));
});

test('unknown routes return a json 404', async () => {
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Not found');
});

test('a completion is readable by id, by anyone signed in', async () => {
  const { token: mine } = await registerUser(request);
  const { token: theirs } = await registerUser(request);
  const [quest] = await seedQuests(1);

  const created = await completeQuest(mine, quest!.id, { rating: 3, review: 'ok' });
  const id = created.body.completion.id;

  const res = await request(app).get(`/completions/${id}`).set(auth(theirs));
  assert.equal(res.status, 200);
  assert.equal(res.body.completion.rating, 3);
  assert.equal(res.body.completion.quest.title, quest!.title);
  assert.ok(res.body.user.username, 'the owner comes back with it');
  assert.equal(res.body.user.passwordHash, undefined);

  assert.equal((await request(app).get('/completions/nope').set(auth(mine))).status, 404);
});

test('deleting a completion removes it and rebuilds the streak', async () => {
  const { token, user } = await registerUser(request);
  const [quest] = await seedQuests(1);

  const created = await completeQuest(token, quest!.id);
  assert.equal(created.body.streak.currentStreak, 1);

  const res = await request(app)
    .delete(`/completions/${created.body.completion.id}`)
    .set(auth(token));
  assert.equal(res.status, 200);
  // Its only activity is gone, so the streak collapses rather than lingering.
  assert.equal(res.body.streak.currentStreak, 0);
  assert.equal(res.body.streak.lastActiveDay, null);

  const grid = await request(app).get('/me/completions').set(auth(token));
  assert.equal(grid.body.completions.length, 0);

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.currentStreak, 0);
});

test('deleting one of two same-day completions keeps the streak', async () => {
  const { token } = await registerUser(request);
  const [a, b] = await seedQuests(2);

  const first = await completeQuest(token, a!.id);
  await completeQuest(token, b!.id);

  const res = await request(app)
    .delete(`/completions/${first.body.completion.id}`)
    .set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.streak.currentStreak, 1, 'the day still has activity');
});

test('a completion belonging to someone else cannot be deleted', async () => {
  const { token: mine } = await registerUser(request);
  const { token: theirs } = await registerUser(request);
  const [quest] = await seedQuests(1);

  const created = await completeQuest(mine, quest!.id);
  const res = await request(app)
    .delete(`/completions/${created.body.completion.id}`)
    .set(auth(theirs));
  assert.equal(res.status, 404);

  assert.equal(await prisma.completion.count(), 1, 'it survives');
});

test('crossing a milestone is reported once, on the day it is hit', async () => {
  const { token, user } = await registerUser(request);
  const [a, b] = await seedQuests(2);

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { currentStreak: 6, longestStreak: 6, lastActiveDay: yesterday },
  });

  const hit = await completeQuest(token, a!.id);
  assert.equal(hit.body.streak.currentStreak, 7);
  assert.equal(hit.body.milestone, 7);

  // Same day again: still 7, but no second celebration for a new completion.
  const again = await completeQuest(token, b!.id);
  assert.equal(again.body.streak.currentStreak, 7);
  assert.equal(again.body.milestone, 7);
});

test('an ordinary streak day reports no milestone', async () => {
  const { token } = await registerUser(request);
  const [quest] = await seedQuests(1);
  const res = await completeQuest(token, quest!.id);
  assert.equal(res.body.milestone, null);
});

test('public profile works by id and by username', async () => {
  const { token, user } = await registerUser(request);
  const [quest] = await seedQuests(1);
  await completeQuest(token, quest!.id);

  const byId = await request(app).get(`/users/${user.id}/profile`).set(auth(token));
  assert.equal(byId.status, 200);
  assert.equal(byId.body.stats.completions, 1);
  assert.equal(byId.body.completions.length, 1);
  assert.equal(byId.body.streak.current, 1);
  assert.equal(byId.body.user.passwordHash, undefined);

  const username = byId.body.user.username;
  const byName = await request(app).get(`/users/${username}/profile`).set(auth(token));
  assert.equal(byName.status, 200);
  assert.equal(byName.body.user.id, user.id);

  assert.equal((await request(app).get('/users/ghost/profile').set(auth(token))).status, 404);
});

test('a profile with zero completions returns empty, not 500', async () => {
  const { token, user } = await registerUser(request);

  const res = await request(app).get(`/users/${user.id}/profile`).set(auth(token));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.completions, []);
  assert.equal(res.body.nextCursor, null);
  assert.equal(res.body.stats.completions, 0);
  assert.equal(res.body.stats.categoriesExplored, 0);
  assert.equal(res.body.streak.current, 0);
  assert.equal(res.body.streak.lastActiveDay, null);
});

test('the sweep breaks stale streaks and records them for analytics', async () => {
  const { token, user } = await registerUser(request);
  const [quest] = await seedQuests(1);
  await completeQuest(token, quest!.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { currentStreak: 12, longestStreak: 12, lastActiveDay: '2020-01-01' },
  });

  const { sweepStreaks } = await import('../src/jobs/cron.js');
  const result = await sweepStreaks();
  assert.equal(result.broken, 1);
  assert.ok(result.scanned >= 1);
  assert.ok(typeof result.durationMs === 'number');

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.currentStreak, 0);
  assert.equal(fresh.longestStreak, 12, 'the record survives the break');

  const breaks = await prisma.streakBreak.findMany({ where: { userId: user.id } });
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0]!.streakLength, 12, 'captured before it was zeroed');
  assert.equal(breaks[0]!.lastActiveDay, '2020-01-01');

  // A second pass has nothing left to break.
  assert.equal((await sweepStreaks()).broken, 0);
});

test('the sweep leaves a streak that is merely open today', async () => {
  const { token, user } = await registerUser(request);
  const [quest] = await seedQuests(1);
  await completeQuest(token, quest!.id);

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { currentStreak: 3, lastActiveDay: yesterday },
  });

  const { sweepStreaks } = await import('../src/jobs/cron.js');
  assert.equal((await sweepStreaks()).broken, 0);

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(fresh.currentStreak, 3);
});
