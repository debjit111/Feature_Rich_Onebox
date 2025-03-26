import json
import logging
import os
from elasticsearch import Elasticsearch
from models import Email

logger = logging.getLogger(__name__)

class ElasticsearchService:
    """Service for handling Elasticsearch operations for email search and indexing"""
    
    def __init__(self):
        self.client = None
        self.index_name = 'emails'
        self.initialized = False
        
    def initialize(self):
        """Initialize Elasticsearch connection"""
        try:
            # Get Elasticsearch URL from environment or use default
            es_url = os.environ.get('ELASTICSEARCH_URL', 'http://localhost:9200')
            
            # Create Elasticsearch client
            self.client = Elasticsearch(es_url)
            
            # Check if connection is successful
            if self.client.ping():
                logger.info("Connected to Elasticsearch")
                
                # Create index if it doesn't exist
                self._create_index()
                self.initialized = True
                return True
            else:
                logger.error("Failed to connect to Elasticsearch")
                return False
        except Exception as e:
            logger.error(f"Elasticsearch initialization error: {str(e)}")
            return False
    
    def _create_index(self):
        """Create index with mappings if it doesn't exist"""
        if not self.client.indices.exists(index=self.index_name):
            mapping = {
                "mappings": {
                    "properties": {
                        "subject": {"type": "text"},
                        "body_text": {"type": "text"},
                        "sender": {"type": "text"},
                        "recipients": {"type": "text"},
                        "date": {"type": "date"},
                        "category": {"type": "keyword"},
                        "account_id": {"type": "keyword"},
                        "folder": {"type": "keyword"}
                    }
                }
            }
            
            self.client.indices.create(index=self.index_name, body=mapping)
            logger.info(f"Created Elasticsearch index '{self.index_name}'")
    
    def index_email(self, email):
        """Index an email in Elasticsearch"""
        if not self.initialized:
            self.initialize()
        
        if not self.initialized:
            logger.error("Cannot index email: Elasticsearch not initialized")
            return False
        
        try:
            doc = {
                'id': email.id,
                'account_id': email.account_id,
                'subject': email.subject,
                'body_text': email.body_text,
                'sender': email.sender,
                'recipients': email.recipients,
                'folder': email.folder,
                'date': email.date.isoformat() if email.date else None,
                'category': email.category
            }
            
            self.client.index(index=self.index_name, id=str(email.id), document=doc)
            logger.debug(f"Indexed email {email.id} in Elasticsearch")
            return True
        except Exception as e:
            logger.error(f"Error indexing email {email.id}: {str(e)}")
            return False
    
    def search_emails(self, options):
        """Search emails in Elasticsearch"""
        if not self.initialized:
            self.initialize()
        
        if not self.initialized:
            logger.error("Cannot search emails: Elasticsearch not initialized")
            return []
        
        try:
            query_string = options.get('query', '')
            filters = options.get('filters', {})
            
            # Build query
            query = {
                "bool": {
                    "must": []
                }
            }
            
            # Add text search if provided
            if query_string:
                query["bool"]["must"].append({
                    "multi_match": {
                        "query": query_string,
                        "fields": ["subject^2", "body_text", "sender", "recipients"]
                    }
                })
            
            # Add filters
            for field, value in filters.items():
                if value:
                    query["bool"]["must"].append({
                        "term": {field: value}
                    })
            
            # Execute search
            search_body = {
                "query": query,
                "sort": [{"date": {"order": "desc"}}],
                "size": 100
            }
            
            response = self.client.search(index=self.index_name, body=search_body)
            
            # Process results
            results = []
            for hit in response["hits"]["hits"]:
                results.append({
                    "id": hit["_source"]["id"],
                    "score": hit["_score"],
                    "subject": hit["_source"].get("subject", ""),
                    "sender": hit["_source"].get("sender", ""),
                    "date": hit["_source"].get("date")
                })
            
            return results
        except Exception as e:
            logger.error(f"Search error: {str(e)}")
            # If Elasticsearch fails, fall back to database query
            logger.info("Falling back to database query")
            return self._fallback_search(options)
    
    def _fallback_search(self, options):
        """Fall back to database query if Elasticsearch fails"""
        from app import db
        
        query_string = options.get('query', '')
        filters = options.get('filters', {})
        
        # Create base query
        query = db.session.query(Email)
        
        # Apply filters
        for field, value in filters.items():
            if value and hasattr(Email, field):
                query = query.filter(getattr(Email, field) == value)
        
        # Apply text search (simple LIKE query - not as effective as Elasticsearch)
        if query_string:
            search_term = f"%{query_string}%"
            query = query.filter(
                db.or_(
                    Email.subject.ilike(search_term),
                    Email.body_text.ilike(search_term),
                    Email.sender.ilike(search_term)
                )
            )
        
        # Get results
        emails = query.order_by(Email.date.desc()).limit(100).all()
        
        # Format results
        results = []
        for email in emails:
            results.append({
                "id": email.id,
                "score": 1.0,  # No real score in SQL query
                "subject": email.subject,
                "sender": email.sender,
                "date": email.date.isoformat() if email.date else None
            })
        
        return results
    
    def close(self):
        """Close Elasticsearch connection"""
        if self.client:
            logger.info("Closing Elasticsearch connection")
            self.client.close()