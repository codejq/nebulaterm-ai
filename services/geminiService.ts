import { GoogleGenAI, Type } from "@google/genai";
import { AIResponse } from "../types";

// Initialize the client
// API Key is strictly from process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_ID = 'gemini-2.5-flash';

// Define schema for consistent JSON output
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    markdown: {
      type: Type.STRING,
      description: "The explanation or answer in markdown format.",
    },
    suggestedCommand: {
      type: Type.STRING,
      description: "The suggested command to run, if any.",
      nullable: true,
    },
  },
  required: ["markdown"],
};

export const askTerminalAssistant = async (
  query: string, 
  historyContext: string
): Promise<AIResponse> => {
  try {
    const systemInstruction = `
      You are an expert Linux/Unix System Administrator and SSH assistant named "Nebula AI".
      
      Your goal is to help the user manage servers, write shell commands, and debug terminal errors.
      
      Rules:
      1. If the user asks for a command, provide the command clearly in a code block.
      2. Keep explanations concise and technical but accessible.
      3. If the user asks in Arabic, reply in Arabic. If in English, reply in English.
      4. You can see the last few lines of the terminal history to understand context.
    `;

    const prompt = `
      Terminal Context (Last few lines):
      ${historyContext}
      
      User Query:
      ${query}
    `;

    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const parsed = JSON.parse(text);
    return {
      markdown: parsed.markdown,
      suggestedCommand: parsed.suggestedCommand || undefined
    };

  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      markdown: "Sorry, I encountered an error processing your request. Please check your API key or internet connection.",
    };
  }
};

export const autoCorrectCommand = async (command: string): Promise<AIResponse> => {
  try {
    const prompt = `
      The user typed the following command in a Linux terminal which might be incorrect or they want to know what it does:
      "${command}"
      
      Analyze it. If it has a syntax error, fix it. If it's valid, explain it briefly.
      If the user is asking a question in natural language instead of a command, answer the question.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response");
    
    const parsed = JSON.parse(text);
    return {
      markdown: parsed.markdown,
      suggestedCommand: parsed.suggestedCommand || undefined
    };

  } catch (error) {
    return {
      markdown: "Unable to analyze command.",
      suggestedCommand: command
    };
  }
};