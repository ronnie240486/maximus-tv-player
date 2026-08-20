import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, ScrollView, Modal, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import TVFocusable from '@/src/components/TVFocusable';
import { getXtream } from '@/src/state/session';
import { xtream } from '@/src/lib/xtream';
import { logSessionEventFast } from '@/src/state/debug-log';

// Esportes que a TheSportsDB (usada em "Jogos do dia") não cobre bem no
// tier gratuito, e por isso não têm um canal pra casar/assistir dentro do
// app — aqui é só placar/horário, sem botão de assistir. A ESPN é pública
// e não pede chave (https://site.api.espn.com), mas é uma API "escondida"
// (não-oficial): pode mudar sem aviso. Vôlei continua vindo da TheSportsDB
// mesmo (a ESPN não tem boa cobertura de vôlei), só que também sem canal.
const SPORTSDB_KEY = '123';

type SportDef = {
  key: string;
  label: string;
  source: 'espn' | 'sportsdb';
  espnPath?: string; // "{sport}/{league}" na URL da ESPN
  sportsdbSport?: string;
};

const SPORTS: SportDef[] = [
  { key: 'futebol', label: 'Futebol (Brasileirão)', source: 'espn', espnPath: 'soccer/bra.1' },
  { key: 'baseball', label: 'Beisebol', source: 'espn', espnPath: 'baseball/mlb' },
  { key: 'tennis', label: 'Tênis', source: 'espn', espnPath: 'tennis/atp' },
  { key: 'nfl', label: 'Futebol Americano', source: 'espn', espnPath: 'football/nfl' },
  { key: 'volleyball', label: 'Vôlei', source: 'sportsdb', sportsdbSport: 'Volleyball' },
  { key: 'mma', label: 'MMA', source: 'espn', espnPath: 'mma/ufc' },
  { key: 'basketball', label: 'Basquete (NBA)', source: 'espn', espnPath: 'basketball/nba' },
  { key: 'wnba', label: 'Basquete (WNBA)', source: 'espn', espnPath: 'basketball/wnba' },
  { key: 'hockey', label: 'Hóquei no Gelo', source: 'espn', espnPath: 'hockey/nhl' },
  { key: 'golf', label: 'Golfe', source: 'espn', espnPath: 'golf/pga' },
  { key: 'f1', label: 'Fórmula 1', source: 'espn', espnPath: 'racing/f1' },
  // Nascar: encontrei fontes conflitantes sobre qual caminho da ESPN
  // funciona pra esse — mantido "nascar-premier" por ter pelo menos uma
  // confirmação real de funcionamento, mas pode não ser 100% confiável.
  // Os outros (hóquei, MMA, tênis, golfe) frequentemente aparecem vazios
  // porque são fora de temporada, ou só têm jogo em dias específicos —
  // não é bug, é a realidade do calendário esportivo.
  { key: 'nascar', label: 'Nascar', source: 'espn', espnPath: 'racing/nascar-premier' },
  { key: 'indycar', label: 'IndyCar', source: 'espn', espnPath: 'racing/irl' },
];
const DAYS_AHEAD = 4;

// Pra cada esporte daqui de cima, que palavra procurar nas categorias de
// canais AO VIVO do painel — se achar, mostra um botão "Assistir ao vivo"
// que leva direto pra essa categoria em Canais. Não tenta adivinhar QUAL
// canal exato passa QUAL jogo específico (isso seria arriscado e
// poderia levar pro canal errado) — só confirma que existe uma categoria
// de canais daquele esporte no painel da pessoa, e deixa ela escolher lá
// dentro.
const SPORT_CHANNEL_KEYWORDS: Record<string, string[]> = {
  futebol: ['futebol', 'esportes', 'sportv', 'premiere', 'campeonato brasileiro', 'brasileirao'],
  baseball: ['beisebol', 'baseball', 'mlb'],
  tennis: ['tenis', 'tênis', 'tennis', 'atp', 'wta'],
  nfl: ['nfl', 'futebol americano'],
  volleyball: ['volei', 'vôlei', 'volleyball'],
  mma: ['mma', 'ufc', 'luta', 'boxe', 'boxing'],
  basketball: ['nba', 'basquete', 'basketball'],
  wnba: ['wnba'],
  hockey: ['nhl', 'hoquei', 'hóquei', 'hockey'],
  golf: ['golfe', 'golf'],
  f1: ['f1', 'formula 1', 'formula1'],
  nascar: ['nascar'],
  indycar: ['indycar', 'indy car'],
};

