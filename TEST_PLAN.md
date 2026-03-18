# NebulaTerm-AI — Full Test Coverage Plan

## Current State

| File | Tests | Status |
|---|---|---|
| `tests/AboutModal.test.tsx` | 8 | Done |
| `tests/aiService.test.ts` | 10 | Done |
| `src-tauri/src/secure_storage.rs` | 12 | Done |
| `simple.test.ts` | 1 | Placeholder |
| **Total** | **31** | |

**Target: ~192 tests**

---

## Phase 1 — Mock Infrastructure (do first, unblocks everything)

### Files to Create

**`tests/__mocks__/@tauri-apps/api/core.ts`**
```ts
import { vi } from 'vitest'
export const invoke = vi.fn()
```

**`tests/__mocks__/@tauri-apps/api/event.ts`**
```ts
import { vi } from 'vitest'
export const listen = vi.fn(() => Promise.resolve(vi.fn()))
```

**`tests/__mocks__/@xterm/xterm.ts`**
```ts
import { vi } from 'vitest'
export class Terminal {
  onData = vi.fn()
  open = vi.fn()
  write = vi.fn()
  writeln = vi.fn()
  dispose = vi.fn()
  loadAddon = vi.fn()
  cols = 80
  rows = 24
  buffer = {
    active: {
      getLine: vi.fn(() => ({ translateToString: vi.fn(() => '') })),
      cursorY: 0,
    },
  }
}
```

**`tests/__mocks__/@xterm/addon-fit.ts`**
```ts
import { vi } from 'vitest'
export class FitAddon { fit = vi.fn(); activate = vi.fn() }
```

Same stub pattern for `@xterm/addon-web-links` and `@xterm/addon-search`.

### `vitest.config.ts` Updates

```ts
resolve: {
  alias: {
    '@tauri-apps/api/core': '/tests/__mocks__/@tauri-apps/api/core.ts',
    '@tauri-apps/api/event': '/tests/__mocks__/@tauri-apps/api/event.ts',
    '@xterm/xterm': '/tests/__mocks__/@xterm/xterm.ts',
    '@xterm/addon-fit': '/tests/__mocks__/@xterm/addon-fit.ts',
    '@xterm/addon-web-links': '/tests/__mocks__/@xterm/addon-web-links.ts',
    '@xterm/addon-search': '/tests/__mocks__/@xterm/addon-search.ts',
  }
},
test: {
  setupFiles: ['./tests/setup.ts'],
  coverage: {
    provider: 'v8',
    include: ['**/*.{ts,tsx}'],
    exclude: ['node_modules/', 'src-tauri/', 'dist/', '*.config.*', 'index.tsx', 'tests/__mocks__/**'],
  }
}
```

### `tests/setup.ts` Updates

Add global stubs needed by all tests:
```ts
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// crypto.randomUUID needed by ServerList
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: vi.fn(() => 'test-uuid-1234') }
})

// localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// window.matchMedia (needed by xterm)
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
})
```

---

## Phase 2 — Pure Presentational Components

### `tests/TabBar.test.tsx` — 12 tests

| # | Scenario |
|---|---|
| 1 | Returns null when `sessions` is empty |
| 2 | Renders one tab when sessions has one entry |
| 3 | Renders multiple tabs in correct order |
| 4 | Active tab has `bg-[#0d1117]` class |
| 5 | Inactive tab has `bg-gray-900` class |
| 6 | Session name appears in correct span |
| 7 | Color dot uses `session.color` as `backgroundColor` |
| 8 | Active tab border-top uses `session.color` |
| 9 | `onSelectSession` called with correct id on tab click |
| 10 | `onCloseSession` called with correct id on X click |
| 11 | Close click does NOT call `onSelectSession` (stopPropagation) |
| 12 | Close button is `opacity-0` on inactive tab |

---

## Phase 3 — Simple Invoke Components

### `tests/UnlockPrompt.test.tsx` — 10 tests

Mocks: `invoke` from `@tauri-apps/api/core`

