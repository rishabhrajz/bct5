import { submitClaim, updateClaimStatus, listClaims } from '../services/claim-service.js';

/**
 * POST /claim/submit
 * Submit a new insurance claim
 */
export async function handleSubmitClaim(req, res) {
    try {
        const {
            policyId,
            patientDid,
            patientAddress,
            fileCid,
            amount,
            providerDid,
            providerVcCid,
            providerVcJwt
        } = req.body;

        // Validate required fields
        if (!policyId || !patientDid || !patientAddress || !fileCid || !amount || !providerDid) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['policyId', 'patientDid', 'patientAddress', 'fileCid', 'amount', 'providerDid']
            });
        }

        // At least one verification method required
        if (!providerVcCid && !providerVcJwt) {
            return res.status(400).json({
                error: 'Must provide either providerVcCid or providerVcJwt for verification'
            });
        }

        // Check for verbose mode (dev only)
        const verbose = req.query.verbose === 'true' && process.env.NODE_ENV === 'development';

        try {
            // Submit claim
            const result = await submitClaim({
                policyId,
                patientDid,
                patientAddress,
                fileCid,
                amount: amount.toString(),
                providerDid,
                providerVcCid,
                providerVcJwt
            });

            const response = {
                success: true,
                claimId: result.claimId,
                txHash: result.txHash,
                claim: {
                    id: result.claim.id,
                    onchainClaimId: result.claim.onchainClaimId,
                    policyId: result.claim.policyId,
                    patientAddress: result.claim.patientAddress,
                    fileCid: result.claim.fileCid,
                    amount: result.claim.amount,
                    status: result.claim.status
                },
                verification: result.verification
            };

            res.status(201).json(response);
        } catch (error) {
            // Handle verification failure
            if (error.verification) {
                const errorResponse = {
                    success: false,
                    error: 'Claim verification failed',
                    message: error.message,
                    verification: {
                        verified: false,
                        error: error.verification.error,
                        message: error.verification.message
                    }
                };

                // Add debug info in verbose mode
                if (verbose) {
                    errorResponse.debug = {
                        tried: error.verification.tried,
                        storedCid: error.verification.storedCid,
                        presentedCid: error.verification.presentedCid,
                        details: error.verification.details
                    };
                }

                return res.status(400).json(errorResponse);
            }

            throw error;
        }
    } catch (error) {
        console.error('Submit claim error:', error);
        res.status(500).json({
            error: 'Failed to submit claim',
            message: error.message
        });
    }
}

/**
 * POST /claim/update-status
 * Update claim status (insurer action)
 */
export async function handleUpdateClaimStatus(req, res) {
    try {
        const { claimId, status } = req.body;

        if (!claimId || !status) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['claimId', 'status']
            });
        }

        // Validate status
        const validStatuses = ['Submitted', 'UnderReview', 'Approved', 'Rejected', 'Paid'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status',
                validStatuses
            });
        }

        const claim = await updateClaimStatus(parseInt(claimId), status);

        res.json({
            success: true,
            claim: {
                id: claim.id,
                onchainClaimId: claim.onchainClaimId,
                status: claim.status
            }
        });
    } catch (error) {
        console.error('Update claim status error:', error);
        res.status(500).json({
            error: 'Failed to update claim status',
            message: error.message
        });
    }
}

/**
 * GET /claim/list
 * List all claims with optional filters
 */
export async function handleListClaims(req, res) {
    try {
        const filters = {};

        if (req.query.policyId) {
            filters.policyId = parseInt(req.query.policyId);
        }

        if (req.query.status) {
            filters.status = req.query.status;
        }

        if (req.query.patientAddress) {
            filters.patientAddress = req.query.patientAddress;
        }

        const claims = await listClaims(filters);

        const response = claims.map(c => ({
            id: c.id,
            onchainClaimId: c.onchainClaimId,
            policyId: c.policyId,
            onchainPolicyId: c.policy?.onchainPolicyId,
            patientAddress: c.patientAddress,
            patientDid: c.patientDid,
            fileCid: c.fileCid,
            amount: c.amount,
            status: c.status,
            onchainTxHash: c.onchainTxHash,           // NEW - Phase B
            onchainBlockNumber: c.onchainBlockNumber, // NEW - Phase B
            source: c.source,                         // NEW - Phase B
            txHash: c.txHash,
            providerName: c.policy?.provider?.name,
            createdAt: c.createdAt
        }));

        res.json({
            success: true,
            claims: response,
            count: response.length
        });
    } catch (error) {
        console.error('List claims error:', error);
        res.status(500).json({
            error: 'Failed to list claims',
            message: error.message
        });
    }
}

export default {
    handleSubmitClaim,
    handleUpdateClaimStatus,
    handleListClaims
};
