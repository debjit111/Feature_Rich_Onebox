import { Client } from '@elastic/elasticsearch';
import { config } from '../config/config';
import { Email } from '../models/email';
import { logger } from '../utils/logger';

export class ElasticsearchService {
  private client: Client;
  private indexName: string;

  constructor() {
    this.indexName = config.elasticsearch.indexName;
    this.client = new Client({
      node: config.elasticsearch.node,
      auth: {
        username: config.elasticsearch.auth.username,
        password: config.elasticsearch.auth.password
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  // Initialize Elasticsearch service
  async initialize(): Promise<void> {
    try {
      // Check if Elasticsearch is available
      await this.client.ping();
      logger.info('Connected to Elasticsearch');

      // Check if index exists
      const indexExists = await this.client.indices.exists({ index: this.indexName });
      
      if (!indexExists) {
        await this.createIndex();
        logger.info(`Created index ${this.indexName}`);
      }
    } catch (error) {
      logger.error('Failed to connect to Elasticsearch:', error);
      throw error;
    }
  }

  // Create emails index with mappings
  private async createIndex(): Promise<void> {
    try {
      await this.client.indices.create({
        index: this.indexName,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                email_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'stop', 'snowball']
                }
              }
            }
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              accountId: { type: 'keyword' },
              msgId: { type: 'keyword' },
              folder: { type: 'keyword' },
              uid: { type: 'long' },
              subject: { 
                type: 'text',
                analyzer: 'email_analyzer',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              from: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              to: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              cc: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              date: { type: 'date' },
              receivedDate: { type: 'date' },
              text: { 
                type: 'text',
                analyzer: 'email_analyzer' 
              },
              html: { type: 'text' },
              category: { type: 'keyword' },
              flags: { type: 'keyword' },
              attachments: {
                type: 'nested',
                properties: {
                  filename: { type: 'keyword' },
                  contentType: { type: 'keyword' },
                  size: { type: 'long' }
                }
              }
            }
          }
        }
      });
    } catch (error) {
      logger.error(`Error creating index ${this.indexName}:`, error);
      throw error;
    }
  }

  // Close Elasticsearch client
  async close(): Promise<void> {
    try {
      await this.client.close();
      logger.info('Elasticsearch client closed');
    } catch (error) {
      logger.error('Error closing Elasticsearch client:', error);
    }
  }

  // Index an email
  async indexEmail(email: Email): Promise<string> {
    try {
      // Check if email already exists
      const exists = await this.emailExists(email.id);
      
      if (exists) {
        logger.debug(`Email ${email.id} already exists, updating`);
        
        // Update existing email
        await this.client.update({
          index: this.indexName,
          id: email.id,
          body: {
            doc: email
          }
        });
        
        return email.id;
      }
      
      // Index new email
      const response = await this.client.index({
        index: this.indexName,
        id: email.id,
        body: email
      });
      
      logger.debug(`Indexed email ${email.id}`);
      return response._id;
    } catch (error) {
      logger.error(`Error indexing email ${email.id}:`, error);
      throw error;
    }
  }

  // Check if an email exists
  async emailExists(id: string): Promise<boolean> {
    try {
      const response = await this.client.exists({
        index: this.indexName,
        id
      });
      
      return response;
    } catch (error) {
      logger.error(`Error checking if email ${id} exists:`, error);
      return false;
    }
  }

  // Get an email by ID
  async getEmailById(id: string): Promise<Email | null> {
    try {
      const response = await this.client.get({
        index: this.indexName,
        id
      });
      
      if (!response || !response._source) {
        return null;
      }
      
      return response._source as Email;
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        return null;
      }
      
      logger.error(`Error getting email ${id}:`, error);
      throw error;
    }
  }

  // Update email category
  async updateEmailCategory(id: string, category: string): Promise<void> {
    try {
      await this.client.update({
        index: this.indexName,
        id,
        body: {
          doc: {
            category
          }
        }
      });
      
      logger.debug(`Updated category for email ${id} to ${category}`);
    } catch (error) {
      logger.error(`Error updating category for email ${id}:`, error);
      throw error;
    }
  }

  // Search emails
  async searchEmails(options: any): Promise<any> {
    try {
      const { page = 1, limit = 50, query, sortBy = 'date', sortOrder = 'desc', filters = {} } = options;
      
      const from = (page - 1) * limit;
      
      // Build query
      const must: any[] = [];
      
      // Full-text search
      if (query) {
        must.push({
          multi_match: {
            query,
            fields: ['subject^3', 'from^2', 'to^2', 'text']
          }
        });
      }
      
      // Add filters
      if (filters.accountId) {
        must.push({ term: { accountId: filters.accountId } });
      }
      
      if (filters.folder) {
        must.push({ term: { folder: filters.folder } });
      }
      
      if (filters.category) {
        must.push({ term: { category: filters.category } });
      }
      
      if (filters.from) {
        must.push({ match: { from: filters.from } });
      }
      
      if (filters.to) {
        must.push({ match: { to: filters.to } });
      }
      
      if (filters.subject) {
        must.push({ match: { subject: filters.subject } });
      }
      
      // Date range
      if (filters.startDate || filters.endDate) {
        const dateRange: any = {};
        
        if (filters.startDate) {
          dateRange.gte = filters.startDate;
        }
        
        if (filters.endDate) {
          dateRange.lte = filters.endDate;
        }
        
        must.push({
          range: {
            date: dateRange
          }
        });
      }
      
      // Build sort
      const sort: any = {};
      sort[sortBy] = { order: sortOrder };
      
      // Perform search
      const body: any = {
        query: {
          bool: {
            must
          }
        },
        sort: [sort],
        from,
        size: limit
      };
      
      const response = await this.client.search({
        index: this.indexName,
        body
      });
      
      // Format results
      const total = response.hits.total.value;
      const emails = response.hits.hits.map((hit: any) => ({
        ...hit._source,
        score: hit._score
      }));
      
      return {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        emails
      };
    } catch (error) {
      logger.error('Error searching emails:', error);
      throw error;
    }
  }
}
