# Screen Recorder / GIF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sandboxed Doujiao screen-recorder plugin that records a selected region or the current display to MP4 or GIF through a host-owned FFmpeg process.

**Architecture:** The renderer plugin exposes only recording controls. A new `screen.record` SDK capability is permission-checked in the main-process bridge and delegates to a host `ScreenRecordingService`. Region selection reuses the current screenshot overlay in a bounds-only mode, while command construction and bounds normalization live in a pure module covered by Node tests.

**Tech Stack:** Electron 33, React 18, TypeScript 5.7, Node test runner, FFmpeg `gdigrab`, Vite, Tailwind CSS.

## Global Constraints

- Windows-only recording for this MVP; return a clear unsupported-platform error elsewhere.
- Capture video only; system audio and microphone recording are outside this MVP.
- Formats: MP4 and GIF. GIF is recorded to a temporary MP4 and converted with the existing palette-based FFmpeg pipeline.
- Modes: selected region and current display.
- Host owns FFmpeg process lifetime, output paths, cleanup, duration limits, and permission enforcement.
- Plugins never receive an FFmpeg executable path or arbitrary command execution.
- Preserve all existing uncommitted `screen-pin`, `drop-shelf`, screenshot, preload, SDK, and host changes.
- Do not commit, publish, sign, or modify the remote registry in this task.

---

### Task 1: Pure Recording Command Contract

**Files:**
- Create: `apps/host/src/main/services/screen-recording-core.ts`
- Create: `apps/host/tests/screen-recording-core.test.mjs`

**Interfaces:**
- Produces: `normalizeRecordingBounds(bounds)`, `normalizeRecordingOptions(options)`, `createRecordingPaths(outputDirectory, format, now)`, and `buildGdiGrabArgs(bounds, options, outputPath)`.
- Consumes: no Electron APIs.

- [ ] **Step 1: Write the failing core tests**

```js
test('normalizes an odd selection to an even positive FFmpeg region', () => {
  assert.deepEqual(normalizeRecordingBounds({ x: 11.6, y: 7.2, width: 801, height: 603 }), {
    x: 12,
    y: 7,
    width: 800,
    height: 602
  })
})

test('builds a bounded gdigrab command without caller supplied arguments', () => {
  assert.deepEqual(
    buildGdiGrabArgs(
      { x: 10, y: 20, width: 800, height: 600 },
      { fps: 24, showCursor: false, crf: 20 },
      'D:\\captures\\recording.mp4'
    ),
    ['-y', '-f', 'gdigrab', '-framerate', '24', '-offset_x', '10', '-offset_y', '20', '-video_size', '800x600', '-draw_mouse', '0', '-i', 'desktop', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'D:\\captures\\recording.mp4']
  )
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs`

Expected: FAIL because `screen-recording-core.ts` does not exist.

- [ ] **Step 3: Implement the pure contract**

```ts
export function normalizeRecordingBounds(bounds: RecordingBounds): RecordingBounds {
  const width = Math.max(2, Math.floor(bounds.width / 2) * 2)
  const height = Math.max(2, Math.floor(bounds.height / 2) * 2)
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }
}

export function buildGdiGrabArgs(
  bounds: RecordingBounds,
  options: NormalizedRecordingOptions,
  outputPath: string
): string[] {
  return [
    '-y', '-f', 'gdigrab', '-framerate', String(options.fps),
    '-offset_x', String(bounds.x), '-offset_y', String(bounds.y),
    '-video_size', `${bounds.width}x${bounds.height}`,
    '-draw_mouse', options.showCursor ? '1' : '0', '-i', 'desktop',
    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-crf', String(options.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath
  ]
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs`

Expected: all core tests pass.

---

### Task 2: Bounds-Only Region Selection

**Files:**
- Modify: `apps/host/src/main/services/screenshot-service.ts`
- Test: `apps/host/tests/screen-recording-core.test.mjs`

**Interfaces:**
- Consumes: `normalizeRecordingBounds` from Task 1.
- Produces: `ScreenshotService.selectRegion()` returning global desktop coordinates without writing the clipboard or notifying the active plugin.

- [ ] **Step 1: Add a failing absolute-bounds test**

