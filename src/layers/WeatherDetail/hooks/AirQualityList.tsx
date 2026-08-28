import type { JiShuData } from '../../../types/weather';

/**
 * 空气质量（极数本源 realtime.air_quality）
 *
 * 中国 AQI 以「缺一段弧的圆环」呈现：
 *   · 缺口张角 a 满足 tan(a/2) = 1/2（≈ 53.13°），开口朝下，端点圆角
 *   · 进度域 0~500，增长比例 y = 4e-7·x³ - 8e-4·x² + 0.5x（x = 500 时 y = 100）
 *   · 颜色按 AQI 六级分区，数值居于环心
 *
 * 置于 15 日预报卡片下方，六项污染物以 3 列 × 2 行网格列于环右侧。
 */

/** 极数本源实时空气质量（realtime.air_quality） */
type JiShuAirQuality = NonNullable<JiShuData['realtime']>['air_quality'];

const AQI_MAX = 500;
const SIZE = 70;
const RADIUS = 26;
const CENTER = SIZE / 2;

// 缺口张角 a = 2·atan(1/2) ≈ 53.13°，其余 306.87° 为实绘弧
const GAP_HALF = Math.atan(0.5);
const ARC_RAD = 2 * Math.PI - 2 * GAP_HALF;
const ARC_LEN = RADIUS * ARC_RAD;

// 屏幕坐标 y 轴向下，「朝下」对应 π/2
const GAP_CENTER = Math.PI / 2;
const TH_START = GAP_CENTER + GAP_HALF; // 缺口左缘（画面左下）
const TH_END = GAP_CENTER - GAP_HALF;   // 缺口右缘（画面右下）

const pt = (th: number) =>
  `${(CENTER + RADIUS * Math.cos(th)).toFixed(3)} ${(CENTER + RADIUS * Math.sin(th)).toFixed(3)}`;

// 起点 → 顺时针（经左侧、顶部、右侧）→ 终点，跨 306.87° > 180°，故 large-arc-flag = 1
const RING_PATH = `M ${pt(TH_START)} A ${RADIUS} ${RADIUS} 0 1 1 ${pt(TH_END)}`;

/** AQI → 进度比例。x ∈ [0,500] 时 y ∈ [0,100]，全程单调递增。 */
function aqiToFraction(x: number): number {
  const v = Math.min(AQI_MAX, Math.max(0, x));
  const y = 4e-7 * v ** 3 - 8e-4 * v ** 2 + 0.5 * v;
  return Math.min(1, Math.max(0, y / 100));
}

/** AQI 六级分区（GB 3095 / HJ 633-2012 标准配色） */
const TIERS = [
  { max: 50, label: '优', color: '#00e400' },
  { max: 100, label: '良好', color: '#ffff00' },
  { max: 150, label: '轻度污染', color: '#ff7e00' },
  { max: 200, label: '中度污染', color: '#ff0000' },
  { max: 300, label: '重度污染', color: '#99004c' },
  { max: 500, label: '严重污染', color: '#7e0023' },
] as const;

function tierOf(aqi: number) {
  return TIERS.find(t => aqi <= t.max) ?? TIERS[TIERS.length - 1];
}

/** 污染物展示顺序：字段名 → 标签 */
const POLLUTANT_ROWS: { key: keyof Pick<JiShuAirQuality, 'pm25' | 'pm10' | 'o3' | 'so2' | 'no2' | 'co'>; label: string }[] = [
  { key: 'pm25', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'o3', label: 'O₃' },
  { key: 'no2', label: 'NO₂' },
  { key: 'so2', label: 'SO₂' },
  { key: 'co', label: 'CO' },
];

export interface AirQualityListProps {
  jishuData: JiShuData | null;
}

export function AirQualityList({ jishuData }: AirQualityListProps) {
  const aq = jishuData?.realtime?.air_quality;
  if (!aq) return null;

  const aqiVal = aq.aqi?.chn;
  const tier = aqiVal != null ? tierOf(aqiVal) : null;
  const frac = aqiVal != null ? aqiToFraction(aqiVal) : 0;
  const offset = ARC_LEN * (1 - frac);
  const label = aq.description?.chn || tier?.label || '';

  return (
    <div className="aq-card">
      <div className="aq-head">
        <span className="aq-title">空气质量</span>
        <span className="aq-src">极数本源 · 实时</span>
      </div>
      <div className="aq-body">
        <div className="aq-ring">
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <path className="aq-ring-track" d={RING_PATH} />
            {frac > 0 && (
              <path
                className="aq-ring-arc"
                d={RING_PATH}
                stroke={tier!.color}
                strokeDasharray={ARC_LEN}
                strokeDashoffset={offset}
              />
            )}
          </svg>
          <div className="aq-ring-center">
            <span className="aq-ring-val" style={tier ? { color: tier.color } : undefined}>
              {aqiVal ?? '—'}
            </span>
            {label && (
              <span className="aq-ring-label" style={tier ? { color: tier.color } : undefined}>
                {label}
              </span>
            )}
          </div>
        </div>
        <div className="aq-list">
          {POLLUTANT_ROWS.map(r => (
            <span className="aq-item" key={r.key}>
              <span className="aq-item-label">{r.label}</span>
              <span className="aq-item-val">{aq[r.key]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
