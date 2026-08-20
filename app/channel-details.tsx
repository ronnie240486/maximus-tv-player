import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  FlatList,
  TextInput,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { usePlayerSession } from '@/src/state/player-session';
import { getXtream } from '@/src/state/session';
import { getDeviceMac } from '@/src/lib/device';
import { sendHeartbeat } from '@/src/api/client';
import { loadListCache, saveListCache } from '@/src/state/list-cache';
import { loadFavorites, toggleFavorite } from '@/src/state/favorites';
import TVFocusable from '@/src/components/TVFocusable';
import {
  loadProgramReminders,
  toggleProgramReminder,
  popDueProgramReminders,
  ProgramReminder,
} from '@/src/state/program-reminders';
import ProgramReminderPopup from '@/src/components/ProgramReminderPopup';
import {
  xtream,
  liveStreamUrl,
  XtreamLive,
  XtreamCategory,
  XtreamEpgListing,
  decodeEpgText,
} from '@/src/lib/xtream';

/** Xtream EPG timestamps look like "2026-07-30 14:00:00" — just want "14:00".
 * Some panels instead send a raw unix-epoch-seconds string for start/end. */
function formatEpgTime(raw: string): string {
  if (/^\d{9,11}$/.test(raw)) {
    const d = new Date(Number(raw) * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const match = raw.match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  return match ? `${match[1]}:${match[2]}` : raw;
}

function parseEpgDate(raw: string): number {
  if (/^\d{9,11}$/.test(raw)) return Number(raw) * 1000;
  const t = Date.parse(raw.replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}

function formatMsTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Alguns paineis mandam o campo "end" bugado (menor que o "start" — como o
// horario mostrando "13:40 - 11:35"). Em vez de confiar cegamente nesse
// campo, ordenamos por inicio e calculamos o fim de cada programa como o
// inicio do PROXIMO — o mesmo truque que qualquer app de EPG usa quando a
// duracao fornecida nao bate. So usamos o "end" original se ele realmente
// vier depois do inicio.
type EpgWithEnd = XtreamEpgListing & { effectiveEnd: number; startMs: number };

function buildEpgTimeline(raw: XtreamEpgListing[]): EpgWithEnd[] {
  const sorted = [...raw].sort((a, b) => parseEpgDate(a.start) - parseEpgDate(b.start));
  return sorted.map((item, idx) => {
    const startMs = parseEpgDate(item.start);
    const rawEnd = parseEpgDate(item.end);
    const nextStart = idx < sorted.length - 1 ? parseEpgDate(sorted[idx + 1].start) : 0;
    const effectiveEnd =
      rawEnd > startMs ? rawEnd : nextStart > startMs ? nextStart : startMs + 60 * 60 * 1000;
    return { ...item, startMs, effectiveEnd };
  });
}

export default function ChannelDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    cover?: string;
    categoryName?: string;
    adult?: string;
  }>();

  // Canal que está tocando AGORA — começa com o que veio pela navegação,
  // mas trocar de canal (pela grade ou pelo carrossel) só atualiza isso e
  // troca a fonte do player, sem precisar navegar de novo. Antes a troca
  // usava router.replace() na mesma tela, e como o player de vídeo só é
  // criado uma vez (na primeira montagem), ele não acompanhava a troca
  // direito — foi aí que vinha o erro ao trocar de canal.
  const [current, setCurrent] = useState({
    streamId: Number(params.id),
    name: params.name || '',
    cover: params.cover || '',
  });
  const favoriteId = `channel-${current.streamId}`;

  const [favorited, setFavorited] = useState(false);
  const [epg, setEpg] = useState<XtreamEpgListing[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(true);
  const [related, setRelated] = useState<XtreamLive[]>([]);
  const [resolvedCategoryName, setResolvedCategoryName] = useState<string>(params.categoryName || '');
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());
  const [dueProgramReminder, setDueProgramReminder] = useState<ProgramReminder | null>(null);

  const [showChannelGrid, setShowChannelGrid] = useState(false);
  const [channelList, setChannelList] = useState<XtreamLive[]>([]);
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('Todos');
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [videoError, setVideoError] = useState(false);
  // Guarda a URL (.m3u8) pra qual já tentamos o fallback .ts — ver o
  // listener de erro do player mais abaixo.
  const tsFallbackTriedFor = useRef<string | null>(null);

  const creds = getXtream();
  const initialStreamUrl = creds ? liveStreamUrl(creds, current.streamId, 'm3u8') : '';
  const { player, setSource, enterFullscreen, reportMiniRect } = usePlayerSession();
  const videoWrapRef = useRef<View>(null);
  const measureVideoSurface = useCallback(() => {
    videoWrapRef.current?.measureInWindow((left, top, width, height) => {
      if (width > 0 && height > 0) reportMiniRect({ left, top, width, height });
    });
  }, [reportMiniRect]);

  useEffect(() => {
    setSource(initialStreamUrl || null, true, 'live').catch(() => setVideoError(true));
  }, [initialStreamUrl, setSource]);

  // Alguns servidores Xtream (comum em contas de teste) não servem o
  // formato HLS (.m3u8) pros canais ao vivo, só o .ts direto — antes de
  // mostrar erro, tenta trocar pra .ts uma vez.
  useEffect(() => {
    setVideoError(false);
    const sub = player.addListener('statusChange', (s) => {
      if (s.status !== 'error') {
        setVideoError(false);
        return;
      }
      const streamUrl = initialStreamUrl;
      const canFallback =
        !!streamUrl && streamUrl.includes('.m3u8') && tsFallbackTriedFor.current !== streamUrl;
      if (canFallback) {
        tsFallbackTriedFor.current = streamUrl;
        const tsUrl = streamUrl.replace(/\.m3u8(\?|$)/, '.ts$1');
        setSource(tsUrl, true, 'live').catch(() => setVideoError(true));
        return;
      }
      setVideoError(true);
    });
    return () => sub.remove();
  }, [player, initialStreamUrl, setSource]);

  // Avisa o painel periodicamente qual canal está sendo assistido aqui —
  // essa prévia inline toca sozinha assim que a tela abre, então o
  // heartbeat também roda enquanto ela estiver na tela.
  useEffect(() => {
    if (!current.name) return;
    let cancelled = false;
    const tick = async () => {
      const mac = await getDeviceMac();
      if (cancelled) return;
      sendHeartbeat(mac, current.name);
    };
    tick();
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [current.name]);

  // Sempre aponta pro player mais atual — trocar de canal faz o hook acima
  // recriar (e liberar) o player automaticamente, então uma referência
  // "presa" por closure viraria inválida. A ref evita isso.
  const playerRef = React.useRef(player);
  playerRef.current = player;

  // A tela de detalhes continua "viva" (só escondida) quando a gente navega
  // pro player em tela cheia por cima dela — sem isso, o vídeo pequeno
  // continuava tocando junto com o grande, duplicando o som. Pausa ao sair,
  // retoma ao voltar. Depende só de [] (não de [player]) de propósito: só
  // deve reagir a foco real da tela, não a toda troca de canal.
  useFocusEffect(
    useCallback(() => {
      try {
        playerRef.current?.play();
      } catch {}
      return () => {};

    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      loadFavorites().then((list) => setFavorited(list.some((f) => f.id === favoriteId)));
      loadProgramReminders().then((list) => setScheduledIds(new Set(list.map((r) => r.id))));
      popDueProgramReminders().then((due) => {
        if (due.length) setDueProgramReminder(due[0]);
      });
    }, [favoriteId])
  );

  const loadEpg = useCallback(async () => {
    if (!creds || !current.streamId) return;
    setLoadingEpg(true);
    const epgRes = await xtream.shortEpg(creds, current.streamId, 10);
    setEpg(epgRes?.epg_listings || []);
    setLoadingEpg(false);
  }, [current.streamId]);

  const applyRelated = useCallback(
    (liveList: XtreamLive[], cats: XtreamCategory[]) => {
      const thisChannel = liveList.find((x) => x.stream_id === current.streamId);
      if (!thisChannel) return;
      setRelated(liveList.filter((c) => c.category_id === thisChannel.category_id && c.stream_id !== current.streamId));
      const catName = cats.find((c) => c.category_id === thisChannel.category_id)?.category_name;
      if (catName) setResolvedCategoryName(catName);
    },
    [current.streamId]
  );

  const loadRelated = useCallback(async () => {
    if (!creds) return;
    // Canais relacionados: pinta na hora com o que já tiver em cache (a
    // tela de Canais já busca e guarda essa lista), sem travar nada — só
    // depois busca fresco em segundo plano. Antes isso buscava a lista
    // INTEIRA de canais toda vez que essa tela abria, e isso é que deixava
    // tudo lento.
    const cache = await loadListCache<XtreamCategory, XtreamLive>('channels');
    if (cache) applyRelated(cache.items, cache.categories);

    const [liveList, cats] = await Promise.all([xtream.liveStreams(creds), xtream.liveCategories(creds)]);
    if (liveList && cats) {
      applyRelated(liveList, cats);
      saveListCache('channels', cats, liveList);
    }
  }, [creds, applyRelated]);

  useEffect(() => {
    loadEpg();
    loadRelated();
  }, [loadEpg, loadRelated]);

  const timeline = useMemo(() => buildEpgTimeline(epg), [epg]);

  const openChannelGrid = useCallback(async () => {
    setShowChannelGrid(true);
    if (channelList.length > 0) return;
    if (!creds) return;
    setLoadingChannels(true);
    const [list, cats] = await Promise.all([xtream.liveStreams(creds), xtream.liveCategories(creds)]);
    setChannelList(list || []);
    setCategories(cats || []);
    setLoadingChannels(false);
  }, [channelList.length, creds]);

  const switchToChannel = useCallback((c: XtreamLive) => {
    setShowChannelGrid(false);
    setCurrent({ streamId: c.stream_id, name: c.name, cover: c.stream_icon || '' });
  }, []);

  const onWatchProgramReminder = useCallback(
    (r: ProgramReminder) => {
      setDueProgramReminder(null);
      // Já é esse canal que está aberto — não precisa trocar nada, só
      // fecha o aviso.
      if (r.channelId === current.streamId) return;
      switchToChannel({ stream_id: r.channelId, name: r.channelName, stream_icon: r.channelCover } as XtreamLive);
    },
    [current.streamId, switchToChannel]
  );

  const onToggleFavorite = async () => {
    const next = await toggleFavorite({
      id: favoriteId,
      kind: 'channel',
      refId: current.streamId,
      name: current.name,
      cover: current.cover,
    });
    setFavorited(next);
  };

  const onToggleReminder = async (item: EpgWithEnd) => {
    const id = `${current.streamId}-${item.id || item.startMs}`;
    const nowScheduled = await toggleProgramReminder({
      id,
      title: decodeEpgText(item.title),
      channelId: current.streamId,
      channelName: current.name,
      channelCover: current.cover,
      startsAt: item.startMs,
    });
    setScheduledIds((prev) => {
      const next = new Set(prev);
      if (nowScheduled) next.add(id);
      else next.delete(id);
      return next;
    });
    Alert.alert(
      nowScheduled ? 'Lembrete criado' : 'Lembrete removido',
      nowScheduled ? 'A gente te avisa quando esse programa começar (com o app aberto).' : undefined
    );
  };

  const openFullscreenPlayer = () => {
    if (!creds) return;
    enterFullscreen();
    router.push({
      pathname: '/player',
      params: {
        id: `live-${current.streamId}`,
        name: current.name,
        stream: liveStreamUrl(creds, current.streamId, 'm3u8'),
        logo: current.cover,
        adult: params.adult === '1' ? '1' : '',
      },
    });
  };

  const nowIdx = useMemo(() => {
    const now = Date.now();
    return timeline.findIndex((e) => e.startMs <= now && now < e.effectiveEnd);
  }, [timeline]);

  return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <View ref={videoWrapRef} onLayout={measureVideoSurface} style={styles.videoWrap}>
        <View style={StyleSheet.absoluteFill} />
        {videoError && (
          <View style={styles.videoErrorOverlay} testID="cd-video-error">
            <Ionicons name="alert-circle-outline" size={28} color={colors.white} />
            <Text style={styles.videoErrorText}>Sem sinal neste canal agora</Text>
            <Pressable
              onPress={() => {
                tsFallbackTriedFor.current = null;
                setVideoError(false);
                player.replaceAsync(
                  initialStreamUrl
                    ? { uri: initialStreamUrl, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1' } }
                    : ''
                );
                player.play();
              }}
              style={styles.videoErrorRetry}
              testID="cd-video-error-retry"
            >
              <Text style={styles.videoErrorRetryText}>TENTAR NOVAMENTE</Text>
            </Pressable>
          </View>
        )}
        {/* Tocar na área do vídeo já abre direto o player em tela cheia. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={openFullscreenPlayer} testID="cd-video-tap" />
        <TVFocusable onPress={() => router.back()} hitSlop={12} style={styles.videoBackBtn} testID="cd-back">
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </TVFocusable>
        <View style={styles.videoTopActions}>
          <TVFocusable onPress={openChannelGrid} hitSlop={12} style={styles.videoActionBtn} testID="cd-channel-grid">
            <Ionicons name="grid" size={19} color={colors.white} />
          </TVFocusable>
          <TVFocusable onPress={openFullscreenPlayer} hitSlop={12} style={styles.videoActionBtn} testID="cd-fullscreen">
            <MaterialCommunityIcons name="fullscreen" size={22} color={colors.white} />
          </TVFocusable>
        </View>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.headerRow}>
            <Text style={styles.channelName} numberOfLines={1}>{current.name}</Text>
            <TVFocusable onPress={onToggleFavorite} hitSlop={10} testID="cd-favorite">
              <Ionicons
                name={favorited ? 'heart' : 'heart-outline'}
                size={22}
                color={favorited ? colors.accentMagenta : colors.textSecondary}
              />
            </TVFocusable>
          </View>
          {!!resolvedCategoryName && (
          <Text style={styles.categoryLine}>
            Categoria <Text style={styles.categoryValue}>{resolvedCategoryName}</Text>
          </Text>
        )}

        <View style={styles.epgHeaderRow}>
          <Text style={styles.sectionTitle}>Guia de programação</Text>
          <View style={styles.todayPill}>
            <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.todayPillText}>Hoje</Text>
          </View>
        </View>

        {loadingEpg ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accentCyan} size="small" />
          </View>
        ) : timeline.length === 0 ? (
          <Text style={styles.emptyEpgText}>Sem informações de programação para este canal.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.epgRow}>
            {timeline.map((item, idx) => {
              const isNow = idx === nowIdx;
              const isNext = idx === nowIdx + 1 || (nowIdx === -1 && idx === 0);
              const pct = isNow
                ? Math.max(0, Math.min(100, ((Date.now() - item.startMs) / (item.effectiveEnd - item.startMs)) * 100))
                : 0;
              const remId = `${current.streamId}-${item.id || item.startMs}`;
              const isScheduled = scheduledIds.has(remId);
              return (
                <View key={item.id || idx} style={styles.epgCard}>
                  {(isNow || isNext) && (
                    <Text style={[styles.epgCardBadge, isNow && styles.epgCardBadgeNow]}>
                      {isNow ? 'AGORA' : 'A SEGUIR'}
                    </Text>
                  )}
                  <View style={styles.epgCardThumb}>
                    {current.cover ? (
                      <Image source={{ uri: current.cover }} style={styles.epgCardThumbImg} contentFit="cover" />
                    ) : (
                      <MaterialCommunityIcons name="television-play" size={22} color={colors.textMuted} />
                    )}
                    {isNow && (
                      <View style={styles.epgProgressTrack}>
                        <View style={[styles.epgProgressBar, { width: `${pct}%` }]} />
                      </View>
                    )}
                    {!isNow && (
                      <TVFocusable
                        onPress={() => onToggleReminder(item)}
                        style={styles.epgAlarmBtn}
                        hitSlop={8}
                        testID={`epg-alarm-${idx}`}
                      >
                        <Ionicons
                          name={isScheduled ? 'notifications' : 'notifications-outline'}
                          size={16}
                          color={isScheduled ? '#F0A94C' : colors.white}
                        />
                      </TVFocusable>
                    )}
                  </View>
                  <Text style={styles.epgCardTitle} numberOfLines={2}>{decodeEpgText(item.title)}</Text>
                  <Text style={styles.epgCardTime}>
                    {formatEpgTime(item.start)} - {formatMsTime(item.effectiveEnd)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        {related.length > 0 && (
          <>
            <View style={styles.epgHeaderRow}>
              <Text style={styles.sectionTitle}>CANAIS MAIS ASSISTIDOS</Text>
              <TVFocusable
                onPress={() => router.push({ pathname: '/channels', params: { initialCategory: resolvedCategoryName } })}
                testID="cd-see-all"
              >
                <Text style={styles.seeAllText}>Ver todos ›</Text>
              </TVFocusable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedRow}>
              {related.slice(0, 15).map((c) => (
                <TVFocusable
                  key={c.stream_id}
                  style={styles.relatedItem}
                  onPress={() => switchToChannel(c)}
                  testID={`cd-related-${c.stream_id}`}
                >
                  <View style={styles.relatedLogoBox}>
                    {c.stream_icon ? (
                      <Image source={{ uri: c.stream_icon }} style={styles.relatedLogoImg} contentFit="contain" />
                    ) : (
                      <MaterialCommunityIcons name="television-classic" size={22} color={colors.textMuted} />
                    )}
                  </View>
                  <Text style={styles.relatedName} numberOfLines={1}>{c.name}</Text>
                </TVFocusable>
              ))}
            </ScrollView>
          </>
        )}
      </ScrollView>
      </SafeAreaView>

      <Modal
        visible={showChannelGrid}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChannelGrid(false)}
      >
        <View style={styles.gridRoot}>
          <Pressable style={styles.gridBackdrop} onPress={() => setShowChannelGrid(false)} />
          <View style={styles.gridPanel}>
            <View style={styles.gridHeader}>
              <Text style={styles.gridTitle}>Canais</Text>
              <TVFocusable onPress={() => setShowChannelGrid(false)} hitSlop={12} testID="cd-grid-close">
                <Ionicons name="close" size={22} color={colors.white} />
              </TVFocusable>
            </View>
            <View style={styles.gridSearchBox}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                value={channelSearch}
                onChangeText={setChannelSearch}
                placeholder="Buscar canal..."
                placeholderTextColor={colors.textMuted}
                style={styles.gridSearchInput}
                testID="cd-grid-search"
              />
            </View>
            {categories.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gridCatRow}>
                {['Todos', ...categories.map((c) => c.category_name)].map((cat) => {
                  const active = cat === selectedCat;
                  return (
                    <TVFocusable
                      key={cat}
                      onPress={() => setSelectedCat(cat)}
                      style={[styles.gridCatChip, active && styles.gridCatChipActive]}
                      testID={`cd-grid-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Text style={[styles.gridCatChipText, active && styles.gridCatChipTextActive]} numberOfLines={1}>
                        {cat}
                      </Text>
                    </TVFocusable>
                  );
                })}
              </ScrollView>
            )}
            {loadingChannels ? (
              <View style={styles.gridLoading}>
                <ActivityIndicator color={colors.accentCyan} />
              </View>
            ) : (
              <FlatList
                data={channelList.filter((c) => {
                  const q = channelSearch.trim().toLowerCase();
                  const qOk = !q || c.name.toLowerCase().includes(q);
                  const catId = selectedCat === 'Todos' ? null : categories.find((cc) => cc.category_name === selectedCat)?.category_id;
                  const catOk = !catId || c.category_id === catId;
                  return qOk && catOk;
                })}
                keyExtractor={(c) => String(c.stream_id)}
                contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 32, gap: 6 }}
                renderItem={({ item }) => (
                  <TVFocusable onPress={() => switchToChannel(item)} style={styles.gridRow} testID={`cd-grid-channel-${item.stream_id}`}>
                    <View style={styles.gridLogoBox}>
                      {item.stream_icon ? (
                        <Image source={{ uri: item.stream_icon }} style={styles.gridLogoImg} contentFit="contain" cachePolicy="memory-disk" />
                      ) : (
                        <MaterialCommunityIcons name="television-classic" size={18} color={colors.textMuted} />
                      )}
                    </View>
                    <Text style={styles.gridRowText} numberOfLines={1}>{item.name}</Text>
                  </TVFocusable>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
      <ProgramReminderPopup
        reminder={dueProgramReminder}
        onWatchNow={onWatchProgramReminder}
        onDismiss={() => setDueProgramReminder(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  videoWrap: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.darkSurface },
  videoErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,15,26,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
  },
  videoErrorText: { color: colors.white, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  videoErrorRetry: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  videoErrorRetryText: { color: colors.accentCyan, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  videoBackBtn: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(11,15,26,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoTopActions: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: 8,
  },
  videoActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(11,15,26,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  channelName: { flex: 1, color: colors.white, fontSize: 22, fontWeight: '800' },
  categoryLine: { color: colors.textSecondary, fontSize: 13, paddingHorizontal: spacing.md, marginTop: 4 },
  categoryValue: { color: colors.white, fontWeight: '700' },
  epgHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  todayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.darkSurface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  todayPillText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  emptyEpgText: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md },
  epgRow: { gap: spacing.sm, paddingHorizontal: spacing.md },
  epgCard: { width: 140 },
  epgCardBadge: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 3,
  },
  epgCardBadgeNow: { color: '#F0A94C' },
  epgCardThumb: {
    width: '100%',
    height: 78,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  epgCardThumbImg: { width: '100%', height: '100%' },
  epgAlarmBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(11,15,26,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  epgProgressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  epgProgressBar: {
    height: '100%',
    backgroundColor: '#F0A94C',
  },
  epgCardTitle: { color: colors.white, fontSize: 12, fontWeight: '700', marginTop: 6 },
  epgCardTime: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  seeAllText: { color: '#F0A94C', fontSize: 13, fontWeight: '700' },
  relatedRow: { gap: spacing.sm, paddingHorizontal: spacing.md },
  relatedItem: { width: 64, alignItems: 'center' },
  relatedLogoBox: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  relatedLogoImg: { width: 40, height: 40 },
  relatedName: { color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
  gridRoot: { flex: 1, flexDirection: 'row' },
  gridBackdrop: { flex: 1 },
  gridPanel: {
    width: '78%',
    maxWidth: 380,
    height: '100%',
    backgroundColor: 'rgba(11,15,26,0.92)',
    paddingTop: 16,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: 8,
  },
  gridTitle: { color: colors.white, fontSize: 16, fontWeight: '800' },
  gridSearchBox: {
    marginHorizontal: spacing.md,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gridSearchInput: { flex: 1, color: colors.white, fontSize: 13 },
  gridCatRow: { gap: 6, paddingHorizontal: spacing.md, paddingBottom: 8, alignItems: 'center' },
  gridCatChip: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  gridCatChipActive: { backgroundColor: 'rgba(76,232,240,0.18)' },
  gridCatChipText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  gridCatChipTextActive: { color: colors.accentCyan },
  gridLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  gridLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLogoImg: { width: 28, height: 28 },
  gridRowText: { flex: 1, color: colors.white, fontSize: 13, fontWeight: '600' },
});
