# Implementation Guide

## Installation

```bash
npm install
npx playwright install chromium
```

## Basic Usage

### CLI Mode
```bash
npm start -- -u https://example.com -d 60 -b chromium
npm start -- --interactive
```

### Programmatic Mode
```javascript
const { PlaywrightRecorder } = require('./src/core/recorder');

const recorder = new PlaywrightRecorder({
  browserType: 'chromium',
  headless: false,
  recordScreenshots: true
});

await recorder.initialize();
await recorder.startRecording('https://example.com');
```

## Configuration

### Browser Options
```javascript
{
  browserType: 'chromium|firefox|webkit',
  headless: true|false,
  slowMo: 100,
  viewport: { width: 1280, height: 720 }
}
```

### Recording Options
```javascript
{
  recordScreenshots: true,
  recordVideo: false,
  maxDuration: 300000
}
```

### Processor Options
```javascript
{
  outputDir: './output',
  batchSize: 100,
  validateOnWrite: true
}
```

## Output Format

### JSONL Structure
```json
{
  "timestamp": "2025-05-29T10:30:00Z",
  "action": "click",
  "selector": "#submit-btn",
  "url": "https://example.com",
  "sessionId": "uuid",
  "generatedCode": "await page.click('#submit-btn');",
  "elementInfo": {
    "tagName": "button",
    "text": "Submit"
  }
}
```

## Testing & Validation

### Expected Behavior
- **Interactive sessions**: 1-2 actions/second with user clicks/fills
- **Idle sessions**: Only navigation events (0.03/s rate)
- **File output**: Real-time JSONL generation with batching

### Validation Commands
```bash
# Record session (interact with page during recording)
npm start -- -u https://httpbin.org/forms/post -d 30

# Validate output
node examples/basic-usage.js validate

# Expected: 100% validation success rate
```

### Performance Expectations
- Memory usage: 20-50MB depending on activity
- File size: 200-500 bytes per action
- Processing delay: 1-3ms per validation

## Integration

### With Testing Frameworks
```javascript
const actions = require('./output/actions.jsonl');
actions.forEach(action => {
  test(`Generated: ${action.action}`, async ({ page }) => {
    eval(action.generatedCode);
  });
});
```

### With ML Pipelines
```python
import json
import pandas as pd

data = []
with open('actions.jsonl', 'r') as f:
    for line in f:
        data.append(json.loads(line))

df = pd.DataFrame(data)
```

## Troubleshooting

### Common Issues
- **Context destroyed**: Navigation timing issue - normal behavior
- **Generic selectors**: Website lacks specific attributes
- **Duplicate events**: Fast user interactions - handled by deduplication

### Performance
- Memory usage: ~50MB per 1000 actions
- Processing rate: 1-2 actions/second
- File size: ~500 bytes per action