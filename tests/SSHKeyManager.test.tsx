import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import SSHKeyManager from '../components/SSHKeyManager';
import { SSHKey } from '../types';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  keys: [] as SSHKey[],
  onAddKey: vi.fn(),
  onDeleteKey: vi.fn(),
};

const sampleKeys: SSHKey[] = [
  { id: 'key-1', name: 'Production Key', content: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----' },
  { id: 'key-2', name: 'Dev Server Key', content: '-----BEGIN OPENSSH PRIVATE KEY-----\ndef\n-----END OPENSSH PRIVATE KEY-----' },
];

describe('SSHKeyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Returns null / renders nothing when isOpen is false
  it('returns null when isOpen is false', () => {
    const { container } = render(
      <SSHKeyManager {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  // 2. Renders modal when isOpen is true
  it('renders modal when isOpen is true', () => {
    render(<SSHKeyManager {...defaultProps} />);
    expect(screen.getByText('SSH Key Management')).toBeInTheDocument();
  });

  // 3. Shows empty state message when keys array is empty
  it('shows empty state message when keys array is empty', () => {
    render(<SSHKeyManager {...defaultProps} keys={[]} />);
    expect(screen.getByText('No keys found')).toBeInTheDocument();
  });

  // 4. Renders list of existing keys by name
  it('renders list of existing keys by name', () => {
    render(<SSHKeyManager {...defaultProps} keys={sampleKeys} />);
    expect(screen.getByText('Production Key')).toBeInTheDocument();
    expect(screen.getByText('Dev Server Key')).toBeInTheDocument();
  });

  // 5. Delete button calls onDeleteKey with key id
  it('delete button calls onDeleteKey with the correct key id', async () => {
    const onDeleteKey = vi.fn();
    render(
      <SSHKeyManager {...defaultProps} keys={sampleKeys} onDeleteKey={onDeleteKey} />
    );

    // The delete buttons are opacity-0 by default (group-hover), but still in the DOM
    // Get all Trash2 icon buttons by title or find them within key items
    const keyItem = screen.getByText('Production Key').closest('div.group');
    expect(keyItem).toBeTruthy();
    const deleteButton = keyItem!.querySelector('button');
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton!);

    expect(onDeleteKey).toHaveBeenCalledWith('key-1');
  });

  // 6. "Import Key" button shows the add-key form
  it('Import Key button shows the add-key form', () => {
    render(<SSHKeyManager {...defaultProps} />);
    fireEvent.click(screen.getByText('Import Key'));
    expect(screen.getByPlaceholderText('e.g. AWS Production Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...')).toBeInTheDocument();
  });

  // 7. Save button disabled when name or key content is empty
  it('Save Key button is disabled when name or content is empty', () => {
    render(<SSHKeyManager {...defaultProps} />);
    fireEvent.click(screen.getByText('Import Key'));

    const saveButton = screen.getByRole('button', { name: /save key/i });
    // Both fields empty - button should be disabled
    expect(saveButton).toBeDisabled();

    // Fill only name
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'My Key' },
    });
    expect(saveButton).toBeDisabled();

    // Clear name and fill only content
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----' },
    });
    expect(saveButton).toBeDisabled();
  });

  // 8. On save: calls invoke('save_ssh_key_to_file', ...) with keyId and keyContent
  it('calls invoke save_ssh_key_to_file with keyId and keyContent on save', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/to/key.pem');
    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);

    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Test Key' },
    });
    const keyContent = '-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----';
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: keyContent },
    });

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('save_ssh_key_to_file', expect.objectContaining({
        keyContent: keyContent,
      }));
    });

    // keyId should be a UUID string
    const callArgs = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.keyId).toBeTruthy();
    expect(typeof callArgs.keyId).toBe('string');
  });

  // 9. On save success: calls onAddKey with object including privateKeyPath from invoke result
  it('calls onAddKey with privateKeyPath from invoke result on success', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/home/user/.ssh/test_key.pem');
    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);

    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'My SSH Key' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(onAddKey).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My SSH Key',
          privateKeyPath: '/home/user/.ssh/test_key.pem',
        })
      );
    });
  });

  // 10a. Passphrase included in payload when provided
  it('passphrase is included in onAddKey payload when provided', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/key.pem');

    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);
    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Key With Passphrase' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });
    fireEvent.change(screen.getByPlaceholderText('Leave empty if key has no passphrase'), {
      target: { value: 'myPassphrase123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(onAddKey).toHaveBeenCalledWith(
        expect.objectContaining({ passphrase: 'myPassphrase123' })
      );
    });
  });

  // 10b. Passphrase is undefined in payload when left empty
  it('passphrase is undefined in onAddKey payload when left empty', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/key2.pem');

    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);
    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Key No Passphrase' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });
    // Leave passphrase field empty

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(onAddKey).toHaveBeenCalledWith(
        expect.objectContaining({ passphrase: undefined })
      );
    });
  });

  // 11. On save error: shows error message from rejected invoke
  it('shows error message when invoke rejects', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue('Permission denied');
    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);

    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Error Key' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to save SSH key: Permission denied/)).toBeInTheDocument();
    });
    expect(onAddKey).not.toHaveBeenCalled();
  });

  // 12. Cancel button hides form and clears error state
  it('Cancel button hides form and clears error state', async () => {
    const onAddKey = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue('Some error');
    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);

    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Error Key' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to save SSH key:/)).toBeInTheDocument();
    });

    // Click cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Form should be hidden and error cleared
    expect(screen.queryByPlaceholderText('e.g. AWS Production Key')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to save SSH key:/)).not.toBeInTheDocument();
  });

  // 13. Shows loading indicator during save operation
  it('shows loading indicator during save operation', async () => {
    const onAddKey = vi.fn();
    let resolveInvoke: (val: unknown) => void;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveInvoke = resolve; })
    );
    render(<SSHKeyManager {...defaultProps} onAddKey={onAddKey} />);

    fireEvent.click(screen.getByText('Import Key'));
    fireEvent.change(screen.getByPlaceholderText('e.g. AWS Production Key'), {
      target: { value: 'Loading Key' },
    });
    fireEvent.change(screen.getByPlaceholderText('-----BEGIN RSA PRIVATE KEY-----...'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\ncontent\n-----END RSA PRIVATE KEY-----' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save key/i }));

    // During loading, the button text should change to "Saving..."
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    // Resolve the promise
    resolveInvoke!('/path/key.pem');
    await waitFor(() => {
      expect(onAddKey).toHaveBeenCalledTimes(1);
    });
  });

  // 14. Close (X) button calls onClose
  it('Close (X) button calls onClose', () => {
    const onClose = vi.fn();
    render(<SSHKeyManager {...defaultProps} onClose={onClose} />);

    // The X button is an SVG inside a button; find the close button
    // It's positioned in the header next to the title
    const heading = screen.getByText('SSH Key Management');
    const header = heading.closest('div');
    const closeButton = header!.querySelector('button');
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
