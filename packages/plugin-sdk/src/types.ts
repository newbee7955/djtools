/**
 * 豆角工具箱插件系统标准契约与类型定义 (V2.0)
 */

export type CapabilityType =
  | 'network.request'
  | 'download.enqueue'
  | 'browser.login'
  | 'browser.extract'
  | 'media.merge'
  | 'media.convert'
  | 'clipboard.history'
  | 'samba.client'
  | 'lan.transfer'
  | 'screen.capture'
  | 'screen.record'
  | 'screen.pin'
  | 'drop.shelf'
  | 'remote.desktop.view'
  | 'remote.desktop.control'
  | 'remote.file.transfer'
  | 'remote.clipboard.sync'
  | 'ui.dialog';

export interface NetworkCapability {
  capability: 'network.request';
  hosts: string[];
  methods?: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD')[];
}

export interface DownloadCapability {
  capability: 'download.enqueue';
  formats?: string[];
}

export interface BrowserLoginCapability {
  capability: 'browser.login';
  domain: string;
}

export interface MediaMergeCapability {
  capability: 'media.merge';
}

export interface MediaConvertCapability {
  capability: 'media.convert';
}

export interface ClipboardCapability {
  capability: 'clipboard.history';
}

export interface SambaCapability {
  capability: 'samba.client';
}

export interface LanTransferCapability {
  capability: 'lan.transfer';
}

export interface ScreenCaptureCapability {
  capability: 'screen.capture';
}

export interface ScreenRecordingCapability {
  capability: 'screen.record';
}

export interface ScreenPinCapability {
  capability: 'screen.pin';
}

export interface DropShelfCapability {
  capability: 'drop.shelf';
}

export interface RemoteAssistCapability {
  capability: 'remote.desktop.view' | 'remote.desktop.control';
}

export interface RemoteFileTransferCapability {
  capability: 'remote.file.transfer';
}

export interface RemoteClipboardSyncCapability {
  capability: 'remote.clipboard.sync';
}

export type PluginCapability =
  | NetworkCapability
  | DownloadCapability
  | BrowserLoginCapability
  | MediaMergeCapability
  | MediaConvertCapability
  | ClipboardCapability
  | SambaCapability
  | LanTransferCapability
  | ScreenCaptureCapability
  | ScreenRecordingCapability
  | ScreenPinCapability
  | DropShelfCapability
  | RemoteAssistCapability
  | RemoteFileTransferCapability
  | RemoteClipboardSyncCapability
  | { capability: CapabilityType; [key: string]: any };

export interface SambaConfig {
  host: string;
  port?: number;
  share: string;
  basePath?: string;
  username?: string;
  password?: string;
  domain?: string;
  workgroup?: string;
}

export interface SambaProfile {
  id: string;
  name: string;
  config: SambaConfig;
  createdAt: number;
  lastConnected?: number;
}

export interface SambaFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  birthtime?: number;
  extension: string;
}

