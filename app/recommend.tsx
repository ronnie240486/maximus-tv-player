import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { posterImageProps } from '@/src/lib/image-placeholder';
import { getXtream } from '@/src/state/session';
import { xtream, XtreamCategory, XtreamMovie, XtreamSeries } from '@/src/lib/xtream';
import { isAdultCategoryName, filterToKidsCategories, filterToKidsItems } from '@/src/lib/adult-content';
import { isActiveProfileKids } from '@/src/state/profiles';
import { useParentalGate } from '@/src/lib/use-parental-gate';
import { loadListCache } from '@/src/state/list-cache';
import { GenreKey, GENRE_LABELS, filterByGenre, shuffleSample } from '@/src/lib/genre-detect';
import { enrichGenresInBackground, getAllCachedGenres, isTmdbConfigured, getSimilarTitles } from '@/src/lib/tmdb';
import TVFocusable from '@/src/components/TVFocusable';

const SUGGESTION_COUNT = 20;

type SuggestionItem = {
  key: string;
  kind: 'movie' | 'series';
  name: string;
  cover?: string;
  categoryId?: string;
  raw: XtreamMovie | XtreamSeries;
};

export default function RecommendScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ genre?: string; query?: string; similarTo?: string }>();
  const genre = params.genre as GenreKey | undefined;
  const similarTo = params.similarTo;
  const { modal: parentalModal, guard } = useParentalGate();

  const [loading, setLoading] = useState(true);
  const [kidsMode, setKidsMode] = useState(false);
  const [moviePool, setMoviePool] = useState<{ items: XtreamMovie[]; categories: XtreamCategory[] }>({ items: [], categories: [] });
  const [seriesPool, setSeriesPool] = useState<{ items: XtreamSeries[]; categories: XtreamCategory[] }>({ items: [], categories: [] });
  const [shownItems, setShownItems] = useState<SuggestionItem[]>([]);
  const [seed, setSeed] = useState(0);
  const [tmdbCache, setTmdbCache] = useState<Record<string, { genres: GenreKey[] }>>({});
  const [enriching, setEnriching] = useState(false);
  const [enrichedCount, setEnrichedCount] = useState(0);
  // Modo "parecido com X": nomes de títulos parecidos que o TMDb devolveu
  // (baseado no algoritmo deles) — depois cruzados com o catálogo real da
  // pessoa, pra só mostrar o que ela de fato tem disponível.
  const [similarNames, setSimilarNames] = useState<string[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  useEffect(() => {
    isActiveProfileKids().then(setKidsMode);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const creds = getXtream();
    if (!creds) {
      setLoading(false);
      return;
    }
    // Usa o mesmo cache que Filmes/Séries já mantêm — se a pessoa já
    // abriu essas telas antes, isso é instantâneo (sem esperar rede).
    // Se ainda não tiver cache (app recém-aberto), busca na hora.
    const [movieCache, seriesCache] = await Promise.all([
      loadListCache<XtreamCategory, XtreamMovie>('movies'),
      loadListCache<XtreamCategory, XtreamSeries>('series'),
    ]);

    let movieItems = movieCache?.items || [];
    let movieCats = movieCache?.categories || [];
    if (movieItems.length === 0) {
      const [cats, items] = await Promise.all([xtream.vodCategories(creds), xtream.vodStreams(creds)]);
      movieCats = cats || [];
      movieItems = items || [];
    }

    let seriesItems = seriesCache?.items || [];
    let seriesCats = seriesCache?.categories || [];
    if (seriesItems.length === 0) {
      const [cats, items] = await Promise.all([xtream.seriesCategories(creds), xtream.seriesList(creds)]);
      seriesCats = cats || [];
      seriesItems = items || [];
    }

    setMoviePool({ items: movieItems, categories: movieCats });
    setSeriesPool({ items: seriesItems, categories: seriesCats });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || !similarTo || !isTmdbConfigured()) return;
    let cancelled = false;
    setSimilarLoading(true);
    getSimilarTitles(similarTo).then((names) => {
      if (!cancelled) {
        setSimilarNames(names);
        setSimilarLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loading, similarTo]);

  // Enriquecimento em segundo plano: manda os títulos do catálogo (que
  // ainda não sabemos o gênero real) pro TMDb, aos poucos, sem travar a
  // tela. Cada vez que um lote termina, atualiza o cache local — e como
  // o cache é PERSISTENTE (fica salvo no aparelho), o catálogo vai
  // ficando cada vez mais coberto a cada busca por voz feita, não só
  // nessa sessão. Não faz nada se a chave do TMDb não estiver
  // configurada (EXPO_PUBLIC_TMDB_API_KEY), nem no modo "parecido com X"
  // (não precisa de gênero nesse modo).
  useEffect(() => {
    if (loading || !isTmdbConfigured() || similarTo) return;
    let cancelled = false;
    setEnriching(true);
    setEnrichedCount(0);

    const titles = [
      ...moviePool.items.map((m) => ({ title: m.name, kind: 'movie' as const })),
      ...seriesPool.items.map((s) => ({ title: s.name, kind: 'series' as const })),
    ];

    enrichGenresInBackground(titles, {
      onBatchDone: () => {
        if (cancelled) return;
        setEnrichedCount((c) => c + 1);
        getAllCachedGenres().then((all) => {
          if (!cancelled) setTmdbCache(all);
        });
      },
    }).finally(() => {
      if (!cancelled) setEnriching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loading, moviePool, seriesPool]);

  // Combina o match rápido (categoria + títulos conhecidos, síncrono) com
  // o que o TMDb já descobriu até agora (cache, cresce em segundo plano)
  // — um título só precisa bater em UM dos dois métodos.
  const matchWithTmdb = useCallback(
    <T extends { name: string; category_id?: string }>(
      items: T[],
      categories: XtreamCategory[],
      genreKey: GenreKey,
      kind: 'movie' | 'series'
    ): T[] => {
      const fastMatches = new Set(filterByGenre(items, categories, genreKey));
      const extra = items.filter((item) => {
        if (fastMatches.has(item)) return false;
        const cacheKey = `${kind}:${item.name.toLowerCase().trim()}`;
        return (tmdbCache[cacheKey]?.genres || []).includes(genreKey);
      });
      return [...fastMatches, ...extra];
    },
    [tmdbCache]
  );

  const pick = useCallback(() => {
    // Perfil infantil: nunca sugere fora da curadoria kids (mesma regra
    // das telas de Filmes/Séries). Perfil normal: sugere de tudo, só pede
    // PIN ao abrir algo de categoria adulta (via guard, igual às outras
    // telas) — não filtra a sugestão em si.
    const movieCats = kidsMode ? filterToKidsCategories(moviePool.categories) : moviePool.categories;
    const movieItems = kidsMode ? filterToKidsItems(moviePool.items, moviePool.categories) : moviePool.items;
    const seriesCats = kidsMode ? filterToKidsCategories(seriesPool.categories) : seriesPool.categories;
    const seriesItemsBase = kidsMode ? filterToKidsItems(seriesPool.items, seriesPool.categories) : seriesPool.items;

    let matchedMovies: XtreamMovie[];
    let matchedSeries: XtreamSeries[];

    if (similarTo) {
      // Modo "parecido com X": cruza os nomes que o TMDb achou como
      // parecidos com o que a pessoa REALMENTE tem no catálogo — nome
      // "contém" nos dois sentidos, pra tolerar título com sufixo (ano,
      // "dublado" etc) de qualquer um dos dois lados.
      const names = similarNames || [];
      const normalizeForMatch = (s: string) =>
        s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const nameMatches = (itemName: string) => {
        const n = normalizeForMatch(itemName);
        if (n.length < 4) return false;
        return names.some((sim) => {
          const s = normalizeForMatch(sim);
          // Limite mínimo de tamanho pros dois lados — sem isso, um
          // pedaço de texto curto/genérico (ex: um número, uma palavra
          // solta) podia "bater" por acidente e trazer coisa sem nada a
          // ver (foi o caso reportado: "Ben 10" aparecendo como
          // parecido com "De Volta pro Futuro").
          if (s.length < 4) return false;
          return n.includes(s) || s.includes(n);
        });
      };
      matchedMovies = movieItems.filter((m) => nameMatches(m.name));
      matchedSeries = seriesItemsBase.filter((s) => nameMatches(s.name));
    } else if (genre) {
      matchedMovies = matchWithTmdb(movieItems, movieCats, genre, 'movie');
      matchedSeries = matchWithTmdb(seriesItemsBase, seriesCats, genre, 'series');
    } else {
      matchedMovies = [];
      matchedSeries = [];
    }

    // Mistura filme e série no resultado — metade de cada, mais ou menos
    // (se um dos dois tiver pouca coisa, completa com o outro).
    const halfCount = Math.ceil(SUGGESTION_COUNT / 2);
    const pickedMovies = shuffleSample(matchedMovies, halfCount);
    const pickedSeries = shuffleSample(matchedSeries, SUGGESTION_COUNT - pickedMovies.length);
    let combined: SuggestionItem[] = [
      ...pickedMovies.map((m) => ({ key: `movie-${m.stream_id}`, kind: 'movie' as const, name: m.name, cover: m.stream_icon, categoryId: m.category_id, raw: m })),
      ...pickedSeries.map((s) => ({ key: `series-${s.series_id}`, kind: 'series' as const, name: s.name, cover: s.cover, categoryId: s.category_id, raw: s })),
    ];
    if (combined.length < SUGGESTION_COUNT && matchedMovies.length > pickedMovies.length) {
      const extra = shuffleSample(matchedMovies.filter((m) => !pickedMovies.includes(m)), SUGGESTION_COUNT - combined.length);
      combined = [...combined, ...extra.map((m) => ({ key: `movie-${m.stream_id}`, kind: 'movie' as const, name: m.name, cover: m.stream_icon, categoryId: m.category_id, raw: m }))];
    }
    if (combined.length < SUGGESTION_COUNT && matchedSeries.length > pickedSeries.length) {
      const extra = shuffleSample(matchedSeries.filter((s) => !pickedSeries.includes(s)), SUGGESTION_COUNT - combined.length);
      combined = [...combined, ...extra.map((s) => ({ key: `series-${s.series_id}`, kind: 'series' as const, name: s.name, cover: s.cover, categoryId: s.category_id, raw: s }))];
    }

    setShownItems(shuffleSample(combined, combined.length));
  }, [genre, similarTo, similarNames, kidsMode, moviePool, seriesPool, matchWithTmdb]);

  useEffect(() => {
    if (!loading && (!similarTo || similarNames !== null)) pick();
  }, [loading, seed, pick, similarTo, similarNames]);

  const totalMatches = useMemo(() => {
    const movieCats = kidsMode ? filterToKidsCategories(moviePool.categories) : moviePool.categories;
    const movieItems = kidsMode ? filterToKidsItems(moviePool.items, moviePool.categories) : moviePool.items;
    const seriesCats = kidsMode ? filterToKidsCategories(seriesPool.categories) : seriesPool.categories;
    const seriesItemsBase = kidsMode ? filterToKidsItems(seriesPool.items, seriesPool.categories) : seriesPool.items;
    if (!genre) return 0;
    return matchWithTmdb(movieItems, movieCats, genre, 'movie').length + matchWithTmdb(seriesItemsBase, seriesCats, genre, 'series').length;
  }, [genre, kidsMode, moviePool, seriesPool, matchWithTmdb]);

  const openItem = (item: SuggestionItem) => {
    const cats = item.kind === 'movie' ? moviePool.categories : seriesPool.categories;
    const categoryName = cats.find((c) => c.category_id === item.categoryId)?.category_name;
    guard(categoryName, () => {
      if (item.kind === 'movie') {
        const m = item.raw as XtreamMovie;
        router.push({
          pathname: '/movie-details',
          params: { id: String(m.stream_id), name: m.name, cover: m.stream_icon || '', adult: isAdultCategoryName(categoryName) ? '1' : '' },
        });
      } else {
        const s = item.raw as XtreamSeries;
        router.push({
          pathname: '/series-details',
          params: { id: String(s.series_id), name: s.name, cover: s.cover || '', adult: isAdultCategoryName(categoryName) ? '1' : '' },
        });
      }
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TVFocusable onPress={() => router.back()} style={styles.backBtn} testID="recommend-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </TVFocusable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {similarTo ? `Parecido com ${similarTo}` : genre ? GENRE_LABELS[genre] : 'Sugestões'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {!!params.query && (
        <Text style={styles.querySubtitle} numberOfLines={1}>Baseado em: "{params.query}"</Text>
      )}
      {enriching && (
        <Text style={styles.enrichingText}>
          Melhorando sugestões com dados reais de gênero (TMDb) — pode ir mudando aos poucos...
        </Text>
      )}

      {(loading || similarLoading) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentCyan} size="large" />
          {similarLoading && <Text style={styles.emptyText}>Buscando títulos parecidos...</Text>}
        </View>
      ) : shownItems.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="film-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            {similarTo
              ? `Não achei nada parecido com "${similarTo}" no seu catálogo — o TMDb pode ter sugerido títulos que seu painel não tem disponível.`
              : 'Não achei filmes ou séries desse gênero no seu catálogo ainda. Essa busca reconhece os títulos mais conhecidos — pode não cobrir tudo que você tem disponível.'}
          </Text>
        </View>
      ) : (
        <>
          <FlashList
            data={shownItems}
            keyExtractor={(item) => item.key}
            numColumns={3}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: 90 }}
            renderItem={({ item }) => (
              <TVFocusable onPress={() => openItem(item)} style={styles.card} testID={`recommend-item-${item.key}`}>
                <View style={styles.posterBox}>
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={styles.poster} {...posterImageProps} />
                  ) : (
                    <MaterialCommunityIcons name={item.kind === 'movie' ? 'movie-open' : 'television-classic'} size={28} color={colors.textMuted} />
                  )}
                  <View style={styles.kindBadge}>
                    <Text style={styles.kindBadgeText}>{item.kind === 'movie' ? 'FILME' : 'SÉRIE'}</Text>
                  </View>
                </View>
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              </TVFocusable>
            )}
          />

          {!similarTo && (
            <TVFocusable onPress={() => setSeed((s) => s + 1)} style={styles.shuffleBtn} testID="recommend-shuffle">
              <Ionicons name="shuffle" size={16} color={colors.black} />
              <Text style={styles.shuffleBtnText}>
                Outras sugestões{totalMatches > SUGGESTION_COUNT ? ` (${totalMatches} no total)` : ''}
              </Text>
            </TVFocusable>
          )}
        </>
      )}

      {parentalModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: colors.white, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  querySubtitle: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingBottom: spacing.sm },
  enrichingText: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  card: { flex: 1, margin: 6, maxWidth: '31%' },
  posterBox: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  poster: { width: '100%', height: '100%' },
  kindBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kindBadgeText: { color: colors.white, fontSize: 8, fontWeight: '800' },
  cardName: { color: colors.white, fontSize: 12, fontWeight: '600', marginTop: 4 },
  shuffleBtn: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
  },
  shuffleBtnText: { color: colors.black, fontWeight: '800', fontSize: 13 },
});
