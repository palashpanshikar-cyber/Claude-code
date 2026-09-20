/**
 * React hooks over the FlowATL client — one per screen in the demo app.
 *
 * Drop alongside `flowatlClient.js` (e.g. `src/api/useFlowATL.js`). Everything
 * here degrades to polling; if the browser supports EventSource the live hooks
 * upgrade to the server's push stream automatically.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flowatl } from './flowatlClient';

/** Generic fetch-once hook with a manual refresh. */
export function useApi(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const result = await loaderRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, isLoading, reload };
}

/** Signs in as a guest on first load so the demo opens straight into a session. */
export function useFlowSession({ autoGuest = true } = {}) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (flowatl.isAuthenticated()) {
          const me = await flowatl.auth.me();
          if (!cancelled) setSession(me);
        } else if (autoGuest) {
          const guest = await flowatl.auth.guest();
          if (!cancelled) setSession({ user: guest.user, subscription: null });
        }
      } catch {
        // A stale token is cleared by the client; fall back to a fresh guest.
        if (autoGuest && !cancelled) {
          try {
            const guest = await flowatl.auth.guest();
            if (!cancelled) setSession({ user: guest.user, subscription: null });
          } catch {
            /* leave the session null and let the UI prompt for sign-in */
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoGuest]);

  return { session, user: session?.user ?? null, subscription: session?.subscription ?? null, isLoading };
}

/** The route the map draws. Static for the life of the app. */
export function useRoute() {
  const { data, ...rest } = useApi(() => flowatl.network.route());
  return { route: data?.route ?? null, ...rest };
}

/**
 * Live shuttle positions. Uses the SSE stream when available and falls back to
 * polling, so the map animates either way.
 */
