// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProviderRegistry
 * @notice The set of clinicians permitted to invoke break-glass access.
 *
 * @dev This is the permissioning layer, and it is deliberately thin. In
 * production the admin role belongs to a health authority and entries are keyed
 * to HFR/HPR facility identifiers; for the hackathon the deployer holds it.
 *
 * The security model does NOT rest on this registry alone. Emergency access can
 * never be blocked pending verification — a paramedic cannot wait for an
 * approval workflow — so prevention is only half the design. The other half is
 * EmergencyAccessLog, which makes every access permanently attributable. This
 * mirrors how real hospital EHRs handle break-glass.
 */
contract ProviderRegistry {
    struct Provider {
        string hfrId; // Health Facility Registry ID
        string name;
        bool active;
        uint64 registeredAt;
    }

    address public admin;
    mapping(address => Provider) private providers;
    address[] private providerList;

    event ProviderRegistered(address indexed provider, string hfrId, string name);
    event ProviderRevoked(address indexed provider);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error AlreadyRegistered();
    error NotRegistered();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function registerProvider(address provider, string calldata hfrId, string calldata name)
        external
        onlyAdmin
    {
        if (provider == address(0)) revert ZeroAddress();
        if (providers[provider].registeredAt != 0) revert AlreadyRegistered();

        providers[provider] = Provider({
            hfrId: hfrId,
            name: name,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        providerList.push(provider);

        emit ProviderRegistered(provider, hfrId, name);
    }

    /// @notice Revoke access. The provider's past access records remain — they are immutable.
    function revokeProvider(address provider) external onlyAdmin {
        if (providers[provider].registeredAt == 0) revert NotRegistered();

        providers[provider].active = false;
        emit ProviderRevoked(provider);
    }

    function reinstateProvider(address provider) external onlyAdmin {
        if (providers[provider].registeredAt == 0) revert NotRegistered();

        providers[provider].active = true;
        emit ProviderRegistered(provider, providers[provider].hfrId, providers[provider].name);
    }

    function isActive(address provider) external view returns (bool) {
        return providers[provider].active;
    }

    function getProvider(address provider) external view returns (Provider memory) {
        return providers[provider];
    }

    function providerCount() external view returns (uint256) {
        return providerList.length;
    }

    function providerAt(uint256 index) external view returns (address) {
        return providerList[index];
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();

        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
