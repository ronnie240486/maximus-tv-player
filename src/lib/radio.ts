// Radio Browser (radio-browser.info) — diretório público e gratuito de
// rádios ao vivo pela internet. Dados em domínio público, sem chave de API.
// Usamos o endpoint "all.api" que faz round-robin entre os servidores
// espelhados do projeto, então não dependemos de um único servidor no ar.

// "all.api" é um DNS round-robin entre os servidores espelhados do
// projeto — na maioria das redes funciona bem, mas em algumas (mais comum
// em TV box, com DNS/roteador mais restritivo) a resolução desse domínio
// específico falha mesmo com internet normal funcionando pra tudo mais.
// Por isso mantemos espelhos fixos como alternativa.
const MIRRORS = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

async function fetchJson(path: string): Promise<any> {
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(`${mirror}${path}`, {
        headers: { 'User-Agent': 'MaximusPlayer/1.0' },
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // Esse espelho falhou (DNS, timeout, etc.) — tenta o próximo antes
      // de desistir de vez.
    }
  }
  return null;
}

export type RadioStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  favicon?: string;
  tags?: string;
  country?: string;
  bitrate?: number;
  clickcount?: number;
  lastcheckok?: number;
};

export type RadioCategory = {
  key: string;
  label: string;
  // Uma ou mais tags da Radio Browser a tentar, em ordem — usamos a
  // primeira que trouxer resultado suficiente.
  tags: string[];
  // Quando definido, filtra por país em vez de tag (ex: "BR" pra rádios
  // brasileiras conhecidas tipo Jovem Pan, Nova Brasil etc).
  countryCode?: string;
};

export const RADIO_CATEGORIES: RadioCategory[] = [
  { key: 'popular', label: 'Populares', tags: [] }, // sem tag = ordena por mais tocadas
  { key: 'nacionais', label: 'Nacionais', tags: [], countryCode: 'BR' },
  { key: 'rock', label: 'Rock', tags: ['rock', 'classic rock', 'rock nacional', 'rock brasileiro'] },
  { key: 'hardrock', label: 'Hard Rock', tags: ['hard rock', 'hardrock', 'heavy metal', 'metal'] },
  { key: 'pop', label: 'Pop', tags: ['pop'] },
  { key: 'sertanejo', label: 'Sertanejo', tags: ['sertanejo'] },
  // Gospel: várias tags diferentes cobrem esse gênero na Radio Browser
  // (nem toda rádio cristã usa exatamente a palavra "gospel") — juntando
  // todas (não só a primeira que der resultado) traz bem mais estações.
  {
    key: 'gospel',
    label: 'Gospel',
    tags: ['gospel', 'christian', 'crista', 'louvor', 'igreja', 'evangelica'],
    countryCode: 'BR',
  },
  // Esportes: cobre notícia/comentário esportivo (ex: rádios tipo Bandsports,
  // Jovem Pan Esportes, ESPN rádio) — bem diferente de rádios de música.
  {
    key: 'esportes',
    label: 'Esportes',
    tags: ['sports', 'sport', 'esporte', 'esportes', 'futebol'],
    countryCode: 'BR',
  },
  { key: 'classicos', label: 'Clássicos', tags: ['oldies', 'classic hits'] },
  { key: 'internacionais', label: 'Internacionais', tags: ['top 40', 'english'] },
];

function dedupeStations(list: RadioStation[]): RadioStation[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = s.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// `hidebroken=true` sozinho não é suficiente — é um filtro mais antigo/
// permissivo. `lastcheckok=true` é mais rigoroso: exige que a ÚLTIMA
// checagem de conectividade da Radio Browser (eles testam as rádios
// periodicamente de verdade) tenha dado certo. Mesmo assim, confere de
// novo no lado do app (lastcheckok !== 0) — não custa nada e é uma
// segunda camada de proteção caso o filtro do servidor falhe silencioso.
function isLikelyWorking(s: RadioStation): boolean {
  if (!(s.url_resolved || s.url)) return false;
  if (s.lastcheckok === 0) return false;
  return true;
}

/** Busca estações de uma categoria — antes parava na PRIMEIRA tag que
 * desse algum resultado (perdendo estações das outras tags à toa); agora
 * busca todas as tags em paralelo e JUNTA tudo (sem duplicar), trazendo
 * bem mais estações por categoria. */
export async function fetchStationsByCategory(cat: RadioCategory, limit = 100): Promise<RadioStation[]> {
  // Categoria "Populares"/"Nacionais": sem tag, só país (ou nada).
  if (cat.tags.length === 0) {
    const url = cat.countryCode
      ? `/json/stations/search?countrycode=${cat.countryCode}&limit=${limit}&hidebroken=true&lastcheckok=true&order=clickcount&reverse=true`
      : `/json/stations/search?limit=${limit}&hidebroken=true&lastcheckok=true&order=clickcount&reverse=true`;
    const json = await fetchJson(url);
    return dedupeStations((json || []).filter(isLikelyWorking));
  }

  // Tag(s) + país (ex: gospel/esportes + Brasil) — busca TODAS as tags em
  // paralelo e junta os resultados, em vez de parar na primeira que
  // trouxer algo.
  const fetchAllTags = async (withCountry: boolean): Promise<RadioStation[]> => {
    const results = await Promise.all(
      cat.tags.map((tag) => {
        const url =
          withCountry && cat.countryCode
            ? `/json/stations/search?tag=${encodeURIComponent(tag)}&countrycode=${cat.countryCode}&limit=${limit}&hidebroken=true&lastcheckok=true&order=clickcount&reverse=true`
            : `/json/stations/bytag/${encodeURIComponent(tag)}?limit=${limit}&hidebroken=true&lastcheckok=true&order=clickcount&reverse=true`;
        return fetchJson(url).then((json) => (json || []) as RadioStation[]);
      })
    );
    return dedupeStations(results.flat().filter(isLikelyWorking));
  };

  if (cat.countryCode) {
    const withCountry = await fetchAllTags(true);
    // Cruzar com país às vezes traz pouca coisa (nem toda rádio cristã/
    // esportiva do Brasil está corretamente marcada com countrycode=BR
    // na Radio Browser) — complementa com a busca sem país, mantendo o
    // que já achou primeiro (dedupeStations tira as repetidas).
    if (withCountry.length < 15) {
      const withoutCountry = await fetchAllTags(false);
      return dedupeStations([...withCountry, ...withoutCountry]);
    }
    return withCountry;
  }

  return fetchAllTags(false);
}

/** Busca por nome — usada pela lupa de pesquisa da tela de Rádios. */
export async function searchStationsByName(query: string, limit = 60): Promise<RadioStation[]> {
  const url = `/json/stations/search?name=${encodeURIComponent(query)}&limit=${limit}&hidebroken=true&lastcheckok=true&order=clickcount&reverse=true`;
  const json = await fetchJson(url);
  return dedupeStations((json || []).filter(isLikelyWorking));
}

export function radioStreamUrl(s: RadioStation): string {
  return s.url_resolved || s.url;
}
