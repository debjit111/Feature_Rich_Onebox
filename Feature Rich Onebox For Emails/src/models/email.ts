// Email interface representing an email message
export interface Email {
  // Unique identifier
  id: string;
  
  // Account that owns this email
  accountId: string;
  
  // Message ID from IMAP
  msgId: string;
  
  // Folder where email is stored
  folder: string;
  
  // IMAP UID
  uid?: number;
  
  // Email subject
  subject: string;
  
  // Sender
  from: string;
  
  // Recipients
  to: string;
  
  // CC recipients
  cc?: string;
  
  // Date from email header
  date?: Date;
  
  // Date when email was received by the system
  receivedDate: Date;
  
  // Plain text body
  text?: string;
  
  // HTML body
  html?: string | null;
  
  // AI-assigned category
  category?: string;
  
  // IMAP flags (read, answered, etc.)
  flags?: string[];
  
  // Attachments list
  attachments?: Attachment[];
  
  // Original email body
  body?: string;
}

// Attachment interface
export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
}
