#!/usr/bin/env tsx
/**
 * Fix admin user using PocketBase Admin API
 * This works by authenticating with an existing admin, then creating/updating another admin
 * 
 * Usage:
 *   tsx scripts/fix-admin-user-api.ts <pocketbase-url> <existing-admin-email> <existing-admin-password> <new-admin-email> <new-admin-password>
 * 
 * Note: This requires an existing admin user. If no admin exists, use the SSH method instead.
 */

import axios from 'axios';
import chalk from 'chalk';

interface AdminUser {
  id: string;
  email: string;
  created: string;
  updated: string;
  avatar: number;
}

async function createAdminUser(
  baseUrl: string,
  existingAdminEmail: string,
  existingAdminPassword: string,
  newAdminEmail: string,
  newAdminPassword: string
): Promise<void> {
  console.log(chalk.bold('\n🔧 Fixing Admin User via API\n'));
  console.log(chalk.gray(`PocketBase URL: ${baseUrl}`));
  console.log(chalk.gray(`New Admin: ${newAdminEmail}\n`));

  // Step 1: Authenticate with existing admin
  console.log(chalk.blue('Step 1: Authenticating with existing admin...'));
  
  let authToken: string;
  try {
    const authResponse = await axios.post(
      `${baseUrl}/api/admins/auth-with-password`,
      {
        identity: existingAdminEmail,
        password: existingAdminPassword,
      }
    );

    authToken = authResponse.data.token;
    console.log(chalk.green('✓ Authenticated successfully'));
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 400) {
        console.error(chalk.red('✗ Authentication failed: Invalid credentials'));
        console.error(chalk.yellow('\nIf no admin exists yet, use the SSH method instead:'));
        console.error(chalk.gray('  ./scripts/fix-admin-user-remote.sh api.db.oceannet.dev hello@oceannet.dev CHANGE_ME'));
      } else {
        console.error(chalk.red(`✗ Authentication failed: ${error.response?.data?.message || error.message}`));
      }
    } else {
      console.error(chalk.red(`✗ Authentication failed: ${error}`));
    }
    process.exit(1);
  }

  // Step 2: Check if admin already exists
  console.log(chalk.blue('\nStep 2: Checking existing admins...'));
  
  try {
    const listResponse = await axios.get(
      `${baseUrl}/api/admins`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );

    const existingAdmin = listResponse.data.items?.find(
      (admin: AdminUser) => admin.email === newAdminEmail
    );

    if (existingAdmin) {
      console.log(chalk.yellow(`⚠ Admin ${newAdminEmail} already exists`));
      console.log(chalk.blue('Updating password...'));

      // Update existing admin
      await axios.patch(
        `${baseUrl}/api/admins/${existingAdmin.id}`,
        {
          email: newAdminEmail,
          password: newAdminPassword,
          passwordConfirm: newAdminPassword,
        },
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      console.log(chalk.green('✓ Admin password updated successfully'));
    } else {
      console.log(chalk.blue('Creating new admin...'));

      // Create new admin
      await axios.post(
        `${baseUrl}/api/admins`,
        {
          email: newAdminEmail,
          password: newAdminPassword,
          passwordConfirm: newAdminPassword,
        },
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      console.log(chalk.green('✓ Admin created successfully'));
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(chalk.red(`✗ Failed: ${error.response?.data?.message || error.message}`));
    } else {
      console.error(chalk.red(`✗ Failed: ${error}`));
    }
    process.exit(1);
  }

  // Step 3: Verify login
  console.log(chalk.blue('\nStep 3: Verifying new admin credentials...'));
  
  try {
    await axios.post(
      `${baseUrl}/api/admins/auth-with-password`,
      {
        identity: newAdminEmail,
        password: newAdminPassword,
      }
    );

    console.log(chalk.green('✓ Login verification successful'));
  } catch (error) {
    console.error(chalk.yellow('⚠ Login verification failed, but admin may still be created'));
  }

  console.log(chalk.bold.green('\n✅ Admin user fixed successfully!\n'));
  console.log(chalk.bold('Admin Details:'));
  console.log(`  ${chalk.gray('Email:')}    ${newAdminEmail}`);
  console.log(`  ${chalk.gray('Admin URL:')} ${chalk.cyan(`${baseUrl}/_/`)}`);
  console.log('');
  console.log(chalk.yellow('You can now login to the admin panel with these credentials.'));
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 5) {
    console.error(chalk.red('Usage: tsx scripts/fix-admin-user-api.ts <pocketbase-url> <existing-admin-email> <existing-admin-password> <new-admin-email> <new-admin-password>'));
    console.error(chalk.gray('\nExample:'));
    console.error(chalk.gray('  tsx scripts/fix-admin-user-api.ts https://api.db.oceannet.dev admin@example.com oldpass hello@oceannet.dev CHANGE_ME'));
    console.error(chalk.gray('\nNote: This requires an existing admin. If no admin exists, use:'));
    console.error(chalk.gray('  ./scripts/fix-admin-user-remote.sh api.db.oceannet.dev hello@oceannet.dev CHANGE_ME'));
    process.exit(1);
  }

  const [baseUrl, existingAdminEmail, existingAdminPassword, newAdminEmail, newAdminPassword] = args;

  try {
    await createAdminUser(baseUrl, existingAdminEmail, existingAdminPassword, newAdminEmail, newAdminPassword);
  } catch (error) {
    console.error(chalk.red('\n✗ Failed:'), error);
    process.exit(1);
  }
}

main();
