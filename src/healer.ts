import axios from 'axios';
import { Queue } from 'bullmq';
import { WatcherConfig, AgentConfig } from './config.js';
import { AgentStatus } from './monitor.js';
import { logger } from './utils/logger.js';

interface Incident {
  id: string;
  agent: string;
  type: 'failure' | 'restart' | 'recovery';
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

interface RestartRecord {
  agent: string;
  count: number;
  lastRestart: Date;
}

export class SelfHealer {
  private config: WatcherConfig;
  private queue: Queue;
  private incidents: Incident[] = [];
  private restartCounts: Map<string, RestartRecord> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config: WatcherConfig, queue: Queue) {
    this.config = config;
    this.queue = queue;
  }

  start(): void {
    if (!this.config.selfHealing.enabled) {
      logger.info('Self-healing disabled');
      return;
    }

    logger.info('Starting self-healer');
    
    // Check every 30 seconds for agents to heal
    this.checkInterval = setInterval(() => {
      this.healLoop();
    }, 30000);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Self-healer stopped');
  }

  private async healLoop(): Promise<void> {
    for (const agent of this.config.agents) {
      await this.checkAndHeal(agent);
    }
  }

  private async checkAndHeal(agent: AgentConfig): Promise<void> {
    // Get latest health status from Redis queue
    const jobs = await this.queue.getJobs(['completed'], 0, 10);
    const latestCheck = jobs
      .filter(j => j.data.agent === agent.name)
      .sort((a, b) => new Date(b.data.timestamp).getTime() - new Date(a.data.timestamp).getTime())[0];

    if (!latestCheck) return;

    const status: AgentStatus = {
      name: agent.name,
      healthy: latestCheck.data.healthy,
      lastCheck: latestCheck.data.timestamp,
      responseTimeMs: latestCheck.data.responseTimeMs,
      statusCode: latestCheck.data.statusCode,
      error: latestCheck.data.error,
      consecutiveFailures: 0, // Will be calculated from history
      uptime: 0,
    };

    // Check if agent is unhealthy
    if (!status.healthy) {
      // Record incident
      this.recordIncident({
        id: `inc-${Date.now()}`,
        agent: agent.name,
        type: 'failure',
        timestamp: new Date().toISOString(),
        message: `Agent ${agent.name} failed health check`,
        details: { error: status.error, statusCode: status.statusCode },
      });

      // Try to restart
      await this.restart(agent, 'auto');
    }
  }

  async restart(agent: AgentConfig, reason: 'auto' | 'manual'): Promise<{ success: boolean; message: string }> {
    // Check restart limits
    const restartRecord = this.restartCounts.get(agent.name);
    const now = new Date();
    
    if (restartRecord) {
      const hoursSinceLastRestart = (now.getTime() - restartRecord.lastRestart.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastRestart < 1 && restartRecord.count >= this.config.selfHealing.maxRestartsPerHour) {
        const message = `Restart limit reached for ${agent.name} (${restartRecord.count} restarts in last hour)`;
        logger.error(message);
        this.recordIncident({
          id: `inc-${Date.now()}`,
          agent: agent.name,
          type: 'failure',
          timestamp: now.toISOString(),
          message,
        });
        return { success: false, message };
      }
      
      if (hoursSinceLastRestart < this.config.selfHealing.cooldownMinutes / 60) {
        const message = `Cooldown period active for ${agent.name}`;
        logger.warn(message);
        return { success: false, message };
      }
    }

    logger.info({ agent: agent.name, reason }, 'Restarting agent');

    try {
      // Call deployer to redeploy
      if (agent.deployUrl) {
        const deployUrl = `${agent.deployUrl}/deploy/${agent.name}`;
        const response = await axios.post(deployUrl, { branch: 'main' }, {
          timeout: 60000,
        });
        
        if (response.data.queued) {
          // Update restart count
          this.restartCounts.set(agent.name, {
            agent: agent.name,
            count: (restartRecord?.count || 0) + 1,
            lastRestart: now,
          });

          this.recordIncident({
            id: `inc-${Date.now()}`,
            agent: agent.name,
            type: 'restart',
            timestamp: now.toISOString(),
            message: `Agent ${agent.name} restarted (${reason})`,
            details: { jobId: response.data.jobId },
          });

          // Send alert if critical
          if (agent.critical) {
            await this.sendAlert(`🚨 Critical agent ${agent.name} restarted (${reason})`);
          }

          return { 
            success: true, 
            message: `Restart queued for ${agent.name}. Job ID: ${response.data.jobId}` 
          };
        }
      }

      return { success: false, message: 'No deploy URL configured' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ agent: agent.name, error: message }, 'Restart failed');
      
      this.recordIncident({
        id: `inc-${Date.now()}`,
        agent: agent.name,
        type: 'failure',
        timestamp: now.toISOString(),
        message: `Restart failed for ${agent.name}: ${message}`,
      });

      return { success: false, message };
    }
  }

  private recordIncident(incident: Incident): void {
    this.incidents.unshift(incident);
    // Keep last 1000 incidents
    if (this.incidents.length > 1000) {
      this.incidents.pop();
    }
  }

  async getRecentIncidents(limit = 50): Promise<Incident[]> {
    return this.incidents.slice(0, limit);
  }

  private async sendAlert(message: string): Promise<void> {
    if (this.config.alerts?.slackWebhook) {
      try {
        await axios.post(this.config.alerts.slackWebhook, { text: message });
      } catch (err) {
        logger.error({ err }, 'Failed to send Slack alert');
      }
    }
  }
}
