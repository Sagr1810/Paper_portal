#!/bin/bash
# =============================================================================
# Paper Portal — Frontend Deploy to S3 + CloudFront
# Run this from your LOCAL machine (Windows: use Git Bash or WSL)
# Prerequisites: aws cli installed + configured (aws configure)
# =============================================================================

set -e

# ── EDIT THESE ────────────────────────────────────────────────────────────────
S3_BUCKET="paper-portal-frontend"          # S3 bucket name (must be unique globally)
CLOUDFRONT_DIST_ID="YOUR-DISTRIBUTION-ID"  # From CloudFront console after creation
BACKEND_URL="http://YOUR-EC2-PUBLIC-IP"    # or ALB DNS name
# ──────────────────────────────────────────────────────────────────────────────

echo "===== [1/4] Build React Frontend ====="
cd frontend

# Write production .env
cat > .env.production <<EOF
VITE_API_BASE_URL=${BACKEND_URL}/api
EOF

npm install
npm run build

echo "===== [2/4] Create S3 Bucket (skip if exists) ====="
aws s3 mb s3://${S3_BUCKET} --region ap-south-1 2>/dev/null || echo "Bucket already exists"

# Enable static website hosting
aws s3 website s3://${S3_BUCKET} \
  --index-document index.html \
  --error-document index.html   # React Router SPA: all 404s → index.html

# Public read policy
aws s3api put-bucket-policy --bucket ${S3_BUCKET} --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"PublicRead\",
    \"Effect\": \"Allow\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::${S3_BUCKET}/*\"
  }]
}"

echo "===== [3/4] Upload Build to S3 ====="
aws s3 sync dist/ s3://${S3_BUCKET} \
  --delete \
  --cache-control "public, max-age=31536000" \
  --exclude "index.html"

# index.html — no cache (always fresh)
aws s3 cp dist/index.html s3://${S3_BUCKET}/index.html \
  --cache-control "no-cache, no-store, must-revalidate"

echo "===== [4/4] Invalidate CloudFront Cache ====="
if [ "${CLOUDFRONT_DIST_ID}" != "YOUR-DISTRIBUTION-ID" ]; then
  aws cloudfront create-invalidation \
    --distribution-id ${CLOUDFRONT_DIST_ID} \
    --paths "/*"
  echo "✅ Cache invalidated"
else
  echo "⚠️  Skipping CloudFront invalidation — set CLOUDFRONT_DIST_ID first"
fi

echo ""
echo "===== ✅ Frontend Deployed ====="
echo "S3 URL:         http://${S3_BUCKET}.s3-website.ap-south-1.amazonaws.com"
echo "CloudFront URL: https://YOUR-DISTRIBUTION-ID.cloudfront.net"
