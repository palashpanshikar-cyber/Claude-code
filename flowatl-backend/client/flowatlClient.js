/**
 * FlowATL API client.
 *
 * Drop this into the Base44 app (e.g. `src/api/flowatlClient.js`) and point
 * VITE_FLOWATL_API at the backend. It has no dependencies and works in any
 * browser or Node 18+ runtime.
 *
 *   import { flowatl } from '@/api/flowatlClient';
 *
 *   await flowatl.auth.guest();
 *   const { route } = await flowatl.network.route();
 *   const stop = flowatl.network.stream(['shuttles'], (event, data) => { ... });
 */

const DEFAULT_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FLOWATL_API) ||
  'http://localhost:4000';

const TOKEN_STORAGE_KEY = 'flowatl.token';

class FlowATLError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'FlowATLError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readStoredToken() {
  try {
    return globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    // Private browsing and SSR both end up here; a session in memory still works.
    return null;
  }
}

function writeStoredToken(token) {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function createFlowATLClient({ baseUrl = DEFAULT_BASE_URL, token = null } = {}) {
  let authToken = token ?? readStoredToken();
  const listeners = new Set();

  function setToken(next, { persist = true } = {}) {
    authToken = next;
    if (persist) writeStoredToken(next);
    for (const listener of listeners) listener(next);
  }

  async function request(path, { method = 'GET', body, auth = false, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authToken && auth !== false) headers.authorization = `Bearer ${authToken}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (response.status === 204) return null;

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = payload?.error ?? {};
      // An expired or revoked session should not keep being retried.
      if (response.status === 401) setToken(null);
      throw new FlowATLError(
        response.status,
        error.code ?? 'request_failed',
        error.message ?? `Request failed with ${response.status}`,
        error.details,
      );
    }
    return payload;
  }

  function captureSession(result) {
    if (result?.token) setToken(result.token);
    return result;
  }

  return {
    baseUrl,
    get token() {
      return authToken;
    },
    setToken,
    /** Notified whenever the session token changes. Returns an unsubscribe fn. */
    onTokenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAuthenticated() {
      return Boolean(authToken);
    },

    auth: {
      register: (input) =>
        request('/api/auth/register', { method: 'POST', body: input }).then(captureSession),
      login: (email, password) =>
        request('/api/auth/login', { method: 'POST', body: { email, password } }).then(
          captureSession,
        ),
      /** Password-free demo sign-in. Disabled when the server runs in production. */
      guest: (email) =>
        request('/api/auth/guest', { method: 'POST', body: email ? { email } : {} }).then(
          captureSession,
        ),
      me: () => request('/api/auth/me', { auth: true }),
      async logout() {
        try {
          await request('/api/auth/logout', { method: 'POST', auth: true });
        } finally {
          setToken(null);
        }
      },
    },

    network: {
      /** Stops, loop geometry and the SVG path for the map. */
      route: () => request('/api/network/route'),
      stops: () => request('/api/network/stops'),
      arrivals: (stopId, limit = 3) =>
        request(`/api/network/stops/${encodeURIComponent(stopId)}/arrivals?limit=${limit}`),
      shuttles: () => request('/api/network/shuttles'),
      status: () => request('/api/network/status'),
    },

    rides: {
      quote: (pickupStopId, destinationStopId) =>
        request('/api/rides/quote', {
          method: 'POST',
          auth: true,
          body: { pickupStopId, destinationStopId },
        }),
      book: (pickupStopId, destinationStopId) =>
        request('/api/rides', {
          method: 'POST',
          auth: true,
          body: { pickupStopId, destinationStopId },
        }),
      active: () => request('/api/rides/active', { auth: true }),
      get: (rideId) => request(`/api/rides/${encodeURIComponent(rideId)}`, { auth: true }),
      cancel: (rideId) =>
        request(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
          method: 'POST',
          auth: true,
        }),
      history: (limit = 25) => request(`/api/rides?limit=${limit}`, { auth: true }),
    },

    subscriptions: {
      plans: () => request('/api/subscriptions/plans'),
      mine: () => request('/api/subscriptions/me', { auth: true }),
      subscribe: () => request('/api/subscriptions', { method: 'POST', auth: true }),
      cancel: () => request('/api/subscriptions/cancel', { method: 'POST', auth: true }),
    },

    freight: {
      options: () => request('/api/freight/options'),
      openLoads: (limit = 20) => request(`/api/freight/loads?limit=${limit}`),
      quote: (input) => request('/api/freight/quote', { method: 'POST', auth: true, body: input }),
      confirm: (input) =>
        request('/api/freight/shipments', { method: 'POST', auth: true, body: input }),
      shipment: (shipmentId) =>
        request(`/api/freight/shipments/${encodeURIComponent(shipmentId)}`, { auth: true }),
      shipments: (limit = 20) => request(`/api/freight/shipments?limit=${limit}`, { auth: true }),
    },

    impact: {
      network: () => request('/api/impact/network'),
      me: () => request('/api/impact/me', { auth: true }),
    },

    /**
     * Subscribe to live server-sent events.
     *
     *   const stop = flowatl.stream(['shuttles', 'ride'], (event, data) => {...});
     *   stop();
     *
     * Topics: shuttles, impact, ride, freight. The last two need a session.
     */
    stream(topics, onEvent, { onError } = {}) {
      const params = new URLSearchParams({ topics: topics.join(',') });
      // EventSource cannot send an Authorization header, so the token rides
      // along in the query string on this endpoint only.
      if (authToken) params.set('token', authToken);

      const source = new EventSource(`${baseUrl}/api/stream?${params}`);
      const handlers = [];
      for (const name of ['ready', ...topics]) {
        const handler = (message) => {
          try {
            onEvent(name, JSON.parse(message.data));
          } catch (error) {
            onError?.(error);
          }
        };
        source.addEventListener(name, handler);
        handlers.push([name, handler]);
      }
      if (onError) source.addEventListener('error', onError);

      return () => {
        for (const [name, handler] of handlers) source.removeEventListener(name, handler);
        source.close();
      };
    },
  };
}

export const flowatl = createFlowATLClient();
export { FlowATLError };
export default flowatl;
