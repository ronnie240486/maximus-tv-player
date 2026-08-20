import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getDeviceMac } from '@/src/lib/device';
import { clearSession, loadSession, getXtream } from '@/src/state/session';
import { getXtreamCacheStats } from '@/src/lib/xtream';
import { xtream } from '@/src/lib/xtream';
import { storage } from '@/src/utils/storage';
import { clearHomeCache } from '@/src/state/home-cache';
import { clearListCache } from '@/src/state/list-cache';
import { isWelcomeAudioEnabled, setWelcomeAudioEnabled } from '@/src/state/welcome-audio';
import { MacStatus, fetchAppExtras, AppExtras, fetchApkUpdate } from '@/src/api/client';
import PinModal from '@/src/components/PinModal';
import TVFocusable from '@/src/components/TVFocusable';
import {
  isParentalLockEnabled,
  setParentalLockEnabled,
  hasParentalPin,
  setParentalPin,
  verifyParentalPin,
} from '@/src/state/parental';

// Everything cleared by "Limpar cache" — cached channel/movie/series/home
// lists only. Deliberately does NOT touch: session (mac_status_v1 — would
// log the person out), profiles_v1 (their saved profiles), or the device MAC
// (device_mac_id_v1 — no longer even used as the source of truth, but left
// alone regardless so nothing about device identity changes here).

const AUTOPLAY_KEY = 'settings_player_autoplay_next_v1';
// Só pra conferir se um APK é realmente o mais recente — muda esse texto
// toda vez que uma correção nova é enviada, e compara com o que aparece
// aqui dentro do app depois de instalar.
import { BUILD_STAMP } from '@/src/build-info';

type PinFlow =
  | { step: 'create-1' }
  | { step: 'create-2'; firstPin: string }
  | { step: 'disable-verify' }
  | { step: 'change-verify' }
  | { step: 'change-new-1' }
  | { step: 'change-new-2'; firstPin: string };

type Row = {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
};

