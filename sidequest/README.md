# SideQuest

Daily quest habit app — discover local adventures, complete quests, build streaks.

**Status: Phase 1 (core loop + habit engine) is built and tested.** No social
layer, no badges, no bucket list — those are Phase 2/3 and deliberately absent.

## Stack

- **API:** TypeScript, Node.js, Express, Prisma, PostgreSQL
- **Mobile:** Expo (React Native) — auth + feed built, completion flow not yet
- **Storage:** Cloudflare R2 for completion photos (falls back to local disk)
- **Jobs:** node-cron for the streak sweep and orphaned-photo cleanup
- **Images:** sharp for resize/re-encode on upload

## Project structure

```
sidequest/
├── api/          # Express backend (TypeScript, strict)
│   ├── prisma/   # schema, migrations, seed content
│   ├── src/
│   └── tests/    # 71 tests, unit + HTTP integration
└── mobile/       # Expo app — see mobile/README.md
```

## Getting started (API)

**Option A — Docker Postgres (recommended)**

```bash
docker compose up -d
cd api
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

**Option B — existing Postgres**

Update `DATABASE_URL` in `api/.env`, then:

```bash
cd api
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

API runs at `http://localhost:3000`. Photos go to `api/uploads/` and are served
from `/uploads/...` until you configure R2.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | tsx watch on `src/index.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | run the compiled build |
| `npm run typecheck` | typecheck `src` and `tests` |
| `npm test` | full suite against a real Postgres |
| `npm run lint` / `lint:fix` | ESLint (flat config, typescript-eslint) |
| `npm run format` / `format:check` | Prettier |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma |

## Tests

```bash
createdb sidequest_test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sidequest_test?schema=public" npx prisma migrate deploy
npm test
```

The suite hits real HTTP endpoints against a real Postgres — it covers the whole
loop (register → feed → complete with photo → streak → minis), not just units.
Override the test database with `TEST_DATABASE_URL`.

## CI

`.github/workflows/sidequest-api.yml` runs lint, format check, typecheck, tests
and a build on every push touching `sidequest/`, against a real Postgres service
container.

## Security and privacy

`SECURITY.md` documents the controls, the reasoning behind the non-obvious ones,
and the gaps that are accepted deliberately. `PRIVACY.md` is a working draft —
it describes what the code actually does, but the placeholders need your details
and it needs review by someone qualified before you publish it.

Two things worth knowing without reading either:

- **Completions are visible to every signed-in user.** That's the product, but
  it means there is no private log.
- **EXIF is stripped from every upload**, GPS included, so a photo taken at
  home doesn't carry your address into the feed.

Account deletion (`DELETE /me`) and data export (`GET /me/export`) are self-serve,
because a privacy policy promising them has to be backed by endpoints that exist.
Deletion needs the password re-entered — a stolen token shouldn't be enough to
destroy an account.

## Auth model

Long-lived JWT (`JWT_EXPIRES_IN`, default 7d) with re-login on expiry — **no
refresh token flow**. A refresh flow buys you short access-token lifetimes and
server-side revocation; neither matters while the only client is a first-party
mobile app with no third-party token exposure, and it costs a token store, a
rotation endpoint and a whole class of replay bugs. Revisit if you add web
sessions or need instant revocation.

Credential endpoints are rate limited by IP: 10 registrations/hour and 20 login
attempts/15min. Behind Railway or Render set `TRUST_PROXY=true`, or every
request looks like it came from the load balancer and all users share one bucket.

## Phase 1 endpoints

All routes except `/health` and `/auth/*` need `Authorization: Bearer <token>`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Liveness check |
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Get JWT |
| GET | `/quests` | Quest feed with filters |
| POST | `/quests` | Submit a quest (lands PENDING) |
| GET | `/quests/mine/submissions` | Your submissions and their state |
| GET | `/quests/categories` | Category list with display labels |
| GET | `/quests/:id` | Quest detail + completion stats |
| POST | `/completions` | Complete a quest (multipart photo) |
| GET | `/completions/:id` | Single completion + its owner |
| DELETE | `/completions/:id` | Remove your own completion |
| GET | `/me` | Profile + streak + stats |
| PATCH | `/me` | Update display name, city, timezone |
| PUT | `/me/avatar` | Upload profile photo (multipart) |
| DELETE | `/me/avatar` | Remove profile photo |
| GET | `/me/completions` | Your completion grid |
| GET | `/me/streak` | Streak stats + 30-day history |
| GET | `/me/export` | Everything we hold about you, as JSON |
| DELETE | `/me` | Delete your account (password required) |
| GET | `/minis/today` | Today's 4 daily minis |
| POST | `/minis/:assignmentId/complete` | Mark mini done |
| GET | `/users/:idOrUsername/profile` | Public profile: stats, streak, grid |

### Admin routes

Admin is the `isAdmin` column, set by hand in the database. There is deliberately
no endpoint that grants it — a self-serve path to moderator rights is a
privilege-escalation bug waiting to happen. These return **404, not 403**, to
ordinary users, so the surface doesn't confirm it exists.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/quests/admin/queue` | Moderation queue (`?status=PENDING`) |
| PATCH | `/quests/:id/status` | Approve or reject a submission |
| GET | `/minis/pool` | The full mini rotation |
| POST | `/minis/pool` | Add a mini at a slot |
| PATCH | `/minis/pool/:id` | Edit a mini |
| DELETE | `/minis/pool/:id` | Remove a mini |

### Feed filters

`GET /quests?category=NATURE&city=Boston&search=river&hideCompleted=true&limit=30&cursor=<id>`

- `category` — one of `ADVENTURE`, `FOOD_DRINK`, `CULTURE`, `NATURE`, `FITNESS`, `CREATIVE`
- `city` — defaults to the user's city; `city=all` disables the filter. Quests
  with no city ("everywhere" quests) always appear.
- Pagination is cursor-based; `nextCursor` is `null` on the last page.

### Completing a quest

`POST /completions` is `multipart/form-data`:

| Field | Required | Notes |
|-------|----------|-------|
| `questId` | yes | |
| `rating` | yes | 1–5 |
| `photo` | yes | JPEG/PNG/WebP/HEIC, max 10MB. One photo in v1. |
| `review` | no | up to 1000 chars |

Returns the completion, the updated streak, and `milestone` — the streak
milestone just crossed (7, 30, 100, 365) or `null`. It fires only on the exact
day the number is hit, so the client celebrates once instead of every day after.

A quest can only be completed once per user (409 on a repeat). This is stricter
than once-per-day: same-day-only would let someone re-log a single quest forever
to farm a streak.

Deleting a completion rebuilds the streak from remaining activity rather than
decrementing it, since removing a day's only activity can sever a run. Its photo
is queued in `OrphanedObject` and removed from storage by the hourly job — the
delete itself never blocks on object storage being reachable, which is what
makes account deletion dependable.

### Quest moderation

User submissions land `PENDING` and stay out of the feed until approved — quest
supply *is* the product, so it can't be open season. A pending quest is visible
to its author (so they can see it's in review) and to admins, and is **not
completable** by anyone, or you could log a quest you invented yourself.

An admin's own submission is auto-approved; there's nobody else to review it.

`status` is separate from `isActive`: status is moderation, `isActive` retires an
approved quest that's no longer doable (venue closed, season over).

### Photo storage

Completions store the R2 object *key*, not a URL, and the URL is resolved on
read. That keeps photos working across a bucket or CDN domain change, and lets
a private bucket be served through short-lived presigned URLs. With
`R2_PUBLIC_URL` set the same key renders as a plain CDN URL instead. With no R2
credentials at all, photos land in `./uploads/` and are served from `/uploads`.

Uploads are resized and re-encoded with sharp before storage — completions to a
1600px long edge, avatars to 512px, both JPEG. Phone originals are 4–12MB and
every profile-grid render would otherwise pay for that; a 4000x3000 test image
lands at 1600x1200 and a twelfth of the bytes. EXIF orientation is baked into
the pixels and the rest of the metadata dropped, so uploads don't carry the GPS
coordinates of where they were taken into a public feed. If sharp can't decode
a format, the original is stored unchanged rather than losing the photo.

## How the habit engine works

**Streaks** are measured in the user's own local calendar day, taken from their
IANA `timezone`. Completing a quest *or* a daily mini counts. Same day again is
a no-op; yesterday → today increments; a longer gap resets to 1.

`GET /me/streak` recomputes the displayed number rather than trusting the stored
counter, so a broken streak reads as broken the moment the user opens the app —
before any job has run. The hourly `sweepStreaks` job exists to keep the stored
column honest for anything that queries it directly (reminders, leaderboards).
It runs hourly, not nightly, because "local midnight" happens 24+ times a day
across timezones.

**Streak breaks** are recorded to `StreakBreak` by the sweep, capturing the
streak length *before* it is zeroed. That is the drop-off data — where people
quit — and it is unrecoverable once the counter is overwritten. The job logs a
JSON line on every run, including runs with nothing to do, because a silent job
is indistinguishable from a broken one.

**Daily minis** are a fixed 20-item pool cycled 4 a day, keyed off the day
number — no recommender. With 4 a day the pool cycles every 5 days, which is
enough for the feed to feel fresh with nothing to tune. Assignments are created
on first read of `/minis/today` and are stable for the rest of that day.
Yesterday's leftover minis return 410 rather than backfilling a missed day.

## Seed content

`npm run db:seed` loads 44 quests (26 "everywhere" + 18 city/campus) and the
20 minis. Set `SEED_CITY` in `.env` to the city or campus you're launching in —
that's the differentiation lever, so it's worth picking before you seed. The
seed is idempotent and matches on title, so re-running it tops content up
without duplicating anything or touching existing completions.

Seeding is ongoing work, not a one-off: quest supply is entirely hand-written
in Phase 1.

## Configuration

See `api/.env.example`. Notable:

- `JWT_SECRET` — required in production, the process refuses to start without it
- `ENABLE_CRON` — set `false` on extra instances so the sweep runs once
- `R2_ACCOUNT_ID` — blank means photos go to local disk; setting it switches to R2
- `R2_PUBLIC_URL` — blank means photo URLs are presigned instead of public
- `CORS_ORIGIN` — defaults to `*`; lock it down once the app ships
- `TRUST_PROXY` — set `true` behind Railway/Render or rate limiting is useless

Running with `NODE_ENV=production` logs a warning for each of these that is
still on a development default, and refuses to start at all without a
`JWT_SECRET`.

## Not built yet (by design)

The mobile app can sign in, browse quests and show your profile, but **cannot
log a completion yet** — that flow (camera, review, rating) is the next thing to
build. Until it exists, Phase 1 still cannot be tested on real people.

Phase 2 (follow graph, friend feed, tagging, reactions, IG story export) and
Phase 3 (badges, bucket list, profile prompts, skills) are not started. The rule
from the build plan holds: no Phase 2 work until 5+ real people have used Phase 1
unprompted for a week.

One exception: the `Follow` table exists in the schema already, unused. Adding a
table is free now and a migration against live data later, so it is the one bit
of Phase 2 worth landing early.
