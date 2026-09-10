import type { StorageProfile } from './types'

const STORAGE_KEY_PROFILES = 'doujiao_obj_storage_profiles_v1'
const STORAGE_KEY_ACTIVE_PROFILE = 'doujiao_obj_storage_active_profile_v1'
const STORAGE_KEY_LAST_BUCKET_PREFIX = 'doujiao_obj_storage_last_bucket_'

export function getStoredProfiles(): StorageProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES)
    if (!raw) return []
    return JSON.parse(raw) as StorageProfile[]
  } catch (err) {
    console.error('[Storage] 获取配置列表失败:', err)
    return []
  }
}

export function saveStoredProfiles(profiles: StorageProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles))
  } catch (err) {
    console.error('[Storage] 保存配置列表失败:', err)
  }
}

export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_PROFILE)
  } catch {
    return null
  }
}

export function setActiveProfileId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE, id)
  } catch {}
}

export function getLastBucketForProfile(profileId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_BUCKET_PREFIX + profileId)
  } catch {
    return null
  }
}

export function setLastBucketForProfile(profileId: string, bucket: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_BUCKET_PREFIX + profileId, bucket)
  } catch {}
}
