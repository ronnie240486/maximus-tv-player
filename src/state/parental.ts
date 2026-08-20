// Parental control: a simple on/off lock plus a 4-digit PIN, both persisted
// via secure storage (Keychain / EncryptedSharedPreferences) since a PIN is
// sensitive-ish data — a kid poking around AsyncStorage shouldn't find it.

import { storage } from '@/src/utils/storage';

const ENABLED_KEY = 'settings_parental_lock_v1';
const PIN_KEY = 'parental_pin_v1';

export async function isParentalLockEnabled(): Promise<boolean> {
  const v = await storage.getItem<boolean>(ENABLED_KEY, false);
  return !!v;
}

export async function setParentalLockEnabled(v: boolean): Promise<void> {
  await storage.setItem(ENABLED_KEY, v);
}

export async function hasParentalPin(): Promise<boolean> {
  const pin = await storage.secureGet<string>(PIN_KEY, '');
  return !!pin;
}

export async function setParentalPin(pin: string): Promise<void> {
  await storage.secureSet(PIN_KEY, pin);
}

export async function verifyParentalPin(pin: string): Promise<boolean> {
  const stored = await storage.secureGet<string>(PIN_KEY, '');
  return !!stored && stored === pin;
}

export async function clearParentalPin(): Promise<void> {
  await storage.secureRemove(PIN_KEY);
}
