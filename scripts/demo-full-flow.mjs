#!/usr/bin/env node
/**
 * demo-full-flow.mjs — End-to-end ArcHive Marketplace demo
 *
 * Uses TWO wallets to demonstrate the real marketplace flow:
 *   - Agent wallet (Cast): registers as agent, accepts/completes tasks
 *   - Client wallet: creates tasks, approves, rates
 *
 * Usage:  node scripts/demo-full-flow.mjs
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  formatUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Config ────────────────────────────────────────────────────────────────────
const ARC_RPC = 'https://rpc.testnet.arc.network';

// Agent wallet (Cast wallet — registers as agent, does the work)
const AGENT_PK = '***REDACTED_TESTNET_KEY***';
// Client wallet (hires the agent)
const CLIENT_PK = '***REDACTED_TESTNET_KEY***';

const AGENT_REGISTRY    = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const TASK_MANAGER      = '0x24f9Fc5569Dab324862f4C634f1Fa7F587DB47d7';
const REPUTATION_ENGINE = '0xa32F3Be485F3c6CB092A67F40586E761010a96d2';
const NANOPAY_DEMO      = '0xF0707583003E3bd60008E3548E92d07D67189ED8';
const USDC_ADDRESS      = '0x3600000000000000000000000000000000000000';

const TASK_PAYMENT = 500_000n; // 0.5 USDC

// ── Chain ─────────────────────────────────────────────────────────────────────
const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ── ABIs ──────────────────────────────────────────────────────────────────────
const registryAbi = parseAbi([
  'function registerAgent(string,string,string,uint256,string[])',
  'function isRegistered(address) view returns (bool)',
  'function getAgent(address) view returns ((string name,string description,string endpoint,uint256 pricePerTask,string[] skillTags,bool active,uint256 registeredAt,uint256 totalTasks,uint256 totalEarned))',
]);

const taskManagerAbi = parseAbi([
  'function createTask(address agent,string description,uint256 payment) returns (uint256 taskId)',
  'function acceptTask(uint256 taskId)',
  'function completeTask(uint256 taskId,string resultHash)',
  'function approveTask(uint256 taskId)',
  'function rateAgent(uint256 taskId,uint8 rating,string comment)',
  'function getTask(uint256 taskId) view returns ((address client,address agent,string description,uint256 payment,string resultHash,uint8 state,uint256 createdAt,uint256 acceptedAt,uint256 completedAt,uint256 disputedAt))',
  'function getTaskCount() view returns (uint256)',
]);

const reputationAbi = parseAbi([
  'function getReputation(address agent) view returns ((uint256 totalRatings,uint256 totalScore,uint256 totalTasks))',
]);

const nanopayAbi = parseAbi([
  'function recordPayment(address agent,uint256 amount,string taskType)',
  'function getPaymentCount() view returns (uint256)',
]);

const erc20Abi = parseAbi([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
const TASK_STATES = ['Created', 'InProgress', 'Completed', 'Approved', 'Disputed', 'Resolved', 'Cancelled'];

function separator(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  STEP: ${title}`);
  console.log('='.repeat(60));
}

async function sendTx(walletClient, publicClient, params, label) {
  console.log(`  [>] Sending: ${label}...`);
  const hash = await walletClient.writeContract(params);
  console.log(`      Tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`      [+] Confirmed in block ${receipt.blockNumber} (${receipt.status})`);
  return receipt;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '#'.repeat(60));
  console.log('#   ArcHive Marketplace — Full Demo Flow');
  console.log('#'.repeat(60));

  const agentAccount = privateKeyToAccount(AGENT_PK);
  const clientAccount = privateKeyToAccount(CLIENT_PK);
  console.log(`\n[*] Agent wallet:  ${agentAccount.address}`);
  console.log(`[*] Client wallet: ${clientAccount.address}`);

  const pub = createPublicClient({ chain: arcTestnet, transport: http() });
  const agentWal = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http() });
  const clientWal = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http() });

  // ── 0. Pre-flight checks ─────────────────────────────────────────────────
  separator('Pre-flight checks');
  const agentBal = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [agentAccount.address] });
  const clientBal = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [clientAccount.address] });
  console.log(`  Agent USDC:  ${formatUnits(agentBal, 6)}`);
  console.log(`  Client USDC: ${formatUnits(clientBal, 6)}`);

  if (clientBal < TASK_PAYMENT) {
    console.error('  [x] Client has insufficient USDC. Fund the client wallet first.');
    process.exit(1);
  }

  // ── 1. Register agent ────────────────────────────────────────────────────
  separator('1 — Register Agent');
  const isReg = await pub.readContract({ address: AGENT_REGISTRY, abi: registryAbi, functionName: 'isRegistered', args: [agentAccount.address] });

  if (isReg) {
    const ag = await pub.readContract({ address: AGENT_REGISTRY, abi: registryAbi, functionName: 'getAgent', args: [agentAccount.address] });
    console.log(`  [i] Already registered as "${ag.name}" — skipping.`);
  } else {
    await sendTx(agentWal, pub, {
      address: AGENT_REGISTRY, abi: registryAbi, functionName: 'registerAgent',
      args: ['CodeReviewer-AI', 'Autonomous smart contract security auditor powered by AI', 'https://archve.demo/api/code-review', 500_000n, ['solidity', 'audit', 'security', 'ai-agent']],
    }, 'registerAgent("CodeReviewer-AI")');
  }

  // ── 2. Client approves USDC + creates task ──────────────────────────────
  separator('2 — Client Creates Task');
  const allowance = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [clientAccount.address, TASK_MANAGER] });
  if (allowance < TASK_PAYMENT) {
    await sendTx(clientWal, pub, {
      address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
      args: [TASK_MANAGER, TASK_PAYMENT * 10n],
    }, `approve(TaskManager, ${formatUnits(TASK_PAYMENT * 10n, 6)} USDC)`);
  }

  const taskCountBefore = await pub.readContract({ address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'getTaskCount' });
  await sendTx(clientWal, pub, {
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'createTask',
    args: [agentAccount.address, 'Audit the ArcHive Marketplace contracts for reentrancy, access control, and economic attack vectors', TASK_PAYMENT],
  }, `createTask(agent=${agentAccount.address.slice(0,10)}..., 0.5 USDC)`);

  const taskId = taskCountBefore;
  console.log(`  [+] Created task ID: ${taskId}`);
  const task = await pub.readContract({ address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'getTask', args: [taskId] });
  console.log(`  State: ${TASK_STATES[task.state]} | Client: ${task.client.slice(0,10)}... | Agent: ${task.agent.slice(0,10)}...`);

  // ── 3. Agent accepts task ──────────────────────────────────────────────
  separator('3 — Agent Accepts Task');
  await sendTx(agentWal, pub, {
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'acceptTask', args: [taskId],
  }, `acceptTask(${taskId})`);
  console.log(`  State: ${TASK_STATES[(await pub.readContract({ address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'getTask', args: [taskId] })).state]}`);

  // ── 4. Agent completes task ────────────────────────────────────────────
  separator('4 — Agent Completes Task');
  const resultHash = 'QmAuditReport_v2_no_critical_issues_found_minor_gas_optimizations_recommended';
  await sendTx(agentWal, pub, {
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'completeTask', args: [taskId, resultHash],
  }, `completeTask(${taskId})`);
  console.log(`  Result: ${resultHash.slice(0, 50)}...`);

  // ── 5. Client approves task (releases payment) ──────────────────────────
  separator('5 — Client Approves (releases payment)');
  const agentBalBefore = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [agentAccount.address] });
  await sendTx(clientWal, pub, {
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'approveTask', args: [taskId],
  }, `approveTask(${taskId})`);
  const agentBalAfter = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [agentAccount.address] });
  console.log(`  Agent earned: +${formatUnits(agentBalAfter - agentBalBefore, 6)} USDC`);

  // ── 6. Client rates agent ──────────────────────────────────────────────
  separator('6 — Client Rates Agent');
  await sendTx(clientWal, pub, {
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'rateAgent',
    args: [taskId, 5, 'Thorough audit with actionable recommendations. Fast turnaround.'],
  }, `rateAgent(task ${taskId}, 5 stars)`);

  try {
    const rep = await pub.readContract({ address: REPUTATION_ENGINE, abi: reputationAbi, functionName: 'getReputation', args: [agentAccount.address] });
    console.log(`  Reputation: ${rep.totalRatings} ratings, avg ${Number(rep.totalScore * 100n / (rep.totalRatings || 1n)) / 100}/5`);
  } catch { console.log('  [i] Reputation query format mismatch — ratings recorded on-chain.'); }

  // ── 7. Record Nanopayment ──────────────────────────────────────────────
  separator('7 — Record Nanopayment');
  await sendTx(clientWal, pub, {
    address: NANOPAY_DEMO, abi: nanopayAbi, functionName: 'recordPayment',
    args: [agentAccount.address, TASK_PAYMENT, 'security-audit'],
  }, `recordPayment(${formatUnits(TASK_PAYMENT, 6)} USDC, "security-audit")`);
  const payCount = await pub.readContract({ address: NANOPAY_DEMO, abi: nanopayAbi, functionName: 'getPaymentCount' });
  console.log(`  Total nanopay records: ${payCount}`);

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('\n' + '#'.repeat(60));
  console.log('#   Demo Complete!');
  console.log('#'.repeat(60));
  console.log(`\n  Task ${taskId}: Full lifecycle with TWO separate wallets:`);
  console.log('    Client created task → Agent accepted → Agent completed');
  console.log('    → Client approved (payment released) → Client rated 5/5');
  console.log('    + Nanopayment recorded');
  console.log(`\n  This demonstrates real marketplace interaction, not self-dealing.\n`);
}

main().catch((err) => {
  console.error('\n[x] Fatal error:', err.shortMessage || err.message);
  if (err.cause) console.error('    Cause:', err.cause.shortMessage || err.cause.message || err.cause);
  process.exit(1);
});
