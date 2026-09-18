import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const recordingCore = await import('../src/main/services/screen-recording-core.ts').catch(() => ({}))
const {
  buildGdiGrabArgs,
  buildMuxAudioVideoArgs,
  createRecordingPaths,
  normalizeRecordingBounds,
  normalizeRecordingOptions,
  toGlobalRecordingBounds
} = recordingCore

test('normalizes an odd selection to an even positive FFmpeg region', () => {
  assert.equal(typeof normalizeRecordingBounds, 'function')
  assert.deepEqual(normalizeRecordingBounds({ x: 11.6, y: 7.2, width: 801, height: 603 }), {
    x: 12,
    y: 7,
    width: 800,
    height: 602
  })
})

test('rejects an empty recording selection', () => {
  assert.equal(typeof normalizeRecordingBounds, 'function')
  assert.throws(
    () => normalizeRecordingBounds({ x: 0, y: 0, width: 1, height: 400 }),
    /录制区域至少需要 2×2 像素/
  )
})

test('clamps plugin recording options to host-owned safety limits', () => {
  assert.equal(typeof normalizeRecordingOptions, 'function')
  assert.deepEqual(
    normalizeRecordingOptions({
      mode: 'region',
      format: 'gif',
      fps: 120,
      showCursor: false,
      crf: -5,
      gifWidth: 9999,
      maxDurationSeconds: 500,
      recordSystemAudio: true,
      recordMicrophone: true,
      showToolbar: false
    }),
    {
      mode: 'region',
      format: 'gif',
      fps: 30,
      showCursor: false,
      crf: 0,
      gifWidth: 1920,
      maxDurationSeconds: 60,
      recordSystemAudio: false,
      recordMicrophone: false,
      showToolbar: false
    }
  )

  assert.deepEqual(
    normalizeRecordingOptions({
      format: 'mp4',
      recordSystemAudio: true,
      recordMicrophone: true
    }),
    {
      mode: 'region',
      format: 'mp4',
      fps: 24,
      showCursor: true,
      crf: 20,
      gifWidth: 720,
      maxDurationSeconds: undefined,
      recordSystemAudio: true,
      recordMicrophone: true,
      showToolbar: true
    }
  )
})

test('defaults recording duration to unlimited when no limit is provided', () => {
  assert.equal(typeof normalizeRecordingOptions, 'function')
  assert.equal(normalizeRecordingOptions({ format: 'mp4' }).maxDurationSeconds, undefined)
  assert.equal(normalizeRecordingOptions({ format: 'gif' }).maxDurationSeconds, undefined)
})

test('builds a bounded gdigrab command without caller supplied arguments', () => {
  assert.equal(typeof buildGdiGrabArgs, 'function')
  assert.deepEqual(
    buildGdiGrabArgs(
      { x: 10, y: 20, width: 800, height: 600 },
      {
        mode: 'region',
        format: 'mp4',
        fps: 24,
        showCursor: false,
        crf: 20,
        gifWidth: 720,
        maxDurationSeconds: 300
      },
      'D:\\captures\\recording.mp4'
    ),
    [
      '-y',
      '-f',
      'gdigrab',
      '-framerate',
      '24',
      '-offset_x',
      '10',
      '-offset_y',
      '20',
      '-video_size',
      '800x600',
      '-draw_mouse',
      '0',
      '-i',
      'desktop',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      'D:\\captures\\recording.mp4'
    ]
  )
})

test('creates a stable final path and a hidden temporary MP4 for GIF conversion', () => {
  assert.equal(typeof createRecordingPaths, 'function')
  assert.deepEqual(
    createRecordingPaths('D:\\captures', 'gif', new Date(2026, 8, 16, 1, 2, 3)),
    {
      finalPath: 'D:\\captures\\屏幕录制_20260916_010203.gif',
      recordingPath: 'D:\\captures\\.屏幕录制_20260916_010203.recording.mp4'
    }
  )
})

test('creates separate temporary video and audio paths when audio recording is enabled', () => {
  assert.equal(typeof createRecordingPaths, 'function')
  assert.deepEqual(
    createRecordingPaths('D:\\captures', 'mp4', new Date(2026, 8, 16, 1, 2, 3), true),
    {
      finalPath: 'D:\\captures\\屏幕录制_20260916_010203.mp4',
      recordingPath: 'D:\\captures\\.屏幕录制_20260916_010203.video.mp4',
      audioPath: 'D:\\captures\\.屏幕录制_20260916_010203.audio.webm'
    }
  )
})

test('builds audio and video mux arguments using copy video and aac audio', () => {
  assert.equal(typeof buildMuxAudioVideoArgs, 'function')
  assert.deepEqual(
    buildMuxAudioVideoArgs(
      'D:\\captures\\.video.mp4',
      'D:\\captures\\.audio.webm',
      'D:\\captures\\output.mp4'
    ),
    [
      '-y',
      '-i',
      'D:\\captures\\.video.mp4',
      '-i',
      'D:\\captures\\.audio.webm',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      'D:\\captures\\output.mp4'
    ]
  )
})

test('converts overlay-local bounds into global desktop coordinates', () => {
  assert.equal(typeof toGlobalRecordingBounds, 'function')
  assert.deepEqual(
    toGlobalRecordingBounds({ x: 30, y: 40, width: 500, height: 301 }, { x: -1920, y: 0 }),
    { x: -1890, y: 40, width: 500, height: 300 }
  )
})

test('screenshot selection mode returns bounds without clipboard side effects', async () => {
  const source = await readFile(
    new URL('../src/main/services/screenshot-service.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /public async selectRegion\(/)
  assert.match(source, /selectionOnly: true/)
  assert.match(source, /if \(!selectionOnly && dataUrl\)/)
  assert.match(source, /toGlobalRecordingBounds\(bounds/)
  assert.match(source, /dataUrl: selectionOnly \? undefined : dataUrl/)
})