export interface SambaTransferProgress {
  id: string;
  type: 'upload' | 'download';
  fileName: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
  speed: string;
  status: 'transferring' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface PluginEngines {
  doujiao: string;    // e.g. ">=0.2.0 <0.3.0"
  pluginApi: string;  // e.g. "^1.0.0"
}

export interface PluginEntrypoints {
  ui: string;         // e.g. "dist/index.html"
}

export interface PluginManifest {
  $schema?: string;
  id: string;
  publisher: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  engines: PluginEngines;
  entrypoints: PluginEntrypoints;
  permissions: PluginCapability[];
  requires?: Record<string, string>; // e.g. { "host.media.ffmpeg": ">=6 <8" }
}

export interface NetworkRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | FormData | Record<string, any>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export interface NetworkResponse<T = any> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export interface DownloadTaskRequest {
  url: string;
  audioUrl?: string; // 可选的独立伴音流（音视频分离场景，宿主将自动使用 FFmpeg 执行无损混流）
  filename: string;
  headers?: Record<string, string>;
  extra?: {
    coverUrl?: string;
    authorName?: string;
    title?: string;
    duration?: number;
    platform?: string;
    quality?: string;
    [key: string]: any;
  };
}

export interface DownloadProgressInfo {
  taskId: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number; // 0 to 100
  speed: string;
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused';
  error?: string;
}

export interface ClipboardItem {
  id: string;
  text: string;
  type: 'text' | 'image';
  timestamp: number;
  charCount: number;
  lineCount: number;
  pinned: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export interface PluginContext {
  pluginId: string;
  version: string;
}

export interface PluginLifecycle {
  activate?(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  dispose?(): void;
}

export interface LanTransferServerStatus {
  running: boolean;
  port: number;
  ip: string;
  allIps: Array<{ name: string; ip: string; isDefault: boolean }>;
  url: string;
  qrCodeSvg: string;
  connectedDevices: Array<{ id: string; deviceName: string; ip: string; lastSeen: number }>;
  saveDirectory: string;
  authEnabled: boolean;
  authPin: string;
  autoPinInQr: boolean;
}

export interface LanTransferSharedFile {
  id: string;
  name: string;
  size: number;
  localPath: string;
  mimeType: string;
  downloadCount: number;
  createdAt: number;
}

export interface LanTransferReceivedFile {
  id: string;
  name: string;
  size: number;
  localPath: string;
  mimeType: string;
  senderDevice: string;
  senderIp: string;
  receivedAt: number;
}

export interface LanTransferMessage {
  id: string;
  text: string;
  sender: 'pc' | 'mobile';
  senderDevice?: string;
  timestamp: number;
}

export interface LanTransferEvent {
  type:
    | 'file-received'
    | 'message-received'
    | 'device-connected'
    | 'device-disconnected'
    | 'share-downloaded'
    | 'upload-progress'
    | 'server-status';
  payload: any;
}

export interface WorkspaceFileItem {
  name: string;
  relativePath: string;
  size: number;
  updatedAt: number;
  isDirectory?: boolean;
}

export interface WorkspaceSnapshotItem {
  id: string;
  timestamp: number;
  type: 'auto' | 'milestone';
  label?: string;
  charCount: number;
  size: number;
  summary?: string;
}

export interface WorkspaceGitStatus {
  installed: boolean;
  isRepo: boolean;
  branch?: string;
  clean?: boolean;
  modifiedFiles?: string[];
  untrackedFiles?: string[];
  stagedFiles?: string[];
}

export interface WorkspaceGitCommitItem {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  timestamp: number;
  message: string;
}

export interface ScreenCaptureOptions {
  /** 截图时是否隐藏宿主主窗口 (默认 true) */
  hideWindow?: boolean;
  /** 截图模式: 'snip' (划选截图) | 'fullscreen' (全屏直截), 默认 'snip' */
  mode?: 'snip' | 'fullscreen';
}

export interface ScreenCaptureResult {
  success: boolean;
  canceled?: boolean;
  dataUrl?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
}

export interface FFmpegConvertOptions {
  inputPath: string;
  outputPath: string;
  format?: string;
  startTime?: string | number;
  duration?: string | number;
  videoCodec?: string;
  audioCodec?: string;
  audioBitrate?: string;
  videoBitrate?: string;
  crf?: number;
  scale?: string;
  fps?: number;
  isGif?: boolean;
  extraArgs?: string[];
}

export interface FFmpegConvertProgress {
  taskId: string;
  percent: number;
  timemark?: string;
  fps?: number;
  speed?: string;
  bitrate?: string;
  status: 'running' | 'completed' | 'failed' | 'canceled';
  error?: string;
  outputPath?: string;
}

export interface MediaProbeInfo {
  format?: string;
  duration?: number;
  size?: number;
  bitrate?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  fps?: number;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
}

/**
 * 宿主向沙箱环境注入的 SDK 核心门面
 */
export interface DoujiaoSDK {
  readonly version: string;
  readonly pluginId: string;

  /** 获取拖拽 File 对象的本地绝对路径 (兼容 Electron 33+ 安全策略) */
  getPathForFile?(file: File): string;

