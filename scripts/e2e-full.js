#!/usr/bin/env node
/**
 * End-to-End Full System Smoke Test
 * 
 * Tests complete workflow: policy purchase → claim submission → reconciliation
 */

import { spawn, execSync } from 'child_process';
import { ethers } from 'ethers';
import fs from 'fs';
import { setTimeout } from 'timers/promises';

const RPC_URL = 'http://127.0.0.1:8545';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Test results
const results = {
    startTime: new Date().toISOString(),
    steps: [],
    status: 'RUNNING',
    errors: []
};

function log(message) {
    console.log(`[E2E] ${message}`);
}

function addStep(name, status, details = {}) {
    results.steps.push({
        name,
        status,
        timestamp: new Date().toISOString(),
        ...details
    });
    log(`${status === 'SUCCESS' ? '✅' : '❌'} ${name}`);
}

async function waitForService(url, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) return true;
        } catch (e) {
            // Service not ready yet
        }
        await setTimeout(2000);
    }
    throw new Error(`Service not ready at ${url}`);
}

async function runE2ETest() {
    log('🚀 Starting End-to-End Full System Test\n');

    try {
        // Step 1: Verify backend health
        log('Step 1: Verifying backend health...');
        try {
            const health = await fetch('http://localhost:4000/health');
            const healthData = await health.json();
            addStep('Backend Health Check', 'SUCCESS', {
                eventListener: healthData.eventListener?.isRunning,
                reconciler: healthData.reconciler?.interval > 0
            });
        } catch (error) {
            addStep('Backend Health Check', 'FAILED', { error: error.message });
            throw error;
        }

        // Step 2: Verify readiness
        log('Step 2: Checking system readiness...');
        try {
            const readiness = await fetch('http://localhost:4000/health/readiness');
            const readinessData = await readiness.json();

            if (!readinessData.ready) {
                throw new Error(`System not ready: ${JSON.stringify(readinessData.checks)}`);
            }

            addStep('Readiness Check', 'SUCCESS', { checks: readinessData.checks });
        } catch (error) {
            addStep('Readiness Check', 'FAILED', { error: error.message });
            throw error;
        }

        // Step 3: Test Policy Creation
        log('Step 3: Testing policy creation flow...');
        try {
            const provider = new ethers.JsonRpcProvider(RPC_URL);
            const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

            const deployed = JSON.parse(fs.readFileSync('./deployments/deployed.json', 'utf8'));
            const policyContractAbi = JSON.parse(
                fs.readFileSync('./artifacts/contracts/PolicyContract.sol/PolicyContract.json', 'utf8')
            ).abi;

            const policyContract = new ethers.Contract(
                deployed.contracts.PolicyContract,
                policyContractAbi,
                wallet
            );

            const coverageAmount = ethers.parseEther('1');
            const tier = 1;
            const now = Math.floor(Date.now() / 1000);
            const startEpoch = now + 60;
            const endEpoch = startEpoch + (365 * 24 * 60 * 60);
            const premiumAmount = ethers.parseEther('0.02');

            const tx = await policyContract.requestPolicy(
                wallet.address,
                coverageAmount,
                tier,
                startEpoch,
                endEpoch,
                'QmTestKYC',
                { value: premiumAmount }
            );

            const receipt = await tx.wait(1);

            // Wait for event listener to sync
            await setTimeout(8000);

            // Verify via API
            const policiesRes = await fetch('http://localhost:4000/policy/list');
            const policiesData = await policiesRes.json();

            addStep('Policy Creation', 'SUCCESS', {
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                policiesInDB: policiesData.length
            });
        } catch (error) {
            addStep('Policy Creation', 'FAILED', { error: error.message });
            // Don't throw - continue with other tests
        }

        // Step 4: Test Reconciler
        log('Step 4: Testing reconciler...');
        try {
            // Trigger manual reconciliation
            const reconcileResponse = await fetch('http://localhost:4000/api/reconcile/run', {
                method: 'POST'
            });
            const reconcileResult = await reconcileResponse.json();

            await setTimeout(5000);

            // Check reconciler status
            const statusResponse = await fetch('http://localhost:4000/api/reconcile/status');
            const status = await statusResponse.json();

            addStep('Reconciler Test', 'SUCCESS', {
                triggered: reconcileResult.success,
                lastRun: status.lastRun,
                stats: status.stats
            });
        } catch (error) {
            addStep('Reconciler Test', 'FAILED', { error: error.message });
        }

        // Step 5: Verify Metrics
        log('Step 5: Checking metrics...');
        try {
            const metricsRes = await fetch('http://localhost:4000/metrics');
            const metrics = await metricsRes.json();

            addStep('Metrics Check', 'SUCCESS', {
                apiRequests: metrics.api_requests,
                uptime: metrics.uptime_seconds
            });
        } catch (error) {
            addStep('Metrics Check', 'FAILED', { error: error.message });
        }

        // Final Status
        const failedSteps = results.steps.filter(s => s.status === 'FAILED');
        results.status = failedSteps.length === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS';
        results.endTime = new Date().toISOString();
        results.duration = `${(new Date(results.endTime) - new Date(results.startTime)) / 1000}s`;

        if (results.status === 'SUCCESS') {
            log('\n✅ E2E Full System Test PASSED!\n');
        } else {
            log(`\n⚠️  E2E Test completed with ${failedSteps.length} failed steps\n`);
        }

    } catch (error) {
        results.status = 'FAILED';
        results.endTime = new Date().toISOString();
        results.error = error.message;
        results.stack = error.stack;

        log('\n❌ E2E Full System Test FAILED!');
        log(`Error: ${error.message}\n`);
    } finally {
        // Write results to file
        const output = JSON.stringify(results, null, 2);
        fs.writeFileSync('artifacts/e2e-full.log', output);
        console.log('\n📄 Results written to artifacts/e2e-full.log');
        console.log(output);

        process.exit(results.status === 'SUCCESS' ? 0 : 1);
    }
}

// Run the test
runE2ETest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
