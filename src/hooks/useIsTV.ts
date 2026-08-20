import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';

// Cache em memória, válido pro resto da sessão do app — a checagem em si
// (getDeviceTypeAsync) é assíncrona, então sem isso TODA TELA que monta o
// hook nascia com isTV=null (tamanho de celular) por um instante, e só
// alguns milissegundos depois "descobria" que era TV e pulava pro tamanho
// grande — um pisca de layout bem visível, especialmente em elementos
// grandes tipo a sidebar. Uma vez descoberto em QUALQUER tela do app, o
// valor já vem pronto (sem esperar nada) nas telas seguintes.
let cachedIsTV: boolean | null = null;

/**
 * Detecta automaticamente se o app está rodando numa TV box / Android TV,
 * sem precisar perguntar nada ao usuário. Usa o `deviceType` do expo-device,
 * que no Android lê o UI mode do sistema (UI_MODE_TYPE_TELEVISION) — o
 * mesmo sinal que o próprio launcher da TV usa para saber que é uma TV.
 *
 * Fica `null` por um instante no primeiro frame (a checagem é assíncrona);
 * qualquer código que dependa disso deve tratar `null` como "ainda não sei"
 * e não como "não é TV", pra evitar um pisca de layout errado no arranque.
 * Isso só acontece na PRIMEIRA vez em toda a sessão do app — as próximas
 * telas já usam o valor em cache, sem esperar nada.
 */
export function useIsTV(): boolean | null {
  const [isTV, setIsTV] = useState<boolean | null>(cachedIsTV);

  useEffect(() => {
    if (cachedIsTV !== null) return; // já sabe a resposta, nada a fazer
    let mounted = true;
    (async () => {
      if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
        cachedIsTV = false;
        if (mounted) setIsTV(false);
        return;
      }
      try {
        const type = await Device.getDeviceTypeAsync();
        const result = type === Device.DeviceType.TV;
        cachedIsTV = result;
        if (mounted) setIsTV(result);
      } catch {
        cachedIsTV = false;
        if (mounted) setIsTV(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return isTV;
}
