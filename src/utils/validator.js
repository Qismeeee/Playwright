const fs = require('fs-extra');
const path = require('path');

class JSONLValidator {
  constructor(options = {}) {
    this.options = {
      strictMode: true,
      allowEmptyValues: false,
      maxFieldLength: 10000,
      validateTimestamp: true,
      ...options
    };

    this.schema = {
      required: ['timestamp', 'action', 'url'],
      optional: ['selector', 'value', 'viewport', 'generated_code', 'metadata', 'session_id'],
      types: {
        timestamp: 'string',
        action: 'string', 
        url: 'string',
        session_id: 'string',
        selector: 'string',
        value: 'string',
        viewport: 'object',
        generated_code: 'string',
        metadata: 'object'
      },
      enums: {
        action: [
          'click', 'fill', 'navigate', 'hover', 'select', 'check', 'uncheck', 'press', 'type',
          'goto',           
          'navigate_back',  
          'navigate_forward', 
          'reload',        
          'scroll',        
          'drag',         
          'drop',
          'wait'            
        ]
      },
      navigation_triggers: {
        navigate: ['direct_url', 'link_click', 'form_submit', 'js_redirect'],
        goto: ['programmatic', 'test_setup']
      }
    };

    this.stats = {
      totalRecords: 0,
      validRecords: 0,
      errors: [],
      warnings: []
    };
  }

