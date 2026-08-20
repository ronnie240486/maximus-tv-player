// Xtream Codes IPTV client + M3U URL parser.
//
// The backend `check_mac.php` returns playlists whose URLs follow the
// Xtream Codes convention:
//   http://server[:port]/get.php?username=X&password=Y&type=m3u_plus&output=ts
// From that we can hit the real Xtream `player_api.php` for structured data
// (categories, live streams, movies, series) — much faster than parsing M3U.

export type XtreamCreds = {
  server: string; // e.g. "http://nuvixonix.shop"
  username: string;
  password: string;
};

import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';

// Some Xtream servers hide behind Cloudflare and reject datacenter IPs; from
// a residential mobile connection (Expo Go / APK) they respond normally, so
// we call them directly on native. In the web preview the browser blocks
// cross-origin requests, so we route through our own FastAPI proxy which
// adds a mobile UA and CORS headers (though Cloudflare may still block from
// the container IP — the app is intended for mobile devices).
const PROXY_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/iptv-proxy`;

const commonHeaders: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  // Sem isso, só as chamadas de VÍDEO (que já mandam User-Agent em outros
  // arquivos) passavam por painéis atrás de Cloudflare — as de DADOS
  // (sinopse, EPG, categorias, etc, todas via player_api.php) não tinham
  // nenhum User-Agent, o que muitos desses painéis tratam como tráfego
  // suspeito/bot e bloqueiam, mesmo com o vídeo funcionando normalmente.
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1',
};

function routeUrl(url: string): string {
  if (Platform.OS === 'web') {
    return `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export function parsePlaylistUrl(url: string): XtreamCreds | null {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    const server = `${u.protocol}//${u.host}`;
    return { server, username, password };
  } catch {
    return null;
  }
}

// Requests hang forever on some Xtream panels when the server is overloaded;
// cap every call so a single slow endpoint can't block the whole screen.
const DEFAULT_TIMEOUT_MS = 9000;

// Cache em memória (instantâneo dentro da mesma sessão) + persistência em
// disco via MMKV pras listas GRANDES que raramente mudam (categorias,
// canais/filmes/séries) — sem isso, cada abertura do app (cold start)
// começava do zero e precisava buscar tudo de novo na rede antes de
// mostrar qualquer coisa. Com persistência, a Home/Filmes/Séries/Canais
// pintam quase instantaneamente a partir do disco enquanto uma busca nova
// acontece por trás (stale-while-revalidate), e só ficam "velhas" de
// verdade depois de 15 minutos.
//
// EPG ("o que está passando agora") e detalhes de item avulso (info de
// filme/série específico) ficam só em memória — mudam com mais frequência
// e persistir cada um criaria um monte de chaves em disco à toa.
//
// + eliminação de chamadas concorrentes idênticas. Sem isso, era comum a
// MESMA lista gigante (ex: get_vod_streams com milhares de itens) ser
// buscada 2-3 vezes ao mesmo tempo quando telas diferentes pedem os mesmos
// dados quase juntas (ex: a Home carrega "Filmes em alta" enquanto a
// pessoa já está entrando na tela de Filmes, que pede a lista completa).
const CACHEABLE_TTL_MS: Record<string, number> = {
  get_live_categories: 900_000,
  get_vod_categories: 900_000,
  get_series_categories: 900_000,
  get_live_streams: 900_000,
  get_vod_streams: 900_000,
  get_series: 900_000,
  get_series_info: 120_000,
  get_vod_info: 120_000,
  // TTL bem mais curto que o resto — é "o que está passando agora", não
  // pode ficar velho por minutos. Mas precisa de ALGUM cache (mesmo curto)
  // pra o pré-carregamento em background (ver channels.tsx) valer a pena;
  // sem isso, o pré-carregamento buscaria e a tela pediria nova de novo
  // um instante depois, dobrando o trabalho à toa.
  get_short_epg: 45_000,
};

