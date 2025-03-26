# Initialize service instances
import logging

logger = logging.getLogger(__name__)

try:
    from services.elasticsearch_service import ElasticsearchService
    elasticsearch_service = ElasticsearchService()
except ImportError as e:
    logger.warning(f"ElasticsearchService could not be imported: {e}")
    # Create a simple mock service as fallback
    class ElasticsearchServiceMock:
        def initialize(self): return False
        def index_email(self, email): return False
        def search_emails(self, options): return []
    elasticsearch_service = ElasticsearchServiceMock()

try:
    from services.ai_service import AiService
    ai_service = AiService()
except ImportError as e:
    logger.warning(f"AiService could not be imported: {e}")
    # Create a simple mock service as fallback
    class AiServiceMock:
        def initialize(self): return False
        def categorize_email(self, email): return "uncategorized"
        def generate_reply_suggestion(self, email): return "Unable to generate reply. AI service not available."
    ai_service = AiServiceMock()

try:
    from services.integration_service import IntegrationService
    integration_service = IntegrationService()
except ImportError as e:
    logger.warning(f"IntegrationService could not be imported: {e}")
    # Create a simple mock service as fallback
    class IntegrationServiceMock:
        def trigger_webhooks(self, event, data): return []
        def test_webhook(self, webhook): return {"success": False, "error": "Integration service not available"}
    integration_service = IntegrationServiceMock()

try:
    from services.imap_service import ImapService
    imap_service = ImapService(elasticsearch_service, ai_service, integration_service)
except ImportError as e:
    logger.warning(f"ImapService could not be imported: {e}")
    # Create a simple mock service as fallback
    class ImapServiceMock:
        def __init__(self, es_service, ai_service, integration_service):
            self.elasticsearch_service = es_service
            self.ai_service = ai_service
            self.integration_service = integration_service
            
        def test_connection(self, account): return False
        def sync_account(self, account, days=30, force=False): 
            return {"success": False, "message": "IMAP service not available"}
        def sync_all_accounts(self, days=30, force=False): return []
        def get_folders(self, account_id): return []
    imap_service = ImapServiceMock(elasticsearch_service, ai_service, integration_service)