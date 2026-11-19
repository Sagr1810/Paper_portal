# 🚀 Paper Portal — AWS Deployment Guide
## Stack: t3.small EC2 + RDS MySQL + S3 + CloudFront + ALB + Auto Scaling

---

## 📋 Prerequisites
- AWS Account (Free Tier eligible)
- AWS CLI installed: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html
- Run `aws configure` with your Access Key + Secret Key + Region: `ap-south-1`

---

## PHASE 1 — RDS MySQL Database

### Step 1: Create RDS Instance
```
AWS Console → RDS → Create Database
  Engine:          MySQL 8.0
  Template:        Free tier
  Instance class:  db.t3.micro
  DB identifier:   paper-portal-db
  Master username: admin
  Master password: YourStrongPassword123!
  Storage:         20 GB SSD (gp2)
  Public access:   NO (private, EC2 only)
  VPC:             Default VPC
  Backup:          Enable (7 days)
```

### Step 2: Note the RDS Endpoint
After creation (~5 mins), copy the endpoint:
```
paper-portal-db.xxxxxxxxxx.ap-south-1.rds.amazonaws.com
```

### Step 3: Create Security Group for RDS
```
Inbound Rule:
  Type: MySQL/Aurora
  Port: 3306
  Source: EC2 Security Group (add after creating EC2 SG)
```

---

## PHASE 2 — EC2 Launch Template (t3.small)

### Step 1: Create Security Group for EC2
```
Name: paper-portal-ec2-sg
Inbound Rules:
  SSH     Port 22   Source: Your IP only
  HTTP    Port 80   Source: 0.0.0.0/0
  Custom  Port 8000 Source: ALB Security Group
```

### Step 2: Edit user_data.sh
Open `aws/user_data.sh` and fill in:
```bash
DB_HOST="paper-portal-db.xxxxxxxxxx.ap-south-1.rds.amazonaws.com"
DB_USER="admin"
DB_PASS="YourStrongPassword123!"
DB_NAME="exam_portal"
CLOUDFRONT_URL="https://YOUR-CLOUDFRONT-ID.cloudfront.net"
```

### Step 3: Create Launch Template
```
AWS Console → EC2 → Launch Templates → Create
  Name:          paper-portal-template
  AMI:           Ubuntu Server 22.04 LTS (ami-0f5ee92e2d63afc18)
  Instance type: t3.small
  Key pair:      Create new → download .pem file
  Security group: paper-portal-ec2-sg
  User data:     Paste contents of aws/user_data.sh
```

---

## PHASE 3 — Application Load Balancer (ALB)

### Step 1: Create Target Group
```
AWS Console → EC2 → Target Groups → Create
  Target type:  Instances
  Name:         paper-portal-tg
  Protocol:     HTTP
  Port:         80
  Health check: GET /api/health → Expect 200
  Healthy threshold:   2
  Unhealthy threshold: 3
  Interval:     30 seconds
```

### Step 2: Create ALB
```
AWS Console → EC2 → Load Balancers → Create → Application LB
  Name:    paper-portal-alb
  Scheme:  Internet-facing
  VPC:     Default VPC
  Subnets: Select at least 2 AZs (ap-south-1a, ap-south-1b)
  
  Security Group:
    Inbound: HTTP 80, HTTPS 443 from 0.0.0.0/0
  
  Listener:
    HTTP:443 → Forward to paper-portal-tg
```

### Step 3: Note ALB DNS Name
```
paper-portal-alb-xxxxxxxxxx.ap-south-1.elb.amazonaws.com
```

---

## PHASE 4 — Auto Scaling Group (ASG)

```
AWS Console → EC2 → Auto Scaling Groups → Create
  Name:              paper-portal-asg
  Launch Template:   paper-portal-template
  VPC & Subnets:     Default VPC, all AZs
  
  Load Balancing:
    Attach to ALB:   paper-portal-alb
    Target Group:    paper-portal-tg
  
  Group Size:
    Minimum:  1
    Desired:  1
    Maximum:  3
  
  Scaling Policy (Target Tracking):
    Metric:           Average CPU Utilization
    Target value:     60%
    Scale-out:        When CPU > 60% → add 1 instance
    Scale-in:         When CPU < 20% → remove 1 instance
    Warmup:           120 seconds
```

---

## PHASE 5 — S3 + CloudFront (Frontend)

### Step 1: Edit deploy_frontend.sh
Open `aws/deploy_frontend.sh` and fill in:
```bash
S3_BUCKET="paper-portal-frontend-youruniquename"
BACKEND_URL="http://paper-portal-alb-xxx.ap-south-1.elb.amazonaws.com"
```

### Step 2: Run deploy script
```bash
# In Git Bash or WSL:
chmod +x aws/deploy_frontend.sh
./aws/deploy_frontend.sh
```

### Step 3: Create CloudFront Distribution
```
AWS Console → CloudFront → Create Distribution
  Origin domain:    paper-portal-frontend.s3-website.ap-south-1.amazonaws.com
  Origin protocol:  HTTP only
  Viewer protocol:  Redirect HTTP to HTTPS
  Cache policy:     CachingOptimized
  Default root:     index.html
  Error pages:      404 → /index.html (200) ← React Router fix
```

### Step 4: Update ALLOWED_ORIGINS on EC2
SSH into EC2 and update `.env`:
```bash
ssh -i your-key.pem ubuntu@EC2-PUBLIC-IP
nano /home/ubuntu/Paper_portal/backend/.env
# Update ALLOWED_ORIGINS=https://your-cloudfront-id.cloudfront.net
sudo systemctl restart paperportal
```

---

## PHASE 6 — Push AWS Files to GitHub

```bash
git add aws/ backend/Procfile
git commit -m "Add AWS deployment scripts"
git push origin main
```

---

## ✅ Final Checklist

- [ ] RDS MySQL created and endpoint noted
- [ ] `aws/user_data.sh` filled with RDS credentials
- [ ] EC2 Launch Template created with user_data.sh
- [ ] ALB + Target Group created (health check: /api/health)
- [ ] Auto Scaling Group (min:1, max:3, CPU 60%)
- [ ] S3 bucket created + React build uploaded
- [ ] CloudFront distribution pointing to S3
- [ ] `ALLOWED_ORIGINS` updated with CloudFront URL
- [ ] Test: `https://cloudfront-url/` → React app loads
- [ ] Test: `https://cloudfront-url/api/health` → `{"status":"ok"}`
- [ ] Test: Login as `admin@portal.edu` / `Admin@1234`

---

## 💰 Cost Estimate (ap-south-1 Mumbai)

| Service | Spec | Monthly |
|---|---|---|
| EC2 t3.small (1 instance) | 2 vCPU, 2GB RAM | ~$15 |
| RDS MySQL db.t3.micro | 1 vCPU, 1GB RAM | ~$15 |
| ALB | Per hour + LCU | ~$18 |
| S3 | < 5 GB | ~$0.50 |
| CloudFront | First 1TB free | ~$0 |
| **Total** | | **~$48/month** |

> 💡 Year 1 with AWS Free Tier: EC2 + RDS are free for 750 hrs/month → **~$18/month** (ALB not free-tier)

---

## 🆘 Troubleshooting

```bash
# Check backend logs
sudo journalctl -u paperportal -f

# Check setup log
cat /var/log/paperportal-setup.log

# Restart backend
sudo systemctl restart paperportal

# Check nginx
sudo nginx -t
sudo systemctl status nginx

# Check health
curl http://localhost/api/health
```
