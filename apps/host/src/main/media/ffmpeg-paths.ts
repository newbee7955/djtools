import path from 'node:path'

export interface FFmpegCandidateOptions {
  userDataDir: string
  appDataDir: string
  platform: NodeJS.Platform
  arch: string
  version?: string
}

export function buildFFmpegExecutableCandidates({
  userDataDir,
  appDataDir,
  platform,
  arch,
  version = '7.0.1'
}: FFmpegCandidateOptions): string[] {
  const executableName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const sharedRoots = [userDataDir, path.join(appDataDir, 'doujiao')]
  const candidates = sharedRoots.flatMap((root) => [
    path.join(root, 'bin', 'ffmpeg', version, `${platform}-${arch}`, executableName),
    path.join(root, 'bin', 'ffmpeg', executableName)
  ])

  return [...new Set(candidates)]
}