  /** 本地工作目录与持久化文件管理 (独立于应用，卸载不丢失) */
  workspace?: {
    getDirectory(scope?: string): Promise<string>;
    setDirectory(directory: string, scope?: string): Promise<string>;
    selectDirectory(defaultPath?: string): Promise<{ canceled: boolean; directoryPath?: string }>;
    listFiles(scope?: string, extensions?: string[], subPath?: string, recursive?: boolean): Promise<WorkspaceFileItem[]>;
    readFile(relativePath: string, scope?: string): Promise<string>;
    writeFile(relativePath: string, content: string, scope?: string): Promise<{ success: boolean; filePath: string }>;
    deleteFile(relativePath: string, scope?: string): Promise<boolean>;
    renameFile(oldName: string, newName: string, scope?: string): Promise<boolean>;
    createDirectory(relativePath: string, scope?: string): Promise<{ success: boolean; dirPath: string }>;
    openDirectory(scope?: string): Promise<void>;
    resetDirectory(scope?: string): Promise<string>;
    saveFileAs(content: string, defaultName?: string, extensions?: string[]): Promise<{ canceled: boolean; filePath?: string; fileName?: string }>;
    selectFileToOpen(extensions?: string[]): Promise<{ canceled: boolean; filePath?: string; content?: string; fileName?: string }>;

    /** 时间轴历史快照 (Local History) */
    history?: {
      saveSnapshot(scope: string, relativePath: string, content: string, type?: 'auto' | 'milestone', label?: string): Promise<WorkspaceSnapshotItem>;
      listSnapshots(scope: string, relativePath: string): Promise<WorkspaceSnapshotItem[]>;
      getSnapshot(scope: string, relativePath: string, snapshotId: string): Promise<string>;
      deleteSnapshot(scope: string, relativePath: string, snapshotId: string): Promise<boolean>;
    };

    /** 专业 Git 版本控制 (Git Version Control) */
    git?: {
      getStatus(scope: string): Promise<WorkspaceGitStatus>;
      init(scope: string): Promise<{ success: boolean; message?: string }>;
      commit(scope: string, message: string, files?: string[]): Promise<{ success: boolean; commitHash?: string; error?: string }>;
      getLog(scope: string, relativePath?: string, maxCount?: number): Promise<WorkspaceGitCommitItem[]>;
      showFile(scope: string, commitHash: string, relativePath: string): Promise<string>;
      checkout(scope: string, commitHash: string, relativePath: string): Promise<{ success: boolean; error?: string }>;
    };
  };

  /** 网络请求代理（受控附加 Cookie 与安全 Header） */
  network: {
    request<T = any>(options: NetworkRequestOptions): Promise<NetworkResponse<T>>;
  };

  /** 下载任务引擎（宿主持有生命周期） */
  download: {
    enqueue(task: DownloadTaskRequest): Promise<{ taskId: string }>;
    onProgress(callback: (info: DownloadProgressInfo) => void): () => void; // 返回取消订阅函数
    openSaveDirectory(): Promise<void>;
  };

  /** 浏览器登录会话管理 */
  auth: {
    requestLogin(domain: string): Promise<{ success: boolean; message?: string }>;
    getStatus(domain: string): Promise<{ loggedIn: boolean; nickname?: string }>;
  };

  /** 剪贴板历史管理 */
  clipboard?: {
    getHistory(): Promise<ClipboardItem[]>;
    writeText(text: string): Promise<boolean>;
    writeImage(dataUrl: string): Promise<boolean>;
    deleteItem(id: string): Promise<boolean>;
    clearHistory(): Promise<boolean>;
    togglePin(id: string): Promise<boolean>;
    onChanged(callback: (items: ClipboardItem[]) => void): () => void;
  };

  /** 媒体处理能力（FFmpeg 受控执行） */
  media?: {
    merge(options: { videoPath: string; audioPath: string; outputPath: string }): Promise<{ success: boolean; error?: string }>;
    checkFFmpeg(): Promise<{ installed: boolean; version?: string; path?: string }>;
    convert(options: FFmpegConvertOptions): Promise<{ success: boolean; taskId: string; outputPath?: string; error?: string }>;
    probe?(filePath: string): Promise<MediaProbeInfo>;
    cancelConvert?(taskId: string): Promise<boolean>;
    showItemInFolder?(localPath: string): Promise<boolean>;
    openPath?(localPath: string): Promise<boolean>;
    onProgress?(callback: (progress: FFmpegConvertProgress) => void): () => void;
  };

