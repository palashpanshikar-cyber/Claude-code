/** FlowPass: $119/month for unlimited rides on the network. */

import { now } from '../lib/clock.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { SUBSCRIPTION_PRICE_USD } from './pricing.js';
import { toCents, usd, type Db } from '../store/db.js';

export const FLOWPASS_PLAN = 'flowpass-monthly';
const PERIOD_DAYS = 30;

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  price_cents: number;
  started_at: number;
  current_period_end: number;
  cancelled_at: number | null;
}

export interface Subscription {
  id: string;
  plan: string;
  status: 'active' | 'cancelled' | 'expired';
  priceUsd: number;
  startedAt: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
}

function toView(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    plan: row.plan,
    status: row.status as Subscription['status'],
    priceUsd: usd(row.price_cents),
    startedAt: new Date(row.started_at).toISOString(),
    currentPeriodEnd: new Date(row.current_period_end).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
  };
}

export class SubscriptionService {
  constructor(private readonly db: Db) {}

  /** The user's subscription if it is still within its paid period. */
  active(userId: string, at: number = now()): Subscription | null {
    const row = this.db
      .prepare(
        `SELECT * FROM subscriptions
          WHERE user_id = ? AND status = 'active' AND current_period_end > ?
          ORDER BY started_at DESC LIMIT 1`,
      )
      .get(userId, at) as SubscriptionRow | undefined;
    return row ? toView(row) : null;
  }

  hasActive(userId: string, at: number = now()): boolean {
    return this.active(userId, at) !== null;
  }

  subscribe(userId: string, at: number = now()): Subscription {
    const existing = this.active(userId, at);
    if (existing) throw ApiError.conflict('This account already has an active FlowPass');

    const row: SubscriptionRow = {
      id: newId('sub'),
      user_id: userId,
      plan: FLOWPASS_PLAN,
      status: 'active',
      price_cents: toCents(SUBSCRIPTION_PRICE_USD),
      started_at: at,
      current_period_end: at + PERIOD_DAYS * 24 * 60 * 60 * 1000,
      cancelled_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan, status, price_cents, started_at, current_period_end, cancelled_at)
         VALUES (@id, @user_id, @plan, @status, @price_cents, @started_at, @current_period_end, @cancelled_at)`,
      )
      .run(row);
    return toView(row);
  }

  /** Cancel at period end — the rider keeps unlimited rides until then. */
  cancel(userId: string, at: number = now()): Subscription {
    const current = this.active(userId, at);
    if (!current) throw ApiError.notFound('No active FlowPass on this account');
    this.db
      .prepare(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
      .run(at, current.id);
    return { ...current, status: 'cancelled', cancelledAt: new Date(at).toISOString() };
  }

  history(userId: string): Subscription[] {
    const rows = this.db
      .prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY started_at DESC')
      .all(userId) as SubscriptionRow[];
    return rows.map(toView);
  }
}
