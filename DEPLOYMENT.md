# Production Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Contract Deployment](#contract-deployment)
4. [Backend Deployment](#backend-deployment)
5. [Frontend Deployment](#frontend-deployment)
6. [Docker Deployment](#docker-deployment)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software
- **Node.js** 18+ LTS
- **Docker** & **Docker Compose** (for containerized deployment)
- **Git**
- **Nginx** or **Apache** (for non-Docker frontend deployment)
- **PM2** or **systemd** (for non-Docker backend deployment)

### Required Accounts
- **Blockchain RPC Provider** (Infura, Alchemy, or self-hosted node)
  - Testnet (Sepolia recommended) or Mainnet access
- **IPFS Storage** (Pinata account with API key)
- **Domain & SSL Certificate** (for production frontend)

### Hardware Requirements
- **Minimum:** 2 CPU cores, 4GB RAM, 20GB storage
- **Recommended:** 4 CPU cores, 8GB RAM, 50GB SSD

---

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/yourorg/projecty.git
cd projecty
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
nano .env
```

**Critical Variables:**
```bash
# Production mode
NODE_ENV=production

# Backend port
PORT=4000

# Database (use PostgreSQL for production)
DATABASE_URL="postgresql://user:password@localhost:5432/projecty"

# Blockchain RPC (Sepolia testnet example)
BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY

# Private key with funds for transactions
PRIVATE_KEY=0x...  # NEVER commit this!

# Pinata IPFS
PINATA_JWT=your_jwt_token

# Reconciler (disable auto-fix in production)
RECONCILER_AUTO_FIX=false
RECONCILE_INTERVAL_MS=300000  # 5 minutes

# CORS (your frontend domain)
CORS_ORIGIN=https://yourdomain.com
```

---

## Contract Deployment

### 1. Configure Network

Edit `hardhat.config.js`:
```javascript
networks: {
  sepolia: {
    url: process.env.BLOCKCHAIN_RPC_URL,
    accounts: [process.env.PRIVATE_KEY],
    chainId: 11155111
  }
}
```

### 2. Deploy Contracts
```bash
# Compile contracts
npx hardhat compile

# Deploy to testnet
npx hardhat run contracts/scripts/deploy.js --network sepolia

# Verify on Etherscan (optional)
npx hardhat verify --network sepolia DEPLOYED_ADDRESS
```

### 3. Save Deployment Info
```bash
# Copy deployment addresses
cp deployments/deployed.json backend/config/contracts.json
cp deployments/deployed.json frontend/public/deployments/deployed.json
```

**Important:** Keep `deployed.json` secure and backed up!

---

## Backend Deployment

### Option A: Docker Deployment (Recommended)

```bash
# Build image
docker build -t projecty-backend:latest ./backend

# Run container
docker run -d \
  --name projecty-backend \
  -p 4000:4000 \
  --env-file .env \
  -v $(pwd)/backend/data:/app/data \
  --restart unless-stopped \
  projecty-backend:latest
```

### Option B: PM2 Deployment

```bash
cd backend

# Install dependencies
npm ci --only=production

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Start with PM2
pm2 start npm --name "projecty-backend" -- start

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Option C: Systemd Service

Create `/etc/systemd/system/projecty-backend.service`:
```ini
[Unit]
Description=ProjectY Backend API
After=network.target

[Service]
Type=simple
User=projecty
WorkingDirectory=/opt/projecty/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable projecty-backend
sudo systemctl start projecty-backend
sudo systemctl status projecty-backend
```

---

## Frontend Deployment

### Option A: Docker with Nginx

```bash
# Build image
docker build -t projecty-frontend:latest ./frontend

# Run container
docker run -d \
  --name projecty-frontend \
  -p 80:80 \
  -p 443:443 \
  -v $(pwd)/ssl:/etc/nginx/ssl:ro \
  --restart unless-stopped \
  projecty-frontend:latest
```

### Option B: Static Build with Nginx

```bash
cd frontend

# Build production bundle
npm ci
npm run build

# Copy to web root
sudo cp -r dist/* /var/www/html/projecty/
```

**Nginx Configuration** (`/etc/nginx/sites-available/projecty`):
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    root /var/www/html/projecty;
    index index.html;

    # API proxy
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # React Router
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/projecty /etc/nginx/sites-enabled/
sudo nginx-t
sudo systemctl reload nginx
```

---

## Docker Deployment (Full Stack)

### Using Docker Compose

```bash
# Copy environment template
cp .env.example .env

# Edit .env with production values
nano .env

# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Docker Compose

Create `docker-compose.prod.yml`:
```yaml
version: '3.8'

services:
  backend:
    image: projecty-backend:latest
    restart: always
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - backend-data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    image: projecty-frontend:latest
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend

volumes:
  backend-data:
```

Deploy:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Database Migration

### SQLite to PostgreSQL (Production)

```bash
# 1. Export SQLite data
sqlite3 backend/data/projecty.db .dump > dump.sql

# 2. Create PostgreSQL database
createdb projecty

# 3. Update DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@localhost:5432/projecty"

# 4. Run migrations
cd backend
npx prisma migrate deploy

# 5. Import data (manually adjust dump.sql for PostgreSQL syntax)
psql projecty < dump.sql
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Backend health
curl https://yourdomain.com/api/health

# Detailed readiness check
curl https://yourdomain.com/api/health/readiness

# Reconciler status
curl https://yourdomain.com/api/reconcile/status
```

### Log Monitoring

**PM2:**
```bash
pm2 logs projecty-backend
pm2 monit
```

**Docker:**
```bash
docker logs -f projecty-backend
docker stats
```

**Systemd:**
```bash
journalctl -u projecty-backend -f
```

### Database Backup

**SQLite:**
```bash
# Daily backup
sqlite3 backend/data/projecty.db ".backup backup-$(date +%Y%m%d).db"
```

**PostgreSQL:**
```bash
# Daily backup
pg_dump projecty > backup-$(date +%Y%m%d).sql
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/backup-script.sh
```

---

## Troubleshooting

### Backend won't start

**Check logs:**
```bash
# PM2
pm2 logs projecty-backend

# Docker
docker logs projecty-backend

# Systemd
journalctl -u projecty-backend -n 100
```

**Common issues:**
- Database connection failed → Check DATABASE_URL
- Port already in use → Change PORT in .env
- Blockchain RPC unreachable → Verify BLOCKCHAIN_RPC_URL

### Event Listener not syncing

```bash
# Check listener health
curl http://localhost:4000/health

# Verify blockchain connection
curl -X POST http://localhost:4000/api/reconcile/run
```

### Reconciler not running

**Check configuration:**
```bash
# Should show isRunning: true
curl http://localhost:4000/api/reconcile/status
```

**Restart backend** if reconciler stopped.

### Frontend shows old contract addresses

**Clear cache and rebuild:**
```bash
cd frontend
rm -rf dist node_modules/.vite
npm install
npm run build
```

### Database migration failed

**Roll back:**
```bash
cd backend
npx prisma migrate resolve --rolled-back MIGRATION_NAME
```

**Re-run:**
```bash
npx prisma migrate deploy
```

---

## Security Checklist

- [ ] **Never commit** `.env` or private keys to Git
- [ ] Use **SSL/TLS** for all production domains
- [ ] Set **NODE_ENV=production** in production
- [ ] Use **strong passwords** for database
- [ ] Enable **firewall** and restrict ports
- [ ] Set `RECONCILER_AUTO_FIX=false` for manual review
- [ ] Regularly **backup database**
- [ ] Keep **dependencies updated** (`npm audit`)
- [ ] Use **environment variables** for all secrets
- [ ] Enable **rate limiting** on API endpoints
- [ ] Monitor **logs** for suspicious activity

---

## Production Checklist

### Pre-Deployment
- [ ] All tests passing locally
- [ ] Contracts deployed to target network
- [ ] Environment variables configured
- [ ] SSL certificates obtained
- [ ] Database backup strategy in place
- [ ] Monitoring/logging configured

### Deployment
- [ ] Backend deployed and running
- [ ] Frontend built and served
- [ ] Health checks passing
- [ ] Event listener syncing
- [ ] Reconciler running (auto-fix disabled)

### Post-Deployment
- [ ] Verify full policy creation flow
- [ ] Verify claim submission and approval
- [ ] Check reconciliation dashboard
- [ ] Monitor logs for errors
- [ ] Test disaster recovery process

---

## Support & Resources

- **Documentation:** [README.md](README.md)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Development Setup:** [DEV_RESET.md](DEV_RESET.md)
- **Issues:** GitHub Issues

---

**Last Updated:** 2025-11-30  
**Version:** 1.0.0 (Phase D)
