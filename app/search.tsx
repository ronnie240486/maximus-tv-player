import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getXtream } from '@/src/state/session';
import {
  xtream,
  liveStreamUrl,
  movieStreamUrl,
  XtreamLive,
  XtreamMovie,
  XtreamSeries,
} from '@/src/lib/xtream';
import { filterToKidsItems } from '@/src/lib/adult-content';
import { isActiveProfileKids } from '@/src/state/profiles';
import TVFocusable from '@/src/components/TVFocusable';

type Row =
  | { kind: 'live'; id: string; name: string; icon?: string; stream: string }
  | { kind: 'movie'; id: string; name: string; icon?: string; stream: string }
  | { kind: 'series'; id: string; name: string; icon?: string };

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; voice?: string }>();
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<XtreamLive[]>([]);
  const [movies, setMovies] = useState<XtreamMovie[]>([]);
  const [series, setSeries] = useState<XtreamSeries[]>([]);
  const [query, setQuery] = useState(params.q || '');
  const [voiceNotFound, setVoiceNotFound] = useState(false);
  const autoOpenedRef = useRef(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    (async () => {
      const creds = getXtream();
      if (!creds) {
        setLoading(false);
        return;
      }
      const kidsMode = await isActiveProfileKids();
      const [l, m, s, liveCats, vodCats, seriesCats] = await Promise.all([
        xtream.liveStreams(creds),
        xtream.vodStreams(creds),
        xtream.seriesList(creds),
        kidsMode ? xtream.liveCategories(creds) : Promise.resolve(null),
        kidsMode ? xtream.vodCategories(creds) : Promise.resolve(null),
        kidsMode ? xtream.seriesCategories(creds) : Promise.resolve(null),
      ]);
      // Perfil infantil: conteúdo adulto não aparece nem na busca — mesma
      // proteção já aplicada em Canais/Filmes/Séries/Home.
      setLive(kidsMode && liveCats ? filterToKidsItems(l || [], liveCats) : l || []);
      setMovies(kidsMode && vodCats ? filterToKidsItems(m || [], vodCats) : m || []);
      setSeries(kidsMode && seriesCats ? filterToKidsItems(s || [], seriesCats) : s || []);
      setLoading(false);
      if (!params.voice) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    })();
  }, []);

  const results: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const creds = getXtream();
    if (!creds) return [];
    // Bidirecional: cobre tanto "digitei parte do nome" (nome contém a
    // busca) quanto "busca por voz com frase inteira" tipo "quero
    // assistir tulsa king" (a frase contém o nome, mas o nome sozinho é
    // mais curto que a frase, então só checar "nome contém busca" nunca
    // batia nesse caso).
    const titleMatches = (name: string) => {
      const n = name.toLowerCase();
      return n.includes(q) || q.includes(n);
    };
    const liveRows: Row[] = live
      .filter((x) => titleMatches(x.name))
      .slice(0, 40)
      .map((x) => ({
        kind: 'live',
        id: `l-${x.stream_id}`,
        name: x.name,
        icon: x.stream_icon || undefined,
        stream: liveStreamUrl(creds, x.stream_id, 'm3u8'),
      }));
    const movieRows: Row[] = movies
      .filter((x) => titleMatches(x.name))
      .slice(0, 40)
      .map((x) => ({
        kind: 'movie',
        id: `m-${x.stream_id}`,
        name: x.name,
        icon: x.stream_icon || undefined,
        stream: movieStreamUrl(creds, x.stream_id, x.container_extension),
      }));
    const seriesRows: Row[] = series
      .filter((x) => titleMatches(x.name))
      .slice(0, 40)
      .map((x) => ({
        kind: 'series',
        id: `s-${x.series_id}`,
        name: x.name,
        icon: x.cover || undefined,
      }));
    return [...liveRows, ...movieRows, ...seriesRows];
  }, [query, live, movies, series]);

  const openRow = (r: Row) => {
    if (r.kind === 'series') {
      router.push({
        pathname: '/series-details',
        params: { id: r.id.replace('s-', ''), name: r.name, cover: r.icon || '' },
      });
      return;
    }
    router.push({
      pathname: '/player',
      params: {
        id: r.id,
        name: r.name,
        stream: r.stream,
        logo: r.icon || '',
      },
    });
  };

  // Comando de voz: abre direto quando tem certeza (nome exato ou só achou
  // uma coisa). Se achou várias parecidas e nenhuma bate exatamente, é
  // melhor mostrar a lista pra pessoa escolher do que chutar a primeira —
  // "amor" pode bater em vários filmes/séries diferentes, por exemplo.
  useEffect(() => {
    if (!params.voice || autoOpenedRef.current || loading) return;
    if (results.length === 0) {
      setVoiceNotFound(true);
      return;
    }
    const q = (params.q || '').trim().toLowerCase();
    const exact = results.find((r) => r.name.trim().toLowerCase() === q);
    if (exact) {
      autoOpenedRef.current = true;
      openRow(exact);
    } else if (results.length === 1) {
      autoOpenedRef.current = true;
      openRow(results[0]);
    }
    // Se caiu aqui sem abrir, results.length > 1 e nenhum bateu exato —
    // deixa a tela normal de resultados aparecer pra pessoa tocar no certo.
  }, [params.voice, params.q, loading, results]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="search-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar canais, filmes, séries..."
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            testID="search-input"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} testID="search-clear">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentCyan} />
        </View>
      ) : query.trim() === '' ? (
        <View style={styles.center} testID="search-hint">
          <Ionicons name="search" size={44} color={colors.textMuted} />
          <Text style={styles.hintTitle}>Buscar</Text>
          <Text style={styles.hintSub}>Encontre canais, filmes e séries.</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.center} testID="search-empty">
          <MaterialCommunityIcons name="magnify-close" size={44} color={colors.textMuted} />
          <Text style={styles.hintTitle}>Sem resultados</Text>
          {voiceNotFound && (
            <Text style={styles.hintSub}>Não encontrei "{params.q}" no catálogo.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 32, gap: spacing.sm }}
          renderItem={({ item }) => (
            <TVFocusable
              onPress={() => openRow(item)}
              style={styles.row}
              testID={`search-result-${item.id}`}
            >
              <View style={styles.logoBox}>
                {item.icon ? (
                  <Image source={{ uri: item.icon }} style={styles.logoImg} contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                  <MaterialCommunityIcons
                    name={item.kind === 'live' ? 'television-classic' : item.kind === 'movie' ? 'movie-open' : 'filmstrip'}
                    size={22}
                    color={colors.textMuted}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowType}>
                  {item.kind === 'live' ? 'CANAL' : item.kind === 'movie' ? 'FILME' : 'SÉRIE'}
                </Text>
              </View>
              {item.kind !== 'series' && (
                <Ionicons name="play-circle" size={22} color={colors.accentCyan} />
              )}
            </TVFocusable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 10,
  },
  backBtn: { padding: 4 },
  searchBox: {
    flex: 1,
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, color: colors.white, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 6 },
  hintTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 10 },
  hintSub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.darkSurface,
    padding: spacing.sm,
    borderRadius: 12,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: 40, height: 40 },
  rowName: { color: colors.white, fontSize: 14, fontWeight: '700' },
  rowType: { color: colors.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 1 },
});
