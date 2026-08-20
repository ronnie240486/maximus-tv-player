import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import YoutubeIframe, { PLAYER_ERRORS } from 'react-native-youtube-iframe';

import { colors, spacing } from '@/src/theme';
import TVFocusable from '@/src/components/TVFocusable';

// Uses the same battle-tested player MaxPlayer (and most IPTV apps) rely on:
// react-native-youtube-iframe. Instead of us hand-rolling an <iframe> HTML
// page (which YouTube can be picky about — error 153 for a top-level
// navigation), this library loads a page purpose-built for embedding inside
// a React Native WebView, so playback/fullscreen/autoplay all behave like
// the real YouTube app.
function extractYouTubeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1) || null;
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
  } catch {
    // not a URL — fall through
  }
  const idMatch = trimmed.match(/[a-zA-Z0-9_-]{11}/);
  return idMatch ? idMatch[0] : null;
}

const ERROR_MESSAGES: Record<string, string> = {
  [PLAYER_ERRORS.VIDEO_NOT_FOUND]: 'Vídeo não encontrado.',
  [PLAYER_ERRORS.EMBED_NOT_ALLOWED]: 'O dono do vídeo não permite assistir dentro de outros apps.',
  [PLAYER_ERRORS.HTML5_ERROR]: 'Erro ao reproduzir o vídeo.',
  [PLAYER_ERRORS.INVALID_PARAMETER]: 'Vídeo inválido.',
};

export default function TrailerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ videoId?: string; query?: string; title?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoId = params.videoId ? extractYouTubeId(params.videoId) : null;
  const searchUrl = `https://m.youtube.com/results?search_query=${encodeURIComponent(params.query || '')}`;
  const externalUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(params.query || '')}`;

  const playerHeight = Math.round(Dimensions.get('window').width * (9 / 16));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="trailer-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {params.title ? `Trailer • ${params.title}` : 'Trailer'}
        </Text>
        <TVFocusable onPress={() => Linking.openURL(externalUrl)} hitSlop={12} testID="trailer-open-external">
          <Ionicons name="open-outline" size={20} color={colors.textSecondary} />
        </TVFocusable>
      </View>

      {videoId ? (
        <View style={{ flex: 1 }}>
          <View style={[styles.playerWrap, { height: playerHeight }]}>
            {loading && (
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator color={colors.accentCyan} size="large" />
              </View>
            )}
            <YoutubeIframe
              height={playerHeight}
              videoId={videoId}
              play
              forceAndroidAutoplay
              onReady={() => setLoading(false)}
              onError={(e: string) => {
                setLoading(false);
                setError(ERROR_MESSAGES[e] || 'Não foi possível reproduzir o trailer.');
              }}
              webViewProps={{ allowsFullscreenVideo: true }}
            />
          </View>

          {!!error && (
            <View style={styles.errorBox} testID="trailer-error">
              <Ionicons name="alert-circle-outline" size={22} color={colors.textMuted} />
              <Text style={styles.errorText}>{error}</Text>
              <TVFocusable onPress={() => Linking.openURL(externalUrl)} style={styles.fallbackBtn} testID="trailer-fallback-btn">
                <Ionicons name="logo-youtube" size={16} color={colors.white} />
                <Text style={styles.fallbackText}>Abrir no app do YouTube</Text>
              </TVFocusable>
            </View>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.hint}>
            <Text style={styles.hintText}>
              Não achamos o trailer oficial direto — toca no vídeo certo aqui embaixo.
            </Text>
          </View>
          <WebView source={{ uri: searchUrl }} style={{ flex: 1, backgroundColor: colors.black }} testID="trailer-webview" />
        </View>
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
  headerTitle: { flex: 1, color: colors.white, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  playerWrap: { width: '100%', backgroundColor: colors.black, justifyContent: 'center' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  errorBox: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: spacing.xl },
  errorText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  fallbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.darkSurface,
  },
  fallbackText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  hint: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  hintText: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
});
