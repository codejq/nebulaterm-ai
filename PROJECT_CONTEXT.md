# NebulaTerm AI — Project Context

## Purpose

NebulaTerm AI is a desktop SSH and local-terminal client developed by Quantum Billing, LLC. It combines multi-tab terminal sessions, saved server and SSH-key management, and an AI assistant for terminal questions and command correction.

The application is a Tauri 2 desktop app: a React/TypeScript webview provides the UI and a Rust process provides SSH, PTY, filesystem, and encrypted-storage commands. It is intended to build for Windows, macOS, and Linux.

## Repository map

```text
.
├── App.tsx                 # Root state, persistence, session/tab orchestration
├── index.tsx / index.css   # React entry point and global styles
├── types.ts                # Shared frontend domain types
├── components/             # React UI components
│   ├── Terminal.tsx        # xterm UI, PTY lifecycle, AI side panel
│   ├── ServerList.tsx      # Server CRUD, local-terminal entry, SSH-key modal host
│   ├── SSHKeyManager.tsx   # SSH-key import and save workflow
│   ├── SettingsModal.tsx   # AI provider configuration and master-password setup
│   ├── UnlockPrompt.tsx    # Locked encrypted-database prompt
│   ├── TabBar.tsx          # Open-session tabs
│   └── AboutModal.tsx
├── services/
│   ├── aiService.ts        # Provider-agnostic AI requests used by Terminal
│   └── geminiService.ts    # Older Gemini-only helper (not used by Terminal)
├── src-tauri/
│   ├── src/main.rs         # Tauri command handlers, SSH/local PTY management
│   ├── src/secure_storage.rs # SQLite + Argon2/AES-GCM credential implementation
│   ├── src/windows_pty.rs  # Windows ConPTY wrapper (not imported by main.rs)
│   ├── capabilities/default.json
│   ├── tauri.conf.json
│   └── nsis/installer.nsi  # Windows installer customization
├── tests/                  # Vitest component/service tests and browser/native mocks
├── scripts/                # Windows and Unix build helpers
└── .github/workflows/release.yml # Tag-triggered cross-platform releases
```

Generated or machine-local directories include `node_modules/`, `dist/`, `coverage/`, and `src-tauri/target/`; they are not source of truth.

## Tech stack and commands

- Frontend: React 18, TypeScript 5, Vite 5, Tailwind CSS, Lucide icons, and xterm.js with Fit, Search, and WebLinks addons.
- Desktop/native: Tauri 2, Rust 2021, `ssh2`, `portable-pty`, SQLite (`rusqlite`), Argon2, and AES-256-GCM.
- Tests: Vitest 4, Testing Library, jsdom, and explicit mocks for Tauri/xterm APIs.
- Node 18+ and Rust are required for local development/building.

| Command | Use |
| --- | --- |
| `npm run dev` | Start Vite at the fixed port `1420`. |
| `npm run build` | Type-check with `tsc` and produce `dist/`. |
| `npm test` | Run Vitest. |
| `npm run test:coverage` | Run tests with V8 coverage output. |
| `npm run tauri dev` | Run the desktop app; Tauri starts Vite through its configured pre-dev command. |
| `npm run tauri build` | Build native bundles after the frontend has been built. |
| `scripts/build_windows.bat` / `scripts/build_unix.sh` | Install dependencies, check Rust, build frontend, and run the Tauri build. |

`vite.config.ts` exposes only `VITE_*` and `TAURI_*` variables to the frontend, while mapping `API_KEY` to `process.env.API_KEY` at build time. Do not commit a real key; local environment files are ignored.

## Frontend architecture

`App.tsx` owns the application state:

- `servers`, `sshKeys`, and `appSettings` load from and save to browser `localStorage`.
- `sessions` and `activeSessionId` are in-memory only. Selecting a server opens a new tab; closing the active tab selects the tab to its left when possible.
- Local terminal sessions retain the full `Server` object on the `Session`; remote sessions resolve the server by `serverId` from the current server list.
- At startup it initializes secure storage and shows `UnlockPrompt` only if a master password exists and the native database is locked.

The current local-storage keys are:

| Key | Value |
| --- | --- |
| `nebula_servers` | Serialized `Server[]`. |
| `nebula_ssh_keys` | Serialized `SSHKey[]`. |
| `nebula_settings` | Serialized `AppSettings`. |

Core frontend types live in `types.ts`: `Server`, `SSHKey`, `Session`, `AppSettings`, `AIProviderConfig`, `AIResponse`, and `ConnectionStatus`. Keep UI-facing type changes there so component contracts stay consistent.

### Components and responsibilities

- `ServerList` provides server create/edit/delete forms, chooses password or key authentication, opens `SSHKeyManager`, and creates a temporary `isLocal: true` entry for a local shell. It does not perform network connection itself.
- `Terminal` creates one xterm terminal per rendered session, connects/reconnects it through Tauri, streams native events, forwards input/resizes, offers a `top` quick command, and has a contextual AI side panel. Non-local connected sessions send an optional keepalive every 30 seconds.
- `SSHKeyManager` can paste a key or select a file with the Tauri dialog plugin. It reads the selected file through Rust and saves a copy through Rust before calling its parent callback.
- `SettingsModal` edits all AI provider configuration locally until Save. Its Security tab can set a master password; the UI enforces a non-empty, 8-character minimum and matching confirmation.
- `UnlockPrompt` invokes the native unlock command, then tells `App` to reveal the normal UI.
- `TabBar` is presentational; `AboutModal` contains company/product details.

## AI behavior

