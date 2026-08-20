// There's no explicit "is_adult" flag in the Xtream API — panels mark adult
// content purely by category naming convention. We match common keywords
// (PT-BR and EN) case/accent-insensitively against the category name.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents
}

const ADULT_KEYWORDS = [
  'adulto',
  'adultos',
  '+18',
  '18+',
  'xxx',
  'adult',
  'porn',
  'sexo',
  'erotic',
  'erótico',
];

// Palavras que costumam aparecer em categorias feitas pra criança de
// verdade. Perfil infantil não é só "sem conteúdo adulto" — é só
// conteúdo QUE PARECE ser infantil mesmo, senão continuaria mostrando
// ação, terror, drama pesado etc., só sem a categoria "+18" explícita.
const KIDS_KEYWORDS = [
  'infantil',
  'infantis',
  'kids',
  'kid ',
  'crianca',
  'criancas',
  'desenho',
  'desenhos',
  'animacao',
  'animacoes',
  'cartoon',
  'anime kids',
  'familia',
  'família',
  'disney',
  'nickelodeon',
  'nick jr',
  'cartoon network',
  'gloob',
  'discovery kids',
  'baby',
  'bebe',
  'bebes',
  'juvenil',
];

// Muitos painéis organizam Filmes/Séries por PLATAFORMA (Netflix, Amazon,
// Disney+...) em vez de por gênero/público — nesse caso, dentro de uma
// categoria só chamada "Netflix" tem desenho infantil e série adulta
// juntos, e não tem como separar isso só pelo nome da categoria. Por
// isso, além de checar a categoria, também batemos o nome do próprio
// título contra uma lista de desenhos/filmes infantis bem conhecidos —
// não é uma lista completa (impossível cobrir tudo), mas pega os casos
// mais comuns mesmo espalhados em categorias mistas.
const KIDS_TITLE_KEYWORDS = [
  'peppa pig',
  'turma da monica',
  'patrulha canina',
  'paw patrol',
  'masha e o urso',
  'masha and the bear',
  'bluey',
  'pj masks',
  'backyardigans',
  'dora a aventureira',
  'dora the explorer',
  'galinha pintadinha',
  'mickey mouse',
  'minnie',
  'frozen',
  'toy story',
  'shrek',
  'enrolados',
  'tangled',
  'moana',
  'vaiana',
  'ursinho pooh',
  'winnie the pooh',
  'bob esponja',
  'spongebob',
  'ben 10',
  'pokemon',
  'kung fu panda',
  'madagascar',
  'carros 1',
  'carros 2',
  'carros 3',
  'cars 1',
  'cars 2',
  'cars 3',
  'croods',
  'zootopia',
  'divertida mente',
  'inside out',
  'como treinar seu dragao',
  'how to train your dragon',
  'meu malvado favorito',
  'despicable me',
  'minions',
  'rio 2011',
  'rio 2014',
  'sing',
  'trolls',
  'coco',
  'luca',
  'encanto',
  'soul 2020',
  'divertida',
  'gata marota',
  'sonic o filme',
  'sonic the hedgehog',
  'super mario bros',
  'super mario',
  'ladrao de raios',
  'a familia addams',
  'era do gelo',
  'ice age',
  'rex',
  'up altas aventuras',
  'wall e',
  'valente',
  'brave',
  'os incriveis',
  'incredibles',
  'monstros sa',
  'monstros university',
  'monsters inc',
  'procurando nemo',
  'finding nemo',
  'procurando dory',
  'finding dory',
  'ratatouille',
  'meninas superpoderosas',
  'powerpuff girls',
  'hora de aventura',
  'adventure time',
  'gravity falls',
  'steven universe',
  'unikitty',
  'os padrinhos magicos',
  'fairly oddparents',
  'as terriveis aventuras de billy e mandy',
  'chaves',
  'chapolin',
  'sitio do pica pau amarelo',
  'sid o cientista',
  'castelo ra tim bum',
  'cocoricó',
  'mundo bita',
];

// FIX DE PERFORMANCE IMPORTANTE: antes, cada palavra-chave era normalizada
// DE NOVO (toLowerCase + normalize NFD + regex) a cada comparação — ou
// seja, pra CADA filme/série checado contra as ~94 palavras de
// KIDS_TITLE_KEYWORDS, rodava até 94 normalizações redundantes das MESMAS
// palavras estáticas, que nunca mudam. Num catálogo com milhares de
// itens (comum em painel IPTV), isso virava centenas de milhares de
// operações de Unicode síncronas na hora de abrir Filmes/Séries com
// perfil infantil — pesado o bastante pra travar (e até derrubar) o app
// numa TV box com processador fraco. Normalizando as listas UMA VEZ SÓ,
// aqui embaixo, elimina praticamente todo esse trabalho redundante.
const NORMALIZED_ADULT_KEYWORDS = ADULT_KEYWORDS.map(normalize);
const NORMALIZED_KIDS_KEYWORDS = KIDS_KEYWORDS.map(normalize);
const NORMALIZED_KIDS_TITLE_KEYWORDS = KIDS_TITLE_KEYWORDS.map(normalize);

