import { PersonProfile } from '../types/album'

const PEOPLE_STORAGE_KEY = 'doujiao_album_people_v1'
const PHOTO_USER_TAGS_KEY = 'doujiao_album_user_tags_v1'

/**
 * Load all people profiles from persistent storage
 */
export function getStoredPeople(): PersonProfile[] {
  try {
    const raw = localStorage.getItem(PEOPLE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('Failed to load people profiles:', err)
    return []
  }
}

/**
 * Save all people profiles
 */
export function saveAllPeople(people: PersonProfile[]): void {
  try {
    localStorage.setItem(PEOPLE_STORAGE_KEY, JSON.stringify(people))
  } catch (err) {
    console.error('Failed to save people profiles:', err)
  }
}

/**
 * Create a new PersonProfile
 */
export function createPerson(name: string, initialPhotoIds: string[] = []): PersonProfile {
  const people = getStoredPeople()
  const trimmedName = name.trim() || `人物 ${people.length + 1}`
  const now = Date.now()

  const newPerson: PersonProfile = {
    id: `person_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    avatarPhotoId: initialPhotoIds[0] || undefined,
    photoIds: Array.from(new Set(initialPhotoIds)),
    createdAt: now,
    updatedAt: now
  }

  people.push(newPerson)
  saveAllPeople(people)
  return newPerson
}

/**
 * Rename a Person
 */
export function renamePerson(personId: string, newName: string): boolean {
  const people = getStoredPeople()
  const p = people.find((item) => item.id === personId)
  if (!p) return false
  p.name = newName.trim() || p.name
  p.updatedAt = Date.now()
  saveAllPeople(people)
  return true
}

/**
 * Set avatar photo for a Person
 */
export function setPersonAvatar(personId: string, photoId: string): boolean {
  const people = getStoredPeople()
  const p = people.find((item) => item.id === personId)
  if (!p) return false
  p.avatarPhotoId = photoId
  p.updatedAt = Date.now()
  saveAllPeople(people)
  return true
}

/**
 * Delete a PersonProfile
 */
export function deletePerson(personId: string): boolean {
  const people = getStoredPeople()
  const filtered = people.filter((item) => item.id !== personId)
  if (filtered.length === people.length) return false
  saveAllPeople(filtered)
  return true
}

/**
 * Add photo to a Person
 */
export function addPhotoToPerson(personId: string, photoId: string): boolean {
  const people = getStoredPeople()
  const p = people.find((item) => item.id === personId)
  if (!p) return false
  if (!p.photoIds.includes(photoId)) {
    p.photoIds.push(photoId)
    if (!p.avatarPhotoId) {
      p.avatarPhotoId = photoId
    }
    p.updatedAt = Date.now()
    saveAllPeople(people)
  }
  return true
}

/**
 * Remove photo from a Person
 */
export function removePhotoFromPerson(personId: string, photoId: string): boolean {
  const people = getStoredPeople()
  const p = people.find((item) => item.id === personId)
  if (!p) return false
  const idx = p.photoIds.indexOf(photoId)
  if (idx !== -1) {
    p.photoIds.splice(idx, 1)
    if (p.avatarPhotoId === photoId) {
      p.avatarPhotoId = p.photoIds[0] || undefined
    }
    p.updatedAt = Date.now()
    saveAllPeople(people)
  }
  return true
}

/**
 * Load all user-defined photo tags: mapping photoId -> string[]
 */
export function getStoredUserTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(PHOTO_USER_TAGS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) || {}
  } catch (err) {
    console.error('Failed to load photo tags:', err)
    return {}
  }
}

/**
 * Save user-defined tags
 */
export function saveAllUserTags(tagsMap: Record<string, string[]>): void {
  try {
    localStorage.setItem(PHOTO_USER_TAGS_KEY, JSON.stringify(tagsMap))
  } catch (err) {
    console.error('Failed to save user tags:', err)
  }
}

/**
 * Add custom tag to a photo
 */
export function addTagToPhoto(photoId: string, tag: string): string[] {
  const trimmed = tag.trim()
  if (!trimmed) return []
  const tagsMap = getStoredUserTags()
  const currentTags = tagsMap[photoId] || []
  if (!currentTags.includes(trimmed)) {
    currentTags.push(trimmed)
    tagsMap[photoId] = currentTags
    saveAllUserTags(tagsMap)
  }
  return currentTags
}

/**
 * Remove custom tag from a photo
 */
export function removeTagFromPhoto(photoId: string, tag: string): string[] {
  const tagsMap = getStoredUserTags()
  const currentTags = tagsMap[photoId] || []
  const filtered = currentTags.filter((t) => t !== tag)
  tagsMap[photoId] = filtered
  saveAllUserTags(tagsMap)
  return filtered
}
