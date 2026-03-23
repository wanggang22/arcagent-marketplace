// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentRegistry
/// @notice AI Agent service marketplace registry for Arc Testnet (Chain ID 5042002).
///         USDC is the native gas token; pricePerTask is denominated in USDC with 6 decimals.
/// @dev    ERC-8004 agent-identity integration is handled externally via scripts/frontend.
///         This contract only tracks agent metadata and task accounting.
contract AgentRegistry {

    // ──────────────────────────────────────────────
    //  Types
    // ──────────────────────────────────────────────

    /// @notice Full on-chain profile for a registered AI agent.
    struct Agent {
        string   name;           // Human-readable agent name
        string   description;    // Short description of what the agent does
        string   endpoint;       // URL or URI clients use to reach the agent
        uint256  pricePerTask;   // Cost per task in USDC (6 decimals, e.g. 1_000_000 = 1 USDC)
        string[] skillTags;      // Searchable skill/category tags
        bool     active;         // Whether the agent is currently accepting tasks
        uint256  registeredAt;   // Block timestamp of initial registration
        uint256  totalTasks;     // Lifetime tasks completed
        uint256  totalEarned;    // Lifetime USDC earned (6 decimals)
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice Contract deployer / admin.
    address public owner;

    /// @notice Pending owner for two-step ownership transfer.
    address public pendingOwner;

    /// @notice Authorised TaskManager contract that may call `incrementTasks`.
    address public taskManager;

    /// @dev    agent address → Agent struct
    mapping(address => Agent) private _agents;

    /// @dev    Ordered list of every address that has ever registered.
    address[] private _agentAddresses;

    /// @dev    Quick lookup to avoid duplicate entries in _agentAddresses.
    mapping(address => bool) private _registered;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event AgentRegistered(address indexed agent, string name);
    event AgentUpdated(address indexed agent);
    event AgentDeactivated(address indexed agent);
    event AgentActivated(address indexed agent);
    event AgentUnregistered(address indexed agent);
    event TaskManagerUpdated(address indexed oldAddr, address indexed newAddr);
    event OwnershipTransferProposed(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentRegistry: caller is not the owner");
        _;
    }

    modifier onlyTaskManager() {
        require(
            msg.sender == taskManager && taskManager != address(0),
            "AgentRegistry: caller is not the task manager"
        );
        _;
    }

    modifier onlyRegistered() {
        require(_registered[msg.sender], "AgentRegistry: agent not registered");
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /// @notice Deploys the registry and sets the caller as owner.
    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────────────
    //  Agent Registration
    // ──────────────────────────────────────────────

    /// @notice Register a new AI agent on the marketplace.
    /// @param _name         Human-readable name.
    /// @param _description  Short description of capabilities.
    /// @param _endpoint     Service endpoint URL.
    /// @param _pricePerTask Cost per task in USDC (6 decimals).
    /// @param _skillTags    Array of skill/category tags.
    function registerAgent(
        string calldata _name,
        string calldata _description,
        string calldata _endpoint,
        uint256 _pricePerTask,
        string[] calldata _skillTags
    ) external {
        require(!_registered[msg.sender], "AgentRegistry: already registered");
        require(bytes(_name).length > 0, "AgentRegistry: name is required");
        require(bytes(_endpoint).length > 0, "AgentRegistry: endpoint is required");
        require(_skillTags.length <= 20, "AgentRegistry: too many tags");

        Agent storage a = _agents[msg.sender];
        a.name         = _name;
        a.description  = _description;
        a.endpoint     = _endpoint;
        a.pricePerTask = _pricePerTask;
        a.active       = true;
        a.registeredAt = block.timestamp;

        // Copy skill tags into storage
        for (uint256 i = 0; i < _skillTags.length; i++) {
            a.skillTags.push(_skillTags[i]);
        }

        _agentAddresses.push(msg.sender);
        _registered[msg.sender] = true;

        emit AgentRegistered(msg.sender, _name);
    }

    // ──────────────────────────────────────────────
    //  Agent Updates
    // ──────────────────────────────────────────────

    /// @notice Update an existing agent's profile. Caller must be the registered agent.
    /// @param _name         New name.
    /// @param _description  New description.
    /// @param _endpoint     New endpoint URL.
    /// @param _pricePerTask New price per task in USDC (6 decimals).
    /// @param _skillTags    New skill tags (replaces existing).
    function updateAgent(
        string calldata _name,
        string calldata _description,
        string calldata _endpoint,
        uint256 _pricePerTask,
        string[] calldata _skillTags
    ) external onlyRegistered {
        require(bytes(_name).length > 0, "AgentRegistry: name is required");
        require(bytes(_endpoint).length > 0, "AgentRegistry: endpoint is required");
        require(_skillTags.length <= 20, "AgentRegistry: too many tags");

        Agent storage a = _agents[msg.sender];
        a.name         = _name;
        a.description  = _description;
        a.endpoint     = _endpoint;
        a.pricePerTask = _pricePerTask;

        // Replace skill tags
        delete a.skillTags;
        for (uint256 i = 0; i < _skillTags.length; i++) {
            a.skillTags.push(_skillTags[i]);
        }

        emit AgentUpdated(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Unregister
    // ──────────────────────────────────────────────

    /// @notice Unregister the caller's agent, clearing all data and marking as unregistered.
    function unregisterAgent() external onlyRegistered {
        Agent storage a = _agents[msg.sender];
        delete a.name;
        delete a.description;
        delete a.endpoint;
        a.pricePerTask = 0;
        delete a.skillTags;
        a.active = false;
        a.registeredAt = 0;
        a.totalTasks = 0;
        a.totalEarned = 0;

        _registered[msg.sender] = false;

        emit AgentUnregistered(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Activation / Deactivation
    // ──────────────────────────────────────────────

    /// @notice Deactivate the caller's agent (stops appearing as available).
    function deactivateAgent() external onlyRegistered {
        require(_agents[msg.sender].active, "AgentRegistry: already inactive");
        _agents[msg.sender].active = false;
        emit AgentDeactivated(msg.sender);
    }

    /// @notice Re-activate the caller's agent.
    function activateAgent() external onlyRegistered {
        require(!_agents[msg.sender].active, "AgentRegistry: already active");
        _agents[msg.sender].active = true;
        emit AgentActivated(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Task Accounting
    // ──────────────────────────────────────────────

    /// @notice Increment an agent's completed-task count and earnings.
    ///         Only callable by the authorised TaskManager contract.
    /// @param _agent  Address of the agent that completed the task.
    /// @param _earned Amount of USDC earned for this task (6 decimals).
    function incrementTasks(address _agent, uint256 _earned) external onlyTaskManager {
        require(_registered[_agent], "AgentRegistry: agent not registered");

        _agents[_agent].totalTasks  += 1;
        _agents[_agent].totalEarned += _earned;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    /// @notice Set the authorised TaskManager contract address. Only owner.
    /// @param _taskManager Address of the TaskManager contract.
    function setTaskManager(address _taskManager) external onlyOwner {
        require(_taskManager != address(0), "AgentRegistry: zero address");
        address oldTaskManager = taskManager;
        taskManager = _taskManager;
        emit TaskManagerUpdated(oldTaskManager, _taskManager);
    }

    // ──────────────────────────────────────────────
    //  Ownership Transfer (Two-Step)
    // ──────────────────────────────────────────────

    /// @notice Propose a new owner. The new owner must call acceptOwnership() to finalize.
    /// @param newOwner Address of the proposed new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AgentRegistry: zero address");
        require(newOwner != owner, "AgentRegistry: already the owner");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner);
    }

    /// @notice Accept ownership after being proposed by the current owner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "AgentRegistry: caller is not the pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    // ──────────────────────────────────────────────
    //  View / Query Functions
    // ──────────────────────────────────────────────

    /// @notice Return the full Agent struct for a given address.
    /// @param _agent Address to look up.
    /// @return The Agent struct (all fields).
    function getAgent(address _agent) external view returns (Agent memory) {
        return _agents[_agent];
    }

    /// @notice Paginated list of agents and their addresses.
    /// @param _offset Starting index in the registry.
    /// @param _limit  Maximum number of agents to return.
    /// @return agents    Array of Agent structs.
    /// @return addresses Array of corresponding agent addresses.
    function getAgentsPaginated(
        uint256 _offset,
        uint256 _limit
    ) external view returns (Agent[] memory agents, address[] memory addresses) {
        uint256 total = _agentAddresses.length;

        // If offset is beyond the list, return empty arrays
        if (_offset >= total) {
            return (new Agent[](0), new address[](0));
        }

        // Clamp limit so we don't read past the end
        uint256 remaining = total - _offset;
        uint256 count = _limit < remaining ? _limit : remaining;

        agents    = new Agent[](count);
        addresses = new address[](count);

        for (uint256 i = 0; i < count; i++) {
            address addr = _agentAddresses[_offset + i];
            agents[i]    = _agents[addr];
            addresses[i] = addr;
        }
    }

    /// @notice Total number of agents ever registered.
    function getAgentCount() external view returns (uint256) {
        return _agentAddresses.length;
    }

    /// @notice Check whether an address has a registered agent.
    /// @param _agent Address to check.
    /// @return True if the address has registered an agent.
    function isRegistered(address _agent) external view returns (bool) {
        return _registered[_agent];
    }

    /// @notice Check if an agent is registered and active
    function isAgentActive(address _agent) external view returns (bool) {
        return _registered[_agent] && _agents[_agent].active;
    }
}
