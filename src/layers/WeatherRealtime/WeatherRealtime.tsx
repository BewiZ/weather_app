import { forwardRef } from 'react';
import { WeatherMetrics } from './hooks/WeatherMetrics';
import { WeatherWarningBar } from './hooks/WeatherWarningBar';
import type { WeatherCurrent } from '../../types/weather';
import type { CmaAlarm } from '../../api/cmaAlarm';

const REALTIME_SOURCE_LABELS: Record<string, string> = {
  weather_com: 'weather.com',
  jishu: '极数本源',
  msn: 'MSN 中国版',
};

export interface WeatherRealtimeProps {
  current: WeatherCurrent;
  todayMax: number;
  todayMin: number;
  realtimeSource?: string;
  isDisabled?: boolean;
  /** 中央气象台气象预警；存在时插入「最高最低温度」与「六项指标」之间 */
  cmaAlarms?: CmaAlarm[];
}

export const WeatherRealtime = forwardRef<HTMLDivElement, WeatherRealtimeProps>(
  ({ current, todayMax, todayMin, realtimeSource, isDisabled = false, cmaAlarms = [] }, ref) => {
    const sourceLabel = realtimeSource ? REALTIME_SOURCE_LABELS[realtimeSource] || realtimeSource : '';
    return (
      <div className="card-realtime" ref={ref}>
        <div className={`weather-hero weather-hero-left${isDisabled ? ' fc-card-disabled' : ''}`}>
          {isDisabled && (
            <div className="fc-card-overlay">
              <span className="fc-card-disabled-text">当前 API 被禁用</span>
            </div>
          )}
          <div className="weather-hero-temp">
            <span className="weather-big-num">{current.temperature}</span>
            <span className="weather-big-unit">℃</span>
          </div>
          <div className="weather-hero-phrase">
            {current.phrase}
            {current.obsQualifierPhrase && <span>{current.obsQualifierPhrase}</span>}
          </div>
          <div className="weather-hero-feels">
            <span>体感温度 {current.temperatureHeatIndex}°</span>
            {sourceLabel && <span className="weather-hero-source">来源: {sourceLabel}</span>}
          </div>
          <div className="weather-hero-hl">
            最高 {todayMax}°
            <span className="weather-hero-hl-sep">/</span>
            最低 {todayMin}°
          </div>
          <WeatherWarningBar alarms={cmaAlarms} />
          <WeatherMetrics
            data={{
              windSpeed: current.windSpeed,
              windDirectionCardinal: current.windDirectionCardinal,
              windDirectionDegrees: current.windDirectionDegrees,
              relativeHumidity: current.relativeHumidity,
              pressure: current.pressure,
              pressTendencyCode: current.pressTendencyCode,
              visibility: current.visibility,
              uvIndex: current.uvIndex,
              cloudCover: current.cloudCover,
              sky: current.sky,
            }}
          />
        </div>
      </div>
    );
  },
);