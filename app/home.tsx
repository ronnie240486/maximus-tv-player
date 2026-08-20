import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ImageBackground,
  ActivityIndicator,
  ScrollView,
  Alert,
  useWindowDimensions,
  findNodeHandle,
  BackHandler,
  ToastAndroid,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
// Carregado sob demanda (não no topo) — ver comentário dentro do
// componente pra entender por quê. Só é avaliado quando o Suspense abaixo
// tenta renderizá-lo pela primeira vez, depois que a Home já pintou.
const VoiceSearchButton = React.lazy(() => import('@/src/components/VoiceSearchButton'));

import { colors, spacing } from '@/src/theme';
import { posterImageProps } from '@/src/lib/image-placeholder';
import { getDeviceMac } from '@/src/lib/device';
import { loadSession, saveSession, getSession, getXtream, getActivePlaylistIndex, setActivePlaylistIndex, clearSession } from '@/src/state/session';
import { checkMac } from '@/src/api/client';
import { setActiveProfileId } from '@/src/state/active-profile';
import { loadHomeCache, saveHomeCache, loadFeaturedCache, saveFeaturedCache, clearHomeCache } from '@/src/state/home-cache';
import { loadListCache, saveListCache } from '@/src/state/list-cache';
import { loadWatchHistory } from '@/src/state/watch-history';
import { popDueReminders } from '@/src/state/game-reminders';
import { logSessionEvent, logSessionEventFast } from '@/src/state/debug-log';
import { popDueProgramReminders, ProgramReminder } from '@/src/state/program-reminders';
import ProgramReminderPopup from '@/src/components/ProgramReminderPopup';
import { isAdultCategoryName, filterToKidsItems } from '@/src/lib/adult-content';
import { isActiveProfileKids } from '@/src/state/profiles';
import { dedupeByName } from '@/src/lib/dedupe';
import { useParentalGate } from '@/src/lib/use-parental-gate';
import { loadFavorites, toggleFavorite } from '@/src/state/favorites';
import ClockWeather from '@/src/components/ClockWeather';
import TVFocusable from '@/src/components/TVFocusable';
import { useIsTV } from '@/src/hooks/useIsTV';
import NetInfo from '@react-native-community/netinfo';
import { getListPerfProps, useIsLowEndDevice } from '@/src/hooks/useIsLowEndDevice';

// Calculado uma vez só (não é hook, é função pura) — todas as fileiras da
// Home reaproveitam o mesmo resultado em vez de recalcular a cada uma.
const homeRowListPerf = getListPerfProps(8);
import {
  xtream,
  parsePlaylistUrl,
  liveStreamUrl,
  movieStreamUrl,
  XtreamLive,
  XtreamMovie,
  XtreamSeries,
  XtreamVodInfo,
  getLastXtreamError,
} from '@/src/lib/xtream';

type NavItem = {
  key: string;
  icon: React.ReactNode;
  testID: string;
  onPress?: () => void;
};

type HomeItem = {
  id: string;
  name: string;
  logo?: string;
  stream: string;
  circular?: boolean;
  seriesId?: number;
  cover?: string;
};

type Section = { title: string; items: HomeItem[] };

// Um filme ou série na fileira de destaque — tipo unificado porque a UI
// (banner, botões) é a mesma pra ambos, só muda de onde vem a info extra.
type FeaturedEntry = {
  kind: 'movie' | 'series';
  id: number;
  name: string;
  cover?: string;
};

