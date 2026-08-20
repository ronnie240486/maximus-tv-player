import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { xtream, XtreamCreds, decodeEpgText } from '@/src/lib/xtream';
import { buildEpgTimeline, formatMsTime, EpgWithEnd } from '@/src/lib/epg-timeline';
import { loadProgramReminders, toggleProgramReminder } from '@/src/state/program-reminders';
import TVFocusable from '@/src/components/TVFocusable';

type Props = {
  creds: XtreamCreds | null;
  channelId: number;
  channelName: string;
  channelCover?: string;
};

/**
 * Faixa horizontal de programação (agora / a seguir / a seguir...) com
 * botão de alarme em cada item pra agendar lembrete — mesmo recurso que já
 * existia em channel-details.tsx, extraído pra um componente próprio pra
 * poder aparecer também na tela cheia (player.tsx) e no mini player (preview
 * de canal da TV), sem duplicar a lógica em cada lugar.
 */
export default function EpgStrip({ creds, channelId, channelName, channelCover }: Props) {
  const [epg, setEpg] = useState<Awaited<ReturnType<typeof xtream.shortEpg>>>(null);
  const [loading, setLoading] = useState(true);
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!creds || !channelId) return;
    let cancelled = false;
    setLoading(true);
    xtream.shortEpg(creds, channelId, 6).then((res) => {
      if (cancelled) return;
      setEpg(res);
      setLoading(false);
    });
    loadProgramReminders().then((list) => {
      if (!cancelled) setScheduledIds(new Set(list.map((r) => r.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [creds, channelId]);

  const timeline = useMemo(() => buildEpgTimeline(epg?.epg_listings || []), [epg]);

  const nowIdx = useMemo(() => {
    const now = Date.now();
    return timeline.findIndex((e) => e.startMs <= now && now < e.effectiveEnd);
  }, [timeline]);

  const onToggleReminder = async (item: EpgWithEnd) => {
    const id = `${channelId}-${item.id || item.startMs}`;
    const nowScheduled = await toggleProgramReminder({
      id,
      title: decodeEpgText(item.title),
      channelId,
      channelName,
      channelCover: channelCover || '',
      startsAt: item.startMs,
    });
    setScheduledIds((prev) => {
      const next = new Set(prev);
      if (nowScheduled) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accentCyan} size="small" />
      </View>
    );
  }

  if (timeline.length === 0) {
    return <Text style={styles.emptyText}>Sem informações de programação para este canal.</Text>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {timeline.map((item, idx) => {
        const isNow = idx === nowIdx;
        const isNext = idx === nowIdx + 1 || (nowIdx === -1 && idx === 0);
        const pct = isNow
          ? Math.max(0, Math.min(100, ((Date.now() - item.startMs) / (item.effectiveEnd - item.startMs)) * 100))
          : 0;
        const remId = `${channelId}-${item.id || item.startMs}`;
        const isScheduled = scheduledIds.has(remId);
        return (
          <View key={item.id || idx} style={styles.card}>
            {(isNow || isNext) && (
              <Text style={[styles.badge, isNow && styles.badgeNow]}>{isNow ? 'AGORA' : 'A SEGUIR'}</Text>
            )}
            <View style={styles.thumb}>
              {channelCover ? (
                <Image source={{ uri: channelCover }} style={styles.thumbImg} contentFit="cover" />
              ) : (
                <MaterialCommunityIcons name="television-play" size={20} color={colors.textMuted} />
              )}
              {isNow && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${pct}%` }]} />
                </View>
              )}
              {!isNow && (
                <TVFocusable onPress={() => onToggleReminder(item)} style={styles.alarmBtn} hitSlop={8} testID={`epg-strip-alarm-${idx}`}>
                  <Ionicons name={isScheduled ? 'notifications' : 'notifications-outline'} size={14} color={isScheduled ? '#F0A94C' : colors.white} />
                </TVFocusable>
              )}
            </View>
            <Text style={styles.title} numberOfLines={2}>{decodeEpgText(item.title)}</Text>
            <Text style={styles.time}>
              {formatMsTime(item.startMs)} - {formatMsTime(item.effectiveEnd)}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { paddingVertical: spacing.md, alignItems: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 12, paddingVertical: spacing.md, textAlign: 'center' },
  row: { gap: 10, paddingHorizontal: spacing.sm },
  card: { width: 110 },
  badge: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  badgeNow: { color: colors.accentCyan },
  thumb: {
    width: 110,
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.darkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressBar: { height: 3, backgroundColor: colors.accentCyan },
  alarmBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 4,
  },
  title: { color: colors.white, fontSize: 11, fontWeight: '600', marginTop: 4 },
  time: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
});
