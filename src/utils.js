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

/**
 * Normalize GET request query parameters into GA4-compatible JSON payload
 * @param {Object} query - Express req.query object
 * @returns {Object} Normalized GA4 payload structure
 */
function normalizeGetPayload(query) {
  // Start with basic GA4 structure
  const payload = {
    client_id: query.cid || query.client_id || 'unknown',
    events: []
  };

  // Handle measurement_id if present
  if (query.tid || query.measurement_id) {
    payload.measurement_id = query.tid || query.measurement_id;
  }

  // Handle user_id if present
  if (query.uid || query.user_id) {
    payload.user_id = query.uid || query.user_id;
  }

  // Handle timestamp_micros if present
  if (query.tm || query.timestamp_micros) {
    payload.timestamp_micros = parseInt(query.tm || query.timestamp_micros) || getCurrentTimestamp() * 1000000;
  }

  // Handle user_properties if present
  if (query.up) {
    try {
      payload.user_properties = typeof query.up === 'string' ? JSON.parse(query.up) : query.up;
    } catch (error) {
      // If parsing fails, skip user_properties
    }
  }

  // Create event from query parameters
  const event = {
    name: query.en || query.event_name || 'page_view',
    params: {}
  };

  // Map common GA4 parameters
  const parameterMappings = {
    // Event parameters
    ep: 'custom_parameter',
    epn: 'custom_parameter', // Custom parameter (numeric)
    
    // E-commerce parameters
    ti: 'transaction_id',
    ta: 'affiliation',
    tr: 'value',
    tt: 'tax',
    ts: 'shipping',
    tcc: 'coupon',
    
    // Item parameters
    in: 'item_name',
    ic: 'item_category',
    iv: 'item_variant',
    ib: 'item_brand',
    ip: 'price',
    iq: 'quantity',
    
    // Page parameters
    dt: 'page_title',
    dl: 'page_location',
    dp: 'page_path',
    dr: 'page_referrer',
    
    // Campaign parameters
    cn: 'campaign_name',
    cs: 'campaign_source',
    cm: 'campaign_medium',
    ck: 'campaign_keyword',
    cc: 'campaign_content',
    ci: 'campaign_id',
    
    // Custom dimensions and metrics
    cd: 'custom_dimension',
    cm: 'custom_metric'
  };

  // Process all query parameters
  for (const [key, value] of Object.entries(query)) {
    // Skip already processed parameters
    if (['cid', 'client_id', 'tid', 'measurement_id', 'uid', 'user_id', 'tm', 'timestamp_micros', 'up', 'en', 'event_name'].includes(key)) {
      continue;
    }

    // Handle custom parameters (ep.*, epn.*)
    if (key.startsWith('ep.')) {
      const paramName = key.substring(3);
      event.params[paramName] = value;
      continue;
    }

    if (key.startsWith('epn.')) {
      const paramName = key.substring(4);
      event.params[paramName] = parseFloat(value) || 0;
      continue;
    }

    // Handle custom dimensions (cd1, cd2, etc.)
    if (key.match(/^cd\d+$/)) {
      const dimensionIndex = key.substring(2);
      event.params[`custom_dimension_${dimensionIndex}`] = value;
      continue;
    }

    // Handle custom metrics (cm1, cm2, etc.)
    if (key.match(/^cm\d+$/)) {
      const metricIndex = key.substring(2);
      event.params[`custom_metric_${metricIndex}`] = parseFloat(value) || 0;
      continue;
    }

    // Map known parameters
    if (parameterMappings[key]) {
      event.params[parameterMappings[key]] = value;
      continue;
    }

    // Add unmapped parameters as-is
    event.params[key] = value;
  }

  // Convert numeric string values where appropriate
  const numericParams = ['value', 'tax', 'shipping', 'price', 'quantity'];
  for (const param of numericParams) {
    if (event.params[param] && typeof event.params[param] === 'string') {
      const numValue = parseFloat(event.params[param]);
      if (!isNaN(numValue)) {
        event.params[param] = numValue;
      }
    }
  }

  payload.events.push(event);
  return payload;
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
  deepClone,
  normalizeGetPayload
};
