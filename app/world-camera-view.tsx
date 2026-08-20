import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';

import { colors, spacing } from '@/src/theme';

export default function WorldCameraViewScreen() {
  const router = useRouter();
  const { title, url } = useLocalSearchParams<{ title?: string; url: string }>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Carregar um site completo (JS, imagens, etc) dentro do WebView é bem
  // mais pesado que qualquer tela nossa — em processador fraco, pode
  // legitimamente demorar bastante sem ter travado. Sem uma explicação,
  // uma bolinha girando por 15-20s parece quebrado mesmo quando só está
  // lento. Esse aviso extra aparece só depois de um tempo, pra não
  // poluir a espera normal (rápida na maioria dos aparelhos).
  const [showSlowHint, setShowSlowHint] = useState(false);
  const slowHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      slowHintTimer.current = setTimeout(() => setShowSlowHint(true), 8000);
    } else {
      setShowSlowHint(false);
      if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
    }
    return () => {
      if (slowHintTimer.current) clearTimeout(slowHintTimer.current);
    };
  }, [loading]);

  useEffect(() => {
    // Sem isso, o botão FÍSICO de voltar do controle remoto pode ser
    // capturado pelo WebView (navegando pra trás dentro do histórico do
    // site, tipo YouTube/webcamera24) em vez de fechar nossa tela — e aí
    // ficar preso numa página que não termina de carregar (é o "fica só
    // carregando" ao apertar voltar). Isso garante que o botão voltar
    // SEMPRE sai da nossa tela, nunca navega dentro do site.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="world-camera-view-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || 'Câmeras'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {failed ? (
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.errorText}>Não foi possível carregar essa página agora.</Text>
          <Pressable
            onPress={() => {
              setFailed(false);
              setLoading(true);
            }}
            style={styles.retryBtn}
          >
            <Text style={styles.retryBtnText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: url }}
            style={styles.webview}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
          />
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={colors.accentCyan} size="large" />
              {showSlowHint && (
                <Text style={styles.slowHintText}>
                  Ainda carregando... pode demorar mais em aparelhos mais lentos, é normal.
                </Text>
              )}
            </View>
          )}
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
  headerTitle: { flex: 1, color: colors.white, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  webview: { flex: 1, backgroundColor: colors.black },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.black,
    gap: 14,
    paddingHorizontal: spacing.xl,
  },
  slowHintText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: spacing.lg,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accentCyan,
  },
  retryBtnText: {
    color: '#001018',
    fontWeight: '700',
  },
});
