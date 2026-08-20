import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

type SharedPlayer = ReturnType<typeof useVideoPlayer>;
type PlayerMode = 'idle' | 'mini' | 'full';
type PlaybackKind = 'live' | 'vod';
type MiniRect = { left: number; top: number; width: number; height: number };

type PlayerSessionValue = {
  player: SharedPlayer;
  mode: PlayerMode;
  source: string | null;
  kind: PlaybackKind | null;
  miniRect: MiniRect | null;
  videoViewRef: React.RefObject<React.ElementRef<typeof VideoView> | null>;
  reportMiniRect: (rect: MiniRect | null) => void;
  setSource: (uri: string | null, autoplay?: boolean, kind?: PlaybackKind) => Promise<void>;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  pause: () => void;
  stop: () => void;
};

const PlayerSessionContext = createContext<PlayerSessionValue | null>(null);

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1',
};

export function PlayerSessionProvider({ children }: { children: React.ReactNode }) {
  const player = useVideoPlayer('', (p) => {
    p.loop = false;
    p.muted = false;
    // Perfil estável para canais ao vivo em TV Box: mantém uma janela de
    // 30s para absorver oscilações curtas, mas não deixa o player acumular
    // buffer indefinidamente. A prioridade é tempo disponível, não o limite
    // de bytes, porque streams LIVE podem variar muito de bitrate.
    p.bufferOptions = {
      preferredForwardBufferDuration: 30,
      minBufferForPlayback: 2.5,
      prioritizeTimeOverSizeThreshold: true,
    };
  });
  const [mode, setMode] = useState<PlayerMode>('idle');
  const [source, setSourceState] = useState<string | null>(null);
  const [kind, setKindState] = useState<PlaybackKind | null>(null);
  const [miniRect, setMiniRect] = useState<MiniRect | null>(null);
  const videoViewRef = useRef<React.ElementRef<typeof VideoView> | null>(null);
  const sourceRef = useRef<string | null>(null);
  const kindRef = useRef<PlaybackKind | null>(null);
  const requestRef = useRef(0);

  const setSource = useCallback(
    async (uri: string | null, autoplay = true, nextKind: PlaybackKind = 'live') => {
      const request = ++requestRef.current;
      if (!uri) {
        sourceRef.current = null;
        kindRef.current = null;
        setSourceState(null);
        setKindState(null);
        try {
          player.pause();
          await player.replaceAsync('');
        } catch {}
        return;
      }

      // VOD e LIVE não podem compartilhar buffer, posição ou callbacks.
      // Ao trocar de filme/série para canal, limpa a fonte anterior antes
      // de preparar a nova. Dentro do mesmo tipo e mesma URI, não recarrega.
      const kindChanged = kindRef.current !== null && kindRef.current !== nextKind;
      if (kindChanged) {
        sourceRef.current = null;
        setSourceState(null);
        try {
          player.pause();
          await player.replaceAsync('');
        } catch {}
        if (request !== requestRef.current) return;
      }

      setMode((previous) => (previous === 'full' ? previous : 'mini'));
      if (sourceRef.current === uri && kindRef.current === nextKind) {
        setSourceState(uri);
        if (autoplay && request === requestRef.current) {
          try {
            player.play();
          } catch {}
        }
        return;
      }

      sourceRef.current = uri;
      kindRef.current = nextKind;
      setSourceState(uri);
      setKindState(nextKind);
      try {
        const contentType = /\.m3u8(?:\?|$)/i.test(uri)
          ? 'hls'
          : /\.ts(?:\?|$)/i.test(uri)
            ? 'progressive'
            : 'auto';
        await player.replaceAsync({ uri, headers: VIDEO_HEADERS, contentType });
        if (request !== requestRef.current) return;
        if (autoplay) player.play();
      } catch (error) {
        if (request === requestRef.current) throw error;
      }
    },
    [player]
  );

  const reportMiniRect = useCallback((rect: MiniRect | null) => setMiniRect(rect), []);
  const enterFullscreen = useCallback(() => setMode('full'), []);
  const exitFullscreen = useCallback(() => setMode(sourceRef.current ? 'mini' : 'idle'), []);
  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {}
  }, [player]);
  const stop = useCallback(() => {
    try {
      player.pause();
      player.replaceAsync('');
    } catch {}
    sourceRef.current = null;
    kindRef.current = null;
    setSourceState(null);
    setKindState(null);
    setMode('idle');
  }, [player]);

  const value = useMemo(
    () => ({ player, mode, source, kind, miniRect, videoViewRef, reportMiniRect, setSource, enterFullscreen, exitFullscreen, pause, stop }),
    [player, mode, source, kind, miniRect, videoViewRef, reportMiniRect, setSource, enterFullscreen, exitFullscreen, pause, stop]
  );

  const surfaceStyle = !source
    ? styles.hiddenSurface
    : mode === 'full'
      ? styles.fullSurface
      : miniRect
        ? [styles.miniSurface, miniRect]
        : styles.hiddenSurface;

  return (
    <PlayerSessionContext.Provider value={value}>
      <View style={styles.hostRoot}>
        <View pointerEvents="none" style={surfaceStyle}>
          <VideoView
            ref={videoViewRef}
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </PlayerSessionContext.Provider>
  );

}

const styles = StyleSheet.create({
  hostRoot: { flex: 1, backgroundColor: '#0B0F1A' },
  content: { flex: 1, zIndex: 1 },
  fullSurface: { ...StyleSheet.absoluteFillObject, zIndex: 0, backgroundColor: '#000000' },
  miniSurface: { position: 'absolute', zIndex: 0, backgroundColor: '#000000', overflow: 'hidden' },
  hiddenSurface: { position: 'absolute', width: 1, height: 1, opacity: 0, zIndex: 0 },
});

export function usePlayerSession() {
  const value = useContext(PlayerSessionContext);
  if (!value) throw new Error('usePlayerSession must be used inside PlayerSessionProvider');
  return value;
}
