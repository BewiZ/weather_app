import { useCallback, useRef, useMemo } from 'react';
import type { JiShuData, UApiResponse } from '../../../types/weather';
import { buildHourCells, type ForecastSource } from '../../../api/unifiedWeather';
import { catmullRomPath } from './Forecast15Day';
import type { Pt } from './Forecast15Day';
import { SourceSwitcher } from './SourceSwitcher';

export type Forecast24Style = 'complex' | 'simple';

// 天气词 → 区域填充色（语义色：晴暖、云灰、雨蓝、雪青白、雾灰、沙黄）
// 用于"曲线与横轴之间"的相邻同天气色块——非排序分类，故不走调色板校验
function phraseToRegionColor(phrase: string): string {
  if (!phrase) return '#475569';
  if (phrase === '晴') return '#f59e0b';
  if (phrase.includes('多云') || phrase.includes('少云')) return '#cbd5e1';
  if (phrase.includes('阴')) return '#94a3b8';
  if (phrase.includes('雷')) return '#8b5cf6';
  if (phrase.includes('暴雨')) return '#1d4ed8';
  if (phrase.includes('大雨')) return '#2563eb';
  if (phrase.includes('中雨')) return '#3b82f6';
  if (phrase.includes('小雨') || phrase.includes('阵雨')) return '#60a5fa';
  if (phrase.includes('暴雪')) return '#0ea5e9';
  if (phrase.includes('大雪')) return '#38bdf8';
  if (phrase.includes('中雪')) return '#7dd3fc';
  if (phrase.includes('小雪') || phrase === '雪' || phrase.includes('阵雪') || phrase.includes('雨夹雪')) return '#bae6fd';
  if (phrase.includes('沙尘') || phrase.includes('浮尘') || phrase.includes('扬沙')) return '#d6a964';
  if (phrase.includes('雾')) return '#cbd5e1';
  if (phrase.includes('霾')) return '#d6cfc7';
  if (phrase.includes('大风') || phrase.includes('风')) return '#6ee7b7';
  if (phrase.includes('霜')) return '#a5f3fc';
  return '#475569';
}

interface HourCell {
  temp: number;
  phrase: string;
  pop: number;
  hour: number;
  label: string;
}

interface Region {
  a: number;
  b: number;
  color: string;
  xL: number;
  xR: number;
  centerX: number;
  topY: number;
  pop: number;
  phrase: string;
}

interface Forecast24HourProps {
  jishuData: JiShuData | null;
  uapiData: UApiResponse | null;
  source: ForecastSource;
  onSourceChange: (s: ForecastSource) => void;
  iconUrlFn: (phrase: string, isNight?: boolean) => string;
  style: Forecast24Style;
  simpleIconUrlFn?: (phrase: string, isNight?: boolean) => string;
  isDisabled?: boolean;
}

const COLW = 44;
const CHARTH = 98;
const PADTOP = 20;
const BASELINE = 96;
const MINSPAN = 4;
const MINBAND = 24;

const SIMPLE_HCOL = 46;
const SIMPLE_SCOL = 50;

