import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getXtream } from '@/src/state/session';
import { loadListCache, saveListCache } from '@/src/state/list-cache';
import { xtream, XtreamCategory, XtreamLive, getLastXtreamError, liveStreamUrl } from '@/src/lib/xtream';
import { isAdultCategoryName, filterToKidsCategories, filterToKidsItems } from '@/src/lib/adult-content';
import { isActiveProfileKids } from '@/src/state/profiles';
import { dedupeByName } from '@/src/lib/dedupe';
import { useParentalGate } from '@/src/lib/use-parental-gate';
import { loadFavorites, toggleFavorite } from '@/src/state/favorites';
import { useIsTV } from '@/src/hooks/useIsTV';
import { getFlashListPerfProps, useIsLowEndDevice } from '@/src/hooks/useIsLowEndDevice';
import { useListImagePrefetch } from '@/src/hooks/useListImagePrefetch';
import TVFocusable from '@/src/components/TVFocusable';
import TVChannelPreview from '@/src/components/TVChannelPreview';
import { usePlayerSession } from '@/src/state/player-session';

const ALL = 'Todos';
const FAVORITES = 'Favoritos';
const CACHE_KEY = 'channels';
const SIDE_COL_WIDTH = 160;

// Extraído e memoizado de propósito: sem isso, toda vez que o destaque
// (D-pad) muda de linha, o componente pai inteiro re-renderiza, e SEM
// memo isso recriava e re-renderizava TODAS as ~20 linhas visíveis na
// tela a cada movimento do controle — não só a que realmente mudou. Com
// React.memo, só as linhas cujas props de verdade mudaram (a que ganhou
// e a que perdeu o destaque) re-renderizam.
const ChannelRow = React.memo(function ChannelRow({
  item,
  index,
  isActive,
  isFavorite,
  onFocus,
  onPress,
}: {
  item: XtreamLive;
  index: number;
  isActive: boolean;
  isFavorite: boolean;
  onFocus: (item: XtreamLive) => void;
  onPress: (item: XtreamLive) => void;
}) {
  return (
    <TVFocusable
      onFocus={() => onFocus(item)}
      onPress={() => onPress(item)}
      style={[styles.tvRow, isActive && styles.tvRowActive]}
      focusStyle={styles.tvRowFocus}
      testID={`tv-channel-${item.stream_id}`}
    >
      <Text style={styles.tvRowNum}>{item.num ?? index + 1}</Text>
      {item.stream_icon ? (
        <Image source={{ uri: item.stream_icon }} style={styles.tvRowIcon} contentFit="contain" cachePolicy="memory-disk" />
      ) : (
        <MaterialCommunityIcons name="television-classic" size={22} color={colors.textMuted} />
      )}
      <Text style={styles.tvRowName} numberOfLines={1}>
        {item.name}
      </Text>
      {isFavorite && <Ionicons name="heart" size={14} color={colors.accentMagenta} />}
    </TVFocusable>
  );
});

