import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { initContracts } from './contract-service.js';
import { getOrCreateIssuerDid } from './veramo-setup.js';
import { startEventListener, getListenerHealth } from './services/event-listener.js';
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

// Health check
app.get('/health', (req, res) => {
    const listenerHealth = getListenerHealth();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        eventListener: listenerHealth
    });
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
            await startEventListener();
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
