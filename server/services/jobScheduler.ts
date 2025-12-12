import { storage } from "../storage";
import { auditService } from "./auditService";
import { oddsService } from "./oddsService";
import { arbitrageService } from "./arbitrageService";
import { computeHedgeCandidates } from "./hedgeService";
import type { JobRun } from "@shared/schema";

interface Job {
  name: string;
  schedule: string; // Cron expression
  enabled: boolean;
  handler: () => Promise<JobRun>;
}

class JobScheduler {
  private jobs: Job[] = [
    {
      name: "odds_prematch_poller",
      schedule: "*/5 * * * *", // Every 5 minutes
      enabled: true,
      handler: () => this.runOddsPolling(false),
    },
    {
      name: "odds_live_poller", 
      schedule: "*/1 * * * *", // Every minute during live windows
      enabled: true,
      handler: () => this.runOddsPolling(true),
    },
    {
      name: "arbitrage_indexer",
      schedule: "*/2 * * * *", // Every 2 minutes
      enabled: true,
      handler: () => arbitrageService.recalculateArbitrage(),
    },
    {
      name: "hedge_monitor",
      schedule: "*/1 * * * *", // Every minute
      enabled: true,
      handler: () => this.runHedgeMonitoring(),
    },
    {
      name: "cleanup_expired",
      schedule: "0 */6 * * *", // Every 6 hours
      enabled: true,
      handler: () => this.runCleanup(),
    },
  ];

  async runJob(jobName: string): Promise<JobRun> {
    const job = this.jobs.find(j => j.name === jobName);
    if (!job) {
      throw new Error(`Job not found: ${jobName}`);
    }

    await auditService.log("system", "job_manual_trigger", "job", null, { jobName });

    return await job.handler();
  }

  private async runOddsPolling(liveOnly: boolean): Promise<JobRun> {
    const jobName = liveOnly ? "odds_live_poller" : "odds_prematch_poller";
    
    const job = await storage.createJobRun({
      jobName,
      status: "running",
    });

    try {
      await auditService.log("system", "odds_polling_started", "job", job.id, { liveOnly });

      // Fetch odds for available leagues
      const leagues = await storage.getLeagues();
      const leagueIds = leagues.slice(0, 3).map(l => l.id); // Limit to 3 leagues

      await oddsService.fetchOdds({
        leagues: leagueIds,
        liveOnly,
        maxPages: liveOnly ? 1 : 5,
      });

      await storage.updateJobRun(job.id, {
        status: "success",
        finishedAt: new Date(),
        metrics: {
          leaguesProcessed: leagueIds.length,
          liveOnly,
        },
      });

      return job;
    } catch (error) {
      await storage.updateJobRun(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      await auditService.log("system", "odds_polling_failed", "job", job.id, {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }

  private async runHedgeMonitoring(): Promise<JobRun> {
    const job = await storage.createJobRun({
      jobName: "hedge_monitor",
      status: "running",
    });

    try {
      await auditService.log("system", "hedge_monitoring_started", "job", job.id, {});

      // Get all tracked bets and check for hedge opportunities
      const activeBets = await storage.getUserBets("", { status: "open" });

      let hedgesCalculated = 0;
      for (const bet of activeBets) {
        try {
          await computeHedgeCandidates(bet.userId, [bet]);
          hedgesCalculated++;
        } catch (error) {
          console.error(`Error computing hedge candidates for bet ${bet.id}:`, error);
        }
      }

      await storage.updateJobRun(job.id, {
        status: "success",
        finishedAt: new Date(),
        metrics: {
          trackedBets: activeBets.length,
          hedgesCalculated,
        },
      });

      return job;
    } catch (error) {
      await storage.updateJobRun(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }

  private async runCleanup(): Promise<JobRun> {
    const job = await storage.createJobRun({
      jobName: "cleanup_expired",
      status: "running",
    });

    try {
      await auditService.log("system", "cleanup_started", "job", job.id, {});

      // Clean up expired arbitrage opportunities
      await storage.deleteExpiredArbitrageOpportunities();

      await storage.updateJobRun(job.id, {
        status: "success",
        finishedAt: new Date(),
        metrics: {
          cleanupComplete: true,
        },
      });

      return job;
    } catch (error) {
      await storage.updateJobRun(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  }

  async getJobStatuses(): Promise<Array<{
    name: string;
    enabled: boolean;
    lastRun?: JobRun;
  }>> {
    const allRuns = await storage.getJobRuns();
    
    return this.jobs.map(job => {
      const lastRun = allRuns
        .filter(run => run.jobName === job.name)
        .sort((a, b) => new Date(b.startedAt!).getTime() - new Date(a.startedAt!).getTime())[0];

      return {
        name: job.name,
        enabled: job.enabled,
        lastRun,
      };
    });
  }
}

export const jobScheduler = new JobScheduler();
