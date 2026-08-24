import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import type { JiShuData, UApiResponse } from '../../../types/weather';
import type { WeatherYesterday } from '../../../types/weather';
import { buildDayCards, type ForecastSource, type UnifiedDayCard } from '../../../api/unifiedWeather';
import { SourceSwitcher } from './SourceSwitcher';

type ForecastCard = UnifiedDayCard & { key: string };

// (weather/week/wind 映射下沉到 unifiedWeather.ts；本组件只做渲染)

// AQI 等级 → 标准六级配色（国标/环保局）；未查找到（null）返回白色
function aqiColor(aqi: number | null): string {
  if (aqi == null) return '#ffffff';
  if (aqi <= 50) return '#00E400';   // 一级 优
  if (aqi <= 100) return '#FFFF00';  // 二级 良
  if (aqi <= 150) return '#FF7E00';  // 三级 轻度污染
  if (aqi <= 200) return '#FF0000';  // 四级 中度污染
  if (aqi <= 300) return '#99004C';  // 五级 重度污染
  return '#7E0023';                   // 六级 严重污染
}

// 温度趋势曲线：Catmull-Rom 样条 → 三次贝塞尔路径（平滑曲线）
export interface Pt { x: number; y: number; t: number }
export function catmullRomPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  if (pts.length === 2) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)} ${pts[1].y.toFixed(2)}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// Catmull-Rom 区间路径：绘制 pts[from..to] 之间的曲线段，邻居上下文与完整路径一致
// （0→1 段与 1→末段拼接后几何上等价于完整 catmullRomPath，便于单独给首段加虚线）
export function catmullRomRange(pts: Pt[], from: number, to: number): string {
  if (from >= to || pts.length === 0) return '';
  let d = `M ${pts[from].x.toFixed(2)} ${pts[from].y.toFixed(2)}`;
  for (let i = from; i < to; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

interface ChartGeom {
  width: number;
  height: number;
  top: number;
  hi: Pt[];
  lo: Pt[];
}

interface Forecast15DayProps {
  jishuData: JiShuData | null;
  uapiData: UApiResponse | null;
  source: ForecastSource;
  onSourceChange: (s: ForecastSource) => void;
  yesterday: WeatherYesterday | null;
  iconUrlFn: (phrase: string, isNight?: boolean) => string;
  isDisabled?: boolean;
}

export function Forecast15Day({ jishuData, uapiData, source, onSourceChange, yesterday, iconUrlFn, isDisabled = false }: Forecast15DayProps) {
  // 水平滚动隔离：
  //   - touchStart 只做初始化，不调 stopPropagation——让外层页面滚动能正常注册；
  //   - touchMove 里判断方向：水平 → 接管水平滚动 + preventDefault；
  //     垂直 → 完全放行给外层（页面上下滚动）；
  //   - 这样手指放卡片上，上下滑页面能滚，左右滑走水平滚动，互不干扰。
  const horizState = useRef({ startX: 0, startY: 0, scrollLeft: 0, tracking: false, horizontal: false });
  const onListTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const el = e.currentTarget as HTMLDivElement;
    horizState.current = {
      startX: t.clientX,
      startY: t.clientY,
      scrollLeft: el.scrollLeft,
      tracking: true,
      horizontal: false,
    };
  }, []);
  const onListTouchMove = useCallback((e: React.TouchEvent) => {
    const cs = horizState.current;
    if (!cs.tracking) return;
    if (cs.horizontal) {
      const el = e.currentTarget as HTMLDivElement;
      const rawDx = e.touches[0].clientX - cs.startX;
      const clamped = Math.max(
        0,
        Math.min(el.scrollWidth - el.clientWidth, cs.scrollLeft - rawDx),
      );
      el.scrollLeft = clamped;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const dx = Math.abs(e.touches[0].clientX - cs.startX);
    const dy = Math.abs(e.touches[0].clientY - cs.startY);
    if (dy > dx) return; // 垂直：放行
    cs.horizontal = true; // 水平：锁定
    const el = e.currentTarget as HTMLDivElement;
    const rawDx = e.touches[0].clientX - cs.startX;
    const clamped = Math.max(
      0,
      Math.min(el.scrollWidth - el.clientWidth, cs.scrollLeft - rawDx),
    );
    el.scrollLeft = clamped;
    e.stopPropagation();
    e.preventDefault();
  }, []);
  const onListTouchEnd = useCallback(() => {
    horizState.current.tracking = false;
  }, []);

  const unifiedCards: ForecastCard[] | null = useMemo(() => {
    const days = buildDayCards({ source, jishu: jishuData, uapi: uapiData });
    if (days.length === 0) return null;
    return days.map(d => ({ ...d, key: `${source}-${d.idx}` }));
  }, [source, jishuData, uapiData]);

  const rows = useMemo(() => {
    const r: { yesterday: boolean; card?: ForecastCard }[] = [];
    if (yesterday) r.push({ yesterday: true });
    if (unifiedCards) for (const c of unifiedCards) r.push({ yesterday: false, card: c });
    return r;
  }, [yesterday, unifiedCards]);

  const tempData = useMemo(() => {
    return rows.map(row => {
      if (row.yesterday) return { hi: yesterday!.tempMax, lo: yesterday!.tempMin };
      return { hi: row.card!.high, lo: row.card!.low };
    });
  }, [rows, yesterday]);

  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [chart, setChart] = useState<ChartGeom | null>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const cardEls = cardRefs.current.slice(0, rows.length).filter(Boolean) as HTMLDivElement[];
    if (cardEls.length === 0 || tempData.length === 0) { setChart(null); return; }
    const firstBand = cardEls[0].querySelector('.fc-chart-band') as HTMLElement | null;
    if (!firstBand) { setChart(null); return; }

    const listRect = list.getBoundingClientRect();
    const bandRect = firstBand.getBoundingClientRect();
    const top = bandRect.top - listRect.top - list.clientTop + list.scrollTop;
    const height = bandRect.height;
    const width = list.scrollWidth;
    const centers = cardEls.map(el => {
      const r = el.getBoundingClientRect();
      return r.left - listRect.left - list.clientLeft + list.scrollLeft + r.width / 2;
    });

    const allTemps = tempData.flatMap(d => [d.hi, d.lo]).filter((v): v is number => v != null);
    if (allTemps.length === 0) { setChart(null); return; }
    let tMin = Math.min(...allTemps);
    let tMax = Math.max(...allTemps);
    if (tMax - tMin < 4) { const mid = (tMax + tMin) / 2; tMin = mid - 2; tMax = mid + 2; }
    const padTop = 14, padBot = 18;
    const span = tMax - tMin;
    const yOf = (t: number) => padTop + (height - padTop - padBot) * (tMax - t) / span;

    const hi: Pt[] = [], lo: Pt[] = [];
    centers.forEach((x, i) => {
      const d = tempData[i];
      if (!d) return;
      if (d.hi != null) hi.push({ x, y: yOf(d.hi), t: d.hi });
      if (d.lo != null) lo.push({ x, y: yOf(d.lo), t: d.lo });
    });

    setChart({ width, height, top, hi, lo });
  }, [tempData, rows.length, tick]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const bump = () => setTick(t => t + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(list);
    window.addEventListener('resize', bump);
    return () => { ro.disconnect(); window.removeEventListener('resize', bump); };
  }, []);

  if (!unifiedCards && !isDisabled) return null;

  return (
    <div className={`forecast-15day${isDisabled ? ' fc-card-disabled' : ''}`}>
      {isDisabled && (
        <div className="fc-card-overlay">
          <span className="fc-card-disabled-text">当前 API 被禁用</span>
        </div>
      )}
      <div className="forecast-15day-corner">
        <span className="fc-section-title">15天预报</span>
        <span className="fc-legend">
          <span className="fc-legend-item"><i className="fc-swatch fc-swatch-hi" />最高</span>
          <span className="fc-legend-item"><i className="fc-swatch fc-swatch-lo" />最低</span>
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <SourceSwitcher source={source} onChange={onSourceChange} />
        </span>
      </div>
      <div className="forecast-15day-list" ref={listRef}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}>
        {rows.map((row, i) => {
          if (row.yesterday && yesterday) {
            return (
              <div className="forecast-15day-card yesterday" key="y" ref={el => { cardRefs.current[i] = el; }}>
                <span className="fc-weekday">{yesterday.dayOfWeek}</span>
                <span className="fc-date">{yesterday.date.slice(4, 6)}{yesterday.date.slice(6, 8)}</span>
                <span className="fc-day-phrase">{yesterday.textDay || '—'}</span>
                <span className="fc-icon-row">
                  <img src={iconUrlFn(yesterday.textDay, false)} alt="" className="weather-icon-img" />
                </span>
                <div className="fc-chart-band" />
                {yesterday.windDir && <span className="fc-wind">{yesterday.windDir}风</span>}
                <span className="fc-wind">{yesterday.windScale || 'N/A'}</span>
                <span className="fc-aqi" style={{ color: aqiColor(null) }}>AQI N/A</span>
              </div>
            );
          }
          const c = row.card!;
          return (
            <div className={`forecast-15day-card${c.isToday ? ' today' : ''}`} key={c.key} ref={el => { cardRefs.current[i] = el; }}>
              <span className="fc-weekday">{c.weekday}</span>
              <span className="fc-date">{c.dateShort}</span>
              <span className="fc-day-phrase">{c.phraseDay || '—'}</span>
              <span className="fc-icon-row">
                <img src={iconUrlFn(c.phraseDay, false)} alt="" className="weather-icon-img" />
                {c.precipDay > 0 && <span className="fc-precip-inline">{c.precipDay}%</span>}
              </span>
              <div className="fc-chart-band" />
              <span className="fc-night-phrase">{c.phraseNight || '—'}</span>
              <span className="fc-icon-row">
                <img src={iconUrlFn(c.phraseNight, true)} alt="" className="weather-icon-img" />
                {c.precipNight > 0 && <span className="fc-precip-inline">{c.precipNight}%</span>}
              </span>
              {c.windDir && <span className="fc-wind">{c.windDir}风</span>}
              <span className="fc-wind">{c.windLevel}</span>
              <span className="fc-aqi" style={{ color: aqiColor(c.aqi) }}>{c.aqi != null ? `AQI ${c.aqi}` : 'AQI N/A'}</span>
            </div>
          );
        })}

        {chart && chart.hi.length > 0 && (
          <svg className="fc-chart-svg" width={chart.width} height={chart.height} style={{ top: chart.top, left: 0 }} aria-hidden="true">
            {yesterday && chart.hi.length >= 2 ? (
              <>
                <path d={catmullRomRange(chart.hi, 0, 1)} className="fc-curve fc-curve-hi fc-curve-past" />
                <path d={catmullRomRange(chart.hi, 1, chart.hi.length - 1)} className="fc-curve fc-curve-hi" />
              </>
            ) : (
              <path d={catmullRomPath(chart.hi)} className="fc-curve fc-curve-hi" />
            )}
            {yesterday && chart.lo.length >= 2 ? (
              <>
                <path d={catmullRomRange(chart.lo, 0, 1)} className="fc-curve fc-curve-lo fc-curve-past" />
                <path d={catmullRomRange(chart.lo, 1, chart.lo.length - 1)} className="fc-curve fc-curve-lo" />
              </>
            ) : (
              <path d={catmullRomPath(chart.lo)} className="fc-curve fc-curve-lo" />
            )}
            {chart.hi.map((p, idx) => (
              <g key={`h${idx}`}>
                <circle cx={p.x} cy={p.y} r={3} className={`fc-dot fc-dot-hi${idx === 0 && yesterday ? ' fc-dot-past' : ''}`} />
                <text x={p.x} y={p.y - 6} textAnchor="middle" className={`fc-val fc-val-hi${idx === 0 && yesterday ? ' fc-val-past' : ''}`}>{p.t}°</text>
              </g>
            ))}
            {chart.lo.map((p, idx) => (
              <g key={`l${idx}`}>
                <circle cx={p.x} cy={p.y} r={3} className={`fc-dot fc-dot-lo${idx === 0 && yesterday ? ' fc-dot-past' : ''}`} />
                <text x={p.x} y={p.y + 12} textAnchor="middle" className={`fc-val fc-val-lo${idx === 0 && yesterday ? ' fc-val-past' : ''}`}>{p.t}°</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}