| # | Scenario |
|---|---|
| 1 | Renders "Database Locked" heading and password input |
| 2 | Shows "Please enter your password" error on empty submit |
| 3 | Calls `invoke('unlock_database', { password })` with typed value |
| 4 | Calls `invoke` when Enter key pressed in input |
| 5 | Calls `onUnlock` callback when invoke resolves successfully |
| 6 | Shows error message when invoke rejects with string |
| 7 | Shows "Invalid password" when rejection is non-string |
| 8 | Button disabled and shows spinner during loading |
| 9 | Error is cleared before each new unlock attempt |
| 10 | `autoFocus` attribute present on password input |

### `tests/SSHKeyManager.test.tsx` — 14 tests

Mocks: `invoke('save_ssh_key_to_file')`

| # | Scenario |
|---|---|
| 1 | Returns null when `isOpen` is false |
| 2 | Renders modal when `isOpen` is true |
| 3 | Shows "No keys found" when `keys` array is empty |
| 4 | Renders list of existing keys by name |
| 5 | Delete button calls `onDeleteKey` with key id |
| 6 | "Import Key" button shows the add-key form |
| 7 | Save button disabled when name or content is empty |
| 8 | On save success: calls `invoke('save_ssh_key_to_file', ...)` |
| 9 | On save success: calls `onAddKey` with `privateKeyPath` from invoke result |
| 10 | Passphrase included in payload only if non-empty |
| 11 | On save error: shows error message from rejected invoke |
| 12 | Cancel button hides form and clears error |
| 13 | Shows spinner during save (`isSaving` state) |
| 14 | Close (X) button calls `onClose` |

---

## Phase 4 — State-Heavy Components

### `tests/ServerList.test.tsx` — 21 tests

Mocks: none (pure presentational + parent callbacks)

| # | Scenario |
|---|---|
| 1 | Renders list of provided servers |
| 2 | Shows "No servers saved" when list is empty |
| 3 | Calls `onSelectServer` when a server row is clicked |
| 4 | Shows add-server form when "+" clicked |
| 5 | Hides form when "+" clicked again (toggle) |
| 6 | "Save" disabled until name, host, username are filled |
| 7 | Submitting add form calls `onAddServer` with correct shape |
| 8 | `crypto.randomUUID()` assigned as new server id |
| 9 | Port defaults to 22 when left empty |
| 10 | Edit button populates form with server's existing values |
| 11 | Updating and clicking "Update" calls `onEditServer` with merged data |
| 12 | Cancel button resets form and hides it |
| 13 | Delete button calls `onDeleteServer` with server id |
| 14 | Delete click does not trigger row click (stopPropagation) |
| 15 | Password field shown when auth method is "password" |
| 16 | SSH key dropdown shown when auth method is "key" |
| 17 | SSH key dropdown lists provided `sshKeys` |
| 18 | "Local Terminal" button calls `onSelectServer` with `isLocal: true` |
| 19 | "Keys" button toggles `SSHKeyManager` visibility |
| 20 | "Settings" button calls `onOpenSettings` |
| 21 | "About" button calls `onOpenAbout` |

### `tests/SettingsModal.test.tsx` — 20 tests

Mocks: `invoke('has_master_password')`, `invoke('set_master_password')`

| # | Scenario |
|---|---|
| 1 | Returns null when `isOpen` is false |
| 2 | Renders when `isOpen` is true |
| 3 | `invoke('has_master_password')` called on open |
| 4 | Shows "Password Set" when returns true |
| 5 | Shows "No Password Set" when returns false |
| 6 | Empty password shows "Password cannot be empty" |
| 7 | Password < 8 chars shows "must be at least 8 characters" |
| 8 | Mismatched passwords shows "Passwords do not match" |
| 9 | Valid passwords call `invoke('set_master_password', { password })` |
| 10 | On success: shows success message, clears inputs |
| 11 | On invoke error: shows error message |
| 12 | Switching provider tabs updates active tab highlight |
| 13 | API key field for active provider is editable |
| 14 | Base URL field appears for Ollama and OpenAI tabs only |
| 15 | Base URL field does NOT appear for Gemini/Anthropic |
| 16 | "Set as Active Provider" radio marks it selected |
| 17 | "Save Changes" calls `onSave` with updated settings |
| 18 | `activeProvider` reflects selected tab |
| 19 | Cancel calls `onClose` without calling `onSave` |
| 20 | Settings re-sync from props when modal re-opens |

