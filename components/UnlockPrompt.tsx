import React, { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

interface UnlockPromptProps {
  onUnlock: () => void;
}

const UnlockPrompt: React.FC<UnlockPromptProps> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await invoke('unlock_database', { password });
      onUnlock();
    } catch (err) {
      setError(String(err) || 'Invalid password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleUnlock();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-md rounded-xl shadow-2xl p-6">

        {/* Header */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-indigo-600/20 rounded-full flex items-center justify-center">
            <Lock className="w-8 h-8 text-indigo-400" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white text-center mb-2">
          Database Locked
        </h2>
        <p className="text-sm text-gray-400 text-center mb-6">
          Enter your master password to access your encrypted credentials
        </p>

        {/* Password Input */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Master Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm text-white focus:border-indigo-500 outline-none transition"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-300">{error}</span>
            </div>
          )}

          <button
            onClick={handleUnlock}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition shadow-[0_0_15px_rgba(79,70,229,0.3)]"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Unlocking...
              </div>
            ) : (
              'Unlock'
            )}
          </button>
        </div>

        {/* Skip Notice */}
        <div className="mt-6 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
          <p className="text-xs text-gray-400 text-center">
            Your credentials are encrypted with AES-256. Without the correct password, they cannot be decrypted.
          </p>
        </div>
      </div>
    </div>
  );
};

export default UnlockPrompt;
