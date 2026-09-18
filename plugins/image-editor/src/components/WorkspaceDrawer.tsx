import React, { useState, useEffect } from 'react';
import type { WorkspaceFileItem } from '@doujiao/plugin-sdk';

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectImage: (dataUrl: string, fileName: string) => void;
  sdk?: any;
}

export const WorkspaceDrawer: React.FC<WorkspaceDrawerProps> = ({
  isOpen,
  onClose,
  onSelectImage,
  sdk
}) => {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async () => {
    if (!sdk?.workspace) return;
    setLoading(true);
    setError(null);
    try {
      const list = await sdk.workspace.listFiles('image-editor', [
        'png',
        'jpg',
        'jpeg',
        'webp',
        'bmp',
        'gif',
        'svg'
      ]);
      setFiles(list || []);
    } catch (err: any) {
      setError(err?.message || '读取工作区目录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen]);

  const handleOpenFile = async (file: WorkspaceFileItem) => {
    if (!sdk?.workspace) return;
    try {
      const content = await sdk.workspace.readFile(file.relativePath, 'image-editor');
      if (content) {
        onSelectImage(content, file.name);
        onClose();
      }
    } catch (err: any) {
      alert(`读取图片失败: ${err?.message}`);
    }
  };

  const handleDeleteFile = async (e: React.MouseEvent, file: WorkspaceFileItem) => {
    e.stopPropagation();
    if (!sdk?.workspace?.deleteFile) return;
    if (window.confirm(`确定要删除图片 "${file.name}" 吗？`)) {
      try {
        await sdk.workspace.deleteFile(file.relativePath, 'image-editor');
        loadFiles();
      } catch (err: any) {
        alert(`删除失败: ${err?.message}`);
      }
    }
  };

  const handleClearAllFiles = async () => {
    if (!sdk?.workspace?.deleteFile || files.length === 0) return;
    if (window.confirm(`⚠️ 高危操作：确定要清空工作区图库 (Doujiao/Images) 中的全部 ${files.length} 张图片吗？此操作不可撤销。`)) {
      setLoading(true);
      try {
        for (const file of files) {
          await sdk.workspace.deleteFile(file.relativePath, 'image-editor');
        }
        await loadFiles();
      } catch (err: any) {
        alert(`清空失败: ${err?.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleOpenFolder = () => {
    if (sdk?.workspace?.openDirectory) {
      sdk.workspace.openDirectory('image-editor');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-full shadow-2xl">
        {/* 抽屉头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="text-base">📁</span>
            <span className="font-semibold text-slate-100 text-sm">工作区图库 (Doujiao/Images)</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-950/60 border-b border-slate-800 text-xs">
          <span className="text-slate-400">共 {files.length} 张图片</span>
          <div className="flex items-center space-x-2">
            {files.length > 0 && (
              <button
                onClick={handleClearAllFiles}
                disabled={loading}
                className="px-2 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/60 rounded transition active:scale-95"
                title="清空图库中的全部图片"
              >
                清空图库
              </button>
            )}
            <button
              onClick={loadFiles}
              disabled={loading}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition"
            >
              刷新
            </button>
            <button
              onClick={handleOpenFolder}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded transition"
            >
              在文件夹中打开
            </button>
          </div>
        </div>

        {/* 图片列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="text-center py-12 text-slate-500 text-xs">正在加载图片列表...</div>
          )}

          {error && (
            <div className="text-center py-8 text-rose-400 text-xs px-2">{error}</div>
          )}

          {!loading && files.length === 0 && !error && (
            <div className="text-center py-12 text-slate-500 text-xs space-y-1">
              <div>暂无已保存的图片</div>
              <div className="text-slate-600">编辑图片后点击「保存」将自动存入此目录</div>
            </div>
          )}

          {files.map((file) => (
            <div
              key={file.relativePath}
              onClick={() => handleOpenFile(file)}
              className="p-2.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-sky-500/50 rounded-lg cursor-pointer transition flex items-center justify-between group"
            >
              <div className="min-w-0 flex-1 pr-2">
                <div className="text-slate-200 font-medium text-xs truncate group-hover:text-sky-300">
                  {file.name}
                </div>
                <div className="text-slate-500 text-[11px] mt-0.5 flex items-center space-x-2">
                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                  <span>•</span>
                  <span>{new Date(file.updatedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <button
                  onClick={() => handleOpenFile(file)}
                  className="text-xs text-sky-400 opacity-0 group-hover:opacity-100 transition px-2 py-1 rounded bg-sky-950/60 hover:bg-sky-900"
                >
                  载入
                </button>
                <button
                  onClick={(e) => handleDeleteFile(e, file)}
                  title="删除此图片"
                  className="text-xs text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-rose-950/60"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
