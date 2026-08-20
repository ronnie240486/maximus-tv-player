import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getSession, getActivePlaylistIndex, setActivePlaylistIndex } from '@/src/state/session';
import { storage } from '@/src/utils/storage';
import TVFocusable from '@/src/components/TVFocusable';

// Mesma lista de chaves que "Limpar cache" em Configurações — trocar de
// playlist muda canais/filmes/séries por completo, então precisa recarregar
// tudo do zero, senão a Home continuaria mostrando o conteúdo da lista antiga.
const CACHE_KEYS = [
  'home_sections_cache_v1',
  'list_cache_v1_channels',
  'list_cache_v1_movies',
  'list_cache_v1_series',
];

export default function PlaylistsScreen() {
  const router = useRouter();
  const session = getSession();
  const playlists = session?.playlists || [];
  const [activeIdx, setActiveIdx] = useState(getActivePlaylistIndex());
  const [switching, setSwitching] = useState(false);

  const selectPlaylist = async (idx: number) => {
    if (idx === activeIdx) return;
    setSwitching(true);
    await setActivePlaylistIndex(idx);
    await Promise.all(CACHE_KEYS.map((k) => storage.removeItem(k)));
    setActiveIdx(idx);
    setSwitching(false);
    Alert.alert('Lista trocada', 'Voltando pra tela inicial pra carregar o conteúdo dessa lista.', [
      { text: 'OK', onPress: () => router.replace('/home') },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="playlists-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Listas</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.hint}>
        Seu painel disponibilizou {playlists.length} lista{playlists.length === 1 ? '' : 's'} pra esse MAC. Escolha qual usar.
      </Text>

      {playlists.length === 0 ? (
        <View style={styles.center} testID="playlists-empty">
          <MaterialCommunityIcons name="playlist-remove" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nenhuma lista encontrada</Text>
          <Text style={styles.emptySub}>Seu painel só disponibilizou uma lista padrão pra esse MAC.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
          {playlists.map((p, idx) => {
            const active = idx === activeIdx;
            return (
              <TVFocusable
                key={`${p.name}-${idx}`}
                onPress={() => selectPlaylist(idx)}
                style={[styles.row, active && styles.rowActive]}
                disabled={switching}
                testID={`playlist-${idx}`}
              >
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons name="playlist-play" size={20} color={active ? colors.accentCyan : colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, active && { color: colors.accentCyan }]}>{p.name || `Lista ${idx + 1}`}</Text>
                  {!!p.type && <Text style={styles.rowSub}>{p.type}</Text>}
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={colors.accentCyan} />}
              </TVFocusable>
            );
          })}
        </ScrollView>
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
  hint: { color: colors.textSecondary, fontSize: 12, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 6 },
  emptyTitle: { color: colors.white, fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptySub: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.darkSurface,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: { borderColor: colors.accentCyan, backgroundColor: 'rgba(76,232,240,0.08)' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.darkSurfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: colors.white, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, textTransform: 'uppercase' },
});
