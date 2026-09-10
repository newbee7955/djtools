export interface PhotoExif {
  cameraMake?: string
  cameraModel?: string
  lensModel?: string
  focalLength?: string
  aperture?: string
  shutterSpeed?: string
  iso?: number
  dateTimeOriginal?: string
  width?: number
  height?: number
  software?: string
}

export interface PhotoItem {
  id: string
  name: string
  relativePath: string
  size: number
  updatedAt: number
  dataUrl?: string
  thumbnailUrl?: string
  date: Date
  dateStr: string // "YYYY-MM-DD"
  year: number
  month: number
  day: number
  exif?: PhotoExif
  tags?: string[]
  userTags?: string[]
  aiTags?: string[]
  peopleIds?: string[]
  aiScene?: string
}

export interface PersonProfile {
  id: string
  name: string
  avatarPhotoId?: string
  photoIds: string[]
  createdAt: number
  updatedAt: number
}

export interface DateGroup {
  dateStr: string
  label: string
  photos: PhotoItem[]
}

export interface MonthGroup {
  monthStr: string // "YYYY-MM"
  label: string
  count: number
  dateGroups: DateGroup[]
}

export interface OnThisDayMemory {
  yearsAgo: number
  year: number
  dateStr: string
  label: string
  photos: PhotoItem[]
}

export type GridSize = 'small' | 'medium' | 'large'
export type AlbumViewMode = 'timeline' | 'people'
