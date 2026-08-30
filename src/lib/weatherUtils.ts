// 纯工具函数（从 App.tsx 抽出，零 React 依赖）

import type { WeatherCurrent, WeatherDay, WeatherYesterday } from '../types/weather';

// ===== 日期 / 坐标键 =====

/** 中文星期标签（和风 / 本应用快照统一用中文展示） */
export const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 本地日期 → YYYYMMDD（无分隔符，与 /v7/historical/weather 的 date 参数一致） */
export function ymd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

/** 粗粒度坐标键（整数度，与 GeoAPI 区级缓存粒度一致） */
export function coordKeyOf(lat: number, lng: number): string {
  return `${Math.round(lat)},${Math.round(lng)}`;
}

/**
 * 由当前实况 + 今日预报构造「今日快照」（形状同 WeatherYesterday）。
 * 和风天气常闭时，次日显示「昨日」直接读该缓存，无需再请求和风。
 * 返回 null 表示当前无实况数据（不可缓存）。
 */
export function buildTodaySnapshot(
  cur: WeatherCurrent | null,
  days: WeatherDay[],
  date: Date,
): WeatherYesterday | null {
  if (!cur) return null;
  const day = days[0] || null;
  return {
    date: ymd(date),
    dayOfWeek: WEEK_CN[date.getDay()] || '',
    tempMax: day?.calendarDayTemperatureMax || 0,
    tempMin: day?.calendarDayTemperatureMin || 0,
    textDay: cur.phrase || '',
    windDir: cur.windDirectionCardinal || '',
    // 快照来自各源的实况风速，单位不统一（km/h 或 m/s），不做风级换算
    windScale: 'N/A',
    windSpeed: 'N/A',
    humidity: cur.relativeHumidity || 0,
  };
}

export function base64urlDecode(s: string): string {
  // base64url → base64：替换 - _ 并补全 =
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

export function windDirToCardinal(dir: string): string {
  const d = dir.trim();
  if (d.length === 0) return '';
  // QWeather 返回中文风向（可能带"风"字），提取方位词
  const m = d.match(/(东北|东南|西南|西北|北|东|南|西)/);
  if (m) return m[1];
  // 数字角度转风向
  const deg = parseInt(d, 10);
  if (isNaN(deg)) return d;
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}

export function windSpeedKmHToLevel(speed: number): string {
  // 风速 km/h → 风级（蒲福风级标准）
  if (speed < 1.6) return '0级';
  if (speed < 3.4) return '1级';
  if (speed < 5.5) return '2级';
  if (speed < 8.0) return '3级';
  if (speed < 10.8) return '4级';
  if (speed < 13.9) return '5级';
  if (speed < 17.2) return '6级';
  if (speed < 20.8) return '7级';
  return '8级以上';
}
