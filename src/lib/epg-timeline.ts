import { XtreamEpgListing } from '@/src/lib/xtream';

export function parseEpgDate(raw: string): number {
  if (/^\d{9,11}$/.test(raw)) return Number(raw) * 1000;
  const t = Date.parse(raw.replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}

export function formatMsTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Alguns paineis mandam o campo "end" bugado (menor que o "start" — como o
// horario mostrando "13:40 - 11:35"). Em vez de confiar cegamente nesse
// campo, ordenamos por inicio e calculamos o fim de cada programa como o
// inicio do PROXIMO — o mesmo truque que qualquer app de EPG usa quando a
// duracao fornecida nao bate. So usamos o "end" original se ele realmente
// vier depois do inicio.
export type EpgWithEnd = XtreamEpgListing & { effectiveEnd: number; startMs: number };

export function buildEpgTimeline(raw: XtreamEpgListing[]): EpgWithEnd[] {
  const sorted = [...raw].sort((a, b) => parseEpgDate(a.start) - parseEpgDate(b.start));
  return sorted.map((item, idx) => {
    const startMs = parseEpgDate(item.start);
    const rawEnd = parseEpgDate(item.end);
    const nextStart = idx < sorted.length - 1 ? parseEpgDate(sorted[idx + 1].start) : 0;
    const effectiveEnd =
      rawEnd > startMs ? rawEnd : nextStart > startMs ? nextStart : startMs + 60 * 60 * 1000;
    return { ...item, startMs, effectiveEnd };
  });
}
