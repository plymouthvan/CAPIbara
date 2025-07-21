const { v4: uuidv4 } = require('uuid');

/**
 * Middleware to generate unique request IDs for correlation
 * Adds request_id to req object for use throughout the request lifecycle
 */
function requestIdMiddleware(req, res, next) {
  // Generate unique request ID
  req.request_id = uuidv4();
  
  // Add request ID to response headers for debugging
  res.set('X-Request-ID', req.request_id);
  
  next();
}

module.exports = {
  requestIdMiddleware
};
