import { API_URL } from '../config';
import type {
  AuthResponse,
  Completion,
  CompletionResponse,
  Mini,
  Quest,
  QuestFeed,
  Streak,
  User,
} from './types';

/** An error carrying the HTTP status, so screens can tell 401 from 500. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The auth token is held here rather than passed to every call.
 *
 * AuthContext owns the lifecycle and pushes changes in; this keeps request
 * plumbing out of every screen.
 */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Called when the API rejects our token, so the app can drop to the login screen. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const TIMEOUT_MS = 15000;

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const controller = new AbortController();
  // A phone on a dead network otherwise hangs forever with a spinner.
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        // Let fetch set the multipart boundary itself — setting it by hand breaks uploads.
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
    });

    if (res.status === 401) {
      onUnauthorized?.();
      throw new ApiError('Your session expired — sign in again', 401);
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('That took too long — check your connection', 0);
    }
    // fetch rejects with a bare TypeError when the host is unreachable, which
    // is by far the most common failure in development.
    throw new ApiError(`Cannot reach the server at ${API_URL}`, 0);
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  register: (input: {
    email: string;
    username: string;
    password: string;
    displayName: string;
    timezone: string;
    city?: string | null;
  }) => request<AuthResponse>('/auth/register', { method: 'POST', body: input }),

  login: (input: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: input }),

  me: () => request<{ user: User; streak: Streak; stats: { completions: number; categoriesExplored: number } }>('/me'),

  quests: (params: { category?: string; cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.category) q.set('category', params.category);
    if (params.cursor) q.set('cursor', params.cursor);
    q.set('limit', String(params.limit ?? 20));
    return request<QuestFeed>(`/quests?${q.toString()}`);
  },

  quest: (id: string) =>
    request<{ quest: Quest; stats: { completions: number; avgRating: number | null } }>(
      `/quests/${id}`,
    ),

  myCompletions: (cursor?: string) =>
    request<{ completions: Completion[]; nextCursor: string | null }>(
      `/me/completions${cursor ? `?cursor=${cursor}` : ''}`,
    ),

  streak: () => request<Streak & { history: { day: string; count: number }[] }>('/me/streak'),

  minisToday: () => request<{ day: string; minis: Mini[]; completed: number }>('/minis/today'),

  completeMini: (assignmentId: string, note?: string) =>
    request<{ mini: Mini; milestone: number | null }>(`/minis/${assignmentId}/complete`, {
      method: 'POST',
      body: { note },
    }),

  completeQuest: (input: {
    questId: string;
    rating: number;
    review?: string;
    photoUri: string;
  }) => {
    const form = new FormData();
    form.append('questId', input.questId);
    form.append('rating', String(input.rating));
    if (input.review) form.append('review', input.review);
    // React Native's FormData takes this shape for files; it is not a Blob.
    form.append('photo', {
      uri: input.photoUri,
      name: 'completion.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    return request<CompletionResponse>('/completions', { method: 'POST', formData: form });
  },
};
