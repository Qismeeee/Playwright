const fs = require('fs-extra');
const path = require('path');

class JSONLValidator {
  constructor(options = {}) {
    this.options = {
      strictMode: false,
      allowEmptyValues: false,
      maxFieldLength: 10000,
      validateTimestamp: true,
      session_id: null,
      ...options
    };
    this.schema = {
      required: ['timestamp', 'action', 'url', 'session_id'],
      optional: ['selector', 'selector_alternatives', 'value', 'viewport', 'generated_code', 'metadata'],
      types: {
        timestamp: 'string',
        action: 'string',
        url: 'string',
        session_id: 'string',
        selector: 'string',
        selector_alternatives: 'object',
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
      selector_types: [
        'css_id', 'xpath_id', 'css_testid', 'xpath_testid', 'css_name', 'xpath_name',
        'css_type', 'xpath_type', 'xpath_text', 'xpath_contains_text', 'css_class',
        'xpath_class', 'xpath_attribute', 'xpath_text_exact', 'xpath_position', 'css_tag'
      ],
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

      if (!record.session_id && !this.options.session_id) {
        record.session_id = this.generateDefaultSessionId();
      } else if (!record.session_id && this.options.session_id) {
        record.session_id = this.options.session_id;
      }
      
      this.validateRequiredFields(record, result);
      this.validateFieldTypes(record, result);
      this.validateFieldValues(record, result);
      // Enforce business rules only in strict mode
      if (this.options.strictMode) {
        this.validateBusinessLogic(record, result);
      }
      this.checkWarnings(record, result);

    } catch (error) {
      result.errors.push(`Validation error: ${error.message}`);
      result.valid = false;
    }

    return result;
  }

  generateDefaultSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  validateRequiredFields(record, result) {
    for (const field of this.schema.required) {
      if (!(field in record)) {
        result.errors.push(`Missing required field: ${field}`);
        result.valid = false;
      } else if (record[field] === null || record[field] === undefined) {
        if (!this.options.allowEmptyValues && field !== 'selector' && field !== 'value') { // Allow null for selector/value if action doesn't need it
          result.errors.push(`Required field '${field}' cannot be null or undefined`);
          result.valid = false;
        }
      }
    }
  }

  validateFieldTypes(record, result) {
    for (const [field, expectedType] of Object.entries(this.schema.types)) {
      if (field in record && record[field] !== null && record[field] !== undefined) {
        const actualType = typeof record[field];
        if (expectedType === 'object' && field === 'selector_alternatives') {
          if (!Array.isArray(record[field])) {
            result.errors.push(`Field '${field}' must be an array`);
            result.valid = false;
          }
        } else if (actualType !== expectedType) {
          result.errors.push(
            `Invalid type for field '${field}': expected ${expectedType}, got ${actualType}`
          );
          result.valid = false;
        }
      }
    }
  }

  validateFieldValues(record, result) {
    if (record.timestamp && this.options.validateTimestamp) {
      if (!this.isValidISO8601(record.timestamp)) {
        result.errors.push('Invalid timestamp format, expected ISO 8601');
        result.valid = false;
      }
    }

    if (record.url && !this.isValidURL(record.url)) {
      result.errors.push(`Invalid URL format for field 'url': ${record.url}`);
      result.valid = false;
    }
    
    if (record.metadata && record.metadata.browser && record.metadata.browser.url && !this.isValidURL(record.metadata.browser.url)) {
      result.warnings.push(`Invalid URL format for field 'metadata.browser.url': ${record.metadata.browser.url}`);
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
      if (typeof record.viewport.width !== 'number' || typeof record.viewport.height !== 'number') {
        result.errors.push('Viewport width and height must be numbers');
        result.valid = false;
      } else if (record.viewport.width <= 0 || record.viewport.height <= 0) {
        result.errors.push('Viewport width and height must be positive numbers');
        result.valid = false;
      }
    }
    if (record.selector_alternatives) {
      this.validateSelectorAlternatives(record.selector_alternatives, result);
    }
  }

  validateSelectorAlternatives(alternatives, result) {
    if (!Array.isArray(alternatives)) {
      result.errors.push('selector_alternatives must be an array');
      result.valid = false;
      return;
    }

    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i];
      if (typeof alt !== 'object' || alt === null || !alt.selector || !alt.type || typeof alt.reliability !== 'number') {
        result.errors.push(
          `selector_alternatives[${i}] must be an object with selector, type, and reliability (number) properties`
        );
        result.valid = false;
        continue;
      }

      if (alt.reliability < 0 || alt.reliability > 1) {
        result.errors.push(
          `selector_alternatives[${i}].reliability must be between 0 and 1, got ${alt.reliability}`
        );
        result.valid = false;
      }

      if (!this.schema.selector_types.includes(alt.type)) {
        result.errors.push(
          `selector_alternatives[${i}].type '${alt.type}' is not valid. Must be one of: ${this.schema.selector_types.join(', ')}`
        );
        result.valid = false;
      }

      if (alt.type.startsWith('xpath_') && !this.isValidXPathSyntax(alt.selector)) {
        result.warnings.push(
          `selector_alternatives[${i}] contains potentially invalid XPath syntax: ${alt.selector}`
        );
      }
    }
  }

  validateBusinessLogic(record, result) {
    const selectorRequiredActions = ['click', 'fill', 'hover', 'select', 'check', 'uncheck', 'type', 'drag', 'drop'];
    if (selectorRequiredActions.includes(record.action) && (!record.selector && record.selector !== null)) { // Allow null if action type doesn't need it
        if(record.selector === undefined || record.selector === ''){
            result.errors.push(`Action '${record.action}' requires a selector`);
            result.valid = false;
        }
    }


    if ((record.action === 'fill' || record.action === 'type') && (record.value === undefined || record.value === null) && !this.options.allowEmptyValues) {
      result.warnings.push(`Action '${record.action}' usually has a value. Current value is '${record.value}'.`);
    }
     if (record.action === 'fill' && record.value === '' && !this.options.allowEmptyValues) {
      result.warnings.push(`Fill action with an empty string value. This might be intentional or an issue.`);
    }


    if ((record.action === 'navigate' || record.action === 'goto') && record.selector) {
      result.warnings.push(`Action '${record.action}' should not have a selector. Selector found: ${record.selector}`);
    }
    
    if ((record.action === 'navigate' || record.action === 'goto') && !record.url) {
        result.errors.push(`Action '${record.action}' requires a url.`);
        result.valid = false;
    }

    if (record.generated_code && record.action) {
      const actionInCode = record.action === 'goto' ? 'goto|navigate' : record.action;
      const regex = new RegExp(`\\.${actionInCode}\\(`, 'i');
      if (!regex.test(record.generated_code)) {
        result.warnings.push(`Generated code '${record.generated_code}' may not accurately reflect action '${record.action}'.`);
      }
    }
  }

  checkWarnings(record, result) {
    if (record.selector && record.selector.length > 0 && record.selector.length < 5 && !record.selector.startsWith('#') && !record.selector.startsWith('.')) {
      result.warnings.push(`Very short selector ('${record.selector}') may be unstable.`);
    }
    if (record.selector && this.hasPotentiallyGeneratedClasses(record.selector)) {
      result.warnings.push(`Selector '${record.selector}' contains potentially generated class names.`);
    }
    if (record.timestamp && this.options.validateTimestamp) {
      try {
        const recordTime = new Date(record.timestamp);
        const now = new Date();
        const diffHours = Math.abs(now - recordTime) / (1000 * 60 * 60);
        if (diffHours > 72) {
          result.warnings.push('Record timestamp is more than 72 hours old/future.');
        }
      } catch (e) { /* Handled by isValidISO8601 */ }
    }
    if (record.selector && (record.selector.startsWith('//') || record.selector.startsWith('/html')) && record.selector.length > 150) {
      result.warnings.push(`Very long XPath selector ('${record.selector.substring(0,50)}...') may be brittle.`);
    }
    if (record.selector_alternatives) {
      const lowReliabilityCount = record.selector_alternatives.filter(
        alt => alt.reliability < 0.5
      ).length;
      if (lowReliabilityCount > 2 && record.selector_alternatives.length > 3) {
        result.warnings.push(`${lowReliabilityCount} selector alternatives have low reliability scores (<0.5).`);
      }
    }
  }

  async validateFile(filePath) {
    const summary = {
      file: filePath,
      totalLines: 0,
      validLines: 0,
      invalidLines: 0,
      emptyLines: 0,
      errors: [],
      warnings: [],
      selectorStats: {
        cssSelectors: 0,
        xpathSelectors: 0,
        withAlternatives: 0,
        totalAlternatives: 0,
        sumReliability: 0,
        averageReliability: 0
      },
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

      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = require('readline').createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        summary.totalLines++;
        const trimmedLine = line.trim();

        if (trimmedLine === '') {
          summary.emptyLines++;
          continue;
        }

        try {
          const record = JSON.parse(trimmedLine);
          const validation = this.validateRecord(record);

          if (validation.valid) {
            summary.validLines++;
            if (record.selector) {
              if (record.selector.startsWith('//') || record.selector.startsWith('/html') || record.selector.startsWith('(')) { // Check for common XPath starts
                summary.selectorStats.xpathSelectors++;
              } else {
                summary.selectorStats.cssSelectors++;
              }
            }
            
            if (record.selector_alternatives && record.selector_alternatives.length > 0) {
              summary.selectorStats.withAlternatives++;
              summary.selectorStats.totalAlternatives += record.selector_alternatives.length;
              record.selector_alternatives.forEach(alt => {
                summary.selectorStats.sumReliability += alt.reliability;
              });
            }
          } else {
            summary.invalidLines++;
            summary.errors.push({
              line: summary.totalLines,
              content: trimmedLine.substring(0, 100) + (trimmedLine.length > 100 ? '...' : ''),
              errors: validation.errors
            });
          }

          if (validation.warnings.length > 0) {
            summary.warnings.push({
              line: summary.totalLines,
              content: trimmedLine.substring(0, 100) + (trimmedLine.length > 100 ? '...' : ''),
              warnings: validation.warnings
            });
          }

        } catch (parseError) {
          summary.invalidLines++;
          summary.errors.push({
            line: summary.totalLines,
            content: trimmedLine.substring(0, 100) + (trimmedLine.length > 100 ? '...' : ''),
            errors: [`JSON parse error: ${parseError.message}`]
          });
        }
      }

      if (summary.selectorStats.totalAlternatives > 0) {
        summary.selectorStats.averageReliability = parseFloat((summary.selectorStats.sumReliability / summary.selectorStats.totalAlternatives).toFixed(3));
      }

    } catch (error) {
      summary.errors.push({
        line: 0,
        content: "File processing error",
        errors: [`File validation error: ${error.message}`]
      });
    } finally {
        summary.performance.endTime = Date.now();
        summary.performance.duration = summary.performance.endTime - summary.performance.startTime;
    }

    return summary;
  }

  isValidISO8601(dateString) {
    if (typeof dateString !== 'string') return false;
    // Matches YYYY-MM-DDTHH:mm:ss or with .SSS, ending with Z
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
    if (!iso8601Regex.test(dateString)) return false;
    const timestamp = Date.parse(dateString);
    return !isNaN(timestamp);
  }

  isValidURL(url) {
    if (typeof url !== 'string') return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  isValidXPathSyntax(xpath) {
    if (typeof xpath !== 'string') return false;
    if (!xpath.startsWith('/') && !xpath.startsWith('(') && !xpath.startsWith('./')) return false; // Basic XPath sanity check
    const openBrackets = (xpath.match(/\[/g) || []).length;
    const closeBrackets = (xpath.match(/\]/g) || []).length;
    const openParens = (xpath.match(/\(/g) || []).length;
    const closeParens = (xpath.match(/\)/g) || []).length;
    
    return openBrackets === closeBrackets && openParens === closeParens;
  }

  isValidCSSSelector(selector) {
    if (typeof selector !== 'string' || selector.trim() === '') return false;
     try {
       if (typeof document !== 'undefined' && document.querySelector) {
         document.querySelector(selector); // This will throw an error for invalid selectors in browser context
       } else {
         // Basic regex for Node.js environment (less reliable)
         // Allows common characters, IDs, classes, attributes, pseudo-classes/elements
         const cssRegex = /^[a-zA-Z0-9\s_\-\.#*:,\[\]()"'=^$|~+>]+$/;
         if (!cssRegex.test(selector)) return false;
         // Further checks for balanced brackets/parentheses could be added
         const openBrackets = (selector.match(/\[/g) || []).length;
         const closeBrackets = (selector.match(/\]/g) || []).length;
         const openParens = (selector.match(/\(/g) || []).length;
         const closeParens = (selector.match(/\)/g) || []).length;
         if(openBrackets !== closeBrackets || openParens !== closeParens) return false;
       }
       return true;
     } catch {
       return false;
     }
  }
  
  hasPotentiallyGeneratedClasses(selector) {
    if (typeof selector !== 'string') return false;
    const generatedPatterns = [
      /css-[a-f0-9]{4,}/i,          // e.g., css-a1b2c3
      /\b[a-zA-Z]+_[a-zA-Z0-9]{6,}\b/i, // e.g., Modal_aBcDeF1
      /\b[a-zA-Z]{2,}-[0-9]{2,}\b/,     // e.g., sc-12345 (styled-components like but generic)
      /styled__\w+/i,               // styled__Component-sc-123
      /emotion-\d+/i,                 // emotion-0
      /glamor-\d+/i,                  // glamor-123
      /^[a-zA-Z0-9_]{10,}$/           // Very long single class name without typical separators
    ];
    
    const classParts = selector.match(/\.([\w-]+)/g) || [];
    for (const classPart of classParts) {
        const className = classPart.substring(1);
        if (className.startsWith('pswp__')) continue; // Whitelist PhotoSwipe classes
        if (className.startsWith('lg-')) continue; // Whitelist lightGallery classes

        if (generatedPatterns.some(pattern => pattern.test(className))) {
            return true;
        }
    }
    return false;
  }

  generateReport(summary) {
    const successRate = (summary.totalLines - summary.emptyLines) > 0
      ? ((summary.validLines / (summary.totalLines - summary.emptyLines)) * 100).toFixed(2)
      : 'N/A';

    let report = `\n📊 Enhanced JSONL Validation Report\n`;
    report += `${'='.repeat(60)}\n`;
    report += `File: ${summary.file}\n`;
    report += `Processing Time: ${summary.performance.duration}ms\n`;
    report += `${'-'.repeat(30)}\n`;
    report += `Total Lines Read: ${summary.totalLines}\n`;
    report += `Empty Lines Skipped: ${summary.emptyLines}\n`;
    report += `Records Processed: ${summary.totalLines - summary.emptyLines}\n`;
    report += `Valid Records: ${summary.validLines} (${successRate}%)\n`;
    report += `Invalid Records: ${summary.invalidLines}\n`;
    report += `${'-'.repeat(30)}\n\n`;

    if (summary.selectorStats) {
      report += `🎯 Selector Analysis:\n`;
      report += `CSS Selectors Found: ${summary.selectorStats.cssSelectors}\n`;
      report += `XPath Selectors Found: ${summary.selectorStats.xpathSelectors}\n`;
      report += `Records with Alternatives: ${summary.selectorStats.withAlternatives}\n`;
      if (summary.selectorStats.totalAlternatives > 0) {
        report += `Avg. Reliability of Alternatives: ${summary.selectorStats.averageReliability}\n`;
      }
      report += `${'-'.repeat(30)}\n\n`;
    }

    if (summary.errors.length > 0) {
      report += `❌ Errors (${summary.errors.length}):\n`;
      summary.errors.slice(0, 10).forEach(error => {
        report += `  Line ${error.line} (Content: "${error.content}"): ${error.errors.join(', ')}\n`;
      });
      if (summary.errors.length > 10) {
        report += `  ... and ${summary.errors.length - 10} more errors\n`;
      }
      report += '\n';
    }

    if (summary.warnings.length > 0) {
      report += `⚠️  Warnings (${summary.warnings.length}):\n`;
      summary.warnings.slice(0, 10).forEach(warning => {
        report += `  Line ${warning.line} (Content: "${warning.content}"): ${warning.warnings.join(', ')}\n`;
      });
      if (summary.warnings.length > 10) {
        report += `  ... and ${summary.warnings.length - 10} more warnings\n`;
      }
    }
    report += `${'='.repeat(60)}\n`;
    return report;
  }

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