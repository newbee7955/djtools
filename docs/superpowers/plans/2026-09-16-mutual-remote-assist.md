# Doujiao Mutual Remote Assistance Implementation Plan (Public Internet Mode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any two Doujiao Toolbox instances across the public internet to establish an attended remote-assistance session in which either instance can act as controller or controlled device, with low-latency WebRTC screen streaming, 9-digit device code pairing, attended consent confirmation, and revocable keyboard/mouse control.

**Architecture:** A lightweight central WSS signaling service (`services/remote-assist-signal`) brokers device presence and WebRTC session rendezvous via 9-digit device codes. Both Doujiao clients initiate outbound WSS connections (no local listening ports, no Windows Firewall warnings). Actual screen video and input data channels travel peer-to-peer over WebRTC, falling back to an authenticated coturn TURN relay when NAT traversal fails. A trusted host session window owns the WebRTC peer connection, while the sandboxed plugin UI provides device identity display, target pairing, consent prompts, and session controls. A native Windows C++ helper receives validated inputs via inherited stdin pipe to execute `SendInput`.

**Tech Stack:** Electron 33, React 18, TypeScript 5.7, Chromium WebRTC, `ws`, Node.js HTTP/WSS, Windows Desktop Capture through Electron `desktopCapturer`, native Win32 `SendInput` helper, Node test runner, coturn (Docker Compose).

---

## Global Constraints

- V1 supports Windows 10/11 x64 only and requires the controlled user to explicitly approve every incoming session.
- Both clients connect outbound to the WSS signaling service; the client host application **never listens on a local TCP/UDP port**, avoiding Windows Firewall popup prompts.
- Each installation can be a controller or controlled device, but one active session has exactly one controller and one controlled role.
- V1 supports one active remote session and one selected display per controlled device.
- V1 controls normal desktop applications only; UAC secure desktop, sign-in screens, lock screens, services, and higher-integrity applications are explicitly unsupported.
- V1 does not install an elevated Windows service and does not provide unattended access.
- Clipboard synchronization, file transfer, audio, multi-monitor switching during a session, and session recording are disabled in V1.
- The plugin renderer never receives unrestricted Node.js, process execution, native input, credential-store, or arbitrary screen-capture access.
- Device private keys, long-lived tokens, TURN secrets, and signaling credentials never enter plugin storage, URLs, renderer logs, or analytics.
- WebRTC media/data encryption is necessary but not sufficient: signaling messages must also be bound to authenticated device identities and an approved session transcript.
- A visible controlled-side indicator, tray disconnect action, and `Ctrl+Alt+Shift+Esc` emergency shortcut remain available throughout control.
- Disconnection releases all remotely-held keys and mouse buttons (`release-all`) before destroying the session.
- Preserve unrelated changes in the current mixed worktree; stage and review only paths listed in this plan.

---

## Product Decisions

### User Flow

```text
┌────────────────────────────────────────────────────────┐
│ 豆角远程协助 (Remote Assistance)                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│   【允许协助】                                         │
│    本机设备代码:  839 201 442   [复制]                 │
│    状态: ● 在线，等待连接                              │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│   【远程协助他人】                                     │
│    输入伙伴设备代码: [ 123 456 789       ]             │
│    协助模式:  (●) 键鼠控制   (○) 仅查看屏幕            │
│    [ 发起协助请求 ]                                    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

1. Both users open the Remote Assistance plugin. The client connects outbound to the WSS signaling service.
2. The controlled user sees their unique formatted **9-digit Device Code** (e.g. `839 201 442`) and selects the target display.
3. The controller inputs the controlled user's 9-digit Device Code, selects permission (`view` or `control`), and clicks "Request Assistance".
4. The controlled user receives a native modal prompt showing the requester's device name, requested permission, and a shared **6-digit safety code** derived from the ephemeral handshake transcript.
5. The controlled user verifies the code and approves (`view`, `control`, or `deny`).
6. WebRTC connects via direct P2P (or coturn TURN relay). The controller receives the video stream; keyboard/mouse inputs are accepted only if approved with `control`.
7. Either user can disconnect at any time. The controlled user has a floating always-on-top indicator, a system tray action, and emergency shortcut `Ctrl+Alt+Shift+Esc`.

### Network & Signaling Model

- **Outbound Only**: Doujiao clients connect to `wss://<signaling-domain>/v1/signal`. No inbound firewall rules or port forwarding required on user machines.
- **Device Code**: Derived deterministically as a formatted 9-digit number from `SHA-256(publicKey)`, registered on the signaling service upon WSS connection.
- **Pure Memory Signaling**: The signaling service holds no permanent database, no media streams, no screen frames, and no input events. Handshake envelopes expire after 300 seconds.
- **WebRTC ICE & TURN**: WebRTC ICE first attempts direct host and STUN P2P candidates. If symmetric NAT/firewall prevents direct connection, traffic relays through coturn. coturn REST-style HMAC credentials expire after 5 minutes and are issued on-demand by the signaling service.

