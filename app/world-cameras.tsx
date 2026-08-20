import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import TVFocusable from '@/src/components/TVFocusable';

// Trocado de camerasdomundo.com pra webcamera24.com — testado e
// confirmado funcionando pelo usuário. Site maior (tem app próprio na
// Google Play, avaliação 4/5 no Trustpilot), e muitas câmeras de lá usam
// embed direto do YouTube por baixo. Países fora da lista oficial deles
// (Líbano, Irã, Palestina, Ilhas Virgens) foram removidos — apontar pra
// um país que não existe no site dava página vazia/erro.
const COUNTRIES: { id: string; name: string; flag: string; url: string }[] = [
  { id: 'brazil', name: 'Brasil', flag: '🇧🇷', url: 'https://webcamera24.com/pt/countries/brazil/' },
  { id: 'usa', name: 'Estados Unidos', flag: '🇺🇸', url: 'https://webcamera24.com/pt/countries/usa/' },
  { id: 'japan', name: 'Japão', flag: '🇯🇵', url: 'https://webcamera24.com/pt/countries/japan/' },
  { id: 'canada', name: 'Canadá', flag: '🇨🇦', url: 'https://webcamera24.com/pt/countries/canada/' },
  { id: 'spain', name: 'Espanha', flag: '🇪🇸', url: 'https://webcamera24.com/pt/countries/spain/' },
  { id: 'turkey', name: 'Turquia', flag: '🇹🇷', url: 'https://webcamera24.com/pt/countries/turkey/' },
  { id: 'thailand', name: 'Tailândia', flag: '🇹🇭', url: 'https://webcamera24.com/pt/countries/thailand/' },
  { id: 'singapore', name: 'Singapura', flag: '🇸🇬', url: 'https://webcamera24.com/pt/countries/singapore/' },
  { id: 'philippines', name: 'Filipinas', flag: '🇵🇭', url: 'https://webcamera24.com/pt/countries/philippines/' },
  { id: 'taiwan', name: 'Taiwan', flag: '🇹🇼', url: 'https://webcamera24.com/pt/countries/taiwan/' },
  { id: 'israel', name: 'Israel', flag: '🇮🇱', url: 'https://webcamera24.com/pt/countries/israel/' },
  { id: 'italy', name: 'Itália', flag: '🇮🇹', url: 'https://webcamera24.com/pt/countries/italy/' },
  { id: 'france', name: 'França', flag: '🇫🇷', url: 'https://webcamera24.com/pt/countries/france/' },
  { id: 'uk', name: 'Reino Unido', flag: '🇬🇧', url: 'https://webcamera24.com/pt/countries/united-kingdom/' },
  { id: 'all', name: 'Ver todas', flag: '🌎', url: 'https://webcamera24.com/pt/popular/' },
];

export default function WorldCamerasScreen() {
  const router = useRouter();

  const openCountry = (name: string, url: string) => {
    router.push({ pathname: '/world-camera-view', params: { title: name, url } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="world-cameras-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Câmeras do Mundo</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.subtitle}>Escolha um país para ver as câmeras ao vivo</Text>

      <FlatList
        data={COUNTRIES}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <TVFocusable
            onPress={() => openCountry(item.name, item.url)}
            style={styles.card}
            testID={`world-country-${item.id}`}
          >
            <Text style={styles.flag}>{item.flag}</Text>
            <Text style={styles.countryName}>{item.name}</Text>
          </TVFocusable>
        )}
      />
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
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  grid: { padding: spacing.md, gap: spacing.sm },
  row: { gap: spacing.sm },
  card: {
    flex: 1,
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  flag: { fontSize: 32 },
  countryName: { color: colors.white, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
