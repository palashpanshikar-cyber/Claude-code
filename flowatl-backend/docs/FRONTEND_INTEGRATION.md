# Wiring the Base44 demo to this backend

The exported Base44 app simulates everything locally. This guide replaces each
piece of that local simulation with the API, screen by screen. Nothing about the
layout, styling or component structure needs to change.

## 1. Install the client

Copy both files out of `flowatl-backend/client/` into the front end:

```
client/flowatlClient.js  ->  src/api/flowatlClient.js
client/useFlowATL.js     ->  src/api/useFlowATL.js
```

They have no dependencies beyond React (for the hooks). Point the app at the
backend in `.env.local`:

```
VITE_FLOWATL_API=http://localhost:4000
```

Make sure the backend's `CORS_ORIGINS` includes the Vite dev origin
(`http://localhost:5173` is in `.env.example` already).

## 2. Sign the rider in

`src/lib/AuthContext.jsx` currently talks to a stubbed Base44 `db` object that
always reports "not authenticated", which is why `App.jsx` sits in a redirect
loop. Swap its body for the FlowATL session, or wrap the app in the hook:

```jsx
import { useFlowSession } from '@/api/useFlowATL';

function AuthenticatedApp() {
  const { user, subscription, isLoading } = useFlowSession(); // guest sign-in on first load

  if (isLoading) return <Spinner />;
  return <Routes>{/* unchanged */}</Routes>;
}
```

`useFlowSession` resumes a stored token, falls back to creating a guest account,
and survives a stale token by requesting a fresh one.

## 3. Home screen — `src/pages/Home.jsx`

Three things are faked here.

**The countdown** is `useCountdown()`, a random 2–8 minute timer that resets to
another random value. Replace it with the real arrival for the selected stop:

```jsx
import { useNextArrival } from '@/api/useFlowATL';

const { display, arrival } = useNextArrival(pickup);
// <p className="...">{display}</p>   ->  "03:41", counting down every second
// arrival.shuttleLabel  ->  "FLO-03"
// arrival.availableSeats ->  seats left on the one that is coming
```

`useNextArrival` refreshes from the server every 15 seconds and ticks locally in
between, so the number moves smoothly without hammering the API.

**The stop list** comes from the hardcoded `STOPS` in `src/lib/flowData.js`. You
can leave that file alone — the server returns the same ids, names and `x`/`y`
coordinates — but pulling it from `useRoute()` means the map follows the backend
if the route ever changes:

```jsx
const { route } = useRoute();
const stops = route?.stops ?? STOPS;   // same shape, plus `area` and `depot`
```

**The shuttles on the map** — `src/components/FlowMap.jsx` animates them from a
local `requestAnimationFrame` loop. Feed it real positions instead:

```jsx
import { useLiveShuttles } from '@/api/useFlowATL';

const shuttles = useLiveShuttles();   // SSE, falling back to polling
// each: { id, label, position: { x, y, bearing }, passengers, capacity, status, batteryPct }
```

Render each at `position.x` / `position.y` in the existing viewBox and rotate by
`position.bearing` radians. Interpolate between frames (they arrive every 1.5s)
with a CSS transition on the transform if you want the motion perfectly smooth.

## 4. Booking screen — `src/pages/Booking.jsx`

Currently this computes the fare with local helpers and invents the passenger
count with `Math.floor(Math.random() * 10) + 1`. All of it comes from one quote:

```jsx
import { useRideQuote, useActiveRide } from '@/api/useFlowATL';

const { quote, isLoading } = useRideQuote(pickup, destination);
const { book } = useActiveRide();
```

| Card row | Was | Now |
| --- | --- | --- |
| Estimated arrival | `new Date() + etaMin` | `quote.arrivesAt` |
| Passengers on shuttle | random 1–10 | `quote.shuttle.passengers` / `quote.shuttle.availableSeats` |
| Stops traversed | `stopsBetween(...)` | `quote.stopsTraversed` |
| Fare | `rideCost(...)` | `quote.fareUsd` (and `quote.listFareUsd` struck through for FlowPass) |
| CO₂ saved | `(stops * 1.1).toFixed(1)` | `quote.co2SavedLbs` |
| — | not shown | `quote.savingsUsd` vs `quote.ridehailUsd` — worth surfacing |

Confirming:

```jsx
const ride = await book(pickup, destination);
setConfirmed(true);
// "Your autonomous shuttle is {ride.pickupEtaSeconds / 60 | 0} minutes away"
// QR: ride.boardingPass.qrPayload
```

Feed `ride.boardingPass.qrPayload` into `src/components/QRCode.jsx` in place of
the placeholder so the code encodes the real boarding token.

The **Subscribe** button becomes a real call:

```jsx
await flowatl.subscriptions.subscribe();   // $119/mo; quotes then return fareUsd: 0
```

Handle two errors the local version could not produce: **409** (a ride is already
in progress — `error.details.rideId`) and **503** (`no_capacity`, every shuttle
is full).

