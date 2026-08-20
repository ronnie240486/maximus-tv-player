import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getXtream } from '@/src/state/session';
import { toggleFavorite, isFavorite } from '@/src/state/favorites';
import TVFocusable from '@/src/components/TVFocusable';
import { useIsTV } from '@/src/hooks/useIsTV';
import {
  xtream,
  seriesEpisodeUrl,
  XtreamSeriesInfo,
  XtreamEpisode,
  getLastXtreamError,
} from '@/src/lib/xtream';

export default function SeriesDetailsScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const params = useLocalSearchParams<{ id: string; name?: string; cover?: string; adult?: string }>();
  const seriesId = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<XtreamSeriesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seasonKey, setSeasonKey] = useState<string>('1');
  const [favorited, setFavorited] = useState(false);
  const favoriteId = `series-${seriesId}`;

  const load = useCallback(async () => {
    setLoading(true);
    const creds = getXtream();
    if (!creds || !seriesId) {
      setLoading(false);
      setError('missing');
      return;
    }
    const [data, fav] = await Promise.all([
      xtream.seriesInfo(creds, seriesId),
      isFavorite(favoriteId),
    ]);
    setInfo(data);
    setError(data ? null : getLastXtreamError());
    setFavorited(fav);
    if (data?.episodes) {
      const firstKey = Object.keys(data.episodes)[0];
      if (firstKey) setSeasonKey(firstKey);
    }
    setLoading(false);
  }, [seriesId, favoriteId]);

  useEffect(() => {
    load();
  }, [load]);

  const seasonKeys = useMemo(() => Object.keys(info?.episodes || {}), [info]);
  const currentEpisodes: XtreamEpisode[] = info?.episodes?.[seasonKey] || [];

  const playEpisode = (ep: XtreamEpisode) => {
    const creds = getXtream();
    if (!creds) return;
    router.push({
      pathname: '/player',
      params: {
        id: `series-ep-${ep.id}`,
        name: `${info?.info.name || 'Série'} • S${seasonKey} E${ep.episode_num} — ${ep.title}`,
        stream: seriesEpisodeUrl(creds, Number(ep.id), ep.container_extension),
        logo: ep.info?.movie_image || info?.info.cover || params.cover || '',
        seriesId: String(seriesId),
        adult: params.adult === '1' ? '1' : '',
      },
    });
  };

  const cover = info?.info.cover || params.cover;
  const backdrop = info?.info.backdrop_path?.[0] || cover;
  const name = info?.info.name || params.name || 'Série';

  const openTrailer = () => {
    if (info?.info.youtube_trailer) {
      router.push({ pathname: '/trailer', params: { videoId: info.info.youtube_trailer, title: name } });
    } else {
      router.push({ pathname: '/trailer', params: { query: `${name} trailer oficial`, title: name } });
    }
  };

  const onToggleFavorite = async () => {
    const next = await toggleFavorite({
      id: favoriteId,
      kind: 'series',
      refId: seriesId,
      name,
      cover,
    });
    setFavorited(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="sd-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {info?.info.name || params.name || 'Série'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 32 }, isTV && styles.scrollContentTV]}>
        {/* Hero */}
        <ImageBackground
          source={backdrop ? { uri: backdrop } : undefined}
          style={[styles.hero, isTV && styles.heroTV]}
          imageStyle={{ opacity: 0.55 }}
        >
          <LinearGradient
            colors={['transparent', 'rgba(11,15,26,0.9)', colors.black]}
            style={StyleSheet.absoluteFill as any}
          />
          <View style={[styles.heroInner, isTV && styles.heroInnerTV]}>
            {cover ? (
              <Image source={{ uri: cover }} style={[styles.cover, isTV && styles.coverTV]} contentFit="cover" />
            ) : (
              <View style={[styles.cover, isTV && styles.coverTV, styles.coverFallback]}>
                <Ionicons name="film" size={isTV ? 56 : 40} color={colors.textMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.titleText, isTV && styles.titleTextTV]} numberOfLines={3}>
                {info?.info.name || params.name}
              </Text>
              {!!info?.info.genre && <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{info.info.genre}</Text>}
              {!!info?.info.releaseDate && (
                <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{info.info.releaseDate}</Text>
              )}
              {!!info?.info.rating && (
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={isTV ? 16 : 12} color={colors.accentMagenta} />
                  <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{String(info.info.rating)}</Text>
                </View>
              )}
            </View>
          </View>
        </ImageBackground>

        <View style={styles.actionRow}>
          <TVFocusable onPress={openTrailer} style={styles.iconBtn} testID="sd-trailer">
            <Ionicons name="logo-youtube" size={20} color={colors.white} />
            <Text style={styles.iconBtnText}>Trailer</Text>
          </TVFocusable>
          <TVFocusable onPress={onToggleFavorite} style={styles.iconBtn} testID="sd-favorite">
            <Ionicons
              name={favorited ? 'heart' : 'heart-outline'}
              size={20}
              color={favorited ? colors.accentMagenta : colors.white}
            />
            <Text style={styles.iconBtnText}>{favorited ? 'Favoritado' : 'Favoritar'}</Text>
          </TVFocusable>
        </View>

        {!!info?.info.plot && (
          <Text style={styles.plot}>{info.info.plot}</Text>
        )}
        {!!info?.info.cast && (
          <Text style={styles.cast} numberOfLines={2}>
            <Text style={styles.castLabel}>Elenco: </Text>
            {info.info.cast}
          </Text>
        )}

        {/* Everything below actually depends on the network call (which
            season exists, which episodes to list) so only this part shows
            a loading/error state instead of blocking the whole screen. */}
        {loading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.accentCyan} size="small" />
          </View>
        ) : error ? (
          <View style={styles.inlineError} testID="sd-error">
            <Text style={styles.errorSub}>
              {error === 'BLOCKED_CLOUDFLARE'
                ? 'Episódios bloqueados no preview — abra no Expo Go/APK.'
                : 'Não foi possível carregar os episódios.'}
            </Text>
            <Pressable onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>TENTAR NOVAMENTE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Season selector */}
            {seasonKeys.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>TEMPORADAS</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {seasonKeys.map((k) => {
                    const active = k === seasonKey;
                    return (
                      <TVFocusable
                        key={k}
                        onPress={() => setSeasonKey(k)}
                        style={[styles.chip, active && styles.chipActive]}
                        testID={`season-${k}`}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          T{k}
                        </Text>
                      </TVFocusable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {/* Episodes */}
            <Text style={styles.sectionTitle}>
              EPISÓDIOS {currentEpisodes.length > 0 && `(${currentEpisodes.length})`}
            </Text>
            <View style={styles.epList}>
              {currentEpisodes.map((ep) => (
                <TVFocusable
                  key={String(ep.id)}
                  onPress={() => playEpisode(ep)}
                  style={styles.epRow}
                  testID={`episode-${ep.id}`}
                >
                  <View style={styles.epThumb}>
                    {ep.info?.movie_image ? (
                      <Image
                        source={{ uri: ep.info.movie_image }}
                        style={styles.epThumbImg}
                        contentFit="cover"
                      />
                    ) : (
                      <Text style={styles.epThumbNum}>{ep.episode_num}</Text>
                    )}
                    <View style={styles.epPlayOverlay}>
                      <Ionicons name="play" size={20} color={colors.white} />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.epTitle} numberOfLines={1}>
                      {ep.episode_num}. {ep.title}
                    </Text>
                    {!!ep.info?.plot && (
                      <Text style={styles.epPlot} numberOfLines={2}>{ep.info.plot}</Text>
                    )}
                    {!!ep.info?.duration && (
                      <Text style={styles.epMeta}>{ep.info.duration}</Text>
                    )}
                  </View>
              </TVFocusable>
            ))}
            {currentEpisodes.length === 0 && (
              <Text style={styles.emptyEp}>Nenhum episódio nesta temporada.</Text>
            )}
          </View>
          </>
        )}
      </ScrollView>
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
  headerTitle: { flex: 1, color: colors.white, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 6 },
  inlineLoading: { paddingVertical: spacing.lg, alignItems: 'center' },
  inlineError: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, alignItems: 'center', gap: 8 },
  errorTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 8 },
  errorSub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  retryText: { color: colors.accentCyan, fontWeight: '800', letterSpacing: 1.2, fontSize: 11 },
  hero: {
    height: 220,
    backgroundColor: colors.darkSurface,
    justifyContent: 'flex-end',
  },
  heroInner: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
    alignItems: 'flex-end',
  },
  cover: {
    width: 90,
    height: 130,
    borderRadius: 8,
    backgroundColor: colors.darkSurfaceAlt,
  },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  titleText: { color: colors.white, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    justifyContent: 'center',
  },
  iconBtn: { alignItems: 'center', gap: 4, minWidth: 64 },
  iconBtnText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  metaText: { color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  plot: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  cast: {
    color: colors.textSecondary,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  castLabel: { color: colors.textMuted, fontWeight: '700' },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chipRow: { gap: 8, paddingHorizontal: spacing.md },
  chip: {
    minWidth: 56,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.darkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.darkSurfaceAlt,
    flexShrink: 0,
  },
  chipActive: { borderColor: colors.accentCyan, backgroundColor: 'rgba(76,232,240,0.10)' },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
  chipTextActive: { color: colors.accentCyan },
  epList: { paddingHorizontal: spacing.md, gap: spacing.sm },
  epRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.darkSurface,
    padding: spacing.sm,
    borderRadius: 12,
  },
  epThumb: {
    width: 100,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.darkSurfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  epThumbImg: { width: '100%', height: '100%' },
  epThumbNum: { color: colors.white, fontSize: 18, fontWeight: '800' },
  epPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  epTitle: { color: colors.white, fontSize: 13, fontWeight: '700' },
  epPlot: { color: colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 15 },
  epMeta: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  emptyEp: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 20 },
  // Variantes maiores pra TV (mesmo raciocínio de movie-details.tsx).
  scrollContentTV: { maxWidth: 900, alignSelf: 'center', width: '100%' },
  heroTV: { height: 420 },
  heroInnerTV: { padding: spacing.xl, gap: spacing.xl },
  coverTV: { width: 160, height: 230, borderRadius: 12 },
  titleTextTV: { fontSize: 32 },
  metaTextTV: { fontSize: 15 },
});
