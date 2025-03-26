import { Request, Response, NextFunction } from 'express';
import { IntegrationService } from '../../services/integrationService';
import { logger } from '../../utils/logger';

export class WebhookController {
  constructor(
    private integrationService: IntegrationService
  ) {}

  // Register a new webhook
  registerWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url, events, name } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: 'Webhook URL is required' });
      }
      
      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'At least one event is required' });
      }
      
      // Validate events
      const validEvents = ['new_email', 'interested_email', 'spam_detected'];
      const invalidEvents = events.filter(event => !validEvents.includes(event));
      
      if (invalidEvents.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid events detected', 
          invalidEvents,
          validEvents
        });
      }
      
      const webhook = await this.integrationService.registerWebhook({
        url,
        events,
        name: name || 'Webhook',
        active: true
      });
      
      res.status(201).json(webhook);
    } catch (error) {
      logger.error('Error registering webhook:', error);
      next(error);
    }
  };

  // Test a webhook
  testWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { webhookId, event } = req.body;
      
      if (!webhookId) {
        return res.status(400).json({ error: 'Webhook ID is required' });
      }
      
      const validEvents = ['new_email', 'interested_email', 'spam_detected'];
      
      if (!event || !validEvents.includes(event)) {
        return res.status(400).json({ 
          error: 'Valid event is required', 
          validEvents 
        });
      }
      
      const result = await this.integrationService.testWebhook(webhookId, event);
      
      if (!result.success) {
        return res.status(404).json({ error: result.error });
      }
      
      res.json({ success: true, result: result.data });
    } catch (error) {
      logger.error('Error testing webhook:', error);
      next(error);
    }
  };
}
