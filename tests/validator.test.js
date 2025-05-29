const { JSONLValidator } = require('../src/utils/validator');
const fs = require('fs-extra');
const path = require('path');

describe('JSONLValidator', () => {
  let validator;
  const testDir = './tests/fixtures';

  beforeEach(() => {
    validator = new JSONLValidator();
  });

  beforeAll(async () => {
    await fs.ensureDir(testDir);
  });

  afterAll(async () => {
    await fs.remove(testDir);
  });

  describe('validateRecord', () => {
    test('should validate valid record', () => {
      const validRecord = {
        timestamp: '2025-05-29T10:30:00Z',
        action: 'click',
        url: 'https://example.com',
        session_id: 'test-session',
        selector: '#button',
        generated_code: 'await page.click("#button");'
      };

      const result = validator.validateRecord(validRecord);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject record missing required fields', () => {
      const invalidRecord = {
        action: 'click',
        selector: '#button'
      };

      const result = validator.validateRecord(invalidRecord);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject invalid action type', () => {
      const invalidRecord = {
        timestamp: '2025-05-29T10:30:00Z',
        action: 'invalid_action',
        url: 'https://example.com',
        session_id: 'test-session'
      };

      const result = validator.validateRecord(invalidRecord);
      expect(result.valid).toBe(false);
      expect(result.errors.some(err => err.includes('Invalid action'))).toBe(true);
    });
  });

  describe('validateFile', () => {
    test('should validate valid JSONL file', async () => {
      const testFile = path.join(testDir, 'valid.jsonl');
      const validData = [
        {
          timestamp: '2025-05-29T10:30:00Z',
          action: 'click',
          url: 'https://example.com',
          session_id: 'test-session'
        },
        {
          timestamp: '2025-05-29T10:30:01Z',
          action: 'fill',
          url: 'https://example.com',
          session_id: 'test-session',
          selector: '#input',
          value: 'test'
        }
      ];

      const jsonlContent = validData.map(record => JSON.stringify(record)).join('\n');
      await fs.writeFile(testFile, jsonlContent);

      const result = await validator.validateFile(testFile);
      expect(result.validLines).toBe(2);
      expect(result.invalidLines).toBe(0);
    });

    test('should handle non-existent file', async () => {
      const result = await validator.validateFile('./non-existent.jsonl');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].errors[0]).toContain('File not found');
    });
  });

  describe('helper methods', () => {
    test('isValidISO8601 should validate timestamps', () => {
      expect(validator.isValidISO8601('2025-05-29T10:30:00Z')).toBe(true);
      expect(validator.isValidISO8601('2025-05-29T10:30:00.123Z')).toBe(true);
      expect(validator.isValidISO8601('invalid-timestamp')).toBe(false);
    });

    test('isValidURL should validate URLs', () => {
      expect(validator.isValidURL('https://example.com')).toBe(true);
      expect(validator.isValidURL('http://localhost:3000')).toBe(true);
      expect(validator.isValidURL('invalid-url')).toBe(false);
    });
  });
});