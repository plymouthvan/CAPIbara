const express = require('express');
const config = require('./config');
const router = require('./router');
const debugLogger = require('./debug');

class Server {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.initializeComponents();
  }

  initializeComponents() {
    // Initialize debug logger
    debugLogger.initialize();
    
    // Initialize router
    router.initialize();
  }

  setupMiddleware() {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }));
    
    // Basic request logging
    this.app.use((req, res, next) => {
      if (config.isDebugLogging()) {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path} from ${this.getClientIP(req)}`);
      }
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: Math.floor(Date.now() / 1000),
        version: require('../package.json').version
      });
    });

    // Main event collection endpoint
    this.app.post('/g/collect', (req, res) => {
      this.handleEventCollection(req, res);
    });

    // Debug endpoint
    this.app.get('/debug', (req, res) => {
      this.handleDebugRequest(req, res);
    });

    // Dry run endpoint
    this.app.post('/dry-run', (req, res) => {
      this.handleDryRunRequest(req, res);
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Not Found' });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      
      const errorResponse = config.isDebugLogging() 
        ? { error: err.message }
        : { error: 'Internal Server Error' };
      
      res.status(500).json(errorResponse);
    });
  }

  handleEventCollection(req, res) {
    router.processRequest(req, res);
  }

  handleDebugRequest(req, res) {
    try {
      const entries = debugLogger.getEntries();
      const stats = debugLogger.getStats();
      
      res.json({
        stats: stats,
        entries: entries
      });
    } catch (error) {
      console.error('Debug endpoint error:', error);
      const errorResponse = config.isDebugLogging() 
        ? { error: error.message }
        : { error: 'Internal Server Error' };
      res.status(500).json(errorResponse);
    }
  }

  handleDryRunRequest(req, res) {
    router.processDryRun(req, res);
  }

  /**
   * Extract client IP address from request
   * Prioritizes X-Forwarded-For header, falls back to direct IP
   */
  getClientIP(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // Take the first IP from comma-separated list
      return forwardedFor.split(',')[0].trim();
    }
    return req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
  }

  start() {
    const port = config.getPort();
    
    this.server = this.app.listen(port, () => {
      console.log(`CAPIbara server listening on port ${port}`);
      console.log(`Debug logging: ${config.isDebugLogging() ? 'enabled' : 'disabled'}`);
      console.log(`Debug max entries: ${config.getDebugMaxEntries()}`);
    });

    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = Server;
