import type { DoujiaoSDK, PluginLifecycle } from './types';

export * from './types';

declare const window: any;

/**
 * 获取宿主注入的受控 SDK 实例
 */
export function getSDK(): DoujiaoSDK {
  const currentWindow = typeof window !== 'undefined' ? window : (globalThis as any).window;
  if (currentWindow && currentWindow.doujiaoSDK) {
    return currentWindow.doujiaoSDK;
  }
  throw new Error(
    '[DoujiaoSDK] 未在当前运行环境中检测到宿主 SDK 门面 (window.doujiaoSDK)。请确保插件在宿主 WebContentsView 沙箱中运行。'
  );
}

/**
 * 便捷定义插件生命周期与初始化导出
 */
export function definePlugin(lifecycle: PluginLifecycle): PluginLifecycle {
  const currentWindow = typeof window !== 'undefined' ? window : (globalThis as any).window;
  if (currentWindow && currentWindow.doujiaoSDK?.lifecycle) {
    currentWindow.doujiaoSDK.lifecycle.register(lifecycle);
  }
  return lifecycle;
}
