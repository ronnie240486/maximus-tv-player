export type ChannelEditorial = {
  eyebrow: string;
  description: string;
  tags: string[];
};

const EDITORIAL: { match: string[]; value: ChannelEditorial }[] = [
  {
    match: ['animal planet'],
    value: {
      eyebrow: 'Natureza e vida selvagem',
      description:
        'Documentários, expedições e histórias sobre animais, seus habitats e a relação entre as pessoas e o mundo natural.',
      tags: ['Animais', 'Natureza', 'Documentários'],
    },
  },
  {
    match: ['discovery'],
    value: {
      eyebrow: 'Ciência, aventura e descoberta',
      description:
        'Séries e documentários que exploram ciência, tecnologia, engenharia, aventura e os mistérios do mundo.',
      tags: ['Ciência', 'Aventura', 'Documentários'],
    },
  },
  {
    match: ['national geographic', 'nat geo', 'natgeo'],
    value: {
      eyebrow: 'Conhecimento e exploração',
      description:
        'Produções sobre ciência, história, cultura, viagens e vida selvagem com imagens de diferentes lugares do planeta.',
      tags: ['Ciência', 'Viagens', 'Natureza'],
    },
  },
  {
    match: ['history'],
    value: {
      eyebrow: 'História e grandes civilizações',
      description:
        'Programas que revisitam acontecimentos, personagens, descobertas e histórias que ajudam a entender o mundo.',
      tags: ['História', 'Biografias', 'Documentários'],
    },
  },
  {
    match: ['cartoon', 'tooncast'],
    value: {
      eyebrow: 'Desenhos e diversão',
      description: 'Animações, aventuras e personagens para a família acompanhar ao longo do dia.',
      tags: ['Infantil', 'Animação', 'Família'],
    },
  },
  {
    match: ['disney'],
    value: {
      eyebrow: 'Histórias para toda a família',
      description: 'Filmes, séries e animações com personagens queridos, aventura, humor e fantasia.',
      tags: ['Infantil', 'Família', 'Animação'],
    },
  },
  {
    match: ['nickelodeon', 'nick jr'],
    value: {
      eyebrow: 'Infantil e pré-escolar',
      description: 'Séries, desenhos e aventuras pensados para crianças e famílias.',
      tags: ['Infantil', 'Animação', 'Família'],
    },
  },
  {
    match: ['sportv', 'sportv'],
    value: {
      eyebrow: 'Esportes ao vivo',
      description: 'Transmissões, notícias e análises dos principais eventos esportivos.',
      tags: ['Esportes', 'Ao vivo', 'Notícias'],
    },
  },
  {
    match: ['espn'],
    value: {
      eyebrow: 'Esportes e competição',
      description: 'Eventos esportivos ao vivo, programas de debate, notícias e análises.',
      tags: ['Esportes', 'Ao vivo', 'Análises'],
    },
  },
  {
    match: ['globo', 'record', 'sbt', 'band'],
    value: {
      eyebrow: 'Programação de televisão',
      description: 'Notícias, entretenimento, séries, novelas e programas para acompanhar a programação ao vivo.',
      tags: ['Variedades', 'Notícias', 'Entretenimento'],
    },
  },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export function getChannelEditorial(channelName: string): ChannelEditorial {
  const normalized = normalize(channelName);
  const found = EDITORIAL.find((entry) => entry.match.some((term) => normalized.includes(normalize(term))));

  return (
    found?.value || {
      eyebrow: 'Canal ao vivo',
      description: 'Acompanhe a programação ao vivo e veja abaixo o que está passando agora neste canal.',
      tags: ['Ao vivo', 'Programação'],
    }
  );
}
