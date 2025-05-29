# Playwright Codegen JSONL

AI-powered browser automation recording tool that captures user interactions and converts them to structured JSONL format for AI agent training.

## Features

- 🎭 **Real-time Recording**: Capture clicks, fills, navigation in browser
- 📄 **JSONL Output**: Structured data format perfect for ML training
- 🔍 **Smart Selectors**: Priority-based selector generation (ID → name → class)
- ✅ **Validation**: Built-in JSONL schema validation
- 🚀 **CLI & Programmatic**: Multiple usage modes

## Quick Start

```bash
# Install dependencies
npm install
npx playwright install chromium

# Interactive recording
npm start -- --interactive

# Command line recording
npm start -- -u https://example.com -d 60

# Validate output
node examples/basic-usage.js validate
```

## Output Format

```json
{
  "timestamp": "2025-05-29T10:30:00Z",
  "action": "click",
  "selector": "#submit-btn",
  "url": "https://example.com",
  "sessionId": "uuid",
  "generatedCode": "await page.click('#submit-btn');"
}
```

## Documentation

- [Implementation Guide](docs/implementation-guide.md)
- [Technical Report](docs/technical-report.md)
- [Best Practices](docs/best-practices.md)

## Performance

- **Processing Rate**: 1-2 actions/second
- **Validation**: 100% JSONL compliance
- **Memory Usage**: ~50MB per 1000 actions

## License

MIT