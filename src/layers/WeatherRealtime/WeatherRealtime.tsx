import { forwardRef } from 'react';
import { WeatherMetrics } from './hooks/WeatherMetrics';
import type { WeatherCurrent } from '../../App';

export interface WeatherRealtimeProps {
  current: WeatherCurrent;
  todayMax: number;
  todayMin: number;
  isDisabled?: boolean;
}

export const WeatherRealtime = forwardRef<HTMLDivElement, WeatherRealtimeProps>(
  ({ current, todayMax, todayMin, isDisabled = false }, ref) => {
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
            体感温度 {current.temperatureHeatIndex}°
          </div>
          <div className="weather-hero-hl">
            最高 {todayMax}°
            <span className="weather-hero-hl-sep">/</span>
            最低 {todayMin}°
          </div>
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
              sunrise: current.sunrise,
              sunset: current.sunset,
            }}
          />
        </div>
      </div>
    );
  },
);