import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { ProgramReminder } from '@/src/state/program-reminders';

type Props = {
  reminder: ProgramReminder | null;
  onWatchNow: (reminder: ProgramReminder) => void;
  onDismiss: () => void;
};

const COUNTDOWN_SECONDS = 10;

/**
 * Aviso de "vai começar agora" pra um lembrete de programação — mostra o
 * nome do programa/canal e uma contagem regressiva de 10s. Se a pessoa não
 * fizer nada, muda pro canal sozinho quando a contagem chegar a zero;
 * "Assistir agora" pula direto pra lá, "Fechar" cancela sem trocar de
 * canal.
 */
export default function ProgramReminderPopup({ reminder, onWatchNow, onDismiss }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!reminder) return;
    setSecondsLeft(COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [reminder?.id]);

  useEffect(() => {
    if (reminder && secondsLeft === 0) {
      onWatchNow(reminder);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  if (!reminder) return null;

  return (
    <Modal transparent animationType="fade" visible={!!reminder} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="notifications" size={26} color={colors.black} />
          </View>
          <Text style={styles.title}>Está começando agora!</Text>
          <Text style={styles.programName} numberOfLines={2}>{reminder.title}</Text>
          <Text style={styles.channelName} numberOfLines={1}>{reminder.channelName}</Text>

          <Text style={styles.countdownText}>
            Mudando de canal em <Text style={styles.countdownNumber}>{secondsLeft}s</Text>
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onDismiss} style={styles.dismissBtn} testID="reminder-dismiss">
              <Text style={styles.dismissText}>Fechar</Text>
            </Pressable>
            <Pressable onPress={() => onWatchNow(reminder)} style={styles.watchBtn} testID="reminder-watch-now">
              <Ionicons name="play" size={16} color={colors.black} />
              <Text style={styles.watchText}>Assistir agora</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { color: colors.white, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  programName: { color: colors.white, fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  channelName: { color: colors.textSecondary, fontSize: 13, marginTop: 2, marginBottom: spacing.md },
  countdownText: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg },
  countdownNumber: { color: colors.accentCyan, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
  dismissBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textMuted,
    alignItems: 'center',
  },
  dismissText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  watchBtn: {
    flex: 1.4,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchText: { color: colors.black, fontWeight: '800', fontSize: 13 },
});
