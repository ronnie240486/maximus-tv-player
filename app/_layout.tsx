import { Stack, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { LogBox, StatusBar, View, Text, StyleSheet } from "react-native";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { verifyAppIntegrity } from "@/src/lib/integrity";
import { storage } from "@/src/utils/storage";
import { logSessionEvent } from "@/src/state/debug-log";
import { getXtream } from "@/src/state/session";
import { xtream, liveStreamUrl } from '@/src/lib/xtream';
import { PlayerSessionProvider } from '@/src/state/player-session';

LogBox.ignoreAllLogs(true);

// Mantém a splash nativa visível (a imagem/cor configurada em app.json,
// desenhada pelo SISTEMA antes de qualquer JS rodar) até sabermos que dá
// pra mostrar alguma coisa de verdade — fontes de ícone carregadas e a
// checagem de integridade concluída. Sem isso, a splash nativa some
// assim que o JS começa a executar, mas o RootLayout ainda retorna
// `null` enquanto essas duas coisas resolvem — nesse intervalo (1-2s) a
// tela fica preta/vazia antes da Home aparecer, dando sensação de
// travamento. Precisa ser chamado ANTES do componente montar.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const [loaded, error] = useIconFonts();
  const [integrityOk, setIntegrityOk] = useState<boolean | null>(null);

  useEffect(() => {
    // Marca o instante em que o RootLayout montou de verdade — antes essa
    // chamada ficava no escopo do MÓDULO (fora do componente, antes até
    // do React montar nada), o que rodava antes dos módulos nativos
    // (storage/MMKV) estarem garantidamente prontos — suspeito forte de
    // ter causado o app abrindo e fechando na hora (crash). Dentro de
    // useEffect, só roda depois que o componente já montou de verdade,
    // com tudo inicializado.
    logSessionEvent('startup', 'RootLayout montado').catch(() => {});
  }, []);

  useEffect(() => {
    // Destrava a rotação de forma ativa — o "orientation": "default" no
    // app.json às vezes não é aplicado direito pelo Expo Go logo na
    // abertura (bug conhecido do próprio Expo Go, não é algo do nosso
    // código). Chamar isso programaticamente garante que funcione mesmo
    // quando a config passiva falha.
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  useEffect(() => {
    setIntegrityOk(verifyAppIntegrity().ok);
  }, []);

  useEffect(() => {
    // expo-image não expõe uma forma de checar o TAMANHO atual do cache de
    // imagens em disco (só limpar tudo) — então em vez de "limpa se passar
    // de X MB", limpa por TEMPO: uma vez a cada 7 dias, o suficiente pra
    // não deixar acumular sem limite numa TV box com pouco espaço,
    // silencioso, sem nenhum aviso ou travamento pro usuário.
    const CLEAR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
    const KEY = 'last_image_cache_clear_at';
    (async () => {
      const last = await storage.getItem<number>(KEY, 0);
      const now = Date.now();
      if (!last || now - last > CLEAR_INTERVAL_MS) {
        try {
          await Image.clearDiskCache();
        } catch {}
        await storage.setItem(KEY, now);
      }
    })();
  }, []);

  useEffect(() => {
    // Checa e aplica atualização OTA (código JS/TS novo, sem precisar de
    // build novo) assim que o app abre. Padrão do expo-updates baixa a
    // atualização mas só aplica na PRÓXIMA abertura — sem isso, a pessoa
    // precisaria fechar e abrir o app DUAS vezes pra ver a mudança. Aqui,
    // já baixa e recarrega sozinho na primeira abertura depois de
    // publicada uma atualização nova.
    // Não roda em desenvolvimento (Updates.isEnabled é false no Expo Go /
    // dev build), só em builds de verdade.
    if (!Updates.isEnabled) return;
    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch {
        // Sem internet nesse instante, servidor de update fora do ar,
        // etc. — segue com a versão já instalada normalmente.
      }
    })();
  }, []);

  const ready = (loaded || !!error) && integrityOk !== null;

  useEffect(() => {
    // Antes, a notificação de "hora do jogo" avisava direitinho, mas
    // tocar nela só abria o app na tela de sempre — não tinha nada
    // ligando o toque na notificação a abrir o canal certo. Isso
    // resolve os dois casos possíveis: app já estava rodando (aberto em
    // segundo plano) e app estava totalmente fechado (o toque na
    // notificação é o que abre o app do zero).
    const openStream = async (streamId: number | undefined) => {
      if (!streamId) return;
      const creds = getXtream();
      if (!creds) return;
      try {
        const streams = await xtream.liveStreams(creds);
        const ch = streams?.find((s) => s.stream_id === streamId);
        router.push({
          pathname: '/player',
          params: {
            id: `live-${streamId}`,
            name: ch?.name || 'Jogo',
            stream: liveStreamUrl(creds, streamId, 'm3u8'),
            logo: ch?.stream_icon || '',
          },
        });
      } catch {}
    };

    // Caso 1: app estava fechado, a pessoa tocou na notificação e isso
    // é o que abriu o app agora — pega a última notificação que causou
    // a abertura (se teve alguma).
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content.data;
      const id = (data?.streamId ?? data?.channelId) as number | undefined;
      if (id) openStream(id);
    });

    // Caso 2: app já estava aberto (em primeiro ou segundo plano) e a
    // pessoa tocou na notificação.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const id = (data?.streamId ?? data?.channelId) as number | undefined;
      if (id) openStream(id);
    });

    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    // Corrigido: antes essa chamada ficava direto no corpo do componente
    // (fora de useEffect) e disparava de novo a CADA renderização do
    // RootLayout — inclusive durante navegação normal entre telas, já
    // que ele envolve toda a Stack. Uma chamada nativa real repetida
    // sem parar é pesado o bastante pra travar a navegação inteira numa
    // TV box fraca, e explica o ícone "piscando" (a splash sendo
    // escondida/tentada esconder de novo sem necessidade). Com
    // useEffect + dependência em `ready`, isso roda no máximo UMA vez —
    // exatamente quando `ready` passa de false pra true.
    if (!ready) return;
    logSessionEvent('startup', 'splash escondida, primeira tela real aparece');
    SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!loaded && !error) return null;
  if (integrityOk === null) return null;

  if (!integrityOk) {
    // Pacote diferente do esperado — sinal de que o APK foi clonado e
    // republicado com outro identificador. Não dá detalhe técnico nenhum
    // (nem qual foi o problema), só recusa a abrir.
    return (
      <View style={styles.blockScreen}>
        <Text style={styles.blockText}>Aplicativo não autorizado.</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F1A" />
      <PlayerSessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            animation: "fade",
          }}
        />
      </PlayerSessionProvider>
    </>
  );
}

const styles = StyleSheet.create({
  blockScreen: {
    flex: 1,
    backgroundColor: "#0B0F1A",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  blockText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
});
