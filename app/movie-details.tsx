import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  movieStreamUrl,
  XtreamVodInfo,
  getLastXtreamError,
} from '@/src/lib/xtream';

export default function MovieDetailsScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const playBtnRef = useRef<React.ElementRef<typeof TVFocusable>>(null);
  const params = useLocalSearchParams<{ id: string; name?: string; cover?: string; adult?: string }>();
  const movieId = Number(params.id);
  const favoriteId = `movie-${movieId}`;

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<XtreamVodInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [favorited, setFavorited] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const creds = getXtream();
    if (!creds || !movieId) {
      setLoading(false);
      setError('missing');
      return;
    }
    const [data, fav] = await Promise.all([
      xtream.vodInfo(creds, movieId),
      isFavorite(favoriteId),
    ]);
    setInfo(data);
    setError(data ? null : getLastXtreamError());
    setFavorited(fav);
    setLoading(false);
  }, [movieId, favoriteId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Assim que abrir os detalhes numa TV, já foca o botão ASSISTIR —
    // sem isso, a pessoa tinha que empurrar o D-pad até achar o botão
    // toda vez que abria um filme, quando na prática é quase sempre o
    // que ela quer fazer (só apertar OK e já ir assistir).
    if (!isTV) return;
    const t = setTimeout(() => {
      playBtnRef.current?.focus();
    }, 300);
    return () => clearTimeout(t);
  }, [isTV]);

  const cover = info?.info.cover_big || info?.info.movie_image || params.cover;
  const backdrop = info?.info.backdrop_path?.[0] || cover;
  const name = info?.info.name || params.name || 'Filme';

  const play = () => {
    const creds = getXtream();
    if (!creds) return;
    router.push({
      pathname: '/player',
      params: {
        id: favoriteId,
        name,
        stream: movieStreamUrl(creds, movieId, info?.movie_data?.container_extension),
        logo: cover || '',
        adult: params.adult === '1' ? '1' : '',
      },
    });
  };

  const openTrailer = () => {
    if (info?.info.youtube_trailer) {
      router.push({
        pathname: '/trailer',
        params: { videoId: info.info.youtube_trailer, title: name },
      });
    } else {
      router.push({
        pathname: '/trailer',
        params: { query: `${name} trailer oficial`, title: name },
      });
    }
  };

  const onToggleFavorite = async () => {
    const next = await toggleFavorite({
      id: favoriteId,
      kind: 'movie',
      refId: movieId,
      name,
      cover,
    });
    setFavorited(next);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="md-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{name}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 32 }, isTV && styles.scrollContentTV]}>
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
              <Text style={[styles.titleText, isTV && styles.titleTextTV]} numberOfLines={3}>{name}</Text>
              {!!info?.info.genre && <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{info.info.genre}</Text>}
              {!!(info?.info.releasedate || info?.info.release_date) && (
                <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{info?.info.releasedate || info?.info.release_date}</Text>
              )}
              {!!info?.info.duration && <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{info.info.duration}</Text>}
              {!!info?.info.rating && (
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={isTV ? 16 : 12} color={colors.accentMagenta} />
                  <Text style={[styles.metaText, isTV && styles.metaTextTV]}>{String(info.info.rating)}</Text>
                </View>
              )}
            </View>
          </View>
        </ImageBackground>

        {/* Action row */}
        <View style={[styles.actionRow, isTV && styles.actionRowTV]}>
          <TVFocusable ref={playBtnRef} onPress={play} style={[styles.playBtn, isTV && styles.playBtnTV]} testID="md-play">
            <Ionicons name="play" size={isTV ? 24 : 18} color={colors.black} />
            <Text style={[styles.playText, isTV && styles.playTextTV]}>ASSISTIR</Text>
          </TVFocusable>
          <TVFocusable onPress={openTrailer} style={styles.iconBtn} testID="md-trailer">
            <Ionicons name="logo-youtube" size={isTV ? 26 : 20} color={colors.white} />
            <Text style={[styles.iconBtnText, isTV && styles.iconBtnTextTV]}>Trailer</Text>
          </TVFocusable>
          <TVFocusable onPress={onToggleFavorite} style={styles.iconBtn} testID="md-favorite">
            <Ionicons
              name={favorited ? 'heart' : 'heart-outline'}
              size={isTV ? 26 : 20}
              color={favorited ? colors.accentMagenta : colors.white}
            />
            <Text style={[styles.iconBtnText, isTV && styles.iconBtnTextTV]}>{favorited ? 'Favoritado' : 'Favoritar'}</Text>
          </TVFocusable>
        </View>

        {/* Synopsis/cast — the only part that actually depends on the
            network call, so only this bit shows a small inline spinner
            instead of blocking the whole screen behind one. */}
        {loading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.accentCyan} size="small" />
          </View>
        ) : error ? (
          <View style={styles.inlineError} testID="md-error">
            <Text style={styles.errorSub}>
              {error === 'BLOCKED_CLOUDFLARE'
                ? 'Detalhes bloqueados no preview — abra no Expo Go/APK.'
                : 'Não foi possível carregar a sinopse.'}
            </Text>
            <Pressable onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>TENTAR NOVAMENTE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!!info?.info.plot && <Text style={[styles.plot, isTV && styles.plotTV]}>{info.info.plot}</Text>}
            {!!info?.info.cast && (
              <Text style={[styles.cast, isTV && styles.plotTV]} numberOfLines={3}>
                <Text style={styles.castLabel}>Elenco: </Text>
                {info.info.cast}
              </Text>
            )}
            {!!info?.info.director && (
              <Text style={[styles.cast, isTV && styles.plotTV]}>
                <Text style={styles.castLabel}>Direção: </Text>
                {info.info.director}
              </Text>
            )}
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
  metaText: { color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accentCyan,
    borderRadius: 10,
    paddingVertical: 12,
  },
  playText: { color: colors.black, fontWeight: '800', letterSpacing: 1 },
  iconBtn: { alignItems: 'center', gap: 4, minWidth: 64 },
  iconBtnText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
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
  // Variantes maiores pra TV — a tela original era dimensionada pra
  // celular (hero de 220px, capa 90x130) e ficava pequena/perdida numa
  // tela grande de TV, sem usar o espaço direito. O conteúdo também
  // ganha uma largura máxima centralizada em telas muito largas, pra não
  // esticar de ponta a ponta de forma esquisita.
  scrollContentTV: { maxWidth: 900, alignSelf: 'center', width: '100%' },
  heroTV: { height: 420 },
  heroInnerTV: { padding: spacing.xl, gap: spacing.xl },
  coverTV: { width: 160, height: 230, borderRadius: 12 },
  titleTextTV: { fontSize: 32 },
  metaTextTV: { fontSize: 15 },
  actionRowTV: { paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  playBtnTV: { paddingVertical: 16 },
  playTextTV: { fontSize: 15 },
  iconBtnTextTV: { fontSize: 12 },
  plotTV: { fontSize: 15, lineHeight: 22, paddingHorizontal: spacing.xl },
});
