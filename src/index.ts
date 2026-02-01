import express from 'express';
import { Queue } from 'bullmq';
import { getConfig, agents } from './config.js';
import { logger } from './utils/logger.js';
import { AgentMonitor } from './monitor.js';
import { SelfHealer } from './healer.js';

const app = express();
const config = getConfig();

// Health check queue for tracking
const healthQueue = new Queue('health-checks', {
  connection: { url: config.redis.url },
});

// Initialize monitor and healer
const monitor = new AgentMonitor(config.agents, healthQueue);
const healer = new SelfHealer(config, healthQueue);

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'watcher',
    agents: agents.length,
    selfHealing: config.selfHealing.enabled,
  });
});

// Get all agent statuses
app.get('/agents', async (req, res) => {
  const statuses = await monitor.getAllStatuses();
  res.json({ agents: statuses });
});

// Get specific agent status
app.get('/agents/:name', async (req, res) => {
  const status = await monitor.getStatus(req.params.name);
  if (!status) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(status);
});

// Trigger manual check
app.post('/check/:name', async (req, res) => {
  const agent = config.agents.find(a => a.name === req.params.name);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const result = await monitor.checkAgent(agent);
  res.json(result);
});

// Trigger manual restart
app.post('/restart/:name', async (req, res) => {
  const agent = config.agents.find(a => a.name === req.params.name);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const result = await healer.restart(agent, 'manual');
  res.json(result);
});

// Get recent incidents
app.get('/incidents', async (req, res) => {
  const incidents = await healer.getRecentIncidents();
  res.json({ incidents });
});

// Start monitoring
monitor.start();
healer.start();

const PORT = config.port;
app.listen(PORT, () => {
  logger.info(`Watcher monitor running on port ${PORT}`);
  logger.info(`Monitoring ${agents.length} agents`);
  logger.info(`Self-healing: ${config.selfHealing.enabled ? 'enabled' : 'disabled'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  monitor.stop();
  healer.stop();
  process.exit(0);
});
