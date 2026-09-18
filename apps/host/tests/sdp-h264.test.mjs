import test from 'node:test'
import assert from 'node:assert/strict'
import { preferH264InSdp } from '../src/main/services/remote-assist/sdp-h264.ts'

const sample = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 102 121',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=98',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:121 rtx/90000',
  'a=fmtp:121 apt=102',
  ''
].join('\r\n')

test('preferH264InSdp moves H264 and its RTX to the front of the video m-line', () => {
  const out = preferH264InSdp(sample)
  const videoLine = out.split('\r\n').find((line) => line.startsWith('m=video'))
  assert.equal(videoLine, 'm=video 9 UDP/TLS/RTP/SAVPF 102 121 96 97 98 99')
})

test('preferH264InSdp leaves audio m-line unchanged', () => {
  const out = preferH264InSdp(sample)
  const audioLine = out.split('\r\n').find((line) => line.startsWith('m=audio'))
  assert.equal(audioLine, 'm=audio 9 UDP/TLS/RTP/SAVPF 111')
})

test('preferH264InSdp is a no-op when H264 is absent', () => {
  const vp8Only = sample.replace(' 102 121', '').replace(/a=rtpmap:102[\s\S]*apt=102\r\n/, '')
  assert.equal(preferH264InSdp(vp8Only), vp8Only)
})