export function Forecast24Hour({ jishuData, uapiData, source, onSourceChange, iconUrlFn, style, simpleIconUrlFn, isDisabled = false }: Forecast24HourProps) {
  const astro = jishuData?.daily?.astro?.[0];

  const horizState = useRef({ startX: 0, startY: 0, scrollLeft: 0, tracking: false, horizontal: false });
  const onScrollTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    horizState.current = {
      startX: t.clientX,
      startY: t.clientY,
      scrollLeft: (e.currentTarget as HTMLDivElement).scrollLeft,
      tracking: true,
      horizontal: false,
    };
  }, []);
  const onScrollTouchMove = useCallback((e: React.TouchEvent) => {
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
    if (dy > dx) return;
    cs.horizontal = true;
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
  const onScrollTouchEnd = useCallback(() => {
    horizState.current.tracking = false;
  }, []);

  const unifiedHours = useMemo(() =>
    buildHourCells({ source, jishu: jishuData, uapi: uapiData }),
    [source, jishuData, uapiData]
  );

  const { cells, curvePts, regions, areaPath } = useMemo<{
    cells: HourCell[];
    curvePts: Pt[];
    regions: Region[];
    areaPath: string;
  }>(() => {
    const hourCells = unifiedHours;
    if (hourCells.length === 0) {
      return { cells: [], curvePts: [], regions: [], areaPath: '' };
    }

    const cells: HourCell[] = hourCells.map((h, i) => ({
      temp: h.temp,
      phrase: h.phrase,
      pop: h.pop,
      hour: h.hour,
      label: i === 0 ? '现在' : String(h.hour),
    }));

    const vals = cells.map(c => c.temp);
    const tMin = Math.min(...vals);
    const tMax = Math.max(...vals);
    const span = Math.max(MINSPAN, tMax - tMin);
    const dataMid = (tMax + tMin) / 2;
    const winMax = dataMid + span / 2;
    const yTop = PADTOP;
    const yBot = BASELINE - MINBAND;
    const yOf = (t: number) => yTop + (yBot - yTop) * (winMax - t) / span;

    const curvePts: Pt[] = cells.map((c, i) => ({
      x: COLW / 2 + i * COLW,
      y: yOf(c.temp),
      t: c.temp,
    }));

    const regions: Region[] = [];
    let a = 0;
    for (let i = 1; i <= cells.length; i++) {
      if (i === cells.length || cells[i].phrase !== cells[a].phrase) {
        const b = i - 1;
        const xL = curvePts[a].x - COLW / 2;
        const xR = curvePts[b].x + COLW / 2;
        const centerX = (xL + xR) / 2;
        let sumY = 0, pop = 0;
        for (let j = a; j <= b; j++) { sumY += curvePts[j].y; pop = Math.max(pop, cells[j].pop); }
        regions.push({
          a, b,
          color: phraseToRegionColor(cells[a].phrase),
          xL, xR, centerX,
          topY: sumY / (b - a + 1),
          pop,
          phrase: cells[a].phrase,
        });
        a = i;
      }
    }

    const first = curvePts[0];
    const last = curvePts[curvePts.length - 1];
    const xL0 = first.x - COLW / 2;
    const xRN = last.x + COLW / 2;
    const curveD = catmullRomPath(curvePts).replace(/^M /, 'L ');
    const areaPath = `M ${xL0.toFixed(2)} ${BASELINE} L ${xL0.toFixed(2)} ${first.y.toFixed(2)} ${curveD} L ${xRN.toFixed(2)} ${last.y.toFixed(2)} L ${xRN.toFixed(2)} ${BASELINE} Z`;

    return { cells, curvePts, regions, areaPath };
  }, [unifiedHours]);

  const simpleData = useMemo(() => {
    const hourCells = unifiedHours;
    if (hourCells.length === 0) return null;

    const sunriseTime = astro?.sunrise?.time;
    const sunsetTime = astro?.sunset?.time;

    const sunriseFloorHour = sunriseTime ? Math.floor(parseInt(sunriseTime.slice(0, 2), 10)) : null;
    const sunsetFloorHour = sunsetTime ? Math.floor(parseInt(sunsetTime.slice(0, 2), 10)) : null;

    const hourCellByHour = new Map<number, { cell: HourCell; label: string }>();
    for (let i = 0; i < hourCells.length; i++) {
      const c = hourCells[i];
      const label = i === 0 ? '现在' : String(c.hour);
      hourCellByHour.set(c.hour, { cell: { temp: c.temp, phrase: c.phrase, pop: c.pop, hour: c.hour, label }, label });
    }

    const startH = hourCells[0]?.hour ?? 0;

    const slots: {
      kind: 'hour' | 'sunrise' | 'sunset';
      hour: number;
      seq: number;
      boundaryOrder: number;
      timeLabel: string;
      timeStr: string;
      temp: number;
      phrase: string;
      pop: number;
      isNow?: boolean;
    }[] = [];

    for (let i = 0; i < hourCells.length; i++) {
      const c = hourCells[i];
      const idxHour = (startH + i) % 24;
      slots.push({
        kind: 'hour',
        hour: idxHour,
        seq: i,
        boundaryOrder: 2,
        timeLabel: String(idxHour).padStart(2, '0'),
        timeStr: String(idxHour).padStart(2, '0') + ':00',
        temp: c.temp,
        phrase: c.phrase,
        pop: c.pop,
        isNow: false,
      });
    }

    const hourToSeq = (floorH: number) => (floorH - startH + 24) % 24;
    const insertBoundary = (kind: 'sunrise' | 'sunset', floorH: number | null, timeStr: string | undefined) => {
      if (floorH == null || !timeStr) return;
      const floorCell = hourCellByHour.get(floorH);
      if (!floorCell) return;
      slots.push({
        kind,
        hour: floorH,
        seq: hourToSeq(floorH),
        boundaryOrder: kind === 'sunrise' ? 0 : 1,
        timeLabel: timeStr,
        timeStr,
        temp: floorCell.cell.temp,
        phrase: kind === 'sunrise' ? '日出' : '日落',
        pop: 0,
        isNow: false,
      });
    };
    if (sunriseTime) insertBoundary('sunrise', sunriseFloorHour, sunriseTime);
    if (sunsetTime) insertBoundary('sunset', sunsetFloorHour, sunsetTime);

    slots.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.boundaryOrder - b.boundaryOrder;
    });

    return slots;
  }, [unifiedHours, astro]);

  const sunriseTime = astro?.sunrise?.time;
  const sunsetTime = astro?.sunset?.time;

  if (style === 'simple' && simpleData) {
    const simpleIcon = simpleIconUrlFn || iconUrlFn;
    let boundaryCount = 0;
    for (const s of simpleData) if (s.kind !== 'hour') boundaryCount++;
    const totalWidth = 24 * SIMPLE_HCOL + boundaryCount * SIMPLE_SCOL;

    return (
      <section className={`forecast-24h${isDisabled ? ' fc-card-disabled' : ''}`}>
        {isDisabled && (
          <div className="fc-card-overlay">
            <span className="fc-card-disabled-text">当前 API 被禁用</span>
          </div>
        )}
        <div className="fc24-header">
          <span className="fc24-title">24小时预报 · 简约</span>
          <span className="fc24-header-right">
            <SourceSwitcher source={source} onChange={onSourceChange} />
          </span>
        </div>
        <div className="fc24-scroll"
          onTouchStart={onScrollTouchStart}
          onTouchMove={onScrollTouchMove}
          onTouchEnd={onScrollTouchEnd}>
          <div className="fc24-simple-inner" style={{ width: totalWidth }}>
            {simpleData.map((slot, idx) => {
              const width = slot.kind === 'hour' ? SIMPLE_HCOL : SIMPLE_SCOL;
              const isNightSlot = slot.kind === 'hour' && (slot.hour < 6 || slot.hour >= 18);

              return (
                <div className={`fc24-simple-col fc24-simple-${slot.kind}`} key={`s${idx}-${slot.kind}`} style={{ width }}>
                  <span className="fc24-simple-time">{slot.timeLabel}</span>
                  <span className="fc24-simple-icongroup">
                    <span className="fc24-simple-icon">
                      <img
                        src={simpleIcon(slot.phrase, isNightSlot)}
                        alt=""
                      />
                    </span>
                    {slot.pop > 0 && (
                      <span className="fc24-simple-pop">{slot.pop}%</span>
                    )}
                  </span>
                  <span className="fc24-simple-temp">{Math.round(slot.temp)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  if (cells.length === 0 && !isDisabled) return null;

  const totalW = cells.length * COLW;

  return (
    <section className={`forecast-24h${isDisabled ? ' fc-card-disabled' : ''}`}>
      {isDisabled && (
        <div className="fc-card-overlay">
          <span className="fc-card-disabled-text">当前 API 被禁用</span>
        </div>
      )}
      <div className="fc24-header">
        <span className="fc24-title">24小时预报</span>
        <span className="fc24-header-right">
          <SourceSwitcher source={source} onChange={onSourceChange} />
          {(sunriseTime || sunsetTime) && (
            <span className="fc24-astro">
            {sunriseTime && (
              <span className="fc24-astro-item">
                <img src={iconUrlFn('日出_白线')} alt="" className="fc24-astro-icon" /> {sunriseTime}
              </span>
            )}
            {sunsetTime && (
              <span className="fc24-astro-item">
                <img src={iconUrlFn('日落_白线')} alt="" className="fc24-astro-icon" /> {sunsetTime}
              </span>
            )}
          </span>
        )}
        </span>
      </div>
      <div className="fc24-scroll"
        onTouchStart={onScrollTouchStart}
        onTouchMove={onScrollTouchMove}
        onTouchEnd={onScrollTouchEnd}>
        <div className="fc24-inner" style={{ width: totalW }}>
          <svg className="fc24-chart" width={totalW} height={CHARTH} aria-hidden="true">
            <defs>
              <linearGradient id="fc24-tempgrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
              <clipPath id="fc24-area">
                <path d={areaPath} />
              </clipPath>
            </defs>
            <g clipPath="url(#fc24-area)">
              {regions.map((r, i) => (
                <rect
                  key={`r${i}`}
                  x={r.xL}
                  y={0}
                  width={r.xR - r.xL}
                  height={BASELINE}
                  fill={r.color}
                  fillOpacity={0.5}
                />
              ))}
            </g>
            <line x1={0} y1={BASELINE} x2={totalW} y2={BASELINE} className="fc24-axis" />
            {curvePts.length > 1 && (
              <path d={catmullRomPath(curvePts)} className="fc24-curve" fill="none" />
            )}
            {curvePts.map((p, i) => (
              <g key={`p${i}`}>
                <circle cx={p.x} cy={p.y} r={2.5} className="fc24-dot" />
                <text x={p.x} y={p.y - 8} textAnchor="middle" className="fc24-temp">{Math.round(cells[i].temp)}°</text>
              </g>
            ))}
            {regions.map((r, i) => {
              const bandTop = r.topY;
              const weatherY = Math.max(bandTop + 13, Math.min(BASELINE - 10, (bandTop + BASELINE) / 2));
              const precipY = weatherY + 8;
              return (
                <g key={`t${i}`}>
                  <text x={r.centerX} y={weatherY} textAnchor="middle" className="fc24-region-weather">
                    {r.phrase || '—'}
                  </text>
                  {r.pop > 0 && (
                    <text x={r.centerX} y={precipY} textAnchor="middle" className="fc24-region-pop">
                      {r.pop}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="fc24-cols">
            {cells.map((c, i) => (
              <div className="fc24-col" key={`c${i}`} style={{ width: COLW }}>
                <span className="fc24-time">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}