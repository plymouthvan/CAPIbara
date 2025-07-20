const config = require('./src/config');
const Server = require('./src/server');

/**
 * CAPIbara - JSON-based templating system for GA4-style event transformation
 * Entry point with startup error handling
 */

async function startServer() {
  try {
    console.log('Starting CAPIbara...');
    
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