export function isAdultCategoryName(categoryName?: string | null): boolean {
  if (!categoryName) return false;
  const n = normalize(categoryName);
  return NORMALIZED_ADULT_KEYWORDS.some((kw) => n.includes(kw));
}

export function isKidsCategoryName(categoryName?: string | null): boolean {
  if (!categoryName) return false;
  const n = normalize(categoryName);
  return NORMALIZED_KIDS_KEYWORDS.some((kw) => n.includes(kw));
}

// Cache por título — se o mesmo catálogo for filtrado mais de uma vez na
// mesma sessão (ex: pull-to-refresh), títulos repetidos não recalculam
// do zero. Capado em tamanho pelo mesmo motivo do cache de EPG (ver
// decodeEpgText em xtream.ts): conjunto de trabalho real é sempre
// pequeno-médio, um teto generoso nunca deveria expulsar algo em uso.
const KIDS_TITLE_CACHE_MAX = 2000;
const kidsTitleCache = new Map<string, boolean>();

export function isKidsTitle(name?: string | null): boolean {
  if (!name) return false;
  const cached = kidsTitleCache.get(name);
  if (cached !== undefined) return cached;

  const n = normalize(name);
  const result = NORMALIZED_KIDS_TITLE_KEYWORDS.some((kw) => n.includes(kw));

  if (kidsTitleCache.size >= KIDS_TITLE_CACHE_MAX) {
    const oldestKey = kidsTitleCache.keys().next().value;
    if (oldestKey !== undefined) kidsTitleCache.delete(oldestKey);
  }
  kidsTitleCache.set(name, result);
  return result;
}

// Usados pelas telas de conteúdo (Canais, Filmes, Séries) quando o perfil
// ativo é infantil — nesse caso o conteúdo adulto não é só bloqueado por
// PIN, ele simplesmente não existe: nem a categoria aparece na lista, nem
// os itens dela aparecem em "Todos".
export function filterOutAdultCategories<T extends { category_name: string }>(
  categories: T[]
): T[] {
  return categories.filter((c) => !isAdultCategoryName(c.category_name));
}

export function filterOutAdultItems<T extends { category_id?: string | number }>(
  items: T[],
  categories: { category_id: string | number; category_name: string }[]
): T[] {
  const adultIds = new Set(
    categories.filter((c) => isAdultCategoryName(c.category_name)).map((c) => String(c.category_id))
  );
  if (adultIds.size === 0) return items;
  return items.filter((i) => !adultIds.has(String(i.category_id)));
}

// Curadoria de verdade pro perfil infantil: só deixa passar categorias
// que PARECEM ser feitas pra criança (bate com KIDS_KEYWORDS) — e, por
// segurança extra, exclui de novo qualquer uma que também bata com
// palavra de conteúdo adulto (evita um caso estranho tipo categoria mal
// nomeada que bata nas duas listas ao mesmo tempo).
export function filterToKidsCategories<T extends { category_name: string }>(
  categories: T[]
): T[] {
  return categories.filter(
    (c) => isKidsCategoryName(c.category_name) && !isAdultCategoryName(c.category_name)
  );
}

export function filterToKidsItems<T extends { category_id?: string | number; name?: string }>(
  items: T[],
  categories: { category_id: string | number; category_name: string }[]
): T[] {
  const kidsIds = new Set(
    categories
      .filter((c) => isKidsCategoryName(c.category_name) && !isAdultCategoryName(c.category_name))
      .map((c) => String(c.category_id))
  );
  const adultIds = new Set(
    categories.filter((c) => isAdultCategoryName(c.category_name)).map((c) => String(c.category_id))
  );
  return items.filter((i) => {
    // Categoria explicitamente adulta nunca passa, nem se o nome bater
    // com algum título infantil conhecido (evita confusão tipo um remake
    // adulto com nome parecido).
    if (adultIds.has(String(i.category_id))) return false;
    if (kidsIds.has(String(i.category_id))) return true;
    return isKidsTitle(i.name);
  });
}
