const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');
const { JSONLValidator } = require('../utils/validator');

class DataProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      batchSize: 100,          
      flushInterval: 5000,     
      maxBufferSize: 1000,      
      outputDir: './output',
      compression: false,
      validateOnWrite: true,
      enableMetadata: false,
      ...options
    };

    this.buffer = [];
    this.stats = {
      processedRecords: 0,
      writtenRecords: 0,
      errorCount: 0,
      startTime: Date.now(),
      lastFlush: Date.now()
    };

    this.validator = new JSONLValidator();
    this.outputStream = null;
    this.flushTimer = null;
    this.initializeOutputDir();
    this.setupAutoFlush();
  }

  async initializeOutputDir() {
    try {
      await fs.ensureDir(this.options.outputDir);
      console.log(`📁 Output directory ready: ${this.options.outputDir}`);
    } catch (error) {
      console.error('Failed to create output directory:', error);
      throw error;
    }
  }

  /**
   * Setup auto-flush timer
   */
  setupAutoFlush() {
    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flushBuffer();
      }
    }, this.options.flushInterval);
  }

  /**
   * Process single action record
   * @param {Object} rawAction 
   * @returns {Promise<Object>} 
   */
  async processAction(rawAction) {
    try {
      this.stats.processedRecords++;

      const processedRecord = await this.transformAction(rawAction);
      if (this.options.enableMetadata) {
        processedRecord.metadata = await this.generateMetadata(rawAction, processedRecord);
      }
      if (this.options.validateOnWrite) {
        const validation = this.validator.validateRecord(processedRecord);
        if (!validation.valid) {
          throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
        if (validation.warnings.length > 0) {
          console.warn(`⚠️  Record warnings: ${validation.warnings.join(', ')}`);
        }
      }

      await this.addToBuffer(processedRecord);
      this.emit('recordProcessed', processedRecord);
      return processedRecord;

    } catch (error) {
      this.stats.errorCount++;
      console.error('Failed to process action:', error);
      this.emit('processingError', error, rawAction);
      throw error;
    }
  }

  /**
   * Transform raw action to JSONL format
   * @param {Object} rawAction 
   * @returns {Object} Transformed record
   */
  async transformAction(rawAction) {
    const record = {
      timestamp: rawAction.timestamp || new Date().toISOString(),
      action: rawAction.action,
      url: rawAction.url,
      generated_code: rawAction.generatedCode
    };

    if (rawAction.selector) {
      record.selector = rawAction.selector;
    }

    if (rawAction.value !== undefined && rawAction.value !== null) {
      record.value = rawAction.value;
    }

    // Remove any undefined fields
    Object.keys(record).forEach(key => {
      if (record[key] === undefined) {
        delete record[key];
      }
    });

    return record;
  }

  /**
   * Generate metadata for record
   * @param {Object} rawAction 
   * @param {Object} processedRecord 
   * @returns {Object} 
   */
  async generateMetadata(rawAction, processedRecord) {
    // Return empty object to disable metadata
    return {};
  }

  /**
   * Add record to buffer với memory management
   * @param {Object} record 
   */
  async addToBuffer(record) {
    this.buffer.push(record);
    if (this.buffer.length >= this.options.batchSize) {
      await this.flushBuffer();
    }
    if (this.buffer.length >= this.options.maxBufferSize) {
      console.warn('⚠️  Buffer size limit reached, forcing flush');
      await this.flushBuffer();
    }
  }

  /**
   * Flush buffer to file
   * @param {boolean} force
   */
  async flushBuffer(force = false) {
    if (this.buffer.length === 0) return;

    if (!force && this.buffer.length < this.options.batchSize) {
      const timeSinceLastFlush = Date.now() - this.stats.lastFlush;
      if (timeSinceLastFlush < this.options.flushInterval) {
        return; 
      }
    }

    try {
      const recordsToWrite = [...this.buffer];
      this.buffer = []; 

      await this.writeRecords(recordsToWrite);
      
      this.stats.writtenRecords += recordsToWrite.length;
      this.stats.lastFlush = Date.now();

      console.log(`💾 Flushed ${recordsToWrite.length} records to file`);
      this.emit('bufferFlushed', recordsToWrite.length);

    } catch (error) {
      console.error('Failed to flush buffer:', error);
      this.buffer.unshift(...recordsToWrite);
      this.emit('flushError', error);
      throw error;
    }
  }

  /**
   * Write records to JSONL file
   * @param {Array} records
   */
  async writeRecords(records) {
    if (records.length === 0) return;

    const fileName = this.generateFileName();
    const filePath = path.join(this.options.outputDir, fileName);

    try {
      const jsonlContent = records
        .map(record => JSON.stringify(record))
        .join('\n') + '\n';
      await fs.appendFile(filePath, jsonlContent, 'utf8');
      console.log(`📝 Written ${records.length} records to ${fileName}`);

    } catch (error) {
      console.error(`Failed to write records to ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Generate output file name
   * @returns {string} 
   */
  generateFileName() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    return `actions-${dateStr}-${timeStr}.jsonl`;
  }

  /**
   * Process batch of actions
   * @param {Array} actions 
   * @returns {Promise<Array>} 
   */
  async processBatch(actions) {
    const processed = [];
    const errors = [];

    for (const action of actions) {
      try {
        const record = await this.processAction(action);
        processed.push(record);
      } catch (error) {
        errors.push({ action, error });
      }
    }

    if (errors.length > 0) {
      console.warn(`⚠️  ${errors.length} actions failed processing in batch`);
      this.emit('batchErrors', errors);
    }

    return processed;
  }

  /**
   * Get processing statistics
   * @returns {Object} 
   */
  getStats() {
    const now = Date.now();
    const duration = now - this.stats.startTime;
    const recordsPerSecond = duration > 0 ? (this.stats.processedRecords / (duration / 1000)).toFixed(2) : 0;

    return {
      ...this.stats,
      duration_ms: duration,
      records_per_second: recordsPerSecond,
      buffer_size: this.buffer.length,
      memory_usage: process.memoryUsage()
    };
  }

  /**
   * Export buffer contents (for debugging)
   * @returns {Array}
   */
  exportBuffer() {
    return [...this.buffer];
  }

  /**
   * Clear buffer without writing
   */
  clearBuffer() {
    const cleared = this.buffer.length;
    this.buffer = [];
    console.log(`🗑️  Cleared ${cleared} records from buffer`);
    this.emit('bufferCleared', cleared);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
      if (this.buffer.length > 0) {
        console.log('🔄 Flushing remaining buffer before cleanup...');
        await this.flushBuffer(true);
      }
      if (this.outputStream) {
        this.outputStream.end();
        this.outputStream = null;
      }

      console.log('✅ Data processor cleanup completed');
      this.emit('cleanupComplete');

    } catch (error) {
      console.error('Cleanup failed:', error);
      this.emit('cleanupError', error);
    }
  }

  /**
   * Start processing (initialize streams, timers, etc.)
   */
  async start() {
    console.log('🚀 Starting data processor...');
    this.stats.startTime = Date.now();
    this.emit('processorStarted');
  }

  /**
   * Stop processing gracefully
   */
  async stop() {
    console.log('🛑 Stopping data processor...');
    await this.cleanup();
    this.emit('processorStopped');
  }
}

module.exports = { DataProcessor };