import express from 'express';
import { Queue } from 'bullmq';
import { getConfig, agents } from './config.js';
import { AgentMonitor } from './monitor.js';
import { SelfHealer } from './healer.js';

const app = express();
const config = getConfig();

const healthQueue = new Queue('health-checks', { connection: { url: config.redis.url } });
const monitor = new AgentMonitor(config.agents, healthQueue);
const healer = new SelfHealer(config, healthQueue);

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'watcher', agents: agents.length, selfHealing: config.selfHealing.enabled });
});

app.get('/agents', async (req, res) => {
  const statuses = await monitor.getAllStatuses();
  res.json({ agents: statuses });
});

app.get('/agents/:name', async (req, res) => {
  const status = await monitor.getStatus(req.params.name);
  if (!status) return res.status(404).json({ error: 'Agent not found' });
  res.json(status);
});

app.post('/check/:name', async (req, res) => {
  const agent = config.agents.find(a => a.name === req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const result = await monitor.checkAgent(agent);
  res.json(result);
});

app.post('/restart/:name', async (req, res) => {
  const agent = config.agents.find(a => a.name === req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const result = await healer.restart(agent, 'manual');
  res.json(result);
});

app.get('/incidents', async (req, res) => {
  const incidents = await healer.getRecentIncidents();
  res.json({ incidents });
});

monitor.start();
healer.start();

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Watcher monitor running on port ${PORT}`);
  console.log(`Monitoring ${agents.length} agents`);
});

export default app;
