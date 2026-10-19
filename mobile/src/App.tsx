import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Check,
  ChevronRight,
  Compass,
  Download,
  Film,
  Footprints,
  Headphones,
  Layers2,
  MapPin,
  MoreHorizontal,
  Navigation2,
  Pencil,
  Play,
  Plus,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import MapView from "./MapView";
import {
  isRoute,
  loadStored,
  planPreview,
  rooms,
  routeLength,
  stepsFor,
  store,
  type Point,
  type SavedRoute,
} from "./navigation";
import { speak, stopVoice } from "./voice";
import type { Media } from "./Panorama";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
const NativeFiles = registerPlugin<{
  saveRoutes(options: { json: string }): Promise<{ saved: boolean }>;
}>("NavigationFiles");
const Panorama = lazy(() => import("./Panorama"));
const STORAGE = "atlas-go-routes-v1";
type Tab = "map" | "route" | "pano";
function routeStore() {
  const data = loadStored<unknown>(STORAGE, []);
  return Array.isArray(data) ? data.filter(isRoute) : [];
}
function readIds(key: string) {
  const data = loadStored<unknown>(key, []);
  return Array.isArray(data)
    ? data.filter(
        (id): id is string =>
          typeof id === "string" && rooms.some((r) => r.id === id),
      )
    : [];
}
async function exportData(routes: SavedRoute[]) {
  const json = JSON.stringify(
    {
      format: "atlas-go-routes-v1",
      exportedAt: new Date().toISOString(),
      routes,
    },
    null,
    2,
  );
  if (Capacitor.isNativePlatform())
    return (await NativeFiles.saveRoutes({ json })).saved;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "atlas-go-routes.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
function TurnIcon({ turn, size = 26 }: { turn?: string; size?: number }) {
  return turn === "left" ? (
    <ArrowLeft size={size} />
  ) : turn === "right" ? (
    <ArrowRight size={size} />
  ) : turn === "arrive" ? (
    <MapPin size={size} />
  ) : (
    <ArrowUp size={size} />
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("map");
  const [from, setFrom] = useState("M104"),
    [to, setTo] = useState<string | null>(null);
  const [searching, setSearching] = useState<"from" | "to" | null>(null),
    [query, setQuery] = useState("");
  const [favourites, setFavourites] = useState(() =>
    readIds("atlas-go-favourites"),
  );
  const [recent, setRecent] = useState(() => readIds("atlas-go-recent"));
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(routeStore);
  const [planned, setPlanned] = useState<Point[]>([]),
    [planning, setPlanning] = useState(false);
  const [navigating, setNavigating] = useState(false),
    [step, setStep] = useState(0),
    [auto, setAuto] = useState(false);
  const [voice, setVoice] = useState(
    () => loadStored("atlas-go-voice", true) === true,
  );
  const [labels, setLabels] = useState(true),
    [filter, setFilter] = useState("全部");
  const [settings, setSettings] = useState(false),
    [fitVersion, setFitVersion] = useState(0);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Point[]>([]),
    [verified, setVerified] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined),
    searchInput = useRef<HTMLInputElement>(null);
  const notice = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(""), 4200);
  };
  const room = rooms.find((r) => r.id === to),
    startRoom = rooms.find((r) => r.id === from)!;
  const handleBack = useRef(() => {});
  handleBack.current = () => {
    const event = new Event("atlas-native-back", { cancelable: true });
    if (!document.dispatchEvent(event)) return;
    if (searching) setSearching(null);
    else if (settings) setSettings(false);
    else if (editing) setEditing(false);
    else if (navigating) {
      setNavigating(false);
      setAuto(false);
      stopVoice();
    } else if (tab !== "map") setTab("map");
    else if (to) setTo(null);
    else if (Capacitor.isNativePlatform()) void NativeApp.exitApp();
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleBack.current();
    };
    document.addEventListener("keydown", keydown);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener("backButton", () => handleBack.current())
      : null;
    return () => {
      document.removeEventListener("keydown", keydown);
      if (listener) void listener.then((handle) => handle.remove());
    };
  }, []);
  const saved = useMemo(
    () =>
      savedRoutes.find((r) => r.from === from && r.to === to) ??
      (() => {
        const reverse = savedRoutes.find((r) => r.from === to && r.to === from);
        return reverse
          ? { ...reverse, points: [...reverse.points].reverse() }
          : undefined;
      })(),
    [savedRoutes, from, to],
  );
  const points = saved?.points ?? planned;
  const steps = useMemo(
    () => stepsFor(points, from, to ?? ""),
    [points, from, to],
  );
  const length = routeLength(points);
  const isVerified = saved?.verified === true;
  useEffect(() => {
    setNavigating(false);
    setAuto(false);
    setStep(0);
    stopVoice();
    setEditing(false);
    setPlanned([]);
    if (!to || to === from || saved) {
      setPlanning(false);
      setFitVersion((v) => v + 1);
      return;
    }
    let active = true;
    setPlanning(true);
    const timer = setTimeout(() => {
      const path = planPreview(startRoom, rooms.find((r) => r.id === to)!);
      if (active) {
        setPlanned(path ?? []);
        setPlanning(false);
        setFitVersion((v) => v + 1);
      }
    }, 30);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [from, to, saved]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
  useEffect(() => {
    store("atlas-go-voice", voice);
    if (!voice) stopVoice();
  }, [voice]);
  useEffect(() => {
    if (navigating && voice && tab !== "pano" && steps[step])
      void speak(
        `${!isVerified && step === 0 ? "路线预演。" : ""}${steps[step].text}。请在实际到达后手动确认位置。`,
      ).catch((error) => notice(error.message));
  }, [step, navigating, voice, tab]);
  useEffect(() => {
    if (tab !== "route") setAuto(false);
    if (tab === "pano") stopVoice();
  }, [tab]);
  useEffect(() => {
    if (!auto || !navigating) return;
    const timer = setInterval(
      () =>
        setStep((current) => {
          if (current >= steps.length - 1) {
            setAuto(false);
            return current;
          }
          return current + 1;
        }),
      6500,
    );
    return () => clearInterval(timer);
  }, [auto, navigating, steps.length]);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) {
        setAuto(false);
        stopVoice();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      stopVoice();
      clearTimeout(toastTimer.current);
    };
  }, []);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  useEffect(
    () => () => {
      if (mediaRef.current?.local) URL.revokeObjectURL(mediaRef.current.src);
    },
    [],
  );
  const chooseMedia = (next: Media) => {
    if (media?.local) URL.revokeObjectURL(media.src);
    setMedia(next);
  };
  const pick = (id: string) => {
    if (searching === "from") setFrom(id);
    else {
      setTo(id);
      setTab("map");
      setRecent((items) => {
        const next = [id, ...items.filter((item) => item !== id)].slice(0, 8);
        store("atlas-go-recent", next);
        return next;
      });
    }
    setSearching(null);
    setQuery("");
  };
  const openSearch = (target: "from" | "to") => {
    setSearching(target);
    setQuery("");
  };
  const favourite = (id: string) =>
    setFavourites((items) => {
      const next = items.includes(id)
        ? items.filter((item) => item !== id)
        : [...items, id];
      store("atlas-go-favourites", next);
      return next;
    });
  const saveRoutes = (next: SavedRoute[]) => {
    setSavedRoutes(next);
    if (!store(STORAGE, next)) notice("路线没有保存成功，请检查设备存储空间");
  };
  const finishEditing = () => {
    if (!to || draft.length < 2) return;
    const route: SavedRoute = {
      id: crypto.randomUUID(),
      from,
      to,
      points: draft,
      verified,
      updatedAt: new Date().toISOString(),
    };
    if (!isRoute(route)) {
      notice("路线点位无效，请在地图范围内至少标记两个点");
      return;
    }
    saveRoutes([
      ...savedRoutes.filter(
        (r) =>
          !(
            (r.from === from && r.to === to) ||
            (r.from === to && r.to === from)
          ),
      ),
      route,
    ]);
    setEditing(false);
    setTab("route");
    notice(
      verified ? "路线已保存，标记为现场核验" : "路线已保存，等待现场核验",
    );
  };
  const importRoutes = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error();
      const data = JSON.parse(await file.text());
      if (
        data.format !== "atlas-go-routes-v1" ||
        !Array.isArray(data.routes) ||
        data.routes.length > 100 ||
        !data.routes.every(isRoute)
      )
        throw new Error();
      saveRoutes([
        ...savedRoutes.filter(
          (r) =>
            !data.routes.some(
              (next: SavedRoute) => next.from === r.from && next.to === r.to,
            ),
        ),
        ...data.routes.map((r: SavedRoute) => ({
          ...r,
          verified: false,
          updatedAt: new Date().toISOString(),
        })),
      ]);
      notice(`已导入 ${data.routes.length} 条路线，需在本机重新核验`);
    } catch {
      notice("文件格式无效，请导入 Atlas Go 导出的路线 JSON");
    }
  };
  const begin = () => {
    if (!points.length) return;
    setStep(0);
    setNavigating(true);
    setTab("route");
    setFitVersion((v) => v + 1);
  };
  const nextStep = () => {
    if (step >= steps.length - 1) {
      setNavigating(false);
      setAuto(false);
      stopVoice();
      notice("本次引导已结束");
    } else setStep((v) => v + 1);
  };
  const searchResults = rooms.filter((r) =>
    `${r.id} ${r.name} ${r.kindLabel}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className={`app ${tab === "pano" ? "pano-mode" : ""} ${editing ? "editing-mode" : ""}`}
    >
      {tab !== "pano" ? (
        <MapView
          selected={to}
          start={from}
          route={editing ? draft : tab === "route" ? points : []}
          current={navigating ? steps[step]?.point : undefined}
          editing={editing}
          onPoint={(point) => setDraft((list) => [...list, point])}
          onSelect={(id) => {
            setTo(id);
            if (tab !== "route") setTab("map");
          }}
          labels={labels}
          filter={filter}
          fitVersion={fitVersion}
        />
      ) : (
        <Suspense
          fallback={<div className="loading-screen">正在准备全景播放器…</div>}
        >
          <Panorama
            media={media}
            onMedia={chooseMedia}
            steps={steps}
            routeKey={`${from}:${to ?? "none"}`}
            onCue={(index, text) => {
              if (index >= 0 && index < steps.length) setStep(index);
              if (voice)
                void speak(text).catch((error) => notice(error.message));
            }}
            notice={notice}
          />
        </Suspense>
      )}

      {!editing && (
        <header className="app-header">
          <div className="brand-line">
            <span>
              <span className="brand-symbol">↗</span> ATLAS <b>GO</b>
            </span>
            <span className="brand-detail">CAMPUS NAVIGATION</span>
          </div>
          <div className="search-row">
            <button className="search-launch" onClick={() => openSearch("to")}>
              <Search size={21} />
              <span>
                {room ? `${room.id} · ${room.name}` : "想去哪个教室？"}
              </span>
              <kbd>搜索</kbd>
            </button>
            <button
              className="header-action"
              aria-label="打开设置与路线资料"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={22} />
            </button>
          </div>
          {tab === "map" && (
            <div className="category-row">
              {["全部", "教室", "阅读", "餐厅"].map((category) => (
                <button
                  key={category}
                  className={filter === category ? "active" : ""}
                  onClick={() => setFilter(category)}
                >
                  {category}
                </button>
              ))}
              <button
                onClick={() => {
                  setLabels((v) => !v);
                }}
              >
                <Layers2 size={14} />
                {labels ? "隐藏编号" : "显示编号"}
              </button>
            </div>
          )}
        </header>
      )}

      {tab !== "pano" && !editing && (
        <section
          className={`bottom-sheet ${tab === "route" ? "route-sheet" : ""} ${navigating ? "navigation-sheet" : ""}`}
        >
          <div className="sheet-grip" />
          {tab === "map" ? (
            room ? (
              <>
                <div className="place-heading">
                  <div>
                    <span className="eyebrow">YOUR NEXT STOP</span>
                    <h1>
                      {room.id}
                      <small>{room.name}</small>
                    </h1>
                  </div>
                  <button
                    className={`favourite-button ${favourites.includes(room.id) ? "active" : ""}`}
                    aria-label={
                      favourites.includes(room.id) ? "取消收藏" : "收藏教室"
                    }
                    onClick={() => favourite(room.id)}
                  >
                    <Bookmark
                      size={21}
                      fill={
                        favourites.includes(room.id) ? "currentColor" : "none"
                      }
                    />
                  </button>
                </div>
                <div className="place-meta">
                  <span>
                    <MapPin size={14} />
                    首层 FF-01
                  </span>
                  <span>{room.kindLabel}</span>
                  <span>图纸 {room.areaM2Region} m²</span>
                </div>
                <div className="place-actions">
                  <button
                    className="button secondary"
                    onClick={() => {
                      setFrom(room.id);
                      setTo(null);
                      notice(`${room.id} 已设为起点`);
                    }}
                  >
                    设为起点
                  </button>
                  <button
                    className="button primary"
                    disabled={room.id === from}
                    onClick={() => {
                      setTab("route");
                      setFitVersion((v) => v + 1);
                    }}
                  >
                    <Route size={18} />
                    {room.id === from ? "与当前起点相同" : "路线规划"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="home-heading">
                  <div>
                    <span className="eyebrow">A LITTLE CLOSER.</span>
                    <h1>校园，不再绕路。</h1>
                  </div>
                  <span className="home-icon">
                    <Navigation2 size={27} />
                  </span>
                </div>
                <p className="home-description">
                  找到教室，沿着熟悉的方向出发。
                </p>
                <div className="home-stats">
                  <span>
                    <b>{rooms.length}</b>个空间
                  </span>
                  <span>
                    <b>2D + 360°</b>双视角
                  </span>
                  <button onClick={() => openSearch("from")}>
                    <i />
                    起点 {from}
                    <ChevronRight size={14} />
                  </button>
                </div>
                <div className="quick-places">
                  {[...new Set([...favourites, "M104", "A101", "THEATER-01"])]
                    .slice(0, 3)
                    .map((id) => (
                      <button key={id} onClick={() => setTo(id)}>
                        <MapPin size={15} />
                        <span>{id}</span>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                </div>
              </>
            )
          ) : navigating ? (
            <>
              <div className="nav-instruction">
                <div className="turn-symbol">
                  <TurnIcon turn={steps[step]?.turn} size={34} />
                </div>
                <div>
                  <span className="eyebrow">
                    {isVerified
                      ? "分步引导 · 手动确认位置"
                      : "路线预演 · 非实时导航"}
                  </span>
                  <h2>{steps[step]?.text}</h2>
                </div>
                <button
                  aria-label={voice ? "关闭语音" : "开启语音"}
                  onClick={() => setVoice((v) => !v)}
                >
                  {voice ? <Volume2 size={21} /> : <VolumeX size={21} />}
                </button>
              </div>
              <div className="step-progress">
                <span
                  style={{
                    width: `${((step + 1) / Math.max(1, steps.length)) * 100}%`,
                  }}
                />
              </div>
              <div className="navigation-detail">
                <span>
                  {from} → {to}
                </span>
                <strong>
                  {step + 1}
                  <small> / {steps.length} 步</small>
                </strong>
              </div>
              <p className="tiny-note">
                未连接室内定位，请核对周围环境后确认下一点。
              </p>
              <div className="navigation-buttons">
                <button
                  className="button secondary"
                  onClick={() => {
                    setNavigating(false);
                    setAuto(false);
                    stopVoice();
                  }}
                >
                  退出
                </button>
                {!isVerified && (
                  <button
                    className="button secondary"
                    onClick={() => setAuto((v) => !v)}
                  >
                    {auto ? "暂停预演" : "自动预演"}
                  </button>
                )}
                <button className="button primary" onClick={nextStep}>
                  {step === steps.length - 1 ? "结束引导" : "已到达此点"}
                  <Check size={18} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="route-heading">
                <h2>步行路线</h2>
                <button
                  className="subtle-button"
                  onClick={() => {
                    setTo(null);
                    setTab("map");
                  }}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="endpoint-fields">
                <div>
                  <button onClick={() => openSearch("from")}>
                    <i className="endpoint-dot start" />
                    <span>
                      {from} <small>{startRoom.name}</small>
                    </span>
                  </button>
                  <button onClick={() => openSearch("to")}>
                    <i className="endpoint-dot end" />
                    <span>
                      {to ? `${to} ${room?.name ?? ""}` : "选择目的地"}
                    </span>
                  </button>
                </div>
                <button
                  className="swap-button"
                  disabled={!to}
                  aria-label="交换起终点"
                  onClick={() => {
                    if (to) {
                      setFrom(to);
                      setTo(from);
                    }
                  }}
                >
                  <ArrowDownUp size={20} />
                </button>
              </div>
              {planning ? (
                <p className="route-loading">正在分析房间轮廓，生成示意路线…</p>
              ) : points.length > 1 ? (
                <>
                  <div className="route-summary">
                    <div>
                      <strong>
                        {Math.round(length)}
                        <small>图纸米</small>
                      </strong>
                      <span>{steps.length} 个引导点 · 实际距离待复核</span>
                    </div>
                    <span
                      className={`validation-tag ${isVerified ? "verified" : ""}`}
                    >
                      {isVerified ? (
                        <ShieldCheck size={14} />
                      ) : (
                        <Pencil size={14} />
                      )}{" "}
                      {isVerified ? "已标注现场核验" : "示意路线"}
                    </span>
                  </div>
                  <p className="route-disclaimer">
                    {isVerified
                      ? "使用本机保存的现场标注路线，位置由你逐步确认。"
                      : "由房间轮廓生成；门口、走廊连通与室外边界尚未核验，仅供预演。"}
                  </p>
                  <div className="route-buttons">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setDraft(saved?.points ?? []);
                        setVerified(false);
                        setEditing(true);
                      }}
                    >
                      标注路线
                    </button>
                    <button className="button primary" onClick={begin}>
                      <Navigation2 size={18} />
                      {isVerified ? "开始分步引导" : "预演路线"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="route-no-result">
                  <Route size={24} />
                  <p>
                    {!to
                      ? "先选择一个目的地"
                      : from === to
                        ? "起点和终点是同一个空间"
                        : "尚未找到可连通的示意路径"}
                  </p>
                  {to && from !== to && (
                    <button
                      className="button primary"
                      onClick={() => {
                        setDraft([]);
                        setVerified(false);
                        setEditing(true);
                      }}
                    >
                      手动标注走廊路线
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {editing && (
        <>
          <div className="editor-top">
            <Pencil size={20} />
            <span>
              在地图上依次点选路线节点
              <br />
              <small>
                {from} → {to} · 已标记 {draft.length} 点
              </small>
            </span>
            <button aria-label="取消路线标注" onClick={() => setEditing(false)}>
              <X size={20} />
            </button>
          </div>
          <section className="editor-sheet">
            <div>
              <button
                className="button secondary"
                disabled={!draft.length}
                onClick={() => setDraft((p) => p.slice(0, -1))}
              >
                <Undo2 size={16} />
                撤销
              </button>
              <button className="button secondary" onClick={() => setDraft([])}>
                清空
              </button>
              <button
                className="button primary"
                disabled={draft.length < 2}
                onClick={finishEditing}
              >
                保存路线
              </button>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              我已在现场核对这条路线的门口、走廊和通行情况
            </label>
            <p>
              从实际出发的门口开始，到目的地门口结束；保存仅在本机，建议导出备份。
            </p>
          </section>
        </>
      )}

      {!editing && (
        <nav className="bottom-nav" aria-label="主导航">
          <button
            className={tab === "map" ? "active" : ""}
            onClick={() => setTab("map")}
          >
            <Compass size={23} />
            <span>探索</span>
          </button>
          <button
            className={tab === "route" ? "active" : ""}
            onClick={() => {
              setTab("route");
              setFitVersion((v) => v + 1);
            }}
          >
            <Route size={23} />
            <span>路线</span>
          </button>
          <button
            className={tab === "pano" ? "active" : ""}
            onClick={() => setTab("pano")}
          >
            <Film size={23} />
            <span>全景导航</span>
            <b>360°</b>
          </button>
        </nav>
      )}

      {searching && (
        <div className="search-page">
          <header>
            <button aria-label="返回地图" onClick={() => setSearching(null)}>
              <ArrowLeft size={23} />
            </button>
            <div>
              <Search size={19} />
              <input
                ref={searchInput}
                placeholder={
                  searching === "from"
                    ? "搜索起点教室或空间名称"
                    : "搜索教室、图书馆、餐厅"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="清除搜索" onClick={() => setQuery("")}>
                  <X size={16} />
                </button>
              )}
            </div>
          </header>
          {!query && (
            <>
              <div className="search-section-title">
                最近搜索{" "}
                <button
                  onClick={() => {
                    setRecent([]);
                    store("atlas-go-recent", []);
                  }}
                >
                  清空
                </button>
              </div>
              <div className="search-chips">
                {recent.length ? (
                  recent.map((id) => (
                    <button key={id} onClick={() => pick(id)}>
                      {id}
                    </button>
                  ))
                ) : (
                  <span>搜索记录会出现在这里</span>
                )}
              </div>
              {favourites.length > 0 && (
                <>
                  <div className="search-section-title">
                    <Star size={14} /> 我的收藏
                  </div>
                  <div className="search-chips">
                    {favourites.map((id) => (
                      <button key={id} onClick={() => pick(id)}>
                        {id}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <div className="search-section-title">
            {query ? `${searchResults.length} 个匹配空间` : "全部空间 · FF-01"}
          </div>
          <div className="search-results">
            {searchResults.map((r) => (
              <button key={r.id} onClick={() => pick(r.id)}>
                <span className="result-icon">
                  <MapPin size={20} />
                </span>
                <span>
                  <strong>
                    {r.id} <small>{r.name}</small>
                  </strong>
                  <span>{r.kindLabel} · 首层</span>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
            {!searchResults.length && (
              <div className="empty-search">
                没有找到这个空间，试试教室编号，如 M104。
              </div>
            )}
          </div>
        </div>
      )}

      {settings && (
        <div className="modal-backdrop">
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="设置与路线资料"
          >
            <button
              className="close-button"
              aria-label="关闭设置"
              onClick={() => setSettings(false)}
            >
              <X size={21} />
            </button>
            <span className="eyebrow">MAKE IT YOUR WAY</span>
            <h2>导航偏好与资料</h2>
            <div className="setting-row">
              <span>
                <Volume2 size={20} />
                中文语音引导
              </span>
              <button
                className={`switch ${voice ? "on" : ""}`}
                role="switch"
                aria-label="中文语音引导"
                aria-checked={voice}
                onClick={() => setVoice((v) => !v)}
              >
                <i />
              </button>
            </div>
            <button
              className="setting-link"
              onClick={() =>
                void speak(
                  "欢迎使用 Atlas Go 校园导航。向前出发，找到你的下一间教室。",
                ).catch((error) => notice(error.message))
              }
            >
              <Headphones size={19} />
              试听中文语音
              <ChevronRight size={16} />
            </button>
            <p className="tiny-note">
              安卓使用系统文字转语音引擎；缺少中文语音包时请先在系统中安装。
            </p>
            <div className="settings-heading">
              现场路线 <span>{savedRoutes.length} 条</span>
            </div>
            <div className="saved-routes">
              {savedRoutes.map((r) => (
                <article key={r.id}>
                  <div>
                    <strong>
                      {r.from} → {r.to}
                    </strong>
                    <small>
                      {r.verified ? "本机已标注核验" : "待现场核验"} ·{" "}
                      {new Date(r.updatedAt).toLocaleDateString("zh-CN")}
                    </small>
                  </div>
                  <button
                    aria-label="删除保存路线"
                    onClick={() =>
                      saveRoutes(savedRoutes.filter((item) => item.id !== r.id))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </article>
              ))}
              {!savedRoutes.length && (
                <p>还没有现场路线。在路线页点「标注路线」开始。</p>
              )}
            </div>
            <div className="settings-actions">
              <button
                className="button secondary"
                disabled={!savedRoutes.length}
                onClick={() => {
                  void exportData(savedRoutes)
                    .then((saved) => {
                      if (saved) notice("路线文件已导出");
                    })
                    .catch(() => notice("路线文件导出失败，请重试"));
                }}
              >
                <Download size={16} />
                导出路线
              </button>
              <label className="button secondary">
                <Upload size={16} />
                导入路线
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void importRoutes(e.target.files?.[0])}
                />
              </label>
            </div>
            <p className="tiny-note">
              导入路线默认待核验。地图已随 App
              离线打包；导入的全景视频需要每次重新选择，方向标注保存在本机。
            </p>
            <div className="about-app">
              <strong>
                ATLAS GO <span>0.1.0 · Android Preview</span>
              </strong>
              <p>
                当前使用校园 FF-01 空间轮廓。尚未连接 GPS
                与楼层坐标配准、室内定位服务和全校实拍全景素材。
              </p>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
