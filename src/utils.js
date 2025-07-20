/**
 * Utility functions for CAPIbara
 */

/**
 * Extract client IP address from Express request
 * Prioritizes X-Forwarded-For header, falls back to direct IP
 * @param {Object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP from comma-separated list
    return forwardedFor.split(',')[0].trim();
  }
  return req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
}

/**
 * Get current UNIX timestamp
 * @returns {number} Current timestamp in seconds
 */
function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create request metadata object
 * @param {Object} req - Express request object
 * @returns {Object} Metadata object with ip, user_agent, timestamp
 */
function createRequestMeta(req) {
  return {
    ip: getClientIP(req),
    user_agent: req.headers['user-agent'] || 'unknown',
    timestamp: getCurrentTimestamp()
  };
}

/**
 * Validate that payload has required GA4 structure
 * @param {Object} payload - Request payload
 * @returns {boolean} True if valid GA4 structure
 */
function isValidGA4Payload(payload) {
  return (
    payload &&
    typeof payload === 'object' &&
    Array.isArray(payload.events) &&
    payload.events.length > 0 &&
    payload.events[0] &&
    typeof payload.events[0].name === 'string'
  );
}

/**
 * Get event name from GA4 payload
 * @param {Object} payload - GA4 payload
 * @returns {string|null} Event name or null if not found
 */
function getEventName(payload) {
  if (isValidGA4Payload(payload)) {
    return payload.events[0].name;
  }
  return null;
}

/**
 * Check if a string matches a wildcard pattern
 * @param {string} pattern - Pattern with optional wildcards (*, purchase.*)
 * @param {string} value - Value to test against pattern
 * @returns {boolean} True if value matches pattern
 */
function matchesWildcard(pattern, value) {
  if (pattern === '*') {
    return true;
  }
  
  if (!pattern.includes('*')) {
    return pattern === value;
  }
  
  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
    .replace(/\*/g, '.*'); // Convert * to .*
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}

/**
 * Sort routes by priority (ascending) and then by original order
 * @param {Array} routes - Array of route objects
 * @returns {Array} Sorted routes array
 */
function sortRoutesByPriority(routes) {
  return routes
    .map((route, index) => ({ ...route, _originalIndex: index }))
    .sort((a, b) => {
      // First sort by priority (ascending, undefined treated as Infinity)
      const priorityA = a.priority !== undefined ? a.priority : Infinity;
      const priorityB = b.priority !== undefined ? b.priority : Infinity;
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // If priorities are equal, maintain original order
      return a._originalIndex - b._originalIndex;
    })
    .map(route => {
      // Remove the temporary _originalIndex property
      const { _originalIndex, ...cleanRoute } = route;
      return cleanRoute;
    });
}

/**
 * Create a standardized error response
 * @param {string} message - Error message
 * @param {boolean} isDebug - Whether to include detailed error info
 * @returns {Object} Error response object
 */
function createErrorResponse(message, isDebug = false) {
  if (isDebug) {
    return { error: message };
  }
  
  // Generic error messages for production
  if (message.toLowerCase().includes('bad request') || 
      message.toLowerCase().includes('invalid') ||
      message.toLowerCase().includes('malformed')) {
    return { error: 'Bad Request' };
  }
  
  if (message.toLowerCase().includes('unauthorized') ||
      message.toLowerCase().includes('forbidden') ||
      message.toLowerCase().includes('auth')) {
    return { error: 'Forbidden' };
  }
  
  return { error: 'Internal Server Error' };
}

/**
 * Deep clone an object (simple implementation for JSON-serializable objects)
 * @param {any} obj - Object to clone
 * @returns {any} Cloned object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

module.exports = {
  getClientIP,
  getCurrentTimestamp,
  createRequestMeta,
  isValidGA4Payload,
  getEventName,
  matchesWildcard,
  sortRoutesByPriority,
  createErrorResponse,
  deepClone
};
