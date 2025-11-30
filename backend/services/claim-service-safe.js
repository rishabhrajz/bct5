import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { getContracts } from '../contract-service.js';
import { sendTransactionSafely, verifyEvent } from '../lib/tx-utils.js';

const prisma = new PrismaClient();

const TX_TIMEOUT = parseInt(process.env.TX_WAIT_TIMEOUT_MS) || 120000; // 2 minutes

/**
 * Safe Claim Service - All claim operations with blockchain verification
 * Pattern: TX → receipt → event verification → DB update
 */

/**
 * Submit claim with safe transaction pattern
 * @returns {claimId, txHash, status: 'SUBMITTED' | 'PENDING_ONCHAIN'}
 */
export async function submitClaimSafe({
    policyId,
    providerAddress,
    providerWallet,
    patientAddress,
    patientDid,
    amount,
    medicalReportCid,
    providerVcCid
}) {
    try {
        console.log('[CLAIM] Starting safe claim submission');

        // Get contracts
        const { claimContract, signer } = getContracts();

        // Get policy details
        const policy = await prisma.policy.findUnique({
            where: { id: policyId }
        });

        if (!policy) {
            throw new Error(`Policy ${policyId} not found`);
        }

        // Send TX to blockchain
        const { tx, receipt } = await sendTransactionSafely(
            claimContract,
            'submitClaim',
            [
                policy.onchainPolicyId,
                providerAddress,
                patientAddress,
                ethers.parseEther(amount),
                medicalReportCid
            ],
            {},
            TX_TIMEOUT
        );

        console.log(`[CLAIM] TX mined in block ${receipt.blockNumber}`);

        // Verify ClaimSubmitted event
        const claimSubmittedEvent = await verifyEvent(
            claimContract,
            'ClaimSubmitted',
            [null, null, null], // Get any ClaimSubmitted event in this block
            receipt.blockNumber
        );

        if (!claimSubmittedEvent) {
            console.warn('[CLAIM] ClaimSubmitted event not found - marking PENDING_ONCHAIN');

            // Create claim record with PENDING status
            const claim = await prisma.claim.create({
                data: {
                    policyId,
                    patientDid,
                    patientAddress,
                    providerAddress,
                    providerWallet: providerWallet || providerAddress,
                    medicalReportCid,
                    providerVcCid: providerVcCid || '',
                    amount: ethers.parseEther(amount).toString(),
                    status: 'PENDING_ONCHAIN',
                    onchainTxHash: tx.hash,
                    onchainBlockNumber: receipt.blockNumber,
                    source: 'api'
                }
            });

            return {
                claimId: null,
                onchainClaimId: null,
                dbClaimId: claim.id,
                txHash: tx.hash,
                status: 'PENDING_ONCHAIN',
                message: 'Claim TX mined but event not found. Will be reconciled by event listener.'
            };
        }

        // Extract claim ID from event
        const onchainClaimId = parseInt(claimSubmittedEvent.args.claimId.toString());
        console.log(`[CLAIM] On-chain claim ID: ${onchainClaimId}`);

        // Create claim in DB
        const claim = await prisma.claim.create({
            data: {
                onchainClaimId,
                policyId,
                patientDid,
                patientAddress,
                providerAddress,
                providerWallet: providerWallet || providerAddress,
                medicalReportCid,
                providerVcCid: providerVcCid || '',
                amount: ethers.parseEther(amount).toString(),
                status: 'Submitted',
                onchainTxHash: tx.hash,
                onchainBlockNumber: receipt.blockNumber,
                source: 'api'
            }
        });

        console.log(`[CLAIM] Claim created in DB: ${claim.id}`);

        return {
            claimId: onchainClaimId,
            onchainClaimId,
            dbClaimId: claim.id,
            txHash: tx.hash,
            status: 'Submitted',
            claim
        };
    } catch (error) {
        console.error('[CLAIM] Submit error:', error);
        throw error;
    }
}

/**
 * Move claim to review (insurer action)
 */
export async function reviewClaimSafe(claimId) {
    try {
        console.log(`[CLAIM] Moving claim ${claimId} to review`);

        const claim = await prisma.claim.findUnique({
            where: { id: claimId }
        });

        if (!claim) {
            throw new Error(`Claim ${claimId} not found`);
        }

        if (!claim.onchainClaimId) {
            throw new Error(`Claim ${claimId} has no on-chain ID`);
        }

        const { claimContract } = getContracts();

        // Send TX to move claim to review
        const { tx, receipt } = await sendTransactionSafely(
            claimContract,
            'reviewClaim',
            [claim.onchainClaimId],
            {},
            TX_TIMEOUT
        );

        // Verify ClaimStatusChanged event
        const statusEvent = await verifyEvent(
            claimContract,
            'ClaimStatusChanged',
            [claim.onchainClaimId],
            receipt.blockNumber
        );

        if (!statusEvent) {
            // Mark as pending
            await prisma.claim.update({
                where: { id: claimId },
                data: {
                    status: 'PENDING_ONCHAIN',
                    onchainTxHash: tx.hash,
                    onchainBlockNumber: receipt.blockNumber
                }
            });

            return {
                success: false,
                status: 'PENDING_ONCHAIN',
                txHash: tx.hash,
                message: 'Event not found, marked PENDING_ONCHAIN'
            };
        }

        // Update claim status
        const updatedClaim = await prisma.claim.update({
            where: { id: claimId },
            data: {
                status: 'UnderReview',
                reviewedAt: new Date(),
                onchainTxHash: tx.hash,
                onchainBlockNumber: receipt.blockNumber
            }
        });

        return {
            success: true,
            status: 'UnderReview',
            txHash: tx.hash,
            claim: updatedClaim
        };
    } catch (error) {
        console.error('[CLAIM] Review error:', error);
        throw error;
    }
}

