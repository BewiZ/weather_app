/**
 * weather.com 天气（observations/current + forecast/daily/10day）→ WeatherCurrent / WeatherDay 映射
 *
 * 切换实况天气来源时，从缓存的原始数据重新构建 WeatherRealtime 卡片所需的数据结构，
 * 无需重新发起网络请求（原始数据已缓存在 raw* ref 中）。
 *
 * 纯函数，无状态、无副作用。
 *
 * weather.com 单位：
 * - 温度 ℃（已正确）
 * - 风速 km/h（已正确）
 * - 气压 hPa（pressureMeanSeaLevel，已正确）
 * - 风向：数值 windDirection（度）+ 文本 windDirectionCardinal
 */

import type { WeatherCurrent, WeatherDay } from '../../../types/weather';

export function buildWeatherCurrentFromWeatherCom(
  obs: Record<string, unknown> | null,
): WeatherCurrent | null {
  if (!obs) return null;
  const o = obs as any;
  if (typeof o.temperature !== 'number' || Number.isNaN(o.temperature)) return null;
  return {
    temperature: Number(o.temperature) || 0,
    phrase: o.wxPhraseLong || o.wxPhraseMedium || o.cloudCoverPhrase || '未知',
    cloudCover: o.cloudCover !== undefined ? Number(o.cloudCover) : undefined,
    temperatureHeatIndex: Number(o.temperatureFeelsLike) || 0,
    relativeHumidity: Number(o.relativeHumidity) || 0,
    windSpeed: Number(o.windSpeed) || 0,
    windDirectionCardinal: o.windDirectionCardinal || '',
    windDirectionDegrees: Number(o.windDirection) || 0,
    uvIndex: o.uvIndex !== undefined ? Number(o.uvIndex) : 0,
    pressure: Number(o.pressureMeanSeaLevel) || 0,
    pressTendencyCode: Number(o.pressTendencyCode) || 0,
    visibility: Number(o.visibility) || 0,
    sunrise: o.sunriseTimeLocal || '',
    sunset: o.sunsetTimeLocal || '',
    obsQualifierPhrase: '',
    obsTimeLocal: o.observationTime || '',
    observationTime: o.observationTime || '',
  };
}

export function buildWeatherDaysFromWeatherCom(
  fc: Record<string, unknown> | null,
  wkMap: string[],
): WeatherDay[] {
  if (!fc) return [];
  const f = fc as any;
  const days: WeatherDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      dayOfWeek: f.dayOfWeek?.[i] || wkMap[date.getDay()] || '',
      calendarDayTemperatureMax: Number(f.temperatureMax?.[i]) || 0,
      calendarDayTemperatureMin: Number(f.temperatureMin?.[i]) || 0,
      narrative: f.narrative?.[i] || (f.daypart?.[0]?.narrative?.[i * 2] || ''),
    });
  }
  return days;
}
