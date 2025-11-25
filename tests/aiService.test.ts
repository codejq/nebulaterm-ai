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
  });
});
