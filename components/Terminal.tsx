import React, { useState, useEffect, useRef } from 'react';
import { ConnectionStatus, Server, SSHKey, AppSettings, AIProviderId } from '../types';
import { askAI, autoCorrectAI } from '../services/aiService';
import { Sparkles, Send, Wifi, WifiOff, RotateCcw, Play } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

interface TerminalProps {
  server: Server | null;
  sshKeys: SSHKey[];
  settings: AppSettings;
}

const Terminal: React.FC<TerminalProps> = ({ server, sshKeys, settings }) => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aiQuery, setAiQuery] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResponses, setAiResponses] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>(settings.activeProvider);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const isConnectingRef = useRef<boolean>(false);

  // Sync refs with state
  useEffect(() => {
    sessionIdRef.current = sessionId;
    statusRef.current = status;
  }, [sessionId, status]);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(88, 166, 255, 0.3)',
        selectionForeground: '#ffffff',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    // Open terminal
    term.open(terminalRef.current);

    // Delay fit() to ensure terminal container has proper dimensions
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (error) {
        console.warn('Initial fit failed, retrying...', error);
        // Retry after a longer delay if first attempt fails
        setTimeout(() => {
          try {
            fitAddon.fit();
          } catch (retryError) {
            console.error('Fit addon failed after retry:', retryError);
          }
        }, 100);
      }
    }, 0);

    // Handle terminal input
    term.onData((data) => {
      console.log('Terminal onData:', {
        data,
        sessionId: sessionIdRef.current,
        status: statusRef.current
      });
      if (sessionIdRef.current && statusRef.current === ConnectionStatus.CONNECTED) {
        console.log('Sending to PTY:', sessionIdRef.current);
        invoke('pty_write', {
          params: {
            session_id: sessionIdRef.current,
            data: data,
          },
        }).catch((error) => {
          console.error('Failed to write to PTY:', error);
        });
      } else {
        console.warn('Cannot write - not connected or no session', {
          sessionId: sessionIdRef.current,
          status: statusRef.current
        });
      }
    });

    // Store refs
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle window resize
    const handleResize = () => {
      try {
        fitAddon.fit();
        if (sessionIdRef.current && term.cols && term.rows) {
          invoke('pty_resize', {
            params: {
              session_id: sessionIdRef.current,
              cols: term.cols,
              rows: term.rows,
            },
          }).catch((error) => {
            console.error('Failed to resize PTY:', error);
          });
        }
      } catch (error) {
        console.warn('Resize fit failed:', error);
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Listen for PTY output
  useEffect(() => {
    if (!sessionId) return;

    const unlistenOutput = listen('pty-output', (event: any) => {
      const payload = event.payload;
      if (payload.session_id === sessionId && xtermRef.current) {
        xtermRef.current.write(payload.data);
      }
    });

    const unlistenDisconnect = listen('pty-disconnect', (event: any) => {
      const payload = event.payload;
      if (payload.session_id === sessionId) {
        setStatus(ConnectionStatus.ERROR);
        if (xtermRef.current) {
          xtermRef.current.writeln(`\r\n\x1b[31m✗ ${payload.error}\x1b[0m`);
          xtermRef.current.writeln(`\x1b[33m⚠ Connection lost. Please reconnect.\x1b[0m`);
        }
      }
    });

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
    };
  }, [sessionId]);

  // Handle SSH connection
  useEffect(() => {
    if (!server || !xtermRef.current) {
      return;
    }

    // Prevent duplicate connections using ref (synchronous check)
    if (isConnectingRef.current) {
      return;
    }

    // Mark as connecting immediately
    isConnectingRef.current = true;

    const connectToServer = async () => {
      setStatus(ConnectionStatus.CONNECTING);

      if (xtermRef.current) {
        if (server.isLocal) {
          xtermRef.current.writeln(`\x1b[34mStarting local terminal...\x1b[0m`);
        } else {
          xtermRef.current.writeln(`\x1b[34mConnecting to ${server.host}:${server.port}...\x1b[0m`);
        }
      }

      try {
        const newSessionId = crypto.randomUUID();
        console.log('Setting session ID:', newSessionId);
        setSessionId(newSessionId);

        if (server.isLocal) {
          // Local PTY connection
          const cols = xtermRef.current?.cols || 80;
          const rows = xtermRef.current?.rows || 24;

          const result = await invoke<string>('pty_connect_local', {
            params: {
              session_id: newSessionId,
              cols,
              rows,
            },
          });

          console.log('Local terminal connected! Setting status to CONNECTED');
          setStatus(ConnectionStatus.CONNECTED);

          if (xtermRef.current) {
            xtermRef.current.writeln(`\x1b[32m✓ Local terminal started\x1b[0m`);
          }
        } else {
          // SSH connection
          const key = server.sshKeyId ? sshKeys.find(k => k.id === server.sshKeyId) : null;
          const preferredMethod = server.preferredAuthMethod || 'password';

          const params = {
            session_id: newSessionId,
            host: server.host,
            port: server.port,
            username: server.username,
            password: preferredMethod === 'password' ? (server.password || null) : null,
            ssh_key_path: preferredMethod === 'key' ? (key?.privateKeyPath || null) : null,
            ssh_key_passphrase: preferredMethod === 'key' ? (key?.passphrase || null) : null,
          };

          await invoke<string>('pty_connect', { params });

          console.log('Connected! Setting status to CONNECTED');
          setStatus(ConnectionStatus.CONNECTED);
          console.log('Session ID after connection:', newSessionId);
          console.log('Refs after connection:', { sessionId: sessionIdRef.current, status: statusRef.current });

          if (xtermRef.current) {
            xtermRef.current.writeln(`\x1b[32m✓ Connected to ${server.username}@${server.host}:${server.port}\x1b[0m`);
          }
        }

        // Fit and resize PTY after connection
        if (fitAddonRef.current && xtermRef.current) {
          try {
            fitAddonRef.current.fit();
            invoke('pty_resize', {
              params: {
                session_id: newSessionId,
                cols: xtermRef.current.cols,
                rows: xtermRef.current.rows,
              },
            }).catch(console.error);
          } catch (error) {
            console.warn('Post-connection fit failed:', error);
          }
        }
      } catch (error) {
        console.error('Connection error:', error);
        setStatus(ConnectionStatus.ERROR);
        if (xtermRef.current) {
          xtermRef.current.writeln(`\x1b[31m✗ Connection failed: ${error}\x1b[0m`);
        }
      }
    };

    connectToServer();

    return () => {
      if (status === ConnectionStatus.CONNECTED && sessionId) {
        invoke('pty_disconnect', { sessionId }).catch(console.error);
      }
    };
  }, [server]); // Only run when server changes

  const handleAiAsk = async () => {
    if (!aiQuery.trim()) return;
    setIsAiLoading(true);

    // Get terminal buffer for context
    const context = xtermRef.current?.buffer.active.getLine(0)?.translateToString() || '';

    // Use selected provider instead of global activeProvider
    const customSettings = { ...settings, activeProvider: selectedProvider };
    const result = await askAI(aiQuery, context, customSettings);

    setIsAiLoading(false);
    setAiQuery('');

    // Add AI response
    const responseText = `AI Analysis (${selectedProvider}):\n${result.markdown}`;
    setAiResponses((prev) => [...prev, responseText]);

    if (result.suggestedCommand && xtermRef.current) {
      // Write suggested command to terminal
      xtermRef.current.write(`\x1b[33m💡 Suggested: ${result.suggestedCommand}\x1b[0m\r\n`);
    }
  };

  const handleAutoCorrect = async () => {
    if (!xtermRef.current) return;

    setIsAiLoading(true);

    // Get the current line from terminal buffer
    const buffer = xtermRef.current.buffer.active;
    const currentLine = buffer.getLine(buffer.cursorY)?.translateToString().trim() || '';

    if (!currentLine) {
      setIsAiLoading(false);
      return;
    }

    // Use selected provider instead of global activeProvider
    const customSettings = { ...settings, activeProvider: selectedProvider };
    const result = await autoCorrectAI(currentLine, customSettings);
    setIsAiLoading(false);

    if (result.suggestedCommand && result.suggestedCommand !== currentLine) {
      xtermRef.current.write(`\r\n\x1b[33m💡 Suggestion: ${result.suggestedCommand}\x1b[0m\r\n`);
      setAiResponses((prev) => [...prev, `Auto-correct: ${result.markdown}`]);
    } else {
      xtermRef.current.write(`\r\n\x1b[32m✓ Command looks good: ${result.markdown}\x1b[0m\r\n`);
    }
  };

  const handleQuickCommand = (cmd: string) => {
    if (sessionId && status === ConnectionStatus.CONNECTED && xtermRef.current) {
      invoke('pty_write', {
        params: {
          session_id: sessionId,
          data: `${cmd}\n`,
        },
      }).catch((error) => {
        console.error('Failed to write command:', error);
      });
    }
  };

  if (!server) return null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden relative">
      {/* Top Status Bar */}
      <div className="h-8 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 select-none">
        <div className="flex items-center gap-2 text-xs">
          {status === ConnectionStatus.CONNECTED ? (
            <Wifi className="w-3 h-3 text-green-500" />
          ) : (
            <WifiOff className="w-3 h-3 text-red-500" />
          )}
          <span className="font-mono text-gray-300">
            {server.isLocal ? 'Local Terminal' : `${server.username}@${server.host}`}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            status === ConnectionStatus.CONNECTED ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
          }`}>
            {status}
          </span>
        </div>

        <div className="text-[10px] text-gray-500 font-mono">
          {server.isLocal ? 'LOCAL' : server.os.toUpperCase()} • {settings.activeProvider.toUpperCase()}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">

        {/* Terminal Window */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden relative">
          <div
            ref={terminalRef}
            className="flex-1 overflow-hidden"
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* AI Side Panel */}
        <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col z-10 shadow-xl">
          <div className="p-3 border-b border-gray-800 bg-gray-850 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="font-semibold text-gray-200 text-xs">AI Assistant</h3>
          </div>

          <div className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              {/* AI Responses */}
              {aiResponses.length > 0 && (
                <div className="space-y-2">
                  {aiResponses.slice(-3).map((response, idx) => (
                    <div key={idx} className="p-2 bg-indigo-900/20 border-l-2 border-indigo-500 text-indigo-200 rounded-r text-xs">
                      {response}
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleAutoCorrect}
                  disabled={!sessionId || isAiLoading}
                  className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded flex flex-col items-center justify-center gap-1 transition disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4 text-orange-400" />
                  <span className="text-[10px] text-gray-300">Auto-Fix</span>
                </button>
                <button
                  onClick={() => handleQuickCommand('top')}
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded flex flex-col items-center justify-center gap-1 transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4 text-green-400" />
                  <span className="text-[10px] text-gray-300">Run 'top'</span>
                </button>
              </div>
            </div>
          </div>

          {/* AI Chat Input */}
          <div className="bg-gray-850 border-t border-gray-800">
            {/* Provider Selector */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-800/50">
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as AIProviderId)}
                className="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-[11px] text-gray-300 focus:border-indigo-500 outline-none"
              >
                <option value="gemini">Gemini ({settings.providers.gemini?.model || 'not configured'})</option>
                <option value="openai">OpenAI ({settings.providers.openai?.model || 'not configured'})</option>
                <option value="anthropic">Claude ({settings.providers.anthropic?.model || 'not configured'})</option>
                <option value="grok">Grok ({settings.providers.grok?.model || 'not configured'})</option>
                <option value="ollama">Ollama ({settings.providers.ollama?.model || 'not configured'})</option>
                <option value="openrouter">OpenRouter ({settings.providers.openrouter?.model || 'not configured'})</option>
              </select>
            </div>

            {/* Chat Input */}
            <div className="p-3 relative">
              <textarea
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAiAsk();
                  }
                }}
                placeholder="Ask AI..."
                className="w-full bg-black/30 border border-gray-700 rounded-lg p-3 pr-10 text-xs text-gray-200 focus:border-indigo-500 outline-none resize-none h-20"
              />
              <button
                onClick={handleAiAsk}
                disabled={isAiLoading || !aiQuery.trim()}
                className="absolute bottom-5 right-5 p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-white disabled:opacity-50 transition"
              >
                {isAiLoading ? (
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Send className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Terminal;
