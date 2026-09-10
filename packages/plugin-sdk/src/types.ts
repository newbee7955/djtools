/**
 * 豆角工具箱插件系统标准契约与类型定义 (V2.0)
 */

export type CapabilityType =
  | 'network.request'
  | 'download.enqueue'
  | 'browser.login'
  | 'browser.extract'
  | 'media.merge'
  | 'clipboard.history'
  | 'samba.client'
  | 'lan.transfer'
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

export interface ClipboardCapability {
  capability: 'clipboard.history';
}

export interface SambaCapability {
  capability: 'samba.client';
}

export interface LanTransferCapability {
  capability: 'lan.transfer';
}

export type PluginCapability =
  | NetworkCapability
  | DownloadCapability
  | BrowserLoginCapability
  | MediaMergeCapability
  | ClipboardCapability
  | SambaCapability
  | LanTransferCapability
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

  /** UI 交互与通知 */
  ui: {
    notify(options: { message: string; type?: 'info' | 'success' | 'warning' | 'error' }): void;
  };

  /** 注册插件生命周期钩子 */
  lifecycle: {
    register(hooks: PluginLifecycle): void;
  };
}

declare global {
  interface Window {
    doujiaoSDK?: DoujiaoSDK;
  }
}
