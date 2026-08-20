// Detecção de gênero pra busca por voz ("quero assistir um filme de
// ação") sem depender de IA paga. Dois problemas reais:
//
// 1. A API do Xtream só devolve o campo "genre" no DETALHE de cada título
//    (uma chamada de rede por filme/série) — impossível checar isso pra
//    milhares de itens de uma vez só, então não dá pra confiar nisso pra
//    filtrar o catálogo inteiro.
// 2. Muitos painéis organizam Filmes/Séries por PLATAFORMA (Netflix,
//    Amazon, Disney+...) em vez de por gênero — então nem sempre existe
//    uma categoria "Ação" pra filtrar.
//
// Solução (mesmo padrão já usado pro conteúdo infantil em
// adult-content.ts): bate o nome de cada item contra uma lista de
// filmes/séries CONHECIDOS daquele gênero — funciona sem chamada de rede
// extra nenhuma, usando só o catálogo que a tela já carregou. Não é uma
// lista completa (impossível cobrir tudo) — pega os títulos mais
// conhecidos/procurados de cada gênero, e ainda tenta bater com o nome
// da categoria também (pra quando o painel tiver categoria por gênero).

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export type GenreKey =
  | 'acao'
  | 'comedia'
  | 'terror'
  | 'romance'
  | 'ficcao'
  | 'animacao'
  | 'drama'
  | 'suspense'
  | 'aventura'
  | 'documentario';

// Palavras que a pessoa pode falar, mapeadas pro gênero interno.
const VOICE_GENRE_WORDS: Record<GenreKey, string[]> = {
  acao: ['acao', 'action'],
  comedia: ['comedia', 'comedy', 'engracado', 'engraçado'],
  terror: ['terror', 'horror', 'medo', 'assombra'],
  romance: ['romance', 'romantico', 'amor'],
  ficcao: ['ficcao cientifica', 'ficcao', 'sci-fi', 'sci fi'],
  animacao: ['animacao', 'animado', 'desenho'],
  drama: ['drama'],
  suspense: ['suspense', 'thriller'],
  aventura: ['aventura', 'adventure'],
  documentario: ['documentario', 'documentary'],
};

// Palavras que costumam aparecer no NOME DA CATEGORIA quando o painel
// organiza por gênero (nem todo painel faz isso, mas quando faz, é a
// forma mais confiável).
const CATEGORY_KEYWORDS: Record<GenreKey, string[]> = {
  acao: ['acao', 'action'],
  comedia: ['comedia', 'comedy'],
  terror: ['terror', 'horror'],
  romance: ['romance', 'romantic'],
  ficcao: ['ficcao cientifica', 'sci-fi', 'sci fi', 'ficcao'],
  animacao: ['animacao', 'animation', 'infantil', 'kids'],
  drama: ['drama'],
  suspense: ['suspense', 'thriller'],
  aventura: ['aventura', 'adventure'],
  documentario: ['documentario', 'documentary'],
};

