/**
 * 远程协助受控端屏幕流捕获授权控制器 (Display Media Controller)
 * 严格限制 getDisplayMedia 请求范围，仅允许捕获用户在会话审批中明确选定的屏幕
 */

import { session, desktopCapturer } from 'electron'

export class DisplayMediaController {
  private approvedSourceId: string | null = null
  private partitionName = 'persist:remote-assist'

  constructor(partitionName: string = 'persist:remote-assist') {
    this.partitionName = partitionName
    this.setupHandler()
  }

  public setApprovedSourceId(sourceId: string | null): void {
    this.approvedSourceId = sourceId
  }

  private setupHandler(): void {
    const targetSession = session.fromPartition(this.partitionName)
    if (!targetSession) {
      return
    }

    if (typeof targetSession.setPermissionRequestHandler === 'function') {
      targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const perm = permission as string
        if (perm === 'display-capture' || perm === 'media' || perm === 'fullscreen') {
          callback(true)
          return
        }
        callback(false)
      })
    }

    if (typeof targetSession.setPermissionCheckHandler === 'function') {
      targetSession.setPermissionCheckHandler((_webContents, permission) => {
        const perm = permission as string
        return perm === 'display-capture' || perm === 'media' || perm === 'fullscreen'
      })
    }

    if (typeof targetSession.setDisplayMediaRequestHandler !== 'function') {
      return
    }

    targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
      let callbackDone = false
      const safeCallback = (result: any) => {
        if (callbackDone) return
        callbackDone = true
        try {
          callback(result)
        } catch (err) {
          console.error('[DisplayMediaController] 回调授权结果异常:', err)
        }
      }

      try {
        const req = request as any
        const isVideoRequested = req.videoRequested !== undefined
          ? Boolean(req.videoRequested)
          : (req.video !== undefined ? Boolean(req.video) : true)

        if (!isVideoRequested) {
          safeCallback({})
          return
        }

        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        let selectedSource = sources.find((s) => s.id === this.approvedSourceId)

        if (!selectedSource && sources.length > 0) {
          // Default to primary display if specific ID not found
          selectedSource = sources[0]
        }

        if (selectedSource) {
          console.info(`[DisplayMediaController] 自动授权屏幕捕获: ${selectedSource.name} (${selectedSource.id})`)
          // V1 强制禁用远程音频录制与同步传输
          safeCallback({ video: selectedSource })
        } else {
          console.warn('[DisplayMediaController] 未找到可用屏幕捕获源')
          safeCallback({})
        }
      } catch (err) {
        console.error('[DisplayMediaController] 捕获源授权异常:', err)
        safeCallback({})
      }
    })
  }

  public reset(): void {
    this.approvedSourceId = null
  }
}
