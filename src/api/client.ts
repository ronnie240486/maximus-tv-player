// InteractivePlayer / OuroPro backend client.
//
// The IPTV panel (`renciaapp.manus.space`) blocks cross-origin *browser*
// requests (no CORS headers) — that's a browser-only restriction, so on
// native (Expo Go / the built APK) we call it directly. Only the web preview
// needs to go through our own FastAPI `/api/iptv-proxy`, and only if that
// backend happens to be deployed and reachable; native never depends on it.

import { Platform } from 'react-native';
import { decodeB64 } from '@/src/lib/obfuscate';

const PROXY_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/iptv-proxy`;

// Ofuscados em base64 — ver src/lib/obfuscate.ts pra entender o porquê e
// os limites disso. Valores decodificados:
//   PANEL_BASE:    https://renciaapp.manus.space/api/v5
//   PANEL_BASE_V4: https://renciaapp.manus.space/api/v4
const PANEL_BASE = decodeB64('aHR0cHM6Ly9yZW5jaWFhcHAubWFudXMuc3BhY2UvYXBpL3Y1');
const PANEL_BASE_V4 = decodeB64('aHR0cHM6Ly9yZW5jaWFhcHAubWFudXMuc3BhY2UvYXBpL3Y0');

const commonHeaders: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  // Some panels behave differently (or block) requests that don't look like
  // they came from a phone. Send this on native directly since we no longer
  // rely on the backend proxy to add it for us.
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) ExoPlayerLib/2.19.1',
};

function routeUrl(url: string): string {
  if (Platform.OS === 'web') {
    return `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** Wraps an upstream IPTV URL through the FastAPI proxy (web only — see routeUrl). */
export function proxied(url: string): string {
  return routeUrl(url);
}

async function safeJson<T>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type Playlist = {
  name: string;
  url: string;
  type?: string;
};

export type MacStatus = {
  authorized: boolean;
  registered: boolean;
  mac: string;
  status?: string;
  expire_date?: string | null;
  playlists?: Playlist[];
  logo_url?: string;
  bg_url?: string;
  banner_url?: string;
  app_name?: string;
  whatsapp_url?: string;
  reseller_contact?: string;
  reseller_whatsapp?: string;
  version?: string;
  apk_link?: string;
  message?: string;
  server_name?: string;
  tipo?: string;
  raw?: Record<string, unknown>;
};

/**
 * Normalizes any of the response shapes the panel emits to a single
 * `MacStatus`. Fields observed so far (mobile UA):
 *   found, status, allowed, mac_registered, mac, nomeServer, tipo, app,
 *   urlM3u8, urlEpg, modoSelecao, dataExpiracao, dataCadastro
 * And the alternate (non-mobile) shape:
 *   success, registered, playlists[], logo_url, bg_url, app_name, ...
 */
function normalize(json: any, macFallback: string): MacStatus {
  if (!json || typeof json !== 'object') {
    return { authorized: false, registered: false, mac: macFallback };
  }

  const registered =
    json.mac_registered === true ||
    json.registered === true ||
    json.registered === 1 ||
    json.registered === '1' ||
    json.found === true;

  const allowed =
    json.allowed === true ||
    (json.success !== false && registered);

  // Playlists — support both `playlists[]` and single `urlM3u8`.
  let playlists: Playlist[] | undefined;
  if (Array.isArray(json.playlists) && json.playlists.length > 0) {
    playlists = json.playlists.map((p: any) => ({
      name: p.name || p.playlist_name || 'Playlist',
      url: p.url || p.playlist_url || '',
      type: p.type,
    })).filter((p: Playlist) => !!p.url);
  } else if (typeof json.urlM3u8 === 'string' && json.urlM3u8) {
    playlists = [{ name: json.nomeServer || 'Playlist', url: json.urlM3u8, type: 'm3u_plus' }];
  }

  return {
    authorized: !!(registered && allowed),
    registered: !!registered,
    mac: json.mac || macFallback,
    status: json.status,
    expire_date: json.dataExpiracao || json.expire_date || null,
    playlists,
    logo_url: json.logo_url,
    bg_url: json.bg_url,
    banner_url: json.banner_url,
    app_name: json.app_name || json.app,
    whatsapp_url: json.whatsapp_url,
    reseller_contact: json.reseller_contact,
    reseller_whatsapp: json.reseller_whatsapp,
    version: json.version,
    apk_link: json.apk_link,
    message: json.error || json.message || json.mensagem,
    server_name: json.nomeServer,
    tipo: json.tipo,
    raw: json,
  };
}