// Títulos/franquias bem conhecidos por gênero — usado pra reconhecer o
// item mesmo quando está numa categoria organizada por plataforma
// (Netflix/Amazon/etc), sem gênero nenhum no nome da categoria. Lista
// deliberadamente enxuta nos clássicos/franquias mais óbvios de cada
// gênero — não tenta ser exaustiva.
const TITLE_HINTS: Record<GenreKey, string[]> = {
  acao: [
    'velozes e furiosos', 'fast and furious', 'john wick', 'missao impossivel',
    'mission impossible', 'duro de matar', 'die hard', 'rambo', 'mad max',
    'vingadores', 'avengers', 'homem de ferro', 'iron man', 'capitao america',
    'batman', 'superman', 'liga da justica', 'justice league', 'transformers',
    'jason bourne', 'bourne', 'james bond', '007', 'agente 007', 'gladiador',
    'gladiator', 'kill bill', 'equalizer', 'esquadrao suicida', 'suicide squad',
    'sem limite', 'extraction', 'rapidos e furiosos', 'homem aranha', 'spider-man',
    'wolverine', 'x-men', 'top gun', 'expendables', 'mercenarios',
  ],
  comedia: [
    'se beber nao case', 'hangover', 'superbad', 'ted', 'zoolander',
    'meu malvado favorito', 'minions', 'shrek', 'esposa de mentirinha',
    'todo mundo em panico', 'scary movie', 'debi e loide', 'dumb and dumber',
    'entre amigos', 'as branquelas', 'white chicks', 'a familia buscape',
    'programa de proteção as loiras', 'legalmente loira', 'legally blonde',
    'meu primeiro amor', 'como perder um homem em 10 dias', 'noiva em fuga',
    'senhor e senhora smith', 'pantera cor de rosa', 'pink panther',
    'austin powers', 'jumanji', 'homem aranha 2', 'divertida mente',
  ],
  terror: [
    'invocacao do mal', 'conjuring', 'annabelle', 'sobrenatural', 'insidious',
    'atividade paranormal', 'paranormal activity', 'expresso do amanha',
    'freddy krueger', 'pesadelo em elm street', 'sexta feira 13',
    'friday the 13th', 'halloween michael myers', 'pânico', 'scream',
    'it a coisa', 'it the movie', 'exorcista', 'exorcist', 'sinister',
    'hereditario', 'hereditary', 'a bruxa', 'the witch', 'corra', 'get out',
    'nos', 'us jordan peele', 'chucky', 'brinquedo assassino', 'jogos mortais',
    'saw', 'texas chainsaw', 'massacre da serra', 'quarantena', 'rec filme',
    'zumbi', 'zombie', 'guerra mundial z', 'world war z',
  ],
  romance: [
    'titanic', 'diario de uma paixao', 'notebook', 'orgulho e preconceito',
    'pride and prejudice', 'como eu era antes de voce', 'me before you',
    'a culpa e das estrelas', 'fault in our stars', 'crepusculo', 'twilight',
    'cinquenta tons de cinza', 'fifty shades', 'la la land', 'simplesmente amor',
    'love actually', 'diario de bridget jones', 'bridget jones', 'coração de melão',
    'um lugar chamado notting hill', 'notting hill', 'ghost do outro lado da vida',
  ],
  ficcao: [
    'interestelar', 'interstellar', 'matrix', 'blade runner', 'duna', 'dune',
    'star wars', 'guerra nas estrelas', 'jornada nas estrelas', 'star trek',
    'jurassic park', 'jurassic world', 'homem de ferro', 'transformers',
    'ex machina', 'chegada', 'arrival', 'gravidade', 'gravity', 'marciano',
    'the martian', 'origem', 'inception', 'planeta dos macacos', 'planet of the apes',
    'exterminador do futuro', 'terminator', 'robocop', 'edge of tomorrow',
    'no limite do amanha', 'divergente', 'divergent', 'jogos vorazes', 'hunger games',
  ],
  animacao: [
    'shrek', 'toy story', 'carros', 'cars pixar', 'procurando nemo', 'finding nemo',
    'divertida mente', 'inside out', 'up altas aventuras', 'valente', 'brave',
    'frozen', 'moana', 'vaiana', 'enrolados', 'tangled', 'coco pixar',
    'como treinar seu dragao', 'kung fu panda', 'madagascar', 'era do gelo',
    'ice age', 'zootopia', 'ralph', 'lego filme', 'lego movie', 'sing',
    'meu malvado favorito', 'minions', 'croods', 'monstros sa',
  ],
  drama: [
    'um sonho possivel', 'preciosa', 'clube da luta', 'fight club', 'forrest gump',
    'um limite entre nos', 'green book', 'foxcatcher', 'spotlight', 'moonlight',
    'la la land', 'coringa', 'joker', 'parasita', 'parasite', 'roma filme',
    'manchester a beira mar', 'manchester by the sea', 'lutero', 'invictus',
    'doze anos de escravidao', '12 years a slave', 'rei leao', 'lion king',
  ],
  suspense: [
    'garota exemplar', 'gone girl', 'clube da luta', 'sexto sentido',
    'sixth sense', 'seven', 'se7en', 'silencio dos inocentes', 'silence of the lambs',
    'psicopata americano', 'american psycho', 'la origem do mal', 'shutter island',
    'ilha do medo', 'prisioneiros', 'prisoners', 'garota da capa vermelha',
    'antes que o mundo acabe', 'nightcrawler', 'menina que roubava livros',
  ],
  aventura: [
    'indiana jones', 'piratas do caribe', 'pirates of the caribbean',
    'jumanji', 'jornada nas estrelas', 'senhor dos aneis', 'lord of the rings',
    'hobbit', 'percy jackson', 'as cronicas de narnia', 'narnia',
    'viagem ao centro da terra', 'a bussola de ouro', 'golden compass',
    'homem que conhecia infinito', 'life of pi', 'vida de pi',
  ],
  documentario: [
    'planeta terra', 'planet earth', 'nosso planeta', 'our planet',
    'formula 1 drive to survive', 'the last dance', 'making a murderer',
    'tiger king', 'meu polvo professor', 'my octopus teacher',
  ],
};

