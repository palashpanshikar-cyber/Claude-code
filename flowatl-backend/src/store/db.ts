import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

export type Db = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user',
  business_name  TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  price_cents          INTEGER NOT NULL,
  started_at           INTEGER NOT NULL,
  current_period_end   INTEGER NOT NULL,
  cancelled_at         INTEGER
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS rides (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_stop_id          TEXT NOT NULL,
  destination_stop_id     TEXT NOT NULL,
  shuttle_id              TEXT,
  shuttle_label           TEXT,
  status                  TEXT NOT NULL,
  stops_traversed         INTEGER NOT NULL,
  miles                   REAL NOT NULL,
  fare_cents              INTEGER NOT NULL,
  list_fare_cents         INTEGER NOT NULL,
  ridehail_cents          INTEGER NOT NULL,
  co2_saved_lbs           REAL NOT NULL,
  covered_by_subscription INTEGER NOT NULL DEFAULT 0,
  boarding_token          TEXT NOT NULL,
  service_date            TEXT NOT NULL,
  booked_at               INTEGER NOT NULL,
  pickup_eta_at           INTEGER,
  boarded_at              INTEGER,
  completed_at            INTEGER,
  cancelled_at            INTEGER
);
CREATE INDEX IF NOT EXISTS rides_user_idx ON rides(user_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides(status);
CREATE INDEX IF NOT EXISTS rides_shuttle_idx ON rides(shuttle_id, status);

CREATE TABLE IF NOT EXISTS freight_shipments (
  id             TEXT PRIMARY KEY,
  van_label      TEXT NOT NULL,
  delivery_zone  TEXT NOT NULL,
  window_id      TEXT NOT NULL,
  status         TEXT NOT NULL,
  miles          REAL NOT NULL,
  co2_saved_lbs  REAL NOT NULL,
  service_date   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  dispatched_at  INTEGER,
  delivered_at   INTEGER
);
CREATE INDEX IF NOT EXISTS shipments_status_idx ON freight_shipments(status);

CREATE TABLE IF NOT EXISTS freight_loads (
  id               TEXT PRIMARY KEY,
  user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  shipment_id      TEXT REFERENCES freight_shipments(id) ON DELETE SET NULL,
  business_name    TEXT NOT NULL,
  pickup_address   TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  pickup_zone      TEXT NOT NULL,
  delivery_zone    TEXT NOT NULL,
  cargo_type       TEXT NOT NULL,
  weight_lbs       REAL NOT NULL,
  window_id        TEXT NOT NULL,
  status           TEXT NOT NULL,
  price_cents      INTEGER,
  dedicated_cents  INTEGER,
  co2_saved_lbs    REAL,
  notes            TEXT,
  service_date     TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  confirmed_at     INTEGER,
  cancelled_at     INTEGER
);
CREATE INDEX IF NOT EXISTS loads_open_idx ON freight_loads(status, delivery_zone, window_id);
CREATE INDEX IF NOT EXISTS loads_user_idx ON freight_loads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loads_shipment_idx ON freight_loads(shipment_id);

CREATE TABLE IF NOT EXISTS daily_counters (
  service_date    TEXT PRIMARY KEY,
  rides           INTEGER NOT NULL DEFAULT 0,
  booked_rides    INTEGER NOT NULL DEFAULT 0,
  co2_saved_lbs   REAL NOT NULL DEFAULT 0,
  fleet_miles     REAL NOT NULL DEFAULT 0,
  passenger_miles REAL NOT NULL DEFAULT 0,
  energy_kwh      REAL NOT NULL DEFAULT 0,
  savings_cents   INTEGER NOT NULL DEFAULT 0,
  freight_loads   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
`;

let instance: Db | null = null;

export function openDatabase(path: string = config.databasePath): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

/** Process-wide handle. Tests create their own with `openDatabase(':memory:')`. */
export function getDb(): Db {
  if (!instance) instance = openDatabase();
  return instance;
}

export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

export function usd(cents: number): number {
  return Math.round(cents) / 100;
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
