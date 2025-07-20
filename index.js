const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const Server = require('./src/server');

/**
 * CAPIbara - JSON-based templating system for GA4-style event transformation
 * Entry point with startup error handling
 */

/**
 * Perform lightweight startup validation
 */
function validateStartupRequirements() {
  console.log('Validating startup requirements...');
  
  // Check for routes.json
  const routesPath = path.join(process.cwd(), 'routes.json');
  if (!fs.existsSync(routesPath)) {
    throw new Error(`STARTUP ERROR: routes.json not found at ${routesPath}. Please ensure routes.json exists in the project root.`);
  }
  
  // Check for templates directory
  const templatesDir = path.join(process.cwd(), 'templates');
  if (!fs.existsSync(templatesDir)) {
    throw new Error(`STARTUP ERROR: templates directory not found at ${templatesDir}. Please ensure templates/ directory exists.`);
  }
  
  // Validate basic environment variables
  const requiredEnvVars = ['PORT'];
  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar] && envVar === 'PORT' && !process.env.PORT);
  
  // PORT is optional (has default), so we don't fail on it
  // But we validate DEBUG_MAX_ENTRIES if present
  if (process.env.DEBUG_MAX_ENTRIES !== undefined) {
    const debugMaxEntries = parseInt(process.env.DEBUG_MAX_ENTRIES);
    if (isNaN(debugMaxEntries)) {
      throw new Error('STARTUP ERROR: DEBUG_MAX_ENTRIES must be a valid integer');
    }
  }
  
  console.log('✓ Startup requirements validated');
}

async function startServer() {
  try {
    console.log('Starting CAPIbara...');
    
    // Validate basic startup requirements first
    validateStartupRequirements();
    
    // Load and validate configuration
    console.log('Loading configuration...');
    config.load();
    console.log(`Loaded ${config.getRoutes().length} routes`);
    
    // Start the server
    const server = new Server();
    server.start();
    
    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      server.stop();
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully...');
      server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Fatal startup error:', error.message);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
