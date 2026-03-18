import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ServerList from '../components/ServerList';
import { Server, SSHKey } from '../types';

// Mock SSHKeyManager to avoid rendering complexity
vi.mock('../components/SSHKeyManager', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="ssh-key-manager">SSHKeyManager</div> : null,
}));

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  id: 'server-1',
  name: 'My Server',
  host: '192.168.1.1',
  username: 'root',
  port: 22,
  os: 'linux',
  preferredAuthMethod: 'password',
  ...overrides,
});

const defaultSshKeys: SSHKey[] = [
  { id: 'key-1', name: 'My Key', content: '---key---' },
];

const defaultProps = {
  servers: [] as Server[],
  activeServerId: null,
  onSelectServer: vi.fn(),
  onAddServer: vi.fn(),
  onEditServer: vi.fn(),
  onDeleteServer: vi.fn(),
  sshKeys: defaultSshKeys,
  onAddKey: vi.fn(),
  onDeleteKey: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenAbout: vi.fn(),
};

function renderServerList(props: Partial<typeof defaultProps> = {}) {
  return render(<ServerList {...defaultProps} {...props} />);
}

describe('ServerList', () => {
  beforeEach(() => vi.clearAllMocks());

  // 1. Renders list of provided servers
  it('renders list of provided servers', () => {
    const servers = [
      makeServer({ id: 's1', name: 'Alpha', host: '10.0.0.1', username: 'admin' }),
      makeServer({ id: 's2', name: 'Beta', host: '10.0.0.2', username: 'user' }),
    ];
    renderServerList({ servers });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('admin@10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('user@10.0.0.2')).toBeInTheDocument();
  });

  // 2. Shows empty state message when list is empty
  it('shows empty state message when list is empty', () => {
    renderServerList({ servers: [] });
    expect(screen.getByText(/No servers saved/i)).toBeInTheDocument();
    expect(screen.getByText(/Click \+ to add one/i)).toBeInTheDocument();
  });

  // 3. Calls onSelectServer when a server row is clicked
  it('calls onSelectServer when a server row is clicked', () => {
    const server = makeServer();
    const onSelectServer = vi.fn();
    renderServerList({ servers: [server], onSelectServer });
    fireEvent.click(screen.getByText('My Server'));
    expect(onSelectServer).toHaveBeenCalledWith(server);
  });

  // 4. Shows add-server form when "+" button clicked
  it('shows add-server form when Plus button is clicked', () => {
    renderServerList();
    fireEvent.click(screen.getByTitle('Add Server'));
    expect(screen.getByText('Add New Server')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Production DB')).toBeInTheDocument();
  });

  // 5. Hides form when cancelled
  it('hides form when Cancel is clicked', () => {
    renderServerList();
    fireEvent.click(screen.getByTitle('Add Server'));
    expect(screen.getByText('Add New Server')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Add New Server')).not.toBeInTheDocument();
  });

  // 6. Save button disabled until required fields are filled — actually the button
  //    is always rendered but handleSave guards on name+host+username. Test that
  //    clicking Save with empty fields does NOT call onAddServer.
  it('does not call onAddServer when required fields are empty', () => {
    const onAddServer = vi.fn();
    renderServerList({ onAddServer });
    fireEvent.click(screen.getByTitle('Add Server'));
    // username has default 'root', but name and host are empty
    fireEvent.click(screen.getByText('Save'));
    expect(onAddServer).not.toHaveBeenCalled();
  });

  // 7. Submitting the add form calls onAddServer with correct shape (including id)
  it('submitting add form calls onAddServer with correct shape including id', () => {
    const onAddServer = vi.fn();
    renderServerList({ onAddServer });
    fireEvent.click(screen.getByTitle('Add Server'));

    fireEvent.change(screen.getByPlaceholderText('Production DB'), {
      target: { value: 'Test Server' },
    });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), {
      target: { value: '1.2.3.4' },
    });
    // username already defaults to 'root'
    fireEvent.click(screen.getByText('Save'));

    expect(onAddServer).toHaveBeenCalledTimes(1);
    const arg = onAddServer.mock.calls[0][0] as Server;
    expect(arg.name).toBe('Test Server');
    expect(arg.host).toBe('1.2.3.4');
    expect(arg.username).toBe('root');
    expect(typeof arg.id).toBe('string');
    expect(arg.id.length).toBeGreaterThan(0);
  });

  // 8. Port defaults to 22 when left empty (port input cleared to NaN → defaults to 22)
  it('port defaults to 22 when port input is cleared', () => {
    const onAddServer = vi.fn();
    renderServerList({ onAddServer });
    fireEvent.click(screen.getByTitle('Add Server'));

    fireEvent.change(screen.getByPlaceholderText('Production DB'), {
      target: { value: 'My Box' },
    });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), {
      target: { value: '5.6.7.8' },
    });
    // Clear the port field — parseInt('') returns NaN, component falls back to 22
    fireEvent.change(screen.getByPlaceholderText('22'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onAddServer).toHaveBeenCalledTimes(1);
    expect(onAddServer.mock.calls[0][0].port).toBe(22);
  });

  // 9. Edit button populates form with server's existing values
  it('edit button populates form with existing server values', () => {
    const server = makeServer({
      name: 'Existing',
      host: '10.10.10.10',
      username: 'admin',
      port: 2222,
    });
    renderServerList({ servers: [server] });
    fireEvent.click(screen.getByTitle('Edit Server'));
    expect(screen.getByText('Edit Server')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10.10.10.10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('admin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2222')).toBeInTheDocument();
  });

  // 10. Updating and submitting calls onEditServer with merged data
  it('updating and submitting calls onEditServer with merged data', () => {
    const server = makeServer({ id: 'edit-id', name: 'Old Name' });
    const onEditServer = vi.fn();
    renderServerList({ servers: [server], onEditServer });

    fireEvent.click(screen.getByTitle('Edit Server'));
    const nameInput = screen.getByDisplayValue('Old Name');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText('Update'));

    expect(onEditServer).toHaveBeenCalledTimes(1);
    const arg = onEditServer.mock.calls[0][0] as Server;
    expect(arg.name).toBe('New Name');
    expect(arg.id).toBe('edit-id');
  });

  // 11. Cancel button resets form and hides it
  it('cancel button resets form state and hides it', () => {
    const server = makeServer();
    renderServerList({ servers: [server] });
    fireEvent.click(screen.getByTitle('Edit Server'));
    expect(screen.getByText('Edit Server')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Edit Server')).not.toBeInTheDocument();
    expect(screen.queryByText('Add New Server')).not.toBeInTheDocument();
  });

  // 12. Delete button calls onDeleteServer with server id
  it('delete button calls onDeleteServer with server id', () => {
    const server = makeServer({ id: 'del-id' });
    const onDeleteServer = vi.fn();
    renderServerList({ servers: [server], onDeleteServer });
    fireEvent.click(screen.getByTitle('Delete Server'));
    expect(onDeleteServer).toHaveBeenCalledWith('del-id');
  });

  // 13. Delete button click does not trigger row/select click (stopPropagation)
  it('delete button click does not trigger onSelectServer', () => {
    const server = makeServer({ id: 'sp-id' });
    const onSelectServer = vi.fn();
    const onDeleteServer = vi.fn();
    renderServerList({ servers: [server], onSelectServer, onDeleteServer });
    fireEvent.click(screen.getByTitle('Delete Server'));
    expect(onDeleteServer).toHaveBeenCalledTimes(1);
    expect(onSelectServer).not.toHaveBeenCalled();
  });

  // 14. Password field shown when auth method is "password"
  it('shows password field when authentication method is password', () => {
    renderServerList();
    fireEvent.click(screen.getByTitle('Add Server'));
    // default is 'password'
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
  });

  // 15. SSH key selector shown when auth method is "key"
  it('shows SSH key selector when auth method is key', () => {
    renderServerList();
    fireEvent.click(screen.getByTitle('Add Server'));
    const authSelect = screen.getByDisplayValue('Password');
    fireEvent.change(authSelect, { target: { value: 'key' } });
    expect(screen.getByText('Select a key...')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter password')).not.toBeInTheDocument();
  });

  // 16. SSH key dropdown lists provided sshKeys
  it('SSH key dropdown lists provided sshKeys', () => {
    const keys: SSHKey[] = [
      { id: 'k1', name: 'Deploy Key', content: 'abc' },
      { id: 'k2', name: 'Personal Key', content: 'xyz' },
    ];
    renderServerList({ sshKeys: keys });
    fireEvent.click(screen.getByTitle('Add Server'));
    const authSelect = screen.getByDisplayValue('Password');
    fireEvent.change(authSelect, { target: { value: 'key' } });
    expect(screen.getByText('Deploy Key')).toBeInTheDocument();
    expect(screen.getByText('Personal Key')).toBeInTheDocument();
  });

  // 17. "Local Terminal" button calls onSelectServer with a local-type server
  it('Local Terminal button calls onSelectServer with a local-type server', () => {
    const onSelectServer = vi.fn();
    renderServerList({ onSelectServer });
    fireEvent.click(screen.getByTitle('Open Local Terminal'));
    expect(onSelectServer).toHaveBeenCalledTimes(1);
    const arg = onSelectServer.mock.calls[0][0] as Server;
    expect(arg.isLocal).toBe(true);
    expect(arg.name).toBe('Local Terminal');
  });

  // 18. Keys button toggles SSHKeyManager visibility
  it('Keys button opens SSHKeyManager', () => {
    renderServerList();
    expect(screen.queryByTestId('ssh-key-manager')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Manage SSH Keys'));
    expect(screen.getByTestId('ssh-key-manager')).toBeInTheDocument();
  });

  // 19. Settings button calls onOpenSettings
  it('Settings button calls onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    renderServerList({ onOpenSettings });
    fireEvent.click(screen.getByTitle('Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  // 20. About button calls onOpenAbout
  it('About button calls onOpenAbout', () => {
    const onOpenAbout = vi.fn();
    renderServerList({ onOpenAbout });
    fireEvent.click(screen.getByTitle('About'));
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });
});
