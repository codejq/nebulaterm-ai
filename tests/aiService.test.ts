import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askAI, autoCorrectAI } from '../services/aiService';
import type { AppSettings } from '../types';

// Mock fetch globally
global.fetch = vi.fn();

describe('aiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSettings: AppSettings = {
    activeProvider: 'gemini',
    providers: {
      gemini: { enabled: true, apiKey: 'test-api-key', model: 'gemini-2.5-flash' },
      openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
      grok: { enabled: true, apiKey: '', model: 'grok-beta' },
      anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
      ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
      openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
    }
  };

  describe('askAI', () => {
    it('should return error message if API key is missing', async () => {
      const settingsWithoutKey: AppSettings = {
        ...mockSettings,
        activeProvider: 'openai',
      };

      const result = await askAI('test query', 'test context', settingsWithoutKey);

      expect(result.markdown).toContain('Configuration Error');
      expect(result.markdown).toContain('Missing API Key');
      expect(result.markdown).toContain('openai');
    });

    it('should return error message for unknown provider', async () => {
      const settingsWithUnknownProvider: AppSettings = {
        ...mockSettings,
        activeProvider: 'unknown' as any,
      };

      const result = await askAI('test query', 'test context', settingsWithUnknownProvider);

      expect(result.markdown).toBe('Unknown provider selected.');
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await askAI('test query', 'test context', settingsWithOllama);

      expect(result.markdown).toContain('Error connecting to ollama');
      expect(result.markdown).toContain('Network error');
    });

    it('should call Ollama API correctly', async () => {
      const mockResponse = {
        response: JSON.stringify({ markdown: 'Test response', suggestedCommand: null })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await askAI('test query', 'test context', settingsWithOllama);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/generate'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result.markdown).toBe('Test response');
    });
  });

  describe('autoCorrectAI', () => {
    it('should format command for analysis', async () => {
      const mockResponse = {
        response: JSON.stringify({
          markdown: 'The command is correct',
          suggestedCommand: 'ls -la'
        })
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await autoCorrectAI('ls -la', settingsWithOllama);

      expect(result.markdown).toBe('The command is correct');
      expect(result.suggestedCommand).toBe('ls -la');
    });

    it('should return error message on failure', async () => {
      (global.fetch as any).mockRejectedValue(new Error('API error'));

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await autoCorrectAI('invalid command', settingsWithOllama);

      expect(result.markdown).toBe('Unable to analyze command.');
      expect(result.suggestedCommand).toBe('invalid command');
    });
  });

  describe('Ollama response parsing', () => {
    it('should handle JSON in code blocks', async () => {
      const mockResponse = {
        response: '```json\n{"markdown": "Test", "suggestedCommand": null}\n```'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await askAI('test', 'context', settingsWithOllama);

      expect(result.markdown).toBe('Test');
    });

    it('should handle plain text responses as fallback', async () => {
      const mockResponse = {
        response: 'This is a plain text response without JSON'
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await askAI('test', 'context', settingsWithOllama);

      expect(result.markdown).toBe('This is a plain text response without JSON');
    });

    it('should handle empty responses', async () => {
      const mockResponse = {
        response: ''
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      await expect(askAI('test', 'context', settingsWithOllama))
        .rejects.toThrow('Ollama returned an empty response');
    });

    it('should extract JSON embedded in free-form text (strategy 3)', async () => {
      const embeddedJson = '{"markdown": "Embedded response", "suggestedCommand": "ls -la"}';
      const mockResponse = {
        response: `Here is some preamble text. ${embeddedJson} And some trailing text.`
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const settingsWithOllama: AppSettings = {
        ...mockSettings,
        activeProvider: 'ollama',
      };

      const result = await askAI('test', 'context', settingsWithOllama);

      expect(result.markdown).toBe('Embedded response');
      expect(result.suggestedCommand).toBe('ls -la');
    });
  });

  describe('OpenAI provider', () => {
    const settingsWithOpenAI: AppSettings = {
      ...{
        activeProvider: 'openai' as const,
        providers: {
          gemini: { enabled: true, apiKey: 'test-api-key', model: 'gemini-2.5-flash' },
          openai: { enabled: true, apiKey: 'openai-key', model: 'gpt-4-turbo-preview' },
          grok: { enabled: true, apiKey: '', model: 'grok-beta' },
          anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
          ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
          openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
        }
      }
    };

    it('should parse successful OpenAI response correctly', async () => {
      const mockData = {
        choices: [{ message: { content: JSON.stringify({ markdown: 'OpenAI answer', suggestedCommand: 'echo hello' }) } }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await askAI('test query', 'test context', settingsWithOpenAI);

      expect(result.markdown).toBe('OpenAI answer');
      expect(result.suggestedCommand).toBe('echo hello');
    });

    it('should throw an error on non-200 HTTP response', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await askAI('test query', 'test context', settingsWithOpenAI);

      expect(result.markdown).toContain('Error connecting to openai');
      expect(result.markdown).toContain('401');
    });
  });

  describe('Grok provider', () => {
    const settingsWithGrok: AppSettings = {
      activeProvider: 'grok' as const,
      providers: {
        gemini: { enabled: true, apiKey: '', model: 'gemini-2.5-flash' },
        openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
        grok: { enabled: true, apiKey: 'grok-key', model: 'grok-beta' },
        anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
        ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
        openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
      }
    };

    it('should use api.x.ai base URL for Grok provider', async () => {
      const mockData = {
        choices: [{ message: { content: JSON.stringify({ markdown: 'Grok answer' }) } }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      await askAI('test query', 'test context', settingsWithGrok);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.x.ai'),
        expect.any(Object)
      );
    });
  });

  describe('Anthropic provider', () => {
    const settingsWithAnthropic: AppSettings = {
      activeProvider: 'anthropic' as const,
      providers: {
        gemini: { enabled: true, apiKey: '', model: 'gemini-2.5-flash' },
        openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
        grok: { enabled: true, apiKey: '', model: 'grok-beta' },
        anthropic: { enabled: true, apiKey: 'anthropic-key', model: 'claude-3-sonnet-20240229' },
        ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
        openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
      }
    };

    it('should parse content[0].text from successful Anthropic response', async () => {
      const mockData = {
        content: [{ text: JSON.stringify({ markdown: 'Anthropic answer', suggestedCommand: 'pwd' }) }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await askAI('test query', 'test context', settingsWithAnthropic);

      expect(result.markdown).toBe('Anthropic answer');
      expect(result.suggestedCommand).toBe('pwd');
    });

    it('should extract JSON embedded in Anthropic text response (fallback)', async () => {
      const embeddedJson = '{"markdown": "Fallback markdown", "suggestedCommand": "whoami"}';
      const mockData = {
        content: [{ text: `Here is your answer: ${embeddedJson}` }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await askAI('test query', 'test context', settingsWithAnthropic);

      expect(result.markdown).toBe('Fallback markdown');
      expect(result.suggestedCommand).toBe('whoami');
    });
  });

  describe('OpenRouter provider', () => {
    const settingsWithOpenRouter: AppSettings = {
      activeProvider: 'openrouter' as const,
      providers: {
        gemini: { enabled: true, apiKey: '', model: 'gemini-2.5-flash' },
        openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
        grok: { enabled: true, apiKey: '', model: 'grok-beta' },
        anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
        ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
        openrouter: { enabled: true, apiKey: 'openrouter-key', model: 'openai/gpt-3.5-turbo' },
      }
    };

    it('should parse choices[0].message.content from OpenRouter response', async () => {
      const mockData = {
        choices: [{ message: { content: JSON.stringify({ markdown: 'OpenRouter answer', suggestedCommand: 'df -h' }) } }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await askAI('test query', 'test context', settingsWithOpenRouter);

      expect(result.markdown).toBe('OpenRouter answer');
      expect(result.suggestedCommand).toBe('df -h');
    });
  });

  describe('autoCorrectAI all-providers-fail', () => {
    it('should return command unchanged when provider throws', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Provider unavailable'));

      const settingsWithOllama: AppSettings = {
        activeProvider: 'ollama' as const,
        providers: {
          gemini: { enabled: true, apiKey: '', model: 'gemini-2.5-flash' },
          openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
          grok: { enabled: true, apiKey: '', model: 'grok-beta' },
          anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
          ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
          openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
        }
      };

      const result = await autoCorrectAI('some-command', settingsWithOllama);

      expect(result.suggestedCommand).toBe('some-command');
      expect(result.markdown).toBe('Unable to analyze command.');
    });
  });
});
