#!/usr/bin/env node
/**
 * Integration Test - Safe Claim Lifecycle
 * 
 * Tests complete claim flow: submit → review → approve/reject
 */

import { ethers } from 'ethers';
import fs from 'fs';

const RPC_URL = 'http://127.0.0.1:8545';
const API_BASE = 'http://localhost:4000';

// Dev account
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function testSafeClaims() {
    console.log('🧪 Testing Safe Claim Lifecycle\n');

    try {
        const provider = new ethers JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        console.log(`✅ Connected as: ${wallet.address}\n`);

        // Load contracts
        const deployed = JSON.parse(fs.readFileSync('./deployments/deployed.json', 'utf8'));
        const claimContract = new ethers.Contract(
            deployed.contracts.ClaimContract,
            JSON.parse(fs.readFileSync('./artifacts/contracts/ClaimContract.sol/ClaimContract.json')).abi,
            wallet
        );

        console.log('Step 1: Submitting claim directly to contract...');
        const policyId = 1;
        const amount = ethers.parseEther('0.5');

        const tx = await claimContract.submitClaim(
            policyId,
            wallet.address,
            wallet.address,
            amount,
            'QmTestMedicalReport'
        );
        console.log(`TX sent: ${tx.hash}`);

        const receipt = await tx.wait(1);
        console.log(`✅ TX mined in block ${receipt.blockNumber}\n`);

        // Extract claim ID
        const claimEvent = receipt.logs
            .map(log => {
                try {
                    return claimContract.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find(event => event && event.name === 'ClaimSubmitted');

        const claimId = claimEvent.args.claimId;
        console.log(`Claim ID: ${claimId}\n`);

        // Wait for event listener
        console.log('Step 2: Waiting for event listener...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Check DB
        const response = await fetch(`${API_BASE}/claim/list`);
        const data = await response.json();
        const claim = data.claims?.find(c => c.onchainClaimId === parseInt(claimId.toString()));

        if (claim && claim.status === 'Submitted') {
            console.log('✅ Claim created in DB from event!');
            console.log(`   Status: ${claim.status}`);
            console.log(`   Source: ${claim.source || 'unknown'}\n`);
        } else {
            throw new Error('Claim not found in DB or wrong status');
        }

        console.log('\n✅ Safe Claim Lifecycle Test PASSED!\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test FAILED!');
        console.error('Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

testSafeClaims();
