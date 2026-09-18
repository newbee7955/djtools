import assert from 'node:assert/strict'
import test from 'node:test'

const pathModule = await import('../src/main/media/ffmpeg-paths.ts').catch(() => ({}))
const { buildFFmpegExecutableCandidates } = pathModule

test('development host discovers FFmpeg installed by the packaged app', () => {
  assert.equal(typeof buildFFmpegExecutableCandidates, 'function')

  const candidates = buildFFmpegExecutableCandidates({
    userDataDir: 'C:\\Users\\Admin\\AppData\\Roaming\\@doujiao\\host',
    appDataDir: 'C:\\Users\\Admin\\AppData\\Roaming',
    platform: 'win32',
    arch: 'x64'
  })

  assert.ok(
    candidates.includes(
      'C:\\Users\\Admin\\AppData\\Roaming\\doujiao\\bin\\ffmpeg\\7.0.1\\win32-x64\\ffmpeg.exe'
    )
  )
  assert.equal(new Set(candidates).size, candidates.length)
})
