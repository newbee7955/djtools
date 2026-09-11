import { contextBridge, ipcRenderer } from 'electron'

const screenshotAPI = {
  getInitialData: () => ipcRenderer.invoke('host:screenshot:get-initial-data'),
  finish: (result: { dataUrl: string; bounds?: { x: number; y: number; width: number; height: number } }) =>
    ipcRenderer.invoke('host:screenshot:finish', result),
  cancel: () => ipcRenderer.invoke('host:screenshot:cancel'),
  copy: (dataUrl: string) => ipcRenderer.invoke('host:screenshot:copy', dataUrl),
  saveAs: (dataUrl: string) => ipcRenderer.invoke('host:screenshot:save-as', dataUrl)
}

contextBridge.exposeInMainWorld('screenshotAPI', screenshotAPI)

export type ScreenshotAPI = typeof screenshotAPI
