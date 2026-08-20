import { useCallback, useEffect, useRef } from 'react';
import { Image } from 'expo-image';

import { useIsLowEndDevice } from '@/src/hooks/useIsLowEndDevice';

// Enquanto a pessoa rola a lista, pré-carrega os pôsteres que estão logo
// ABAIXO da área visível (ainda não apareceram na tela) — quando eles
// finalmente entrarem na tela, a imagem já está no cache (memória+disco)
// e aparece na hora, sem o soquinho de carregamento.
//
// Genérico o bastante pra servir Movies, Series e Channels (cada um passa
// sua própria função de extrair a URL do item).
export function useListImagePrefetch<T>(
  data: T[],
  getUrl: (item: T) => string | undefined,
  aheadCount = 20
) {
  // Em TV box fraca, o prefetch acontece EXATAMENTE durante o momento em
  // que a pessoa está navegando com o D-pad (é disparado pelo próprio
  // scroll) — competir por CPU/rede bem ali é pior do que ajudar, porque
  // rouba processamento justo da hora que precisa responder rápido ao
  // controle remoto. Em aparelho fraco, prefere ficar quieto: sem
  // prefetch nenhum (as imagens ainda carregam normal quando aparecem na
  // tela, só perde o "já pronto antes de chegar" — troca aceitável).
  const isLowEndDevice = useIsLowEndDevice();
  // Ref em vez de depender direto de `data` no useCallback — evita que a
  // IDENTIDADE da função onViewableItemsChanged mude a cada render (o
  // FlashList v2 se beneficia de props estáveis; ver docs do Shopify).
  const dataRef = useRef(data);
  dataRef.current = data;

  // Só dispara prefetch quando o scroll AVANÇA pra um índice mais alto
  // que o já visto — sem isso, rolar pra cima e pra baixo repetidamente
  // dispararia Image.prefetch das mesmas URLs várias vezes à toa.
  const lastMaxIndex = useRef(-1);
  useEffect(() => {
    lastMaxIndex.current = -1;
  }, [data]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (isLowEndDevice) return;
      const indices = viewableItems
        .map((v) => v.index)
        .filter((i): i is number => typeof i === 'number');
      if (indices.length === 0) return;
      const maxIndex = Math.max(...indices);
      if (maxIndex <= lastMaxIndex.current) return;
      lastMaxIndex.current = maxIndex;

      const nextUrls = dataRef.current
        .slice(maxIndex + 1, maxIndex + 1 + aheadCount)
        .map(getUrl)
        .filter((u): u is string => !!u);

      if (nextUrls.length > 0) {
        Image.prefetch(nextUrls, 'memory-disk').catch(() => {});
      }
    },
    [aheadCount, getUrl, isLowEndDevice]
  );

  // Objeto estável (criado uma vez) — o FlashList/FlatList não suporta
  // trocar viewabilityConfig em tempo real, então precisa ser sempre a
  // MESMA referência entre renders.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;

  return { onViewableItemsChanged, viewabilityConfig };
}
