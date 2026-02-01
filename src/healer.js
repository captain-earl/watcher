import axios from 'axios';

export class SelfHealer {
  constructor(config, queue) {
    this.config = config;
    this.queue = queue;
    this.incidents = [];
    this.restartCounts = new Map();
  }

  start() {
    if (!this.config.selfHealing.enabled) return;
    this.checkInterval = setInterval(() => this.healLoop(), 30000);
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  async healLoop() {
    for (const agent of this.config.agents) await this.checkAndHeal(agent);
  }

  async checkAndHeal(agent) {
    const jobs = await this.queue.getJobs(['completed'], 0, 10);
    const latestCheck = jobs.filter(j => j.data.agent === agent.name)
      .sort((a, b) => new Date(b.data.timestamp) - new Date(a.data.timestamp))[0];
    if (!latestCheck || latestCheck.data.healthy) return;
    await this.restart(agent, 'auto');
  }

  async restart(agent, reason) {
    const restartRecord = this.restartCounts.get(agent.name);
    const now = new Date();
    
    if (restartRecord) {
      const hoursSinceLast = (now - restartRecord.lastRestart) / (1000 * 60 * 60);
      if (hoursSinceLast < 1 && restartRecord.count >= this.config.selfHealing.maxRestartsPerHour) {
        return { success: false, message: `Restart limit reached for ${agent.name}` };
      }
    }

    try {
      if (agent.deployUrl) {
        const response = await axios.post(`${agent.deployUrl}/deploy/${agent.name}`, { branch: 'main' }, { timeout: 60000 });
        if (response.data.queued) {
          this.restartCounts.set(agent.name, { agent: agent.name, count: (restartRecord?.count || 0) + 1, lastRestart: now });
          return { success: true, message: `Restart queued for ${agent.name}`, jobId: response.data.jobId };
        }
      }
      return { success: false, message: 'No deploy URL configured' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getRecentIncidents(limit = 50) { return this.incidents.slice(0, limit); }
}
