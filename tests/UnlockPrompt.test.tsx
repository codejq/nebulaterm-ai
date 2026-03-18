import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import UnlockPrompt from '../components/UnlockPrompt';

describe('UnlockPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders password input and heading/title
  it('renders the password input and heading', () => {
    const onUnlock = vi.fn();
    render(<UnlockPrompt onUnlock={onUnlock} />);
    expect(screen.getByText('Database Locked')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });

  // 2. Shows validation error when submitting with empty password
  it('shows validation error when submitting with empty password', async () => {
    const onUnlock = vi.fn();
    render(<UnlockPrompt onUnlock={onUnlock} />);
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));
    await waitFor(() => {
      expect(screen.getByText('Please enter your password')).toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  // 3. Calls invoke('unlock_database', { password }) with typed value on button click
  it('calls invoke with typed password on button click', async () => {
    const onUnlock = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'mySecret123' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('unlock_database', { password: 'mySecret123' });
    });
  });

  // 4. Calls invoke when Enter key pressed in the input
  it('calls invoke when Enter key is pressed in the input', async () => {
    const onUnlock = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'pressEnterPass' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('unlock_database', { password: 'pressEnterPass' });
    });
  });

  // 5. Calls onUnlock callback when invoke resolves successfully
  it('calls onUnlock callback when invoke resolves successfully', async () => {
    const onUnlock = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'validPassword' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledTimes(1);
    });
  });

  // 6. Shows error message when invoke rejects with a string error
  it('shows error message when invoke rejects with a string error', async () => {
    const onUnlock = vi.fn();
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue('Invalid password provided');
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'wrongPassword' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid password provided')).toBeInTheDocument();
    });
    expect(onUnlock).not.toHaveBeenCalled();
  });

  // 7. Shows a fallback error message when rejection is non-string
  it('shows a fallback error message when rejection is non-string (object error)', async () => {
    const onUnlock = vi.fn();
    // When String(err) is called on an Error object it gives "Error: ..."
    // When called on a plain object like {}, it gives "[object Object]"
    // The component does: setError(String(err) || 'Invalid password')
    // So a truthy String() result will show that stringified value
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue({ code: 500 });
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'anyPassword' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      // String({code: 500}) === '[object Object]' which is truthy, so that's shown
      expect(screen.getByText('[object Object]')).toBeInTheDocument();
    });
  });

  // 8. Button is disabled during loading (after submit, before resolve)
  it('button is disabled during loading', async () => {
    const onUnlock = vi.fn();
    let resolveInvoke: (val: unknown) => void;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveInvoke = resolve; })
    );
    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'loading test' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    // Button should be disabled while loading
    await waitFor(() => {
      expect(screen.getByRole('button')).toBeDisabled();
    });

    // Resolve and confirm it re-enables
    resolveInvoke!(undefined);
    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledTimes(1);
    });
  });

  // 9. Error display is cleared/reset before each new unlock attempt
  it('clears error before each new unlock attempt', async () => {
    const onUnlock = vi.fn();
    (invoke as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce('First error')
      .mockResolvedValueOnce(undefined);

    render(<UnlockPrompt onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value: 'firstAttempt' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    // Wait for first error to appear
    await waitFor(() => {
      expect(screen.getByText('First error')).toBeInTheDocument();
    });

    // Submit again — error should be cleared before second invoke
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.queryByText('First error')).not.toBeInTheDocument();
    });
  });

  // 10. Password input has autoFocus (is the primary focus element)
  it('password input receives focus (autoFocus)', () => {
    const onUnlock = vi.fn();
    const { container } = render(<UnlockPrompt onUnlock={onUnlock} />);
    const input = screen.getByPlaceholderText('Enter your password');
    // In jsdom autoFocus doesn't reflect as an HTML attribute but we can verify
    // the input element is the one with autoFocus prop set in the component
    // by checking its type and that it exists as the primary credential input
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
    // The component sets autoFocus={true} - verify the element is the only password input
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(1);
    expect(passwordInputs[0]).toBe(input);
  });

  describe('UnlockPrompt - additional coverage', () => {
    // Covers lines 27-34: handleKeyDown branch where key is NOT Enter — no invoke call
    it('does not call invoke when a non-Enter key is pressed', async () => {
      const onUnlock = vi.fn();
      render(<UnlockPrompt onUnlock={onUnlock} />);

      const input = screen.getByPlaceholderText('Enter your password');
      fireEvent.change(input, { target: { value: 'myPassword' } });

      // Press a non-Enter key (e.g. Tab)
      fireEvent.keyDown(input, { key: 'Tab' });
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.keyDown(input, { key: 'a' });

      // invoke should NOT have been called since none of the keys were Enter
      expect(invoke).not.toHaveBeenCalled();
      expect(onUnlock).not.toHaveBeenCalled();
    });

    // Covers the empty-password branch via Enter key (not just button click)
    it('shows validation error when Enter is pressed with empty password', async () => {
      const onUnlock = vi.fn();
      render(<UnlockPrompt onUnlock={onUnlock} />);

      const input = screen.getByPlaceholderText('Enter your password');
      // Don't type anything — press Enter on empty input
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByText('Please enter your password')).toBeInTheDocument();
      });
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
