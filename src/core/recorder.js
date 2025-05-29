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
              type: input.target.type
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

    this.page.on('input', async (event) => {
      try {
        const element = event.target;
        const value = await element.inputValue();
        const selectorInfo = await this.selectorGenerator.generateSelector(element, this.page);

        await this.recordAction({
          action: 'fill',
          selector: selectorInfo.primary,
          value: value,
          url: this.page.url(),
          timestamp: new Date().toISOString(),
          generatedCode: `await page.fill('${selectorInfo.primary}', '${value}');`,
          elementInfo: await this.getElementInfo(element)
        });
      } catch (error) {
        console.error('Error recording input event:', error);
        this.stats.errorsEncountered++;
      }
    });

    this.page.on('hover', async (event) => {
      try {
        const element = event.target;
        const selectorInfo = await this.selectorGenerator.generateSelector(element, this.page);

        await this.recordAction({
          action: 'hover',
          selector: selectorInfo.primary,
          url: this.page.url(),
          timestamp: new Date().toISOString(),
          generatedCode: `await page.hover('${selectorInfo.primary}');`,
          elementInfo: await this.getElementInfo(element)
        });
      } catch (error) {
        console.error('Error recording hover event:', error);
        this.stats.errorsEncountered++;
      }
    });

    this.page.on('keydown', async (event) => {
      const specialKeys = ['Enter', 'Tab', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F5'];
      
      if (specialKeys.includes(event.key)) {
        await this.recordAction({
          action: 'press',
          value: event.key,
          url: this.page.url(),
          timestamp: new Date().toISOString(),
          generatedCode: `await page.keyboard.press('${event.key}');`
        });
      }
    });

    this.page.on('change', async (event) => {
      try {
        const element = event.target;
        const tagName = await element.tagName();
        
        if (tagName.toLowerCase() === 'select') {
          const value = await element.inputValue();
          const selectorInfo = await this.selectorGenerator.generateSelector(element, this.page);

          await this.recordAction({
            action: 'select',
            selector: selectorInfo.primary,
            value: value,
            url: this.page.url(),
            timestamp: new Date().toISOString(),
            generatedCode: `await page.selectOption('${selectorInfo.primary}', '${value}');`,
            elementInfo: await this.getElementInfo(element)
          });
        }
      } catch (error) {
        console.error('Error recording select event:', error);
        this.stats.errorsEncountered++;
      }
    });

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Page console error:', msg.text());
      }
    });

    this.page.on('pageerror', (error) => {
      console.error('Page error:', error);
    });

    console.log('Event listeners setup complete');
  }

  async recordAction(actionData) {
    if (!this.isRecording) return;

    try {
      const enrichedAction = {
        ...actionData,
        sessionId: this.sessionId,
        viewport: this.options.viewport
      };

      if (actionData.action !== 'navigate') {
        try {
          const userAgent = await this.page.evaluate(() => navigator.userAgent).catch(() => 'unknown');
          const title = await this.page.title().catch(() => 'unknown');
          const currentUrl = this.page && !this.page.isClosed() ? this.page.url() : 'unknown';
          
          enrichedAction.browserInfo = {
            userAgent: userAgent,
            url: currentUrl,
            title: title
          };
        } catch (error) {
          enrichedAction.browserInfo = {
            userAgent: 'context-destroyed',
            url: 'unknown',
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
  async processClickEvent(clickData) {
    try {
      const elementData = await this.page.evaluate(({x, y}) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;
        
        return {
          tagName: element.tagName.toLowerCase(),
          id: element.id || null,
          className: element.className || null,
          text: element.textContent?.trim()?.substring(0, 50) || null,
          attributes: Array.from(element.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {})
        };
      }, {x: clickData.x, y: clickData.y});

      if (!elementData) return;
      const selector = this.generateSelectorFromData(elementData);
      
      await this.recordAction({
        action: 'click',
        selector: selector,
        url: this.page.url(),
        timestamp: new Date(clickData.timestamp).toISOString(),
        generatedCode: `await page.click('${selector}');`,
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
      const selector = this.generateSelectorFromData(inputData.target);
      const inputKey = `${selector}_${inputData.value}`;

      if (this.inputDebounceMap.has(selector)) {
        clearTimeout(this.inputDebounceMap.get(selector));
      }

      this.inputDebounceMap.set(selector, setTimeout(async () => {
        const currentTime = Date.now();
        
        if (selector === this.lastActions.fill.selector && 
            inputData.value === this.lastActions.fill.value &&
            (currentTime - this.lastActions.fill.timestamp) < 2000) {
          return;
        }

        if (inputData.value.length < 2) return;
        
        this.lastActions.fill.selector = selector;
        this.lastActions.fill.value = inputData.value;
        this.lastActions.fill.timestamp = currentTime;
        
        await this.recordAction({
          action: 'fill',
          selector: selector,
          value: inputData.value,
          url: this.page.url(),
          timestamp: new Date(inputData.timestamp).toISOString(),
          generatedCode: `await page.fill('${selector}', '${inputData.value}');`,
          elementInfo: inputData.target
        });

        this.inputDebounceMap.delete(selector);
      }, 1500));

    } catch (error) {
      if (!error.message.includes('Execution context was destroyed')) {
        console.error('Error processing input:', error.message);
      }
    }
  }

  generateSelectorFromData(elementData) {
    if (elementData.id) {
      return `#${elementData.id}`;
    }
    
    if (elementData.attributes && elementData.attributes['data-testid']) {
      return `[data-testid="${elementData.attributes['data-testid']}"]`;
    }
    
    if (elementData.className) {
      const firstClass = elementData.className.split(' ')[0];
      return `${elementData.tagName}.${firstClass}`;
    }
    
    return elementData.tagName || 'unknown';
  }
  async getElementInfo(element) {
    try {
      return await element.evaluate((el) => ({
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        text: el.textContent?.trim()?.substring(0, 100) || null,
        attributes: Array.from(el.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        position: {
          x: Math.round(el.getBoundingClientRect().x),
          y: Math.round(el.getBoundingClientRect().y),
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height)
        },
        visible: el.offsetParent !== null,
        focused: el === document.activeElement
      }));
    } catch (error) {
      console.error('Error getting element info:', error);
      return { error: error.message };
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