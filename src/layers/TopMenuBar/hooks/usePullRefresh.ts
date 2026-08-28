/**
 * usePullRefresh
 *
 * 独立承载"下拉刷新"的全部逻辑：手指触摸追踪、三阶段动画参数计算、
 * 触发 / 回弹决策、加载器 DOM 更新。App.tsx 只关心 onRefresh 回调
 * 和 isRefreshing 状态即可。
 *
 * 设计原则：
 *   - 全程直接 DOM 操作（useRef + requestAnimationFrame），
 *     零 React re-render，以支撑 120Hz 触摸刷新。
 *   - contentOffset 通过外部传入的 ref 读写，供 App.tsx 的滚动
 *     逻辑（applyScroll）使用。
 *   - 加载器 DOM 节点通过 forwardRef 传入（PullRefreshLoader 组件
 *     暴露），hook 回调在触发时才读取 ref.current，因此首次
 *     渲染时 ref 为空也不会出错。
 */

import { useCallback, useEffect, useRef, MutableRefObject } from 'react';

// ---------------------------------------------------------------------------
// 三段动画参数
//
// 进度区间                动作
// 0         → 0.60  弧长从 0° 增长到 160°（头比尾快 ~2.3 倍，尾缓头快）
// 0.60      → 1.00  弧继续增长到 330°（留 30° 缺口，让头尾都可见），
//                    颜色透明度从 0.40 加深到 1.00
// 1.00      → 1.50  整体圆环（含缺口和箭头）顺时针自转 180°
//
// 任意位置松手：
//   - 进度 >= 1.00  → 触发 onRefresh
//   - 进度 <  1.00  → ease-out 回弹到 0
// ---------------------------------------------------------------------------

/** 手指拖拽多少像素对应 progress = 1.0 */
const TOTAL_DRAG = 260;

/** 圆圈最大下降距离（px） */
const MAX_DESCEND = 100;

/** 箭头起点：1 点钟方向（屏幕坐标，顺时针为正） */
const START_ANG = -60;

/** 60%：颜色/透明度开始加深 */
const P_READY = 0.60;

/** 100%：圆环几乎闭合（留 30° 缺口），视为"准备刷新" */
const P_CLOSE = 1.00;

/** 150%：半圈阶段终点（整体自转 180°） */
const P_TRIGGER = 1.50;

/** 闭合时圆环缺口角度（度），B1 终点与 B2 全程共用 */
const CLOSE_GAP = 60;

// 箭头三角形几何参数（在 App.tsx 中调优为 15/20，此处保持同步）
const ARROW_LEN = 8;      // 尖端到头点的长度
const ARROW_HALF_W = 8;   // 底座半宽（底座总宽 = 2 * ARROW_HALF_W）

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 加载器 SVG 内节点（PullRefreshLoader 通过 forwardRef 暴露） */
export interface LoaderDOM {
  loader: HTMLDivElement | null;
  ring: SVGGElement | null;
  arcTrail: SVGPathElement | null;
  arrowHead: SVGPolygonElement | null;
  circleFull: SVGCircleElement | null;
  debugEl: HTMLDivElement | null;   // 下拉进度浮动调试面板
}

type DragEvent = React.TouchEvent | React.MouseEvent;

