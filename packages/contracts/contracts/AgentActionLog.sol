// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentActionLog
 * @notice Every decision the triage agent makes, hashed and anchored on-chain.
 *
 * @dev This is the contract that answers "who is accountable for the AI?".
 * The agent cannot act without leaving a record: each action writes the hash of
 * its full payload here, so the reasoning behind any clinical recommendation
 * can be proven after the fact and cannot be quietly revised.
 *
 * Only payload *hashes* are stored. The reasoning itself lives off-chain; this
 * contract proves it existed, when, and that it has not changed since.
 *
 * The agent's key is registered as an operator. It is deliberately NOT able to
 * move funds — see EmergencyEscrow, where release is gated to a human.
 */
contract AgentActionLog {
    struct AgentAction {
        address agent;
        uint64 timestamp;
        uint8 actionType;
        bytes32 payloadHash;
    }

    uint8 public constant ACTION_TRIAGE_ASSESSMENT = 1;
    uint8 public constant ACTION_CONTRAINDICATION_ALERT = 2;
    uint8 public constant ACTION_SBAR_HANDOFF = 3;
    uint8 public constant ACTION_CONTACTS_NOTIFIED = 4;
    uint8 public constant ACTION_ER_NOTIFIED = 5;
    uint8 public constant ACTION_PREAUTH_PACKET = 6;
    uint8 public constant ACTION_FLAGGED_FOR_HUMAN = 7;

    address public admin;
    mapping(address => bool) public isAgent;
    mapping(bytes32 => AgentAction[]) private actions;

    event AgentAuthorized(address indexed agent);
    event AgentDeauthorized(address indexed agent);
    event ActionLogged(
        bytes32 indexed patientHash,
        address indexed agent,
        uint8 indexed actionType,
        bytes32 payloadHash,
        uint64 timestamp
    );

    error NotAdmin();
    error NotAuthorizedAgent();
    error InvalidActionType();
    error ZeroAddress();

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function authorizeAgent(address agent) external onlyAdmin {
        if (agent == address(0)) revert ZeroAddress();

        isAgent[agent] = true;
        emit AgentAuthorized(agent);
    }

    function deauthorizeAgent(address agent) external onlyAdmin {
        isAgent[agent] = false;
        emit AgentDeauthorized(agent);
    }

    /// @notice Anchor one agent action. Called by the agent itself, autonomously.
    function logAction(bytes32 patientHash, uint8 actionType, bytes32 payloadHash) external {
        if (!isAgent[msg.sender]) revert NotAuthorizedAgent();
        if (actionType == 0 || actionType > ACTION_FLAGGED_FOR_HUMAN) revert InvalidActionType();

        actions[patientHash].push(
            AgentAction({
                agent: msg.sender,
                timestamp: uint64(block.timestamp),
                actionType: actionType,
                payloadHash: payloadHash
            })
        );

        emit ActionLogged(
            patientHash, msg.sender, actionType, payloadHash, uint64(block.timestamp)
        );
    }

    function getActions(bytes32 patientHash) external view returns (AgentAction[] memory) {
        return actions[patientHash];
    }

    function actionCount(bytes32 patientHash) external view returns (uint256) {
        return actions[patientHash].length;
    }

    /// @notice Verify an off-chain payload matches what was anchored at `index`.
    function verifyPayload(bytes32 patientHash, uint256 index, bytes calldata payload)
        external
        view
        returns (bool)
    {
        return actions[patientHash][index].payloadHash == keccak256(payload);
    }
}