---

## Phase 5 — Services

### `tests/aiService.test.ts` — additions (+8 tests, total 18)

| # | New Scenario |
|---|---|
| 1 | `callOpenAICompatible` — successful response parsed correctly |
| 2 | `callOpenAICompatible` — non-200 response throws with status code |
| 3 | Grok uses `api.x.ai` base URL |
| 4 | `callAnthropic` — parses `content[0].text` from successful response |
| 5 | `callAnthropic` — falls back to regex JSON extraction |
| 6 | `callOpenRouter` — parses `choices[0].message.content` |
| 7 | `autoCorrectAI` — returns command unchanged on error |
| 8 | Ollama: JSON embedded in free-form text is extracted |

### `tests/geminiService.test.ts` — 5 tests

Mocks: `@google/genai`

| # | Scenario |
|---|---|
| 1 | Returns parsed `markdown` and `suggestedCommand` from mock response |
| 2 | Returns error markdown when `GoogleGenAI` throws |
| 3 | Returns fallback markdown when response text is empty |
| 4 | `autoCorrectCommand` returns suggestion from parsed response |
| 5 | `autoCorrectCommand` returns original command with error markdown on failure |

---

## Phase 6 — App Root

### `tests/App.test.tsx` — 15 tests

Mocks: `invoke('init_secure_storage')`, `invoke('has_master_password')`, `invoke('is_database_unlocked')`, `invoke('delete_ssh_key_file')`, localStorage

| # | Scenario |
|---|---|
| 1 | Shows loading spinner while `isCheckingDb` is true |
| 2 | Shows `UnlockPrompt` when DB is locked |
| 3 | Shows main layout after DB check with no lock |
| 4 | `invoke('init_secure_storage')` called on mount |
| 5 | Loads servers from localStorage on init |
| 6 | Uses default server list when localStorage is empty |
| 7 | `handleSelectServer` creates new session and switches to it |
| 8 | `handleCloseSession` removes the session |
| 9 | Closing active session activates session to the left |
| 10 | Closing last session sets `activeSessionId` to null |
| 11 | Empty sessions shows "No Active Sessions" placeholder |
| 12 | `handleDeleteKey` calls `invoke('delete_ssh_key_file', { keyId })` |
| 13 | Session tab colors cycle through `SESSION_COLORS` array |
| 14 | Settings modal opens via `onOpenSettings` from ServerList |
| 15 | About modal opens via `onOpenAbout` from ServerList |

---

## Phase 7 — Terminal Component (most complex)

### `tests/Terminal.test.tsx` — 28 tests

Mocks: full xterm suite, `invoke`, `listen`

| # | Scenario |
|---|---|
| 1 | Returns null when `server` prop is null |
| 2 | Renders status bar with server host when server is provided |
| 3 | Renders "Local Terminal" when `server.isLocal` is true |
| 4 | Shows DISCONNECTED status on initial render |
| 5 | Calls `invoke('pty_connect', {...})` on mount (SSH) |
| 6 | Calls `invoke('pty_connect_local', ...)` when `server.isLocal` |
| 7 | SSH auth uses password when `preferredAuthMethod` is 'password' |
| 8 | SSH auth uses key path when `preferredAuthMethod` is 'key' |
| 9 | Status changes to CONNECTED after `pty_connect` resolves |
| 10 | Status changes to ERROR when `pty_connect` rejects |
| 11 | `listen('pty-output', ...)` registered after session id is set |
| 12 | `listen('pty-disconnect', ...)` registered after session id is set |
| 13 | pty-disconnect event sets status to DISCONNECTED, sessionId to null |
| 14 | Reconnect button shown when status is DISCONNECTED or ERROR |
| 15 | Reconnect button click calls `pty_connect` again |
| 16 | Reconnect is no-op if `isConnectingRef.current` is true |
| 17 | Keep-alive toggle visible only when SSH connected (not local) |
| 18 | Keep-alive button toggles `keepAliveEnabled` state |
| 19 | AI query textarea is present |
| 20 | Enter in AI textarea (no shift) calls `askAI` |
| 21 | Shift+Enter in AI textarea does NOT submit |
| 22 | AI send button disabled when query empty or loading |
| 23 | Provider selector dropdown lists all providers |
| 24 | Auto-Fix button disabled when sessionId is null |
| 25 | Quick command buttons disabled when status is not CONNECTED |
| 26 | Keep-Alive manual button calls `invoke('pty_keepalive', ...)` |
| 27 | `invoke('pty_disconnect')` called on unmount if connected |
| 28 | `listen` unsubscribers called on session id change cleanup |

