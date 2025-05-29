const yargs = require('yargs');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs-extra');
const path = require('path');

const { PlaywrightRecorder } = require('../core/recorder');
const config = require('../../config/default.json');

class CLI {
  constructor() {
    this.recorder = null;
    this.spinner = ora();
    this.isShuttingDown = false;
    this.setupShutdownHandlers();
  }

  async run() {
    try {
      console.log(chalk.blue.bold('🎭 Playwright Codegen JSONL'));
      console.log(chalk.gray('AI-powered browser automation recording\n'));

      const argv = this.parseArguments();
      
      if (argv.interactive) {
        await this.runInteractiveMode();
      } else {
        await this.runCommandMode(argv);
      }

    } catch (error) {
      console.error(chalk.red('❌ CLI Error:'), error.message);
      process.exit(1);
    }
  }

  parseArguments() {
    const args = process.argv.slice(2);
    if (args.length > 0 && !args[0].startsWith('-')) {
      const [url, duration, browser] = args;
      return {
        url: url,
        duration: duration ? parseInt(duration, 10) : 300,
        browser: browser || 'chromium',
        headless: false,
        screenshots: true,
        video: false,
        output: './output',
        validate: true,
        interactive: false
      };
    }
    
    return yargs
      .usage('Usage: $0 [options]')
      .option('url', {
        alias: 'u',
        describe: 'Target URL to record',
        type: 'string'
      })
      .option('output', {
        alias: 'o',
        describe: 'Output directory',
        type: 'string',
        default: './output'
      })
      .option('duration', {
        alias: 'd',
        describe: 'Recording duration in seconds',
        type: 'number',
        default: 300
      })
      .option('browser', {
        alias: 'b',
        describe: 'Browser type',
        choices: ['chromium', 'firefox', 'webkit'],
        default: 'chromium'
      })
      .option('headless', {
        describe: 'Run in headless mode',
        type: 'boolean',
        default: false
      })
      .option('interactive', {
        alias: 'i',
        describe: 'Run in interactive mode',
        type: 'boolean',
        default: false
      })
      .option('screenshots', {
        describe: 'Capture screenshots',
        type: 'boolean',
        default: true
      })
      .option('video', {
        describe: 'Record video',
        type: 'boolean',
        default: false
      })
      .option('validate', {
        describe: 'Validate output in real-time',
        type: 'boolean',
        default: true
      })
      .example('$0 -u https://example.com -d 60', 'Record example.com for 60 seconds')
      .example('$0 --interactive', 'Run in interactive mode')
      .help('h')
      .alias('h', 'help')
      .version('1.0.0')
      .parse();
  }

  async runInteractiveMode() {
    console.log(chalk.yellow('🔄 Interactive Mode\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Enter target URL:',
        validate: (input) => {
          if (!input.trim()) return 'URL is required';
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      },
      {
        type: 'number',
        name: 'duration',
        message: 'Recording duration (seconds):',
        default: 300,
        validate: (input) => input > 0 && input <= 3600
      },
      {
        type: 'list',
        name: 'browser',
        message: 'Choose browser:',
        choices: ['chromium', 'firefox', 'webkit'],
        default: 'chromium'
      },
      {
        type: 'confirm',
        name: 'headless',
        message: 'Run in headless mode?',
        default: false
      },
      {
        type: 'confirm',
        name: 'screenshots',
        message: 'Capture screenshots?',
        default: true
      },
      {
        type: 'confirm',
        name: 'video',
        message: 'Record video?',
        default: false
      },
      {
        type: 'input',
        name: 'output',
        message: 'Output directory:',
        default: './output'
      }
    ]);

    await this.runRecording(answers);
  }

  async runCommandMode(argv) {
    console.log(chalk.yellow('⚡ Command Mode\n'));

    if (!argv.url) {
      console.error(chalk.red('❌ URL is required in command mode'));
      console.log('Use --interactive flag for interactive mode');
      process.exit(1);
    }

    await this.runRecording(argv);
  }

  async runRecording(options) {
    try {
      await this.ensureOutputDirectory(options.output);
      this.displayConfiguration(options);
      await this.initializeRecorder(options);
      await this.startRecordingSession(options);
      await this.displaySummary();

    } catch (error) {
      this.spinner.fail(chalk.red('Recording failed'));
      console.error(chalk.red('Error:'), error.message);
      
      if (this.recorder) {
        await this.recorder.cleanup();
      }
      
      process.exit(1);
    }
  }

  async ensureOutputDirectory(outputPath) {
    try {
      await fs.ensureDir(outputPath);
      console.log(chalk.green('📁 Output directory:'), chalk.cyan(path.resolve(outputPath)));
    } catch (error) {
      throw new Error(`Failed to create output directory: ${error.message}`);
    }
  }

