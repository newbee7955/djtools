import * as faceapi from '@vladmandic/face-api'
import { getModelFile, isFaceModelReady, FACE_MODEL_FILES } from './face-model-storage'

// Track loaded state
let isLoaded = false
let modelLoadPromise: Promise<boolean> | null = null

/**
 * Load weights of a NeuralNetwork directly from IndexedDB ArrayBuffers
 * using TensorFlow.js official weightsLoaderFactory (100% offline, zero network / DNS calls)
 */
async function loadNetFromIndexedDB(net: any, manifestFileName: string): Promise<void> {
  if (net.isLoaded) {
    return
  }

  const manifestBuffer = await getModelFile(manifestFileName)
  if (!manifestBuffer) {
    throw new Error(`离线模型配置文件缺失: ${manifestFileName}`)
  }

  const manifestText = new TextDecoder('utf-8').decode(manifestBuffer)
  const manifest = JSON.parse(manifestText)

  const weightsLoader = (faceapi.tf.io as any).weightsLoaderFactory(async (filePaths: string[]) => {
    return Promise.all(
      filePaths.map(async (fp: string) => {
        const basename = fp.split('/').pop() || fp
        const binBuffer = await getModelFile(basename)
        if (!binBuffer) {
          throw new Error(`离线模型权重文件缺失: ${basename}`)
        }
        return binBuffer
      })
    )
  })

  const weightMap = await weightsLoader(manifest, '')
  net.loadFromWeightMap(weightMap)
}

/**
 * Load face-api neural network weights directly from IndexedDB
 */
export async function loadFaceApiModels(): Promise<boolean> {
  if (
    isLoaded &&
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68TinyNet.isLoaded &&
    faceapi.nets.faceRecognitionNet.isLoaded
  ) {
    return true
  }

  if (modelLoadPromise) return modelLoadPromise

  modelLoadPromise = (async () => {
    const ready = await isFaceModelReady()
    if (!ready) {
      throw new Error('离线人脸识别模型尚未下载，请先点击下载模型文件')
    }

    console.log('[FaceAI] 正在装载 TinyFaceDetector 离线人脸检测模型...')
    await loadNetFromIndexedDB(
      faceapi.nets.tinyFaceDetector,
      'tiny_face_detector_model-weights_manifest.json'
    )

    console.log('[FaceAI] 正在装载 FaceLandmark68TinyNet 离线关键点模型...')
    await loadNetFromIndexedDB(
      faceapi.nets.faceLandmark68TinyNet,
      'face_landmark_68_tiny_model-weights_manifest.json'
    )

    console.log('[FaceAI] 正在装载 FaceRecognitionNet 离线人脸识别特征模型...')
    await loadNetFromIndexedDB(
      faceapi.nets.faceRecognitionNet,
      'face_recognition_model-weights_manifest.json'
    )

    isLoaded = true
    console.log('[FaceAI] ✅ 离线深度人脸神经网络模型全部就绪！')
    return true
  })()

  try {
    // 10s maximum safety timeout
    return await Promise.race([
      modelLoadPromise,
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('模型加载超时（超过10秒），请检查本地存储或重试')), 10000)
      )
    ])
  } catch (err) {
    modelLoadPromise = null
    isLoaded = false
    throw err
  }
}

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number }
  descriptor: Float32Array
  score: number
}

/**
 * Detect faces in an image and compute 128D descriptors
 */
