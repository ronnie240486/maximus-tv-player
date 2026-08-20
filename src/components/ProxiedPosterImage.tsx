// Redimensiona pôsteres via backend (Pillow) antes de carregar — um card
// de ~90px de largura não precisa de um pôster de 1000x1500px original.
//
// SEGURANÇA: isso NUNCA pode ser uma dependência dura. Se o backend não
// estiver configurado (EXPO_PUBLIC_BACKEND_URL vazio) ou o endpoint
// falhar/demorar, o app tem que continuar mostrando a imagem original
// exatamente como sempre mostrou — ver ProxiedPosterImage abaixo, que
// cai pra URL original automaticamente em caso de erro.
import React, { useState } from 'react';
import { Image, type ImageProps } from 'expo-image';

import { posterImageProps } from '@/src/lib/image-placeholder';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

/** Monta a URL redimensionada, ou `null` se não houver backend configurado
 * (nesse caso quem chama deve usar a URL original direto, sem proxy). */
export function resizedImageUrl(originalUrl: string, width: number): string | null {
  if (!BACKEND_URL || !originalUrl) return null;
  const w = Math.round(width);
  return `${BACKEND_URL}/api/image-proxy?url=${encodeURIComponent(originalUrl)}&w=${w}`;
}

type ProxiedPosterImageProps = Omit<ImageProps, 'source'> & {
  uri: string | undefined;
  /** Largura alvo em pixels — deve bater com o tamanho real do card na
   * tela (não adianta pedir um pôster maior do que ele vai ocupar). */
  width: number;
};

/**
 * Wrapper do <Image> do expo-image que tenta a versão redimensionada
 * (via backend) primeiro e cai pra URL original automaticamente se essa
 * falhar por qualquer motivo (backend fora do ar, timeout, erro). A
 * pessoa nunca vê um pôster quebrado por causa disso — na pior hipótese,
 * carrega do jeito que sempre carregou (imagem no tamanho original).
 */
export default function ProxiedPosterImage({ uri, width, ...rest }: ProxiedPosterImageProps) {
  const [useOriginal, setUseOriginal] = useState(false);

  if (!uri) return <Image source={undefined} {...posterImageProps} {...rest} />;

  const resized = !useOriginal ? resizedImageUrl(uri, width) : null;
  const finalUri = resized || uri;

  return (
    <Image
      source={{ uri: finalUri }}
      onError={() => {
        // Só tenta cair pra original se AINDA não é a original (evita
        // loop se a própria imagem original também estiver quebrada).
        if (!useOriginal && resized) setUseOriginal(true);
      }}
      {...posterImageProps}
      {...rest}
    />
  );
}
