#!/bin/bash

# CAPIbara Docker Setup Script
# This script automates the initial setup for running CAPIbara via Docker

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

print_header "CAPIbara Docker Setup"

# Step 1: Create capibara directory and move into it
print_status "Creating capibara directory..."
if [ ! -d "capibara" ]; then
    mkdir capibara
    print_status "Created capibara directory"
else
    print_warning "capibara directory already exists"
fi

cd capibara
print_status "Moved into capibara directory: $(pwd)"

# Step 2: Pull the latest Docker image
print_status "Pulling latest CAPIbara Docker image..."
docker pull ghcr.io/plymouthvan/capibara:latest

# Step 3: Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    print_status "Creating .env file with example values..."
    cat > .env << 'EOF'
# CAPIbara Configuration
PORT=8080
DEBUG_LOGGING=true
FILE_LOGGING_ENABLED=true
FILE_LOG_MAX_SIZE=1048576
FILE_LOG_MAX_FILES=3

# Example API Keys (replace with your actual keys)
API_KEY=abc123
META_ACCESS_TOKEN=your-meta-access-token-here
GA4_API_SECRET=your-ga4-api-secret-here

# Optional: Custom log directory
# LOG_DIRECTORY=/var/log/capibara

# Optional: Debug settings
DEBUG_MAX_ENTRIES=100
CAPI_TEST_MODE=false
EOF
    print_status "Created .env file with example configuration"
else
    print_warning ".env file already exists, skipping creation"
fi

# Step 4: Create routes.json file if it doesn't exist
if [ ! -f "routes.json" ]; then
    print_status "Creating routes.json file..."
    
    # Check if routes.json.example exists in current directory or parent
    if [ -f "../routes.json.example" ]; then
        cp ../routes.json.example routes.json
        print_status "Copied routes.json.example to routes.json"
    elif [ -f "routes.json.example" ]; then
        cp routes.json.example routes.json
        print_status "Copied routes.json.example to routes.json"
    else
        # Create a basic routes.json template
        cat > routes.json << 'EOF'
{
  "routes": [
    {
      "name": "example-route",
      "event_match": "purchase",
      "target_url": "https://httpbin.org/post",
      "method": "POST",
      "template": "meta.json",
      "auth": {
        "type": "apikey",
        "key": "{{API_KEY}}"
      }
    }
  ]
}
EOF
        print_status "Created basic routes.json template"
        print_warning "Please edit routes.json to configure your actual routes and destinations"
    fi
else
    print_warning "routes.json already exists, skipping creation"
fi

# Step 5: Ensure templates directory exists
if [ ! -d "templates" ]; then
    mkdir templates
    print_status "Created templates directory"
    
    # Create example template files
    cat > templates/meta.json << 'EOF'
{
  "event_name": "{{events.0.name}}",
  "event_time": "{{meta.timestamp}}",
  "action_source": "website",
  "event_source_url": "{{page_location}}",
  "user_data": {
    "client_user_agent": "{{meta.user_agent}}",
    "client_ip_address": "{{meta.ip}}",
    "em": "{{user_properties.email}}"
  },
  "custom_data": {
    "value": "{{events.0.params.value}}",
    "currency": "{{events.0.params.currency || 'USD'}}"
  }
}
EOF

    cat > templates/ga4.json << 'EOF'
{
  "client_id": "{{client_id}}",
  "events": [
    {
      "name": "{{events.0.name}}",
      "params": {
        "value": "{{events.0.params.value}}",
        "currency": "{{events.0.params.currency || 'USD'}}"
      }
    }
  ]
}
EOF
    
    print_status "Created example template files (meta.json, ga4.json)"
else
    print_warning "templates directory already exists"
fi

# Step 6: Create docker-compose.yml if it doesn't exist
if [ ! -f "docker-compose.yml" ]; then
    print_status "Creating docker-compose.yml..."
    cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  capibara:
    image: ghcr.io/plymouthvan/capibara:latest
    container_name: capibara
    ports:
      - "${PORT:-8080}:8080"
    environment:
      - DEBUG_LOGGING=${DEBUG_LOGGING:-true}
      - FILE_LOGGING_ENABLED=${FILE_LOGGING_ENABLED:-true}
      - FILE_LOG_MAX_SIZE=${FILE_LOG_MAX_SIZE:-1048576}
      - FILE_LOG_MAX_FILES=${FILE_LOG_MAX_FILES:-3}
      - DEBUG_MAX_ENTRIES=${DEBUG_MAX_ENTRIES:-100}
      - CAPI_TEST_MODE=${CAPI_TEST_MODE:-false}
      - API_KEY=${API_KEY}
      - META_ACCESS_TOKEN=${META_ACCESS_TOKEN}
      - GA4_API_SECRET=${GA4_API_SECRET}
    volumes:
      - ./routes.json:/app/routes.json:ro
      - ./templates:/app/templates:ro
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  logs:
EOF
    print_status "Created docker-compose.yml"
else
    print_warning "docker-compose.yml already exists, skipping creation"
fi

# Create logs directory
if [ ! -d "logs" ]; then
    mkdir logs
    print_status "Created logs directory"
fi

# Step 7: Display final instructions
print_header "Setup Complete!"
echo
print_status "CAPIbara has been set up in: $(pwd)"
echo
echo -e "${BLUE}Next steps:${NC}"
echo "1. Edit .env file with your actual configuration values"
echo "2. Edit routes.json to configure your routes and destinations"
echo "3. Add or modify templates in the templates/ directory as needed"
echo
echo -e "${BLUE}To manage CAPIbara:${NC}"
echo -e "${GREEN}• To start CAPIbara:${NC} docker compose up -d"
echo -e "${GREEN}• To view logs:${NC} docker compose logs -f"
echo -e "${GREEN}• To stop:${NC} docker compose down"
echo -e "${GREEN}• To restart:${NC} docker compose restart"
echo -e "${GREEN}• To update image:${NC} docker compose pull && docker compose up -d"
echo
echo -e "${BLUE}Endpoints will be available at:${NC}"
echo "• Health check: http://localhost:8080/health"
echo "• Main endpoint: http://localhost:8080/g/collect"
echo "• Debug endpoint: http://localhost:8080/debug"
echo "• Dry run endpoint: http://localhost:8080/dry-run"
echo
print_status "Setup completed successfully!"
