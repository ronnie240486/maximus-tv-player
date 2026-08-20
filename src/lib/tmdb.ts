// Integração com o TMDb (themoviedb.org) — banco de dados de filmes/séries
// gratuito, usado aqui só pra descobrir o GÊNERO REAL de cada título do
// catálogo (coisa que o Xtream não devolve em massa, só uma consulta de
// cada vez no detalhe). Precisa de uma chave de API gratuita
// (EXPO_PUBLIC_TMDB_API_KEY) — sem ela configurada, esse módulo não faz
// nada (as sugestões continuam funcionando só com categoria + títulos
// conhecidos, ver genre-detect.ts).
//
// Cache persistente: cada título só é consultado no TMDb UMA VEZ NA VIDA
// do app (fica salvo em disco) — sem isso, toda busca por gênero
// recomeçaria do zero, gastando tempo e cota de API à toa.

import { storage } from '@/src/utils/storage';
import { GenreKey } from './genre-detect';

const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || '';
// v2: invalida o cache antigo — antes da correção que confere se o
// resultado do TMDb é REALMENTE o mesmo título antes de confiar no
// gênero, dados errados podem ter ficado salvos (ex: Barbie marcada
// como "ação" por engano). Trocar a chave da versão faz esses dados
// velhos serem ignorados, forçando busca nova com a lógica corrigida.
const CACHE_KEY = 'tmdb_genre_cache_v2';

// IDs oficiais de gênero do TMDb (developers.themoviedb.org/3/genres) —
// mapeados pros nossos GenreKey internos. Gêneros do TMDb sem
// correspondente direto no nosso conjunto (Crime, History, Family, War,
// Western, Music, News, Reality...) ficam de fora de propósito — melhor
// não mapear do que mapear errado.
const TMDB_GENRE_MAP: Record<number, GenreKey[]> = {
  28: ['acao'], // Action
  10759: ['acao', 'aventura'], // Action & Adventure (TV)
  12: ['aventura'], // Adventure
  16: ['animacao'], // Animation
  35: ['comedia'], // Comedy
  99: ['documentario'], // Documentary
  18: ['drama'], // Drama
  27: ['terror'], // Horror
  9648: ['suspense'], // Mystery
  10749: ['romance'], // Romance
  878: ['ficcao'], // Science Fiction
  10765: ['ficcao'], // Sci-Fi & Fantasy (TV)
  53: ['suspense'], // Thriller
};

type CacheEntry = { genres: GenreKey[]; ts: number };
let cacheMemory: Record<string, CacheEntry> | null = null;

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cacheMemory) return cacheMemory;
  const raw = await storage.getItem<string>(CACHE_KEY, '');
  cacheMemory = raw ? JSON.parse(raw) : {};
  return cacheMemory!;
}

async function saveCache(): Promise<void> {
  if (cacheMemory) await storage.setItem(CACHE_KEY, JSON.stringify(cacheMemory));
}

function cacheKeyFor(title: string, kind: 'movie' | 'series'): string {
  return `${kind}:${title.toLowerCase().trim()}`;
}

/** Acha títulos PARECIDOS com uma referência ("uma série igual a Tulsa
 * King") usando o próprio recurso de recomendação do TMDb — bem mais
 * preciso que só bater gênero, porque leva em conta tom, elenco,
 * temática etc, não só a categoria ampla. Busca o título de referência
 * primeiro (tenta filme E série, já que a pessoa nem sempre fala qual é
 * qual), pega o ID, e usa o endpoint de similares/recomendados dele.
 */
export async function getSimilarTitles(referenceTitle: string): Promise<string[]> {
  if (!API_KEY) return [];

  for (const kind of ['tv', 'movie'] as const) {
    try {
      const searchUrl = `https://api.themoviedb.org/3/search/${kind}?api_key=${API_KEY}&query=${encodeURIComponent(referenceTitle)}&language=pt-BR`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) continue;
      const searchJson = await searchRes.json();
      const found = searchJson?.results?.[0];
      if (!found) continue;

      // Confere se achou o título certo mesmo (mesma checagem usada no
      // enriquecimento de gênero) — não adianta pegar recomendação de um
      // título errado.
      const foundTitle = normalizeTitle(found.title || found.name || '');
      const refTitle = normalizeTitle(referenceTitle);
      const isMatch = foundTitle === refTitle || (refTitle.length >= 4 && foundTitle.includes(refTitle)) || (foundTitle.length >= 4 && refTitle.includes(foundTitle));
      if (!isMatch) continue;

      // "recommendations" costuma trazer resultado mais parecido em tom/
      // temática que "similar" (que às vezes só olha gênero+palavra-chave
      // solta) — tenta recommendations primeiro, cai pra similar se vier
      // vazio.
      for (const endpoint of ['recommendations', 'similar']) {
        const relatedUrl = `https://api.themoviedb.org/3/${kind}/${found.id}/${endpoint}?api_key=${API_KEY}&language=pt-BR`;
        const relatedRes = await fetch(relatedUrl);
        if (!relatedRes.ok) continue;
        const relatedJson = await relatedRes.json();
        const titles: string[] = (relatedJson?.results || [])
          .map((r: any) => r.title || r.name)
          .filter(Boolean);
        if (titles.length > 0) return titles;
      }
    } catch {
      // Tenta o outro tipo (filme/série) antes de desistir de vez.
    }
  }
  return [];
}

