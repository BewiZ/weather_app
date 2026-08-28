import type { JiShuData } from '../../../types/weather';

/**
 * 空气质量列表（极数本源 realtime.air_quality）
 *
 * 置于 15 日预报卡片下方。样式暂定简单列表：两个 AQI 读数 + 六项污染物。
 */

/** 极数本源实时空气质量（realtime.air_quality） */
type JiShuAirQuality = NonNullable<JiShuData['realtime']>['air_quality'];

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

  return (
    <div className="aq-card">
      <div className="aq-head">
        <span className="aq-title">空气质量</span>
        <span className="aq-src">极数本源 · 实时</span>
      </div>
      <div className="aq-aqi">
        <div className="aq-aqi-item">
          <span className="aq-aqi-num">{aq.aqi?.chn ?? '—'}</span>
          <span className="aq-aqi-meta">
            <span>中国 AQI</span>
            <span>{aq.description?.chn || ''}</span>
          </span>
        </div>
        <div className="aq-aqi-item">
          <span className="aq-aqi-num">{aq.aqi?.usa ?? '—'}</span>
          <span className="aq-aqi-meta">
            <span>美国 AQI</span>
            <span>{aq.description?.usa || ''}</span>
          </span>
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
  );
}
