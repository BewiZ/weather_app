/**
 * JiShu → WeatherCurrent / WeatherDay 映射
 *
 * 当 weather.com 不可用/被禁用时，从极数本源（JiShu）数据中提取实况天气
 * 和今天的最高/最低温度，填入 WeatherRealtime 卡片所需的数据结构。
 *
 * 纯函数，无状态、无副作用，方便测试与复用。
 */

import { skyconToPhrase } from '../../../api/unifiedWeather';
import { windDirToCardinal } from '../../../lib/weatherUtils';
import type { JiShuData, WeatherCurrent, WeatherDay } from '../../../types/weather';

interface JiShuFallbackResult {
  current: WeatherCurrent;
  todayDay: WeatherDay | null;
}

/** 将 JiShu API 返回数据归一化为 WeatherRealtime 需要的字段 */
export function buildWeatherCurrentFromJiShu(
  jiShu: JiShuData,
  wkMap: string[],
): JiShuFallbackResult | null {
  const jiShuAny = jiShu as any;
  const rt = jiShuAny.realtime || {};
  const sm = jiShuAny.summary || {};
  const dly = jiShuAny.daily || {};

  const humidity =
    typeof rt.humidity === 'number'
      ? Math.round(rt.humidity * 100)
      : typeof sm.humidity_percent === 'number'
      ? sm.humidity_percent
      : 0;

  const phrase = sm.skycon_code
    ? skyconToPhrase(sm.skycon_code)
    : sm.skycon || '未知';

  const temperature =
    typeof rt.temperature === 'number'
      ? rt.temperature
      : typeof sm.temperature === 'number'
      ? sm.temperature
      : 0;

  const apparent =
    typeof rt.apparent_temperature === 'number'
      ? rt.apparent_temperature
      : typeof sm.apparent_temperature === 'number'
      ? sm.apparent_temperature
      : 0;

  const windDeg =
    typeof rt.wind?.direction === 'number'
      ? rt.wind.direction
      : typeof sm.wind?.direction_deg === 'number'
      ? sm.wind.direction_deg
      : 0;

  const windSpeed =
    typeof rt.wind?.speed === 'number'
      ? rt.wind.speed
      : typeof sm.wind?.speed_ms === 'number'
      ? sm.wind.speed_ms
      : 0;

  const pressureHpa = typeof rt.pressure === 'number' ? Math.round(rt.pressure / 100) : 0;
  const uv = typeof rt.life_index?.ultraviolet?.index === 'number' ? rt.life_index.ultraviolet.index : 0;
  const vis =
    typeof rt.visibility === 'number'
      ? rt.visibility
      : typeof sm.visibility_km === 'number'
      ? sm.visibility_km
      : 0;

  let sunrise = '';
  let sunset = '';
  if (dly.astro && dly.astro.length > 0) {
    sunrise = dly.astro[0].sunrise?.time || '';
    sunset = dly.astro[0].sunset?.time || '';
  }

  const current: WeatherCurrent = {
    temperature,
    phrase,
    temperatureHeatIndex: apparent,
    relativeHumidity: humidity,
    windSpeed,
    windDirectionCardinal: sm.wind?.direction_text || windDirToCardinal(windDeg),
    windDirectionDegrees: windDeg,
    uvIndex: uv,
    pressure: pressureHpa,
    pressTendencyCode: 0,
    visibility: vis,
    sunrise,
    sunset,
    obsQualifierPhrase: '',
    obsTimeLocal: jiShu.server_time || '',
    observationTime: jiShu.server_time || '',
  };

  // 今天最高/最低
  let todayDay: WeatherDay | null = null;
  if (dly.temperature && dly.temperature.length > 0) {
    const today = dly.temperature[0];
    const dateStr = today.date || new Date().toISOString().slice(0, 10);
    todayDay = {
      date: dateStr,
      dayOfWeek: wkMap[new Date(dateStr).getDay()] || '',
      calendarDayTemperatureMax: Number(today.max) || 0,
      calendarDayTemperatureMin: Number(today.min) || 0,
      narrative: phrase,
    };
  }

  return { current, todayDay };
}