export function isTmdbConfigured(): boolean {
  return !!API_KEY;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // remove ruído comum de nome de canal/VOD de painel IPTV (ano entre
    // parênteses/colchetes, tags de qualidade) que não existe no título
    // "limpo" que o TMDb devolve — sem isso, a comparação abaixo quase
    // nunca bateria mesmo pro título certo.
    .replace(/\(\d{4}\)|\[\d{4}\]|\b\d{4}\b/g, '')
    .replace(/\b(4k|hd|fullhd|dublado|legendado|dual|lançamento)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchGenresFor(title: string, kind: 'movie' | 'series'): Promise<GenreKey[]> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${API_KEY}&query=${encodeURIComponent(title)}&language=pt-BR`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const first = json?.results?.[0];
    if (!first) return [];

    // Confere se o resultado que o TMDb achou é DE VERDADE o mesmo
    // título do catálogo antes de confiar no gênero dele — sem essa
    // checagem, um título parecido só no nome (mas sendo um filme
    // totalmente diferente) podia "vazar" gênero errado pro catálogo
    // (ex: uma comédia romântica aparecendo numa busca por ficção
    // científica, porque o primeiro resultado da busca no TMDb pra
    // aquele nome era outra coisa).
    const resultTitle = normalizeTitle(first.title || first.name || '');
    const queryTitle = normalizeTitle(title);
    const isSameTitle =
      resultTitle === queryTitle ||
      (queryTitle.length >= 4 && resultTitle.includes(queryTitle)) ||
      (resultTitle.length >= 4 && queryTitle.includes(resultTitle));
    if (!isSameTitle) return [];

    const genreIds: number[] = first?.genre_ids || [];
    const mapped = new Set<GenreKey>();
    for (const id of genreIds) {
      for (const g of TMDB_GENRE_MAP[id] || []) mapped.add(g);
    }
    return Array.from(mapped);
  } catch {
    return [];
  }
}

/**
 * Enriquece um lote de títulos com gênero real do TMDb, respeitando o
 * cache (só consulta o que ainda não sabe). Roda em lotes pequenos e
 * paralelos, não tudo de uma vez — evita sobrecarregar a API e trava a
 * tela. `onBatchDone` é chamado a cada lote concluído, pra tela ir
 * atualizando as sugestões progressivamente em vez de esperar tudo
 * terminar.
 */
export async function enrichGenresInBackground(
  titles: { title: string; kind: 'movie' | 'series' }[],
  opts: { batchSize?: number; maxItems?: number; onBatchDone?: (results: Map<string, GenreKey[]>) => void } = {}
): Promise<void> {
  if (!API_KEY) return;
  const { batchSize = 8, maxItems = 150, onBatchDone } = opts;

  const cache = await loadCache();
  const pending = titles
    .filter((t) => !(cacheKeyFor(t.title, t.kind) in cache))
    .slice(0, maxItems);

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (t) => {
        const genres = await fetchGenresFor(t.title, t.kind);
        return { key: cacheKeyFor(t.title, t.kind), genres };
      })
    );
    const batchMap = new Map<string, GenreKey[]>();
    for (const r of results) {
      cache[r.key] = { genres: r.genres, ts: Date.now() };
      batchMap.set(r.key, r.genres);
    }
    await saveCache();
    onBatchDone?.(batchMap);
    // Pequena pausa entre lotes — sem pressa nenhuma (isso roda em
    // segundo plano), só sendo educado com a API gratuita.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Gêneros já conhecidos (cache) pra um título — síncrono, útil pra
 * filtrar depois que o enriquecimento já rodou pelo menos uma vez. */
export async function getCachedGenres(title: string, kind: 'movie' | 'series'): Promise<GenreKey[]> {
  const cache = await loadCache();
  return cache[cacheKeyFor(title, kind)]?.genres || [];
}

export async function getAllCachedGenres(): Promise<Record<string, CacheEntry>> {
  return loadCache();
}
