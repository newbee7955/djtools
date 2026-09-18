/**
 * 远程输入序号去重：点击/滚轮会同时走无序快通道与可靠备份通道，
 * 同一 seq 只允许注入一次。移动和按键不参与去重。
 */
export class InputSeqDedupe {
  private seen = new Set<number>()
  private queue: number[] = []
  private maxSize: number

  constructor(maxSize: number = 128) {
    this.maxSize = maxSize
  }

  public isDuplicate(type: string, seq: number): boolean {
    if (type === 'pointer-move' || type === 'key') {
      return false
    }
    if (this.seen.has(seq)) {
      return true
    }
    this.seen.add(seq)
    this.queue.push(seq)
    if (this.queue.length > this.maxSize) {
      const oldest = this.queue.shift()
      if (oldest !== undefined) {
        this.seen.delete(oldest)
      }
    }
    return false
  }

  public reset(): void {
    this.seen.clear()
    this.queue = []
  }
}
