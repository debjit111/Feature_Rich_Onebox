import json
import logging
import os
import numpy as np
from openai import OpenAI
from models import VectorEntry, Email
from app import db

logger = logging.getLogger(__name__)

class AiService:
    """Service for AI-powered email categorization, RAG, and reply suggestions"""
    
    def __init__(self):
        self.client = None
        self.api_key = os.environ.get('OPENAI_API_KEY')
        self.model = os.environ.get('OPENAI_MODEL', 'gpt-3.5-turbo')
        self.embedding_model = os.environ.get('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small')
        self.initialized = False
        
    def initialize(self):
        """Initialize OpenAI client"""
        if self.initialized:
            return True
            
        try:
            if not self.api_key:
                logger.warning("OpenAI API key not found in environment")
                return False
                
            self.client = OpenAI(api_key=self.api_key)
            self.initialized = True
            logger.info("OpenAI client initialized")
            return True
        except Exception as e:
            logger.error(f"OpenAI initialization error: {str(e)}")
            return False
    
    def categorize_email(self, email):
        """Categorize an email using OpenAI
        
        Categories:
        - interested: Shows genuine interest in the product/service
        - not_interested: Clearly not interested
        - meeting_booked: Has booked or wants to book a meeting
        - spam: Unsolicited or irrelevant
        - out_of_office: Automated out of office reply
        """
        if not self.initialized:
            self.initialize()
            
        if not self.initialized:
            logger.error("Cannot categorize email: OpenAI not initialized")
            return "uncategorized"
            
        try:
            # Prepare email content for analysis
            email_content = f"""
            Subject: {email.subject}
            From: {email.sender}
            
            {email.body_text or ''}
            """
            
            # Create prompt for categorization
            prompt = f"""
            Categorize the following email into exactly one of these categories:
            - interested: Shows genuine interest in the product/service
            - not_interested: Clearly not interested
            - meeting_booked: Has booked or wants to book a meeting
            - spam: Unsolicited or irrelevant
            - out_of_office: Automated out of office reply
            
            Email:
            {email_content}
            
            Category (return only the category name):
            """
            
            # Call OpenAI API
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are an email categorization assistant. Categorize the email into exactly one category."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,  # Use deterministic output
                max_tokens=20     # We only need a short response
            )
            
            # Extract category from response
            category = response.choices[0].message.content.strip().lower()
            
            # Validate category
            valid_categories = ['interested', 'not_interested', 'meeting_booked', 'spam', 'out_of_office']
            if category not in valid_categories:
                logger.warning(f"Invalid category returned: {category}")
                # Default to uncategorized if the AI returns an invalid category
                return "uncategorized"
                
            logger.info(f"Categorized email {email.id} as '{category}'")
            return category
            
        except Exception as e:
            logger.error(f"Error categorizing email: {str(e)}")
            return "uncategorized"
    
    def generate_reply_suggestion(self, email):
        """Generate an AI-powered reply suggestion for an email"""
        if not self.initialized:
            self.initialize()
            
        if not self.initialized:
            logger.error("Cannot generate reply: OpenAI not initialized")
            return "Unable to generate reply suggestion. OpenAI API not available."
            
        try:
            # Get email context
            email_content = f"""
            Subject: {email.subject}
            From: {email.sender}
            
            {email.body_text or ''}
            """
            
            # Get relevant context from vector store if available
            context_texts = self._find_similar_texts(email.body_text or '', limit=3)
            context = "\n\n".join(context_texts) if context_texts else ""
            
            # Create prompt for reply generation
            prompt = f"""
            Here is an email I've received:
            
            {email_content}
            
            """
            
            if context:
                prompt += f"""
                Here is some additional context that might be relevant:
                
                {context}
                
                """
                
            prompt += """
            Please draft a professional, helpful, and concise reply to this email.
            """
            
            # Call OpenAI API
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are an email assistant. Draft professional, helpful, and concise replies."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,  # Some creativity
                max_tokens=500    # Reasonably sized email
            )
            
            # Extract reply from response
            reply = response.choices[0].message.content.strip()
            
            return reply
            
        except Exception as e:
            logger.error(f"Error generating reply: {str(e)}")
            return "Unable to generate reply suggestion. Error occurred."
    
    def store_text_for_rag(self, text, description=None):
        """Store text in vector database for RAG"""
        if not self.initialized:
            self.initialize()
            
        if not self.initialized:
            logger.error("Cannot store text: OpenAI not initialized")
            return False
            
        try:
            # Generate embedding for text
            embedding = self._get_embedding(text)
            
            if not embedding:
                return False
                
            # Store in database
            vector_entry = VectorEntry(
                text=text,
                embedding=json.dumps(embedding),
                description=description
            )
            
            db.session.add(vector_entry)
            db.session.commit()
            
            logger.info(f"Stored text in vector database: {description or 'Unknown'}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing text: {str(e)}")
            db.session.rollback()
            return False
    
    def _get_embedding(self, text):
        """Get embedding vector for text"""
        try:
            response = self.client.embeddings.create(
                model=self.embedding_model,
                input=text
            )
            
            return response.data[0].embedding
            
        except Exception as e:
            logger.error(f"Error getting embedding: {str(e)}")
            return None
    
    def _find_similar_texts(self, query, limit=3):
        """Find similar texts in vector database"""
        if not self.initialized:
            self.initialize()
            
        if not self.initialized:
            return []
            
        try:
            # Get embedding for query
            query_embedding = self._get_embedding(query)
            
            if not query_embedding:
                return []
                
            # Get all vectors from database
            vector_entries = VectorEntry.query.all()
            
            if not vector_entries:
                return []
                
            # Calculate similarity
            results = []
            for entry in vector_entries:
                # Parse stored embedding
                entry_embedding = json.loads(entry.embedding)
                
                # Calculate cosine similarity
                similarity = self._cosine_similarity(query_embedding, entry_embedding)
                
                results.append((entry, similarity))
                
            # Sort by similarity (highest first)
            results.sort(key=lambda x: x[1], reverse=True)
            
            # Return most similar texts
            return [entry.text for entry, _ in results[:limit]]
            
        except Exception as e:
            logger.error(f"Error finding similar texts: {str(e)}")
            return []
    
    def _cosine_similarity(self, vec1, vec2):
        """Calculate cosine similarity between two vectors"""
        try:
            vec1 = np.array(vec1)
            vec2 = np.array(vec2)
            
            dot_product = np.dot(vec1, vec2)
            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)
            
            return dot_product / (norm1 * norm2)
            
        except Exception as e:
            logger.error(f"Error calculating similarity: {str(e)}")
            return 0.0