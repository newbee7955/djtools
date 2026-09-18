# Notepad Content Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-gated access to the notepad while encrypting note bodies at rest and leaving titles and file names visible.

**Architecture:** A renderer-only vault derives a non-extractable AES-256-GCM key from the user's password with PBKDF2-HMAC-SHA-256 and a random persisted salt. Note bodies are plaintext only in React memory after unlock; workspace files, localStorage cache, and all newly created history snapshots contain a versioned ciphertext envelope. Existing plaintext files are migrated after the user creates the vault, while legacy snapshot and Git history remain readable after unlock and are explicitly disclosed because rewriting history is destructive.

**Tech Stack:** React 18, TypeScript 5.7, Web Crypto API, Node test runner, existing Doujiao workspace/history SDK.

## Global Constraints

- Encrypt body content only; keep note titles, directory names, and file names visible.
- Never persist the password or an extractable content key.
- Use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a per-vault random salt.
- Use AES-256-GCM with a fresh 96-bit IV for every encrypted payload.
- Preserve plaintext export and copy behavior as explicit user actions.
- Preserve compatibility with existing plaintext notes and callers of the workspace history API.
- Do not rewrite or delete existing snapshot or Git history automatically.
- Do not modify or stage the existing time-album worktree changes.

---

### Task 1: Versioned encryption core

**Files:**
- Create: `plugins/notepad/src/lib/content-crypto.ts`
- Create: `plugins/notepad/tests/content-crypto.test.mjs`

**Interfaces:**
- Produces: `createVault(password)`, `unlockVault(password, config)`, `encryptContent(content, key)`, `decryptContent(stored, key)`, `isEncryptedContent(stored)`, `serializeNotesCache(notes, key)`, and `deserializeNotesCache(raw, key)`.
- Ciphertext format: `DJNOTE_ENCRYPTED_V1:` followed by JSON containing `version`, `iv`, and `ciphertext` base64 fields.

- [ ] **Step 1: Write failing crypto behavior tests**

```js
test('encrypts and decrypts Unicode without exposing plaintext', async () => {
  const { config, key } = await createVault('correct horse battery staple')
  const stored = await encryptContent('机密正文 hello', key)
  assert.equal(stored.includes('机密正文'), false)
  assert.equal(await decryptContent(stored, key), '机密正文 hello')
  assert.equal((await unlockVault('correct horse battery staple', config)).type, 'secret')
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: assertion failure because the encryption module API does not exist.

- [ ] **Step 3: Implement Web Crypto and encrypted cache helpers**

```ts
const CONTENT_PREFIX = 'DJNOTE_ENCRYPTED_V1:'
const PBKDF2_ITERATIONS = 600_000

export async function encryptContent(content: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(content))
  return CONTENT_PREFIX + JSON.stringify({ version: 1, iv: toBase64(iv), ciphertext: toBase64(ciphertext) })
}
```

- [ ] **Step 4: Run the crypto tests and confirm GREEN**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: all crypto, wrong-password, plaintext-compatibility, and cache-roundtrip tests pass.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- plugins/notepad/src/lib/content-crypto.ts plugins/notepad/tests/content-crypto.test.mjs`
Expected: exit code 0 with no whitespace errors.

### Task 2: Password gate, migration, and encrypted persistence

**Files:**
- Create: `plugins/notepad/src/components/VaultGate.tsx`
- Modify: `plugins/notepad/src/App.tsx`
- Test: `plugins/notepad/tests/content-crypto.test.mjs`

**Interfaces:**
- Consumes: Task 1 encryption and cache helpers.
- Produces: setup/unlock UI, in-memory `CryptoKey`, manual lock, 15-minute idle lock, encrypted workspace writes, and one-time plaintext file migration.

- [ ] **Step 1: Add failing persistence-boundary assertions**

```js
assert.match(appSource, /await encryptContent\(activeNote\.content, vaultKey\)/)
assert.doesNotMatch(appSource, /localStorage\.setItem\('doujiao_notepad_notes', JSON\.stringify\(notes\)\)/)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: failure showing plaintext persistence is still present.

- [ ] **Step 3: Implement the vault lifecycle and persistence boundaries**

```ts
const [vaultConfig, setVaultConfig] = useState(() => loadVaultConfig())
const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)

