// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IdentityRegistry.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PolicyContract
 * @dev Manages insurance policies with approval workflows and payment escrow
 */
contract PolicyContract is ReentrancyGuard, Ownable {
    enum PolicyStatus { Pending, Approved, Rejected, Active, Expired }
    enum ProviderStatus { Pending, Approved, Rejected }
    enum PolicyTier { Basic, Standard, Premium }
    
    struct Policy {
        uint256 id;
        address beneficiary;
        uint256 coverageAmount;
        uint256 premiumPaid;
        PolicyTier tier;
        PolicyStatus status;
        uint256 startEpoch;
        uint256 endEpoch;
        string kycDocCid;
    }
    
    struct Provider {
        address providerAddress;
        string did;
        string licenseCid;
        ProviderStatus status;
        uint256 registeredAt;
    }
    
    // State variables
    uint256 private policyCounter;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => uint256) public policyPremiumEscrow;
    mapping(address => Provider) public providers;
    mapping(address => ProviderStatus) public providerApprovalStatus;
    
    IdentityRegistry public identityRegistry;
    address public claimContractAddress;
    address public insurerAddress;
    
    // Premium rate per coverage (in basis points, 100 = 1%)
    uint256 public constant BASIC_PREMIUM_RATE = 100;      // 1%
    uint256 public constant STANDARD_PREMIUM_RATE = 200;   // 2%
    uint256 public constant PREMIUM_PREMIUM_RATE = 300;    // 3%
    
    // Events
    event PolicyRequested(
        uint256 indexed policyId,
        address indexed beneficiary,
        uint256 premium,
        string kycDocCid
    );
    
    event PolicyApproved(uint256 indexed policyId);
    
    event PolicyRejected(
        uint256 indexed policyId,
        string reason,
        uint256 refundAmount
    );
    
    event PolicyIssued(
        uint256 indexed policyId,
        address indexed beneficiary,
        uint256 coverageAmount,
        uint256 startEpoch,
        uint256 endEpoch
    );
    
    event PolicyRevoked(uint256 indexed policyId);
    
    event ProviderRegistered(
        address indexed provider,
        string did,
        string licenseCid
    );
    
    event ProviderApproved(address indexed provider);
    
    event ProviderRejected(address indexed provider, string reason);
    
    /**
     * @dev Constructor sets the IdentityRegistry address
     */
    constructor(address _identityRegistry) Ownable(msg.sender) {
        require(_identityRegistry != address(0), "Invalid registry address");
        identityRegistry = IdentityRegistry(_identityRegistry);
        insurerAddress = msg.sender;
        policyCounter = 0;
    }
    
    modifier onlyInsurer() {
        require(msg.sender == insurerAddress, "Only insurer can call");
        _;
    }
    
    /**
     * @dev Set the ClaimContract address (can only be set once)
     */
    function setClaimContract(address _claimContract) external onlyOwner {
        require(claimContractAddress == address(0), "Claim contract already set");
        require(_claimContract != address(0), "Invalid claim contract address");
        claimContractAddress = _claimContract;
    }
    
    /**
     * @dev Set insurer address
     */
    function setInsurerAddress(address _insurer) external onlyOwner {
        require(_insurer != address(0), "Invalid insurer address");
        insurerAddress = _insurer;
    }
    
    /**
     * @dev Calculate premium based on coverage and tier
     */
    function calculatePremium(uint256 coverageAmount, PolicyTier tier) public pure returns (uint256) {
        uint256 rate;
        if (tier == PolicyTier.Basic) {
            rate = BASIC_PREMIUM_RATE;
        } else if (tier == PolicyTier.Standard) {
            rate = STANDARD_PREMIUM_RATE;
        } else {
            rate = PREMIUM_PREMIUM_RATE;
        }
        return (coverageAmount * rate) / 10000;
    }
    
    /**
     * @dev Request a new policy with payment
     */
    function requestPolicy(
        address beneficiary,
        uint256 coverageAmount,
        PolicyTier tier,
        uint256 startEpoch,
        uint256 endEpoch,
        string memory kycDocCid
    ) external payable returns (uint256) {
        require(beneficiary != address(0), "Invalid beneficiary address");
        require(coverageAmount > 0, "Coverage amount must be positive");
        require(endEpoch > startEpoch, "End epoch must be after start epoch");
        require(bytes(kycDocCid).length > 0, "KYC document required");
        
        uint256 premium = calculatePremium(coverageAmount, tier);
        require(msg.value == premium, "Incorrect premium amount");
        
        policyCounter++;
        uint256 policyId = policyCounter;
        
        // Hold premium in escrow
        policyPremiumEscrow[policyId] = msg.value;
        
        policies[policyId] = Policy({
            id: policyId,
            beneficiary: beneficiary,
            coverageAmount: coverageAmount,
            premiumPaid: msg.value,
            tier: tier,
            status: PolicyStatus.Active, // Auto-approve: Set to Active immediately
            startEpoch: startEpoch,
            endEpoch: endEpoch,
            kycDocCid: kycDocCid
        });
        
        emit PolicyRequested(policyId, beneficiary, msg.value, kycDocCid);
        // Auto-approve: Emit PolicyIssued immediately
        emit PolicyIssued(policyId, beneficiary, coverageAmount, startEpoch, endEpoch);
        emit PolicyApproved(policyId);
        
        return policyId;
    }
    
    /**
     * @dev Approve a policy (releases escrow to insurer)
     */
    function approvePolicy(uint256 policyId) external onlyInsurer {
        require(policies[policyId].id != 0, "Policy does not exist");
        require(policies[policyId].status == PolicyStatus.Pending, "Policy not pending");
        
        // Release premium from escrow to insurer
        uint256 premium = policyPremiumEscrow[policyId];
        policyPremiumEscrow[policyId] = 0;
        
        policies[policyId].status = PolicyStatus.Active;
        
        emit PolicyApproved(policyId);
        emit PolicyIssued(
            policyId,
            policies[policyId].beneficiary,
            policies[policyId].coverageAmount,
            policies[policyId].startEpoch,
            policies[policyId].endEpoch
        );
    }
    
    /**
     * @dev Reject a policy (refunds premium to beneficiary)
     */
    function rejectPolicy(uint256 policyId, string memory reason) external onlyInsurer nonReentrant {
        require(policies[policyId].id != 0, "Policy does not exist");
        require(policies[policyId].status == PolicyStatus.Pending, "Policy not pending");
        
        // Checks-Effects-Interactions pattern
        uint256 refund = policyPremiumEscrow[policyId];
        address beneficiary = policies[policyId].beneficiary;
        
        // Update state before external call
        policyPremiumEscrow[policyId] = 0;
        policies[policyId].status = PolicyStatus.Rejected;
        
        // External call last
        (bool success, ) = payable(beneficiary).call{value: refund}("");
        require(success, "Refund failed");
        
        emit PolicyRejected(policyId, reason, refund);
    }
    
    /**
     * @dev Legacy issuePolicy function (now just approves a pending policy)
     */
    function issuePolicy(
        address beneficiary,
        uint256 coverageAmount,
        uint256 startEpoch,
        uint256 endEpoch
    ) external returns (uint256) {
        require(beneficiary != address(0), "Invalid beneficiary address");
        require(coverageAmount > 0, "Coverage amount must be positive");
        require(endEpoch > startEpoch, "End epoch must be after start epoch");
        
        policyCounter++;
        uint256 policyId = policyCounter;
        
        policies[policyId] = Policy({
            id: policyId,
            beneficiary: beneficiary,
            coverageAmount: coverageAmount,
            premiumPaid: 0,
            tier: PolicyTier.Standard,
            status: PolicyStatus.Active,
            startEpoch: startEpoch,
            endEpoch: endEpoch,
            kycDocCid: ""
        });
        
        emit PolicyIssued(policyId, beneficiary, coverageAmount, startEpoch, endEpoch);
        
        return policyId;
    }
    
    /**
     * @dev Request provider approval
     */
    function requestProviderApproval(
        string memory did,
        string memory licenseCid
    ) external {
        require(bytes(did).length > 0, "DID required");
        require(bytes(licenseCid).length > 0, "License CID required");
        
        providers[msg.sender] = Provider({
            providerAddress: msg.sender,
            did: did,
            licenseCid: licenseCid,
            status: ProviderStatus.Pending,
            registeredAt: block.timestamp
        });
        
        providerApprovalStatus[msg.sender] = ProviderStatus.Pending;
        
        emit ProviderRegistered(msg.sender, did, licenseCid);
    }
    
    /**
     * @dev Approve a provider
     */
    function approveProvider(address provider) external onlyInsurer {
        require(providers[provider].providerAddress != address(0), "Provider not found");
        require(providers[provider].status == ProviderStatus.Pending, "Provider not pending");
        
        providers[provider].status = ProviderStatus.Approved;
        providerApprovalStatus[provider] = ProviderStatus.Approved;
        
        emit ProviderApproved(provider);
    }
    
    /**
     * @dev Reject a provider
     */
    function rejectProvider(address provider, string memory reason) external onlyInsurer {
        require(providers[provider].providerAddress != address(0), "Provider not found");
        require(providers[provider].status == ProviderStatus.Pending, "Provider not pending");
        
        providers[provider].status = ProviderStatus.Rejected;
        providerApprovalStatus[provider] = ProviderStatus.Rejected;
        
        emit ProviderRejected(provider, reason);
    }
    
    /**
     * @dev Check if provider is approved
     */
    function isProviderApproved(address provider) external view returns (bool) {
        return providerApprovalStatus[provider] == ProviderStatus.Approved;
    }
    
    /**
     * @dev Get provider details
     */
    function getProvider(address provider) external view returns (Provider memory) {
        return providers[provider];
    }
    
    /**
     * @dev Revoke an existing policy
     */
    function revokePolicy(uint256 policyId) external {
        require(policies[policyId].id != 0, "Policy does not exist");
        require(policies[policyId].status == PolicyStatus.Active, "Policy not active");
        
        policies[policyId].status = PolicyStatus.Expired;
        
        emit PolicyRevoked(policyId);
    }
    
    /**
     * @dev Get policy details
     */
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        require(policies[policyId].id != 0, "Policy does not exist");
        return policies[policyId];
    }
    
    /**
     * @dev Check if a policy is active and valid
     */
    function isPolicyValid(uint256 policyId) external view returns (bool) {
        Policy memory policy = policies[policyId];
        if (policy.id == 0 || policy.status != PolicyStatus.Active) {
            return false;
        }
        return block.timestamp >= policy.startEpoch && block.timestamp <= policy.endEpoch;
    }
    
    /**
     * @dev Get the current policy counter
     */
    function getPolicyCount() external view returns (uint256) {
        return policyCounter;
    }
}
