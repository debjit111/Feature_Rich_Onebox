import json
import logging
import os
import requests
from datetime import datetime
from models import Webhook, Email
from app import db

logger = logging.getLogger(__name__)

class IntegrationService:
    """Service for handling external integrations like webhooks and Slack notifications"""
    
    def __init__(self):
        self.slack_webhook_url = os.environ.get('SLACK_WEBHOOK_URL')
    
    def trigger_webhooks(self, event, data):
        """Trigger all matching webhooks for an event"""
        try:
            # Find webhooks that are subscribed to this event
            webhooks = Webhook.query.filter(
                Webhook.events.like(f"%{event}%"),
                Webhook.active == True
            ).all()
            
            if not webhooks:
                logger.debug(f"No webhooks found for event {event}")
                return []
                
            results = []
            
            # Call each webhook
            for webhook in webhooks:
                try:
                    # Prepare webhook data
                    webhook_data = {
                        "event": event,
                        "timestamp": datetime.utcnow().isoformat(),
                        "data": data
                    }
                    
                    # Call webhook URL
                    response = requests.post(
                        webhook.url,
                        json=webhook_data,
                        headers={"Content-Type": "application/json"},
                        timeout=5
                    )
                    
                    success = 200 <= response.status_code < 300
                    
                    # Record result
                    results.append({
                        "webhook_id": webhook.id,
                        "name": webhook.name,
                        "success": success,
                        "status_code": response.status_code,
                        "response": response.text[:100]  # Truncate long responses
                    })
                    
                    # Update last triggered time
                    webhook.last_triggered = datetime.utcnow()
                    db.session.commit()
                    
                except Exception as e:
                    logger.error(f"Error calling webhook {webhook.name}: {str(e)}")
                    results.append({
                        "webhook_id": webhook.id,
                        "name": webhook.name,
                        "success": False,
                        "error": str(e)
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"Error triggering webhooks: {str(e)}")
            return []
    
    def test_webhook(self, webhook):
        """Test a webhook with sample data"""
        try:
            # Create test data
            test_data = {
                "event": "test",
                "timestamp": datetime.utcnow().isoformat(),
                "data": {
                    "message": "This is a test webhook from Onebox Email Aggregator",
                    "webhook_id": webhook.id,
                    "webhook_name": webhook.name
                }
            }
            
            # Call webhook URL
            response = requests.post(
                webhook.url,
                json=test_data,
                headers={"Content-Type": "application/json"},
                timeout=5
            )
            
            success = 200 <= response.status_code < 300
            
            return {
                "success": success,
                "status_code": response.status_code,
                "response": response.text[:100]  # Truncate long responses
            }
            
        except Exception as e:
            logger.error(f"Error testing webhook: {str(e)}")
            return {"success": False, "error": str(e)}
    
    def send_slack_notification(self, message, email=None, color="#36a64f"):
        """Send a notification to Slack"""
        if not self.slack_webhook_url:
            logger.debug("Slack webhook URL not configured")
            return False
            
        try:
            # Create Slack message payload
            payload = {
                "attachments": [
                    {
                        "color": color,
                        "pretext": message,
                        "mrkdwn_in": ["text", "pretext"]
                    }
                ]
            }
            
            # Add email details if provided
            if email:
                payload["attachments"][0].update({
                    "title": email.subject,
                    "text": f"From: {email.sender}\nCategory: {email.category or 'uncategorized'}",
                    "footer": f"Email ID: {email.id}"
                })
            
            # Send to Slack
            response = requests.post(
                self.slack_webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=5
            )
            
            success = 200 <= response.status_code < 300
            
            if not success:
                logger.error(f"Slack notification failed: {response.status_code} {response.text}")
                
            return success
            
        except Exception as e:
            logger.error(f"Error sending Slack notification: {str(e)}")
            return False
    
    def notify_new_email(self, email_id):
        """Send notification for a new email"""
        email = Email.query.get(email_id)
        if not email:
            return False
            
        # Determine message based on category
        category = email.category or "uncategorized"
        color = "#36a64f"  # default green
        
        if category == "interested":
            message = "🔥 New Interested Lead!"
            color = "#36a64f"  # green
        elif category == "meeting_booked":
            message = "📅 New Meeting Booked!"
            color = "#2eb6f2"  # blue
        elif category == "spam":
            message = "🗑️ Spam Email Received"
            color = "#dddddd"  # gray
        elif category == "out_of_office":
            message = "🏖️ Out of Office Reply"
            color = "#dddddd"  # gray
        else:
            message = "📬 New Email Received"
            color = "#f2c744"  # yellow
            
        # Send notification
        return self.send_slack_notification(message, email, color)