import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePlayerSession } from '@/src/state/player-session';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius } from '@/src/theme';
import TVFocusable from './TVFocusable';
import EpgStrip from './EpgStrip';
import { XtreamCreds, XtreamLive, XtreamEpgListing, decodeEpgText, liveStreamUrl, xtream } from '@/src/lib/xtream';
import { buildEpgTimeline, parseEpgDate, formatMsTime } from '@/src/lib/epg-timeline';
import { getChannelEditorial } from '@/src/lib/channel-editorial';

type Props = {
  channel: XtreamLive | null;
  creds: XtreamCreds | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenFull: () => void;
  onSearch: () => void;
};

type ProgramInfo = {
  title: string;
  description: string;
  startMs: number;
  endMs: number;
};

function toProgramInfo(item: XtreamEpgListing, effectiveEnd?: number): ProgramInfo {
  return {
    title: decodeEpgText(item.title) || 'Programação ao vivo',
    description: decodeEpgText(item.description) || '',
    startMs: parseEpgDate(item.start),
    endMs: effectiveEnd || parseEpgDate(item.end),
  };
}

/** Painel de canal para a experiência de TV: preview, identidade, descrição e EPG. */
export default function TVChannelPreview({ channel, creds, isFavorite, onToggleFavorite, onOpenFull, onSearch }: Props) {
  const { player, setSource, mode, reportMiniRect } = usePlayerSession();
  const modeRef = useRef(mode);
  const videoBoxRef = useRef<View>(null);
  const channelId = channel?.stream_id;
  const [epgReady, setEpgReady] = useState(false);
  const [currentProgram, setCurrentProgram] = useState<ProgramInfo | null>(null);
  const [nextProgram, setNextProgram] = useState<ProgramInfo | null>(null);

  modeRef.current = mode;

  const measureMiniSurface = useCallback(() => {
    videoBoxRef.current?.measureInWindow((left, top, width, height) => {
      if (width > 0 && height > 0) reportMiniRect({ left, top, width, height });
    });
  }, [reportMiniRect]);

  useEffect(() => {
    const frame = requestAnimationFrame(measureMiniSurface);
    return () => cancelAnimationFrame(frame);
  }, [channelId, measureMiniSurface]);

  useEffect(() => {
    setEpgReady(false);
    setCurrentProgram(null);
    setNextProgram(null);
    if (!channelId || !creds) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setEpgReady(true);
    }, 900);

    xtream.shortEpg(creds, channelId, 6)
      .then((response) => {
        if (cancelled) return;
        const timeline = buildEpgTimeline(response?.epg_listings || []);
        const now = Date.now();
        const currentIndex = timeline.findIndex((item) => now >= item.startMs && now < item.effectiveEnd);
        const index = currentIndex >= 0 ? currentIndex : timeline.findIndex((item) => item.startMs >= now);
        const current = index >= 0 ? timeline[index] : timeline[0];
        const next = index >= 0 ? timeline[index + 1] : timeline[1];
        setCurrentProgram(current ? toProgramInfo(current, current.effectiveEnd) : null);
        setNextProgram(next ? toProgramInfo(next, next.effectiveEnd) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentProgram(null);
          setNextProgram(null);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [channelId, creds]);

  useEffect(() => {
    if (!channelId || !creds) {
      if (modeRef.current !== 'full') setSource(null, false, 'live').catch(() => {});
      return;
    }
    setSource(liveStreamUrl(creds, channelId), true, 'live').catch(() => {});
  }, [channelId, creds, setSource]);

  const tsFallbackTriedRef = useRef(false);
  const tsFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    tsFallbackTriedRef.current = false;
    const sub = player.addListener('statusChange', (s) => {
      if (s.status !== 'error') {
        if (tsFallbackTimerRef.current) {
          clearTimeout(tsFallbackTimerRef.current);
          tsFallbackTimerRef.current = null;
        }
        return;
      }
      if (modeRef.current === 'full' || !channelId || !creds || tsFallbackTriedRef.current || tsFallbackTimerRef.current) return;

      tsFallbackTimerRef.current = setTimeout(() => {
        tsFallbackTimerRef.current = null;
        if (modeRef.current === 'full' || player.status !== 'error' || tsFallbackTriedRef.current || !channelId || !creds) return;
        tsFallbackTriedRef.current = true;
        setSource(liveStreamUrl(creds, channelId, 'ts'), true, 'live').catch(() => {});
      }, 1200);
    });

    return () => {
      sub.remove();
      if (tsFallbackTimerRef.current) clearTimeout(tsFallbackTimerRef.current);
      tsFallbackTimerRef.current = null;
    };
  }, [player, channelId, creds, setSource]);

  if (!channel) {
    return (
      <View style={[styles.wrap, styles.center]}>
        <Ionicons name="tv-outline" size={40} color={colors.textMuted} />
        <Text style={styles.emptyText}>Selecione um canal para ver os detalhes</Text>
      </View>
    );
  }

  const editorial = getChannelEditorial(channel.name);
  const progress = currentProgram && currentProgram.endMs > currentProgram.startMs
    ? Math.min(1, Math.max(0, (Date.now() - currentProgram.startMs) / (currentProgram.endMs - currentProgram.startMs)))
    : 0;

  return (
    <View style={styles.wrap}>
      <View ref={videoBoxRef} onLayout={measureMiniSurface} style={styles.videoBox}>
        <LinearGradient colors={['rgba(3,7,18,0.04)', 'rgba(3,7,18,0.72)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveBadgeText}>AO VIVO</Text></View>
        <View style={styles.videoHint}><Ionicons name="play" size={13} color={colors.white} /><Text style={styles.videoHintText}>OK para tela cheia</Text></View>
      </View>

      <View style={styles.infoPanel}>
        <View style={styles.channelHeader}>
          <View style={styles.channelLogoBox}>
            {channel.stream_icon ? <Image source={{ uri: channel.stream_icon }} style={styles.channelLogo} contentFit="contain" cachePolicy="memory-disk" /> : <Ionicons name="tv-outline" size={28} color={colors.textSecondary} />}
          </View>
          <View style={styles.channelHeaderCopy}>
            <Text style={styles.eyebrow}>{editorial.eyebrow}</Text>
            <Text style={styles.channelName} numberOfLines={2}>{channel.name}</Text>
          </View>
          <View style={styles.hdBadge}><Text style={styles.hdText}>HD</Text></View>
        </View>

        <View style={styles.tagRow}>{editorial.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}</View>

        <Text style={styles.sectionLabel}>SOBRE O CANAL</Text>
        <Text style={styles.channelDescription} numberOfLines={4}>{editorial.description}</Text>

        <View style={styles.nowCard}>
          <View style={styles.nowHeader}>
            <View style={styles.nowTitleRow}><View style={styles.nowDot} /><Text style={styles.nowLabel}>AGORA</Text></View>
            {currentProgram && <Text style={styles.programTime}>{formatMsTime(currentProgram.startMs)} – {formatMsTime(currentProgram.endMs)}</Text>}
          </View>
          <Text style={styles.programTitle} numberOfLines={2}>{currentProgram?.title || 'Programação ao vivo'}</Text>
          {!!currentProgram?.description && <Text style={styles.programDescription} numberOfLines={3}>{currentProgram.description}</Text>}
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
        </View>

        {nextProgram && <View style={styles.nextRow}><Text style={styles.nextLabel}>A SEGUIR</Text><Text style={styles.nextTitle} numberOfLines={1}>{nextProgram.title}</Text><Text style={styles.nextTime}>{formatMsTime(nextProgram.startMs)}</Text></View>}

        {epgReady && <View style={styles.epgStripWrap}><EpgStrip creds={creds} channelId={channelId} channelName={channel.name} channelCover={channel.stream_icon} /></View>}

        <View style={styles.actionsRow}>
          <TVFocusable style={[styles.actionBtn, styles.primaryAction]} onPress={onOpenFull} testID="tv-preview-open-full"><Ionicons name="play" size={15} color={colors.black} /><Text style={styles.primaryActionText}>Assistir agora</Text></TVFocusable>
          <TVFocusable style={styles.actionBtn} onPress={onToggleFavorite} testID="tv-preview-favorite"><Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={16} color={isFavorite ? colors.accentMagenta : colors.white} /><Text style={styles.actionText}>{isFavorite ? 'Favoritado' : 'Favoritar'}</Text></TVFocusable>
          {!!channel.tv_archive && <TVFocusable style={styles.actionBtn} onPress={onOpenFull} testID="tv-preview-catchup"><Ionicons name="time-outline" size={16} color={colors.white} /><Text style={styles.actionText}>Replay</Text></TVFocusable>}
          <TVFocusable style={styles.actionBtn} onPress={onSearch} testID="tv-preview-search"><Ionicons name="search" size={16} color={colors.white} /><Text style={styles.actionText}>Buscar</Text></TVFocusable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(7, 10, 22, 0.72)', borderRadius: radius.md, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyText: { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  videoBox: { width: '100%', aspectRatio: 16 / 9, minHeight: 150, backgroundColor: '#080b16', justifyContent: 'space-between', padding: spacing.sm },
  liveBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(230, 48, 76, 0.9)', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white },
  liveBadgeText: { color: colors.white, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  videoHint: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 5 },
  videoHintText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  infoPanel: { flex: 1, padding: spacing.md, minHeight: 0 },
  channelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  channelLogoBox: { width: 54, height: 54, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  channelLogo: { width: 45, height: 45 },
  channelHeaderCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.accentCyan, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  channelName: { color: colors.white, fontSize: 20, fontWeight: '900', marginTop: 3 },
  hdBadge: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3 },
  hdText: { color: colors.textSecondary, fontSize: 9, fontWeight: '900' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  tag: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4 },
  tagText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  sectionLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: spacing.md },
  channelDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5 },
  nowCard: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, padding: spacing.sm, marginTop: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  nowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accentMagenta },
  nowLabel: { color: colors.accentMagenta, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  programTime: { color: colors.textMuted, fontSize: 10 },
  programTitle: { color: colors.white, fontSize: 15, fontWeight: '800', marginTop: 7 },
  programDescription: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 5 },
  progressTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden', marginTop: 10 },
  progressFill: { height: '100%', backgroundColor: colors.accentCyan, borderRadius: 2 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: spacing.sm },
  nextLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  nextTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', flex: 1 },
  nextTime: { color: colors.textMuted, fontSize: 10 },
  epgStripWrap: { marginTop: spacing.sm, maxHeight: 70 },
  actionsRow: { flexDirection: 'row', gap: 7, paddingTop: spacing.md, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.darkSurfaceAlt, paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.sm },
  primaryAction: { backgroundColor: colors.accentCyan },
  actionText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  primaryActionText: { color: colors.black, fontSize: 10, fontWeight: '900' },
});
