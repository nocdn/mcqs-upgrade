#!/bin/bash

# 1. Dynamically get your current Public IP
MY_NEW_IP=$(curl -s https://api.ipify.org)
echo "🌍 Your Current IP: $MY_NEW_IP"

# 2. Get the Security Group ID for your RDS instance 'mcq-app-db'
SG_ID=$(aws rds describe-db-instances --db-instance-identifier mcq-app-db --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId" --output text)
echo "🔒 Security Group ID: $SG_ID"

# 3. Clean up OLD rules on port 5432 (Revoke all access to 5432 first)
# Note: This prevents the security group from filling up with old IPs.
# It suppresses errors (2>/dev/null) in case there were no rules to delete.
echo "🧹 Cleaning up old IP rules..."
aws ec2 revoke-security-group-ingress --group-id $SG_ID --protocol tcp --port 5432 --cidr 0.0.0.0/0 2>/dev/null || true

# 4. Authorize the NEW IP
echo "🚀 Authorizing new IP..."
aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID \
    --protocol tcp \
    --port 5432 \
    --cidr ${MY_NEW_IP}/32 \
    --region eu-west-2

echo "✅ Success! You can now connect to RDS from $MY_NEW_IP"
