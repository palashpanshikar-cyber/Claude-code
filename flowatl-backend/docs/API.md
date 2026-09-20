# FlowATL API Reference

Base URL: `http://localhost:4000` (configurable via `PORT` / `HOST`).

All request and response bodies are JSON. Money is in US dollars as a number
(`1.5` means $1.50), distances in miles, weights in pounds, emissions in pounds
of CO₂e, and timestamps as ISO 8601 strings in UTC.

## Authentication

Send the session token as a bearer header:

```
Authorization: Bearer <token>
```

The one exception is `GET /api/stream`: browsers cannot set headers on an
`EventSource`, so that endpoint also accepts `?token=<token>`.

Endpoints are marked:

- **public** — no token needed
- **optional** — works signed out, but a signed-in rider gets personalised results
- **required** — 401 without a valid token

## Errors

Every failure returns the same envelope:

```json
{
  "error": {
    "code": "conflict",
    "message": "This account already has a ride in progress",
    "details": { "rideId": "ride_TE286AF6K59N" }
  }
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_failed` | Body or query failed schema validation; `details` lists the fields |
| 400 | `bad_request` | Valid shape, invalid request (e.g. pickup equals destination) |
| 401 | `unauthorized` | Missing, expired or revoked token |
| 403 | `forbidden` | The resource belongs to another account |
| 404 | `not_found` | Unknown stop, ride, shipment or route |
| 409 | `conflict` | Duplicate email, second concurrent ride, double subscription |
| 429 | `rate_limited` | Too many requests; `details.retryAfterSeconds` |
| 503 | `no_capacity` | Every shuttle is full |

Rate limits: 600 requests/minute per IP across `/api`, 20/minute on the auth
endpoints. Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset`.

---

## Health

### `GET /health` — public

```json
{
  "status": "ok",
  "serverTime": "2026-09-20T14:30:39.305Z",
  "fleet": { "size": 6, "active": 6, "passengersOnboard": 28 }
}
```

---

## Accounts

### `POST /api/auth/register` — public

```json
{ "email": "rider@example.com", "password": "at least 8 chars",
  "displayName": "Ada", "businessName": "Marietta St Diner" }
```

`displayName` and `businessName` are optional; `businessName` is used as the
default shipper name on FlowHaul. Returns **201** with `{ user, token, expiresAt }`.

### `POST /api/auth/login` — public

`{ "email": "...", "password": "..." }` → `{ user, token, expiresAt }`.

An unknown email and a wrong password return the same 401 message, so the
endpoint does not reveal which addresses have accounts.

### `POST /api/auth/guest` — public

`{}` or `{ "email": "demo@example.com" }`. Creates (or resumes) an account with
no password so a demo can open straight into a rider session. **Disabled when the
server runs with `NODE_ENV=production`** — returns 403.

### `GET /api/auth/me` — required

```json
{ "user": { "id": "user_...", "email": "...", "displayName": "...", "role": "user" },
  "subscription": null }
