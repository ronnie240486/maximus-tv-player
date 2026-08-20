import * as Device from 'expo-device';
import { Platform } from 'react-native';

export type DevicePerfTier = 'low' | 'mid' | 'high';

// TV boxes baratas costumam ter 1-2GB de RAM total (contra 4-8GB+ de um
// celular médio). `Device.totalMemory` é síncrono (não precisa de
// useEffect/useState), então isso pode ser calculado uma vez só, direto
// no module scope.
const LOW_RAM_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

// RAM alta não quer dizer processador rápido — é comum TV box vir com
// "bastante RAM" (número que ajuda a vender) só que com um chip antigo/
// fraco por baixo. Pra pegar esse caso, faz um teste rápido e real de
// velocidade de CPU na abertura do app: roda uma quantidade fixa de
// contas (sem I/O) e mede quanto tempo levou.
//
// IMPORTANTE — isto é um PONTO DE PARTIDA, não uma base calibrada: eu
// (Claude) não tenho acesso a nenhuma TV box física pra testar e ajustar
// esses números com dados reais. Por isso o sistema é em NÍVEIS (não um
// corte único fraco/normal) — um limiar um pouco errado empurra o
// aparelho pro nível vizinho, não faz ele pular de um extremo pro outro.
// A forma certa de calibrar de verdade é rodar esse benchmark em vários
// aparelhos reais (ver Diagnóstico > Logs de depuração) e ajustar os
// números abaixo com base no que aparecer.
const CPU_BENCHMARK_ITERATIONS = 3_000_000;
// CALIBRADO COM DADOS REAIS (não mais chute):
// - Celular topo de linha (Android 16, 11GB RAM): 265ms no benchmark
// - TV box genuinamente fraca (TORRESTEK, Android 7.1.2, 3.9GB RAM): 3076ms
// A diferença relativa entre os dois (quase 12x) é um sinal real, mesmo
// sabendo que os números absolutos são inflados (o benchmark roda cedo
// demais, antes do motor JS esquentar — ver comentário mais abaixo).
// Ponto de corte escolhido no meio do caminho: bem acima do celular
// rápido, bem abaixo da TV box fraca confirmada.
const CPU_FAST_MAX_MS = 400;
const CPU_SLOW_MIN_MS = 1200;

function benchmarkCpuMs(): number {
  const start = Date.now();
  let x = 0;
  for (let i = 0; i < CPU_BENCHMARK_ITERATIONS; i++) {
    x += Math.sqrt(i) % 7;
  }
  // Só pra o resultado do loop não ser "otimizado embora" por engano por
  // algum motor JS mais agressivo — nunca chega a logar de verdade.
  if (x === -1) console.log(x);
  return Date.now() - start;
}

// Alguns TV box ainda são 32-bit (armeabi-v7a) — geralmente sinal de
// chip mais antigo/mais fraco.
function is32BitOnly(): boolean {
  try {
    const archs = Device.supportedCpuArchitectures || [];
    return archs.length > 0 && !archs.some((a) => a.includes('64'));
  } catch {
    return false;
  }
}

export const cpuBenchmarkMs = Platform.OS === 'web' ? 0 : benchmarkCpuMs();

const TIER_ORDER: DevicePerfTier[] = ['low', 'mid', 'high'];
function degradeTier(tier: DevicePerfTier): DevicePerfTier {
  const idx = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, idx - 1)];
}

const devicePerfTier: DevicePerfTier = (() => {
  try {
    // O benchmark de CPU roda cedo demais (antes do motor JS "esquentar",
    // competindo com o resto do app carregando) — os números absolutos
    // são inflados mesmo em aparelhos rápidos (celular topo de linha deu
    // 265ms). MAS a diferença RELATIVA entre aparelhos continua sendo um
    // sinal real: a mesma TV box fraca que dá 3076ms nesse teste também é
    // a que trava de verdade navegando no app — por isso volta a entrar
    // na conta, só que com limiares recalibrados nos dois pontos de
    // dados reais que já temos (ver comentário nas constantes acima).
    let tier: DevicePerfTier =
      cpuBenchmarkMs <= CPU_FAST_MAX_MS ? 'high' : cpuBenchmarkMs >= CPU_SLOW_MIN_MS ? 'low' : 'mid';

    const mem = Device.totalMemory;
    const weakByRam = typeof mem === 'number' && mem > 0 && mem < LOW_RAM_THRESHOLD_BYTES;
    if (weakByRam) tier = degradeTier(tier);

    if (is32BitOnly()) tier = degradeTier(tier);

    return tier;
  } catch {
    return 'high';
  }
})();

