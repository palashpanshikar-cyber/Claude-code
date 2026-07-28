import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives.
 *
 * `localhost` means the phone itself, so a real device can never reach a server
 * running on your laptop that way. In development we fall back to the host that
 * served the Expo bundle, which is your machine's LAN address — the one thing
 * that works on device, simulator and web without configuration.
 *
 * Set EXPO_PUBLIC_API_URL to override (a deployed API, or a tunnel).
 */
function inferDevHost(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:3000`;

  // Android emulators reach the host machine on a special address.
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? inferDevHost();
