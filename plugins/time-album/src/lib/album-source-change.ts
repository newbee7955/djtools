import type { AlbumSource } from './s3-types.ts'
import type { PersonProfile } from '../types/album.ts'

export interface AlbumSourceChangeActions {
  cancelPendingLoads: () => void
  resetClusterRuntime: () => void
  clearPeople: () => void
  clearPhotos: () => void
  clearFaceRecords: () => Promise<void>
  activateSource: (source: AlbumSource) => void
}

function isSameAlbumSource(current: AlbumSource, next: AlbumSource): boolean {
  if (current.type !== next.type) return false

  if (current.type === 'local' && next.type === 'local') {
    const p1 = current.path || ''
    const p2 = next.path || ''
    return p1 === p2 && p1 !== ''
  }

  if (current.type === 's3' && next.type === 's3') {
    return (
      current.profileId === next.profileId &&
      current.bucket === next.bucket &&
      (current.prefix || '') === (next.prefix || '')
    )
  }

  return false
}

export function reconcilePeopleForPhotos(
  people: PersonProfile[],
  currentPhotoIds: readonly string[]
): { people: PersonProfile[]; removedStaleSource: boolean } {
  if (people.length === 0 || currentPhotoIds.length === 0) {
    return { people, removedStaleSource: false }
  }

  const storedPhotoIds = people.flatMap((person) => person.photoIds)
  if (storedPhotoIds.length === 0) {
    return { people, removedStaleSource: false }
  }

  const currentPhotoIdSet = new Set(currentPhotoIds)
  const hasCurrentPhoto = storedPhotoIds.some((photoId) => currentPhotoIdSet.has(photoId))
  if (!hasCurrentPhoto) {
    return { people: [], removedStaleSource: true }
  }

  // Prune any photo IDs that do not exist in the current photo pool
  const cleanedPeople: PersonProfile[] = []
  for (const person of people) {
    if (person.photoIds.length === 0) {
      cleanedPeople.push(person)
      continue
    }
    const validPhotoIds = person.photoIds.filter((id) => currentPhotoIdSet.has(id))
    if (validPhotoIds.length > 0) {
      const p: PersonProfile = { ...person, photoIds: validPhotoIds }
      if (person.avatarPhotoId && !currentPhotoIdSet.has(person.avatarPhotoId)) {
        p.avatarPhotoId = validPhotoIds[0]
      }
      cleanedPeople.push(p)
    }
  }

  return { people: cleanedPeople, removedStaleSource: false }
}

/**
 * Atomically discard state whose photo IDs belong to the previous album source,
 * then activate the new source. Re-selecting the same source is a no-op.
 */
export async function switchAlbumSource(
  current: AlbumSource,
  next: AlbumSource,
  actions: AlbumSourceChangeActions
): Promise<boolean> {
  if (isSameAlbumSource(current, next)) return false

  actions.cancelPendingLoads()
  actions.resetClusterRuntime()
  actions.clearPeople()
  actions.clearPhotos()
  await actions.clearFaceRecords()
  actions.activateSource(next)
  return true
}
