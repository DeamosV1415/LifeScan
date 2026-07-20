// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentActionLog} from "./AgentActionLog.sol";

/**
 * @title EmergencyEscrow
 * @notice Where the agent's authority deliberately stops.
 *
 * @dev This contract exists to make a boundary explicit and enforceable rather
 * than merely stated in a slide.
 *
 * The agent CAN prepare an insurance pre-authorization packet and anchor its
 * hash here, in the same second treatment begins. That is the honest, buildable
 * version of "instant cashless payout" — the claim is filed in second ten
 * instead of day three.
 *
 * The agent CANNOT release funds. `release()` is gated to a human approver
 * role, and the agent's address is rejected even if it somehow holds that role.
 * An autonomous agent that moves money during a medical emergency raises a
 * liability question nobody can currently answer, so we did not build one.
 *
 * Scope note: this is a demonstration of the control boundary, not a payments
 * system. Real settlement would run through the insurer's rails.
 */
contract EmergencyEscrow {
    struct PreAuth {
        bytes32 patientHash;
        bytes32 packetHash;
        uint256 amount;
        address preparedBy;
        uint64 preparedAt;
        bool released;
        address releasedBy;
        uint64 releasedAt;
    }

    address public admin;
    AgentActionLog public immutable agentLog;

    mapping(address => bool) public isHumanApprover;
    PreAuth[] private preAuths;

    event ApproverAdded(address indexed approver);
    event ApproverRemoved(address indexed approver);
    event PreAuthPrepared(
        uint256 indexed id, bytes32 indexed patientHash, bytes32 packetHash, uint256 amount
    );
    event FundsReleased(uint256 indexed id, address indexed releasedBy, uint256 amount);

    error NotAdmin();
    error NotAuthorizedAgent();
    error NotHumanApprover();
    error AgentsCannotRelease();
    error AlreadyReleased();
    error ZeroAddress();

    constructor(address agentLogAddress) {
        admin = msg.sender;
        agentLog = AgentActionLog(agentLogAddress);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function addApprover(address approver) external onlyAdmin {
        if (approver == address(0)) revert ZeroAddress();

        isHumanApprover[approver] = true;
        emit ApproverAdded(approver);
    }

    function removeApprover(address approver) external onlyAdmin {
        isHumanApprover[approver] = false;
        emit ApproverRemoved(approver);
    }

    /// @notice The agent prepares a claim. This is the limit of its authority.
    function preparePreAuth(bytes32 patientHash, bytes32 packetHash, uint256 amount)
        external
        returns (uint256 id)
    {
        if (!agentLog.isAgent(msg.sender)) revert NotAuthorizedAgent();

        preAuths.push(
            PreAuth({
                patientHash: patientHash,
                packetHash: packetHash,
                amount: amount,
                preparedBy: msg.sender,
                preparedAt: uint64(block.timestamp),
                released: false,
                releasedBy: address(0),
                releasedAt: 0
            })
        );

        id = preAuths.length - 1;
        emit PreAuthPrepared(id, patientHash, packetHash, amount);
    }

    /**
     * @notice Release funds against a prepared pre-auth. Humans only.
     * @dev The agent check is a second, independent gate. Even if an agent
     * address were mistakenly granted the approver role, this still refuses —
     * the boundary does not depend on one line of access control being right.
     */
    function release(uint256 id) external {
        if (agentLog.isAgent(msg.sender)) revert AgentsCannotRelease();
        if (!isHumanApprover[msg.sender]) revert NotHumanApprover();

        PreAuth storage preAuth = preAuths[id];
        if (preAuth.released) revert AlreadyReleased();

        preAuth.released = true;
        preAuth.releasedBy = msg.sender;
        preAuth.releasedAt = uint64(block.timestamp);

        emit FundsReleased(id, msg.sender, preAuth.amount);
    }

    function getPreAuth(uint256 id) external view returns (PreAuth memory) {
        return preAuths[id];
    }

    function preAuthCount() external view returns (uint256) {
        return preAuths.length;
    }
}