---

## Phase 8 — Rust Tests

### `src-tauri/src/secure_storage.rs` — additions (+12 tests, total 24)

Add to the existing `#[cfg(test)]` module:

| # | Scenario |
|---|---|
| 1 | `store_credential` stores without error when unlocked |
| 2 | `get_credential` retrieves stored credential by id |
| 3 | `decrypt_password` round-trips password through stored value |
| 4 | `store_credential` with None password; `get_credential` returns None |
| 5 | `delete_credential` removes; subsequent `get_credential` returns error |
| 6 | Overwriting same id updates values (INSERT OR REPLACE) |
| 7 | `store_credential` fails when DB not unlocked |
| 8 | `is_unlocked` returns false before `unlock` |
| 9 | `is_unlocked` returns true after `set_master_password` |
| 10 | `is_unlocked` returns true after successful `unlock` |
| 11 | `with_database` returns error before `init_database` |
| 12 | Encrypted data differs across calls (random nonce) |

### `src-tauri/src/main.rs` — serde struct tests (+7 tests)

Add `#[cfg(test)]` module to `main.rs`:

| # | Scenario |
|---|---|
| 1 | `ConnectionParams` deserializes from JSON with all optionals as None |
| 2 | `ConnectionParams` deserializes when password is provided |
| 3 | `PtyWriteParams` round-trips through `serde_json` |
| 4 | `PtyResizeParams` deserializes cols and rows correctly |
| 5 | `LocalPtyParams` deserializes with explicit cols/rows |
| 6 | `StoreCredentialParams` handles optional fields |
| 7 | `DecryptedCredential` serializes correctly |

### `src-tauri/src/windows_pty.rs` — smoke tests (+3, Windows CI only)

```rust
#[cfg(all(test, target_os = "windows"))]
mod tests {
    // test WindowsPty::new, write, resize don't panic
}
```

### `src-tauri/tests/` — integration tests (+6 tests)

New files: `tests/secure_storage_integration.rs`, `tests/key_storage.rs`

| # | Scenario |
|---|---|
| 1 | `init_secure_storage` → `has_master_password` → false |
| 2 | `set_master_password` → `is_database_unlocked` → false |
| 3 | `set_master_password` → `unlock_database` → `is_database_unlocked` → true |
| 4 | `unlock_database` with wrong password → error |
| 5 | `save_ssh_key_to_file` → file exists on disk with expected path |
| 6 | `delete_ssh_key_file` → file no longer exists |

---

## Summary

| Phase | Area | Est. Tests |
|---|---|---|
| 1 | Mock infrastructure | (setup only) |
| 2 | TabBar | 12 |
| 3 | UnlockPrompt, SSHKeyManager | 24 |
| 4 | ServerList, SettingsModal | 41 |
| 5 | aiService (additions), geminiService | 13 |
| 6 | App | 15 |
| 7 | Terminal | 28 |
| 8 | Rust unit + integration | 28 |
| | **Total new tests** | **~161** |
| | **Grand total (incl. existing 31)** | **~192** |

## Coverage Targets

- Frontend: **80%+** statement coverage on `components/` and `services/`
- Rust: **85%+** on `secure_storage.rs`, **60%+** on `main.rs`
- Run with: `npm run test:coverage` (HTML report in `coverage/`)
- Rust: `cargo test` in `src-tauri/`
