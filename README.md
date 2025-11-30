# ProjectY - Decentralized Insurance Platform

A production-grade decentralized insurance system with DID/VC integration, smart contracts, and robust transaction handling.

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..

# 2. Run the automated setup
./DEV_RESET.sh
```

That's it! The system will:
- Start Hardhat local blockchain
- Deploy smart contracts
- Reset and migrate database
- Start backend API
- Start frontend UI

Open http://localhost:5173 and start testing!

---

## 📋 Prerequisites

- **Node.js** v18+ (LTS recommended)
- **npm** v9+
- **MetaMask** browser extension
- **Git**

---

## 🔧 Manual Setup (Step-by-Step)

If you prefer manual setup or the automated script fails:

### 1. Clone Repository

```bash
git clone https://github.com/rishabhrajz/bct5
cd projecty
```

### 2. Install Dependencies

```bash
# Root dependencies
npm install

# Backend dependencies
cd backend
npm install

# Frontend dependencies
cd ../frontend
npm install

cd ..
```

### 3. Start Hardhat Node

```bash
# Terminal 1
npx hardhat node
```

Keep this terminal open. You should see:
```
Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/
```

### 4. Deploy Smart Contracts

```bash
# Terminal 2
npx hardhat run contracts/scripts/deploy.js --network localhost
```

You should see:
```
✅ IdentityRegistry deployed to: 0x5FbDB...
✅ PolicyContract deployed to: 0xe7f172...
✅ ClaimContract deployed to: 0x9fE467...
```

### 5. Setup Database

```bash
# Terminal 2
cd backend
npx prisma generate
npx prisma migrate dev
```

### 6. Start Backend

```bash
# Terminal 2 (still in backend/)
npm run dev
```

You should see:
```
✅ Veramo agent initialized
✅ Contracts initialized
🚀 Server running on http://localhost:4000
```

### 7. Start Frontend

```bash
# Terminal 3
cd frontend
npm run dev
```

You should see:
```
  ➜  Local:   http://localhost:5173/
```

---

## 🦊 MetaMask Setup

### Add Localhost Network

1. Open MetaMask
2. Click network dropdown
3. Click "Add Network" → "Add network manually"
4. Fill in:

| Field | Value |
|-------|-------|
| Network Name | Hardhat Local |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Currency Symbol | ETH |

5. Click "Save"

### Import Dev Account

This is a **development-only** account with test ETH:

1. Click MetaMask account icon
2. Select "Import Account"
3. Paste this private key:
   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
4. Click "Import"

**Address:** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`  
**Balance:** ~10000 ETH (test money)

⚠️ **WARNING:** This is a publicly known test key. Never use it with real money!

---

## 🎬 Demonstration Guide

### 1. Provider Onboarding

**Goal:** Register a healthcare provider

