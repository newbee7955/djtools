    const isController = !!(window.__RA_SESSION__ && window.__RA_SESSION__.isController);
    const permission = (window.__RA_SESSION__ && window.__RA_SESSION__.permission) || 'view';
    const clipboardEnabled = !!(window.__RA_SESSION__ && window.__RA_SESSION__.clipboardEnabled);
    const iceMode = (window.__RA_SESSION__ && window.__RA_SESSION__.iceMode) || 'auto';
    let pc = null;
    let dataChannel = null;
    let dataDataChannel = null;
    let seq = 1;
    let localStreamPromise = null;
    let localVideoTrack = null;
    let localVideoSender = null;
    // 默认 1080p：兼顾高清画质与流畅度，被控端为 1080p 时即原生分辨率
    let desiredQuality = '1080p';
    let controllerDesiredQuality = '1080p';
    // 画质档位的中文标签：控制端状态栏回显用（原始/高清/流畅/省流）
    const QUALITY_LABELS = { native: '原始', '1080p': '高清 1080p', '720p': '流畅 720p', '540p': '省流 540p' };
    // 控制端：正在等待受控端确认的档位（用于超时判定与状态回显）
    let pendingQuality = null;
    // 受控端：最近一次成功应用的档位，用于跳过重复应用（避免无谓的采集重启）
    let appliedQuality = 'native';
    const initialPreferredFps = (window.__RA_SESSION__ && window.__RA_SESSION__.preferredFps) || 60;
    let desiredFps = initialPreferredFps;
    let controllerDesiredFps = initialPreferredFps;
    let appliedFps = initialPreferredFps;
    let pendingFps = null;
    let pointerChannel = null;     // 不可靠无序鼠标移动专用通道（消除队头阻塞）
    let pendingPointerMove = null; // 节流保留的最新坐标
    let pointerThrottleTimer = null; // 节流定时器
    let lastPointerSendTime = 0;   // 上次发送时间戳
    let lastEncodeStats = { encodeMs: undefined, codec: '', encoderImplementation: '', qualityLimitationReason: '' };
    let encodeStatsLogged = false;
    let localCursorEnabled = false;
    let remoteCursorHidden = permission === 'control';
    let statsTimer = null;
    let directFallbackTimer = null;
    let offerWaitTimer = null;
    let relayFallbackStarted = false;
    let iceRestartInProgress = false;
    let iceGeneration = 0;
    let icePhase = 'direct';
    let remoteDescriptionGeneration = -1;
    const pendingCandidatesByGeneration = new Map();
    const observedLocalCandidates = new Map();
    const observedRemoteCandidates = new Map();

    const rtcConfig = {
      iceServers: (window.__RA_SESSION__ && window.__RA_SESSION__.iceServers) || [],
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 2
    };

    // ICE 诊断：用于定位"为什么走了中继而不是 P2P 直连"
    const iceErrors = [];
    const iceDiagState = { reported: false, settledScheduled: false };
    const iceServerUrls = (rtcConfig.iceServers || []).map(function (s) { return s && s.urls; }).flat().filter(Boolean);
    console.log('[ICE] 使用的 ICE 服务器:', iceServerUrls.join(', '));

    // 先只用 host/STUN 尝试直连，避免 TURN 中继候选先被提名后锁定本代 ICE。
    const allIceServers = rtcConfig.iceServers || [];
    const urlsOfIceServer = function (server) {
      if (!server || !server.urls) return [];
      return (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(function (url) { return typeof url === 'string'; });
    };
    const isTurnUrl = function (url) { return /^turns?:/i.test(url); };
    const directOnlyIceServers = [];
    allIceServers.forEach(function (server) {
      const directUrls = urlsOfIceServer(server).filter(function (url) { return !isTurnUrl(url); });
      if (!directUrls.length) return;
      directOnlyIceServers.push(Object.assign({}, server, {
        urls: Array.isArray(server.urls) ? directUrls : directUrls[0],
        username: undefined,
        credential: undefined
      }));
    });
    const turnIceServers = allIceServers.filter(function (server) {
      return urlsOfIceServer(server).some(isTurnUrl);
    });
    const directRtcConfig = {
      iceServers: directOnlyIceServers,
      bundlePolicy: rtcConfig.bundlePolicy,
      iceTransportPolicy: rtcConfig.iceTransportPolicy,
      iceCandidatePoolSize: rtcConfig.iceCandidatePoolSize
    };
    const fullRtcConfig = {
      iceServers: allIceServers,
      bundlePolicy: rtcConfig.bundlePolicy,
      iceTransportPolicy: rtcConfig.iceTransportPolicy,
      iceCandidatePoolSize: rtcConfig.iceCandidatePoolSize
    };
    const DIRECT_ICE_TIMEOUT_MS = 5000;
    const DIRECT_ONLY_DIAGNOSTIC_MS = 10000;
    console.log('[ICE] 模式:', iceMode, '直连服务器:', directOnlyIceServers.length, 'TURN服务器:', turnIceServers.length);

    const CAPTURE_TIMEOUT_MS = 8000;
    const CAPTURE_MAX_ATTEMPTS = 2;

    function withTimeout(promise, ms, fallback) {
      return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
      ]);
    }

    // 受控端屏幕捕获：带单次超时与重试，避免 getDisplayMedia 挂起导致握手永久卡住
    async function captureScreen() {
      // 将目标画质的分辨率直接带入首次 getDisplayMedia，避免捕获后 applyConstraints 重启采集器（1-2s 黑屏）
      const targetProfile = QUALITY_PROFILES[controllerDesiredQuality] || QUALITY_PROFILES['1080p'];
      for (let attempt = 1; attempt <= CAPTURE_MAX_ATTEMPTS; attempt++) {
        try {
          const stream = await withTimeout(
            (function () {
              const currentFps = appliedFps || desiredFps || 60;
              const base = { frameRate: { ideal: currentFps, max: currentFps } };
              if (targetProfile.maxWidth) {
                base.width = { max: targetProfile.maxWidth };
                base.height = { max: targetProfile.maxHeight };
              }
              const cursorMode = (permission === 'control') ? 'never' : 'always';
              return navigator.mediaDevices.getDisplayMedia({ video: Object.assign({}, base, { cursor: cursorMode }), audio: false })
                .catch(function () {
                  return navigator.mediaDevices.getDisplayMedia({ video: base, audio: false });
                });
            })(),
            CAPTURE_TIMEOUT_MS,
            null
          );
          if (stream) {
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              if ('contentHint' in videoTrack) {
                // motion 偏向低延迟/流畅（detail 会为清晰度牺牲延迟）
                videoTrack.contentHint = 'motion';
              }
              pc.addTrack(videoTrack, stream);
              localVideoTrack = videoTrack;
              localVideoSender = pc.getSenders().find((s) => s.track === videoTrack) || null;
              // 拥塞时优先保帧率（掉分辨率而非掉帧），减少"拖尾/卡顿"观感
              if (localVideoSender) {
                await applyLowLatencyEncoding(localVideoSender, targetProfile);
              }
              preferHardwareH264();
            }
            console.log('[WebRTC] 受控端屏幕捕获成功, 轨道数:', stream.getTracks().length);
            // 标记已应用的画质档位，避免后续收到相同档位时重复 applyConstraints
            appliedQuality = controllerDesiredQuality;
            if (permission === 'control') applyRemoteCursorHidden(true);
            return stream;
          }
          console.warn('[WebRTC] 受控端屏幕捕获第 ' + attempt + ' 次超时');
        } catch (e) {
          console.error('[WebRTC] 受控端屏幕捕获失败 (第 ' + attempt + ' 次):', e);
        }
      }
      return null;
    }

    // 采集画质档位：只影响传给控制端的画面分辨率与码率，不改变被控机系统分辨率
    // 码率已适配 60fps（较 30fps 时翻倍，避免码率不足导致跳帧/模糊）
    const QUALITY_PROFILES = {
      native: { maxWidth: null, maxHeight: null, maxBitrate: null, startBitrateKbps: 6000 },
      '1080p': { maxWidth: 1920, maxHeight: 1080, maxBitrate: 8000000, startBitrateKbps: 5000 },
      '720p': { maxWidth: 1280, maxHeight: 720, maxBitrate: 4000000, startBitrateKbps: 3000 },
      '540p': { maxWidth: 960, maxHeight: 540, maxBitrate: 2000000, startBitrateKbps: 1500 }
    };

    function orderCodecsH264First(caps) {
      if (!caps || !caps.codecs || !caps.codecs.length) return null;
      const h264 = [];
      const rest = [];
      for (let i = 0; i < caps.codecs.length; i++) {
        const codec = caps.codecs[i];
        const mime = String(codec.mimeType || '').toUpperCase();
        if (mime === 'VIDEO/H264') h264.push(codec);
        else rest.push(codec);
      }
      if (!h264.length) return null;
      h264.sort(function (a, b) {
        const aPm = (a.sdpFmtpLine || '').indexOf('packetization-mode=1') >= 0 ? 0 : 1;
        const bPm = (b.sdpFmtpLine || '').indexOf('packetization-mode=1') >= 0 ? 0 : 1;
        return aPm - bPm;
      });
      return h264.concat(rest);
    }

    function preferHardwareH264() {
      if (!pc) return;
      try {
        const senderCaps = (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities)
          ? RTCRtpSender.getCapabilities('video')
          : null;
        const receiverCaps = (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities)
          ? RTCRtpReceiver.getCapabilities('video')
          : null;
        if (senderCaps && senderCaps.codecs) {
          console.log('[WebRTC] Sender编码能力:', senderCaps.codecs.map(function (c) { return c.mimeType; }).join(', '));
        }
        const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
        for (let i = 0; i < transceivers.length; i++) {
          const t = transceivers[i];
          if (typeof t.setCodecPreferences !== 'function') continue;
          const kind = (t.receiver && t.receiver.track && t.receiver.track.kind)
            || (t.sender && t.sender.track && t.sender.track.kind);
          if (kind && kind !== 'video') continue;
          const dir = t.direction || '';
          const caps = (dir === 'recvonly' || dir === 'inactive') && receiverCaps ? receiverCaps : (senderCaps || receiverCaps);
          const ordered = orderCodecsH264First(caps);
          if (!ordered) {
            console.warn('[WebRTC] 本机 WebRTC 未列出 H264，将回退 VP8');
            continue;
          }
          try {
            t.setCodecPreferences(ordered);
          } catch (e) {
            console.warn('[WebRTC] setCodecPreferences 失败:', e);
          }
        }
      } catch (e) {
        console.warn('[WebRTC] 设置 H264 编码偏好失败:', e);
      }
    }

    function preferH264InSdp(sdp) {
      if (!sdp || typeof sdp !== 'string') return sdp;
      const parts = sdp.split('m=');
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].indexOf('video') !== 0) continue;
        const match = parts[i].match(/^(.*?)(\r\n|\n)/);
        if (!match) continue;
        const header = match[1];
        const rest = parts[i].slice(match[0].length);
        const headerParts = header.split(' ');
        if (headerParts.length < 4) continue;
        const payloadTypes = headerParts.slice(3);
        const codecByPt = {};
        const aptByPt = {};
        rest.replace(/a=rtpmap:(\d+) ([^\s/]+)/g, function (_all, pt, name) {
          codecByPt[pt] = String(name).toUpperCase();
          return _all;
        });
        rest.replace(/a=fmtp:(\d+) (.*)/g, function (_all, pt, params) {
          const apt = String(params).match(/(?:^|;)\s*apt=(\d+)/);
          if (apt) aptByPt[pt] = apt[1];
          return _all;
        });
        const h264Pts = payloadTypes.filter(function (pt) { return codecByPt[pt] === 'H264'; });
        if (h264Pts.length === 0) continue;
        const h264RtxPts = payloadTypes.filter(function (pt) {
          return codecByPt[pt] === 'RTX' && h264Pts.indexOf(aptByPt[pt]) >= 0;
        });
        const used = {};
        h264Pts.concat(h264RtxPts).forEach(function (pt) { used[pt] = true; });
        const others = payloadTypes.filter(function (pt) { return !used[pt]; });
        parts[i] = headerParts.slice(0, 3).concat(h264Pts, h264RtxPts, others).join(' ') + match[2] + rest;
      }
      return parts.join('m=');
    }

    function applyLowLatencyEncoding(sender, profile, targetFps) {
      if (!sender || typeof sender.getParameters !== 'function') return Promise.resolve();
      try {
        const encParams = sender.getParameters();
        encParams.degradationPreference = 'maintain-framerate';
        if (!encParams.encodings || encParams.encodings.length === 0) {
          encParams.encodings = [{}];
        }
        const enc = encParams.encodings[0];
        if (profile && profile.maxBitrate) enc.maxBitrate = profile.maxBitrate;
        enc.maxFramerate = targetFps || appliedFps || desiredFps || 60;
        enc.priority = 'high';
        enc.networkPriority = 'high';
        return sender.setParameters(encParams).catch(function (e) {
          console.warn('[WebRTC] 设置低延迟编码参数失败:', e);
        });
      } catch (e) {
        console.warn('[WebRTC] 设置低延迟编码参数失败:', e);
        return Promise.resolve();
      }
    }

    function currentStartBitrateKbps() {
      const profileId = isController
        ? desiredQuality
        : (appliedQuality && appliedQuality !== 'native' ? appliedQuality : controllerDesiredQuality);
      const profile = QUALITY_PROFILES[profileId] || QUALITY_PROFILES['720p'];
      return profile.startBitrateKbps || 3000;
    }

    function mungeLowLatencySdp(sdp) {
      if (!sdp || typeof sdp !== 'string') return sdp;
      sdp = preferH264InSdp(sdp);
      const startKbps = currentStartBitrateKbps();
      const minKbps = Math.max(300, Math.round(startKbps / 2));
      // 这段脚本嵌在外层模板字符串里，禁止写反斜杠转义（n/r/d），否则写出 HTML 时会被插值成真实换行把语法弄坏
      const parts = sdp.split('m=');
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].indexOf('video') !== 0) continue;
        parts[i] = parts[i].replace(/a=fmtp:([0-9]+) (.*)/g, function (m, id, rest) {
          if (rest.indexOf('x-google-start-bitrate') !== -1) return m;
          return 'a=fmtp:' + id + ' ' + rest + ';x-google-min-bitrate=' + minKbps + ';x-google-start-bitrate=' + startKbps;
        });
      }
      return parts.join('m=');
    }

    // applyConstraints 超时上限：桌面采集轨改约束会重启采集器（Chromium 常见 1-2s），
    // 用 Promise.race 兜底，避免个别环境卡死后画质流程永久挂起。
    const APPLY_CONSTRAINTS_TIMEOUT_MS = 4000;
    // 超时哨兵值：计时器分支解析为该字符串，用于区分"约束已应用"与"等待超时"
    const APPLY_QUALITY_TIMEOUT = '__apply-quality-timeout__';

    // 受控端：回执画质应用结果，控制端据此把「切换中」更新为「已切换」
    function applyRemoteCursorHidden(hidden) {
      remoteCursorHidden = !!hidden;
      if (localVideoTrack && typeof localVideoTrack.applyConstraints === 'function') {
        localVideoTrack.applyConstraints({ cursor: remoteCursorHidden ? 'never' : 'always' }).catch(function () {});
      }
      if (window.remoteAssistSession && typeof window.remoteAssistSession.setRemoteCursorHidden === 'function') {
        window.remoteAssistSession.setRemoteCursorHidden(remoteCursorHidden);
      }
    }

    function sendRemoteCursorState(hidden) {
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ kind: 'control', action: 'set-remote-cursor', hidden: !!hidden }));
      }
    }

    function sendQualityApplied(profileId) {
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ kind: 'control', action: 'quality-applied', profileId }));
      }
    }

    async function applyQuality(profileId) {
      const profile = QUALITY_PROFILES[profileId] || QUALITY_PROFILES.native;

      // 档位未变化：跳过昂贵的采集重启（仍回执确认，避免控制端一直等到超时）
      if (profileId === appliedQuality) {
        console.log('[画质] 档位未变化，跳过应用:', profileId);
        sendQualityApplied(profileId);
        return;
      }

      // 1) 先限码率并套低延迟编码参数：setParameters 很快且不重启采集器
      if (localVideoSender) {
        await applyLowLatencyEncoding(localVideoSender, profile);
      }

      // 2) 再改分辨率：可能触发采集器重启，故用超时兜底，避免流程被挂住
      if (localVideoTrack && typeof localVideoTrack.applyConstraints === 'function') {
        const currentFps = appliedFps || 60;
        const videoConstraints = profile.maxWidth
          ? { width: { max: profile.maxWidth }, height: { max: profile.maxHeight }, frameRate: { ideal: currentFps, max: currentFps } }
          : { frameRate: { ideal: currentFps, max: currentFps } };
        const startedAt = Date.now();
        try {
          const result = await Promise.race([
            localVideoTrack.applyConstraints(videoConstraints).then(function () { return 'ok'; }),
            new Promise(function (resolve) {
              setTimeout(function () { resolve(APPLY_QUALITY_TIMEOUT); }, APPLY_CONSTRAINTS_TIMEOUT_MS);
            })
          ]);
          if (result === APPLY_QUALITY_TIMEOUT) {
            console.warn('[画质] applyConstraints 超过 ' + APPLY_CONSTRAINTS_TIMEOUT_MS + 'ms 未返回，判定为超时');
          } else {
            console.log('[画质] applyConstraints 用时', Date.now() - startedAt, 'ms');
            console.log('[WebRTC] 已应用画质档位:', profileId);
          }
        } catch (e) {
          console.warn('[WebRTC] 应用分辨率约束失败:', e);
        }
      }

      // 超时也记为已应用：约束请求可能仍在后台生效，标记可避免控制端重试反复重启采集器
      appliedQuality = profileId;
      applyRemoteCursorHidden(remoteCursorHidden);
      sendQualityApplied(profileId);
    }

    // 控制端：通过 DataChannel 把画质档位下发给受控端
    function sendQuality(profileId) {
      desiredQuality = profileId;
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ kind: 'control', action: 'set-quality', profileId }));
      }
    }

    // 受控端：回执帧率应用结果给控制端
    function sendFpsApplied(fps) {
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ kind: 'control', action: 'fps-applied', fps: fps }));
      }
    }

    // 受控端：动态应用目标帧率（同时调整编码器与采集轨约束）
    async function applyFps(targetFps) {
      const fps = Math.min(60, Math.max(10, Number(targetFps) || 60));
      if (fps === appliedFps) {
        console.log('[帧率] 帧率未变化，跳过应用:', fps);
        sendFpsApplied(fps);
        return;
      }
      appliedFps = fps;

      // 1) 调整编码器最大帧率
      if (localVideoSender) {
        const profile = QUALITY_PROFILES[appliedQuality] || QUALITY_PROFILES['1080p'];
        await applyLowLatencyEncoding(localVideoSender, profile, fps);
      }

      // 2) 动态调整采集轨约束
      if (localVideoTrack && typeof localVideoTrack.applyConstraints === 'function') {
        try {
          await localVideoTrack.applyConstraints({
            frameRate: { ideal: fps, max: fps }
          });
          console.log('[WebRTC] 已应用帧率约束:', fps, 'fps');
        } catch (e) {
          console.warn('[WebRTC] 应用帧率约束失败:', e);
        }
      }

      sendFpsApplied(fps);
    }

    // 控制端：通过 DataChannel 发送目标帧率指令并记录偏好
    function sendFps(targetFps) {
      desiredFps = targetFps;
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ kind: 'control', action: 'set-fps', fps: targetFps }));
      }
      if (window.remoteAssistSession && typeof window.remoteAssistSession.setPreferredFps === 'function') {
        window.remoteAssistSession.setPreferredFps(targetFps);
      }
    }

    // 传输通道就绪态：驱动发送按钮/聊天输入的可用性与状态提示，避免"点了没反应"
    function setTransferReady(ready) {
      const sendBtn = document.getElementById('sendFilesBtn');
      const input = document.getElementById('chatInput');
      const status = document.getElementById('transferStatus');
      if (sendBtn) {
        sendBtn.disabled = !ready;
        sendBtn.title = ready ? '发送文件' : '传输通道未建立，暂时无法发送';
      }
      if (input) {
        input.disabled = !ready;
        input.title = ready ? '' : '传输通道未建立，暂时无法发送';
      }
      if (status) {
        status.textContent = ready ? '传输通道已就绪' : '传输通道未建立（等待连接）';
      }
    }

    // 传输/聊天数据通道的帧桥接线：双向帧 + 背压 + 就绪/关闭状态（走 Task 7 的 preload API）
    function wireDataChannel(channel) {
      if (!window.remoteAssistSession || !window.remoteAssistSession.transfer) return;
      channel.binaryType = 'arraybuffer';
      const markReady = () => {
        setTransferReady(true);
        window.remoteAssistSession.transfer.notifyReady();
      };
      const markClosed = () => {
        setTransferReady(false);
        window.remoteAssistSession.transfer.notifyClosed();
      };
      channel.onopen = () => {
        console.log('[WebRTC] doujiao-data 通道已打开');
        markReady();
      };
      channel.onclose = () => {
        console.log('[WebRTC] doujiao-data 通道已关闭');
        markClosed();
      };
      channel.onerror = (err) => {
        console.warn('[WebRTC] doujiao-data 通道异常:', err);
        if (channel.readyState !== 'open') {
          markClosed();
        }
      };
      channel.onmessage = (event) => {
        window.remoteAssistSession.transfer.sendIncomingChunk(new Uint8Array(event.data));
      };
      // 通道创建时可能已处于 open（或最终不会触发 onopen）：按当前 readyState 初始化就绪态
      if (channel.readyState === 'open') {
        markReady();
      } else {
        setTransferReady(false);
      }
      window.remoteAssistSession.transfer.onOutgoingChunk((bytes) => {
        if (channel.readyState === 'open') {
          channel.send(bytes);
          window.remoteAssistSession.transfer.reportBackpressure(channel.bufferedAmount);
        }
      });
    }

    // 是否处于全屏态：原生全屏元素存在，或已进入窗口内降级全屏（pseudo-fs）
    function fsActive() {
      return Boolean(document.fullscreenElement) || document.body.classList.contains('pseudo-fs');
    }

    // 切换「隐藏页内标题栏/面板」的类名，保证无论原生还是降级全屏都只看到远端画面
    function applyFsClass(on) {
      document.body.classList.toggle('fs-active', on);
    }

    function setupFullscreen() {
      const btn = document.getElementById('fullscreenBtn');
      if (!btn) return;

      function updateLabel() {
        btn.textContent = fsActive() ? '退出全屏' : '全屏';
      }

      // 进入窗口内降级全屏：不依赖 fullscreen 权限，点了就生效
      function enterPseudoFullscreen(reason) {
        if (reason) console.warn('[WebRTC] 原生全屏不可用，降级为窗口内全屏:', reason);
        document.body.classList.add('pseudo-fs');
        applyFsClass(true);
        updateLabel();
      }

      function enterFullscreen() {
        if (typeof document.documentElement.requestFullscreen !== 'function') {
          enterPseudoFullscreen('当前环境不支持全屏 API');
          return;
        }
        document.documentElement.requestFullscreen().then(() => {
          applyFsClass(true);
          updateLabel();
        }).catch((e) => {
          // 权限被拒或需要重启才生效：不再静默失败，改为窗口内全屏兜底
          enterPseudoFullscreen(e);
        });
      }

      function exitFullscreen() {
        document.body.classList.remove('pseudo-fs');
        applyFsClass(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        updateLabel();
      }

      btn.addEventListener('click', () => {
        if (fsActive()) exitFullscreen();
        else enterFullscreen();
      });

      // 全屏悬浮按钮：退出全屏 / 立即断开（保证全屏下也能随时中止）
      const hud = document.getElementById('fsHud');
      const hudExit = document.getElementById('fsHudExit');
      if (hudExit) {
        hudExit.addEventListener('click', () => exitFullscreen());
      }
      const hudDisconnect = document.getElementById('fsHudDisconnect');
      if (hudDisconnect) {
        hudDisconnect.addEventListener('click', () => {
          if (window.remoteAssistSession) window.remoteAssistSession.disconnect('user-clicked');
        });
      }

      // 全屏模式下：光标移到屏幕顶部时才滑出 HUD，移开后自动隐藏，实现 100% 无遮挡
      window.addEventListener('mousemove', (e) => {
        if (!fsActive() || !hud) return;
        if (e.clientY <= 8 || hud.contains(e.target)) {
          hud.classList.add('visible');
        } else if (e.clientY > 65) {
          hud.classList.remove('visible');
        }
      });

      document.addEventListener('fullscreenchange', () => {
        // 既不在原生全屏也不在降级全屏时，清理隐藏标题栏的类名
        if (!document.fullscreenElement && !document.body.classList.contains('pseudo-fs')) {
          applyFsClass(false);
        }
        updateLabel();
      });

      // F11 切换全屏；Esc 仅在降级全屏下退出（此时才拦截默认行为）
      window.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
          e.preventDefault();
          if (fsActive()) exitFullscreen();
          else enterFullscreen();
        } else if (e.key === 'Escape' && document.body.classList.contains('pseudo-fs')) {
          e.preventDefault();
          exitFullscreen();
        }
      });
    }

    function normalizeCandidateMetadata(candidate) {
      if (!candidate) return null;
      const line = typeof candidate.candidate === 'string' ? candidate.candidate : '';
      const parts = line.trim().split(/\s+/);
      const typeIndex = parts.indexOf('typ');
      return {
        candidateType: candidate.candidateType || candidate.type || (typeIndex >= 0 ? parts[typeIndex + 1] : 'unknown') || 'unknown',
        protocol: String(candidate.protocol || parts[2] || '?').toLowerCase(),
        address: candidate.address || candidate.ip || parts[4] || '',
        port: candidate.port || (parts[5] ? Number(parts[5]) : ''),
        foundation: candidate.foundation || (parts[0] ? parts[0].replace(/^candidate:/, '') : '')
      };
    }

    function candidateFingerprint(candidate) {
      const meta = normalizeCandidateMetadata(candidate);
      if (!meta) return '';
      return [meta.candidateType, meta.protocol, meta.address, meta.port, meta.foundation].join('|');
    }

    function recordObservedCandidate(target, candidate) {
      const meta = normalizeCandidateMetadata(candidate);
      if (!meta) return;
      target.set(candidateFingerprint(meta), meta);
    }

    function countCandidateTypes(inventory) {
      const counts = {};
      inventory.forEach(function (candidate) {
        const key = (candidate.candidateType || 'unknown') + '/' + (candidate.protocol || '?');
        counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    }

    // 打印 ICE 明细：事件候选保留完整收集史，getStats 用于候选对与当前状态。
    async function reportIceDiagnostics(reason) {
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        const localInventory = new Map(observedLocalCandidates);
        const remoteInventory = new Map(observedRemoteCandidates);
        const cands = {};
        stats.forEach(function (r) {
          if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
            cands[r.id] = r;
            const target = r.type === 'local-candidate' ? localInventory : remoteInventory;
            const meta = normalizeCandidateMetadata(r);
            if (meta) target.set(candidateFingerprint(meta), meta);
          }
        });
        const localByType = countCandidateTypes(localInventory);
        const remoteByType = countCandidateTypes(remoteInventory);
        const pairs = [];
        stats.forEach(function (r) {
          if (r.type === 'candidate-pair') {
            const l = cands[r.localCandidateId];
            const rc = cands[r.remoteCandidateId];
            pairs.push({
              state: r.state,
              nominated: Boolean(r.nominated),
              selected: Boolean(r.selected),
              localType: l ? (l.candidateType || 'unknown') : 'unknown',
              remoteType: rc ? (rc.candidateType || 'unknown') : 'unknown',
              local: l ? ((l.candidateType || 'unknown') + '/' + (l.protocol || '?') + ' ' + (l.address || l.ip || '') + ':' + (l.port || '')) : '?',
              remote: rc ? ((rc.candidateType || 'unknown') + '/' + (rc.protocol || '?') + ' ' + (rc.address || rc.ip || '') + ':' + (rc.port || '')) : '?',
              sent: r.requestsSent,
              recv: r.responsesReceived
            });
          }
        });
        const probePairs = function (localType, remoteType) {
          const matched = pairs.filter(function (p) {
            return p.localType === localType && p.remoteType === remoteType;
          });
          const scoreOf = function (p) {
            return (p.state === 'succeeded' ? 4 : 0) + (p.nominated ? 2 : 0) + ((Number(p.recv) || 0) > 0 ? 1 : 0);
          };
          let best = null;
          let succeeded = 0;
          let maxRecv = 0;
          matched.forEach(function (p) {
            const recv = Number(p.recv) || 0;
            if (p.state === 'succeeded') succeeded++;
            maxRecv = Math.max(maxRecv, recv);
            if (!best || scoreOf(p) > scoreOf(best) || (scoreOf(p) === scoreOf(best) && (Number(p.sent) || 0) > (Number(best.sent) || 0))) {
              best = p;
            }
          });
          return { count: matched.length, succeeded: succeeded, maxRecv: maxRecv, best: best };
        };
        const fmt = function (o) {
          const keys = Object.keys(o);
          return keys.length ? keys.map(function (k) { return k + '×' + o[k]; }).join(', ') : '无';
        };
        const lines = [];
        lines.push('[ICE诊断] ==== ' + reason + ' ====');
        lines.push('[ICE诊断] ICE 代次/阶段: ' + iceGeneration + '/' + icePhase);
        lines.push('[ICE诊断] ICE 服务器: ' + iceServerUrls.join(', '));
        lines.push('[ICE诊断] 本地候选: ' + fmt(localByType));
        lines.push('[ICE诊断] 远端候选: ' + fmt(remoteByType));
        lines.push('[ICE诊断] 候选对 ' + pairs.length + ' 对，状态: ' + (pairs.map(function (p) { return p.state; }).join(',') || '无'));
        pairs.slice(0, 40).forEach(function (p, i) {
          lines.push('[ICE诊断] 对' + (i + 1) + ': ' + p.state + (p.nominated ? '(nominated)' : '') + ' 本地=' + p.local + ' 远端=' + p.remote + ' 请求/响应=' + p.sent + '/' + p.recv);
        });
        const groups = {};
        pairs.forEach(function (p) {
          const key = p.localType + '\u2194' + p.remoteType;
          if (!groups[key]) groups[key] = { count: 0, succeeded: 0, maxSent: 0, maxRecv: 0 };
          const group = groups[key];
          group.count++;
          if (p.state === 'succeeded') group.succeeded++;
          group.maxSent = Math.max(group.maxSent, Number(p.sent) || 0);
          group.maxRecv = Math.max(group.maxRecv, Number(p.recv) || 0);
        });
        Object.keys(groups).forEach(function (key) {
          const group = groups[key];
          lines.push('[ICE诊断] 汇总 ' + key + ': ' + group.count + '对 成功' + group.succeeded + ' 最大请求/响应=' + group.maxSent + '/' + group.maxRecv);
        });
        const keyPairLine = function (label, localType, remoteType) {
          const probe = probePairs(localType, remoteType);
          if (!probe.count) {
            lines.push('[ICE诊断] 关键组合 ' + label + ': 不存在');
          } else {
            lines.push('[ICE诊断] 关键组合 ' + label + ': ' + probe.count + '对 状态=' + probe.best.state + ' 请求/响应=' + probe.best.sent + '/' + probe.best.recv);
          }
        };
        // RFC 8445 会把本地 srflx pair 替换为其 host base，因此合法直连通常显示为 host↔srflx/prflx。
        keyPairLine('host\u2194srflx', 'host', 'srflx');
        keyPairLine('host\u2194prflx', 'host', 'prflx');
        keyPairLine('host\u2194host', 'host', 'host');
        if (iceErrors.length) {
          lines.push('[ICE诊断] ICE 候选者错误:');
          iceErrors.forEach(function (e) {
            lines.push('[ICE诊断]   ' + e.url + ' code=' + e.code + ' ' + (e.text || '') + ' address=' + (e.address || '?') + ':' + (e.port || '?'));
          });
        } else {
          lines.push('[ICE诊断] 无 ICE 候选者错误');
        }
        const isNonRelay = function (type) { return type !== 'relay' && type !== 'unknown'; };
        const directPairs = pairs.filter(function (pair) {
          return isNonRelay(pair.localType) && isNonRelay(pair.remoteType);
        });
        const directSuccess = directPairs.some(function (pair) { return pair.state === 'succeeded'; });
        const directMaxRecv = directPairs.reduce(function (max, pair) { return Math.max(max, Number(pair.recv) || 0); }, 0);
        const hasSrflxKey = function (bucket) {
          return Object.keys(bucket).some(function (key) { return key.indexOf('srflx') === 0; });
        };
        const localHasSrflx = hasSrflxKey(localByType);
        const remoteHasSrflx = hasSrflxKey(remoteByType);
        lines.push('[ICE诊断] 本机是否有公网映射(srflx): ' + (localHasSrflx ? '是' : '否'));
        lines.push('[ICE诊断] 对端是否有公网映射(srflx): ' + (remoteHasSrflx ? '是' : '否'));
        let verdict;
        if (directSuccess) {
          verdict = '已建立直连（非中继）';
        } else if (!localHasSrflx) {
          verdict = '本机未获得公网映射（无 srflx 候选：STUN 无响应，可能被 VPN/代理/TUN 或安全软件拦截 UDP 出向）';
        } else if (!remoteHasSrflx) {
          verdict = '对端未获得公网映射（无 srflx 候选：对方网络可能拦截 UDP 出向）';
        } else if (directPairs.length && directMaxRecv > 0) {
          verdict = '直连检查已有响应，但握手或提名未完成';
        } else if (directPairs.length) {
          verdict = '直连检查无响应（对端入站 UDP 可能被 NAT/防火墙过滤）';
        } else if (localHasSrflx && remoteHasSrflx) {
          verdict = '已交换公网映射，但未形成可检测的直连候选对';
        } else {
          verdict = '仅中继可用（缺少可直连的候选组合）';
        }
        lines.push('[ICE诊断] 结论: ' + verdict);
        lines.forEach(function (line) { console.log(line); });
      } catch (e) {
        console.warn('[ICE诊断] 生成诊断信息失败:', e);
      }
    }

    function isPcConnected() {
      return Boolean(pc && (
        pc.connectionState === 'connected'
        || pc.iceConnectionState === 'connected'
        || pc.iceConnectionState === 'completed'
      ));
    }

    function paintStatsBar(modeText, rttMs, videoDelayMs, fpsText) {
      const statsBar = document.getElementById('statsBar');
      if (!statsBar || !isPcConnected()) return;
      let text = '已连接 ● ' + (modeText || '识别链路中');
      const encodeBits = [];
      if (typeof lastEncodeStats.encodeMs === 'number') encodeBits.push(lastEncodeStats.encodeMs + 'ms');
      if (lastEncodeStats.codec) encodeBits.push(lastEncodeStats.codec);
      if (lastEncodeStats.encoderImplementation) encodeBits.push(lastEncodeStats.encoderImplementation);
      if (encodeBits.length) text += ' ● 编码: ' + encodeBits.join(' ');
      if (rttMs !== undefined) {
        text += ' ● 网络: ' + rttMs + 'ms';
      }
      if (videoDelayMs !== undefined) {
        text += ' ● 接收: ' + videoDelayMs + 'ms';
      }
      if (lastEncodeStats.qualityLimitationReason && lastEncodeStats.qualityLimitationReason !== 'none') {
        text += ' ● 受限:' + lastEncodeStats.qualityLimitationReason;
      }
      if (fpsText) text += ' ● ' + fpsText;
      statsBar.innerText = text;
      const fsHudStats = document.getElementById('fsHudStats');
      if (fsHudStats) fsHudStats.innerText = text;
      if (!encodeStatsLogged && encodeBits.length) {
        encodeStatsLogged = true;
        console.log('[WebRTC] 视频编码', lastEncodeStats.codec || '未知', lastEncodeStats.encoderImplementation || '', typeof lastEncodeStats.encodeMs === 'number' ? lastEncodeStats.encodeMs + 'ms' : '');
      }
    }

    function collectMediaStats(stats) {
      let videoDelayMs = undefined;
      let fpsText = '';
      const codecMap = {};
      stats.forEach(function (report) {
        if (report.type === 'codec' && report.mimeType) {
          codecMap[report.id] = String(report.mimeType).replace(/^video\//i, '');
        }
      });
      stats.forEach(function (report) {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (typeof report.totalProcessingDelay === 'number' && typeof report.framesDecoded === 'number' && report.framesDecoded > 0) {
            videoDelayMs = Math.round((report.totalProcessingDelay / report.framesDecoded) * 1000);
          } else if (typeof report.jitterBufferDelay === 'number' && typeof report.jitterBufferEmittedCount === 'number' && report.jitterBufferEmittedCount > 0) {
            const jbDelayMs = Math.round((report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000);
            let decodeMs = 0;
            if (typeof report.totalDecodeTime === 'number' && typeof report.framesDecoded === 'number' && report.framesDecoded > 0) {
              decodeMs = Math.round((report.totalDecodeTime / report.framesDecoded) * 1000);
            }
            videoDelayMs = jbDelayMs + decodeMs;
          }
          if (typeof report.framesPerSecond === 'number') {
            fpsText = report.framesPerSecond + 'fps';
          }
          if (report.codecId && codecMap[report.codecId]) {
            lastEncodeStats.codec = lastEncodeStats.codec || codecMap[report.codecId];
          }
        }
        if (!isController && report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          if (typeof report.totalEncodeTime === 'number' && typeof report.framesEncoded === 'number' && report.framesEncoded > 0) {
            lastEncodeStats.encodeMs = Math.round((report.totalEncodeTime / report.framesEncoded) * 1000);
          }
          lastEncodeStats.encoderImplementation = report.encoderImplementation || lastEncodeStats.encoderImplementation;
          lastEncodeStats.qualityLimitationReason = report.qualityLimitationReason || '';
          if (report.codecId && codecMap[report.codecId]) {
            lastEncodeStats.codec = codecMap[report.codecId];
          }
          if (typeof report.framesPerSecond === 'number') {
            fpsText = report.framesPerSecond + 'fps';
          }
        }
      });
      if (!isController && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({
          kind: 'control',
          action: 'media-stats',
          encodeMs: lastEncodeStats.encodeMs,
          codec: lastEncodeStats.codec,
          encoderImplementation: lastEncodeStats.encoderImplementation,
          qualityLimitationReason: lastEncodeStats.qualityLimitationReason
        }));
      }
      return { videoDelayMs: videoDelayMs, fpsText: fpsText };
    }

    async function checkConnectionMode() {
      if (!pc) return;
      let modeText = null;
      let modeKey = null;
      let modeTextFull = null;
      let rttMs = undefined;
      let videoDelayMs = undefined;
      let fpsText = '';
      try {
        const stats = await pc.getStats();
        let selectedPairId = null;
        stats.forEach(function (report) {
          if (report.type === 'transport' && report.selectedCandidatePairId) {
            selectedPairId = report.selectedCandidatePairId;
          }
        });
        let activePair = selectedPairId ? stats.get(selectedPairId) : null;
        if (!activePair) {
          const compatiblePairs = [];
          stats.forEach(function (report) {
            if (report.type === 'candidate-pair' && (report.selected || report.nominated || report.state === 'succeeded')) {
              compatiblePairs.push(report);
            }
          });
          activePair = compatiblePairs.find(function (report) { return report.selected; })
            || compatiblePairs.find(function (report) { return report.nominated && report.state === 'succeeded'; })
            || compatiblePairs.find(function (report) { return report.nominated; })
            || compatiblePairs.find(function (report) { return report.state === 'succeeded'; })
            || null;
        }

        if (activePair) {
          const localCand = stats.get(activePair.localCandidateId);
          const remoteCand = stats.get(activePair.remoteCandidateId);
          if (typeof activePair.currentRoundTripTime === 'number') {
            rttMs = Math.round(activePair.currentRoundTripTime * 1000);
          }
          if (localCand && remoteCand) {
            const isRelay = localCand.candidateType === 'relay' || remoteCand.candidateType === 'relay';
            const isLan = localCand.candidateType === 'host' && remoteCand.candidateType === 'host';
            modeKey = isRelay ? 'relay' : (isLan ? 'p2p-lan' : 'p2p-wan');
            modeText = isRelay ? '中继转发' : (isLan ? 'P2P 局域网' : 'P2P 直连');
            modeTextFull = isRelay ? '中继转发' : (isLan ? 'P2P 局域网直连' : 'P2P 公网直连');
            if (isRelay && !iceDiagState.reported) {
              iceDiagState.reported = true;
              void reportIceDiagnostics('连接模式=中继转发（未直连）· 连接即刻快照');
            }
            const badge = document.getElementById('connModeBadge');
            if (badge) {
              badge.innerText = modeText;
              badge.style.background = isRelay ? '#f59e0b' : '#10b981';
              badge.title = modeTextFull + ' (' + localCand.candidateType + ' \u2194 ' + remoteCand.candidateType + ')';
            }
          }
        }

        const media = collectMediaStats(stats);
        videoDelayMs = media.videoDelayMs;
        fpsText = media.fpsText;

        if (modeKey && window.remoteAssistSession && typeof window.remoteAssistSession.reportStats === 'function') {
          window.remoteAssistSession.reportStats({
            connectionMode: modeKey,
            connectionModeText: modeTextFull,
            rttMs: rttMs,
            videoDelayMs: videoDelayMs
          });
        }
      } catch (e) {
        console.warn('[WebRTC] 获取连接模式异常:', e);
      }
      paintStatsBar(modeTextFull || modeText, rttMs, videoDelayMs, fpsText);
    }

    function startStatsPolling() {
      if (statsTimer) return;
      checkConnectionMode();
      statsTimer = setInterval(checkConnectionMode, 1500);
    }

    function stopStatsPolling() {
      if (statsTimer) {
        clearInterval(statsTimer);
        statsTimer = null;
      }
    }

    function clearDirectFallbackTimer() {
      if (directFallbackTimer) {
        clearTimeout(directFallbackTimer);
        directFallbackTimer = null;
      }
    }

    function scheduleRelayFallback() {
      if (iceMode === 'direct-only') {
        if (directFallbackTimer) return;
        console.log('[ICE] direct-only 诊断模式：保持 STUN/host 配置，不启用 TURN；从 checking 观测 10 秒');
        directFallbackTimer = setTimeout(function () {
          directFallbackTimer = null;
          void reportIceDiagnostics('direct-only 10 秒观测结果');
        }, DIRECT_ONLY_DIAGNOSTIC_MS);
        return;
      }
      if (!isController || iceMode !== 'auto' || relayFallbackStarted || turnIceServers.length === 0 || directFallbackTimer) return;
      directFallbackTimer = setTimeout(function () {
        directFallbackTimer = null;
        void beginRelayFallback('直连候选检查超时');
      }, DIRECT_ICE_TIMEOUT_MS);
      console.log('[ICE] 已从 checking 开始直连计时，' + DIRECT_ICE_TIMEOUT_MS + 'ms 后仍未连通则 ICE restart 回退 TURN');
    }

    function sendIceSignal(type, payload) {
      if (!window.remoteAssistSession) return;
      window.remoteAssistSession.sendSignal(Object.assign({
        type: type,
        iceGeneration: iceGeneration,
        icePhase: icePhase
      }, payload || {}));
    }

    function getSignalGeneration(sig, fallbackGeneration) {
      const value = sig && sig.iceGeneration;
      if (Number.isInteger(value) && value >= 0) return value;
      // 旧版对端没有代次字段；把其信令归入当前唯一待处理的协商代次。
      return fallbackGeneration;
    }

    async function createAndSendOffer(iceRestart) {
      if (!pc) return;
      preferHardwareH264();
      const offer = iceRestart
        ? await pc.createOffer({ iceRestart: true })
        : await pc.createOffer();
      const mungedOffer = { type: offer.type, sdp: mungeLowLatencySdp(offer.sdp) };
      await pc.setLocalDescription(mungedOffer);
      try {
        const videoSection = (mungedOffer.sdp || '').split('m=video')[1] || '';
        console.log('[WebRTC] Offer 视频 m-line:', (videoSection.split('\n')[0] || '').trim());
      } catch (e) {}
      const localDesc = pc.localDescription.toJSON ? pc.localDescription.toJSON() : {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      };
      console.log('[WebRTC] 控制端已生成并发送 Offer, iceGeneration=' + iceGeneration + ', icePhase=' + icePhase);
      sendIceSignal('offer', { sdp: localDesc });
    }

    async function beginRelayFallback(reason) {
      if (!pc || !isController || iceMode !== 'auto' || relayFallbackStarted || turnIceServers.length === 0) return;
      const alreadyConnected = pc.iceConnectionState === 'connected'
        || pc.iceConnectionState === 'completed'
        || pc.connectionState === 'connected';
      if (alreadyConnected) return;
      relayFallbackStarted = true;
      iceRestartInProgress = true;
      clearDirectFallbackTimer();
      iceGeneration += 1;
      icePhase = 'relay-fallback';
      console.warn('[ICE] 直连未建立，启用 TURN 并重启 ICE:', reason, 'generation=' + iceGeneration);
      const status = document.getElementById('statsBar');
      if (status) status.innerText = 'P2P 直连未建立，正在切换中继...';
      try {
        pc.setConfiguration(fullRtcConfig);
        if (typeof pc.restartIce === 'function') pc.restartIce();
        await createAndSendOffer(true);
      } catch (error) {
        iceRestartInProgress = false;
        console.error('[ICE] ICE restart 失败:', error);
        void reportIceDiagnostics('ICE restart 失败');
        if (window.remoteAssistSession) window.remoteAssistSession.disconnect('ice-restart-failed');
      }
    }

    function notifyConnected() {
      clearDirectFallbackTimer();
      startStatsPolling();
      // 连接后 8 秒再打一次最终 ICE 状态：确认直连候选对最终是否成功过（连接瞬间的快照可能还在竞速中）
      if (!iceDiagState.settledScheduled) {
        iceDiagState.settledScheduled = true;
        setTimeout(function () { void reportIceDiagnostics('连接后 8 秒最终 ICE 状态'); }, 8000);
      }
      if (window.remoteAssistSession) {
        window.remoteAssistSession.setConnected();
      }
    }

    function queueCandidate(generation, candidate) {
      const queued = pendingCandidatesByGeneration.get(generation) || [];
      queued.push(candidate);
      pendingCandidatesByGeneration.set(generation, queued);
    }

    function discardStaleCandidateQueues() {
      pendingCandidatesByGeneration.forEach(function (_candidates, generation) {
        if (generation < iceGeneration) pendingCandidatesByGeneration.delete(generation);
      });
    }

    async function safeAddIceCandidate(cand) {
      if (!pc) return;
      try {
        if (cand === null) {
          await pc.addIceCandidate(null);
          console.log('[WebRTC] 已注入远端 End-of-candidates, generation=' + iceGeneration);
          return;
        }
        if (!cand || !cand.candidate) return;
        recordObservedCandidate(observedRemoteCandidates, cand);
        console.log('[WebRTC] 注入远端候选者:', cand.candidate);
        if (typeof RTCIceCandidate === 'function') {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } else {
          await pc.addIceCandidate(cand);
        }
      } catch (e) {
        console.warn('[WebRTC] 添加候选者异常:', e);
      }
    }

    async function flushCandidatesForGeneration(generation) {
      const queued = pendingCandidatesByGeneration.get(generation) || [];
      pendingCandidatesByGeneration.delete(generation);
      while (queued.length > 0) {
        const cand = queued.shift();
        await safeAddIceCandidate(cand);
      }
    }

    function initWebRTC() {
      // 首代只收集 host/STUN 候选；只有一次受控的 ICE restart 才会启用 TURN。
      pc = new RTCPeerConnection(directRtcConfig);

      function handleConnectionFailed(reason) {
        if (iceRestartInProgress) {
          console.log('[ICE] 忽略 ICE restart 期间旧代次产生的 failed 事件:', reason);
          return;
        }
        if (isController && iceMode === 'auto' && !relayFallbackStarted && turnIceServers.length > 0) {
          void beginRelayFallback(reason);
          return;
        }
        if (!isController && iceMode === 'auto' && icePhase === 'direct' && turnIceServers.length > 0) {
          const waiting = document.getElementById('statsBar');
          if (waiting) waiting.innerText = 'P2P 直连未建立，等待对端切换中继...';
          return;
        }
        stopStatsPolling();
        clearDirectFallbackTimer();
        console.warn('[WebRTC] 连接中断或失败:', reason);
        const stats = document.getElementById('statsBar');
        if (stats) stats.innerText = '连接中断 (' + reason + ')';
        if (!iceDiagState.reported) {
          iceDiagState.reported = true;
          void reportIceDiagnostics('ICE/连接失败: ' + reason);
        }
        if (window.remoteAssistSession) {
          window.remoteAssistSession.disconnect('connection-failed');
        }
      }

      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE 状态变更为:', pc.iceConnectionState);
        const stats = document.getElementById('statsBar');
        if (pc.iceConnectionState === 'checking') {
          scheduleRelayFallback();
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          notifyConnected();
          if (stats) stats.innerText = '已连接 ● 正在识别链路';
        } else if (pc.iceConnectionState === 'failed') {
          handleConnectionFailed('ICE 穿透失败');
        } else if (pc.iceConnectionState === 'disconnected') {
          if (stats) stats.innerText = '连接波动中...';
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] 连接状态变更为:', pc.connectionState);
        const stats = document.getElementById('statsBar');
        if (pc.connectionState === 'connected') {
          if (offerWaitTimer) {
            clearTimeout(offerWaitTimer);
            offerWaitTimer = null;
          }
          notifyConnected();
          if (stats) stats.innerText = '已连接 ● 正在识别链路';
        } else if (pc.connectionState === 'failed') {
          if (offerWaitTimer) {
            clearTimeout(offerWaitTimer);
            offerWaitTimer = null;
          }
          handleConnectionFailed('WebRTC 握手失败');
        } else if (pc.connectionState === 'disconnected') {
          if (stats) stats.innerText = '连接断开 (disconnected)';
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && window.remoteAssistSession) {
          recordObservedCandidate(observedLocalCandidates, event.candidate);
          console.log('[WebRTC] 本地候选者收集:', event.candidate.type, event.candidate.protocol, event.candidate.address || event.candidate.candidate);
          const cand = event.candidate.toJSON ? event.candidate.toJSON() : {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          };
          sendIceSignal('ice-candidate', { candidate: cand });
        } else if (!event.candidate) {
          console.log('[WebRTC] 本地 ICE 候选者收集完成 (End-of-candidates)');
          sendIceSignal('ice-candidate', { candidate: null });
        }
      };

      pc.onicecandidateerror = (event) => {
        console.warn('[WebRTC] ICE 候选者错误:', event.url, event.errorCode, event.errorText);
        try {
          const key = String(event.url) + '|' + String(event.errorCode);
          if (!iceErrors.some(function (x) { return x.key === key; })) {
            iceErrors.push({ key: key, url: event.url, code: event.errorCode, text: event.errorText, address: event.address, port: event.port });
          }
        } catch (e) {}
      };

      if (isController) {
        try {
          pc.addTransceiver('video', { direction: 'recvonly' });
          preferHardwareH264();
        } catch (e) {
          console.warn('[WebRTC] addTransceiver warning:', e);
        }

        dataChannel = pc.createDataChannel('doujiao-input', { ordered: true });
        // 鼠标移动专用：不可靠无序，丢包不重传不阻塞后续坐标（消除队头阻塞）
        pointerChannel = pc.createDataChannel('doujiao-pointer', { ordered: false, maxRetransmits: 0 });
        pointerChannel.onopen = () => console.log('[WebRTC] 控制端 PointerChannel 打开');
        dataChannel.onopen = () => {
          console.log('[WebRTC] 控制端 DataChannel 打开');
          notifyConnected();
          // 通道就绪后同步一次当前画质档位与帧率
          sendQuality(desiredQuality);
          sendFps(desiredFps);
          if (permission === 'control') sendRemoteCursorState(localCursorEnabled);
          // 若 doujiao-data 也已处于 open 状态，确保已向主进程上报 ready 并更新 UI
          if (dataDataChannel && dataDataChannel.readyState === 'open') {
            setTransferReady(true);
            if (window.remoteAssistSession && window.remoteAssistSession.transfer) {
              window.remoteAssistSession.transfer.notifyReady();
            }
          }
        };

        // 控制端：接收受控端的画质/帧率回执，把「切换中」更新为确定的「已切换」反馈
        dataChannel.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data && data.kind === 'control' && data.action === 'quality-applied') {
              const status = document.getElementById('qualityStatus');
              if (status) status.textContent = '已切换: ' + (QUALITY_LABELS[data.profileId] || data.profileId);
              if (pendingQuality === data.profileId) pendingQuality = null;
              return;
            }
            if (data && data.kind === 'control' && data.action === 'fps-applied') {
              const status = document.getElementById('fpsStatus');
              if (status) status.textContent = '已切换: ' + data.fps + 'fps';
              if (pendingFps === data.fps) pendingFps = null;
              return;
            }
            if (data && data.kind === 'control' && data.action === 'set-remote-cursor') {
              return;
            }
            if (data && data.kind === 'control' && data.action === 'media-stats') {
              if (typeof data.encodeMs === 'number') lastEncodeStats.encodeMs = data.encodeMs;
              if (data.codec) lastEncodeStats.codec = data.codec;
              if (data.encoderImplementation) lastEncodeStats.encoderImplementation = data.encoderImplementation;
              if (data.qualityLimitationReason) lastEncodeStats.qualityLimitationReason = data.qualityLimitationReason;
            }
          } catch {}
        };

        // 新增：传输/聊天数据通道（与输入通道分离，避免大帧阻塞鼠标键盘事件）
        dataDataChannel = pc.createDataChannel('doujiao-data', { ordered: true });
        wireDataChannel(dataDataChannel);

        pc.ontrack = (event) => {
          console.log('[WebRTC] 接收到远端桌面流轨道, id:', event.track ? event.track.id : 'unknown');
          const video = document.getElementById('remoteVideo');
          // 尽量压小抖动缓冲，降低端到端延迟
          try {
            const receiver = event.receiver;
            if (receiver) {
              if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0;
              if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0;
            }
          } catch (e) {
            console.warn('[WebRTC] 设置低延迟抖动缓冲失败:', e);
          }
          if (video) {
            // 最低延迟渲染：禁用浏览器额外缓冲
            try {
              if ('latencyHint' in video) video.latencyHint = 0;
            } catch (e) {}
            if (event.streams && event.streams[0]) {
              video.srcObject = event.streams[0];
            } else if (event.track) {
              video.srcObject = new MediaStream([event.track]);
            }
            video.play().catch(e => console.warn('[WebRTC] 播放远端视频异常:', e));
            const stats = document.getElementById('statsBar');
            if (stats) stats.innerText = '桌面流已接入';
          }
          notifyConnected();
        };

        // 首代 Offer 只携带 host/STUN 候选；TURN 回退由 checking 计时器触发新的 ICE 代次。
        createAndSendOffer(false).catch(err => {
          console.error('[WebRTC] 生成 Offer 失败:', err);
        });

        setupControllerInput();
      } else {
        // 受控端：启动桌面屏幕流捕获（带超时重试）
        localStreamPromise = captureScreen();

        // 诊断看门狗：如果受控端就绪 15 秒内未收到任何 Offer 信令，输出明确诊断
        offerWaitTimer = setTimeout(() => {
          if (!pc || pc.remoteDescription) return;
          console.warn('[WebRTC] ⚠ 等待控制端 Offer 超时 (15s)，可能原因：控制端未创建会话窗口、信令在网关被拦截或对端离线');
          const status = document.getElementById('statsBar');
          if (status) status.innerText = '等待控制端发起协商超时...';
        }, 15000);

        pc.ondatachannel = (event) => {
          const channel = event.channel;
          // 不可靠鼠标移动通道：直接转发，不经过可靠通道
          if (channel.label === 'doujiao-pointer') {
            channel.onmessage = (msg) => {
              try {
                const data = JSON.parse(msg.data);
                window.remoteAssistSession.sendInput(data);
              } catch {}
            };
            return;
          }
          // 传输/聊天通道按 label 分流，交由帧桥接处理
          if (channel.label === 'doujiao-data') {
            dataDataChannel = channel;
            wireDataChannel(channel);
            return;
          }
          // 既有 doujiao-input 处理（键鼠 / 画质）保持不变
          channel.onopen = () => {
            console.log('[WebRTC] 受控端 DataChannel 打开');
            notifyConnected();
          };
          channel.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);
              // 控制指令（如画质切换 / 帧率切换）与输入事件分流
              if (data && data.kind === 'control' && data.action === 'set-quality') {
                controllerDesiredQuality = data.profileId;
                applyQuality(data.profileId);
                return;
              }
              if (data && data.kind === 'control' && data.action === 'set-fps') {
                controllerDesiredFps = Number(data.fps) || 60;
                applyFps(controllerDesiredFps);
                return;
              }
              if (data && data.kind === 'control' && data.action === 'set-remote-cursor') {
                applyRemoteCursorHidden(data.hidden);
                return;
              }
              // 画质回执/帧率回执/编码统计是本端发给控制端的确认消息，受控端必须忽略，切勿当作输入事件转发
              if (data && data.kind === 'control' && data.action === 'quality-applied') {
                return;
              }
              if (data && data.kind === 'control' && data.action === 'fps-applied') {
                return;
              }
              if (data && data.kind === 'control' && data.action === 'media-stats') {
                return;
              }
              window.remoteAssistSession.sendInput(data);
            } catch {}
          };
        };
      }

      window.remoteAssistSession.onSignal(async (sig) => {
        if (!pc || !sig) return;
        console.log('[WebRTC] 接收到信令:', sig.type);

        try {
          if (sig.type === 'offer' && !isController) {
            if (offerWaitTimer) {
              clearTimeout(offerWaitTimer);
              offerWaitTimer = null;
            }
            const incomingGeneration = getSignalGeneration(sig, iceGeneration);
            if (incomingGeneration < iceGeneration) {
              console.warn('[ICE] 忽略旧代次 Offer:', incomingGeneration, '<', iceGeneration);
              return;
            }
            const incomingPhase = sig.icePhase === 'relay-fallback' || incomingGeneration > 0 ? 'relay-fallback' : 'direct';
            if (incomingGeneration > iceGeneration) {
              iceGeneration = incomingGeneration;
              icePhase = incomingPhase;
              discardStaleCandidateQueues();
            }
            if (incomingPhase === 'relay-fallback') {
              relayFallbackStarted = true;
              iceRestartInProgress = true;
              icePhase = 'relay-fallback';
              clearDirectFallbackTimer();
              pc.setConfiguration(fullRtcConfig);
              const status = document.getElementById('statsBar');
              if (status) status.innerText = 'P2P 直连未建立，正在建立中继...';
            }
            if (localStreamPromise) {
              const stream = await withTimeout(localStreamPromise, CAPTURE_TIMEOUT_MS * CAPTURE_MAX_ATTEMPTS + 2000, null);
              if (!stream && window.remoteAssistSession) {
                console.error('[WebRTC] 受控端未能成功捕获屏幕流，取消会话');
                window.remoteAssistSession.disconnect('screen-capture-failed');
                return;
              }
            }
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            remoteDescriptionGeneration = iceGeneration;

            // 确保视频 Transceiver 方向为 sendonly
            try {
              const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
              const videoTransceiver = transceivers.find(t =>
                (t.receiver && t.receiver.track && t.receiver.track.kind === 'video') ||
                (t.sender && t.sender.track && t.sender.track.kind === 'video')
              );
              if (videoTransceiver) {
                videoTransceiver.direction = 'sendonly';
              }
            } catch (e) {
              console.warn('[WebRTC] 设置视频 Transceiver 异常:', e);
            }

            preferHardwareH264();
            const answer = await pc.createAnswer();
            const mungedAnswer = { type: answer.type, sdp: mungeLowLatencySdp(answer.sdp) };
            await pc.setLocalDescription(mungedAnswer);

            // 在 localDescription 设置后再消费候选者，防止 InvalidStateError
            await flushCandidatesForGeneration(iceGeneration);

            const localDesc = pc.localDescription.toJSON ? pc.localDescription.toJSON() : {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp
            };
            sendIceSignal('answer', { sdp: localDesc });
            iceRestartInProgress = false;
          } else if (sig.type === 'answer' && isController) {
            const incomingGeneration = getSignalGeneration(sig, iceGeneration);
            if (incomingGeneration < iceGeneration) {
              console.warn('[ICE] 忽略旧代次 Answer:', incomingGeneration, '<', iceGeneration);
              return;
            }
            if (incomingGeneration > iceGeneration) {
              console.warn('[ICE] 忽略超前代次 Answer:', incomingGeneration, '>', iceGeneration);
              return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
            remoteDescriptionGeneration = iceGeneration;
            await flushCandidatesForGeneration(iceGeneration);
            iceRestartInProgress = false;
          } else if (sig.type === 'ice-candidate' && Object.prototype.hasOwnProperty.call(sig, 'candidate')) {
            const incomingGeneration = getSignalGeneration(sig, iceGeneration);
            if (incomingGeneration < iceGeneration) {
              console.warn('[ICE] 忽略旧代次候选:', incomingGeneration, '<', iceGeneration);
              return;
            }
            if (sig.candidate) recordObservedCandidate(observedRemoteCandidates, sig.candidate);
            if (incomingGeneration > iceGeneration) {
              queueCandidate(incomingGeneration, sig.candidate);
              return;
            }
            const isReady = remoteDescriptionGeneration === iceGeneration && pc.remoteDescription && pc.remoteDescription.type;
            if (isReady) {
              await safeAddIceCandidate(sig.candidate);
            } else {
              queueCandidate(incomingGeneration, sig.candidate);
            }
          }
        } catch (err) {
          console.error('[WebRTC] 处理信令异常:', sig.type, err);
          // offer/answer 是握手关键信令，处理失败会永久卡在 connecting，直接失败退出
          if ((sig.type === 'offer' || sig.type === 'answer') && window.remoteAssistSession) {
            window.remoteAssistSession.disconnect('handshake-error');
          }
        }
      });
    }

    function setupControllerInput() {
      const video = document.getElementById('remoteVideo');
      const disconnectBtn = document.getElementById('disconnectBtn');
      if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
          window.remoteAssistSession.disconnect('user-clicked');
        });
      }

      const qualitySelect = document.getElementById('qualitySelect');
      if (qualitySelect) {
        qualitySelect.value = desiredQuality;
        qualitySelect.addEventListener('change', () => {
          const value = qualitySelect.value;
          // 立即给出「切换中」反馈，并记录待确认档位（受控端回执前一直等待）
          pendingQuality = value;
          const status = document.getElementById('qualityStatus');
          if (status) status.textContent = '切换中...';
          sendQuality(value);
          // 6 秒仍未收到 quality-applied：提示超时（若期间又切了别的档位则不覆盖新状态）
          setTimeout(() => {
            if (pendingQuality === value) {
              const el = document.getElementById('qualityStatus');
              if (el) el.textContent = '切换超时';
            }
          }, 6000);
        });
      }

      const fpsSelect = document.getElementById('fpsSelect');
      if (fpsSelect) {
        fpsSelect.value = String(desiredFps);
        fpsSelect.addEventListener('change', () => {
          const value = Number(fpsSelect.value) || 60;
          pendingFps = value;
          const status = document.getElementById('fpsStatus');
          if (status) status.textContent = '切换中...';
          sendFps(value);
          setTimeout(() => {
            if (pendingFps === value) {
              const el = document.getElementById('fpsStatus');
              if (el) el.textContent = '切换超时';
            }
          }, 6000);
        });
      }
      setupFullscreen();

      // 传输/聊天面板：仅查看会话隐藏发送入口；打开接收文件夹保持可用
      const transferApi = window.remoteAssistSession ? window.remoteAssistSession.transfer : null;
      const chatLog = document.getElementById('chatLog');
      // 初始化时若传输通道已打开，主动补正就绪态
      if (dataDataChannel && dataDataChannel.readyState === 'open') {
        setTransferReady(true);
      }
      if (transferApi) {
        // 仅当拥有控制权限时才接线「发送文件」与聊天输入；仅查看会话下不注册
        if (permission === 'control') {
          const sendFilesBtn = document.getElementById('sendFilesBtn');
          if (sendFilesBtn) {
            sendFilesBtn.addEventListener('click', () => {
              // 再次确认通道就绪态，如果已处于 open 态则纠偏并放行
              const isOpen = Boolean(dataDataChannel && dataDataChannel.readyState === 'open');
              if (!isOpen) {
                const status = document.getElementById('transferStatus');
                if (status) status.textContent = '传输通道未建立，无法发送文件';
                return;
              }
              setTransferReady(true);
              transferApi.requestSendFiles();
            });
          }
          const chatInput = document.getElementById('chatInput');
          if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && chatInput.value.trim()) {
                transferApi.sendChat(chatInput.value.trim());
                appendChat('我: ' + chatInput.value.trim());
                chatInput.value = '';
              }
            });
          }
        }
        const openFolderBtn = document.getElementById('openFolderBtn');
        if (openFolderBtn) {
          openFolderBtn.addEventListener('click', () => transferApi.openReceiveFolder());
        }
        transferApi.onState((state) => {
          const status = document.getElementById('transferStatus');
          if (status) {
            // 新的传输状态到达时清除上一次的错误红色
            status.style.color = '';
            status.textContent = (state.direction === 'outgoing' ? '发送' : '接收') + ' ' + state.transferredBytes + '/' + state.totalBytes + ' · ' + state.status;
          }
        });
        // 主进程发送失败（如无可用传输通道）时，把错误显示到状态栏
        transferApi.onError((msg) => {
          const s = document.getElementById('transferStatus');
          if (s) {
            s.textContent = '发送失败: ' + msg;
            s.style.color = '#f87171';
          }
        });
        transferApi.onChat((text) => appendChat('对方: ' + text));
        // 主进程文件选择结果回执（仅作 UI 反馈）
        transferApi.onPickResult((paths) => {
          const status = document.getElementById('transferStatus');
          if (status && paths && paths.length) {
            status.textContent = '已选择 ' + paths.length + ' 个文件';
          }
        });
      }
      function appendChat(line) {
        if (!chatLog) return;
        chatLog.textContent = line;
        chatLog.title = line;
      }

      if (permission !== 'control' || !video) return;

      // 控制端默认隐藏本地光标，仅显示远端画面内的真实光标，彻底消除双光标/重影现象
      const cursorBtn = document.getElementById('cursorModeBtn');
      video.style.cursor = 'none';
      if (cursorBtn) {
        cursorBtn.textContent = '光标: 仅远端';
        cursorBtn.style.background = '#334155';
        cursorBtn.addEventListener('click', () => {
          localCursorEnabled = !localCursorEnabled;
          video.style.cursor = localCursorEnabled ? 'default' : 'none';
          cursorBtn.textContent = localCursorEnabled ? '光标: 本地+远端' : '光标: 仅远端';
          cursorBtn.style.background = localCursorEnabled ? '#0284c7' : '#334155';
          cursorBtn.title = localCursorEnabled
            ? '当前为本地+远端双光标(适合高延迟网络)，点击切换为仅远端光标'
            : '当前为仅远端光标(无重影)，点击开启本地即时光标';
        });
      }

      // 精确坐标换算：消除 object-fit: contain 上下/左右黑边带来的非线性拉伸与偏差
      function getNormalizedCoords(e) {
        const rect = video.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        let renderWidth = rect.width;
        let renderHeight = rect.height;
        let offsetX = 0;
        let offsetY = 0;

        if (vWidth > 0 && vHeight > 0) {
          const videoRatio = vWidth / vHeight;
          const containerRatio = rect.width / rect.height;

          if (containerRatio > videoRatio) {
            // 左右留黑边 (Pillarbox)
            renderHeight = rect.height;
            renderWidth = renderHeight * videoRatio;
            offsetX = (rect.width - renderWidth) / 2;
          } else {
            // 上下留黑边 (Letterbox)
            renderWidth = rect.width;
            renderHeight = renderWidth / videoRatio;
            offsetY = (rect.height - renderHeight) / 2;
          }
        }

        const clientX = e.clientX - rect.left - offsetX;
        const clientY = e.clientY - rect.top - offsetY;

        const normX = Math.max(0, Math.min(1, clientX / renderWidth));
        const normY = Math.max(0, Math.min(1, clientY / renderHeight));

        return { normX, normY };
      }

      function sendUrgentInput(evt) {
        const payload = JSON.stringify(evt);
        if (pointerChannel && pointerChannel.readyState === 'open') {
          pointerChannel.send(payload);
        }
        if (evt.type !== 'pointer-move') {
          if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(payload);
          }
        } else if (!pointerChannel || pointerChannel.readyState !== 'open') {
          if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(payload);
          }
        }
      }

      function sendReliableInput(evt) {
        if (dataChannel && dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify(evt));
        }
      }

      function flushPointerMove() {
        if (!pendingPointerMove) return;
        const coords = pendingPointerMove;
        pendingPointerMove = null;
        lastPointerSendTime = performance.now();
        const evt = {
          type: 'pointer-move',
          seq: seq++,
          x: coords.normX,
          y: coords.normY
        };
        sendUrgentInput(evt);
      }

      function sendPointerMove(coords) {
        const now = performance.now();
        const elapsed = now - lastPointerSendTime;

        if (elapsed >= 8) {
          // 距上次已超过 8ms：立即发送（首帧 0ms 延迟）
          if (pointerThrottleTimer) {
            clearTimeout(pointerThrottleTimer);
            pointerThrottleTimer = null;
          }
          pendingPointerMove = null;
          lastPointerSendTime = now;
          const evt = {
            type: 'pointer-move',
            seq: seq++,
            x: coords.normX,
            y: coords.normY
          };
          sendUrgentInput(evt);
        } else {
          // 8ms 内高频移动：保留最新坐标，满 8ms 触发冲刷（最高 125Hz 顺滑传输）
          pendingPointerMove = coords;
          if (!pointerThrottleTimer) {
            pointerThrottleTimer = setTimeout(() => {
              pointerThrottleTimer = null;
              flushPointerMove();
            }, Math.max(1, 8 - elapsed));
          }
        }
      }

      video.addEventListener('mousemove', (e) => {
        const coords = getNormalizedCoords(e);
        if (!coords) return;
        sendPointerMove(coords);
      });

      const sendButton = (button, pressed) => {
        // 点击前先确保最新移动坐标已被立即冲刷
        flushPointerMove();
        const evt = {
          type: 'pointer-button',
          seq: seq++,
          button,
          pressed
        };
        sendUrgentInput(evt);
      };

      video.addEventListener('mousedown', (e) => {
        const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
        sendButton(btn, true);
      });

      video.addEventListener('mouseup', (e) => {
        const btn = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
        sendButton(btn, false);
      });

      video.addEventListener('wheel', (e) => {
        e.preventDefault();
        const evt = {
          type: 'wheel',
          seq: seq++,
          deltaX: e.deltaX,
          deltaY: e.deltaY
        };
        sendUrgentInput(evt);
      }, { passive: false });

      video.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('keydown', (e) => {
        const evt = {
          type: 'key',
          seq: seq++,
          code: e.code,
          pressed: true,
          modifiers: [
            e.ctrlKey && 'Control',
            e.shiftKey && 'Shift',
            e.altKey && 'Alt'
          ].filter(Boolean)
        };
        sendReliableInput(evt);
      });

      window.addEventListener('keyup', (e) => {
        const evt = {
          type: 'key',
          seq: seq++,
          code: e.code,
          pressed: false,
          modifiers: []
        };
        sendReliableInput(evt);
      });
    }

    // 剪贴板同步指示灯：初始文案由主进程注入；应用远端剪贴板时短暂闪烁提示
    function setupClipboardBadge() {
      const badge = document.getElementById('clipboardBadge');
      if (!badge) return;
      const baseText = clipboardEnabled ? '剪贴板同步中' : '剪贴板同步关闭';
      const baseColor = '#0ea5e9';
      badge.textContent = baseText;
      const api = window.remoteAssistSession ? window.remoteAssistSession.transfer : null;
      if (api && typeof api.onClipboardApplied === 'function') {
        api.onClipboardApplied(() => {
          badge.textContent = '剪贴板已同步';
          badge.style.background = '#10b981';
          setTimeout(() => {
            badge.textContent = baseText;
            badge.style.background = baseColor;
          }, 1500);
        });
      }
    }

    if (window.remoteAssistSession) {
      initWebRTC();
    }
    setupClipboardBadge();
