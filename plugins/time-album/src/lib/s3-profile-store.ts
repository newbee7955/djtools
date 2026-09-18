import type { AlbumSource, StorageProfile } from './s3-types'

const STORAGE_KEY_PROFILES = 'doujiao_album_s3_profiles_v1'
const STORAGE_KEY_ACTIVE_SOURCE = 'doujiao_album_active_source_v1'

export function getStoredS3Profiles(): StorageProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES)
    if (!raw) return []
    return JSON.parse(raw) as StorageProfile[]
  } catch (err) {
    console.error('[TimeAlbum] 获取 S3 配置列表失败:', err)
    return []
  }
}

export function saveStoredS3Profiles(profiles: StorageProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles))
  } catch (err) {
    console.error('[TimeAlbum] 保存 S3 配置列表失败:', err)
  }
}

export function upsertS3Profile(profile: StorageProfile): StorageProfile[] {
  const list = getStoredS3Profiles()
  const idx = list.findIndex((p) => p.id === profile.id)
  if (idx >= 0) {
    list[idx] = profile
  } else {
    list.unshift(profile)
  }
  saveStoredS3Profiles(list)
  return list
}

export function deleteS3Profile(profileId: string): StorageProfile[] {
  const list = getStoredS3Profiles().filter((p) => p.id !== profileId)
  saveStoredS3Profiles(list)
  return list
}

export function getActiveAlbumSource(): AlbumSource {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_SOURCE)
    if (!raw) return { type: 'local', path: '' }
    const parsed = JSON.parse(raw)
    if (parsed && (parsed.type === 'local' || parsed.type === 's3')) {
      return parsed as AlbumSource
    }
  } catch {}
  return { type: 'local', path: '' }
}

export function saveActiveAlbumSource(source: AlbumSource): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_SOURCE, JSON.stringify(source))
  } catch (err) {
    console.error('[TimeAlbum] 保存相册存储源失败:', err)
  }
}
