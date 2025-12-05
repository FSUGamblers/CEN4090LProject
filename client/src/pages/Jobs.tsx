import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Play, RotateCcw, Clock, CheckCircle, XCircle, Settings, Activity, AlertCircle } from "lucide-react";

interface JobRun {
  id: string;
  jobName: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt?: string;
  errorSummary?: string;
  metrics?: any;
}

const jobDescriptions = {
  'odds_prematch_poller': {
    name: 'Pre-match Odds Polling',
    description: 'Fetches upcoming game odds every 5 minutes',
    schedule: 'Every 5 minutes'
  },
  'odds_live_poller': {
    name: 'Live Odds Polling', 
    description: 'Fetches live odds during active games',
    schedule: 'Every 1 minute'
  },
  'arbitrage_indexer': {
    name: 'Arbitrage Detection',
    description: 'Analyzes odds for arbitrage opportunities',
    schedule: 'Every 2 minutes'
  },
  'hedge_monitor': {
    name: 'Hedge Monitoring',
    description: 'Monitors tracked bets for hedge opportunities',
    schedule: 'Every 1 minute'
  },
  'cleanup_expired': {
    name: 'Cleanup & Maintenance',
    description: 'Removes expired opportunities and old data',
    schedule: 'Every 6 hours'
  }
};

export default function Jobs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<JobRun | null>(null);
  const [showJobDetails, setShowJobDetails] = useState(false);

  const { data: jobs = [], isLoading } = useQuery<JobRun[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  const runJobMutation = useMutation({
    mutationFn: async (jobName: string) => {
      await apiRequest("POST", `/api/jobs/${jobName}:run`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Success",
        description: "Job started successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start job",
        variant: "destructive",
      });
    }
  });

  const triggerOddsIngestMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/ingest/odds/run", {
        leagues: ["americanfootball_nfl"],
        live_only: false,
        max_pages: 5
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Success",
        description: "Odds ingestion triggered",
      });
    }
  });

  const handleRunJob = (jobName: string) => {
    runJobMutation.mutate(jobName);
  };

  const handleViewDetails = (job: JobRun) => {
    setSelectedJob(job);
    setShowJobDetails(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Activity className="w-4 h-4 text-green-500" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      running: "bg-green-500/10 text-green-500 border-green-500/20",
      success: "bg-blue-500/10 text-blue-500 border-blue-500/20", 
      failed: "bg-red-500/10 text-red-500 border-red-500/20"
    };

    return (
      <Badge variant="outline" className={variants[status as keyof typeof variants] || ""}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatDuration = (startedAt: string, finishedAt?: string) => {
    const start = new Date(startedAt);
    const end = finishedAt ? new Date(finishedAt) : new Date();
    const duration = end.getTime() - start.getTime();
    
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${Math.round(duration / 1000)}s`;
    return `${Math.round(duration / 60000)}m`;
  };

  // Group jobs by name to show latest run for each
  const jobsByName = jobs.reduce((acc, job) => {
    if (!acc[job.jobName] || new Date(job.startedAt) > new Date(acc[job.jobName].startedAt)) {
      acc[job.jobName] = job;
    }
    return acc;
  }, {} as Record<string, JobRun>);

  const recentJobs = jobs.slice(0, 10);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jobs & Polling</h1>
          <p className="text-sm text-muted-foreground">Monitor and control system jobs and data ingestion</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => triggerOddsIngestMutation.mutate()}
            disabled={triggerOddsIngestMutation.isPending}
            data-testid="button-trigger-odds-ingest"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {triggerOddsIngestMutation.isPending ? "Starting..." : "Trigger Odds Fetch"}
          </Button>
        </div>
      </div>

      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Jobs</p>
                <p className="text-2xl font-bold">
                  {jobs.filter(job => job.status === 'running').length}
                </p>
              </div>
              <Activity className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold text-green-500">92%</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failed Today</p>
                <p className="text-2xl font-bold text-red-500">
                  {jobs.filter(job => job.status === 'failed' && 
                    new Date(job.startedAt).toDateString() === new Date().toDateString()).length}
                </p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Duration</p>
                <p className="text-2xl font-bold">2.4s</p>
              </div>
              <Clock className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="scheduled" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="scheduled" data-testid="tab-scheduled">Scheduled Jobs</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">Execution History</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(jobDescriptions).map(([jobName, info]) => {
                  const latestRun = jobsByName[jobName];
                  
                  return (
                    <div key={jobName} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(latestRun?.status || 'unknown')}
                            <div>
                              <h3 className="font-medium">{info.name}</h3>
                              <p className="text-sm text-muted-foreground">{info.description}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-sm">
                            <p className="text-muted-foreground">Schedule: {info.schedule}</p>
                            {latestRun && (
                              <p className="text-muted-foreground">
                                Last run: {new Date(latestRun.startedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                          {latestRun && getStatusBadge(latestRun.status)}
                          <Button
                            size="sm"
                            onClick={() => handleRunJob(jobName)}
                            disabled={runJobMutation.isPending}
                            data-testid={`button-run-${jobName}`}
                          >
                            <Play className="w-4 h-4 mr-1" />
                            Run Now
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Executions</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-muted rounded-lg"></div>
                    </div>
                  ))}
                </div>
              ) : recentJobs.length > 0 ? (
                <div className="space-y-4">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {getStatusIcon(job.status)}
                          <div>
                            <h3 className="font-medium">
                              {jobDescriptions[job.jobName as keyof typeof jobDescriptions]?.name || job.jobName}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>{new Date(job.startedAt).toLocaleString()}</span>
                              <span>•</span>
                              <span>Duration: {formatDuration(job.startedAt, job.finishedAt)}</span>
                              {job.errorSummary && (
                                <>
                                  <span>•</span>
                                  <div className="flex items-center gap-1 text-red-500">
                                    <AlertCircle className="w-3 h-3" />
                                    <span>Error</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {getStatusBadge(job.status)}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDetails(job)}
                            data-testid={`button-details-${job.id}`}
                          >
                            Details
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No job executions found</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Job Details Dialog */}
      <Dialog open={showJobDetails} onOpenChange={setShowJobDetails}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job Execution Details</DialogTitle>
          </DialogHeader>
          {selectedJob && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Job Name</p>
                  <p className="font-medium">
                    {jobDescriptions[selectedJob.jobName as keyof typeof jobDescriptions]?.name || selectedJob.jobName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div className="mt-1">
                    {getStatusBadge(selectedJob.status)}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Started At</p>
                  <p className="font-medium">{new Date(selectedJob.startedAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{formatDuration(selectedJob.startedAt, selectedJob.finishedAt)}</p>
                </div>
              </div>

              {selectedJob.errorSummary && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Error Summary</p>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    <p className="text-sm text-red-500">{selectedJob.errorSummary}</p>
                  </div>
                </div>
              )}

              {selectedJob.metrics && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Metrics</p>
                  <div className="bg-muted rounded-lg p-3">
                    <pre className="text-sm overflow-auto">
                      {JSON.stringify(selectedJob.metrics, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
