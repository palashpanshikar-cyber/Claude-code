# SideQuest mobile

Expo (React Native) client for the SideQuest API.

## Running it

The API must be running first — see `../api`.

```bash
npm install
npm start
```

Then scan the QR code with Expo Go, or press `i` / `a` for a simulator.

## Pointing it at the API

By default the app talks to **port 3000 on whichever host served the Expo
bundle**. On a real phone that's your laptop's LAN address, which is the one
thing that works without configuration — `localhost` from a phone means the
phone itself, so it can never reach your machine.

Your laptop and phone must be on the same network, and the API has to be
reachable from it. If your firewall blocks inbound 3000, either allow it or use
a tunnel.

To point somewhere else — a deployed API, or an ngrok tunnel:

```bash
EXPO_PUBLIC_API_URL=https://your-api.example.com npm start
```

## What's built

Backlog items 61–68, plus enough screens to prove the loop:

- Bottom-tab navigation, gated on auth state
- Typed API client with timeouts, 401 handling and readable network errors
- JWT in the device keychain via `expo-secure-store` — **not** AsyncStorage,
  which is unencrypted
- Auth context that restores the session on launch and drops it on any 401
- React Query for caching, pull-to-refresh and infinite scroll
- Login and signup screens
- Quest feed: streak header, today's minis, category filters, infinite scroll
- Profile: stats and a completion grid

## Not built yet

The completion flow (camera, review, rating — backlog 81–88) is the big gap:
you can browse quests but not log one from the app. `expo-image-picker` is
installed ready for it, and `api.completeQuest()` already handles the multipart
upload.

Also missing: quest detail screen, mini completion from the UI, edit profile.
