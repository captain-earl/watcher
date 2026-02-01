import { z } from 'zod';

export const WatcherConfigSchema = z.object({
  agents: z.array(z.object({
    name: z.string(),
    healthUrl: z.string().url(),
    deployUrl: z.string().url().optional(), // URL to trigger redeploy
    critical: z.boolean().default(false), // Critical agents get immediate restart
    checkIntervalSec: z.number().default(30),
    timeoutMs: z.number().default(5000),
    retries: z.number().default(3),
    expectedStatus: z.number().default(200),
  })),
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
  }),
  alerts: z.object({
    slackWebhook: z.string().url().optional(),
    email: z.string().email().optional(),
  }).optional(),
  selfHealing: z.object({
    enabled: z.boolean().default(true),
    maxRestartsPerHour: z.number().default(5),
    cooldownMinutes: z.number().default(10),
  }).default({}),
  port: z.number().default(3002),
});

export type WatcherConfig = z.infer<typeof WatcherConfigSchema>;

// Agent registry with health endpoints
export const agents = [
  {
    name: 'deployer',
    healthUrl: 'https://deployer.captain-earl.vercel.app/health',
    critical: true,
    checkIntervalSec: 30,
    timeoutMs: 5000,
    retries: 3,
  },
  {
    name: 'edna',
    healthUrl: 'https://edna-ghl-agent.vercel.app/health',
    critical: true,
    checkIntervalSec: 60,
    timeoutMs: 5000,
    retries: 3,
  },
  {
    name: 'mabel',
    healthUrl: 'https://mabel-lead-agent.vercel.app/health',
    critical: true,
    checkIntervalSec: 60,
    timeoutMs: 5000,
    retries: 3,
  },
  {
    name: 'otis',
    healthUrl: 'https://otis-seo-agent.vercel.app/health',
    critical: false,
    checkIntervalSec: 120,
    timeoutMs: 5000,
    retries: 2,
  },
  {
    name: 'harold',
    healthUrl: 'https://harold-finance-agent.vercel.app/health',
    critical: false,
    checkIntervalSec: 120,
    timeoutMs: 5000,
    retries: 2,
  },
];

export function getConfig(): WatcherConfig {
  return WatcherConfigSchema.parse({
    agents: agents.map(a => ({
      ...a,
      deployUrl: process.env.DEPLOYER_URL || 'https://deployer.captain-earl.vercel.app',
    })),
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    alerts: {
      slackWebhook: process.env.SLACK_WEBHOOK_URL,
      email: process.env.ALERT_EMAIL,
    },
    selfHealing: {
      enabled: process.env.SELF_HEALING_ENABLED !== 'false',
      maxRestartsPerHour: parseInt(process.env.MAX_RESTARTS_PER_HOUR || '5'),
      cooldownMinutes: parseInt(process.env.RESTART_COOLDOWN_MIN || '10'),
    },
    port: parseInt(process.env.PORT || '3002'),
  });
}