### Security Model

- `remote.desktop.view` authorizes display capture and receipt of a remote stream.
- `remote.desktop.control` authorizes validated keyboard/mouse injection during an approved session.
- Input events use normalized coordinates and a closed discriminated union. Unknown fields, oversized messages, invalid key codes, stale sequence numbers, and excessive event rates are rejected.
- The native helper accepts input only from its inherited stdin, has no listening socket, exits when the host closes the pipe, and validates a 256-bit session token on every command.
- Local user mouse movement triggers an immediate input override window (1.5s), ensuring the local user always maintains supreme physical control.

---

## Reference Architecture

```text
Doujiao A (Controller)                                       Doujiao B (Controlled)
┌──────────────────────────┐                                ┌──────────────────────────┐
│ remote-assist plugin UI  │                                │ remote-assist plugin UI  │
│ Device Code input / view │                                │ My Device Code / consent │
└─────────────┬────────────┘                                └─────────────┬────────────┘
              │ permissioned IPC                                          │ permissioned IPC
┌─────────────▼────────────┐       Outbound WSS Signaling       ┌─────────▼────────────┐
│ RemoteAssistService      │◄───────────┐      ┌───────────────►│ RemoteAssistService  │
│ identity / signaling     │            │      │                │ identity / signaling │
└─────────────┬────────────┘            ▼      ▼                └─────────┬────────────┘
              │ creates          ┌───────────────────┐                    │ creates
              │                  │ Signaling Server  │                    │
              │                  │ (WSS Rendezvous)  │                    │
              │                  └───────────────────┘                    │
┌─────────────▼────────────┐                                    ┌─────────▼────────────┐
│ trusted session window   │◄══ WebRTC P2P (or coturn TURN) ═══►│ trusted session window│
│ controller stream & input│                                    │ display capture / ICE│
└──────────────────────────┘                                    └─────────┬────────────┘
                                                                          │ validated JSONL
                                                                ┌─────────▼────────────┐
                                                                │ Win32 input helper   │
                                                                │ SendInput (no socket)│
                                                                └──────────────────────┘
```

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/plugin-sdk/src/types.ts` | Public remote-assistance types, capabilities, and SDK surface |
| `apps/host/src/main/services/remote-assist/remote-assist-contract.ts` | Pure validation, input normalization, state transitions, safety-code derivation |
| `apps/host/src/main/services/remote-assist/device-identity-store.ts` | Host-owned Ed25519 device identity and 9-digit Device Code derivation encrypted with `safeStorage` |
| `apps/host/src/main/services/remote-assist/signaling-client.ts` | Outbound WSS signaling client (heartbeat, registration, rendezvous, envelope exchange) |
| `apps/host/src/main/services/remote-assist/remote-assist-service.ts` | Consent, session ownership, lifecycle, event routing, emergency disconnect |
| `apps/host/src/main/services/remote-assist/display-media-controller.ts` | Scoped display-media grants for the active controlled session |
| `apps/host/src/main/services/remote-assist/remote-input-helper.ts` | Native helper process lifecycle, local mouse override, and JSONL pipe protocol |
| `apps/host/src/main/container/remote-assist-session-window.ts` | Trusted controller/controlled WebRTC session window (`persist:remote-assist` partition) |
| `apps/host/src/main/container/remote-control-indicator.ts` | Controlled-side always-on-top click-through-safe floating session status bar |
| `apps/host/src/preload/remote-assist-session.ts` | Narrow session-only signaling/input bridge |
| `apps/host/native/remote-input-helper/` | Win32 helper that validates session token and invokes `SendInput` |
| `plugins/remote-assist/` | Dashboard UI (My Device ID, Connect to Remote Device) plus WebRTC session renderer |
| `services/remote-assist-signal/` | Internet WSS rendezvous signaling service and coturn TURN credential issuer |

---

### Task 1: Define the Remote-Assistance Contract and Validators

**Files:**
- Create: `apps/host/src/main/services/remote-assist/remote-assist-contract.ts`
- Create: `apps/host/tests/remote-assist-contract.test.mjs`
- Modify: `packages/plugin-sdk/src/types.ts`

**Interfaces:**
- Produces `RemoteAssistRole`, `RemoteAssistPermission`, `RemoteAssistSessionState`, `RemoteAssistInputEvent`, `RemoteAssistSignalEnvelope`, and `RemoteAssistDeviceInfo`.
- Produces `parseInputEvent(value)`, `parseSignalEnvelope(value, now)`, `canTransition(from, to)`, `normalizePointer(value)`, and `formatDeviceCode(rawCode)`.
- Enforces protocol version `1`, signal envelope lifetime of 300 seconds, input payload size limit of 4 KiB, and monotonically increasing input sequence numbers.

- [ ] **Step 1: Write failing pure-contract tests**

```js
test('accepts normalized pointer movement and rejects out-of-range coordinates', () => {
  assert.deepEqual(parseInputEvent({
    type: 'pointer-move', sessionId: 's_123', seq: 8, x: 0.25, y: 0.75
  }), {
    type: 'pointer-move', sessionId: 's_123', seq: 8, x: 0.25, y: 0.75
  })
  assert.throws(
    () => parseInputEvent({ type: 'pointer-move', sessionId: 's_123', seq: 9, x: 1.1, y: 0.5 }),
    /normalized coordinates/
  )
})

