import React, { useState } from 'react';
import { StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { colors } from '@/src/theme';
import TVFocusable from '@/src/components/TVFocusable';
import { detectVoiceGenre, detectSimilarToRequest } from '@/src/lib/genre-detect';

// Isolado da Home de propósito — importar 'expo-speech-recognition' no
// topo do home.tsx fazia esse módulo (que registra listeners nativos de
// reconhecimento de fala) ser avaliado toda vez que o app abre, mesmo
// pra quem nunca usa busca por voz. A Home carrega este componente com
// React.lazy (ver home.tsx), o que adia essa avaliação pra depois da
// Home já ter pintado a tela — cold start mais rápido pra maioria das
// aberturas do app.
export default function VoiceSearchButton() {
  const router = useRouter();
  const [listening, setListening] = useState(false);

  // Comando de voz: "Space HD", "De volta para o futuro" etc. — reconhece
  // a fala e manda pra tela de busca já com o termo preenchido, que abre
  // direto o primeiro resultado quando a origem é voz (ver search.tsx).
  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;
    const transcript = event.results[0]?.transcript?.trim();
    setListening(false);
    if (!transcript) return;

    // "Me dê uma série parecida com Tulsa King" — pedido por
    // SIMILARIDADE a um título de referência, diferente de pedir um
    // gênero solto. Checa isso ANTES do gênero, porque uma frase desse
    // tipo poderia acidentalmente conter uma palavra de gênero também.
    const similarTitle = detectSimilarToRequest(transcript);
    if (similarTitle) {
      router.push({
        pathname: '/recommend',
        params: { similarTo: similarTitle, query: transcript },
      });
      return;
    }

    // "Quero assistir um filme de ação" — reconhece o gênero pedido e
    // manda pra tela de sugestões (mistura filmes+séries daquele gênero),
    // em vez de tratar como busca de título literal.
    const genre = detectVoiceGenre(transcript);
    if (genre) {
      router.push({ pathname: '/recommend', params: { genre, query: transcript } });
      return;
    }
    router.push({ pathname: '/search', params: { q: transcript, voice: '1' } });
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      Alert.alert('Não entendi', 'Tente falar de novo, mais perto do microfone.');
    }
  });

  const startVoiceSearch = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', 'Ative o microfone nas permissões do app pra usar o comando de voz.');
      return;
    }
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'pt-BR',
      interimResults: false,
      continuous: false,
    });
  };

  return (
    <TVFocusable
      onPress={startVoiceSearch}
      style={[styles.micBtn, listening && styles.micBtnActive]}
      testID="nav-voice-search"
      hitSlop={10}
    >
      <Ionicons name={listening ? 'mic' : 'mic-outline'} size={18} color={listening ? colors.black : colors.accentCyan} />
    </TVFocusable>
  );
}

const styles = StyleSheet.create({
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.darkSurfaceAlt,
    borderWidth: 1,
    borderColor: colors.accentCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: colors.accentCyan,
  },
});
