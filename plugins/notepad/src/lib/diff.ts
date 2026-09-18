export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  oldNum?: number
  newNum?: number
  text: string
}

export interface DiffResult {
  lines: DiffLine[]
  additions: number
  deletions: number
}

/**
 * 计算两段文本的逐行差异 (LCS Diff 算法)
 */
export function computeLineDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const n = oldLines.length
  const m = newLines.length

  // LCS 动态规划表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  // 回溯还原 diff 路径
  const lines: DiffLine[] = []
  let i = n
  let j = m

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      lines.unshift({ type: 'unchanged', oldNum: i, newNum: j, text: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.unshift({ type: 'added', newNum: j, text: newLines[j - 1] })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      lines.unshift({ type: 'removed', oldNum: i, text: oldLines[i - 1] })
      i--
    }
  }

  const additions = lines.filter((l) => l.type === 'added').length
  const deletions = lines.filter((l) => l.type === 'removed').length

  return { lines, additions, deletions }
}
