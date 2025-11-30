#!/usr/bin/env node
/**
 * Integration Test - Event Listener
 * 
 * Tests that event listener correctly updates DB when contract events are emitted
 */

import { ethers } from 'ethers';
import fs from 'fs';

const RPC_URL = 'http://127.0.0.1:8545';
const API_BASE = 'http://localhost:4000';

// Dev account
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function testEventListener() {
    console.log('🧪 Testing Event Listener Integration\n');

    try {
        // 1. Connect to blockchain
        console.log('Step 1: Connecting to blockchain...');
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        console.log(`✅ Connected as: ${wallet.address}\n`);

        // 2. Load deployed contracts
        console.log('Step 2: Loading deployed contracts...');
        const deployed = JSON.parse(fs.readFileSync('./deployments/deployed.json', 'utf8'));
        const policyAddress = deployed.contracts.PolicyContract;
        const claimAddress = deployed.contracts.ClaimContract;
        console.log(`✅ PolicyContract: ${policyAddress}`);
        console.log(`✅ ClaimContract: ${claimAddress}\n`);

        // 3. Load contract ABIs
        const policyABI = JSON.parse(
            fs.readFileSync('./artifacts/contracts/PolicyContract.sol/PolicyContract.json', 'utf8')
        ).abi;
        const claimABI = JSON.parse(
            fs.readFileSync('./artifacts/contracts/ClaimContract.sol/ClaimContract.json', 'utf8')
        ).abi;

        const policyContract = new ethers.Contract(policyAddress, policyABI, wallet);
        const claimContract = new ethers.Contract(claimAddress, claimABI, wallet);

        // 4. Test Policy Event
        console.log('Step 3: Submitting policy transaction...');
        const coverageAmount = ethers.parseEther('1');
        const tier = 1; // Standard
        const now = Math.floor(Date.now() / 1000);
        const startEpoch = now + 60;
        const endEpoch = startEpoch + (365 * 24 * 60 * 60);
        const kycCid = 'QmTestKYC123';
        const premiumAmount = ethers.parseEther('0.02');

        const policyTx = await policyContract.requestPolicy(
            wallet.address,
            coverageAmount,
            tier,
            startEpoch,
            endEpoch,
            kycCid,
            { value: premiumAmount }
        );
        console.log(`TX sent: ${policyTx.hash}`);

        const policyReceipt = await policyTx.wait(1);
        console.log(`✅ Policy TX mined in block ${policyReceipt.blockNumber}\n`);

        // Extract policy ID from events
        const policyEvent = policyReceipt.logs
            .map(log => {
                try {
                    return policyContract.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(event => event && event.name === 'PolicyIssued');

        if (!policyEvent) {
            throw new Error('PolicyIssued event not found');
        }

        const policyId = policyEvent.args.policyId;
        console.log(`Policy ID: ${policyId}`);

        // 5. Wait for event listener to process (max 15 seconds)
        console.log('Step 4: Waiting for event listener to update DB...');
        let dbUpdated = false;
        for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if policy exists in DB
            try {
                const response = await fetch(`${API_BASE}/policy/list`);
                const data = await response.json();
                const policy = data.policies?.find(p =>
                    p.onchainPolicyId === parseInt(policyId.toString())
                );

                if (policy) {
                    console.log(`✅ DB updated! Policy found:`);
                    console.log(`   ID: ${policy.id}`);
                    console.log(`   Status: ${policy.status}`);
                    console.log(`   TX Hash: ${policy.onchainTxHash || 'none'}`);
                    console.log(`   Block: ${policy.onchainBlockNumber || 'none'}`);
                    console.log(`   Source: ${policy.source || 'unknown'}`);
                    console.log(`   Beneficiary: ${policy.beneficiaryAddress}`);

                    // Verify all critical fields
                    const checks = {
                        status: policy.status === 'ACTIVE',
                        onchainPolicyId: policy.onchainPolicyId === parseInt(policyId.toString()),
                        beneficiary: policy.beneficiaryAddress.toLowerCase() === wallet.address.toLowerCase(),
                        // Note: API may not return all fields, check what we can
                        exists: true
                    };

                    if (checks.status && checks.onchainPolicyId && checks.beneficiary) {
                        console.log(`\n✅ All checks passed!`);
                        dbUpdated = true;
                        break;
                    } else {
                        console.log(`   Warning: Some checks failed:`, checks);
                    }
                }
            } catch (err) {
                // Continue waiting
            }
        }

        if (!dbUpdated) {
            throw new Error('Event listener did not update DB within 15 seconds');
        }

        console.log('\n✅ Event Listener Integration Test PASSED!\n');
        console.log('Summary:');
        console.log('- Contract event emitted ✅');
        console.log('- Listener detected event ✅');
        console.log('- Policy created in DB from on-chain data ✅');
        console.log('- Status: ACTIVE ✅');
        console.log('- Total time: <15 seconds ✅');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test FAILED!');
        console.error('Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run test
testEventListener();
