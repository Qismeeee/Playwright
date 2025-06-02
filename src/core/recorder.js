const { chromium, firefox, webkit } = require('playwright');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { SelectorGenerator } = require('../utils/selector');
const { DataProcessor } = require('./processor');

class PlaywrightRecorder extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      browserType: 'chromium',
      headless: false,
      slowMo: 100,
      viewport: { width: 1280, height: 720 },
      recordVideo: false,
      recordScreenshots: true,
      maxDuration: 300000,
      ...options
    };

    this.browser = null;
    this.context = null;
    this.page = null;
    this.selectorGenerator = new SelectorGenerator();
    this.dataProcessor = new DataProcessor(options.processor || {});

    this.sessionId = uuidv4();
    this.isRecording = false;
    this.startTime = null;
    this.recordingTimeout = null;

    this.lastActions = {
      click: { selector: null, timestamp: 0 },
      navigate: { url: null, timestamp: 0 },
      fill: { selector: null, value: null, timestamp: 0 }
    };

    this.inputDebounceMap = new Map();

    this.stats = {
      actionsRecorded: 0,
      errorsEncountered: 0,
      sessionDuration: 0
    };

    console.log(`🎬 Recorder initialized with session ID: ${this.sessionId}`);
  }

  async initialize() {
    try {
      console.log('🚀 Initializing browser...');
      
      const browserEngine = this.getBrowserEngine();
      
      this.browser = await browserEngine.launch({
        headless: this.options.headless,
        slowMo: this.options.slowMo,
        devtools: !this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--no-first-run',
          '--disable-default-apps'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: this.options.viewport,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        recordVideo: this.options.recordVideo ? { 
          dir: './output/videos/' 
        } : undefined,
        recordHar: { path: `./output/hars/${this.sessionId}.har` },
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      this.page = await this.context.newPage();

      await this.setupEventListeners();

      await this.dataProcessor.start();

      console.log('✅ Browser initialized successfully');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Failed to initialize browser:', error);
      await this.cleanup();
      throw error;
    }
  }

  getBrowserEngine() {
    switch (this.options.browserType.toLowerCase()) {
      case 'firefox':
        return firefox;
      case 'webkit':
      case 'safari':
        return webkit;
      case 'chromium':
      case 'chrome':
      default:
        return chromium;
    }
  }

  async setupEventListeners() {
    console.log('📡 Setting up event listeners...');

    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page.mainFrame()) {
        const currentUrl = frame.url();
        const currentTime = Date.now();
        
        if (currentUrl === this.lastActions.navigate.url && 
            (currentTime - this.lastActions.navigate.timestamp) < 3000) {
          return;
        }
        
        this.lastActions.navigate.url = currentUrl;
        this.lastActions.navigate.timestamp = currentTime;
        
        await this.recordAction({
          action: 'navigate',
          url: currentUrl,
          timestamp: new Date().toISOString(),
          generatedCode: `await page.goto('${currentUrl}');`
        });
      }
    });

    await this.page.addInitScript(() => {
      document.addEventListener('click', (event) => {
        window._playwrightRecorderClicks = window._playwrightRecorderClicks || [];
        window._playwrightRecorderClicks.push({
          target: event.target,
          timestamp: Date.now(),
          x: event.clientX,
          y: event.clientY
        });
      });

      document.addEventListener('input', (event) => {
        window._playwrightRecorderInputs = window._playwrightRecorderInputs || [];
        window._playwrightRecorderInputs.push({
          target: event.target,
          value: event.target.value,
          timestamp: Date.now()
        });
      });
    });

    setInterval(async () => {
      if (!this.isRecording) return;
      
      try {
        const clicks = await this.page.evaluate(() => {
          const clicks = window._playwrightRecorderClicks || [];
          window._playwrightRecorderClicks = [];
          return clicks.map(click => ({
            timestamp: click.timestamp,
            x: click.x,
            y: click.y
          }));
        });

        for (const click of clicks) {
          await this.processClickEvent(click);
        }

        const inputs = await this.page.evaluate(() => {
          const inputs = window._playwrightRecorderInputs || [];
          window._playwrightRecorderInputs = [];
          return inputs.map(input => ({
            value: input.value,
            timestamp: input.timestamp,
            target: {
              tagName: input.target.tagName,
              id: input.target.id,
              className: input.target.className,
              type: input.target.type,
              name: input.target.name
            }
          }));
        });

        for (const input of inputs) {
          await this.processInputEvent(input);
        }

      } catch (error) {
        if (!error.message.includes('Execution context was destroyed')) {
          console.error('Error processing events:', error);
        }
      }
    }, 1000);

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Page console error:', msg.text());
      }
    });

    this.page.on('pageerror', (error) => {
      console.error('Page error:', error);
    });

    console.log('✅ Event listeners setup complete');
  }

  async processClickEvent(clickData) {
    try {
      const elementData = await this.page.evaluate(({x, y}) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;
        
        const getElementXPath = (el) => {
          if (el.id) return `//*[@id="${el.id}"]`;
          if (el === document.body) return '/html/body';
          
          let ix = 0;
          const siblings = el.parentNode?.childNodes || [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === el) {
              const tagName = el.tagName.toLowerCase();
              const parentXPath = getElementXPath(el.parentNode);
              return `${parentXPath}/${tagName}[${ix + 1}]`;
            }
            if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
              ix++;
            }
          }
          return null;
        };

        const getTextBasedXPath = (el) => {
          const text = el.textContent?.trim();
          if (text && text.length > 0 && text.length < 50) {
            const tagName = el.tagName.toLowerCase();
            return `//${tagName}[text()="${text}"]`;
          }
          return null;
        };

        const getAttributeXPath = (el) => {
          if (el.getAttribute('name')) {
            return `//*[@name="${el.getAttribute('name')}"]`;
          }
          if (el.getAttribute('type')) {
            const tagName = el.tagName.toLowerCase();
            return `//${tagName}[@type="${el.getAttribute('type')}"]`;
          }
          return null;
        };
        
        return {
          tagName: element.tagName.toLowerCase(),
          id: element.id || null,
          className: element.className || null,
          text: element.textContent?.trim()?.substring(0, 50) || null,
          attributes: Array.from(element.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {}),
          xpath: {
            position: getElementXPath(element),
            text: getTextBasedXPath(element),
            attribute: getAttributeXPath(element)
          },
          offsetParent: element.offsetParent ? element.offsetParent.tagName : null
        };
      }, {x: clickData.x, y: clickData.y});

      if (!elementData) return;

      console.log('Element data for selector generation:', elementData);

      const selectors = this.generateAllSelectors(elementData);
      
      console.log('Generated selectors:', selectors);

      const currentTime = Date.now();
      
      if (selectors.primary === this.lastActions.click.selector && 
          (currentTime - this.lastActions.click.timestamp) < 1000) {
        return;
      }
      
      this.lastActions.click.selector = selectors.primary;
      this.lastActions.click.timestamp = currentTime;
      
      await this.recordAction({
        action: 'click',
        selector: selectors.primary,
        selector_alternatives: selectors.alternatives,
        url: this.page.url(),
        timestamp: new Date(clickData.timestamp).toISOString(),
        generatedCode: `await page.click('${selectors.primary}');`,
        elementInfo: {
          position: { x: clickData.x, y: clickData.y },
          ...elementData
        }
      });
    } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) {
        console.error('Error processing click:', error.message);
      }
    }
  }

  async processInputEvent(inputData) {
    try {
      const elementData = {
        tagName: inputData.target.tagName?.toLowerCase() || 'input',
        id: inputData.target.id || null,
        className: inputData.target.className || null,
        attributes: {
          name: inputData.target.name,
          type: inputData.target.type
        },
        text: null,
        xpath: {
          attribute: inputData.target.name ? `//*[@name="${inputData.target.name}"]` : null,
          position: null,
          text: null
        }
      };

      const selectors = this.generateAllSelectors(elementData);
      const inputKey = `${selectors.primary}_${inputData.value}`;

      if (this.inputDebounceMap.has(selectors.primary)) {
        clearTimeout(this.inputDebounceMap.get(selectors.primary));
      }

      this.inputDebounceMap.set(selectors.primary, setTimeout(async () => {
        const currentTime = Date.now();
        
        if (selectors.primary === this.lastActions.fill.selector && 
            inputData.value === this.lastActions.fill.value &&
            (currentTime - this.lastActions.fill.timestamp) < 2000) {
          return;
        }

        if (inputData.value.length < 2) return;
        
        this.lastActions.fill.selector = selectors.primary;
        this.lastActions.fill.value = inputData.value;
        this.lastActions.fill.timestamp = currentTime;
        
        await this.recordAction({
          action: 'fill',
          selector: selectors.primary,
          selector_alternatives: selectors.alternatives,
          value: inputData.value,
          url: this.page.url(),
          timestamp: new Date(inputData.timestamp).toISOString(),
          generatedCode: `await page.fill('${selectors.primary}', '${inputData.value}');`,
          elementInfo: inputData.target
        });

        this.inputDebounceMap.delete(selectors.primary);
      }, 1500));

    } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) {
        console.error('Error processing input:', error.message);
      }
    }
  }

  generateAllSelectors(elementData) {
    const selectors = [];
    
    if (elementData.id) {
      selectors.push({
        type: 'css_id',
        value: `#${elementData.id}`,
        priority: 1,
        reliability: 0.95
      });
      selectors.push({
        type: 'xpath_id',
        value: `//*[@id="${elementData.id}"]`,
        priority: 1,
        reliability: 0.95
      });
    }
    
    if (elementData.attributes && elementData.attributes['data-testid']) {
      const testId = elementData.attributes['data-testid'];
      selectors.push({
        type: 'css_testid',
        value: `[data-testid="${testId}"]`,
        priority: 2,
        reliability: 0.9
      });
      selectors.push({
        type: 'xpath_testid',
        value: `//*[@data-testid="${testId}"]`,
        priority: 2,
        reliability: 0.9
      });
    }

    if (elementData.attributes && elementData.attributes['name']) {
      const name = elementData.attributes['name'];
      selectors.push({
        type: 'css_name',
        value: `[name="${name}"]`,
        priority: 3,
        reliability: 0.85
      });
      selectors.push({
        type: 'xpath_name',
        value: `//*[@name="${name}"]`,
        priority: 3,
        reliability: 0.85
      });
    }

    if (elementData.attributes && elementData.attributes['type']) {
      const type = elementData.attributes['type'];
      selectors.push({
        type: 'css_type',
        value: `${elementData.tagName}[type="${type}"]`,
        priority: 4,
        reliability: 0.8
      });
      selectors.push({
        type: 'xpath_type',
        value: `//${elementData.tagName}[@type="${type}"]`,
        priority: 4,
        reliability: 0.8
      });
    }

    if (elementData.text && elementData.text.length > 0 && elementData.text.length < 30) {
      const text = elementData.text.replace(/"/g, '\\"');
      selectors.push({
        type: 'xpath_text',
        value: `//${elementData.tagName}[text()="${text}"]`,
        priority: 5,
        reliability: 0.75
      });
      selectors.push({
        type: 'xpath_contains_text',
        value: `//${elementData.tagName}[contains(text(),"${text}")]`,
        priority: 6,
        reliability: 0.7
      });
    }
    
    if (elementData.className) {
      const classes = elementData.className.split(' ').filter(cls => 
        cls.length > 2 && !cls.match(/^[a-z]+-[0-9]+$/) && !cls.match(/^css-[a-z0-9]+$/i)
      );
      if (classes.length > 0) {
        const firstClass = classes[0];
        selectors.push({
          type: 'css_class',
          value: `${elementData.tagName}.${firstClass}`,
          priority: 7,
          reliability: 0.6
        });
        selectors.push({
          type: 'xpath_class',
          value: `//${elementData.tagName}[@class="${firstClass}"]`,
          priority: 7,
          reliability: 0.6
        });
      }
    }

    if (elementData.xpath) {
      if (elementData.xpath.attribute) {
        selectors.push({
          type: 'xpath_attribute',
          value: elementData.xpath.attribute,
          priority: 8,
          reliability: 0.75
        });
      }
      
      if (elementData.xpath.text) {
        selectors.push({
          type: 'xpath_text_exact',
          value: elementData.xpath.text,
          priority: 5,
          reliability: 0.75
        });
      }
      
      if (elementData.xpath.position) {
        selectors.push({
          type: 'xpath_position',
          value: elementData.xpath.position,
          priority: 10,
          reliability: 0.4
        });
      }
    }

    selectors.push({
      type: 'css_tag',
      value: elementData.tagName,
      priority: 11,
      reliability: 0.3
    });

    selectors.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.reliability - a.reliability;
    });

    return {
      primary: selectors[0]?.value || elementData.tagName,
      alternatives: selectors.slice(1, 6).map(s => ({
        selector: s.value,
        type: s.type,
        reliability: s.reliability
      }))
    };
  }

  async recordAction(actionData) {
    if (!this.isRecording) return;

    try {
      console.log('Recording action with data:', actionData);

      const enrichedAction = {
        ...actionData,
        session_id: this.sessionId,
        viewport: this.options.viewport
      };

      if (actionData.action !== 'navigate') {
        try {
          const userAgent = await this.page.evaluate(() => navigator.userAgent).catch(() => 'unknown');
          const title = await this.page.title().catch(() => 'unknown');
          
          enrichedAction.browserInfo = {
            userAgent: userAgent,
            url: this.page.url(),
            title: title
          };
        } catch (error) {
          enrichedAction.browserInfo = {
            userAgent: 'context-destroyed',
            url: this.page.url(),
            title: 'unknown'
          };
        }
      }

      if (this.options.recordScreenshots && actionData.action !== 'navigate') {
        try {
          enrichedAction.screenshot = await this.captureScreenshot();
        } catch (error) {
        }
      }

      console.log('Enriched action before processor:', enrichedAction);

      await this.dataProcessor.processAction(enrichedAction);
      
      this.stats.actionsRecorded++;
      this.emit('actionRecorded', enrichedAction);

      console.log(`📝 Recorded: ${actionData.action} ${actionData.selector || actionData.url}`);

    } catch (error) {
      console.error('Failed to record action:', error);
      this.stats.errorsEncountered++;
      this.emit('recordingError', error, actionData);
    }
  }

  async captureScreenshot() {
    try {
      const screenshot = await this.page.screenshot({
        type: 'png',
        fullPage: false
      });
      return screenshot.toString('base64');
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      return null;
    }
  }

  async startRecording(url = null) {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    try {
      console.log('🎬 Starting recording session...');
      
      this.isRecording = true;
      this.startTime = Date.now();

      if (url) {
        console.log(`🌐 Navigating to: ${url}`);
        await this.page.goto(url, { waitUntil: 'networkidle' });
      }

      if (this.options.maxDuration > 0) {
        this.recordingTimeout = setTimeout(() => {
          console.log('⏰ Recording timeout reached, stopping...');
          this.stopRecording();
        }, this.options.maxDuration);
      }

      this.emit('recordingStarted', { sessionId: this.sessionId, url });
      console.log('✅ Recording started successfully');

    } catch (error) {
      this.isRecording = false;
      console.error('❌ Failed to start recording:', error);
      throw error;
    }
  }

  async stopRecording() {
    if (!this.isRecording) {
      console.log('⚠️  No active recording to stop');
      return;
    }

    try {
      console.log('🛑 Stopping recording session...');
      
      this.isRecording = false;
      
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
        this.recordingTimeout = null;
      }

      this.stats.sessionDuration = Date.now() - this.startTime;

      await this.dataProcessor.stop();

      const summary = this.generateSessionSummary();
      
      this.emit('recordingStopped', summary);
      console.log('✅ Recording stopped successfully');
      
      return summary;

    } catch (error) {
      console.error('❌ Error stopping recording:', error);
      throw error;
    }
  }

  generateSessionSummary() {
    return {
      sessionId: this.sessionId,
      duration: this.stats.sessionDuration,
      actionsRecorded: this.stats.actionsRecorded,
      errorsEncountered: this.stats.errorsEncountered,
      processorStats: this.dataProcessor.getStats(),
      startTime: this.startTime,
      endTime: Date.now()
    };
  }

  getPage() {
    return this.page;
  }

  getBrowser() {
    return this.browser;
  }

  isCurrentlyRecording() {
    return this.isRecording;
  }

  getStats() {
    return {
      ...this.stats,
      sessionId: this.sessionId,
      isRecording: this.isRecording,
      sessionDuration: this.isRecording ? Date.now() - this.startTime : this.stats.sessionDuration
    };
  }

  async cleanup() {
    try {
      console.log('🧹 Cleaning up recorder resources...');

      if (this.isRecording) {
        await this.stopRecording();
      }

      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.page = null;
      }

      if (this.dataProcessor) {
        await this.dataProcessor.cleanup();
      }

      console.log('✅ Cleanup completed');
      this.emit('cleanupComplete');

    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      this.emit('cleanupError', error);
    }
  }
}

module.exports = { PlaywrightRecorder };