  /** Samba 文件系统管理能力 */
  samba?: {
    getProfiles(): Promise<SambaProfile[]>;
    saveProfile(profile: SambaProfile): Promise<boolean>;
    deleteProfile(id: string): Promise<boolean>;
    testConnection(config: SambaConfig): Promise<{ success: boolean; error?: string }>;
    connect(profileId: string): Promise<{ success: boolean; error?: string }>;
    disconnect(profileId: string): Promise<boolean>;
    listDirectory(profileId: string, path: string): Promise<SambaFileItem[]>;
    createDirectory(profileId: string, path: string): Promise<boolean>;
    deleteItem(profileId: string, path: string, isDirectory: boolean): Promise<boolean>;
    renameItem(profileId: string, oldPath: string, newPath: string): Promise<boolean>;
    readFileText(profileId: string, path: string, maxBytes?: number): Promise<string>;
    getThumbnail(profileId: string, path: string, mimeType: string, size: number): Promise<string | null>;
    uploadFile(profileId: string, localFilePath: string, remoteDirectory: string): Promise<{ success: boolean; error?: string }>;
    downloadFile(profileId: string, remoteFilePath: string, localSavePath?: string): Promise<{ success: boolean; localPath?: string; error?: string }>;
    getFileStreamUrl(profileId: string, path: string): Promise<string>;
    saveThumbnailCache(profileId: string, path: string, size: number, dataUrl: string): Promise<boolean>;
    selectLocalFile(): Promise<{ canceled: boolean; filePath?: string; fileName?: string; size?: number }>;
    selectLocalDirectory(): Promise<{ canceled: boolean; directoryPath?: string }>;
    onTransferProgress(callback: (progress: SambaTransferProgress) => void): () => void;
  };

  /** 对象存储配置管理能力 */
  objectStorage?: {
    getProfiles(): Promise<any[]>;
    saveProfiles(profiles: any[]): Promise<boolean>;
    saveProfile(profile: any): Promise<boolean>;
    deleteProfile(id: string): Promise<boolean>;
    onProfilesUpdated?(callback: () => void): () => void;
  };

  /** 局域网跨设备文件传输助手 (PC与手机互传) */
  lan?: {
    startServer(options?: { port?: number; ip?: string; saveDirectory?: string }): Promise<LanTransferServerStatus>;
    stopServer(): Promise<boolean>;
    getStatus(): Promise<LanTransferServerStatus>;
    switchIp(ip: string): Promise<LanTransferServerStatus>;
    setAuthEnabled(enabled: boolean): Promise<LanTransferServerStatus>;
    refreshPin(): Promise<LanTransferServerStatus>;
    setAutoPinInQr(enabled: boolean): Promise<LanTransferServerStatus>;
    addShareFiles(filePaths: string[]): Promise<LanTransferSharedFile[]>;
    removeShareFile(id: string): Promise<boolean>;
    getShareFiles(): Promise<LanTransferSharedFile[]>;
    getReceivedFiles(): Promise<LanTransferReceivedFile[]>;
    deleteReceivedFile(id: string): Promise<boolean>;
    openFile(localPath: string): Promise<boolean>;
    showItemInFolder(localPath: string): Promise<boolean>;
    selectFilesToSend(): Promise<{ canceled: boolean; filePaths: string[] }>;
    selectSaveDirectory(): Promise<{ canceled: boolean; directoryPath?: string }>;
    openSaveDirectory(): Promise<void>;
    sendTextMessage(text: string): Promise<LanTransferMessage>;
    getMessages(): Promise<LanTransferMessage[]>;
    clearMessages(): Promise<boolean>;
    onEvent(callback: (event: LanTransferEvent) => void): () => void;
  };

  /** 屏幕截图与录像能力 */
  screen?: {
    capture(options?: ScreenCaptureOptions): Promise<ScreenCaptureResult>;
    onCaptured(callback: (result: ScreenCaptureResult) => void): () => void;
    startRecording(options: ScreenRecordingOptions): Promise<ScreenRecordingStatus>;
    stopRecording(): Promise<ScreenRecordingResult>;
    cancelRecording(): Promise<boolean>;
    getRecordingStatus(): Promise<ScreenRecordingStatus>;
    getRecordingSupport(): Promise<ScreenRecordingSupport>;
    openRecording(localPath: string): Promise<boolean>;
    showRecordingInFolder?(localPath: string): Promise<boolean>;
    onRecordingEvent(callback: (event: ScreenRecordingEvent) => void): () => void;
  };

  /** 桌面贴图置顶能力 */
  pin?: {
    createPin(options: PinOptions): Promise<string>;
    closePin(pinId: string): Promise<boolean>;
    closeAllPins(): Promise<boolean>;
    getPinnedList(): Promise<PinItem[]>;
    pinFromClipboard(): Promise<string | null>;
    setPinOpacity(pinId: string, opacity: number): Promise<boolean>;
    setPinScale(pinId: string, scale: number): Promise<boolean>;
    setPinClickThrough(pinId: string, clickThrough: boolean): Promise<boolean>;
    cancelAllClickThrough?(): Promise<boolean>;
    getPinData?(pinId: string): Promise<PinItem | null>;
    movePin?(pinId: string, deltaX: number, deltaY: number): Promise<boolean>;
    resizePin?(pinId: string, width: number, height: number): Promise<boolean>;
    copyImage?(dataUrl: string): Promise<boolean>;
    saveAs?(dataUrl: string, defaultName?: string): Promise<{ canceled: boolean; filePath?: string }>;
    onPinsChanged(callback: (pins: PinItem[]) => void): () => void;
  };

