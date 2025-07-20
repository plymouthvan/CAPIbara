const { getClientIP } = require('./utils');

class AuthenticationManager {
  /**
   * Authenticate a request against a route's authentication configuration
   * @param {Object} req - Express request object
   * @param {Object} authConfig - Route authentication configuration
   * @returns {Object} Authentication result { success: boolean, error?: string }
   */
  authenticate(req, authConfig) {
    if (!authConfig || !authConfig.type) {
      return { success: false, error: 'Missing authentication configuration' };
    }

    switch (authConfig.type) {
      case 'whitelist':
        return this.authenticateOriginWhitelist(req, authConfig);
      case 'apikey':
        return this.authenticateApiKey(req, authConfig);
      case 'ip_whitelist':
        return this.authenticateIPWhitelist(req, authConfig);
      default:
        return { success: false, error: `Unknown authentication type: ${authConfig.type}` };
    }
  }

  /**
   * Authenticate using origin whitelist
   * @param {Object} req - Express request object
   * @param {Object} authConfig - Authentication configuration
   * @returns {Object} Authentication result
   */
  authenticateOriginWhitelist(req, authConfig) {
    const origin = req.headers.origin;
    
    if (!origin) {
      return { 
        success: false, 
        error: 'Missing Origin header for whitelist authentication' 
      };
    }

    if (!authConfig.origins || !Array.isArray(authConfig.origins)) {
      return { 
        success: false, 
        error: 'Invalid origins configuration for whitelist authentication' 
      };
    }

    const isAllowed = authConfig.origins.includes(origin);
    
    if (!isAllowed) {
      return { 
        success: false, 
        error: `Origin ${origin} not in whitelist` 
      };
    }

    return { success: true };
  }

  /**
   * Authenticate using API key
   * @param {Object} req - Express request object
   * @param {Object} authConfig - Authentication configuration
   * @returns {Object} Authentication result
   */
  authenticateApiKey(req, authConfig) {
    const providedKey = req.headers['x-api-key'];
    
    if (!providedKey) {
      return { 
        success: false, 
        error: 'Missing x-api-key header for API key authentication' 
      };
    }

    if (!authConfig.key) {
      return { 
        success: false, 
        error: 'Invalid key configuration for API key authentication' 
      };
    }

    const expectedKey = authConfig.key;
    
    if (providedKey !== expectedKey) {
      return { 
        success: false, 
        error: 'Invalid API key' 
      };
    }

    return { success: true };
  }

  /**
   * Authenticate using IP whitelist
   * @param {Object} req - Express request object
   * @param {Object} authConfig - Authentication configuration
   * @returns {Object} Authentication result
   */
  authenticateIPWhitelist(req, authConfig) {
    const clientIP = getClientIP(req);
    
    if (!authConfig.allowed_ips || !Array.isArray(authConfig.allowed_ips)) {
      return { 
        success: false, 
        error: 'Invalid allowed_ips configuration for IP whitelist authentication' 
      };
    }

    const isAllowed = authConfig.allowed_ips.includes(clientIP);
    
    if (!isAllowed) {
      return { 
        success: false, 
        error: `IP address ${clientIP} not in whitelist` 
      };
    }

    return { success: true };
  }

  /**
   * Log authentication attempt for debugging
   * @param {Object} req - Express request object
   * @param {Object} authResult - Authentication result
   * @param {string} routeName - Name of the route being accessed
   */
  logAuthAttempt(req, authResult, routeName) {
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const origin = req.headers.origin || 'none';
    
    if (authResult.success) {
      console.log(`Auth success: ${routeName} from ${clientIP} (${origin})`);
    } else {
      console.log(`Auth failed: ${routeName} from ${clientIP} (${origin}) - ${authResult.error}`);
    }
  }
}

module.exports = new AuthenticationManager();
