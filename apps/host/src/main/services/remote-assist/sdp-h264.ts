/**
 * 把 H264 payload type 挪到 video m-line 最前，并带上对应 RTX。
 * setCodecPreferences 在 recvonly transceiver 上经常被 Chromium 忽略，SDP 重排更可靠。
 */
export function preferH264InSdp(sdp: string): string {
  if (!sdp || typeof sdp !== 'string') return sdp

  const parts = sdp.split('m=')
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].indexOf('video') !== 0) continue

    const match = parts[i].match(/^(.*?)(\r\n|\n)/)
    if (!match) continue
    const header = match[1]
    const rest = parts[i].slice(match[0].length)
    const headerParts = header.split(' ')
    if (headerParts.length < 4) continue

    const payloadTypes = headerParts.slice(3)
    const codecByPt: Record<string, string> = {}
    const aptByPt: Record<string, string> = {}
    rest.replace(/a=rtpmap:(\d+) ([^\s/]+)/g, (_all, pt, name) => {
      codecByPt[pt] = String(name).toUpperCase()
      return _all
    })
    rest.replace(/a=fmtp:(\d+) (.*)/g, (_all, pt, params) => {
      const apt = String(params).match(/(?:^|;)\s*apt=(\d+)/)
      if (apt) aptByPt[pt] = apt[1]
      return _all
    })

    const h264Pts = payloadTypes.filter((pt) => codecByPt[pt] === 'H264')
    if (h264Pts.length === 0) continue

    const h264RtxPts = payloadTypes.filter(
      (pt) => codecByPt[pt] === 'RTX' && h264Pts.indexOf(aptByPt[pt]) >= 0
    )
    const used: Record<string, boolean> = {}
    h264Pts.concat(h264RtxPts).forEach((pt) => {
      used[pt] = true
    })
    const others = payloadTypes.filter((pt) => !used[pt])
    const reordered = h264Pts.concat(h264RtxPts, others)
    parts[i] = headerParts.slice(0, 3).concat(reordered).join(' ') + match[2] + rest
  }

  return parts.join('m=')
}