export default function HomeScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const { modal: parentalModal, guard } = useParentalGate();
  const params = useLocalSearchParams<{ profileId?: string; profileName?: string }>();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Segunda camada de segurança — já setamos isso na tela de perfis antes
  // de navegar pra cá, mas garantir de novo aqui evita qualquer cenário de
  // remontagem/hot-reload deixando o perfil "errado" ativo.
  if (params.profileId) {
    setActiveProfileId(params.profileId);
  }

  const [mac, setMac] = useState('');
  const [dueProgramReminder, setDueProgramReminder] = useState<ProgramReminder | null>(null);
  const onWatchProgramReminder = useCallback(
    (r: ProgramReminder) => {
      setDueProgramReminder(null);
      router.push({
        pathname: '/channel-details',
        params: { id: String(r.channelId), name: r.channelName, cover: r.channelCover || '' },
      });
    },
    [router]
  );
  // Evita chamar checkMac() de novo se a última checagem foi há pouco
  // tempo — sem isso, TODA vez que a Home ganha foco (inclusive voltando
  // de Filmes/Séries/Canais) disparava uma chamada de rede nova, o que
  // pesava na sensação de navegação lenta, principalmente em TV box com
  // rede mais fraca.
  const lastFocusCheckRef = React.useRef(0);

  useEffect(() => {
    // Banner discreto de "sem internet" — a tela já usa cache (stale-
    // while-revalidate) quando a rede falha, então isso não muda o
    // comportamento, só avisa visualmente o que já está acontecendo (por
    // que os dados podem estar desatualizados agora).
    const unsub = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false);
    });
    return unsub;
  }, []);
  // Keyed slots instead of a flat array so each section can be filled in
  // independently as its own fetch resolves, without waiting on the others.
  const [slots, setSlots] = useState<{
    live?: Section;
    movies?: Section;
    series?: Section;
  }>({});
  // Deliberately NOT part of `slots`/home-cache — continue-watching reflects
  // live local watch-history, never a stale disk snapshot, and keeping it
  // fully separate means the cache-restore logic below can never clobber it
  // (that was the actual bug before: a single merged object let a slightly
  // later cache-restore silently overwrite whatever this had just set).
  const [continueWatching, setContinueWatching] = useState<Section | undefined>(undefined);
  // "Lançamentos em destaque" — os primeiros itens da lista de filmes
  // (o painel normalmente lista adições recentes primeiro), guardados como
  // objetos completos (não convertidos pra HomeItem) porque essa fileira
  // precisa de botões extras (trailer/favoritar) que os outros não têm.
  const [featured, setFeatured] = useState<FeaturedEntry[]>([]);
  const [featuredFavIds, setFeaturedFavIds] = useState<Set<string>>(new Set());
  const [bg, setBg] = useState<string | undefined>();
  const [isOffline, setIsOffline] = useState(false);
  // Se a URL da imagem de fundo do painel vier preenchida mas FALHAR ao
  // carregar (link assinado vencido, servidor de imagem fora do ar, etc.),
  // sem isso a tela ficava sem fundo nenhum — nunca caía pro padrão porque
  // `bg` continuava "preenchido" (só que quebrado). Reseta toda vez que a
  // URL muda, pra dar uma nova chance de carregar.
  const [bgFailed, setBgFailed] = useState(false);
  useEffect(() => {
    setBgFailed(false);
  }, [bg]);
  const [logo, setLogo] = useState<string | undefined>();
  const [appName, setAppName] = useState<string>('Maximus Player');
  // Only show the full-screen spinner when there's nothing to paint yet
  // (no cache, first section still pending). Once anything is on screen —
  // cached or freshly fetched — we never block the UI again.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<string>('home');

  const sections = React.useMemo(() => {
    const order: Section[] = [];
    if (continueWatching) order.push(continueWatching);
    if (slots.live) order.push(slots.live);
    if (slots.movies) order.push(slots.movies);
    if (slots.series) order.push(slots.series);
    return order;
  }, [continueWatching, slots]);

  // Continue-watching is local-only (no network) and can change any time the
  // person comes back from the player, so refresh it on every focus instead
  // of only on first mount like the network-backed sections below.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        // Roda em TODA vez que a tela ganha foco (não só quando abre o
        // app) — por isso a checagem de bloqueio/lista removida precisa
        // estar aqui também, não só no load() inicial. Sem isso, "Continue
        // assistindo" continuava tocando vídeo mesmo com o MAC bloqueado
        // ou a lista removida no painel, porque ele nunca perguntava de
        // novo pro painel, só usava o link salvo no celular.
        const creds = getXtream();
        if (creds) {
          const session = getSession();
          if (session?.status === 'Teste') {
            // Conta de teste (gerada pelo botão TESTE) não existe no
            // painel principal — perguntar pra ele sempre diria "não
            // autorizado" e derrubaria o teste na hora. Em vez disso, só
            // confere se o prazo do teste já passou, localmente.
            const expiresAt = session.expire_date ? new Date(session.expire_date) : null;
            if (expiresAt && !isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
              await clearSession();
              await clearHomeCache();
              router.replace('/');
              return;
            }
          } else {
            const now = Date.now();
            if (now - lastFocusCheckRef.current < 45000) {
              // Checou o painel há menos de 45s — pula essa verificação
              // dessa vez, evita bater na rede toda hora só por navegar
              // pra frente e voltar entre as telas.
            } else {
              lastFocusCheckRef.current = now;
              const m = await getDeviceMac();
              if (cancelled) return;
              const fresh = await checkMac(m);
              if (cancelled) return;
              const isRealResponse = fresh.message !== 'Falha de conexão.';
              if (isRealResponse) {
                const stillHasThisPlaylist = (fresh.playlists || []).some((p) => {
                  const parsed = parsePlaylistUrl(p.url);
                  return !!parsed && parsed.username === creds.username && parsed.server === creds.server;
                });
                if (!fresh.authorized || !stillHasThisPlaylist) {
                  await clearSession();
                  await clearHomeCache();
                  router.replace('/');
                  return;
                }
              }
            }
          }
        }

        loadWatchHistory().then((history) => {
          setContinueWatching(
            history.length
              ? {
                  title: 'CONTINUE ASSISTINDO',
                  items: history.slice(0, 15).map((h) => ({
                    id: `continue-${h.id}`,
                    name: h.name,
                    logo: h.logo,
                    stream: h.stream,
                  })),
                }
              : undefined
          );
        });
        popDueReminders().then((due) => {
          due.forEach((r) => {
            Alert.alert(
              'Hora do jogo!',
              `${r.name} está começando agora. Quer abrir a lista de canais pra encontrar a transmissão?`,
              [
                { text: 'Agora não', style: 'cancel' },
                { text: 'Abrir canais', onPress: () => router.push({ pathname: '/channels', params: { initialQuery: r.league || '' } }) },
              ]
            );
          });
        });
        // Lembretes de programação de TV (canal já conhecido, diferente dos
        // jogos acima) — mostra o popup com contagem regressiva de 10s em
        // vez de um Alert simples, e muda de canal sozinho se a pessoa não
        // fizer nada.
        popDueProgramReminders().then((due) => {
          if (due.length) setDueProgramReminder(due[0]);
        });
        loadFavorites().then((list) => {
          setFeaturedFavIds(new Set(list.filter((f) => f.kind === 'movie' || f.kind === 'series').map((f) => f.id)));
        });
      })();
      return () => {
        cancelled = true;
      };
    }, [router])
  );

  // "Aperta voltar de novo pra sair" — padrão esperado em qualquer app
  // Android, principalmente em TV box (onde não existe gesto de "ir pra
  // home", só o botão voltar do controle). Sem isso, não tinha jeito
  // nenhum de fechar o app pelo controle remoto. Só fica ativo com a
  // Home em foco (useFocusEffect) — nas outras telas, o botão voltar
  // continua navegando pra tela anterior normalmente.
  const lastBackPress = useRef(0);
  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const now = Date.now();
        if (now - lastBackPress.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastBackPress.current = now;
        if (Platform.OS === 'android') {
          ToastAndroid.show('Aperte voltar de novo para sair', ToastAndroid.SHORT);
        }
        return true;
      });
      return () => sub.remove();
    }, [])
  );

  const isLowEndDevice = useIsLowEndDevice();

  const load = useCallback(async () => {
    logSessionEvent('home-load', 'inicio');
    const [m, session, cache, featuredCache] = await Promise.all([
      getDeviceMac(),
      loadSession(),
      loadHomeCache(),
      loadFeaturedCache(),
    ]);
    logSessionEvent('home-load', `mac/sessao/cache local prontos (tinha cache: ${!!cache?.sections})`);
    setMac(m);
    setBg(session?.bg_url);
    setLogo(session?.logo_url);
    setAppName(session?.app_name || 'Maximus Player');

    // Stale-while-revalidate: paint whatever we had last time immediately,
    // then keep loading in the background and swap in fresh data per
    // section as it arrives. No spinner if we already have something to show.
    if (cache?.sections) {
      setSlots((prev) => ({ ...prev, ...(cache.sections as { live?: Section; movies?: Section; series?: Section }) }));
      setLoading(false);
    }
    if (featuredCache && featuredCache.length > 0) {
      setFeatured(featuredCache as FeaturedEntry[]);
    }

    const creds = getXtream();
    if (!creds) {
      if (!cache?.sections) {
        setSlots({});
        setLoading(false);
      }
      return;
    }

    // Sessão de teste: não existe no painel principal, então perguntar pra
    // ele sempre voltaria "não autorizado". Só confere localmente se o
    // prazo do teste já venceu.
    if (session?.status === 'Teste') {
      const expiresAt = session.expire_date ? new Date(session.expire_date) : null;
      if (expiresAt && !isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
        await clearSession();
        await clearHomeCache();
        router.replace('/');
        return;
      }
    } else {
      // A confirmação do painel não pode bloquear a primeira pintura da Home.
      // O conteúdo salvo em cache e as listas atuais devem aparecer primeiro;
      // a validação segue em segundo plano e só remove a sessão se houver uma
      // resposta real de bloqueio. Isso evita que o D-pad fique sem responder
      // enquanto a TV Box espera a rede do painel.
      void checkMac(m)
        .then(async (fresh) => {
          logSessionEvent('home-load', `checkMac em segundo plano: ${fresh.message}`);
          const isRealResponse = fresh.message !== 'Falha de conexão.';
          if (isRealResponse && !fresh.authorized) {
            await clearSession();
            await clearHomeCache();
            router.replace('/');
            return;
          }
          if (isRealResponse) await saveSession(fresh);
        })
        .catch(() => {});
    }

    // Fire all three independently — each one paints as soon as it's ready
    // instead of the whole screen waiting on the slowest endpoint. The
    // spinner only comes down once we have something to show, or once all
    // three have finished trying (so it doesn't flash "empty" between the
    // first section landing and the rest still being in flight).
    const kidsMode = await isActiveProfileKids();
    logSessionEvent('home-load', 'comecando fetch paralelo de canais/filmes/series (rede pro painel)');

    let settled = 0;
    const maybeStopSpinner = (gotSomething: boolean) => {
      settled += 1;
      if (settled >= 3) logSessionEvent('home-load', 'fetch paralelo: todos os 3 terminaram');
      if (gotSomething || settled >= 3) setLoading(false);
    };

    const liveCatsP = kidsMode ? xtream.liveCategories(creds) : Promise.resolve(null);
    const liveP = Promise.all([xtream.liveStreams(creds), liveCatsP]).then(([live, liveCats]) => {
      const filteredLive =
        kidsMode && liveCats ? filterToKidsItems(live || [], liveCats) : live;
      const gotSomething = !!(filteredLive && filteredLive.length);
      if (gotSomething) {
        setSlots((prev) => ({
          ...prev,
          live: {
            title: 'CANAIS MAIS ASSISTIDOS',
            items: dedupeByName(filteredLive!).slice(0, 12).map((s: XtreamLive) => ({
              id: `live-${s.stream_id}`,
              name: s.name,
              logo: s.stream_icon || undefined,
              stream: liveStreamUrl(creds, s.stream_id, 'm3u8'),
              circular: true,
            })),
          },
        }));
        // Também guarda pra tela de Canais aproveitar — assim ela não
        // precisa buscar tudo de novo do zero na primeira visita depois
        // de já ter passado pela Home.
        loadListCache<unknown, XtreamLive>('channels').then((existing) => {
          saveListCache('channels', existing?.categories || [], filteredLive!);
        });
      }
      maybeStopSpinner(gotSomething);
      return filteredLive;
    });

    const vodCatsP = kidsMode ? xtream.vodCategories(creds) : Promise.resolve(null);
    const moviesP = Promise.all([xtream.vodStreams(creds), vodCatsP]).then(([movies, vodCats]) => {
      const filteredMovies =
        kidsMode && vodCats ? filterToKidsItems(movies || [], vodCats) : movies;
      const gotSomething = !!(filteredMovies && filteredMovies.length);
      if (gotSomething) {
        const deduped = dedupeByName(filteredMovies!);
        setSlots((prev) => ({
          ...prev,
          movies: {
            title: 'FILMES EM ALTA',
            items: deduped.slice(0, 20).map((m: XtreamMovie) => ({
              id: `movie-${m.stream_id}`,
              name: m.name,
              logo: m.stream_icon || undefined,
              stream: movieStreamUrl(creds, m.stream_id, m.container_extension),
            })),
          },
        }));
        loadListCache<unknown, XtreamMovie>('movies').then((existing) => {
          saveListCache('movies', existing?.categories || [], filteredMovies!);
        });
      }
      maybeStopSpinner(gotSomething);
      return filteredMovies;
    });

    const seriesCatsP = kidsMode ? xtream.seriesCategories(creds) : Promise.resolve(null);
    const seriesP = Promise.all([xtream.seriesList(creds), seriesCatsP]).then(([series, seriesCats]) => {
      const filteredSeries =
        kidsMode && seriesCats ? filterToKidsItems(series || [], seriesCats) : series;
      const gotSomething = !!(filteredSeries && filteredSeries.length);
      if (gotSomething) {
        setSlots((prev) => ({
          ...prev,
          series: {
            title: 'SÉRIES POPULARES',
            items: dedupeByName(filteredSeries!).slice(0, 20).map((s: XtreamSeries) => ({
              id: `series-${s.series_id}`,
              name: s.name,
              logo: s.cover || undefined,
              stream: '', // series need episode picker
              seriesId: s.series_id,
              cover: s.cover || undefined,
            })),
          },
        }));
        loadListCache<unknown, XtreamSeries>('series').then((existing) => {
          saveListCache('series', existing?.categories || [], filteredSeries!);
        });
      }
      maybeStopSpinner(gotSomething);
      return filteredSeries;
    });

    // Destaque combina filme e série, embaralhado — assim não é sempre a
    // mesma vitrine toda vez que abre o app. Espera só filmes+séries, NÃO
    // a lista de canais (que costuma ser bem maior e mais lenta) — antes
    // isso estava esperando as três listas juntas, o que deixava a fileira
    // de destaque demorada pra aparecer sem necessidade.
    // Mostra o destaque assim que filme OU série chegar primeiro (não fica
    // esperando os dois juntos, que sempre demora pelo menos o tempo do
    // mais lento) — completa e reembaralha quando o segundo também chegar.
    let featuredMovies: XtreamMovie[] | null = null;
    let featuredSeries: XtreamSeries[] | null = null;
    const buildFeatured = () => {
      const movieEntries: FeaturedEntry[] = dedupeByName(featuredMovies || [])
        .slice(0, 15)
        .map((m: XtreamMovie) => ({ kind: 'movie' as const, id: m.stream_id, name: m.name, cover: m.stream_icon }));
      const seriesEntries: FeaturedEntry[] = dedupeByName(featuredSeries || [])
        .slice(0, 15)
        .map((s: XtreamSeries) => ({ kind: 'series' as const, id: s.series_id, name: s.name, cover: s.cover }));
      const combined = [...movieEntries, ...seriesEntries];
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combined[i], combined[j]] = [combined[j], combined[i]];
      }
      const finalFeatured = combined.slice(0, 12);
      setFeatured(finalFeatured);
      saveFeaturedCache(finalFeatured);
    };
    moviesP.then((movies) => {
      featuredMovies = movies || [];
      buildFeatured();
    });
    seriesP.then((series) => {
      featuredSeries = series || [];
      buildFeatured();
    });

    const [live, movies, series] = await Promise.all([liveP, moviesP, seriesP]);

    const allEmpty = !live?.length && !movies?.length && !series?.length;

    // Se essa lista não trouxe nada e existe outra cadastrada, troca
    // sozinho pra próxima e tenta de novo — a pessoa não precisa fazer
    // nada manualmente quando uma lista para de funcionar.
    if (allEmpty) {
      const totalPlaylists = session?.playlists?.length || 0;
      const currentIdx = getActivePlaylistIndex();
      if (totalPlaylists > 1 && currentIdx < totalPlaylists - 1) {
        await setActivePlaylistIndex(currentIdx + 1, false);
        return load();
      }
      // Chegou aqui e ainda veio vazio: ou só tem uma lista mesmo (e ela
      // não funciona), ou já tentamos todas e nenhuma trouxe nada. Nesse
      // caso não faz sentido deixar a pessoa "presa" na Home vendo erro —
      // volta pro login, igual quando o painel bloqueia o MAC.
      await setActivePlaylistIndex(0, false);
      await clearSession();
      await clearHomeCache();
      router.replace('/');
      return;
    }

    setLoadError(null);
    setLoading(false);

    // Persist whatever we ended up with so the next cold open of Home is instant.
    if (!allEmpty) {
      setSlots((prev) => {
        saveHomeCache(prev);
        return prev;
      });
    }

    // Pré-carrega Filmes e Séries em segundo plano, DEPOIS que a Home já
    // terminou o essencial (não compete por rede/CPU com o que a pessoa
    // está vendo agora). Grava no mesmo cache que as telas de Filmes e
    // Séries leem (list-cache.ts) — assim, quando a pessoa de fato clicar
    // nelas, o cache já está quente e abre instantâneo, em vez de esperar
    // a rede do zero. Silencioso: se falhar, a tela de Filmes/Séries
    // busca do zero normalmente quando abrir, sem problema nenhum.
    //
    // EXCETO em TV box fraca: processar essas listas inteiras (potencial-
    // mente milhares de itens — parse de JSON, gravação em disco) rouba
    // CPU justo no momento em que a pessoa provavelmente já está
    // navegando pela Home recém-carregada com o controle remoto. Nesses
    // aparelhos, é melhor Filmes/Séries buscarem do zero quando abrirem
    // (um pouco mais lento pra abrir) do que deixar a Home travando os
    // comandos do D-pad agora.
    if (!isLowEndDevice) {
      (async () => {
        try {
          const [movieCats, movieStreams] = await Promise.all([
            xtream.vodCategories(creds),
            xtream.vodStreams(creds),
          ]);
          if (movieCats || movieStreams) {
            await saveListCache('movies', movieCats || [], movieStreams || []);
          }
        } catch {}
        try {
          const [seriesCats, seriesStreams] = await Promise.all([
            xtream.seriesCategories(creds),
            xtream.seriesList(creds),
          ]);
          if (seriesCats || seriesStreams) {
            await saveListCache('series', seriesCats || [], seriesStreams || []);
          }
        } catch {}
      })();
    }
  }, [isLowEndDevice]);

  useEffect(() => {
    load();
  }, [load]);

  const openFeaturedDetails = (item: FeaturedEntry) => {
    const adultFlag = isAdultCategoryName(item.name) ? '1' : '';
    guard(item.name, () => {
      if (item.kind === 'movie') {
        router.push({
          pathname: '/movie-details',
          params: { id: String(item.id), name: item.name, cover: item.cover || '', adult: adultFlag },
        });
      } else {
        router.push({
          pathname: '/series-details',
          params: { id: String(item.id), name: item.name, cover: item.cover || '', adult: adultFlag },
        });
      }
    });
  };

  const openFeaturedTrailer = (item: FeaturedEntry) => {
    router.push({
      pathname: '/trailer',
      params: { query: `${item.name} trailer oficial`, title: item.name },
    });
  };

  const toggleFeaturedFavorite = async (item: FeaturedEntry) => {
    const id = `${item.kind}-${item.id}`;
    const nowFav = await toggleFavorite({ id, kind: item.kind, refId: item.id, name: item.name, cover: item.cover });
    setFeaturedFavIds((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const openItem = (item: HomeItem) => {
    if (item.id.startsWith('continue-')) {
      // Already excluded from recording if it was adult content — safe to
      // resume straight into the player without asking again.
      router.push({
        pathname: '/player',
        params: { id: item.id, name: item.name, stream: item.stream, logo: item.logo || '' },
      });
      return;
    }

    // Home doesn't fetch category names (keeps it fast), so the best signal
    // available here is the item's own title — same keyword heuristic, just
    // applied to the name instead of a category.
    const adultFlag = isAdultCategoryName(item.name) ? '1' : '';

    if (item.seriesId) {
      guard(item.name, () => {
        router.push({
          pathname: '/series-details',
          params: { id: String(item.seriesId), name: item.name, cover: item.cover || '', adult: adultFlag },
        });
      });
      return;
    }
    if (item.id.startsWith('movie-')) {
      guard(item.name, () => {
        router.push({
          pathname: '/movie-details',
          params: { id: item.id.replace('movie-', ''), name: item.name, cover: item.logo || '', adult: adultFlag },
        });
      });
      return;
    }
    if (!item.stream) return;
    guard(item.name, () => {
      const channelId = item.id.replace('live-', '').replace('continue-live-', '');
      if (isTV) {
        const creds = getXtream();
        if (creds) {
          router.push({
            pathname: '/player',
            params: {
              id: `live-${channelId}`,
              name: item.name,
              stream: liveStreamUrl(creds, Number(channelId), 'm3u8'),
              logo: item.logo || '',
              adult: adultFlag,
            },
          });
          return;
        }
      }
      router.push({
        pathname: '/channel-details',
        params: {
          id: channelId,
          name: item.name,
          cover: item.logo || '',
          adult: adultFlag,
        },
      });
    });
  };

  const openKids = async () => {
    const creds = getXtream();
    if (!creds) {
      router.push('/movies');
      return;
    }
    const cats = await xtream.vodCategories(creds);
    const match = cats?.find((c) => {
      const n = c.category_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return n.includes('anima') || n.includes('kids') || n.includes('infantil') || n.includes('desenho') || n.includes('crianca');
    });
    router.push({ pathname: '/movies', params: match ? { initialCategory: match.category_name } : {} });
  };

  const navIconSize = isTV ? 26 : 18;
  // Ref pro item "Início" da sidebar — usado como destino de nextFocusLeft
  // pros elementos mais à esquerda do conteúdo (banner de destaque, e o
  // primeiro item de cada fileira), pra resolver a navegação por D-pad
  // precisando de MUITOS cliques pra esquerda pra sair do conteúdo e
  // chegar na sidebar (o algoritmo espacial padrão do Android TV não
  // prioriza isso sozinho).
  const homeNavRef = useRef<React.ElementRef<typeof TVFocusable>>(null);
  const [homeNavHandle, setHomeNavHandle] = useState<number | undefined>();
  useEffect(() => {
    // Antes só rodava com isTV=true — mas isTV depende de uma flag do
    // Android que TV box genérica/barata (comum entre clientes) não
    // costuma ter, mesmo sendo usada com controle remoto do mesmo jeito.
    // Isso desligava essa navegação inteira bem no aparelho que mais
    // precisa dela. Resolver o handle não tem custo real em celular,
    // então roda sempre agora.
    // Espera o próximo tick pra garantir que o node nativo já existe.
    const t = setTimeout(() => {
      const handle = findNodeHandle(homeNavRef.current);
      if (handle) setHomeNavHandle(handle);
    }, 300);
    return () => clearTimeout(t);
  }, []);
  const allNavItems = [
    { key: 'home', label: 'Início', testID: 'nav-home', icon: (active: boolean) => <Ionicons name="home" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: undefined },
    { key: 'live', label: 'Canais', testID: 'nav-live', icon: (active: boolean) => <MaterialCommunityIcons name="television-classic" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/channels') },
    { key: 'movies', label: 'Filmes', testID: 'nav-movies', icon: (active: boolean) => <MaterialCommunityIcons name="movie-open" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/movies') },
    { key: 'series', label: 'Séries', testID: 'nav-series', icon: (active: boolean) => <Ionicons name="film" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/series') },
    { key: 'placar', label: 'Placar', testID: 'nav-placar', icon: (active: boolean) => <MaterialCommunityIcons name="scoreboard-outline" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/placar') },
    { key: 'kids', label: 'Kids', testID: 'nav-kids', icon: (active: boolean) => <MaterialCommunityIcons name="drawing" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: openKids },
    { key: 'radios', label: 'Rádios', testID: 'nav-radios', icon: (active: boolean) => <MaterialCommunityIcons name="radio" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/radios') },
    { key: 'world-cameras', label: 'Câmeras', testID: 'nav-world-cameras', icon: (active: boolean) => <Ionicons name="earth" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/world-cameras') },
    { key: 'search', label: 'Busca', testID: 'nav-search', icon: (active: boolean) => <Ionicons name="search" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/search') },
    { key: 'diagnostic', label: 'Diagnóstico', testID: 'nav-diagnostic', icon: (active: boolean) => <Ionicons name="pulse" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/diagnostic') },
    { key: 'settings', label: 'Ajustes', testID: 'nav-settings', icon: (active: boolean) => <Ionicons name="settings" size={navIconSize} color={active ? colors.accentCyan : colors.textSecondary} />, onPress: () => router.push('/settings') },
    ];

  return (
    <ImageBackground
      // Sem bg_url do painel (ex: conta de teste, sem MAC cadastrado ainda)
      // OU a URL falhou ao carregar (link vencido, servidor fora do ar) —
      // usa a imagem de fundo padrão do app em vez de deixar sem nada.
      // Assim que o MAC for cadastrado no painel com uma imagem própria
      // que carregue de verdade, volta a usar ela normalmente.
      source={bg && !bgFailed ? { uri: bg } : require('@/assets/images/default-bg.png')}
      onError={() => setBgFailed(true)}
      style={styles.bg}
      imageStyle={{ opacity: bg && !bgFailed ? 0.35 : 0.75 }}
    >
      <View style={[styles.overlay, !(bg && !bgFailed) && styles.overlayLight]} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {isOffline && (
          <View style={styles.offlineBanner} testID="offline-banner">
            <Ionicons name="cloud-offline-outline" size={14} color={colors.black} />
            <Text style={styles.offlineBannerText}>Sem internet — mostrando o que já tinha salvo</Text>
          </View>
        )}
        <View style={{ flex: 1, flexDirection: isLandscape ? 'row' : 'column' }}>
          {isLandscape && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={[styles.sideNav, isTV && styles.sideNavTV]}
              contentContainerStyle={styles.sideNavInner}
              testID="bottom-nav"
            >
              {allNavItems.map((it) => {
                const active = activeNav === it.key;
                return (
                  <TVFocusable
                    key={it.key}
                    ref={it.key === 'home' ? homeNavRef : undefined}
                    onFocus={() => {
                      // Diagnóstico de lentidão na sidebar: registra o
                      // instante em que o React terminou de processar o
                      // evento de foco (onFocus chega DEPOIS do foco já
                      // ter mudado no nível do sistema — se o intervalo
                      // entre um item e o próximo, no Diagnóstico, for
                      // muito maior que o tempo real que a pessoa levou
                      // segurando o botão, é sinal de fila/atraso na JS
                      // thread, não do controle em si).
                      logSessionEventFast('sidebar-focus', it.key);
                    }}
                    onPress={() => {
                      setActiveNav(it.key);
                      it.onPress?.();
                    }}
                    style={[styles.sideNavItem, isTV && styles.sideNavItemTV]}
                    testID={it.testID}
                  >
                    {it.icon(active)}
                    <Text
                      style={[styles.sideNavLabel, isTV && styles.sideNavLabelTV, active && styles.bottomNavLabelActive]}
                      numberOfLines={1}
                    >
                      {it.label}
                    </Text>
                  </TVFocusable>
                );
              })}
            </ScrollView>
          )}

          {/* Content */}
          <View style={[styles.content, isLandscape && { paddingTop: 3 }]}>
            <View style={[styles.topBar, isLandscape && { paddingBottom: 4 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.hello, isLandscape && { fontSize: 14 }]} testID="home-hello" numberOfLines={1}>
                  Olá, {params.profileName || 'usuário'}
                </Text>
                <Text style={[styles.appNameSmall, isLandscape && { fontSize: 9 }]} numberOfLines={1}>{appName}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <ClockWeather compact />
                <Suspense
                  fallback={
                    <View style={styles.micBtn}>
                      <Ionicons name="mic-outline" size={18} color={colors.accentCyan} />
                    </View>
                  }
                >
                  <VoiceSearchButton />
                </Suspense>
                <TVFocusable onPress={() => router.replace('/profiles')} testID="nav-profile">
                  <Image
                    source={logo ? { uri: logo } : require('@/assets/images/icon.png')}
                    style={{ width: isLandscape ? 28 : 34, height: isLandscape ? 28 : 34, borderRadius: 17 }}
                    contentFit="cover"
                  />
                </TVFocusable>
              </View>
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accentCyan} />
                <Text style={styles.loadingText}>Carregando conteúdo...</Text>
              </View>
            ) : sections.length === 0 ? (
              <EmptyHome errorCode={loadError} onRetry={load} />
            ) : (
              <FlatList
                style={{ flex: 1 }}
                data={sections}
                keyExtractor={(_, idx) => `section-${idx}`}
                contentContainerStyle={{ paddingBottom: 24 }}
                ListHeaderComponent={
                  featured.length > 0 ? (
                    <FeaturedHero
                      items={featured}
                      favIds={featuredFavIds}
                      onOpen={openFeaturedDetails}
                      onTrailer={openFeaturedTrailer}
                      onToggleFavorite={toggleFeaturedFavorite}
                      isLandscape={isLandscape}
                      nextFocusLeft={homeNavHandle}
                    />
                  ) : null
                }
                renderItem={({ item }) => (
                  <SectionRow section={item} onOpen={openItem} isLandscape={isLandscape} isTV={isTV} nextFocusLeft={homeNavHandle} />
                )}
              />
            )}
          </View>

          {/* Bottom nav (retrato) — todos os destinos, rolável na horizontal
              pra caber tudo sem cortar. Em paisagem vira a barra lateral acima. */}
          {!isLandscape && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bottomNav}
              contentContainerStyle={styles.bottomNavInner}
              testID="bottom-nav"
            >
              {allNavItems.map((it) => {
                const active = activeNav === it.key;
                return (
                  <Pressable
                    key={it.key}
                    onPress={() => {
                      setActiveNav(it.key);
                      it.onPress?.();
                    }}
                    style={styles.bottomNavItem}
                    testID={it.testID}
                  >
                    {it.icon(active)}
                    <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>
                      {it.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
      {parentalModal}
      <ProgramReminderPopup
        reminder={dueProgramReminder}
        onWatchNow={onWatchProgramReminder}
        onDismiss={() => setDueProgramReminder(null)}
      />
    </ImageBackground>
  );
}

function FeaturedHero({
  items,
  favIds,
  onOpen,
  onTrailer,
  onToggleFavorite,
  isLandscape,
  nextFocusLeft,
}: {
  items: FeaturedEntry[];
  favIds: Set<string>;
  onOpen: (item: FeaturedEntry) => void;
  onTrailer: (item: FeaturedEntry) => void;
  onToggleFavorite: (item: FeaturedEntry) => void;
  isLandscape: boolean;
  nextFocusLeft?: number;
}) {
  const [index, setIndex] = useState(0);
  const [infoCache, setInfoCache] = useState<Record<string, { plot?: string; genre?: string; rating?: string | number; releaseDate?: string; backdrop?: string }>>({});
  const creds = getXtream();

  const current = items[index];
  const cacheKey = current ? `${current.kind}-${current.id}` : '';
  const info = current ? infoCache[cacheKey] : undefined;

  // Busca a sinopse/nota/backdrop só do item que está na tela agora (não de
  // todos de uma vez, pra não disparar uma dúzia de chamadas na abertura da
  // Home) — e guarda em cache pra não buscar de novo se o carrossel voltar
  // pro mesmo item.
  useEffect(() => {
    if (!current || !creds || infoCache[cacheKey]) return;
    let cancelled = false;
    const promise =
      current.kind === 'movie' ? xtream.vodInfo(creds, current.id) : xtream.seriesInfo(creds, current.id);
    promise.then((res: any) => {
      if (cancelled || !res) return;
      setInfoCache((prev) => ({
        ...prev,
        [cacheKey]: {
          plot: res.info?.plot,
          genre: res.info?.genre,
          rating: res.info?.rating,
          releaseDate: res.info?.releasedate || res.info?.release_date || res.info?.releaseDate,
          backdrop: res.info?.backdrop_path?.[0],
        },
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Gira sozinho a cada 7s, volta pro começo depois do último.
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % items.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!current) return null;

  const isFav = favIds.has(`${current.kind}-${current.id}`);
  const backdrop = info?.backdrop || current.cover;
  const year = (info?.releaseDate || '').slice(0, 4);

  return (
    <View style={styles.heroWrap}>
      <ImageBackground
        source={backdrop ? { uri: backdrop } : undefined}
        style={[styles.heroBg, { aspectRatio: isLandscape ? 16 / 6 : 3 / 4 }]}
        imageStyle={{ opacity: 0.9 }}
      >
        <LinearGradient
          colors={['rgba(11,15,26,0.10)', 'rgba(11,15,26,0.40)', 'rgba(11,15,26,0.90)']}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill as any}
        />
        <LinearGradient
          colors={['rgba(11,15,26,0.45)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 0 }}
          style={StyleSheet.absoluteFill as any}
        />
        <View style={styles.heroContent}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{current.kind === 'movie' ? 'FILME' : 'SÉRIE'}</Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>{current.name}</Text>
          <View style={styles.heroMetaRow}>
            {!!info?.rating && (
              <View style={styles.heroMetaItem}>
                <Ionicons name="star" size={12} color="#F0C24C" />
                <Text style={styles.heroMetaText}>{String(info.rating)}</Text>
              </View>
            )}
            {!!year && <Text style={styles.heroMetaText}>{year}</Text>}
            <View style={styles.heroQualityPill}>
              <Text style={styles.heroQualityText}>HD</Text>
            </View>
          </View>
          {!!info?.plot && (
            <Text style={styles.heroPlot} numberOfLines={3}>{info.plot}</Text>
          )}
          <View style={styles.heroActions}>
            <TVFocusable
              onPress={() => onOpen(current)}
              style={styles.heroPlayBtn}
              testID={`hero-play-${current.id}`}
              nextFocusLeft={nextFocusLeft}
            >
              <Ionicons name="play" size={16} color={colors.black} />
              <Text style={styles.heroPlayText}>ASSISTIR</Text>
            </TVFocusable>
            <Pressable onPress={() => onTrailer(current)} style={styles.heroInfoBtn} testID={`hero-trailer-${current.id}`}>
              <Ionicons name="logo-youtube" size={16} color={colors.white} />
              <Text style={styles.heroInfoText}>TRAILER</Text>
            </Pressable>
            <Pressable onPress={() => onToggleFavorite(current)} style={styles.heroIconBtn} testID={`hero-favorite-${current.id}`}>
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={18} color={isFav ? colors.accentMagenta : colors.white} />
            </Pressable>
          </View>
          <View style={styles.heroDots}>
            {items.map((it, i) => (
              <Pressable key={`${it.kind}-${it.id}`} onPress={() => setIndex(i)} hitSlop={6}>
                <View style={[styles.heroDot, i === index && styles.heroDotActive]} />
              </Pressable>
            ))}
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

function SectionRow({
  section,
  onOpen,
  isLandscape,
  isTV,
  nextFocusLeft,
}: {
  section: Section;
  onOpen: (item: HomeItem) => void;
  isLandscape: boolean;
  isTV?: boolean | null;
  nextFocusLeft?: number;
}) {
  const posterWidth = isTV ? 160 : isLandscape ? 130 : 90;
  const circularWidth = isTV ? 110 : isLandscape ? 88 : 64;
  const circularCardSize = isTV ? 110 : isLandscape ? 88 : 64;
  const circularImgSize = isTV ? 76 : isLandscape ? 60 : 44;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionBar} />
        <Text style={styles.sectionTitle}>{section.title}</Text>
      </View>
      <FlatList
        horizontal
        data={section.items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={homeRowListPerf.initialNumToRender}
        maxToRenderPerBatch={homeRowListPerf.maxToRenderPerBatch}
        windowSize={homeRowListPerf.windowSize}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <TVFocusable
            onPress={() => onOpen(item)}
            testID={`home-item-${item.id}`}
            nextFocusLeft={index === 0 ? nextFocusLeft : undefined}
          >
            {item.circular ? (
              <View style={[styles.circularItem, { width: circularWidth }]}>
                <View style={[styles.circularCard, { width: circularCardSize, height: circularCardSize, borderRadius: circularCardSize / 2 }]}>
                  {item.logo ? (
                    <Image source={{ uri: item.logo }} style={{ width: circularImgSize, height: circularImgSize }} contentFit="contain" cachePolicy="memory-disk" />
                  ) : (
                    <Ionicons name="tv" size={isTV ? 32 : 22} color={colors.black} />
                  )}
                </View>
                <Text style={[styles.circularName, isTV && styles.circularNameTV]} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            ) : (
              <View style={[styles.posterItem, { width: posterWidth }]}>
                <View style={[styles.posterCard, { width: posterWidth, height: posterWidth * (130 / 90) }]}>
                  {item.logo ? (
                    <Image source={{ uri: item.logo }} style={styles.posterImg} contentFit="cover" cachePolicy="memory-disk" {...posterImageProps} />
                  ) : (
                    <Ionicons name="image" size={isTV ? 36 : 26} color={colors.textMuted} />
                  )}
                </View>
                <Text style={[styles.posterName, isTV && styles.posterNameTV]} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
            )}
          </TVFocusable>
        )}
      />
    </View>
  );
}

function EmptyHome({ errorCode, onRetry }: { errorCode: string | null; onRetry: () => void }) {
  const blocked = errorCode === 'BLOCKED_CLOUDFLARE';
  return (
    <View style={styles.emptyWrap} testID="home-empty">
      <MaterialCommunityIcons
        name={blocked ? 'cloud-alert' : 'television-off'}
        size={48}
        color={colors.textMuted}
      />
      <Text style={styles.emptyTitle}>
        {blocked ? 'Conteúdo indisponível no preview' : 'Nada disponível ainda'}
      </Text>
      <Text style={styles.emptySub}>
        {blocked
          ? 'O servidor IPTV está bloqueando o IP do preview (Cloudflare).\nAbra o app no Expo Go pelo celular ou pelo APK — vai carregar tudo normal.'
          : 'Sem conteúdo para exibir agora.\nVerifique sua conexão ou fale com o revendedor.'}
      </Text>
      <Pressable onPress={onRetry} style={styles.retryBtn} testID="home-retry">
        <Ionicons name="refresh" size={14} color={colors.accentCyan} />
        <Text style={styles.retryText}>TENTAR NOVAMENTE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.black },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accentCyan,
    paddingVertical: 4,
  },
  offlineBannerText: { color: colors.black, fontSize: 11, fontWeight: '700' },
  overlayLight: { backgroundColor: 'rgba(0,0,0,0.15)' },
  safe: { flex: 1 },
  bottomNav: {
    flexGrow: 0,
    backgroundColor: colors.darkSurfaceAlt,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  bottomNavInner: { paddingVertical: 8, paddingHorizontal: spacing.sm, gap: 4 },
  bottomNavItem: { width: 72, alignItems: 'center', gap: 2, paddingVertical: 4 },
  bottomNavLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  bottomNavLabelActive: { color: colors.accentCyan, fontWeight: '800' },
  sideNav: {
    width: 78,
    maxWidth: 78,
    minWidth: 78,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.darkSurfaceAlt,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
  },
  sideNavTV: { width: 112, maxWidth: 112, minWidth: 112 },
  sideNavInner: { paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  sideNavItem: { alignItems: 'center', gap: 2, width: 52 },
  sideNavItemTV: { width: 92, paddingVertical: 6, gap: 4 },
  sideNavLabel: { color: colors.textSecondary, fontSize: 8, fontWeight: '600', textAlign: 'center' },
  sideNavLabelTV: { fontSize: 12 },
  profileFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.darkSurfaceAlt,
    borderWidth: 1,
    borderColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: colors.accentCyan,
  },
  content: { flex: 1, minWidth: 0, paddingTop: spacing.md },
  topBar: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hello: { color: colors.white, fontSize: 16, fontWeight: '700' },
  heroWrap: { marginBottom: spacing.lg },
  heroBg: { width: '100%', aspectRatio: 3 / 4, backgroundColor: colors.darkSurface, justifyContent: 'flex-end' },
  heroContent: { padding: spacing.md, paddingBottom: spacing.lg },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
  },
  heroBadgeText: { color: colors.black, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: '900' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroMetaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  heroQualityPill: { borderWidth: 1, borderColor: colors.textSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  heroQualityText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  heroPlot: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 10, maxWidth: '92%' },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md },
  heroPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  heroPlayText: { color: colors.black, fontSize: 13, fontWeight: '800' },
  heroInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  heroInfoText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  heroIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDots: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  heroDotActive: { backgroundColor: colors.accentCyan, width: 18 },
  appNameSmall: { color: colors.accentCyan, fontSize: 10, marginTop: 2, letterSpacing: 1.5 },
  macText: { color: colors.textMuted, fontSize: 10, letterSpacing: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textSecondary, fontSize: 12 },
  section: { marginBottom: 18 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  sectionBar: { width: 3, height: 14, backgroundColor: colors.accentCyan, borderRadius: 2 },
  sectionTitle: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  circularItem: { alignItems: 'center', width: 64 },
  circularCard: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  circularImg: { width: 44, height: 44 },
  circularName: {
    color: colors.textSecondary,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  circularNameTV: { fontSize: 14, marginTop: 6 },
  posterItem: { width: 90 },
  posterCard: {
    width: 90,
    height: 130,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterImg: { width: '100%', height: '100%' },
  posterName: { color: colors.white, fontSize: 11, marginTop: 6 },
  posterNameTV: { fontSize: 15, marginTop: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  retryText: {
    color: colors.accentCyan,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
