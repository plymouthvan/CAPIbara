const axios = require('axios');
const config = require('./config');
const auth = require('./auth');
const templateEngine = require('./template-engine');
const debugLogger = require('./debug');
const { 
  isValidGA4Payload, 
  getEventName, 
  matchesWildcard, 
  sortRoutesByPriority,
  createRequestMeta,
  deepClone
} = require('./utils');

class Router {
  constructor() {
    this.routes = [];
    this.fallbackRoute = null;
  }

  /**
   * Initialize router with routes from config
   */
  initialize() {
    const allRoutes = config.getRoutes();
    
    // Separate fallback route from regular routes
    this.routes = allRoutes.filter(route => !route.fallback);
    const fallbackRoutes = allRoutes.filter(route => route.fallback);
    
    if (fallbackRoutes.length > 0) {
      this.fallbackRoute = fallbackRoutes[0]; // Already validated in config
    }
    
    // Sort routes by priority
    this.routes = sortRoutesByPriority(this.routes);
  }

  /**
   * Process an incoming request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async processRequest(req, res) {
    const startTime = Date.now();
    const meta = createRequestMeta(req);
    const payload = req.body;

    try {
      // Validate payload structure
      if (!isValidGA4Payload(payload)) {
        const error = 'Invalid payload: missing events[0].name';
        debugLogger.logRequest(req, payload, null, null, 'validation_error', error);
        return res.status(400).json({ error: config.isDebugLogging() ? error : 'Bad Request' });
      }

      const eventName = getEventName(payload);
      const matchingRoutes = this.findMatchingRoutes(eventName);

      if (matchingRoutes.length === 0) {
        return await this.handleUnmatchedEvent(req, res, payload, meta);
      }

      // Process matching routes
      const results = await this.executeRoutes(matchingRoutes, req, payload, meta);
      
      // Determine response based on results
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      if (successCount > 0) {
        res.status(200).json({ status: 'success', processed: successCount });
      } else {
        const errorMessages = results.map(r => r.error).filter(Boolean);
        const error = `All routes failed: ${errorMessages.join(', ')}`;
        res.status(500).json({ 
          error: config.isDebugLogging() ? error : 'Internal Server Error' 
        });
      }

    } catch (error) {
      console.error('Router error:', error);
      debugLogger.logRequest(req, payload, null, null, 'router_error', error.message);
      res.status(500).json({ 
        error: config.isDebugLogging() ? error.message : 'Internal Server Error' 
      });
    }
  }

  /**
   * Find routes that match the given event name
   * @param {string} eventName - Name of the event to match
   * @returns {Array} Array of matching routes
   */
  findMatchingRoutes(eventName) {
    const matching = [];
    
    for (const route of this.routes) {
      if (matchesWildcard(route.event_match, eventName)) {
        matching.push(route);
        
        // If multi is not enabled, only return the first match
        if (!route.multi) {
          break;
        }
      }
    }
    
    return matching;
  }

