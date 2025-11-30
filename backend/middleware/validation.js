import { ethers } from 'ethers';

/**
 * Input Validation Middleware
 */

// Validate numeric ID parameter
export function validateId(req, res, next) {
    const id = parseInt(req.params.id);
    if (!id || id < 1 || !Number.isInteger(id)) {
        return res.status(400).json({
            error: {
                code: 'INVALID_ID',
                message: 'ID must be a positive integer',
                details: { provided: req.params.id }
            }
        });
    }
    req.validatedId = id;
    next();
}

// Validate Ethereum address
export function validateAddress(fieldName = 'address') {
    return (req, res, next) => {
        try {
            const address = req.body[fieldName];
            if (!address) {
                return res.status(400).json({
                    error: {
                        code: 'MISSING_ADDRESS',
                        message: `${fieldName} is required`,
                        details: { field: fieldName }
                    }
                });
            }
            req.body[`validated_${fieldName}`] = ethers.getAddress(address);
            next();
        } catch (error) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_ADDRESS',
                    message: `Invalid Ethereum address for ${fieldName}`,
                    details: { field: fieldName, provided: req.body[fieldName] }
                }
            });
        }
    };
}

// Validate positive amount
export function validateAmount(fieldName = 'amount') {
    return (req, res, next) => {
        const amount = req.body[fieldName];
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_AMOUNT',
                    message: `${fieldName} must be a positive number`,
                    details: { field: fieldName, provided: amount }
                }
            });
        }
        next();
    };
}

// Validate IPFS CID format (basic check)
export function validateCid(fieldName = 'cid') {
    return (req, res, next) => {
        const cid = req.body[fieldName];
        if (!cid || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(cid)) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_CID',
                    message: `${fieldName} must be a valid IPFS CID`,
                    details: { field: fieldName, provided: cid }
                }
            });
        }
        next();
    };
}

// Rate limiting (simple in-memory implementation)
const rateLimitMap = new Map();

export function rateLimit(maxRequests = 10, windowMs = 1000) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        if (!rateLimitMap.has(ip)) {
            rateLimitMap.set(ip, []);
        }

        const requests = rateLimitMap.get(ip);
        const recentRequests = requests.filter(time => now - time < windowMs);

        if (recentRequests.length >= maxRequests) {
            return res.status(429).json({
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message: 'Too many requests, please try again later',
                    details: {
                        limit: maxRequests,
                        window: `${windowMs}ms`,
                        retryAfter: Math.ceil(windowMs / 1000)
                    }
                }
            });
        }

        recentRequests.push(now);
        rateLimitMap.set(ip, recentRequests);

        // Cleanup old entries periodically
        if (Math.random() < 0.01) {
            for (const [key, value] of rateLimitMap.entries()) {
                const filtered = value.filter(time => now - time < windowMs * 2);
                if (filtered.length === 0) {
                    rateLimitMap.delete(key);
                } else {
                    rateLimitMap.set(key, filtered);
                }
            }
        }

        next();
    };
}

// Error response helper
export function errorResponse(code, message, details = {}, statusCode = 500) {
    return {
        error: {
            code,
            message,
            details,
            timestamp: new Date().toISOString()
        }
    };
}

// Success response helper
export function successResponse(data, meta = {}) {
    return {
        success: true,
        data,
        meta: {
            timestamp: new Date().toISOString(),
            ...meta
        }
    };
}
