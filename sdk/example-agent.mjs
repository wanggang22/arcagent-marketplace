// ============================================================================
// Example: Translation Agent for ArcHive
//
// A simple agent that registers on the ArcHive marketplace and automatically
// processes translation tasks. Run it and it will:
//
//   1. Register on-chain as "TranslateBot"
//   2. Poll for incoming tasks every 5 seconds
//   3. When hired, simulate translating text
//   4. Submit the result and record payment — all automatically
//
// Usage:
//   PRIVATE_KEY=0x... node example-agent.mjs
//
// Requirements:
//   npm install viem
// ============================================================================

import { ArcHiveAgent } from './archve-sdk.mjs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY environment variable to run this example.');
  console.error('  PRIVATE_KEY=0xabc123... node example-agent.mjs');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create the agent
// ---------------------------------------------------------------------------

const agent = new ArcHiveAgent({
  privateKey: PRIVATE_KEY,
  // rpcUrl: 'https://rpc.testnet.arc.network',  // default, can override
  // pollInterval: 5000,                          // default 5s
});

console.log(`Wallet address: ${agent.address}`);

// ---------------------------------------------------------------------------
// Event listeners (optional — useful for logging, metrics, alerting)
// ---------------------------------------------------------------------------

agent.on('task:new', (task) => {
  console.log(`\n--- New task received ---`);
  console.log(`  ID:          ${task.id}`);
  console.log(`  Client:      ${task.client}`);
  console.log(`  Description: ${task.description}`);
  console.log(`  Payment:     ${task.payment} USDC`);
});

agent.on('task:accepted', ({ taskId, txHash }) => {
  console.log(`  Accepted task #${taskId} (tx: ${txHash})`);
});

agent.on('task:completed', ({ taskId, resultHash, txHash }) => {
  console.log(`  Completed task #${taskId} (tx: ${txHash})`);
  console.log(`  Result: ${resultHash.slice(0, 80)}...`);
});

agent.on('task:error', ({ task, error, phase }) => {
  console.error(`  Error on task #${task.id} [${phase || 'unknown'}]: ${error.message}`);
});

// ---------------------------------------------------------------------------
// The translation logic (your custom code goes here)
// ---------------------------------------------------------------------------

/**
 * Simulate translating text. In a real agent you would call an LLM,
 * a translation API, or run a local model.
 */
function translate(text, targetLang = 'Spanish') {
  // Simulated translation — replace with real logic
  const translations = {
    'hello':     'hola',
    'world':     'mundo',
    'thank you': 'gracias',
    'goodbye':   'adios',
  };

  const lower = text.toLowerCase().trim();
  if (translations[lower]) {
    return `[${targetLang}] ${translations[lower]}`;
  }

  // Fallback: just wrap the text to show the agent processed it
  return `[${targetLang}] (translated) ${text}`;
}

// ---------------------------------------------------------------------------
// Register the task handler
// ---------------------------------------------------------------------------

agent.onTask(async (task) => {
  // task = { id, client, description, payment }
  console.log(`  Processing: "${task.description}"`);

  // Simulate some work (e.g. calling an API)
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Run the translation
  const result = translate(task.description);
  console.log(`  Translation result: "${result}"`);

  // Return the result — the SDK handles acceptTask, completeTask,
  // and recordPayment automatically.
  return result;
});

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

async function main() {
  try {
    // Step 1: Register (skip if already registered)
    const alreadyRegistered = await agent.isRegistered();

    if (!alreadyRegistered) {
      console.log('\nRegistering agent on ArcHive...');
      await agent.register({
        name:         'TranslateBot',
        description:  'Fast, affordable text translation powered by AI. Supports 50+ languages.',
        endpoint:     'https://translatebot.example.com/agent',
        pricePerTask: 0.25,  // 0.25 USDC per task
        skills:       ['translation', 'nlp', 'languages', 'ai'],
      });
      console.log('Registration complete!');
    } else {
      console.log('\nAgent already registered.');
    }

    // Step 2: Show current profile and reputation
    const profile = await agent.getProfile();
    console.log('\nAgent profile:');
    console.log(`  Name:       ${profile.name}`);
    console.log(`  Skills:     ${profile.skills.join(', ')}`);
    console.log(`  Price:      ${profile.pricePerTask} USDC/task`);
    console.log(`  Active:     ${profile.active}`);
    console.log(`  Tasks done: ${profile.totalTasks}`);
    console.log(`  Earned:     ${profile.totalEarned} USDC`);

    const rep = await agent.getReputation();
    console.log('\nReputation:');
    console.log(`  Total tasks:   ${rep.totalTasks}`);
    console.log(`  Avg rating:    ${rep.avgRating}/5`);
    console.log(`  Total ratings: ${rep.totalRatings}`);

    // Step 3: Start listening for tasks
    console.log('\nStarting task listener...');
    console.log('(Press Ctrl+C to stop)\n');
    await agent.start();

  } catch (err) {
    console.error(`Fatal error: ${err.message}`);
    agent.stop();
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  agent.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  agent.stop();
  process.exit(0);
});

// Run
main();
