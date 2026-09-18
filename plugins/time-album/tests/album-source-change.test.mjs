import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceChangeModule = await import('../src/lib/album-source-change.ts').catch(() => ({}))
const switchAlbumSource = sourceChangeModule.switchAlbumSource
const reconcilePeopleForPhotos = sourceChangeModule.reconcilePeopleForPhotos

test('switching to a different album source clears source-bound state before activation', async () => {
  assert.equal(
    typeof switchAlbumSource,
    'function',
    'album source switching must provide one reset-and-activate operation'
  )

  const calls = []
  const previousSource = { type: 'local', path: 'D:\\old-photos' }
  const nextSource = {
    type: 's3',
    profileId: 'profile-1',
    bucket: 'new-photos',
    prefix: 'album/'
  }

  const changed = await switchAlbumSource(previousSource, nextSource, {
    cancelPendingLoads: () => calls.push('cancel-loads'),
    resetClusterRuntime: () => calls.push('reset-cluster'),
    clearPeople: () => calls.push('clear-people'),
    clearPhotos: () => calls.push('clear-photos'),
    clearFaceRecords: async () => calls.push('clear-face-records'),
    activateSource: (source) => calls.push(`activate:${source.bucket}`)
  })

  assert.equal(changed, true)
  assert.deepEqual(calls, [
    'cancel-loads',
    'reset-cluster',
    'clear-people',
    'clear-photos',
    'clear-face-records',
    'activate:new-photos'
  ])
})

test('selecting the active album source does not erase its classifications', async () => {
  assert.equal(
    typeof switchAlbumSource,
    'function',
    'album source switching must provide one reset-and-activate operation'
  )

  const calls = []
  const source = {
    type: 's3',
    profileId: 'profile-1',
    bucket: 'photos',
    prefix: 'album/'
  }

  const changed = await switchAlbumSource(source, { ...source }, {
    cancelPendingLoads: () => calls.push('cancel-loads'),
    resetClusterRuntime: () => calls.push('reset-cluster'),
    clearPeople: () => calls.push('clear-people'),
    clearPhotos: () => calls.push('clear-photos'),
    clearFaceRecords: async () => calls.push('clear-face-records'),
    activateSource: () => calls.push('activate')
  })

  assert.equal(changed, false)
  assert.deepEqual(calls, [])
})

test('source changes invalidate in-flight clustering work', async () => {
  const serviceSource = await readFile(
    new URL('../src/lib/idle-cluster-service.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    serviceSource,
    /public resetForSourceChange\(\): void/,
    'the clustering singleton must expose a source-change reset'
  )
  assert.match(
    serviceSource,
    /this\.sourceGeneration\+\+/,
    'the reset must invalidate work captured for the previous source'
  )
})

test('stored classifications with no photos in the current source are identified as stale', () => {
  assert.equal(
    typeof reconcilePeopleForPhotos,
    'function',
    'album loading must be able to repair classifications left by an earlier source'
  )

  const stalePeople = [
    {
      id: 'person-1',
      name: '人物 1',
      photoIds: ['old/a.jpg', 'old/b.jpg'],
      createdAt: 1,
      updatedAt: 1
    }
  ]

  assert.deepEqual(reconcilePeopleForPhotos(stalePeople, ['new/a.jpg', 'new/b.jpg']), {
    people: [],
    removedStaleSource: true
  })
})

test('stored classifications are preserved when they contain a current photo', () => {
  assert.equal(typeof reconcilePeopleForPhotos, 'function')

  const currentPeople = [
    {
      id: 'person-1',
      name: '人物 1',
      photoIds: ['album/a.jpg'],
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: 'person-empty',
      name: '待整理',
      photoIds: [],
      createdAt: 2,
      updatedAt: 2
    }
  ]

  assert.deepEqual(reconcilePeopleForPhotos(currentPeople, ['album/a.jpg']), {
    people: currentPeople,
    removedStaleSource: false
  })
})

test('orphan photo IDs are pruned and dead people with only vanished photos are removed', () => {
  const people = [
    {
      id: 'person-1',
      name: '小明',
      avatarPhotoId: 'old/deleted.jpg',
      photoIds: ['old/deleted.jpg', 'album/live.jpg'],
      createdAt: 1,
      updatedAt: 1
    },
    {
      id: 'person-dead',
      name: '旧相册人物',
      photoIds: ['foreign/a.jpg', 'foreign/b.jpg'],
      createdAt: 2,
      updatedAt: 2
    }
  ]

  const result = reconcilePeopleForPhotos(people, ['album/live.jpg', 'album/other.jpg'])
  assert.equal(result.removedStaleSource, false)
  assert.equal(result.people.length, 1)
  assert.equal(result.people[0].id, 'person-1')
  assert.deepEqual(result.people[0].photoIds, ['album/live.jpg'])
  assert.equal(result.people[0].avatarPhotoId, 'album/live.jpg')
})

