const config = require('./config');
const { getClientIP, getCurrentTimestamp } = require('./utils');

class DebugLogger {
  constructor() {
    this.entries = [];
    this.maxEntries = 100;
  }

  /**
   * Initialize debug logger with configuration
   */
  initialize() {
    this.maxEntries = config.getDebugMaxEntries();
  }

  /**
   * Log a request and its processing result
   * @param {Object} req - Express request object
   * @param {Object} originalPayload - Original request payload
   * @param {string} routeName - Name of the route that processed the request
   * @param {string} targetUrl - Target URL the request was sent to
   * @param {string} status - Processing status (success, passthrough, auth_failed, etc.)
   * @param {string} error - Error message if processing failed
   * @param {number} duration - Processing duration in milliseconds
   * @param {Object} transformedPayload - Transformed payload (null for passthrough)
   */
  logRequest(req, originalPayload, routeName, targetUrl, status, error = null, duration = 0, transformedPayload = null) {
    // Skip logging if debug retention is disabled
    if (this.maxEntries === 0) {
      return;
    }

    const entry = {
      timestamp: getCurrentTimestamp(),
      source_ip: getClientIP(req),
      source_path: req.path,
      route: routeName,
      original_payload: this._sanitizePayload(originalPayload),
      transformed_payload: transformedPayload ? this._sanitizePayload(transformedPayload) : null,
      target_url: targetUrl,
      status: status,
      error: error,
      duration_ms: Math.round(duration),
      user_agent: req.headers['user-agent'] || 'unknown'
    };

    // Add entry to the beginning of the array
    this.entries.unshift(entry);

    // Enforce max entries limit (keep most recent)
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }

    // Log to console if debug logging is enabled
    if (config.isDebugLogging()) {
      this._logToConsole(entry);
    }
  }

  /**
   * Get all debug entries for the /debug endpoint
   * @returns {Array} Array of debug entries
   */
  getEntries() {
    return [...this.entries]; // Return a copy to prevent external modification
  }

  /**
   * Clear all debug entries
   */
  clearEntries() {
    this.entries = [];
  }

  /**
   * Get debug statistics
   * @returns {Object} Debug statistics
   */
  getStats() {
    const statusCounts = {};
    let totalDuration = 0;
    let requestCount = this.entries.length;

    for (const entry of this.entries) {
      // Count statuses
      statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
      
      // Sum durations
      if (entry.duration_ms) {
        totalDuration += entry.duration_ms;
      }
    }

    return {
      total_requests: requestCount,
      status_breakdown: statusCounts,
      average_duration_ms: requestCount > 0 ? Math.round(totalDuration / requestCount) : 0,
      max_entries: this.maxEntries,
      current_entries: this.entries.length
    };
  }

  /**
   * Sanitize payload for logging (remove sensitive data)
   * @param {Object} payload - Payload to sanitize
   * @returns {Object} Sanitized payload
   */
  _sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    // Create a deep copy and remove potentially sensitive fields
    const sanitized = JSON.parse(JSON.stringify(payload));
    
    // Remove common sensitive fields
    this._removeSensitiveFields(sanitized, [
      'password',
      'token',
      'secret',
      'key',
      'auth',
      'authorization',
      'credit_card',
      'ssn',
      'social_security'
    ]);

    return sanitized;
  }

  /**
   * Recursively remove sensitive fields from an object
   * @param {Object} obj - Object to clean
   * @param {Array} sensitiveFields - Array of field names to remove
   */
  _removeSensitiveFields(obj, sensitiveFields) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        // Check if this key contains sensitive information
        const isSensitive = sensitiveFields.some(field => 
          lowerKey.includes(field.toLowerCase())
        );
        
        if (isSensitive) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // Recursively clean nested objects
          if (Array.isArray(obj[key])) {
            obj[key].forEach(item => this._removeSensitiveFields(item, sensitiveFields));
          } else {
            this._removeSensitiveFields(obj[key], sensitiveFields);
          }
        }
      }
    }
  }

  /**
   * Log entry to console for debugging
   * @param {Object} entry - Debug entry to log
   */
  _logToConsole(entry) {
    const timestamp = new Date(entry.timestamp * 1000).toISOString();
    const status = entry.status.toUpperCase();
    const route = entry.route || 'unknown';
    const duration = entry.duration_ms ? `${entry.duration_ms}ms` : 'N/A';
    
    if (entry.error) {
      console.log(`[${timestamp}] ${status} ${route} (${duration}) - ERROR: ${entry.error}`);
    } else {
      console.log(`[${timestamp}] ${status} ${route} (${duration}) -> ${entry.target_url || 'N/A'}`);
    }
  }
}

module.exports = new DebugLogger();