```

### `POST /api/auth/logout` — required

Revokes the token. **204**, no body.

---

## Network

### `GET /api/network/route` — public

Stops, loop geometry and the SVG path, so the client can render the map from
server data instead of a local constant.

```json
{
  "route": {
    "id": "downtown-loop",
    "name": "Downtown Loop",
    "loopMiles": 4.31,
    "stopCount": 6,
    "pathD": "M180,482 L168,96 ... Z",
    "stops": [
      { "id": "five-points", "name": "Five Points", "area": "Downtown core · MARTA transfer",
        "lat": 33.754, "lng": -84.3917, "x": 180, "y": 482, "depot": true, "demandWeight": 1.6 }
    ],
    "segments": [{ "from": "five-points", "to": "centennial", "miles": 0.61 }]
  }
}
```

`x`/`y` are in the client's SVG viewBox, matching the existing `flowData.js`, so
the map keeps working unchanged.

### `GET /api/network/stops` — public

Every stop with its single soonest arrival attached as `nextArrival`.

### `GET /api/network/stops/:stopId/arrivals?limit=3` — public

What the "Next Shuttle" countdown reads.

```json
{
  "stopId": "five-points",
  "generatedAt": "2026-09-20T14:30:50.098Z",
  "nextArrival": {
    "shuttleId": "shuttle_flo03", "shuttleLabel": "FLO-03",
    "etaSeconds": 251, "etaMinutes": 4.2,
    "passengers": 8, "availableSeats": 4, "status": "in_service"
  },
  "arrivals": [ ... ]
}
```

`etaSeconds` accounts for the driving distance *and* the dwell at every stop in
between. A shuttle standing at the stop right now reports `0`.

### `GET /api/network/shuttles` — public

```json
{
  "generatedAt": "...",
  "shuttles": [{
    "id": "shuttle_flo01", "label": "FLO-01", "routeId": "downtown-loop",
    "status": "in_service",
    "distanceMiles": 3.568, "loopProgress": 0.8283,
    "position": { "x": 100.5, "y": 430.5, "bearing": 0.575 },
    "atStopId": null, "nextStopId": "five-points", "nextStopEtaSeconds": 242,
    "passengers": 8, "capacity": 12, "availableSeats": 4, "occupancyPct": 67,
    "batteryPct": 50.1, "acceptingRiders": true,
    "speedMph": 11, "odometerMiles": 0.07
  }]
}
```

`status` is `in_service`, `dwelling` (stopped for boarding) or `charging` (at the
depot). `position` is ready to drop into the SVG; `bearing` is radians, for
rotating the icon.

`acceptingRiders` is `false` when a shuttle has dropped below its charge
threshold: it finishes carrying whoever is aboard, takes no new riders and runs
to the Five Points depot to top up. Grey it out on the map — it will not stop for
anyone, and it is excluded from arrival estimates for booking purposes.

### `GET /api/network/shuttles/:shuttleId` — public

One shuttle.

### `GET /api/network/status` — public

Route, every shuttle and fleet-level figures in a single call — enough to paint
the whole home screen.

---

## Rides

### `POST /api/rides/quote` — optional

```json
{ "pickupStopId": "five-points", "destinationStopId": "aquarium" }
```

```json
{
  "quote": {
    "pickupStopId": "five-points", "destinationStopId": "aquarium",
    "pickup": { "id": "five-points", "name": "Five Points" },
    "destination": { "id": "aquarium", "name": "Georgia Aquarium" },
    "stopsTraversed": 2, "miles": 0.9,
    "fareUsd": 1.5, "listFareUsd": 1.5, "coveredBySubscription": false,
    "ridehailUsd": 8.25, "savingsUsd": 6.75,
    "co2SavedLbs": 0.64, "estimatedMinutes": 6,
    "shuttle": { "id": "shuttle_flo03", "label": "FLO-03", "passengers": 8, "availableSeats": 4 },
    "pickupEtaSeconds": 251, "pickupEtaMinutes": 4,
    "arrivesAt": "2026-09-20T14:40:56.697Z",
    "serviceAvailable": true
  }
}
```

Everything the booking card needs. Signed in with an active FlowPass,
`fareUsd` is `0` and `coveredBySubscription` is `true` while `listFareUsd` keeps
the list price. `pickupEtaMinutes` is the number behind *"Your autonomous shuttle
is 4 minutes away."*

Pickup and destination must differ (400 otherwise).

### `POST /api/rides` — required

Same body as the quote. Assigns the soonest shuttle with a free seat, holds that
seat and issues a boarding pass. **201**.

```json
{
  "ride": {
    "id": "ride_TE286AF6K59N",
    "status": "awaiting_pickup",
    "phase": "Approaching", "phaseIndex": 0,
    "phases": ["Approaching","Arrived","Boarding","En Route","Arriving at Destination"],
    "pickup": { "id": "five-points", "name": "Five Points" },
    "destination": { "id": "aquarium", "name": "Georgia Aquarium" },
    "shuttle": { ... full shuttle snapshot ... },
    "shuttleLabel": "FLO-03", "passengersOnboard": 8,
    "stopsTraversed": 2, "miles": 0.9,
    "fareUsd": 1.5, "listFareUsd": 1.5, "ridehailUsd": 8.25, "savingsUsd": 6.75,
    "co2SavedLbs": 0.64, "coveredBySubscription": false,
    "pickupEtaSeconds": 242, "etaSeconds": 598, "etaMinutes": 10, "progressPct": 0,
    "boardingPass": {
      "token": "8rokiLMVfuQCB0OAevUq_0N_",
      "qrPayload": "flowatl://board?ride=ride_TE286AF6K59N&token=8rokiLMVfuQCB0OAevUq_0N_"
    },
    "bookedAt": "...", "boardedAt": null, "completedAt": null, "cancelledAt": null
  }
}
```

Render `boardingPass.qrPayload` as the QR code on the confirmation screen.

Errors: **409** `conflict` if the account already has a ride in progress (the id
is in `details.rideId`); **503** `no_capacity` if every shuttle is full.

### `GET /api/rides/active` — required

The trip in progress, or `{ "ride": null }`. This is what the live-tracking
screen polls — or receives on the `ride` SSE topic.

`status` moves `awaiting_pickup` → `onboard` → `completed`, and `phase` is
derived from where the assigned shuttle actually is:

| Phase | Meaning |
| --- | --- |
| `Approaching` | The shuttle is still on its way to the pickup stop |
| `Arrived` | It has pulled in and is standing at the stop |
| `Boarding` | Second half of the dwell — doors open |
| `En Route` | Aboard, more than one stop from the destination |
| `Arriving at Destination` | The next stop is the destination |
| `Completed` / `Cancelled` | Terminal |

`passengersOnboard` is the live count on that vehicle, and `etaSeconds` counts
down as it drives.

### `GET /api/rides/:rideId` — required

One ride. **403** if it belongs to another account.

### `POST /api/rides/:rideId/cancel` — required

Releases the held seat (or takes the rider off, if already aboard). **409** if
the ride already completed.

### `GET /api/rides?limit=25` — required

Newest first.

---

## FlowPass subscription

### `GET /api/subscriptions/plans` — public

```json
{ "plans": [{ "id": "flowpass-monthly", "name": "FlowPass",
              "priceUsd": 119, "interval": "month", "benefits": [ ... ] }] }
