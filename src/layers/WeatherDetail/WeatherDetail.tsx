import { RefObject } from 'react';
import type { ForecastSource } from '../../api/unifiedWeather';
import type { JiShuData, UApiResponse } from '../../types/weather';
import type { Forecast24Style } from './hooks/Forecast24Hour';
import { Forecast24Hour } from './hooks/Forecast24Hour';
import { Forecast15Day } from './hooks/Forecast15Day';
import { AirQualityList } from './hooks/AirQualityList';
import { LifeIndices } from './hooks/LifeIndices';

export interface WeatherDetailProps {
  jishuData: JiShuData | null;
  uapiData: UApiResponse | null;
  source24: ForecastSource;
  source15: ForecastSource;
  onSource24Change: (s: ForecastSource) => void;
  onSource15Change: (s: ForecastSource) => void;
  forecast24Style: Forecast24Style;
  iconUrlFn: (phrase: string, isNight?: boolean) => string;
  simpleIconUrlFn: (phrase: string, isNight?: boolean) => string;
  yesterday: { date: string; dayOfWeek: string; tempMax: number; tempMin: number; textDay: string; windDir: string; windScale: string; windSpeed: string; humidity: number } | null;
  is24Disabled?: boolean;
  is15Disabled?: boolean;
  cardForecastRef?: RefObject<HTMLDivElement | null>;
  card15dayRef?: RefObject<HTMLDivElement | null>;
}

export function WeatherDetail({
  jishuData,
  uapiData,
  source24,
  source15,
  onSource24Change,
  onSource15Change,
  forecast24Style,
  iconUrlFn,
  simpleIconUrlFn,
  yesterday,
  is24Disabled = false,
  is15Disabled = false,
  cardForecastRef,
  card15dayRef,
}: WeatherDetailProps) {
  return (
    <>
      <div className="card-forecast" ref={cardForecastRef}>
        <Forecast24Hour
          jishuData={jishuData}
          uapiData={uapiData}
          source={source24}
          onSourceChange={onSource24Change}
          iconUrlFn={iconUrlFn}
          style={forecast24Style}
          simpleIconUrlFn={simpleIconUrlFn}
          isDisabled={is24Disabled}
        />
      </div>
      <div className="card-15day" ref={card15dayRef}>
        <Forecast15Day
          jishuData={jishuData}
          uapiData={uapiData}
          source={source15}
          onSourceChange={onSource15Change}
          yesterday={yesterday}
          iconUrlFn={iconUrlFn}
          isDisabled={is15Disabled}
        />
      </div>
      {/* 15 日预报下方：空气质量（极数本源）+ 18 项生活指数（UApiPro） */}
      {(jishuData?.realtime?.air_quality || uapiData?.life_indices) && (
        <div className="card-extra">
          <AirQualityList jishuData={jishuData} />
          <LifeIndices uapiData={uapiData} />
        </div>
      )}
    </>
  );
}