#!/bin/bash
# =============================================================================
# Paper Portal — EC2 t3.small Bootstrap Script
# Ubuntu 22.04 LTS | FastAPI + MySQL
# Run as: EC2 User Data  OR  sudo bash user_data.sh
# =============================================================================

set -e
exec > /var/log/paperportal-setup.log 2>&1

echo "===== [1/8] System Update ====="
apt-get update -y
apt-get upgrade -y
apt-get install -y git nginx python3-pip python3-venv curl unzip

echo "===== [2/8] Install Node.js 20 (for frontend build) ====="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "===== [3/8] Install MySQL Client ====="
apt-get install -y default-mysql-client

echo "===== [4/8] Clone Repository ====="
cd /home/ubuntu
git clone https://github.com/Sagr1810/Paper_portal.git
cd Paper_portal

echo "===== [5/8] Setup Backend ====="
cd /home/ubuntu/Paper_portal/backend

# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

# ── EDIT THESE VALUES BEFORE RUNNING ──────────────────────────────────────────
DB_HOST="YOUR-RDS-ENDPOINT.rds.amazonaws.com"
DB_USER="admin"
DB_PASS="YourStrongPassword123!"
DB_NAME="exam_portal"
SECRET_KEY="$(openssl rand -hex 64)"
CLOUDFRONT_URL="https://YOUR-CLOUDFRONT-ID.cloudfront.net"
# ──────────────────────────────────────────────────────────────────────────────

cat > /home/ubuntu/Paper_portal/backend/.env <<EOF
APP_NAME=Exam Paper Maker & Moderation Portal
SECRET_KEY=${SECRET_KEY}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
DATABASE_URL=mysql+pymysql://${DB_USER}:${DB_PASS}@${DB_HOST}:3306/${DB_NAME}
ALLOWED_ORIGINS=${CLOUDFRONT_URL},http://localhost:5173
UPLOAD_DIR=uploads
MAX_UPLOAD_SIZE_MB=10
OWNER_EMAIL=admin@portal.edu
OWNER_PASSWORD=Admin@1234
EOF

# Create uploads directory
mkdir -p /home/ubuntu/Paper_portal/backend/uploads
chown -R ubuntu:ubuntu /home/ubuntu/Paper_portal

echo "===== [6/8] Run Database Migrations ====="
source /home/ubuntu/Paper_portal/backend/venv/bin/activate
cd /home/ubuntu/Paper_portal/backend
alembic upgrade head
python seed.py || echo "Seed already ran or skipped"

echo "===== [7/8] Create systemd Service ====="
cat > /etc/systemd/system/paperportal.service <<EOF
[Unit]
Description=Paper Portal FastAPI Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Paper_portal/backend
Environment="PATH=/home/ubuntu/Paper_portal/backend/venv/bin"
ExecStart=/home/ubuntu/Paper_portal/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable paperportal
systemctl start paperportal

echo "===== [8/8] Configure Nginx Reverse Proxy ====="
cp /home/ubuntu/Paper_portal/aws/nginx.conf /etc/nginx/sites-available/paperportal
ln -sf /etc/nginx/sites-available/paperportal /etc/nginx/sites-enabled/paperportal
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "===== ✅ Setup Complete ====="
echo "Backend: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/api/health"