type ScoreEvent = {
  id: string;
  home: string;
  away: string;
  homeScore: string | null;
  awayScore: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  time: string | null; // "HH:mm"
  date: string; // "YYYY-MM-DD"
  status: string | null;
  broadcast?: string | null;
};

// Tabela de classificação — só disponível pra futebol por enquanto (a
// ESPN devolve isso num endpoint DIFERENTE do resto: "/apis/v2/" em vez
// de "/apis/site/v2/" — só descobri isso testando, o padrão normal
// devolve vazio pra futebol especificamente).
type StandingRow = {
  position: number;
  teamName: string;
  teamLogo?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalDiff: number;
};

async function fetchStandings(espnPath: string): Promise<StandingRow[]> {
  const parse = (json: any): any[] => json?.standings?.entries || json?.children?.[0]?.standings?.entries || [];
  const build = (entries: any[]): StandingRow[] => {
    const getStat = (stats: any[], name: string) => stats?.find((s: any) => s.name === name || s.type === name)?.value ?? 0;
    return entries.map((e: any, idx: number) => ({
      position: getStat(e.stats, 'rank') || idx + 1,
      teamName: e.team?.displayName || e.team?.name || '—',
      teamLogo: e.team?.logos?.[0]?.href,
      played: getStat(e.stats, 'gamesPlayed'),
      wins: getStat(e.stats, 'wins'),
      draws: getStat(e.stats, 'ties') || getStat(e.stats, 'draws'),
      losses: getStat(e.stats, 'losses'),
      points: getStat(e.stats, 'points'),
      goalDiff: getStat(e.stats, 'pointDifferential') || getStat(e.stats, 'goalDifferential'),
    }));
  };

  try {
    const year = new Date().getFullYear();
    // Alguns relatos indicam que sem "season=" esse endpoint pode voltar
    // vazio — tenta com o ano atual primeiro, cai pra sem o parâmetro se
    // não trouxer nada.
    const res1 = await fetch(`https://site.api.espn.com/apis/v2/sports/${espnPath}/standings?season=${year}`);
    const json1 = res1.ok ? await res1.json() : null;
    const entries1 = json1 ? parse(json1) : [];
    if (entries1.length > 0) return build(entries1);

    const res2 = await fetch(`https://site.api.espn.com/apis/v2/sports/${espnPath}/standings`);
    const json2 = res2.ok ? await res2.json() : null;
    const entries2 = json2 ? parse(json2) : [];
    if (entries2.length > 0) return build(entries2);

    logSessionEventFast('standings', `vazio pra ${espnPath} (com e sem season=${year})`);
    return [];
  } catch (e: any) {
    logSessionEventFast('standings', `erro pra ${espnPath}: ${e?.message || e}`);
    return [];
  }
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(dateStr: string): string {
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  if (dateStr === today) return 'HOJE';
  if (dateStr === tomorrow) return 'AMANHÃ';
  if (dateStr === yesterday) return 'ONTEM';
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return `${weekday.toUpperCase()} ${d.getDate()}/${d.getMonth() + 1}`;
}

function normalizeEspnEvent(raw: any): ScoreEvent | null {
  const comp = raw?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
  const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
  const iso = raw.date as string | undefined;
  const d = iso ? new Date(iso) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const broadcastNames: string[] = (comp.broadcasts || []).flatMap((b: any) => b.names || []);
  // Antes só mostrava o placar se `comp.status.type.state !== 'pre'` — mas
  // isso escondia o placar de jogo JÁ TERMINADO em alguns esportes (ex:
  // futebol mostrava tudo sem número, mesmo com jogo acabado, mas
  // beisebol funcionava certo). Não achei o motivo exato da diferença
  // entre esportes sem poder testar ao vivo — mais seguro simplificar:
  // mostra o número sempre que a ESPN mandar ele (mesmo que seja "0"),
  // só fica em branco quando o campo realmente não vier preenchido.
  const homeScoreRaw = home?.score;
  const awayScoreRaw = away?.score;
  return {
    id: `espn-${raw.id}`,
    home: home?.team?.displayName || home?.athlete?.displayName || '—',
    away: away?.team?.displayName || away?.athlete?.displayName || '—',
    homeScore: homeScoreRaw !== undefined && homeScoreRaw !== null && homeScoreRaw !== '' ? homeScoreRaw : null,
    awayScore: awayScoreRaw !== undefined && awayScoreRaw !== null && awayScoreRaw !== '' ? awayScoreRaw : null,
    // Times (esportes coletivos) já vêm com o escudo pronto — esportes
    // individuais (tênis, golfe, MMA, corrida) não têm "team", só
    // "athlete", que não tem escudo, então fica null e a tela usa um
    // ícone genérico no lugar.
    homeLogo: home?.team?.logo || null,
    awayLogo: away?.team?.logo || null,
    time: d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : null,
    date: d ? isoDate(d) : isoDate(new Date()),
    status: comp.status?.type?.description ?? null,
    broadcast: broadcastNames.length ? broadcastNames.join(', ') : null,
  };
}

function normalizeSportsDbEvent(raw: any): ScoreEvent {
  return {
    id: String(raw.idEvent),
    home: raw.strHomeTeam || '—',
    away: raw.strAwayTeam || '—',
    homeScore: raw.intHomeScore ?? null,
    awayScore: raw.intAwayScore ?? null,
    time: raw.strTime ? raw.strTime.slice(0, 5) : null,
    date: raw.dateEvent,
    status: raw.strStatus || null,
  };
}

export default function PlacarScreen() {
  const router = useRouter();
  const [sport, setSport] = useState<string>('futebol');
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Categoria de canal AO VIVO do painel que bate com cada esporte (se
  // existir) — usado só pro botão "Assistir ao vivo" aparecer quando faz
  // sentido, nunca pra tentar casar um jogo específico com um canal.
  const [sportChannelCategory, setSportChannelCategory] = useState<Record<string, string>>({});
  const [showStandings, setShowStandings] = useState(false);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);

  useEffect(() => {
    const creds = getXtream();
    if (!creds) return;
    xtream.liveCategories(creds).then((cats) => {
      if (!cats) return;
      const found: Record<string, string> = {};
      for (const [sportKey, keywords] of Object.entries(SPORT_CHANNEL_KEYWORDS)) {
        const match = cats.find((c) => {
          const n = c.category_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return keywords.some((kw) => n.includes(kw));
        });
        if (match) found[sportKey] = match.category_name;
      }
      setSportChannelCategory(found);
    });
  }, []);

  const fetchDay = useCallback(async (def: SportDef, date: string): Promise<ScoreEvent[]> => {
    try {
      if (def.source === 'espn') {
        const yyyymmdd = date.replace(/-/g, '');
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${def.espnPath}/scoreboard?dates=${yyyymmdd}`);
        if (!res.ok) return [];
        const json = await res.json();
        const raw: any[] = json?.events || [];
        return raw.map(normalizeEspnEvent).filter((e): e is ScoreEvent => !!e);
      } else {
        const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsday.php?d=${date}&s=${encodeURIComponent(def.sportsdbSport!)}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const json = await res.json();
        const raw: any[] = json?.events || [];
        return raw.map((e) => normalizeSportsDbEvent({ ...e, dateEvent: e.dateEvent || date }));
      }
    } catch {
      return [];
    }
  }, []);

  const load = useCallback(
    async (s: string) => {
      setLoading(true);
      setError(null);
      const def = SPORTS.find((sp) => sp.key === s);
      if (!def) {
        setEvents([]);
        setLoading(false);
        return;
      }
      // Antes só buscava HOJE em diante — jogo de ontem (ou antes), já
      // com resultado final, nunca nem era buscado, mesmo que a pessoa
      // quisesse muito ver quem ganhou. Agora inclui 2 dias pra trás
      // também, mantendo hoje como a primeira busca (mais rápida de
      // aparecer).
      const dates = [
        isoDate(new Date(Date.now() - 2 * 86400000)),
        isoDate(new Date(Date.now() - 86400000)),
        isoDate(new Date()),
        isoDate(new Date(Date.now() + 86400000)),
        isoDate(new Date(Date.now() + 2 * 86400000)),
      ];
      const todayIdx = 2;

      try {
        // HOJE primeiro, sozinho — uma chamada de rede só, mostra
        // resultado rápido. Os outros dias carregam depois, em segundo
        // plano, sem travar a abertura da tela.
        const todayEvents = await fetchDay(def, dates[todayIdx]);
        setEvents(todayEvents);
        setLoading(false);

        const otherDates = dates.filter((_, i) => i !== todayIdx);
        const restResults = await Promise.all(otherDates.map((date) => fetchDay(def, date)));
        setEvents((prev) => [...prev, ...restResults.flat()]);
      } catch {
        setEvents([]);
        setError('Não foi possível carregar os placares agora.');
    }
    setLoading(false);
  }, [fetchDay]);

  useEffect(() => {
    load(sport);
  }, [sport, load]);

  const grouped = useMemo(() => {
    const byDate: Record<string, ScoreEvent[]> = {};
    for (const e of events) {
      const key = e.date || 'sem-data';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(e);
    }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TVFocusable onPress={() => router.back()} hitSlop={16} style={styles.backBtn} testID="placar-back">
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </TVFocusable>
        <Text style={styles.headerTitle}>Placar</Text>
        <View style={styles.headerBtnRow}>
          {sport === 'futebol' && (
            <TVFocusable
              onPress={() => {
                setShowStandings(true);
                if (standings.length === 0 && !standingsLoading) {
                  setStandingsLoading(true);
                  fetchStandings(SPORTS.find((s) => s.key === sport)!.espnPath!).then((rows) => {
                    setStandings(rows);
                    setStandingsLoading(false);
                  });
                }
              }}
              style={styles.tableBtn}
              testID="placar-standings"
            >
              <Ionicons name="list" size={16} color={colors.white} />
            </TVFocusable>
          )}
          {sportChannelCategory[sport] ? (
            <TVFocusable
              onPress={() =>
                router.push({ pathname: '/channels', params: { initialCategory: sportChannelCategory[sport] } })
              }
              style={styles.watchBtn}
              testID="placar-watch-live"
            >
              <Ionicons name="play-circle" size={16} color={colors.black} />
              <Text style={styles.watchBtnText}>Assistir</Text>
            </TVFocusable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>
      </View>

      <Modal visible={showStandings} transparent animationType="fade" onRequestClose={() => setShowStandings(false)}>
        <Pressable style={styles.standingsBackdrop} onPress={() => setShowStandings(false)}>
          <Pressable style={styles.standingsPanel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.standingsTitle}>Tabela — Brasileirão</Text>
            {standingsLoading ? (
              <ActivityIndicator color={colors.accentCyan} style={{ marginVertical: 20 }} />
            ) : standings.length === 0 ? (
              <Text style={styles.standingsEmpty}>Não consegui carregar a tabela agora. Tenta de novo mais tarde.</Text>
            ) : (
              <ScrollView>
                <View style={styles.standingsHeaderRow}>
                  <Text style={[styles.standingsHeaderCell, { width: 24 }]}>#</Text>
                  <Text style={[styles.standingsHeaderCell, { flex: 1 }]}>Time</Text>
                  <Text style={styles.standingsHeaderCell}>P</Text>
                  <Text style={styles.standingsHeaderCell}>J</Text>
                  <Text style={styles.standingsHeaderCell}>SG</Text>
                </View>
                {standings.map((row) => (
                  <View key={row.teamName} style={styles.standingsRow}>
                    <Text style={[styles.standingsCell, { width: 24, color: colors.textMuted }]}>{row.position}</Text>
                    {!!row.teamLogo && <Image source={{ uri: row.teamLogo }} style={styles.standingsLogo} contentFit="contain" />}
                    <Text style={[styles.standingsCell, { flex: 1 }]} numberOfLines={1}>{row.teamName}</Text>
                    <Text style={[styles.standingsCell, styles.standingsPoints]}>{row.points}</Text>
                    <Text style={styles.standingsCell}>{row.played}</Text>
                    <Text style={styles.standingsCell}>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <TVFocusable onPress={() => setShowStandings(false)} style={styles.standingsCloseBtn} testID="placar-standings-close">
              <Text style={styles.standingsCloseBtnText}>Fechar</Text>
            </TVFocusable>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.chipRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
          {SPORTS.map((s) => {
            const active = s.key === sport;
            return (
              <TVFocusable
                key={s.key}
                onPress={() => setSport(s.key)}
                style={[styles.chip, active && styles.chipActive]}
                testID={`placar-chip-${s.key}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
              </TVFocusable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accentCyan} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            Nenhum jogo encontrado nos próximos dias. Pode ser que esse esporte esteja fora de temporada agora.
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([date]) => date}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          renderItem={({ item: [date, dayEvents] }) => (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.dayLabel}>{dayLabel(date)}</Text>
              {dayEvents.map((e) => {
                const started = e.homeScore != null || e.awayScore != null;
                return (
                  <View key={e.id} style={styles.card}>
                    <View style={styles.teamsCol}>
                      <View style={styles.teamRow}>
                        {e.homeLogo ? (
                          <Image source={{ uri: e.homeLogo }} style={styles.teamLogo} contentFit="contain" />
                        ) : (
                          <View style={styles.teamLogoFallback}>
                            <Ionicons name="person" size={12} color={colors.textMuted} />
                          </View>
                        )}
                        <Text style={styles.teamName} numberOfLines={1}>{e.home}</Text>
                      </View>
                      <View style={styles.teamRow}>
                        {e.awayLogo ? (
                          <Image source={{ uri: e.awayLogo }} style={styles.teamLogo} contentFit="contain" />
                        ) : (
                          <View style={styles.teamLogoFallback}>
                            <Ionicons name="person" size={12} color={colors.textMuted} />
                          </View>
                        )}
                        <Text style={styles.teamName} numberOfLines={1}>{e.away}</Text>
                      </View>
                    </View>
                    <View style={styles.scoreCol}>
                      {started ? (
                        <>
                          <Text style={styles.scoreText}>{e.homeScore ?? '-'}</Text>
                          <Text style={styles.scoreText}>{e.awayScore ?? '-'}</Text>
                        </>
                      ) : (
                        <Text style={styles.timeText}>{e.time || '--:--'}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: '800' },
  headerBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tableBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.darkSurface,
  },
  standingsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  standingsPanel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    backgroundColor: colors.darkSurface,
    borderRadius: 14,
    padding: spacing.md,
  },
  standingsTitle: { color: colors.white, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  standingsEmpty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  standingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkSurfaceAlt,
    marginBottom: 4,
  },
  standingsHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700', width: 28, textAlign: 'center' },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  standingsCell: { color: colors.white, fontSize: 13, width: 28, textAlign: 'center' },
  standingsPoints: { fontWeight: '800', color: colors.accentCyan },
  standingsLogo: { width: 18, height: 18 },
  standingsCloseBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accentCyan,
    alignItems: 'center',
  },
  standingsCloseBtnText: { color: colors.black, fontWeight: '800' },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  watchBtnText: { color: colors.black, fontSize: 12, fontWeight: '800' },
  chipRow: { paddingBottom: spacing.sm },
  chipRowInner: { paddingHorizontal: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.darkSurface,
  },
  chipActive: { backgroundColor: colors.accentCyan },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyText: { color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' },
  dayLabel: { color: colors.accentCyan, fontSize: 12, fontWeight: '800', marginBottom: spacing.sm, letterSpacing: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.darkSurface,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  teamsCol: { flex: 1, gap: 6 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamLogo: { width: 22, height: 22 },
  teamLogoFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.darkSurfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: { color: colors.white, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  scoreCol: { alignItems: 'flex-end', gap: 4 },
  scoreText: { color: colors.accentCyan, fontSize: 16, fontWeight: '800' },
  timeText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
});