## 5. Live ride — `src/pages/LiveRide.jsx`

The whole screen is a 26-second `requestAnimationFrame` animation with phases
derived from a progress fraction and a passenger count that randomly walks up and
down. Replace it with the server's view of the trip:

```jsx
import { useActiveRide } from '@/api/useFlowATL';

const { ride } = useActiveRide();   // pushed live over SSE
if (!ride) return <NoActiveRide />;
```

| UI element | Field |
| --- | --- |
| Status label | `ride.phase` |
| Progress bar segments | `ride.phaseIndex` against `ride.phases` |
| ETA | `ride.etaMinutes` / `ride.etaSeconds` |
| Passengers onboard | `ride.passengersOnboard` (the real count on that vehicle) |
| Percentage | `ride.progressPct` |
| Shuttle on the map | `ride.shuttle.position` |
| Arrival state | `ride.status === 'completed'` |

The existing `PHASES` array can go — `ride.phases` ships the same five labels in
the same order, so the progress bar keeps working.

Note that the ride now takes as long as the shuttle actually takes. For a demo
that needs to finish in under a minute, run the backend with `TIME_SCALE=8`.

## 6. FlowHaul — `src/pages/FlowHaul.jsx`

The `MATCHED` array, the `$38` and the `$110` are all hardcoded. They become a
quote against the live load pool:

```jsx
import { useFreight } from '@/api/useFlowATL';

const { cargoTypes, deliveryWindows, getQuote, confirm, quote, shipment } = useFreight();
```

Populate the two dropdowns from `cargoTypes` and `deliveryWindows` (the labels
are already `Morning 8–12` etc.), then quote as the form changes:

```jsx
await getQuote({ pickupAddress, deliveryAddress, cargoType, weightLbs: Number(weight), windowId });
```

| UI element | Field |
| --- | --- |
| Matched loads list | `quote.matchedLoads` — `businessName`, `cargoType`, `weightLbs`, `sharePct` |
| Destination on each row | `quote.deliveryZone.name` |
| "Your cost" | `quote.priceUsd` |
| "vs. dedicated delivery" | `quote.dedicatedUsd` |
| Savings line | `quote.savingsPct` and `quote.co2SavedLbs` |
| Van fill | `quote.capacityUsedPct` of `quote.vanCapacityLbs` |

Handle the honest case the fixture could not: when nothing else is going that
way, `quote.consolidated` is `false`, `matchedLoads` is empty and the price is
the dedicated quote. Show "No consolidation available for this window" rather
than a fake match.

**Confirm Consolidation** dispatches a van:

```jsx
const shipment = await confirm({ pickupAddress, deliveryAddress, cargoType, weightLbs, windowId });
setStage('tracking');
```

Then track it with `useShipmentTracking(shipment.id)` — `phase`, `phaseIndex`,
`phases`, `progressPct` and `etaMinutes` map onto the existing `FreightTracking`
component exactly like the ride screen. Drive the van icon's `x` from
`shipment.progressPct` instead of the local animation.

## 7. Impact dashboard — `src/pages/Impact.jsx`

The stats object and its 2.2-second increment loop both go away:

```jsx
import { useNetworkImpact, usePersonalImpact } from '@/api/useFlowATL';

const impact = useNetworkImpact();        // pushed every 5s
const { impact: mine } = usePersonalImpact();
```

| Tile | Was | Now |
| --- | --- | --- |
| Rides today | `1284`, +1 every tick | `impact.ridesToday` |
| CO₂ saved today | `942`, +0.7 | `impact.co2SavedLbsToday` |
| Cars removed | `312`, random | `impact.carsRemovedToday` |
| Active shuttles | `18 ± 1` | `impact.activeShuttles` |
| Avg wait | random walk | `impact.averageWaitMinutes` |
| Miles driven | `rides * 1.8` | `impact.fleetMilesToday` |

Personal card: `mine.ridesTaken`, `mine.moneySavedUsd`, `mine.co2SavedLbs`, and
the reward bar from `mine.rewardTier` (`progressPct`, `ridesRemaining`,
`ridesRequired`, `name`).

These start at zero for a new rider and only move when trips actually complete —
which is the point, but worth knowing before a demo. Book and complete a couple
of rides first, or run with `TIME_SCALE` raised.

## 8. What `flowData.js` is still good for

Keep `pointAtDistance`, `pointBetween` and the `pathD` helper if you want to
interpolate shuttle motion between server frames. `rideCost` and `stopsBetween`
are now duplicated by the backend — delete them so there is only one place a fare
can be calculated.

## Running both

```bash
# terminal 1
cd flowatl-backend && npm run dev          # :4000

# terminal 2
npm run dev                                 # :5173
```

For a demo where a full 26-minute lap is too slow:

```bash
TIME_SCALE=6 FLEET_SIZE=8 npm run dev
```