export default function ChannelsScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const flashListPerf = getFlashListPerfProps();
  const gridFlashListPerf = getFlashListPerfProps();
  const params = useLocalSearchParams<{ initialQuery?: string; initialCategory?: string }>();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const numColumns = isLandscape ? 4 : 2;
  const gridWidth = isLandscape ? width - SIDE_COL_WIDTH : width;
  const itemGap = spacing.sm;
  const itemWidth = (gridWidth - spacing.md * 2 - itemGap * (numColumns - 1)) / numColumns;
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [streams, setStreams] = useState<XtreamLive[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>(params.initialCategory || ALL);
  const [query, setQuery] = useState(params.initialQuery || '');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [showCategoryDrawer, setShowCategoryDrawer] = useState(false);
  const [previewChannel, setPreviewChannel] = useState<XtreamLive | null>(null);
  // Destaque visual da linha (instantâneo) — separado do preview de vídeo
  // em si, que é mais pesado e usa debounce (ver onFocusChannel abaixo).
  const [focusedChannel, setFocusedChannel] = useState<XtreamLive | null>(null);
  const focusPrefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (focusPrefetchTimer.current) clearTimeout(focusPrefetchTimer.current);
    };
  }, []);
  const { modal: parentalModal, guard } = useParentalGate();

  useFocusEffect(
    useCallback(() => {
      loadFavorites().then((list) => {
        setFavoriteIds(new Set(list.filter((f) => f.kind === 'channel').map((f) => f.id)));
      });
    }, [])
  );

  const onToggleFavorite = async (s: XtreamLive) => {
    const id = `channel-${s.stream_id}`;
    const nowFav = await toggleFavorite({ id, kind: 'channel', refId: s.stream_id, name: s.name, cover: s.stream_icon });
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const isLowEndDevice = useIsLowEndDevice();
  const { enterFullscreen, source: sessionSource, kind: sessionKind } = usePlayerSession();

  const load = useCallback(async () => {
    // Paint the cached list instantly (if we have one) instead of a blank
    // spinner, then refresh in the background — same idea as the Home screen.
    const cache = await loadListCache<XtreamCategory, XtreamLive>(CACHE_KEY);
    if (cache) {
      setCategories(cache.categories);
      setStreams(cache.items);
      setLoading(false);
    }

    const creds = getXtream();
    if (!creds) {
      if (!cache) setLoading(false);
      return;
    }

    // Categories are a small, fast call — let them paint the filter chips
    // immediately instead of waiting on the (often huge) channel list.
    const catsPromise = xtream.liveCategories(creds).then((cats) => {
      if (cats && cats.length) setCategories(cats);
      return cats;
    });

    const list = await xtream.liveStreams(creds);
    if (list && list.length) {
      setStreams(list);
      setLoadError(null);
    } else if (!cache) {
      setLoadError(getLastXtreamError());
    }
    setLoading(false);

    const cats = await catsPromise;
    if (list && list.length) {
      saveListCache(CACHE_KEY, cats || [], list);

      // Pré-carrega o EPG ("o que está passando agora") dos primeiros ~15
      // canais em segundo plano — quando a pessoa focar/abrir um desses
      // canais, o EPG já está pronto (ou quase), sem esperar a rede na
      // hora. Silencioso: se falhar, a tela busca normalmente quando
      // precisar de verdade.
      //
      // Pulado em TV box fraca (mesmo raciocínio do prefetch da Home): 15
      // requisições paralelas competem por CPU/rede exatamente quando a
      // tela de Canais acabou de abrir e a pessoa já está navegando.
      if (!isLowEndDevice) {
        Promise.all(list.slice(0, 15).map((c) => xtream.shortEpg(creds, c.stream_id, 1).catch(() => null)));
      }
    }
  }, [isLowEndDevice]);

  useEffect(() => {
    load();
  }, [load]);

  const [kidsMode, setKidsMode] = useState(false);
  useEffect(() => {
    isActiveProfileKids().then(setKidsMode);
  }, []);

  // Perfil infantil: conteúdo adulto não é só bloqueado por PIN, ele
  // simplesmente não existe — nem a categoria aparece na lista, nem os
  // itens dela aparecem em "Todos". Tudo daqui pra baixo usa essas
  // versões filtradas, nunca `categories`/`streams` direto.
  const visibleCategories = useMemo(
    () => (kidsMode ? filterToKidsCategories(categories) : categories),
    [categories, kidsMode]
  );
  // Busca O(1) em vez de percorrer a lista de categorias toda vez (era
  // usado dentro de loop pra montar a contagem por categoria, e de novo
  // pra CADA card renderizado na grade do celular — com centenas de
  // categorias, isso se somava rápido).
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.category_id, c.category_name);
    return map;
  }, [categories]);
  const categoryIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of visibleCategories) map.set(c.category_name, c.category_id);
    return map;
  }, [visibleCategories]);
  const visibleStreams = useMemo(
    () => (kidsMode ? filterToKidsItems(streams, categories) : streams),
    [streams, categories, kidsMode]
  );

  const catNames = useMemo<string[]>(() => {
    return [FAVORITES, ALL, ...visibleCategories.map((c) => c.category_name)];
  }, [visibleCategories]);

  // Contagem por categoria (mostrada ao lado do nome na coluna da TV).
  // Precisa ser memoizada: sem isso, esse cálculo (um filter() por
  // categoria) rodava de novo em TODA renderização — inclusive a cada
  // movimento do D-pad na lista de canais (que atualiza `previewChannel`
  // e força o componente inteiro a re-renderizar) — pesado o bastante
  // pra contribuir com o travamento ao navegar em listas grandes.
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { [ALL]: visibleStreams.length, [FAVORITES]: favoriteIds.size };
    const byCategory = new Map<string, number>();
    for (const stream of visibleStreams) {
      if (stream.category_id) byCategory.set(stream.category_id, (byCategory.get(stream.category_id) || 0) + 1);
    }
    for (const cat of visibleCategories) {
      map[cat.category_name] = byCategory.get(cat.category_id) || 0;
    }
    return map;
  }, [visibleStreams, visibleCategories, favoriteIds]);

  const nonFavFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selectedCatId = selectedCat === ALL ? null : categoryIdByName.get(selectedCat);
    const matches = visibleStreams.filter((s) => {
      const catOk = !selectedCatId || s.category_id === selectedCatId;
      const qOk = !q || s.name.toLowerCase().includes(q);
      return catOk && qOk;
    });
    return dedupeByName(matches);
  }, [visibleStreams, categoryIdByName, selectedCat, query]);

  const filtered = useMemo(() => {
    if (selectedCat === FAVORITES) {
      const matches = visibleStreams.filter((s) => favoriteIds.has(`channel-${s.stream_id}`));
      return dedupeByName(matches);
    }
    return nonFavFiltered;
  }, [selectedCat, favoriteIds, visibleStreams, nonFavFiltered]);

  const { onViewableItemsChanged: onGridViewableItemsChanged, viewabilityConfig: gridViewabilityConfig } =
    useListImagePrefetch(filtered, (c: XtreamLive) => c.stream_icon);

  // Ao trocar de categoria (ou filtro), só ATUALIZA O DESTAQUE do primeiro
  // canal da nova lista — nunca carrega vídeo nenhum sozinho. Antes disso
  // trocar de categoria já disparava o preview do primeiro canal da lista
  // nova sem a pessoa ter clicado em nada; agora só o clique explícito
  // (ver onPressChannel) é que carrega o vídeo.
  useEffect(() => {
    if (!isTV) return;
    if (!filtered.length) {
      setPreviewChannel(null);
      setFocusedChannel(null);
      return;
    }
    setFocusedChannel((prev) => {
      if (prev && filtered.some((s) => s.stream_id === prev.stream_id)) return prev;
      return filtered[0];
    });
    // Se o canal que estava em preview sumiu do filtro atual (ex: trocou
    // de categoria e ele não pertence a ela), tira do preview também —
    // mas sem substituir por outro sozinho.
    setPreviewChannel((prev) => (prev && filtered.some((s) => s.stream_id === prev.stream_id) ? prev : null));
  }, [isTV, filtered]);

  // Chamado a cada movimento do D-pad na lista (TV) — só atualiza o
  // destaque visual da linha. NÃO carrega vídeo nenhum: antes o preview
  // trocava sozinho enquanto a pessoa só estava navegando (mesmo com
  // debounce), o que dava a impressão de "abrir" o canal sem ter
  // clicado em nada. Ver onPressChannel abaixo pra quando o vídeo
  // realmente carrega.
  const onFocusChannel = useCallback((item: XtreamLive) => {
    setFocusedChannel(item);
    // Na TV, a prioridade é responder ao D-pad. O prefetch de manifesto
    // durante o foco disputa rede/CPU com a renderização e não deve rodar
    // enquanto o usuário navega pelos canais.
    if (isLowEndDevice || isTV) return;

    // Pre-buffer leve: se o D-pad ficar parado 500ms num canal, busca o
    // manifesto (.m3u8) dele em background — sem player nenhum, só uma
    // requisição de rede que "esquenta" DNS/TCP/TLS com o servidor e
    // deixa o manifesto pronto no cache HTTP. Quando a pessoa realmente
    // abrir o canal, essa etapa (que costuma ser boa parte do atraso
    // pra começar a tocar) já foi feita. Deliberadamente NÃO cria um
    // VideoPlayer escondido pra isso — instanciar player de vídeo de
    // verdade só pra bufferizar é pesado, e faria o oposto do que
    // queremos numa TV box já fraca. Em device já detectado como fraco,
    // nem essa versão leve roda — qualquer trabalho extra de JS/rede
    // compete com a responsividade do D-pad, que é mais importante.
    if (focusPrefetchTimer.current) clearTimeout(focusPrefetchTimer.current);
    focusPrefetchTimer.current = setTimeout(() => {
      const creds = getXtream();
      if (!creds) return;
      const url = liveStreamUrl(creds, item.stream_id, 'm3u8');
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1' } }).catch(() => {});
    }, 500);
  }, [isLowEndDevice, isTV]);

  // 1º clique num canal: só carrega o preview (mini player), não abre
  // tela cheia ainda. 2º clique no MESMO canal (que já está em preview):
  // aí sim abre a tela cheia — evita abrir em tela cheia por engano só
  // por ter apertado OK uma vez navegando.
  const onPressChannel = useCallback(
    (item: XtreamLive) => {
      if (previewChannel?.stream_id === item.stream_id) {
        openPlayer(item);
      } else {
        setPreviewChannel(item);
        setFocusedChannel(item);
      }
    },
    [previewChannel]
  );

  const openPlayer = (s: XtreamLive) => {
    const categoryName = categories.find((c) => c.category_id === s.category_id)?.category_name;
    guard(categoryName, () => {
      // Na TV, o fluxo "lista → preview pequeno → channel-details (tela
      // do meio, com EPG) → tela cheia" exigia 2 cliques em OK e deixava
      // essa tela do meio viva rodando por trás quando ia pra tela cheia
      // (2 players ativos ao mesmo tempo, travando a TV box). Direto pra
      // tela cheia aqui: 1 clique, sem tela intermediária pra ficar presa
      // rodando. No celular mantém o fluxo normal (channel-details tem o
      // EPG detalhado que faz sentido ali).
      if (isTV) {
        enterFullscreen();
        const creds = getXtream();
        if (!creds) return;
        router.push({
          pathname: '/player',
          params: {
            id: `live-${s.stream_id}`,
            name: s.name,
            stream: sessionKind === 'live' && sessionSource ? sessionSource : liveStreamUrl(creds, s.stream_id, 'm3u8'),
            logo: s.stream_icon || '',
            adult: isAdultCategoryName(categoryName) ? '1' : '',
          },
        });
        return;
      }
      router.push({
        pathname: '/channel-details',
        params: {
          id: String(s.stream_id),
          name: s.name,
          cover: s.stream_icon || '',
          categoryName: categoryName || '',
          adult: isAdultCategoryName(categoryName) ? '1' : '',
        },
      });
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={[styles.header, isLandscape && { paddingVertical: 5 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="channels-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={[styles.headerTitle, isLandscape && { fontSize: 15 }]}>Canais ao vivo</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/favorites')} hitSlop={12} testID="channels-favorites">
            <Ionicons name="heart-outline" size={22} color={colors.white} />
          </Pressable>
          <Pressable onPress={() => setShowCategoryDrawer(true)} hitSlop={12} testID="channels-menu">
            <Ionicons name="menu" size={24} color={colors.white} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar canal..."
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="channels-search-input"
        />
      </View>

      {!!params.initialQuery && (
        <View style={styles.gameHint} testID="channels-game-hint">
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.gameHintText}>
            Não sabemos qual canal exato transmite esse jogo — filtramos por "{params.initialQuery}", mas talvez precise procurar manualmente.
          </Text>
        </View>
      )}

      {/* Category chips — horizontal chrome (retrato apenas; em paisagem vira coluna lateral abaixo) */}
      {!isLandscape && !isTV && (
        <View style={styles.chipRow} testID="channels-chip-row">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
            {catNames.map((cat) => {
              const active = cat === selectedCat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setSelectedCat(cat)}
                  style={[styles.chip, active && styles.chipActive]}
                  testID={`chip-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {cat === FAVORITES && (
                    <Ionicons
                      name="heart"
                      size={12}
                      color={active ? colors.accentCyan : colors.textSecondary}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {isTV ? (
        <View style={{ flex: 1, flexDirection: 'row' }} testID="channels-tv-layout">
          <ScrollView
            style={styles.tvCatCol}
            contentContainerStyle={styles.tvCatColInner}
            showsVerticalScrollIndicator={false}
            testID="channels-tv-categories"
          >
            {catNames.map((cat) => {
              const active = cat === selectedCat;
              const count = categoryCounts[cat] ?? 0;
              return (
                <TVFocusable
                  key={cat}
                  onPress={() => setSelectedCat(cat)}
                  style={[styles.tvCatItem, active && styles.tvCatItemActive]}
                  testID={`tv-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                    {cat === FAVORITES && (
                      <Ionicons name="heart" size={12} color={active ? colors.accentCyan : colors.textSecondary} />
                    )}
                    <Text style={[styles.tvCatText, active && styles.tvCatTextActive]} numberOfLines={1}>
                      {cat}
                    </Text>
                  </View>
                  <Text style={styles.tvCatCount}>{count}</Text>
                </TVFocusable>
              );
            })}
          </ScrollView>

          <View style={styles.tvListCol}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accentCyan} />
              </View>
            ) : filtered.length === 0 ? (
              <Empty errorCode={loadError} onRetry={load} />
            ) : (
              <FlashList
                data={filtered}
                keyExtractor={(c) => String(c.stream_id)}
                {...flashListPerf}
                // FlashList mede/recicla sozinho — não precisa mais dizer
                // a altura da linha de antemão (getItemLayout, que era
                // essencial no FlatList antigo, some daqui).
                renderItem={({ item, index }) => (
                  <ChannelRow
                    item={item}
                    index={index}
                    isActive={focusedChannel?.stream_id === item.stream_id}
                    isFavorite={favoriteIds.has(`channel-${item.stream_id}`)}
                    onFocus={onFocusChannel}
                    onPress={onPressChannel}
                  />
                )}
              />
            )}
          </View>

          <View style={styles.tvPreviewCol}>
            <TVChannelPreview
              channel={previewChannel}
              creds={getXtream()}
              isFavorite={!!previewChannel && favoriteIds.has(`channel-${previewChannel.stream_id}`)}
              onToggleFavorite={() => previewChannel && onToggleFavorite(previewChannel)}
              onOpenFull={() => previewChannel && openPlayer(previewChannel)}
              onSearch={() => router.push('/search')}
            />
          </View>
        </View>
      ) : (
      <View style={{ flex: 1, flexDirection: isLandscape ? 'row' : 'column' }}>
        {isLandscape && (
          <ScrollView style={styles.sideCatCol} contentContainerStyle={styles.sideCatColInner} showsVerticalScrollIndicator={false} testID="channels-side-categories">
            {catNames.map((cat) => {
              const active = cat === selectedCat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setSelectedCat(cat)}
                  style={[styles.sideChip, active && styles.sideChipActive]}
                  testID={`chip-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {cat === FAVORITES && (
                    <Ionicons name="heart" size={12} color={active ? colors.accentCyan : colors.textSecondary} style={{ marginRight: 4 }} />
                  )}
                  <Text style={[styles.sideChipText, active && styles.sideChipTextActive]} numberOfLines={2}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accentCyan} />
            </View>
          ) : filtered.length === 0 ? (
            <Empty errorCode={loadError} onRetry={load} />
          ) : (
        <FlashList
          key={numColumns}
          style={{ flex: 1 }}
          data={filtered}
          keyExtractor={(c) => String(c.stream_id)}
          numColumns={numColumns}
          contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: 32, gap: spacing.sm }}
          {...gridFlashListPerf}
          onViewableItemsChanged={onGridViewableItemsChanged}
          viewabilityConfig={gridViewabilityConfig}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openPlayer(item)}
              style={[styles.card, { width: itemWidth }]}
              testID={`channel-${item.stream_id}`}
            >
              <View style={styles.logoBox}>
                {item.stream_icon ? (
                  <Image source={{ uri: item.stream_icon }} style={styles.logoImg} contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                  <MaterialCommunityIcons name="television-classic" size={28} color={colors.textMuted} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {!!item.category_id && (
                  <Text style={styles.cardCat} numberOfLines={1}>
                    {categoryNameById.get(item.category_id) || ''}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => onToggleFavorite(item)}
                hitSlop={10}
                style={styles.cardHeart}
                testID={`channel-favorite-${item.stream_id}`}
              >
                <Ionicons
                  name={favoriteIds.has(`channel-${item.stream_id}`) ? 'heart' : 'heart-outline'}
                  size={16}
                  color={favoriteIds.has(`channel-${item.stream_id}`) ? colors.accentMagenta : colors.textMuted}
                />
              </Pressable>
            </Pressable>
          )}
        />
          )}
        </View>
      </View>
      )}
      {parentalModal}

      {/* Categories drawer — opened via the header menu button. Picking a
          category filters the same channel grid in place, no navigation. */}
      <Modal visible={showCategoryDrawer} transparent animationType="fade" onRequestClose={() => setShowCategoryDrawer(false)}>
        <Pressable style={styles.drawerOverlay} onPress={() => setShowCategoryDrawer(false)}>
          <Pressable style={styles.drawerPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.drawerTitle}>CATEGORIAS</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              {catNames.map((cat) => {
                const active = cat === selectedCat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => {
                      setSelectedCat(cat);
                      setShowCategoryDrawer(false);
                    }}
                    style={[styles.drawerItem, active && styles.drawerItemActive]}
                    testID={`drawer-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}>
                      {cat === FAVORITES && <Ionicons name="heart" size={14} color={active ? colors.accentCyan : colors.textSecondary} />}
                      <Text style={[styles.drawerItemText, active && styles.drawerItemTextActive]} numberOfLines={1}>
                        {cat}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={16} color={colors.accentCyan} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Empty({ errorCode, onRetry }: { errorCode: string | null; onRetry: () => void }) {
  const blocked = errorCode === 'BLOCKED_CLOUDFLARE';
  return (
    <View style={styles.center} testID="channels-empty">
      <MaterialCommunityIcons
        name={blocked ? 'cloud-alert' : 'television-off'}
        size={44}
        color={colors.textMuted}
      />
      <Text style={styles.emptyTitle}>
        {blocked ? 'Bloqueado no preview' : 'Nenhum canal encontrado'}
      </Text>
      <Text style={styles.emptySub}>
        {blocked
          ? 'Abra o app no Expo Go pelo celular ou no APK\npra carregar os canais.'
          : 'Tente outra categoria ou verifique sua conexão.'}
      </Text>
      <Pressable onPress={onRetry} style={styles.retryBtn} testID="channels-retry">
        <Ionicons name="refresh" size={14} color={colors.accentCyan} />
        <Text style={styles.retryText}>TENTAR NOVAMENTE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  searchBox: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.white, fontSize: 14 },
  gameHint: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.darkSurfaceAlt,
  },
  gameHintText: { flex: 1, color: colors.textSecondary, fontSize: 10, lineHeight: 14 },
  chipRow: { height: 56, justifyContent: 'center' },
  chipRowInner: { gap: 8, paddingHorizontal: spacing.md, alignItems: 'center' },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.darkSurface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.darkSurfaceAlt,
    flexShrink: 0,
    maxWidth: 200,
  },
  chipActive: { borderColor: colors.accentCyan, backgroundColor: 'rgba(76,232,240,0.10)' },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.accentCyan },
  sideCatCol: { width: 160, maxWidth: 160, minWidth: 160, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.darkSurfaceAlt },
  sideCatColInner: { padding: 6, gap: 4 },
  sideChip: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 6,
    backgroundColor: colors.darkSurface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideChipActive: { backgroundColor: 'rgba(76,232,240,0.14)' },
  sideChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', flexShrink: 1 },

  // --- Layout de TV (categorias | lista numerada | preview ao vivo) ---
  tvCatCol: {
    width: 260,
    maxWidth: 260,
    minWidth: 260,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: colors.darkSurfaceAlt,
  },
  tvCatColInner: { paddingVertical: spacing.sm },
  tvCatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  tvCatItemActive: { backgroundColor: 'rgba(76,232,240,0.14)' },
  tvCatText: { color: colors.textSecondary, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  tvCatTextActive: { color: colors.accentCyan },
  tvCatCount: { color: colors.textMuted, fontSize: 13, marginLeft: 6 },
  tvListCol: {
    width: 340,
    maxWidth: 340,
    minWidth: 340,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: colors.darkSurfaceAlt,
  },
  tvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    height: 56,
  },
  tvRowActive: { backgroundColor: 'rgba(76,232,240,0.10)' },
  tvRowFocus: {
    borderWidth: 2,
    borderColor: colors.accentCyan,
    borderRadius: 8,
    transform: [{ scale: 1 }],
  },
  tvRowNum: { color: colors.textMuted, fontSize: 14, width: 34, fontVariant: ['tabular-nums'] },
  tvRowIcon: { width: 32, height: 32 },
  tvRowName: { color: colors.white, fontSize: 16, fontWeight: '600', flex: 1 },
  tvPreviewCol: { flex: 1, padding: spacing.sm },
  sideChipTextActive: { color: colors.accentCyan },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    minHeight: 68,
    backgroundColor: colors.darkSurface,
    borderRadius: 12,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: 44, height: 44 },
  cardName: { color: colors.white, fontSize: 13, fontWeight: '700' },
  cardCat: { color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  emptyTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 12 },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  retryBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  retryText: { color: colors.accentCyan, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  cardHeart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(11,15,26,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawerPanel: {
    width: '78%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: colors.darkSurface,
    paddingTop: 60,
    paddingHorizontal: spacing.md,
  },
  drawerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  drawerItemActive: { backgroundColor: 'rgba(76,232,240,0.10)' },
  drawerItemText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', flex: 1 },
  drawerItemTextActive: { color: colors.accentCyan, fontWeight: '800' },
});
