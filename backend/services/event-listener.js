import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { getContracts } from '../contract-service.js';

const prisma = new PrismaClient();

// Configuration
const POLL_INTERVAL = parseInt(process.env.EVENT_POLL_INTERVAL_MS) || 5000; // 5 seconds
const START_BLOCK = parseInt(process.env.EVENT_START_BLOCK) || 'latest';

let isRunning = false;
let lastProcessedBlock = null;

/**
 * Event Listener Service - Syncs blockchain events with database
 * 
 * Listens for contract events and updates DB only after on-chain confirmation
 */

/**
 * Process PolicyCreated/PolicyIssued event
 * Creates policy from on-chain data if not found in DB
 */
async function handlePolicyCreatedEvent(event) {
    try {
        const { policyId, beneficiary } = event.args;
        const txHash = event.transactionHash;
        const blockNumber = event.blockNumber;

        console.log(JSON.stringify({
            event: 'policy_created',
            policyId: policyId.toString(),
            beneficiary,
            txHash,
            blockNumber,
            timestamp: new Date().toISOString()
        }));

        // Validate address
        const beneficiaryAddress = ethers.getAddress(beneficiary).toLowerCase();

        // Try to find existing policy
        let policy = await prisma.policy.findFirst({
            where: {
                beneficiaryAddress,
                onchainPolicyId: parseInt(policyId.toString())
            }
        });

        if (policy) {
            // Update existing policy
            policy = await prisma.policy.update({
                where: { id: policy.id },
                data: {
                    status: 'ACTIVE',
                    onchainTxHash: txHash,
                    onchainBlockNumber: blockNumber,
                }
            });

            console.log(JSON.stringify({
                event: 'policy_updated',
                policyId: policy.id,
                onchainPolicyId: policyId.toString(),
                status: 'ACTIVE',
                action: 'updated_existing'
            }));
        } else {
            // Policy not found - query contract for full details
            console.log(JSON.stringify({
                event: 'policy_not_found_querying_contract',
                policyId: policyId.toString(),
                owner: beneficiaryAddress
            }));

            const { policyContract } = getContracts();
            const onchainPolicy = await policyContract.policies(policyId);

            // Validate we got valid data
            if (onchainPolicy.beneficiary === '0x0000000000000000000000000000000000000000') {
                console.warn(JSON.stringify({
                    event: 'policy_not_found_on_chain',
                    policyId: policyId.toString()
                }));
                return;
            }

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

            // Create policy from on-chain data
            policy = await prisma.policy.create({
                data: {
                    onchainPolicyId: parseInt(policyId.toString()),
                    beneficiaryAddress,
                    beneficiaryDid: `did:ethr:localhost:${beneficiaryAddress}`,
                    coverageAmount: onchainPolicy.coverageAmount.toString(),
                    tier: getTierString(onchainPolicy.tier),
                    premiumPaid: onchainPolicy.premiumPaid.toString(),
                    startEpoch: parseInt(onchainPolicy.startEpoch.toString()),
                    endEpoch: parseInt(onchainPolicy.endEpoch.toString()),
                    kycDocCid: '',
                    status: 'ACTIVE',
                    onchainTxHash: txHash,
                    onchainBlockNumber: blockNumber,
                    policyVcCid: '',
                    vcStatus: 'VC_PENDING',
                    approvedAt: new Date(),
                    issuerDid: 'did:ethr:localhost:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
                    providerId: provider.id,
                    source: 'onchain'
                }
            });

            console.log(JSON.stringify({
                event: 'policy_created_from_onchain',
                policyId: policy.id,
                onchainPolicyId: policyId.toString(),
                beneficiary: beneficiaryAddress,
                source: 'onchain'
            }));
        }

        // Create audit log
        await createAuditLog({
            entityType: 'policy',
            entityId: policy.id,
            action: policy.source === 'onchain' ? 'created_from_event' : 'updated_from_event',
            before: {},
            after: { status: 'ACTIVE', txHash, blockNumber, source: policy.source },
            confidence: 1.0,
            actor: 'system_event_listener'
        });

    } catch (error) {
        console.error(JSON.stringify({
            event: 'policy_event_error',
            error: error.message,
            stack: error.stack
        }));
    }
}

