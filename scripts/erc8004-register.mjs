#!/usr/bin/env node
/**
 * erc8004-register.mjs — ERC-8004 AI Agent Identity Registration for ArcHive Marketplace
 *
 * Integrates ERC-8004 identity layer with the ArcHive AgentRegistry:
 *   1. Check if agent already has an ERC-8004 identity
 *   2. If not, register a new AI Agent identity on IdentityRegistry
 *   3. Give self-feedback on ReputationRegistry
 *   4. Create a validation request on ValidationRegistry
 *   5. Link the ERC-8004 identity to the ArcHive agent profile
 *
 * Usage:  node scripts/erc8004-register.mjs
 *
 * Uses Foundry cast commands via child_process (proven working on Arc Testnet).
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

// ── Config ───────────────────────────────────────────────────────────────────
const HOME = process.env.HOME || process.env.USERPROFILE;
const CAST = resolve(HOME, '.foundry/versions/stable/cast.exe');
const RPC  = 'https://rpc.testnet.arc.network';

const PK   = process.env.PRIVATE_KEY
  || '***REDACTED_TESTNET_KEY***';
const SELF = process.env.WALLET_ADDRESS
  || '***REDACTED_TESTNET_ADDR***';

// ERC-8004 contracts
const IDENTITY_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const VALIDATION_REGISTRY = '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

// ArcHive contracts
const AGENT_REGISTRY = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const TASK_MANAGER   = '0x24f9Fc5569Dab324862f4C634f1Fa7F587DB47d7';

const METADATA_URI = process.env.METADATA_URI
  || 'ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei';

const ZERO_B32 = '0x' + '0'.repeat(64);

let ok = 0;
let fail = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Execute a cast send transaction, return parsed JSON output or null on failure */
function send(label, to, sig, args, opts = {}) {
  const pk = opts.pk || PK;
  const jsonFlag = opts.json ? ' --json' : '';
  const cmd = `"${CAST}" send ${to} "${sig}" ${args} --rpc-url ${RPC} --private-key ${pk}${jsonFlag}`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
    ok++;
    console.log(`  [+] ${label}`);
    if (opts.json) {
      try { return JSON.parse(out); } catch { return out; }
    }
    return true;
  } catch (e) {
    fail++;
    const msg = e.stderr ? e.stderr.slice(0, 200) : e.message.slice(0, 200);
    console.log(`  [x] ${label}: ${msg}`);
    return opts.json ? null : false;
  }
}

