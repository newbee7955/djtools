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

export interface StorageObjectItem {
  name: string // 显示名称 (例如 "photo.jpg" 或 "documents")
  key: string // 对象完整路径 (例如 "2026/09/photo.jpg" 或 "documents/")
  isDirectory: boolean
  size: number
  lastModified?: string
  etag?: string
  storageClass?: string
  extension: string
}

export interface UploadTask {
  id: string
  fileName: string
  key: string
  size: number
  progress: number // 0 ~ 100
  status: 'uploading' | 'completed' | 'failed'
  error?: string
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
    icon: '🟧',
    defaultEndpoint: 's3.amazonaws.com',
    defaultRegion: 'us-east-1',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 's3.amazonaws.com 或 s3.ap-northeast-1.amazonaws.com',
    note: '亚马逊 AWS 官方标准 S3 服务'
  },
  minio: {
    provider: 'minio',
    name: 'MinIO (私有化)',
    icon: '🔴',
    defaultEndpoint: 'localhost:9000',
    defaultRegion: 'us-east-1',
    pathStyle: true,
    useSSL: false,
    placeholderEndpoint: '192.168.1.100:9000 或 localhost:9000',
    note: '私有化部署开源对象存储，通常使用 Path-Style 与 HTTP 端口'
  },
  oss: {
    provider: 'oss',
    name: '阿里云 OSS (S3兼容)',
    icon: '🔶',
    defaultEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
    defaultRegion: 'cn-hangzhou',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 'oss-cn-hangzhou.aliyuncs.com',
    note: '阿里云 OSS 原生支持 AWS S3 兼容接入，需配置正确的地域 Endpoint'
  },
  cos: {
    provider: 'cos',
    name: '腾讯云 COS (S3兼容)',
    icon: '🔷',
    defaultEndpoint: 'cos.ap-guangzhou.myqcloud.com',
    defaultRegion: 'ap-guangzhou',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: 'cos.ap-guangzhou.myqcloud.com',
    note: '腾讯云对象存储，全面兼容 S3 REST API'
  },
  r2: {
    provider: 'r2',
    name: 'Cloudflare R2',
    icon: '⚡',
    defaultEndpoint: '<ACCOUNT_ID>.r2.cloudflarestorage.com',
    defaultRegion: 'auto',
    pathStyle: false,
    useSSL: true,
    placeholderEndpoint: '<ACCOUNT_ID>.r2.cloudflarestorage.com',
    note: 'Cloudflare R2 免出口流量费对象存储'
  },
  custom: {
    provider: 'custom',
    name: '自定义 S3 兼容',
    icon: '🪣',
    defaultEndpoint: '',
    defaultRegion: 'us-east-1',
    pathStyle: true,
    useSSL: true,
    placeholderEndpoint: 'example.com:9000',
    note: '七牛云、华为云 OBS、Ceph 等任意标准 S3 兼容存储'
  }
}