export function useLiveShuttles({ pollMs = 2000 } = {}) {
  const [shuttles, setShuttles] = useState([]);

  useEffect(() => {
    let stopStream;
    let timer;

    if (typeof EventSource !== 'undefined') {
      stopStream = flowatl.stream(['shuttles'], (event, payload) => {
        if (event === 'shuttles') setShuttles(payload.shuttles);
      });
    } else {
      const poll = async () => {
        try {
          const { shuttles: next } = await flowatl.network.shuttles();
          setShuttles(next);
        } catch {
          /* keep the last good positions on a blip */
        }
      };
      poll();
      timer = setInterval(poll, pollMs);
    }

    return () => {
      stopStream?.();
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);

  return shuttles;
}

/** The "Next Shuttle" countdown for a stop, refreshed every second locally. */
export function useNextArrival(stopId, { refreshMs = 15000 } = {}) {
  const [arrival, setArrival] = useState(null);
  const [secondsAway, setSecondsAway] = useState(null);

  useEffect(() => {
    if (!stopId) return undefined;
    let cancelled = false;

    const fetchArrival = async () => {
      try {
        const { nextArrival } = await flowatl.network.arrivals(stopId, 1);
        if (cancelled) return;
        setArrival(nextArrival);
        setSecondsAway(nextArrival?.etaSeconds ?? null);
      } catch {
        /* keep counting down from the last known value */
      }
    };

    fetchArrival();
    const refresh = setInterval(fetchArrival, refreshMs);
    // Tick locally between refreshes so the display moves every second.
    const tick = setInterval(() => {
      setSecondsAway((current) => (current === null ? null : Math.max(0, current - 1)));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [stopId, refreshMs]);

  const minutes = secondsAway === null ? null : Math.floor(secondsAway / 60);
  const seconds = secondsAway === null ? null : secondsAway % 60;
  return {
    arrival,
    secondsAway,
    /** "04:12", ready to render. */
    display:
      secondsAway === null
        ? '--:--'
        : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  };
}

/** Prices a trip whenever the rider changes either end of it. */
export function useRideQuote(pickupStopId, destinationStopId) {
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!pickupStopId || !destinationStopId || pickupStopId === destinationStopId) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    setIsLoading(true);
    flowatl.rides
      .quote(pickupStopId, destinationStopId)
      .then((result) => {
        if (!cancelled) {
          setQuote(result.quote);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickupStopId, destinationStopId]);

  return { quote, error, isLoading };
}

/** The rider's trip in progress, pushed live. Drives the live-ride screen. */
export function useActiveRide({ pollMs = 2000 } = {}) {
  const [ride, setRide] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let stopStream;
    let timer;
    let cancelled = false;

    const apply = (next) => {
      if (cancelled) return;
      setRide(next);
      setIsLoading(false);
    };

    flowatl.rides
      .active()
      .then(({ ride: current }) => apply(current))
      .catch(() => apply(null));

    if (typeof EventSource !== 'undefined') {
      stopStream = flowatl.stream(['ride'], (event, payload) => {
        if (event === 'ride') apply(payload.ride);
      });
    } else {
      timer = setInterval(() => {
        flowatl.rides
          .active()
          .then(({ ride: current }) => apply(current))
          .catch(() => {});
      }, pollMs);
    }

    return () => {
      cancelled = true;
      stopStream?.();
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);

  const book = useCallback(async (pickupStopId, destinationStopId) => {
    const { ride: booked } = await flowatl.rides.book(pickupStopId, destinationStopId);
    setRide(booked);
    return booked;
  }, []);

  const cancel = useCallback(async () => {
    if (!ride) return null;
    const { ride: cancelled } = await flowatl.rides.cancel(ride.id);
    setRide(null);
    return cancelled;
  }, [ride]);

  return { ride, isLoading, book, cancel };
}

/** Network-wide impact numbers, pushed every few seconds. */
export function useNetworkImpact({ pollMs = 5000 } = {}) {
  const [impact, setImpact] = useState(null);

  useEffect(() => {
    let stopStream;
    let timer;

    if (typeof EventSource !== 'undefined') {
      stopStream = flowatl.stream(['impact'], (event, payload) => {
        if (event === 'impact') setImpact(payload.impact);
      });
    } else {
      const poll = () =>
        flowatl.impact
          .network()
          .then(({ impact: next }) => setImpact(next))
          .catch(() => {});
      poll();
      timer = setInterval(poll, pollMs);
    }

    return () => {
      stopStream?.();
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);

  return impact;
}

export function usePersonalImpact() {
  const { data, ...rest } = useApi(() => flowatl.impact.me());
  return { impact: data?.impact ?? null, ...rest };
}

/** FlowHaul: form options, quoting and confirming a consolidated run. */
export function useFreight() {
  const { data: options } = useApi(() => flowatl.freight.options());
  const [quote, setQuote] = useState(null);
  const [shipment, setShipment] = useState(null);
  const [error, setError] = useState(null);
  const [isWorking, setIsWorking] = useState(false);

  const getQuote = useCallback(async (input) => {
    setIsWorking(true);
    setError(null);
    try {
      const { quote: next } = await flowatl.freight.quote(input);
      setQuote(next);
      return next;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsWorking(false);
    }
  }, []);

  const confirm = useCallback(async (input) => {
    setIsWorking(true);
    setError(null);
    try {
      const { shipment: next } = await flowatl.freight.confirm(input);
      setShipment(next);
      return next;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsWorking(false);
    }
  }, []);

  return {
    cargoTypes: options?.cargoTypes ?? [],
    deliveryWindows: options?.deliveryWindows ?? [],
    vanCapacityLbs: options?.vanCapacityLbs ?? 2000,
    quote,
    shipment,
    error,
    isWorking,
    getQuote,
    confirm,
  };
}

/** Polls one freight shipment so the tracking screen advances. */
export function useShipmentTracking(shipmentId, { pollMs = 3000 } = {}) {
  const [shipment, setShipment] = useState(null);

  useEffect(() => {
    if (!shipmentId) return undefined;
    let cancelled = false;
    const poll = () =>
      flowatl.freight
        .shipment(shipmentId)
        .then(({ shipment: next }) => {
          if (!cancelled) setShipment(next);
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [shipmentId, pollMs]);

  return shipment;
}
