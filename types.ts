
export interface SSHKey {
  id: string;
  name: string;
  content: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  username: string;
  password?: string;
  port: number;
  os: 'linux' | 'windows' | 'macos';
  sshKeyId?: string;
  preferredAuthMethod?: 'password' | 'key';
  isLocal?: boolean;
}

export interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system' | 'ai';
  content: string;
  timestamp: number;
}

export interface AIResponse {
  markdown: string;
  suggestedCommand?: string;
}

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export type AIProviderId = 'gemini' | 'openai' | 'grok' | 'anthropic' | 'ollama' | 'openrouter';

export interface AIProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string; // For Ollama or custom OpenAI proxies
  model: string;
}

export interface AppSettings {
  activeProvider: AIProviderId;
  providers: Record<AIProviderId, AIProviderConfig>;
}

export interface Session {
  id: string;
  serverId: string;
  name: string;
  color: string;
  server?: Server; // Store full server object for temporary servers like local terminal
}
