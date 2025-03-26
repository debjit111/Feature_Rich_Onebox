# Email Aggregator

A feature-rich email management system that synchronizes multiple IMAP accounts in real-time, categorizes emails using AI, enables advanced search with Elasticsearch, integrates with Slack/webhooks, and provides AI-powered reply suggestions.

## Features

- **Real-Time IMAP Sync**: Connect to multiple IMAP accounts (Gmail/Outlook) with IDLE mode for live updates
- **Elasticsearch-Powered Search**: Full-text search and advanced filtering of emails
- **AI Email Categorization**: Automatically classify emails as Interested, Not Interested, Meeting Booked, Spam, or Out of Office
- **Slack & Webhook Integration**: Send notifications for important emails and trigger webhooks for automation
- **AI-Powered Reply Suggestions**: Generate context-aware email replies using RAG and OpenAI
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **TypeScript Frontend**: Modern, type-safe frontend with React
- **Python Backend**: Fast and scalable backend using FastAPI

## Architecture

The project is built with a modern microservices architecture:

- **Frontend**: React with TypeScript
- **Backend**: Python FastAPI
- **Database**: PostgreSQL
- **Search Engine**: Elasticsearch
- **AI Services**: OpenAI integration
- **Message Queue**: Redis for async tasks
- **Containerization**: Docker and Docker Compose

## Prerequisites

- Node.js (v14+)
- Python 3.8+
- Docker and Docker Compose
- OpenAI API key (for AI features)
- IMAP email accounts (Gmail, Outlook, etc.)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/email_aggregator

# Redis
REDIS_URL=redis://localhost:6379

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# OpenAI
OPENAI_API_KEY=your_api_key_here

# Email Accounts (repeat for multiple accounts)
EMAIL_ACCOUNT_1_HOST=imap.gmail.com
EMAIL_ACCOUNT_1_USER=your_email@gmail.com
EMAIL_ACCOUNT_1_PASSWORD=your_app_specific_password

# Slack Integration (optional)
SLACK_BOT_TOKEN=your_slack_bot_token
SLACK_CHANNEL_ID=your_channel_id

# Webhook Configuration (optional)
WEBHOOK_URL=your_webhook_url
WEBHOOK_SECRET=your_webhook_secret
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/email-aggregator.git
cd email-aggregator
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Install Node.js dependencies:
```bash
npm install
```

4. Start the development environment:
```bash
docker-compose up -d
```

## Development

### Backend Development

1. Start the FastAPI server:
```bash
uvicorn app:app --reload
```

2. Run tests:
```bash
pytest
```

### Frontend Development

1. Start the development server:
```bash
npm run dev
```

2. Build for production:
```bash
npm run build
```

## API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Deployment

### Using Docker Compose

1. Build and start all services:
```bash
docker-compose up --build
```

2. Stop all services:
```bash
docker-compose down
```

### Manual Deployment

1. Set up your production environment variables
2. Build the frontend:
```bash
npm run build
```
3. Start the backend server:
```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.

## Acknowledgments

- OpenAI for providing the AI capabilities
- Elasticsearch for powerful search functionality
- FastAPI for the modern Python web framework
- React and TypeScript for the frontend framework

