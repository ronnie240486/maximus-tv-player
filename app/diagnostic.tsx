import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getDeviceMac } from '@/src/lib/device';
import { checkMac } from '@/src/api/client';
import { parsePlaylistUrl, xtream } from '@/src/lib/xtream';
import { getSession, loadSession } from '@/src/state/session';
import { getSessionLog, clearSessionLog } from '@/src/state/debug-log';
import { getDeviceCapabilityInfo } from '@/src/hooks/useIsLowEndDevice';
import * as Notifications from 'expo-notifications';
import TVFocusable from '@/src/components/TVFocusable';

type CheckState = 'checking' | 'ok' | 'off';

/**
 * Diagnóstico simplificado — de propósito, NÃO mostra nada técnico
 * (URLs do painel, usuário/senha, contato do revendedor, JSON cru). É só
 * um resumo de duas linhas ("Internet: OK/OFF", "Lista: OK/OFF") pra
 * qualquer cliente entender rapidamente onde está o problema, sem expor
 * dado nenhum sensível nem informação que só confunde quem não é técnico.
 */
export default function BackendDiagScreen() {
  const router = useRouter();
  const [internetState, setInternetState] = useState<CheckState>('checking');
  const [listState, setListState] = useState<CheckState>('checking');
  const [checking, setChecking] = useState(true);

  const onTestNotification = useCallback(async () => {
    try {
      const perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permissão negada', 'Vai em Ajustes do Android > Apps > Maximus Player > Notificações, e ativa manualmente.');
        return;
      }
      await Notifications.setNotificationChannelAsync('game-reminders', {
        name: 'Lembretes de jogo',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Teste de notificação 🔔', body: 'Se você está vendo isso, o mecanismo funciona!' },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: Date.now() + 10000,
          channelId: 'game-reminders',
        },
      });
      Alert.alert(
        'Agendado!',
        'Uma notificação vai aparecer em 10 segundos. Pode fechar o app completamente (deslizar pra fora dos recentes) e esperar — se ela aparecer mesmo com o app fechado, o mecanismo funciona de verdade.'
      );
    } catch (e: any) {
      Alert.alert('Erro ao agendar', e?.message || String(e));
    }
  }, []);

  const onViewLogs = useCallback(async () => {
    const logs = await getSessionLog();
    const cap = getDeviceCapabilityInfo();
    const ramGb = cap.totalMemoryBytes ? (cap.totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1) : '?';
    const deviceInfo =
      `Aparelho: ${cap.modelName || '?'} (Android ${cap.osVersion || '?'})\n` +
      `RAM: ${ramGb}GB | CPU bench: ${cap.cpuBenchmarkMs}ms (rápido ≤${cap.cpuFastMaxMs}ms, lento ≥${cap.cpuSlowMinMs}ms) | ` +
      `${cap.is32BitOnly ? '32-bit' : '64-bit'} | Nível: ${cap.devicePerfTier.toUpperCase()}`;
    Alert.alert(
      'Logs de depuração',
      `${deviceInfo}\n\n${logs.length ? logs.join('\n') : 'Nenhum log ainda — cria um teste ou navega pelo app primeiro.'}`,
      [
        { text: 'Limpar', onPress: () => clearSessionLog(), style: 'destructive' },
        { text: 'Fechar', style: 'cancel' },
      ]
    );
  }, []);

  const run = useCallback(async () => {
    setChecking(true);
    setInternetState('checking');
    setListState('checking');

    // 1) Internet: tenta alcançar um endereço simples e sempre no ar,
    // sem relação nenhuma com o painel — se isso falhar, o problema é a
    // conexão do aparelho, não a lista.
    let internetOk = false;
    try {
      const res = await fetch('https://www.gstatic.com/generate_204');
      internetOk = res.ok || res.status === 204;
    } catch {
      internetOk = false;
    }
    setInternetState(internetOk ? 'ok' : 'off');

    // 2) Lista: confirma que a conta ATUALMENTE ativa no app (sessão
    // local) tem uma playlist que realmente responde com conteúdo — sem
    // internet, nem tenta. IMPORTANTE: usa a sessão salva, não
    // `checkMac` de novo — contas de teste geradas direto no app (ver
    // tela de MAC) não existem no painel do revendedor, então
    // reconsultar o painel aqui sempre voltava "não autorizado"/sem
    // playlist pra elas, mesmo com o teste funcionando normalmente no
    // resto do app.
    let listOk = false;
    if (internetOk) {
      try {
        const session = getSession() || (await loadSession());
        let playlists = session?.playlists;

        // Sessão normal (não-teste): revalida com o painel, já que o
        // revendedor pode ter bloqueado/trocado a lista nesse meio tempo.
        // Sessão de teste: não existe no painel, então isso é pulado —
        // usa direto o que já está salvo localmente.
        if (session?.status !== 'Teste') {
          const mac = await getDeviceMac();
          const fresh = await checkMac(mac);
          if (fresh.authorized && fresh.playlists?.length) {
            playlists = fresh.playlists;
          }
        }

        if (playlists?.length) {
          for (const p of playlists) {
            const creds = parsePlaylistUrl(p.url);
            if (!creds) continue;
            try {
              const cats = await xtream.liveCategories(creds);
              if (cats && cats.length > 0) {
                listOk = true;
                break;
              }
            } catch {
              // essa lista específica não respondeu — tenta a próxima
            }
          }
        }
      } catch {
        listOk = false;
      }
    }
    setListState(listOk ? 'ok' : 'off');
    setChecking(false);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const allOk = internetState === 'ok' && listState === 'ok';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TVFocusable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="diag-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </TVFocusable>
        <Text style={styles.headerTitle}>Diagnóstico</Text>
        <TVFocusable onPress={run} hitSlop={16} disabled={checking} testID="diag-refresh">
          <Ionicons name="refresh" size={22} color={checking ? colors.textMuted : colors.accentCyan} />
        </TVFocusable>
      </View>

      <View style={styles.body}>
        <StatusRow label="Internet" state={internetState} />
        <StatusRow label="Lista" state={listState} />

        <View style={styles.summaryBox}>
          {checking ? (
            <>
              <ActivityIndicator color={colors.accentCyan} />
              <Text style={styles.summaryText}>Verificando...</Text>
            </>
          ) : allOk ? (
            <>
              <Ionicons name="checkmark-circle" size={22} color={colors.accentCyan} />
              <Text style={styles.summaryText}>Tudo certo! É só aproveitar.</Text>
            </>
          ) : internetState === 'off' ? (
            <>
              <Ionicons name="wifi-outline" size={22} color={colors.danger} />
              <Text style={styles.summaryText}>Sem internet. Verifique seu Wi-Fi ou dados móveis.</Text>
            </>
          ) : (
            <>
              <Ionicons name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.summaryText}>Sua lista parece fora do ar. Fale com seu revendedor.</Text>
            </>
          )}
        </View>

        {/* Botão temporário de depuração — só existe pra rastrear de vez o
            bug da sessão de teste sendo sobrescrita. Remover depois. */}
        <TVFocusable onPress={onTestNotification} style={styles.debugBtn} testID="diag-test-notification">
          <Ionicons name="notifications-outline" size={16} color={colors.textMuted} />
          <Text style={styles.debugBtnText}>Testar notificação (10s, feche o app depois)</Text>
        </TVFocusable>
        <TVFocusable onPress={onViewLogs} style={styles.debugBtn} testID="diag-view-logs">
          <Ionicons name="bug-outline" size={16} color={colors.textMuted} />
          <Text style={styles.debugBtnText}>Ver logs de depuração</Text>
        </TVFocusable>
      </View>
    </SafeAreaView>
  );
}

function StatusRow({ label, state }: { label: string; state: CheckState }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {state === 'checking' ? (
        <ActivityIndicator color={colors.textMuted} size="small" />
      ) : (
        <View style={styles.rowBadge}>
          <Ionicons
            name={state === 'ok' ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={state === 'ok' ? colors.accentCyan : colors.danger}
          />
          <Text style={[styles.rowBadgeText, { color: state === 'ok' ? colors.accentCyan : colors.danger }]}>
            {state === 'ok' ? 'OK' : 'OFF'}
          </Text>
        </View>
      )}
    </View>
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
  body: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.darkSurface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: { color: colors.white, fontSize: 15, fontWeight: '700' },
  rowBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowBadgeText: { fontSize: 14, fontWeight: '800' },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  summaryText: { color: colors.white, fontSize: 14, flex: 1 },
  debugBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: 10,
  },
  debugBtnText: { color: colors.textMuted, fontSize: 12 },
});
