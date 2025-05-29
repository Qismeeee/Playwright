class SelectorGenerator {
    constructor(options = {}) {
      this.options = {
        priority: ['id', 'data-testid', 'aria-label', 'class', 'tag', 'xpath'],
        includeText: true,
        maxClassNames: 2,
        generateMultiple: true,
        ...options
      };
    }
  
    /**
     * Main entry point - generate selector cho element
     * @param {ElementHandle} element - Playwright element handle
     * @param {Page} page - Playwright page instance
     * @returns {Object} - Generated selectors với priority
     */
    async generateSelector(element, page) {
      try {
        const selectors = {
          primary: null,
          fallbacks: [],
          metadata: {}
        };
  
        const elementInfo = await this.getElementInfo(element);
        selectors.metadata = elementInfo;
  
        for (const strategy of this.options.priority) {
          const selector = await this.generateByStrategy(strategy, elementInfo, element, page);
          
          if (selector && await this.validateSelector(selector, page, element)) {
            if (!selectors.primary) {
              selectors.primary = selector;
            } else {
              selectors.fallbacks.push(selector);
            }
          }
        }
  
        if (!selectors.primary) {
          selectors.primary = await this.generateXPathSelector(element);
        }
  
        return selectors;
      } catch (error) {
        console.error('Selector generation failed:', error);
        return {
          primary: await this.generateXPathSelector(element),
          fallbacks: [],
          metadata: { error: error.message }
        };
      }
    }
  

    /**
     * Extract element information for selector generation
     * @param {ElementHandle} element 
     * @returns {Object} Element properties
     */
    async getElementInfo(element) {
      return await element.evaluate((el) => {
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          className: el.className || null,
          attributes: Array.from(el.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {}),
          text: el.textContent?.trim()?.substring(0, 50) || null,
          innerHTML: el.innerHTML?.substring(0, 100) || null,
          position: {
            x: el.getBoundingClientRect().x,
            y: el.getBoundingClientRect().y
          },
          visible: el.offsetParent !== null,
          parentTagName: el.parentElement?.tagName?.toLowerCase() || null
        };
      });
    }
  
    /**
     * Generate selector theo specific strategy
     * @param {string} strategy - Selector strategy
     * @param {Object} elementInfo - Element properties
     * @param {ElementHandle} element - Element handle
     * @param {Page} page - Page instance
     * @returns {string|null} Generated selector
     */
    async generateByStrategy(strategy, elementInfo, element, page) {
      switch (strategy) {
        case 'id':
          return elementInfo.id ? `#${elementInfo.id}` : null;
  
        case 'data-testid':
          return elementInfo.attributes['data-testid'] 
            ? `[data-testid="${elementInfo.attributes['data-testid']}"]` 
            : null;
  
        case 'aria-label':
          return elementInfo.attributes['aria-label']
            ? `[aria-label="${elementInfo.attributes['aria-label']}"]`
            : null;
  
        case 'class':
          return this.generateClassSelector(elementInfo);
  
        case 'tag':
          return this.generateTagSelector(elementInfo);
  
        case 'xpath':
          return await this.generateXPathSelector(element);
  
        default:
          return null;
      }
    }
  
    /**
     * Generate class-based selector với smart filtering
     * @param {Object} elementInfo 
     * @returns {string|null}
     */
    generateClassSelector(elementInfo) {
      if (!elementInfo.className) return null;
  
      const classes = elementInfo.className
        .split(/\s+/)
        .filter(cls => cls.length > 0)
        .filter(cls => !this.isGeneratedClass(cls))
        .slice(0, this.options.maxClassNames);
  
      if (classes.length === 0) return null;
  
      const classSelector = classes.map(cls => `.${cls}`).join('');
      return `${elementInfo.tagName}${classSelector}`;
    }
  
    /**
     * Check if class name is auto-generated (CSS-in-JS, etc.)
     * @param {string} className 
     * @returns {boolean}
     */
    isGeneratedClass(className) {
      const patterns = [
        /^css-[a-z0-9]+$/i,     
        /^[a-z]+-[0-9]+$/i,     
        /^_[a-z0-9]+$/i,       
        /^[A-Z][a-zA-Z]+-[a-z0-9]+$/ 
      ];
  
      return patterns.some(pattern => pattern.test(className));
    }
  
    /**
     * Generate tag-based selector với context
     * @param {Object} elementInfo 
     * @returns {string}
     */
    generateTagSelector(elementInfo) {
      let selector = elementInfo.tagName;
      if (this.options.includeText && elementInfo.text) {
        const textContent = elementInfo.text.replace(/"/g, '\\"');
        selector += `:has-text("${textContent}")`;
      }
      if (elementInfo.attributes.type) {
        selector += `[type="${elementInfo.attributes.type}"]`;
      }
  
      return selector;
    }
  
    /**
     * Generate XPath selector as fallback
     * @param {ElementHandle} element 
     * @returns {string}
     */
    async generateXPathSelector(element) {
      return await element.evaluate((el) => {
        const getElementXPath = (element) => {
          if (element.id !== '') {
            return `//*[@id="${element.id}"]`;
          }
          
          if (element === document.body) {
            return '/html/body';
          }
  
          let ix = 0;
          const siblings = element.parentNode?.childNodes || [];
          
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === element) {
              const tagName = element.tagName.toLowerCase();
              return `${getElementXPath(element.parentNode)}/${tagName}[${ix + 1}]`;
            }
            if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
              ix++;
            }
          }
        };
  
        return getElementXPath(el);
      });
    }
  
    /**
     * Validate selector uniqueness và functionality
     * @param {string} selector 
     * @param {Page} page 
     * @param {ElementHandle} originalElement 
     * @returns {boolean}
     */
    async validateSelector(selector, page, originalElement) {
      try {
        const elements = await page.$$(selector);
        if (elements.length !== 1) {
          return false;
        }
        const isSame = await page.evaluate(
          ([sel, orig]) => {
            const found = document.querySelector(sel);
            return found === orig;
          },
          [selector, originalElement]
        );
  
        return isSame;
      } catch (error) {
        return false;
      }
    }
  
    /**
     * Get best selector from generated options
     * @param {Object} selectors 
     * @returns {string}
     */
    getBestSelector(selectors) {
      return selectors.primary || selectors.fallbacks[0] || 'unknown';
    }
  
    /**
     * Generate selector cho text content
     * @param {string} text 
     * @returns {string}
     */
    generateTextSelector(text) {
      const cleanText = text.replace(/"/g, '\\"').substring(0, 30);
      return `text=${cleanText}`;
    }
  }
  
  module.exports = { SelectorGenerator };