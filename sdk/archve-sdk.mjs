// ============================================================================
// ArcHive Agent SDK
// Turn any script into an ArcHive marketplace agent in minutes.
//
// Usage:
//   import { ArcHiveAgent } from './archve-sdk.mjs';
//   const agent = new ArcHiveAgent({ privateKey: '0x...' });
//   await agent.register({ name: 'MyAgent', ... });
//   agent.onTask(async (task) => { return 'result'; });
//   await agent.start();
//
// Requirements: viem (npm install viem)
// Target chain: Arc Testnet (Chain ID 5042002)
// ============================================================================

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseUnits,
  formatUnits,
  keccak256,
  toHex,
  getContract,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Arc Testnet chain definition
// ---------------------------------------------------------------------------

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.network' },
  },
});

// ---------------------------------------------------------------------------
// Default contract addresses (Arc Testnet)
// ---------------------------------------------------------------------------

const DEFAULT_ADDRESSES = {
  AgentRegistry:    '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42',
  TaskManager:      '0x24f9Fc5569Dab324862f4C634f1Fa7F587DB47d7',
  ReputationEngine: '0xa32F3Be485F3c6CB092A67F40586E761010a96d2',
  NanopayDemo:      '0xF0707583003E3bd60008E3548E92d07D67189ED8',
  USDC:             '0x3600000000000000000000000000000000000000',
};

// ---------------------------------------------------------------------------
// Contract ABIs (minimal — only the functions the SDK needs)
// ---------------------------------------------------------------------------

const AGENT_REGISTRY_ABI = [
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name',         type: 'string'   },
      { name: '_description',  type: 'string'   },
      { name: '_endpoint',     type: 'string'   },
      { name: '_pricePerTask', type: 'uint256'  },
      { name: '_skillTags',    type: 'string[]' },
    ],
    outputs: [],
  },
  {
    name: 'updateAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name',         type: 'string'   },
      { name: '_description',  type: 'string'   },
      { name: '_endpoint',     type: 'string'   },
      { name: '_pricePerTask', type: 'uint256'  },
      { name: '_skillTags',    type: 'string[]' },
    ],
    outputs: [],
  },
  {
    name: 'deactivateAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'activateAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'getAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'name',         type: 'string'   },
          { name: 'description',  type: 'string'   },
          { name: 'endpoint',     type: 'string'   },
          { name: 'pricePerTask', type: 'uint256'  },
          { name: 'skillTags',    type: 'string[]' },
          { name: 'active',       type: 'bool'     },
          { name: 'registeredAt', type: 'uint256'  },
          { name: 'totalTasks',   type: 'uint256'  },
          { name: 'totalEarned',  type: 'uint256'  },
        ],
      },
    ],
  },
  {
    name: 'isRegistered',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

const TASK_MANAGER_ABI = [
  {
    name: 'acceptTask',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'completeTask',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId',     type: 'uint256' },
      { name: 'resultHash', type: 'string'  },
    ],
    outputs: [],
  },
  {
    name: 'getTask',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'client',      type: 'address' },
          { name: 'agent',       type: 'address' },
          { name: 'description', type: 'string'  },
          { name: 'payment',     type: 'uint256' },
          { name: 'resultHash',  type: 'string'  },
          { name: 'state',       type: 'uint8'   },
          { name: 'createdAt',   type: 'uint256' },
          { name: 'acceptedAt',  type: 'uint256' },
          { name: 'completedAt', type: 'uint256' },
          { name: 'disputedAt',  type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getTaskCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getTasksByAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
];

const REPUTATION_ENGINE_ABI = [
  {
    name: 'getReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'totalTasks',    type: 'uint256' },
      { name: 'avgRatingX100', type: 'uint256' },
      { name: 'totalRatings',  type: 'uint256' },
    ],
  },
  {
    name: 'getReviews',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agent',  type: 'address' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit',  type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'taskId',    type: 'uint256' },
          { name: 'reviewer',  type: 'address' },
          { name: 'rating',    type: 'uint8'   },
          { name: 'comment',   type: 'string'  },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
    ],
  },
];

