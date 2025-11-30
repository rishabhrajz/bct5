import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { initContracts } from './contract-service.js';
import { getOrCreateIssuerDid } from './veramo-setup.js';
import { startEventListener, getListenerHealth } from './services/event-listener.js';
import { runReconciliation, getReconcilerStatus, startReconciler } from './services/reconciler.js';
import { pinFile } from './ipfs-pinata.js';
import { handleProviderOnboard, handleListProviders } from './controllers/provider-controller.js';
import { handleIssuePolicy, handleListPolicies, handleGetPolicy } from './controllers/policy-controller.js';
import { handleSubmitClaim, handleUpdateClaimStatus, handleListClaims } from './controllers/claim-controller.js';
import * as approvalService from './services/approval-service.js';
import * as kycService from './services/kyc-service.js';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Health check endpoints
app.get('/health', (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        eventListener: getListenerHealth(),
        reconciler: getReconcilerStatus()
    };
    res.json(health);
});

// Liveness probe (for container orchestration)
app.get('/health/liveness', (req, res) => {
    res.status(200).json({ alive: true, timestamp: new Date().toISOString() });
});

// Readiness probe (checks all dependencies)
app.get('/health/readiness', async (req, res) => {
    const checks = {
        database: false,
        blockchain: false,
        eventListener: false,
        migrations: false
    };

    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;
        checks.database = true;

        // Check if migrations are applied
        try {
            await prisma.policy.count();
            checks.migrations = true;
        } catch (e) {
            checks.migrations = false;
        }

        // Check blockchain connection
        try {
            const { policyContract } = getContracts();
            const network = await policyContract.runner.provider.getNetwork();
            checks.blockchain = network.chainId > 0;
        } catch (e) {
            checks.blockchain = false;
        }

        // Check event listener
        const listener = getListenerHealth();
        checks.eventListener = listener.isRunning === true;

        const allReady = Object.values(checks).every(v => v === true);

        res.status(allReady ? 200 : 503).json({
            ready: allReady,
            checks,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            ready: false,
            checks,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Metrics endpoint (simple counters)
let metrics = {
    tx_sent_count: 0,
    tx_mined_count: 0,
    reconciler_runs: 0,
    reconciler_fixes: 0,
    api_requests: 0
};

app.get('/metrics', (req, res) => {
    const reconcilerStatus = getReconcilerStatus();
    res.json({
        ...metrics,
        reconciler_total_reconciled: reconcilerStatus.stats?.totalReconciled || 0,
        reconciler_auto_fixed: reconcilerStatus.stats?.autoFixed || 0,
        reconciler_pending_suggestions: reconcilerStatus.stats?.pendingSuggestions || 0,
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Request counter middleware
app.use((req, res, next) => {
    metrics.api_requests++;
    next();
});

// Reconciler endpoints
app.get('/api/reconcile/status', (req, res) => {
    const status = getReconcilerStatus();
    res.json(status);
});

app.get('/api/reconcile/mismatches', async (req, res) => {
    try {
        // Get all suggestions (pending manual review)
        const suggestions = await prisma.reconciliationAudit.findMany({
            where: {
                action: 'suggestion',
                appliedBy: 'pending'
            },
            orderBy: { timestamp: 'desc' },
            take: 100
        });

        const mismatches = suggestions.map(s => ({
            id: `${s.entityType}_${s.entityId}`,
            entityType: s.entityType,
            entityId: s.entityId,
            field: s.fieldName,
            dbValue: s.oldValue,
            chainValue: s.newValue,
            detectedAt: s.timestamp,
            severity: s.reconcileReason.includes('critical') ? 'critical' : 'high',
            reason: s.reconcileReason
        }));

        res.json({ mismatches, count: mismatches.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reconcile/suggestions', async (req, res) => {
    try {
        const suggestions = await prisma.reconciliationAudit.findMany({
            where: {
                action: 'suggestion',
                appliedBy: 'pending'
            },
            orderBy: { timestamp: 'desc' }
        });

        res.json({ suggestions, count: suggestions.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reconcile/apply/:id', async (req, res) => {
    try {
        const suggestionId = parseInt(req.params.id);
        const { adminAddress } = req.body;

        const suggestion = await prisma.reconciliationAudit.findUnique({
            where: { id: suggestionId }
        });

        if (!suggestion || suggestion.action !== 'suggestion') {
            return res.status(404).json({ error: 'Suggestion not found' });
        }

        if (suggestion.appliedBy !== 'pending') {
            return res.status(400).json({ error: 'Suggestion already applied' });
        }

        // Apply the suggestion
        const newValue = JSON.parse(suggestion.newValue);
        const updateData = { [suggestion.fieldName]: newValue };

        if (suggestion.entityType === 'policy') {
            await prisma.policy.update({
                where: { id: suggestion.entityId },
                data: updateData
            });
        } else {
            await prisma.claim.update({
                where: { id: suggestion.entityId },
                data: updateData
            });
        }

        // Mark suggestion as applied
        await prisma.reconciliationAudit.update({
            where: { id: suggestionId },
            data: {
                appliedBy: adminAddress || 'admin',
                action: 'manual_apply'
            }
        });

        res.json({
            success: true,
            applied: {
                entityType: suggestion.entityType,
                entityId: suggestion.entityId,
                oldValue: suggestion.oldValue,
                newValue: suggestion.newValue
            },
            auditId: suggestionId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reconcile/run', async (req, res) => {
    try {
        await runReconciliation();
        res.json({ success: true, message: 'Reconciliation triggered' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Provider Routes =====
app.post('/provider/onboard', upload.single('file'), handleProviderOnboard);
app.get('/provider/list', handleListProviders);

// ===== Policy Routes =====
app.post('/policy/issue', handleIssuePolicy);

// Canonical policy recording endpoint with transaction verification
app.post('/policy/record', async (req, res) => {
    try {
        const {
            txHash,
            beneficiaryAddress,
            beneficiaryDid,
            coverageAmount,
            startEpoch,
            endEpoch,
            tier,
            premiumAmount,
            kycCid
        } = req.body;

        console.log('[API] Recording policy from tx:', txHash);

        // Import safe policy service
        const { recordPolicyFromBlockchain } = await import('./services/policy-service-v2.js');

        // Record policy with transaction verification
        const policy = await recordPolicyFromBlockchain({
            txHash,
            beneficiaryAddress,
            beneficiaryDid,
            coverageAmount,
            startEpoch,
            endEpoch,
            tier,
            premiumAmount,
            kycCid
        });

        res.json({
            ok: true,
            policy,
            message: policy.status === 'ACTIVE'
                ? 'Policy activated successfully'
                : 'Policy pending on-chain confirmation'
        });
    } catch (error) {
        console.error('[API] Error in /policy/record:', error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});
app.get('/policy/list', handleListPolicies);
app.get('/policy/:policyId', handleGetPolicy);

// ===== Claim Routes =====
app.post('/claim/submit', handleSubmitClaim);
app.post('/claim/update-status', handleUpdateClaimStatus);
app.get('/claim/list', handleListClaims);

// Safe claim endpoints
import * as claimServiceSafe from './services/claim-service-safe.js';

app.post('/claim/review/:id', async (req, res) => {
    try {
        const result = await claimServiceSafe.reviewClaimSafe(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('Review claim error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/claim/approve-safe/:id', async (req, res) => {
    try {
        const { payoutAmount } = req.body;
        if (!payoutAmount) {
            return res.status(400).json({ error: 'payoutAmount required' });
        }
        const result = await claimServiceSafe.approveClaimSafe(parseInt(req.params.id), payoutAmount);
        res.json(result);
    } catch (error) {
        console.error('Approve claim error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/claim/reject-safe/:id', async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: 'reason required' });
        }
        const result = await claimServiceSafe.rejectClaimSafe(parseInt(req.params.id), reason);
        res.json(result);
    } catch (error) {
        console.error('Reject claim error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== File Upload Route =====
app.post('/file/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const result = await pinFile(req.file.buffer, req.file.originalname);

        res.json({
            success: true,
            fileCid: result.cid,
            gatewayUrl: result.gatewayUrl,
            filename: req.file.originalname
        });
    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({
            error: 'Failed to upload file',
            message: error.message
        });
    }
});

// ===== KYC Routes =====
app.post('/kyc/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { userAddress, documentType, userDid } = req.body;

        if (!userAddress || !documentType) {
            return res.status(400).json({ error: 'userAddress and documentType required' });
        }

        // Upload to IPFS
        const result = await pinFile(req.file.buffer, req.file.originalname);

        // Store KYC record
        const kycDoc = await kycService.uploadKYCDocument(
            userAddress,
            documentType,
            result.cid,
            userDid
        );

        res.json({
            success: true,
            documentCid: result.cid,
            gatewayUrl: result.gatewayUrl,
            kycDocument: kycDoc
        });
    } catch (error) {
        console.error('KYC upload error:', error);
        res.status(500).json({
            error: 'Failed to upload KYC document',
            message: error.message
        });
    }
});

app.get('/kyc/:userAddress', async (req, res) => {
    try {
        const { userAddress } = req.params;
        const kycDocs = await kycService.getKYCByAddress(userAddress);

        res.json({
            success: true,
            documents: kycDocs
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/kyc/pending/list', async (req, res) => {
    try {
        const pending = await kycService.getPendingKYC();
        res.json({ success: true, documents: pending });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/kyc/verify/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { verifierAddress } = req.body;

        const kycDoc = await kycService.verifyKYC(parseInt(id), verifierAddress);
        res.json({ success: true, document: kycDoc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/kyc/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, verifierAddress } = req.body;

        const kycDoc = await kycService.rejectKYC(parseInt(id), reason, verifierAddress);
        res.json({ success: true, document: kycDoc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Provider Approval Routes =====
app.get('/provider/pending', async (req, res) => {
    try {
        const providers = await approvalService.getPendingProviders();
        res.json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/provider/approve/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { insurerAddress } = req.body;

        const provider = await approvalService.approveProvider(parseInt(id), insurerAddress);
        res.json({ success: true, provider });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/provider/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, insurerAddress } = req.body;

        const provider = await approvalService.rejectProvider(parseInt(id), reason, insurerAddress);
        res.json({ success: true, provider });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Policy Approval Routes =====
app.get('/policy/pending', async (req, res) => {
    try {
        const policies = await approvalService.getPendingPolicies();
        res.json({ success: true, policies });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/policy/approve/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { insurerAddress } = req.body;

        const policy = await approvalService.approvePolicy(parseInt(id), insurerAddress);
        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/policy/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, insurerAddress, refundTxHash } = req.body;

        const policy = await approvalService.rejectPolicy(
            parseInt(id),
            reason,
            insurerAddress,
            refundTxHash
        );
        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Claim Approval Routes =====
app.get('/claim/pending', async (req, res) => {
    try {
        const claims = await approvalService.getPendingClaims();
        res.json({ success: true, claims });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/claim/under-review', async (req, res) => {
    try {
        const claims = await approvalService.getUnderReviewClaims();
        res.json({ success: true, claims });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Legacy endpoint - use /claim/review/:id instead
app.post('/claim/under-review/:id', async (req, res) => {
    try {
        const result = await claimServiceSafe.reviewClaimSafe(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Legacy endpoint - use /claim/approve-safe/:id instead  
app.post('/claim/approve/:id', async (req, res) => {
    try {
        const { payoutAmount } = req.body;
        if (!payoutAmount) {
            return res.status(400).json({ error: 'payoutAmount required' });
        }
        const result = await claimServiceSafe.approveClaimSafe(parseInt(req.params.id), payoutAmount);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Legacy endpoint - use /claim/reject-safe/:id instead
app.post('/claim/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const claim = await approvalService.rejectClaim(parseInt(id), reason);
        res.json({ success: true, claim });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/claim/mark-paid/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { txHash } = req.body;

        const claim = await approvalService.markClaimPaid(parseInt(id), txHash);
        res.json({ success: true, claim });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== DID Management Routes =====
app.post('/did/create', async (req, res) => {
    try {
        const { alias } = req.body;

        // Create a DID using didManagerCreate
        // Don't pass alias if it's not provided to avoid conflicts
        const createOptions = {
            provider: 'did:ethr:localhost',
            kms: 'local',
            options: {
                keyType: 'Secp256k1'
            }
        };

        // Only add alias if provided and not empty
        if (alias && alias.trim()) {
            createOptions.alias = alias.trim();
        }

        const identifier = await veramoAgent.didManagerCreate(createOptions);

        res.json({
            success: true,
            did: identifier.did,
            alias: identifier.alias || null
        });
    } catch (error) {
        console.error('DID creation error:', error);
        res.status(500).json({
            error: 'Failed to create DID',
            message: error.message
        });
    }
});

// ===== Debug Routes (DEV only) =====
if (process.env.NODE_ENV === 'development') {
    app.get('/debug/providers', async (req, res) => {
        try {
            const providers = await prisma.provider.findMany({
                select: {
                    id: true,
                    providerDid: true,
                    providerAddress: true,
                    name: true,
                    vcCid: true,
                    licenseCid: true,
                    createdAt: true
                }
            });

            res.json({
                success: true,
                providers,
                count: providers.length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/debug/policies', async (req, res) => {
        try {
            const policies = await prisma.policy.findMany({
                select: {
                    id: true,
                    onchainPolicyId: true,
                    beneficiaryAddress: true,
                    coverageAmount: true,
                    providerId: true,
                    createdAt: true
                }
            });

            res.json({
                success: true,
                policies,
                count: policies.length,
                mapping: policies.map(p => ({
                    onchainPolicyId: p.onchainPolicyId,
                    providerId: p.providerId
                }))
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/debug/claims', async (req, res) => {
        try {
            const claims = await prisma.claim.findMany({
                include: {
                    policy: {
                        select: {
                            onchainPolicyId: true,
                            providerId: true
                        }
                    }
                }
            });

            res.json({
                success: true,
                claims,
                count: claims.length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Initialize and start server
async function startServer() {
    try {
        console.log('🚀 Starting ProjectY Backend...\n');

        // Initialize Veramo and get/create issuer DID
        console.log('📝 Initializing Veramo...');
        await getOrCreateIssuerDid();

        // Initialize contracts
        console.log('⛓️  Initializing contracts...');
        await initContracts();
        console.log('✅ Contracts initialized\n');

        // Start event listener in development
        if (process.env.NODE_ENV !== 'production') {
            console.log('🎧 Starting event listener...');
            startEventListener();

            // Start reconciler
            console.log('🔄 Starting reconciler...');
            startReconciler();
            console.log('✅ Event listener started\n');
        }

        // Start HTTP server
        app.listen(PORT, () => {
            console.log(`\n✅ ProjectY Backend running on port ${PORT}`);
            console.log(`   Health check: http://localhost:${PORT}/health`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
