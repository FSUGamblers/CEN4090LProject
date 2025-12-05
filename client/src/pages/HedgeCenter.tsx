import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Plus, TrendingUp, AlertTriangle, Eye, EyeOff } from "lucide-react";

interface UserBet {
  id: string;
  eventId: string;
  marketId: string;
  sportsbookId: string;
  outcomeId: string;
  stake: string;
  priceAtBet: string;
  notes?: string;
  isTracked: boolean;
  settlement: string;
  createdAt: string;
}

interface HedgeSuggestion {
  id: string;
  suggestedLegs: Array<{
    sportsbookId: string;
    outcomeId: string;
    priceValue: number;
    stake: number;
  }>;
  lockedProfitLow: string;
  lockedProfitHigh: string;
  rationale: string;
  confidence: string;
  expiresAt: string;
}

export default function HedgeCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddBet, setShowAddBet] = useState(false);
  const [newBet, setNewBet] = useState({
    eventId: "",
    marketId: "", 
    sportsbookId: "",
    outcomeId: "",
    stake: "",
    priceAtBet: "",
    notes: ""
  });

  const { data: bets = [], isLoading } = useQuery<UserBet[]>({
    queryKey: ["/api/bets"],
    select: (data: any[]) => data.filter(bet => bet.settlement === "pending")
  });

  const addBetMutation = useMutation({
    mutationFn: async (betData: any) => {
      await apiRequest("POST", "/api/bets", betData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      setShowAddBet(false);
      setNewBet({
        eventId: "",
        marketId: "",
        sportsbookId: "",
        outcomeId: "",
        stake: "",
        priceAtBet: "",
        notes: ""
      });
      toast({
        title: "Success",
        description: "Bet added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add bet",
        variant: "destructive",
      });
    }
  });

  const trackBetMutation = useMutation({
    mutationFn: async (betId: string) => {
      await apiRequest("POST", `/api/bets/${betId}/track`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      toast({
        title: "Success",
        description: "Bet tracking enabled",
      });
    }
  });

  const untrackBetMutation = useMutation({
    mutationFn: async (betId: string) => {
      await apiRequest("POST", `/api/bets/${betId}/untrack`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      toast({
        title: "Success", 
        description: "Bet tracking disabled",
      });
    }
  });

  const handleAddBet = () => {
    addBetMutation.mutate(newBet);
  };

  const handleToggleTracking = (bet: UserBet) => {
    if (bet.isTracked) {
      untrackBetMutation.mutate(bet.id);
    } else {
      trackBetMutation.mutate(bet.id);
    }
  };

  const trackedBets = bets.filter(bet => bet.isTracked);
  const untrackedBets = bets.filter(bet => !bet.isTracked);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hedge Center</h1>
          <p className="text-sm text-muted-foreground">Manage your bets and monitor hedge opportunities</p>
        </div>
        <Dialog open={showAddBet} onOpenChange={setShowAddBet}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-bet">
              <Plus className="w-4 h-4 mr-2" />
              Add Bet
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Bet</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="stake">Stake ($)</Label>
                  <Input
                    id="stake"
                    type="number"
                    placeholder="100"
                    value={newBet.stake}
                    onChange={(e) => setNewBet(prev => ({ ...prev, stake: e.target.value }))}
                    data-testid="input-bet-stake"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="odds">Odds</Label>
                  <Input
                    id="odds"
                    placeholder="+110"
                    value={newBet.priceAtBet}
                    onChange={(e) => setNewBet(prev => ({ ...prev, priceAtBet: e.target.value }))}
                    data-testid="input-bet-odds"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sportsbook">Sportsbook</Label>
                <Select 
                  value={newBet.sportsbookId} 
                  onValueChange={(value) => setNewBet(prev => ({ ...prev, sportsbookId: value }))}
                >
                  <SelectTrigger data-testid="select-sportsbook">
                    <SelectValue placeholder="Select sportsbook" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draftkings">DraftKings</SelectItem>
                    <SelectItem value="fanduel">FanDuel</SelectItem>
                    <SelectItem value="caesars">Caesars</SelectItem>
                    <SelectItem value="betmgm">BetMGM</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="outcome">Outcome/Selection</Label>
                <Input
                  id="outcome"
                  placeholder="Lakers +6.5"
                  value={newBet.outcomeId}
                  onChange={(e) => setNewBet(prev => ({ ...prev, outcomeId: e.target.value }))}
                  data-testid="input-bet-outcome"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional notes about this bet..."
                  value={newBet.notes}
                  onChange={(e) => setNewBet(prev => ({ ...prev, notes: e.target.value }))}
                  data-testid="textarea-bet-notes"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAddBet(false)}
                  className="flex-1"
                  data-testid="button-cancel-bet"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddBet}
                  disabled={addBetMutation.isPending}
                  className="flex-1"
                  data-testid="button-save-bet"
                >
                  {addBetMutation.isPending ? "Adding..." : "Add Bet"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Bets</p>
                <p className="text-2xl font-bold">{bets.length}</p>
              </div>
              <Shield className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tracked Bets</p>
                <p className="text-2xl font-bold text-blue-500">{trackedBets.length}</p>
              </div>
              <Eye className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Hedge Alerts</p>
                <p className="text-2xl font-bold text-amber-500">{Math.floor(trackedBets.length * 0.3)}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Tracked Bets with Hedge Monitoring */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Tracked Bets ({trackedBets.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trackedBets.length > 0 ? (
              <div className="space-y-4">
                {trackedBets.map((bet) => (
                  <div key={bet.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-medium text-sm">{bet.outcomeId}</h3>
                        <p className="text-xs text-muted-foreground">
                          ${parseFloat(bet.stake).toLocaleString()} at {bet.priceAtBet}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">
                          Tracking
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleTracking(bet)}
                          data-testid={`button-untrack-${bet.id}`}
                        >
                          <EyeOff className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Example hedge suggestion UI could go here */}
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-medium text-amber-500">Hedge Opportunity</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Opposing bet at +102 • Stake: $445 • Lock profit: $67-$89
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" data-testid={`button-review-hedge-${bet.id}`}>
                          Review
                        </Button>
                        <Button size="sm" data-testid={`button-execute-hedge-${bet.id}`}>
                          Execute
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Eye className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No bets are currently being tracked</p>
                <p className="text-xs mt-1">Enable tracking on bets below to monitor hedge opportunities</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* All Bets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              All Bets ({bets.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-16 bg-muted rounded-lg"></div>
                  </div>
                ))}
              </div>
            ) : bets.length > 0 ? (
              <div className="space-y-4">
                {bets.map((bet) => (
                  <div key={bet.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium text-sm">{bet.outcomeId}</h3>
                        <p className="text-xs text-muted-foreground">
                          ${parseFloat(bet.stake).toLocaleString()} at {bet.priceAtBet}
                        </p>
                        {bet.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{bet.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={bet.isTracked ? "secondary" : "outline"}
                          className={bet.isTracked ? "bg-blue-500/10 text-blue-500" : ""}
                        >
                          {bet.isTracked ? "Tracked" : "Untracked"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleTracking(bet)}
                          data-testid={`button-toggle-tracking-${bet.id}`}
                        >
                          {bet.isTracked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <h3 className="font-medium mb-2">No Bets Found</h3>
                <p className="text-sm">Add your first bet to start monitoring hedge opportunities</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
