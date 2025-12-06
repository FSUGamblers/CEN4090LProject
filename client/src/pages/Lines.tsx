import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { LAST_LINES_QUERY_KEY, persistCachedLines, readCachedLines } from "@/lib/linesCache";
import type { LineData, LinesFilters } from "@/types/lines";
import { Search, Filter, Activity, Clock, TrendingUp, Building2, MapPin } from "lucide-react";

export default function Lines() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<LinesFilters>({});

  useEffect(() => {
    const cached = readCachedLines(filters);
    if (!cached) return;

    queryClient.setQueryData(LAST_LINES_QUERY_KEY, cached);
  }, [filters, queryClient]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch lines data
  const { data: lines = [], isLoading, isFetching, error, refetch } = useQuery<LineData[]>({
    queryKey: ['/api/lines', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.sport) params.append('sport', filters.sport);
      if (filters.state) params.append('state', filters.state);
      if (filters.marketType) params.append('market_type', filters.marketType);
      if (filters.live) params.append('live', filters.live);
      if (filters.event) params.append('event', filters.event);

      const response = await fetch(`/api/lines?${params.toString()}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch lines');
      }
      return response.json();
    },
    initialData: () => readCachedLines(filters)?.lines,
    enabled: false,
    refetchOnWindowFocus: false,
    onSuccess: (data) => {
      const cachePayload = {
        lines: data,
        lastFetched: new Date().toISOString(),
        filters,
      };

      persistCachedLines(cachePayload);
      queryClient.setQueryData(LAST_LINES_QUERY_KEY, cachePayload);
    },
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Get unique values for filters
  const sports = Array.from(new Set(lines?.map(line => line.market.event.sport.code) || []));
  const states = Array.from(new Set(lines?.flatMap(line => line.stateAvailability || []) || []));
  const marketTypes = Array.from(new Set(lines?.map(line => line.market.marketType) || []));

  // Filter lines based on search
  const filteredLines = lines?.filter(line => {
    if (!filters.search) return true;
    const searchTerm = filters.search.toLowerCase();
    return (
      line.market.event.sport.name.toLowerCase().includes(searchTerm) ||
      line.market.event.league.name.toLowerCase().includes(searchTerm) ||
      line.market.event.homeTeam?.name.toLowerCase().includes(searchTerm) ||
      line.market.event.awayTeam?.name.toLowerCase().includes(searchTerm) ||
      line.sportsbook.name.toLowerCase().includes(searchTerm) ||
      line.market.marketType.toLowerCase().includes(searchTerm)
    );
  }) || [];

  // Calculate stats
  const totalLines = filteredLines.length;
  const liveLines = filteredLines.filter(line => line.isLive).length;
  const uniqueEvents = new Set(filteredLines.map(line => line.market.event.id)).size;
  const uniqueSportsbooks = new Set(filteredLines.map(line => line.sportsbook.id)).size;

  const formatPrice = (priceValue: string, priceFormat: string) => {
    const price = parseFloat(priceValue);
    if (priceFormat === 'american') {
      return price > 0 ? `+${price}` : `${price}`;
    } else if (priceFormat === 'decimal') {
      return price.toFixed(2);
    } else if (priceFormat === 'fractional') {
      // Convert decimal to fractional for display
      const decimal = price;
      const numerator = Math.round((decimal - 1) * 100);
      const denominator = 100;
      return `${numerator}/${denominator}`;
    }
    return priceValue;
  };

  const getOutcomeLabel = (line: LineData) => {
    const outcome = line.market.outcomes.find(o => o.id === line.outcomeId);
    return outcome?.label || line.outcomeId;
  };

  const formatEventDisplay = (line: LineData) => {
    const event = line.market.event;
    if (event.homeTeam && event.awayTeam) {
      return `${event.awayTeam.shortName || event.awayTeam.name} @ ${event.homeTeam.shortName || event.homeTeam.name}`;
    }
    return `Event ${event.id}`;
  };

  if (error) {
    toast({
      title: "Error Loading Lines",
      description: "Failed to load lines data. Please try again.",
      variant: "destructive",
    });
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lines & Odds</h1>
          <p className="text-sm text-muted-foreground">
            View all stored odds data across events and sportsbooks
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lines.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Last updated: {new Date(Math.max(...lines.map(line => new Date(line.timestamp).getTime()))).toLocaleTimeString()}
            </span>
          )}
          <Button onClick={handleRefresh} disabled={isFetching || isRefreshing} data-testid="button-scan-lines">
            {isFetching || isRefreshing ? 'Scanning…' : 'Scan Lines'}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Lines</p>
                <p className="text-2xl font-bold" data-testid="text-total-lines">{totalLines}</p>
              </div>
              <Activity className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Live Lines</p>
                <p className="text-2xl font-bold text-green-500" data-testid="text-live-lines">{liveLines}</p>
              </div>
              <Clock className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Events</p>
                <p className="text-2xl font-bold" data-testid="text-unique-events">{uniqueEvents}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sportsbooks</p>
                <p className="text-2xl font-bold" data-testid="text-unique-sportsbooks">{uniqueSportsbooks}</p>
              </div>
              <Building2 className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Filters */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search events, teams, sportsbooks..."
                value={filters.search || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                data-testid="input-search"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sport-filter">Sport</Label>
              <Select 
                value={filters.sport || 'all'} 
                onValueChange={(value) => setFilters(prev => ({ ...prev, sport: value === 'all' ? undefined : value }))}
              >
                <SelectTrigger id="sport-filter" data-testid="select-sport">
                  <SelectValue placeholder="All Sports" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sports</SelectItem>
                  {sports.map(sport => (
                    <SelectItem key={sport} value={sport}>{sport}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="state-filter">State</Label>
              <Select 
                value={filters.state || 'all'} 
                onValueChange={(value) => setFilters(prev => ({ ...prev, state: value === 'all' ? undefined : value }))}
              >
                <SelectTrigger id="state-filter" data-testid="select-state">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {states.map(state => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="market-filter">Market Type</Label>
              <Select 
                value={filters.marketType || 'all'} 
                onValueChange={(value) => setFilters(prev => ({ ...prev, marketType: value === 'all' ? undefined : value }))}
              >
                <SelectTrigger id="market-filter" data-testid="select-market-type">
                  <SelectValue placeholder="All Markets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Markets</SelectItem>
                  {marketTypes.map(market => (
                    <SelectItem key={market} value={market}>{market}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="live-filter">Live Status</Label>
              <Select 
                value={filters.live || 'all'} 
                onValueChange={(value) => setFilters(prev => ({ ...prev, live: value === 'all' ? undefined : value }))}
              >
                <SelectTrigger id="live-filter" data-testid="select-live">
                  <SelectValue placeholder="All Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lines</SelectItem>
                  <SelectItem value="1">Live Only</SelectItem>
                  <SelectItem value="0">Pre-Game Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              className="w-full" 
              onClick={() => setFilters({})}
              variant="outline"
              data-testid="button-clear-filters"
            >
              Clear Filters
            </Button>
          </CardContent>
        </Card>

        {/* Lines Table */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Lines Data</CardTitle>
                <Badge variant="secondary" data-testid="badge-lines-count">{filteredLines.length} Lines</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading || isFetching || isRefreshing ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredLines.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Sport/League</TableHead>
                        <TableHead>Market</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Sportsbook</TableHead>
                        <TableHead>Odds</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>States</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLines.slice(0, 100).map((line) => (
                        <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                          <TableCell className="font-medium">
                            {formatEventDisplay(line)}
                            <div className="text-sm text-muted-foreground">
                              {new Date(line.market.event.startTime).toLocaleDateString()} {new Date(line.market.event.startTime).toLocaleTimeString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{line.market.event.sport.name}</div>
                            <div className="text-sm text-muted-foreground">{line.market.event.league.name}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{line.market.marketType}</Badge>
                          </TableCell>
                          <TableCell>{getOutcomeLabel(line)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {line.sportsbook.logoUrl && (
                                <img 
                                  src={line.sportsbook.logoUrl} 
                                  alt={line.sportsbook.name}
                                  className="w-6 h-6 rounded"
                                />
                              )}
                              <span>{line.sportsbook.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono">
                            {formatPrice(line.priceValue, line.priceFormat)}
                          </TableCell>
                          <TableCell>
                            {line.isLive ? (
                              <Badge className="bg-green-500">Live</Badge>
                            ) : (
                              <Badge variant="secondary">Pre-Game</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              <span className="text-sm">{line.stateAvailability?.length || 0}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(line.timestamp).toLocaleTimeString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredLines.length > 100 && (
                    <div className="p-4 text-center text-sm text-muted-foreground border-t">
                      Showing first 100 of {filteredLines.length} lines
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Lines Found</h3>
                  <p className="text-muted-foreground mb-4">
                    {lines && lines.length === 0 
                      ? "No lines data available. Check if odds ingestion is running."
                      : "No lines match your current filters. Try adjusting your search criteria."
                    }
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}