  /** 桌面文件暂存岛能力 */
  shelf?: {
    getItems(): Promise<ShelfItem[]>;
    addItem(item: Partial<ShelfItem>): Promise<ShelfItem>;
    removeItems(ids: string[]): Promise<boolean>;
    clearShelf(): Promise<boolean>;
    startDrag(filePaths: string[]): Promise<void>;
    packToZip(filePaths: string[], zipName?: string): Promise<{ success: boolean; zipPath?: string; error?: string }>;
    copyPaths(filePaths: string[]): Promise<boolean>;
    toggleShelfWindow(visible?: boolean): Promise<boolean>;
    openFile?(filePath: string): Promise<boolean>;
    showItemInFolder?(filePath: string): Promise<boolean>;
    selectFiles?(): Promise<{ canceled?: boolean; count?: number }>;
    getConfig?(): Promise<ShelfConfig>;
    setConfig?(config: Partial<ShelfConfig>): Promise<ShelfConfig>;
    onShelfChanged(callback: (items: ShelfItem[]) => void): () => void;
    setCollapsed?(collapsed: boolean): Promise<boolean>;
    isCollapsed?(): Promise<boolean>;
    setTabY?(y: number): Promise<boolean>;
    onCollapseChanged?(callback: (collapsed: boolean) => void): () => void;
    pasteFromClipboard?(): Promise<{ success: boolean; count: number; message?: string }>;
  };

  /** 远程协助能力 */
  remoteAssist?: RemoteAssistApi;

  /** UI 交互与通知 */
  ui: {
    notify(options: { message: string; type?: 'info' | 'success' | 'warning' | 'error' }): void;
  };

