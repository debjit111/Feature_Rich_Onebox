// Email account interface
export interface Account {
  // Unique identifier
  id: string;
  
  // User email address
  user: string;
  
  // Account password or token
  password: string;
  
  // IMAP server hostname
  host: string;
  
  // IMAP server port
  port: number;
  
  // Whether to use TLS
  tls: boolean;
  
  // Display name for the account
  name: string;
  
  // Connection status
  connected?: boolean;
  
  // Last synchronization date
  lastSync?: Date;
}
