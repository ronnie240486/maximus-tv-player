// Some Xtream panels list the exact same channel/movie/series multiple
// times (literal duplicate rows). Keep only the first occurrence of each
// name so lists don't show 3-4 copies of the same thing back to back.
export function dedupeByName<T extends { name: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
