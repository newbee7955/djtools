import test from 'node:test'
import assert from 'node:assert/strict'
import { InputSeqDedupe } from '../src/main/services/remote-assist/input-seq-dedupe.ts'

test('pointer-button and wheel duplicates are skipped, later seqs are kept', () => {
  const dedupe = new InputSeqDedupe(4)
  assert.equal(dedupe.isDuplicate('pointer-button', 1), false)
  assert.equal(dedupe.isDuplicate('pointer-button', 1), true)
  assert.equal(dedupe.isDuplicate('wheel', 2), false)
  assert.equal(dedupe.isDuplicate('wheel', 2), true)
  assert.equal(dedupe.isDuplicate('pointer-button', 3), false)
})

test('pointer-move and key events are never treated as duplicates', () => {
  const dedupe = new InputSeqDedupe()
  assert.equal(dedupe.isDuplicate('pointer-move', 9), false)
  assert.equal(dedupe.isDuplicate('pointer-move', 9), false)
  assert.equal(dedupe.isDuplicate('key', 10), false)
  assert.equal(dedupe.isDuplicate('key', 10), false)
})

test('oldest seqs fall out of the window and can be accepted again', () => {
  const dedupe = new InputSeqDedupe(2)
  assert.equal(dedupe.isDuplicate('pointer-button', 1), false)
  assert.equal(dedupe.isDuplicate('pointer-button', 2), false)
  assert.equal(dedupe.isDuplicate('pointer-button', 3), false)
  assert.equal(dedupe.isDuplicate('pointer-button', 1), false)
})

test('reset clears remembered seqs', () => {
  const dedupe = new InputSeqDedupe()
  assert.equal(dedupe.isDuplicate('pointer-button', 8), false)
  dedupe.reset()
  assert.equal(dedupe.isDuplicate('pointer-button', 8), false)
})
