// Continue watching — a short, recency-ordered list of the last VOD items
// (movies / series episodes) the person opened in the player, so Home can
// show a "resume" row like Netflix does. Live channels are intentionally
// never recorded — "continue watching" a live channel doesn't mean anything.
// Keyed per profile so each person's "resume" row only shows their own stuff.

import { storage } from '@/src/utils/storage';
import { getActiveProfileId } from '@/src/state/active-profile';

const KEY_PREFIX = 'watch_history_v1_';
const MAX_ITEMS = 20;

export type WatchEntry = {
  id: string; // same id passed to the player (e.g. "movie-123", "series-ep-456")
  name: string;
  logo?: string;
  stream: string;
  seriesId?: number; // present for episodes, so "resume" can reopen the series details instead
  positionSeconds?: number; // de onde a pessoa parou — usado pra retomar
  durationSeconds?: number; // duração total, pra calcular % assistido e
  // pra saber quando o item está "praticamente terminado" (não vale a
  // pena oferecer retomar os últimos 30s de um filme de 2h)
  updatedAt: number;
};

const cache: Record<string, WatchEntry[]> = {};

function storageKey(): string {
  return KEY_PREFIX + getActiveProfileId();
}

async function persist(list: WatchEntry[]): Promise<void> {
  cache[getActiveProfileId()] = list;
  await storage.setItem(storageKey(), JSON.stringify(list));
}

export async function loadWatchHistory(): Promise<WatchEntry[]> {
  const profileId = getActiveProfileId();
  if (cache[profileId]) return cache[profileId];
  const raw = await storage.getItem<string>(storageKey(), '');
  if (!raw) {
    cache[profileId] = [];
    return cache[profileId];
  }
  try {
    cache[profileId] = JSON.parse(raw) as WatchEntry[];
  } catch {
    cache[profileId] = [];
  }
  return cache[profileId];
}

export async function recordWatch(entry: Omit<WatchEntry, 'updatedAt'>): Promise<void> {
  const list = await loadWatchHistory();
  const withoutThis = list.filter((e) => e.id !== entry.id);
  const next = [{ ...entry, updatedAt: Date.now() }, ...withoutThis].slice(0, MAX_ITEMS);
  await persist(next);
}

/** Atualiza só a posição de reprodução de um item que já está no
 * histórico (chamado periodicamente enquanto o vídeo toca) — não
 * recria a entrada do zero, só atualiza o número. Se o item ainda não
 * estiver no histórico por algum motivo (chamada antes do recordWatch
 * inicial rodar), não faz nada — evita criar uma entrada incompleta. */
/** Atualiza a posição de reprodução — se o item ainda não estiver no
 * histórico por algum motivo (ex: recordWatch falhou ou ainda não tinha
 * terminado quando isso rodou pela primeira vez), CRIA o registro na
 * hora em vez de desistir silenciosamente. Antes, se recordWatch não
 * tivesse rodado com sucesso por qualquer razão, a posição nunca era
 * salva e ninguém percebia — o filme sempre voltava do início sem
 * nenhum aviso de erro. */
export async function updateWatchPosition(
  id: string,
  positionSeconds: number,
  durationSeconds: number,
  fallback?: { name: string; logo?: string; stream: string; seriesId?: number }
): Promise<void> {
  const list = await loadWatchHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) {
    if (!fallback) return;
    const next = [{ ...fallback, id, positionSeconds, durationSeconds, updatedAt: Date.now() }, ...list].slice(0, MAX_ITEMS);
    await persist(next);
    return;
  }
  const next = [...list];
  next[idx] = { ...next[idx], positionSeconds, durationSeconds, updatedAt: Date.now() };
  await persist(next);
}

/** Posição salva pra um item, se tiver — usado quando o player abre, pra
 * saber se deve pular direto pra onde a pessoa parou. Ignora posições
 * "praticamente no início" (menos de 15s, não vale a pena) ou
 * "praticamente no fim" (menos de 30s restantes, mais fácil deixar
 * assistir o final e começar do zero da próxima vez do que ficar preso
 * retomando os últimos segundos pra sempre). */
export async function getResumePosition(id: string): Promise<number | null> {
  const list = await loadWatchHistory();
  const entry = list.find((e) => e.id === id);
  if (!entry?.positionSeconds || !entry.durationSeconds) return null;
  if (entry.positionSeconds < 15) return null;
  if (entry.durationSeconds - entry.positionSeconds < 30) return null;
  return entry.positionSeconds;
}
