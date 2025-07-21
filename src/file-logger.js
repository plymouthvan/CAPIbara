const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class FileLogger {
  constructor() {
    this.logger = null;
    this.logDirectory = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the file logger with configuration
   */
  initialize() {
    if (this.isInitialized) {
      return;
    }

    // Skip initialization if file logging is disabled and not in test mode
    if (!config.isFileLoggingEnabled() && !config.isTestMode()) {
      console.log('File logging disabled');
      return;
    }

    try {
      this.setupLogDirectory();
      this.createLogger();
      this.isInitialized = true;
      
      console.log(`✓ File logging initialized: ${this.logDirectory}`);
    } catch (error) {
      console.error('Failed to initialize file logger:', error.message);
      // Don't throw - allow application to continue without file logging
    }
  }

  /**
   * Setup log directory with appropriate permissions
   */
  setupLogDirectory() {
    // Determine log directory based on environment
    if (config.isTestMode()) {
      this.logDirectory = path.join(process.cwd(), 'logs', 'test');
    } else {
      const customLogDir = process.env.LOG_DIRECTORY;
      if (customLogDir) {
        this.logDirectory = customLogDir;
      } else {
        // Try production path first, fallback to local
        const prodPath = '/var/log/capibara';
        try {
          if (!fs.existsSync(prodPath)) {
            fs.mkdirSync(prodPath, { recursive: true, mode: 0o755 });
          }
          // Test write permissions
          const testFile = path.join(prodPath, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          this.logDirectory = prodPath;
        } catch (error) {
          // Fallback to local logs directory
          this.logDirectory = path.join(process.cwd(), 'logs');
        }
      }
    }

    // Ensure directory exists
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Create Winston logger with rotating file transport
   */
  createLogger() {
    const logFilePath = path.join(this.logDirectory, 'capibara.log');
    
    // Configure log rotation settings
    const maxSize = config.getFileLogMaxSize();
    const maxFiles = config.getFileLogMaxFiles();

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: logFilePath,
          maxsize: maxSize,
          maxFiles: maxFiles,
          tailable: true,
          handleExceptions: false,
          handleRejections: false
        })
      ],
      exitOnError: false
    });

    // Add console transport in test mode for debugging
    if (config.isTestMode() && config.isDebugLogging()) {
      this.logger.add(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }
  }

  /**
   * Log a request with all relevant details
   * @param {string} requestId - Unique request identifier
   * @param {Object} req - Express request object
   * @param {Object} originalPayload - Original request payload
   * @param {string} routeName - Name of the matched route
   * @param {string} targetUrl - Target URL for forwarding
   * @param {string} authStatus - Authentication status
   * @param {string} processingStatus - Processing status
   * @param {number} httpStatus - HTTP response status
   * @param {number} duration - Processing duration in milliseconds
   * @param {string} errorMessage - Error message if any
   * @param {string} errorCode - Error code if any
   * @param {Object} transformedPayload - Transformed payload (optional)
   */
  logRequest(requestId, req, originalPayload, routeName, targetUrl, authStatus, processingStatus, httpStatus, duration, errorMessage = null, errorCode = null, transformedPayload = null) {
    if (!this.isInitialized || !this.logger) {
      return;
    }

    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        request_id: requestId,
        source_ip: this.getClientIP(req),
        source_path: req.path,
        request_method: req.method,
        payload_source: req.payload_source || (req.method === 'GET' ? 'query' : 'body'),
        source_type: req.source_type || (req.method === 'GET' ? 'GTM_GET' : 'STANDARD_POST'),
        route_name: routeName,
        auth_status: authStatus,
        processing_status: processingStatus,
        target_url: targetUrl,
        http_status: httpStatus,
        duration_ms: Math.round(duration || 0),
        error_message: errorMessage,
        error_code: errorCode,
        user_agent: req.headers['user-agent'] || 'unknown'
      };

      // Conditionally include request body
      if (config.isDebugLogging() && originalPayload) {
        logEntry.request_body = this.sanitizePayload(originalPayload);
      }

      // Include transformed payload if available and different from original
      if (transformedPayload && transformedPayload !== originalPayload) {
        logEntry.transformed_payload = this.sanitizePayload(transformedPayload);
      }

      // Add test mode marker
      if (config.isTestMode()) {
        logEntry.test_mode = true;
      }

      this.logger.info(logEntry);

    } catch (error) {
      console.error('File logging error:', error.message);
      // Don't throw - logging failures shouldn't break the application
    }
  }

  /**
   * Extract client IP address from request
   */
  getClientIP(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    return req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Sanitize payload for logging (remove sensitive data)
   */
  sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    try {
      const sanitized = JSON.parse(JSON.stringify(payload));
      this.removeSensitiveFields(sanitized, [
        'password',
        'token',
        'secret',
        'key',
        'auth',
        'authorization',
        'credit_card',
        'ssn',
        'social_security',
        'api_key'
      ]);
      return sanitized;
    } catch (error) {
      return '[SANITIZATION_ERROR]';
    }
  }

  /**
   * Recursively remove sensitive fields from an object
   */
  removeSensitiveFields(obj, sensitiveFields) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        const isSensitive = sensitiveFields.some(field => 
          lowerKey.includes(field.toLowerCase())
        );
        
        if (isSensitive) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          if (Array.isArray(obj[key])) {
            obj[key].forEach(item => this.removeSensitiveFields(item, sensitiveFields));
          } else {
            this.removeSensitiveFields(obj[key], sensitiveFields);
          }
        }
      }
    }
  }

  /**
   * Get the current log directory path
   */
  getLogDirectory() {
    return this.logDirectory;
  }

  /**
   * Check if file logging is active
   */
  isActive() {
    return this.isInitialized && this.logger !== null;
  }

  /**
   * Graceful shutdown - close log files
   */
  shutdown() {
    if (this.logger) {
      this.logger.end();
    }
  }
}

module.exports = new FileLogger();
