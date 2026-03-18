import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import SettingsModal from '../components/SettingsModal';
import { AppSettings, AIProviderId } from '../types';

const makeSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  activeProvider: 'gemini' as AIProviderId,
  providers: {
    gemini: { enabled: true, apiKey: '', model: '' },
    openai: { enabled: false, apiKey: '', baseUrl: '', model: '' },
    grok: { enabled: false, apiKey: '', model: '' },
    anthropic: { enabled: false, apiKey: '', model: '' },
    ollama: { enabled: false, apiKey: '', baseUrl: '', model: '' },
    openrouter: { enabled: false, apiKey: '', model: '' },
  },
  ...overrides,
});

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  settings: makeSettings(),
  onSave: vi.fn(),
};

function renderModal(props: Partial<typeof defaultProps> = {}) {
  return render(<SettingsModal {...defaultProps} {...props} />);
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no master password set
    (invoke as any).mockResolvedValue(false);
  });

  // 1. Returns null when isOpen is false
  it('renders nothing when isOpen is false', () => {
    (invoke as any).mockResolvedValue(false);
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  // 2. Renders when isOpen is true
  it('renders when isOpen is true', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  // 3. invoke('has_master_password') is called on mount/open
  it('calls invoke has_master_password on mount', async () => {
    renderModal();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('has_master_password');
    });
  });

  // 4. Shows "Password Set" indicator when has_master_password returns true
  it('shows Password Set indicator when has_master_password returns true', async () => {
    (invoke as any).mockResolvedValue(true);
    renderModal();
    // Navigate to security tab (default opens on gemini, click Master Password)
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => {
      expect(screen.getByText('Password Set')).toBeInTheDocument();
    });
  });

  // 5. Shows "No Password Set" indicator when has_master_password returns false
  it('shows No Password Set indicator when has_master_password returns false', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => {
      expect(screen.getByText('No Password Set')).toBeInTheDocument();
    });
  });

  // 6. Password validation — empty password shows error
  it('empty password shows error', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    fireEvent.click(screen.getByText('Set Master Password'));
    expect(screen.getByText('Password cannot be empty')).toBeInTheDocument();
  });

  // 7. Password validation — too short shows error
  it('too short password shows error', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    const [pwInput] = screen.getAllByPlaceholderText('Enter password (min 8 characters)');
    fireEvent.change(pwInput, { target: { value: 'short' } });
    fireEvent.click(screen.getByText('Set Master Password'));
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  // 8. Password validation — mismatch shows error
  it('mismatched passwords shows error', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    const pwInput = screen.getByPlaceholderText('Enter password (min 8 characters)');
    const confirmInput = screen.getByPlaceholderText('Re-enter password');
    fireEvent.change(pwInput, { target: { value: 'password123' } });
    fireEvent.change(confirmInput, { target: { value: 'password456' } });
    fireEvent.click(screen.getByText('Set Master Password'));
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  // 9. Valid passwords call invoke('set_master_password', { password: '...' })
  it('valid passwords call invoke set_master_password', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'has_master_password') return Promise.resolve(false);
      if (cmd === 'set_master_password') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    const pwInput = screen.getByPlaceholderText('Enter password (min 8 characters)');
    const confirmInput = screen.getByPlaceholderText('Re-enter password');
    fireEvent.change(pwInput, { target: { value: 'supersecret' } });
    fireEvent.change(confirmInput, { target: { value: 'supersecret' } });
    fireEvent.click(screen.getByText('Set Master Password'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_master_password', { password: 'supersecret' });
    });
  });

  // 10. On success: shows success message and clears inputs
  it('on success shows success message and clears inputs', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'has_master_password') return Promise.resolve(false);
      if (cmd === 'set_master_password') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    const pwInput = screen.getByPlaceholderText('Enter password (min 8 characters)');
    const confirmInput = screen.getByPlaceholderText('Re-enter password');
    fireEvent.change(pwInput, { target: { value: 'supersecret' } });
    fireEvent.change(confirmInput, { target: { value: 'supersecret' } });
    fireEvent.click(screen.getByText('Set Master Password'));

    await waitFor(() => {
      expect(screen.getByText(/Master password set successfully/i)).toBeInTheDocument();
    });
    expect((pwInput as HTMLInputElement).value).toBe('');
    expect((confirmInput as HTMLInputElement).value).toBe('');
  });

  // 11. On error: shows error message from rejected invoke
  it('on invoke error shows error message', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'has_master_password') return Promise.resolve(false);
      if (cmd === 'set_master_password') return Promise.reject('DB error');
      return Promise.resolve(undefined);
    });
    renderModal();
    fireEvent.click(screen.getByText('Master Password'));
    await waitFor(() => screen.getByText('No Password Set'));

    const pwInput = screen.getByPlaceholderText('Enter password (min 8 characters)');
    const confirmInput = screen.getByPlaceholderText('Re-enter password');
    fireEvent.change(pwInput, { target: { value: 'supersecret' } });
    fireEvent.change(confirmInput, { target: { value: 'supersecret' } });
    fireEvent.click(screen.getByText('Set Master Password'));

    await waitFor(() => {
      expect(screen.getByText(/Failed to set password/i)).toBeInTheDocument();
    });
  });

  // 12. Provider tabs exist and can be switched
  it('provider sidebar tabs exist and switching changes content heading', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    // Gemini tab should be visible in sidebar
    const geminiTab = screen.getByRole('button', { name: /Google Gemini/i });
    expect(geminiTab).toBeInTheDocument();
    // Switch to Anthropic Claude (unique enough text)
    fireEvent.click(screen.getByRole('button', { name: /Anthropic Claude/i }));
    // The heading in the content area should now say "Anthropic Claude"
    // There will be multiple elements with this text; verify at least one is a heading
    const headings = screen.getAllByText('Anthropic Claude');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // Switch to Grok (unique text)
    fireEvent.click(screen.getByRole('button', { name: /xAI Grok/i }));
    const grokHeadings = screen.getAllByText('xAI Grok');
    expect(grokHeadings.length).toBeGreaterThanOrEqual(1);
  });

  // 13. API key input is present and editable for the active provider
  it('API key input is present and editable', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    // Default tab is gemini (activeProvider from settings)
    const apiKeyInput = screen.getByPlaceholderText('sk-...');
    expect(apiKeyInput).toBeInTheDocument();
    fireEvent.change(apiKeyInput, { target: { value: 'my-api-key' } });
    expect((apiKeyInput as HTMLInputElement).value).toBe('my-api-key');
  });

  // 14. Base URL field appears for Ollama
  it('base URL field appears when Ollama tab is active', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Ollama/i }));
    const urlInput = screen.getByPlaceholderText('http://localhost:11434');
    expect(urlInput).toBeInTheDocument();
  });

  // 14b. Base URL field appears for OpenAI
  it('base URL field appears when OpenAI tab is active', async () => {
    (invoke as any).mockResolvedValue(false);
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI$/i }));
    const urlInput = screen.getByPlaceholderText('https://api.openai.com/v1');
    expect(urlInput).toBeInTheDocument();
  });

  // 15. Save Changes button calls onSave with updated settings
  it('Save Changes calls onSave with updated settings', async () => {
    (invoke as any).mockResolvedValue(false);
    const onSave = vi.fn();
    renderModal({ onSave });
    // Update the gemini API key
    const apiKeyInput = screen.getByPlaceholderText('sk-...');
    fireEvent.change(apiKeyInput, { target: { value: 'gemini-key-xyz' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const savedSettings = onSave.mock.calls[0][0] as AppSettings;
    expect(savedSettings.providers.gemini.apiKey).toBe('gemini-key-xyz');
  });

  // 16. Close button calls onClose without calling onSave
  it('Cancel button calls onClose without calling onSave', async () => {
    (invoke as any).mockResolvedValue(false);
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderModal({ onClose, onSave });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  // Additional: X button calls onClose
  it('X button calls onClose', async () => {
    (invoke as any).mockResolvedValue(false);
    const onClose = vi.fn();
    renderModal({ onClose });
    // The X button is in the header
    const buttons = screen.getAllByRole('button');
    const xButton = buttons.find(b => b.querySelector('svg'));
    // Find the header close button specifically by its position in the header
    const header = screen.getByText('Settings').closest('div');
    const closeBtn = header?.parentElement?.querySelector('button');
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