1. Open http://localhost:5173/provider/onboard
2. Connect MetaMask (use Account #2 from Hardhat)
3. Fill in:
   - Provider Name: "City Hospital"
   - License file: Upload any PDF
4. Click "Submit for Approval"
5. Wait for transaction confirmation
6. Note: Provider is now in "PENDING" status

### 2. Provider Approval (Insurer)

**Goal:** Approve the provider

1. Switch to Insurer dashboard: http://localhost:5173/insurer
2. Connect MetaMask (use Account #1 - the main dev account)
3. View "Pending Providers" section
4. Click "Approve" on City Hospital
5. Confirm MetaMask transaction
6. Provider is now "APPROVED"

### 3. Patient Onboarding & KYC

**Goal:** Register a patient and complete KYC

1. Switch to Account #3 in MetaMask
2. Open http://localhost:5173/patient
3. Click "Upload KYC Document"
4. Upload any ID document (PDF/image)
5. Document type: "AADHAAR"
6. Submit

### 4. KYC Approval (Insurer)

1. Switch back to Account #1 (Insurer)
2. Go to http://localhost:5173/insurer
3. View "Pending KYC" section
4. Click "Verify" on the KYC document
5. Patient is now verified

### 5. Policy Purchase (Patient)

**Goal:** Buy an insurance policy

1. Switch to Account #3 (Patient)
2. Go to http://localhost:5173/issue-policy
3. Fill in:
   - Coverage Amount: **1 ETH**
   - Policy Tier: **Standard**
   - Duration: **365 days**
4. Click "Request Policy"
5. MetaMask will popup:
   - Premium: **0.02 ETH** (2% of coverage)
   - Click "Confirm"
6. Wait for transaction...
7. Success! Policy is created

**What just happened:**
- ✅ Blockchain transaction sent (`tx.hash`)
- ✅ Receipt confirmed (block number)
- ✅ `PolicyIssued` event verified
- ✅ Database updated to `ACTIVE`
- ✅ Premium held in smart contract escrow

### 6. View Policy (Patient Dashboard)

1. Go to http://localhost:5173/patient
2. See your active policy:
   - Policy ID
   - Coverage amount
   - Status: ACTIVE
   - Premium paid
   - Start/End dates

### 7. Submit Claim (Provider)

**Goal:** Provider submits a medical claim

1. Switch to Account #2 (Provider)
2. Go to http://localhost:5173/provider
3. Click "Submit Claim"
4. Fill in:
   - Policy ID: (from patient's policy)
   - Patient Address: `0x...` (Account #3's address)
   - Claim Amount: **0.5 ETH**
   - Upload medical report (PDF)
5. Submit claim
6. Claim is now "PENDING"

### 8. Approve Claim (Insurer)

1. Switch to Account #1 (Insurer)
2. Go to http://localhost:5173/insurer
3. View "Pending Claims" section
4. Click "Approve & Pay" on the claim
5. Enter payout amount: **0.5 ETH**
6. Click "Approve & Pay"
7. Confirm MetaMask transaction (sending 0.5 ETH)
8. Claim paid! Provider receives ETH

---

## 🧪 Testing

### Run Smoke Test

```bash
node tests/smoke-test.js
```

Expected output:
```
🧪 Starting smoke test...
✅ Connected as: 0xf39Fd...
✅ PolicyContract at: 0xe7f17...
✅ TX sent: 0x...
✅ Confirmed in block: 5
✅ API Response: { ok: true, policy: {...} }
✅ Policy status: ACTIVE
✅ Smoke test PASSED!
```

### Run Contract Tests

```bash
npx hardhat test
```

---

## 📁 Project Structure

```
projecty/
├── backend/
│   ├── services/
│   │   ├── policy-service-v2.js   # Safe policy recording
│   │   ├── approval-service.js    # Provider/claim approvals
│   │   └── claim-service.js       # Claim submission
│   ├── lib/
│   │   └── tx-utils.js            # Transaction safety utilities
│   ├── prisma/
│   │   └── schema.prisma          # Database schema
│   └── server.js                  # Express API server
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── IssuePolicy.jsx    # Policy purchase
│   │   │   ├── PatientDashboard.jsx
│   │   │   ├── ProviderOnboard.jsx
│   │   │   └── InsurerDashboard.jsx
│   │   └── utils/
│   │       └── contracts.js       # Web3 utilities
├── contracts/
│   ├── PolicyContract.sol         # Policy management
│   ├── ClaimContract.sol          # Claim processing
│   └── IdentityRegistry.sol       # DID registry
├── scripts/
│   └── deploy.js                  # Contract deployment
└── tests/
    └── smoke-test.js              # End-to-end test
```

---

## 🔑 Test Accounts

Hardhat provides 20 test accounts. Here are the first 3:

### Account #1 (Insurer/Admin)
```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Account #2 (Provider)
```
Address: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

### Account #3 (Patient)
```
Address: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Private Key: 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

All accounts start with **10000 ETH** on fresh Hardhat node.

---

## 🛠️ Troubleshooting

### Port Already in Use

```bash
# Kill process on port 8545 (Hardhat)
lsof -ti:8545 | xargs kill -9

# Kill process on port 4000 (Backend)
lsof -ti:4000 | xargs kill -9

# Kill process on port 5173 (Frontend)
lsof -ti:5173 | xargs kill -9
```

### MetaMask Shows Wrong Balance

1. Open MetaMask
2. Settings → Advanced
3. Click "Clear activity tab data"
4. Refresh page

### "Cannot connect to database"

```bash
cd backend
npx prisma generate
npx prisma migrate reset --force
```

### "Nonce too high" Error

MetaMask's nonce is out of sync with blockchain:

1. Open MetaMask
2. Settings → Advanced
3. Click "Reset Account"
4. Refresh page

### Contracts Not Found

Redeploy contracts:

```bash
npx hardhat run contracts/scripts/deploy.js --network localhost
```

### Frontend Shows Old Contract Addresses

Hard refresh browser:
- **Mac:** `Cmd + Shift + R`
- **Windows/Linux:** `Ctrl + Shift + R`

---

## 🔄 Reset Everything

If you want to start fresh:

```bash
./DEV_RESET.sh
```

Or manually:

```bash
# 1. Stop all processes
lsof -ti:8545 | xargs kill -9
lsof -ti:4000 | xargs kill -9
lsof -ti:5173 | xargs kill -9

# 2. Reset database
cd backend
npx prisma migrate reset --force

# 3. Clear Veramo
rm -rf backend/veramo_keystore/*

# 4. Start fresh Hardhat
npx hardhat node &

# 5. Redeploy contracts
npx hardhat run contracts/scripts/deploy.js --network localhost

# 6. Restart backend
cd backend && npm run dev &

# 7. Restart frontend
cd frontend && npm run dev &
```

See [DEV_RESET.md](DEV_RESET.md) for detailed instructions.

---

## 📚 API Endpoints

### Policy
- `POST /policy/record` - Record policy from blockchain tx
- `GET /policy/list` - List all policies
- `GET /policy/:id` - Get policy by ID

### Provider
- `POST /provider/onboard` - Register new provider
- `GET /provider/list` - List all providers
- `POST /provider/approve/:id` - Approve provider (insurer)

### Claim
- `POST /claim/submit` - Submit claim
- `GET /claim/pending` - Get pending claims
- `POST /claim/approve/:id` - Approve & pay claim

### KYC
- `POST /kyc/upload` - Upload KYC document
- `GET /kyc/pending` - Get pending KYC docs
- `POST /kyc/approve/:id` - Approve KYC

---

## 🎯 Key Features

- ✅ **Robust Transaction Handling** - Timeouts, retries, event verification
- ✅ **Auto-Approval** - Policies activate immediately on payment
- ✅ **Premium Escrow** - Funds held on-chain until claims
- ✅ **MetaMask Integration** - Web3 wallet for all transactions
- ✅ **DID/VC Support** - Veramo integration for credentials
- ✅ **IPFS Storage** - Documents stored on Pinata
- ✅ **Multi-Role System** - Patient, Provider, Insurer workflows
- ✅ **Event-Driven** - Smart contract events tracked
- ✅ **Database Sync** - Blockchain ↔ DB reconciliation

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📝 License

This project is for educational purposes.

---

## 🙋 Support

Issues? Check:
1. [DEV_RESET.md](DEV_RESET.md) - Reset guide
2. [Troubleshooting](#troubleshooting) - Common issues
3. GitHub Issues - Report bugs

---

## 🎉 Demo Success Checklist

After setup, verify:

- [ ] Hardhat node running on port 8545
- [ ] Backend running on port 4000
- [ ] Frontend running on port 5173
- [ ] MetaMask connected to localhost:8545
- [ ] Dev account imported with ~10000 ETH
- [ ] Can register provider
- [ ] Can approve provider (as insurer)
- [ ] Can buy policy (as patient)
- [ ] Can submit claim (as provider)
- [ ] Can approve claim (as insurer)
- [ ] Smoke test passes: `node tests/smoke-test.js`

---

**Built with:** Hardhat • Ethers.js • Veramo • Prisma • React • Express
