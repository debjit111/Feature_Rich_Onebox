import { Configuration, OpenAIApi } from 'openai';
import { config } from '../config/config';
import { Email } from '../models/email';
import { logger } from '../utils/logger';

// Simple in-memory vector store for RAG
interface VectorEntry {
  text: string;
  embedding: number[];
}

export class AiService {
  private openai: OpenAIApi;
  private apiKey: string;
  private vectorStore: VectorEntry[] = [];
  private model: string;
  private initialized: boolean = false;

  constructor() {
    this.apiKey = config.openai.apiKey;
    this.model = config.openai.model;
    
    if (this.apiKey) {
      const configuration = new Configuration({
        apiKey: this.apiKey
      });
      
      this.openai = new OpenAIApi(configuration);
      this.initialized = true;
      logger.info('AI service initialized with OpenAI');
    } else {
      logger.warn('OpenAI API key not provided. AI services will not work.');
    }
  }

  // Categorize an email
  async categorizeEmail(email: Email): Promise<string> {
    if (!this.initialized) {
      logger.warn('AI service not initialized. Returning default category.');
      return 'not_interested';
    }

    try {
      // Extract relevant information from email
      const { subject, from, text } = email;
      const truncatedText = text?.substring(0, 2000) || ''; // Limit text length for token limits
      
      const prompt = `
        Please categorize the following email into one of these categories:
        - interested (the sender shows clear interest in our product/service)
        - not_interested (neutral or negative response)
        - meeting_booked (email contains meeting confirmation)
        - spam (unsolicited email)
        - out_of_office (automatic out of office reply)
        
        Email:
        From: ${from}
        Subject: ${subject}
        
        Body:
        ${truncatedText}
        
        Category:
      `;
      
      const response = await this.openai.createChatCompletion({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are an email categorization assistant. Categorize the email accurately based on its content.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3, // Lower temperature for more deterministic results
        max_tokens: 50 // We just need a single category
      });
      
      const category = response.data.choices[0]?.message?.content?.trim().toLowerCase() || 'not_interested';
      
      // Normalize category
      const categories = ['interested', 'not_interested', 'meeting_booked', 'spam', 'out_of_office'];
      const normalizedCategory = categories.find(c => category.includes(c)) || 'not_interested';
      
      logger.info(`Categorized email "${email.subject}" as "${normalizedCategory}"`);
      return normalizedCategory;
    } catch (error) {
      logger.error(`Error categorizing email ${email.id}:`, error);
      return 'not_interested'; // Default category on error
    }
  }

  // Store text with embeddings for RAG
  async storeTextForRAG(text: string, description: string = ''): Promise<boolean> {
    if (!this.initialized) {
      logger.warn('AI service not initialized. Cannot store text for RAG.');
      return false;
    }

    try {
      const response = await this.openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: text
      });
      
      const embedding = response.data.data[0].embedding;
      
      this.vectorStore.push({
        text: text,
        embedding
      });
      
      logger.info(`Stored text for RAG: ${description || text.substring(0, 50)}...`);
      return true;
    } catch (error) {
      logger.error('Error storing text for RAG:', error);
      return false;
    }
  }

  // Find similar texts from vector store
  private async findSimilarTexts(query: string, limit: number = 3): Promise<string[]> {
    if (!this.initialized || this.vectorStore.length === 0) {
      return [];
    }

    try {
      // Get query embedding
      const response = await this.openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: query
      });
      
      const queryEmbedding = response.data.data[0].embedding;
      
      // Calculate cosine similarity with all stored embeddings
      const similarities = this.vectorStore.map(entry => {
        const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
        return { text: entry.text, similarity };
      });
      
      // Sort by similarity (descending) and take top results
      similarities.sort((a, b) => b.similarity - a.similarity);
      const topResults = similarities.slice(0, limit);
      
      return topResults.map(result => result.text);
    } catch (error) {
      logger.error('Error finding similar texts:', error);
      return [];
    }
  }

  // Helper for cosine similarity calculation
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Generate reply suggestion using RAG
  async generateReplySuggestion(email: Email, context: any = {}): Promise<string> {
    if (!this.initialized) {
      logger.warn('AI service not initialized. Cannot generate reply suggestion.');
      return 'AI service not available. Please compose your own reply.';
    }

    try {
      // Extract email information
      const { subject, from, text } = email;
      const truncatedText = text?.substring(0, 1000) || '';
      
      // Find relevant context from vector store
      const query = `${subject} ${truncatedText.substring(0, 200)}`;
      const similarTexts = await this.findSimilarTexts(query);
      
      const contextText = similarTexts.length > 0 
        ? `Relevant context:\n${similarTexts.join('\n\n')}`
        : 'No specific context available.';
      
      // Additional context from params
      const additionalContext = context.description || '';
      
      const prompt = `
        Please suggest a professional and helpful reply to the following email:
        
        From: ${from}
        Subject: ${subject}
        
        Email content:
        ${truncatedText}
        
        ${contextText}
        
        ${additionalContext ? `Additional context: ${additionalContext}` : ''}
        
        Reply:
      `;
      
      const response = await this.openai.createChatCompletion({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are an email assistant. Generate a professional, concise, and helpful email reply.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      const suggestion = response.data.choices[0]?.message?.content?.trim() || 'Unable to generate a reply.';
      
      logger.info(`Generated reply suggestion for email "${subject}"`);
      return suggestion;
    } catch (error) {
      logger.error(`Error generating reply suggestion for email ${email.id}:`, error);
      return 'Error generating reply. Please compose your own reply.';
    }
  }
}
