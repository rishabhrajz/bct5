export function validateAddress(address) {
    if (!address) return 'Address is required';
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return 'Invalid Ethereum address format';
    }
    return null;
}

export function validateDID(did) {
    if (!did) return 'DID is required';
    if (!did.startsWith('did:ethr:')) {
        return 'DID must start with "did:ethr:"';
    }
    return null;
}

export function validateAmount(amount, min = 0) {
    if (!amount) return 'Amount is required';
    if (isNaN(amount)) return 'Amount must be a number';
    if (parseFloat(amount) <= parseFloat(min)) {
        return `Amount must be greater than ${min}`;
    }
    return null;
}

export function validateCID(cid) {
    if (!cid) return 'CID is required';
    if (!cid.startsWith('bafk') && !cid.startsWith('bafy') && !cid.startsWith('Qm')) {
        return 'Invalid IPFS CID format';
    }
    return null;
}

export function validatePolicyId(policyId) {
    if (!policyId) return 'Policy ID is required';
    const num = parseInt(policyId);
    if (isNaN(num) || num < 1) {
        return 'Policy ID must be a positive number';
    }
    return null;
}

export function formatError(error) {
    // Extract meaningful error messages from different error formats
    if (typeof error === 'string') return error;

    if (error.message) {
        // Contract errors
        if (error.message.includes('execution reverted')) {
            const match = error.message.match(/"([^"]+)"/);
            if (match) return match[1];
        }
        // Prisma errors
        if (error.message.includes('Unique constraint')) {
            return 'This record already exists in the database';
        }
        if (error.message.includes('not found')) {
            return error.message;
        }
        return error.message;
    }

    if (error.error) {
        return formatError(error.error);
    }

    return 'An unexpected error occurred';
}

export function shortenAddress(address, chars = 4) {
    if (!address) return '';
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function shortenDID(did, chars = 10) {
    if (!did) return '';
    if (did.length <= chars * 2) return did;
    return `${did.slice(0, chars)}...${did.slice(-chars)}`;
}

export function weiToEth(wei) {
    if (!wei) return '0';
    return (BigInt(wei) / BigInt(1e18)).toString();
}

export function ethToWei(eth) {
    if (!eth) return '0';
    return (BigInt(Math.floor(parseFloat(eth) * 1e18))).toString();
}
