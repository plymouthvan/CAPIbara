FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy core files
COPY index.js ./
COPY package*.json ./
COPY src/ ./src/

# Templates and routes should be mounted in production, not baked in
# You may COPY templates/ and routes.json here for local dev/testing
# COPY templates/ ./templates/
# COPY routes.json ./routes.json

# Create templates directory for runtime mounting
RUN mkdir -p /app/templates

# Expose port (configurable via PORT env var, defaults to 8080)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Run the application
CMD ["node", "index.js"]
