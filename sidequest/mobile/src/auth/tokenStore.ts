import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'sidequest.token';

/**
 * The JWT lives in the device keychain/keystore, not AsyncStorage.
 *
 * AsyncStorage is plain unencrypted files — readable on a rooted or jailbroken
 * device, and included in some backups. A token is a bearer credential valid
 * for seven days, so it belongs behind the platform's secure storage.
 *
 * SecureStore has no web implementation; on web we fall back to localStorage so
 * `expo start --web` still works for quick checks. That is not a secure store,
 * which is fine because web is not a shipping target.
 */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
    return SecureStore.getItemAsync(KEY);
  },

  async set(token: string): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(KEY, token);
      return;
    }
    await SecureStore.setItemAsync(KEY, token);
  },

  async clear(): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(KEY);
      return;
    }
    await SecureStore.deleteItemAsync(KEY);
  },
};