const NANOPAY_DEMO_ABI = [
  {
    name: 'recordPayment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent',    type: 'address' },
      { name: 'amount',   type: 'uint256' },
      { name: 'taskType', type: 'string'  },
    ],
    outputs: [],
  },
];

// ---------------------------------------------------------------------------
// Task states (mirrors the Solidity enum)
// ---------------------------------------------------------------------------

const TaskState = Object.freeze({
  Created:    0,
  InProgress: 1,
  Completed:  2,
  Approved:   3,
  Disputed:   4,
  Resolved:   5,
  Cancelled:  6,
});

const TaskStateName = Object.freeze(
  Object.fromEntries(Object.entries(TaskState).map(([k, v]) => [v, k]))
);

// ---------------------------------------------------------------------------
// ArcHiveAgent
// ---------------------------------------------------------------------------

export class ArcHiveAgent extends EventEmitter {
  /**
   * Create a new ArcHiveAgent instance.
   *
   * @param {Object}  opts
   * @param {string}  opts.privateKey  - Hex private key (e.g. '0xabc...')
   * @param {string}  [opts.rpcUrl]    - RPC endpoint (defaults to Arc Testnet)
   * @param {Object}  [opts.addresses] - Override default contract addresses
   * @param {number}  [opts.pollInterval] - Polling interval in ms (default 5000)
   */
  constructor({ privateKey, rpcUrl, addresses, pollInterval } = {}) {
    super();

    if (!privateKey) {
      throw new Error('ArcHiveAgent: privateKey is required');
    }

    // Resolve addresses (allow per-contract overrides)
    this._addresses = { ...DEFAULT_ADDRESSES, ...addresses };

    // Create account from private key
    this._account = privateKeyToAccount(privateKey);

    // Define chain (use custom RPC if provided)
    const chain = rpcUrl
      ? { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } }
      : arcTestnet;

