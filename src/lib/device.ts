import * as Crypto from 'expo-crypto';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';

const KEY = 'device_mac_id_v1';
const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

let cachedMac: string | null = null;

function toMac(hex: string): string {
  const bytes = hex.slice(0, 12).toUpperCase();
  return bytes.match(/.{1,2}/g)!.join(':');
}

/**
 * Returns a stable MAC-style device ID (AA:BB:CC:DD:EE:FF).
 *
 * Derived deterministically (SHA-256, first 6 bytes) from the OS-level
 * device identifier (Android ID / iOS identifierForVendor) rather than a
 * randomly-generated value we store — that way it comes out the same every
 * time for a given physical device, with no dependency on app storage
 * actually persisting between launches. This matters specifically because
 * Expo Go's dev-tunnel sessions (no EAS project, "anonymous" mode) sandbox
 * AsyncStorage/SecureStore per session, so a *stored* random MAC would
 * silently reset every time the tunnel restarted — this device-derived
 * approach isn't affected by that, and behaves identically in the built APK.
 *
 * Falls back to a randomly-generated + persisted value only if no stable
 * native device ID is available (e.g. some emulators, or web).
 */
export async function getDeviceMac(): Promise<string> {
  if (cachedMac && MAC_RE.test(cachedMac)) return cachedMac;

  try {
    let nativeId: string | null = null;
    if (Platform.OS === 'android') {
      nativeId = Application.getAndroidId();
    } else if (Platform.OS === 'ios') {
      nativeId = await Application.getIosIdForVendorAsync();
    }
    if (nativeId) {
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nativeId);
      const mac = toMac(hash);
      cachedMac = mac;
      return mac;
    }
  } catch {
    // fall through to the stored-random fallback below
  }

  const stored = await storage.secureGet<string>(KEY, '');
  if (stored && MAC_RE.test(stored)) {
    cachedMac = stored;
    return stored;
  }

  const bytes = await Crypto.getRandomBytesAsync(6);
  const mac = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

  cachedMac = mac;
  await storage.secureSet<string>(KEY, mac);
  return mac;
}

export async function resetDeviceMac(): Promise<string> {
  cachedMac = null;
  await storage.secureRemove(KEY);
  return getDeviceMac();
}