// Avisa o painel qual conteúdo está sendo assistido agora nesse MAC — é
// isso que faz a lista "Dispositivos Conectados" mostrar não só "online",
// mas também o nome do canal/conteúdo, igual o painel já mostra pra outros
// tipos de dispositivo. Chamado periodicamente enquanto algo está tocando
// (ver player.tsx); se falhar (sem internet, painel fora do ar etc.),
// simplesmente não atualiza dessa vez — nunca interrompe a reprodução.
export async function sendHeartbeat(mac: string, content: string): Promise<void> {
  try {
    await fetch(proxied(`${PANEL_BASE_V4}/heartbeat.php`), {
      method: 'POST',
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, content }),
    });
  } catch {
    // silencioso de propósito — isso é só telemetria pro painel, nunca
    // pode atrapalhar quem está assistindo.
  }
}

export async function checkMac(mac: string): Promise<MacStatus> {
  const upstream = `${PANEL_BASE}/check_mac.php?mac=${encodeURIComponent(mac)}`;
  try {
    const res = await fetch(proxied(upstream), { headers: commonHeaders });
    const json = await safeJson<any>(res);
    if (!json) return { authorized: false, registered: false, mac, message: 'Resposta inválida.' };
    return normalize(json, mac);
  } catch {
    return { authorized: false, registered: false, mac, message: 'Falha de conexão.' };
  }
}

// Endpoint dedicado do link/versão do APK — antes o app só torcia pra que
// check_mac.php mandasse "version"/"apk_link" junto (nem sempre manda), o
// que fazia o botão de atualização nunca aparecer. Usa /api/v4/update.php
// de verdade agora, chamado só quando a pessoa aperta o botão em
// Configurações (não em toda checagem de sessão).
export type ApkUpdate = { url?: string; version?: string };

export async function fetchApkUpdate(mac: string): Promise<ApkUpdate> {
  try {
    const res = await fetch(proxied(`${PANEL_BASE_V4}/update.php?mac=${encodeURIComponent(mac)}`), {
      headers: commonHeaders,
    });
    const json = await safeJson<any>(res);
    if (!json) return {};
    // Nomes de campo podem variar (link direto de APK, ou link da Play
    // Store) — aceita as variações mais comuns em vez de travar num nome
    // só.
    const url =
      json.apk_link || json.download_url || json.url || json.link || json.playstore_url || undefined;
    const versionRaw = json.version ?? json.apk_version ?? json.versao;
    const version = versionRaw != null ? String(versionRaw) : undefined;
    return {
      url: typeof url === 'string' && url.trim() ? url.trim() : undefined,
      version,
    };
  } catch {
    return {};
  }
}

export async function checkExpire(mac: string): Promise<{ expired: boolean; expire_date?: string | null }> {
  const upstream = `${PANEL_BASE}/check_expire.php?mac=${encodeURIComponent(mac)}`;
  try {
    const res = await fetch(proxied(upstream), { headers: commonHeaders });
    const json = await safeJson<any>(res);
    if (!json) return { expired: true };
    return { expired: !!json.expired, expire_date: json.expire_date };
  } catch {
    return { expired: true };
  }
}

export type TestRegisterResult = {
  ok: boolean;
  http?: number;
  url: string;
  raw: string;
};

// URL raiz do painel, sem o /api/v5 ou /api/v4 no final — usada só pra
// montar a chamada do /api/guim.php abaixo.
const PANEL_ROOT = decodeB64('aHR0cHM6Ly9yZW5jaWFhcHAubWFudXMuc3BhY2U=');

