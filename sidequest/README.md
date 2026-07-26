# SideQuest

Daily quest habit app — discover local adventures, complete quests, build streaks.

**Status: Phase 1 (core loop + habit engine) is built and tested.** No social
layer, no badges, no bucket list — those are Phase 2/3 and deliberately absent.

## Stack

- **API:** TypeScript, Node.js, Express, Prisma, PostgreSQL
- **Mobile:** Expo (React Native) — not started
- **Storage:** Cloudflare R2 for completion photos (falls back to local disk)
- **Jobs:** node-cron for the streak sweep

## Project structure

```
sidequest/
├── api/          # Express backend (TypeScript, strict)
│   ├── prisma/   # schema, migrations, seed content
│   ├── src/
│   └── tests/    # 38 tests, unit + HTTP integration
└── mobile/       # Expo app (not started)
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
| GET | `/quests/categories` | Category list with display labels |
| GET | `/quests/:id` | Quest detail + completion stats |
| POST | `/completions` | Complete a quest (multipart photo) |
| GET | `/me` | Profile + streak + stats |
| PATCH | `/me` | Update display name, city, timezone |
| GET | `/me/completions` | Your completion grid |
| GET | `/me/streak` | Streak stats + 30-day history |
| GET | `/minis/today` | Today's 4 daily minis |
| POST | `/minis/:assignmentId/complete` | Mark mini done |

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

Returns the completion and the updated streak. A quest can only be completed
once per user (409 on a repeat).

### Photo storage

Completions store the R2 object *key*, not a URL, and the URL is resolved on
read. That keeps photos working across a bucket or CDN domain change, and lets
a private bucket be served through short-lived presigned URLs. With
`R2_PUBLIC_URL` set the same key renders as a plain CDN URL instead. With no R2
credentials at all, photos land in `./uploads/` and are served from `/uploads`.

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

## Not built yet (by design)

Phase 2 (follow graph, friend feed, tagging, reactions, IG story export) and
Phase 3 (badges, bucket list, profile prompts, skills) are not started. The rule
from the build plan holds: no Phase 2 work until 5+ real people have used Phase 1
unprompted for a week.

One exception: the `Follow` table exists in the schema already, unused. Adding a
table is free now and a migration against live data later, so it is the one bit
of Phase 2 worth landing early.
