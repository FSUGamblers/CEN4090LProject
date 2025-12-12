import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Plus, Edit3, Save, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ManualBet = {
  id: string;
  sport: string;
  league?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  marketType: string;
  selection: string;
  sportsbook: string;
  oddsAmerican: number;
  stake: string;
  status: string;
  notes?: string | null;
  createdAt: string;
};

const statusOptions = ["open", "won", "lost", "void", "settled"];

const initialBetForm = {
  sport: "",
  league: "",
  homeTeam: "",
  awayTeam: "",
  marketType: "Moneyline",
  selection: "",
  sportsbook: "",
  oddsAmerican: "",
  stake: "",
  status: "open",
  notes: "",
};

export default function HedgeCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [betForm, setBetForm] = useState(initialBetForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Partial<ManualBet>>({});

  const { data: bets = [], isLoading } = useQuery<ManualBet[]>({
    queryKey: ["/api/bets"],
  });

  const createBet = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/bets", {
        ...betForm,
        oddsAmerican: Number(betForm.oddsAmerican),
        stake: Number(betForm.stake),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      setBetForm(initialBetForm);
      toast({ title: "Bet added", description: "Manual bet saved to your tracker." });
    },
    onError: () => {
      toast({
        title: "Unable to save bet",
        description: "Please check your entry and try again.",
        variant: "destructive",
      });
    },
  });

  const updateBet = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<ManualBet> }) => {
      await apiRequest("PUT", `/api/bets/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      setEditingId(null);
      setEditingDraft({});
      toast({ title: "Bet updated", description: "Changes saved." });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not update bet. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!betForm.sport || !betForm.selection || !betForm.sportsbook) {
      toast({
        title: "Missing details",
        description: "Sport, selection, and sportsbook are required.",
        variant: "destructive",
      });
      return;
    }

    const odds = Number(betForm.oddsAmerican);
    const stake = Number(betForm.stake);

    if (!Number.isFinite(odds) || betForm.oddsAmerican === "") {
      toast({
        title: "Odds required",
        description: "Enter valid American odds (e.g., -110).",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(stake) || stake <= 0) {
      toast({
        title: "Stake required",
        description: "Enter a positive stake amount.",
        variant: "destructive",
      });
      return;
    }

    createBet.mutate();
  };

  const startEditing = (bet: ManualBet) => {
    setEditingId(bet.id);
    setEditingDraft({
      selection: bet.selection,
      sportsbook: bet.sportsbook,
      oddsAmerican: bet.oddsAmerican,
      stake: bet.stake,
      notes: bet.notes ?? "",
      status: bet.status,
    });
  };

  const saveEditing = () => {
    if (!editingId) return;
    const payload: Partial<ManualBet> = { ...editingDraft };

    if (payload.oddsAmerican !== undefined) {
      payload.oddsAmerican = Number(payload.oddsAmerican);
    }

    if (payload.stake !== undefined) {
      payload.stake = typeof payload.stake === "number" ? String(payload.stake) : payload.stake;
    }

    updateBet.mutate({ id: editingId, payload });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hedge Center / Bet Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Manually record wagers, update their status, and keep a clean ledger for hedging.
          </p>
        </div>
        <Badge variant="outline">Manual entry only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add bet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Sport</Label>
              <Input
                placeholder="NFL"
                value={betForm.sport}
                onChange={(e) => setBetForm((prev) => ({ ...prev, sport: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>League</Label>
              <Input
                placeholder="AFC East"
                value={betForm.league}
                onChange={(e) => setBetForm((prev) => ({ ...prev, league: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Market</Label>
              <Input
                placeholder="Moneyline"
                value={betForm.marketType}
                onChange={(e) => setBetForm((prev) => ({ ...prev, marketType: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Home team</Label>
              <Input
                placeholder="Team A"
                value={betForm.homeTeam}
                onChange={(e) => setBetForm((prev) => ({ ...prev, homeTeam: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Away team</Label>
              <Input
                placeholder="Team B"
                value={betForm.awayTeam}
                onChange={(e) => setBetForm((prev) => ({ ...prev, awayTeam: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Selection</Label>
              <Input
                placeholder="Jets +3.5"
                value={betForm.selection}
                onChange={(e) => setBetForm((prev) => ({ ...prev, selection: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Sportsbook</Label>
              <Input
                placeholder="DraftKings"
                value={betForm.sportsbook}
                onChange={(e) => setBetForm((prev) => ({ ...prev, sportsbook: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Odds (American)</Label>
              <Input
                placeholder="-110"
                value={betForm.oddsAmerican}
                onChange={(e) => setBetForm((prev) => ({ ...prev, oddsAmerican: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Stake</Label>
              <Input
                placeholder="50"
                value={betForm.stake}
                onChange={(e) => setBetForm((prev) => ({ ...prev, stake: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={betForm.status}
                onValueChange={(value) => setBetForm((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Limits, boosts, or hedge plan"
              value={betForm.notes}
              onChange={(e) => setBetForm((prev) => ({ ...prev, notes: e.target.value }))}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={createBet.isPending}>
              {createBet.isPending ? "Saving..." : "Add bet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-4 h-4" /> Bet tracker ({bets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : bets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bets recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Selection</th>
                    <th className="p-2">Market</th>
                    <th className="p-2">Sportsbook</th>
                    <th className="p-2">Odds</th>
                    <th className="p-2">Stake</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Notes</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bets.map((bet) => {
                    const isEditing = editingId === bet.id;
                    return (
                      <tr key={bet.id} className="align-top">
                        <td className="p-2 font-medium">
                          {isEditing ? (
                            <Input
                              value={editingDraft.selection ?? ""}
                              onChange={(e) =>
                                setEditingDraft((prev) => ({ ...prev, selection: e.target.value }))
                              }
                            />
                          ) : (
                            bet.selection
                          )}
                          <div className="text-xs text-muted-foreground">
                            {bet.homeTeam && bet.awayTeam
                              ? `${bet.homeTeam} vs ${bet.awayTeam}`
                              : bet.league || bet.sport}
                          </div>
                        </td>
                        <td className="p-2">{bet.marketType}</td>
                        <td className="p-2">
                          {isEditing ? (
                            <Input
                              value={editingDraft.sportsbook ?? ""}
                              onChange={(e) =>
                                setEditingDraft((prev) => ({ ...prev, sportsbook: e.target.value }))
                              }
                            />
                          ) : (
                            bet.sportsbook
                          )}
                        </td>
                        <td className="p-2">
                          {isEditing ? (
                            <Input
                              value={editingDraft.oddsAmerican ?? bet.oddsAmerican}
                              onChange={(e) =>
                                setEditingDraft((prev) => ({ ...prev, oddsAmerican: Number(e.target.value) }))
                              }
                            />
                          ) : (
                            bet.oddsAmerican
                          )}
                        </td>
                        <td className="p-2">
                          {isEditing ? (
                            <Input
                              value={editingDraft.stake ?? bet.stake}
                              onChange={(e) =>
                                setEditingDraft((prev) => ({ ...prev, stake: e.target.value }))
                              }
                            />
                          ) : (
                            `$${Number(bet.stake).toLocaleString()}`
                          )}
                        </td>
                        <td className="p-2">
                          {isEditing ? (
                            <Select
                              value={editingDraft.status ?? bet.status}
                              onValueChange={(value) =>
                                setEditingDraft((prev) => ({ ...prev, status: value }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                {statusOptions.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {status}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{bet.status}</Badge>
                          )}
                        </td>
                        <td className="p-2 w-64">
                          {isEditing ? (
                            <Textarea
                              value={editingDraft.notes ?? bet.notes ?? ""}
                              onChange={(e) =>
                                setEditingDraft((prev) => ({ ...prev, notes: e.target.value }))
                              }
                            />
                          ) : (
                            <span className="line-clamp-2 text-xs text-muted-foreground">{bet.notes}</span>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                                <XCircle className="w-4 h-4 mr-1" /> Cancel
                              </Button>
                              <Button size="sm" onClick={saveEditing} disabled={updateBet.isPending}>
                                <Save className="w-4 h-4 mr-1" /> Save
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => startEditing(bet)}>
                              <Edit3 className="w-4 h-4 mr-1" /> Edit
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