/**
 * Helper to convert tier enum to string
 */
function getTierString(tier) {
    const tierMap = { 0: 'Basic', 1: 'Standard', 2: 'Premium' };
    return tierMap[tier] || 'Standard';
}

/**
 * Process ClaimSubmitted event 
 * Creates claim from on-chain data if not found in DB
 */
async function handleClaimSubmittedEvent(event) {
    try {
        const { claimId, provider, patient, amount } = event.args;
        const txHash = event.transactionHash;
        const blockNumber = event.blockNumber;

        console.log(JSON.stringify({
            event: 'claim_submitted',
            claimId: claimId.toString(),
            provider,
            patient,
            amount: amount.toString(),
            txHash,
            blockNumber,
            timestamp: new Date().toISOString()
        }));

        // Validate addresses
        const providerAddress = ethers.getAddress(provider).toLowerCase();
        const patientAddress = ethers.getAddress(patient).toLowerCase();

        // Try to find existing claim
        let claim = await prisma.claim.findFirst({
            where: {
                onchainClaimId: parseInt(claimId.toString())
            }
        });

        if (claim) {
            // Update existing claim
            claim = await prisma.claim.update({
                where: { id: claim.id },
                data: {
                    status: 'Submitted',
                    onchainTxHash: txHash,
                    onchainBlockNumber: blockNumber,
                }
            });

            console.log(JSON.stringify({
                event: 'claim_updated',
                claimId: claim.id,
                status: 'Submitted',
                action: 'updated_existing'
            }));
        } else {
            // Claim not found - query contract for full details
            console.log(JSON.stringify({
                event: 'claim_not_found_querying_contract',
                claimId: claimId.toString()
            }));

            const { claimContract } = getContracts();
            const onchainClaim = await claimContract.claims(claimId);

            // Validate we got valid data
            if (onchainClaim.patient === '0x0000000000000000000000000000000000000000') {
                console.warn(JSON.stringify({
                    event: 'claim_not_found_on_chain',
                    claimId: claimId.toString()
                }));
                return;
            }

            // Find policy by onchain address
            const policy = await prisma.policy.findFirst({
                where: {
                    beneficiaryAddress: patientAddress
                }
            });

            if (!policy) {
                console.warn(JSON.stringify({
                    event: 'policy_not_found_for_claim',
                    claimId: claimId.toString(),
                    patient: patientAddress
                }));
                return;
            }

            // Create claim from on-chain data
            claim = await prisma.claim.create({
                data: {
                    onchainClaimId: parseInt(claimId.toString()),
                    policyId: policy.id,
                    patientDid: `did:ethr:localhost:${patientAddress}`,
                    patientAddress,
                    providerAddress,
                    providerWallet: providerAddress,
                    medicalReportCid: '',
                    providerVcCid: '',
                    amount: amount.toString(),
                    status: 'Submitted',
                    onchainTxHash: txHash,
                    onchainBlockNumber: blockNumber,
                    source: 'onchain'
                }
            });

            console.log(JSON.stringify({
                event: 'claim_created_from_onchain',
                claimId: claim.id,
                onchainClaimId: claimId.toString(),
                source: 'onchain'
            }));
        }

        await createAuditLog({
            entityType: 'claim',
            entityId: claim.id,
            action: claim.source === 'onchain' ? 'created_from_event' : 'updated_from_event',
            before: {},
            after: { status: 'Submitted', txHash, blockNumber, source: claim.source },
            confidence: 1.0,
            actor: 'system_event_listener'
        });

    } catch (error) {
        console.error(JSON.stringify({
            event: 'claim_submitted_error',
            error: error.message,
            stack: error.stack
        }));
    }
}

/**
 * Process ClaimStatusChanged event (for review/approve/reject)
 * Handles status transitions with idempotency
 */
