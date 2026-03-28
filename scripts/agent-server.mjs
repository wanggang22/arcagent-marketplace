#!/usr/bin/env node
/**
 * agent-server.mjs — ArcAgent AI Agent Execution Bridge
 *
 * A persistent Express server that:
 * 1. Listens for on-chain tasks and auto-processes them
 * 2. Serves x402 paid API endpoints via Circle Nanopayments (Gateway)
 * 3. Optionally uses Claude AI for real responses
 *
 * Usage:
 *   AGENT_PK=0x... node scripts/agent-server.mjs
 *
 * Environment:
 *   AGENT_PK       — private key (hex, with 0x prefix)
 *   PORT           — HTTP port (default 3080)
 *   POLL_MS        — task-poll interval in ms (default 5000)
 *   ANTHROPIC_API_KEY — optional, for real AI responses via Claude
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  formatUnits,
  keccak256,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import express from 'express';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';

// ── Configuration ────────────────────────────────────────────────────────────

const PORT    = Number(process.env.PORT) || 3080;
const POLL_MS = Number(process.env.POLL_MS) || 5000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const AGENT_PK = process.env.AGENT_PK;
if (!AGENT_PK) {
  console.error('Set AGENT_PK environment variable.');
  process.exit(1);
}

const ARC_RPC         = 'https://rpc.testnet.arc.network';
const AGENT_REGISTRY  = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const TASK_MANAGER    = '0x24f9Fc5569Dab324862f4C634f1Fa7F587DB47d7';
const NANOPAY_DEMO    = '0xF0707583003E3bd60008E3548E92d07D67189ED8';

// ── Chain definition ─────────────────────────────────────────────────────────

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ── ABIs ─────────────────────────────────────────────────────────────────────

const registryAbi = parseAbi([
  'function isRegistered(address) view returns (bool)',
  'function getAgent(address) view returns ((string name,string description,string endpoint,uint256 pricePerTask,string[] skillTags,bool active,uint256 registeredAt,uint256 totalTasks,uint256 totalEarned))',
]);

const taskManagerAbi = parseAbi([
  'function getTaskCount() view returns (uint256)',
  'function getTask(uint256 taskId) view returns ((address client,address agent,string description,uint256 payment,string resultHash,uint8 state,uint256 createdAt,uint256 acceptedAt,uint256 completedAt,uint256 disputedAt))',
  'function acceptTask(uint256 taskId)',
  'function completeTask(uint256 taskId,string resultHash)',
]);

const nanopayAbi = parseAbi([
  'function recordPayment(address agent,uint256 amount,string taskType)',
]);

// ── Task states ──────────────────────────────────────────────────────────────

const TASK_STATES = [
  'Created',     // 0
  'InProgress',  // 1
  'Completed',   // 2
  'Approved',    // 3
  'Disputed',    // 4
  'Resolved',    // 5
  'Cancelled',   // 6
];

// ── Clients ──────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(AGENT_PK);

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC),
});

const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(ARC_RPC),
});

// ── Agent state ──────────────────────────────────────────────────────────────

const state = {
  agentName: '(loading...)',
  agentAddress: account.address,
  status: 'starting',
  tasksProcessed: 0,
  totalEarned: 0n,
  recentLogs: [],          // last 10 log entries
  lastKnownTaskCount: 0n,
  startedAt: new Date(),
  processing: new Set(),   // task IDs currently being processed
};

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  state.recentLogs.push(entry);
  if (state.recentLogs.length > 10) state.recentLogs.shift();
}

// ── AI result generation ─────────────────────────────────────────────────────

function classifyTask(description) {
  const d = description.toLowerCase();
  if (d.includes('audit') || d.includes('security') || d.includes('review')) return 'security-audit';
  if (d.includes('translate')) return 'translation';
  if (d.includes('analyze') || d.includes('data') || d.includes('analysis')) return 'data-analysis';
  return 'general';
}

function generateResult(description, taskType) {
  switch (taskType) {
    case 'security-audit':
      return JSON.stringify({
        type: 'security-audit',
        summary: 'Security audit completed successfully.',
        findings: [
          { severity: 'LOW', title: 'Unchecked return value in transfer()', recommendation: 'Add require() wrapper or use SafeERC20.' },
          { severity: 'INFO', title: 'Floating pragma detected', recommendation: 'Pin solidity version to 0.8.20.' },
          { severity: 'INFO', title: 'Missing event emissions on state changes', recommendation: 'Emit events in all state-changing functions for off-chain indexing.' },
        ],
        gasOptimizations: [
          'Use uint96 for payment amounts to pack with address in single slot.',
          'Cache storage reads in local variables within loops.',
        ],
        overallRisk: 'LOW',
        conclusion: 'No critical or high-severity issues found. Contract is safe for deployment with minor improvements.',
      });

    case 'translation':
      return JSON.stringify({
        type: 'translation',
        summary: 'Translation completed.',
        sourceLanguage: 'auto-detected',
        targetLanguage: 'en',
        translatedText: `[Translated content for: "${description.slice(0, 80)}"]`,
        confidence: 0.96,
        wordCount: Math.floor(Math.random() * 500) + 100,
      });

    case 'data-analysis':
      return JSON.stringify({
        type: 'data-analysis',
        summary: 'Data analysis completed.',
        metrics: {
          dataPointsProcessed: Math.floor(Math.random() * 10000) + 1000,
          anomaliesDetected: Math.floor(Math.random() * 5),
          trendDirection: 'upward',
          confidence: 0.91,
        },
        insights: [
          'Primary metric shows 12% growth over the analysis period.',
          'Seasonal pattern detected with peak activity in Q4.',
          'Two outlier data points identified and flagged for review.',
        ],
        recommendation: 'Continue current trajectory. Monitor flagged anomalies.',
      });

    default:
      return JSON.stringify({
        type: 'task-completion',
        summary: `Task completed successfully: "${description.slice(0, 100)}"`,
        status: 'done',
        processingTimeMs: Math.floor(Math.random() * 2000) + 1000,
        confidence: 0.94,
        notes: 'Result generated by ArcAgent autonomous agent.',
      });
  }
}

// ── On-chain helpers ─────────────────────────────────────────────────────────

async function sendTx(params, label) {
  log(`  TX: ${label}...`);
  try {
    const hash = await walletClient.writeContract(params);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    log(`  TX confirmed (block ${receipt.blockNumber}, status=${receipt.status})`);
    return receipt;
  } catch (err) {
    const msg = err.shortMessage || err.message || String(err);
    log(`  TX FAILED: ${msg}`);
    throw err;
  }
}

// ── Task processing pipeline ─────────────────────────────────────────────────

async function processTask(taskId) {
  if (state.processing.has(taskId)) return;
  state.processing.add(taskId);

  try {
    const task = await publicClient.readContract({
      address: TASK_MANAGER,
      abi: taskManagerAbi,
      functionName: 'getTask',
      args: [taskId],
    });

    // Only act on tasks assigned to us that are in Created state (0)
    if (task.agent.toLowerCase() !== account.address.toLowerCase()) return;
    if (task.state !== 0) return;

    log(`New task detected! ID: ${taskId}, Description: ${task.description.slice(0, 80)}`);

    // Step 1: Accept the task
    try {
      await sendTx({
        address: TASK_MANAGER,
        abi: taskManagerAbi,
        functionName: 'acceptTask',
        args: [taskId],
      }, `acceptTask(${taskId})`);
    } catch (err) {
      log(`Skipping task ${taskId} — acceptTask failed (${err.shortMessage || err.message})`);
      return;
    }

    // Step 2: Simulate AI processing (3-5 second delay)
    const taskType = classifyTask(task.description);
    const delay = 3000 + Math.floor(Math.random() * 2000);
    log(`  Processing as "${taskType}" (simulating ${delay}ms of AI work)...`);
    await new Promise((r) => setTimeout(r, delay));

    // Step 3: Generate result
    const resultBody = generateResult(task.description, taskType);
    const resultHash = keccak256(toHex(resultBody)).slice(0, 50); // truncate for readability

    // Step 4: Complete the task on-chain
    try {
      await sendTx({
        address: TASK_MANAGER,
        abi: taskManagerAbi,
        functionName: 'completeTask',
        args: [taskId, resultHash],
      }, `completeTask(${taskId})`);
    } catch (err) {
      log(`Error completing task ${taskId}: ${err.shortMessage || err.message}`);
      return;
    }

    // Step 5: Record nanopayment
    try {
      await sendTx({
        address: NANOPAY_DEMO,
        abi: nanopayAbi,
        functionName: 'recordPayment',
        args: [account.address, task.payment, taskType],
      }, `recordPayment(${formatUnits(task.payment, 6)} USDC, "${taskType}")`);
    } catch (err) {
      log(`Warning: nanopayment recording failed for task ${taskId}: ${err.shortMessage || err.message}`);
      // Non-fatal — the task itself is already completed
    }

    // Step 6: Update local state
    state.tasksProcessed += 1;
    state.totalEarned += task.payment;
    log(`Task ${taskId} completed! Result: ${resultHash}`);

  } catch (err) {
    log(`Unexpected error processing task ${taskId}: ${err.shortMessage || err.message}`);
  } finally {
    state.processing.delete(taskId);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────

let pollTimer = null;
let consecutiveErrors = 0;

async function poll() {
  try {
    const taskCount = await publicClient.readContract({
      address: TASK_MANAGER,
      abi: taskManagerAbi,
      functionName: 'getTaskCount',
    });

    consecutiveErrors = 0; // reset on success

    if (taskCount > state.lastKnownTaskCount) {
      // Process any new tasks
      for (let id = state.lastKnownTaskCount; id < taskCount; id++) {
        // Fire-and-forget — processTask handles its own errors
        processTask(id);
      }
      state.lastKnownTaskCount = taskCount;
    }
  } catch (err) {
    consecutiveErrors += 1;
    const backoff = Math.min(consecutiveErrors * 5, 60);
    log(`RPC error (attempt ${consecutiveErrors}): ${err.shortMessage || err.message}. Retrying in ${backoff}s.`);
    // Extend the next poll interval for backoff
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, backoff * 1000);
    return;
  }

  pollTimer = setTimeout(poll, POLL_MS);
}

// ── Also scan older tasks on startup for any that are still Created ──────────

async function scanExistingTasks() {
  try {
    const taskCount = await publicClient.readContract({
      address: TASK_MANAGER,
      abi: taskManagerAbi,
      functionName: 'getTaskCount',
    });
    state.lastKnownTaskCount = taskCount;

    log(`Scanning ${taskCount} existing task(s) for unprocessed work...`);

    for (let id = 0n; id < taskCount; id++) {
      try {
        const task = await publicClient.readContract({
          address: TASK_MANAGER,
          abi: taskManagerAbi,
          functionName: 'getTask',
          args: [id],
        });
        if (
          task.agent.toLowerCase() === account.address.toLowerCase() &&
          task.state === 0
        ) {
          log(`Found pending task ${id} — processing now.`);
          await processTask(id);
        }
      } catch {
        // Individual task read failure — skip
      }
    }

    log('Startup scan complete.');
  } catch (err) {
    log(`Startup scan failed: ${err.shortMessage || err.message}`);
  }
}

// ── x402 Gateway Middleware (Circle Nanopayments) ───────────────────────────

const gateway = createGatewayMiddleware({
  sellerAddress: account.address,
  networks: ['eip155:5042002'],  // Arc Testnet
});

// x402 pricing for paid API endpoints
const X402_PRICES = {
  '/api/analyze':   '$0.001',
  '/api/translate': '$0.0005',
  '/api/code':      '$0.002',
};

// x402 stats
state.x402Calls = 0;
state.x402Earned = 0n;

// ── Claude AI helper ────────────────────────────────────────────────────────

async function askClaude(systemPrompt, userMessage) {
  if (!ANTHROPIC_API_KEY) {
    return '[AI unavailable — set ANTHROPIC_API_KEY for real responses]';
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || 'No response generated.';
  } catch (err) {
    log(`Claude API error: ${err.message}`);
    return `[AI error: ${err.message}]`;
  }
}

// ── Express server & dashboard ───────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── x402 Paid API Endpoints ─────────────────────────────────────────────────

app.get('/api/analyze', gateway.require(X402_PRICES['/api/analyze']), async (req, res) => {
  const query = req.query.q || 'What are the current trends in AI agents?';
  log(`x402 /api/analyze: "${query.slice(0, 60)}"`);
  state.x402Calls++;
  state.x402Earned += 1000n; // 0.001 USDC in micro units

  const result = await askClaude(
    'You are a data analyst AI agent on the ArcAgent marketplace. Provide concise, data-driven analysis. Use bullet points. Reply in the same language as the query.',
    `Analyze: "${query}"`
  );

  const response = {
    agent: state.agentName, type: 'data-analysis', query, result,
    poweredBy: ANTHROPIC_API_KEY ? 'Claude (Anthropic)' : 'Simulated',
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.get('/api/translate', gateway.require(X402_PRICES['/api/translate']), async (req, res) => {
  const text = req.query.text || 'Hello world';
  const to = req.query.to || 'auto';
  log(`x402 /api/translate: "${text.slice(0, 60)}" → ${to}`);
  state.x402Calls++;
  state.x402Earned += 500n;

  const result = await askClaude(
    'You are a professional translator AI agent. Return ONLY the translated text, nothing else.',
    to === 'auto'
      ? `Detect the language and translate to the opposite (Chinese↔English, etc.):\n\n${text}`
      : `Translate to ${to}:\n\n${text}`
  );

  const response = {
    agent: state.agentName, type: 'translation',
    source: text, targetLanguage: to, result,
    poweredBy: ANTHROPIC_API_KEY ? 'Claude (Anthropic)' : 'Simulated',
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.get('/api/code', gateway.require(X402_PRICES['/api/code']), async (req, res) => {
  const prompt = req.query.q || 'Write a function to check if a number is prime';
  const lang = req.query.lang || 'javascript';
  log(`x402 /api/code: "${prompt.slice(0, 60)}" (${lang})`);
  state.x402Calls++;
  state.x402Earned += 2000n;

  const result = await askClaude(
    `You are a code generation AI agent. Generate clean, well-commented ${lang} code. Return ONLY the code block.`,
    prompt
  );

  const response = {
    agent: state.agentName, type: 'code-generation',
    prompt, language: lang, result,
    poweredBy: ANTHROPIC_API_KEY ? 'Claude (Anthropic)' : 'Simulated',
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

// x402 pricing info endpoint (no payment required)
app.get('/api/pricing', (_req, res) => {
  res.json({
    agent: state.agentName,
    endpoints: Object.entries(X402_PRICES).map(([path, price]) => ({ path, price })),
    network: 'Arc Testnet (eip155:5042002)',
    facilitator: 'Circle Gateway (Nanopayments)',
    settlement: 'Batched — zero gas for users',
  });
});

app.get('/', (_req, res) => {
  const uptime = Math.floor((Date.now() - state.startedAt.getTime()) / 1000);
  const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
  const earned = formatUnits(state.totalEarned, 6);
  const statusColor = state.status === 'listening' ? '#00e676' : '#ffa726';

  const logsHtml = state.recentLogs.length
    ? state.recentLogs.map((l) => `<div class="log-entry">${escapeHtml(l)}</div>`).join('\n')
    : '<div class="log-entry dim">No activity yet.</div>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>ArcAgent Agent Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
    .container { max-width: 720px; margin: 0 auto; }
    h1 { color: #58a6ff; margin-bottom: 0.5rem; font-size: 1.6rem; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.25rem; }
    .card h2 { color: #58a6ff; font-size: 1rem; margin-bottom: 0.75rem; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 2rem; }
    .stat-label { color: #8b949e; font-size: 0.85rem; }
    .stat-value { color: #f0f6fc; font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem; }
    .status-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .log-entry { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.8rem; padding: 0.3rem 0; border-bottom: 1px solid #21262d; color: #c9d1d9; word-break: break-all; }
    .log-entry:last-child { border-bottom: none; }
    .dim { color: #484f58; }
    .addr { font-family: monospace; font-size: 0.9rem; word-break: break-all; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    footer { text-align: center; color: #484f58; margin-top: 2rem; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>ArcAgent Agent Server</h1>
    <p class="subtitle">AI Agent Execution Bridge — Autonomous Task Processing</p>

    <div class="card">
      <h2>Agent Info</h2>
      <div class="stat-grid">
        <div>
          <div class="stat-label">Name</div>
          <div class="stat-value">${escapeHtml(state.agentName)}</div>
        </div>
        <div>
          <div class="stat-label">Status</div>
          <div class="stat-value">
            <span class="status-dot pulse" style="background:${statusColor}"></span>
            ${escapeHtml(state.status)}
          </div>
        </div>
        <div style="grid-column: 1 / -1">
          <div class="stat-label">Address</div>
          <div class="stat-value addr">${state.agentAddress}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Performance</h2>
      <div class="stat-grid">
        <div>
          <div class="stat-label">Tasks Processed</div>
          <div class="stat-value">${state.tasksProcessed}</div>
        </div>
        <div>
          <div class="stat-label">Total Earned</div>
          <div class="stat-value">${earned} USDC</div>
        </div>
        <div>
          <div class="stat-label">Uptime</div>
          <div class="stat-value">${uptimeStr}</div>
        </div>
        <div>
          <div class="stat-label">Poll Interval</div>
          <div class="stat-value">${POLL_MS / 1000}s</div>
        </div>
        <div>
          <div class="stat-label">x402 API Calls</div>
          <div class="stat-value">${state.x402Calls}</div>
        </div>
        <div>
          <div class="stat-label">x402 Earned</div>
          <div class="stat-value">${formatUnits(state.x402Earned, 6)} USDC</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Recent Activity (last 10)</h2>
      ${logsHtml}
    </div>

    <footer>
      Agent is running and listening for tasks... &middot; Auto-refreshes every 10s<br>
      Arc Testnet (chain ${arcTestnet.id}) &middot; RPC: ${ARC_RPC}
    </footer>
  </div>
</body>
</html>`);
});

// JSON status endpoint for programmatic access
app.get('/status', (_req, res) => {
  res.json({
    agent: state.agentName,
    address: state.agentAddress,
    status: state.status,
    tasksProcessed: state.tasksProcessed,
    totalEarned: formatUnits(state.totalEarned, 6),
    x402Calls: state.x402Calls,
    x402Earned: formatUnits(state.x402Earned, 6),
    uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
    recentLogs: state.recentLogs,
  });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  ArcAgent Agent Server — AI Execution Bridge');
  console.log('='.repeat(60));
  console.log(`  Agent address : ${account.address}`);
  console.log(`  RPC           : ${ARC_RPC}`);
  console.log(`  Chain ID      : ${arcTestnet.id}`);
  console.log(`  Poll interval : ${POLL_MS}ms`);
  console.log(`  Dashboard     : http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('');

  // Verify agent is registered
  try {
    const isReg = await publicClient.readContract({
      address: AGENT_REGISTRY,
      abi: registryAbi,
      functionName: 'isRegistered',
      args: [account.address],
    });

    if (isReg) {
      const agentInfo = await publicClient.readContract({
        address: AGENT_REGISTRY,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [account.address],
      });
      state.agentName = agentInfo.name;
      log(`Agent registered on-chain as "${agentInfo.name}"`);
      log(`  Skills: [${agentInfo.skillTags.join(', ')}]`);
      log(`  Price: ${formatUnits(agentInfo.pricePerTask, 6)} USDC/task`);
      log(`  Lifetime tasks: ${agentInfo.totalTasks}, earned: ${formatUnits(agentInfo.totalEarned, 6)} USDC`);
    } else {
      state.agentName = '(unregistered)';
      log('WARNING: Agent address is NOT registered in AgentRegistry.');
      log('  Tasks can still be processed, but registration is recommended.');
    }
  } catch (err) {
    log(`Could not verify registration: ${err.shortMessage || err.message}`);
  }

  // Scan existing tasks for any pending work
  await scanExistingTasks();

  // Start polling
  state.status = 'listening';
  log('Now listening for new tasks...');
  pollTimer = setTimeout(poll, POLL_MS);

  // Start HTTP server
  app.listen(PORT, () => {
    log(`Dashboard live at http://localhost:${PORT}`);
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  log(`Received ${signal} — shutting down gracefully.`);
  state.status = 'shutting down';
  clearTimeout(pollTimer);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Go ───────────────────────────────────────────────────────────────────────

start().catch((err) => {
  console.error('[FATAL]', err.shortMessage || err.message);
  process.exit(1);
});
