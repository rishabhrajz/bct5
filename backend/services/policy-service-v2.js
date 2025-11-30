import { PrismaClient } from '@prisma/client';
import { getContracts } from '../contract-service.js';
import { sendTransactionSafely, verifyEvent, extractPolicyIdFromReceipt } from '../lib/tx-utils.js';

const prisma = new PrismaClient();

/**
 * Record a policy payment from blockchain transaction
 * This is called AFTER the frontend successfully sends the blockchain transaction
 * 
 * @param {Object} params - Policy parameters
 * @param {string} params.txHash - Transaction hash from blockchain
 * @param {string} params.beneficiaryAddress - Patient's wallet address
 * @param {string} params.beneficiaryDid - Patient's DID
 * @param {string} params.coverageAmount - Coverage amount in wei (string)
 * @param {number} params.startEpoch - Policy start timestamp
 * @param {number} params.endEpoch - Policy end timestamp
 * @param {string} params.tier - Policy tier (Basic/Standard/Premium)
 * @param {string} params.premiumAmount - Premium paid in wei (string)
 * @param {string} params.kycCid - IPFS CID of KYC document
 * @returns {Promise<Object>} Created policy record
 */
export async function recordPolicyFromBlockchain({
    txHash,
    beneficiaryAddress,
    beneficiaryDid,
    coverageAmount,
    startEpoch,
    endEpoch,
    tier,
    premiumAmount,
    kycCid
}) {
    try {
        console.log(`[POLICY] Recording policy from tx: ${txHash}`);

        // Get contracts
        const { policyContract, provider } = getContracts();

        // Step 1: Get transaction receipt
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
            throw new Error(`Transaction ${txHash} not found`);
        }

        if (receipt.status !== 1) {
            throw new Error(`Transaction ${txHash} failed on-chain`);
        }

        console.log(`[POLICY] Receipt confirmed in block ${receipt.blockNumber} `);

        // Step 2: Extract policy ID from event
        const policyId = extractPolicyIdFromReceipt(receipt, policyContract);
        if (!policyId) {
            throw new Error('Could not extract policy ID from transaction receipt');
        }

        // Step 3: Verify PolicyIssued event exists
        const event = await verifyEvent(
            policyContract,
            'PolicyIssued',
            [policyId, null], // Filter by policyId, any beneficiary
            receipt.blockNumber
        );

        if (!event) {
            // Mark as PENDING_ONCHAIN for reconciler to fix
            console.warn(`[POLICY] PolicyIssued event not found, marking as PENDING_ONCHAIN`);
            return await createPolicyRecord({
                onchainPolicyId: policyId,
                beneficiaryAddress,
                beneficiaryDid,
                coverageAmount,
                startEpoch,
                endEpoch,
                tier,
                premiumAmount,
                kycCid,
                txHash,
                blockNumber: receipt.blockNumber,
                status: 'PENDING_ONCHAIN',
            });
        }

        // Step 4: Verify policy exists on-chain
        const onchainPolicy = await policyContract.policies(policyId);
        if (onchainPolicy.beneficiary === '0x0000000000000000000000000000000000000000') {
            throw new Error(`Policy ${policyId} not found on - chain`);
        }

        console.log(`[POLICY] Verified policy ${policyId} on - chain with status ${onchainPolicy.status} `);

        // Step 5: Create database record with ACTIVE status
        const policy = await createPolicyRecord({
            onchainPolicyId: policyId,
            beneficiaryAddress,
            beneficiaryDid,
            coverageAmount,
            startEpoch,
            endEpoch,
            tier,
            premiumAmount,
            kycCid,
            txHash,
            blockNumber: receipt.blockNumber,
            status: 'ACTIVE',
        });

        console.log(`[POLICY] Database record created: ID ${policy.id} `);

        return policy;
    } catch (error) {
        console.error('[POLICY] Error recording policy:', error.message);
        throw error;
    }
}

/**
 * Internal function to create policy record in database
 */
async function createPolicyRecord({
    onchainPolicyId,
    beneficiaryAddress,
    beneficiaryDid,
    coverageAmount,
    startEpoch,
    endEpoch,
    tier,
    premiumAmount,
    kycCid,
    txHash,
    blockNumber,
    status,
}) {
    // Get or create default provider
    let provider = await prisma.provider.findFirst();
    if (!provider) {
        provider = await prisma.provider.create({
            data: {
                providerDid: 'did:ethr:localhost:0x0000000000000000000000000000000000000001',
                providerAddress: '0x0000000000000000000000000000000000000001',
                name: 'Default Provider',
                issuerDid: 'did:ethr:localhost:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
                issuedAt: new Date(),
                licenseCid: '',
                vcCid: '',
                status: 'APPROVED'
            }
        });
    }

    // Create policy
    const policy = await prisma.policy.create({
        data: {
            provider: {
                connect: { id: provider.id }
            },
            issuerDid: 'did:ethr:localhost:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
            beneficiaryAddress,
            beneficiaryDid: beneficiaryDid || `did: ethr: localhost:${beneficiaryAddress} `,
            coverageAmount: coverageAmount.toString(),
            startEpoch: parseInt(startEpoch),
            endEpoch: parseInt(endEpoch),
            tier: tier || 'Standard',
            premiumPaid: premiumAmount?.toString() || '0',
            onchainPolicyId: parseInt(onchainPolicyId),
            kycDocCid: kycCid || '',
            status: status,
            onchainTxHash: txHash,
            onchainBlockNumber: blockNumber,
            policyVcCid: '',
            vcStatus: 'VC_PENDING', // Will be updated by event listener
            approvedAt: status === 'ACTIVE' ? new Date() : null,
        },
    });

    return policy;
}

/**
 * Get policy by on-chain ID
 */
export async function getPolicyByOnchainId(onchainPolicyId) {
    return await prisma.policy.findUnique({
        where: { onchainPolicyId: parseInt(onchainPolicyId) },
        include: { provider: true }
    });
}

/**
 * Get policy by database ID
 */
export async function getPolicyById(id) {
    return await prisma.policy.findUnique({
        where: { id: parseInt(id) },
        include: { provider: true }
    });
}

/**
 * List all policies for a beneficiary
 */
export async function listPoliciesByBeneficiary(beneficiaryAddress) {
    return await prisma.policy.findMany({
        where: {
            beneficiaryAddress: beneficiaryAddress.toLowerCase()
        },
        include: { provider: true },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * List all policies
 */
export async function listAllPolicies() {
    return await prisma.policy.findMany({
        include: { provider: true },
        orderBy: { createdAt: 'desc' }
    });
}

export default {
    recordPolicyFromBlockchain,
    getPolicyByOnchainId,
    getPolicyById,
    listPoliciesByBeneficiary,
    listAllPolicies,
};
