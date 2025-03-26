import json
import logging
from datetime import datetime
from flask import render_template, request, jsonify, redirect, url_for, flash
from app import app, db
from models import EmailAccount, Email, Attachment, Webhook, VectorEntry
from services import imap_service, elasticsearch_service, ai_service, integration_service

logger = logging.getLogger(__name__)

# Add a global context processor to provide the current year for all templates
@app.context_processor
def inject_now():
    return {'now': datetime.utcnow()}

# Home route
@app.route('/')
def index():
    """Homepage with dashboard overview"""
    accounts = EmailAccount.query.filter_by(active=True).all()
    # Count emails by category
    email_stats = db.session.query(
        Email.category, db.func.count(Email.id)
    ).group_by(Email.category).all()
    
    stats = {
        'accounts': len(accounts),
        'emails': Email.query.count(),
        'categories': {category: count for category, count in email_stats}
    }
    
    return render_template('index.html', stats=stats, accounts=accounts)

# Email account routes
@app.route('/accounts', methods=['GET', 'POST'])
def manage_accounts():
    """View and manage email accounts"""
    if request.method == 'POST':
        # Add new account
        try:
            account = EmailAccount(
                name=request.form['name'],
                email=request.form['email'],
                password=request.form['password'],
                host=request.form['host'],
                port=int(request.form['port']),
                use_tls=bool(request.form.get('use_tls', False))
            )
            db.session.add(account)
            db.session.commit()
            
            # Test connection
            success = imap_service.test_connection(account)
            if success:
                flash('Account added successfully!', 'success')
                return redirect(url_for('manage_accounts'))
            else:
                db.session.delete(account)
                db.session.commit()
                flash('Failed to connect to the email server. Please check your credentials.', 'danger')
        except Exception as e:
            logger.error(f"Error adding account: {str(e)}")
            flash(f'Error adding account: {str(e)}', 'danger')
            db.session.rollback()
    
    accounts = EmailAccount.query.all()
    return render_template('accounts.html', accounts=accounts)

@app.route('/accounts/<int:account_id>/sync', methods=['POST'])
def sync_account(account_id):
    """Trigger email synchronization for an account"""
    account = EmailAccount.query.get_or_404(account_id)
    try:
        result = imap_service.sync_account(account)
        account.last_sync = datetime.utcnow()
        db.session.commit()
        flash(f'Successfully synced {result["new_emails"]} new emails!', 'success')
    except Exception as e:
        logger.error(f"Sync error: {str(e)}")
        flash(f'Error syncing emails: {str(e)}', 'danger')
    
    return redirect(url_for('manage_accounts'))

@app.route('/accounts/<int:account_id>/delete', methods=['POST'])
def delete_account(account_id):
    """Delete an email account"""
    account = EmailAccount.query.get_or_404(account_id)
    try:
        db.session.delete(account)
        db.session.commit()
        flash('Account deleted successfully!', 'success')
    except Exception as e:
        logger.error(f"Delete error: {str(e)}")
        flash(f'Error deleting account: {str(e)}', 'danger')
        db.session.rollback()
    
    return redirect(url_for('manage_accounts'))

# Email routes
@app.route('/emails')
def view_emails():
    """View all emails with filtering options"""
    category = request.args.get('category')
    account_id = request.args.get('account_id')
    query = Email.query
    
    if category:
        query = query.filter_by(category=category)
    if account_id:
        query = query.filter_by(account_id=account_id)
    
    # Default to recent emails first
    emails = query.order_by(Email.received_date.desc()).limit(100).all()
    
    accounts = EmailAccount.query.all()
    return render_template('emails.html', emails=emails, accounts=accounts)

@app.route('/emails/<int:email_id>')
def view_email(email_id):
    """View a single email with details"""
    email = Email.query.get_or_404(email_id)
    return render_template('email_detail.html', email=email)