    // Public client for reads
    this._publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl || arcTestnet.rpcUrls.default.http[0]),
    });

    // Wallet client for writes
    this._walletClient = createWalletClient({
      account: this._account,
      chain,
      transport: http(rpcUrl || arcTestnet.rpcUrls.default.http[0]),
    });

    // Contract instances
    this._registry = getContract({
      address: this._addresses.AgentRegistry,
      abi: AGENT_REGISTRY_ABI,
      client: { public: this._publicClient, wallet: this._walletClient },
    });

    this._taskManager = getContract({
      address: this._addresses.TaskManager,
      abi: TASK_MANAGER_ABI,
      client: { public: this._publicClient, wallet: this._walletClient },
    });

    this._reputation = getContract({
      address: this._addresses.ReputationEngine,
      abi: REPUTATION_ENGINE_ABI,
      client: { public: this._publicClient, wallet: this._walletClient },
    });

    this._nanopay = getContract({
      address: this._addresses.NanopayDemo,
      abi: NANOPAY_DEMO_ABI,
      client: { public: this._publicClient, wallet: this._walletClient },
    });

    // Internal state
    this._taskHandler = null;
    this._pollTimer = null;
    this._pollInterval = pollInterval || 5000;
    this._processedTasks = new Set();
    this._running = false;
  }

  // -------------------------------------------------------------------------
  // Public properties
  // -------------------------------------------------------------------------

  /** The agent's wallet address. */
  get address() {
    return this._account.address;
  }

  /** Whether the polling loop is currently active. */
  get isRunning() {
    return this._running;
  }

  /** Enum of task states for convenience. */
  static get TaskState() {
    return TaskState;
  }

  /** Map from state number to name. */
  static get TaskStateName() {
    return TaskStateName;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register this wallet as an agent on the ArcHive marketplace.
   *
   * @param {Object}   opts
   * @param {string}   opts.name         - Human-readable agent name
   * @param {string}   opts.description  - What the agent does
   * @param {string}   opts.endpoint     - URL clients use to reach the agent
   * @param {number}   opts.pricePerTask - Price per task in USDC (e.g. 0.5)
   * @param {string[]} opts.skills       - Skill tags (e.g. ['ai', 'nlp'])
   * @returns {Promise<string>} Transaction hash
   */
  async register({ name, description, endpoint, pricePerTask, skills = [] }) {
    if (!name || !endpoint) {
      throw new Error('ArcHiveAgent: name and endpoint are required');
    }

    const priceWei = parseUnits(String(pricePerTask || 0), 6);

    const hash = await this._withRetry(() =>
      this._registry.write.registerAgent([
        name,
        description || '',
        endpoint,
        priceWei,
        skills,
      ])
    );

    this._log(`Registered as "${name}" — tx: ${hash}`);
    return hash;
  }

  /**
   * Update the agent's on-chain profile.
   *
   * @param {Object}   opts  - Same fields as register()
   * @returns {Promise<string>} Transaction hash
   */
  async updateProfile({ name, description, endpoint, pricePerTask, skills = [] }) {
    const priceWei = parseUnits(String(pricePerTask || 0), 6);

    const hash = await this._withRetry(() =>
      this._registry.write.updateAgent([
        name,
        description || '',
        endpoint,
        priceWei,
        skills,
      ])
    );

    this._log(`Profile updated — tx: ${hash}`);
    return hash;
  }

  /**
   * Deactivate this agent (stop appearing as available).
   * @returns {Promise<string>} Transaction hash
   */
  async deactivate() {
    const hash = await this._withRetry(() =>
      this._registry.write.deactivateAgent()
    );
    this._log(`Agent deactivated — tx: ${hash}`);
    return hash;
  }

  /**
   * Re-activate this agent.
   * @returns {Promise<string>} Transaction hash
   */
  async activate() {
    const hash = await this._withRetry(() =>
      this._registry.write.activateAgent()
    );
    this._log(`Agent activated — tx: ${hash}`);
    return hash;
  }

  /**
   * Check if this agent is registered on-chain.
   * @returns {Promise<boolean>}
   */
  async isRegistered() {
    return this._withRetry(() =>
      this._registry.read.isRegistered([this.address])
    );
  }

  /**
   * Get this agent's on-chain profile.
   * @returns {Promise<Object>}
   */
  async getProfile() {
    const raw = await this._withRetry(() =>
      this._registry.read.getAgent([this.address])
    );
    return {
      name:         raw.name,
      description:  raw.description,
      endpoint:     raw.endpoint,
      pricePerTask: Number(formatUnits(raw.pricePerTask, 6)),
      skills:       raw.skillTags,
      active:       raw.active,
      registeredAt: Number(raw.registeredAt),
      totalTasks:   Number(raw.totalTasks),
      totalEarned:  Number(formatUnits(raw.totalEarned, 6)),
    };
  }

  // -------------------------------------------------------------------------
  // Task management
  // -------------------------------------------------------------------------

  /**
   * Register a callback to handle incoming tasks.
   * The handler receives a task object and should return a result string.
   *
   * @param {Function} handler - async (task) => resultString
   */
  onTask(handler) {
    if (typeof handler !== 'function') {
      throw new Error('ArcHiveAgent: onTask handler must be a function');
    }
    this._taskHandler = handler;
  }

  /**
   * Start polling for new tasks. Requires onTask() to be set first.
   * The SDK will automatically accept, process, and complete tasks.
   */
  async start() {
    if (this._running) {
      this._log('Already running');
      return;
    }
    if (!this._taskHandler) {
      throw new Error('ArcHiveAgent: call onTask(handler) before start()');
    }

    this._running = true;
    this._log(`Listening for tasks (poll every ${this._pollInterval}ms)...`);

    // Initial poll
    await this._poll();

    // Set up interval
    this._pollTimer = setInterval(() => this._poll(), this._pollInterval);
  }

  /**
   * Stop polling for tasks.
   */
  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._running = false;
    this._log('Stopped listening for tasks');
  }

  /**
   * Get all task IDs assigned to this agent.
   * @returns {Promise<bigint[]>}
   */
  async getMyTaskIds() {
    return this._withRetry(() =>
      this._taskManager.read.getTasksByAgent([this.address])
    );
  }

  /**
   * Get full details for all tasks assigned to this agent.
   * @returns {Promise<Object[]>}
   */
  async getMyTasks() {
    const ids = await this.getMyTaskIds();
    const tasks = [];
    for (const id of ids) {
      const task = await this.getTask(id);
      tasks.push(task);
    }
    return tasks;
  }

  /**
   * Get a single task by ID.
   * @param {number|bigint} taskId
   * @returns {Promise<Object>}
   */
  async getTask(taskId) {
    const raw = await this._withRetry(() =>
      this._taskManager.read.getTask([BigInt(taskId)])
    );
    return {
      id:          BigInt(taskId),
      client:      raw.client,
      agent:       raw.agent,
      description: raw.description,
      payment:     Number(formatUnits(raw.payment, 6)),
      paymentRaw:  raw.payment,
      resultHash:  raw.resultHash,
      state:       Number(raw.state),
      stateName:   TaskStateName[Number(raw.state)],
      createdAt:   Number(raw.createdAt),
      acceptedAt:  Number(raw.acceptedAt),
      completedAt: Number(raw.completedAt),
      disputedAt:  Number(raw.disputedAt),
    };
  }

  /**
   * Accept a task (transitions Created -> InProgress).
   * @param {number|bigint} taskId
   * @returns {Promise<string>} Transaction hash
   */
  async acceptTask(taskId) {
    const hash = await this._withRetry(() =>
      this._taskManager.write.acceptTask([BigInt(taskId)])
    );
    this._log(`Accepted task #${taskId} — tx: ${hash}`);
    this.emit('task:accepted', { taskId: BigInt(taskId), txHash: hash });
    return hash;
  }

  /**
   * Complete a task with a result (transitions InProgress -> Completed).
   * @param {number|bigint} taskId
   * @param {string}        resultHash - Deliverable hash or result string
   * @returns {Promise<string>} Transaction hash
   */
  async completeTask(taskId, resultHash) {
    const hash = await this._withRetry(() =>
      this._taskManager.write.completeTask([BigInt(taskId), resultHash])
    );
    this._log(`Completed task #${taskId} — tx: ${hash}`);
    this.emit('task:completed', { taskId: BigInt(taskId), resultHash, txHash: hash });
    return hash;
  }

  // -------------------------------------------------------------------------
  // Reputation
  // -------------------------------------------------------------------------

  /**
   * Get this agent's reputation from the ReputationEngine.
   * @returns {Promise<Object>} { totalTasks, avgRating, totalRatings }
   */
  async getReputation() {
    const [totalTasks, avgRatingX100, totalRatings] = await this._withRetry(() =>
      this._reputation.read.getReputation([this.address])
    );
    return {
      totalTasks:   Number(totalTasks),
      avgRating:    Number(avgRatingX100) / 100,
      totalRatings: Number(totalRatings),
    };
  }

  /**
   * Get paginated reviews for this agent.
   * @param {number} [offset=0]
   * @param {number} [limit=10]
   * @returns {Promise<Object[]>}
   */
  async getReviews(offset = 0, limit = 10) {
    const raw = await this._withRetry(() =>
      this._reputation.read.getReviews([this.address, BigInt(offset), BigInt(limit)])
    );
    return raw.map((r) => ({
      taskId:    Number(r.taskId),
      reviewer:  r.reviewer,
      rating:    Number(r.rating),
      comment:   r.comment,
      timestamp: Number(r.timestamp),
    }));
  }

  // -------------------------------------------------------------------------
  // Nanopay
  // -------------------------------------------------------------------------

  /**
   * Record a nanopayment on NanopayDemo.
   * @param {Object} opts
   * @param {string} opts.agent    - Agent address (defaults to self)
   * @param {number} opts.amount   - USDC amount (e.g. 0.5)
   * @param {string} opts.taskType - Short description of the task type
   * @returns {Promise<string>} Transaction hash
   */
  async recordPayment({ agent, amount, taskType }) {
    const agentAddr = agent || this.address;
    const amountWei = parseUnits(String(amount), 6);

    const hash = await this._withRetry(() =>
      this._nanopay.write.recordPayment([agentAddr, amountWei, taskType])
    );
    this._log(`Recorded payment of ${amount} USDC — tx: ${hash}`);
    return hash;
  }

  // -------------------------------------------------------------------------
  // Internal: polling loop
  // -------------------------------------------------------------------------

  async _poll() {
    try {
      const taskIds = await this.getMyTaskIds();

      for (const id of taskIds) {
        const idStr = id.toString();

        // Skip tasks we have already processed
        if (this._processedTasks.has(idStr)) continue;

        let task;
        try {
          task = await this.getTask(id);
        } catch (err) {
          this._log(`Failed to fetch task #${id}: ${err.message}`);
          continue;
        }

        // Only process tasks in Created state (waiting to be accepted)
        if (task.state !== TaskState.Created) {
          // Mark non-Created tasks so we don't re-check them every poll
          if (task.state !== TaskState.InProgress) {
            this._processedTasks.add(idStr);
          }
          continue;
        }

        // Found a new task!
        this.emit('task:new', task);
        this._log(`New task #${id}: "${task.description}" (${task.payment} USDC)`);

        // Mark as processed immediately to avoid double-processing
        this._processedTasks.add(idStr);

        // Process the task in background (don't block the poll loop)
        this._processTask(task).catch((err) => {
          this._log(`Error processing task #${id}: ${err.message}`);
          this.emit('task:error', { task, error: err });
        });
      }
    } catch (err) {
      this._log(`Poll error: ${err.message}`);
    }
  }

  async _processTask(task) {
    const taskId = task.id;

    // Step 1: Accept the task
    try {
      await this.acceptTask(taskId);
    } catch (err) {
      if (this._isContractRevert(err)) {
        this._log(`Skipping task #${taskId}: contract reverted on accept — ${err.message}`);
        this.emit('task:error', { task, error: err, phase: 'accept' });
        return;
      }
      throw err;
    }

    // Step 2: Call the user's handler
    let result;
    try {
      result = await this._taskHandler({
        id:          taskId,
        client:      task.client,
        description: task.description,
        payment:     task.payment,
      });
    } catch (err) {
      this._log(`Handler error for task #${taskId}: ${err.message}`);
      this.emit('task:error', { task, error: err, phase: 'handler' });
      return;
    }

    // Ensure result is a string
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    // Step 3: Complete the task on-chain
    try {
      await this.completeTask(taskId, resultStr);
    } catch (err) {
      if (this._isContractRevert(err)) {
        this._log(`Skipping task #${taskId}: contract reverted on complete — ${err.message}`);
        this.emit('task:error', { task, error: err, phase: 'complete' });
        return;
      }
      throw err;
    }

    // Step 4: Record nanopayment (best-effort, don't fail the task)
    try {
      await this.recordPayment({
        agent: this.address,
        amount: task.payment,
        taskType: task.description.slice(0, 100),
      });
    } catch (err) {
      this._log(`Warning: failed to record nanopayment for task #${taskId}: ${err.message}`);
    }

    this._log(`Task #${taskId} fully processed`);
  }

  // -------------------------------------------------------------------------
  // Internal: retry logic
  // -------------------------------------------------------------------------

  /**
   * Execute an async function with one retry on RPC/network failure.
   * Contract reverts are NOT retried — they bubble up immediately.
   */
  async _withRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      // Don't retry contract reverts
      if (this._isContractRevert(err)) {
        throw err;
      }

      // Retry once for network/RPC errors
      this._log(`RPC error, retrying once: ${err.message}`);
      await this._sleep(1000);
      return await fn();
    }
  }

  /**
   * Check if an error is a contract revert (as opposed to an RPC/network error).
   */
  _isContractRevert(err) {
    const msg = err?.message || '';
    return (
      msg.includes('revert') ||
      msg.includes('execution reverted') ||
      msg.includes('CALL_EXCEPTION') ||
      err?.code === 'CALL_EXCEPTION'
    );
  }

  // -------------------------------------------------------------------------
  // Internal: utilities
  // -------------------------------------------------------------------------

  _log(msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[ArcHive ${ts}] ${msg}`);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Named exports for convenience
// ---------------------------------------------------------------------------

export { TaskState, TaskStateName, DEFAULT_ADDRESSES, arcTestnet };
