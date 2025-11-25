
import React from 'react';
import { AppSettings, AIProviderId } from '../types';
import { X, Settings, Cpu, Globe, Key, Lock, Shield } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

type SettingsTab = AIProviderId | 'security';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  // Local state to handle changes before saving
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('gemini');

  // Security state
  const [hasMasterPassword, setHasMasterPassword] = React.useState<boolean>(false);
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwordError, setPasswordError] = React.useState('');
  const [passwordSuccess, setPasswordSuccess] = React.useState('');

  // Sync when opening
  React.useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setActiveTab(settings.activeProvider);
      checkMasterPassword();
    }
  }, [isOpen, settings]);

  const checkMasterPassword = async () => {
    try {
      const result = await invoke<boolean>('has_master_password');
      setHasMasterPassword(result);
    } catch (error) {
      console.error('Failed to check master password:', error);
    }
  };

  const handleSetMasterPassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!newPassword) {
      setPasswordError('Password cannot be empty');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      await invoke('set_master_password', { password: newPassword });
      setHasMasterPassword(true);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Master password set successfully! Your credentials are now encrypted.');
    } catch (error) {
      setPasswordError(`Failed to set password: ${error}`);
    }
  };

  if (!isOpen) return null;

  const handleUpdateProvider = (provider: AIProviderId, field: string, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: {
          ...prev.providers[provider],
          [field]: value
        }
      }
    }));
  };

  const handleSave = () => {
    onSave({
      ...localSettings,
      // Only update activeProvider if we're on an AI provider tab, not security
      activeProvider: activeTab === 'security' ? localSettings.activeProvider : activeTab
    });
    onClose();
  };

  const providersList: {id: AIProviderId, label: string}[] = [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'grok', label: 'xAI Grok' },
    { id: 'anthropic', label: 'Anthropic Claude' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'ollama', label: 'Ollama (Local/Remote)' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" /> Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 bg-gray-950/50 border-r border-gray-800 p-2 space-y-1">
            <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Security</div>
            <button
              onClick={() => setActiveTab('security')}
              className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 transition ${
                activeTab === 'security'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <Shield className="w-4 h-4" />
              Master Password
            </button>

            <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">AI Providers</div>
            {providersList.map(p => (
              <button
                key={p.id}
                onClick={() => setActiveTab(p.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 transition ${
                  activeTab === p.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <Cpu className="w-4 h-4" />
                {p.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto bg-gray-900">
            {activeTab === 'security' ? (
              // Security Settings
              <>
                <h3 className="text-xl font-bold text-white mb-1">
                  <Lock className="w-5 h-5 inline mr-2 text-indigo-400" />
                  Master Password
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  Set a master password to encrypt all your credentials. Your data will be stored securely on disk and can be moved to another machine.
                </p>

                <div className="space-y-4">
                  {/* Status */}
                  <div className={`p-4 rounded-lg border ${
                    hasMasterPassword
                      ? 'bg-green-900/20 border-green-700'
                      : 'bg-orange-900/20 border-orange-700'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {hasMasterPassword ? (
                        <>
                          <Shield className="w-4 h-4 text-green-400" />
                          <span className="text-sm font-semibold text-green-400">Password Set</span>
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4 text-orange-400" />
                          <span className="text-sm font-semibold text-orange-400">No Password Set</span>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-gray-300">
                      {hasMasterPassword
                        ? 'Your credentials are encrypted and stored in a local SQLite database.'
                        : 'Set a master password to enable encrypted credential storage.'}
                    </p>
                  </div>

                  {/* Set/Change Password */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        {hasMasterPassword ? 'New Master Password' : 'Master Password'}
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded p-2.5 text-sm text-white focus:border-indigo-500 outline-none transition"
                        placeholder="Enter password (min 8 characters)"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded p-2.5 text-sm text-white focus:border-indigo-500 outline-none transition"
                        placeholder="Re-enter password"
                      />
                    </div>

                    {passwordError && (
                      <div className="p-3 bg-red-900/20 border border-red-700 rounded text-xs text-red-300">
                        {passwordError}
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="p-3 bg-green-900/20 border border-green-700 rounded text-xs text-green-300">
                        {passwordSuccess}
                      </div>
                    )}

                    <button
                      onClick={handleSetMasterPassword}
                      className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded transition shadow-[0_0_15px_rgba(79,70,229,0.3)]"
                    >
                      {hasMasterPassword ? 'Change Master Password' : 'Set Master Password'}
                    </button>
                  </div>

                  {/* Info Box */}
                  <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg">
                    <h4 className="text-sm font-semibold text-white mb-2">Portable Database</h4>
                    <p className="text-xs text-gray-400 mb-2">
                      Your encrypted database is stored in the same directory as the application executable. Simply move the entire app folder to another machine and your credentials will come with it.
                    </p>
                    <p className="text-xs text-gray-500">
                      File: <code className="text-indigo-400">nebulaterm.db</code> (next to the .exe)
                    </p>
                  </div>
                </div>
              </>
            ) : (
              // AI Provider Settings
              <>
                <h3 className="text-xl font-bold text-white mb-1">
                  {providersList.find(p => p.id === activeTab)?.label}
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  Configure connection details for this provider.
                </p>

                <div className="space-y-4">

                  {/* Activation Check */}
                  <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg flex items-center justify-between">
                    <span className="text-sm text-gray-200">Set as Active Provider</span>
                    <button
                      onClick={() => setLocalSettings(prev => ({...prev, activeProvider: activeTab as AIProviderId}))}
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        localSettings.activeProvider === activeTab
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'border-gray-500'
                      }`}
                    >
                      {localSettings.activeProvider === activeTab && <div className="w-2 h-2 bg-white rounded-full" />}
                    </button>
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                      <Key className="w-3 h-3" /> API Key
                    </label>
                    <input
                      type="password"
                      value={localSettings.providers[activeTab as AIProviderId]?.apiKey || ''}
                      onChange={(e) => handleUpdateProvider(activeTab as AIProviderId, 'apiKey', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-700 rounded p-2.5 text-sm text-white focus:border-indigo-500 outline-none transition"
                      placeholder={activeTab === 'ollama' ? 'Optional (if using auth proxy)' : 'sk-...'}
                    />
                  </div>

                  {/* URL (Only specific providers) */}
                  {(activeTab === 'ollama' || activeTab === 'openai') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center gap-1">
                        <Globe className="w-3 h-3" /> Endpoint URL
                      </label>
                      <input
                        type="text"
                        value={localSettings.providers[activeTab as AIProviderId]?.baseUrl || ''}
                        onChange={(e) => handleUpdateProvider(activeTab as AIProviderId, 'baseUrl', e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded p-2.5 text-sm text-white focus:border-indigo-500 outline-none transition"
                        placeholder={activeTab === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                      />
                      {activeTab === 'ollama' && <p className="text-xs text-gray-500 mt-1">Point this to your remote server IP if not running locally.</p>}
                    </div>
                  )}

                  {/* Model Selection */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Model Name</label>
                    <input
                      type="text"
                      value={localSettings.providers[activeTab as AIProviderId]?.model || ''}
                      onChange={(e) => handleUpdateProvider(activeTab as AIProviderId, 'model', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-700 rounded p-2.5 text-sm text-white focus:border-indigo-500 outline-none transition"
                      placeholder={
                        activeTab === 'gemini' ? 'gemini-2.5-flash' :
                        activeTab === 'openai' ? 'gpt-4-turbo' :
                        activeTab === 'anthropic' ? 'claude-3-sonnet-20240229' :
                        activeTab === 'grok' ? 'grok-beta' :
                        activeTab === 'openrouter' ? 'openai/gpt-3.5-turbo' : 'llama3'
                      }
                    />
                    {activeTab === 'openrouter' && (
                      <p className="text-[10px] text-gray-500 mt-1">See openrouter.ai/docs/models for available model IDs.</p>
                    )}
                  </div>

                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-gray-900 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:text-white transition">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded transition shadow-[0_0_15px_rgba(79,70,229,0.3)]">
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
};

export default SettingsModal;