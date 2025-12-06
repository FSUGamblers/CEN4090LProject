import type { LineData, LinesFilters } from "@/types/lines";

export interface CachedLines {
  lines: LineData[];
  lastFetched?: string;
  filters?: LinesFilters;
}

export const LINES_CACHE_KEY = "linesCache";
export const LAST_LINES_QUERY_KEY = ["last-lines-cache"] as const;

function filtersMatch(a?: LinesFilters, b?: LinesFilters) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.sport === b.sport &&
    a.state === b.state &&
    a.marketType === b.marketType &&
    a.live === b.live &&
    a.event === b.event &&
    a.search === b.search
  );
}

export function readCachedLines(currentFilters?: LinesFilters): CachedLines | null {
  if (typeof window === "undefined") return null;

  const cachedValue = localStorage.getItem(LINES_CACHE_KEY);
  if (!cachedValue) return null;

  try {
    const parsed = JSON.parse(cachedValue) as CachedLines;
    if (!parsed?.lines) return null;

    if (currentFilters && !filtersMatch(parsed.filters, currentFilters)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error("Failed to parse cached lines", error);
    return null;
  }
}

export function persistCachedLines(cache: CachedLines) {
  if (typeof window === "undefined") return;

  localStorage.setItem(LINES_CACHE_KEY, JSON.stringify(cache));
}
