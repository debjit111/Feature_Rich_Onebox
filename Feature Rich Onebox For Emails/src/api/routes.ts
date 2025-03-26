import { Express } from 'express';
import { EmailController } from './controllers/emailController';
import { WebhookController } from './controllers/webhookController';
import { ImapService } from '../services/imapService';
import { ElasticsearchService } from '../services/elasticsearchService';
import { AiService } from '../services/aiService';
import { IntegrationService } from '../services/integrationService';

export function setupRoutes(
  app: Express,
  imapService: ImapService,
  elasticsearchService: ElasticsearchService,
  aiService: AiService,
  integrationService: IntegrationService
) {
  // Initialize controllers
  const emailController = new EmailController(
    imapService,
    elasticsearchService,
    aiService
  );
  
  const webhookController = new WebhookController(
    integrationService
  );
  
  // Email routes
  app.get('/api/emails', emailController.getEmails);
  app.get('/api/emails/search', emailController.searchEmails);
  app.get('/api/emails/:id', emailController.getEmailById);
  app.get('/api/emails/category/:category', emailController.getEmailsByCategory);
  app.get('/api/emails/account/:accountId', emailController.getEmailsByAccount);
  app.get('/api/emails/folder/:folder', emailController.getEmailsByFolder);
  app.post('/api/emails/:id/suggest-reply', emailController.suggestReply);
  app.post('/api/emails/:id/categorize', emailController.categorizeEmail);
  
  // Account routes
  app.get('/api/accounts', emailController.getAccounts);
  app.get('/api/accounts/:id/folders', emailController.getFolders);
  app.post('/api/accounts/sync', emailController.syncEmails);
  
  // Webhook routes
  app.post('/api/webhooks/register', webhookController.registerWebhook);
  app.post('/api/webhooks/test', webhookController.testWebhook);
  
  // Health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
}
