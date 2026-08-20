import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useVideoPlayer } from 'expo-video';

import { colors, spacing } from '@/src/theme';
import { loadFavorites, toggleFavorite, FavoriteItem, FavoriteKind } from '@/src/state/favorites';
import TVFocusable from '@/src/components/TVFocusable';
import { useIsTV } from '@/src/hooks/useIsTV';
import { getXtream } from '@/src/state/session';
import { liveStreamUrl } from '@/src/lib/xtream';

const TABS: { key: FavoriteKind | 'all'; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'channel', label: 'Canais' },
  { key: 'movie', label: 'Filmes' },
  { key: 'series', label: 'Séries' },
  { key: 'radio', label: 'Rádios' },
];

export default function FavoritesScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [tab, setTab] = useState<FavoriteKind | 'all'>('all');
  const [currentRadio, setCurrentRadio] = useState<FavoriteItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);

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
      loadFavorites().then(setItems);
    }, [])
  );

  const filtered = useMemo(
    () => (tab === 'all' ? items : items.filter((i) => i.kind === tab)),
    [items, tab]
  );

  const playRadio = async (item: FavoriteItem) => {
    if (!item.streamUrl) return;
    setCurrentRadio(item);
    setPlaying(true);
    setBuffering(true);
    try {
      await player.replaceAsync({
        uri: item.streamUrl,
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

  const closeRadioPlayer = () => {
    player.pause();
    setCurrentRadio(null);
    setPlaying(false);
  };

  const openItem = (item: FavoriteItem) => {
    if (item.kind === 'radio') {
      playRadio(item);
      return;
    }
    if (item.kind === 'movie') {
      router.push({ pathname: '/movie-details', params: { id: String(item.refId), name: item.name, cover: item.cover || '' } });
      return;
    }
    if (item.kind === 'series') {
      router.push({ pathname: '/series-details', params: { id: String(item.refId), name: item.name, cover: item.cover || '' } });
      return;
    }
    if (isTV) {
      const creds = getXtream();
      if (creds) {
        router.push({
          pathname: '/player',
          params: {
            id: `live-${item.refId}`,
            name: item.name,
            stream: liveStreamUrl(creds, Number(item.refId), 'm3u8'),
            logo: item.cover || '',
          },
        });
        return;
      }
    }
    router.push({
      pathname: '/channel-details',
      params: {
        id: String(item.refId),
        name: item.name,
        cover: item.cover || '',
      },
    });
  };

  const removeFavorite = async (item: FavoriteItem) => {
    await toggleFavorite(item);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (currentRadio?.id === item.id) closeRadioPlayer();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="favorites-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Favoritos</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.chipRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <TVFocusable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.chip, active && styles.chipActive]}
                testID={`favorites-tab-${t.key}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </TVFocusable>
            );
          })}
        </ScrollView>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.center} testID="favorites-empty">
          <Ionicons name="heart-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nada favoritado ainda</Text>
          <Text style={styles.emptySub}>
            Toca no coração em um canal, filme, série ou rádio pra ele aparecer aqui.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          numColumns={3}
          columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
          contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: currentRadio ? 100 : 32, gap: spacing.md }}
          renderItem={({ item }) => {
            const isPlayingRadio = item.kind === 'radio' && currentRadio?.id === item.id;
            return (
              <TVFocusable onPress={() => openItem(item)} style={styles.poster} focusStyle={styles.posterFocusTV} testID={`favorite-${item.id}`}>
                <View style={[styles.posterCard, item.kind === 'radio' && styles.posterCardRadio]}>
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={styles.posterImg} contentFit={item.kind === 'radio' ? 'contain' : 'cover'} cachePolicy="memory-disk" />
                  ) : (
                    <MaterialCommunityIcons
                      name={item.kind === 'channel' ? 'television-classic' : item.kind === 'radio' ? 'radio' : 'movie-open'}
                      size={26}
                      color={colors.textMuted}
                    />
                  )}
                  {isPlayingRadio && playing && (
                    <View style={styles.playingBadge}>
                      <View style={styles.eqBar1} />
                      <View style={styles.eqBar2} />
                      <View style={styles.eqBar3} />
                    </View>
                  )}
                  <Pressable
                    onPress={() => removeFavorite(item)}
                    style={styles.removeBtn}
                    hitSlop={8}
                    testID={`favorite-remove-${item.id}`}
                  >
                    <Ionicons name="heart" size={16} color={colors.accentMagenta} />
                  </Pressable>
                </View>
                <Text style={styles.posterName} numberOfLines={2}>{item.name}</Text>
              </TVFocusable>
            );
          }}
        />
      )}

      {currentRadio && (
        <View style={styles.miniPlayer} testID="favorites-radio-mini-player">
          <View style={styles.miniLogoBox}>
            {currentRadio.cover ? (
              <Image source={{ uri: currentRadio.cover }} style={styles.miniLogoImg} contentFit="contain" />
            ) : (
              <MaterialCommunityIcons name="radio" size={20} color={colors.textMuted} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniName} numberOfLines={1}>{currentRadio.name}</Text>
            <Text style={styles.miniSub}>{buffering ? 'Carregando...' : playing ? 'Ao vivo' : 'Pausado'}</Text>
          </View>
          <TVFocusable onPress={togglePlay} style={styles.miniBtn} testID="favorites-radio-play-pause">
            {buffering ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.white} />
            )}
          </TVFocusable>
          <TVFocusable onPress={closeRadioPlayer} style={styles.miniBtn} testID="favorites-radio-close">
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
  chipRow: { height: 56, justifyContent: 'center' },
  chipRowInner: { gap: 8, paddingHorizontal: spacing.md, alignItems: 'center' },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: colors.darkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.darkSurfaceAlt,
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.accentCyan, backgroundColor: 'rgba(76,232,240,0.10)' },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.accentCyan },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 6 },
  emptyTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  poster: { flex: 1 / 3, maxWidth: '32%' },
  posterFocusTV: { borderWidth: 2, borderColor: colors.accentCyan, borderRadius: 10 },
  posterCard: {
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  posterCardRadio: { aspectRatio: 1, backgroundColor: colors.white, padding: 10 },
  posterImg: { width: '100%', height: '100%' },
  playingBadge: {
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
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(11,15,26,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterName: { color: colors.white, fontSize: 11, marginTop: 6 },
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
