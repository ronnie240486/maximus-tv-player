import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ImageBackground,
  Alert,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { getDeviceMac } from '@/src/lib/device';
import { checkMac, MacStatus, registerTestDevice, registerCustomer, fetchAppExtras, AppExtras } from '@/src/api/client';
import { hasUsedTest, markTestUsed } from '@/src/state/test-usage';
import { parsePlaylistUrl, xtream, XtreamCreds } from '@/src/lib/xtream';
import { saveSession, loadSession, clearSession } from '@/src/state/session';
import { clearHomeCache } from '@/src/state/home-cache';
import { clearListCache } from '@/src/state/list-cache';
import { logSessionEvent } from '@/src/state/debug-log';
import { useIsTV } from '@/src/hooks/useIsTV';
import { BUILD_STAMP, BUILD_SHORT } from '@/src/build-info';
import TVFocusable from '@/src/components/TVFocusable';

const POLL_MS = 5000;

export default function MacLoginScreen() {
  const router = useRouter();
  const isTV = useIsTV();
  const [mac, setMac] = useState<string>('');
  const [extras, setExtras] = useState<AppExtras>({});
  const [status, setStatus] = useState<MacStatus | null>(null);
  const [bgFailed, setBgFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [testing, setTesting] = useState(false);
  // Mostrado só durante o "aquecimento" do teste recém-criado (ver
  // onTestRegister) — deixa claro pro usuário que ele não travou, só está
  // esperando o servidor de teste terminar de provisionar a conta nova.
  const [testStage, setTestStage] = useState<string | null>(null);
  // Enquanto isso for true, não mostramos a tela de "Como entrar" — só uma
  // tela em branco/carregando. Evita o "flash" da tela de login toda vez
  // que o app abre, mesmo já estando logado: antes, a tela de login sempre
  // aparecia primeiro e só depois (quando a checagem de rede terminava)
  // é que redirecionava pra frente. Agora só mostramos o login de fato
  // depois de confirmar que NÃO existe uma sessão válida.
  const [checkingSession, setCheckingSession] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Enquanto isso for true, o poll automático (runPoll) NÃO FAZ NADA — nem
  // agenda o próximo, nem age se uma checagem já estava em andamento. Ver
  // onTestRegister: é ligado assim que a pessoa aperta TESTE.
  const testFlowActiveRef = useRef(false);

  const runPoll = useCallback(
    async (deviceMac: string, isManual = false) => {
      if (!mountedRef.current) return;
      // ESSENCIAL: nunca deixa o poll automático agir enquanto um teste
      // está sendo gerado/aquecido. Sem isso, se esse MAC também estiver
      // cadastrado no painel normal do revendedor (ex: de um teste manual
      // anterior), esse poll (roda a cada 5s) achava esse cadastro
      // "autorizado" e entrava sozinho com ELE — sobrescrevendo bem no
      // meio do processo a sessão de teste que a pessoa tinha acabado de
      // gerar, mesmo com o teste certinho e funcionando. Foi a causa real
      // por trás de vários "Lista OFF" que pareciam ser problema no teste
      // em si, quando na verdade o teste nunca chegava a "grudar".
      if (testFlowActiveRef.current) {
        return;
      }
      setChecking(true);
      const s = await checkMac(deviceMac);
      if (!mountedRef.current || testFlowActiveRef.current) {
        if (testFlowActiveRef.current) {
        }
        return;
      }
      setChecking(false);
      setStatus(s);
      setLastCheck(new Date());
      setPollCount((c) => c + 1);
      if (s.authorized && (s.playlists || []).some((p) => !!parsePlaylistUrl(p.url))) {
        await saveSession(s);
        router.replace('/welcome');
        return;
      }
      if (!isManual) {
        pollRef.current = setTimeout(() => runPoll(deviceMac), POLL_MS);
      }
    },
    [router]
  );

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      logSessionEvent('index-load', 'inicio (tela de ativacao)');
      const m = await getDeviceMac();
      if (!mountedRef.current) return;
      setMac(m);
      logSessionEvent('index-load', 'mac obtido');

      // Best-effort: se falhar ou demorar, a tela funciona normal do
      // mesmo jeito, só sem essa frase.
      fetchAppExtras(m)
        .then((ex) => {
          if (mountedRef.current) setExtras(ex);
        })
        .catch(() => {});

      // Mesmo com sessão salva, sempre confirma de novo com o painel antes
      // de liberar — se o revendedor bloqueou a lista nesse meio tempo, o
      // app não pode continuar usando dados antigos salvos no celular.
      const cached = await loadSession();
      logSessionEvent('index-load', `sessao local carregada (tinha sessao: ${!!cached?.authorized}, status: ${cached?.status || '-'})`);
      if (cached?.authorized) {
        if (cached.status === 'Teste') {
          // Sessão de teste: não existe no painel principal, então
          // perguntar pra ele sempre voltaria "não autorizado" mesmo com
          // o teste ainda válido. Só confere localmente se já venceu.
          const expiresAt = cached.expire_date ? new Date(cached.expire_date) : null;
          const stillValid = expiresAt && !isNaN(expiresAt.getTime()) && expiresAt.getTime() > Date.now();
          if (stillValid) {
            logSessionEvent('index-load', 'teste local ainda valido, indo pra /welcome');
            router.replace('/welcome');
            return;
          }
          await clearSession();
          await clearHomeCache();
        } else {
          logSessionEvent('index-load', 'checkMac (2a chamada, confirmando sessao salva): comecando');
          const fresh = await checkMac(m);
          logSessionEvent('index-load', 'checkMac (2a chamada): terminou');
          if (!mountedRef.current) return;
          // Não basta "authorized: true" — o painel às vezes marca o MAC
          // como autorizado mesmo sem nenhuma lista cadastrada de verdade
          // (bug do lado deles). Confirma que existe pelo menos uma
          // playlist que dá pra usar antes de liberar a entrada.
          const hasUsablePlaylist = (fresh.playlists || []).some((p) => !!parsePlaylistUrl(p.url));
          if (fresh.authorized && hasUsablePlaylist) {
            await saveSession(fresh);
            logSessionEvent('index-load', 'autorizado, indo pra /welcome');
            router.replace('/welcome');
            return;
          }
          // Não está mais autorizado (ou não tem lista nenhuma que
          // funcione) — limpa a sessão velha e segue pro fluxo normal de
          // verificação abaixo.
          await clearSession();
          await clearHomeCache();
          setStatus(fresh);
        }
      }

      // Chegou até aqui: ou nunca teve sessão, ou a sessão expirou/foi
      // bloqueada agora — é a hora certa de mostrar a tela de login.
      logSessionEvent('index-load', 'mostrando tela de login (sem sessao valida)');
      setCheckingSession(false);
      runPoll(m);
    })();
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [router, runPoll]);

  const onCopy = async () => {
    if (!mac) return;
    await Clipboard.setStringAsync(mac);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const onCheckNow = async () => {
    if (!mac || checking) return;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    await runPoll(mac);
    // Restart auto-polling after manual check
    if (mountedRef.current && !status?.authorized) {
      pollRef.current = setTimeout(() => runPoll(mac), POLL_MS);
    }
  };

  const onOpenWhatsapp = () => {
    // Mesma fonte que a tela de Configurações usa (Suporte/Revendedor) —
    // whatsapp_url já vem pronto do painel, com número certo. Só cai pro
    // reseller_whatsapp (só dígitos) se aquele campo não vier preenchido.
    if (status?.whatsapp_url) {
      Linking.openURL(status.whatsapp_url).catch(() => {});
      return;
    }
    const raw = status?.reseller_whatsapp || '';
    const digits = raw.replace(/\D/g, '');
    // Sem número cadastrado no painel, abre o WhatsApp mesmo assim (sem
    // destinatário) em vez de não fazer nada — o botão nunca fica "morto".
    Linking.openURL(digits ? `https://wa.me/${digits}` : 'https://wa.me/');
  };

  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');

  // Botão "Teste" agora pede nome (e WhatsApp, opcional) ANTES de gerar o
  // teste de verdade — sem isso, o cadastro de clientes só tinha o MAC
  // (um código sem sentido nenhum), sem jeito de saber quem é a pessoa de
  // verdade quando chegar a hora de cobrar.
  const onTestRegister = () => {
    if (!mac || testing) return;
    setNameInput('');
    setPhoneInput('');
    setShowNamePrompt(true);
  };

  const doTestRegister = async () => {
    setShowNamePrompt(false);
    if (!mac || testing) return;

    // Trava o poll automático AGORA, antes de qualquer coisa — ver o
    // comentário em runPoll pra entender por quê. Também cancela um poll
    // que porventura já estivesse agendado.
    testFlowActiveRef.current = true;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }

    // MAC já cadastrado no painel do revendedor? Sempre pode testar de
    // novo. MAC desconhecido? Só uma vez, pra não virar gerador de teste
    // infinito só de reabrir o app.
    if (!status?.registered) {
      const alreadyUsed = await hasUsedTest(mac);
      if (alreadyUsed) {
        Alert.alert(
          'Teste já utilizado',
          'Esse dispositivo já usou o teste gratuito. Fale com seu revendedor pra liberar o acesso completo.'
        );
        testFlowActiveRef.current = false;
        pollRef.current = setTimeout(() => runPoll(mac), POLL_MS);
        return;
      }
    }

    setTesting(true);
    const result = await registerTestDevice(mac);
    setTesting(false);
    if (!mountedRef.current) return;

    if (!result.ok) {
      Alert.alert(
        'Não foi possível gerar o teste',
        'Tente novamente em instantes ou fale com seu revendedor.'
      );
      // Teste falhou — libera o poll automático de volta, já que a
      // pessoa continua nessa tela.
      testFlowActiveRef.current = false;
      pollRef.current = setTimeout(() => runPoll(mac), POLL_MS);
      return;
    }

    // Grava no cadastro de clientes (nosso backend) — silencioso, nunca
    // atrapalha o fluxo da pessoa testando, mesmo que essa chamada falhe.
    registerCustomer({
      mac,
      name: nameInput.trim() || undefined,
      phone: phoneInput.trim() || undefined,
      rawResponse: result.raw,
    });

    // O gerador de teste (chatbot) cria um acesso IPTV próprio, num
    // servidor separado do painel principal (que só sabe de MACs já
    // cadastrados manualmente por um revendedor) — então esperar o painel
    // "reconhecer" isso não funciona. Em vez disso, usamos o usuário/senha
    // que o teste devolveu pra entrar direto no app com essa conta,
    // igual a um login normal.
    try {
      const parsed = JSON.parse(result.raw);
      const dns: string = parsed.dns || '';
      const username: string = parsed.username || '';
      const password: string = parsed.password || '';
      if (!dns || !username || !password) throw new Error('missing_fields');

      const dnsTrimmed = dns.trim().replace(/\/+$/, '');
      // O campo "dns" que o gerador de teste devolve às vezes vem sem
      // "http://" na frente (só "servidor.com:8080") — nesse caso a URL
      // final ficava inválida e nenhuma chamada (sinopse, EPG, stream)
      // funcionava, mesmo com usuário/senha corretos. Sempre garante um
      // esquema explícito antes de montar a URL da playlist.
      const server = /^https?:\/\//i.test(dnsTrimmed) ? dnsTrimmed : `http://${dnsTrimmed}`;
      const playlistUrl = `${server}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=mpegts`;

      // O servidor do teste às vezes leva um tempo bom (mais de 1 minuto,
      // confirmado na prática) pra terminar de provisionar a conta
      // recém-criada — se a gente entrar antes disso, player_api.php ainda
      // responde vazio/erro pra tudo (sinopse, EPG, o próprio stream),
      // mesmo com usuário/senha corretos. Por isso "aquecemos" aqui: tenta
      // autenticar repetidamente antes de navegar, pra só entrar quando o
      // servidor já está respondendo de verdade. A janela é generosa de
      // propósito (~75s) porque colar a mesma lista manualmente no painel
      // — que sabidamente funciona — já leva mais tempo que isso só pelo
      // processo manual (abrir painel, colar, salvar, voltar pro app).
      const testCreds: XtreamCreds = { server, username, password };
      const MAX_WARMUP_TRIES = 25;
      const WARMUP_INTERVAL_MS = 3000;
      let warmed = false;
      for (let attempt = 1; attempt <= MAX_WARMUP_TRIES; attempt++) {
        if (!mountedRef.current) return;
        const elapsedSec = Math.round(((attempt - 1) * WARMUP_INTERVAL_MS) / 1000);
        setTestStage(
          elapsedSec < 20
            ? 'Preparando seu teste...'
            : elapsedSec < 45
            ? 'Ainda preparando, quase lá...'
            : 'O servidor está demorando, aguarde mais um pouco...'
        );
        const auth = await xtream.authenticate(testCreds);
        if (auth?.user_info) {
          warmed = true;
          break;
        }
        if (attempt < MAX_WARMUP_TRIES) {
          await new Promise((resolve) => setTimeout(resolve, WARMUP_INTERVAL_MS));
        }
      }
      if (!mountedRef.current) return;
      setTestStage(null);
      if (!warmed) {
        // Não trava o usuário pra sempre — se depois de ~75s o servidor
        // ainda não respondeu, deixa entrar mesmo assim (pode ser lentidão
        // pontual), mas avisa que pode ser preciso tentar de novo.
        Alert.alert(
          'O servidor de teste está demorando',
          'Vamos entrar mesmo assim, mas se os filmes/canais não carregarem, toque em TESTE de novo em instantes.'
        );
      }

      const testStatus: MacStatus = {
        authorized: true,
        registered: true,
        mac,
        status: 'Teste',
        // IMPORTANTE: prioriza expiresAt (formato "AAAA-MM-DD HH:mm:ss"),
        // não expiresAtFormatted ("DD/MM/AAAA...") — o JS interpreta datas
        // com barra como MM/DD/AAAA (padrão americano), então "02/08"
        // virava fevereiro em vez de agosto, e o teste expirava na hora
        // errada sem ninguém perceber.
        expire_date: parsed.expiresAt || null,
        playlists: [{ name: 'Teste', url: playlistUrl, type: 'm3u_plus' }],
        app_name: 'Maximus Player',
      };

      // Limpa qualquer coisa guardada de uma tentativa anterior (outra
      // conta, outro teste, o MAC cadastrado sem lista) antes de entrar —
      // sem isso, o app podia misturar capas/dados antigos com o stream
      // de credenciais novas, e nada tocava direito.
      await clearHomeCache();
      await clearListCache(['channels', 'movies', 'series']);
      if (!status?.registered) {
        await markTestUsed(mac);
      }
      await saveSession(testStatus);
      router.replace('/welcome');
    } catch {
      setTestStage(null);
      // Resposta do teste veio num formato inesperado — não trava o
      // cliente numa tela de erro técnico, só avisa e deixa tentar de novo.
      Alert.alert(
        'Teste gerado, mas não consegui entrar automaticamente',
        'Fale com seu revendedor passando o ID do dispositivo acima.'
      );
      testFlowActiveRef.current = false;
      if (mountedRef.current) pollRef.current = setTimeout(() => runPoll(mac), POLL_MS);
    }
  };

  const bg = status?.bg_url;
  const logo = status?.logo_url;
  const banner = status?.banner_url;
  const appName = status?.app_name;
  useEffect(() => {
    setBgFailed(false);
  }, [bg]);

  // Registrado no painel mas sem acesso (bloqueado pelo revendedor, lista
  // removida, etc.) — diferente de "nunca vi esse MAC", que é o estado
  // normal de quem ainda não pediu acesso. Só nesse caso (bloqueado) que
  // faz sentido mostrar a Tela de Bloqueio personalizada, se o revendedor
  // tiver preenchido ela no painel.
  const isBlocked =
    !!status?.registered &&
    (!status.authorized || !(status.playlists || []).some((p) => !!parsePlaylistUrl(p.url)));
  const showLockScreen = isBlocked && !!extras.lockTitle && !!extras.lockMessage;

  // Concise summary of the last response for on-screen debug.
  const debugLine = (() => {
    if (!lastCheck) return 'Aguardando primeira verificação...';
    const time = lastCheck.toLocaleTimeString();
    if (!status) return `${time} • sem resposta`;
    if (status.message === 'Falha de conexão.') {
      return `${time} • FALHA DE REDE (verifique internet/CORS)`;
    }
    if (isBlocked) {
      return `${time} • registrado mas sem playlist`;
    }
    if (status.registered) {
      return `${time} • registered=SIM, status=${status.status || '—'}`;
    }
    return `${time} • device NÃO encontrado no painel`;
  })();

  if (checkingSession) {
    // Tela em branco/carregando só por um instante, enquanto confirma se
    // já existe uma sessão válida — sem isso, a tela de "Como entrar"
    // aparecia rapidinho toda vez, mesmo pra quem já estava logado.
    return (
      <View style={[styles.bg, styles.center]} testID="mac-login-checking-session">
        <ActivityIndicator color={colors.accentCyan} size="large" />
      </View>
    );
  }

  if (showLockScreen) {
    return (
      <ImageBackground
        source={bg && !bgFailed ? { uri: bg } : require('@/assets/images/default-bg.png')}
        onError={() => setBgFailed(true)}
        style={styles.bg}
        imageStyle={{ opacity: bg && !bgFailed ? 0.2 : 0.75 }}
      >
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.lockWrap} testID="mac-lock-screen">
            <View style={styles.lockIconCircle}>
              <Ionicons name="lock-closed" size={30} color={colors.danger} />
            </View>
            <Text style={styles.lockTitle}>{extras.lockTitle}</Text>
            <Text style={styles.lockMessage}>{extras.lockMessage}</Text>

            {!!extras.lockButtonText && !!extras.lockButtonUrl && (
              <TVFocusable
                onPress={() => Linking.openURL(extras.lockButtonUrl!).catch(() => {})}
                style={styles.lockBtn}
                testID="mac-lock-btn"
              >
                <Text style={styles.lockBtnText}>{extras.lockButtonText}</Text>
              </TVFocusable>
            )}

            <Text style={styles.lockMacLabel}>ID DO DISPOSITIVO (MAC)</Text>
            <Pressable onPress={onCopy} hitSlop={12} testID="mac-lock-value-copy">
              <Text style={styles.lockMacValue}>{mac}</Text>
            </Pressable>

            <TVFocusable onPress={onCheckNow} style={styles.lockRetryBtn} testID="mac-lock-retry">
              <Ionicons name="refresh" size={16} color={colors.accentCyan} />
              <Text style={styles.lockRetryText}>VERIFICAR NOVAMENTE</Text>
            </TVFocusable>
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground
      source={bg && !bgFailed ? { uri: bg } : require('@/assets/images/default-bg.png')}
      onError={() => setBgFailed(true)}
      style={styles.bg}
      imageStyle={{ opacity: bg && !bgFailed ? 0.25 : 0.75 }}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.logoWrap}>
          {banner ? (
            <Image source={{ uri: banner }} style={styles.banner} contentFit="contain" testID="app-banner" />
          ) : logo ? (
            <Image source={{ uri: logo }} style={styles.logoImg} contentFit="contain" />
          ) : (
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logoImg}
              contentFit="contain"
              testID="app-logo"
            />
          )}
        </View>

        <Text style={styles.title} testID="mac-login-title">Como entrar</Text>
        {!!extras.impactPhrase && (
          <Text style={styles.impactPhrase} testID="mac-impact-phrase">
            {extras.impactPhrase}
          </Text>
        )}

        <View style={styles.centerBlock}>
          <Text style={styles.label}>ID DO DISPOSITIVO (MAC)</Text>
          <Pressable onPress={onCopy} hitSlop={12} testID="mac-value-copy">
            <Text style={styles.macValue} numberOfLines={1}>
              {mac || '— — : — — : — — : — — : — — : — —'}
            </Text>
          </Pressable>
          <Text style={styles.tap}>{copied ? 'Copiado!' : 'Toque para copiar'}</Text>

          {!!testStage && (
            <View style={styles.testStageBox} testID="mac-test-stage">
              <ActivityIndicator color={colors.accentCyan} size="small" />
              <Text style={styles.testStageText}>{testStage}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.md, alignItems: 'center' }}>
            <TVFocusable
              onPress={onTestRegister}
              disabled={testing || !!testStage}
              style={[styles.testBtn, isTV && styles.testBtnTV, (testing || testStage) && { opacity: 0.5 }]}
              testID="mac-test-register"
            >
              {testing || testStage ? (
                <ActivityIndicator color={colors.black} size="small" />
              ) : (
                <Ionicons name="flash" size={isTV ? 20 : 14} color={colors.black} />
              )}
              <Text style={[styles.testBtnText, isTV && styles.btnTextTV]}>
                {testStage ? 'PREPARANDO...' : 'TESTE'}
              </Text>
            </TVFocusable>

            <TVFocusable
              onPress={onOpenWhatsapp}
              style={[styles.whatsBtn, isTV && styles.whatsBtnTV]}
              testID="mac-whatsapp-btn"
            >
              <Ionicons name="logo-whatsapp" size={isTV ? 20 : 14} color={colors.white} />
              <Text style={[styles.whatsBtnText, isTV && styles.btnTextTV]}>ZAP</Text>
            </TVFocusable>
          </View>

          <View style={styles.statusBox} testID="mac-status-box">
            {checking ? (
              <ActivityIndicator color={colors.accentCyan} size="small" />
            ) : (
              <Ionicons name="time-outline" size={16} color={colors.accentCyan} />
            )}
            <Text style={styles.statusText}>
              {checking ? 'VERIFICANDO...' : 'AGUARDANDO ATIVACAO...'}
            </Text>
          </View>

          <Text style={styles.debugText} testID="mac-debug-line">
            {debugLine}
          </Text>
          <Text style={styles.debugSmall}>
            Tentativas: {pollCount}
          </Text>

          <TVFocusable
            onPress={onCheckNow}
            disabled={checking}
            style={[styles.checkBtn, isTV && styles.checkBtnTV, checking && { opacity: 0.5 }]}
            testID="mac-check-now"
          >
            <Ionicons name="refresh" size={isTV ? 20 : 14} color={colors.accentCyan} />
            <Text style={[styles.checkBtnText, isTV && styles.btnTextTV]}>VERIFICAR AGORA</Text>
          </TVFocusable>

          <Text style={styles.hint}>
            Envie o ID acima para seu revendedor.{'\n'}
            Assim que ativado, o acesso abre automaticamente.
          </Text>
          {!!extras.contactInfo && (
            <Text style={styles.hint} testID="mac-contact-info">
              {extras.contactInfo}
            </Text>
          )}
        </View>

        <TVFocusable
          onPress={() => router.push('/diagnostic')}
          style={styles.diagBtn}
          hitSlop={12}
          testID="mac-login-diagnostic"
        >
          <Ionicons name="pulse" size={12} color={colors.textMuted} />
          <Text style={styles.diagText}>Diagnosticar backend</Text>
        </TVFocusable>

        <Text style={styles.footer}>{appName || 'Maximus Player'}</Text>
        <Pressable
          onPress={() => Alert.alert('O que mudou nesse build', BUILD_STAMP)}
          hitSlop={10}
          testID="mac-build-stamp"
        >
          <Text style={styles.buildStamp}>{BUILD_SHORT} (toque pra ver o que mudou)</Text>
        </Pressable>
      </SafeAreaView>

      <Modal visible={showNamePrompt} transparent animationType="fade" onRequestClose={() => setShowNamePrompt(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Antes de testar</Text>
            <Text style={styles.modalSubtitle}>
              Como podemos te chamar? Ajuda o revendedor a saber quem é você quando for liberar o acesso completo.
            </Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Seu nome"
              placeholderTextColor={colors.textMuted}
              style={styles.modalInput}
              autoFocus
              testID="test-prompt-name"
            />
            <TextInput
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="WhatsApp (opcional)"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              style={styles.modalInput}
              testID="test-prompt-phone"
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                onPress={() => setShowNamePrompt(false)}
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                testID="test-prompt-cancel"
              >
                <Text style={styles.modalBtnSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={doTestRegister}
                disabled={!nameInput.trim()}
                style={[styles.modalBtn, styles.modalBtnPrimary, !nameInput.trim() && { opacity: 0.5 }]}
                testID="test-prompt-confirm"
              >
                <Text style={styles.modalBtnPrimaryText}>Gerar teste</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.black },
  center: { alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, paddingHorizontal: spacing.xl },
  logoWrap: { alignItems: 'center', marginTop: spacing.xl + spacing.sm },
  banner: {
    width: '72%',
    maxWidth: 320,
    aspectRatio: 1,
    marginTop: spacing.md,
    borderRadius: 12,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: 96, height: 72 },
  title: {
    color: colors.white,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  impactPhrase: {
    color: colors.accentCyan,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  lockWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  lockIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(240,153,123,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  lockTitle: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  lockMessage: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  lockBtn: {
    backgroundColor: colors.accentCyan,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginBottom: spacing.xl,
  },
  lockBtnText: { color: colors.black, fontWeight: '800', letterSpacing: 1, fontSize: 14 },
  lockMacLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  lockMacValue: { color: colors.textSecondary, fontSize: 15, fontWeight: '700', marginBottom: spacing.lg },
  lockRetryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  lockRetryText: { color: colors.accentCyan, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  centerBlock: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
  },
  macValue: {
    color: colors.accentCyan,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  tap: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
  testStageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  testStageText: { color: colors.accentCyan, fontSize: 12, fontWeight: '700' },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  testBtnText: {
    color: colors.black,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  testBtnTV: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 26,
  },
  btnTextTV: {
    fontSize: 16,
  },
  whatsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#25D366',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  whatsBtnText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  whatsBtnTV: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 26,
  },
  statusBox: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.darkSurface,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  statusText: {
    color: colors.accentCyan,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  debugText: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  debugSmall: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  checkBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  checkBtnText: {
    color: colors.accentCyan,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  checkBtnTV: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 26,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.lg,
  },
  resellerBox: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 20,
  },
  resellerText: { color: colors.accentCyan, fontSize: 13, fontWeight: '700' },
  diagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 4,
  },
  diagText: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1,
    textDecorationLine: 'underline',
  },
  footer: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  buildStamp: {
    color: colors.textMuted,
    fontSize: 9,
    textAlign: 'center',
    marginBottom: spacing.md,
    opacity: 0.6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.darkSurface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: 10,
  },
  modalTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  modalSubtitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 4 },
  modalInput: {
    backgroundColor: colors.darkSurfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.white,
    fontSize: 15,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalBtnSecondary: { backgroundColor: colors.darkSurfaceAlt },
  modalBtnSecondaryText: { color: colors.textSecondary, fontWeight: '700' },
  modalBtnPrimary: { backgroundColor: colors.accentCyan },
  modalBtnPrimaryText: { color: colors.black, fontWeight: '800' },
});
