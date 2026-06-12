#!/usr/bin/env tsx
/**
 * Oceannet Migration Script
 * Creates all collections and schemas in PocketBase for the Oceannet platform
 * 
 * Usage:
 *   tsx scripts/migrate-oceannet-collections.ts <pocketbase-url> <admin-email> <admin-password>
 * 
 * Example:
 *   tsx scripts/migrate-oceannet-collections.ts https://api.db.oceannet.dev panos@oceannet.cloud CHANGE_ME
 */

import axios from 'axios';
import chalk from 'chalk';

interface FieldSchema {
  name: string;
  type: string;
  required?: boolean;
  options?: {
    collectionId?: string;
    values?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CollectionSchema {
  name: string;
  type: 'base' | 'auth' | 'view';
  schema: FieldSchema[];
  indexes?: string[];
  listRule?: string;
  viewRule?: string;
  createRule?: string;
  updateRule?: string;
  deleteRule?: string;
}

class PocketBaseMigrator {
  private baseUrl: string;
  private adminToken: string | null = null;
  private adminEmail: string;
  private adminPassword: string;

  constructor(baseUrl: string, adminEmail: string, adminPassword: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminEmail = adminEmail;
    this.adminPassword = adminPassword;
  }

  async authenticate(): Promise<void> {
    console.log(chalk.blue('Authenticating as admin...'));
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/admins/auth-with-password`,
        {
          identity: this.adminEmail,
          password: this.adminPassword,
        }
      );

      this.adminToken = response.data.token;
      console.log(chalk.green('✓ Authenticated successfully'));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Authentication failed: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  private getAuthHeaders() {
    if (!this.adminToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    return {
      'Authorization': `Bearer ${this.adminToken}`,
      'Content-Type': 'application/json',
    };
  }

  async collectionExists(name: string): Promise<boolean> {
    try {
      await axios.get(
        `${this.baseUrl}/api/collections/${name}`,
        { headers: this.getAuthHeaders() }
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  async createCollection(schema: CollectionSchema): Promise<void> {
    const exists = await this.collectionExists(schema.name);
    
    if (exists) {
      console.log(chalk.yellow(`⚠ Collection "${schema.name}" already exists, skipping...`));
      return;
    }

    console.log(chalk.blue(`Creating collection "${schema.name}"...`));

    try {
      await axios.post(
        `${this.baseUrl}/api/collections`,
        schema,
        { headers: this.getAuthHeaders() }
      );
      console.log(chalk.green(`✓ Created collection "${schema.name}"`));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.message || error.message;
        throw new Error(`Failed to create collection "${schema.name}": ${message}`);
      }
      throw error;
    }
  }

  async updateCollection(name: string, schema: Partial<CollectionSchema>): Promise<void> {
    console.log(chalk.blue(`Updating collection "${name}"...`));

    try {
      await axios.patch(
        `${this.baseUrl}/api/collections/${name}`,
        schema,
        { headers: this.getAuthHeaders() }
      );
      console.log(chalk.green(`✓ Updated collection "${name}"`));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.message || error.message;
        throw new Error(`Failed to update collection "${name}": ${message}`);
      }
      throw error;
    }
  }

  async getCollectionId(name: string): Promise<string> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/collections/${name}`,
        { headers: this.getAuthHeaders() }
      );
      return response.data.id;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Collection "${name}" not found. Create it first.`);
      }
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to get collection "${name}": ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  async getUsersCollectionId(): Promise<string> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/collections`,
        { headers: this.getAuthHeaders() }
      );
      
      const usersCollection = response.data.items?.find(
        (col: { name: string; type: string }) => col.type === 'auth'
      );
      
      if (!usersCollection) {
        throw new Error('Users collection not found');
      }
      
      return usersCollection.id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to get users collection: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }


  async migrate(): Promise<void> {
    console.log(chalk.bold('\n🚀 Starting Oceannet Migration\n'));
    
    await this.authenticate();
    
    // Get the users collection ID (it's built-in)
    const usersCollectionId = await this.getUsersCollectionId();
    console.log(chalk.gray(`Using users collection ID: ${usersCollectionId}\n`));

    // Collection ID map for resolving references
    const collectionIdMap = new Map<string, string>();
    collectionIdMap.set('_pb_users_auth_', usersCollectionId);
    collectionIdMap.set('users', usersCollectionId); // Alias

    // Helper to resolve collection references in schema
    const resolveSchema = (schema: FieldSchema[]): FieldSchema[] => {
      return schema.map(field => {
        if (field.type === 'relation' && field.options?.collectionId) {
          const refName = field.options.collectionId;
          const resolvedId = collectionIdMap.get(refName);
          if (resolvedId) {
            return {
              ...field,
              options: {
                ...field.options,
                collectionId: resolvedId,
              },
            };
          }
        }
        return field;
      });
    };

    // Define all collections (in dependency order)
    const collections: CollectionSchema[] = [
      {
        name: 'user_profiles',
        type: 'base',
        schema: [
          { name: 'user_id', type: 'relation', required: true, options: { collectionId: usersCollectionId, maxSelect: 1, cascadeDelete: true } },
          { name: 'email', type: 'email', required: true },
          { name: 'full_name', type: 'text' },
          { name: 'company_name', type: 'text' },
          { name: 'phone', type: 'text' },
          { name: 'avatar_url', type: 'url' },
          { name: 'role', type: 'select', required: true, options: { values: ['superuser', 'developer', 'client'] } },
          { name: 'email_verified', type: 'bool', options: { defaultValue: false } },
          { name: 'is_activated', type: 'bool', options: { defaultValue: false } },
          { name: 'seniority_level', type: 'select', options: { values: ['junior', 'mid', 'senior', 'lead', 'principal', 'staff', 'distinguished'] } },
          { name: 'resume_url', type: 'url' },
          { name: 'resume_uploaded_at', type: 'date' },
          { name: 'resume_reviewed', type: 'bool', options: { defaultValue: false } },
          { name: 'resume_reviewed_at', type: 'date' },
          { name: 'activation_status', type: 'select', options: { values: ['active', 'pending_email', 'pending_resume', 'pending_review', 'standby', 'activated'] } },
          { name: 'profile_bio', type: 'text' },
          { name: 'skills', type: 'json' },
          { name: 'years_of_experience', type: 'number' },
          { name: 'github_url', type: 'url' },
          { name: 'linkedin_url', type: 'url' },
          { name: 'portfolio_url', type: 'url' },
        ],
      },
      {
        name: 'quote_conversations',
        type: 'base',
        schema: [
          { name: 'user_id', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'user_email', type: 'email' },
          { name: 'user_name', type: 'text' },
          { name: 'initial_prompt', type: 'text', required: true },
          { name: 'messages', type: 'json', required: true },
          { name: 'status', type: 'select', required: true, options: { values: ['active', 'completed', 'abandoned'] } },
        ],
      },
      {
        name: 'quotes',
        type: 'base',
        schema: [
          { name: 'conversation_id', type: 'relation', required: true, options: { collectionId: 'quote_conversations' as string, maxSelect: 1 } },
          { name: 'user_id', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'user_email', type: 'email' },
          { name: 'user_name', type: 'text' },
          { name: 'project_name', type: 'text' },
          { name: 'project_description', type: 'text', required: true },
          { name: 'breakdown', type: 'json', required: true },
          { name: 'items', type: 'json', required: true },
          { name: 'subtotal', type: 'number', required: true },
          { name: 'discount', type: 'number' },
          { name: 'total', type: 'number', required: true },
          { name: 'deposit_percentage', type: 'number' },
          { name: 'deposit_amount', type: 'number' },
          { name: 'currency', type: 'text' },
          { name: 'status', type: 'select', required: true, options: { values: ['draft', 'sent', 'accepted', 'rejected', 'expired'] } },
          { name: 'valid_until', type: 'date', required: true },
          { name: 'has_domain', type: 'bool' },
          { name: 'domain_name', type: 'text' },
          { name: 'needs_domain_help', type: 'bool' },
          { name: 'project_structure', type: 'json' },
          { name: 'architecture_plan', type: 'json' },
          { name: 'client_tasks', type: 'json' },
          { name: 'additional_costs', type: 'json' },
          { name: 'assumptions', type: 'json' },
          { name: 'confidence', type: 'select', options: { values: ['high', 'medium', 'low'] } },
          { name: 'timeline', type: 'text' },
          { name: 'quote_type', type: 'select', options: { values: ['final', 'suggested'] } },
          { name: 'requires_consultation', type: 'bool' },
          { name: 'consultation_reasons', type: 'json' },
          { name: 'complexity_assessment', type: 'json' },
          { name: 'price_validation', type: 'json' },
          { name: 'price_range', type: 'json' },
        ],
      },
      {
        name: 'projects',
        type: 'base',
        schema: [
          { name: 'user_id', type: 'relation', required: true, options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'assigned_developer_id', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'quote_id', type: 'relation', options: { collectionId: 'quotes', maxSelect: 1 } },
          { name: 'invoice_id', type: 'text' },
          { name: 'name', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'status', type: 'select', required: true, options: { values: ['pending', 'in_progress', 'review', 'completed', 'on_hold', 'cancelled'] } },
          { name: 'priority', type: 'select', required: true, options: { values: ['low', 'medium', 'high', 'urgent'] } },
          { name: 'progress_percentage', type: 'number' },
          { name: 'estimated_hours', type: 'number' },
          { name: 'hours_spent', type: 'number' },
          { name: 'start_date', type: 'date' },
          { name: 'estimated_completion_date', type: 'date' },
          { name: 'actual_completion_date', type: 'date' },
          { name: 'total_budget', type: 'number' },
          { name: 'amount_paid', type: 'number' },
          { name: 'amount_remaining', type: 'number' },
          { name: 'hourly_rate', type: 'number' },
          { name: 'tech_stack', type: 'json' },
          { name: 'deliverables', type: 'json' },
          { name: 'milestones', type: 'json' },
          { name: 'repository_url', type: 'url' },
          { name: 'staging_url', type: 'url' },
          { name: 'production_url', type: 'url' },
          { name: 'project_type', type: 'select', required: true, options: { values: ['development', 'service'] } },
          { name: 'lifecycle_stage', type: 'select', required: true, options: { values: ['development', 'live', 'maintenance'] } },
          { name: 'website_url', type: 'url' },
          { name: 'website_preview_url', type: 'url' },
        ],
      },
      {
        name: 'project_tasks',
        type: 'base',
        schema: [
          { name: 'project_id', type: 'relation', required: true, options: { collectionId: 'projects', maxSelect: 1, cascadeDelete: true } },
          { name: 'title', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'status', type: 'select', required: true, options: { values: ['pending', 'in_progress', 'completed', 'cancelled'] } },
          { name: 'priority', type: 'select', required: true, options: { values: ['low', 'medium', 'high', 'urgent'] } },
          { name: 'assigned_to', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'estimated_hours', type: 'number' },
          { name: 'actual_hours', type: 'number' },
          { name: 'due_date', type: 'date' },
          { name: 'completed_at', type: 'date' },
        ],
      },
      {
        name: 'support_subscriptions',
        type: 'base',
        schema: [
          { name: 'user_id', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'email', type: 'email', required: true },
          { name: 'website', type: 'url' },
          { name: 'plan_name', type: 'text', required: true },
          { name: 'plan_price', type: 'number', required: true },
          { name: 'billing_period', type: 'select', required: true, options: { values: ['monthly', 'yearly'] } },
          { name: 'currency', type: 'text' },
          { name: 'status', type: 'select', required: true, options: { values: ['pending', 'active', 'cancelled', 'past_due', 'expired'] } },
          { name: 'stripe_session_id', type: 'text' },
          { name: 'stripe_customer_id', type: 'text' },
          { name: 'stripe_subscription_id', type: 'text' },
          { name: 'stripe_price_id', type: 'text' },
          { name: 'current_period_start', type: 'date' },
          { name: 'current_period_end', type: 'date' },
          { name: 'cancelled_at', type: 'date' },
        ],
      },
      {
        name: 'project_subscriptions',
        type: 'base',
        schema: [
          { name: 'project_id', type: 'relation', required: true, options: { collectionId: 'projects', maxSelect: 1, cascadeDelete: true } },
          { name: 'subscription_id', type: 'relation', required: true, options: { collectionId: 'support_subscriptions', maxSelect: 1 } },
          { name: 'hours_allocated', type: 'number', required: true },
          { name: 'hours_used', type: 'number' },
          { name: 'hours_reset_date', type: 'date', required: true },
          { name: 'is_active', type: 'bool', required: true },
        ],
      },
      {
        name: 'invoices',
        type: 'base',
        schema: [
          { name: 'user_id', type: 'relation', required: true, options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'project_id', type: 'relation', options: { collectionId: 'projects', maxSelect: 1 } },
          { name: 'quote_id', type: 'relation', options: { collectionId: 'quotes', maxSelect: 1 } },
          { name: 'invoice_number', type: 'text', required: true },
          { name: 'title', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'status', type: 'select', required: true, options: { values: ['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled', 'refunded'] } },
          { name: 'subtotal', type: 'number', required: true },
          { name: 'tax_rate', type: 'number' },
          { name: 'tax_amount', type: 'number' },
          { name: 'discount_amount', type: 'number' },
          { name: 'total_amount', type: 'number', required: true },
          { name: 'amount_paid', type: 'number' },
          { name: 'amount_due', type: 'number' },
          { name: 'currency', type: 'text' },
          { name: 'issue_date', type: 'date', required: true },
          { name: 'due_date', type: 'date' },
          { name: 'paid_date', type: 'date' },
          { name: 'payment_method', type: 'text' },
          { name: 'stripe_payment_intent_id', type: 'text' },
          { name: 'stripe_invoice_id', type: 'text' },
          { name: 'payment_url', type: 'url' },
          { name: 'line_items', type: 'json' },
          { name: 'notes', type: 'text' },
          { name: 'terms', type: 'text' },
        ],
      },
      {
        name: 'service_tickets',
        type: 'base',
        schema: [
          { name: 'project_id', type: 'relation', required: true, options: { collectionId: 'projects', maxSelect: 1 } },
          { name: 'subscription_id', type: 'relation', options: { collectionId: 'support_subscriptions', maxSelect: 1 } },
          { name: 'user_id', type: 'relation', required: true, options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'title', type: 'text', required: true },
          { name: 'description', type: 'text', required: true },
          { name: 'priority', type: 'select', required: true, options: { values: ['low', 'medium', 'high', 'urgent'] } },
          { name: 'status', type: 'select', required: true, options: { values: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] } },
          { name: 'ticket_type', type: 'select', required: true, options: { values: ['bug', 'feature', 'improvement', 'question', 'other'] } },
          { name: 'assigned_to', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'estimated_hours', type: 'number' },
          { name: 'actual_hours', type: 'number' },
          { name: 'resolved_at', type: 'date' },
          { name: 'resolved_by', type: 'relation', options: { collectionId: usersCollectionId, maxSelect: 1 } },
        ],
      },
      {
        name: 'ticket_messages',
        type: 'base',
        schema: [
          { name: 'ticket_id', type: 'relation', required: true, options: { collectionId: 'service_tickets', maxSelect: 1, cascadeDelete: true } },
          { name: 'user_id', type: 'relation', required: true, options: { collectionId: usersCollectionId, maxSelect: 1 } },
          { name: 'message', type: 'text', required: true },
          { name: 'is_internal', type: 'bool' },
          { name: 'attachments', type: 'json' },
        ],
      },
      {
        name: 'webhook_logs',
        type: 'base',
        schema: [
          { name: 'event_type', type: 'text', required: true },
          { name: 'event_id', type: 'text', required: true },
          { name: 'payload', type: 'json', required: true },
          { name: 'status', type: 'select', required: true, options: { values: ['pending', 'processed', 'failed'] } },
          { name: 'error_message', type: 'text' },
          { name: 'processed_at', type: 'date' },
        ],
      },
    ];

