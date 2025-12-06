export interface LinesFilters {
  sport?: string;
  state?: string;
  marketType?: string;
  live?: string;
  event?: string;
  search?: string;
}

export interface LineData {
  id: string;
  marketId: string;
  sportsbookId: string;
  outcomeId: string;
  priceFormat: string;
  priceValue: string;
  isLive: boolean;
  stateAvailability: string[];
  sourceLatencyMs?: number;
  timestamp: string;
  sportsbook: {
    id: string;
    name: string;
    logoUrl?: string;
  };
  market: {
    id: string;
    marketType: string;
    outcomes: Array<{ id: string; label: string }>;
    event: {
      id: string;
      startTime: string;
      status: string;
      sport: {
        id: string;
        name: string;
        code: string;
      };
      league: {
        id: string;
        name: string;
        region?: string;
      };
      homeTeam?: {
        id: string;
        name: string;
        shortName?: string;
      };
      awayTeam?: {
        id: string;
        name: string;
        shortName?: string;
      };
    };
  };
}
