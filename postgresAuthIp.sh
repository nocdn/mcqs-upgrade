#!/bin/bash

MY_NEW_IP=$(curl -s https://api.ipify.org)
echo "[ip] Current IP: $MY_NEW_IP"

SG_ID=$(aws rds describe-db-instances \
    --db-instance-identifier mcq-app-db \
    --region eu-west-2 \
    --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId" \
    --output text)
echo "[sg] Security Group ID: $SG_ID"

echo "[sg] Currently authorized IPs:"
aws ec2 describe-security-groups \
    --group-ids $SG_ID \
    --region eu-west-2 \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[].CidrIp" \
    --output text | tr '\t' '\n' | while read ip; do
  echo "   - $ip"
done

EXISTING=$(aws ec2 describe-security-groups \
    --group-ids $SG_ID \
    --region eu-west-2 \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[?CidrIp==\`${MY_NEW_IP}/32\`].CidrIp" \
    --output text)

if [ -n "$EXISTING" ]; then
  echo "[sg] IP $MY_NEW_IP is already authorized for port 5432"
else
  echo "[sg] Adding new IP to authorized list..."
  if aws ec2 authorize-security-group-ingress \
      --group-id $SG_ID \
      --protocol tcp \
      --port 5432 \
      --cidr ${MY_NEW_IP}/32 \
      --region eu-west-2 2>/dev/null; then
    echo "[sg] Added $MY_NEW_IP to authorized IPs"
  else
    echo "[sg] Failed to add IP (it may already exist or there was an error)"
  fi
fi

echo ""
echo "[sg] Updated authorized IPs:"
aws ec2 describe-security-groups \
    --group-ids $SG_ID \
    --region eu-west-2 \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[].CidrIp" \
    --output text | tr '\t' '\n' | while read ip; do
  echo "   - $ip"
done
