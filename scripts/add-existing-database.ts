#!/usr/bin/env tsx
/**
 * Add an existing PocketBase database to the manager system
 * This is useful when a database was created manually or outside the manager
 * 
 * Usage:
 *   tsx scripts/add-existing-database.ts <name> <slug> <domain> <container-name> <email> <password>
 * 
 * Example:
 *   tsx scripts/add-existing-database.ts "Oceannet" "api" "api.db.oceannet.dev" "pocketbase-api" "hello@oceannet.dev" "CHANGE_ME"
 */

import { nanoid } from 'nanoid';
import { projectManager } from '../src/services/project-manager.js';
import { credentialsManager } from '../src/services/credentials-manager.js';
import { storageManager } from '../src/services/storage-manager.js';
import { dockerManager } from '../src/services/docker-manager.js';
import type { Project } from '../src/types/index.js';
import chalk from 'chalk';

async function addExistingDatabase(
  name: string,
  slug: string,
  domain: string,
  containerName: string,
  email: string,
  password: string
) {
  console.log(chalk.bold('\n🔧 Adding Existing Database to Manager\n'));
  
  await projectManager.initialize();
  
  // Check if project already exists
  const existing = await storageManager.getProjectBySlug(slug);
  if (existing) {
    console.error(chalk.red(`❌ Project with slug "${slug}" already exists!`));
    console.log(chalk.gray(`   ID: ${existing.id}`));
    console.log(chalk.gray(`   Name: ${existing.name}`));
    process.exit(1);
  }
  
  // Check if container exists
  console.log(chalk.blue(`Checking container: ${containerName}...`));
  const containerInfo = await dockerManager.getContainerInfo(containerName);
  if (!containerInfo) {
    console.error(chalk.red(`❌ Container "${containerName}" not found!`));
    console.log(chalk.yellow('   Make sure the container is running or exists.'));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Container found: ${containerName}`));
  console.log(chalk.gray(`   Status: ${containerInfo.state}`));
  
  // Get container port
  const port = containerInfo.ports[0]?.hostPort || 0;
  
  // Create project entry
  const projectId = nanoid(12);
  const project: Project = {
    id: projectId,
    name,
    slug,
    description: `Existing database: ${name}`,
    status: containerInfo.state === 'running' ? 'running' : 'stopped',
    containerName,
    port,
    domain,
    createdAt: new Date(),
    updatedAt: new Date(),
    config: {
      memoryLimit: '256m',
      cpuLimit: '0.5',
      autoBackup: true,
      enabledFeatures: {
        auth: true,
        storage: true,
        realtime: true,
      },
    },
  };
  
  // Save project
  console.log(chalk.blue('\nSaving project to manager...'));
  await storageManager.saveProject(project);
  console.log(chalk.green(`✓ Project saved: ${projectId}`));
  
  // Store credentials
  console.log(chalk.blue('Storing credentials...'));
  await credentialsManager.storeCredentials(
    projectId,
    name,
    slug,
    domain,
    email,
    password
  );
  console.log(chalk.green(`✓ Credentials stored`));
  
  console.log(chalk.bold.green('\n✅ Database added successfully!\n'));
  console.log(chalk.bold('Project Details:'));
  console.log(`  ${chalk.gray('ID:')}          ${projectId}`);
  console.log(`  ${chalk.gray('Name:')}        ${name}`);
  console.log(`  ${chalk.gray('Slug:')}        ${slug}`);
  console.log(`  ${chalk.gray('Domain:')}      ${domain}`);
  console.log(`  ${chalk.gray('Container:')}   ${containerName}`);
  console.log(`  ${chalk.gray('Status:')}      ${project.status}`);
  console.log(`  ${chalk.gray('Port:')}        ${port}`);
  console.log('');
  console.log(chalk.bold('Credentials:'));
  console.log(`  ${chalk.gray('Email:')}       ${email}`);
  console.log(`  ${chalk.gray('Password:')}   ${password}`);
  console.log('');
  console.log(chalk.bold('URLs:'));
  console.log(`  ${chalk.gray('API:')}         ${chalk.cyan(`https://${domain}`)}`);
  console.log(`  ${chalk.gray('Admin:')}       ${chalk.cyan(`https://${domain}/_/`)}`);
  console.log('');
  console.log(chalk.yellow('You can now use the dashboard to manage this database!'));
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 6) {
    console.error(chalk.red('Usage: tsx scripts/add-existing-database.ts <name> <slug> <domain> <container-name> <email> <password>'));
    console.error(chalk.gray('\nExample:'));
    console.error(chalk.gray('  tsx scripts/add-existing-database.ts "Oceannet" "api" "api.db.oceannet.dev" "pocketbase-api" "hello@oceannet.dev" "CHANGE_ME"'));
    process.exit(1);
  }

  const [name, slug, domain, containerName, email, password] = args;

  try {
    await addExistingDatabase(name, slug, domain, containerName, email, password);
  } catch (error) {
    console.error(chalk.red('\n✗ Failed:'), error);
    process.exit(1);
  }
}

main();
