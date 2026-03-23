// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================================
// TaskManager.sol — Task creation, escrow, and lifecycle management
// Target: Arc Testnet (Chain ID 5042002)
// =============================================================================

// -----------------------------------------------------------------------------
// Minimal IERC20 interface (USDC on Arc Testnet, 6 decimals)
// -----------------------------------------------------------------------------
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

// -----------------------------------------------------------------------------
// AgentRegistry interface — the TaskManager relies on an external registry
// to validate agents and track completed-task counts.
// -----------------------------------------------------------------------------
interface IAgentRegistry {
    /// @notice Returns true when the agent address is registered AND active.
    function isAgentActive(address agent) external view returns (bool);

    /// @notice Increments the completed-task counter for the given agent.
    function incrementTasks(address agent, uint256 earned) external;
}

interface IReputationEngine {
    function rateAgent(address agent, uint256 taskId, uint8 rating, string calldata comment, address reviewer) external;
}

// =============================================================================
// TaskManager
// =============================================================================
contract TaskManager {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice USDC token on Arc Testnet (6 decimals).
    address public constant USDC_TOKEN = 0x3600000000000000000000000000000000000000;

    /// @notice Duration after which a dispute auto-resolves in favour of the agent.
    uint256 public constant DISPUTE_TIMEOUT = 24 hours;

    /// @notice Duration after which a client can reclaim a task the agent never accepted.
    uint256 public constant ACCEPT_TIMEOUT = 48 hours;

    /// @notice Duration after completion during which client must approve or dispute.
    ///         After this, anyone can call autoApproveTask to release payment to agent.
    uint256 public constant AUTO_APPROVE_TIMEOUT = 72 hours;

    /// @notice Minimum task age before owner can use emergencyWithdraw.
    uint256 public constant EMERGENCY_TIMEOUT = 30 days;

    // -------------------------------------------------------------------------
    // Enums & Structs
    // -------------------------------------------------------------------------

    enum TaskState {
        Created,
        InProgress,
        Completed,
        Approved,
        Disputed,
        Resolved,
        Cancelled
    }

    struct Task {
        address client;       // task creator / payer
        address agent;        // assigned agent
        string  description;  // human-readable task description
        uint256 payment;      // USDC amount (6 decimals)
        string  resultHash;   // deliverable hash submitted by agent
        TaskState state;      // current lifecycle state
        uint256 createdAt;    // block.timestamp when created
        uint256 acceptedAt;   // block.timestamp when agent accepted
        uint256 completedAt;  // block.timestamp when agent submitted result
        uint256 disputedAt;   // block.timestamp when client disputed
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Contract owner (deployer).
    address public owner;

    /// @notice Pending owner for two-step ownership transfer.
    address public pendingOwner;

    /// @notice Reference to the AgentRegistry contract.
    IAgentRegistry public agentRegistry;

    /// @notice Reference to the ReputationEngine contract.
    IReputationEngine public reputationEngine;

    /// @notice All tasks, indexed by taskId (0-based).
    Task[] public tasks;

    /// @notice Mapping: client address => array of task IDs they created.
    mapping(address => uint256[]) private _clientTasks;

    /// @notice Mapping: agent address => array of task IDs assigned to them.
    mapping(address => uint256[]) private _agentTasks;

    /// @notice Mapping: taskId => whether the task has already been rated.
    mapping(uint256 => bool) private _taskRated;

    /// @notice Running total of USDC (6 decimals) paid out to agents.
    uint256 public totalVolume;

    /// @notice Running count of tasks that reached Approved / Resolved (agent paid).
    uint256 public totalApprovedTasks;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TaskCreated(uint256 indexed taskId, address indexed client, address indexed agent, uint256 payment);
    event TaskAccepted(uint256 indexed taskId, address indexed agent);
    event TaskCompleted(uint256 indexed taskId, address indexed agent, string resultHash);
    event TaskApproved(uint256 indexed taskId, address indexed client, address indexed agent, uint256 payment);
    event TaskDisputed(uint256 indexed taskId, address indexed client);
    event TaskResolved(uint256 indexed taskId, address indexed agent, uint256 payment);
    event TaskCancelled(uint256 indexed taskId, address indexed client, uint256 refund);
    event TaskAutoApproved(uint256 indexed taskId, address indexed agent, uint256 payment);
    event DisputeResolvedByOwner(uint256 indexed taskId, bool favorAgent);
    event EmergencyWithdraw(uint256 indexed taskId, uint256 amount);
    event ReputationEngineUpdated(address indexed oldAddr, address indexed newAddr);
    event AgentRegistryUpdated(address indexed oldAddr, address indexed newAddr);
    event OwnershipTransferProposed(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "TaskManager: caller is not the owner");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _agentRegistry Address of the deployed AgentRegistry contract.
    constructor(address _agentRegistry) {
        require(_agentRegistry != address(0), "TaskManager: zero address registry");
        owner = msg.sender;
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // -------------------------------------------------------------------------
    // Core Functions
    // -------------------------------------------------------------------------

    /// @notice Create a new task and escrow USDC payment in this contract.
    /// @dev Caller must have approved this contract to spend `payment` USDC beforehand.
    /// @param agent   The agent assigned to the task (must be registered & active).
    /// @param description  Human-readable description of the work.
    /// @param payment USDC amount (6 decimals) to escrow.
    /// @return taskId The ID of the newly created task.
    function createTask(
        address agent,
        string calldata description,
        uint256 payment
    ) external returns (uint256 taskId) {
        require(agent != address(0), "TaskManager: zero address agent");
        require(msg.sender != agent, "TaskManager: cannot hire yourself");
        require(payment > 0, "TaskManager: payment must be > 0");
        require(agentRegistry.isAgentActive(agent), "TaskManager: agent not registered or inactive");

        // Transfer USDC from client to this contract (escrow).
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(
            usdc.transferFrom(msg.sender, address(this), payment),
            "TaskManager: USDC transfer failed"
        );

        // Create task.
        taskId = tasks.length;
        tasks.push(Task({
            client:      msg.sender,
            agent:       agent,
            description: description,
            payment:     payment,
            resultHash:  "",
            state:       TaskState.Created,
            createdAt:   block.timestamp,
            acceptedAt:  0,
            completedAt: 0,
            disputedAt:  0
        }));

        // Track by client and agent.
        _clientTasks[msg.sender].push(taskId);
        _agentTasks[agent].push(taskId);

        emit TaskCreated(taskId, msg.sender, agent, payment);
    }

    /// @notice Agent accepts an assigned task. Transitions Created -> InProgress.
    /// @param taskId The task to accept.
    function acceptTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.agent, "TaskManager: caller is not the assigned agent");
        require(t.state == TaskState.Created, "TaskManager: task is not in Created state");

        t.state = TaskState.InProgress;
        t.acceptedAt = block.timestamp;

        emit TaskAccepted(taskId, msg.sender);
    }

    /// @notice Agent submits a result for the task. Transitions InProgress -> Completed.
    /// @param taskId     The task to complete.
    /// @param resultHash Hash or reference to the deliverable.
    function completeTask(uint256 taskId, string calldata resultHash) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.agent, "TaskManager: caller is not the assigned agent");
        require(t.state == TaskState.InProgress, "TaskManager: task is not InProgress");

        t.resultHash = resultHash;
        t.state = TaskState.Completed;
        t.completedAt = block.timestamp;

        emit TaskCompleted(taskId, msg.sender, resultHash);
    }

    /// @notice Client approves the completed work. Releases escrowed USDC to agent
    ///         and increments the agent's task count in the registry.
    ///         Transitions Completed -> Approved.
    /// @param taskId The task to approve.
    function approveTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.client, "TaskManager: caller is not the client");
        require(t.state == TaskState.Completed, "TaskManager: task is not Completed");

        t.state = TaskState.Approved;

        // Release USDC to the agent.
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(t.agent, t.payment), "TaskManager: USDC transfer to agent failed");

        // Update agent stats in registry.
        agentRegistry.incrementTasks(t.agent, t.payment);

        // Update aggregate market stats.
        totalVolume += t.payment;
        totalApprovedTasks += 1;

        emit TaskApproved(taskId, msg.sender, t.agent, t.payment);
    }

    /// @notice Auto-approve a task if the client has not approved or disputed within 72h
    ///         after the agent submitted the result. Anyone can call this.
    /// @param taskId The task to auto-approve.
    function autoApproveTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(t.state == TaskState.Completed, "TaskManager: task is not Completed");
        require(
            block.timestamp >= t.completedAt + AUTO_APPROVE_TIMEOUT,
            "TaskManager: auto-approve timeout not reached"
        );

        t.state = TaskState.Approved;

        // Release USDC to the agent.
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(t.agent, t.payment), "TaskManager: USDC transfer to agent failed");

        // Update agent stats in registry.
        agentRegistry.incrementTasks(t.agent, t.payment);

        // Update aggregate market stats.
        totalVolume += t.payment;
        totalApprovedTasks += 1;

        emit TaskAutoApproved(taskId, t.agent, t.payment);
    }

    /// @notice Client rates the agent after task approval.
    function rateAgent(uint256 taskId, uint8 rating, string calldata comment) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.client, "TaskManager: caller is not the client");
        require(t.state == TaskState.Approved || t.state == TaskState.Resolved, "TaskManager: task not approved/resolved");
        require(address(reputationEngine) != address(0), "TaskManager: reputation engine not set");
        require(!_taskRated[taskId], "TaskManager: task already rated");

        _taskRated[taskId] = true;
        reputationEngine.rateAgent(t.agent, taskId, rating, comment, msg.sender);
    }

    /// @notice Set the ReputationEngine contract address.
    function setReputationEngine(address _reputationEngine) external onlyOwner {
        require(_reputationEngine != address(0), "TaskManager: zero address");
        address oldReputationEngine = address(reputationEngine);
        reputationEngine = IReputationEngine(_reputationEngine);
        emit ReputationEngineUpdated(oldReputationEngine, _reputationEngine);
    }

    /// @notice Client disputes the completed work. Transitions Completed -> Disputed.
    /// @param taskId The task to dispute.
    function disputeTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.client, "TaskManager: caller is not the client");
        require(t.state == TaskState.Completed, "TaskManager: task is not Completed");

        t.state = TaskState.Disputed;
        t.disputedAt = block.timestamp;

        emit TaskDisputed(taskId, msg.sender);
    }

    /// @notice Anyone can resolve a dispute after 24 hours. Auto-resolves in favour
    ///         of the agent (releases escrowed USDC). Transitions Disputed -> Resolved.
    /// @param taskId The disputed task.
    function resolveDispute(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(t.state == TaskState.Disputed, "TaskManager: task is not Disputed");
        require(
            block.timestamp >= t.disputedAt + DISPUTE_TIMEOUT,
            "TaskManager: dispute timeout not reached"
        );

        t.state = TaskState.Resolved;

        // Release USDC to the agent.
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(t.agent, t.payment), "TaskManager: USDC transfer to agent failed");

        emit TaskResolved(taskId, t.agent, t.payment);
    }

    /// @notice Owner resolves a disputed task, deciding in favour of agent or client.
    /// @param taskId    The disputed task.
    /// @param favorAgent If true, payment goes to agent; if false, refund to client.
    function ownerResolveDispute(uint256 taskId, bool favorAgent) external onlyOwner {
        Task storage t = _getTask(taskId);
        require(t.state == TaskState.Disputed, "TaskManager: task is not Disputed");

        t.state = TaskState.Resolved;

        IERC20 usdc = IERC20(USDC_TOKEN);
        if (favorAgent) {
            require(usdc.transfer(t.agent, t.payment), "TaskManager: USDC transfer to agent failed");

            // Update aggregate market stats.
            totalVolume += t.payment;
            totalApprovedTasks += 1;

            emit TaskResolved(taskId, t.agent, t.payment);
        } else {
            require(usdc.transfer(t.client, t.payment), "TaskManager: USDC refund to client failed");
            emit TaskCancelled(taskId, t.client, t.payment);
        }

        emit DisputeResolvedByOwner(taskId, favorAgent);
    }

    /// @notice Client cancels a task that has not been accepted yet.
    ///         Refunds escrowed USDC. Transitions Created -> Cancelled.
    /// @param taskId The task to cancel.
    function cancelTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.client, "TaskManager: caller is not the client");
        require(t.state == TaskState.Created, "TaskManager: task is not in Created state");

        t.state = TaskState.Cancelled;

        // Refund USDC to client.
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(t.client, t.payment), "TaskManager: USDC refund failed");

        emit TaskCancelled(taskId, msg.sender, t.payment);
    }

    /// @notice Client reclaims a task if the agent has not accepted within 48 hours.
    ///         Refunds escrowed USDC. Transitions Created -> Cancelled.
    /// @param taskId The task to reclaim.
    function reclaimTask(uint256 taskId) external {
        Task storage t = _getTask(taskId);
        require(msg.sender == t.client, "TaskManager: caller is not the client");
        require(t.state == TaskState.Created, "TaskManager: task is not in Created state");
        require(
            block.timestamp >= t.createdAt + ACCEPT_TIMEOUT,
            "TaskManager: accept timeout not reached"
        );

        t.state = TaskState.Cancelled;

        // Refund USDC to client.
        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(t.client, t.payment), "TaskManager: USDC refund failed");

        emit TaskCancelled(taskId, msg.sender, t.payment);
    }

    // -------------------------------------------------------------------------
    // Emergency
    // -------------------------------------------------------------------------

    /// @notice Owner-only emergency withdrawal for tasks older than 30 days that are
    ///         stuck in a non-terminal state. Sends escrowed USDC to the owner.
    /// @param taskId The task to emergency-withdraw from.
    function emergencyWithdraw(uint256 taskId) external onlyOwner {
        Task storage t = _getTask(taskId);
        require(
            t.state != TaskState.Approved &&
            t.state != TaskState.Resolved &&
            t.state != TaskState.Cancelled,
            "TaskManager: task already finalized"
        );
        require(
            block.timestamp >= t.createdAt + EMERGENCY_TIMEOUT,
            "TaskManager: task is not old enough"
        );

        t.state = TaskState.Cancelled;

        IERC20 usdc = IERC20(USDC_TOKEN);
        require(usdc.transfer(owner, t.payment), "TaskManager: USDC emergency transfer failed");

        emit EmergencyWithdraw(taskId, t.payment);
    }

    // -------------------------------------------------------------------------
    // Ownership Transfer (Two-Step)
    // -------------------------------------------------------------------------

    /// @notice Propose a new owner. The new owner must call acceptOwnership() to finalize.
    /// @param newOwner Address of the proposed new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "TaskManager: zero address");
        require(newOwner != owner, "TaskManager: already the owner");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner);
    }

    /// @notice Accept ownership after being proposed by the current owner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "TaskManager: caller is not the pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    // -------------------------------------------------------------------------
    // View / Query Functions
    // -------------------------------------------------------------------------

    /// @notice Returns full Task struct for a given taskId.
    function getTask(uint256 taskId) external view returns (Task memory) {
        require(taskId < tasks.length, "TaskManager: task does not exist");
        return tasks[taskId];
    }

    /// @notice Returns the total number of tasks created.
    function getTaskCount() external view returns (uint256) {
        return tasks.length;
    }

    /// @notice Returns all task IDs created by a given client.
    function getTasksByClient(address client) external view returns (uint256[] memory) {
        return _clientTasks[client];
    }

    /// @notice Returns all task IDs assigned to a given agent.
    function getTasksByAgent(address agent) external view returns (uint256[] memory) {
        return _agentTasks[agent];
    }

    /// @notice Returns aggregate marketplace statistics in a single call.
    /// @return totalTasks     Total number of tasks ever created.
    /// @return approvedTasks  Number of tasks where the agent was paid out.
    /// @return volume         Total USDC (6 decimals) paid out to agents.
    function getMarketStats() external view returns (uint256 totalTasks, uint256 approvedTasks, uint256 volume) {
        totalTasks    = tasks.length;
        approvedTasks = totalApprovedTasks;
        volume        = totalVolume;
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    /// @dev Fetches a task by ID with bounds check, returning a storage pointer.
    function _getTask(uint256 taskId) internal view returns (Task storage) {
        require(taskId < tasks.length, "TaskManager: task does not exist");
        return tasks[taskId];
    }
}
