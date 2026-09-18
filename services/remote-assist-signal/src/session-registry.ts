/**
 * 信令服务内存设备注册表 (纯内存，不落地存储任何用户数据)
 */

export interface RegisteredDevice {
  deviceCode: string
  displayName?: string
  publicKey?: string
  socket: any
  registeredAt: number
}

export class SessionRegistry {
  private devices = new Map<string, RegisteredDevice>()

  public register(deviceCode: string, socket: any, displayName?: string, publicKey?: string): void {
    const clean = deviceCode.replace(/\s+/g, '')
    this.devices.set(clean, {
      deviceCode,
      displayName,
      publicKey,
      socket,
      registeredAt: Date.now()
    })
  }

  public unregisterBySocket(socket: any): string | null {
    for (const [code, dev] of this.devices.entries()) {
      if (dev.socket === socket) {
        this.devices.delete(code)
        return dev.deviceCode
      }
    }
    return null
  }

  public getBySocket(socket: any): RegisteredDevice | undefined {
    for (const dev of this.devices.values()) {
      if (dev.socket === socket) {
        return dev
      }
    }
    return undefined
  }

  public get(deviceCode: string): RegisteredDevice | undefined {
    const clean = deviceCode.replace(/\s+/g, '')
    return this.devices.get(clean)
  }

  public get count(): number {
    return this.devices.size
  }
}