interface DragStart {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 动画核心
// ---------------------------------------------------------------------------

/**
 * 三阶段动画参数计算 + DOM 更新
 *
 * progress: 0 → P_TRIGGER（=1.50），超过 1.50 会被 clamp
 */
function updateLoader(
  progress: number,
  dom: LoaderDOM,
  showDebug: boolean,
): void {
  const { loader, ring, arcTrail, arrowHead, circleFull, debugEl } = dom;
  if (!loader || !ring || !arcTrail || !arrowHead || !circleFull) return;

  // -------- 1) 按阶段计算角度 / 透明度 / 自转 -------------------------------
  let tailDeg = START_ANG;
  let headDeg = START_ANG;
  let spanDeg = 0;
  let alpha = 0.40;
  let rot = 0;

  if (progress < P_READY) {
    // 阶段 A：弧增长，头比尾快 ~2.3 倍
    const u = progress / P_READY;
    tailDeg = START_ANG + 120 * u;        // -60 → 60
    headDeg = START_ANG + 280 * u;        // -60 → 220
    spanDeg = 160 * u;                     // 0 → 160
  } else if (progress < P_CLOSE) {
    // 阶段 B1：颜色加深，弧增长到 (360-CLOSE_GAP)°，留固定缺口
    const u = (progress - P_READY) / (P_CLOSE - P_READY);
    tailDeg = 60 + 25 * u;                          // 60 → 85
    headDeg = 220 + 165 * u;                        // 220 → 385（与 tail 保持 300°）
    spanDeg = 160 + 140 * u;                        // 160 → 300 (即 360 - CLOSE_GAP)
    alpha = 0.40 + 0.60 * u;                        // 0.40 → 1.00
  } else {
    // 阶段 B2：整体顺时针自转 180°，缺口保持 CLOSE_GAP
    const u = Math.min((progress - P_CLOSE) / (P_TRIGGER - P_CLOSE), 1);
    spanDeg = 360 - CLOSE_GAP;                      // 300
    tailDeg = 85;
    headDeg = 385;
    alpha = 1.00;
    rot = 180 * u;                                  // 0 → 180°
  }

  // -------- 2) 圆圈位置：ease-out（先快后慢），到 100% 停止下降 -------------
  // 圆圈直径 48px：起点在页面顶部之上 48px（完全隐藏），随下拉落入视野
  const LOADER_OFFSET = -48;
  if (progress <= 0) {
    loader.style.top = `${LOADER_OFFSET}px`;
    loader.style.opacity = '0';
  } else {
    const dp = Math.min(progress, P_CLOSE);
    const top = LOADER_OFFSET + (1 - Math.pow(1 - dp, 2)) * MAX_DESCEND;
    loader.style.top = `${top}px`;
    loader.style.opacity = '1';
  }

  // -------- 3) 颜色 / 透明度（通过 currentColor 影响弧线） -----------------
  loader.style.color = `rgba(255,255,255,${alpha})`;

  // -------- 4) 绘制弧线 + 箭头头 -------------------------------------------
  const cx = 30, cy = 30, R = 20;

  if (spanDeg < 359) {
    // 未闭合：画弧 + 箭头头，隐藏完整圆
    const largeArc = spanDeg > 180 ? 1 : 0;
    const tailRad = (tailDeg % 360) * (Math.PI / 180);
    const headRad = (headDeg % 360) * (Math.PI / 180);
    const x1 = cx + R * Math.cos(tailRad);
    const y1 = cy + R * Math.sin(tailRad);
    const x2 = cx + R * Math.cos(headRad);
    const y2 = cy + R * Math.sin(headRad);

    // SVG 弧：M x1 y1 A R R 0 largeArc sweep x2 y2
    // sweep = 1 → 顺时针（屏幕坐标系下从尾走到头）
    arcTrail.setAttribute(
      'd',
      `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    );
    arcTrail.setAttribute('opacity', '1');
    circleFull.setAttribute('opacity', '0');

    // 箭头头：三角形，尖端在头点 + tangent，底边在头点两侧
    // 顺时针切线方向 = headRad + π/2
    const tangentAngle = headRad + Math.PI / 2;
    const tipX = x2 + ARROW_LEN * Math.cos(tangentAngle);
    const tipY = y2 + ARROW_LEN * Math.sin(tangentAngle);
    const perpA = tangentAngle + Math.PI / 2;     // 与切线垂直
    const b1x = x2 + ARROW_HALF_W * Math.cos(perpA);
    const b1y = y2 + ARROW_HALF_W * Math.sin(perpA);
    const b2x = x2 + ARROW_HALF_W * Math.cos(perpA + Math.PI);
    const b2y = y2 + ARROW_HALF_W * Math.sin(perpA + Math.PI);
    arrowHead.setAttribute(
      'points',
      `${tipX.toFixed(2)},${tipY.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)} ${b2x.toFixed(2)},${b2y.toFixed(2)}`,
    );
    arrowHead.setAttribute('opacity', '1');
  } else {
    arcTrail.setAttribute('opacity', '0');
    arrowHead.setAttribute('opacity', '0');
    circleFull.setAttribute('opacity', '1');
  }

  // -------- 5) 整体旋转（B2 阶段） -------------------------------------------
  ring.setAttribute('transform', rot ? `rotate(${rot}, 0, 0)` : 'rotate(0, 0, 0)');

  // -------- 6) "释放刷新" 文字（progress >= 100% 才显示） -------------------
  if (progress >= P_CLOSE) {
    loader.classList.add('ready');
  } else {
    loader.classList.remove('ready');
  }

  // -------- 7) 调试面板（直接改 DOM，零 re-render） -------------------------
  if (showDebug && debugEl) {
    let phase = 'A 增长';
    if (progress >= P_CLOSE) phase = 'B2 半圈';
    else if (progress >= P_READY) phase = 'B1 加深';

    if (debugEl.children[0]) {
      (debugEl.children[0] as HTMLElement).textContent =
        `进度: ${Math.round(progress * 100)}% | ${phase} | 弧: ${Math.round(spanDeg)}° | α: ${alpha.toFixed(2)} | 旋转: ${Math.round(rot)}°`;
    }
    if (debugEl.children[1]) {
      const child = debugEl.children[1] as HTMLElement;
      const trigger = progress >= P_CLOSE;
      child.textContent = trigger ? '✓ 触发' : '未触发';
      child.style.color = trigger ? '#4ade80' : '#fca5a5';
    }
  }
}

/** 回弹动画：从 startProgress 平滑 ease-out 到 0 */
function bounceBack(
  startProgress: number,
  dom: LoaderDOM,
  showDebug: boolean,
  dur = 350,
  onFrame?: (prog: number) => void,
  onComplete?: () => void,
): void {
  const startTime = performance.now();
  function step(t: number) {
    const p = Math.min(1, (t - startTime) / dur);    // 0 → 1
    const eased = 1 - Math.pow(1 - p, 2);            // 0 → 1（ease-out）
    const prog = startProgress * (1 - eased);         // startProgress → 0
    updateLoader(prog, dom, showDebug);
    onFrame?.(prog);
    if (p < 1) requestAnimationFrame(step);
    else { updateLoader(0, dom, showDebug); onFrame?.(0); onComplete?.(); }
  }
  requestAnimationFrame(step);
}

/**
 * 刷新完成动画：从 100% 平滑 ease-out 回到 0。
 *
 * 刷新期间 loader 停在 progress = 1.0（圆环闭合、颜色最深），
 * fetch 完成后调用此函数，圆环平滑上升并淡出。
 */
export function refreshCompleteAnimation(
  dom: LoaderDOM,
  showDebug: boolean,
  dur = 350,
  onComplete?: () => void,
): void {
  const startTime = performance.now();
  function step(t: number) {
    const p = Math.min(1, (t - startTime) / dur);    // 0 → 1
    const eased = 1 - Math.pow(1 - p, 2);            // 0 → 1（ease-out）
    const prog = 1 - eased;                          // 1.0 → 0
    updateLoader(prog, dom, showDebug);
    if (p < 1) requestAnimationFrame(step);
    else { updateLoader(0, dom, showDebug); onComplete?.(); }
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UsePullRefreshProps {
  /** 加载器 + 调试面板 DOM（PullRefreshLoader 暴露的 ref） */
  domRef: MutableRefObject<LoaderDOM | null>;
  /** 内容顶部已滚过的额外拖拽量（App.tsx 的滚动逻辑也读它） */
  contentOffsetRef: MutableRefObject<number>;
  /** 是否显示调试面板 */
  showPullDebug: boolean;
  /** 是否正在刷新（外部传入，用于阻止下拉） */
  isRefreshing: boolean;
  /** 内容当前滚动位置（App.tsx 通过 applyScroll 维护） */
  pageScrollYRef: MutableRefObject<number>;
  /** 内容最大可滚动量 */
  pageMaxScrollRef: MutableRefObject<number>;
  /** 内容滚动更新回调（dy 消耗在正常滚动上时调用） */
  applyScroll: (sy: number) => void;
  /** 触发刷新时的回调（由 App.tsx 实现，负责 fetch 与状态管理） */
  onRefreshTriggered: () => Promise<void>;
  /** 下拉动画结束时（回弹或刷新完成后）调用，由外部清理卡片等附加 transform */
  onRefreshComplete?: () => void;
}

interface UsePullRefreshReturn {
  /** 触摸事件处理函数 */
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
  /** 调试面板拖动 */
  onPullDebugStart: (e: DragEvent) => void;
  onPullDebugMove: (e: DragEvent) => void;
  onPullDebugEnd: (e: DragEvent) => void;
  /** 强制重置 contentOffset（用于 App.tsx 内外部回滚场景） */
  resetContentOffset: () => void;
}

export function usePullRefresh({
  domRef,
  contentOffsetRef,
  showPullDebug,
  isRefreshing,
  pageScrollYRef,
  pageMaxScrollRef,
  applyScroll,
  onRefreshTriggered,
  onRefreshComplete,
}: UsePullRefreshProps): UsePullRefreshReturn {
  // 上一帧触摸 Y（用于计算 dy）
  const lastY = useRef<number>(0);
  // 用 RAF 批处理 updateLoader：handleTouchMove 在 120Hz 下每秒可触发上百次，
  // 每次 updateLoader 写入 ~10 个 DOM 属性（SVG 弧、箭头、颜色、透明度、class），
  // 同步执行会触发多次重排。RAF 批处理保证每帧最多一次，显著降低掉帧。
  const pendingLoader = useRef<{ progress: number; showDebug: boolean } | null>(null);
  const loaderRAF = useRef<number>(0);
  function scheduleLoaderUpdate(progress: number, showDebug: boolean) {
    if (loaderRAF.current) return;
    pendingLoader.current = { progress, showDebug };
    loaderRAF.current = requestAnimationFrame(() => {
      loaderRAF.current = 0;
      if (pendingLoader.current) {
        updateLoader(pendingLoader.current.progress, domRef.current ?? ({} as LoaderDOM), pendingLoader.current.showDebug);
        pendingLoader.current = null;
      }
    });
  }
  // 下拉进度浮动调试元素的位置 & 拖动起点
  const debugPos = useRef({ x: 16, y: 60 });
  const debugDragStart = useRef<DragStart>({ x: 0, y: 0 });

  // 惯性：记录触摸 Y 速度样本（末尾 6 个 {y, t}，t 为 1/60 秒单位）
  const velocitySamples = useRef<{ y: number; t: number }[]>([]);
  let sampleTick = useRef(0);
  // 惯性动画进行中时，阻止新的触摸/下滑触发
  const momentumRunning = useRef(false);

  // onRefreshTriggered 用 ref 持有，F5 键盘监听器始终调用最新版本，
  // 避免回调身份变化时反复增删监听器
  const onRefreshRef = useRef(onRefreshTriggered);
  onRefreshRef.current = onRefreshTriggered;

  /**
   * 惯性滚动：从初速度 v0（px/帧）开始指数衰减，碰到边界或减速到阈值即停。
   * 同时做"吸附"——松手时离顶/底较近则吸附到顶/底。
   */
  function momentumScroll(v0: number) {
    const currentY = pageScrollYRef.current;
    const maxScroll = pageMaxScrollRef.current;

    // 吸附：仅当"贴住边界 + 速度继续往边界冲"时才吸附
    //   v0 > 0 → 手指往下 → 页面继续往上滚（scrollY 减小）→ 在顶继续冲 → 吸附 0
    //   v0 < 0 → 手指往上 → 页面继续往下滚（scrollY 增大）→ 在底继续冲 → 吸附 max
    // 自适应阈值：松散模式 maxScroll 可能仅约 12px，固定 30 会让吸附区覆盖全程
    // → 一拨动即弹回边界的"回退"现象；改用 maxScroll/3 上限 30，区间内仍可正常滚动。
    const snapThreshold = Math.min(30, maxScroll / 3);
    if (v0 < 0 && maxScroll > 0 && currentY > maxScroll - snapThreshold) {
      applyScroll(maxScroll);
      return;
    }

    const vMin = 2;
    if (Math.abs(v0) < vMin) return;

    const damping = 0.90;
    const vMax = 120;
    // 手指速度 → 页面滚动：pageScrollY -= v0（与 handleTouchMove 的 newScroll = scrollY - dy 一致）
    let v = Math.max(-vMax, Math.min(vMax, v0));

    momentumRunning.current = true;
    function step() {
      const currentY = pageScrollYRef.current;
      const newY = currentY - v;
      applyScroll(newY);
      v *= damping;
      if (Math.abs(v) < 0.4) {
        momentumRunning.current = false;
        return;
      }
      // 触顶/底强制停止（用局部变量 currentY 避免反复读 ref）
      if (currentY <= 0 || (maxScroll > 0 && currentY >= maxScroll)) {
        momentumRunning.current = false;
        return;
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const resetContentOffset = useCallback(() => {
    contentOffsetRef.current = 0;
  }, [contentOffsetRef]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return;
      momentumRunning.current = false; // 新触摸停止惯性
      const t = e.touches[0];
      lastY.current = t.clientY;
      contentOffsetRef.current = 0;
      velocitySamples.current = [{ y: t.clientY, t: sampleTick.current }];
      updateLoader(0, domRef.current ?? ({} as LoaderDOM), showPullDebug);
    },
    [domRef, showPullDebug, isRefreshing, contentOffsetRef],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return;

      const y = e.touches[0].clientY;
      const dy = y - lastY.current;
      lastY.current = y;

      // 记录触摸 Y 速度样本（末尾 6 帧）
      sampleTick.current++;
      const samples = velocitySamples.current;
      samples.push({ y, t: sampleTick.current });
      if (samples.length > 6) samples.shift();

      // 先滚动，再下拉：
      //   - pageScrollY > 0：已在滚动区，按 dy 双向更新（上滑下滚 / 下滑上滚）；
      //     已到顶或到底时 applyScroll 被 clamp 原地 return，手指继续下滑自然
      //     溢出到下方 else 分支转成下拉量
      //   - pageScrollY == 0 且 contentOffset == 0 且 dy < 0（顶部、无活跃下拉、
      //     手指上滑）：开始向下滚动——补 contentOffset===0 这个条件很关键：
      //     若此时已有活跃下拉（contentOffset>0），dy<0 是"收回加载圈"，必须
      //     走下方 else 分支让 contentOffset 回 0；否则会被错误吸进滚动分支，
      //     在 maxScroll==0 时 applyScroll 原地 return，contentOffset 冻结 →
      //     加载圈收回不去
      //   - 其余（顶部手指下滑 dy>0 起步下拉；或 contentOffset>0 时 dy<0 收回）：
      //     下拉刷新 / 回弹
      //
      // 关键修正：仅在 pageScrollY == 0（页面真正在顶部）时，才把溢出的 dy 转为
      // 下拉量。快速滑动时 pageScrollY 还在变化中，此时不应触发放入下拉分支，
      // 避免页面未到顶就出现刷新圈。
      if (pageScrollYRef.current > 0) {
        const newScroll = pageScrollYRef.current - dy;
        if (newScroll >= 0) {
          applyScroll(newScroll);
          return;
        }
        // 向上越过顶部：滚动归零；溢出部分仅在本帧 dy>0（手指往下推）时转为下拉量
        pageScrollYRef.current = 0;
        const overflow = -newScroll;
        if (dy > 0) {
          contentOffsetRef.current = Math.max(0, contentOffsetRef.current + overflow);
          applyScroll(0);  // 溢出变下拉：同步更新卡片 transform
        }
        // dy <= 0 时手指在上滑，溢出是惯性冲顶——不进入下拉
      } else if (contentOffsetRef.current === 0 && dy < 0) {
        applyScroll(-dy);
      } else {
        contentOffsetRef.current = Math.max(0, contentOffsetRef.current + dy);
        applyScroll(0);  // 下拉中：同步更新卡片 transform
      }

      const progress = Math.min(P_TRIGGER, contentOffsetRef.current / TOTAL_DRAG);
      scheduleLoaderUpdate(progress, showPullDebug);
    },
    [domRef, showPullDebug, isRefreshing, contentOffsetRef, pageScrollYRef, applyScroll],
  );

  const handleTouchEnd = useCallback(() => {
    if (isRefreshing) return;

    // 算惯性初速度（px/帧）：末尾 6 帧样本平均速度
    const samples = velocitySamples.current;
    let v0 = 0;
    if (samples.length >= 2) {
      const last = samples[samples.length - 1];
      const first = samples[0];
      const dt = last.t - first.t;
      if (dt > 0) {
        v0 = (last.y - first.y) / dt;
      }
    }
    velocitySamples.current = [];

    const progress = Math.min(P_TRIGGER, contentOffsetRef.current / TOTAL_DRAG);

    if (progress >= P_CLOSE) {
      void onRefreshRef.current();
      if (domRef.current?.loader) {
        domRef.current.loader.classList.remove('ready');
      }
      contentOffsetRef.current = 0;
      applyScroll(0);
      updateLoader(P_CLOSE, domRef.current ?? ({} as LoaderDOM), showPullDebug);
    } else {
      // 只有实际下拉了才回弹（contentOffset > 0），否则 bounceBack 的
      // applyScroll(0) 会与 momentumScroll 打架，导致松手后页面瞬移回顶部。
      if (contentOffsetRef.current > 0) {
        const startPo = contentOffsetRef.current;
        bounceBack(progress, domRef.current ?? ({} as LoaderDOM), showPullDebug, 350,
          (prog) => {
            contentOffsetRef.current = prog * startPo;
            applyScroll(0);
          },
          onRefreshComplete,
        );
        contentOffsetRef.current = 0;
      } else {
        updateLoader(0, domRef.current ?? ({} as LoaderDOM), showPullDebug);
      }
      // 松手后有足够末速度时启动惯性滚动
      momentumScroll(v0);
    }
  }, [domRef, showPullDebug, isRefreshing, contentOffsetRef, onRefreshTriggered, onRefreshComplete]);

  // -------- 下拉进度浮动调试元素拖动（与下拉互不干扰） -----------------------
  const onPullDebugStart = useCallback((e: DragEvent) => {
    e.stopPropagation();
    const el = domRef.current?.debugEl;
    if (!el) return;
    const ct = 'touches' in e ? e.touches[0] : e;
    debugDragStart.current = { x: ct.clientX, y: ct.clientY };
    debugPos.current = { x: el.offsetLeft, y: el.offsetTop };
  }, [domRef]);

  const onPullDebugMove = useCallback((e: DragEvent) => {
    e.stopPropagation();
    const el = domRef.current?.debugEl;
    if (!el) return;
    const ct = 'touches' in e ? e.touches[0] : e;
    const dx = ct.clientX - debugDragStart.current.x;
    const dy = ct.clientY - debugDragStart.current.y;
    const newX = Math.max(0, debugPos.current.x + dx);
    const newY = Math.max(0, debugPos.current.y + dy);
    debugPos.current = { x: newX, y: newY };
    el.style.left = `${newX}px`;
    el.style.top = `${newY}px`;
  }, [domRef]);

  const onPullDebugEnd = useCallback((e: DragEvent) => {
    e.stopPropagation();
  }, []);

  // 键盘 F5 也可触发刷新（原 App.tsx 有的行为）
  // 监听器内部读 onRefreshRef.current，因此无需随回调变化而重新订阅
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F5') onRefreshRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    onPullDebugStart,
    onPullDebugMove,
    onPullDebugEnd,
    resetContentOffset,
  };
}
