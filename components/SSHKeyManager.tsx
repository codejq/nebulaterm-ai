import React, { useState } from 'react';
import { SSHKey } from '../types';
import { X, Key, Plus, Trash2, Check, ShieldCheck } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

interface SSHKeyManagerProps {
  isOpen: boolean;
  onClose: () => void;
  keys: SSHKey[];
  onAddKey: (key: SSHKey) => void;
  onDeleteKey: (id: string) => void;
}

const SSHKeyManager: React.FC<SSHKeyManagerProps> = ({ isOpen, onClose, keys, onAddKey, onDeleteKey }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyContent, setNewKeyContent] = useState('');
  const [newKeyPassphrase, setNewKeyPassphrase] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (newKeyName && newKeyContent) {
      const keyId = crypto.randomUUID();
      setIsSaving(true);
      setSaveError(null);

      try {
        // Save key content to file using Tauri backend
        const keyPath = await invoke<string>('save_ssh_key_to_file', {
          keyId: keyId,
          keyContent: newKeyContent,
        });

        console.log('Key saved to:', keyPath);

        // Add key with file path
        onAddKey({
          id: keyId,
          name: newKeyName,
          content: newKeyContent, // Keep content for display/backup
          privateKeyPath: keyPath,
          passphrase: newKeyPassphrase || undefined,
        });

        setNewKeyName('');
        setNewKeyContent('');
        setNewKeyPassphrase('');
        setIsAdding(false);
        setIsSaving(false);
      } catch (error) {
        console.error('Failed to save SSH key:', error);
        setSaveError(`Failed to save SSH key: ${error}`);
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-400" /> SSH Key Management
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex-1 overflow-hidden flex">
          {/* List */}
          <div className="w-1/3 border-r border-gray-800 p-2 overflow-y-auto bg-gray-900">
             <button 
               onClick={() => setIsAdding(true)}
               className="w-full py-2 px-3 mb-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded flex items-center justify-center gap-2 text-sm transition"
             >
               <Plus className="w-4 h-4" /> Import Key
             </button>
             {keys.length === 0 && !isAdding && (
               <div className="text-center text-gray-600 text-xs py-4">No keys found</div>
             )}
             {keys.map(k => (
               <div key={k.id} className="group flex items-center justify-between p-2 rounded hover:bg-gray-800 mb-1 transition">
                 <div className="flex items-center gap-2 overflow-hidden">
                   <Key className="w-3 h-3 text-gray-500" />
                   <span className="text-sm text-gray-300 truncate">{k.name}</span>
                 </div>
                 <button onClick={() => onDeleteKey(k.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition">
                   <Trash2 className="w-3 h-3" />
                 </button>
               </div>
             ))}
          </div>

          {/* Details / Form */}
          <div className="flex-1 p-4 overflow-y-auto bg-gray-950/50">
            {isAdding ? (
              <div className="space-y-4">
                <div>
                   <label className="block text-xs font-medium text-gray-400 mb-1">Key Name</label>
                   <input 
                     value={newKeyName}
                     onChange={e => setNewKeyName(e.target.value)}
                     className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none"
                     placeholder="e.g. AWS Production Key"
                     autoFocus
                   />
                </div>
                <div>
                   <label className="block text-xs font-medium text-gray-400 mb-1">Private Key (PEM/OpenSSH)</label>
                   <textarea 
                     value={newKeyContent}
                     onChange={e => setNewKeyContent(e.target.value)}
                     className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-xs font-mono text-gray-300 focus:border-indigo-500 outline-none resize-none"
                     placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                   />
                   <p className="text-[10px] text-gray-500 mt-1">Keys are securely saved to disk and work with all formats (OpenSSH, PEM, PKCS#8).</p>
                </div>
                {saveError && (
                  <div className="p-2 bg-red-900/20 border border-red-700/50 rounded text-red-400 text-xs">
                    {saveError}
                  </div>
                )}
                <div>
                   <label className="block text-xs font-medium text-gray-400 mb-1">Passphrase (optional)</label>
                   <input
                     type="password"
                     value={newKeyPassphrase}
                     onChange={e => setNewKeyPassphrase(e.target.value)}
                     className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:border-indigo-500 outline-none"
                     placeholder="Leave empty if key has no passphrase"
                   />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setSaveError(null);
                    }}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!newKeyName || !newKeyContent || isSaving}
                    className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white flex items-center gap-1 transition"
                  >
                    {isSaving ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3" /> Save Key
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-500">
                <ShieldCheck className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">Secure Key Storage</p>
                <p className="text-xs opacity-60 mt-1 text-center max-w-[200px]">
                  Import your private keys here to associate them with your saved servers.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SSHKeyManager;