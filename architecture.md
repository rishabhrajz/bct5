# ProjectY Architecture Documentation

## System Overview

ProjectY is an event-driven, blockchain-backed insurance platform with real-time synchronization and automated reconciliation.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │   Provider   │  │   Patient    │  │  Admin Reconcile   │   │
│  │  Dashboard   │  │  Dashboard   │  │    Dashboard       │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└────────────┬────────────────┬─────────────────┬────────────────┘
             │                │                 │
             ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend API Layer                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Express REST API                                         │  │
│  │  - Provider onboarding     - Claim submission            │  │
│  │  - Policy issuance         - Reconciliation endpoints    │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────┬──────────────┬──────────────┬────────────────┬─────────┘
        │              │              │                │
        ▼              ▼              ▼                ▼
┌──────────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────────┐
│   Database   │ │Blockchain│ │  Veramo DID │ │  IPFS/Pinata │
│   (SQLite)   │ │(Hardhat) │ │  VC Service │ │   Storage    │
└──────┬───────┘ └────┬─────┘ └─────────────┘ └──────────────┘
       │              │
       │              │
       ▼              ▼
┌─────────────────────────────────┐
│     Background Services         │
│  ┌───────────────────────────┐ │
│  │   Event Listener          │ │
│  │   - Polls blockchain      │ │
│  │   - Syncs events → DB     │ │
│  └───────────────────────────┘ │
│  ┌───────────────────────────┐ │
│  │   Reconciler              │ │
│  │   - Compares DB vs chain  │ │
│  │   - Auto-fixes mismatches │ │
│  │   - Generates suggestions │ │
│  └───────────────────────────┘ │
└─────────────────────────────────┘
```

---

## Data Flow: Event-Driven Pipeline

**Complete flow from transaction to reconciliation:**

```
User Action → TX → Receipt → Event → DB → Reconciler → Admin UI

1. User submits policy/claim via frontend
2. Frontend sends TX to blockchain
3. Backend waits for receipt (with timeout)
4. Backend verifies event in receipt
5. DB updated only after event confirmation
6. Event listener syncs any missed events
7. Reconciler detects mismatches
8. Admin UI shows reconciliation status
```

---

## Pattern 1: Safe Transaction (Write Path)

**Used for:** Policy issuance, claim submission, claim approval

```javascript
// 1. Send TX
const tx = await contract.requestPolicy(...);

// 2. Wait for receipt (with timeout)
const receipt = await tx.wait(1);

// 3. Verify event
const event = await verifyEvent(contract, 'PolicyIssued', [policyId], receipt.blockNumber);

// 4. Update DB only if event confirmed
if (event) {
  await prisma.policy.create({ status: 'ACTIVE', ... });
} else {
  await prisma.policy.create({ status: 'PENDING_ONCHAIN', ... });
}
```

---

## Pattern 2: Event Listener (Read Path)

```javascript
// Poll blockchain every 5 seconds
const events = await policyContract.queryFilter(
  policyContract.filters.PolicyIssued(),
  lastBlock + 1,
  currentBlock
);

for (const event of events) {
  let policy = await prisma.policy.findFirst({
    where: { onchainPolicyId: event.args.policyId }
  });
  
  if (!policy) {
    // Query contract for full details
    const onchainPolicy = await policyContract.policies(event.args.policyId);
    
    // Create from on-chain data
    policy = await prisma.policy.create({
      ...onchainPolicy,
      source: 'onchain'
    });
  }
}
```

---

## Pattern 3: Reconciliation (Consistency Check)

```javascript
// Run every 60 seconds
for (const policy of policies) {
  const onchainPolicy = await policyContract.policies(policy.onchainPolicyId);
  
  // Detect mismatch
  if (policy.status !== mapOnchainStatus(onchainPolicy.status)) {
    // Auto-fix if safe
    if (isSafeToAutoFix({ field: 'status' })) {
      await prisma.policy.update({
        where: { id: policy.id },
        data: { status: mapOnchainStatus(onchainPolicy.status) }
      });
      
      // Log audit entry
      await prisma.reconciliationAudit.create({
        action: 'auto_fix',
        entityType: 'policy',
        fieldName: 'status',
        oldValue: policy.status,
        newValue: mapOnchainStatus(onchainPolicy.status)
      });
    } else {
      // Create suggestion for manual review
      await prisma.reconciliationAudit.create({
        action: 'suggestion',
        ...
      });
    }
  }
}
```

---

## Database Schema

### Core Models

**Policy**
- Unique constraint: `(onchainPolicyId, beneficiaryAddress)`
- Source: `'api'` or `'onchain'`
- Status: `PENDING`, `ACTIVE`, `PENDING_ONCHAIN`, `EXPIRED`

**Claim**
- Source: `'api'` or `'onchain'`  
- Status: `Submitted`, `UnderReview`, `Approved`, `Rejected`, `Paid`, `PENDING_ONCHAIN`

**ReconciliationAudit**
- Action: `'auto_fix'`, `'suggestion'`, `'manual_apply'`
- Full field diff with old/new values
- Indexed by entity type, ID, and timestamp

---

## Status State Machine

### Policy Lifecycle
```
PENDING → TX → PENDING_ONCHAIN → [event] → ACTIVE → [expire] → EXPIRED
```

### Claim Lifecycle
```
Submitted → TX → PENDING_ONCHAIN → [event] → Submitted
    → reviewClaim → UnderReview
    → approveClaim → Approved → paymentTX → Paid
    → rejectClaim → Rejected
```

---

## API Endpoints

### Reconciliation (Phase C)
- `GET /api/reconcile/status` - Health & stats
- `GET /api/reconcile/mismatches` - Detected issues
- `GET /api/reconcile/suggestions` - Pending actions
- `POST /api/reconcile/apply/:id` - Apply fix
- `POST /api/reconcile/run` - Trigger manual run

### Claims (Phase B - Safe)
- `POST /claim/review/:id` - Move to review
- `POST /claim/approve-safe/:id` - Approve & pay
- `POST /claim/reject-safe/:id` - Reject

### Policies (Phase A)
- `POST /policy/record` - Record from TX
- `GET /policy/list` - List all (with onchain fields)

---

## Security

1. **Transaction Verification**: No DB writes before blockchain confirmation
2. **Reconciliation Safety**: Only safe fields auto-fixed
3. **Idempotency**: Event listener & reconciler prevent duplicates
4. **Address Validation**: All addresses normalized via `ethers.getAddress()`

---

## Performance

- Event listener: Batch processing, 5s poll interval
- Reconciler: 100 records/run max, 60s interval
- Database: Indexed on critical fields

---

**Implementation Status:** Phases A, B, C - COMPLETE ✅