export async function detectFacesInImage(
  imgOrDataUrl: HTMLImageElement | string
): Promise<DetectedFace[]> {
  await loadFaceApiModels()

  let imgElement: HTMLImageElement
  let createdElement = false
  let objectUrlToRevoke: string | null = null

  if (typeof imgOrDataUrl === 'string') {
    try {
      imgElement = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        const timer = setTimeout(() => {
          reject(new Error('图片加载超时'))
        }, 10000)

        if (!imgOrDataUrl.startsWith('data:') && !imgOrDataUrl.startsWith('blob:')) {
          img.crossOrigin = 'anonymous'
        }

        img.onload = () => {
          clearTimeout(timer)
          resolve(img)
        }
        img.onerror = () => {
          clearTimeout(timer)
          reject(new Error('图片加载失败，无法进行面部检测'))
        }
        img.src = imgOrDataUrl
      })
    } catch (primaryErr) {
      // 容错降级：若直接 Image 跨域受阻，尝试 fetch 获取 blob 并构建同源 ObjectURL
      if (imgOrDataUrl.startsWith('http://') || imgOrDataUrl.startsWith('https://')) {
        try {
          const resp = await fetch(imgOrDataUrl)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const blob = await resp.blob()
          const objUrl = URL.createObjectURL(blob)
          objectUrlToRevoke = objUrl
          imgElement = await new Promise<HTMLImageElement>((res, rej) => {
            const fallbackImg = new Image()
            fallbackImg.onload = () => res(fallbackImg)
            fallbackImg.onerror = () => rej(new Error('Blob图片解析失败'))
            fallbackImg.src = objUrl
          })
        } catch {
          throw primaryErr
        }
      } else {
        throw primaryErr
      }
    }
    createdElement = true
  } else {
    imgElement = imgOrDataUrl
  }

  try {
    // inputSize: 320 provides blazing fast detection on CPU/WebGL
    // scoreThreshold: 0.25 detects casual portraits accurately
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.25
    })

    const results = await faceapi
      .detectAllFaces(imgElement, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors()

    return results.map((res) => ({
      box: {
        x: Math.round(res.detection.box.x),
        y: Math.round(res.detection.box.y),
        width: Math.round(res.detection.box.width),
        height: Math.round(res.detection.box.height)
      },
      descriptor: res.descriptor,
      score: res.detection.score
    }))
  } finally {
    if (objectUrlToRevoke) {
      try {
        URL.revokeObjectURL(objectUrlToRevoke)
      } catch {}
    }
    if (createdElement && imgElement) {
      imgElement.src = ''
    }
  }
}


export interface PhotoFaceRecord {
  photoId: string
  descriptor: Float32Array
  score: number
}

export interface FaceCluster {
  clusterId: string
  representativePhotoId: string
  photoIds: string[]
  descriptors: Float32Array[]
}

/**
 * Euclidean distance between two 128D face vectors
 */
export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  return faceapi.euclideanDistance(a, b)
}

/**
 * Cluster faces into persons using greedy leader-follower clustering
 * Threshold: 0.58 is ideal for MobileNet / ResNet-34 128D descriptors
 */
export function clusterFaces(
  records: PhotoFaceRecord[],
  threshold = 0.58
): FaceCluster[] {
  const sorted = [...records].sort((a, b) => b.score - a.score)
  const clusters: FaceCluster[] = []

  for (const item of sorted) {
    let bestCluster: FaceCluster | null = null
    let minDistance = Infinity

    for (const cluster of clusters) {
      for (const desc of cluster.descriptors) {
        const dist = euclideanDistance(item.descriptor, desc)
        if (dist < threshold && dist < minDistance) {
          minDistance = dist
          bestCluster = cluster
        }
      }
    }

    if (bestCluster) {
      if (!bestCluster.photoIds.includes(item.photoId)) {
        bestCluster.photoIds.push(item.photoId)
      }
      bestCluster.descriptors.push(item.descriptor)
    } else {
      clusters.push({
        clusterId: `cluster_${Date.now()}_${clusters.length + 1}`,
        representativePhotoId: item.photoId,
        photoIds: [item.photoId],
        descriptors: [item.descriptor]
      })
    }
  }

  return clusters
}

/**
 * 在已知人物的特征向量库中，为指定的人脸寻找最佳匹配人物
 * @param descriptor 待检测的 128 维人脸特征向量
 * @param peopleDescriptors 已知人物的特征集合，包含每个人物的 personId 与代表性面部向量
 * @param threshold 距离匹配阈值（默认 0.53，在 128 维空间中具有极高的精确率与召回率）
 */
export function findBestMatchingPerson(
  descriptor: Float32Array,
  peopleDescriptors: Array<{ personId: string; descriptors: Float32Array[] }>,
  threshold = 0.53
): { personId: string; distance: number } | null {
  let bestMatch: { personId: string; distance: number } | null = null
  let minDistance = Infinity

  for (const person of peopleDescriptors) {
    for (const d of person.descriptors) {
      const dist = euclideanDistance(descriptor, d)
      if (dist < threshold && dist < minDistance) {
        minDistance = dist
        bestMatch = { personId: person.personId, distance: dist }
      }
    }
  }

  return bestMatch
}
