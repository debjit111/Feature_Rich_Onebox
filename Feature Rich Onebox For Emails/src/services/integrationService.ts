import axios from 'axios';
import { config } from '../config/config';
import { Email } from '../models/email';
import { logger } from '../utils/logger';

// Interface for webhook config
interface Webhook {
  id: string;
  url: string;
  events: string[];
  name: string;
  active: boolean;
}

// Interface for notification
interface SlackNotification {
  title: string;
  text: string;
  color?: string;
  email: Email;
}

export class IntegrationService {
  private webhooks: Webhook[] = [];
  private slackWebhookUrl: string;

  constructor() {
    this.slackWebhookUrl = config.slack.webhookUrl;
    
    // Load any existing webhooks from configuration
    // In a production environment, these would come from a database
    const webhookUrl = config.webhook.url;
    if (webhookUrl) {
      this.webhooks.push({
        id: 'default',
        url: webhookUrl,
        events: ['interested_email', 'new_email'],
        name: 'Default Webhook',
        active: true
      });
    }
    
    logger.info(`Integration service initialized with ${this.webhooks.length} webhooks`);
  }

  // Send notification to Slack
  async sendSlackNotification(notification: SlackNotification): Promise<boolean> {
    if (!this.slackWebhookUrl) {
      logger.warn('Slack webhook URL not configured. Cannot send notification.');
      return false;
    }

    try {
      const { title, text, color = 'good', email } = notification;
      
      const payload = {
        attachments: [
          {
            color: color,
            title: title,
            title_link: `mailto:${email.from}?subject=Re: ${email.subject}`,
            text: text,
            fields: [
              {
                title: 'From',
                value: email.from,
                short: true
              },
              {
                title: 'Account',
                value: email.accountId,
                short: true
              },
              {
                title: 'Category',
                value: email.category || 'Uncategorized',
                short: true
              },
              {
                title: 'Received',
                value: email.receivedDate ? new Date(email.receivedDate).toLocaleString() : 'Unknown',
                short: true
              }
            ],
            footer: 'Email Aggregator',
            ts: Math.floor(Date.now() / 1000)
          }
        ]
      };
      
      const response = await axios.post(this.slackWebhookUrl, payload);
      
      if (response.status === 200) {
        logger.info(`Sent Slack notification for email "${email.subject}"`);
        return true;
      } else {
        logger.error(`Error sending Slack notification: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      logger.error('Error sending Slack notification:', error);
      return false;
    }
  }

  // Register a new webhook
  async registerWebhook(webhook: Omit<Webhook, 'id'>): Promise<Webhook> {
    const id = Date.now().toString();
    
    const newWebhook: Webhook = {
      id,
      ...webhook
    };
    
    this.webhooks.push(newWebhook);
    logger.info(`Registered new webhook "${webhook.name}" for events: ${webhook.events.join(', ')}`);
    
    return newWebhook;
  }

  // Trigger webhooks for an event
  async triggerWebhooks(event: string, data: any): Promise<any[]> {
    const results = [];
    
    // Find all active webhooks for this event
    const matchingWebhooks = this.webhooks.filter(webhook => 
      webhook.active && webhook.events.includes(event)
    );
    
    if (matchingWebhooks.length === 0) {
      return [];
    }
    
    logger.info(`Triggering ${matchingWebhooks.length} webhooks for event "${event}"`);
    
    // Call each webhook
    for (const webhook of matchingWebhooks) {
      try {
        const payload = {
          event,
          timestamp: new Date().toISOString(),
          data
        };
        
        const response = await axios.post(webhook.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Name': event
          },
          timeout: 5000 // 5 second timeout
        });
        
        results.push({
          webhookId: webhook.id,
          success: true,
          statusCode: response.status
        });
        
        logger.info(`Successfully triggered webhook "${webhook.name}" for event "${event}"`);
      } catch (error) {
        logger.error(`Error triggering webhook "${webhook.name}" for event "${event}":`, error);
        
        results.push({
          webhookId: webhook.id,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  // Test a webhook
  async testWebhook(webhookId: string, event: string): Promise<any> {
    // Find webhook
    const webhook = this.webhooks.find(wh => wh.id === webhookId);
    
    if (!webhook) {
      return { success: false, error: 'Webhook not found' };
    }
    
    // Test payload
    const testPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: `Test payload for event "${event}"`,
        webhookName: webhook.name
      }
    };
    
    try {
      const response = await axios.post(webhook.url, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Name': event,
          'X-Test': 'true'
        },
        timeout: 5000
      });
      
      logger.info(`Successfully tested webhook "${webhook.name}" for event "${event}"`);
      
      return {
        success: true,
        data: {
          webhook,
          statusCode: response.status,
          response: response.data
        }
      };
    } catch (error) {
      logger.error(`Error testing webhook "${webhook.name}" for event "${event}":`, error);
      
      return {
        success: false,
        error: error.message,
        data: {
          webhook
        }
      };
    }
  }
}
