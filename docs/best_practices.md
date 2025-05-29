# Best Practices

## Testing Guidelines

### Effective Recording
- **User interaction required**: Tool captures events only when user actively clicks/types
- **Minimum session**: 30s with 5+ interactions for meaningful data
- **Expected rate**: 1-2 actions/second during active use

### Validation Results
- **Success rate**: 100% JSONL format compliance achieved
- **File integrity**: All required fields present, valid timestamps
- **Processing speed**: 1-3ms validation per file

### Production Recommendations
```bash
# Interactive recording (recommended)
npm start -- -u https://demo-site.com -d 60
# Interact with page during recording for quality data

# Batch validation
node examples/basic-usage.js validate
# Expect 100% validation success
```

## Recording Strategy

### Session Management
- Limit sessions to 5-10 minutes
- Use meaningful session IDs
- Monitor memory usage during long sessions

### Action Quality
- Use sites with ID/name attributes
- Avoid rapid-fire interactions
- Let pages fully load before interactions

## Output Optimization

### JSONL Quality
```bash
# Validate before using
node examples/basic-usage.js validate

# Filter low-quality selectors
jq 'select(.selector != "div" and .selector != "span")' actions.jsonl
```

### File Management
- Rotate files daily (avoid large files)
- Compress historical data
- Regular cleanup of temp files

## Production Deployment

### Performance Monitoring
```javascript
// Monitor memory usage
setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > 500 * 1024 * 1024) {
    console.warn('High memory usage');
  }
}, 30000);
```

### Error Handling
- Graceful shutdown on SIGTERM
- Automatic retry for network errors
- Validation after each batch

## AI Training Integration

### Data Preprocessing
```python
# Remove duplicates
df = df.drop_duplicates(['action', 'selector', 'value'])

# Filter by selector quality
df = df[~df['selector'].isin(['div', 'span', 'unknown'])]

# Group by sessions
df['session_group'] = df['sessionId']
```

### Quality Metrics
- Selector specificity score
- Action sequence completeness
- Timestamp consistency
- Validation pass rate

## Troubleshooting

### Common Patterns
```bash
# Check for duplicates
jq '.selector' actions.jsonl | sort | uniq -c | sort -nr

# Validate timestamps
jq -r '.timestamp' actions.jsonl | sort -c

# Action distribution
jq -r '.action' actions.jsonl | sort | uniq -c
```

### Memory Issues
- Reduce batch size to 50
- Enable garbage collection
- Use streaming processors for large sessions

## Security Considerations

### Data Privacy
- Exclude sensitive form data
- Mask personal information
- Secure file storage

### Access Control
- Restrict output directory permissions
- Use environment variables for configs
- Regular security audits