import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { getContracts } from '../contract-service.js';

const prisma = new PrismaClient();

// Configuration
const RECONCILE_INTERVAL = parseInt(process.env.RECONCILE_INTERVAL_MS) || 60000; // 60 seconds
const AUTO_FIX_ENABLED = process.env.RECONCILER_AUTO_FIX !== 'false'; // Default: true
const MAX_BATCH_SIZE = parseInt(process.env.RECONCILER_MAX_BATCH_SIZE) || 100;

let isRunning = false;
let lastRunTime = null;
let stats = {
    totalReconciled: 0,
    autoFixed: 0,
    pendingSuggestions: 0
};

/**
 * Reconciler Service - Ensures DB consistency with blockchain state
 */

/**
 * Map on-chain status enum to DB status string
 */
function mapOnchainStatusToDb(onchainStatus, entityType) {
    if (entityType === 'policy') {
        const policyStatusMap = {
            0: 'PENDING',
            1: 'ACTIVE',
            2: 'EXPIRED',
            3: 'REJECTED'
        };
        return policyStatusMap[onchainStatus] || 'PENDING';
    } else if (entityType === 'claim') {
        const claimStatusMap = {
            0: 'Pending',
            1: 'UnderReview',
            2: 'Approved',
            3: 'Rejected',
            4: 'Paid'
        };
        return claimStatusMap[onchainStatus] || 'Pending';
    }
    return null;
}

/**
 * Detect mismatches between DB and blockchain state
 */
function detectMismatches(dbRecord, onchainRecord, entityType) {
    const mismatches = [];

    // Status mismatch
    const chainStatus = mapOnchainStatusToDb(onchainRecord.status, entityType);
    if (chainStatus && chainStatus !== dbRecord.status) {
        // Skip if DB is PENDING_ONCHAIN (will be handled separately)
        if (dbRecord.status !== 'PENDING_ONCHAIN') {
            mismatches.push({
                field: 'status',
                dbValue: dbRecord.status,
                chainValue: chainStatus,
                severity: 'high',
                reason: 'Status mismatch between DB and blockchain'
            });
        }
    }

    // Amount mismatch (critical)
    const amountField = entityType === 'policy' ? 'coverageAmount' : 'amount';
    if (onchainRecord.coverageAmount && onchainRecord.coverageAmount.toString() !== dbRecord[amountField]) {
        mismatches.push({
            field: amountField,
            dbValue: dbRecord[amountField],
            chainValue: onchainRecord.coverageAmount.toString(),
            severity: 'critical',
            reason: 'Amount discrepancy - requires manual review'
        });
    }

    return mismatches;
}

/**
 * Determine if a mismatch can be auto-fixed safely
 */
function isSafeToAutoFix(mismatch) {
    // Only auto-fix status changes and non-critical mismatches
    if (!AUTO_FIX_ENABLED) return false;

    if (mismatch.severity === 'critical') return false;
    if (mismatch.field === 'coverageAmount' || mismatch.field === 'amount') return false;
    if (mismatch.field === 'beneficiaryAddress') return false;

    // Safe to auto-fix: status changes
    if (mismatch.field === 'status') return true;

    return false;
}

/**
 * Auto-fix a mismatch (update DB to match blockchain)
 */
async function autoFix(mismatch, dbRecord, entityType) {
    try {
        const updateData = {
            [mismatch.field]: mismatch.chainValue
        };

        let updated;
        if (entityType === 'policy') {
            updated = await prisma.policy.update({
                where: { id: dbRecord.id },
                data: updateData
            });
        } else {
            updated = await prisma.claim.update({
                where: { id: dbRecord.id },
                data: updateData
            });
        }

        // Create audit log
        await prisma.reconciliationAudit.create({
            data: {
                action: 'auto_fix',
                entityType,
                entityId: dbRecord.id,
                fieldName: mismatch.field,
                oldValue: JSON.stringify(mismatch.dbValue),
                newValue: JSON.stringify(mismatch.chainValue),
                onchainTxHash: dbRecord.onchainTxHash,
                onchainBlockNumber: dbRecord.onchainBlockNumber,
                reconcileReason: mismatch.reason,
                appliedBy: 'system'
            }
        });

        console.log(JSON.stringify({
            event: 'auto_fix_applied',
            entityType,
            entityId: dbRecord.id,
            field: mismatch.field,
            oldValue: mismatch.dbValue,
            newValue: mismatch.chainValue
        }));

        stats.autoFixed++;
        return updated;
    } catch (error) {
        console.error(JSON.stringify({
            event: 'auto_fix_error',
            error: error.message,
            entityType,
            entityId: dbRecord.id
        }));
        throw error;
    }
}

/**
 * Create a suggestion for manual review
 */
async function createSuggestion(mismatch, dbRecord, entityType) {
    try {
        await prisma.reconciliationAudit.create({
            data: {
                action: 'suggestion',
                entityType,
                entityId: dbRecord.id,
                fieldName: mismatch.field,
                oldValue: JSON.stringify(mismatch.dbValue),
                newValue: JSON.stringify(mismatch.chainValue),
                onchainTxHash: dbRecord.onchainTxHash,
                onchainBlockNumber: dbRecord.onchainBlockNumber,
                reconcileReason: mismatch.reason + ' (manual review required)',
                appliedBy: 'pending'
            }
        });

        console.log(JSON.stringify({
            event: 'suggestion_created',
            entityType,
            entityId: dbRecord.id,
            field: mismatch.field,
            severity: mismatch.severity
        }));

        stats.pendingSuggestions++;
    } catch (error) {
        console.error(JSON.stringify({
            event: 'suggestion_error',
            error: error.message
        }));
    }
}

/**
 * Handle PENDING_ONCHAIN status promotion
 */
