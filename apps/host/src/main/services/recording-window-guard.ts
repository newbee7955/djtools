export interface RecordingHostWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  hide(): void
  show(): void
  restore(): void
  focus(): void
}

export class RecordingWindowGuard {
  private mainWindow: RecordingHostWindow | null = null
  private shouldRestore = false

  public init(mainWindow: RecordingHostWindow): void {
    this.mainWindow = mainWindow
  }

  public hideForRecording(): void {
    const mainWindow = this.mainWindow
    this.shouldRestore = Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    )
    if (this.shouldRestore) mainWindow?.hide()
  }

  public restoreAfterRecording(): void {
    const shouldRestore = this.shouldRestore
    this.shouldRestore = false
    const mainWindow = this.mainWindow
    if (!shouldRestore || !mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  public clearWithoutRestore(): void {
    this.shouldRestore = false
  }
}
