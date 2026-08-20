// Game reminders for "Jogos do dia". We can't automatically know *which*
// channel airs a given match (the free sports API has no such mapping), so
// this stores a lightweight reminder (what + when). We also schedule a real
// device notification (expo-notifications) for the game's start time — this
// fires even with the app closed or the screen locked, unlike the old
// in-app-only check.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';
import { getActiveProfileId } from '@/src/state/active-profile';

const KEY_PREFIX = 'game_reminders_v1_';
const CHANNEL_ID = 'game-reminders';

// Como a notificação deve se comportar quando o app está ABERTO na hora
// que ela dispara (sem isso, o padrão do expo-notifications é não mostrar
// nada visualmente enquanto o app está em primeiro plano).
//
// Protegido com try/catch: essa chamada roda no escopo do MÓDULO (bem
// cedo, antes até da tela abrir de verdade) — se o módulo nativo do
// expo-notifications não estiver pronto nesse instante por qualquer
// motivo, sem o try/catch isso derrubava o app inteiro na abertura
// ("abre e fecha rápido"). Com isso, na pior hipótese só perde o
// comportamento de notificação com app aberto, mas o app continua de pé.
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
    name: 'Lembretes de jogo',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  channelReady = true;
}

let permissionAsked = false;
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // Só pede uma vez por sessão do app — se a pessoa negar, não fica
  // insistindo toda vez que tentar marcar outro lembrete.
  if (permissionAsked) return false;
  permissionAsked = true;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

export type GameReminder = {
  id: string; // idEvent from the sports API
  name: string; // "Time A vs Time B"
  league?: string;
  startsAt: number; // epoch ms
  notified: boolean;
  notificationId?: string; // id devolvido pelo agendamento, pra poder cancelar
  streamId?: number; // stream_id do canal do painel - usado pra abrir o
  // canal certo quando a pessoa tocar na notificação
};

const cache: Record<string, GameReminder[]> = {};

function storageKey(): string {
  return KEY_PREFIX + getActiveProfileId();
}

async function persist(list: GameReminder[]): Promise<void> {
  cache[getActiveProfileId()] = list;
  await storage.setItem(storageKey(), JSON.stringify(list));
}

export async function loadGameReminders(): Promise<GameReminder[]> {
  const profileId = getActiveProfileId();
  if (cache[profileId]) return cache[profileId];
  const raw = await storage.getItem<string>(storageKey(), '');
  if (!raw) {
    cache[profileId] = [];
    return cache[profileId];
  }
  try {
    cache[profileId] = JSON.parse(raw) as GameReminder[];
  } catch {
    cache[profileId] = [];
  }
  return cache[profileId];
}

export async function isGameScheduled(id: string): Promise<boolean> {
  const list = await loadGameReminders();
  return list.some((r) => r.id === id);
}

export async function toggleGameReminder(item: Omit<GameReminder, 'notified' | 'notificationId'>): Promise<boolean> {
  const list = await loadGameReminders();
  const existing = list.find((r) => r.id === item.id);

  if (existing) {
    // Desmarcando — cancela a notificação agendada (se tinha uma) e
    // remove da lista.
    if (existing.notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing.notificationId);
      } catch {}
    }
    await persist(list.filter((r) => r.id !== item.id));
    return false;
  }

  // Marcando — tenta agendar notificação real. Se a pessoa negar
  // permissão (ou o horário já passou), o lembrete ainda é salvo, só sem
  // notificationId — continua funcionando do jeito antigo (checagem
  // dentro do app), só perde o alerta com app fechado.
  let notificationId: string | undefined;
  if (item.startsAt > Date.now()) {
    try {
      const granted = await ensurePermission();
      if (granted) {
        await ensureChannel();
        notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Hora do jogo! 🏆',
            body: `${item.name} está começando agora.`,
            // streamId aqui é o que permite abrir o canal certo direto
            // quando a pessoa tocar na notificação (ver o listener em
            // _layout.tsx) — sem isso, tocar na notificação só abria o
            // app na tela de sempre, sem saber qual jogo era.
            data: { streamId: item.streamId },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: item.startsAt,
            channelId: CHANNEL_ID,
          },
        });
      }
    } catch {
      // Falha ao agendar (aparelho sem suporte, etc) — segue sem
      // notificationId, o lembrete continua salvo mesmo assim.
    }
  }

  await persist([...list, { ...item, notified: false, notificationId }]);
  return true;
}

/** Reminders whose start time has arrived (within the last 3h, so we don't
 * resurface something from days ago) and haven't been shown yet. Marks them
 * as notified as a side effect so they don't repeat every focus. This stays
 * as a backup for when the app happens to be open right at kickoff — the
 * real alert (app closed/locked) now comes from the scheduled notification
 * above. */
export async function popDueReminders(): Promise<GameReminder[]> {
  const list = await loadGameReminders();
  const now = Date.now();
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const due = list.filter((r) => !r.notified && r.startsAt <= now && now - r.startsAt < THREE_HOURS);
  if (due.length) {
    const updated = list.map((r) => (due.some((d) => d.id === r.id) ? { ...r, notified: true } : r));
    await persist(updated);
  }
  return due;
}
