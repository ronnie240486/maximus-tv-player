import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
  error?: string | null;
};

const PIN_LENGTH = 4;

export default function PinModal({
  visible,
  title,
  subtitle,
  confirmLabel = 'CONFIRMAR',
  onSubmit,
  onCancel,
  error,
}: Props) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (visible) setPin('');
  }, [visible]);

  const submit = () => {
    if (pin.length !== PIN_LENGTH) return;
    onSubmit(pin);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Pressable onPress={onCancel} hitSlop={16} style={styles.closeBtn} testID="pin-modal-close">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>

          <Ionicons name="lock-closed" size={28} color={colors.accentCyan} />
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            autoFocus
            style={styles.input}
            placeholder="••••"
            placeholderTextColor={colors.textMuted}
            testID="pin-modal-input"
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={pin.length !== PIN_LENGTH}
            style={[styles.confirmBtn, pin.length !== PIN_LENGTH && { opacity: 0.4 }]}
            testID="pin-modal-confirm"
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.darkSurface,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: { position: 'absolute', top: 12, right: 12, padding: 4 },
  title: { color: colors.white, fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  subtitle: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
  input: {
    marginTop: spacing.sm,
    width: 140,
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.darkSurfaceAlt,
    color: colors.white,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 12,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: 4 },
  confirmBtn: {
    marginTop: spacing.md,
    width: '100%',
    backgroundColor: colors.accentCyan,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmText: { color: colors.black, fontWeight: '800', letterSpacing: 1.2, fontSize: 12 },
});
