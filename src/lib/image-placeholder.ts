// Placeholder visual pros pôsteres/capas enquanto a imagem real carrega.
//
// O painel Xtream não manda um blurhash calculado por imagem (isso
// precisaria ser gerado a partir do arquivo original, coisa que exigiria
// processamento — no cliente seria lento, no servidor exigiria mudar o
// painel, que não é nosso). Então isso aqui é um blurhash FIXO — um
// cinza-azulado suave, combinando com o tema escuro do app — não estima
// a cor real de cada pôster individualmente, mas já resolve o problema
// que motivou o pedido: em vez de "nada (preto) → estoura a imagem", vira
// "cinza suave → esmaece pra imagem", sensação de carregamento bem mais
// leve mesmo sem o dado por-imagem.
export const POSTER_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// Props prontas pra passar num <Image> do expo-image em qualquer poster/
// capa da lista — mantém consistência (mesmo placeholder, mesma
// transição) sem repetir os três props em cada tela.
export const posterImageProps = {
  placeholder: { blurhash: POSTER_BLURHASH },
  placeholderContentFit: 'cover' as const,
  transition: 200,
};
