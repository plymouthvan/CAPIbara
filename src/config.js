const fs = require('fs');
const path = require('path');

class Config {
  constructor() {
    this.routes = null;
    this.debugLogging = false;
    this.debugMaxEntries = 100;
    this.port = 8080;
    this.fileLoggingEnabled = false;
    this.fileLogMaxSize = 1048576; // 1MB
    this.fileLogMaxFiles = 3;
    this.testMode = false;
  }

  /**
   * Load and validate configuration at startup
   * Throws fatal errors for invalid configurations
   */
  load() {
    this._loadEnvironmentVariables();
    this._loadRoutes();
    this._validateRoutes();
  }

  _loadEnvironmentVariables() {
    require('dotenv').config();
    
    this.debugLogging = process.env.DEBUG_LOGGING === 'true';
    this.port = parseInt(process.env.PORT) || 8080;
    this.testMode = process.env.CAPI_TEST_MODE === 'true';
    this.fileLoggingEnabled = process.env.FILE_LOGGING_ENABLED === 'true';
    
    // Validate DEBUG_MAX_ENTRIES (separate from file logging)
    if (process.env.DEBUG_LOG_MAX !== undefined) {
      const maxEntries = parseInt(process.env.DEBUG_LOG_MAX);
      if (isNaN(maxEntries)) {
        throw new Error('DEBUG_LOG_MAX must be a valid integer');
      }
      if (maxEntries < 0) {
        this.debugMaxEntries = 0; // Disable debug retention
      } else if (maxEntries > 1000) {
        this.debugMaxEntries = 1000; // Cap at 1000
      } else {
        this.debugMaxEntries = maxEntries;
      }
    } else if (process.env.DEBUG_MAX_ENTRIES !== undefined) {
      // Backward compatibility
      const maxEntries = parseInt(process.env.DEBUG_MAX_ENTRIES);
      if (isNaN(maxEntries)) {
        throw new Error('DEBUG_MAX_ENTRIES must be a valid integer');
      }
      if (maxEntries < 0) {
        this.debugMaxEntries = 0;
      } else if (maxEntries > 1000) {
        this.debugMaxEntries = 1000;
      } else {
        this.debugMaxEntries = maxEntries;
      }
    }
    
    // File logging configuration
    if (process.env.FILE_LOG_MAX_SIZE !== undefined) {
      const maxSize = parseInt(process.env.FILE_LOG_MAX_SIZE);
      if (isNaN(maxSize) || maxSize <= 0) {
        throw new Error('FILE_LOG_MAX_SIZE must be a positive integer');
      }
      this.fileLogMaxSize = maxSize;
    }
    
    if (process.env.FILE_LOG_MAX_FILES !== undefined) {
      const maxFiles = parseInt(process.env.FILE_LOG_MAX_FILES);
      if (isNaN(maxFiles) || maxFiles <= 0) {
        throw new Error('FILE_LOG_MAX_FILES must be a positive integer');
      }
      this.fileLogMaxFiles = maxFiles;
    }
  }

