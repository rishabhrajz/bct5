#!/bin/bash
# DEV_RESET.md - Complete Development Environment Reset Guide

# ⚠️ WARNING: This will DELETE all development data!
# This script is ONLY for development environments (NODE_ENV=development)

echo "========================================"
echo "ProjectY Development Environment Reset"
echo "========================================"
echo ""
echo "⚠️  This will:"
echo "  - Drop and recreate the database"
echo "  - Reset Hardhat blockchain state"
echo "  - Clear Veramo DID/VC stores"
echo "  - Redeploy all smart contracts"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Reset cancelled."
    exit 0
fi

# Check we're in development
if [ "$NODE_ENV" = "production" ] || [ "$NODE_ENV" = "staging" ]; then
    echo "❌ ERROR: Cannot run reset in $NODE_ENV environment!"
    exit 1
fi

echo ""
echo "Step 1: Stopping running processes..."
# Kill hardhat node
lsof -ti:8545 | xargs kill -9 2>/dev/null || true
# Kill backend
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
# Kill frontend
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 2
echo "✅ Processes stopped"

echo ""
echo "Step 2: Resetting database..."
cd backend
npx prisma migrate reset --force
echo "✅ Database reset complete"

echo ""
echo "Step 3: Clearing Veramo key store..."
rm -rf backend/veramo_keystore/* 2>/dev/null || true
echo "✅ Veramo store cleared"

echo ""
echo "Step 4: Starting fresh Hardhat node..."
cd ..
npx hardhat node --hostname 0.0.0.0 --port 8545 &
HARDHAT_PID=$!
sleep 5
echo "✅ Hardhat node started (PID: $HARDHAT_PID)"

echo ""
echo "Step 5: Deploying contracts..."
npx hardhat run contracts/scripts/deploy.js --network localhost
if [ $? -ne 0 ]; then
    echo "❌ Contract deployment failed!"
    kill $HARDHAT_PID
    exit 1
fi
echo "✅ Contracts deployed"

echo ""
echo "Step 6: Starting backend..."
cd backend
npm run dev &
BACKEND_PID=$!
sleep 5
echo "✅ Backend started (PID: $BACKEND_PID)"

echo ""
echo "Step 7: Starting frontend..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!
sleep 3
echo "✅ Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "========================================"
echo "✅ Reset Complete!"
echo "========================================"
echo ""
echo "Services running:"
echo "  - Hardhat Node: http://127.0.0.1:8545 (PID: $HARDHAT_PID)"
echo "  - Backend API:  http://localhost:4000 (PID: $BACKEND_PID)"
echo "  - Frontend UI:  http://localhost:5173 (PID: $FRONTEND_PID)"
echo ""
echo "Next steps:"
echo "  1. Import dev account to MetaMask:"
echo "     Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "     Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo ""
echo "  2. Connect MetaMask to:"
echo "     Network: Localhost 8545"
echo "     Chain ID: 31337"
echo "     RPC URL: http://127.0.0.1:8545"
echo ""
echo "  3. Open http://localhost:5173 and start testing!"
echo ""
echo "To stop all services:"
echo "  kill $HARDHAT_PID $BACKEND_PID $FRONTEND_PID"
echo ""
