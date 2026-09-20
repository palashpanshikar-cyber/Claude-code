import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/server.js';
import { createServices, type Services } from '../src/services.js';
import { openDatabase } from '../src/store/db.js';

let services: Services;
let server: Server;
let baseUrl: string;

interface CallResult<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<CallResult<T>> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...rest, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const json = (value: unknown) => JSON.stringify(value);

before(async () => {
  services = createServices({
    db: openDatabase(':memory:'),
    simulation: { fleetSize: 4, capacity: 12, seed: 8080 },
  });
  const app = createApp(services, { quiet: true });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  services.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('health and network', () => {
  it('reports healthy with a running fleet', async () => {
    const { status, body } = await call('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.fleet.size, 4);
  });

  it('serves the route the client draws', async () => {
    const { status, body } = await call('/api/network/route');
    assert.equal(status, 200);
    assert.equal(body.route.stops.length, 6);
    assert.equal(body.route.segments.length, 6);
    assert.ok(body.route.pathD.startsWith('M'));
    assert.ok(body.route.loopMiles > 0);
  });

  it('serves live shuttle positions', async () => {
    const { body } = await call('/api/network/shuttles');
    assert.equal(body.shuttles.length, 4);
    for (const shuttle of body.shuttles) {
      assert.ok(shuttle.position.x >= 0 && shuttle.position.y >= 0);
      assert.ok(shuttle.passengers <= shuttle.capacity);
      assert.ok(['in_service', 'dwelling', 'charging'].includes(shuttle.status));
    }
  });

  it('counts down the next shuttle at a stop', async () => {
    const { body } = await call('/api/network/stops/five-points/arrivals?limit=2');
    assert.equal(body.stopId, 'five-points');
    assert.ok(body.arrivals.length <= 2);
    assert.ok(body.nextArrival.etaSeconds >= 0);
  });

  it('404s an unknown stop', async () => {
    const { status, body } = await call('/api/network/stops/mars/arrivals');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  });

  it('404s an unknown route', async () => {
    const { status, body } = await call('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  });
});

describe('the booking flow', () => {
  let token: string;

  it('signs a rider in as a guest', async () => {
    const { status, body } = await call('/api/auth/guest', { method: 'POST', body: json({}) });
    assert.equal(status, 201);
    assert.ok(body.token);
    assert.ok(body.user.id.startsWith('user_'));
    token = body.token;
  });

  it('quotes a trip without an account', async () => {
    const { status, body } = await call('/api/rides/quote', {
      method: 'POST',
      body: json({ pickupStopId: 'five-points', destinationStopId: 'aquarium' }),
    });
    assert.equal(status, 200);
    assert.equal(body.quote.stopsTraversed, 2);
    assert.equal(body.quote.fareUsd, 1.5);
    assert.ok(body.quote.co2SavedLbs > 0);
    assert.ok(body.quote.ridehailUsd > body.quote.fareUsd);
    assert.ok(body.quote.pickupEtaMinutes >= 1);
  });

  it('rejects an unknown stop', async () => {
    const { status, body } = await call('/api/rides/quote', {
      method: 'POST',
      body: json({ pickupStopId: 'atlantis', destinationStopId: 'aquarium' }),
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'validation_failed');
    assert.equal(body.error.details[0].path, 'pickupStopId');
  });

  it('requires a signed-in rider to book', async () => {
    const { status, body } = await call('/api/rides', {
      method: 'POST',
      body: json({ pickupStopId: 'five-points', destinationStopId: 'aquarium' }),
    });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'unauthorized');
  });

  let rideId: string;

  it('books a ride and issues a boarding pass', async () => {
    const { status, body } = await call('/api/rides', {
      method: 'POST',
      token,
      body: json({ pickupStopId: 'five-points', destinationStopId: 'aquarium' }),
    });
    assert.equal(status, 201);
    assert.equal(body.ride.status, 'awaiting_pickup');
    assert.ok(body.ride.boardingPass.token);
    assert.ok(body.ride.shuttle.label.startsWith('FLO-'));
    rideId = body.ride.id;
  });

  it('exposes the ride as the active one', async () => {
    const { body } = await call('/api/rides/active', { token });
    assert.equal(body.ride.id, rideId);
  });

  it('refuses a second concurrent booking', async () => {
    const { status, body } = await call('/api/rides', {
      method: 'POST',
      token,
      body: json({ pickupStopId: 'benz', destinationStopId: 'castleberry' }),
    });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'conflict');
    assert.equal(body.error.details.rideId, rideId);
  });

  it('hides a ride from another account', async () => {
    const other = await call('/api/auth/guest', { method: 'POST', body: json({}) });
    const { status, body } = await call(`/api/rides/${rideId}`, { token: other.body.token });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'forbidden');
  });

  it('cancels the ride', async () => {
    const { status, body } = await call(`/api/rides/${rideId}/cancel`, { method: 'POST', token });
    assert.equal(status, 200);
    assert.equal(body.ride.status, 'cancelled');
    const active = await call('/api/rides/active', { token });
    assert.equal(active.body.ride, null);
  });

  it('lists the rider\'s history', async () => {
    const { body } = await call('/api/rides?limit=10', { token });
    assert.equal(body.rides.length, 1);
    assert.equal(body.rides[0].id, rideId);
  });
});

describe('accounts and FlowPass', () => {
  let token: string;

  before(async () => {
    const { body } = await call('/api/auth/register', {
      method: 'POST',
      body: json({
        email: 'pass-holder@test.flowatl',
        password: 'correct horse battery',
        displayName: 'Pass Holder',
      }),
    });
    token = body.token;
  });

  it('rejects a weak password', async () => {
    const { status, body } = await call('/api/auth/register', {
      method: 'POST',
      body: json({ email: 'short@test.flowatl', password: 'abc' }),
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'validation_failed');
  });

  it('rejects a duplicate email', async () => {
    const { status, body } = await call('/api/auth/register', {
      method: 'POST',
      body: json({ email: 'pass-holder@test.flowatl', password: 'correct horse battery' }),
    });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'conflict');
  });

  it('rejects a bad password without saying which part was wrong', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      body: json({ email: 'pass-holder@test.flowatl', password: 'not the password' }),
    });
    assert.equal(status, 401);
    assert.equal(body.error.message, 'Incorrect email or password');
  });

  it('logs in with the right password', async () => {
    const { status, body } = await call('/api/auth/login', {
      method: 'POST',
      body: json({ email: 'pass-holder@test.flowatl', password: 'correct horse battery' }),
    });
    assert.equal(status, 200);
    assert.ok(body.token);
  });

  it('publishes the FlowPass price', async () => {
    const { body } = await call('/api/subscriptions/plans');
    assert.equal(body.plans[0].priceUsd, 119);
    assert.equal(body.plans[0].interval, 'month');
  });

  it('subscribes and waives the fare', async () => {
    const created = await call('/api/subscriptions', { method: 'POST', token });
    assert.equal(created.status, 201);
    assert.equal(created.body.subscription.status, 'active');

    const { body } = await call('/api/rides/quote', {
      method: 'POST',
      token,
      body: json({ pickupStopId: 'five-points', destinationStopId: 'castleberry' }),
    });
    assert.equal(body.quote.fareUsd, 0);
    assert.ok(body.quote.listFareUsd > 0);
    assert.ok(body.quote.coveredBySubscription);
  });

  it('refuses to subscribe twice', async () => {
    const { status } = await call('/api/subscriptions', { method: 'POST', token });
    assert.equal(status, 409);
  });

  it('invalidates the token on logout', async () => {
    const { body } = await call('/api/auth/guest', { method: 'POST', body: json({}) });
    const temp = body.token;
    assert.equal((await call('/api/auth/me', { token: temp })).status, 200);
    assert.equal((await call('/api/auth/logout', { method: 'POST', token: temp })).status, 204);
    assert.equal((await call('/api/auth/me', { token: temp })).status, 401);
  });
});

describe('FlowHaul', () => {
  let token: string;

  before(async () => {
    const { body } = await call('/api/auth/register', {
      method: 'POST',
      body: json({
        email: 'shipper@test.flowatl',
        password: 'correct horse battery',
        businessName: 'Marietta St Diner',
      }),
    });
    token = body.token;
  });

  it('serves the form options', async () => {
    const { body } = await call('/api/freight/options');
    assert.equal(body.cargoTypes.length, 5);
    assert.equal(body.deliveryWindows.length, 3);
    assert.equal(body.vanCapacityLbs, 2000);
  });

  const shipment = {
    pickupAddress: '123 Marietta St NW',
    deliveryAddress: '1180 Peachtree St NE, Midtown',
    cargoType: 'Restaurant Supplies',
    weightLbs: 150,
    windowId: 'morning',
  };

  it('quotes a consolidated run against real open loads', async () => {
    const { status, body } = await call('/api/freight/quote', {
      method: 'POST',
      body: json(shipment),
    });
    assert.equal(status, 200);
    assert.ok(body.quote.matchedLoads.length >= 1);
    assert.ok(body.quote.priceUsd < body.quote.dedicatedUsd);
    assert.ok(body.quote.savingsPct > 0);
    assert.equal(body.quote.deliveryZone.id, 'midtown');
  });

  it('rejects cargo that will not fit in a van', async () => {
    const { status, body } = await call('/api/freight/quote', {
      method: 'POST',
      body: json({ ...shipment, weightLbs: 9000 }),
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'validation_failed');
  });

  it('rejects an unknown cargo type', async () => {
    const { status } = await call('/api/freight/quote', {
      method: 'POST',
      body: json({ ...shipment, cargoType: 'Live Animals' }),
    });
    assert.equal(status, 400);
  });

  let shipmentId: string;

  it('confirms consolidation and dispatches a van', async () => {
    const { status, body } = await call('/api/freight/shipments', {
      method: 'POST',
      token,
      body: json(shipment),
    });
    assert.equal(status, 201);
    assert.match(body.shipment.vanLabel, /^FH-\d\d$/);
    assert.equal(body.shipment.phase, 'Dispatched');
    assert.ok(body.shipment.loads.some((load: any) => load.isYours));
    assert.ok(body.shipment.loads.length >= 2, 'the van should carry more than one load');
    shipmentId = body.shipment.id;
  });

  it('tracks the shipment', async () => {
    const { body } = await call(`/api/freight/shipments/${shipmentId}`, { token });
    assert.equal(body.shipment.id, shipmentId);
    assert.ok(body.shipment.phases.includes('Delivered'));
    assert.ok(body.shipment.etaMinutes >= 0);
  });

  it('hides a shipment from another business', async () => {
    const other = await call('/api/auth/guest', { method: 'POST', body: json({}) });
    const { status } = await call(`/api/freight/shipments/${shipmentId}`, {
      token: other.body.token,
    });
    assert.equal(status, 403);
  });

  it('lists the business\'s shipments', async () => {
    const { body } = await call('/api/freight/shipments', { token });
    assert.equal(body.shipments.length, 1);
    assert.equal(body.shipments[0].id, shipmentId);
  });
});

describe('impact', () => {
  it('reports network numbers for today', async () => {
    const { status, body } = await call('/api/impact/network');
    assert.equal(status, 200);
    assert.ok(body.impact.ridesToday > 0);
    assert.ok(body.impact.co2SavedLbsToday > 0);
    assert.ok(body.impact.carsRemovedToday > 0);
    assert.equal(body.impact.fleetSize, 4);
    assert.ok(body.impact.averageWaitMinutes > 0);
    assert.ok(body.impact.freightLoadsToday >= 1, 'the confirmed shipment should be counted');
  });

  it('keeps counters moving forward', async () => {
    const first = (await call('/api/impact/network')).body.impact;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = (await call('/api/impact/network')).body.impact;
    assert.ok(second.ridesToday >= first.ridesToday);
    assert.ok(second.fleetMilesToday >= first.fleetMilesToday);
  });

  it('requires a rider for personal impact', async () => {
    assert.equal((await call('/api/impact/me')).status, 401);
  });

  it('starts a new rider at zero', async () => {
    const { body: auth } = await call('/api/auth/guest', { method: 'POST', body: json({}) });
    const { body } = await call('/api/impact/me', { token: auth.token });
    assert.equal(body.impact.ridesTaken, 0);
    assert.equal(body.impact.co2SavedLbs, 0);
    assert.equal(body.impact.rewardTier.name, 'Commuter');
  });
});

describe('the live stream', () => {
  it('pushes shuttle positions over SSE', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/stream?topics=shuttles`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // Read until the first shuttles frame arrives.
    while (!buffer.includes('event: shuttles')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    controller.abort();

    assert.ok(buffer.includes('event: ready'));
    assert.ok(buffer.includes('event: shuttles'));
    const line = buffer.split('\n').find((l) => l.startsWith('data: {"generatedAt'));
    assert.ok(line, 'the shuttles frame should carry a JSON payload');
    const payload = JSON.parse(line.slice(6));
    assert.equal(payload.shuttles.length, 4);
  });
});
