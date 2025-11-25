
import { GoogleGenAI, Type } from "@google/genai";
import { AIResponse, AppSettings } from "../types";

// Schema for Gemini
const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    markdown: { type: Type.STRING },
    suggestedCommand: { type: Type.STRING, nullable: true },
  },
  required: ["markdown"],
};

// Common System Prompt
const SYSTEM_PROMPT = `
You are an expert Linux/Unix System Administrator and SSH assistant named "Nebula AI".
Your goal is to help the user manage servers, write shell commands, and debug terminal errors.

Rules:
1. If the user asks for a command, provide the command clearly in a code block.
2. Keep explanations concise and technical but accessible.
3. If the user asks in Arabic, reply in Arabic.
4. You MUST return the response in strict JSON format.
5. JSON Structure: { "markdown": "string response with markdown", "suggestedCommand": "optional command string" }
`;

export const askAI = async (
  query: string,
  historyContext: string,
  settings: AppSettings
): Promise<AIResponse> => {
  const providerConfig = settings.providers[settings.activeProvider];
  
  if (!providerConfig || (!providerConfig.apiKey && settings.activeProvider !== 'ollama')) {
    return { markdown: `Configuration Error: Missing API Key for ${settings.activeProvider}. Please check Settings.` };
  }

  const prompt = `
    Terminal Context (Last few lines):
    ${historyContext}
    
    User Query:
    ${query}
  `;

  try {
    switch (settings.activeProvider) {
      case 'gemini':
        return await callGemini(prompt, providerConfig.apiKey, providerConfig.model);
      case 'openai':
      case 'grok':
        return await callOpenAICompatible(prompt, providerConfig, settings.activeProvider);
      case 'anthropic':
        return await callAnthropic(prompt, providerConfig);
      case 'ollama':
        return await callOllama(prompt, providerConfig);
      case 'openrouter':
        return await callOpenRouter(prompt, providerConfig);
      default:
        return { markdown: "Unknown provider selected." };
    }
  } catch (error: any) {
    console.error("AI Service Error:", error);
    return { markdown: `Error connecting to ${settings.activeProvider}: ${error.message || 'Unknown error'}` };
  }
};

export const autoCorrectAI = async (
  command: string,
  settings: AppSettings
): Promise<AIResponse> => {
  const providerConfig = settings.providers[settings.activeProvider];
  const prompt = `The user typed: "${command}". If it has a syntax error, fix it. If valid, explain it. Return JSON with "markdown" and "suggestedCommand".`;

  try {
    // Re-use the main handler but with specific prompt
    switch (settings.activeProvider) {
      case 'gemini':
        return await callGemini(prompt, providerConfig.apiKey, providerConfig.model);
      case 'openai':
      case 'grok':
        return await callOpenAICompatible(prompt, providerConfig, settings.activeProvider);
      case 'anthropic':
        return await callAnthropic(prompt, providerConfig);
      case 'ollama':
        return await callOllama(prompt, providerConfig);
      case 'openrouter':
        return await callOpenRouter(prompt, providerConfig);
      default:
        return { markdown: "Unknown provider." };
    }
  } catch (error) {
    return { markdown: "Unable to analyze command.", suggestedCommand: command };
  }
};

// --- Provider Implementations ---

// 1. Gemini Implementation
async function callGemini(prompt: string, apiKey: string, model: string): Promise<AIResponse> {
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const response = await ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response");
    return JSON.parse(text);
  } catch (e) {
    throw e;
  }
}

// 2. OpenAI / Grok / Generic Compatible
async function callOpenAICompatible(prompt: string, config: any, providerName: string): Promise<AIResponse> {
  const baseUrl = providerName === 'grok' 
    ? 'https://api.x.ai/v1/chat/completions' 
    : 'https://api.openai.com/v1/chat/completions';

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || (providerName === 'grok' ? 'grok-beta' : 'gpt-4-turbo-preview'),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + " Respond strictly in JSON." },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`API returned ${response.status}`);
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  return JSON.parse(content);
}

// 3. Anthropic (Claude)
async function callAnthropic(prompt: string, config: any): Promise<AIResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'dangerously-allow-browser': 'true' // Only for client-side demo
    },
    body: JSON.stringify({
      model: config.model || 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      system: SYSTEM_PROMPT + " Respond strictly in JSON format.",
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Anthropic API Error: ${response.statusText}`);

  const data = await response.json();
  const content = data.content[0]?.text;
  
  try {
    return JSON.parse(content);
  } catch (e) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { markdown: content };
  }
}

// 4. Ollama (Remote or Local)
async function callOllama(prompt: string, config: any): Promise<AIResponse> {
  const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');

  // Enhanced prompt that works better with models that don't support JSON format parameter
  const enhancedPrompt = `${prompt}

IMPORTANT: You MUST respond with a valid JSON object in this exact format:
{
  "markdown": "your response here with markdown formatting",
  "suggestedCommand": "optional command if applicable, or null"
}

Do not include any text before or after the JSON object. Only output the JSON.`;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'llama3',
      system: SYSTEM_PROMPT,
      prompt: enhancedPrompt,
      stream: false,
      // Some models don't support format parameter well, so we'll handle it in post-processing
      options: {
        temperature: 0.7,
        num_predict: 2048
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama connection failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Check if response exists and is not empty
  if (!data.response || data.response.trim() === '') {
    throw new Error('Ollama returned an empty response. Make sure the model is downloaded and running.');
  }

  const responseText = data.response.trim();

  // Try multiple strategies to extract valid JSON

  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(responseText);
    // Validate the structure
    if (parsed.markdown || parsed.suggestedCommand !== undefined) {
      return {
        markdown: parsed.markdown || '',
        suggestedCommand: parsed.suggestedCommand
      };
    }
  } catch (e) {
    // Continue to next strategy
  }

  // Strategy 2: Extract JSON from code blocks (```json ... ```)
  const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed.markdown || parsed.suggestedCommand !== undefined) {
        return {
          markdown: parsed.markdown || '',
          suggestedCommand: parsed.suggestedCommand
        };
      }
    } catch (e) {
      // Continue to next strategy
    }
  }

  // Strategy 3: Find any JSON object in the response
  const jsonMatch = responseText.match(/\{[\s\S]*?"markdown"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.markdown || parsed.suggestedCommand !== undefined) {
        return {
          markdown: parsed.markdown || '',
          suggestedCommand: parsed.suggestedCommand
        };
      }
    } catch (e) {
      // Continue to fallback
    }
  }

  // Fallback: If all parsing fails, wrap the raw response in markdown
  // Clean up any JSON formatting instructions the model might have included
  const cleanResponse = responseText
    .replace(/^.*?(?=\{|[A-Za-z])/s, '') // Remove leading explanations
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return { markdown: cleanResponse || responseText };
}

// 5. OpenRouter
async function callOpenRouter(prompt: string, config: any): Promise<AIResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': window.location.origin, // Required by OpenRouter
      'X-Title': 'NebulaTerm AI'
    },
    body: JSON.stringify({
      model: config.model || 'openai/gpt-3.5-turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + " Respond strictly in JSON." },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`OpenRouter API Error: ${response.status}`);

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  return JSON.parse(content);
}
