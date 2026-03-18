import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted before all imports and variable declarations.
// To share `mockGenerateContent` between the factory and the test body without
// hitting the temporal dead zone (const/let are not accessible before their
// declaration during hoisting), we use `vi.hoisted` which is evaluated at
// hoist time alongside vi.mock factories.
const { mockGenerateContent } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn() };
});

vi.mock('@google/genai', () => {
  function GoogleGenAI(_opts: unknown) {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }

  return {
    GoogleGenAI,
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
    },
  };
});

// Import AFTER mock registration so the module-level `new GoogleGenAI()` in
// geminiService.ts picks up our mocked constructor.
import { askTerminalAssistant, autoCorrectCommand } from '../services/geminiService';

describe('geminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('askTerminalAssistant', () => {
    it('should return parsed markdown and suggestedCommand from successful response', async () => {
      const responsePayload = {
        markdown: 'Use `ls -la` to list files.',
        suggestedCommand: 'ls -la',
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(responsePayload),
      });

      const result = await askTerminalAssistant('list files', 'user@host:~$');

      expect(result.markdown).toBe('Use `ls -la` to list files.');
      expect(result.suggestedCommand).toBe('ls -la');
    });

    it('should return error markdown when GoogleGenAI throws', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));

      const result = await askTerminalAssistant('list files', 'user@host:~$');

      // The catch block returns a fixed error string.
      expect(result.markdown).toContain('error');
    });

    it('should return fallback markdown when response text is empty', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '',
      });

      // Empty text triggers `if (!text) throw new Error("No response from AI")`.
      // The catch block returns the fallback error markdown.
      const result = await askTerminalAssistant('list files', 'user@host:~$');

      expect(typeof result.markdown).toBe('string');
      expect(result.markdown.length).toBeGreaterThan(0);
    });
  });

  describe('autoCorrectCommand', () => {
    it('should return suggestion from parsed response', async () => {
      const responsePayload = {
        markdown: 'The command `grpe` should be `grep`.',
        suggestedCommand: 'grep pattern file.txt',
      };

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(responsePayload),
      });

      const result = await autoCorrectCommand('grpe pattern file.txt');

      expect(result.markdown).toBe('The command `grpe` should be `grep`.');
      expect(result.suggestedCommand).toBe('grep pattern file.txt');
    });

    it('should return original command with error indicator on failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network timeout'));

      const result = await autoCorrectCommand('grpe pattern file.txt');

      expect(result.suggestedCommand).toBe('grpe pattern file.txt');
      expect(result.markdown).toBe('Unable to analyze command.');
    });
  });
});