  _loadRoutes() {
    const routesPath = path.join(process.cwd(), 'routes.json');
    
    if (!fs.existsSync(routesPath)) {
      throw new Error(`routes.json not found at ${routesPath}`);
    }

    let routesContent;
    try {
      routesContent = fs.readFileSync(routesPath, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read routes.json: ${error.message}`);
    }

    try {
      const routesData = JSON.parse(routesContent);
      this.routes = routesData.routes;
    } catch (error) {
      throw new Error(`Invalid JSON in routes.json: ${error.message}`);
    }

    if (!Array.isArray(this.routes)) {
      throw new Error('routes.json must contain a "routes" array');
    }
  }

  _validateRoutes() {
    const fallbackRoutes = [];
    const seenPriorities = new Map();

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];
      const routeIndex = i + 1;

      // Validate required fields
      if (!route.event_match) {
        throw new Error(`Route ${routeIndex}: missing required field "event_match"`);
      }
      if (!route.target_url) {
        throw new Error(`Route ${routeIndex}: missing required field "target_url"`);
      }

      // Validate authentication
      if (!route.auth) {
        throw new Error(`Route ${routeIndex}: missing required field "auth"`);
      }
      this._validateAuthentication(route.auth, routeIndex);

      // Track fallback routes
      if (route.fallback === true) {
        fallbackRoutes.push(routeIndex);
      }

      // Validate priority if specified
      if (route.priority !== undefined) {
        if (!Number.isInteger(route.priority)) {
          throw new Error(`Route ${routeIndex}: priority must be an integer`);
        }
      }

      // Validate template exists if specified
      if (route.template) {
        this._validateTemplate(route.template, routeIndex);
      }

      // Resolve environment variables in route configuration
      this._resolveEnvironmentVariables(route, routeIndex);
    }

    // Check for multiple fallback routes
    if (fallbackRoutes.length > 1) {
      throw new Error(`Multiple fallback routes defined (routes ${fallbackRoutes.join(', ')}). Only one fallback route is allowed.`);
    }
  }

  _validateAuthentication(auth, routeIndex) {
    const authTypes = Object.keys(auth).filter(key => key === 'type');
    if (authTypes.length === 0) {
      throw new Error(`Route ${routeIndex}: auth missing "type" field`);
    }

    const { type } = auth;
    const strategyCount = [
      auth.origins ? 1 : 0,
      auth.key ? 1 : 0,
      auth.allowed_ips ? 1 : 0
    ].reduce((sum, count) => sum + count, 0);

    if (strategyCount > 1) {
      throw new Error(`Route ${routeIndex}: multiple authentication strategies defined. Only one strategy per route is allowed.`);
    }

    switch (type) {
      case 'whitelist':
        if (!auth.origins || !Array.isArray(auth.origins) || auth.origins.length === 0) {
          throw new Error(`Route ${routeIndex}: whitelist auth requires "origins" array`);
        }
        break;
      case 'apikey':
        if (!auth.key) {
          throw new Error(`Route ${routeIndex}: apikey auth requires "key" field`);
        }
        break;
      case 'ip_whitelist':
        if (!auth.allowed_ips || !Array.isArray(auth.allowed_ips) || auth.allowed_ips.length === 0) {
          throw new Error(`Route ${routeIndex}: ip_whitelist auth requires "allowed_ips" array`);
        }
        break;
      default:
        throw new Error(`Route ${routeIndex}: unknown auth type "${type}"`);
    }
  }

  _validateTemplate(templatePath, routeIndex) {
    const fullPath = path.join(process.cwd(), 'templates', templatePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Route ${routeIndex}: template file not found: ${templatePath}`);
    }

    try {
      const templateContent = fs.readFileSync(fullPath, 'utf8');
      JSON.parse(templateContent);
    } catch (error) {
      throw new Error(`Route ${routeIndex}: invalid JSON in template ${templatePath}: ${error.message}`);
    }
  }

  _resolveEnvironmentVariables(obj, routeIndex) {
    const envVarRegex = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;
    
    const resolveValue = (value) => {
      if (typeof value === 'string') {
        return value.replace(envVarRegex, (match, envVar) => {
          const envValue = process.env[envVar];
          if (envValue === undefined) {
            throw new Error(`Route ${routeIndex}: environment variable ${envVar} is not defined`);
          }
          return envValue;
        });
      }
      return value;
    };

    const traverse = (current) => {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          current[i] = resolveValue(current[i]);
          if (typeof current[i] === 'object' && current[i] !== null) {
            traverse(current[i]);
          }
        }
      } else if (typeof current === 'object' && current !== null) {
        for (const key in current) {
          current[key] = resolveValue(current[key]);
          if (typeof current[key] === 'object' && current[key] !== null) {
            traverse(current[key]);
          }
        }
      }
    };

    traverse(obj);
  }

  getRoutes() {
    return this.routes;
  }

  isDebugLogging() {
    return this.debugLogging;
  }

  getDebugMaxEntries() {
    return this.debugMaxEntries;
  }

  getPort() {
    return this.port;
  }

  isFileLoggingEnabled() {
    return this.fileLoggingEnabled;
  }

  getFileLogMaxSize() {
    return this.fileLogMaxSize;
  }

  getFileLogMaxFiles() {
    return this.fileLogMaxFiles;
  }

  isTestMode() {
    return this.testMode;
  }
}

module.exports = new Config();
