#!/usr/bin/env node
/**
 * agent-server.mjs — ArcHive AI Agent Execution Bridge
 *
 * A persistent Express server that listens for on-chain tasks assigned to this
 * agent, automatically accepts them, simulates AI processing, submits results,
 * and records nanopayments.  Serves a live status dashboard at GET /.
 *
 * Usage:
 *   AGENT_PK=0x... node scripts/agent-server.mjs
 *   node scripts/agent-server.mjs                # uses default Cast wallet
 *
 * Environment:
 *   AGENT_PK   — private key (hex, with 0x prefix)
 *   PORT       — HTTP port (default 3080)
 *   POLL_MS    — task-poll interval in ms (default 5000)
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

// ── Configuration ────────────────────────────────────────────────────────────

const PORT    = Number(process.env.PORT) || 3080;
const POLL_MS = Number(process.env.POLL_MS) || 5000;

const AGENT_PK =
  process.env.AGENT_PK ||
  '***REDACTED_TESTNET_KEY***';

const ARC_RPC         = 'https://rpc.testnet.arc.network';
const AGENT_REGISTRY  = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const TASK_MANAGER    = '0x97F7297e334a80dAe32038aD9970974e50910d64';
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
        notes: 'Result generated by ArcHive autonomous agent.',
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

// ── Express server & dashboard ───────────────────────────────────────────────

const app = express();

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
  <title>ArcHive Agent Server</title>
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
    <h1>ArcHive Agent Server</h1>
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
  console.log('  ArcHive Agent Server — AI Execution Bridge');
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
