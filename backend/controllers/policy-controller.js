import { issuePolicy, listPolicies, getPolicyByOnchainId } from '../services/policy-service.js';

/**
 * POST /policy/issue
 * Issue a new insurance policy
 */
export async function handleIssuePolicy(req, res) {
    try {
        const {
            beneficiaryAddress,
            beneficiaryDid,
            coverageAmount,
            startEpoch,
            endEpoch,
            providerId
        } = req.body;

        // Validate required fields
        if (!beneficiaryAddress || !coverageAmount || !startEpoch || !endEpoch || !providerId) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['beneficiaryAddress', 'coverageAmount', 'startEpoch', 'endEpoch', 'providerId']
            });
        }

        // Issue policy
        const result = await issuePolicy({
            beneficiaryAddress,
            beneficiaryDid,
            coverageAmount: coverageAmount.toString(),
            startEpoch: parseInt(startEpoch),
            endEpoch: parseInt(endEpoch),
            providerId: parseInt(providerId)
        });

        res.status(201).json({
            success: true,
            policyId: result.policyId,
            policyVcCid: result.policyVcCid,
            txHash: result.txHash,
            policy: {
                id: result.policy.id,
                onchainPolicyId: result.policy.onchainPolicyId,
                beneficiaryAddress: result.policy.beneficiaryAddress,
                coverageAmount: result.policy.coverageAmount,
                startEpoch: result.policy.startEpoch,
                endEpoch: result.policy.endEpoch,
                providerId: result.policy.providerId
            }
        });
    } catch (error) {
        console.error('Issue policy error:', error);
        res.status(500).json({
            error: 'Failed to issue policy',
            message: error.message
        });
    }
}

/**
 * GET /policy/list
 * List all policies
 */
export async function handleListPolicies(req, res) {
    try {
        const policies = await listPolicies();

        const response = policies.map(p => ({
            id: p.id,
            onchainPolicyId: p.onchainPolicyId,
            beneficiaryAddress: p.beneficiaryAddress,
            beneficiaryDid: p.beneficiaryDid,
            coverageAmount: p.coverageAmount,
            tier: p.tier,
            premiumPaid: p.premiumPaid,
            startEpoch: p.startEpoch,
            endEpoch: p.endEpoch,
            status: p.status,
            onchainTxHash: p.onchainTxHash,           // NEW - Phase B
            onchainBlockNumber: p.onchainBlockNumber, // NEW - Phase B
            source: p.source,                         // NEW - Phase B
            policyVcCid: p.policyVcCid,
            vcStatus: p.vcStatus,
            providerName: p.provider?.name,
            createdAt: p.createdAt,
            approvedAt: p.approvedAt
        }));

        res.json({
            success: true,
            policies: response,
            count: response.length
        });
    } catch (error) {
        console.error('List policies error:', error);
        res.status(500).json({
            error: 'Failed to list policies',
            message: error.message
        });
    }
}

/**
 * GET /policy/:policyId
 * Get policy by on-chain policy ID
 */
export async function handleGetPolicy(req, res) {
    try {
        const { policyId } = req.params;
        const policy = await getPolicyByOnchainId(parseInt(policyId));

        if (!policy) {
            return res.status(404).json({
                error: 'Policy not found',
                policyId: parseInt(policyId)
            });
        }

        res.json({
            success: true,
            policy: {
                id: policy.id,
                onchainPolicyId: policy.onchainPolicyId,
                beneficiaryAddress: policy.beneficiaryAddress,
                beneficiaryDid: policy.beneficiaryDid,
                coverageAmount: policy.coverageAmount,
                startEpoch: policy.startEpoch,
                endEpoch: policy.endEpoch,
                providerId: policy.providerId,
                providerName: policy.provider?.name,
                policyVcCid: policy.policyVcCid,
                createdAt: policy.createdAt
            }
        });
    } catch (error) {
        console.error('Get policy error:', error);
        res.status(500).json({
            error: 'Failed to get policy',
            message: error.message
        });
    }
}

export default {
    handleIssuePolicy,
    handleListPolicies,
    handleGetPolicy
};