async function handleClaimStatusChangedEvent(event) {
    try {
        const { claimId, newStatus } = event.args;
        const txHash = event.transactionHash;
        const blockNumber = event.blockNumber;

        // Map contract enum to DB status
        const statusMap = {
            0: 'Pending',
            1: 'UnderReview',
            2: 'Approved',
            3: 'Rejected',
            4: 'Paid'
        };

        const dbStatus = statusMap[newStatus] || 'Pending';

        console.log(JSON.stringify({
            event: 'claim_status_changed',
            claimId: claimId.toString(),
            newStatus: dbStatus,
            txHash,
            blockNumber,
            timestamp: new Date().toISOString()
        }));

        const claim = await prisma.claim.findFirst({
            where: { onchainClaimId: parseInt(claimId.toString()) }
        });

        if (!claim) {
            console.warn(JSON.stringify({
                event: 'claim_not_found_for_status_change',
                claimId: claimId.toString(),
                newStatus: dbStatus
            }));
            return;
        }

        // Idempotency check
        if (claim.onchainTxHash === txHash) {
            console.log(JSON.stringify({
                event: 'claim_already_processed',
                claimId: claim.id,
                txHash
            }));
            return;
        }

        // Update claim status
        const updateData = {
            status: dbStatus,
            onchainTxHash: txHash,
            onchainBlockNumber: blockNumber,
        };

        if (dbStatus === 'UnderReview') {
            updateData.reviewedAt = new Date();
        }

        await prisma.claim.update({
            where: { id: claim.id },
            data: updateData
        });

        await createAuditLog({
            entityType: 'claim',
            entityId: claim.id,
            action: 'status_change_event',
            before: { status: claim.status },
            after: { status: dbStatus, txHash, blockNumber },
            confidence: 1.0,
            actor: 'system_event_listener'
        });

        console.log(JSON.stringify({
            event: 'claim_status_updated',
            claimId: claim.id,
            status: dbStatus
        }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'claim_status_error',
            error: error.message
        }));
    }
}

/**
 * Process ClaimPaid event
 * Marks claim as paid with transaction details
 */
async function handleClaimPaidEvent(event) {
    try {
        const { claimId, providerWallet, amount } = event.args;
        const txHash = event.transactionHash;
        const blockNumber = event.blockNumber;

        console.log(JSON.stringify({
            event: 'claim_paid',
            claimId: claimId.toString(),
            providerWallet,
            amount: amount.toString(),
            txHash,
            blockNumber,
            timestamp: new Date().toISOString()
        }));

        const claim = await prisma.claim.findFirst({
            where: { onchainClaimId: parseInt(claimId.toString()) }
        });

        if (!claim) {
            console.warn(JSON.stringify({
                event: 'claim_not_found_for_payment',
                claimId: claimId.toString()
            }));
            return;
        }

        // Idempotency check
        if (claim.payoutTxHash === txHash || claim.onchainTxHash === txHash) {
            console.log(JSON.stringify({
                event: 'claim_payment_already_processed',
                claimId: claim.id,
                txHash
            }));
            return;
        }

        await prisma.claim.update({
            where: { id: claim.id },
            data: {
                status: 'Paid',
                payoutAmount: amount.toString(),
                payoutTxHash: txHash,
                paidAt: new Date(),
                onchainTxHash: txHash,
                onchainBlockNumber: blockNumber,
            }
        });

        await createAuditLog({
            entityType: 'claim',
            entityId: claim.id,
            action: 'claim_paid_event',
            before: { status: claim.status },
            after: { status: 'Paid', payoutAmount: amount.toString(), txHash, blockNumber },
            confidence: 1.0,
            actor: 'system_event_listener'
        });

        console.log(JSON.stringify({
            event: 'claim_paid_updated',
            claimId: claim.id,
            status: 'Paid',
            amount: amount.toString()
        }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'claim_paid_error',
            error: error.message
        }));
    }
}

/**
 * Create audit log entry
 */
async function createAuditLog({ entityType, entityId, action, before, after, confidence, actor }) {
    try {
        // For now, just log - we'll add audit table in Phase C
        console.log(JSON.stringify({
            audit: {
                entityType,
                entityId,
                action,
                before,
                after,
                confidence,
                actor,
                timestamp: new Date().toISOString()
            }
        }));

        // TODO: Add to reconciliation_audit table when schema is ready
    } catch (error) {
        console.error('Audit log error:', error);
    }
}

