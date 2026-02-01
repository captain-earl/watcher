import { z } from 'zod';

export const agents = [
  { name: 'deployer', healthUrl: 'https://slp-deployer.vercel.app/health', critical: true, checkIntervalSec: 30, timeoutMs: 5000, retries: 3 },
  { name: 'edna', healthUrl: 'https://edna-ghl-agent.vercel.app/health', critical: true, checkIntervalSec: 60, timeoutMs: 5000, retries: 3 },
  { name: 'mabel', healthUrl: 'https://mabel-lead-agent.vercel.app/health', critical: true, checkIntervalSec: 60, timeoutMs: 5000, retries: 3 },
  { name: 'otis', healthUrl: 'https://otis-seo-agent.vercel.app/health', critical: false, checkIntervalSec: 120, timeoutMs: 5000, retries: 2 },
  { name: 'harold', healthUrl: 'https://harold-finance-agent.vercel.app/health', critical: false, checkIntervalSec: 120, timeoutMs: 5000, retries: 2 },
];

export function getConfig() {
  return {
    agents: agents.map(a => ({ ...a, deployUrl: process.env.DEPLOYER_URL || 'https://slp-deployer.vercel.app' })),
    redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    alerts: { slackWebhook: process.env.SLACK_WEBHOOK_URL, email: process.env.ALERT_EMAIL },
    selfHealing: {
      enabled: process.env.SELF_HEALING_ENABLED !== 'false',
      maxRestartsPerHour: parseInt(process.env.MAX_RESTARTS_PER_HOUR || '5'),
      cooldownMinutes: parseInt(process.env.RESTART_COOLDOWN_MIN || '10'),
    },
    port: parseInt(process.env.PORT || '3002'),
  };
}