/** Execute a cast call (read-only), return trimmed output or null */
function castCall(to, sig, args) {
  const cmd = `"${CAST}" call ${to} "${sig}" ${args} --rpc-url ${RPC}`;
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** Compute keccak256 via cast */
function keccak(input) {
  try {
    return execSync(`"${CAST}" keccak "${input}"`, {
      encoding: 'utf8', timeout: 5000, stdio: 'pipe',
    }).trim();
  } catch {
    return ZERO_B32;
  }
}

// ── Main Flow ────────────────────────────────────────────────────────────────

console.log('='.repeat(62));
console.log('  ERC-8004 Identity Registration for ArcHive Marketplace');
console.log('='.repeat(62));
console.log(`\n  Wallet:              ${SELF}`);
console.log(`  IdentityRegistry:    ${IDENTITY_REGISTRY}`);
console.log(`  ReputationRegistry:  ${REPUTATION_REGISTRY}`);
console.log(`  ValidationRegistry:  ${VALIDATION_REGISTRY}`);
console.log(`  ArcHive AgentReg:    ${AGENT_REGISTRY}`);

// ── Step 1: Check if agent already has an ERC-8004 identity ──────────────────
console.log('\n--- Step 1: Check existing ERC-8004 identity ---');

let agentId = null;

// Try to find an existing identity by scanning recent token IDs owned by SELF
// The IdentityRegistry is an ERC-721; we call ownerOf to find our token
const balanceRaw = castCall(IDENTITY_REGISTRY, 'balanceOf(address)(uint256)', SELF);
const balance = balanceRaw ? parseInt(balanceRaw) : 0;

if (balance > 0) {
  console.log(`  [i] Wallet owns ${balance} ERC-8004 identity token(s). Searching for agent ID...`);
  // Scan token IDs to find one owned by this wallet
  for (let tryId = 1; tryId < 3000; tryId++) {
    const owner = castCall(IDENTITY_REGISTRY, 'ownerOf(uint256)(address)', `${tryId}`);
    if (owner && owner.toLowerCase().includes(SELF.toLowerCase().slice(2))) {
      agentId = tryId;
      break;
    }
    // If ownerOf reverts (token doesn't exist), stop scanning
    if (owner === null) continue;
  }
  if (agentId) {
    console.log(`  [+] Found existing ERC-8004 identity: Agent ID ${agentId}`);
    const tokenURI = castCall(IDENTITY_REGISTRY, 'tokenURI(uint256)(string)', `${agentId}`);
    if (tokenURI) console.log(`      Metadata: ${tokenURI}`);
  }
} else {
  console.log('  [i] No existing ERC-8004 identity found for this wallet.');
}

// ── Step 2: Register new identity if needed ──────────────────────────────────
if (!agentId) {
  console.log('\n--- Step 2: Register new ERC-8004 AI Agent identity ---');

  const regOut = send(
    'IdentityRegistry.register',
    IDENTITY_REGISTRY,
    'register(string)',
    `"${METADATA_URI}"`,
    { json: true },
  );

  // Extract Agent ID from Transfer event in transaction logs
  if (regOut && regOut.logs) {
    // ERC-721 Transfer event topic: keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const transferLog = regOut.logs.find(l =>
      l.topics && l.topics[0] === TRANSFER_TOPIC
    );
    if (transferLog && transferLog.topics[3]) {
      agentId = parseInt(transferLog.topics[3], 16);
    }
  }

  // Fallback: scan recent IDs if log parsing didn't work
  if (!agentId) {
    console.log('  [i] Parsing logs failed, scanning for agent ID...');
    for (let tryId = 1; tryId < 3000; tryId++) {
      const owner = castCall(IDENTITY_REGISTRY, 'ownerOf(uint256)(address)', `${tryId}`);
      if (owner && owner.toLowerCase().includes(SELF.toLowerCase().slice(2))) {
        agentId = tryId;
        break;
      }
    }
  }

  if (agentId) {
    console.log(`  [+] Registered! Agent ID: ${agentId}`);
    const tokenURI = castCall(IDENTITY_REGISTRY, 'tokenURI(uint256)(string)', `${agentId}`);
    if (tokenURI) console.log(`      Metadata: ${tokenURI}`);
  } else {
    console.error('  [x] Could not determine Agent ID after registration. Aborting.');
    process.exit(1);
  }
} else {
  console.log('\n--- Step 2: Skipped (identity already exists) ---');
}

// ── Step 3: Give self-feedback on ReputationRegistry ─────────────────────────
console.log('\n--- Step 3: Self-feedback on ReputationRegistry ---');

const feedbackTag = 'archve_marketplace_verified';
const feedbackScore = 90 + Math.floor(Math.random() * 10); // 90-99
const tagHash = keccak(feedbackTag);

send(
  `giveFeedback (score=${feedbackScore}, tag="${feedbackTag}")`,
  REPUTATION_REGISTRY,
  'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
  `${agentId} ${feedbackScore} 0 "${feedbackTag}" "" "" "" ${tagHash}`,
);

// ── Step 4: Create validation request on ValidationRegistry ──────────────────
console.log('\n--- Step 4: Validation request on ValidationRegistry ---');

const reqLabel = `archve_identity_validation_agent${agentId}_${Date.now()}`;
const reqHash = keccak(reqLabel);
const requestURI = `ipfs://bafkreiarchve-agent-${agentId}`;

// The owner requests validation from themselves (self-validation for demo)
// In production, a dedicated validator address would be used
send(
  'validationRequest',
  VALIDATION_REGISTRY,
  'validationRequest(address,uint256,string,bytes32)',
  `${SELF} ${agentId} "${requestURI}" ${reqHash}`,
);