@app.route('/emails/<int:email_id>/suggest-reply', methods=['GET'])
def suggest_reply(email_id):
    """Get AI-generated reply suggestion for an email"""
    email = Email.query.get_or_404(email_id)
    
    try:
        reply = ai_service.generate_reply_suggestion(email)
        return jsonify({'reply': reply})
    except Exception as e:
        logger.error(f"Error generating reply: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/search')
def search_emails():
    """Search emails using Elasticsearch"""
    query = request.args.get('q', '')
    account_id = request.args.get('account_id')
    category = request.args.get('category')
    
    if not query and not category and not account_id:
        return render_template('search.html', emails=[], accounts=EmailAccount.query.all())
    
    try:
        search_options = {
            'query': query,
            'filters': {}
        }
        
        if account_id:
            search_options['filters']['account_id'] = account_id
        if category:
            search_options['filters']['category'] = category
        
        results = elasticsearch_service.search_emails(search_options)
        emails = [Email.query.get(result['id']) for result in results]
        
        return render_template('search.html', 
                             emails=emails, 
                             query=query,
                             accounts=EmailAccount.query.all())
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        flash(f'Search error: {str(e)}', 'danger')
        return render_template('search.html', 
                             emails=[], 
                             query=query,
                             accounts=EmailAccount.query.all())

# Webhook routes
@app.route('/webhooks', methods=['GET', 'POST'])
def manage_webhooks():
    """View and manage webhooks"""
    if request.method == 'POST':
        try:
            webhook = Webhook(
                name=request.form['name'],
                url=request.form['url'],
                events=request.form['events']
            )
            db.session.add(webhook)
            db.session.commit()
            flash('Webhook added successfully!', 'success')
        except Exception as e:
            logger.error(f"Error adding webhook: {str(e)}")
            flash(f'Error adding webhook: {str(e)}', 'danger')
            db.session.rollback()
    
    webhooks = Webhook.query.all()
    return render_template('webhooks.html', webhooks=webhooks)

@app.route('/webhooks/<int:webhook_id>/test', methods=['POST'])
def test_webhook(webhook_id):
    """Test a webhook with sample data"""
    webhook = Webhook.query.get_or_404(webhook_id)
    try:
        result = integration_service.test_webhook(webhook)
        if result.get('success'):
            flash('Webhook test successful!', 'success')
        else:
            flash(f'Webhook test failed: {result.get("error")}', 'danger')
    except Exception as e:
        logger.error(f"Webhook test error: {str(e)}")
        flash(f'Webhook test error: {str(e)}', 'danger')
    
    return redirect(url_for('manage_webhooks'))

@app.route('/webhooks/<int:webhook_id>/delete', methods=['POST'])
def delete_webhook(webhook_id):
    """Delete a webhook"""
    webhook = Webhook.query.get_or_404(webhook_id)
    try:
        db.session.delete(webhook)
        db.session.commit()
        flash('Webhook deleted successfully!', 'success')
    except Exception as e:
        logger.error(f"Delete error: {str(e)}")
        flash(f'Error deleting webhook: {str(e)}', 'danger')
        db.session.rollback()
    
    return redirect(url_for('manage_webhooks'))

# API routes
@app.route('/api/emails', methods=['GET'])
def api_get_emails():
    """API to get emails"""
    category = request.args.get('category')
    account_id = request.args.get('account_id')
    query = Email.query
    
    if category:
        query = query.filter_by(category=category)
    if account_id:
        query = query.filter_by(account_id=account_id)
    
    emails = query.order_by(Email.received_date.desc()).limit(100).all()
    
    return jsonify([{
        'id': email.id,
        'subject': email.subject,
        'sender': email.sender,
        'date': email.date.isoformat() if email.date else None,
        'category': email.category,
        'folder': email.folder
    } for email in emails])

@app.route('/api/emails/<int:email_id>', methods=['GET'])
def api_get_email(email_id):
    """API to get email details"""
    email = Email.query.get_or_404(email_id)
    
    return jsonify({
        'id': email.id,
        'account_id': email.account_id,
        'message_id': email.message_id,
        'folder': email.folder,
        'subject': email.subject,
        'sender': email.sender,
        'recipients': email.recipients,
        'cc': email.cc,
        'body_text': email.body_text,
        'body_html': email.body_html,
        'date': email.date.isoformat() if email.date else None,
        'received_date': email.received_date.isoformat(),
        'category': email.category,
        'attachments': [{
            'id': att.id,
            'filename': att.filename,
            'content_type': att.content_type,
            'size': att.size
        } for att in email.attachments]
    })

@app.route('/api/sync', methods=['POST'])
def api_sync_all():
    """API to sync all accounts"""
    try:
        results = imap_service.sync_all_accounts()
        return jsonify({'success': True, 'results': results})
    except Exception as e:
        logger.error(f"Sync error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/accounts', methods=['GET'])
def api_get_accounts():
    """API to get all accounts"""
    accounts = EmailAccount.query.all()
    return jsonify([{
        'id': acc.id,
        'name': acc.name,
        'email': acc.email,
        'host': acc.host,
        'port': acc.port,
        'use_tls': acc.use_tls,
        'last_sync': acc.last_sync.isoformat() if acc.last_sync else None,
        'active': acc.active
    } for acc in accounts])

@app.route('/api/categorize/<int:email_id>', methods=['POST'])
def api_categorize_email(email_id):
    """API to categorize an email using AI"""
    email = Email.query.get_or_404(email_id)
    
    try:
        category = ai_service.categorize_email(email)
        email.category = category
        db.session.commit()
        
        # Trigger webhooks for categorization event
        integration_service.trigger_webhooks('email.categorized', {
            'email_id': email.id,
            'category': category
        })
        
        return jsonify({'success': True, 'category': category})
    except Exception as e:
        logger.error(f"Categorization error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500