  /**
   * Validate single action record
   * @param {Object} record 
   * @returns {Object} 
   */
  validateRecord(record) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      record: record
    };

    try {
      if (typeof record !== 'object' || record === null) {
        result.errors.push('Record must be a valid object');
        result.valid = false;
        return result;
      }

      this.validateRequiredFields(record, result);
      this.validateFieldTypes(record, result);
      this.validateFieldValues(record, result);
      this.validateBusinessLogic(record, result);
      this.checkWarnings(record, result);

    } catch (error) {
      result.errors.push(`Validation error: ${error.message}`);
      result.valid = false;
    }

    return result;
  }

  /**
   * Validate required fields presence
   * @param {Object} record 
   * @param {Object} result 
   */
  validateRequiredFields(record, result) {
    for (const field of this.schema.required) {
      if (!(field in record)) {
        result.errors.push(`Missing required field: ${field}`);
        result.valid = false;
      } else if (record[field] === null || record[field] === undefined) {
        if (!this.options.allowEmptyValues) {
          result.errors.push(`Required field '${field}' cannot be null or undefined`);
          result.valid = false;
        }
      }
    }
  }

  /**
   * Validate field data types
   * @param {Object} record 
   * @param {Object} result 
   */
  validateFieldTypes(record, result) {
    for (const [field, expectedType] of Object.entries(this.schema.types)) {
      if (field in record && record[field] !== null) {
        const actualType = typeof record[field];
        
        if (actualType !== expectedType) {
          result.errors.push(
            `Invalid type for field '${field}': expected ${expectedType}, got ${actualType}`
          );
          result.valid = false;
        }
      }
    }
  }

  /**
   * Validate field values và constraints
   * @param {Object} record 
   * @param {Object} result 
   */
  validateFieldValues(record, result) {
    if (record.timestamp && this.options.validateTimestamp) {
      if (!this.isValidISO8601(record.timestamp)) {
        result.errors.push('Invalid timestamp format, expected ISO 8601');
        result.valid = false;
      }
    }

    if (record.url && !this.isValidURL(record.url)) {
      result.errors.push('Invalid URL format');
      result.valid = false;
    }

    if (record.action && this.schema.enums.action) {
      if (!this.schema.enums.action.includes(record.action)) {
        result.errors.push(
          `Invalid action '${record.action}'. Must be one of: ${this.schema.enums.action.join(', ')}`
        );
        result.valid = false;
      }
    }

    for (const [field, value] of Object.entries(record)) {
      if (typeof value === 'string' && value.length > this.options.maxFieldLength) {
        result.errors.push(`Field '${field}' exceeds maximum length of ${this.options.maxFieldLength}`);
        result.valid = false;
      }
    }

    if (record.viewport) {
      if (!record.viewport.width || !record.viewport.height) {
        result.errors.push('Viewport must contain width and height properties');
        result.valid = false;
      }
      if (typeof record.viewport.width !== 'number' || typeof record.viewport.height !== 'number') {
        result.errors.push('Viewport width and height must be numbers');
        result.valid = false;
      }
    }
  }

  /**
   * Validate business logic rules
   * @param {Object} record 
   * @param {Object} result 
   */
  validateBusinessLogic(record, result) {
    const selectorRequiredActions = ['click', 'fill', 'hover', 'select', 'check', 'uncheck'];
    if (selectorRequiredActions.includes(record.action) && !record.selector) {
      result.errors.push(`Action '${record.action}' requires a selector`);
      result.valid = false;
    }
    if (record.action === 'fill' && !record.value) {
      result.warnings.push('Fill action without value may indicate incomplete interaction');
    }
    if (record.action === 'navigate' && record.selector) {
      result.warnings.push('Navigate action should not have selector');
    }
    if (record.generated_code && record.action) {
      if (!record.generated_code.includes(record.action) && record.action !== 'navigate') {
        result.warnings.push('Generated code may not match recorded action');
      }
    }
  }

  /**
   * Check for potential issues (warnings)
   * @param {Object} record 
   * @param {Object} result 
   */
  checkWarnings(record, result) {
    if (record.selector && record.selector.length < 3) {
      result.warnings.push('Very short selector may be unstable');
    }
    if (record.selector && this.hasGeneratedClasses(record.selector)) {
      result.warnings.push('Selector contains potentially generated class names');
    }
    if (record.timestamp) {
      const recordTime = new Date(record.timestamp);
      const now = new Date();
      const diffHours = (now - recordTime) / (1000 * 60 * 60);
      
      if (diffHours > 24) {
        result.warnings.push('Record timestamp is more than 24 hours old');
      }
    }
  }

  /**
   * Validate entire JSONL file
   * @param {string} filePath 
   * @returns {Object} 
   */
  async validateFile(filePath) {
    const summary = {
      file: filePath,
      totalLines: 0,
      validLines: 0,
      invalidLines: 0,
      emptyLines: 0,
      errors: [],
      warnings: [],
      performance: {
        startTime: Date.now(),
        endTime: null,
        duration: null
      }
    };

    try {
      if (!await fs.pathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        summary.totalLines++;
        if (line === '') {
          summary.emptyLines++;
          continue;
        }

        try {
          const record = JSON.parse(line);
          const validation = this.validateRecord(record);

          if (validation.valid) {
            summary.validLines++;
          } else {
            summary.invalidLines++;
            summary.errors.push({
              line: i + 1,
              errors: validation.errors
            });
          }

          if (validation.warnings.length > 0) {
            summary.warnings.push({
              line: i + 1,
              warnings: validation.warnings
            });
          }

        } catch (parseError) {
          summary.invalidLines++;
          summary.errors.push({
            line: i + 1,
            errors: [`JSON parse error: ${parseError.message}`]
          });
        }
      }

      summary.performance.endTime = Date.now();
      summary.performance.duration = summary.performance.endTime - summary.performance.startTime;

    } catch (error) {
      summary.errors.push({
        line: 0,
        errors: [`File validation error: ${error.message}`]
      });
    }

    return summary;
  }

  /**
   * Check if timestamp is valid ISO 8601 format
   * @param {string} dateString 
   * @returns {boolean}
   */
  isValidISO8601(dateString) {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    return iso8601Regex.test(dateString) && !isNaN(Date.parse(dateString));
  }

  /**
   * Check if URL is valid
   * @param {string} url 
   * @returns {boolean}
   */
  isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if selector contains generated class names
   * @param {string} selector 
   * @returns {boolean}
   */
  hasGeneratedClasses(selector) {
    const generatedPatterns = [
      /css-[a-z0-9]+/i,
      /[a-z]+-[0-9]+/i,
      /_[a-z0-9]+/i
    ];
    
    return generatedPatterns.some(pattern => pattern.test(selector));
  }

  /**
   * Generate validation report
   * @param {Object} summary 
   * @returns {string}
   */
  generateReport(summary) {
    const successRate = summary.totalLines > 0 
      ? ((summary.validLines / (summary.totalLines - summary.emptyLines)) * 100).toFixed(2)
      : 0;

    let report = `\n📊 JSONL Validation Report\n`;
    report += `${'='.repeat(50)}\n`;
    report += `File: ${summary.file}\n`;
    report += `Total Lines: ${summary.totalLines}\n`;
    report += `Valid Records: ${summary.validLines}\n`;
    report += `Invalid Records: ${summary.invalidLines}\n`;
    report += `Empty Lines: ${summary.emptyLines}\n`;
    report += `Success Rate: ${successRate}%\n`;
    report += `Processing Time: ${summary.performance.duration}ms\n\n`;

    if (summary.errors.length > 0) {
      report += `❌ Errors (${summary.errors.length}):\n`;
      summary.errors.slice(0, 10).forEach(error => {
        report += `  Line ${error.line}: ${error.errors.join(', ')}\n`;
      });
      if (summary.errors.length > 10) {
        report += `  ... and ${summary.errors.length - 10} more errors\n`;
      }
      report += '\n';
    }

    if (summary.warnings.length > 0) {
      report += `⚠️  Warnings (${summary.warnings.length}):\n`;
      summary.warnings.slice(0, 5).forEach(warning => {
        report += `  Line ${warning.line}: ${warning.warnings.join(', ')}\n`;
      });
      if (summary.warnings.length > 5) {
        report += `  ... and ${summary.warnings.length - 5} more warnings\n`;
      }
    }

    return report;
  }

  /**
   * Reset validation statistics
   */
  reset() {
    this.stats = {
      totalRecords: 0,
      validRecords: 0,
      errors: [],
      warnings: []
    };
  }
}

module.exports = { JSONLValidator };