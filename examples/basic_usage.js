const { PlaywrightRecorder } = require('../src/core/recorder');

async function basicRecording() {
  const recorder = new PlaywrightRecorder({
    browserType: 'chromium',
    headless: false,
    recordScreenshots: true,
    processor: {
      outputDir: './examples/output',
      validateOnWrite: true
    }
  });

  await recorder.initialize();
  await recorder.startRecording('https://httpbin.org/forms/post');
  
  setTimeout(async () => {
    const summary = await recorder.stopRecording();
    await recorder.cleanup();
    console.log('Recording completed:', summary);
  }, 30000);
}

async function programmaticRecording() {
  const recorder = new PlaywrightRecorder({
    browserType: 'chromium',
    headless: true
  });

  try {
    await recorder.initialize();
    await recorder.startRecording();
    
    const page = recorder.getPage();

    await page.goto('https://httpbin.org/forms/post');
    await page.fill('[name="custname"]', 'John Doe');
    await page.fill('[name="custtel"]', '123-456-7890'); 
    await page.fill('[name="custemail"]', 'john@example.com');
    await page.click('input[value="Submit"]');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const summary = await recorder.stopRecording();
    await recorder.cleanup();
    
    console.log('Programmatic recording completed:', summary);
  } catch (error) {
    console.error('Recording failed:', error.message);
    await recorder.cleanup();
  }
}

async function validateJSONL() {
  const { JSONLValidator } = require('../src/utils/validator');
  const validator = new JSONLValidator();
  
  const path = require('path');
  const fs = require('fs');
  const outputDir = path.resolve(__dirname, '../output');
  
  try {
    const files = fs.readdirSync(outputDir)
      .filter(file => file.startsWith('actions-') && file.endsWith('.jsonl'))
      .map(file => path.join(outputDir, file));
    
    if (files.length === 0) {
      console.log('No JSONL files found in the output directory');
      return;
    }
    for (const file of files) {
      console.log(`Validating ${path.basename(file)}...`);
      const result = await validator.validateFile(file);
      console.log(validator.generateReport(result));
    }
  } catch (error) {
    console.error(`Error validating files: ${error.message}`);
  }
}

if (require.main === module) {
  const mode = process.argv[2] || 'basic';
  
  switch(mode) {
    case 'basic':
      basicRecording();
      break;
    case 'programmatic':
      programmaticRecording();
      break;
    case 'validate':
      validateJSONL();
      break;
  }
}