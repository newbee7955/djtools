import { contextBridge, ipcRenderer } from 'electron'

export interface RecordingOverlayState {
  recordingId: string
  bounds?: { x: number; y: number; width: number; height: number }
  format: 'mp4' | 'gif'
  startedAt: number
  recordSystemAudio: boolean
  recordMicrophone: boolean
  showToolbar: boolean
}

const recordingOverlayAPI = {
  getInitialState: (): Promise<RecordingOverlayState | null> =>
    ipcRenderer.invoke('host:recording-overlay:get-state'),
  sendAction: (action: string, payload?: any): Promise<any> =>
    ipcRenderer.invoke('host:recording-overlay:action', { action, payload }),
  onEvent: (callback: (event: string, payload?: any) => void): (() => void) => {
    const listener = (_: any, data: { event: string; payload?: any }) => {
      callback(data.event, data.payload)
    }
    ipcRenderer.on('host:recording-overlay:event', listener)
    return () => ipcRenderer.removeListener('host:recording-overlay:event', listener)
  },
  submitAudio: (base64Audio: string): Promise<boolean> =>
    ipcRenderer.invoke('host:recording-overlay:submit-audio', base64Audio),
  stopRecording: (): Promise<void> =>
    ipcRenderer.invoke('host:recording-overlay:stop'),
  cancelRecording: (): Promise<void> =>
    ipcRenderer.invoke('host:recording-overlay:cancel')
}

contextBridge.exposeInMainWorld('recordingOverlayAPI', recordingOverlayAPI)

export type RecordingOverlayAPI = typeof recordingOverlayAPI