/** Reconhece um pedido tipo "quero assistir um filme de ação" e devolve o
 * gênero detectado, ou null se a frase não parecer um pedido de gênero
 * (nesse caso, a busca por voz continua funcionando como busca de título
 * normal, sem mudar nada). */
export function detectVoiceGenre(transcript: string): GenreKey | null {
  const n = normalize(transcript);
  for (const [genre, words] of Object.entries(VOICE_GENRE_WORDS)) {
    if (words.some((w) => n.includes(w))) return genre as GenreKey;
  }
  return null;
}

/** Reconhece um pedido tipo "me dê uma série igual a Tulsa King" / "um
 * filme parecido com Duna" e devolve o TÍTULO DE REFERÊNCIA (ex: "Tulsa
 * King") — null se a frase não seguir esse padrão. Checado ANTES de
 * detectVoiceGenre na busca por voz, porque "uma série de ação igual a
 * X" deveria priorizar o título de referência (mais específico) sobre
 * só o gênero solto.
 */
export function detectSimilarToRequest(transcript: string): string | null {
  // Aceita várias formas de conectivo que a pessoa pode falar antes do
  // título de referência — "igual A", "igual DE" (como em "igual de
  // volta pro futuro"), "que nem", etc. Antes só aceitava "igual a/ao/à"
  // explicitamente, perdendo frases bem naturais em português.
  const match = transcript.match(
    /(?:igual\s+(?:a|ao|à|de)?|parecid[oa]\s+com|que\s+nem|tipo|no\s+estilo\s+de)\s+(.+)$/i
  );
  if (!match) return null;
  const title = match[1].trim().replace(/[?.!]+$/, '');
  return title.length >= 2 ? title : null;
}

export const GENRE_LABELS: Record<GenreKey, string> = {
  acao: 'Ação',
  comedia: 'Comédia',
  terror: 'Terror',
  romance: 'Romance',
  ficcao: 'Ficção científica',
  animacao: 'Animação',
  drama: 'Drama',
  suspense: 'Suspense',
  aventura: 'Aventura',
  documentario: 'Documentário',
};

/** Quantos gêneros diferentes o nome de uma categoria bate ao mesmo tempo
 * — usado pra detectar categoria "combinada" tipo "Ação/Aventura" ou
 * "Ação e Comédia", comum em painel de IPTV. Uma categoria assim não dá
 * pra confiar pra NENHUM dos dois gêneros por categoria (senão todo item
 * dela aparecia em ambas as buscas, mesmo sendo só de um gênero de
 * verdade) — nesses casos, só o match por título conhecido continua
 * valendo. */
function countMatchingGenres(normalizedCategoryName: string): number {
  let count = 0;
  for (const keywords of Object.values(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => normalizedCategoryName.includes(kw))) count++;
  }
  return count;
}

function itemMatchesGenre(name: string, categoryName: string | undefined, genre: GenreKey): boolean {
  const nName = normalize(name);
  const nCat = categoryName ? normalize(categoryName) : '';
  if (nCat && countMatchingGenres(nCat) === 1 && CATEGORY_KEYWORDS[genre].some((kw) => nCat.includes(kw))) {
    return true;
  }
  return TITLE_HINTS[genre].some((kw) => nName.includes(kw));
}

/** Filtra uma lista de itens (filmes OU séries, ambos têm `name` +
 * `category_id`) pelo gênero detectado — junta o que bater por categoria
 * com o que bater por título conhecido. */
export function filterByGenre<T extends { name: string; category_id?: string }>(
  items: T[],
  categories: { category_id: string; category_name: string }[],
  genre: GenreKey
): T[] {
  const catNameById = new Map(categories.map((c) => [c.category_id, c.category_name]));
  return items.filter((item) => itemMatchesGenre(item.name, item.category_id ? catNameById.get(item.category_id) : undefined, genre));
}

/** Sorteia `count` itens aleatórios de uma lista (usado pro "outras
 * sugestões" — mesma lista já filtrada, ordem diferente cada vez). */
export function shuffleSample<T>(list: T[], count: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