/**
 * Process all events since last check
 */
async function processEvents() {
    try {
        const { policyContract, claimContract, provider } = getContracts();

        if (!provider) {
            console.error('Provider not available');
            return;
        }

        const currentBlock = await provider.getBlockNumber();

        if (!lastProcessedBlock) {
            // Start from 100 blocks ago, but not before block 0
            lastProcessedBlock = Math.max(0, currentBlock - 100);
        }

        const fromBlock = lastProcessedBlock + 1;
        const toBlock = currentBlock;

        if (fromBlock > toBlock) {
            // No new blocks
            return;
        }

        console.log(JSON.stringify({
            event: 'processing_blocks',
            fromBlock,
            toBlock,
            timestamp: new Date().toISOString()
        }));

        // Query PolicyIssued events
        const policyEvents = await policyContract.queryFilter(
            policyContract.filters.PolicyIssued(),
            fromBlock,
            toBlock
        );

        for (const event of policyEvents) {
            await handlePolicyCreatedEvent(event);
        }

        // Query ClaimSubmitted events
        const claimSubmittedEvents = await claimContract.queryFilter(
            claimContract.filters.ClaimSubmitted(),
            fromBlock,
            toBlock
        );

        for (const event of claimSubmittedEvents) {
            await handleClaimSubmittedEvent(event);
        }

        // Query ClaimStatusChanged events
        const claimStatusEvents = await claimContract.queryFilter(
            claimContract.filters.ClaimStatusChanged(),
            fromBlock,
            toBlock
        );

        for (const event of claimStatusEvents) {
            await handleClaimStatusChangedEvent(event);
        }

        // Query ClaimPaid events
        const claimPaidEvents = await claimContract.queryFilter(
            claimContract.filters.ClaimPaid(),
            fromBlock,
            toBlock
        );

        for (const event of claimPaidEvents) {
            await handleClaimPaidEvent(event);
        }

        // Update last processed block
        lastProcessedBlock = toBlock;

        console.log(JSON.stringify({
            event: 'block_processing_complete',
            processedBlocks: toBlock - fromBlock + 1,
            lastBlock: toBlock
        }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'process_events_error',
            error: error.message,
            stack: error.stack
        }));
    }
}

/**
 * Start the event listener
 */
export async function startEventListener() {
    if (isRunning) {
        console.log('Event listener already running');
        return;
    }

    isRunning = true;
    console.log(JSON.stringify({
        event: 'listener_started',
        pollInterval: POLL_INTERVAL,
        timestamp: new Date().toISOString()
    }));

    // Process events on interval
    const intervalId = setInterval(async () => {
        await processEvents();
    }, POLL_INTERVAL);

    // Process immediately on start
    await processEvents();

    // Return function to stop listener
    return () => {
        isRunning = false;
        clearInterval(intervalId);
        console.log(JSON.stringify({
            event: 'listener_stopped',
            timestamp: new Date().toISOString()
        }));
    };
}

/**
 * Expose processEvent for testing
 */
export async function processEvent(eventName, eventData) {
    const handlers = {
        'PolicyCreated': handlePolicyCreatedEvent,
        'PolicyIssued': handlePolicyCreatedEvent,
        'ClaimSubmitted': handleClaimSubmittedEvent,
        'ClaimStatusChanged': handleClaimStatusChangedEvent,
        'ClaimPaid': handleClaimPaidEvent,
    };

    const handler = handlers[eventName];
    if (!handler) {
        throw new Error(`Unknown event: ${eventName}`);
    }

    await handler(eventData);
}

/**
 * Get listener health status
 */
export function getListenerHealth() {
    return {
        isRunning,
        lastProcessedBlock,
        pollInterval: POLL_INTERVAL,
        timestamp: new Date().toISOString()
    };
}

export default {
    startEventListener,
    processEvent,
    getListenerHealth
};
