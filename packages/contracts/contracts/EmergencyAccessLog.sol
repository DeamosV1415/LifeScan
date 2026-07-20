// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProviderRegistry} from "./ProviderRegistry.sol";

/**
 * @title EmergencyAccessLog
 * @notice The accountability layer. Break-glass grants, permanently attributed.
 *
 * @dev Design principle: the chain is never in the path that saves the life,
 * only in the path that proves who touched the data. Tier-0 data (blood group,
 * allergies) reaches a paramedic with no network at all. This contract governs
 * Tier 1 — the full clinical record — where the tradeoff is different.
 *
 * No PHI is ever written here. `patientHash` is keccak256 of the patient
 * identifier; nothing on this chain reveals who a patient is.
 *
 * Access is granted, not requested-and-approved. A clinician cannot wait for a
 * human to approve a workflow while a patient bleeds, so an active provider
 * gets the grant immediately. What they cannot do is take it quietly: the grant
 * is an immutable record, visible to the patient in real time.
 *
 * The patient retains the only veto — freezeRecord() — and it is enforced here,
 * on-chain, not in the UI. Guardians re-check this contract independently
 * before releasing key shares, so a frozen record cannot be opened even if
 * every piece of our own infrastructure is compromised or lying.
 */
contract EmergencyAccessLog {
    struct AccessRecord {
        address provider;
        uint64 timestamp;
        uint16 reasonCode;
        bytes32 contextHash; // hash of the paramedic's free-text context, optional
    }

    /// @notice Reason codes are a fixed vocabulary so the audit trail is analysable.
    uint16 public constant REASON_UNCONSCIOUS = 1;
    uint16 public constant REASON_TRAUMA = 2;
    uint16 public constant REASON_CARDIAC = 3;
    uint16 public constant REASON_OVERDOSE = 4;
    uint16 public constant REASON_OTHER = 99;

    ProviderRegistry public immutable registry;

    mapping(bytes32 => AccessRecord[]) private history;
    mapping(bytes32 => bool) private frozen;
    mapping(bytes32 => address) private patientOwner;
    mapping(bytes32 => mapping(address => bool)) private providerBlocked;

    event PatientRegistered(bytes32 indexed patientHash, address indexed owner);
    event BreakGlassGranted(
        bytes32 indexed patientHash,
        address indexed provider,
        uint64 timestamp,
        uint16 reasonCode,
        bytes32 contextHash
    );
    event RecordFrozen(bytes32 indexed patientHash);
    event RecordUnfrozen(bytes32 indexed patientHash);
    event ProviderBlocked(bytes32 indexed patientHash, address indexed provider);

    error ProviderNotActive();
    error RecordIsFrozen();
    error ProviderIsBlocked();
    error NotPatientOwner();
    error PatientAlreadyRegistered();
    error PatientNotRegistered();
    error InvalidReasonCode();

    constructor(address registryAddress) {
        registry = ProviderRegistry(registryAddress);
    }

    /// @notice Claim ownership of a patient record hash. First claim wins.
    function registerPatient(bytes32 patientHash) external {
        if (patientOwner[patientHash] != address(0)) revert PatientAlreadyRegistered();

        patientOwner[patientHash] = msg.sender;
        emit PatientRegistered(patientHash, msg.sender);
    }

    /**
     * @notice Break glass on a patient record. Grants immediately if permitted.
     * @dev Emits BreakGlassGranted, which is what the Guardian nodes and the
     * triage agent both watch. The agent is triggered by this event, not by a
     * button — that is what makes it autonomous rather than merely automated.
     */
    function requestBreakGlass(bytes32 patientHash, uint16 reasonCode, bytes32 contextHash)
        external
    {
        if (!_isValidReason(reasonCode)) revert InvalidReasonCode();
        if (!registry.isActive(msg.sender)) revert ProviderNotActive();
        if (frozen[patientHash]) revert RecordIsFrozen();
        if (providerBlocked[patientHash][msg.sender]) revert ProviderIsBlocked();

        history[patientHash].push(
            AccessRecord({
                provider: msg.sender,
                timestamp: uint64(block.timestamp),
                reasonCode: reasonCode,
                contextHash: contextHash
            })
        );

        emit BreakGlassGranted(
            patientHash, msg.sender, uint64(block.timestamp), reasonCode, contextHash
        );
    }

    /// @notice Patient kill switch. Blocks all future access; past records stay.
    function freezeRecord(bytes32 patientHash) external {
        _requireOwner(patientHash);

        frozen[patientHash] = true;
        emit RecordFrozen(patientHash);
    }

    function unfreezeRecord(bytes32 patientHash) external {
        _requireOwner(patientHash);

        frozen[patientHash] = false;
        emit RecordUnfrozen(patientHash);
    }

    /// @notice Revoke one specific provider without freezing the whole record.
    function blockProvider(bytes32 patientHash, address provider) external {
        _requireOwner(patientHash);

        providerBlocked[patientHash][provider] = true;
        emit ProviderBlocked(patientHash, provider);
    }

    // --- Views. Guardians call these before releasing a key share. ---

    function isFrozen(bytes32 patientHash) external view returns (bool) {
        return frozen[patientHash];
    }

    function isBlocked(bytes32 patientHash, address provider) external view returns (bool) {
        return providerBlocked[patientHash][provider];
    }

    function ownerOf(bytes32 patientHash) external view returns (address) {
        return patientOwner[patientHash];
    }

    function getAccessHistory(bytes32 patientHash) external view returns (AccessRecord[] memory) {
        return history[patientHash];
    }

    function accessCount(bytes32 patientHash) external view returns (uint256) {
        return history[patientHash].length;
    }

    /**
     * @notice Whether a provider currently holds a grant issued within `window`.
     * @dev This is the exact check each Guardian performs before releasing its
     * share. Grants are time-boxed: a break-glass from last month must not
     * unlock a record today.
     */
    function hasRecentGrant(bytes32 patientHash, address provider, uint64 window)
        external
        view
        returns (bool)
    {
        if (frozen[patientHash]) return false;
        if (providerBlocked[patientHash][provider]) return false;
        if (!registry.isActive(provider)) return false;

        AccessRecord[] storage records = history[patientHash];

        // Newest first — a recent grant is found in one or two iterations.
        for (uint256 i = records.length; i > 0; i--) {
            AccessRecord storage record = records[i - 1];

            if (record.timestamp + window < block.timestamp) return false;
            if (record.provider == provider) return true;
        }

        return false;
    }

    function _requireOwner(bytes32 patientHash) private view {
        address owner = patientOwner[patientHash];
        if (owner == address(0)) revert PatientNotRegistered();
        if (owner != msg.sender) revert NotPatientOwner();
    }

    function _isValidReason(uint16 reasonCode) private pure returns (bool) {
        return reasonCode == REASON_UNCONSCIOUS || reasonCode == REASON_TRAUMA
            || reasonCode == REASON_CARDIAC || reasonCode == REASON_OVERDOSE
            || reasonCode == REASON_OTHER;
    }
}
