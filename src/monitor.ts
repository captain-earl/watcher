import axios, { AxiosError } from 'axios';
import { Queue } from 'bullmq';
import { logger } from './utils/logger.js';

export interface AgentConfig {
  name: string;
  healthUrl: string;
  timeoutMs: number;
  retries: number;
  expectedStatus: number;
  checkIntervalSec: number;
  critical: boolean;
}

export interface AgentStatus {
  name: string;
  healthy: boolean;
  lastCheck: string;
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  consecutiveFailures: number;
  uptime: number;
}

export class AgentMonitor {
  private agents: AgentConfig[];
  private queue: Queue;
  private statuses: Map<string, AgentStatus> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor(agents: AgentConfig[], queue: Queue) {
    this.agents = agents;
    this.queue = queue;
  }

  start(): void {
    if (this.running) return;
    
    this.running = true;
    logger.info('Starting agent monitor');

    for (const agent of this.agents) {
      // Initial check
      this.checkAgent(agent);
      
      // Schedule periodic checks
      const interval = setInterval(
        () => this.checkAgent(agent),
        agent.checkIntervalSec * 1000
      );
      this.intervals.set(agent.name, interval);
    }
  }

  stop(): void {
    this.running = false;
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    logger.info('Agent monitor stopped');
  }

  async checkAgent(agent: AgentConfig): Promise<AgentStatus> {
    const startTime = Date.now();
    let lastError: string | undefined;
    let statusCode: number | undefined;
    let healthy = false;

    // Try multiple times
    for (let i = 0; i < agent.retries; i++) {
      try {
        const response = await axios.get(agent.healthUrl, {
          timeout: agent.timeoutMs,
          validateStatus: () => true, // Don't throw on bad status
        });
        
        statusCode = response.status;
        
        if (statusCode === agent.expectedStatus) {
          healthy = true;
          break;
        } else {
          lastError = `Unexpected status code: ${statusCode}`;
        }
      } catch (err) {
        const error = err as AxiosError;
        lastError = error.message;
        statusCode = error.response?.status;
      }
      
      // Wait before retry
      if (i < agent.retries - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const responseTimeMs = Date.now() - startTime;
    const existingStatus = this.statuses.get(agent.name);
    const consecutiveFailures = healthy 
      ? 0 
      : (existingStatus?.consecutiveFailures || 0) + 1;

    const status: AgentStatus = {
      name: agent.name,
      healthy,
      lastCheck: new Date().toISOString(),
      responseTimeMs,
      statusCode,
      error: lastError,
      consecutiveFailures,
      uptime: healthy 
        ? (existingStatus?.uptime || 0) + agent.checkIntervalSec 
        : existingStatus?.uptime || 0,
    };

    this.statuses.set(agent.name, status);

    // Queue health check record
    await this.queue.add('health-check', {
      agent: agent.name,
      healthy,
      responseTimeMs,
      statusCode,
      error: lastError,
      timestamp: status.lastCheck,
    });

    // Log unhealthy agents
    if (!healthy) {
      logger.warn({ 
        agent: agent.name, 
        error: lastError,
        statusCode,
        consecutiveFailures,
        critical: agent.critical,
      }, 'Agent health check failed');
    } else if (existingStatus?.consecutiveFailures > 0) {
      logger.info({ agent: agent.name }, 'Agent recovered');
    }

    return status;
  }

  async getStatus(name: string): Promise<AgentStatus | null> {
    return this.statuses.get(name) || null;
  }

  async getAllStatuses(): Promise<AgentStatus[]> {
    return Array.from(this.statuses.values());
  }

  isRunning(): boolean {
    return this.running;
  }
}
