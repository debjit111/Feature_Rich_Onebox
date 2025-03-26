import express from 'express';
import { config } from './config/config';
import { setupRoutes } from './api/routes';
import { ElasticsearchService } from './services/elasticsearchService';
import { ImapService } from './services/imapService';
import { AiService } from './services/aiService';
import { IntegrationService } from './services/integrationService';
import { logger } from './utils/logger';
import { errorHandler } from './utils/errorHandler';

async function startServer() {
  try {
    // Initialize services
    const elasticsearchService = new ElasticsearchService();
    await elasticsearchService.initialize();
    logger.info('Elasticsearch service initialized');

    const aiService = new AiService();
    logger.info('AI service initialized');

    const integrationService = new IntegrationService();
    logger.info('Integration service initialized');

    const imapService = new ImapService(
      elasticsearchService,
      aiService,
      integrationService
    );
    await imapService.initialize();
    logger.info('IMAP service initialized');

    // Create Express app
    const app = express();
    app.use(express.json());

    // Setup routes
    setupRoutes(app, imapService, elasticsearchService, aiService, integrationService);

    // Error handling middleware
    app.use(errorHandler);

    // Start server
    app.listen(config.port, config.host, () => {
      logger.info(`Server running at http://${config.host}:${config.port}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      await imapService.disconnect();
      await elasticsearchService.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
