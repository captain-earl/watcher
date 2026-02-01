import axios from 'axios';
import { Queue } from 'bullmq';

export class AgentMonitor {
  constructor(agents, queue) {
    this.agents = agents;
    this.queue = queue;
    this.statuses = new Map();
    this.intervals = new Map();
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    
    for (const agent of this.agents) {
      this.checkAgent(agent);
      const interval = setInterval(() => this.checkAgent(agent), agent.checkIntervalSec * 1000);
      this.intervals.set(agent.name, interval);
    }
  }

  stop() {
    this.running = false;
    for (const interval of this.intervals.values()) clearInterval(interval);
    this.intervals.clear();
  }

  async checkAgent(agent) {
    const startTime = Date.now();
    let lastError, statusCode, healthy = false;

    for (let i = 0; i < agent.retries; i++) {
      try {
        const response = await axios.get(agent.healthUrl, { timeout: agent.timeoutMs, validateStatus: () => true });
        statusCode = response.status;
        if (statusCode === 200) { healthy = true; break; }
        else lastError = `Unexpected status: ${statusCode}`;
      } catch (err) {
        lastError = err.message;
        statusCode = err.response?.status;
      }
      if (i < agent.retries - 1) await new Promise(r => setTimeout(r, 1000));
    }

    const responseTimeMs = Date.now() - startTime;
    const existingStatus = this.statuses.get(agent.name);
    const consecutiveFailures = healthy ? 0 : (existingStatus?.consecutiveFailures || 0) + 1;

    const status = {
      name: agent.name,
      healthy,
      lastCheck: new Date().toISOString(),
      responseTimeMs,
      statusCode,
      error: lastError,
      consecutiveFailures,
      uptime: healthy ? (existingStatus?.uptime || 0) + agent.checkIntervalSec : existingStatus?.uptime || 0,
    };

    this.statuses.set(agent.name, status);
    await this.queue.add('health-check', { agent: agent.name, healthy, responseTimeMs, statusCode, error: lastError, timestamp: status.lastCheck });
    return status;
  }

  async getStatus(name) { return this.statuses.get(name) || null; }
  async getAllStatuses() { return Array.from(this.statuses.values()); }
}