export default function SettingsScreen() {
  const router = useRouter();
  const [mac, setMac] = useState('');
  const [session, setSession] = useState<MacStatus | null>(null);
  const [extras, setExtras] = useState<AppExtras>({});
  const [parentalLock, setParentalLock] = useState(false);
  const [pinExists, setPinExists] = useState(false);
  const [autoplayNext, setAutoplayNext] = useState(true);
  const [pinFlow, setPinFlow] = useState<PinFlow | null>(null);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [welcomeAudio, setWelcomeAudio] = useState(true);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [m, s, parental, hasPin, autoplay, welcomeAudioOn] = await Promise.all([
        getDeviceMac(),
        loadSession(),
        isParentalLockEnabled(),
        hasParentalPin(),
        storage.getItem<boolean>(AUTOPLAY_KEY, true),
        isWelcomeAudioEnabled(),
      ]);
      setMac(m);
      setSession(s);
      setParentalLock(parental);
      setPinExists(hasPin);
      setAutoplayNext(autoplay !== false);

      // Best-effort: Website / e-mail do revendedor / aviso legal, se o
      // revendedor tiver preenchido no painel. Não trava a tela se falhar.
      fetchAppExtras(m).then(setExtras).catch(() => {});

      // Mensagem do provedor de IPTV (ex: aviso de pagamento) — vem do
      // próprio servidor Xtream, separado do painel Maximus.
      const creds = getXtream();
      if (creds) {
        xtream.authenticate(creds).then((res) => {
          const msg = res?.user_info?.message?.trim();
          if (msg) setProviderMessage(msg);
        });
      }
      setWelcomeAudio(welcomeAudioOn);
    })();
  }, []);

  const toggleAutoplay = async (v: boolean) => {
    setAutoplayNext(v);
    await storage.setItem(AUTOPLAY_KEY, v);
  };

  const toggleWelcomeAudio = async (v: boolean) => {
    setWelcomeAudio(v);
    await setWelcomeAudioEnabled(v);
  };


  // Turning ON with no PIN yet -> create one first. Turning OFF always
  // requires the current PIN, so a kid can't just flip the switch back off.
  const onToggleParental = async (v: boolean) => {
    setPinError(null);
    if (v) {
      const hasPin = await hasParentalPin();
      if (hasPin) {
        await setParentalLockEnabled(true);
        setParentalLock(true);
      } else {
        setPinFlow({ step: 'create-1' });
      }
    } else {
      setPinFlow({ step: 'disable-verify' });
    }
  };

  const onSubmitPin = async (pin: string) => {
    if (!pinFlow) return;
    switch (pinFlow.step) {
      case 'create-1':
        setPinError(null);
        setPinFlow({ step: 'create-2', firstPin: pin });
        return;
      case 'create-2':
        if (pin !== pinFlow.firstPin) {
          setPinError('Os PINs não são iguais. Digite de novo.');
          setPinFlow({ step: 'create-1' });
          return;
        }
        await setParentalPin(pin);
        await setParentalLockEnabled(true);
        setParentalLock(true);
        setPinExists(true);
        setPinFlow(null);
        return;
      case 'disable-verify': {
        const ok = await verifyParentalPin(pin);
        if (!ok) {
          setPinError('PIN incorreto.');
          return;
        }
        await setParentalLockEnabled(false);
        setParentalLock(false);
        setPinFlow(null);
        setPinError(null);
        return;
      }
      case 'change-verify': {
        const ok = await verifyParentalPin(pin);
        if (!ok) {
          setPinError('PIN incorreto.');
          return;
        }
        setPinError(null);
        setPinFlow({ step: 'change-new-1' });
        return;
      }
      case 'change-new-1':
        setPinError(null);
        setPinFlow({ step: 'change-new-2', firstPin: pin });
        return;
      case 'change-new-2':
        if (pin !== pinFlow.firstPin) {
          setPinError('Os PINs não são iguais. Digite de novo.');
          setPinFlow({ step: 'change-new-1' });
          return;
        }
        await setParentalPin(pin);
        setPinFlow(null);
        setPinError(null);
        Alert.alert('Pronto', 'PIN alterado com sucesso.');
        return;
    }
  };

  const pinModalCopy: Record<PinFlow['step'], { title: string; subtitle: string }> = {
    'create-1': { title: 'Criar PIN', subtitle: 'Escolha um PIN de 4 dígitos pra proteger o conteúdo adulto.' },
    'create-2': { title: 'Confirme o PIN', subtitle: 'Digite o mesmo PIN de novo.' },
    'disable-verify': { title: 'Desativar controle parental', subtitle: 'Digite o PIN atual pra desativar.' },
    'change-verify': { title: 'Alterar PIN', subtitle: 'Digite o PIN atual pra continuar.' },
    'change-new-1': { title: 'Novo PIN', subtitle: 'Escolha o novo PIN de 4 dígitos.' },
    'change-new-2': { title: 'Confirme o novo PIN', subtitle: 'Digite o novo PIN de novo.' },
  };

  const copyMac = async () => {
    if (!mac) return;
    await Clipboard.setStringAsync(mac);
    Alert.alert('Copiado', 'ID do dispositivo copiado para a área de transferência.');
  };

  const showAccount = () => {
    Alert.alert(
      'Conta',
      [
        session?.status ? `Status: ${session.status}` : null,
        session?.expire_date ? `Expira em: ${session.expire_date}` : null,
        session?.server_name ? `Servidor: ${session.server_name}` : null,
        !session?.status ? 'Nenhuma conta ativa no momento.' : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  };

  const clearAllCaches = async () => {
    await clearHomeCache();
    await clearListCache(['channels', 'movies', 'series']);
  };

  const clearCache = () => {
    Alert.alert(
      'Limpar cache',
      'Isso apaga apenas as listas salvas (canais, filmes, séries e a tela inicial), pra forçar buscar tudo de novo. Seu login e seus perfis continuam salvos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar',
          style: 'destructive',
          onPress: async () => {
            await clearAllCaches();
            Alert.alert('Pronto', 'Cache limpo. As listas vão recarregar na próxima vez que você abrir cada tela.');
          },
        },
      ]
    );
  };

  const updateContent = () => {
    Alert.alert(
      'Atualizar conteúdo',
      'Isso limpa o que está guardado e busca canais, filmes e séries de novo — use se algo não estiver aparecendo certo ou se tiver conteúdo novo no painel.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Atualizar',
          onPress: async () => {
            await clearAllCaches();
            Alert.alert('Pronto', 'Conteúdo será atualizado. Voltando pra tela inicial...', [
              { text: 'OK', onPress: () => router.replace('/home') },
            ]);
          },
        },
      ]
    );
  };

  const showLanguage = () => {
    Alert.alert('Idioma', 'No momento o app está disponível apenas em Português (Brasil).');
  };

  const showVersion = () => {
    Alert.alert(
      session?.app_name || 'Maximus Player',
      `Versão ${session?.version || '1.0'}\n\n${BUILD_STAMP}`
    );
  };

  const openWhatsapp = () => {
    if (session?.whatsapp_url) Linking.openURL(session.whatsapp_url).catch(() => {});
  };

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const onCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await fetchApkUpdate(mac);
      if (!info.url) {
        Alert.alert('Sem atualização', 'Não foi possível encontrar um link de atualização agora. Tente de novo mais tarde.');
        return;
      }
      // Abre o link como veio do painel — seja da Play Store
      // (market://... ou https://play.google.com/...) ou um link de
      // download direto do APK, o sistema decide sozinho o que abrir.
      Linking.openURL(info.url).catch(() => {
        Alert.alert('Não foi possível abrir', 'O link de atualização não pôde ser aberto neste aparelho.');
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível verificar atualização agora. Confira sua internet e tente de novo.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const rows: Row[] = [
    {
      id: 'account',
      title: 'Conta',
      subtitle: session?.status
        ? `${session.status}${session.expire_date ? ` • até ${session.expire_date}` : ''}`
        : mac || 'Carregando...',
      icon: <Ionicons name="person-circle-outline" size={22} color={colors.accentCyan} />,
      onPress: showAccount,
    },
    {
      id: 'mac',
      title: 'ID do dispositivo',
      subtitle: mac,
      icon: <MaterialCommunityIcons name="identifier" size={20} color={colors.accentCyan} />,
      onPress: copyMac,
    },
    ...(session?.reseller_whatsapp
      ? [
          {
            id: 'support',
            title: 'Suporte / Revendedor',
            subtitle: session?.reseller_contact || session?.reseller_whatsapp,
            icon: <Ionicons name="logo-whatsapp" size={20} color={colors.accentCyan} />,
            onPress: openWhatsapp,
          } as Row,
        ]
      : []),
    ...(extras.websiteUrl
      ? [
          {
            id: 'website',
            title: 'Website',
            subtitle: extras.websiteUrl,
            icon: <Ionicons name="globe-outline" size={20} color={colors.accentCyan} />,
            onPress: () => Linking.openURL(extras.websiteUrl!).catch(() => {}),
          } as Row,
        ]
      : []),
    ...(extras.resellerEmail
      ? [
          {
            id: 'reseller-email',
            title: 'E-mail do revendedor',
            subtitle: extras.resellerEmail,
            icon: <Ionicons name="mail-outline" size={20} color={colors.accentCyan} />,
            onPress: () => Linking.openURL(`mailto:${extras.resellerEmail}`).catch(() => {}),
          } as Row,
        ]
      : []),
    ...(extras.legalNotice
      ? [
          {
            id: 'legal-notice',
            title: 'Aviso legal',
            icon: <Ionicons name="document-text-outline" size={20} color={colors.accentCyan} />,
            onPress: () => Alert.alert('Aviso legal', extras.legalNotice!),
          } as Row,
        ]
      : []),
    {
      id: 'cache-stats',
      title: 'Cache desta sessão',
      subtitle: (() => {
        const s = getXtreamCacheStats();
        const total = s.hits + s.misses;
        if (total === 0) return 'Ainda sem dados nessa sessão';
        return `${Math.round(s.hitRate * 100)}% das chamadas vieram do cache (${s.hits} de ${total})`;
      })(),
      icon: <Ionicons name="speedometer-outline" size={20} color={colors.accentCyan} />,
    },
    {
      id: 'update',
      title: checkingUpdate ? 'Verificando...' : 'Verificar atualização',
      subtitle: 'Busca a versão mais recente do app agora',
      icon: checkingUpdate ? (
        <ActivityIndicator size="small" color={colors.accentCyan} />
      ) : (
        <Ionicons name="cloud-download-outline" size={20} color={colors.accentCyan} />
      ),
      onPress: checkingUpdate ? undefined : onCheckUpdate,
    },
    {
      id: 'playlists',
      title: 'Listas',
      subtitle: `${session?.playlists?.length || 1} lista${(session?.playlists?.length || 1) === 1 ? '' : 's'} disponível${(session?.playlists?.length || 1) === 1 ? '' : 'is'}`,
      icon: <MaterialCommunityIcons name="playlist-play" size={20} color={colors.accentCyan} />,
      onPress: () => router.push('/playlists'),
    },
    {
      id: 'update-content',
      title: 'Atualizar conteúdo',
      subtitle: 'Busca canais, filmes e séries de novo',
      icon: <Ionicons name="refresh" size={20} color={colors.accentCyan} />,
      onPress: updateContent,
    },
    {
      id: 'cache',
      title: 'Cache',
      subtitle: 'Limpar cache do app',
      icon: <Ionicons name="trash-outline" size={20} color={colors.accentCyan} />,
      onPress: clearCache,
    },
    {
      id: 'language',
      title: 'Idioma',
      subtitle: 'Português (Brasil)',
      icon: <Ionicons name="language" size={20} color={colors.accentCyan} />,
      onPress: showLanguage,
    },
    {
      id: 'parental',
      title: 'Controle parental',
      subtitle: parentalLock ? 'Ativado — conteúdo adulto bloqueado' : 'Desativado',
      icon: <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.accentCyan} />,
      toggle: { value: parentalLock, onChange: onToggleParental },
    },
    ...(pinExists
      ? [
          {
            id: 'change-pin',
            title: 'Alterar PIN',
            subtitle: 'Trocar o PIN do controle parental',
            icon: <MaterialCommunityIcons name="lock-reset" size={20} color={colors.accentCyan} />,
            onPress: () => setPinFlow({ step: 'change-verify' }),
          } as Row,
        ]
      : []),
    {
      id: 'player',
      title: 'Player',
      subtitle: autoplayNext ? 'Próximo episódio automático: ativado' : 'Próximo episódio automático: desativado',
      icon: <Ionicons name="play-circle-outline" size={20} color={colors.accentCyan} />,
      toggle: { value: autoplayNext, onChange: toggleAutoplay },
    },
    {
      id: 'welcome-audio',
      title: 'Áudio de boas-vindas',
      subtitle: welcomeAudio ? 'Ativado' : 'Desativado',
      icon: <Ionicons name="volume-high-outline" size={20} color={colors.accentCyan} />,
      toggle: { value: welcomeAudio, onChange: toggleWelcomeAudio },
    },
    {
      id: 'diagnostic',
      title: 'Diagnóstico',
      subtitle: 'Testar conexão com o backend',
      icon: <MaterialCommunityIcons name="stethoscope" size={20} color={colors.accentCyan} />,
      onPress: () => router.push('/diagnostic'),
    },
    {
      id: 'version',
      title: 'Versão',
      subtitle: `v${session?.version || '1.0'} • ${BUILD_STAMP}`,
      icon: <Ionicons name="information-circle-outline" size={20} color={colors.accentCyan} />,
      onPress: showVersion,
    },
    {
      id: 'logout',
      title: 'Sair / Trocar dispositivo',
      subtitle: 'Apaga o login salvo neste app',
      icon: <Ionicons name="log-out-outline" size={20} color={colors.danger} />,
      danger: true,
      onPress: () => {
        Alert.alert(
          'Sair',
          'Isso vai apagar o login salvo (você vai precisar ativar o MAC de novo no painel). Seu ID de dispositivo continua o mesmo.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Sair',
              style: 'destructive',
              onPress: async () => {
                await clearSession();
                router.replace('/');
              },
            },
          ]
        );
      },
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="settings-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Configurações</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 40 }}>
        {!!providerMessage && (
          <View style={styles.providerBanner} testID="provider-message">
            <Ionicons name="warning-outline" size={18} color="#F0A94C" />
            <Text style={styles.providerBannerText}>{providerMessage}</Text>
          </View>
        )}
        {rows.map((r) => (
          <TVFocusable
            key={r.id}
            onPress={r.toggle ? () => r.toggle!.onChange(!r.toggle!.value) : r.onPress}
            style={styles.row}
            testID={`setting-${r.id}`}
          >
            <View style={styles.iconWrap}>{r.icon}</View>
            <View style={styles.textWrap}>
              <Text style={[styles.title, r.danger && { color: colors.danger }]}>{r.title}</Text>
              {!!r.subtitle && <Text style={styles.sub} numberOfLines={1}>{r.subtitle}</Text>}
            </View>
            {r.toggle ? (
              <Switch
                value={r.toggle.value}
                onValueChange={r.toggle.onChange}
                trackColor={{ false: colors.darkSurfaceAlt, true: colors.accentCyan }}
                thumbColor={colors.white}
              />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            )}
          </TVFocusable>
        ))}
      </ScrollView>

      <PinModal
        visible={pinFlow !== null}
        title={pinFlow ? pinModalCopy[pinFlow.step].title : ''}
        subtitle={pinFlow ? pinModalCopy[pinFlow.step].subtitle : ''}
        error={pinError}
        onSubmit={onSubmitPin}
        onCancel={() => {
          setPinFlow(null);
          setPinError(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  providerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(240,169,76,0.12)',
    borderWidth: 1,
    borderColor: '#F0A94C',
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  providerBannerText: { flex: 1, color: '#F0A94C', fontSize: 12, fontWeight: '700' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.white, fontSize: 20, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.darkSurface,
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.darkSurfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: { color: colors.white, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
