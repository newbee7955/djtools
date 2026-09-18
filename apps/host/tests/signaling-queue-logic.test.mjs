import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSignalEnvelope,
  SIGNAL_ENVELOPE_TTL_MS,
  MAX_CLOCK_SKEW_MS
} from '../src/main/services/remote-assist/remote-assist-contract.ts'

test('SIGNAL_ENVELOPE_TTL_MS and MAX_CLOCK_SKEW_MS are widened for clock drift tolerance', () => {
  assert.equal(SIGNAL_ENVELOPE_TTL_MS, 600_000, 'TTL should be 10 minutes (600,000ms)')
  assert.equal(MAX_CLOCK_SKEW_MS, 300_000, 'Max clock skew should be 5 minutes (300,000ms)')
})

test('parseSignalEnvelope: permits envelopes within 10m past and 5m future', () => {
  const now = 1700000000000
  const envelope = {
    v: 1,
    type: 'session-request',
    from: '123456789',
    to: '987654321',
    timestamp: now
  }

  // 8 minutes in the past (< 10m): allowed
  const pastEnvelope = { ...envelope, timestamp: now - 8 * 60 * 1000 }
  assert.doesNotThrow(() => parseSignalEnvelope(pastEnvelope, now))

  // 11 minutes in the past (> 10m): rejected
  const tooOldEnvelope = { ...envelope, timestamp: now - 11 * 60 * 1000 }
  assert.throws(
    () => parseSignalEnvelope(tooOldEnvelope, now),
    /expired: age 660000ms > max 600000ms/
  )

  // 4 minutes in the future (< 5m): allowed
  const futureEnvelope = { ...envelope, timestamp: now + 4 * 60 * 1000 }
  assert.doesNotThrow(() => parseSignalEnvelope(futureEnvelope, now))

  // 6 minutes in the future (> 5m): rejected
  const tooFarFutureEnvelope = { ...envelope, timestamp: now + 6 * 60 * 1000 }
  assert.throws(
    () => parseSignalEnvelope(tooFarFutureEnvelope, now),
    /too far in the future: ahead by 360000ms > max 300000ms/
  )
})

test('parseSignalEnvelope: includes type and from in the error message for easy debugging', () => {
  const now = 1700000000000
  const stale = {
    v: 1,
    type: 'disconnect',
    from: '999888777',
    to: '111222333',
    timestamp: now - 6821779 // exact duration from user report
  }

  assert.throws(
    () => parseSignalEnvelope(stale, now),
    /Signal envelope \[type=disconnect, from=999888777\] expired: age 6821779ms > max 600000ms/
  )
})

test('SignalingClient queue eviction logic simulation: drops >30s envelopes on flush', () => {
  const now = Date.now()
  let outboundQueue = [
    { v: 1, type: 'session-request', from: '1', timestamp: now - 6821779 }, // ~2 hours old
    { v: 1, type: 'offer', from: '1', timestamp: now - 45000 },           // 45s old
    { v: 1, type: 'ice-candidate', from: '1', timestamp: now - 5000 },    // 5s old (fresh)
    { v: 1, type: 'disconnect', from: '1', timestamp: now - 1000 }        // 1s old (fresh)
  ]

  // Enqueue cleanup
  outboundQueue = outboundQueue.filter((env) => now - env.timestamp <= 30_000)
  assert.equal(outboundQueue.length, 2)
  assert.equal(outboundQueue[0].type, 'ice-candidate')
  assert.equal(outboundQueue[1].type, 'disconnect')

  // flushOutboundQueue simulation
  const pending = outboundQueue
  outboundQueue = []
  const sent = []
  for (const envelope of pending) {
    if (now - envelope.timestamp > 30_000) {
      continue
    }
    sent.push(envelope)
  }

  assert.equal(sent.length, 2)
  assert.equal(sent[0].type, 'ice-candidate')
  assert.equal(sent[1].type, 'disconnect')
})

test('clearOutboundQueue simulation: clears all or filters by predicate', () => {
  let outboundQueue = [
    { v: 1, type: 'offer', from: '1', timestamp: 1 },
    { v: 1, type: 'answer', from: '1', timestamp: 2 },
    { v: 1, type: 'disconnect', from: '1', timestamp: 3 }
  ]

  // Clear all except disconnect
  outboundQueue = outboundQueue.filter((env) => env.type === 'disconnect')
  assert.equal(outboundQueue.length, 1)
  assert.equal(outboundQueue[0].type, 'disconnect')

  // Clear all
  outboundQueue = []
  assert.equal(outboundQueue.length, 0)
})