```

### `GET /api/subscriptions/me` — required

`{ "subscription": <active or null>, "history": [...] }`

### `POST /api/subscriptions` — required

Starts a 30-day period. **201**. **409** if one is already active. From then on
quotes and bookings come back at `fareUsd: 0`.

### `POST /api/subscriptions/cancel` — required

Cancels at period end — unlimited rides continue until `currentPeriodEnd`.

> No payment processing. Subscribing records the intent; nobody is charged.

---

## FlowHaul (freight)

### `GET /api/freight/options` — public

Cargo types, delivery windows, van capacity and the zone list — everything the
shipment form's dropdowns need.

### `GET /api/freight/loads?limit=20` — public

The open-load pool: loads currently looking for a van.

### `POST /api/freight/quote` — optional

```json
{
  "pickupAddress": "123 Marietta St NW",
  "deliveryAddress": "1180 Peachtree St NE, Midtown",
  "cargoType": "Restaurant Supplies",
  "weightLbs": 150,
  "windowId": "morning"
}
```

`cargoType` is one of `Restaurant Supplies`, `Retail Inventory`, `Event
Equipment`, `Film Production Equipment`, `Other`. `windowId` is `morning`,
`afternoon` or `evening`.

```json
{
  "quote": {
    "quoteId": "fq_4R6Q8F038GR0",
    "pickupZone": { "id": "downtown", "name": "Downtown" },
    "deliveryZone": { "id": "midtown", "name": "Midtown" },
    "windowId": "morning", "windowLabel": "Morning 8–12",
    "miles": 2.47, "weightLbs": 150,
    "matchedLoads": [
      { "id": "load_JY17WCSJ27Q1", "businessName": "Ponce City Bakery",
        "cargoType": "Restaurant Supplies", "weightLbs": 124,
        "deliveryZone": "midtown", "deliveryZoneName": "Midtown",
        "windowId": "morning", "windowLabel": "Morning 8–12", "sharePct": 34 }
    ],
    "shipperCount": 3, "totalWeightLbs": 351,
    "vanCapacityLbs": 2000, "capacityUsedPct": 18,
    "priceUsd": 48.92, "dedicatedUsd": 96,
    "savingsUsd": 47.08, "savingsPct": 49,
    "co2SavedLbs": 2.81, "yourSharePct": 39,
    "consolidated": true
  }
}
```

The matched loads are real rows from the open pool: same delivery zone, an
overlapping delivery window, and enough payload left on the van. The addresses
are resolved to zones by matching Atlanta neighbourhoods, landmarks and
corridors; anything unrecognised falls back to Downtown.

`priceUsd` is that van run's cost allocated across whoever is on it — 55% by
weight, 45% split evenly — against `dedicatedUsd`, a single-customer courier
quote. When nothing else is heading that way, `consolidated` is `false`,
`matchedLoads` is empty and the price equals the dedicated quote.

**400** if the cargo is heavier than a van (2,000 lbs).

### `POST /api/freight/shipments` — required

Same body, plus optional `businessName` and `notes`. Claims the matched loads,
dispatches a van and returns the tracking view. **201**.

Loads already claimed by a concurrent request are skipped rather than
double-booked, so the shipment may carry fewer loads than the quote showed.

### `GET /api/freight/shipments/:shipmentId` — required

```json
{
  "shipment": {
    "id": "ship_...", "vanLabel": "FH-01", "status": "in_transit",
    "phase": "Consolidated", "phaseIndex": 2,
    "phases": ["Dispatched","Picked Up","Consolidated","In Transit","Out for Delivery","Delivered"],
    "deliveryZone": { "id": "midtown", "name": "Midtown" },
    "windowId": "morning", "windowLabel": "Morning 8–12",
    "miles": 2.47, "co2SavedLbs": 2.81,
    "etaSeconds": 640, "etaMinutes": 11, "progressPct": 42,
    "loads": [{ "id": "load_...", "businessName": "Marietta St Diner",
                "cargoType": "Restaurant Supplies", "weightLbs": 150,
                "priceUsd": 48.92, "isYours": true }],
    "totalWeightLbs": 351,
    "createdAt": "...", "dispatchedAt": "...", "deliveredAt": null
  }
}
```

Visible only to the businesses whose cargo is on the van (**403** otherwise).

### `GET /api/freight/shipments?limit=20` — required

Every shipment carrying this account's cargo, newest first.

---

## Impact

### `GET /api/impact/network` — public

```json
{
  "impact": {
    "serviceDate": "2026-09-20",
    "ridesToday": 873, "bookedRidesToday": 4,
    "co2SavedLbsToday": 820.6, "carsRemovedToday": 541,
    "activeShuttles": 6, "fleetSize": 6,
    "averageWaitMinutes": 2.2, "passengersOnboardNow": 29,
    "fleetMilesToday": 615.2, "passengerMilesToday": 1194.2,
    "energyKwhToday": 646, "riderSavingsUsdToday": 5674.5,
    "freightLoadsToday": 1,
    "updatedAt": "2026-09-20T14:31:18.173Z"
  }
}
```

Counters roll over at local midnight in Atlanta. `ridesToday` counts every trip
the network carried — walk-up riders plus booked ones; `bookedRidesToday` is the
booked subset. `carsRemovedToday` applies the 62% car-displacement rate rather
than assuming every rider would otherwise have driven.

### `GET /api/impact/me` — required

```json
{
  "impact": {
    "userId": "user_...",
    "ridesTaken": 37, "ridesThisMonth": 6,
    "moneySavedUsd": 214.3, "totalSpentUsd": 55.5,
    "co2SavedLbs": 28.4, "milesTravelled": 41.2,
    "favoriteStopId": "five-points",
    "rewardTier": { "name": "Downtown Local", "ridesRequired": 50,
                    "ridesRemaining": 13, "progressPct": 74 }
  }
}
```

Only completed rides count. `moneySavedUsd` is the modelled ride-hail cost of
those trips minus what the rider actually paid.

---

## Live stream (SSE)

### `GET /api/stream?topics=shuttles,impact,ride,freight` — optional

`text/event-stream`. Topics default to `shuttles,impact`. `ride` and `freight`
need a session and are silently skipped without one.

| Topic | Every | Payload |
| --- | --- | --- |
| `shuttles` | 1.5s | `{ generatedAt, shuttles: [...] }` |
| `impact` | 5s | `{ impact: {...} }` |
| `ride` | 1.5s, plus immediately on any phase change | `{ ride: {...} \| null }` |
| `freight` | 4s | `{ shipments: [...] }` |

A `ready` event fires on connect with the accepted topics. A `: keep-alive`
comment every 20s keeps proxies from closing the connection, and the server sends
`retry: 3000`, so the browser's `EventSource` reconnects on its own.

```js
const source = new EventSource(`${BASE}/api/stream?topics=shuttles,ride&token=${token}`);
source.addEventListener('shuttles', (e) => setShuttles(JSON.parse(e.data).shuttles));
source.addEventListener('ride', (e) => setRide(JSON.parse(e.data).ride));
```