`services/aiService.ts` is the active AI abstraction. `Terminal` calls `askAI(query, terminalHistory, settings)` and `autoCorrectAI(command, settings)` and expects an `AIResponse` JSON object with `markdown` and optional `suggestedCommand`.

Supported provider IDs are `gemini`, `openai`, `grok`, `anthropic`, `ollama`, and `openrouter`. Provider settings include enablement, API key, model, and optionally a base URL (used by Ollama). The service makes browser-side HTTP requests directly to provider endpoints. `geminiService.ts` duplicates Gemini-only behavior and is currently not imported by the UI; avoid changing one while assuming the other is used.

## Native architecture and Tauri contract

`src-tauri/src/main.rs` maintains an in-process `PTY_SESSIONS` map keyed by frontend-generated session IDs. It supports two connection kinds:

- `pty_connect`: remote SSH. It uses `ssh2` normally; on Windows, key-path authentication is delegated to the system `ssh` command in a portable PTY for key compatibility.
- `pty_connect_local`: starts `cmd.exe` on Windows or `$SHELL` (falling back to `/bin/sh`) on Unix in a `portable-pty` session, with the app's current working directory as its starting directory.

The native-to-webview events are:

| Event | Payload fields | Meaning |
| --- | --- | --- |
| `pty-output` | `session_id`, `data` | Terminal bytes converted lossily to text. |
| `pty-disconnect` | `session_id`, `error` | Session/process ended or an I/O error occurred. |

Frontend Tauri command calls use camelCase argument keys as below. Rust deserializes the nested parameter structs with their existing snake_case fields.

| Command | Frontend call / responsibility |
| --- | --- |
| `pty_connect` | `{ params }`: host, port, username, password/key material and `session_id`. |
| `pty_connect_local` | `{ params }`: `session_id`, cols, rows. |
| `pty_write` / `pty_resize` | `{ params }` containing session and input/size. |
| `pty_disconnect` / `pty_keepalive` | `{ sessionId }`. |
| `pty_check_connection` | Native command exists; it is not currently used by the React UI. |
| `save_ssh_key_to_file`, `read_ssh_key_file`, `delete_ssh_key_file` | Save/read/remove managed SSH-key files. |
| `init_secure_storage`, `has_master_password`, `set_master_password`, `unlock_database`, `is_database_unlocked` | Secure-store lifecycle. |
| `store_credential`, `get_credential`, `delete_credential` | Encrypted credential CRUD. These are not currently called by the React application. |

When adding a native command, update both `tauri::generate_handler!` and the frontend invocation/mocks/tests as applicable. PTY changes need special care: a terminal is connected to its session by the event payload's `session_id`, and cleanup occurs in both frontend effects and native session removal.

## Storage and security facts

The Rust secure store is initialized at `data/nebulaterm.db` beneath the executable directory. Its SQLite schema has `config` and `credentials` tables. A master password is Argon2-hashed with a generated salt; the same password and salt derive a 32-byte key. Passwords and key passphrases stored through credential CRUD are encrypted with AES-256-GCM using a new random 12-byte nonce per value, then base64 encoded.

Managed SSH-key files are written as `<executable directory>/ssh_keys/<key-id>.key`. The native layer also reads arbitrary user-selected key files through the dialog/import workflow.

Important current limitation: the secure-store implementation is not wired into the frontend's saved server, SSH-key, or provider settings state. Those values—including server passwords, SSH-key content/passphrases, and AI API keys—are presently serialized in the webview's `localStorage`. Do not state or assume that all credentials in the UI are encrypted at rest until that integration is implemented.

## Configuration, bundles, and releases

- `src-tauri/tauri.conf.json` defines product name `NebulaTerm-AI`, identifier `com.nebulaterm.ai`, and version `1.0.23`. The default window is 1200×800 and allows resizing.
- Bundling targets are DEB, RPM, AppImage, MSI, NSIS, and DMG. The Windows NSIS installer uses `src-tauri/nsis/installer.nsi`.
- `package.json`, Cargo, and Tauri configuration are aligned at version `1.0.23`; bump them together for a release.
- `.github/workflows/release.yml` runs on `v*` tags, creates a GitHub release, builds on macOS, Ubuntu 22.04, and Windows, then uploads platform bundles. The workflow currently deletes `package-lock.json` before `npm install`, so it is not a lockfile-reproducible install.
- Tauri's CSP is explicitly `null`; browser-side network calls are therefore not restricted by a configured CSP.

## Tests

The test suite mirrors the frontend structure: each main component, `App`, and both AI services have a test file. `tests/setup.ts` installs jsdom/testing-library behavior, while `tests/__mocks__` supplies Tauri core/event and xterm addon mocks. Rust unit tests for encrypted storage live in `src-tauri/src/secure_storage.rs`; an integration test is in `src-tauri/tests/secure_storage_integration.rs`.

`TEST_PLAN.md` is a coverage plan and implementation checklist, not runtime application behavior. The existing `coverage/` directory is generated output.

## Working conventions for future agents

1. Keep the React/native boundary explicit. A UI-only feature should not invent a Rust command; a native feature must be registered, invoked, and tested.
2. Preserve the Tauri event names and `session_id` correlation unless updating both producer and consumer.
3. Avoid placing secrets in source, logs, snapshots, or this document. Treat the existing local-storage credential behavior as a known technical/security limitation, not a reason to expose values.
4. Test frontend changes with `npm test` and run `npm run build` for type/build validation when practical. For secure-storage changes, also run the relevant Rust tests.
5. Do not edit generated directories (`dist`, `coverage`, `src-tauri/target`) as a source change. Do not delete or overwrite unrelated worktree changes.
