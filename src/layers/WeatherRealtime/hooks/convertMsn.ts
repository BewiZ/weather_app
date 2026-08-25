/**
 * MSN 天气（中国版 assets.msn.cn）→ WeatherCurrent / WeatherDay 映射
 *
 * 当 weather.com 不可用 / 被禁用时，从 MSN 中国版 API 提取实况天气
 * 和今天的最高 / 最低温度，填入 WeatherRealtime 卡片所需的数据结构。
 *
 * 纯函数，无状态、无副作用。
 *
 * MSN 中国版单位：
 * - 温度 ℃（已正确）
 * - 风速 km/h（已正确）
 * - 能见度 km（已正确，与 WeatherMetrics 期望一致）
 * - 气压 hPa（已正确）
 * - 风向：文本 "东风" / "东北风"（需转方位词 + 角度）
 */

import { windDirToCardinal } from '../../../lib/weatherUtils';
import type { WeatherCurrent, WeatherDay } from '../../../types/weather';
import type { MsnData } from '../../../api/msn';

interface MsnFallbackResult {
  current: WeatherCurrent;
  todayDay: WeatherDay | null;
}

// 文本风向 → 角度（八方位，每 45° 一档）
const WIND_DIR_DEGREES: Record<string, number> = {
  北: 0,
  东北: 45,
  东: 90,
  东南: 135,
  南: 180,
  西南: 225,
  西: 270,
  西北: 315,
};

/**
 * 从 MSN 风向文本（如 "东风" / "东北风"）提取角度。
 * 先取前 2 字符（"东北" / "东风" 去掉末尾"风"字），匹配八方位表。
 */
function msnWindTextToDegrees(dir: string | undefined): number {
  if (!dir) return 0;
  const d = dir.trim().replace(/(风|向)$/, ''); // "东风"→"东"，"东北风"→"东北"
  if (WIND_DIR_DEGREES[d] !== undefined) return WIND_DIR_DEGREES[d];
  return 0;
}

export function buildWeatherCurrentFromMsn(
  msn: MsnData,
  wkMap: string[],
): MsnFallbackResult | null {
  const cur = msn.current;
  if (!cur) return null;

  // 温度：优先 current.temp
  const temperature = typeof cur.temp === 'number' ? cur.temp : 0;

  // 体感：feels
  const heatIndex = typeof cur.feels === 'number' ? cur.feels : temperature;

  // 湿度
  const humidity = typeof cur.rh === 'number' ? cur.rh : 0;

  // 风向：优先 windDir（数值角度，如 83°），备用 pvdrWindDir 文本（"东风"）
  let windDegrees = 0;
  let windCardinal: string;
  const windDir = cur.windDir;
  if (typeof windDir === 'number') {
    windDegrees = windDir;
    windCardinal = windDirToCardinal(String(windDir));
  } else {
    // 文本兜底：pvdrWindDir / windDir 文本
    const windDirText = cur.pvdrWindDir || (typeof windDir === 'string' ? windDir : '') || '';
    windCardinal = windDirToCardinal(windDirText);
    windDegrees = msnWindTextToDegrees(windDirText);
  }

  // 云量：cloudCover（%）
  const cloudCover = typeof cur.cloudCover === 'number' ? cur.cloudCover : undefined;

  // 云况：sky（FEW / SCT / BKN / OVC / CLR）— 中国版接口通常不带，尝试提取
  const sky = typeof cur.sky === 'string' ? cur.sky : undefined;

  // 风速：km/h
  const windSpeed =
    typeof cur.windSpd === 'number'
      ? cur.windSpd
      : typeof cur.windSpeed === 'number'
      ? cur.windSpeed
      : 0;

  // 气压：hPa
  const pressure = typeof cur.baro === 'number' ? cur.baro : 0;

  // 能见度：km
  const visibility = typeof cur.vis === 'number' ? cur.vis : 0;

  // 紫外线
  const uvIndex = typeof cur.uv === 'number' ? cur.uv : 0;

  // 天气描述
  const phrase = cur.cap || (cur.aqiSeverity ? `${cur.aqiSeverity}，${cur.uvDesc || ''}` : '未知');

  // 观测时间
  const obsTime = cur.created || '';

  const current: WeatherCurrent = {
    temperature,
    phrase,
    temperatureHeatIndex: heatIndex,
    relativeHumidity: humidity,
    windSpeed,
    windDirectionCardinal: windCardinal,
    windDirectionDegrees: windDegrees,
    uvIndex,
    pressure,
    pressTendencyCode: 0,
    visibility,
    sunrise: '',
    sunset: '',
    obsQualifierPhrase: cur.aqiSeverity ? `AQI ${cur.aqi || '--'}` : '',
    obsTimeLocal: obsTime,
    observationTime: obsTime,
    cloudCover,
    sky,
  };

  // 今天最高 / 最低（从 forecastDays[0] 取）
  let todayDay: WeatherDay | null = null;
  const days = msn.forecastDays || [];
  if (days.length > 0) {
    const fd = days[0] as any;
    const daily = fd.daily || {};
    const almanac = fd.almanac || {};

    const tMax = typeof daily.tempHi === 'number' ? daily.tempHi : 0;
    const tMin = typeof daily.tempLo === 'number' ? daily.tempLo : 0;

    // 昼夜天气描述拼接
    const dayCap = daily.day?.cap || '';
    const nightCap = daily.night?.cap || '';
    const narrative = dayCap && nightCap
      ? `${dayCap}转${nightCap}`
      : dayCap || nightCap || phrase;

    const valid = daily.valid || '';
    const dateStr = valid ? valid.slice(0, 10) : new Date().toISOString().slice(0, 10);

    todayDay = {
      date: dateStr,
      dayOfWeek: wkMap[new Date(dateStr).getDay()] || '',
      calendarDayTemperatureMax: tMax,
      calendarDayTemperatureMin: tMin,
      narrative,
    };

    // 若 current 中无日出日落，尝试从 forecast 的 almanac 补上
    if (!current.sunrise && almanac.sunrise) {
      current.sunrise = almanac.sunrise;
    }
    if (!current.sunset && almanac.sunset) {
      current.sunset = almanac.sunset;
    }
  }

  return { current, todayDay };
}
