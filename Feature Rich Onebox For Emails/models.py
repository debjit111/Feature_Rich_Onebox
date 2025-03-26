from datetime import datetime
from app import db

class EmailAccount(db.Model):
    """Model for storing email account information"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(256), nullable=False)  # Store securely, encrypt in production
    host = db.Column(db.String(100), nullable=False)
    port = db.Column(db.Integer, nullable=False, default=993)
    use_tls = db.Column(db.Boolean, default=True)
    last_sync = db.Column(db.DateTime)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship
    emails = db.relationship('Email', backref='account', lazy=True, cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<EmailAccount {self.email}>'

class Email(db.Model):
    """Model for storing email messages"""
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('email_account.id'), nullable=False)
    
    # Email metadata
    message_id = db.Column(db.String(256), nullable=True)  # From email header
    folder = db.Column(db.String(100), nullable=False, default='INBOX')
    subject = db.Column(db.String(512), nullable=True)
    sender = db.Column(db.String(256), nullable=True)  # From field
    recipients = db.Column(db.Text, nullable=True)  # To field, can be multiple
    cc = db.Column(db.Text, nullable=True)  # CC field, can be multiple
    
    # Email content
    body_text = db.Column(db.Text, nullable=True)
    body_html = db.Column(db.Text, nullable=True)
    
    # Timestamps
    date = db.Column(db.DateTime, nullable=True)  # Date from email header
    received_date = db.Column(db.DateTime, default=datetime.utcnow)  # When our system received it
    
    # AI processing
    category = db.Column(db.String(50), nullable=True)  # interested, not_interested, meeting_booked, spam, out_of_office
    
    # IMAP specific
    uid = db.Column(db.Integer, nullable=True)  # IMAP UID
    flags = db.Column(db.String(100), nullable=True)  # read, answered, etc.
    
    # Relationships
    attachments = db.relationship('Attachment', backref='email', lazy=True, cascade="all, delete-orphan")
    
    def __repr__(self):
        return f'<Email {self.subject}>'

class Attachment(db.Model):
    """Model for storing email attachments"""
    id = db.Column(db.Integer, primary_key=True)
    email_id = db.Column(db.Integer, db.ForeignKey('email.id'), nullable=False)
    
    filename = db.Column(db.String(256), nullable=False)
    content_type = db.Column(db.String(100), nullable=True)
    size = db.Column(db.Integer, nullable=True)  # Size in bytes
    content = db.Column(db.LargeBinary, nullable=True)  # Actual file content (optional)
    
    def __repr__(self):
        return f'<Attachment {self.filename}>'

class Webhook(db.Model):
    """Model for storing webhook configurations"""
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    url = db.Column(db.String(512), nullable=False)
    events = db.Column(db.String(256), nullable=False)  # Comma-separated event names
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_triggered = db.Column(db.DateTime, nullable=True)
    
    def __repr__(self):
        return f'<Webhook {self.name}>'

class VectorEntry(db.Model):
    """Model for storing vector embeddings for RAG"""
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    embedding = db.Column(db.Text, nullable=False)  # JSON serialized embedding
    description = db.Column(db.String(256), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f'<VectorEntry {self.description or self.id}>'