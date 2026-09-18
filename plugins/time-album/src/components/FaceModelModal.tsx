import React, { useState, useEffect } from 'react'
import {
  isFaceModelReady,
  downloadFaceModels,
  clearFaceModelCache,
  TOTAL_MODEL_BYTES
} from '../lib/face-model-storage'
import {
  detectFacesInImage,
  loadFaceApiModels,
  clusterFaces,
  PhotoFaceRecord
} from '../lib/face-recognition'
import { getThumbnail } from '../lib/thumbnail-cache'
import { PersonProfile, PhotoItem } from '../types/album'
import { createPerson } from '../lib/people-store'
import {
  getCachedPhotoFace,
  savePhotoFaces
} from '../lib/face-cache-store'

interface FaceModelModalProps {
  photos: PhotoItem[]
  existingPeople: PersonProfile[]
  onClose: () => void
  onUpdatePeople: (people: PersonProfile[]) => void
  onToast: (msg: string) => void
}

export const FaceModelModal: React.FC<FaceModelModalProps> = ({
  photos,
  existingPeople,
  onClose,
  onUpdatePeople,
  onToast
}) => {
  const [isReady, setIsReady] = useState<boolean | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    loadedBytes: number
    totalBytes: number
    percentage: number
    currentFileName: string
  } | null>(null)

  // Clustering state
  const [isClustering, setIsClustering] = useState(false)
  const [clusteringProgress, setClusteringProgress] = useState<{
    processed: number
    total: number
    facesFound: number
    statusText?: string
  } | null>(null)

  // Check initial ready state
  useEffect(() => {
    isFaceModelReady().then(setIsReady)
  }, [])

  // Handle download
  const handleStartDownload = async () => {
    setIsDownloading(true)
    setDownloadProgress({
      loadedBytes: 0,
      totalBytes: TOTAL_MODEL_BYTES,
      percentage: 0,
      currentFileName: '正在连接模型镜像源...'
    })

    try {
      await downloadFaceModels((info) => {
        setDownloadProgress(info)
      })
      setIsReady(true)
      setIsDownloading(false)
      setDownloadProgress(null)
      onToast('✨ 端侧离线人脸识别模型下载成功，已就绪！')
    } catch (err: any) {
      console.error('Download error:', err)
      setIsDownloading(false)
      setDownloadProgress(null)
      alert(err.message || '模型下载失败，请检查网络后重试')
    }
  }

  // Handle clear cache
  const handleClearCache = async () => {
    if (window.confirm('确定要清除本地缓存的人脸识别模型吗？（将释放约 6.6MB 存储空间）')) {
      await clearFaceModelCache()
      setIsReady(false)
      onToast('已清除离线模型缓存')
    }
  }

  // Handle automatic face clustering
  const handleStartClustering = async () => {
    if (photos.length === 0) {
      alert('当前相册没有照片可供聚类')
      return
    }

    setIsClustering(true)
    setClusteringProgress({
      processed: 0,
      total: photos.length,
      facesFound: 0,
      statusText: '正在装载端侧离线神经网络模型...'
    })

    try {
      // Ensure model is loaded first; if this fails, error will be clearly shown
      await loadFaceApiModels()
    } catch (err: any) {
      setIsClustering(false)
      setClusteringProgress(null)
      console.error('Failed to load face models:', err)
      alert(`人脸识别模型加载失败: ${err.message || err}。请尝试重新下载模型。`)
      return
    }

    setClusteringProgress({
      processed: 0,
      total: photos.length,
      facesFound: 0,
      statusText: '模型装载完毕，正在准备扫描照片...'
    })

    const faceRecords: PhotoFaceRecord[] = []
    let facesCount = 0
    const sdk = (window as any).doujiaoSDK || null

    // Process photos sequentially
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i]

      setClusteringProgress({
        processed: i,
        total: photos.length,
        facesFound: facesCount,
        statusText: `正在扫描 (${i + 1}/${photos.length}): ${p.name}`
      })

      // Allow UI thread to breathe and render the progress bar
      await new Promise((r) => setTimeout(r, 16))

      // 优先从 IndexedDB 缓存读取已分析过的人脸特征
      const cached = await getCachedPhotoFace(p.id)
      if (cached) {
        for (const f of cached.faces) {
          facesCount++
          faceRecords.push({
            photoId: p.id,
            descriptor: new Float32Array(f.descriptor),
            score: f.score
          })
        }
      } else {
        let imgUrl = p.thumbnailUrl || p.dataUrl

        if (!imgUrl) {
          imgUrl = (await getThumbnail(p.relativePath)) || undefined
        }
        if (!imgUrl && sdk?.workspace) {
          try {
            imgUrl = (await sdk.workspace.readFile(p.relativePath, 'time-album')) || undefined
          } catch {}
        }

        if (imgUrl) {
          try {
            const faces = await detectFacesInImage(imgUrl)
            await savePhotoFaces(p.id, faces)
            for (const f of faces) {
              facesCount++
              faceRecords.push({
                photoId: p.id,
                descriptor: f.descriptor,
                score: f.score
              })
            }
          } catch (e) {
            console.warn('Face detect error for photo:', p.name, e)
            await savePhotoFaces(p.id, [])
          }
        } else {
          await savePhotoFaces(p.id, [])
        }
      }

      setClusteringProgress({
        processed: i + 1,
        total: photos.length,
        facesFound: facesCount,
        statusText: `已扫描 ${i + 1} / ${photos.length} 张，识别到 ${facesCount} 处面孔`
      })
    }

    if (faceRecords.length === 0) {
      setIsClustering(false)
      setClusteringProgress(null)
      alert('未在相册照片中检测到清晰人脸。可能原因：照片中无人脸或面部较小/模糊。')
      return
    }

    setClusteringProgress({
      processed: photos.length,
      total: photos.length,
      facesFound: facesCount,
      statusText: `正在分析 ${facesCount} 处人脸特征向量并自动聚类...`
    })
    await new Promise((r) => setTimeout(r, 50))

    // Cluster faces using greedy leader-follower Euclidean distance (0.56)
    const clusters = clusterFaces(faceRecords, 0.56)

    // Filter clusters with at least 1 photo
    const newPeopleList = [...existingPeople]
    let newCreatedCount = 0

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      const defaultName = `人物 ${newPeopleList.length + 1}`
      const newPerson = createPerson(defaultName, c.photoIds)
      newPerson.avatarPhotoId = c.representativePhotoId
      newPeopleList.push(newPerson)
      newCreatedCount++
    }

    onUpdatePeople(newPeopleList)
    setIsClustering(false)
    setClusteringProgress(null)
    onToast(`🎉 人脸聚类完成！已自动归纳出 ${newCreatedCount} 位人物（识别到 ${facesCount} 处人脸）`)
    onClose()
  }

  const formatMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-slate-900 dark:text-white animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-2xl shadow-xs">
              🤖
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                端侧离线人脸识别与聚类模型
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                高精度人脸 128D 特征向量提取 • 全自动人物聚类归整
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDownloading || isClustering}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 text-xs transition-colors disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Privacy & Architecture Note */}
        <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs space-y-1.5 text-slate-700 dark:text-slate-300">
          <div className="font-semibold text-indigo-700 dark:text-white flex items-center gap-1.5">
            <span>🔒</span>
            <span>100% 本地离线运行与隐私承诺</span>
          </div>
          <p>
            模型文件仅需从官方镜像下载一次（约 6.6MB），将永久缓存在您的本地浏览器 IndexedDB 数据库中。
          </p>
          <p>
            模型加载后所有面孔提取、特征相似度比对均在您的设备内完成，<strong>绝无任何照片、面部数据外流</strong>。
          </p>
        </div>

        {/* Status Card & Action Area */}
        {isReady === null ? (
          <div className="py-6 flex flex-col items-center justify-center gap-2 text-slate-400">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">正在检查本地模型缓存...</span>
          </div>
        ) : isClustering ? (
          /* Clustering in progress */
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-2 min-w-0 truncate">
                <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="truncate">{clusteringProgress?.statusText || '正在全自动扫描并聚类人脸...'}</span>
              </span>
              <span className="text-slate-500 dark:text-slate-400 font-mono shrink-0">
                {clusteringProgress?.processed} / {clusteringProgress?.total} 张
              </span>
            </div>

            <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-150 rounded-full"
                style={{
                  width: `${
                    clusteringProgress && clusteringProgress.total > 0
                      ? Math.round((clusteringProgress.processed / clusteringProgress.total) * 100)
                      : 0
                  }%`
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>已检测到人脸: <strong className="text-indigo-600 dark:text-indigo-400">{clusteringProgress?.facesFound ?? 0}</strong> 处</span>
              <span>
                {clusteringProgress && clusteringProgress.total > 0
                  ? Math.round((clusteringProgress.processed / clusteringProgress.total) * 100)
                  : 0}%
              </span>
            </div>
          </div>
        ) : isDownloading ? (
          /* Downloading in progress */
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">
                正在下载模型权重包: {downloadProgress?.percentage}%
              </span>
              <span className="text-slate-500 dark:text-slate-400 font-mono">
                {formatMB(downloadProgress?.loadedBytes || 0)} MB / {formatMB(downloadProgress?.totalBytes || 0)} MB
              </span>
            </div>

            <div className="h-2 w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${downloadProgress?.percentage || 0}%` }}
              />
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
              当前文件: {downloadProgress?.currentFileName}
            </p>
          </div>
        ) : isReady ? (
          /* Model is ready */
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">✅</span>
                <div>
                  <h4 className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    离线人脸识别模型已就绪
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    已保存在本地数据库中（6.57 MB），随时可离线使用
                  </p>
                </div>
              </div>
              <button
                onClick={handleClearCache}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="删除已下载的模型文件以释放存储空间"
              >
                清除缓存
              </button>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleStartClustering}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center justify-center gap-2 transition-all active:scale-98"
              >
                <span>⚡</span>
                <span>启动全自动人脸聚类 ({photos.length} 张照片)</span>
              </button>
            </div>
          </div>
        ) : (
          /* Not downloaded */
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-white">包含模型组件：</span>
                <span className="text-slate-500 dark:text-slate-400 font-mono">共 6.57 MB</span>
              </div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-400 text-[11px] list-disc list-inside">
                <li>TinyFaceDetector：轻量人脸检测网络（约 0.2 MB）</li>
                <li>FaceLandmark68Tiny：68 点面部特征定位网络（约 0.1 MB）</li>
                <li>FaceRecognitionNet：128 维人脸特征提取网络（约 6.3 MB）</li>
              </ul>
            </div>

            <button
              onClick={handleStartDownload}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center justify-center gap-2 transition-all active:scale-98"
            >
              <span>⬇️</span>
              <span>立即下载离线模型 (约 6.6 MB)</span>
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end">
          <button
            onClick={onClose}
            disabled={isDownloading || isClustering}
            className="px-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-transparent dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors disabled:opacity-40"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
