import logging
import email
import email.header
import email.utils
import re
import time
from datetime import datetime, timedelta
from email.header import decode_header
from imap_tools import MailBox, A, MailMessageFlags, MailMessage
from models import EmailAccount, Email, Attachment
from app import db

logger = logging.getLogger(__name__)

class ImapService:
    """Service for handling IMAP connections and email synchronization"""
    
    def __init__(self, elasticsearch_service, ai_service, integration_service):
        self.elasticsearch_service = elasticsearch_service
        self.ai_service = ai_service
        self.integration_service = integration_service
        self.active_connections = {}  # Store active connections
        self.sync_in_progress = set()  # Track accounts currently syncing
        
    def test_connection(self, account):
        """Test connection to an email account"""
        try:
            mailbox = MailBox(account.host)
            mailbox.login(account.email, account.password, initial_folder='INBOX')
            mailbox.logout()
            return True
        except Exception as e:
            logger.error(f"Connection test failed for {account.email}: {str(e)}")
            return False
    
    def sync_account(self, account, days=30, force=False):
        """Sync emails for an account from the past X days"""
        if account.id in self.sync_in_progress:
            logger.info(f"Sync already in progress for account {account.id}")
            return {"success": False, "message": "Sync already in progress"}
        
        self.sync_in_progress.add(account.id)
        
        try:
            # Determine last sync date
            sync_from_date = None
            if account.last_sync and not force:
                sync_from_date = account.last_sync
            else:
                sync_from_date = datetime.utcnow() - timedelta(days=days)
            
            logger.info(f"Syncing account {account.email} from {sync_from_date}")
            
            # Connect to mailbox
            with MailBox(account.host).login(account.email, account.password) as mailbox:
                # Get list of folders
                folders = mailbox.folder.list()
                folder_names = [f.name for f in folders]
                
                new_emails = 0
                updated_emails = 0
                error_count = 0
                
                # Process main folders
                for folder_name in folder_names:
                    # Skip certain system folders
                    if any(x in folder_name.lower() for x in ['junk', 'trash', 'deleted']):
                        continue
                    
                    try:
                        # Select folder
                        mailbox.folder.set(folder_name)
                        
                        # Search for emails
                        query = A()
                        if sync_from_date:
                            query = query.date_gte(sync_from_date.date())
                        
                        logger.info(f"Searching folder {folder_name}")
                        messages = mailbox.fetch(query, limit=None)
                        
                        # Process emails
                        for msg in messages:
                            try:
                                result = self._process_email(account, msg, folder_name)
                                if result == "new":
                                    new_emails += 1
                                elif result == "updated":
                                    updated_emails += 1
                            except Exception as e:
                                logger.error(f"Error processing email in {folder_name}: {str(e)}")
                                error_count += 1
                                
                    except Exception as e:
                        logger.error(f"Error processing folder {folder_name}: {str(e)}")
            
            # Update last sync time
            account.last_sync = datetime.utcnow()
            db.session.commit()
            
            logger.info(f"Sync completed for {account.email}: {new_emails} new, {updated_emails} updated, {error_count} errors")
            
            # Return results
            return {
                "success": True,
                "account_id": account.id,
                "new_emails": new_emails,
                "updated_emails": updated_emails,
                "errors": error_count
            }
            
        except Exception as e:
            logger.error(f"Sync error for account {account.email}: {str(e)}")
            return {"success": False, "message": str(e)}
            
        finally:
            self.sync_in_progress.remove(account.id)
    
    def _process_email(self, account, msg, folder_name):
        """Process a single email message"""
        # Check if email already exists (by message ID)
        existing_email = Email.query.filter_by(
            account_id=account.id,
            message_id=msg.uid
        ).first()
        
        if existing_email:
            # Update existing email if needed
            if existing_email.folder != folder_name:
                existing_email.folder = folder_name
                db.session.commit()
                return "updated"
            return "existing"
        
        # Create new email record
        try:
            # Parse email date
            msg_date = None
            if msg.date:
                msg_date = msg.date
            
            # Create email object
            email_obj = Email(
                account_id=account.id,
                message_id=msg.uid,
                folder=folder_name,
                subject=msg.subject or "(No Subject)",
                sender=msg.from_ or "",
                recipients=", ".join(msg.to or []),
                cc=", ".join(msg.cc or []),
                body_text=msg.text or "",
                body_html=msg.html or None,
                date=msg_date,
                received_date=datetime.utcnow(),
                uid=int(msg.uid) if msg.uid.isdigit() else None,
                flags=", ".join(msg.flags)
            )
            
            db.session.add(email_obj)
            db.session.flush()  # Flush to get the ID
            
            # Process attachments
            for att in msg.attachments:
                attachment = Attachment(
                    email_id=email_obj.id,
                    filename=att.filename,
                    content_type=att.content_type,
                    size=len(att.payload) if att.payload else 0
                )
                db.session.add(attachment)
            
            db.session.commit()
            
            # Index in Elasticsearch
            self.elasticsearch_service.index_email(email_obj)
            
            # Categorize email
            category = self.ai_service.categorize_email(email_obj)
            email_obj.category = category
            db.session.commit()
            
            # Trigger webhooks
            self.integration_service.trigger_webhooks('email.new', {
                'email_id': email_obj.id,
                'account_id': account.id,
                'subject': email_obj.subject,
                'sender': email_obj.sender,
                'category': category
            })
            
            return "new"
            
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error processing email: {str(e)}")
            raise
    
    def sync_all_accounts(self, days=30, force=False):
        """Sync all active email accounts"""
        accounts = EmailAccount.query.filter_by(active=True).all()
        results = []
        
        for account in accounts:
            try:
                result = self.sync_account(account, days, force)
                results.append({
                    "account_id": account.id,
                    "email": account.email,
                    "success": result.get("success", False),
                    "message": result.get("message", ""),
                    "new_emails": result.get("new_emails", 0)
                })
            except Exception as e:
                logger.error(f"Error syncing account {account.email}: {str(e)}")
                results.append({
                    "account_id": account.id,
                    "email": account.email,
                    "success": False,
                    "message": str(e)
                })
        
        return results
    
    def get_folders(self, account_id):
        """Get list of folders for an account"""
        account = EmailAccount.query.get(account_id)
        if not account:
            return []
        
        try:
            with MailBox(account.host).login(account.email, account.password) as mailbox:
                folders = mailbox.folder.list()
                return [f.name for f in folders]
        except Exception as e:
            logger.error(f"Error getting folders for {account.email}: {str(e)}")
            return []
    
    def setup_idle_mode(self, account_id):
        """Setup IDLE mode for real-time email notifications (requires background thread)"""
        # Note: Implementing IDLE mode requires background thread management
        # which is complex in a Flask application. This would typically be
        # handled by a separate worker process or using Celery/RQ.
        # Basic implementation shown here for reference.
        
        account = EmailAccount.query.get(account_id)
        if not account:
            return False
        
        logger.warning("IDLE mode is not fully implemented yet")
        return False