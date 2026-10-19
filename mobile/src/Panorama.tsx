import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  ArrowUp,
  ChevronRight,
  Film,
  Focus,
  Maximize,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { loadStored, store, type Step } from "./navigation";
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
const clock = (t: number) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
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
    arrow = useRef<HTMLDivElement>(null);
  const yaw = useRef(0),
    pitch = useRef(0),
    drag = useRef<{ x: number; y: number } | null>(null);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState("");
  const [url, setUrl] = useState(""),
    [annotating, setAnnotating] = useState(false),
    [cueStep, setCueStep] = useState(0),
    [cueText, setCueText] = useState("沿此方向前行");
  const key = `atlas-go-cues:${media?.id ?? "none"}:${routeKey}`;
  const [cues, setCues] = useState<Cue[]>([]);
  const lastCue = useRef("");
  useEffect(() => {
    const back = (event: Event) => {
      if (annotating) {
        event.preventDefault();
        setAnnotating(false);
      }
    };
    document.addEventListener("atlas-native-back", back);
    return () => document.removeEventListener("atlas-native-back", back);
  }, [annotating]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) video.current?.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    const saved = loadStored<unknown>(key, []);
    setCues(
      Array.isArray(saved)
        ? saved.filter(
            (c) =>
              c &&
              typeof c.text === "string" &&
              Number.isFinite(c.time) &&
              Number.isFinite(c.yaw) &&
              Number.isInteger(c.step),
          )
        : [],
    );
    lastCue.current = "";
  }, [key]);
  const cue = [...cues].reverse().find((c) => c.time <= time);
  const activeCue = useRef(cue);
  activeCue.current = cue;
  useEffect(() => {
    if (playing && cue && cue.id !== lastCue.current) {
      lastCue.current = cue.id;
      onCue(cue.step, cue.text);
    }
    if (!cue) lastCue.current = "";
  }, [cue?.id, playing]);
  useEffect(() => {
    if (!media || !host.current || !video.current) return;
    setTime(0);
    setDuration(0);
    setPlaying(false);
    setError("");
    yaw.current = 0;
    pitch.current = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError("当前设备无法启动全景渲染，请检查 WebView 或硬件加速。");
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
      setError("全景渲染已中断，请切回地图再打开全景。");
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      if (document.hidden) return;
      const radians = Math.PI / 180,
        a = yaw.current * radians,
        p = pitch.current * radians;
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
        const heading = c.yaw * radians,
          world = new THREE.Vector3(
            Math.sin(heading) * 8,
            -0.8,
            -Math.cos(heading) * 8,
          ),
          projected = world.clone().project(camera);
        const front =
          world.dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
        arrow.current.style.opacity =
          front && Math.abs(projected.x) < 0.95 ? "1" : "0";
        arrow.current.style.left = `${((projected.x + 1) / 2) * 100}%`;
        arrow.current.style.top = `${((1 - projected.y) / 2) * 100}%`;
      }
    };
    render();
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
  }, [media?.src]);
  const saveCues = (next: Cue[]) => {
    const sorted = [...next].sort((a, b) => a.time - b.time);
    setCues(sorted);
    if (!store(key, sorted)) notice("方向标注未能保存，设备存储空间可能不足");
  };
  const play = async () => {
    if (!video.current) return;
    try {
      if (video.current.paused) await video.current.play();
      else video.current.pause();
    } catch {
      setError("视频无法播放，请检查文件格式、网络或点击重新播放。");
    }
  };
  return (
    <div className="panorama" ref={root}>
      {media ? (
        <>
          <div
            className="panorama-render"
            ref={host}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              yaw.current -= (e.clientX - drag.current.x) * 0.18;
              pitch.current = Math.max(
                -75,
                Math.min(
                  75,
                  pitch.current + (e.clientY - drag.current.y) * 0.18,
                ),
              );
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
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
            preload="metadata"
            onLoadedMetadata={(e) =>
              setDuration(
                Number.isFinite(e.currentTarget.duration)
                  ? e.currentTarget.duration
                  : 0,
              )
            }
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() =>
              setError(
                "视频加载失败。远程视频需允许跨域访问，建议先导入本地 MP4。",
              )
            }
          />
          <div className="pano-direction" ref={arrow}>
            <div className="direction-disc">
              <ArrowUp size={38} />
            </div>
            <span>{cue?.text}</span>
          </div>
          <div className="pano-top">
            <span className="pano-badge">360° 全景视频</span>
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
                aria-label="全屏"
                onClick={() => {
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void root.current
                      ?.requestFullscreen()
                      .catch(() => notice("当前设备不支持页面全屏"));
                }}
              >
                <Maximize size={20} />
              </button>
            </div>
          </div>
          {error && (
            <div className="pano-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  video.current?.load();
                }}
              >
                重新载入
              </button>
            </div>
          )}
          <div className="pano-bottom">
            <div className="pano-caption">
              <strong>{cue?.text ?? "拖动视角，环视路线现场"}</strong>
              <span>
                {media.name}
                {media.local ? " · 本地文件，本次打开有效" : ""}
              </span>
            </div>
            <div className="video-controls">
              <button
                aria-label={playing ? "暂停视频" : "播放视频"}
                onClick={() => void play()}
              >
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <span>{clock(time)}</span>
              <input
                aria-label="视频进度"
                type="range"
                min="0"
                max={duration || 1}
                step="0.1"
                value={time}
                onChange={(e) => {
                  if (video.current) {
                    video.current.currentTime = +e.target.value;
                    setTime(+e.target.value);
                    lastCue.current = "";
                  }
                }}
              />
              <span>{clock(duration)}</span>
            </div>
            <div className="pano-actions">
              <button onClick={() => setAnnotating(true)}>
                <Plus size={16} />
                标注方向 · {cues.length}
              </button>
              <label>
                <Upload size={16} />
                更换视频
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      onMedia({
                        src: URL.createObjectURL(file),
                        name: file.name,
                        id: `${file.name}:${file.size}:${file.lastModified}`,
                        local: true,
                      });
                  }}
                />
              </label>
            </div>
          </div>
        </>
      ) : (
        <div className="pano-empty">
          <div className="orbital-orb">
            <span />
            <span />
            <Film size={44} />
          </div>
          <p className="eyebrow">BE THERE, BEFORE YOU GO.</p>
          <h1>
            先看见，
            <br />
            再出发。
          </h1>
          <p>
            导入校园 360° 全景视频，
            <br />
            在真实场景里叠加方向指引。
          </p>
          <label className="button primary">
            <Upload size={18} />
            导入全景视频
            <input
              type="file"
              accept="video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  onMedia({
                    src: URL.createObjectURL(file),
                    name: file.name,
                    id: `${file.name}:${file.size}:${file.lastModified}`,
                    local: true,
                  });
              }}
            />
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const value = new URL(url);
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
              aria-label="全景视频 HTTPS 直链"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="或粘贴 HTTPS 视频直链"
            />
            <button type="submit" aria-label="载入视频">
              <ChevronRight size={20} />
            </button>
          </form>
          <small>
            支持等距柱状投影（通常 2:1）的单目视频。
            <br />
            尚未接入实拍素材；普通视频不会自动变成全景。
            <br />
            方向标注按视频时间轴播放，不代表实时定位。
          </small>
        </div>
      )}
      {annotating && (
        <div className="modal-backdrop">
          <section
            className="modal cue-editor"
            role="dialog"
            aria-modal="true"
            aria-label="全景方向标注"
          >
            <button
              className="close-button"
              aria-label="关闭标注"
              onClick={() => setAnnotating(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">DIRECTION CUES</span>
            <h2>把方向留在现场。</h2>
            <p>
              先关闭面板并拖动视频朝向目标，再在当前时间添加标注。重新导入同一视频、选择同一路线时会恢复标注。
            </p>
            <div className="cue-capture">
              <strong>{clock(time)}</strong>
              <span>
                当前朝向 {Math.round(((yaw.current % 360) + 360) % 360)}°
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
            <label>
              方向文字
              <input
                value={cueText}
                maxLength={100}
                onChange={(e) => setCueText(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={!cueText.trim()}
              onClick={() => {
                saveCues([
                  ...cues,
                  {
                    id: crypto.randomUUID(),
                    time,
                    yaw: yaw.current,
                    text: cueText.trim(),
                    step: steps.length ? cueStep : -1,
                  },
                ]);
                notice("方向标注已保存");
              }}
            >
              在当前时间添加方向
            </button>
            <div className="cue-list">
              {cues.map((c) => (
                <article key={c.id}>
                  <span>{clock(c.time)}</span>
                  <strong>{c.text}</strong>
                  <button
                    aria-label="删除方向标注"
                    onClick={() =>
                      saveCues(cues.filter((item) => item.id !== c.id))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
              {!cues.length && <p>还没有方向标注。</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