/**
 * Approve and pay claim (insurer action)
 */
export async function approveClaimSafe(claimId, payoutAmount) {
    try {
        console.log(`[CLAIM] Approving claim ${claimId} with payout ${payoutAmount}`);

        const claim = await prisma.claim.findUnique({
            where: { id: claimId }
        });

        if (!claim) {
            throw new Error(`Claim ${claimId} not found`);
        }

        if (!claim.onchainClaimId) {
            throw new Error(`Claim ${claimId} has no on-chain ID`);
        }

        const { claimContract } = getContracts();
        const payoutWei = ethers.parseEther(payoutAmount.toString());

        // Send TX to approve and pay
        const { tx, receipt } = await sendTransactionSafely(
            claimContract,
            'approveAndPayClaim',
            [claim.onchainClaimId, payoutWei],
            { value: payoutWei }, // Send ETH
            TX_TIMEOUT
        );

        // Verify ClaimPaid event
        const paidEvent = await verifyEvent(
            claimContract,
            'ClaimPaid',
            [claim.onchainClaimId],
            receipt.blockNumber
        );

        if (!paidEvent) {
            await prisma.claim.update({
                where: { id: claimId },
                data: {
                    status: 'PENDING_ONCHAIN',
                    onchainTxHash: tx.hash,
                    onchainBlockNumber: receipt.blockNumber
                }
            });

            return {
                success: false,
                status: 'PENDING_ONCHAIN',
                txHash: tx.hash,
                message: 'Payment TX mined but event not found'
            };
        }

        // Update claim to Paid
        const updatedClaim = await prisma.claim.update({
            where: { id: claimId },
            data: {
                status: 'Paid',
                payoutAmount: payoutWei.toString(),
                payoutTxHash: tx.hash,
                paidAt: new Date(),
                onchainTxHash: tx.hash,
                onchainBlockNumber: receipt.blockNumber
            }
        });

        return {
            success: true,
            status: 'Paid',
            txHash: tx.hash,
            payoutAmount: payoutWei.toString(),
            claim: updatedClaim
        };
    } catch (error) {
        console.error('[CLAIM] Approve error:', error);
        throw error;
    }
}

/**
 * Reject claim (insurer action)
 */
export async function rejectClaimSafe(claimId, reason) {
    try {
        console.log(`[CLAIM] Rejecting claim ${claimId}: ${reason}`);

        const claim = await prisma.claim.findUnique({
            where: { id: claimId }
        });

        if (!claim) {
            throw new Error(`Claim ${claimId} not found`);
        }

        if (!claim.onchainClaimId) {
            throw new Error(`Claim ${claimId} has no on-chain ID`);
        }

        const { claimContract } = getContracts();

        // Send TX to reject claim
        const { tx, receipt } = await sendTransactionSafely(
            claimContract,
            'rejectClaim',
            [claim.onchainClaimId, reason],
            {},
            TX_TIMEOUT
        );

        // Verify ClaimRejected event
        const rejectedEvent = await verifyEvent(
            claimContract,
            'ClaimRejected',
            [claim.onchainClaimId],
            receipt.blockNumber
        );

        if (!rejectedEvent) {
            await prisma.claim.update({
                where: { id: claimId },
                data: {
                    status: 'PENDING_ONCHAIN',
                    onchainTxHash: tx.hash,
                    onchainBlockNumber: receipt.blockNumber
                }
            });

            return {
                success: false,
                status: 'PENDING_ONCHAIN',
                txHash: tx.hash,
                message: 'Rejection TX mined but event not found'
            };
        }

        // Update claim to Rejected
        const updatedClaim = await prisma.claim.update({
            where: { id: claimId },
            data: {
                status: 'Rejected',
                rejectionReason: reason,
                reviewedAt: new Date(),
                onchainTxHash: tx.hash,
                onchainBlockNumber: receipt.blockNumber
            }
        });

        return {
            success: true,
            status: 'Rejected',
            txHash: tx.hash,
            reason,
            claim: updatedClaim
        };
    } catch (error) {
        console.error('[CLAIM] Reject error:', error);
        throw error;
    }
}

export default {
    submitClaimSafe,
    reviewClaimSafe,
    approveClaimSafe,
    rejectClaimSafe
};
