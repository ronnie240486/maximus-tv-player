// Favorites — movies and series the person has marked with the heart/star
// button on the details screen. Persisted as a flat list so both list and
// detail screens can check "is this favorited" without extra fetches.
// Keyed per profile — two people using the same app shouldn't see each
// other's favorites.

import { storage } from '@/src/utils/storage';
import { getActiveProfileId } from '@/src/state/active-profile';

const KEY_PREFIX = 'favorites_v1_';

export type FavoriteKind = 'movie' | 'series' | 'channel' | 'radio';

export type FavoriteItem = {
  id: string; // `${kind}-${streamId or seriesId or stationuuid}`
  kind: FavoriteKind;
  refId: number | string; // stream_id / series_id, or stationuuid for radios
  name: string;
  cover?: string;
  streamUrl?: string; // rádios não reconstroem a URL via Xtream, então guardamos direto
  addedAt: number;
};

// Cacheado por perfil, não globalmente — trocar de perfil não deve
// reaproveitar os favoritos carregados do perfil anterior.
const cache: Record<string, FavoriteItem[]> = {};

function storageKey(): string {
  return KEY_PREFIX + getActiveProfileId();
}

async function persist(list: FavoriteItem[]): Promise<void> {
  cache[getActiveProfileId()] = list;
  await storage.setItem(storageKey(), JSON.stringify(list));
}

export async function loadFavorites(): Promise<FavoriteItem[]> {
  const profileId = getActiveProfileId();
  if (cache[profileId]) return cache[profileId];
  const raw = await storage.getItem<string>(storageKey(), '');
  if (!raw) {
    cache[profileId] = [];
    return cache[profileId];
  }
  try {
    cache[profileId] = JSON.parse(raw) as FavoriteItem[];
  } catch {
    cache[profileId] = [];
  }
  return cache[profileId];
}

export function isFavoriteSync(id: string): boolean {
  return !!cache[getActiveProfileId()]?.some((f) => f.id === id);
}

export async function isFavorite(id: string): Promise<boolean> {
  const list = await loadFavorites();
  return list.some((f) => f.id === id);
}

export async function toggleFavorite(item: Omit<FavoriteItem, 'addedAt'>): Promise<boolean> {
  const list = await loadFavorites();
  const exists = list.some((f) => f.id === item.id);
  const next = exists
    ? list.filter((f) => f.id !== item.id)
    : [{ ...item, addedAt: Date.now() }, ...list];
  await persist(next);
  return !exists; // returns the new favorited state
}