// Só essas ações (listas grandes, "raramente mudam") persistem em disco.
// get_series_info/get_vod_info/get_short_epg ficam de fora de propósito
// (ver comentário acima).
const DISK_PERSIST_ACTIONS = new Set([
  'get_live_categories',
  'get_vod_categories',
  'get_series_categories',
  'get_live_streams',
  'get_vod_streams',
  'get_series',
]);
const DISK_CACHE_PREFIX = 'xtream_disk_cache_v1:';

type CacheEntry = { value: unknown; expiresAt: number };
const xtreamCache = new Map<string, CacheEntry>();
const xtreamInFlight = new Map<string, Promise<unknown>>();

// Métricas simples pra mostrar em Configurações — só conta, não guarda
// nada sensível. Zera quando o app reabre (é só da sessão atual).
let cacheHits = 0;
let cacheMisses = 0;
export function getXtreamCacheStats(): { hits: number; misses: number; hitRate: number } {
  const total = cacheHits + cacheMisses;
  return { hits: cacheHits, misses: cacheMisses, hitRate: total > 0 ? cacheHits / total : 0 };
}

// Disco (MMKV) só entra pras ações em DISK_PERSIST_ACTIONS — ver
// comentário acima de CACHEABLE_TTL_MS. Segue o mesmo padrão do resto do
// app pra guardar objeto: JSON.stringify manual antes de passar pro
// storage (que faz seu próprio JSON.stringify por cima, então a leitura
// precisa desfazer os dois passos na ordem inversa).
async function readDiskCache(cacheKey: string): Promise<CacheEntry | null> {
  try {
    const raw = await storage.getItem<string>(DISK_CACHE_PREFIX + cacheKey, '');
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeDiskCache(cacheKey: string, entry: CacheEntry): void {
  // Fire-and-forget: a escrita em disco não deve atrasar quem está
  // esperando a resposta da rede, e uma falha aqui não é motivo pra
  // quebrar nada (a próxima chamada só volta a bater na rede, que já
  // funcionava assim antes desta persistência existir).
  storage.setItem(DISK_CACHE_PREFIX + cacheKey, JSON.stringify(entry)).catch(() => {});
}

async function xtreamGet<T>(
  creds: XtreamCreds,
  action: string,
  extra: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T | null> {
  const params = new URLSearchParams({
    username: creds.username,
    password: creds.password,
    ...(action ? { action } : {}),
    ...extra,
  });
  const url = `${creds.server}/player_api.php?${params.toString()}`;
  const cacheKey = url; // já inclui server+credenciais+ação+parâmetros

  const ttl = CACHEABLE_TTL_MS[action] || 0;
  const persistToDisk = DISK_PERSIST_ACTIONS.has(action);
  if (ttl > 0) {
    const cached = xtreamCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cacheHits++;
      return cached.value as T;
    }
    // Miss em memória (cold start, provavelmente) — antes de ir pra rede,
    // tenta o disco. Se achar algo ainda válido, usa e já repovoa a
    // memória (próximas chamadas na mesma sessão nem passam por aqui).
    if (persistToDisk) {
      const fromDisk = await readDiskCache(cacheKey);
      if (fromDisk) {
        cacheHits++;
        xtreamCache.set(cacheKey, fromDisk);
        return fromDisk.value as T;
      }
    }
    cacheMisses++;
  }

  // Eliminação de chamada duplicada: se essa MESMA URL já está sendo
  // buscada agora (outra tela pediu ao mesmo tempo), espera a chamada em
  // andamento em vez de disparar outra rede idêntica.
  const existing = xtreamInFlight.get(cacheKey);
  if (existing) return existing as Promise<T | null>;

  const promise = (async (): Promise<T | null> => {
    // Só tenta de novo em falha PASSAGEIRA (timeout, sem rede no instante) —
    // bloqueio de Cloudflare ou erro HTTP normalmente é permanente pra
    // aquela chamada, tentar de novo só demoraria mais sem resolver nada.
    const RETRY_DELAYS_MS = [1000, 3000];
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(routeUrl(url), {
          headers: commonHeaders,
          signal: controller.signal,
        });
        if (!res.ok) {
          lastError = res.status === 403 ? 'BLOCKED_CLOUDFLARE' : `HTTP_${res.status}`;
          return null;
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) {
          lastError = 'BLOCKED_CLOUDFLARE';
          return null;
        }
        lastError = null;
        const json = (await res.json()) as T;
        if (ttl > 0) {
          const entry: CacheEntry = { value: json, expiresAt: Date.now() + ttl };
          xtreamCache.set(cacheKey, entry);
          if (persistToDisk) writeDiskCache(cacheKey, entry);
        }
        return json;
      } catch (e: any) {
        lastError = e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
  })().finally(() => {
    xtreamInFlight.delete(cacheKey);
  });

  xtreamInFlight.set(cacheKey, promise);
  return promise;
}

let lastError: string | null = null;
export function getLastXtreamError(): string | null {
  return lastError;
}

export type XtreamCategory = { category_id: string; category_name: string; parent_id?: number };

export type XtreamLive = {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number;
  stream_icon?: string;
  epg_channel_id?: string;
  added?: string;
  category_id?: string;
  tv_archive?: number;
  direct_source?: string;
  tv_archive_duration?: number;
};

export type XtreamMovie = {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string;
  category_id?: string;
  container_extension?: string;
  direct_source?: string;
};

export type XtreamSeries = {
  num?: number;
  name: string;
  series_id: number;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string | number;
  rating_5based?: number;
  category_id?: string;
};

export type XtreamSeasonInfo = {
  air_date?: string;
  episode_count?: number;
  id?: number;
  name?: string;
  overview?: string;
  season_number: number;
  cover?: string;
  cover_big?: string;
};

export type XtreamEpisode = {
  id: string;
  episode_num: number;
  title: string;
  container_extension?: string;
  info?: {
    plot?: string;
    duration?: string;
    duration_secs?: number;
    movie_image?: string;
    releaseDate?: string;
    rating?: string;
  };
};

export type XtreamVodInfo = {
  info: {
    name?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releasedate?: string;
    release_date?: string;
    rating?: string | number;
    duration?: string;
    cover_big?: string;
    movie_image?: string;
    backdrop_path?: string[];
    youtube_trailer?: string; // usually just the raw YouTube video id
  };
  movie_data?: {
    stream_id?: number;
    container_extension?: string;
  };
};
export type XtreamSeriesInfo = {
  seasons: XtreamSeasonInfo[];
  info: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string | number;
    backdrop_path?: string[];
    youtube_trailer?: string;
  };
  episodes: Record<string, XtreamEpisode[]>;
};

export type XtreamUserInfo = {
  user_info?: {
    message?: string;
    status?: string;
    exp_date?: string;
    active_cons?: string | number;
    max_connections?: string | number;
    is_trial?: string;
  };
};

export const xtream = {
  authenticate: (c: XtreamCreds) => xtreamGet<XtreamUserInfo>(c, ''),
  liveCategories: (c: XtreamCreds) =>
    xtreamGet<XtreamCategory[]>(c, 'get_live_categories'),
  vodCategories: (c: XtreamCreds) =>
    xtreamGet<XtreamCategory[]>(c, 'get_vod_categories'),
  seriesCategories: (c: XtreamCreds) =>
    xtreamGet<XtreamCategory[]>(c, 'get_series_categories'),
  liveStreams: (c: XtreamCreds, categoryId?: string) =>
    xtreamGet<XtreamLive[]>(c, 'get_live_streams', categoryId ? { category_id: categoryId } : {}),
  vodStreams: (c: XtreamCreds, categoryId?: string) =>
    xtreamGet<XtreamMovie[]>(c, 'get_vod_streams', categoryId ? { category_id: categoryId } : {}),
  seriesList: (c: XtreamCreds, categoryId?: string) =>
    xtreamGet<XtreamSeries[]>(c, 'get_series', categoryId ? { category_id: categoryId } : {}),
  seriesInfo: (c: XtreamCreds, seriesId: number) =>
    xtreamGet<XtreamSeriesInfo>(c, 'get_series_info', { series_id: String(seriesId) }),
  vodInfo: (c: XtreamCreds, vodId: number) =>
    xtreamGet<XtreamVodInfo>(c, 'get_vod_info', { vod_id: String(vodId) }),
  shortEpg: (c: XtreamCreds, streamId: number, limit = 4) =>
    xtreamGet<{ epg_listings: XtreamEpgListing[] }>(c, 'get_short_epg', {
      stream_id: String(streamId),
      limit: String(limit),
    }),
};

export type XtreamEpgListing = {
  id?: string;
  title: string; // base64-encoded
  description?: string; // base64-encoded
  start: string; // "YYYY-MM-DD HH:mm:ss"
  end: string;
};

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

// Memoiza por string de entrada — a MESMA tela de EPG re-renderiza várias
// vezes sem o texto ter mudado (marcar lembrete, timeline recalculando,
// etc), e sem isso cada re-render refazia o decode inteiro (loop
// caractere-a-caractere + decodeURIComponent) de TODOS os títulos/
// descrições visíveis, do zero, toda vez. Capado em tamanho pra não
// crescer sem limite numa sessão longa — o "conjunto de trabalho" real
// (títulos de EPG visíveis nas telas abertas) é sempre pequeno, então um
// teto generoso nunca deveria expulsar algo que ainda está em uso.
const EPG_DECODE_CACHE_MAX = 500;
const epgDecodeCache = new Map<string, string>();

/** Decodes the base64 text Xtream sends for EPG title/description — no
 * `atob`/Buffer dependency needed, works the same on native and web. */
export function decodeEpgText(input?: string): string {
  if (!input) return '';
  const cached = epgDecodeCache.get(input);
  if (cached !== undefined) return cached;

  let result: string;
  try {
    let str = input.replace(/[^A-Za-z0-9+/=]/g, '');
    let output = '';
    for (let i = 0; i < str.length; i += 4) {
      const enc1 = B64_CHARS.indexOf(str[i]);
      const enc2 = B64_CHARS.indexOf(str[i + 1]);
      const enc3 = B64_CHARS.indexOf(str[i + 2]);
      const enc4 = B64_CHARS.indexOf(str[i + 3]);
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
      if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
    }
    // Xtream text is UTF-8 encoded before base64 — decode the byte string properly.
    result = decodeURIComponent(
      output
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    result = input;
  }

  // Se já estourou o teto, tira a entrada mais antiga (primeira inserida
  // — Map do JS preserva ordem de inserção) antes de adicionar a nova.
  if (epgDecodeCache.size >= EPG_DECODE_CACHE_MAX) {
    const oldestKey = epgDecodeCache.keys().next().value;
    if (oldestKey !== undefined) epgDecodeCache.delete(oldestKey);
  }
  epgDecodeCache.set(input, result);
  return result;
}

export function liveStreamUrl(c: XtreamCreds, streamId: number, ext: 'ts' | 'm3u8' = 'm3u8'): string {
  return `${c.server}/live/${c.username}/${c.password}/${streamId}.${ext}`;
}

export function movieStreamUrl(
  c: XtreamCreds,
  streamId: number,
  containerExtension?: string
): string {
  const ext = containerExtension || 'mp4';
  return `${c.server}/movie/${c.username}/${c.password}/${streamId}.${ext}`;
}

export function seriesEpisodeUrl(
  c: XtreamCreds,
  episodeId: number,
  containerExtension?: string
): string {
  const ext = containerExtension || 'mp4';
  return `${c.server}/series/${c.username}/${c.password}/${episodeId}.${ext}`;
}
