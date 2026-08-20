// Liga/desliga o áudio de boas-vindas tocado na tela de entrada, depois
// que o dispositivo é autorizado. Padrão: ativado.

import { storage } from '@/src/utils/storage';

const KEY = 'settings_welcome_audio_enabled_v1';

export async function isWelcomeAudioEnabled(): Promise<boolean> {
  const v = await storage.getItem<boolean>(KEY, true);
  return v !== false;
}

export async function setWelcomeAudioEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(KEY, enabled);
}