test('formats raw device identifier into a 9-digit readable code', () => {
  assert.equal(formatDeviceCode('839201442'), '839 201 442')
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-contract.test.mjs`  
Expected: FAIL because `remote-assist-contract.ts` does not exist.

- [ ] **Step 3: Add the narrow SDK capability and pure validators**

Update `packages/plugin-sdk/src/types.ts`:
```ts
export type RemoteAssistPermission = 'view' | 'control'

export type RemoteAssistInputEvent =
  | { type: 'pointer-move'; sessionId: string; seq: number; x: number; y: number }
  | { type: 'pointer-button'; sessionId: string; seq: number; button: 'left' | 'middle' | 'right'; pressed: boolean }
  | { type: 'wheel'; sessionId: string; seq: number; deltaX: number; deltaY: number }
  | { type: 'key'; sessionId: string; seq: number; code: string; pressed: boolean; modifiers: string[] }

export interface RemoteAssistDeviceInfo {
  deviceCode: string       // e.g. "839 201 442"
  rawDeviceId: string
  displayName: string
  signalingStatus: 'connected' | 'connecting' | 'disconnected'
}

export interface RemoteAssistApi {
  getDeviceInfo(): Promise<RemoteAssistDeviceInfo>
  requestSession(targetDeviceCode: string, permission: RemoteAssistPermission): Promise<RemoteAssistSessionStatus>
  respondToSession(requestId: string, decision: 'view' | 'control' | 'deny'): Promise<boolean>
  disconnect(sessionId: string): Promise<boolean>
  onEvent(callback: (event: RemoteAssistEvent) => void): () => void
}
```

Add `remote.desktop.view` and `remote.desktop.control` to `CapabilityType`.

- [ ] **Step 4: Run tests and SDK build**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-contract.test.mjs`  
Run: `npm run build:sdk`  
Expected: contract tests pass and SDK build succeeds.

---

### Task 2: Add Encrypted Device Identity and 9-Digit Code Derivation

**Files:**
- Create: `apps/host/src/main/services/remote-assist/device-identity-store.ts`
- Create: `apps/host/src/main/services/remote-assist/pairing-session.ts`
- Create: `apps/host/tests/remote-assist-identity.test.mjs`

**Interfaces:**
- Produces `DeviceIdentityStore.getOrCreate()` returning `{ rawDeviceId, deviceCode, publicKey, sign(payload) }`.
- Derives a stable 9-digit numeric device code (`/^\d{3} \d{3} \d{3}$/`) from the device's public key hash.
- Produces `deriveSafetyCode(transcriptHash)` returning exactly six decimal digits for human visual cross-check during consent.
- Stores Ed25519 private key encrypted by Electron `safeStorage`.

- [ ] **Step 1: Write failing identity tests around injected crypto/storage adapters**

```js
test('generates a stable 9-digit formatted device code from public key', async () => {
  const store = new DeviceIdentityStore(fakeCrypto, fakeSafeStorage, new Map())
  const id1 = await store.getOrCreate()
  assert.match(id1.deviceCode, /^\d{3} \d{3} \d{3}$/)
  const id2 = await store.getOrCreate()
  assert.equal(id1.deviceCode, id2.deviceCode)
})

test('derives a stable 6-digit confirmation code from handshake transcript', () => {
  assert.match(deriveSafetyCode('hash_12345'), /^\d{6}$/)
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-identity.test.mjs`  
Expected: FAIL because identity store is missing.

- [ ] **Step 3: Implement encrypted identity and pairing transcript**

Derive the 9-digit code using `(BigInt('0x' + sha256(pubKey).slice(0, 8)) % 900000000n + 100000000n).toString()` formatted as `XXX XXX XXX`. Implement canonical transcript generation signed by both devices.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-identity.test.mjs`  
Expected: all identity tests pass.

---

### Task 3: Build the Windows Input Helper and Host Wrapper

**Files:**
- Create: `apps/host/native/remote-input-helper/CMakeLists.txt`
- Create: `apps/host/native/remote-input-helper/src/main.cpp`
- Create: `apps/host/native/remote-input-helper/PROTOCOL.md`
- Create: `apps/host/src/main/services/remote-assist/remote-input-helper.ts`
- Create: `apps/host/tests/remote-input-helper.test.mjs`
- Modify: `apps/host/electron-builder.yml`

**Interfaces:**
- Helper consumes newline-delimited JSON on inherited stdin pipe (no network socket) and returns ACKs on stdout.
- Validates 256-bit session token on every message.
- Accurately maps normalized `(x, y)` to Windows Virtual Desktop coordinates using `GetSystemMetrics(SM_XVIRTUALSCREEN)` and `MOUSEEVENTF_VIRTUALDESK`.
- Tracks held keys and buttons; automatically issues `release-all` on EOF, pipe closure, parent exit, or explicit release command.
- Includes local physical mouse override suppression window (1.5s).
- Exposes `--self-test` to test coordinate translation and keymapping without moving real hardware.

- [ ] **Step 1: Write failing wrapper tests with fake child-process adapter**

```js
test('sends hello before input and releases held keys on shutdown', async () => {
  const child = createFakeChild()
  const helper = new RemoteInputHelper(() => child)
  await helper.start('token_256')
  helper.send({ type: 'key', sessionId: 's_1', seq: 1, code: 'ShiftLeft', pressed: true, modifiers: [] })
  await helper.stop()
  assert.deepEqual(child.messages.map(m => m.type), ['hello', 'key', 'release-all', 'shutdown'])
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test apps/host/tests/remote-input-helper.test.mjs`  
Expected: FAIL because wrapper is missing.

- [ ] **Step 3: Implement C++ helper and TypeScript wrapper**

Implement Win32 `SendInput` handling with scan-code mappings, virtual desktop multi-monitor normalization, and held-state cleanup.

- [ ] **Step 4: Build and self-test native binary**

Run: `cmake -S apps/host/native/remote-input-helper -B apps/host/native/remote-input-helper/build -A x64`  
Run: `cmake --build apps/host/native/remote-input-helper/build --config Release`  
Run: `apps\host\native\remote-input-helper\build\Release\doujiao-remote-input.exe --self-test`  
Expected: self-test prints `remote-input self-test: PASS`.

- [ ] **Step 5: Run wrapper tests**

Run: `node --experimental-strip-types --test apps/host/tests/remote-input-helper.test.mjs`  
Expected: tests pass.

---

### Task 4: Implement Outbound WSS Signaling Client and Session Manager

**Files:**
- Create: `apps/host/src/main/services/remote-assist/signaling-client.ts`
- Create: `apps/host/src/main/services/remote-assist/remote-assist-service.ts`
- Create: `apps/host/tests/remote-assist-service.test.mjs`

**Interfaces:**
- `SignalingClient`: Outbound WSS connection to public signaling service with automatic exponential-backoff reconnect and 25-second heartbeat ping.
- Registers local device code and signed identity token upon connection.
- Dispatches peer session requests, responses, WebRTC SDP offers/answers, and ICE candidate envelopes.
- `RemoteAssistService`: Single source of truth for session lifecycle (`idle → requesting → awaiting-consent → connecting → connected → disconnecting → idle`).

- [ ] **Step 1: Write failing signaling client and service tests with mock WS**

```js
test('handles session request and routes consent to controlled user', async () => {
  const { service, mockWs } = createTestHarness()
  mockWs.simulateMessage({
    type: 'incoming-request',
    requestId: 'req_1',
    fromDeviceCode: '111 222 333',
    fromName: 'Bob Laptop',
    permission: 'control'
  })
  assert.equal(service.getState().phase, 'awaiting-consent')
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-service.test.mjs`  
Expected: FAIL because signaling client and service are absent.

- [ ] **Step 3: Implement SignalingClient and RemoteAssistService**

Implement WSS client protocol, heartbeat, message signing, incoming request consent flow, safety-code derivation, and reject any input if session is view-only.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-service.test.mjs`  
Expected: service tests pass.

---

### Task 5: Create Trusted WebRTC Session Window & Capture Controller

**Files:**
- Create: `apps/host/src/main/container/remote-assist-session-window.ts`
- Create: `apps/host/src/main/services/remote-assist/display-media-controller.ts`
- Create: `apps/host/src/preload/remote-assist-session.ts`
- Modify: `apps/host/electron.vite.config.ts`
- Create: `apps/host/tests/remote-assist-session-window.test.mjs`

**Interfaces:**
- Controller role: Visible `BrowserWindow` with custom control titlebar, stream viewport, latency/FPS stats, and disconnect button.
- Controlled role: Hidden `BrowserWindow` with `backgroundThrottling: false` to keep screen capture running at full frame rate.
- Both use `sandbox: true`, `contextIsolation: true`, and isolated partition `persist:remote-assist`.
- `DisplayMediaController` scopes `setDisplayMediaRequestHandler` strictly to the approved screen ID.

- [ ] **Step 1: Write failing window sandbox and permission tests**

```js
test('session window enforces strict sandbox and dedicated partition', async () => {
  const source = await read('../src/main/container/remote-assist-session-window.ts')
  assert.match(source, /partition:\s*'persist:remote-assist'/)
  assert.match(source, /backgroundThrottling:\s*false/)
  assert.match(source, /contextIsolation:\s*true/)
})
```

- [ ] **Step 2: Verify RED**

Run: `node --test apps/host/tests/remote-assist-session-window.test.mjs`  
Expected: FAIL because files are absent.

- [ ] **Step 3: Implement session window and preload entry**

Implement session window lifecycle, register preload entry in `electron.vite.config.ts`, and wire scoped `setDisplayMediaRequestHandler`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test apps/host/tests/remote-assist-session-window.test.mjs`  
Run: `npm run build:host`  
Expected: tests pass and host builds successfully.

---

### Task 6: Build the Remote Assistance Plugin UI & WebRTC Stream Renderer

**Files:**
- Create: `plugins/remote-assist/package.json`
- Create: `plugins/remote-assist/manifest.json`
- Create: `plugins/remote-assist/src/App.tsx`
- Create: `plugins/remote-assist/src/session.ts`
- Create: `plugins/remote-assist/src/index.css`
- Create: `plugins/remote-assist/tests/remote-assist-plugin.test.mjs`
- Modify: `apps/host/src/preload/plugin.ts`
- Modify: `apps/host/src/main/ipc/bridge.ts`

**Interfaces:**
- Plugin Dashboard UI:
  - Card 1: "允许协助" -> Displays my 9-digit Device Code with Copy button, online status dot, and screen selector.
  - Card 2: "远程协助他人" -> Input target 9-digit Device Code, radio buttons for `键鼠控制` / `仅查看屏幕`, and "发起连接" button.
  - Consent Dialog: Shows requester's device name, requested mode, 6-digit confirmation code, and Allow/Deny buttons.
- Session Renderer (`session.ts`):
  - Uses standard WebRTC `RTCPeerConnection` with STUN/TURN configuration.
  - Video track sets `contentHint = 'detail'` for razor-sharp code/text readability.
  - DataChannel: Ordered channel for key/button clicks, unordered low-latency channel (`maxRetransmits: 0`) for mouse movements.

- [ ] **Step 1: Write failing plugin tests**

```js
test('remote-assist declares view and control permissions in manifest', async () => {
  const manifest = JSON.parse(await read('../manifest.json'))
  assert.deepEqual(manifest.permissions.map(p => p.capability), [
    'remote.desktop.view',
    'remote.desktop.control'
  ])
})
```

- [ ] **Step 2: Verify RED**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement plugin UI, IPC bridge, and WebRTC session**

Build React dashboard, hook up `window.doujiaoSDK.remoteAssist`, implement WebRTC handshake and DataChannel input event serialization.

- [ ] **Step 4: Verify GREEN**

Run: `node --test plugins/remote-assist/tests/remote-assist-plugin.test.mjs`  
Run: `npm run build -w plugins/remote-assist`  
Expected: plugin tests pass and production bundle builds cleanly.

---

### Task 7: Controlled-Side Floating Safety Bar, Tray Action & Emergency Disconnect

**Files:**
- Create: `apps/host/src/main/container/remote-control-indicator.ts`
- Modify: `apps/host/src/main/tray.ts`
- Modify: `apps/host/src/main/index.ts`
- Create: `apps/host/tests/remote-assist-safety.test.mjs`

**Interfaces:**
- Floating indicator: A click-through-safe, always-on-top pill displaying controller name, session duration, mode badge ("正在被远程控制中"), and prominent "断开" button.
- Tray action: Dynamically displays "断开当前远程协助" while a session is active.
- Emergency Shortcut: Global shortcut `Ctrl+Alt+Shift+Esc` terminates the session immediately.
- Unified Disconnect: Stops capture, closes WebRTC, kills helper pipe, invokes `release-all` to clear stuck keys, and restores host state.

- [ ] **Step 1: Write failing safety tests**

```js
test('every exit path calls release-all before window destruction', async () => {
  const log = []
  await service.simulateEmergencyExit(log)
  assert.ok(log.indexOf('release-all') < log.indexOf('destroy-window'))
})
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-safety.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement floating safety bar and disconnect pipeline**

Wire global shortcut, tray menu update, floating indicator window, and idempotent `disconnect(reason)` method.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test apps/host/tests/remote-assist-safety.test.mjs`  
Expected: safety tests pass.

---

### Task 8: Build the WSS Signaling Service and coturn Relay

**Files:**
- Create: `services/remote-assist-signal/package.json`
- Create: `services/remote-assist-signal/tsconfig.json`
- Create: `services/remote-assist-signal/src/server.ts`
- Create: `services/remote-assist-signal/src/session-registry.ts`
- Create: `services/remote-assist-signal/src/turn-credentials.ts`
- Create: `services/remote-assist-signal/docker-compose.yml`
- Create: `services/remote-assist-signal/coturn/turnserver.conf`
- Create: `services/remote-assist-signal/tests/signal-server.test.mjs`

**Interfaces:**
- Node.js WSS service on port `8080` (or behind nginx 443 with TLS).
- Client registration: Client sends `{ type: 'register', deviceCode, signedToken }`.
- Session matchmaking: Forwards `{ type: 'session-request', toDeviceCode, ... }` to target socket.
- Ephemeral TURN credential issuer: Generates coturn REST credentials (`username = timestamp:deviceId`, `password = hmac_sha1(username, secret)`).
- `docker-compose.yml` for one-command deployment of both Signaling service and coturn.

- [ ] **Step 1: Write failing signaling server unit tests**

```js
test('matches two clients by 9-digit device code and forwards signaling', async () => {
  const server = await startTestSignalServer()
  const clientA = connectTestWs('839 201 442')
  const clientB = connectTestWs('123 456 789')
  await clientA.send({ type: 'request', to: '123 456 789', payload: 'offer' })
  const received = await clientB.waitForMessage()
  assert.equal(received.payload, 'offer')
})
```

- [ ] **Step 2: Verify RED**

Run: `node --test services/remote-assist-signal/tests/signal-server.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement signaling server & coturn config**

Build the WSS server, rate limiters (20 msg/s per client), 5-minute envelope TTL, and write coturn configuration.

- [ ] **Step 4: Verify GREEN**

Run: `node --test services/remote-assist-signal/tests/signal-server.test.mjs`  
Run: `docker compose -f services/remote-assist-signal/docker-compose.yml config`  
Expected: tests pass and Docker compose config validates.

---

### Task 9: End-to-End Integration and Final Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/remote-assistance-security.md`
- Create: `apps/host/tests/remote-assist-e2e.test.mjs`

**Interfaces:**
- Root build scripts include `build:plugins` and `test`.
- Documents network requirements (outbound 443 WSS, UDP 3478 STUN, UDP 49152-65535 TURN relay).
- Full regression suite covering device code pairing, attended approval, WebRTC connection, input execution, and emergency disconnect.

- [ ] **Step 1: Run complete automated test suite**

Run:
```powershell
node --test apps/host/tests/remote-assist-*.test.mjs plugins/remote-assist/tests/*.test.mjs services/remote-assist-signal/tests/*.test.mjs
```
Expected: all tests pass.

- [ ] **Step 2: Build all workspaces**

Run:
```powershell
npm run build:sdk
npm run build -w plugins/remote-assist
npm run build:host
```
Expected: all packages and host compile without error.

- [ ] **Step 3: Conduct dual-instance manual validation**

Launch two separate Doujiao instances:
1. Instance A displays Device Code `839 201 442`.
2. Instance B enters `839 201 442` and requests Control.
3. Instance A shows modal with 6-digit confirmation code and clicks Allow.
4. Verify smooth desktop video stream at high DPI, mouse movements, clicks, keyboard input.
5. Move local physical mouse on Instance A and verify local override priority.
6. Press `Ctrl+Alt+Shift+Esc` on Instance A and verify immediate session termination with no stuck keys.

---

## Acceptance Criteria

- Any two Doujiao instances connected to the internet can establish a remote session using a 9-digit Device Code.
- No local ports are opened by the client; no Windows Defender Firewall popups appear.
- The controlled user must explicitly approve every session, verifying the 6-digit safety code.
- View-only sessions are strictly blocked from injecting input at SDK, IPC, and native helper boundaries.
- WebRTC screen video stream is sharp (`contentHint = 'detail'`) and low latency.
- Disconnecting from either side, tray menu, floating bar, or `Ctrl+Alt+Shift+Esc` instantly releases all keys and mouse buttons.
- Signaling server and coturn configuration are packaged into an easy `docker-compose.yml` for zero-friction server deployment.
