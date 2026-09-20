import { z } from 'zod';
import { CARGO_TYPES, VAN_CAPACITY_LBS } from '../domain/freight.js';
import { isStopId } from '../domain/network.js';
import { DELIVERY_WINDOWS } from '../domain/zones.js';

const stopId = z.string().refine(isStopId, {
  message: 'Unknown stop id',
});

export const tripSchema = z.object({
  pickupStopId: stopId,
  destinationStopId: stopId,
});

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

export const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
  businessName: z.string().trim().min(1).max(120).optional(),
});

export const guestSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
});

const windowIds = DELIVERY_WINDOWS.map((w) => w.id) as [string, ...string[]];

export const freightQuoteSchema = z.object({
  pickupAddress: z.string().trim().min(4, 'Enter a pickup address').max(200),
  deliveryAddress: z.string().trim().min(4, 'Enter a delivery address').max(200),
  cargoType: z.enum(CARGO_TYPES),
  weightLbs: z
    .number()
    .positive('Cargo weight must be greater than zero')
    .max(VAN_CAPACITY_LBS, `A FlowHaul van tops out at ${VAN_CAPACITY_LBS} lbs`),
  windowId: z.enum(windowIds),
});

export const freightConfirmSchema = freightQuoteSchema.extend({
  businessName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
