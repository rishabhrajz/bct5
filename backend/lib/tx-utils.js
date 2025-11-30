import { ethers } from 'ethers';

/**
 * Safe transaction pattern with timeout & event verification
 * 
 * @param {ethers.Contract} contract - The contract instance
 * @param {string} methodName - The method to call
 * @param {Array} args - Arguments for the method
 * @param {Object} options - Transaction options (value, gasLimit, etc.)
 * @param {number} timeout - Timeout in milliseconds (default: 120000 = 2 minutes)
 * @returns {Promise<{tx, receipt}>} Transaction and receipt
 * @throws {Error} If transaction fails or times out
 */
export async function sendTransactionSafely(
    contract,
    methodName,
    args = [],
    options = {},
    timeout = 120000
) {
    try {
        // Send transaction
        const tx = await contract[methodName](...args, options);
        console.log(`[TX] ${methodName} sent: ${tx.hash}`);
        console.log(`[TX] From: ${await contract.signer.getAddress()}`);
        console.log(`[TX] To: ${contract.address}`);
        console.log(`[TX] Value: ${options.value || '0'} wei`);

        // Wait for confirmation with timeout
        const receipt = await Promise.race([
            tx.wait(1), // Wait for 1 confirmation
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TX_TIMEOUT')), timeout)
            )
        ]);

        // Verify transaction succeeded
        if (!receipt || receipt.status !== 1) {
            console.error(`[TX] Transaction failed:`, receipt);
            throw new Error('TX_FAILED');
        }

        console.log(`[TX] Confirmed in block ${receipt.blockNumber}`);
        console.log(`[TX] Gas used: ${receipt.gasUsed.toString()}`);

        return { tx, receipt };
    } catch (error) {
        console.error(`[TX] Error in ${methodName}:`, error.message);

        // Add context to error
        if (error.code === 'CALL_EXCEPTION') {
            error.message = `Contract call reverted: ${error.message}`;
        } else if (error.message === 'TX_TIMEOUT') {
            error.message = `Transaction timeout after ${timeout}ms. TX may still be pending.`;
        }

        throw error;
    }
}

/**
 * Verify that a specific event was emitted in a transaction receipt
 * 
 * @param {ethers.Contract} contract - The contract instance
 * @param {string} eventName - Name of the event to verify
 * @param {Array} filterArgs - Arguments for event filter (use null for any value)
 * @param {number} blockNumber - Block number to query
 * @returns {Promise<Object|null>} Parsed event or null if not found
 */
export async function verifyEvent(contract, eventName, filterArgs, blockNumber) {
    try {
        console.log(`[EVENT] Verifying ${eventName} in block ${blockNumber}...`);

        // Create event filter
        const filter = contract.filters[eventName](...filterArgs);

        // Query events in the specific block only
        const events = await contract.queryFilter(filter, blockNumber, blockNumber);

        if (events.length === 0) {
            console.warn(`[EVENT] ${eventName} not found in block ${blockNumber}`);
            return null;
        }

        console.log(`[EVENT] Found ${events.length} ${eventName} event(s)`);

        // Parse and return first event
        const parsedEvent = {
            name: events[0].event,
            args: events[0].args,
            blockNumber: events[0].blockNumber,
            transactionHash: events[0].transactionHash,
        };

        console.log(`[EVENT] Parsed:`, parsedEvent);

        return parsedEvent;
    } catch (error) {
        console.error(`[EVENT] Error verifying event:`, error.message);
        throw error;
    }
}

/**
 * Wait for a transaction receipt with retry logic
 * 
 * @param {ethers.providers.Provider} provider - Ethers provider
 * @param {string} txHash - Transaction hash
 * @param {number} confirmations - Number of confirmations to wait for (default: 1)
 * @param {number} timeout - Timeout in milliseconds (default: 120000)
 * @param {number} retries - Number of retries (default: 3)
 * @returns {Promise<Object>} Transaction receipt
 */
export async function waitForTransactionWithRetry(
    provider,
    txHash,
    confirmations = 1,
    timeout = 120000,
    retries = 3
) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[TX] Attempt ${attempt}/${retries} to get receipt for ${txHash}`);

            const receipt = await Promise.race([
                provider.waitForTransaction(txHash, confirmations),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('WAIT_TIMEOUT')), timeout)
                )
            ]);

            if (receipt) {
                console.log(`[TX] Receipt obtained in block ${receipt.blockNumber}`);
                return receipt;
            }
        } catch (error) {
            lastError = error;
            console.warn(`[TX] Attempt ${attempt} failed:`, error.message);

            if (attempt < retries) {
                const backoff = 1000 * attempt; // Exponential backoff
                console.log(`[TX] Retrying in ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
    }

    throw new Error(`Failed to get receipt after ${retries} attempts: ${lastError.message}`);
}

/**
 * Extract policy ID from PolicyIssued or PolicyCreated event
 * 
 * @param {Object} receipt - Transaction receipt
 * @param {ethers.Contract} contract - Contract instance
 * @returns {number|null} Policy ID or null if not found
 */
export function extractPolicyIdFromReceipt(receipt, contract) {
    try {
        // Try to find PolicyIssued event
        const policyIssuedEvent = receipt.logs.find(log => {
            try {
                const parsed = contract.interface.parseLog(log);
                return parsed.name === 'PolicyIssued' || parsed.name === 'PolicyCreated';
            } catch {
                return false;
            }
        });

        if (!policyIssuedEvent) {
            console.warn('[EXTRACT] PolicyIssued/PolicyCreated event not found in receipt');
            return null;
        }

        const parsed = contract.interface.parseLog(policyIssuedEvent);
        const policyId = Number(parsed.args[0]); // First arg is usually policyId

        console.log(`[EXTRACT] Policy ID: ${policyId}`);
        return policyId;
    } catch (error) {
        console.error('[EXTRACT] Error extracting policy ID:', error);
        return null;
    }
}

/**
 * Get current gas price with buffer
 * 
 * @param {ethers.providers.Provider} provider - Ethers provider
 * @param {number} bufferPercent - Percentage buffer to add (default: 20%)
 * @returns {Promise<BigNumber>} Gas price with buffer
 */
export async function getGasPriceWithBuffer(provider, bufferPercent = 20) {
    const gasPrice = await provider.getGasPrice();
    const buffer = gasPrice.mul(bufferPercent).div(100);
    return gasPrice.add(buffer);
}

export default {
    sendTransactionSafely,
    verifyEvent,
    waitForTransactionWithRetry,
    extractPolicyIdFromReceipt,
    getGasPriceWithBuffer,
};
