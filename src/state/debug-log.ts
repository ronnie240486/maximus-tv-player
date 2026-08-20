// Logger de depuração temporário — só existe pra rastrear de vez o bug da
// sessão de teste sendo sobrescrita. Grava um histórico curto (últimas 40
// entradas) em storage, com hora + de onde veio + o que aconteceu. Dá pra
// ver isso na tela de Diagnóstico (botão "Ver logs de depuração").
import { storage } from '@/src/utils/storage';

const KEY = 'debug_session_log_v1';
const MAX_ENTRIES = 40;

function timeWithMs(): string {
  const d = new Date();
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export async function logSessionEvent(where: string, detail: string): Promise<void> {
  try {
    const raw = await storage.getItem<string>(KEY, '');
    const list: string[] = raw ? JSON.parse(raw) : [];
    list.push(`${timeWithMs()} [${where}] ${detail}`);
    while (list.length > MAX_ENTRIES) list.shift();
    await storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Log de depuração não pode nunca quebrar o app de verdade.
  }
}

// Versão "leve" pra eventos de ALTA FREQUÊNCIA (ex: cada troca de foco do
// D-pad) — a versão normal faz uma leitura+escrita completa no
// armazenamento a CADA chamada, o que seria pesado o bastante pra
// atrapalhar justamente o que está tentando medir (lag de navegação).
// Essa aqui só guarda em memória (rápido, síncrono) e manda tudo pro
// armazenamento de uma vez só depois de ficar 1.5s sem nenhum evento
// novo — assim não interfere na medição.
let fastBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function logSessionEventFast(where: string, detail: string): void {
  fastBuffer.push(`${timeWithMs()} [${where}] ${detail}`);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    try {
      const raw = await storage.getItem<string>(KEY, '');
      const list: string[] = raw ? JSON.parse(raw) : [];
      const merged = [...list, ...fastBuffer];
      while (merged.length > MAX_ENTRIES) merged.shift();
      await storage.setItem(KEY, JSON.stringify(merged));
      fastBuffer = [];
    } catch {}
  }, 1500);
}

export async function getSessionLog(): Promise<string[]> {
  try {
    const raw = await storage.getItem<string>(KEY, '');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearSessionLog(): Promise<void> {
  await storage.removeItem(KEY);
}
