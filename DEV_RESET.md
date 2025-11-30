# Development Environment Reset Guide

## ⚠️ WARNING
**This will DELETE all development data including:**
- Database records (policies, providers, claims)
- Blockchain state (all transactions and contracts)
- Veramo DID/VC key stores

**This is ONLY for development environments** (`NODE_ENV=development`)

---

## Quick Reset (Automated)

```bash
# Run the automated reset script
chmod +x DEV_RESET.sh
./DEV_RESET.sh
```

The script will:
1. Stop all running processes
2. Reset the database
3. Clear Veramo stores
4. Restart Hardhat with fresh blockchain
5. Redeploy contracts
6. Start backend and frontend

---

## Manual Reset Steps

If you prefer to run steps manually:

### 1. Stop Running Processes

```bash
# Kill Hardhat node
lsof -ti:8545 | xargs kill -9 2>/dev/null

# Kill backend
lsof -ti:4000 | xargs kill -9 2>/dev/null

# Kill frontend
lsof -ti:5173 | xargs kill -9 2>/dev/null
```

### 2. Reset Database

```bash
cd backend
npx prisma migrate reset --force
```

This will:
- Drop all tables
- Re-run all migrations
- Apply seed data (if configured)

### 3. Clear Veramo Key Store

```bash
rm -rf backend/veramo_keystore/*
```

### 4. Start Fresh Hardhat Node

```bash
npx hardhat node --hostname 0.0.0.0 --port 8545
```

Keep this terminal open.

### 5. Deploy Contracts (New Terminal)

```bash
npx hardhat run contracts/scripts/deploy.js --network localhost
```

Verify `deployments/deployed.json` is updated with new addresses.

### 6. Start Backend

```bash
cd backend
npm run dev
```

Keep this terminal open.

### 7. Start Frontend (New Terminal)

```bash
cd frontend
npm run dev
```

---

## MetaMask Setup

After reset, import the dev account to MetaMask:

### Add Localhost Network

1. Open MetaMask
2. Click network dropdown → "Add Network"
3. Fill in:
   - **Network Name:** Hardhat Local
   - **RPC URL:** http://127.0.0.1:8545
   - **Chain ID:** 31337
   - **Currency Symbol:** ETH

### Import Dev Account

**Private Key:** 
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Address:**
```
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

**Steps:**
1. Open MetaMask
2. Click account icon → "Import Account"
3. Paste private key above
4. Click "Import"

---

## Verify Setup

Test that everything is working:

```bash
# Check Hardhat is running
curl http://127.0.0.1:8545

# Check backend is running
curl http://localhost:4000/health

# Check contracts are deployed
cat deployments/deployed.json
```

Expected response from contracts file:
```json
{
  "network": "localhost",
  "chainId": 31337,
  "contracts": {
    "IdentityRegistry": "0x...",
    "PolicyContract": "0x...",
    "ClaimContract": "0x..."
  }
}
```

---

## Troubleshooting

### "Port already in use"

Kill the process using the port:
```bash
lsof -ti:8545 | xargs kill -9  # Hardhat
lsof -ti:4000 | xargs kill -9  # Backend
lsof -ti:5173 | xargs kill -9  # Frontend
```

### "Cannot connect to database"

Ensure you're in the `backend` directory and run:
```bash
npx prisma generate
npx prisma migrate reset --force
```

### "Contract not deployed"

Check `deployments/deployed.json` exists and run:
```bash
npx hardhat run contracts/scripts/deploy.js --network localhost
```

### MetaMask shows wrong balance

Reset MetaMask account:
1. Open MetaMask
2. Settings → Advanced →Clear activity tab data
3. Refresh the page

---

## Safety Guards

The reset script includes guards to prevent accidental data loss:

```javascript
// In backend code
if (process.env.NODE_ENV === 'production') {
  throw new Error('Cannot reset production database!');
}
```

**Never run `DEV_RESET.sh` in production or staging!**

---

## After Reset Checklist

- [ ] Hardhat node is running on port 8545
- [ ] Backend is running on port 4000
- [ ] Frontend is running on port 5173
- [ ] `deployments/deployed.json` has contract addresses
- [ ] MetaMask connected to localhost:8545 (Chain ID: 31337)
- [ ] Dev account imported and has balance (~10000 ETH)
- [ ] Can open http://localhost:5173 in browser

---

## Next Steps

1. Open http://localhost:5173
2. Connect MetaMask wallet
3. Start using the application!

For more details, see the main [README.md](README.md).
