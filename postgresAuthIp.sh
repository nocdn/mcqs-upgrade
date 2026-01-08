#!/bin/bash

# 1. Dynamically get your current Public IP
MY_NEW_IP=$(curl -s https://api.ipify.org)
echo "🌍 Your Current IP: $MY_NEW_IP"

# 2. Get the Security Group ID for your RDS instance 'mcq-app-db'
SG_ID=$(aws rds describe-db-instances --db-instance-identifier mcq-app-db --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId" --output text)
echo "🔒 Security Group ID: $SG_ID"

# 3. List current authorized IPs
echo "📋 Currently authorized IPs:"
aws ec2 describe-security-groups --group-ids $SG_ID --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[].CidrIp" --output text | tr '\t' '\n' | while read ip; do
  echo "   • $ip"
done

# 4. Check if IP already authorized
EXISTING=$(aws ec2 describe-security-groups --group-ids $SG_ID --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[?CidrIp==\`${MY_NEW_IP}/32\`].CidrIp" --output text)

if [ -n "$EXISTING" ]; then
  echo "ℹ️  IP $MY_NEW_IP is already authorized"
else
  # 5. Authorize the NEW IP (append to existing rules)
  echo "🚀 Adding new IP to authorized list..."
  aws ec2 authorize-security-group-ingress \
      --group-id $SG_ID \
      --protocol tcp \
      --port 5432 \
      --cidr ${MY_NEW_IP}/32 \
      --region eu-west-2
  echo "✅ Success! Added $MY_NEW_IP to authorized IPs"
fi

echo ""
echo "📋 Updated authorized IPs:"
aws ec2 describe-security-groups --group-ids $SG_ID --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].IpRanges[].CidrIp" --output text | tr '\t' '\n' | while read ip; do
  echo "   • $ip"
done
