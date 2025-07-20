const fs = require('fs');
const path = require('path');

class TemplateEngine {
  constructor() {
    this.templateCache = new Map();
  }

  /**
   * Load and cache a template from the templates directory
   * @param {string} templatePath - Relative path to template file
   * @returns {Object} Parsed template object
   */
  loadTemplate(templatePath) {
    if (this.templateCache.has(templatePath)) {
      return this.templateCache.get(templatePath);
    }

    const fullPath = path.join(process.cwd(), 'templates', templatePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    try {
      const templateContent = fs.readFileSync(fullPath, 'utf8');
      const template = JSON.parse(templateContent);
      this.templateCache.set(templatePath, template);
      return template;
    } catch (error) {
      throw new Error(`Failed to load template ${templatePath}: ${error.message}`);
    }
  }

  /**
   * Process a template with the given payload data
   * @param {string} templatePath - Path to template file
   * @param {Object} payload - Event payload data
   * @param {Object} meta - Request metadata (ip, user_agent, timestamp)
   * @returns {Object} Processed template with resolved tokens
   */
  processTemplate(templatePath, payload, meta) {
    const template = this.loadTemplate(templatePath);
    const context = {
      ...payload,
      meta
    };
    
    return this.resolveTokens(template, context);
  }

  /**
   * Recursively resolve all tokens in a template object
   * @param {any} obj - Template object or value to process
   * @param {Object} context - Data context for token resolution
   * @returns {any} Processed object with resolved tokens
   */
  resolveTokens(obj, context) {
    if (typeof obj === 'string') {
      return this.resolveStringTokens(obj, context);
    }
    
    if (Array.isArray(obj)) {
      const result = [];
      for (const item of obj) {
        const resolved = this.resolveTokens(item, context);
        if (resolved !== undefined) {
          result.push(resolved);
        }
      }
      return result;
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const resolved = this.resolveTokens(value, context);
        if (resolved !== undefined) {
          result[key] = resolved;
        }
      }
      return result;
    }
    
    return obj;
  }

  /**
   * Resolve tokens in a string value
   * @param {string} str - String containing tokens
   * @param {Object} context - Data context for resolution
   * @returns {string|undefined} Resolved string or undefined if missing
   */
  resolveStringTokens(str, context) {
    const tokenRegex = /\{\{([^}]+)\}\}/g;
    let hasTokens = false;
    
    const resolved = str.replace(tokenRegex, (match, tokenExpression) => {
      hasTokens = true;
      return this.resolveTokenExpression(tokenExpression.trim(), context);
    });
    
    // If no tokens were found, return the original string
    if (!hasTokens) {
      return str;
    }
    
    // If the resolved string contains MISSING_VALUE markers, return undefined
    if (resolved.includes('__MISSING_VALUE__')) {
      return undefined;
    }
    
    return resolved;
  }

  /**
   * Resolve a single token expression with optional fallback
   * @param {string} expression - Token expression (e.g., "path.to.value || 'fallback'")
   * @param {Object} context - Data context for resolution
   * @returns {string} Resolved value or MISSING_VALUE marker
   */
  resolveTokenExpression(expression, context) {
    // Check for fallback syntax: "path || fallback"
    const fallbackMatch = expression.match(/^(.+?)\s*\|\|\s*(.+)$/);
    
    if (fallbackMatch) {
      const [, mainPath, fallbackValue] = fallbackMatch;
      const mainValue = this.getValueByPath(mainPath.trim(), context);
      
      if (mainValue !== undefined) {
        return String(mainValue);
      }
      
      // Process fallback value (could be a literal or another path)
      const fallback = this.processFallbackValue(fallbackValue.trim(), context);
      return fallback !== undefined ? String(fallback) : '__MISSING_VALUE__';
    }
    
    // No fallback, resolve the path directly
    const value = this.getValueByPath(expression, context);
    return value !== undefined ? String(value) : '__MISSING_VALUE__';
  }

  /**
   * Process a fallback value which could be a literal or path
   * @param {string} fallbackValue - The fallback expression
   * @param {Object} context - Data context for resolution
   * @returns {any} Resolved fallback value
   */
  processFallbackValue(fallbackValue, context) {
    // Check if it's a quoted string literal
    if ((fallbackValue.startsWith("'") && fallbackValue.endsWith("'")) ||
        (fallbackValue.startsWith('"') && fallbackValue.endsWith('"'))) {
      return fallbackValue.slice(1, -1); // Remove quotes
    }
    
    // Check if it's null
    if (fallbackValue === 'null') {
      return null;
    }
    
    // Check if it's a boolean
    if (fallbackValue === 'true') return true;
    if (fallbackValue === 'false') return false;
    
    // Check if it's a number
    if (/^-?\d+(\.\d+)?$/.test(fallbackValue)) {
      return parseFloat(fallbackValue);
    }
    
    // Otherwise, treat it as a path
    return this.getValueByPath(fallbackValue, context);
  }

  /**
   * Get a value from an object using dot notation path
   * @param {string} path - Dot notation path (e.g., "events.0.name")
   * @param {Object} context - Object to traverse
   * @returns {any} Value at path or undefined if not found
   */
  getValueByPath(path, context) {
    const parts = path.split('.');
    let current = context;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      
      // Handle array indices
      if (Array.isArray(current) && /^\d+$/.test(part)) {
        const index = parseInt(part, 10);
        current = current[index];
      } else if (typeof current === 'object') {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Clear the template cache (useful for testing)
   */
  clearCache() {
    this.templateCache.clear();
  }
}

module.exports = new TemplateEngine();
