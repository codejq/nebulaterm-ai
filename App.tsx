
import React, { useState, useEffect } from 'react';
import ServerList from './components/ServerList';
import Terminal from './components/Terminal';
import SettingsModal from './components/SettingsModal';
import AboutModal from './components/AboutModal';
import UnlockPrompt from './components/UnlockPrompt';
import TabBar from './components/TabBar';
import { Server, SSHKey, AppSettings, Session } from './types';
import { Terminal as TerminalIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

function App() {
  const [isDbLocked, setIsDbLocked] = useState(false);
  const [isCheckingDb, setIsCheckingDb] = useState(true);

  // Initialize secure storage database on mount
  useEffect(() => {
    const initDb = async () => {
      try {
        await invoke('init_secure_storage');

        // Check if master password exists
        const hasMasterPw = await invoke<boolean>('has_master_password');

        if (hasMasterPw) {
          // Check if database is unlocked
          const isUnlocked = await invoke<boolean>('is_database_unlocked');
          setIsDbLocked(!isUnlocked);
        }
      } catch (error) {
        console.error('Failed to initialize secure storage:', error);
      } finally {
        setIsCheckingDb(false);
      }
    };

    initDb();
  }, []);

  const handleUnlock = () => {
    setIsDbLocked(false);
  };
  // --- Data Initialization ---
  const [servers, setServers] = useState<Server[]>(() => {
    const saved = localStorage.getItem('nebula_servers');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: '1',
        name: 'AWS Production',
        host: '54.211.10.23',
        username: 'ubuntu',
        port: 22,
        os: 'linux'
      },
      {
        id: '2',
        name: 'DigitalOcean Staging',
        host: '168.10.55.2',
        username: 'root',
        port: 22,
        os: 'linux'
      }
    ];
  });

  const [sshKeys, setSshKeys] = useState<SSHKey[]>(() => {
    const saved = localStorage.getItem('nebula_ssh_keys');
    if (saved) return JSON.parse(saved);
    return [];
  });

  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('nebula_settings');
    if (saved) return JSON.parse(saved);
    return {
      activeProvider: 'gemini',
      providers: {
        gemini: { enabled: true, apiKey: process.env.API_KEY || '', model: 'gemini-2.5-flash' },
        openai: { enabled: true, apiKey: '', model: 'gpt-4-turbo-preview' },
        grok: { enabled: true, apiKey: '', model: 'grok-beta' },
        anthropic: { enabled: true, apiKey: '', model: 'claude-3-sonnet-20240229' },
        ollama: { enabled: true, apiKey: '', baseUrl: 'http://localhost:11434', model: 'llama3' },
        openrouter: { enabled: true, apiKey: '', model: 'openai/gpt-3.5-turbo' },
      }
    };
  });

  // --- Session Management (Tabs) ---
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Persistence
  useEffect(() => { localStorage.setItem('nebula_servers', JSON.stringify(servers)); }, [servers]);
  useEffect(() => { localStorage.setItem('nebula_ssh_keys', JSON.stringify(sshKeys)); }, [sshKeys]);
  useEffect(() => { localStorage.setItem('nebula_settings', JSON.stringify(appSettings)); }, [appSettings]);

  // Tab Colors
  const SESSION_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  const handleSelectServer = (server: Server) => {
    // Open new session
    const newSessionId = crypto.randomUUID();
    const color = SESSION_COLORS[sessions.length % SESSION_COLORS.length];

    const newSession: Session = {
      id: newSessionId,
      serverId: server.id,
      name: server.name,
      color: color,
      server: server.isLocal ? server : undefined // Store full server object for local terminals
    };

    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newSessionId);
  };

  const handleCloseSession = (id: string) => {
    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) return;

    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);

    // If we closed the active session, pick another one
    if (activeSessionId === id) {
      if (newSessions.length > 0) {
        // Try to go to the one to the left, or the first one
        const newIdx = Math.max(0, idx - 1);
        setActiveSessionId(newSessions[newIdx].id);
      } else {
        setActiveSessionId(null);
      }
    }
  };

  const handleAddServer = (newServer: Server) => setServers([...servers, newServer]);
  const handleDeleteServer = (id: string) => setServers(servers.filter(s => s.id !== id));
  const handleAddKey = (key: SSHKey) => setSshKeys([...sshKeys, key]);
  const handleDeleteKey = (id: string) => setSshKeys(sshKeys.filter(k => k.id !== id));

  // Show unlock prompt if database is locked
  if (isDbLocked) {
    return <UnlockPrompt onUnlock={handleUnlock} />;
  }

  // Show loading while checking database
  if (isCheckingDb) {
    return (
      <div className="flex h-screen w-full bg-black items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-gray-400 text-sm">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-black text-white font-sans antialiased selection:bg-indigo-500/30 overflow-hidden">

      {/* Left Sidebar */}
      <ServerList
        servers={servers}
        activeServerId={null} // Server list just acts as a launcher now
        onSelectServer={handleSelectServer}
        onAddServer={handleAddServer}
        onDeleteServer={handleDeleteServer}
        sshKeys={sshKeys}
        onAddKey={handleAddKey}
        onDeleteKey={handleDeleteKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
      />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-[#0d1117] relative">
        
        {/* Top Tab Bar */}
        <TabBar 
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onCloseSession={handleCloseSession}
        />

        {/* Terminals Container */}
        <div className="flex-1 relative overflow-hidden">
          
          {sessions.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 select-none">
              <TerminalIcon className="w-20 h-20 mb-6 opacity-20" />
              <h2 className="text-xl font-semibold mb-2">No Active Sessions</h2>
              <p className="text-sm">Select a server from the sidebar to connect.</p>
            </div>
          ) : (
            sessions.map((session) => {
              // Use stored server for local terminals, otherwise look up from servers array
              const server = session.server || servers.find(s => s.id === session.serverId);
              // If server was deleted, we might have a zombie session, handle gracefully
              if (!server) {
                return null;
              }

              const isActive = session.id === activeSessionId;

              return (
                <div
                  key={session.id}
                  className="absolute inset-0 w-full h-full flex flex-col"
                  style={{
                    zIndex: isActive ? 10 : 1,
                    visibility: isActive ? 'visible' : 'hidden',
                    pointerEvents: isActive ? 'auto' : 'none'
                  }}
                >
                  <Terminal
                    server={server}
                    sshKeys={sshKeys}
                    settings={appSettings}
                  />
                </div>
              );
            })
          )}
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={appSettings}
        onSave={setAppSettings}
      />

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />
    </div>
  );
}

export default App;
