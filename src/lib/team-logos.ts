// Escudo real de time pra deixar "Jogos do Dia" menos genérico — usa a
// Wikipédia (gratuita, sem chave de API) pra buscar a imagem principal do
// clube. Antes usava uma lista fixa de ~40 times conhecidos, mas isso não
// escalava — a maioria dos times reais que aparecem em "jogos do dia" (Série
// B, C, times estrangeiros como Wolverhampton, Middlesbrough) simplesmente
// não estava na lista. Agora busca DINAMICAMENTE por qualquer nome de time.
//
// O risco de busca livre é achar a coisa ERRADA (ex: "São Paulo" sozinho
// pode achar o artigo da CIDADE, não do time) — mitigado assim:
// 1. Busca com sufixo "futebol clube" primeiro (ajuda a desambiguar a
//    maioria dos times brasileiros).
// 2. Se não achar nada, tenta variações (F.C., nome puro).
// 3. Só aceita o resultado se o TÍTULO do artigo encontrado realmente
//    contém o nome do time buscado (não confia em qualquer coisa que a
//    busca livre trouxer).

import { storage } from '@/src/utils/storage';
import { logSessionEventFast } from '@/src/state/debug-log';

const CACHE_KEY = 'team_logo_cache_v2';

type CacheEntry = { url: string | null; ts: number };
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

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function searchWikiTitle(query: string): Promise<string | null> {
  const url = `https://pt.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json&origin=*`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const title: string | undefined = json?.[1]?.[0];
  return title || null;
}

async function fetchThumbnail(wikiTitle: string): Promise<string | null> {
  const res = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json?.thumbnail?.source || null;
}

/** Devolve a URL do escudo do time, buscando dinamicamente na Wikipédia —
 * funciona pra qualquer time (não só uma lista fixa), com uma checagem
 * de segurança pra não devolver a coisa errada (ex: a CIDADE em vez do
 * time). Devolve null se não achar com confiança suficiente — nesse caso
 * a tela deve continuar usando o ícone genérico do esporte. */
export async function getTeamLogoUrl(teamName: string): Promise<string | null> {
  const key = normalize(teamName);
  if (key.length < 3) return null;

  const cache = await loadCache();
  if (cache[key]) return cache[key].url;

  let wikiTitle: string | null = null;
  try {
    wikiTitle = await searchWikiTitle(`${teamName} futebol clube`);
    if (!wikiTitle) wikiTitle = await searchWikiTitle(`${teamName} F.C.`);
    if (!wikiTitle) wikiTitle = await searchWikiTitle(teamName);

    if (!wikiTitle) {
      logSessionEventFast('team-logo', `nao achou artigo pra "${teamName}"`);
      cache[key] = { url: null, ts: Date.now() };
      await saveCache();
      return null;
    }

    const normalizedFound = normalize(wikiTitle.replace(/_/g, ' '));
    const isPlausible = normalizedFound.includes(key) || key.includes(normalizedFound.split(' ')[0] || '');
    if (!isPlausible) {
      logSessionEventFast('team-logo', `artigo "${wikiTitle}" nao parece bater com "${teamName}"`);
      cache[key] = { url: null, ts: Date.now() };
      await saveCache();
      return null;
    }

    const url = await fetchThumbnail(wikiTitle);
    if (!url) logSessionEventFast('team-logo', `sem imagem no artigo "${wikiTitle}"`);
    cache[key] = { url, ts: Date.now() };
    await saveCache();
    return url;
  } catch (e: any) {
    logSessionEventFast('team-logo', `erro buscando "${teamName}": ${e?.message || e}`);
    return null;
  }
}