async function handlePendingOnchain(dbRecord, onchainRecord, entityType) {
    try {
        // If event confirmed and status is ACTIVE on chain, promote from PENDING_ONCHAIN
        const chainStatus = mapOnchainStatusToDb(onchainRecord.status, entityType);

        if (chainStatus === 'ACTIVE' || chainStatus === 'Submitted') {
            const updateData = { status: chainStatus };

            let updated;
            if (entityType === 'policy') {
                updated = await prisma.policy.update({
                    where: { id: dbRecord.id },
                    data: updateData
                });
            } else {
                updated = await prisma.claim.update({
                    where: { id: dbRecord.id },
                    data: updateData
                });
            }

            // Audit log
            await prisma.reconciliationAudit.create({
                data: {
                    action: 'auto_fix',
                    entityType,
                    entityId: dbRecord.id,
                    fieldName: 'status',
                    oldValue: 'PENDING_ONCHAIN',
                    newValue: chainStatus,
                    onchainTxHash: dbRecord.onchainTxHash,
                    onchainBlockNumber: dbRecord.onchainBlockNumber,
                    reconcileReason: 'Promoted from PENDING_ONCHAIN after event confirmation',
                    appliedBy: 'system'
                }
            });

            console.log(JSON.stringify({
                event: 'pending_onchain_promoted',
                entityType,
                entityId: dbRecord.id,
                newStatus: chainStatus
            }));

            stats.autoFixed++;
            return updated;
        }
    } catch (error) {
        console.error(JSON.stringify({
            event: 'pending_onchain_error',
            error: error.message
        }));
    }
}

/**
 * Reconcile policies with blockchain state
 */
async function reconcilePolicies() {
    try {
        const { policyContract } = getContracts();

        // Get policies with onchain IDs
        const policies = await prisma.policy.findMany({
            where: {
                onchainPolicyId: { not: null }
            },
            take: MAX_BATCH_SIZE
        });

        console.log(`[RECONCILE] Processing ${policies.length} policies`);

        for (const policy of policies) {
            // Handle PENDING_ONCHAIN specifically
            if (policy.status === 'PENDING_ONCHAIN') {
                const onchainPolicy = await policyContract.policies(policy.onchainPolicyId);
                await handlePendingOnchain(policy, onchainPolicy, 'policy');
                continue;
            }

            // Get on-chain state
            const onchainPolicy = await policyContract.policies(policy.onchainPolicyId);

            // Detect mismatches
            const mismatches = detectMismatches(policy, onchainPolicy, 'policy');

            // Process each mismatch
            for (const mismatch of mismatches) {
                if (isSafeToAutoFix(mismatch)) {
                    await autoFix(mismatch, policy, 'policy');
                } else {
                    await createSuggestion(mismatch, policy, 'policy');
                }
                stats.totalReconciled++;
            }
        }
    } catch (error) {
        console.error(JSON.stringify({
            event: 'reconcile_policies_error',
            error: error.message
        }));
    }
}

/**
 * Reconcile claims with blockchain state
 */
async function reconcileClaims() {
    try {
        const { claimContract } = getContracts();

        const claims = await prisma.claim.findMany({
            where: {
                onchainClaimId: { not: null }
            },
            take: MAX_BATCH_SIZE
        });

        console.log(`[RECONCILE] Processing ${claims.length} claims`);

        for (const claim of claims) {
            // Handle PENDING_ONCHAIN
            if (claim.status === 'PENDING_ONCHAIN') {
                const onchainClaim = await claimContract.claims(claim.onchainClaimId);
                await handlePendingOnchain(claim, onchainClaim, 'claim');
                continue;
            }

            // Get on-chain state
            const onchainClaim = await claimContract.claims(claim.onchainClaimId);

            // Detect mismatches
            const mismatches = detectMismatches(claim, { ...onchainClaim, status: onchainClaim.status }, 'claim');

            // Process mismatches
            for (const mismatch of mismatches) {
                if (isSafeToAutoFix(mismatch)) {
                    await autoFix(mismatch, claim, 'claim');
                } else {
                    await createSuggestion(mismatch, claim, 'claim');
                }
                stats.totalReconciled++;
            }
        }
    } catch (error) {
        console.error(JSON.stringify({
            event: 'reconcile_claims_error',
            error: error.message
        }));
    }
}

/**
 * Run complete reconciliation
 */
export async function runReconciliation() {
    if (isRunning) {
        console.log('[RECONCILE] Already running, skipping');
        return;
    }

    try {
        isRunning = true;
        lastRunTime = new Date();

        console.log(JSON.stringify({
            event: 'reconciliation_started',
            timestamp: lastRunTime.toISOString()
        }));

        await reconcilePolicies();
        await reconcileClaims();

        console.log(JSON.stringify({
            event: 'reconciliation_complete',
            stats,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'reconciliation_error',
            error: error.message
        }));
    } finally {
        isRunning = false;
    }
}

/**
 * Start periodic reconciliation
 */
export function startReconciler() {
    console.log(JSON.stringify({
        event: 'reconciler_started',
        interval: RECONCILE_INTERVAL,
        autoFixEnabled: AUTO_FIX_ENABLED
    }));

    // Run immediately
    runReconciliation();

    // Then run on interval
    const intervalId = setInterval(runReconciliation, RECONCILE_INTERVAL);

    return () => {
        clearInterval(intervalId);
        console.log('[RECONCILE] Stopped');
    };
}

/**
 * Get reconciler status
 */
export function getReconcilerStatus() {
    return {
        isRunning,
        lastRun: lastRunTime,
        interval: RECONCILE_INTERVAL,
        autoFixEnabled: AUTO_FIX_ENABLED,
        stats
    };
}

export default {
    runReconciliation,
    startReconciler,
    getReconcilerStatus
};
