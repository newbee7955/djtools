import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const read = (relativeUrl) => readFile(new URL(relativeUrl, import.meta.url), 'utf8')

test('session window embedded script executes without ReferenceError in simulated WebRTC lifecycle', async () => {
  const runtime = await read('../src/main/container/remote-assist-session-runtime.js')

  for (const isCtrl of [true, false]) {
    const script = 'window.__RA_SESSION__ = ' + JSON.stringify({
      isController: isCtrl,
      permission: 'control',
      clipboardEnabled: true,
      iceMode: 'auto',
      iceServers: []
    }) + ';\n' + runtime

    const signalCallbacks = []
    const mockElement = {
      innerText: '',
      textContent: '',
      value: '',
      style: {},
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {},
      play: async () => {}
    }
    const mockDoc = {
      getElementById: () => mockElement,
      querySelector: () => mockElement,
      querySelectorAll: () => [],
      createElement: () => mockElement,
      body: mockElement,
      exitFullscreen: async () => {},
      fullscreenElement: null,
      addEventListener: () => {},
      removeEventListener: () => {}
    }

    let instancePC = null

    class MockRTCPeerConnection {
      constructor() {
        this.connectionState = 'new'
        this.iceConnectionState = 'new'
        this.localDescription = { type: isCtrl ? 'offer' : 'answer', sdp: 'v=0...' }
        this.remoteDescription = null
        this.onconnectionstatechange = null
        this.oniceconnectionstatechange = null
        this.onicecandidate = null
        this.ondatachannel = null
        instancePC = this
      }
      createDataChannel() {
        return {
          readyState: 'open',
          send: () => {},
          addEventListener: () => {},
          close: () => {}
        }
      }
      addTransceiver() { return {} }
      getTransceivers() { return [] }
      getSenders() { return [] }
      addTrack() {}
      setConfiguration() {}
      async setLocalDescription(desc) { this.localDescription = desc }
      async setRemoteDescription(desc) { this.remoteDescription = desc }
      async createOffer() { return { type: 'offer', sdp: 'mock-offer' } }
      async createAnswer() { return { type: 'answer', sdp: 'mock-answer' } }
      async addIceCandidate() {}
      async getStats() { return new Map() }
      close() {}
    }

    const sandbox = {
      window: {
        addEventListener: () => {},
        removeEventListener: () => {},
        remoteAssistSession: {
          onSignal: (cb) => { signalCallbacks.push(cb) },
          sendSignal: () => {},
          sendInput: () => {},
          disconnect: () => {},
          setConnected: () => {},
          reportStats: () => {},
          setRemoteCursorHidden: () => {},
          transfer: {
            onOutgoingChunk: () => () => {},
            sendIncomingChunk: () => {},
            notifyReady: () => {},
            notifyClosed: () => {},
            reportBackpressure: () => {},
            onClipboardApplied: () => () => {},
            onState: () => () => {},
            onChat: () => () => {},
            onProgress: () => () => {},
            onIncomingPrompt: () => () => {},
            onIncomingStart: () => () => {},
            onSpeedSample: () => () => {},
            onSummary: () => () => {},
            onCancelled: () => () => {},
            onError: () => () => {},
            requestSendFiles: () => {},
            sendChat: () => {},
            openReceiveFolder: () => {},
            respondIncoming: () => {},
            cancelTransfer: () => {},
            onPickResult: () => () => {}
          }
        }
      },
      document: mockDoc,
      navigator: {
        mediaDevices: {
          getDisplayMedia: async () => ({
            getVideoTracks: () => [{
              id: 'track-1',
              applyConstraints: async () => {},
              getSettings: () => ({ width: 1920, height: 1080 })
            }]
          })
        }
      },
      RTCPeerConnection: MockRTCPeerConnection,
      RTCRtpSender: { getCapabilities: () => ({ codecs: [] }) },
      RTCSessionDescription: function (d) { return d },
      RTCIceCandidate: function (c) { return c },
      MediaStream: function (tracks) { this.tracks = tracks },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: (fn) => setTimeout(fn, 1),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: () => 123,
      clearInterval: () => {},
      requestAnimationFrame: (fn) => setTimeout(fn, 1),
      cancelAnimationFrame: () => {},
      performance: { now: () => Date.now() },
      Date,
      Math,
      JSON,
      Array,
      Object,
      Map,
      Set,
      Promise,
      Error,
      Uint8Array
    }
    sandbox.window.document = mockDoc

    const context = vm.createContext(sandbox)
    assert.doesNotThrow(() => vm.runInContext(script, context), `Script execution failed for isController=${isCtrl}`)

    for (const cb of signalCallbacks) {
      if (!isCtrl) {
        await assert.doesNotReject(async () => {
          await cb({ type: 'offer', sdp: { type: 'offer', sdp: 'mock-offer' }, iceGeneration: 0, icePhase: 'direct' })
          await cb({ type: 'ice-candidate', candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1234 typ host' }, iceGeneration: 0 })
        }, 'Controlled peer failed to process offer/ice-candidate')
      } else {
        await assert.doesNotReject(async () => {
          await cb({ type: 'answer', sdp: { type: 'answer', sdp: 'mock-answer' }, iceGeneration: 0 })
          await cb({ type: 'ice-candidate', candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 1234 typ host' }, iceGeneration: 0 })
        }, 'Controller peer failed to process answer/ice-candidate')
      }
    }

    if (instancePC) {
      if (typeof instancePC.onconnectionstatechange === 'function') {
        instancePC.connectionState = 'connected'
        instancePC.iceConnectionState = 'connected'
        assert.doesNotThrow(() => instancePC.onconnectionstatechange(), 'pc.onconnectionstatechange connected failed')
        assert.match(mockElement.innerText, /正在识别链路/)

        const reports = new Map()
        reports.set('t', { type: 'transport', selectedCandidatePairId: 'p' })
        reports.set('p', {
          type: 'candidate-pair',
          selected: true,
          localCandidateId: 'l',
          remoteCandidateId: 'r',
          currentRoundTripTime: 0.048
        })
        reports.set('l', { candidateType: 'host' })
        reports.set('r', { candidateType: 'host' })
        reports.set('c', { type: 'codec', mimeType: 'video/H264', id: 'c' })
        reports.set('in', {
          type: 'inbound-rtp',
          kind: 'video',
          framesDecoded: 10,
          totalProcessingDelay: 0.12,
          framesPerSecond: 60,
          codecId: 'c'
        })
        instancePC.getStats = async () => reports
        const check = vm.runInContext('typeof checkConnectionMode === "function" ? checkConnectionMode : null', context)
        assert.equal(typeof check, 'function')
        await check()
        assert.match(mockElement.innerText, /P2P/)
        assert.doesNotMatch(mockElement.innerText, /正在识别链路/)
        assert.match(mockElement.innerText, /编码:/)
        assert.match(mockElement.innerText, /H264/)

        instancePC.connectionState = 'failed'
        assert.doesNotThrow(() => instancePC.onconnectionstatechange(), 'pc.onconnectionstatechange failed failed')
      }
      if (typeof instancePC.oniceconnectionstatechange === 'function') {
        instancePC.iceConnectionState = 'connected'
        assert.doesNotThrow(() => instancePC.oniceconnectionstatechange(), 'pc.oniceconnectionstatechange connected failed')
      }
    }
  }
})