// URL de FALLBACK do gerador de teste (chatbot sigmab.pro) — só usada se
// a busca dinâmica abaixo (via /api/guim.php) falhar por qualquer motivo.
// Antes esse link era sempre fixo porque o campo "URL do Servidor (DNS)"
// do painel não chegava certo pro app — agora tem um endpoint dedicado
// (/api/guim.php?mac=...) que devolve isso certinho no campo
// "gpcpro_server_url", então a gente busca ele toda vez em vez de confiar
// só nesse valor fixo. Se o revendedor trocar essa URL no painel, o app
// já pega a nova sem precisar gerar um APK novo.
// Ofuscado em base64 (ver src/lib/obfuscate.ts) — decodificado:
//   https://nuvixtv.sigmab.pro/api/chatbot/Yen129WPEa/XYgD9JWr6V
const TEST_REGISTER_URL_FALLBACK = decodeB64(
  'aHR0cHM6Ly9udXZpeHR2LnNpZ21hYi5wcm8vYXBpL2NoYXRib3QvWWVuMTI5V1BFYS9YWWdEOUpXcjZW'
);

// Cache em memória do /api/guim.php inteiro — busca uma vez por sessão do
// app só, tanto a URL do gerador de teste quanto os campos extras abaixo
// (frase de impacto, website, e-mail do revendedor, aviso legal) usam essa
// mesma resposta em vez de disparar uma chamada de rede cada um.
let cachedGuim: Record<string, unknown> | null = null;

async function fetchGuim(mac: string): Promise<Record<string, unknown> | null> {
  if (cachedGuim) return cachedGuim;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${PANEL_ROOT}/api/guim.php?mac=${encodeURIComponent(mac)}`, {
      headers: commonHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') {
        cachedGuim = json;
        return json;
      }
    }
  } catch {
    // Sem internet nesse instante, endpoint fora do ar, resposta em
    // formato inesperado — quem chamou trata o retorno null.
  }
  return null;
}

async function getTestRegisterUrl(mac: string): Promise<string> {
  const guim = await fetchGuim(mac);
  const url = guim?.gpcpro_server_url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  return TEST_REGISTER_URL_FALLBACK;
}

export async function registerTestDevice(mac: string): Promise<TestRegisterResult> {
  const testRegisterUrl = await getTestRegisterUrl(mac);
  const upstream = `${testRegisterUrl}?mac=${encodeURIComponent(mac)}`;
  try {
    const res = await fetch(proxied(upstream), {
      method: 'POST',
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac }),
    });
    const text = await res.text();
    return { ok: res.ok, http: res.status, url: upstream, raw: text };
  } catch (e: any) {
    return { ok: false, url: upstream, raw: e?.message || String(e) };
  }
}

// Grava o cadastro de cliente no NOSSO backend (não no painel do
// revendedor) — nome + MAC + o que o teste devolveu, pra o dono do app
// conseguir ver quem testou e (depois) marcar como pago. Best-effort: se
// isso falhar (rede caiu, backend fora do ar), a pessoa que está testando
// não deve ser afetada de jeito nenhum — o teste dela já foi gerado
// normalmente antes dessa chamada, isso aqui é só registro.
export async function registerCustomer(input: {
  mac: string;
  name?: string;
  phone?: string;
  rawResponse?: string;
}): Promise<void> {
  try {
    await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/customers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mac: input.mac,
        name: input.name || null,
        phone: input.phone || null,
        raw_response: input.rawResponse || null,
      }),
    });
  } catch {
    // Silencioso de propósito — ver comentário acima.
  }
}

// Campos do painel que ainda não tinham lugar nenhum no app — buscados do
// mesmo /api/guim.php acima. Cada um só aparece se o revendedor de fato
// preencheu ele no painel (senão fica undefined, e a tela que usa isso
// simplesmente não mostra a linha/texto correspondente).
export type AppExtras = {
  websiteUrl?: string;
  impactPhrase?: string;
  contactInfo?: string;
  resellerEmail?: string;
  legalNotice?: string;
  lockTitle?: string;
  lockMessage?: string;
  lockButtonText?: string;
  lockButtonUrl?: string;
};

export async function fetchAppExtras(mac: string): Promise<AppExtras> {
  const guim = await fetchGuim(mac);
  if (!guim) return {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    websiteUrl: str(guim.gpcpro_contact_website),
    impactPhrase: str(guim.gpcpro_impact_phrase),
    contactInfo: str(guim.gpcpro_contact_info),
    resellerEmail: str(guim.gpcpro_reseller_email),
    legalNotice: str(guim.gpcpro_legal_notice),
    lockTitle: str(guim.gpcpro_lock_title),
    lockMessage: str(guim.gpcpro_lock_message),
    lockButtonText: str(guim.gpcpro_lock_button_text),
    lockButtonUrl: str(guim.gpcpro_lock_button_url),
  };
}
