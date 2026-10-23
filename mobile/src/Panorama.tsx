import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronRight,
  Compass,
  Film,
  Focus,
  Link2,
  Loader2,
  Maximize,
  Move,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { loadStored, store, type Step } from "./navigation";
import "./Panorama.css";

export type Media = { src: string; name: string; id: string; local: boolean };
type Cue = {
  id: string;
  time: number;
  yaw: number;
  text: string;
  step: number;
};
type Props = {
  media: Media | null;
  onMedia: (media: Media) => void;
  steps: Step[];
  routeKey: string;
  onCue: (step: number, text: string) => void;
  notice: (text: string) => void;
};
const clock = (t: number) => {
  const seconds = Math.max(0, Number.isFinite(t) ? Math.floor(t) : 0);
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ""}${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
const heading = (value: number) => ((value % 360) + 360) % 360;
function readCues(key: string): Cue[] {
  const data = loadStored<unknown>(key, []);
  if (!Array.isArray(data)) return [];
  const ids = new Set<string>();
  return data
    .filter((c): c is Cue => {
      if (
        !c ||
        typeof c.id !== "string" ||
        !c.id ||
        ids.has(c.id) ||
        typeof c.text !== "string" ||
        !c.text.trim() ||
        c.text.length > 100 ||
        !Number.isFinite(c.time) ||
        c.time < 0 ||
        !Number.isFinite(c.yaw) ||
        !Number.isInteger(c.step) ||
        c.step < -1
      )
        return false;
      ids.add(c.id);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}
export default function Panorama({
  media,
  onMedia,
  steps,
  routeKey,
  onCue,
  notice,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLDivElement>(null),
    arrow = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLElement>(null),
    textInput = useRef<HTMLInputElement>(null),
    addButton = useRef<HTMLButtonElement>(null);
  const yaw = useRef(0),
    pitch = useRef(0),
    renderedView = useRef({ yaw: 0, pitch: 0 }),
    drag = useRef<{ x: number; y: number; id: number } | null>(null),
    resumeAfterEdit = useRef(false);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [buffering, setBuffering] = useState(true),
    [ready, setReady] = useState(false),
    [hasPlayed, setHasPlayed] = useState(false),
    [attempt, setAttempt] = useState(0),
    [aspectWarning, setAspectWarning] = useState(false),
    [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState(""),
    [annotating, setAnnotating] = useState(false),
    [cueStep, setCueStep] = useState(0),
    [cueText, setCueText] = useState("沿此方向前行"),
    [capture, setCapture] = useState({ time: 0, yaw: 0 }),
    [deletedCue, setDeletedCue] = useState<Cue | null>(null);
  const key = `atlas-go-cues:${media?.id ?? "none"}:${routeKey}`;
  const [cues, setCues] = useState<Cue[]>([]);
  const lastCue = useRef("");
  const cue = [...cues]
    .reverse()
    .find((c) => c.time <= time && (c.step === -1 || c.step < steps.length));
  const activeCue = useRef(cue);
  activeCue.current = cue;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  const closeEditor = useCallback(
    (resume = true) => {
      setAnnotating(false);
      addButton.current?.focus();
      if (resume && resumeAfterEdit.current && !document.hidden) {
        void video.current
          ?.play()
          .catch(() => notice("点击播放，继续查看全景视频"));
      }
      resumeAfterEdit.current = false;
    },
    [notice],
  );
  useEffect(() => {
    const back = (event: Event) => {
      if (annotating) {
        event.preventDefault();
        closeEditor();
      }
    };
    document.addEventListener("atlas-native-back", back);
    return () => document.removeEventListener("atlas-native-back", back);
  }, [annotating, closeEditor]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        resumeAfterEdit.current = false;
        video.current?.pause();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    setCues(readCues(key));
    setDeletedCue(null);
    lastCue.current = "";
  }, [key]);
  useEffect(() => {
    if (playing && cue && cue.id !== lastCue.current) {
      lastCue.current = cue.id;
      onCueRef.current(cue.step, cue.text);
    }
    if (!cue) lastCue.current = "";
  }, [cue?.id, playing]);
  useEffect(() => {
    if (!annotating) return;
    textInput.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditor();
      }
      if (event.key !== "Tab") return;
      const nodes = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, [annotating, closeEditor]);
  useEffect(() => {
    if (!media || !host.current || !video.current) return;
    setTime(0);
    setDuration(0);
    setPlaying(false);
    setError("");
    setBuffering(true);
    setReady(false);
    setHasPlayed(false);
    setAspectWarning(false);
    yaw.current = 0;
    pitch.current = 0;
    renderedView.current = { yaw: 0, pitch: 0 };
    drag.current = null;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setError(
        "设备暂时无法显示全景。请重试，或更新 Android System WebView 后重新打开。",
      );
      return;
    }
    const element = host.current,
      v = video.current;
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    const texture = new THREE.VideoTexture(v);
    texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.SphereGeometry(30, 64, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    scene.add(new THREE.Mesh(geometry, material));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.appendChild(renderer.domElement);
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const onLost = (event: Event) => {
      event.preventDefault();
      v.pause();
      setError("全景画面已中断。点击重新载入，即可恢复渲染。");
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    let raf = 0,
      smoothedYaw = 0,
      smoothedPitch = 0,
      previous = performance.now();
    const world = new THREE.Vector3(),
      projected = new THREE.Vector3(),
      view = new THREE.Vector3();
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (document.hidden) return;
      const smoothing = 1 - Math.exp(-18 * delta);
      smoothedYaw += (yaw.current - smoothedYaw) * smoothing;
      smoothedPitch += (pitch.current - smoothedPitch) * smoothing;
      renderedView.current.yaw = smoothedYaw;
      renderedView.current.pitch = smoothedPitch;
      const radians = Math.PI / 180,
        a = smoothedYaw * radians,
        p = smoothedPitch * radians;
      camera.lookAt(
        Math.sin(a) * Math.cos(p),
        Math.sin(p),
        -Math.cos(a) * Math.cos(p),
      );
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      if (arrow.current) {
        const c = activeCue.current;
        if (!c) {
          arrow.current.style.opacity = "0";
          return;
        }
        const angle = c.yaw * radians;
        world.set(Math.sin(angle) * 8, -0.8, -Math.cos(angle) * 8);
        projected.copy(world).project(camera);
        const front = world.dot(camera.getWorldDirection(view)) > 0;
        arrow.current.style.opacity =
          front && Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.85
            ? "1"
            : "0";
        arrow.current.style.left = `${((projected.x + 1) / 2) * 100}%`;
        arrow.current.style.top = `${((1 - projected.y) / 2) * 100}%`;
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      v.pause();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [media?.src, attempt]);
  const saveCues = (next: Cue[]) => {
    const sorted = [...next].sort((a, b) => a.time - b.time);
    setCues(sorted);
    const saved = store(key, sorted);
    if (!saved) notice("方向已添加，但未能保存到本机。请检查设备存储空间。");
    return saved;
  };
  const selectFile = (file?: File) => {
    if (!file) return;
    if (!file.size) {
      notice("这个视频文件为空，请重新选择");
      return;
    }
    if (file.type && !file.type.startsWith("video/")) {
      notice("请选择 MP4、WebM 或其他视频文件");
      return;
    }
    video.current?.pause();
    onMedia({
      src: URL.createObjectURL(file),
      name: file.name,
      id: `${file.name}:${file.size}:${file.lastModified}`,
      local: true,
    });
  };
  const play = async () => {
    if (!video.current || error) return;
    try {
      if (video.current.paused) {
        if (video.current.ended) {
          video.current.currentTime = 0;
          lastCue.current = "";
        }
        await video.current.play();
      } else video.current.pause();
    } catch {
      setError("视频暂时无法播放。请重试，或选择设备支持的 MP4 文件。");
    }
  };
  const openEditor = () => {
    resumeAfterEdit.current = !video.current?.paused;
    video.current?.pause();
    yaw.current = renderedView.current.yaw;
    pitch.current = renderedView.current.pitch;
    setCapture({
      time: video.current?.currentTime ?? time,
      yaw: heading(yaw.current),
    });
    setCueStep(Math.min(cueStep, Math.max(0, steps.length - 1)));
    setAnnotating(true);
  };
  const seek = (target: number) => {
    if (!video.current || !duration) return;
    const bounded = Math.min(duration, Math.max(0, target));
    video.current.currentTime = bounded;
    setTime(bounded);
    lastCue.current = "";
  };
  return (
    <div className="panorama panorama-product" ref={root}>
      {media ? (
        <>
          <div
            className="panorama-render"
            ref={host}
            tabIndex={0}
            role="region"
            aria-label="全景画面，可拖动或使用方向键环视"
            onKeyDown={(e) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  e.key,
                )
              )
                return;
              e.preventDefault();
              if (e.key === "ArrowLeft") yaw.current -= 8;
              if (e.key === "ArrowRight") yaw.current += 8;
              if (e.key === "ArrowUp")
                pitch.current = Math.min(75, pitch.current + 8);
              if (e.key === "ArrowDown")
                pitch.current = Math.max(-75, pitch.current - 8);
            }}
            onPointerDown={(e) => {
              if (drag.current) return;
              drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current || drag.current.id !== e.pointerId) return;
              yaw.current -= (e.clientX - drag.current.x) * 0.18;
              pitch.current = Math.max(
                -75,
                Math.min(
                  75,
                  pitch.current + (e.clientY - drag.current.y) * 0.18,
                ),
              );
              drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
          />
          <video
            ref={video}
            key={media.src}
            className="texture-video"
            src={media.src}
            playsInline
            muted
            crossOrigin={media.local ? undefined : "anonymous"}
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(Number.isFinite(v.duration) ? v.duration : 0);
              setAspectWarning(
                v.videoWidth > 0 &&
                  Math.abs(v.videoWidth / v.videoHeight - 2) > 0.2,
              );
            }}
            onLoadedData={() => {
              setReady(true);
              setBuffering(false);
            }}
            onCanPlay={() => {
              setReady(true);
              setBuffering(false);
            }}
            onWaiting={() => setBuffering(true)}
            onStalled={() => setBuffering(true)}
            onSeeking={() => setBuffering(true)}
            onSeeked={() => setBuffering(false)}
            onPlaying={() => {
              setBuffering(false);
              setHasPlayed(true);
            }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={(e) => {
              setBuffering(false);
              const code = e.currentTarget.error?.code;
              setError(
                code === 3 || code === 4
                  ? "此视频格式无法解码。请使用设备支持的 H.264 MP4 或 WebM 文件。"
                  : "视频未能载入。请检查网络与文件；在线直链还需要允许跨域访问。",
              );
            }}
          />
          <div className="pano-direction" ref={arrow} aria-hidden="true">
            <div className="direction-disc">
              <ArrowUp size={38} />
            </div>
            <span>{cue?.text}</span>
          </div>
          <div className="pano-top">
            <span className="pano-badge">
              <Compass size={14} />
              360° 全景 <i />
              {media.local ? "本地素材" : "在线素材"}
            </span>
            <div>
              <button
                aria-label="视角归中"
                onClick={() => {
                  yaw.current = 0;
                  pitch.current = 0;
                }}
              >
                <Focus size={20} />
              </button>
              <button
                aria-label="切换全屏"
                onClick={() => {
                  if (
                    !document.fullscreenElement &&
                    !root.current?.requestFullscreen
                  ) {
                    notice("当前设备不支持页面全屏");
                    return;
                  }
                  const request = document.fullscreenElement
                    ? document.exitFullscreen()
                    : root.current?.requestFullscreen();
                  void request?.catch(() => notice("当前设备不支持页面全屏"));
                }}
              >
                <Maximize size={20} />
              </button>
            </div>
          </div>
          {error ? (
            <div className="pano-error" role="alert">
              <AlertCircle size={25} />
              <strong>暂时无法打开这段全景</strong>
              <p>{error}</p>
              <button
                onClick={() => {
                  setAttempt((v) => v + 1);
                  video.current?.load();
                }}
              >
                <RotateCcw size={16} />
                重新载入
              </button>
              <label className="pano-file-action">
                <Upload size={16} />
                选择其他视频
                <input
                  type="file"
                  aria-label="选择其他全景视频"
                  accept="video/*"
                  onChange={(e) => selectFile(e.target.files?.[0])}
                />
              </label>
            </div>
          ) : buffering && (playing || !ready) ? (
            <div className="pano-loading" role="status">
              <Loader2 size={26} />
              <span>{ready ? "正在缓冲画面…" : "正在准备全景画面…"}</span>
              {!ready && (
                <button onClick={() => void play()}>点击播放以继续载入</button>
              )}
            </div>
          ) : !hasPlayed ? (
            <button
              className="pano-start"
              aria-label="播放全景视频"
              onClick={() => void play()}
            >
              <span>
                <Play size={30} fill="currentColor" />
              </span>
              <strong>走进这段全景</strong>
              <small>拖动屏幕，自由环视</small>
            </button>
          ) : null}
          <div className="pano-bottom">
            <div className="pano-caption">
              <span className="pano-caption-kicker">
                {cue ? "当前方向指引" : "全景路线预览"}
              </span>
              <strong>{cue?.text ?? "先看清路线，再从容出发"}</strong>
              <span title={media.name}>{media.name}</span>
            </div>
            <div className="video-controls">
              <button
                aria-label={playing ? "暂停视频" : "播放视频"}
                disabled={!!error}
                onClick={() => void play()}
              >
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <span>{clock(time)}</span>
              <input
                aria-label="视频进度"
                aria-valuetext={`${clock(time)}，共 ${clock(duration)}`}
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={Math.min(time, duration || 1)}
                disabled={!duration || !!error}
                onChange={(e) => seek(+e.target.value)}
              />
              <span>{clock(duration)}</span>
            </div>
            <div className="pano-actions">
              <button
                ref={addButton}
                disabled={!ready || !!error}
                onClick={openEditor}
              >
                <Plus size={16} />
                标注方向 <b>{cues.length}</b>
              </button>
              <label>
                <Upload size={16} />
                更换视频
                <input
                  type="file"
                  aria-label="更换全景视频"
                  accept="video/*"
                  onChange={(e) => selectFile(e.target.files?.[0])}
                />
              </label>
            </div>
            <p className="pano-disclaimer">
              <Move size={12} />
              拖动环视 · 方向按视频时间轴展示
            </p>
            {aspectWarning && (
              <p className="pano-aspect-warning">
                <AlertCircle size={13} />
                画幅不是常见的 2:1，环视时可能出现拉伸。
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="pano-empty">
          <div className="orbital-orb">
            <span />
            <span />
            <Film size={44} />
            <b>360°</b>
          </div>
          <p className="eyebrow">EXPLORE BEFORE YOU ARRIVE</p>
          <h1>
            先看见，
            <br />
            再出发。
          </h1>
          <p>
            把真实校园装进全景。
            <br />
            转动视角，让每一个路口更熟悉。
          </p>
          <div className="pano-feature-row">
            <span>
              <Move size={14} />
              自由环视
            </span>
            <span>
              <Compass size={14} />
              方向标注
            </span>
          </div>
          <label className="button primary">
            <Upload size={18} />
            导入全景视频
            <input
              type="file"
              aria-label="导入全景视频"
              accept="video/*"
              onChange={(e) => selectFile(e.target.files?.[0])}
            />
          </label>
          <button
            className="pano-url-toggle"
            aria-expanded={showUrl}
            onClick={() => setShowUrl(!showUrl)}
          >
            <Link2 size={14} />
            使用在线视频链接
            <ChevronRight size={14} />
          </button>
          {showUrl && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const value = new URL(url.trim());
                  if (value.protocol !== "https:") throw new Error();
                  onMedia({
                    src: value.href,
                    name: "在线全景视频",
                    id: value.href,
                    local: false,
                  });
                } catch {
                  notice("请输入有效的 HTTPS 视频直链");
                }
              }}
            >
              <input
                type="url"
                aria-label="全景视频 HTTPS 直链"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/campus.mp4"
              />
              <button type="submit" aria-label="载入视频">
                <ChevronRight size={20} />
              </button>
            </form>
          )}
          <div className="pano-howto">
            <strong>第一次使用全景导航</strong>
            <ol>
              <li>
                <span>01</span>选择自己拍摄的 360° 视频
              </li>
              <li>
                <span>02</span>在路口暂停，拖动视角对准方向
              </li>
              <li>
                <span>03</span>添加方向文字，播放时自动呈现
              </li>
            </ol>
          </div>
          <small>
            支持 2:1 等距柱状投影的单目视频。
            <br />
            尚未接入校园实拍素材；需导入自己的全景视频。
            <br />
            方向根据视频时间播放，当前不提供实时定位。
          </small>
        </div>
      )}
      {annotating && (
        <div
          className="modal-backdrop pano-modal-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <section
            className="modal cue-editor"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pano-cue-title"
            aria-describedby="pano-cue-description"
          >
            <button
              className="close-button"
              aria-label="关闭标注并返回视频"
              onClick={() => closeEditor()}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">DIRECTION STUDIO</span>
            <h2 id="pano-cue-title">把方向留在现场。</h2>
            <p id="pano-cue-description">
              视频已暂停。将当前画面的朝向保存为方向指引；回到视频拖动视角，即可选择下一个方向。
            </p>
            <div className="cue-capture">
              <div>
                <small>视频时间</small>
                <strong>{clock(capture.time)}</strong>
              </div>
              <span>
                <Compass size={15} />
                相对朝向 {Math.round(capture.yaw)}°
              </span>
            </div>
            {steps.length > 0 && (
              <label>
                关联路线步骤
                <select
                  value={cueStep}
                  onChange={(e) => {
                    setCueStep(+e.target.value);
                    setCueText(steps[+e.target.value]?.text ?? "沿此方向前行");
                  }}
                >
                  {steps.map((step, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {step.text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!cueText.trim()) return;
                const existing = cues.find(
                  (c) => Math.abs(c.time - capture.time) < 0.25,
                );
                const next = {
                  id: existing?.id ?? crypto.randomUUID(),
                  time: capture.time,
                  yaw: capture.yaw,
                  text: cueText.trim(),
                  step: steps.length ? cueStep : -1,
                };
                const saved = saveCues([
                  ...cues.filter((c) => c.id !== existing?.id),
                  next,
                ]);
                lastCue.current = "";
                setDeletedCue(null);
                if (saved)
                  notice(
                    existing
                      ? "这个时间点的方向已更新"
                      : "方向已保存，播放到这里时会自动显示",
                  );
                closeEditor();
              }}
            >
              <label htmlFor="pano-cue-text">
                方向文字<span>{cueText.length}/100</span>
              </label>
              <input
                id="pano-cue-text"
                ref={textInput}
                value={cueText}
                maxLength={100}
                placeholder="例如：前方走廊右转"
                onChange={(e) => setCueText(e.target.value)}
              />
              <button
                className="button primary"
                disabled={!cueText.trim()}
                type="submit"
              >
                <Check size={17} />
                保存当前方向
              </button>
            </form>
            <div className="cue-list-heading">
              <strong>已保存的方向</strong>
              <span>{cues.length} 个时间点 · 本机保存</span>
            </div>
            <div className="cue-list">
              {cues.map((c) => (
                <article key={c.id}>
                  <button
                    className="cue-jump"
                    aria-label={`跳转到 ${clock(c.time)}，${c.text}`}
                    onClick={() => {
                      seek(c.time);
                      yaw.current = c.yaw;
                      pitch.current = 0;
                      closeEditor(false);
                    }}
                  >
                    <span>{clock(c.time)}</span>
                    <strong>{c.text}</strong>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    className="cue-delete"
                    aria-label={`删除 ${clock(c.time)} 的方向标注`}
                    onClick={() => {
                      setDeletedCue(c);
                      saveCues(cues.filter((item) => item.id !== c.id));
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
              {!cues.length && (
                <p>
                  <Compass size={23} />
                  这里将收纳沿途的每一个转弯。
                </p>
              )}
            </div>
            {deletedCue && (
              <div className="cue-undo" role="status">
                方向标注已删除
                <button
                  onClick={() => {
                    saveCues([...cues, deletedCue]);
                    setDeletedCue(null);
                  }}
                >
                  撤销
                </button>
              </div>
            )}
            <small className="cue-local-note">
              同一视频与路线的标注会自动恢复。朝向相对视频画面，非地理方位；本机资料清除后将无法恢复。
            </small>
          </section>
        </div>
      )}
    </div>
  );
}
