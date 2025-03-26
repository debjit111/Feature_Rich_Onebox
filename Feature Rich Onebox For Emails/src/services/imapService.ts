import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { config, EmailAccount } from '../config/config';
import { ElasticsearchService } from './elasticsearchService';
import { AiService } from './aiService';
import { IntegrationService } from './integrationService';
import { Email } from '../models/email';
import { logger } from '../utils/logger';

// Interface for connection state tracking
interface ImapConnection {
  instance: Imap;
  connected: boolean;
  folders?: string[];
  lastSyncDate?: Date;
}

export class ImapService {
  private connections: Map<string, ImapConnection> = new Map();
  private accounts: EmailAccount[] = [];
  private syncInProgress: Set<string> = new Set();

  constructor(
    private elasticsearchService: ElasticsearchService,
    private aiService: AiService,
    private integrationService: IntegrationService
  ) {}

  // Initialize IMAP service
  async initialize(): Promise<void> {
    this.accounts = config.emailAccounts();
    logger.info(`Initializing IMAP service with ${this.accounts.length} accounts`);
    
    for (const account of this.accounts) {
      try {
        await this.connectAccount(account);
      } catch (error) {
        logger.error(`Failed to connect to account ${account.id}:`, error);
      }
    }

    // Start initial sync of emails
    await this.syncAllAccounts(false);
  }

