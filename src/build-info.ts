// Identificador de build — atualizar aqui a cada leva de correções. Usado
// na tela de MAC/login (visível ANTES de logar, pra confirmar rapidinho
// que o APK instalado é o mais novo) e em Configurações > Versão.
export const BUILD_STAMP =
  'build 2026-08-03 (madrugada) — corrige 2 áudios tocando junto no preview ' +
  'de canal da TV, navegação por D-pad até a sidebar (nextFocusLeft), ' +
  'buffer de vídeo maior nos canais ao vivo, categoria trocando de canal ' +
  'sozinha, overscan cortando avatar na tela de Perfis, sidebar/textos ' +
  'maiores na TV, entrada mais rápida nas boas-vindas, lembrete de ' +
  'programação com contagem regressiva de 10s e troca automática de canal, ' +
  'campos do painel (Tela de Bloqueio, Frase de Impacto, Website, etc), ' +
  'URL do teste buscada dinamicamente do painel';

// Versão curta pra mostrar direto na tela, sem precisar tocar em nada —
// só a data/hora, pra bater o olho e já saber se é o build mais recente.
export const BUILD_SHORT = 'build 2026-08-03 madrugada';
