#!/usr/bin/env node
/**
 * check-status.mjs — Query and display ArcHive Marketplace state
 *
 * Reads on-chain data and prints:
 *   - All registered agents with details
 *   - All tasks with statuses
 *   - Agent reputations
 *   - Nanopayment records
 *
 * Usage:  node scripts/check-status.mjs
 */

import {
  createPublicClient,
  http,
  defineChain,
  parseAbi,
  formatUnits,
} from 'viem';

// ── Config ────────────────────────────────────────────────────────────────────
const ARC_RPC = 'https://rpc.testnet.arc.network';

const AGENT_REGISTRY    = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const TASK_MANAGER      = '0x97F7297e334a80dAe32038aD9970974e50910d64';
const REPUTATION_ENGINE = '0xa32F3Be485F3c6CB092A67F40586E761010a96d2';
const NANOPAY_DEMO      = '0xF0707583003E3bd60008E3548E92d07D67189ED8';

// ── Chain ─────────────────────────────────────────────────────────────────────
const arcTestnet = defineChain({
  id: 1637,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ── ABIs ──────────────────────────────────────────────────────────────────────
const registryAbi = parseAbi([
  'function getAgentCount() view returns (uint256)',
  'function getAgentsPaginated(uint256 _offset, uint256 _limit) view returns ((string name,string description,string endpoint,uint256 pricePerTask,string[] skillTags,bool active,uint256 registeredAt,uint256 totalTasks,uint256 totalEarned)[] agents, address[] addresses)',
]);

const taskManagerAbi = parseAbi([
  'function getTaskCount() view returns (uint256)',
  'function getTask(uint256 taskId) view returns ((address client,address agent,string description,uint256 payment,string resultHash,uint8 state,uint256 createdAt,uint256 acceptedAt,uint256 completedAt))',
]);

const reputationAbi = parseAbi([
  'function getReputation(address agent) view returns (uint256 totalTasks,uint256 avgRatingX100,uint256 totalRatings)',
  'function getReviewCount(address agent) view returns (uint256)',
  'function getReviews(address agent,uint256 offset,uint256 limit) view returns ((uint256 taskId,address reviewer,uint8 rating,string comment,uint256 timestamp)[])',
]);

const nanopayAbi = parseAbi([
  'function getPaymentCount() view returns (uint256)',
  'function getPayments(uint256 offset,uint256 limit) view returns ((address payer,address agent,uint256 amount,string taskType,uint256 timestamp)[])',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
const TASK_STATES = ['Created', 'Accepted', 'Completed', 'Approved', 'Disputed', 'Resolved', 'Cancelled'];

function banner(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDate(timestamp) {
  if (!timestamp || timestamp === 0n) return 'N/A';
  return new Date(Number(timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '#'.repeat(60));
  console.log('#   ArcHive Marketplace — Status Dashboard');
  console.log('#'.repeat(60));
  console.log(`\n  RPC: ${ARC_RPC}`);

  const pub = createPublicClient({ chain: arcTestnet, transport: http() });

  // ── Agents ──────────────────────────────────────────────────────────────────
  banner('Registered Agents');

  const agentCount = await pub.readContract({
    address: AGENT_REGISTRY, abi: registryAbi, functionName: 'getAgentCount',
  });
  console.log(`  Total agents: ${agentCount}\n`);

  if (agentCount > 0n) {
    const { agents, addresses } = await pub.readContract({
      address: AGENT_REGISTRY,
      abi: registryAbi,
      functionName: 'getAgentsPaginated',
      args: [0n, agentCount],
    });

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const addr = addresses[i];
      console.log(`  [Agent #${i}]  ${a.name}`);
      console.log(`    Address:     ${addr}`);
      console.log(`    Description: ${a.description}`);
      console.log(`    Endpoint:    ${a.endpoint}`);
      console.log(`    Price:       ${formatUnits(a.pricePerTask, 6)} USDC`);
      console.log(`    Skills:      [${a.skillTags.join(', ')}]`);
      console.log(`    Active:      ${a.active}`);
      console.log(`    Registered:  ${formatDate(a.registeredAt)}`);
      console.log(`    Tasks done:  ${a.totalTasks}`);
      console.log(`    Earned:      ${formatUnits(a.totalEarned, 6)} USDC`);
      console.log();
    }
  } else {
    console.log('  (no agents registered yet)\n');
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  banner('Tasks');

  const taskCount = await pub.readContract({
    address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'getTaskCount',
  });
  console.log(`  Total tasks: ${taskCount}\n`);

  const agentAddresses = new Set();

  if (taskCount > 0n) {
    for (let i = 0n; i < taskCount; i++) {
      const t = await pub.readContract({
        address: TASK_MANAGER, abi: taskManagerAbi, functionName: 'getTask', args: [i],
      });
      agentAddresses.add(t.agent);

      console.log(`  [Task #${i}]  ${TASK_STATES[t.state]}`);
      console.log(`    Client:      ${shortAddr(t.client)}`);
      console.log(`    Agent:       ${shortAddr(t.agent)}`);
      console.log(`    Description: ${t.description.length > 60 ? t.description.slice(0, 60) + '...' : t.description}`);
      console.log(`    Payment:     ${formatUnits(t.payment, 6)} USDC`);
      if (t.resultHash) console.log(`    Result hash: ${t.resultHash}`);
      console.log(`    Created:     ${formatDate(t.createdAt)}`);
      if (t.acceptedAt > 0n)  console.log(`    Accepted:    ${formatDate(t.acceptedAt)}`);
      if (t.completedAt > 0n) console.log(`    Completed:   ${formatDate(t.completedAt)}`);
      console.log();
    }
  } else {
    console.log('  (no tasks created yet)\n');
  }

  // ── Reputations ─────────────────────────────────────────────────────────────
  banner('Agent Reputations');

  // Collect all known agent addresses from both sources
  if (agentCount > 0n) {
    const { addresses } = await pub.readContract({
      address: AGENT_REGISTRY,
      abi: registryAbi,
      functionName: 'getAgentsPaginated',
      args: [0n, agentCount],
    });
    addresses.forEach(a => agentAddresses.add(a));
  }

  if (agentAddresses.size === 0) {
    console.log('  (no agents to query)\n');
  } else {
    for (const addr of agentAddresses) {
      const rep = await pub.readContract({
        address: REPUTATION_ENGINE, abi: reputationAbi, functionName: 'getReputation', args: [addr],
      });

      const reviewCount = await pub.readContract({
        address: REPUTATION_ENGINE, abi: reputationAbi, functionName: 'getReviewCount', args: [addr],
      });

      console.log(`  [${shortAddr(addr)}]`);
      console.log(`    Avg rating:  ${rep.totalRatings > 0n ? (Number(rep.avgRatingX100) / 100).toFixed(2) + '/5' : 'N/A (no ratings)'}`);
      console.log(`    Total rated: ${rep.totalRatings}`);
      console.log(`    Reviews:     ${reviewCount}`);

      if (reviewCount > 0n) {
        const reviews = await pub.readContract({
          address: REPUTATION_ENGINE,
          abi: reputationAbi,
          functionName: 'getReviews',
          args: [addr, 0n, reviewCount],
        });
        for (const r of reviews) {
          const stars = '*'.repeat(r.rating) + '.'.repeat(5 - r.rating);
          console.log(`      [${stars}] Task #${r.taskId}: "${r.comment}" (by ${shortAddr(r.reviewer)}, ${formatDate(r.timestamp)})`);
        }
      }
      console.log();
    }
  }

  // ── Nanopayments ────────────────────────────────────────────────────────────
  banner('Nanopayment Records');

  const payCount = await pub.readContract({
    address: NANOPAY_DEMO, abi: nanopayAbi, functionName: 'getPaymentCount',
  });
  console.log(`  Total records: ${payCount}\n`);

  if (payCount > 0n) {
    const payments = await pub.readContract({
      address: NANOPAY_DEMO,
      abi: nanopayAbi,
      functionName: 'getPayments',
      args: [0n, payCount],
    });

    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      console.log(`  [Payment #${i}]`);
      console.log(`    Payer:    ${shortAddr(p.payer)}`);
      console.log(`    Agent:    ${shortAddr(p.agent)}`);
      console.log(`    Amount:   ${formatUnits(p.amount, 6)} USDC`);
      console.log(`    Type:     ${p.taskType}`);
      console.log(`    Time:     ${formatDate(p.timestamp)}`);
      console.log();
    }
  } else {
    console.log('  (no payments recorded yet)\n');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  banner('Summary');
  console.log(`  Agents registered: ${agentCount}`);
  console.log(`  Tasks created:     ${taskCount}`);
  console.log(`  Nanopay records:   ${payCount}`);
  console.log(`\n  Contracts:`);
  console.log(`    AgentRegistry:    ${AGENT_REGISTRY}`);
  console.log(`    TaskManager:      ${TASK_MANAGER}`);
  console.log(`    ReputationEngine: ${REPUTATION_ENGINE}`);
  console.log(`    NanopayDemo:      ${NANOPAY_DEMO}`);
  console.log();
}

main().catch((err) => {
  console.error('\n[x] Error:', err.shortMessage || err.message);
  process.exit(1);
});
