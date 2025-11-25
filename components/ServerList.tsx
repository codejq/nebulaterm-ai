
import React, { useState } from 'react';
import { Server, SSHKey } from '../types';
import { Plus, Server as ServerIcon, Trash2, Monitor, Command, Key, Settings as SettingsIcon, Terminal, Info } from 'lucide-react';
import SSHKeyManager from './SSHKeyManager';

interface ServerListProps {
  servers: Server[];
  activeServerId: string | null;
  onSelectServer: (server: Server) => void;
  onAddServer: (server: Server) => void;
  onDeleteServer: (id: string) => void;
  sshKeys: SSHKey[];
  onAddKey: (key: SSHKey) => void;
  onDeleteKey: (id: string) => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}

const ServerList: React.FC<ServerListProps> = ({
  servers,
  activeServerId,
  onSelectServer,
  onAddServer,
  onDeleteServer,
  sshKeys,
  onAddKey,
  onDeleteKey,
  onOpenSettings,
  onOpenAbout
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isKeyManagerOpen, setIsKeyManagerOpen] = useState(false);
  const [newServer, setNewServer] = useState<Partial<Server>>({
    name: '',
    host: '',
    username: 'root',
    password: '',
    port: 22,
    os: 'linux',
    sshKeyId: '',
    preferredAuthMethod: 'password'
  });

  const handleSave = () => {
    if (newServer.name && newServer.host && newServer.username) {
      onAddServer({
        ...newServer,
        id: crypto.randomUUID(),
        port: newServer.port || 22,
        sshKeyId: newServer.sshKeyId || undefined
      } as Server);
      setIsAdding(false);
      setNewServer({ name: '', host: '', username: 'root', password: '', port: 22, os: 'linux', sshKeyId: '' });
    }
  };

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full z-20">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-100 flex items-center gap-2">
            <Command className="w-5 h-5 text-indigo-400" />
            NebulaTerm
          </h2>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition"
            title="Add Server"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => {
              const localServer: Server = {
                id: crypto.randomUUID(),
                name: 'Local Terminal',
                host: 'localhost',
                username: 'local',
                port: 0,
                os: 'windows',
                isLocal: true,
              };
              onSelectServer(localServer);
            }}
            className="w-full text-xs flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-white transition font-medium"
            title="Open Local Terminal"
          >
            <Terminal className="w-4 h-4" /> Local Terminal
          </button>

          <div className="flex gap-2">
            <button
            onClick={() => setIsKeyManagerOpen(true)}
            className="flex-1 text-xs flex items-center justify-center gap-2 py-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded text-gray-300 transition"
            title="Manage SSH Keys"
            >
            <Key className="w-3 h-3" /> Keys
            </button>
            <button
            onClick={onOpenSettings}
            className="w-8 flex items-center justify-center py-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded text-gray-300 transition"
            title="Settings"
            >
            <SettingsIcon className="w-3 h-3" />
            </button>
            <button
            onClick={onOpenAbout}
            className="w-8 flex items-center justify-center py-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded text-gray-300 transition"
            title="About"
            >
            <Info className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {servers.map((server) => (
          <div
            key={server.id}
            className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
              activeServerId === server.id
                ? 'bg-indigo-600/20 border border-indigo-500/50 text-white'
                : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200 border border-transparent'
            }`}
            onClick={() => onSelectServer(server)}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <ServerIcon className={`w-4 h-4 ${activeServerId === server.id ? 'text-indigo-400' : 'text-gray-500'}`} />
              <div className="flex flex-col truncate">
                <span className="font-medium text-sm truncate">{server.name}</span>
                <span className="text-xs opacity-60 truncate">{server.username}@{server.host}</span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteServer(server.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {servers.length === 0 && !isAdding && (
          <div className="text-center p-4 text-gray-500 text-sm">
            No servers saved. <br/> Click + to add one.
          </div>
        )}
      </div>

      {isAdding && (
        <div className="absolute top-0 left-0 w-full h-full bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-xl w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
              <Monitor className="w-5 h-5" /> Add New Server
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  placeholder="Production DB"
                  className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Host / IP</label>
                  <input
                    type="text"
                    placeholder="192.168.1.10"
                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition"
                    value={newServer.host}
                    onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                  />
                </div>
                <div className="w-20">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                  <input
                    type="number"
                    placeholder="22"
                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition"
                    value={newServer.port}
                    onChange={(e) => setNewServer({ ...newServer, port: parseInt(e.target.value) || 22 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  placeholder="root"
                  className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition"
                  value={newServer.username}
                  onChange={(e) => setNewServer({ ...newServer, username: e.target.value })}
                />
              </div>

              {/* Authentication Method Selection */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Authentication Method</label>
                <select
                  className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition appearance-none"
                  value={newServer.preferredAuthMethod || 'password'}
                  onChange={(e) => setNewServer({ ...newServer, preferredAuthMethod: e.target.value as 'password' | 'key' })}
                >
                  <option value="password">Password</option>
                  <option value="key">SSH Key</option>
                </select>
              </div>

              {/* Password Field - Show only if password auth is selected */}
              {newServer.preferredAuthMethod === 'password' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="Enter password"
                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition"
                    value={newServer.password || ''}
                    onChange={(e) => setNewServer({ ...newServer, password: e.target.value })}
                  />
                </div>
              )}

              {/* SSH Key Selection - Show only if key auth is selected */}
              {newServer.preferredAuthMethod === 'key' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">SSH Key</label>
                  <select
                    className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none transition appearance-none"
                    value={newServer.sshKeyId || ''}
                    onChange={(e) => setNewServer({ ...newServer, sshKeyId: e.target.value })}
                  >
                    <option value="">Select a key...</option>
                    {sshKeys.map(key => (
                      <option key={key.id} value={key.id}>{key.name}</option>
                    ))}
                  </select>
                </div>
              )}

            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setIsAdding(false)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition shadow-[0_0_15px_rgba(79,70,229,0.3)]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <SSHKeyManager 
        isOpen={isKeyManagerOpen} 
        onClose={() => setIsKeyManagerOpen(false)}
        keys={sshKeys}
        onAddKey={onAddKey}
        onDeleteKey={onDeleteKey}
      />
    </div>
  );
};

export default ServerList;
