// Generic cache for list screens (Channels / Movies / Series): categories +
// items, keyed per screen. Same stale-while-revalidate idea as home-cache.ts
// — paint the last known list instantly on open, then refresh in the
// background instead of showing a blank spinner every time.

import { storage } from '@/src/utils/storage';

const PREFIX = 'list_cache_v1_';

export type CachedList<TCategory, TItem> = {
  categories: TCategory[];
  items: TItem[];
  savedAt: number;
};

const memory: Record<string, CachedList<any, any>> = {};

// Limpa tanto o que está salvo no celular quanto a cópia guardada em
// memória enquanto o app está aberto — sem isso, "Limpar cache" parecia
// não fazer nada, porque a tela voltava a usar a cópia em memória (que
// continuava com os dados antigos) antes mesmo de checar o armazenamento.
export async function clearListCache(keys: string[]): Promise<void> {
  for (const key of keys) {
    delete memory[key];
    await storage.removeItem(PREFIX + key);
  }
}

export async function saveListCache<TCategory, TItem>(
  key: string,
  categories: TCategory[],
  items: TItem[]
): Promise<void> {
  const data: CachedList<TCategory, TItem> = { categories, items, savedAt: Date.now() };
  memory[key] = data;
  await storage.setItem(PREFIX + key, JSON.stringify(data));
}

export async function loadListCache<TCategory, TItem>(
  key: string
): Promise<CachedList<TCategory, TItem> | null> {
  if (memory[key]) return memory[key];
  const raw = await storage.getItem<string>(PREFIX + key, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedList<TCategory, TItem>;
    memory[key] = parsed;
    return parsed;
  } catch {
    return null;
  }
}
