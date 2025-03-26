import { Request, Response, NextFunction } from 'express';
import { ImapService } from '../../services/imapService';
import { ElasticsearchService } from '../../services/elasticsearchService';
import { AiService } from '../../services/aiService';
import { logger } from '../../utils/logger';

export class EmailController {
  constructor(
    private imapService: ImapService,
    private elasticsearchService: ElasticsearchService,
    private aiService: AiService
  ) {}

  // Get emails with pagination and filtering
  getEmails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const sortBy = (req.query.sortBy as string) || 'date';
      const sortOrder = (req.query.sortOrder as string) || 'desc';
      const from = req.query.from as string;
      const to = req.query.to as string;
      const subject = req.query.subject as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      const result = await this.elasticsearchService.searchEmails({
        page,
        limit,
        sortBy,
        sortOrder,
        filters: {
          from,
          to,
          subject,
          startDate,
          endDate
        }
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Search emails with Elasticsearch
  searchEmails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      const result = await this.elasticsearchService.searchEmails({
        query,
        page,
        limit
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Get a specific email by ID
  getEmailById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      const email = await this.elasticsearchService.getEmailById(id);
      
      if (!email) {
        return res.status(404).json({ error: 'Email not found' });
      }
      
      res.json(email);
    } catch (error) {
      next(error);
    }
  };

  // Get emails by category
  getEmailsByCategory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { category } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const validCategories = ['interested', 'not_interested', 'meeting_booked', 'spam', 'out_of_office'];
      
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      
      const result = await this.elasticsearchService.searchEmails({
        page,
        limit,
        filters: {
          category
        }
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Get emails by account
  getEmailsByAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { accountId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const result = await this.elasticsearchService.searchEmails({
        page,
        limit,
        filters: {
          accountId
        }
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Get emails by folder
  getEmailsByFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { folder } = req.params;
      const accountId = req.query.accountId as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      
      if (!accountId) {
        return res.status(400).json({ error: 'accountId query parameter is required' });
      }
      
      const result = await this.elasticsearchService.searchEmails({
        page,
        limit,
        filters: {
          accountId,
          folder
        }
      });
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  // Get AI reply suggestion for an email
  suggestReply = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { context } = req.body; // Optional additional context
      
      const email = await this.elasticsearchService.getEmailById(id);
      
      if (!email) {
        return res.status(404).json({ error: 'Email not found' });
      }
      
      const suggestion = await this.aiService.generateReplySuggestion(email, context);
      
      res.json({ suggestion });
    } catch (error) {
      next(error);
    }
  };

  // Manually categorize an email (or re-categorize)
  categorizeEmail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { category } = req.body;
      
      const validCategories = ['interested', 'not_interested', 'meeting_booked', 'spam', 'out_of_office'];
      
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      
      const email = await this.elasticsearchService.getEmailById(id);
      
      if (!email) {
        return res.status(404).json({ error: 'Email not found' });
      }
      
      // Update category in Elasticsearch
      await this.elasticsearchService.updateEmailCategory(id, category);
      
      res.json({ success: true, id, category });
    } catch (error) {
      next(error);
    }
  };

  // Get all accounts
  getAccounts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accounts = await this.imapService.getAccounts();
      
      // Return sanitized accounts (without passwords)
      const sanitizedAccounts = accounts.map(account => ({
        id: account.id,
        name: account.name,
        user: account.user,
        host: account.host,
        connected: account.connected || false
      }));
      
      res.json(sanitizedAccounts);
    } catch (error) {
      next(error);
    }
  };

  // Get folders for an account
  getFolders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      const folders = await this.imapService.getFolders(id);
      
      if (!folders) {
        return res.status(404).json({ error: 'Account not found or not connected' });
      }
      
      res.json(folders);
    } catch (error) {
      next(error);
    }
  };

  // Manually trigger email synchronization
  syncEmails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { accountId, force } = req.body;
      
      // If accountId is specified, sync only that account
      if (accountId) {
        const result = await this.imapService.syncAccount(accountId, !!force);
        return res.json({ success: true, accountId, result });
      }
      
      // Otherwise sync all accounts
      const results = await this.imapService.syncAllAccounts(!!force);
      res.json({ success: true, results });
    } catch (error) {
      logger.error('Error syncing emails:', error);
      next(error);
    }
  };
}
