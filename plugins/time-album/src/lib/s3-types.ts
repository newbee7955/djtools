export type ProviderType = 's3' | 'oss' | 'cos' | 'minio' | 'r2' | 'custom'

export interface StorageProfile {
  id: string
  name: string
  provider: ProviderType
  endpoint: string // e.g. s3.ap-northeast-1.amazonaws.com, http://192.168.1.100:9000, oss-cn-hangzhou.aliyuncs.com
  region: string // e.g. us-east-1, cn-hangzhou, ap-guangzhou, auto
  accessKeyId: string
  secretAccessKey: string
  defaultBucket?: string
  pathStyle?: boolean // MinIO 通常为 true，标准 AWS 为 false
  customDomain?: string // 可选自定义 CDN 域名，如 https://cdn.example.com
  useSSL?: boolean // 默认 true (http 协议为 false)
  createdAt: number
  lastUsedAt?: number
}

export interface BucketItem {
  name: string
  creationDate?: string
}

export interface S3ObjectItem {
  name: string
  key: string
  isDirectory: boolean
  size: number
  lastModified?: string
  etag?: string
  extension: string
}

export interface ProviderPreset {
  provider: ProviderType
  name: string
  icon: string
  defaultEndpoint: string
  defaultRegion: string
  pathStyle: boolean
  useSSL: boolean
  placeholderEndpoint: string
  note: string
}

export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  s3: {
    provider: 's3',
    name: 'AWS S3',
    icon: '📦',
    defaultEndpoint: 's3.us-east-1.amazonaws.com',
    defaultRegion: 'us-east-1',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 's3.{region}.amazonaws.com',
    note: '全球标准 S3，需在 AWS IAM 创建具有 S3 权限的 AccessKey'
  },
  oss: {
    provider: 'oss',
    name: '阿里云 OSS',
    icon: '☁️',
    defaultEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
    defaultRegion: 'cn-hangzhou',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 'oss-{region}.aliyuncs.com',
    note: '需在阿里云 RAM 控制台创建 AccessKey'
  },
  cos: {
    provider: 'cos',
    name: '腾讯云 COS',
    icon: '🐧',
    defaultEndpoint: 'cos.ap-guangzhou.myqcloud.com',
    defaultRegion: 'ap-guangzhou',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 'cos.{region}.myqcloud.com',
    note: '需在腾讯云访问管理获取 SecretId / SecretKey'
  },
  minio: {
    provider: 'minio',
    name: '私有 MinIO',
    icon: '🦩',
    defaultEndpoint: 'http://127.0.0.1:9000',
    defaultRegion: 'us-east-1',
    pathStyle: true,
    useSSL: false,
    placeholderEndpoint: 'http://192.168.x.x:9000',
    note: '家庭 NAS 或私有服务器部署的开源对象存储，需开启 Path-Style'
  },
  r2: {
    provider: 'r2',
    name: 'Cloudflare R2',
    icon: '⚡',
    defaultEndpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    defaultRegion: 'auto',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    note: 'Cloudflare 零出网流量费对象存储，Region 填 auto'
  },
  custom: {
    provider: 'custom',
    name: '自定义 S3 API',
    icon: '⚙️',
    defaultEndpoint: '',
    defaultRegion: 'us-east-1',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: '兼容 S3 协议的 API 地址',
    note: 'Ceph、RustFS、SeaweedFS 等任何兼容 AWS S3 协议的存储系统'
  }
}

/**
 * 相册存储源抽象
 */
export type AlbumSourceType = 'local' | 's3'

export interface LocalAlbumSource {
  type: 'local'
  path: string
}

export interface S3AlbumSource {
  type: 's3'
  profileId: string
  bucket: string
  prefix: string // 例如 "photos/" 或 ""
}

export type AlbumSource = LocalAlbumSource | S3AlbumSource