// Self-validate (respond to our own validation request)
send(
  'validationResponse',
  VALIDATION_REGISTRY,
  'validationResponse(bytes32,uint8,string,bytes32,string)',
  `${reqHash} 100 "" ${ZERO_B32} "archve_verified"`,
);

// Verify validation status
const valStatus = castCall(
  VALIDATION_REGISTRY,
  'getValidationStatus(bytes32)(address,uint256,uint8,bytes32,string,uint256)',
  reqHash,
);
if (valStatus) {
  console.log(`  [i] Validation status: ${valStatus.slice(0, 120)}...`);
}

// ── Step 5: Link ERC-8004 identity to ArcHive agent profile ──────────────────
console.log('\n--- Step 5: Link ERC-8004 identity to ArcHive AgentRegistry ---');

// Check if already registered on ArcHive
const isRegistered = castCall(AGENT_REGISTRY, 'isRegistered(address)(bool)', SELF);

if (isRegistered && isRegistered.includes('true')) {
  console.log('  [i] Agent already registered on ArcHive AgentRegistry.');

  // Read existing agent profile
  const agentInfo = castCall(
    AGENT_REGISTRY,
    'getAgent(address)((string,string,string,uint256,string[],bool,uint256,uint256,uint256))',
    SELF,
  );
  if (agentInfo) {
    console.log(`  [i] Current ArcHive profile: ${agentInfo.slice(0, 200)}`);
  }

  // Update the agent's description to include the ERC-8004 Agent ID
  // This links the two registries together on-chain
  const updatedDesc = `ERC-8004 Verified Agent (ID: ${agentId}) | ArcHive Marketplace AI`;
  const updateResult = send(
    `updateAgent (linking ERC-8004 ID ${agentId})`,
    AGENT_REGISTRY,
    'updateAgent(string,string,uint256)',
    `"${updatedDesc}" "" 0`,
  );

  if (!updateResult) {
    // updateAgent may not exist with that signature; try alternative approach
    // Emit a linking event by calling a generic method or just log the association
    console.log(`  [i] Could not call updateAgent. The link is recorded off-chain:`);
    console.log(`      ArcHive wallet:  ${SELF}`);
    console.log(`      ERC-8004 ID:     ${agentId}`);
    console.log(`      Identity NFT:    ${IDENTITY_REGISTRY} #${agentId}`);
  }
} else {
  // Not yet registered on ArcHive — register now with ERC-8004 reference in description
  console.log('  [i] Agent not yet registered on ArcHive. Registering with ERC-8004 link...');

  const name = `ArcHive-Agent-${agentId}`;
  const description = `ERC-8004 Verified Agent (ID: ${agentId}) | AI Marketplace Service`;
  const endpoint = `https://api.archve.demo/agent-${agentId}`;
  const price = 500000; // 0.5 USDC
  const skills = '["ai","erc8004","verified"]';

  send(
    `registerAgent on ArcHive (name="${name}")`,
    AGENT_REGISTRY,
    'registerAgent(string,string,string,uint256,string[])',
    `"${name}" "${description}" "${endpoint}" ${price} ${skills}`,
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(62));
console.log('  ERC-8004 x ArcHive Integration Summary');
console.log('='.repeat(62));
console.log(`  Wallet:              ${SELF}`);
console.log(`  ERC-8004 Agent ID:   ${agentId}`);
console.log(`  Identity NFT:        ${IDENTITY_REGISTRY} #${agentId}`);
console.log(`  Reputation Score:    ${feedbackScore} (${feedbackTag})`);
console.log(`  Validation:          ${reqHash.slice(0, 18)}...`);
console.log(`  ArcHive Registry:    ${AGENT_REGISTRY}`);
console.log(`  Explorer:            https://testnet.arcscan.app/address/${SELF}`);
console.log(`  Transactions:        ${ok} succeeded, ${fail} failed`);
console.log('='.repeat(62));
