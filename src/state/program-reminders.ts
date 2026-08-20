// Lembretes de programação de TV — quando o horário chega, avisamos e
// oferecemos ir direto pro canal (diferente dos jogos, aqui SABEMOS o canal,
// então o "ir assistir" é uma ação de verdade, não só uma sugestão).
//
// Agenda notificação REAL do sistema (expo-notifications) — funciona com
// o app fechado/tela bloqueada, não só quando a pessoa está com o app
// aberto. Mesmo mecanismo já usado/testado nos lembretes de jogo.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';
import { getActiveProfileId } from '@/src/state/active-profile';

const KEY_PREFIX = 'program_reminders_v1_';
const CHANNEL_ID = 'program-reminders';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {}

let channelReady = false;
async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') {
    channelReady = true;
    return;
  }
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Lembretes de programação',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  channelReady = true;
}

let permissionAsked = false;
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionAsked) return false;
  permissionAsked = true;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

export type ProgramReminder = {
  id: string; // `${channelId}-${epgItemId}`
  title: string;
  channelId: number;
  channelName: string;
  channelCover?: string;
  startsAt: number; // epoch ms
  notified: boolean;
  notificationId?: string;
};

const cache: Record<string, ProgramReminder[]> = {};

function storageKey(): string {
  return KEY_PREFIX + getActiveProfileId();
}

async function persist(list: ProgramReminder[]): Promise<void> {
  cache[getActiveProfileId()] = list;
  await storage.setItem(storageKey(), JSON.stringify(list));
}

export async function loadProgramReminders(): Promise<ProgramReminder[]> {
  const profileId = getActiveProfileId();
  if (cache[profileId]) return cache[profileId];
  const raw = await storage.getItem<string>(storageKey(), '');
  if (!raw) {
    cache[profileId] = [];
    return cache[profileId];
  }
  try {
    cache[profileId] = JSON.parse(raw) as ProgramReminder[];
  } catch {
    cache[profileId] = [];
  }
  return cache[profileId];
}

export async function isProgramScheduled(id: string): Promise<boolean> {
  const list = await loadProgramReminders();
  return list.some((r) => r.id === id);
}

export async function toggleProgramReminder(item: Omit<ProgramReminder, 'notified' | 'notificationId'>): Promise<boolean> {
  const list = await loadProgramReminders();
  const existing = list.find((r) => r.id === item.id);

  if (existing) {
    if (existing.notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
      } catch {}
    }
    await persist(list.filter((r) => r.id !== item.id));
    return false;
  }

  let notificationId: string | undefined;
  if (item.startsAt > Date.now()) {
    try {
      const granted = await ensurePermission();
      if (granted) {
        await ensureChannel();
        notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Começando agora 📺',
            body: `${item.title} — ${item.channelName}`,
            data: { channelId: item.channelId },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: item.startsAt,
            channelId: CHANNEL_ID,
          },
        });
      }
    } catch {}
  }

  await persist([...list, { ...item, notified: false, notificationId }]);
  return true;
}

/** Lembretes cujo horário já chegou (últimas 3h, pra não reaparecer de dias atrás). */
export async function popDueProgramReminders(): Promise<ProgramReminder[]> {
  const list = await loadProgramReminders();
  const now = Date.now();
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const due = list.filter((r) => !r.notified && r.startsAt <= now && now - r.startsAt < THREE_HOURS);
  if (due.length) {
    const updated = list.map((r) => (due.some((d) => d.id === r.id) ? { ...r, notified: true } : r));
    await persist(updated);
  }
  return due;
}
