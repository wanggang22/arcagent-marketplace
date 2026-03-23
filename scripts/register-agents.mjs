#!/usr/bin/env node
/**
 * register-agents.mjs — Register 3 demo AI agents on ArcHive Marketplace
 *
 * Usage:  node scripts/register-agents.mjs
 */

import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Config ────────────────────────────────────────────────────────────────────
const ARC_RPC = 'https://rpc.testnet.arc.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '***REDACTED_TESTNET_KEY***';
const AGENT_REGISTRY = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';

// ── Arc Testnet chain definition ──────────────────────────────────────────────
const arcTestnet = defineChain({
  id: 1637,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

// ── ABI (only the functions we need) ──────────────────────────────────────────
const registryAbi = parseAbi([
  'function registerAgent(string _name, string _description, string _endpoint, uint256 _pricePerTask, string[] _skillTags)',
  'function isRegistered(address _agent) view returns (bool)',
  'function getAgent(address _agent) view returns ((string name, string description, string endpoint, uint256 pricePerTask, string[] skillTags, bool active, uint256 registeredAt, uint256 totalTasks, uint256 totalEarned))',
  'event AgentRegistered(address indexed agent, string name)',
]);

// ── Demo agents to register ───────────────────────────────────────────────────
const DEMO_AGENTS = [
  {
    name: 'DataAnalyst-AI',
    description: 'Data analysis and visualization',
    endpoint: 'https://api.archive.demo/data-analyst',
    price: 500_000n,        // 0.5 USDC
    skills: ['data', 'analytics', 'visualization'],
  },
  {
    name: 'TranslateBot',
    description: 'Multi-language translation service',
    endpoint: 'https://api.archive.demo/translate',
    price: 100_000n,        // 0.1 USDC
    skills: ['translation', 'nlp', 'language'],
  },
  {
    name: 'CodeReviewer',
    description: 'Smart contract code review',
    endpoint: 'https://api.archive.demo/code-review',
    price: 1_000_000n,      // 1.0 USDC
    skills: ['solidity', 'audit', 'security'],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('  ArcHive Marketplace — Register Demo Agents');
  console.log('='.repeat(60));

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`\n[*] Wallet: ${account.address}`);

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  // Check if already registered (one address can only register once)
  const alreadyRegistered = await publicClient.readContract({
    address: AGENT_REGISTRY,
    abi: registryAbi,
    functionName: 'isRegistered',
    args: [account.address],
  });

  if (alreadyRegistered) {
    console.log('\n[!] This wallet is already registered as an agent.');
    const agent = await publicClient.readContract({
      address: AGENT_REGISTRY,
      abi: registryAbi,
      functionName: 'getAgent',
      args: [account.address],
    });
    console.log(`    Name: ${agent.name}`);
    console.log(`    Description: ${agent.description}`);
    console.log(`    Price: ${Number(agent.pricePerTask) / 1e6} USDC`);
    console.log(`    Skills: ${agent.skillTags.join(', ')}`);
    console.log(`    Active: ${agent.active}`);
    console.log('\n[i] Skipping registration. To register different agents, use different wallets.');
    console.log('[i] Proceeding to register remaining agents if using separate keys...\n');
  }

  // Since one wallet = one agent, we register only the first unregistered agent
  // In a real scenario you would use 3 different wallets
  // For this demo, we register the first agent from our single wallet
  if (!alreadyRegistered) {
    const agent = DEMO_AGENTS[0]; // Register first agent with our wallet
    console.log(`\n[>] Registering agent: "${agent.name}"`);
    console.log(`    Description: ${agent.description}`);
    console.log(`    Price: ${Number(agent.price) / 1e6} USDC`);
    console.log(`    Skills: [${agent.skills.join(', ')}]`);

    try {
      const hash = await walletClient.writeContract({
        address: AGENT_REGISTRY,
        abi: registryAbi,
        functionName: 'registerAgent',
        args: [agent.name, agent.description, agent.endpoint, agent.price, agent.skills],
      });

      console.log(`    Tx: ${hash}`);
      console.log('    Waiting for confirmation...');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`    [+] Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);
    } catch (err) {
      console.error(`    [x] Failed: ${err.shortMessage || err.message}`);
    }
  }

  // Show info about the other agents that would need separate wallets
  console.log('\n--- Additional agents (require separate wallets) ---');
  for (const agent of DEMO_AGENTS.slice(1)) {
    console.log(`  - ${agent.name}: ${agent.description} @ ${Number(agent.price) / 1e6} USDC`);
    console.log(`    Skills: [${agent.skills.join(', ')}]`);
  }

  console.log('\n[i] To register all 3 agents, fund W1 and W2 with testnet ETH');
  console.log('    and run separate registration calls from each wallet.\n');
  console.log('='.repeat(60));
  console.log('  Registration complete!');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n[x] Fatal error:', err.message);
  process.exit(1);
});