const lockVault = () => {
  setVaultKey(null)
  setNotes([])
  setActiveNoteId('')
  setShowHistoryDrawer(false)
}
```

`loadWorkspace` decrypts encrypted bodies, encrypts legacy plaintext before rewriting the same visible `.txt` file, and only runs after unlock. Auto-save, Ctrl+S, new note creation, and imported files encrypt before `workspace.writeFile`; explicit copy, save-as, and export continue using the in-memory plaintext.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: all tests pass.

Run: `npm.cmd run typecheck -w plugins/notepad`
Expected: TypeScript exits 0.

- [ ] **Step 5: Review checkpoint**

Run: `rg -n "writeFile\(|saveSnapshot\(|doujiao_notepad_notes" plugins/notepad/src`
Expected: every non-export body persistence call encrypts content or writes an encrypted cache.

### Task 3: Encrypted history with correct plaintext statistics

**Files:**
- Modify: `packages/plugin-sdk/src/types.ts`
- Modify: `apps/host/src/preload/plugin.ts`
- Modify: `apps/host/src/main/ipc/bridge.ts`
- Modify: `apps/host/src/main/services/workspace-service.ts`
- Modify: `plugins/notepad/src/components/VersionHistoryDrawer.tsx`

**Interfaces:**
- Extends compatibly: `saveSnapshot(scope, relativePath, encryptedContent, type?, label?, stats?: { charCount: number; size: number })`.
- `VersionHistoryDrawer` consumes `encryptContent(plaintext)` and `decryptContent(stored)` callbacks supplied by `App`.

- [ ] **Step 1: Add failing history-boundary assertions**

```js
assert.match(drawerSource, /await encryptForStorage\(currentContent\)/)
assert.match(drawerSource, /await decryptFromStorage\(content\)/)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: failure because history still receives and renders plaintext directly.

- [ ] **Step 3: Add the optional snapshot statistics argument end to end**

```ts
saveSnapshot(
  scope: string,
  relativePath: string,
  content: string,
  type?: 'auto' | 'milestone',
  label?: string,
  stats?: { charCount: number; size: number }
): Promise<WorkspaceSnapshotItem>
```

The host uses `stats?.charCount ?? content.length` and `stats?.size ?? Buffer.byteLength(content, 'utf-8')`, retaining all existing callers.

- [ ] **Step 4: Encrypt new snapshot bodies and decrypt snapshot/Git reads**

```ts
const encrypted = await encryptForStorage(currentContent)
await sdk.workspace.history.saveSnapshot(scope, fileName, encrypted, 'milestone', label, {
  charCount: currentContent.length,
  size: new TextEncoder().encode(currentContent).byteLength
})
```

- [ ] **Step 5: Run typechecks**

Run: `npm.cmd run typecheck -w packages/plugin-sdk`
Expected: exit code 0.

Run: `npm.cmd run typecheck -w apps/host`
Expected: exit code 0.

Run: `npm.cmd run typecheck -w plugins/notepad`
Expected: exit code 0.

### Task 4: Release metadata and final verification

**Files:**
- Modify: `plugins/notepad/manifest.json`
- Modify: `plugins/notepad/package.json`
- Test: `plugins/notepad/tests/content-crypto.test.mjs`

**Interfaces:**
- Produces: notepad plugin version `1.4.0` with changelog describing password unlock and encrypted note bodies.

- [ ] **Step 1: Update plugin metadata**

```json
{
  "version": "1.4.0",
  "changelog": "【v1.4.0】新增主密码解锁与便签正文 AES-GCM 加密存储；文件名保持可见，复制和导出仍可生成明文"
}
```

- [ ] **Step 2: Run complete verification**

Run: `node --test plugins/notepad/tests/content-crypto.test.mjs`
Expected: all tests pass with zero failures.

Run: `npm.cmd run typecheck -w packages/plugin-sdk && npm.cmd run typecheck -w apps/host && npm.cmd run typecheck -w plugins/notepad`
Expected: all three typechecks exit 0.

Run: `npm.cmd run build -w plugins/notepad`
Expected: Vite production build exits 0.

Run: `git diff --check`
Expected: exit code 0.

- [ ] **Step 3: Inspect scoped worktree changes**

Run: `git status --short`
Expected: only this plan, the pre-existing time-album changes, and the notepad encryption files are modified; do not stage or commit without an explicit request.
