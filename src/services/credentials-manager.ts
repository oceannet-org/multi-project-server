import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { paths } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('credentials-manager');

interface DatabaseCredentials {
  projectId: string;
  projectName: string;
  projectSlug: string;
  domain: string;
  adminEmail: string;
  adminPassword: string;
  createdAt: string;
  updatedAt: string;
}

interface CredentialsStore {
  databases: Record<string, DatabaseCredentials>;
  lastUpdated: string;
}

const CREDENTIALS_FILE = path.join(paths.data, 'database-credentials.json');

class CredentialsManager {
  private store: CredentialsStore = {
    databases: {},
    lastUpdated: new Date().toISOString(),
  };

  async initialize(): Promise<void> {
    await this.loadStore();
    logger.info('Credentials manager initialized');
  }

  private async loadStore(): Promise<void> {
    try {
      const data = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
      // An empty file (e.g. a touch or an interrupted write) is the same as no
      // store — re-initialize instead of crash-looping on JSON.parse.
      if (data.trim() === '') {
        logger.info('Credentials store is empty, creating new one');
        await this.saveStore();
        return;
      }
      this.store = JSON.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No credentials store found, creating new one');
        await this.saveStore();
      } else {
        logger.error('Failed to load credentials store', error);
        throw error;
      }
    }
  }

  private async saveStore(): Promise<void> {
    await fs.mkdir(path.dirname(CREDENTIALS_FILE), { recursive: true });
    this.store.lastUpdated = new Date().toISOString();
    await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  /**
   * Generate a secure random password
   */
  generatePassword(length = 16): string {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
    let password = '';
    const values = new Uint32Array(length);
    crypto.getRandomValues(values);
    
    for (let i = 0; i < length; i++) {
      password += charset[values[i] % charset.length];
    }
    
    return password;
  }

  /**
   * Store credentials for a database
   */
  async storeCredentials(
    projectId: string,
    projectName: string,
    projectSlug: string,
    domain: string,
    adminEmail: string,
    adminPassword: string
  ): Promise<void> {
    this.store.databases[projectId] = {
      projectId,
      projectName,
      projectSlug,
      domain,
      adminEmail,
      adminPassword,
      createdAt: this.store.databases[projectId]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveStore();
    logger.info(`Stored credentials for project: ${projectName}`);
  }

  /**
   * Get credentials for a database
   */
  getCredentials(projectId: string): DatabaseCredentials | null {
    return this.store.databases[projectId] || null;
  }

  /**
   * Get all stored credentials
   */
  getAllCredentials(): DatabaseCredentials[] {
    return Object.values(this.store.databases);
  }

  /**
   * Update credentials for a database
   */
  async updateCredentials(projectId: string, updates: Partial<DatabaseCredentials>): Promise<void> {
    const existing = this.store.databases[projectId];
    if (!existing) {
      throw new Error(`No credentials found for project: ${projectId}`);
    }

    this.store.databases[projectId] = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.saveStore();
    logger.info(`Updated credentials for project: ${existing.projectName}`);
  }

  /**
   * Delete credentials for a database
   */
  async deleteCredentials(projectId: string): Promise<void> {
    const existing = this.store.databases[projectId];
    if (existing) {
      delete this.store.databases[projectId];
      await this.saveStore();
      logger.info(`Deleted credentials for project: ${existing.projectName}`);
    }
  }

  /**
   * Export credentials to a readable format (for backup/reference)
   */
  exportCredentials(): string {
    const lines: string[] = [
      '# PocketBase Database Credentials',
      '# Generated: ' + new Date().toISOString(),
      '# ⚠️  KEEP THIS FILE SECURE - DO NOT COMMIT TO GIT',
      '',
    ];

    for (const cred of Object.values(this.store.databases)) {
      lines.push(`## ${cred.projectName} (${cred.projectSlug})`);
      lines.push(`Database ID: ${cred.projectId}`);
      lines.push(`Domain: https://${cred.domain}`);
      lines.push(`Admin URL: https://${cred.domain}/_/`);
      lines.push(`Admin Email: ${cred.adminEmail}`);
      lines.push(`Admin Password: ${cred.adminPassword}`);
      lines.push(`Created: ${cred.createdAt}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

export const credentialsManager = new CredentialsManager();

