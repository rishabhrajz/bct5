# Diagnostic Report - Demo Run Analysis

**Date:** 2025-11-30  
**Session:** Fresh start demonstration after hard reset

---

## Executive Summary

Tested ProjectY demonstration flow (Steps 1-8 from README). Steps 1-7 completed successfully, but Step 8 (Claim Approval) failed due to 3 bugs:

1. **NaN Policy ID bug** - `/policy/pending` endpoint crashes with 500 error
2. **Claim status mismatch** - Database and blockchain out of sync
3. **MetaMask insufficient funds** - Possible cache issue

---

## Screenshot Analysis

### Screenshot 1: Claim Submission ✅ **SUCCESS**
- Provider successfully submitted medical claim
- Medical report uploaded to IPFS
- Console shows: "Policy recorded" → "Policy activated successfully"
- Claim amount: 0.5000 ETH

### Screenshot 2: Policy Purchase (MetaMask) ✅ **SUCCESS**
- MetaMask transaction request appeared correctly
- Premium calculation correct: 0.02 ETH (2% of 1 ETH coverage for Standard tier)
- User confirmed transaction
- Network fee: $1.26 E ETH

### Screenshot 3: Policy Confirmation ✅ **SUCCESS**
- Success toast: "Policy requested! Premium held in escrow. Awaiting verification."
- Console logs show successful policy recording
- Transaction confirmed on blockchain

