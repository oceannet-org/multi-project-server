# AWS Credentials Setup Guide

This guide explains how to add admin credentials to your AWS instance so that all new PocketBase databases automatically get the admin user created.

## Overview

The admin credentials (`ADMIN_EMAIL` and `ADMIN_PASSWORD`) are used to automatically create admin users in every new PocketBase database. These credentials are stored as environment variables in the Docker container.

## For New Deployments (Terraform)

If you're deploying a new instance with Terraform:

1. **Update `terraform/terraform.tfvars`** with your credentials:
   ```hcl
   admin_email    = "hello@oceannet.dev"
   admin_password = "CHANGE_ME"
   ```

2. **Apply Terraform**:
   ```bash
   cd terraform
   terraform plan
   terraform apply
   ```

The credentials will be automatically injected into the instance via the `user-data.sh` script.

## For Existing Instances

If you already have a running instance, you need to update the environment variables:

### Option 1: Update via SSM (Recommended)

Run this command to update the `.env` file and restart the container:

```bash
aws ssm send-command \
  --instance-ids i-0eeb2f36b052f1228 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "cd /opt/pocketbase-manager",
    "echo \"ADMIN_EMAIL=hello@oceannet.dev\" >> .env",
    "echo \"ADMIN_PASSWORD=CHANGE_ME\" >> .env",
    "docker compose -f docker-compose.prod.yml down",
    "docker compose -f docker-compose.prod.yml up -d"
  ]'
```

### Option 2: Update via SSH

```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201

# Edit the .env file
cd /opt/pocketbase-manager
echo "ADMIN_EMAIL=hello@oceannet.dev" >> .env
echo "ADMIN_PASSWORD=CHANGE_ME" >> .env

# Restart the container
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### Option 3: Update docker-compose.prod.yml

Edit `/opt/pocketbase-manager/docker-compose.prod.yml` and add the environment variables:

```yaml
services:
  manager:
    environment:
      - ADMIN_EMAIL=hello@oceannet.dev
      - ADMIN_PASSWORD=CHANGE_ME
```

Then restart:
```bash
docker compose -f docker-compose.prod.yml up -d
```

## Verification

After updating, verify the credentials are loaded:

```bash
# Check environment variables in the container
docker exec pocketbase-manager env | grep ADMIN

# Should show:
# ADMIN_EMAIL=hello@oceannet.dev
# ADMIN_PASSWORD=CHANGE_ME
```

## Testing

Create a new database and verify the admin user is automatically created:

1. Go to the management dashboard
2. Create a new database
3. Click "Open Admin" - it should work immediately without manual login

## Security Notes

- The `admin_password` variable in Terraform is marked as `sensitive = true`, so it won't be displayed in logs
- Never commit `terraform.tfvars` with real credentials to git
- Use AWS Secrets Manager or Parameter Store for production deployments
- Consider rotating passwords regularly

## Troubleshooting

If admin users aren't being created automatically:

1. **Check environment variables**:
   ```bash
   docker exec pocketbase-manager env | grep ADMIN
   ```

2. **Check application logs**:
   ```bash
   docker logs pocketbase-manager | grep -i admin
   ```

3. **Verify the createProject code** is using `config.adminEmail` and `config.adminPassword`

4. **Check if PocketBase is ready** before creating admin user (the code waits up to 20 seconds)
