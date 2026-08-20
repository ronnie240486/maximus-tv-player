// In-memory session cache for the MAC status/branding, plus persistence via
// the universal storage helper. Screens read `getSession()` synchronously
// after login; `loadSession()` rehydrates from disk on cold start.

import { storage } from '@/src/utils/storage';
import { MacStatus } from '@/src/api/client';
import { parsePlaylistUrl, XtreamCreds } from '@/src/lib/xtream';

const STORAGE_KEY = 'mac_status_v1';
// O painel pode mandar mais de uma playlist (ex: "Lista 1", "Lista 02") no
// mesmo MAC — guardamos qual delas a pessoa escolheu usar.
const ACTIVE_PLAYLIST_KEY = 'active_playlist_index_v1';

let cached: MacStatus | null = null;
let cachedCreds: XtreamCreds | null = null;
let cachedActiveIndex = 0;

export function getSession(): MacStatus | null {
  return cached;
}

export function getActivePlaylistIndex(): number {
  return cachedActiveIndex;
}

// `persist=true` (padrão) é pra quando a pessoa escolhe manualmente uma
// lista na tela de Playlists — isso deve continuar valendo depois de fechar
// e abrir o app de novo. `persist=false` é usado pela troca automática (Home,
// quando uma lista falha) — só vale pra sessão atual; ao reabrir o app,
// sempre volta a tentar a lista 1 (ou a que a pessoa escolheu manualmente).
export async function setActivePlaylistIndex(idx: number, persist: boolean = true): Promise<void> {
  cachedActiveIndex = idx;
  cachedCreds = null; // força getXtream() recalcular com a nova playlist
  if (persist) {
    await storage.setItem(ACTIVE_PLAYLIST_KEY, idx);
  }
}

export function getXtream(): XtreamCreds | null {
  if (cachedCreds) return cachedCreds;
  const list = cached?.playlists;
  const chosen = list?.[cachedActiveIndex] || list?.[0];
  if (!chosen?.url) return null;
  cachedCreds = parsePlaylistUrl(chosen.url);
  return cachedCreds;
}

export async function saveSession(status: MacStatus): Promise<void> {
  cached = status;
  cachedCreds = null;
  await storage.setItem(STORAGE_KEY, JSON.stringify(status));
}

export async function loadSession(): Promise<MacStatus | null> {
  if (cached) return cached;
  const [raw, idxRaw] = await Promise.all([
    storage.getItem<string>(STORAGE_KEY, ''),
    storage.getItem<number>(ACTIVE_PLAYLIST_KEY, 0),
  ]);
  cachedActiveIndex = typeof idxRaw === 'number' ? idxRaw : 0;
  if (!raw) return null;
  try {
    cached = JSON.parse(raw) as MacStatus;
    return cached;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  cached = null;
  cachedCreds = null;
  cachedActiveIndex = 0;
  await storage.removeItem(STORAGE_KEY);
  await storage.removeItem(ACTIVE_PLAYLIST_KEY);
}