/** Nível de desempenho do aparelho — 'low' (fraco), 'mid' (intermediário)
 * ou 'high' (normal/forte). Prefira isso a `useIsLowEndDevice` quando o
 * ajuste puder ser gradual em vez de tudo-ou-nada. */
export function useDevicePerfTier(): DevicePerfTier {
  return devicePerfTier;
}

/**
 * true só no nível MAIS fraco ('low') — usado pelas otimizações mais
 * agressivas (desligar prefetch em segundo plano por completo), que só
 * fazem sentido no pior caso. Aparelhos 'mid' continuam recebendo ajuste
 * (via getListPerfProps/getFlashListPerfProps), só não o mais extremo.
 */
export function useIsLowEndDevice(): boolean {
  return devicePerfTier === 'low';
}

/** Detalhes crus da detecção — usado na tela de Diagnóstico pra mostrar
 * os números reais do aparelho, e permitir calibrar os limiares certos
 * com dados de TV box de verdade (sem isso, teria que adivinhar às
 * cegas, sem poder testar no aparelho da pessoa). */
export function getDeviceCapabilityInfo() {
  return {
    devicePerfTier,
    totalMemoryBytes: Device.totalMemory,
    cpuBenchmarkMs,
    cpuFastMaxMs: CPU_FAST_MAX_MS,
    cpuSlowMinMs: CPU_SLOW_MIN_MS,
    is32BitOnly: is32BitOnly(),
    supportedCpuArchitectures: Device.supportedCpuArchitectures,
    modelName: Device.modelName,
    osVersion: Device.osVersion,
  };
}

/**
 * Ajusta os parâmetros de virtualização de uma FlatList conforme o nível
 * do aparelho — menos itens de cada vez em aparelho fraco, um meio-termo
 * em intermediário, mantém o padrão em aparelho forte. Usado pelas listas
 * que continuam em FlatList (ex: a linha de seções da Home). Para Movies/
 * Series/Channels, que usam FlashList, ver getFlashListPerfProps abaixo.
 */
export function getListPerfProps(baseInitialNumToRender: number) {
  if (devicePerfTier === 'low') {
    return {
      initialNumToRender: Math.max(6, Math.round(baseInitialNumToRender / 2)),
      maxToRenderPerBatch: Math.max(6, Math.round(baseInitialNumToRender / 2)),
      windowSize: 4,
    };
  }
  if (devicePerfTier === 'mid') {
    return {
      initialNumToRender: Math.max(8, Math.round(baseInitialNumToRender * 0.75)),
      maxToRenderPerBatch: Math.max(8, Math.round(baseInitialNumToRender * 0.75)),
      windowSize: 5,
    };
  }
  return {
    initialNumToRender: baseInitialNumToRender,
    maxToRenderPerBatch: baseInitialNumToRender,
    windowSize: 7,
  };
}

/**
 * Equivalente a getListPerfProps, mas pro FlashList (que não usa
 * initialNumToRender/maxToRenderPerBatch/windowSize do FlatList — o
 * parâmetro que controla quanto ele renderiza além da área visível é o
 * drawDistance). Valor menor = menos itens montados de uma vez = menos
 * CPU/memória gasta; maior = rolagem mais "generosa" mas mais pesada.
 * `undefined` deixa o FlashList usar o próprio padrão.
 */
export function getFlashListPerfProps() {
  if (devicePerfTier === 'low') return { drawDistance: 120 };
  if (devicePerfTier === 'mid') return { drawDistance: 200 };
  return {};
}