### Screenshot 4: Insurer Dashboard ⚠️ **PARTIAL SUCCESS / ERRORS**
**What works:**
- Active Policies: 1 (Policy #1 visible)
- Claims Under Review: 1 (Claim #1 showing 0.5000 ETH)

**Console Errors:**
- Multiple `GET http://localhost:4000/policy/pending` → 500 Internal Server Error
- MetaMask RPC Error appears

### Screenshot 5: Claim Approval Attempt ❌ **FAILED**
- Modal opened: "Approve & Pay Claim #1"
- Payout Amount field: 0.5 ETH
- Console shows:
  - Repeated `GET http://localhost:4000/policy/pending` → 500 errors
  - MetaMask insufficient funds error
  - `InsureDashboard:16x133` error

---

## Diagnostic Commands & Results

### Command 1: Check Backend Terminal Logs

```bash
# Read backend terminal output
cat backend_terminal_output.log
```

**Output:**
```
Get policy error: PrismaClientValidationError: 
Invalid `prisma.policy.findUnique()` invocation:

{
  where: {
    onchainPolicyId: NaN
                     ~~~
  },
  include: {
    provider: true
  }
}

Argument onchainPolicyId: Got invalid value NaN on prisma.findUniquePolicy. 
Provided Float, expected Int.

    at Ui.validate (/Users/rishabhraj/Downloads/projecty/backend/node_modules/@prisma/client/runtime/library.js:148:73)
    at gn.createMessage (/Users/rishabhraj/Downloads/projecty/backend/node_modules/@prisma/client/runtime/library.js:164:1298)
    ...
    at async getPolicyByOnchainId (file:///Users/rishabhraj/Downloads/projecty/backend/services/policy-service.js:143:12)
    at async handleGetPolicy (file:///Users/rishabhraj/Downloads/projecty/backend/controllers/policy-controller.js:107:24)

🔍 Claim #1 set to under review

✅ Claim #1 approved for payout: 0.5

eth_estimateGas
  Contract call:       ClaimContract#approveAndPayClaim
  From:                0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
  To:                  0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0
  Value:               0.5 ETH

  Error: reverted with reason string 'Claim not under review'
```

**Analysis:**
- ❌ `/policy/pending` endpoint is being called but crashes with NaN policy ID
- ✅ Claim was marked as "under review" in database
- ❌ Smart contract rejects approval because claim status on blockchain is still "Submitted"

---

### Command 2: Check Policy Status

```bash
curl http://localhost:4000/policy/pending
```

**Output:**
```json
{
  "error": "Failed to get policy",
  "message": "Invalid `prisma.policy.findUnique()` invocation:\n\n{\n  where: {\n    onchainPolicyId: NaN\n  },\n  include: {\n    provider: true\n  }\n}\n\nArgument onchainPolicyId: Got invalid value NaN on prisma.findUniquePolicy. Provided Float, expected Int."
}
```

**Analysis:**
- The endpoint is trying to query with `onchainPolicyId: NaN`
- This causes Prisma to throw a validation error
- Results in 500 Internal Server Error

---

### Command 3: List All Policies

```bash
curl -s http://localhost:4000/policy/list | python3 -c "import sys, json; data=json.load(sys.stdin); print('Total policies:', len(data.get('policies', []))); [print(f\"Policy #{p['onchainPolicyId']}: {p['status']}\") for p in data.get('policies', [])]"
```

**Output:**
```
Total policies: 1
Policy #1: ACTIVE
```

**Analysis:**
- ✅ Policy #1 exists in database
- ✅ Status is ACTIVE
- ✅ Database insertion worked correctly

---

### Command 4: Check Pending Claims

```bash
curl -s http://localhost:4000/claim/pending | python3 -c "import sys, json; data=json.load(sys.stdin); print('Pending claims:', len(data.get('claims', [])))"
```

**Output:**
```
Pending claims: 0
```

**Analysis:**
- ❌ No claims returned as "pending"
- But frontend shows "Claims Under Review: 1"
- Indicates status mismatch: claim marked as "UNDER_REVIEW" in database but query is looking for "PENDING" status

---

### Command 5: Check Claim Status (from backend logs)

```
🔍 Claim #1 set to under review
✅ Claim #1 approved for payout: 0.5
Error: reverted with reason string 'Claim not under review'
```

**Analysis:**
- ✅ Backend marked claim as "under review" in database
- ✅ Backend tried to approve claim on blockchain
- ❌ Smart contract rejected because claim status on blockchain is still "Submitted" (not "UnderReview")

---

## Root Cause Analysis

### Bug #1: NaN Policy ID in `/policy/pending`

**Location:** `backend/controllers/policy-controller.js` or `backend/server.js`

**Root Cause:**
1. The `/policy/pending` endpoint is being called (likely by frontend polling)
2. The handler is trying to get a policy by ID
3. The policy ID is being passed as `undefined` or `null`
4. When parsed as integer, it becomes `NaN`
5. Prisma rejects `NaN` as invalid argument for `onchainPolicyId`

**Code Path:**
```
Frontend → GET /policy/pending → handleGetPolicy() → getPolicyByOnchainId(NaN) → Prisma Error
```

**Fix Required:**
- Add validation in the endpoint handler
- Check if `policyId` parameter exists and is a valid number
- Return empty array or 404 instead of crashing

---

### Bug #2: Claim Status Mismatch

**Location:** `backend/services/claim-service.js` or `backend/services/approval-service.js`

**Root Cause:**
1. When insurer clicks "Review" on a claim, backend updates database: `status = 'UNDER_REVIEW'`
2. But the smart contract's claim status is NOT updated (still `ClaimStatus.Pending = 0`)
3. When trying to approve, smart contract checks: `require(claim.status == ClaimStatus.UnderReview)`
4. Contract rejects with "Claim not under review"

**Expected Flow:**
```
DB: PENDING → UNDER_REVIEW → APPROVED
Contract: Pending → UnderReview → Approved
```

**Actual Flow:**
```
DB: PENDING → UNDER_REVIEW ✅ → APPROVED (attempted)
Contract: Pending → Pending ❌ → ERROR
```

**Fix Required:**
- Call smart contract's `reviewClaim()` function before updating database
- Or update the query to fetch claims with "PENDING" status instead of filtering

---

### Bug #3: MetaMask Insufficient Funds

**Location:** Frontend MetaMask interaction

**Root Cause:**
- MetaMask showing insufficient funds error
- But Hardhat test accounts start with 10000 ETH
- Likely causes:
  1. MetaMask nonce cache issue
  2. Wrong account selected (not Account #1)
  3. Multiple transactions pending

**Fix Required:**
- Reset MetaMask account: Settings → Advanced → Reset Account
- Or clear activity data
- Ensure using correct test account

---

## Steps Completed vs Failed

### ✅ Successfully Completed (Steps 1-7)

| Step | Description | Status | Evidence |
|------|-------------|--------|----------|
| 1 | Provider Onboarding | ✅ | Provider registered in system |
| 2 | Provider Approval (Insurer) | ✅ | Provider status = APPROVED |
| 3 | Patient Onboarding & KYC | ✅ | KYC document uploaded |
| 4 | KYC Approval (Insurer) | ✅ | KYC status = VERIFIED |
| 5 | Policy Purchase (Patient) | ✅ | Policy #1 created, premium 0.02 ETH paid |
| 6 | View Policy (Patient Dashboard) | ✅ | Policy #1 visible, status ACTIVE |
| 7 | Submit Claim (Provider) | ✅ | Claim #1 submitted, 0.5 ETH requested |

### ❌ Failed (Step 8)

| Step | Description | Status | Error |
|------|-------------|--------|-------|
| 8 | Approve Claim (Insurer) | ❌ | Multiple bugs: NaN policy ID, status mismatch, MetaMask error |

---

## Proposed Solutions

### Solution #1: Fix NaN Policy ID Bug

**File:** `backend/server.js` or `backend/controllers/policy-controller.js`

**Current Code (suspected):**
```javascript
app.get('/policy/pending', async (req, res) => {
    const policyId = parseInt(req.query.policyId); // Could be NaN
    const policy = await getPolicyByOnchainId(policyId); // Crashes if NaN
});
```

**Fixed Code:**
```javascript
app.get('/policy/pending', async (req, res) => {
    const policyId = parseInt(req.query.policyId);
    
    // Validation
    if (!policyId || isNaN(policyId)) {
        return res.json({ policies: [] }); // Return empty array
    }
    
    const policy = await getPolicyByOnchainId(policyId);
    // ...
});
```

---

### Solution #2: Fix Claim Status Synchronization

**Option A: Update blockchain when moving to "Under Review"**

**File:** `backend/services/approval-service.js`

```javascript
async function reviewClaim(claimId) {
    // Step 1: Update on blockchain
    const { claimContract, signer } = getContracts();
    const tx = await claimContract.reviewClaim(claimId);
    await tx.wait();
    
    // Step 2: Update database
    await prisma.claim.update({
        where: { id: claimId },
        data: { status: 'UNDER_REVIEW' }
    });
}
```

**Option B: Query for correct status**

**File:** `backend/services/approval-service.js`

```javascript
// Current (wrong)
async function getPendingClaims() {
    return await prisma.claim.findMany({
        where: { status: 'PENDING' } // Wrong - should be UNDER_REVIEW
    });
}

// Fixed
async function getPendingClaims() {
    return await prisma.claim.findMany({
        where: { 
            OR: [
                { status: 'PENDING' },
                { status: 'UNDER_REVIEW' }
            ]
        }
    });
}
```

---

### Solution #3: Fix MetaMask Issue

**Steps:**
1. Open MetaMask
2. Click Settings → Advanced
3. Click "Reset Account"
4. Retry transaction

**Or:**
1. Clear activity data: Settings → Advanced → "Clear activity tab data"
2. Refresh page
3. Retry

---

## Testing Verification Commands

After fixes, run these commands to verify:

```bash
# 1. Check policy endpoint doesn't crash
curl http://localhost:4000/policy/pending
# Expected: {"policies": []} or valid data

# 2. Check pending claims
curl http://localhost:4000/claim/pending
# Expected: Array with Claim #1

# 3. Check policy list
curl http://localhost:4000/policy/list | python3 -c "import sys, json; data=json.load(sys.stdin); print(f\"Policies: {len(data['policies'])}\")"
# Expected: Policies: 1

# 4. Run smoke test (after fixes)
node tests/smoke-test.js
# Expected: ✅ Smoke test PASSED!
```

---

## Recommended Next Steps

1. **Fix bugs** - Apply solutions #1 and #2
2. **Reset MetaMask** - Clear cache/nonce
3. **Re-run Step 8** - Approve claim again
4. **Verify payout** - Check provider receives 0.5 ETH
5. **Document fixes** - Update code with comments

---

## Environment State

### Running Services
- ✅ Hardhat Node: `http://127.0.0.1:8545` (Block #5+)
- ✅ Backend API: `http://localhost:4000`
- ✅ Frontend UI: `http://localhost:5173`

### Database
- ✅ Policies: 1 (Policy #1, status: ACTIVE)
- ⚠️ Claims: 1 (Claim #1, status mismatch)
- ✅ Providers: 1+ (approved)
- ✅ KYC: 1+ (verified)

### Blockchain
- ✅ Contract deployed: Policy, Claim, Identity Registry
- ✅ Policy #1 on-chain: ACTIVE
- ⚠️ Claim #1 on-chain: Pending (not UnderReview)

---

## Conclusion

**What Worked:**
- All backend services running
- Smart contracts deployed correctly
- Provider/Patient onboarding flows
- Policy purchase and premium escrow
- Claim submission

**What Needs Fixing:**
- `/policy/pending` endpoint NaN handling
- Claim status synchronization between DB and blockchain
- MetaMask account reset

**Impact:**
- Demo is 87.5% complete (7/8 steps)
- Core functionality works
- Only approval workflow has bugs

**Time to Fix:** ~15-30 minutes to apply all solutions and re-test.

---

**Report Generated:** 2025-11-30 00:39 IST  
**Session ID:** Fresh-start demo run  
**Status:** Awaiting user approval to apply fixes