  /**
   * Execute multiple routes
   * @param {Array} routes - Routes to execute
   * @param {Object} req - Express request object
   * @param {Object} payload - Request payload
   * @param {Object} meta - Request metadata
   * @returns {Array} Array of execution results
   */
  async executeRoutes(routes, req, payload, meta) {
    const results = [];
    
    for (const route of routes) {
      const result = await this.executeRoute(route, req, payload, meta);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Execute a single route
   * @param {Object} route - Route configuration
   * @param {Object} req - Express request object
   * @param {Object} payload - Request payload
   * @param {Object} meta - Request metadata
   * @returns {Object} Execution result
   */
  async executeRoute(route, req, payload, meta) {
    const startTime = Date.now();
    
    try {
      // Authenticate request
      const authResult = auth.authenticate(req, route.auth);
      if (!authResult.success) {
        if (config.isDebugLogging()) {
          auth.logAuthAttempt(req, authResult, route.name || 'unnamed');
        }
        
        debugLogger.logRequest(
          req, 
          payload, 
          route.name || 'unnamed',
          route.target_url,
          'auth_failed',
          authResult.error,
          Date.now() - startTime
        );
        
        return { success: false, error: authResult.error, route: route.name };
      }

      // Process payload
      let transformedPayload;
      let status;
      
      if (route.template) {
        // Template mode
        transformedPayload = templateEngine.processTemplate(route.template, payload, meta);
        status = 'success';
      } else {
        // Passthrough mode
        transformedPayload = deepClone(payload);
        status = 'passthrough';
      }

      // Send to target URL
      const httpResult = await this.sendToTarget(route, transformedPayload);
      
      if (!httpResult.success) {
        debugLogger.logRequest(
          req,
          payload,
          route.name || 'unnamed',
          route.target_url,
          'http_error',
          httpResult.error,
          Date.now() - startTime,
          transformedPayload
        );
        
        return { success: false, error: httpResult.error, route: route.name };
      }

      // Log successful execution
      debugLogger.logRequest(
        req,
        payload,
        route.name || 'unnamed',
        route.target_url,
        status,
        null,
        Date.now() - startTime,
        transformedPayload
      );

      return { success: true, route: route.name, status: httpResult.status };

    } catch (error) {
      console.error(`Route execution error for ${route.name}:`, error);
      
      debugLogger.logRequest(
        req,
        payload,
        route.name || 'unnamed',
        route.target_url,
        'execution_error',
        error.message,
        Date.now() - startTime
      );
      
      return { success: false, error: error.message, route: route.name };
    }
  }

  /**
   * Send transformed payload to target URL
   * @param {Object} route - Route configuration
   * @param {Object} payload - Transformed payload
   * @returns {Object} HTTP result
   */
  async sendToTarget(route, payload) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...route.headers
      };

      const response = await axios.post(route.target_url, payload, {
        headers,
        timeout: 30000, // 30 second timeout
        validateStatus: (status) => status < 500 // Accept 4xx as success
      });

      return { 
        success: true, 
        status: response.status,
        data: response.data 
      };

    } catch (error) {
      let errorMessage = 'HTTP request failed';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout';
      } else if (error.response) {
        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      } else if (error.request) {
        errorMessage = 'No response from target';
      } else {
        errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Handle unmatched events
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Object} payload - Request payload
   * @param {Object} meta - Request metadata
   */
  async handleUnmatchedEvent(req, res, payload, meta) {
    const eventName = getEventName(payload);
    
    // Log unmatched event if enabled
    if (process.env.LOG_UNMATCHED_EVENTS === 'true') {
      console.log(`Unmatched event: ${eventName} from ${meta.ip}`);
    }

    // Try fallback route if available
    if (this.fallbackRoute) {
      const result = await this.executeRoute(this.fallbackRoute, req, payload, meta);
      
      if (result.success) {
        return res.status(200).json({ status: 'success', processed: 1, fallback: true });
      } else {
        return res.status(500).json({ 
          error: config.isDebugLogging() ? `Fallback route failed: ${result.error}` : 'Internal Server Error' 
        });
      }
    }

    // Log as unmatched in debug
    debugLogger.logRequest(req, payload, null, null, 'unmatched', `No route matched event: ${eventName}`);
    
    // Return 200 OK for unmatched events (as per spec)
    res.status(200).json({ status: 'unmatched', event: eventName });
  }

  /**
   * Process dry run request (no actual HTTP calls)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async processDryRun(req, res) {
    const meta = createRequestMeta(req);
    const payload = req.body;

    try {
      // Validate payload structure
      if (!isValidGA4Payload(payload)) {
        const error = 'Invalid payload: missing events[0].name';
        return res.status(400).json({ error: config.isDebugLogging() ? error : 'Bad Request' });
      }

      const eventName = getEventName(payload);
      const matchingRoutes = this.findMatchingRoutes(eventName);

      if (matchingRoutes.length === 0) {
        return res.json({ matched_routes: [] });
      }

      const results = [];

      for (const route of matchingRoutes) {
        // Authenticate request
        const authResult = auth.authenticate(req, route.auth);
        if (!authResult.success) {
          results.push({
            route: route.name || 'unnamed',
            target_url: route.target_url,
            auth_error: authResult.error
          });
          continue;
        }

        // Process payload
        let transformedPayload;
        
        if (route.template) {
          transformedPayload = templateEngine.processTemplate(route.template, payload, meta);
        } else {
          transformedPayload = deepClone(payload);
        }

        results.push({
          route: route.name || 'unnamed',
          target_url: route.target_url,
          transformed_payload: transformedPayload
        });
      }

      res.json({ matched_routes: results });

    } catch (error) {
      console.error('Dry run error:', error);
      res.status(500).json({ 
        error: config.isDebugLogging() ? error.message : 'Internal Server Error' 
      });
    }
  }
}

module.exports = new Router();