    // Create collections in order (respecting dependencies)
    console.log(chalk.bold('\n📦 Creating Collections\n'));
    
    for (const collection of collections) {
      try {
        // Resolve collection references before creating
        const resolvedSchema = resolveSchema(collection.schema);
        const collectionToCreate = {
          ...collection,
          schema: resolvedSchema,
        };
        
        await this.createCollection(collectionToCreate);
        
        // Get the ID of the newly created collection and store it
        const id = await this.getCollectionId(collection.name);
        collectionIdMap.set(collection.name, id);
      } catch (error) {
        console.error(chalk.red(`✗ Error creating ${collection.name}:`), error);
        throw error;
      }
    }

    console.log(chalk.bold.green('\n✅ Migration completed successfully!\n'));
    console.log(chalk.gray(`Collections created: ${collections.length}`));
    console.log(chalk.gray(`PocketBase URL: ${this.baseUrl}`));
    console.log(chalk.gray(`Admin Panel: ${this.baseUrl}/_/\n`));
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error(chalk.red('Usage: tsx scripts/migrate-oceannet-collections.ts <pocketbase-url> <admin-email> <admin-password>'));
    console.error(chalk.gray('\nExample:'));
    console.error(chalk.gray('  tsx scripts/migrate-oceannet-collections.ts https://api.db.oceannet.dev panos@oceannet.cloud CHANGE_ME'));
    process.exit(1);
  }

  const [baseUrl, adminEmail, adminPassword] = args;

  const migrator = new PocketBaseMigrator(baseUrl, adminEmail, adminPassword);
  
  try {
    await migrator.migrate();
  } catch (error) {
    console.error(chalk.red('\n✗ Migration failed:'), error);
    process.exit(1);
  }
}

main();