```js
test('converts overlay-local bounds into global desktop coordinates', () => {
  assert.deepEqual(
    toGlobalRecordingBounds({ x: 30, y: 40, width: 500, height: 301 }, { x: -1920, y: 0 }),
    { x: -1890, y: 40, width: 500, height: 300 }
  )
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs`

Expected: FAIL because `toGlobalRecordingBounds` is missing.

- [ ] **Step 3: Implement the helper and selection-only capture mode**

```ts
export function toGlobalRecordingBounds(
  local: RecordingBounds,
  displayOrigin: Pick<RecordingBounds, 'x' | 'y'>
): RecordingBounds {
  return normalizeRecordingBounds({
    x: displayOrigin.x + local.x,
    y: displayOrigin.y + local.y,
    width: local.width,
    height: local.height
  })
}
```

Add `selectionOnly`, `displayX`, and `displayY` to the screenshot overlay state. In selection-only mode, the overlay sends an empty `dataUrl`, hides annotation/copy/save/pin controls, changes the confirmation label to “开始录制”, and the main process returns global bounds without clipboard writes or plugin notifications.

- [ ] **Step 4: Re-run the core tests**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs`

Expected: all tests pass.

---

### Task 3: Host Recording Service and Permissioned SDK

**Files:**
- Create: `apps/host/src/main/services/screen-recording-service.ts`
- Create: `apps/host/tests/screen-recording-integration.test.mjs`
- Modify: `packages/plugin-sdk/src/types.ts`
- Modify: `apps/host/src/preload/plugin.ts`
- Modify: `apps/host/src/main/ipc/bridge.ts`
- Modify: `apps/host/src/main/index.ts`
- Modify: `apps/host/src/main/services/workspace-service.ts`

**Interfaces:**
- Produces SDK methods `screen.startRecording`, `screen.stopRecording`, `screen.cancelRecording`, `screen.getRecordingStatus`, `screen.showRecordingInFolder`, and `screen.onRecordingEvent`.
- Produces IPC channels under `plugin:screen-recording:*` guarded by `screen.record`.
- Consumes screenshot region selection and `FFmpegManager` status/conversion.

- [ ] **Step 1: Write failing source-wiring tests**

```js
test('the SDK exposes screen recording only through the screen.record capability', async () => {
  const sdk = await readFile(new URL('../../../packages/plugin-sdk/src/types.ts', import.meta.url), 'utf8')
  const bridge = await readFile(new URL('../src/main/ipc/bridge.ts', import.meta.url), 'utf8')
  assert.match(sdk, /\| 'screen\.record'/)
  assert.match(sdk, /startRecording\(/)
  assert.match(bridge, /checkScreenRecordingPermission/)
  assert.match(bridge, /plugin:screen-recording:start/)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test apps/host/tests/screen-recording-integration.test.mjs`

Expected: FAIL because the capability, service, and handlers are absent.

- [ ] **Step 3: Implement the host-owned lifecycle**

```ts
public async start(
  ownerPluginId: string,
  options: ScreenRecordingOptions,
  emit: (event: ScreenRecordingEvent) => void
): Promise<ScreenRecordingStatus>;

public async stop(ownerPluginId: string): Promise<ScreenRecordingResult>;
public async cancel(ownerPluginId: string): Promise<boolean>;
public getStatus(ownerPluginId: string): ScreenRecordingStatus;
public shutdown(): void;
```

The service selects bounds, resolves the plugin workspace directory, spawns FFmpeg with fixed arguments, writes `q` for clean stop, converts GIF through `FFmpegManager.convertMedia`, removes temporary files, enforces owner identity and duration limits, and emits `starting`, `recording`, `converting`, `completed`, `failed`, and `canceled` events.

- [ ] **Step 4: Wire the SDK, preload, IPC, and shutdown cleanup**

```ts
const checkScreenRecordingPermission = async (senderId: number): Promise<string> => {
  const pluginId = containerManager.getPluginIdByWebContentsId(senderId)
  if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
  const plugin = PluginManager.getInstance().getPlugin(pluginId)
  if (!plugin?.manifest?.permissions?.some((p) => p.capability === 'screen.record')) {
    throw new Error(`[Security] 插件 ${pluginId} 未声明 screen.record 权限`)
  }
  return pluginId
}
```

- [ ] **Step 5: Run tests and typechecks**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs apps/host/tests/screen-recording-integration.test.mjs`

Run: `npm.cmd run typecheck -w packages/plugin-sdk`

Run: `npm.cmd run typecheck -w apps/host`

Expected: tests pass and both typechecks exit 0.

---

### Task 4: Screen Recorder Plugin UI

**Files:**
- Create: `plugins/screen-recorder/package.json`
- Create: `plugins/screen-recorder/manifest.json`
- Create: `plugins/screen-recorder/index.html`
- Create: `plugins/screen-recorder/tsconfig.json`
- Create: `plugins/screen-recorder/vite.config.ts`
- Create: `plugins/screen-recorder/tailwind.config.js`
- Create: `plugins/screen-recorder/postcss.config.js`
- Create: `plugins/screen-recorder/src/main.tsx`
- Create: `plugins/screen-recorder/src/App.tsx`
- Create: `plugins/screen-recorder/src/index.css`
- Create: `plugins/screen-recorder/tests/screen-recorder-plugin.test.mjs`

**Interfaces:**
- Consumes the Task 3 SDK methods.
- Produces the `screen-recorder` plugin with `screen.record` and `workspace` permissions.

- [ ] **Step 1: Write a failing plugin contract test**

```js
test('screen-recorder declares the narrow recording capability and both formats', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions.map((item) => item.capability), ['screen.record', 'workspace'])
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /value="mp4"/)
  assert.match(app, /value="gif"/)
  assert.match(app, /startRecording/)
  assert.match(app, /stopRecording/)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test plugins/screen-recorder/tests/screen-recorder-plugin.test.mjs`

Expected: FAIL because the plugin does not exist.

- [ ] **Step 3: Implement the plugin UI**

The UI includes region/current-display mode, MP4/GIF format, frame rate, pointer toggle, GIF width, duration limit, output-directory chooser, FFmpeg readiness, a prominent start/stop control, elapsed time, conversion progress, cancel, open result, and show-in-folder actions. It subscribes once to recording events and cleans up the subscription on unmount.

- [ ] **Step 4: Run plugin tests, typecheck, and build**

Run: `node --test plugins/screen-recorder/tests/screen-recorder-plugin.test.mjs`

Run: `npm.cmd run typecheck -w plugins/screen-recorder`

Run: `npm.cmd run build -w plugins/screen-recorder`

Expected: test passes, typecheck exits 0, and `plugins/screen-recorder/dist/index.html` exists.

---

### Task 5: Repository Integration and Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Interfaces:**
- Consumes the completed host and plugin code.
- Produces root build integration and user-facing documentation.

- [ ] **Step 1: Add the workspace build entry and refresh the lockfile**

Add `npm run build -w plugins/screen-recorder` to `build:plugins`, then run:

`npm.cmd install --package-lock-only --ignore-scripts --no-audit --no-fund`

Expected: lockfile contains `plugins/screen-recorder` without fetching new dependencies.

- [ ] **Step 2: Document the plugin and MVP boundary**

Add a README section describing region/current-display capture, MP4/GIF, FFmpeg processing, configurable frame rate/pointer/duration/output directory, and the no-audio MVP limitation.

- [ ] **Step 3: Run focused verification**

Run: `node --test apps/host/tests/screen-recording-core.test.mjs apps/host/tests/screen-recording-integration.test.mjs plugins/screen-recorder/tests/screen-recorder-plugin.test.mjs`

Run: `npm.cmd run typecheck -w packages/plugin-sdk`

Run: `npm.cmd run typecheck -w apps/host`

Run: `npm.cmd run typecheck -w plugins/screen-recorder`

Run: `npm.cmd run build -w plugins/screen-recorder`

Run: `npm.cmd run build:host`

Run: `git diff --check`

Expected: all tests pass; typechecks, builds, and diff check exit 0.

- [ ] **Step 4: Inspect the final diff and preserve unrelated work**

Run: `git status --short`

Run: `git diff -- packages/plugin-sdk/src/types.ts apps/host/src/main/services/screenshot-service.ts apps/host/src/main/services/screen-recording-core.ts apps/host/src/main/services/screen-recording-service.ts apps/host/src/main/ipc/bridge.ts apps/host/src/preload/plugin.ts apps/host/src/main/index.ts apps/host/src/main/services/workspace-service.ts plugins/screen-recorder package.json package-lock.json README.md`

Expected: only intended screen-recorder additions appear alongside preserved pre-existing changes; no commit or release artifact is created.