  // Connect to an IMAP account
  async connectAccount(account: EmailAccount): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Connecting to account ${account.id} (${account.user})`);
        
        const imap = new Imap({
          user: account.user,
          password: account.password,
          host: account.host,
          port: account.port,
          tls: account.tls,
          tlsOptions: { rejectUnauthorized: false },
          keepalive: true,
          authTimeout: 30000
        });

        // Setup event handlers
        imap.once('ready', () => {
          logger.info(`Connected to account ${account.id}`);
          this.connections.set(account.id, { 
            instance: imap, 
            connected: true 
          });
          
          // Setup IDLE mode
          this.setupIdleMode(account.id);
          
          // Load folders
          this.loadFolders(account.id).then(() => {
            resolve(true);
          }).catch(folderError => {
            logger.error(`Error loading folders for account ${account.id}:`, folderError);
            resolve(true); // Still resolve as we are connected
          });
        });

        imap.once('error', (err) => {
          logger.error(`IMAP error for account ${account.id}:`, err);
          if (!this.connections.has(account.id) || !this.connections.get(account.id)?.connected) {
            reject(err);
          }
        });

        imap.once('end', () => {
          logger.info(`Connection to account ${account.id} ended`);
          
          // Update connection status
          const connection = this.connections.get(account.id);
          if (connection) {
            connection.connected = false;
          }
          
          // Attempt to reconnect after delay
          setTimeout(() => {
            this.reconnect(account.id).catch(err => {
              logger.error(`Failed to reconnect to account ${account.id}:`, err);
            });
          }, 5000);
        });

        // Connect to the account
        imap.connect();
      } catch (error) {
        logger.error(`Error connecting to account ${account.id}:`, error);
        reject(error);
      }
    });
  }

  // Reconnect to an account
  private async reconnect(accountId: string): Promise<boolean> {
    const account = this.accounts.find(acc => acc.id === accountId);
    if (!account) {
      logger.error(`Cannot reconnect to unknown account ${accountId}`);
      return false;
    }

    // Close existing connection if it exists
    const connection = this.connections.get(accountId);
    if (connection) {
      try {
        if (connection.connected) {
          connection.instance.end();
        }
      } catch (error) {
        logger.error(`Error closing existing connection for account ${accountId}:`, error);
      }
    }

    // Try to reconnect
    try {
      return await this.connectAccount(account);
    } catch (error) {
      logger.error(`Failed to reconnect to account ${accountId}:`, error);
      return false;
    }
  }

  // Disconnect all accounts
  async disconnect(): Promise<void> {
    logger.info('Disconnecting from all IMAP accounts');
    
    for (const [accountId, connection] of this.connections.entries()) {
      try {
        if (connection.connected) {
          connection.instance.end();
          logger.info(`Disconnected from account ${accountId}`);
        }
      } catch (error) {
        logger.error(`Error disconnecting from account ${accountId}:`, error);
      }
    }
  }

  // Load folders for an account
  private async loadFolders(accountId: string): Promise<string[]> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      logger.error(`Cannot load folders - no connection for account ${accountId}`);
      return [];
    }

    return new Promise((resolve, reject) => {
      connection.instance.getBoxes((err, boxes) => {
        if (err) {
          reject(err);
          return;
        }

        const folders: string[] = [];
        
        // Process boxes recursively
        const processBoxes = (boxObject: any, prefix = '') => {
          for (const boxName in boxObject) {
            const fullPath = prefix ? `${prefix}${boxName}` : boxName;
            folders.push(fullPath);
            
            if (boxObject[boxName].children) {
              processBoxes(boxObject[boxName].children, `${fullPath}/`);
            }
          }
        };
        
        processBoxes(boxes);
        
        // Store folders in connection
        connection.folders = folders;
        logger.info(`Loaded ${folders.length} folders for account ${accountId}`);
        resolve(folders);
      });
    });
  }

  // Get folders for an account
  async getFolders(accountId: string): Promise<string[] | null> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      return null;
    }

    // If folders are already loaded, return them
    if (connection.folders) {
      return connection.folders;
    }

    // Otherwise, load them
    return await this.loadFolders(accountId);
  }

  // Setup IDLE mode for real-time updates
  private setupIdleMode(accountId: string): void {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      logger.error(`Cannot setup IDLE mode - no connection for account ${accountId}`);
      return;
    }

    // Function to start IDLE mode on a mailbox
    const startIdle = () => {
      logger.info(`Starting IDLE mode for account ${accountId}`);
      
      // Open INBOX
      connection.instance.openBox('INBOX', false, (err) => {
        if (err) {
          logger.error(`Error opening INBOX for account ${accountId}:`, err);
          return;
        }

        // Setup handlers for new emails
        connection.instance.on('mail', (numNewMsgs) => {
          logger.info(`Received ${numNewMsgs} new messages for account ${accountId}`);
          this.fetchNewEmails(accountId, numNewMsgs);
        });

        // Start IDLE mode
        connection.instance.idle();
        
        // Periodically restart IDLE to keep connection alive
        // This is a workaround for certain IMAP servers that might drop idle connections
        setInterval(() => {
          try {
            if (connection.connected) {
              connection.instance.idle();
            }
          } catch (error) {
            logger.error(`Error restarting IDLE for account ${accountId}:`, error);
          }
        }, 29 * 60 * 1000); // Every 29 minutes
      });
    };

    // Start IDLE mode
    startIdle();
  }

  // Fetch new emails when notified by IDLE
  private async fetchNewEmails(accountId: string, numNewMsgs: number): Promise<void> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      logger.error(`Cannot fetch new emails - no connection for account ${accountId}`);
      return;
    }

    const account = this.accounts.find(acc => acc.id === accountId);
    if (!account) {
      logger.error(`Cannot fetch new emails - unknown account ${accountId}`);
      return;
    }

    logger.info(`Fetching ${numNewMsgs} new emails for account ${accountId}`);

    try {
      // Search for all emails in INBOX
      connection.instance.search(['ALL'], async (err, results) => {
        if (err) {
          logger.error(`Error searching for new emails for account ${accountId}:`, err);
          return;
        }

        // Get only the latest messages (up to numNewMsgs)
        const latestMessages = results.slice(-numNewMsgs);
        
        if (latestMessages.length === 0) {
          logger.info(`No new messages to fetch for account ${accountId}`);
          return;
        }
        
        // Fetch each message
        for (const msgId of latestMessages) {
          try {
            const email = await this.fetchEmail(accountId, msgId);
            if (email) {
              // Process email
              await this.processEmail(email);
            }
          } catch (fetchError) {
            logger.error(`Error fetching email ${msgId} for account ${accountId}:`, fetchError);
          }
        }
      });
    } catch (error) {
      logger.error(`Error fetching new emails for account ${accountId}:`, error);
    }
  }

  // Fetch a specific email by message ID
  private fetchEmail(accountId: string, msgId: number): Promise<Email | null> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      logger.error(`Cannot fetch email - no connection for account ${accountId}`);
      return Promise.resolve(null);
    }

    const account = this.accounts.find(acc => acc.id === accountId);
    if (!account) {
      logger.error(`Cannot fetch email - unknown account ${accountId}`);
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const fetch = connection.instance.fetch([msgId], { 
        bodies: ['HEADER', 'TEXT'],
        struct: true
      });

      let email: Partial<Email> = {
        id: `${accountId}-${msgId}`,
        accountId,
        msgId: msgId.toString(),
        folder: 'INBOX',
        receivedDate: new Date()
      };

      fetch.on('message', (msg) => {
        msg.on('body', (stream, info) => {
          let buffer = '';
          
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
          
          stream.once('end', () => {
            if (info.which === 'HEADER') {
              const parsed = Imap.parseHeader(buffer);
              email.subject = parsed.subject?.[0] || 'No Subject';
              email.from = parsed.from?.[0] || '';
              email.to = parsed.to?.[0] || '';
              email.cc = parsed.cc?.[0] || '';
              email.date = parsed.date?.[0] ? new Date(parsed.date[0]) : new Date();
            } else {
              email.body = buffer;
            }
          });
        });

        msg.once('attributes', (attrs) => {
          email.flags = attrs.flags || [];
          email.uid = attrs.uid;
        });

        msg.once('end', () => {
          // Parse the email body with mailparser for better content extraction
          if (email.body) {
            simpleParser(email.body).then(parsed => {
              email.html = parsed.html || null;
              email.text = parsed.text || '';
              email.attachments = parsed.attachments?.map(att => ({
                filename: att.filename || 'unnamed',
                contentType: att.contentType || 'application/octet-stream',
                size: att.size || 0
              })) || [];
              
              resolve(email as Email);
            }).catch(error => {
              logger.error(`Error parsing email ${msgId} for account ${accountId}:`, error);
              // Still resolve with what we have
              resolve(email as Email);
            });
          } else {
            resolve(email as Email);
          }
        });
      });

      fetch.once('error', (err) => {
        logger.error(`Error fetching email ${msgId} for account ${accountId}:`, err);
        reject(err);
      });

      fetch.once('end', () => {
        logger.debug(`Fetch completed for email ${msgId} from account ${accountId}`);
      });
    });
  }

  // Process a fetched email
  private async processEmail(email: Email): Promise<void> {
    try {
      // 1. Categorize email with AI
      const category = await this.aiService.categorizeEmail(email);
      email.category = category;
      
      // 2. Store in Elasticsearch
      await this.elasticsearchService.indexEmail(email);
      
      // 3. Send notifications based on category
      if (category === 'interested') {
        await this.integrationService.sendSlackNotification({
          title: `Interested: ${email.subject}`,
          text: `From: ${email.from}\n\n${email.text?.substring(0, 200)}...`,
          color: 'good',
          email: email
        });
        
        // 4. Trigger webhooks
        await this.integrationService.triggerWebhooks('interested_email', email);
      } else if (category === 'spam') {
        await this.integrationService.triggerWebhooks('spam_detected', email);
      }
      
      // Trigger general new email webhooks
      await this.integrationService.triggerWebhooks('new_email', email);
      
      logger.info(`Processed email "${email.subject}" from ${email.from} (Category: ${category})`);
    } catch (error) {
      logger.error(`Error processing email ${email.id}:`, error);
    }
  }

  // Sync emails from the last 30 days for a specific account
  async syncAccount(accountId: string, force: boolean = false): Promise<any> {
    // Prevent multiple syncs of the same account
    if (this.syncInProgress.has(accountId)) {
      logger.info(`Sync already in progress for account ${accountId}`);
      return { status: 'in_progress' };
    }
    
    const connection = this.connections.get(accountId);
    const account = this.accounts.find(acc => acc.id === accountId);
    
    if (!connection || !connection.connected || !account) {
      logger.error(`Cannot sync emails - no connection for account ${accountId}`);
      return { error: 'No connection' };
    }
    
    // Mark sync as in progress
    this.syncInProgress.add(accountId);
    
    try {
      // Calculate date range - last 30 days
      const since = new Date();
      since.setDate(since.getDate() - 30);
      
      // If we've synced before and not forcing, only get emails since last sync
      if (!force && connection.lastSyncDate) {
        since.setTime(connection.lastSyncDate.getTime());
      }
      
      const sinceString = since.toISOString().substring(0, 10);
      
      // Process important folders
      const foldersToSync = ['INBOX', 'Sent', 'Drafts', 'Spam'];
      const results = {};
      
      for (const folder of foldersToSync) {
        try {
          // Only try to sync folders that exist
          if (connection.folders && !connection.folders.includes(folder)) {
            continue;
          }
          
          // Open folder
          const box = await this.openMailbox(accountId, folder);
          
          // Search for emails since the date
          const query = ['SINCE', sinceString];
          const messageIds = await this.searchMailbox(accountId, query);
          
          logger.info(`Found ${messageIds.length} emails in ${folder} since ${sinceString} for account ${accountId}`);
          
          // Fetch and process emails in batches to avoid memory issues
          const batchSize = 10;
          const batches = [];
          
          for (let i = 0; i < messageIds.length; i += batchSize) {
            batches.push(messageIds.slice(i, i + batchSize));
          }
          
          let processedCount = 0;
          
          for (const batch of batches) {
            const emailPromises = batch.map(msgId => this.fetchEmail(accountId, msgId));
            const emails = await Promise.all(emailPromises);
            
            for (const email of emails) {
              if (email) {
                await this.processEmail(email);
                processedCount++;
              }
            }
          }
          
          results[folder] = {
            total: messageIds.length,
            processed: processedCount
          };
        } catch (folderError) {
          logger.error(`Error syncing folder ${folder} for account ${accountId}:`, folderError);
          results[folder] = { error: folderError.message };
        }
      }
      
      // Update last sync date
      connection.lastSyncDate = new Date();
      
      return {
        accountId,
        status: 'completed',
        lastSync: connection.lastSyncDate,
        results
      };
    } catch (error) {
      logger.error(`Error syncing account ${accountId}:`, error);
      return { error: error.message };
    } finally {
      // Remove from in-progress set
      this.syncInProgress.delete(accountId);
    }
  }

  // Sync all accounts
  async syncAllAccounts(force: boolean = false): Promise<any[]> {
    logger.info(`Syncing all accounts (force=${force})`);
    
    const results = [];
    
    for (const account of this.accounts) {
      try {
        const result = await this.syncAccount(account.id, force);
        results.push({ accountId: account.id, result });
      } catch (error) {
        logger.error(`Error syncing account ${account.id}:`, error);
        results.push({ accountId: account.id, error: error.message });
      }
    }
    
    return results;
  }

  // Helper method to open a mailbox
  private openMailbox(accountId: string, mailbox: string): Promise<any> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      return Promise.reject(new Error(`No connection for account ${accountId}`));
    }

    return new Promise((resolve, reject) => {
      connection.instance.openBox(mailbox, false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(box);
      });
    });
  }

  // Helper method to search a mailbox
  private searchMailbox(accountId: string, query: any[]): Promise<number[]> {
    const connection = this.connections.get(accountId);
    if (!connection || !connection.connected) {
      return Promise.reject(new Error(`No connection for account ${accountId}`));
    }

    return new Promise((resolve, reject) => {
      connection.instance.search(query, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results);
      });
    });
  }

  // Get all accounts
  async getAccounts(): Promise<any[]> {
    return this.accounts.map(account => ({
      ...account,
      connected: this.connections.get(account.id)?.connected || false,
      lastSync: this.connections.get(account.id)?.lastSyncDate
    }));
  }
}
