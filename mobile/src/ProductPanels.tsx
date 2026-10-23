import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Footprints,
  Headphones,
  MapPin,
  Navigation2,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { rooms, type SavedRoute, type Step } from "./navigation";
import type { Journey } from "./journeys";

export const APP_VERSION = "0.2.0";

export function Dialog({
  title,
  label,
  onClose,
  children,
  className = "",
}: {
  title: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,a[href],[tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (
        [...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current
      )
        return;
      const list = focusable();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && index <= 0) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (!e.shiftKey && (index < 0 || index === list.length - 1)) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop product-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal product-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="close-button"
          aria-label={`关闭${title}`}
          onClick={onClose}
        >
          <X size={21} />
        </button>
        {label && <span className="eyebrow">{label}</span>}
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

export function PersonalCenter({
  favourites,
  journeys,
  routes,
  onChoose,
  onFavourite,
  onRoute,
  onDeleteRoute,
  onClearHistory,
  onSettings,
  onHelp,
}: {
  favourites: string[];
  journeys: Journey[];
  routes: SavedRoute[];
  onChoose: (id: string) => void;
  onFavourite: (id: string) => void;
  onRoute: (from: string, to: string) => void;
  onDeleteRoute: (id: string) => void;
  onClearHistory: () => void;
  onSettings: () => void;
  onHelp: () => void;
}) {
  return (
    <main className="personal-center">
      <header className="personal-header">
        <div>
          <span className="eyebrow">YOUR CAMPUS, YOUR WAY</span>
          <h1>我的校园</h1>
          <p>把每一次出发，变得更熟悉。</p>
        </div>
        <button
          className="circle-action"
          onClick={onSettings}
          aria-label="导航设置"
        >
          <Settings2 size={22} />
        </button>
      </header>
      <div className="personal-pass">
        <span className="pass-icon">
          <Navigation2 size={30} />
        </span>
        <div>
          <strong>ATLAS GO</strong>
          <p>校园随行 · 本机资料</p>
        </div>
        <span className="offline-badge">
          <WifiOff size={12} /> 离线地图
        </span>
      </div>
      <div className="personal-stats">
        <span>
          <b>{favourites.length}</b>收藏地点
        </span>
        <span>
          <b>{routes.length}</b>保存路线
        </span>
        <span>
          <b>{journeys.length}</b>引导记录
        </span>
      </div>
      <section className="personal-section">
        <div className="section-title">
          <h2>
            <Bookmark size={18} /> 常用地点
          </h2>
          <span>点击即可规划</span>
        </div>
        {favourites.length ? (
          <div className="favourite-grid">
            {favourites.map((id) => {
              const room = rooms.find((r) => r.id === id)!;
              return (
                <article key={id}>
                  <button onClick={() => onChoose(id)}>
                    <span className="place-tile-icon">
                      <MapPin size={19} />
                    </span>
                    <strong>{id}</strong>
                    <small>{room.name}</small>
                  </button>
                  <button
                    className="remove-favourite"
                    aria-label={`取消收藏 ${id}`}
                    onClick={() => onFavourite(id)}
                  >
                    <Bookmark size={15} fill="currentColor" />
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="inline-empty">
            <Bookmark size={24} />
            <strong>留住常去的地方</strong>
            <p>在教室详情点击收藏，下次一键找到。</p>
            <button onClick={() => onChoose("M104")}>
              浏览 M104 <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>
      <section className="personal-section">
        <div className="section-title">
          <h2>
            <Route size={18} /> 现场路线
          </h2>
          <button onClick={onSettings}>
            管理 <ChevronRight size={14} />
          </button>
        </div>
        {routes.length ? (
          <div className="library-list">
            {routes.map((r) => (
              <article key={r.id}>
                <button
                  className="library-main"
                  onClick={() => onRoute(r.from, r.to)}
                >
                  <span className="list-tile">
                    <Route size={19} />
                  </span>
                  <span>
                    <strong>
                      {r.from} <ArrowRight size={12} /> {r.to}
                    </strong>
                    <small>
                      {r.verified ? "已标注现场核验" : "待现场核验"} ·{" "}
                      {r.points.length} 个节点
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
                <button
                  className="icon-touch"
                  aria-label={`删除路线 ${r.from} 到 ${r.to}`}
                  onClick={() => onDeleteRoute(r.id)}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="section-empty-text">
            在路线页标注走过的门口与走廊，建立自己的校园路线。
          </p>
        )}
      </section>
      <section className="personal-section">
        <div className="section-title">
          <h2>
            <Clock3 size={18} /> 最近引导
          </h2>
          {journeys.length > 0 && (
            <button onClick={onClearHistory}>清空</button>
          )}
        </div>
        {journeys.length ? (
          <div className="library-list">
            {journeys.map((j) => (
              <article key={j.id}>
                <button
                  className="library-main"
                  onClick={() => onRoute(j.from, j.to)}
                >
                  <span className="list-tile">
                    <Footprints size={19} />
                  </span>
                  <span>
                    <strong>
                      {j.from} <ArrowRight size={12} /> {j.to}
                    </strong>
                    <small>
                      {new Date(j.completedAt).toLocaleDateString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                      })}{" "}
                      · {j.mode === "preview" ? "路线预演" : "分步引导"} ·{" "}
                      {Math.round(j.distance)} 图纸米
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="section-empty-text">
            完成一次路线预演或分步引导后，记录会出现在这里。
          </p>
        )}
      </section>
      <button className="help-entry" onClick={onHelp}>
        <span>
          <Compass size={22} />
          <span>
            <strong>第一次使用？</strong>
            <small>了解地图、路线和 360° 实景</small>
          </span>
        </span>
        <ChevronRight size={19} />
      </button>
      <p className="personal-footer">
        ATLAS GO {APP_VERSION} · 资料保存在此设备
      </p>
    </main>
  );
}

export function RouteOverview({
  steps,
  from,
  to,
  current,
  navigating,
  onClose,
}: {
  steps: Step[];
  from: string;
  to: string;
  current: number;
  navigating: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="路线总览"
      label="EVERY TURN, IN SIGHT"
      onClose={onClose}
      className="overview-dialog"
    >
      <p className="dialog-description">
        {from} → {to} · {steps.length} 个引导点
      </p>
      <ol className="step-timeline">
        {steps.map((s, index) => (
          <li
            key={index}
            className={navigating && index === current ? "current" : ""}
          >
            <span className="timeline-number">
              {navigating && index < current ? <Check size={13} /> : index + 1}
            </span>
            <div>
              <strong>{s.text}</strong>
              <small>
                {s.distance > 0
                  ? `这一段约 ${Math.round(s.distance)} 图纸米`
                  : index === steps.length - 1
                    ? "目的地入口位置待现场确认"
                    : "从所选起点开始"}
              </small>
            </div>
            {navigating && index === current && (
              <span className="timeline-current">当前</span>
            )}
          </li>
        ))}
      </ol>
      <p className="tiny-note">
        查看总览不会更改引导进度，请返回路线页逐点确认位置。
      </p>
    </Dialog>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="每一次出发，都有方向。"
      label="WELCOME TO ATLAS GO"
      onClose={onClose}
      className="help-dialog"
    >
      <div className="help-visual" aria-hidden="true">
        <span />
        <span />
        <Navigation2 size={42} />
        <i />
        <MapPin size={29} />
      </div>
      <div className="help-steps">
        <article>
          <span>
            <MapPin size={21} />
          </span>
          <div>
            <strong>01 / 找到下一间教室</strong>
            <p>搜索编号或名称，在地图中查看位置，把常去的地点加入收藏。</p>
          </div>
        </article>
        <article>
          <span>
            <Route size={21} />
          </span>
          <div>
            <strong>02 / 先看路线，再出发</strong>
            <p>
              选择起终点，查看每一段方向。示意路线可预演，现场路线由你标注与核对。
            </p>
          </div>
        </article>
        <article>
          <span>
            <Compass size={21} />
          </span>
          <div>
            <strong>03 / 在 360° 现场看方向</strong>
            <p>导入实拍全景视频，在时间轴标注转向，播放时跟随方向提示。</p>
          </div>
        </article>
      </div>
      <div className="data-note">
        <ShieldCheck size={18} />
        <p>
          地图支持离线浏览。路线、收藏和记录保存在本机；当前尚未接入实时室内定位。
        </p>
      </div>
      <button className="button primary full-width" onClick={onClose}>
        开始探索 <ArrowRight size={17} />
      </button>
    </Dialog>
  );
}

export function ArrivalDialog({
  journey,
  onClose,
  onAgain,
  onExplore,
}: {
  journey: Journey;
  onClose: () => void;
  onAgain: () => void;
  onExplore: () => void;
}) {
  return (
    <Dialog
      title={
        journey.mode === "preview"
          ? "下一次出发，心中有数。"
          : "这一程，已完成。"
      }
      label={
        journey.mode === "preview" ? "PREVIEW COMPLETE" : "GUIDANCE COMPLETE"
      }
      onClose={onClose}
      className="arrival-dialog"
    >
      <div className="arrival-mark">
        <Check size={34} />
        <span />
      </div>
      <p className="arrival-destination">
        <MapPin size={16} /> {journey.to} ·{" "}
        {rooms.find((r) => r.id === journey.to)?.name}
      </p>
      <div className="arrival-stats">
        <span>
          <strong>
            {Math.round(journey.distance)}
            <small>图纸米</small>
          </strong>
          <small>路线距离</small>
        </span>
        <span>
          <strong>
            {journey.stepCount}
            <small>个</small>
          </strong>
          <small>引导点</small>
        </span>
      </div>
      <p className="dialog-description">
        {journey.mode === "preview"
          ? "预演记录已保存在「我的校园」。现场通行情况请以实际环境为准。"
          : "引导记录已保存在「我的校园」。本次位置由你逐点确认。"}
      </p>
      <button className="button primary full-width" onClick={onExplore}>
        继续探索 <Compass size={18} />
      </button>
      <button className="text-action" onClick={onAgain}>
        再看一次路线
      </button>
    </Dialog>
  );
}
