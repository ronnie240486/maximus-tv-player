import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { posterImageProps } from '@/src/lib/image-placeholder';
import { getXtream } from '@/src/state/session';
import { loadListCache, saveListCache } from '@/src/state/list-cache';
import { xtream, XtreamCategory, XtreamSeries } from '@/src/lib/xtream';
import { isAdultCategoryName, filterToKidsCategories, filterToKidsItems } from '@/src/lib/adult-content';
import { isActiveProfileKids } from '@/src/state/profiles';
import { dedupeByName } from '@/src/lib/dedupe';
import { useParentalGate } from '@/src/lib/use-parental-gate';
import { loadFavorites, toggleFavorite } from '@/src/state/favorites';
import { useIsTV } from '@/src/hooks/useIsTV';
import { getFlashListPerfProps } from '@/src/hooks/useIsLowEndDevice';
import { useListImagePrefetch } from '@/src/hooks/useListImagePrefetch';
import TVFocusable from '@/src/components/TVFocusable';

const ALL = 'Todos';
const FAVORITES = 'Favoritos';
const CACHE_KEY = 'series';
const SIDE_COL_WIDTH_PHONE = 160;
const SIDE_COL_WIDTH_TV = 230;

export default function SeriesScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const flashListPerf = getFlashListPerfProps();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const numColumns = isLandscape ? 6 : 3;
  const SIDE_COL_WIDTH = isTV ? SIDE_COL_WIDTH_TV : SIDE_COL_WIDTH_PHONE;
  const gridWidth = isLandscape ? width - SIDE_COL_WIDTH : width;
  const itemGap = spacing.sm;
  const itemWidth = (gridWidth - spacing.md * 2 - itemGap * (numColumns - 1)) / numColumns;
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [series, setSeries] = useState<XtreamSeries[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'default' | 'az' | 'date' | 'rating'>('default');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const { modal: parentalModal, guard } = useParentalGate();

  useFocusEffect(
    useCallback(() => {
      loadFavorites().then((list) => {
        setFavoriteIds(new Set(list.filter((f) => f.kind === 'series').map((f) => f.id)));
      });
    }, [])
  );

  const onToggleFavorite = async (s: XtreamSeries) => {
    const id = `series-${s.series_id}`;
    const nowFav = await toggleFavorite({ id, kind: 'series', refId: s.series_id, name: s.name, cover: s.cover });
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const load = useCallback(async () => {
    const cache = await loadListCache<XtreamCategory, XtreamSeries>(CACHE_KEY);
    if (cache) {
      setCategories(cache.categories);
      setSeries(cache.items);
      setLoading(false);
    }

    const creds = getXtream();
    if (!creds) {
      if (!cache) setLoading(false);
      return;
    }

    const catsPromise = xtream.seriesCategories(creds).then((cats) => {
      if (cats && cats.length) setCategories(cats);
      return cats;
    });

    const list = await xtream.seriesList(creds);
    if (list && list.length) setSeries(list);
    setLoading(false);

    const cats = await catsPromise;
    if (list && list.length) {
      saveListCache(CACHE_KEY, cats || [], list);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [kidsMode, setKidsMode] = useState(false);
  useEffect(() => {
    isActiveProfileKids().then(setKidsMode);
  }, []);

  const visibleCategories = useMemo(
    () => (kidsMode ? filterToKidsCategories(categories) : categories),
    [categories, kidsMode]
  );
  const visibleSeries = useMemo(
    () => (kidsMode ? filterToKidsItems(series, categories) : series),
    [series, categories, kidsMode]
  );

  const catNames = useMemo<string[]>(
    () => [FAVORITES, ALL, ...visibleCategories.map((c) => c.category_name)],
    [visibleCategories]
  );

  const sortItems = useCallback(
    (items: XtreamSeries[]) => {
      const sorted = [...items];
      if (sortBy === 'az') {
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      } else if (sortBy === 'date') {
        sorted.sort((a, b) => (Date.parse(b.releaseDate || '') || 0) - (Date.parse(a.releaseDate || '') || 0));
      } else if (sortBy === 'rating') {
        sorted.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
      }
      return sorted;
    },
    [sortBy]
  );

  // Mesmo motivo do movies.tsx: filtro pesado sem favoriteIds nas
  // dependências — favoritar não recalcula mais a lista inteira.
  const nonFavFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const catId = selectedCat === ALL ? null : visibleCategories.find((c) => c.category_name === selectedCat)?.category_id;
    const matches = visibleSeries.filter((s) => {
      const catOk = !catId || s.category_id === catId;
      const qOk = !q || s.name.toLowerCase().includes(q);
      return catOk && qOk;
    });
    return sortItems(dedupeByName(matches));
  }, [visibleSeries, visibleCategories, selectedCat, query, sortItems]);

  const filtered = useMemo(() => {
    if (selectedCat === FAVORITES) {
      const base = dedupeByName(visibleSeries.filter((s) => favoriteIds.has(`series-${s.series_id}`)));
      return sortItems(base);
    }
    return nonFavFiltered;
  }, [selectedCat, favoriteIds, visibleSeries, nonFavFiltered, sortItems]);

  const { onViewableItemsChanged, viewabilityConfig } = useListImagePrefetch(
    filtered,
    (s: XtreamSeries) => s.cover
  );

  const openSeries = (s: XtreamSeries) => {
    const categoryName = categories.find((c) => c.category_id === s.category_id)?.category_name;
    guard(categoryName, () => {
      router.push({
        pathname: '/series-details',
        params: {
          id: String(s.series_id),
          name: s.name,
          cover: s.cover || '',
          adult: isAdultCategoryName(categoryName) ? '1' : '',
        },
      });
    });
  };

  const categoryChips = (
    <>
      {catNames.map((cat) => {
        const active = cat === selectedCat;
        return (
          <TVFocusable
            key={cat}
            onPress={() => setSelectedCat(cat)}
            style={[isLandscape ? styles.sideChip : styles.chip, active && (isLandscape ? styles.sideChipActive : styles.chipActive)]}
            testID={`series-chip-${cat.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {cat === FAVORITES && (
              <Ionicons name="heart" size={12} color={active ? colors.accentCyan : colors.textSecondary} style={{ marginRight: 4 }} />
            )}
            <Text
              style={[
                isLandscape ? styles.sideChipText : styles.chipText,
                active && (isLandscape ? styles.sideChipTextActive : styles.chipTextActive),
                isLandscape && isTV && { fontSize: 15 },
              ]}
              numberOfLines={isLandscape ? 2 : 1}
            >
              {cat}
            </Text>
          </TVFocusable>
        );
      })}
    </>
  );

  const grid =
    loading ? (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentCyan} />
      </View>
    ) : filtered.length === 0 ? (
      <View style={styles.center} testID="series-empty">
        <MaterialCommunityIcons name="movie-off" size={44} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Nenhuma série encontrada</Text>
      </View>
    ) : (
      <FlashList
        key={numColumns}
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(s) => String(s.series_id)}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: 32, gap: spacing.md }}
        {...flashListPerf}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <TVFocusable
            style={[styles.poster, { width: itemWidth }]}
            focusStyle={styles.posterFocusTV}
            testID={`series-${item.series_id}`}
            onPress={() => openSeries(item)}
          >
            <View style={styles.posterCard}>
              {item.cover ? (
                <Image source={{ uri: item.cover }} style={styles.posterImg} contentFit="cover" cachePolicy="memory-disk" {...posterImageProps} />
              ) : (
                <Ionicons name="film" size={30} color={colors.textMuted} />
              )}
              <Pressable
                onPress={() => onToggleFavorite(item)}
                hitSlop={10}
                style={styles.posterHeart}
                testID={`series-favorite-${item.series_id}`}
              >
                <Ionicons
                  name={favoriteIds.has(`series-${item.series_id}`) ? 'heart' : 'heart-outline'}
                  size={16}
                  color={favoriteIds.has(`series-${item.series_id}`) ? colors.accentMagenta : colors.white}
                />
              </Pressable>
            </View>
            <Text style={styles.posterName} numberOfLines={2}>{item.name}</Text>
          </TVFocusable>
        )}
      />
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={[styles.header, isLandscape && { paddingVertical: 5 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="series-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={[styles.headerTitle, isLandscape && { fontSize: 15 }]}>Séries</Text>
        <Pressable onPress={() => router.push('/favorites')} hitSlop={12} testID="series-favorites">
          <Ionicons name="heart-outline" size={22} color={colors.white} />
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar série..."
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="series-search-input"
        />
      </View>

      <Pressable onPress={() => setShowSortMenu(true)} style={styles.sortBtn} testID="series-sort-btn">
        <Ionicons name="swap-vertical" size={14} color={colors.accentCyan} />
        <Text style={styles.sortBtnText}>
          Ordenar: {sortBy === 'default' ? 'Padrão' : sortBy === 'az' ? 'A-Z' : sortBy === 'date' ? 'Mais recentes' : 'Nota'}
        </Text>
      </Pressable>

      <Modal visible={showSortMenu} transparent animationType="fade" onRequestClose={() => setShowSortMenu(false)}>
        <Pressable style={styles.sortOverlay} onPress={() => setShowSortMenu(false)}>
          <View style={styles.sortMenu}>
            {([
              { key: 'default', label: 'Padrão' },
              { key: 'az', label: 'Ordem alfabética (A-Z)' },
              { key: 'date', label: 'Mais recentes' },
              { key: 'rating', label: 'Melhor nota' },
            ] as const).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  setSortBy(opt.key);
                  setShowSortMenu(false);
                }}
                style={styles.sortOption}
                testID={`series-sort-${opt.key}`}
              >
                <Text style={[styles.sortOptionText, sortBy === opt.key && styles.sortOptionTextActive]}>{opt.label}</Text>
                {sortBy === opt.key && <Ionicons name="checkmark" size={16} color={colors.accentCyan} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {isLandscape ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <ScrollView
            style={[styles.sideCatCol, { width: SIDE_COL_WIDTH, maxWidth: SIDE_COL_WIDTH, minWidth: SIDE_COL_WIDTH }]}
            contentContainerStyle={styles.sideCatColInner}
            showsVerticalScrollIndicator={false}
          >
            {categoryChips}
          </ScrollView>
          <View style={{ flex: 1, minWidth: 0 }}>{grid}</View>
        </View>
      ) : (
        <>
          <View style={styles.chipRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
              {categoryChips}
            </ScrollView>
          </View>
          {grid}
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
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
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
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.darkSurfaceAlt,
  },
  sortBtnText: { color: colors.accentCyan, fontSize: 11, fontWeight: '700' },
  sortOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  sortMenu: {
    width: '80%',
    maxWidth: 300,
    backgroundColor: colors.darkSurface,
    borderRadius: 12,
    padding: spacing.sm,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  sortOptionText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  sortOptionTextActive: { color: colors.accentCyan, fontWeight: '800' },
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
  sideChipTextActive: { color: colors.accentCyan },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  poster: {},
  posterFocusTV: {
    borderWidth: 2,
    borderColor: colors.accentCyan,
    borderRadius: 10,
  },
  posterCard: {
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  posterHeart: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(11,15,26,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterImg: { width: '100%', height: '100%' },
  posterName: { color: colors.white, fontSize: 11, marginTop: 6 },
});