  displayConfiguration(options) {
    console.log(chalk.blue('\n🎬 Recording Configuration:'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.yellow('URL:')} ${options.url}`);
    console.log(`${chalk.yellow('Duration:')} ${options.duration}s`);
    console.log(`${chalk.yellow('Browser:')} ${options.browser}`);
    console.log(`${chalk.yellow('Headless:')} ${options.headless ? 'Yes' : 'No'}`);
    console.log(`${chalk.yellow('Screenshots:')} ${options.screenshots ? 'Yes' : 'No'}`);
    console.log(`${chalk.yellow('Video:')} ${options.video ? 'Yes' : 'No'}`);
    console.log(`${chalk.yellow('Output:')} ${options.output}`);
    console.log();
  }

  async initializeRecorder(options) {
    this.spinner.start('Initializing browser...');

    const recorderOptions = {
      browserType: options.browser,
      headless: options.headless,
      recordScreenshots: options.screenshots,
      recordVideo: options.video,
      maxDuration: options.duration * 1000,
      processor: {
        outputDir: options.output,
        validateOnWrite: options.validate
      }
    };

    this.recorder = new PlaywrightRecorder(recorderOptions);
    this.setupRecorderEventListeners();
    await this.recorder.initialize();
    this.spinner.succeed('Browser initialized');
  }

  setupRecorderEventListeners() {
    let actionCount = 0;

    this.recorder.on('actionRecorded', (action) => {
      actionCount++;
      const actionText = `${action.action}${action.selector ? ` ${action.selector}` : ''}`;
      console.log(chalk.green('📝'), chalk.gray(`[${actionCount}]`), actionText);
    });

    this.recorder.on('recordingError', (error) => {
      console.log(chalk.red('⚠️  Recording error:'), error.message);
    });

    this.recorder.on('processingError', (error) => {
      console.log(chalk.red('⚠️  Processing error:'), error.message);
    });

    this.recorder.dataProcessor.on('bufferFlushed', (count) => {
      console.log(chalk.blue('💾'), `Saved ${count} actions to file`);
    });
  }

  async startRecordingSession(options) {
    console.log(chalk.green('🎬 Starting recording...'));
    console.log(chalk.gray('Press Ctrl+C to stop recording\n'));
    await this.recorder.startRecording(options.url);
    this.startProgressTracking(options.duration);
    await this.waitForRecordingComplete();
  }

 
  startProgressTracking(durationSeconds) {
    const startTime = Date.now();
    const updateInterval = 5000; 

    const progressTimer = setInterval(() => {
      if (!this.recorder.isCurrentlyRecording()) {
        clearInterval(progressTimer);
        return;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      const stats = this.recorder.getStats();

      console.log(chalk.blue('📊'), 
        `Elapsed: ${elapsed}s | Remaining: ${remaining}s | Actions: ${stats.actionsRecorded}`
      );

      if (remaining === 0) {
        clearInterval(progressTimer);
      }
    }, updateInterval);
  }


  async waitForRecordingComplete() {
    return new Promise((resolve) => {
      this.recorder.once('recordingStopped', resolve);
      const checkInterval = setInterval(() => {
        if (!this.recorder.isCurrentlyRecording()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  async displaySummary() {
    const stats = this.recorder.getStats();
    const processorStats = this.recorder.dataProcessor.getStats();

    console.log(chalk.green('\n✅ Recording completed!'));
    console.log(chalk.blue('\n📊 Session Summary:'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.yellow('Session ID:')} ${stats.sessionId}`);
    console.log(`${chalk.yellow('Duration:')} ${Math.floor(stats.sessionDuration / 1000)}s`);
    console.log(`${chalk.yellow('Actions Recorded:')} ${stats.actionsRecorded}`);
    console.log(`${chalk.yellow('Records Written:')} ${processorStats.writtenRecords}`);
    console.log(`${chalk.yellow('Processing Rate:')} ${processorStats.records_per_second}/s`);
    
    if (stats.errorsEncountered > 0) {
      console.log(`${chalk.red('Errors:')} ${stats.errorsEncountered}`);
    }
    console.log(`\n${chalk.green('📁 Output files saved in:')} ${chalk.cyan('./output')}`);
  }


  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log(chalk.yellow(`\n🛑 Received ${signal}, shutting down gracefully...`));
      
      if (this.spinner.isSpinning) {
        this.spinner.stop();
      }

      if (this.recorder && this.recorder.isCurrentlyRecording()) {
        try {
          await this.recorder.stopRecording();
          console.log(chalk.green('✅ Recording saved successfully'));
        } catch (error) {
          console.error(chalk.red('❌ Error saving recording:'), error.message);
        }
      }

      if (this.recorder) {
        await this.recorder.cleanup();
      }

      console.log(chalk.blue('👋 Goodbye!'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    process.on('uncaughtException', async (error) => {
      console.error(chalk.red('❌ Uncaught Exception:'), error);
      if (this.recorder) {
        await this.recorder.cleanup();
      }
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error(chalk.red('❌ Unhandled Rejection:'), reason);
      if (this.recorder) {
        await this.recorder.cleanup();
      }
      process.exit(1);
    });
  }
}

if (require.main === module) {
  const cli = new CLI();
  cli.run().catch(console.error);
}

module.exports = { CLI };