#!/usr/bin/env node
/**
 * Smoke Test - End-to-end policy creation flow
 * 
 * Tests: POST /policy/record with transaction verification
 * Expected: tx.hash → receipt → event → DB ACTIVE or PENDING_ONCHAIN
 */

const { ethers } = require('ethers');
const fetch = require('node-fetch');

const API_BASE = 'http://localhost:4000';
const RPC_URL = 'http://127.0.0.1:8545';

// Test account (Hardhat's first account)
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function runSmokeTest() {
    console.log('🧪 Starting smoke test...\n');

    try {
        // 1. Connect to blockchain
        console.log('Step 1: Connecting to blockchain...');
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        console.log(`✅ Connected as: ${wallet.address}\n`);

        // 2. Load deployed contract
        console.log('Step 2: Loading deployed contract...');
        const deployedData = require('../deployments/deployed.json');
        const policyContractAddress = deployedData.contracts.PolicyContract;
        console.log(`✅ PolicyContract at: ${policyContractAddress}\n`);

        const PolicyContract = new ethers.ContractFactory(
            require('../artifacts/contracts/PolicyContract.sol/PolicyContract.json').abi,
            require('../artifacts/contracts/PolicyContract.sol/PolicyContract.json').bytecode,
            wallet
        );
        const policyContract = PolicyContract.attach(policyContractAddress);

        // 3. Prepare policy parameters
        console.log('Step 3: Preparing policy parameters...');
        const coverageAmount = ethers.utils.parseEther('1'); // 1 ETH coverage
        const tier = 1; // Standard
        const now = Math.floor(Date.now() / 1000);
        const startEpoch = now + 60;
        const endEpoch = startEpoch + (365 * 24 * 60 * 60); // 1 year
        const kycCid = 'QmTest123'; // Mock KYC CID
        const premiumAmount = ethers.utils.parseEther('0.02'); // 2% premium

        console.log(`  Coverage: ${ethers.utils.formatEther(coverageAmount)} ETH`);
        console.log(`  Premium: ${ethers.utils.formatEther(premiumAmount)} ETH`);
        console.log(`  Tier: Standard`);
        console.log(`✅ Parameters ready\n`);

        // 4. Send blockchain transaction
        console.log('Step 4: Sending blockchain transaction...');
        const tx = await policyContract.requestPolicy(
            wallet.address,
            coverageAmount,
            tier,
            startEpoch,
            endEpoch,
            kycCid,
            { value: premiumAmount }
        );
        console.log(`✅ TX sent: ${tx.hash}\n`);

        // 5. Wait for confirmation
        console.log('Step 5: Waiting for confirmation...');
        const receipt = await tx.wait(1);
        console.log(`✅ Confirmed in block: ${receipt.blockNumber}`);
        console.log(`  Gas used: ${receipt.gasUsed.toString()}\n`);

        // 6. Call backend API
        console.log('Step 6: Recording policy via API...');
        const apiResponse = await fetch(`${API_BASE}/policy/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                txHash: receipt.hash,
                beneficiaryAddress: wallet.address,
                beneficiaryDid: `did:ethr:localhost:${wallet.address}`,
                coverageAmount: coverageAmount.toString(),
                startEpoch,
                endEpoch,
                tier: 'Standard',
                premiumAmount: premiumAmount.toString(),
                kycCid,
            }),
        });

        if (!apiResponse.ok) {
            const error = await apiResponse.text();
            throw new Error(`API call failed: ${error}`);
        }

        const result = await apiResponse.json();
        console.log(`✅ API Response:`, JSON.stringify(result, null, 2));
        console.log('');

        // 7. Verify policy status
        console.log('Step 7: Verifying policy status...');
        const policy = result.policy;

        if (policy.status === 'ACTIVE') {
            console.log('✅ Policy status: ACTIVE');
            console.log(`  Policy ID: ${policy.onchainPolicyId}`);
            console.log(`  TX Hash: ${policy.onchainTxHash}`);
            console.log(`  Block: ${policy.onchainBlockNumber}`);
        } else if (policy.status === 'PENDING_ONCHAIN') {
            console.log('⚠️  Policy status: PENDING_ONCHAIN');
            console.log('  (Event verification failed, reconciler will fix)');
        } else {
            throw new Error(`Unexpected policy status: ${policy.status}`);
        }

        console.log('\n✅ Smoke test PASSED!\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Smoke test FAILED!');
        console.error('Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run test
runSmokeTest();