  /** 注册插件生命周期钩子 */
  lifecycle: {
    register(hooks: PluginLifecycle): void;
  };
}

export type ScreenRecordingMode = 'fullscreen' | 'display' | 'region';
export type ScreenRecordingFormat = 'mp4' | 'gif';

export interface ScreenRecordingOptions {
  mode?: ScreenRecordingMode;
  bounds?: { x: number; y: number; width: number; height: number };
  fps?: number;
  format?: ScreenRecordingFormat;
  showCursor?: boolean;
  maxDuration?: number;
  maxDurationSeconds?: number;
  gifWidth?: number;
  recordSystemAudio?: boolean;
  recordMicrophone?: boolean;
  showToolbar?: boolean;
}

export interface ScreenRecordingStatus {
  active: boolean;
  phase: 'idle' | 'selecting' | 'starting' | 'recording' | 'stopping' | 'converting' | 'completed' | 'failed' | 'canceled';
  recordingId?: string;
  format?: ScreenRecordingFormat;
  startedAt?: number;
  startTime?: number;
  elapsedMs?: number;
  duration?: number;
  outputPath?: string;
  progress?: number;
  error?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface ScreenRecordingResult {
  success: boolean;
  recordingId?: string;
  canceled?: boolean;
  outputPath?: string;
  format?: ScreenRecordingFormat;
  durationMs?: number;
  duration?: number;
  fileSize?: number;
  error?: string;
}

export interface ScreenRecordingSupport {
  supported: boolean;
  platform?: string;
  ffmpegInstalled?: boolean;
  ffmpegVersion?: string;
  reason?: string;
  installed?: boolean;
  version?: string;
  hasAudioInput?: boolean;
}

export type ScreenRecordingEvent = ScreenRecordingStatus;

export interface PinItem {
  id: string;
  dataUrl: string;
  bounds?: { x: number; y: number; width: number; height: number };
  opacity?: number;
  scale?: number;
  clickThrough?: boolean;
  createdAt: number;
  title?: string;
}

export interface PinOptions {
  dataUrl: string;
  bounds?: { x: number; y: number; width: number; height: number };
  opacity?: number;
  scale?: number;
  title?: string;
}

export interface ShelfConfig {
  shortcut: string;
  copyFiles: boolean;
  autoDock?: boolean;
  dockSide?: 'left' | 'right';
}

export interface ShelfItem {
  id: string;
  name: string;
  path: string;
  originalPath?: string;
  isCopy?: boolean;
  size: number;
  type: 'file' | 'image' | 'text' | 'url' | 'directory';
  thumbnail?: string;
  content?: string;
  createdAt: number;
}

// 远程协助相关接口契约
export type RemoteAssistRole = 'controller' | 'controlled';
export type RemoteAssistPermission = 'view' | 'control';

export type RemoteAssistInputEvent =
  | { type: 'pointer-move'; sessionId: string; seq: number; x: number; y: number }
  | { type: 'pointer-button'; sessionId: string; seq: number; button: 'left' | 'middle' | 'right'; pressed: boolean }
  | { type: 'wheel'; sessionId: string; seq: number; deltaX: number; deltaY: number }
  | { type: 'key'; sessionId: string; seq: number; code: string; pressed: boolean; modifiers: string[] };

export interface RemoteAssistDeviceInfo {
  deviceCode: string;       // e.g. "839 201 442"
  rawDeviceId: string;
  displayName: string;
  signalingStatus: 'connected' | 'connecting' | 'disconnected';
  signalingUrl?: string;
  safetyCode?: string;       // e.g. "582 109" (persistent, refreshable)
  preferredFps?: number;     // e.g. 60, 30, 15
  pendingRequest?: {
    requestId: string;
    fromDeviceCode: string;
    fromDisplayName: string;
    permission: RemoteAssistPermission;
    safetyCode: string;
    providedSafetyCode?: string;
    safetyCodeMatched?: boolean;
  } | null;
}

export type RemoteAssistSessionPhase =
  | 'idle'
  | 'requesting'
  | 'awaiting-consent'
  | 'connecting'
  | 'connected'
  | 'disconnecting';

export interface RemoteAssistSessionStatus {
  sessionId: string;
  role: RemoteAssistRole;
  phase: RemoteAssistSessionPhase;
  permission: RemoteAssistPermission;
  peerDeviceCode: string;
  peerDisplayName?: string;
  safetyCode?: string;
  connectionMode?: 'p2p-lan' | 'p2p-wan' | 'relay';
  connectionModeText?: string;
  rttMs?: number;
  startedAt?: number;
  error?: string;
}

export type RemoteAssistEvent =
  | { type: 'signaling-status'; status: 'connected' | 'connecting' | 'disconnected' }
  | { type: 'incoming-request'; requestId: string; fromDeviceCode: string; fromDisplayName: string; permission: RemoteAssistPermission; safetyCode: string; providedSafetyCode?: string; safetyCodeMatched?: boolean }
  | { type: 'session-state'; status: RemoteAssistSessionStatus }
  | { type: 'local-override'; at: number }
  | { type: 'session-ended'; sessionId: string; reason: string }
  | { type: 'transfer-state'; state: { transferId: string; mode: 'send' | 'clipboard-file' | 'clipboard-image'; direction: 'outgoing' | 'incoming'; totalBytes: number; transferredBytes: number; status: string; message?: string } }
  | { type: 'transfer-chat'; text: string }
  | { type: 'clipboard-applied'; kind: 'text' | 'image' | 'files' };

export interface RemoteAssistApi {
  getDeviceInfo(): Promise<RemoteAssistDeviceInfo>;
  setSignalingUrl?(url: string): Promise<boolean>;
  refreshSafetyCode?(): Promise<string>;
  setPreferredFps?(fps: number): Promise<boolean>;
  requestSession(targetDeviceCode: string, permission: RemoteAssistPermission, safetyCode?: string): Promise<RemoteAssistSessionStatus>;
  respondToSession(requestId: string, decision: 'view' | 'control' | 'deny'): Promise<boolean>;
  disconnect(sessionId: string): Promise<boolean>;
  transfer?: {
    getSettings(): Promise<{ receiveDir: string; policy: { receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } } }>;
    setReceiveDir(dir: string): Promise<boolean>;
    setPolicy(policy: { receiveFiles: boolean; clipboard: { text: boolean; image: boolean; file: boolean } }): Promise<boolean>;
    sendPaths(paths: string[]): Promise<string>;
    chooseAndSend(): Promise<string | null>;
    cancel(transferId: string): Promise<boolean>;
    openReceiveFolder(): Promise<boolean>;
    sendChat(text: string): Promise<boolean>;
  };
  onEvent(callback: (event: RemoteAssistEvent) => void): () => void;
}

declare global {
  interface Window {
    doujiaoSDK?: DoujiaoSDK;
  }
}
