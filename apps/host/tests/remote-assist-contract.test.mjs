import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseInputEvent,
  parseSignalEnvelope,
  canTransition,
  normalizePointer,
  formatDeviceCode,
  unformatDeviceCode,
  normalizeDeviceCode,
  isValidDeviceCode,
  normalizePermission,
  SIGNAL_ENVELOPE_TTL_MS,
  MAX_INPUT_PAYLOAD_BYTES
} from '../src/main/services/remote-assist/remote-assist-contract.ts'

test('formatDeviceCode: formats raw 9-digit code and unformat cleans whitespace', () => {
  assert.equal(formatDeviceCode('839201442'), '839 201 442')
  assert.equal(formatDeviceCode('839 201 442'), '839 201 442')
  assert.equal(unformatDeviceCode('839 201 442'), '839201442')
  assert.throws(() => formatDeviceCode('12345'), /9-digit/)
  assert.throws(() => formatDeviceCode('12345678a'), /9-digit/)
})

test('normalizePointer: clamps and rounds pointer coordinates within [0, 1]', () => {
  assert.deepEqual(normalizePointer(0.5, 0.25), { x: 0.5, y: 0.25 })
  assert.deepEqual(normalizePointer(-0.01, 1.05), { x: 0, y: 1 })
  assert.throws(() => normalizePointer(NaN, 0.5), /finite number/)
})

test('isValidDeviceCode / normalizeDeviceCode: only accept 9-digit codes', () => {
  assert.equal(isValidDeviceCode('839201442'), true)
  assert.equal(isValidDeviceCode('839 201 442'), true)
  assert.equal(isValidDeviceCode('<script>alert(1)</script>'), false)
  assert.equal(isValidDeviceCode('12345'), false)
  assert.equal(isValidDeviceCode(839201442), false)
  assert.equal(normalizeDeviceCode('839 201 442'), '839201442')
  assert.equal(normalizeDeviceCode(null), '')
})

test('normalizePermission: coerces arbitrary input into the view/control whitelist', () => {
  assert.equal(normalizePermission('view'), 'view')
  assert.equal(normalizePermission('control'), 'control')
  assert.equal(normalizePermission("'; require('x') //"), 'control')
  assert.equal(normalizePermission(undefined), 'control')
  assert.equal(normalizePermission({}), 'control')
})

test('parseInputEvent: accepts valid pointer-move and rejects out-of-range / invalid coordinates', () => {
  const valid = {
    type: 'pointer-move',
    sessionId: 's_123',
    seq: 8,
    x: 0.25,
    y: 0.75
  }
  assert.deepEqual(parseInputEvent(valid), valid)

  assert.throws(
    () => parseInputEvent({ type: 'pointer-move', sessionId: 's_123', seq: 9, x: 1.1, y: 0.5 }),
    /normalized coordinates/
  )
  assert.throws(
    () => parseInputEvent({ type: 'pointer-move', sessionId: 's_123', seq: -1, x: 0.5, y: 0.5 }),
    /non-negative integer/
  )
})

test('parseInputEvent: accepts pointer-button, wheel, and key events', () => {
  assert.deepEqual(
    parseInputEvent({ type: 'pointer-button', sessionId: 's_1', seq: 10, button: 'left', pressed: true }),
    { type: 'pointer-button', sessionId: 's_1', seq: 10, button: 'left', pressed: true }
  )

  assert.deepEqual(
    parseInputEvent({ type: 'wheel', sessionId: 's_1', seq: 11, deltaX: 0, deltaY: 120 }),
    { type: 'wheel', sessionId: 's_1', seq: 11, deltaX: 0, deltaY: 120 }
  )

  assert.deepEqual(
    parseInputEvent({
      type: 'key',
      sessionId: 's_1',
      seq: 12,
      code: 'KeyA',
      pressed: true,
      modifiers: ['Control']
    }),
    {
      type: 'key',
      sessionId: 's_1',
      seq: 12,
      code: 'KeyA',
      pressed: true,
      modifiers: ['Control']
    }
  )

  assert.throws(
    () => parseInputEvent({ type: 'pointer-button', sessionId: 's_1', seq: 1, button: 'invalid', pressed: true }),
    /button/
  )
})

test('parseInputEvent: rejects oversized payloads', () => {
  const hugeModifiers = new Array(500).fill('ModifierLongNamePadding1234567890')
  assert.throws(
    () => parseInputEvent({
      type: 'key',
      sessionId: 's_1',
      seq: 13,
      code: 'KeyB',
      pressed: true,
      modifiers: hugeModifiers
    }),
    /payload size/
  )
})

test('canTransition: validates session lifecycle state transitions', () => {
  assert.equal(canTransition('idle', 'requesting'), true)
  assert.equal(canTransition('idle', 'awaiting-consent'), true)
  assert.equal(canTransition('idle', 'connected'), false)

  assert.equal(canTransition('requesting', 'connecting'), true)
  assert.equal(canTransition('requesting', 'idle'), true)
  assert.equal(canTransition('requesting', 'connected'), false)

  assert.equal(canTransition('awaiting-consent', 'connecting'), true)
  assert.equal(canTransition('awaiting-consent', 'idle'), true)

  assert.equal(canTransition('connecting', 'connected'), true)
  assert.equal(canTransition('connecting', 'disconnecting'), true)
  assert.equal(canTransition('connecting', 'idle'), true)

  assert.equal(canTransition('connected', 'disconnecting'), true)
  assert.equal(canTransition('connected', 'idle'), true)
  assert.equal(canTransition('connected', 'requesting'), false)

  assert.equal(canTransition('disconnecting', 'idle'), true)
  assert.equal(canTransition('disconnecting', 'connected'), false)
})

test('parseSignalEnvelope: validates v1 protocol envelope and expiration', () => {
  const now = 1700000000000
  const validEnvelope = {
    v: 1,
    type: 'session-request',
    from: '839201442',
    to: '123456789',
    timestamp: now - 10000,
    payload: { permission: 'control', safetyCode: '123456' }
  }

  assert.deepEqual(parseSignalEnvelope(validEnvelope, now), validEnvelope)

  // Expired (> 600s)
  assert.throws(
    () => parseSignalEnvelope({ ...validEnvelope, timestamp: now - 601000 }, now),
    /expired/
  )

  // Far future (> 300s)
  assert.throws(
    () => parseSignalEnvelope({ ...validEnvelope, timestamp: now + 305000 }, now),
    /future/
  )

  // Invalid protocol version
  assert.throws(
    () => parseSignalEnvelope({ ...validEnvelope, v: 2 }, now),
    /version/
  )
})
