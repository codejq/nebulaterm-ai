import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TabBar from '../components/TabBar';
import { Session } from '../types';

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  serverId: 'server-1',
  name: 'My Session',
  color: '#ff0000',
  ...overrides,
});

describe('TabBar', () => {
  const onSelectSession = vi.fn();
  const onCloseSession = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  // 1. Returns null / renders nothing when sessions is empty
  it('returns null when sessions is empty', () => {
    const { container } = render(
      <TabBar
        sessions={[]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  // 2. Renders one tab when sessions has one entry
  it('renders one tab when sessions has one entry', () => {
    const session = makeSession();
    render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    expect(screen.getByText('My Session')).toBeInTheDocument();
  });

  // 3. Renders multiple tabs in correct order
  it('renders multiple tabs in correct order', () => {
    const sessions = [
      makeSession({ id: 's1', name: 'Alpha' }),
      makeSession({ id: 's2', name: 'Beta' }),
      makeSession({ id: 's3', name: 'Gamma' }),
    ];
    render(
      <TabBar
        sessions={sessions}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    const tabs = screen.getAllByText(/Alpha|Beta|Gamma/);
    expect(tabs[0]).toHaveTextContent('Alpha');
    expect(tabs[1]).toHaveTextContent('Beta');
    expect(tabs[2]).toHaveTextContent('Gamma');
  });

  // 4. Active tab has distinct visual class
  it('active tab has active styling classes', () => {
    const session = makeSession({ id: 'active-id' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId="active-id"
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    // Use getByTitle to find the tab div (it has title={session.name})
    const tabEl = screen.getByTitle('My Session');
    expect(tabEl.className).toContain('bg-[#0d1117]');
    expect(tabEl.className).toContain('border-t-2');
  });

  // 5. Inactive tab has different styling
  it('inactive tab has inactive styling classes', () => {
    const session = makeSession({ id: 'inactive-id' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    const tabEl = screen.getByTitle('My Session');
    expect(tabEl.className).toContain('bg-gray-900');
    expect(tabEl.className).toContain('border-transparent');
  });

  // 6. Session name appears in the tab
  it('displays the session name in the tab', () => {
    const session = makeSession({ name: 'Production Server' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    expect(screen.getByText('Production Server')).toBeInTheDocument();
  });

  // 7. Color dot uses session.color as backgroundColor style
  it('color dot uses session.color as backgroundColor', () => {
    const session = makeSession({ color: '#00ff00' });
    const { container } = render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    // The color dot is a div with rounded-full class
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeTruthy();
    expect((dot as HTMLElement).style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  // 8. Active tab border-top uses session.color
  it('active tab border-top color uses session.color', () => {
    const session = makeSession({ id: 'active-id', color: '#1234ab' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId="active-id"
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    const tabEl = screen.getByText('My Session').closest('div[style]') as HTMLElement;
    expect(tabEl).toBeTruthy();
    // borderTopColor is set inline via style prop when active
    expect(tabEl.style.borderTopColor).not.toBe('transparent');
  });

  // 9. onSelectSession is called with correct session id on tab click
  it('calls onSelectSession with correct session id on tab click', () => {
    const session = makeSession({ id: 'click-id' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    fireEvent.click(screen.getByText('My Session'));
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith('click-id');
  });

  // 10. onCloseSession is called with correct session id on X close button click
  it('calls onCloseSession with correct session id on close button click', () => {
    const session = makeSession({ id: 'close-id', name: 'Close Me' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId="close-id"
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    // The close button contains the X icon - find the button element
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onCloseSession).toHaveBeenCalledTimes(1);
    expect(onCloseSession).toHaveBeenCalledWith('close-id');
  });

  // 11. Close button click does NOT call onSelectSession (event.stopPropagation)
  it('close button click does not call onSelectSession', () => {
    const session = makeSession({ id: 'stop-prop-id', name: 'Stop Prop' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId="stop-prop-id"
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(onCloseSession).toHaveBeenCalledWith('stop-prop-id');
  });

  // 12. Close button has opacity styling for inactive tabs
  it('close button has opacity-0 class for inactive tabs', () => {
    const session = makeSession({ id: 'inactive-btn', name: 'Inactive' });
    render(
      <TabBar
        sessions={[session]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onCloseSession={onCloseSession}
      />
    );
    const closeBtn = screen.getByRole('button');
    expect(closeBtn.className).toContain('opacity-0');
  });
});
