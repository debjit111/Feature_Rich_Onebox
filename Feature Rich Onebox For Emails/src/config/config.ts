import dotenv from 'dotenv';

dotenv.config();

// Define email account interface
export interface EmailAccount {
  id: string;
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  name: string;
}

// Configuration object
export const config = {
  host: '0.0.0.0',
  port: 8000,
  
  // Elasticsearch configuration
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    auth: {
      username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
      password: process.env.ELASTICSEARCH_PASSWORD || 'changeme'
    },
    indexName: 'emails'
  },
  
  // OpenAI configuration 
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4' // or gpt-3.5-turbo depending on needs
  },
  
  // Slack webhook for notifications
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || ''
  },
  
  // Custom webhook for automation
  webhook: {
    url: process.env.WEBHOOK_URL || ''
  },
  
  // Email accounts - get from environment variables or use defaults
  // In production, you would load these from a secure source
  emailAccounts: (): EmailAccount[] => {
    // Load accounts from environment variables or secrets management
    const accounts: EmailAccount[] = [];
    
    // Try to load from environment variables
    try {
      const accountsJson = process.env.EMAIL_ACCOUNTS;
      if (accountsJson) {
        const parsedAccounts = JSON.parse(accountsJson);
        if (Array.isArray(parsedAccounts)) {
          parsedAccounts.forEach(account => {
            if (account.id && account.user && account.password && account.host) {
              accounts.push({
                id: account.id,
                user: account.user,
                password: account.password,
                host: account.host,
                port: account.port || 993,
                tls: account.tls !== false,
                name: account.name || account.user
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Error parsing email accounts from environment:', error);
    }
    
    // If no accounts were loaded from environment variables, add example placeholder
    // This is just for documentation - it won't work without real credentials
    if (accounts.length === 0) {
      console.warn('No email accounts configured. Please set EMAIL_ACCOUNTS environment variable.');
      
      // Add example accounts that will be replaced in production
      if (process.env.NODE_ENV === 'development') {
        accounts.push({
          id: 'gmail1',
          user: process.env.GMAIL_USER || 'youremail@gmail.com',
          password: process.env.GMAIL_PASSWORD || 'app_password_here',
          host: 'imap.gmail.com',
          port: 993,
          tls: true,
          name: 'Work Gmail'
        });
        
        accounts.push({
          id: 'outlook1',
          user: process.env.OUTLOOK_USER || 'youremail@outlook.com',
          password: process.env.OUTLOOK_PASSWORD || 'app_password_here',
          host: 'outlook.office365.com',
          port: 993,
          tls: true,
          name: 'Personal Outlook'
        });
      }
    }
    
    return accounts;
  }
};
