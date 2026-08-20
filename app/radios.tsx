import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, TextInput, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useVideoPlayer } from 'expo-video';

import { colors, spacing } from '@/src/theme';
import {
  RADIO_CATEGORIES,
  RadioStation,
  fetchStationsByCategory,
  searchStationsByName,
  radioStreamUrl,
} from '@/src/lib/radio';
import { loadFavorites, toggleFavorite } from '@/src/state/favorites';
import TVFocusable from '@/src/components/TVFocusable';

const FAVORITES_KEY = '__favorites__';
const SIDE_COL_WIDTH = 160;
const ALL_CATS = [{ key: FAVORITES_KEY, label: 'Favoritos', tags: [] as string[] }, ...RADIO_CATEGORIES];

export default function RadiosScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const numColumns = isLandscape ? 6 : 3;
  const gridWidth = isLandscape ? width - SIDE_COL_WIDTH : width;
  const itemGap = spacing.sm;
  const itemWidth = (gridWidth - spacing.md * 2 - itemGap * (numColumns - 1)) / numColumns;
  const [selectedCat, setSelectedCat] = useState(RADIO_CATEGORIES[0]);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RadioStation[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteStations, setFavoriteStations] = useState<RadioStation[]>([]);

  const player = useVideoPlayer('', (p) => {
    p.loop = false;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      setBuffering(status === 'loading');
    });
    return () => sub.remove();
  }, [player]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites().then((list) => {
        const radios = list.filter((f) => f.kind === 'radio');
        setFavoriteIds(new Set(radios.map((f) => f.id)));
        setFavoriteStations(
          radios.map((f) => ({
            stationuuid: String(f.refId),
            name: f.name,
            url_resolved: f.streamUrl || '',
            url: f.streamUrl || '',
            favicon: f.cover,
          }))
        );
      });
    }, [])
  );

  const load = useCallback(async (cat: typeof selectedCat) => {
    if (cat.key === FAVORITES_KEY) return;
    setLoading(true);
    setError(false);
    try {
      const list = await fetchStationsByCategory(cat);
      setStations(list);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load(selectedCat);
  }, [selectedCat, load]);

  useEffect(() => {
    if (!showSearch) return;
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchStationsByName(q)
        .then(setSearchResults)
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query, showSearch]);

  const play = async (station: RadioStation) => {
    setCurrent(station);
    setPlaying(true);
    setBuffering(true);
    try {
      // Sem User-Agent explícito, vários servidores de rádio
      // (Shoutcast/Icecast) recusam a conexão — mesma proteção que os
      // outros players do app já usam pra streams de vídeo.
      await player.replaceAsync({
        uri: radioStreamUrl(station),
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1' },
      });
      player.play();
    } catch {
      setBuffering(false);
    }
  };

  const togglePlay = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  const closePlayer = () => {
    player.pause();
    setCurrent(null);
    setPlaying(false);
  };

  const onToggleFavoriteStation = async (station: RadioStation) => {
    const id = `radio-${station.stationuuid}`;
    const nowFav = await toggleFavorite({
      id,
      kind: 'radio',
      refId: station.stationuuid,
      name: station.name.trim(),
      cover: station.favicon,
      streamUrl: radioStreamUrl(station),
    });
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (nowFav) next.add(id);
      else next.delete(id);
      return next;
    });
    setFavoriteStations((prev) =>
      nowFav
        ? [...prev, station]
        : prev.filter((s) => s.stationuuid !== station.stationuuid)
    );
  };

  const listData = showSearch ? searchResults : selectedCat.key === FAVORITES_KEY ? favoriteStations : stations;
  const listLoading = showSearch ? searching : selectedCat.key === FAVORITES_KEY ? false : loading;

  const categoryChips = (
    <>
      {ALL_CATS.map((cat) => {
        const active = cat.key === selectedCat.key;
        return (
          <TVFocusable
            key={cat.key}
            onPress={() => setSelectedCat(cat as typeof selectedCat)}
            style={[isLandscape ? styles.sideChip : styles.chip, active && (isLandscape ? styles.sideChipActive : styles.chipActive)]}
            testID={`radio-chip-${cat.key}`}
          >
            {cat.key === FAVORITES_KEY && (
              <Ionicons name="heart" size={12} color={active ? colors.accentCyan : colors.textSecondary} style={{ marginRight: 4 }} />
            )}
            <Text style={[isLandscape ? styles.sideChipText : styles.chipText, active && (isLandscape ? styles.sideChipTextActive : styles.chipTextActive)]} numberOfLines={isLandscape ? 2 : 1}>
              {cat.label}
            </Text>
          </TVFocusable>
        );
      })}
    </>
  );

  const grid = listLoading ? (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accentCyan} />
    </View>
  ) : showSearch && query.trim().length < 2 ? (
    <View style={styles.center}>
      <Ionicons name="search" size={40} color={colors.textMuted} />
      <Text style={styles.emptySub}>Digite pelo menos 2 letras pra buscar.</Text>
    </View>
  ) : error || listData.length === 0 ? (
    <View style={styles.center} testID="radios-empty">
      <MaterialCommunityIcons name="radio-off" size={44} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>
        {selectedCat.key === FAVORITES_KEY ? 'Nenhuma rádio favoritada ainda' : 'Nenhuma rádio encontrada'}
      </Text>
      {selectedCat.key !== FAVORITES_KEY && (
        <Text style={styles.emptySub}>Tenta outra categoria ou confere sua internet.</Text>
      )}
    </View>
  ) : (
    <FlatList
      key={numColumns}
        style={{ flex: 1 }}
      data={listData}
      keyExtractor={(s) => s.stationuuid}
      numColumns={numColumns}
      columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
      contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: current ? 110 : 24, gap: spacing.md }}
      renderItem={({ item }) => {
        const active = current?.stationuuid === item.stationuuid;
        const favId = `radio-${item.stationuuid}`;
        const isFav = favoriteIds.has(favId);
        return (
          <TVFocusable style={[styles.station, { width: itemWidth }]} focusStyle={styles.stationFocusTV} onPress={() => play(item)} testID={`radio-${item.stationuuid}`}>
            <View style={[styles.stationCard, active && styles.stationCardActive]}>
              {item.favicon ? (
                <Image source={{ uri: item.favicon }} style={styles.stationImg} contentFit="contain" />
              ) : (
                <MaterialCommunityIcons name="radio" size={26} color={colors.textMuted} />
              )}
              <Pressable
                onPress={() => onToggleFavoriteStation(item)}
                hitSlop={8}
                style={styles.stationHeart}
                testID={`radio-favorite-${item.stationuuid}`}
              >
                <Ionicons
                  name={isFav ? 'heart' : 'heart-outline'}
                  size={14}
                  color={isFav ? colors.accentMagenta : colors.white}
                />
              </Pressable>
              {active && playing && (
                <View style={styles.stationPlayingBadge}>
                  <View style={styles.eqBar1} />
                  <View style={styles.eqBar2} />
                  <View style={styles.eqBar3} />
                </View>
              )}
            </View>
            <Text style={styles.stationName} numberOfLines={2}>{item.name.trim()}</Text>
          </TVFocusable>
        );
      }}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={[styles.header, isLandscape && { paddingVertical: 5 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="radios-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={[styles.headerTitle, isLandscape && { fontSize: 15 }]}>Rádios</Text>
        <TVFocusable onPress={() => setShowSearch((v) => !v)} hitSlop={12} testID="radios-search-toggle">
          <Ionicons name={showSearch ? 'close' : 'search'} size={22} color={colors.white} />
        </TVFocusable>
      </View>

      {showSearch && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar rádio pelo nome..."
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoFocus
            testID="radios-search-input"
          />
        </View>
      )}

      {isLandscape ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {!showSearch && (
            <ScrollView style={styles.sideCatCol} contentContainerStyle={styles.sideCatColInner} showsVerticalScrollIndicator={false}>
              {categoryChips}
            </ScrollView>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>{grid}</View>
        </View>
      ) : (
        <>
          {!showSearch && (
            <View style={styles.chipRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
                {categoryChips}
              </ScrollView>
            </View>
          )}
          {grid}
        </>
      )}

      {current && (
        <View style={styles.miniPlayer} testID="radio-mini-player">
          <View style={styles.miniLogoBox}>
            {current.favicon ? (
              <Image source={{ uri: current.favicon }} style={styles.miniLogoImg} contentFit="contain" />
            ) : (
              <MaterialCommunityIcons name="radio" size={20} color={colors.textMuted} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniName} numberOfLines={1}>{current.name.trim()}</Text>
            <Text style={styles.miniSub}>{buffering ? 'Carregando...' : playing ? 'Ao vivo' : 'Pausado'}</Text>
          </View>
          <TVFocusable onPress={togglePlay} style={styles.miniBtn} testID="radio-play-pause">
            {buffering ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.white} />
            )}
          </TVFocusable>
          <TVFocusable onPress={closePlayer} style={styles.miniBtn} testID="radio-close">
            <Ionicons name="close" size={22} color={colors.white} />
          </TVFocusable>
        </View>
      )}
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
  emptyTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  station: {},
  stationFocusTV: { borderWidth: 2, borderColor: colors.accentCyan, borderRadius: 10 },
  stationCard: {
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: colors.white,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    padding: 10,
  },
  stationCardActive: { borderWidth: 2, borderColor: colors.accentCyan },
  stationImg: { width: '100%', height: '100%' },
  stationHeart: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(11,15,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationPlayingBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    backgroundColor: 'rgba(11,15,26,0.7)',
    borderRadius: 4,
    padding: 3,
  },
  eqBar1: { width: 2, height: 6, backgroundColor: colors.accentCyan, borderRadius: 1 },
  eqBar2: { width: 2, height: 10, backgroundColor: colors.accentCyan, borderRadius: 1 },
  eqBar3: { width: 2, height: 4, backgroundColor: colors.accentCyan, borderRadius: 1 },
  stationName: { color: colors.white, fontSize: 11, marginTop: 6, textAlign: 'center' },
  miniPlayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.darkSurfaceAlt,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  miniLogoBox: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  miniLogoImg: { width: '100%', height: '100%' },
  miniName: { color: colors.white, fontSize: 13, fontWeight: '700' },
  miniSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  miniBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
