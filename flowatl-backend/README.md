# FlowATL Backend

Backend for **FlowATL** — the AI-optimized autonomous electric shuttle network for
downtown Atlanta, plus **FlowHaul**, its consolidated B2B freight product.

The Base44 front end simulates everything in the browser: shuttle positions drift
on a timer, the "Next Shuttle" countdown is `Math.random()`, matched freight loads
are a hardcoded array and the impact dashboard increments a number every 2.2
seconds. This service replaces all of it with one authoritative simulation and a
REST + SSE API, so the map, the booking card, the live ride and the impact
dashboard are all reading the same moving world.

## What it actually does

A **live network simulation** ticks once a second. Shuttles drive the loop at a
configured speed, dwell at each stop, pick up and drop off walk-up riders drawn
from a time-of-day demand curve, drain their batteries and pull into the Five
Points depot to charge when they run low. Every number the API serves is read
off that world:

| The app shows | Where it comes from |
| --- | --- |
| Shuttles moving on the map | Real positions along the loop, in the client's own SVG coordinates |
| "Next Shuttle 04:12" | Distance from the nearest shuttle to that stop, plus the dwell at every stop in between |
| "7 passengers on board" | Who is actually on that vehicle — walk-up riders plus booked riders |
| Fare | `max($1.50, stops × $0.35)`, waived for FlowPass holders |
| "CO₂ saved vs. a solo Uber" | Trip miles × (gasoline + ride-hail deadhead − the shuttle's grid draw split across everyone aboard) × car-displacement rate |
| Ride phases | Where the assigned shuttle is: Approaching → Arrived → Boarding → En Route → Arriving at Destination |
| FlowHaul matched loads | Real open loads in the pool going to the same zone in an overlapping window |
| "$38 vs. $110 dedicated" | That van run's cost, split by weight and headcount, against a dedicated courier quote |
| Impact dashboard | Aggregates of trips that actually completed today |
| A shuttle greyed out on the map | Its pack dropped below the charge threshold, so it is running empty to the depot |

Because it is one simulation, the pieces cannot disagree: the shuttle the booking
card promises is the shuttle that shows up on the map, carrying the passenger
count the live screen displays.

## Quick start

```bash
npm install
cp .env.example .env     # optional — the defaults work
npm run dev              # http://localhost:4000
```

```bash
curl localhost:4000/health
curl localhost:4000/api/network/stops/five-points/arrivals
```

A full booking flow:

```bash
BASE=http://localhost:4000
TOKEN=$(curl -s -XPOST $BASE/api/auth/guest -H 'content-type: application/json' \
  -d '{}' | jq -r .token)

curl -s -XPOST $BASE/api/rides/quote -H 'content-type: application/json' \
  -d '{"pickupStopId":"five-points","destinationStopId":"aquarium"}' | jq .quote

curl -s -XPOST $BASE/api/rides -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pickupStopId":"five-points","destinationStopId":"aquarium"}' | jq .ride

curl -s $BASE/api/rides/active -H "authorization: Bearer $TOKEN" | jq '.ride.phase, .ride.etaMinutes'
```

Watch the fleet move:

```bash
curl -N "$BASE/api/stream?topics=shuttles,impact"
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode on `src/index.ts` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm test` | Full suite (104 tests, in-memory database) |
| `npm run typecheck` | Types only, including tests |

## Configuration

Everything is environment-driven; see `.env.example` for the annotated list.
The ones worth knowing:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `DATABASE_PATH` | `./data/flowatl.db` | `:memory:` gives a fresh network every boot |
| `AUTH_SECRET` | random per boot | **Required** when `NODE_ENV=production` |
| `CORS_ORIGINS` | `*` | Comma-separated origins for the browser app |
| `FLEET_SIZE` | `6` | Shuttles on the loop |
| `SHUTTLE_CAPACITY` | `12` | Seated plus standing |
| `SHUTTLE_SPEED_MPH` | `11` | Downtown traffic |
| `STOP_DWELL_SECONDS` | `30` | Boarding time at each stop |
| `TIME_SCALE` | `1` | Fast-forwards the whole world — driving, dwell, charging and freight |
| `SIM_SEED` | `20260920` | Fixed seed — the same seed replays the same network |

With the defaults the loop is about **4.3 miles**, a lap takes **~26 minutes**, and
six shuttles give a **~4.4 minute headway** — so the "Next Shuttle" countdown
naturally lands in the 0–4 minute range and the average wait is about 2.2 minutes.
Turn `FLEET_SIZE` down to stretch the waits out, or up to tighten them.

## Architecture

```
src/
  config.ts            Environment configuration
  services.ts          Composition root — builds and wires everything
  server.ts            Express app
  index.ts             Entry point and graceful shutdown
  domain/
    network.ts         Stops, loop geometry, distances (the source of truth)
    demand.ts          Time-of-day ridership model
    simulation.ts      The live fleet: movement, dwell, boarding, battery
    pricing.ts         Fares, ride-hail comparison, emissions math
    rides.ts           Booking and the live-tracking state machine
    subscriptions.ts   FlowPass
    zones.ts           Delivery zones and windows for freight
    freight.ts         FlowHaul matching, pricing and shipment tracking
    impact.ts          The impact ledger
    auth.ts            Accounts and sessions
  store/db.ts          SQLite schema and connection
  http/                Routes, validation schemas, middleware
client/
  flowatlClient.js     Dependency-free API client for the Base44 app
  useFlowATL.js        React hooks, one per screen
docs/
  API.md               Full endpoint reference
  FRONTEND_INTEGRATION.md  Wiring the existing demo screens to this API
```

The domain layer knows nothing about HTTP, and the simulation knows nothing about
the database — it emits events (`shuttle:arrive`, `shuttle:depart`,
`ambient:complete`, `fleet:moved`) that the ride and impact services subscribe to.
That is what keeps a booked ride and the shuttle carrying it in step.

## Data and persistence

SQLite via `better-sqlite3`, in WAL mode. Riders, sessions, rides,
subscriptions, freight loads, shipments and the daily impact counters all
persist across restarts. The fleet itself lives in memory and is rebuilt on
boot — a restart re-spreads the shuttles around the loop and warms them up with
riders rather than starting from an empty depot.

Daily counters roll over at **local midnight in Atlanta**, not UTC, and a new day
is seeded with the ridership the network would already have carried by that hour
(see `ImpactService.ensureDay`). Opening the dashboard at 3pm should not claim
downtown has taken zero trips today.

## Notes on the numbers

Every constant that feeds a published figure is named and documented in
`src/domain/pricing.ts` and `src/domain/freight.ts` rather than being scattered
through the UI. The emissions basis:

- **0.882 lb CO₂/mile** — EPA tailpipe average for a US passenger vehicle.
- **×1.4 deadhead** — ride-hail drivers circulate empty between fares.
- **1.05 kWh/mile** shuttle draw × **0.72 lb CO₂/kWh** Georgia grid, divided by
  everyone aboard.
- **62% car displacement** — the rest of the riders would have walked, biked or
  taken MARTA, so their trip displaces nothing.

These are defensible modelling assumptions, not measurements. They are all in one
place so they can be argued with and changed.

## Security

- Passwords are scrypt-hashed with a per-user salt; session tokens are random and
  only their SHA-256 digest is stored.
- Login and registration are rate-limited separately from the rest of the API.
- Guest sign-in (`POST /api/auth/guest`) is **disabled** when `NODE_ENV=production`,
  and the server refuses to boot in production without an `AUTH_SECRET`.
- Rides and shipments are scoped to their owner; reading someone else's returns
  403, not 404-by-accident.

This is demo-grade auth — it keeps one rider's data separate from another's. It is
not a substitute for a real identity provider, and there is no payment processing:
booking a ride and subscribing to FlowPass record the intent, they do not charge
anyone.
