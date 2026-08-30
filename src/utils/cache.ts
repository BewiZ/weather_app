// localStorage 读写封装（从 App.tsx 抽出，零 React 依赖）
//
// 冷启动时从 localStorage 恢复上一次数据，避免白屏；
// 原始 JSON 同时持久化，保证重启后调试面板仍能读取。

import type { WeatherCurrent, WeatherDay, WeatherYesterday } from '../types/weather';
import type { CmaAlarm } from '../api/cmaAlarm';

/** 「和风天气已调用过」标记：首次使用调用一次后写入，之后常闭不再请求 */
export const QW_EVER_CALLED_KEY = 'qw_ever_called';

// ---- 通用读写 ----

/** 读取 JSON 并解析；缺失或损坏时返回 fallback */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v) return JSON.parse(v) as T;
  } catch (_) { /* ignore */ }
  return fallback;
}

/** 写入 JSON（解析或序列化失败时静默忽略） */
export function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
}

/** 读取字符串；缺失时返回 fallback */
export function readString(key: string, fallback: string): string {
  return localStorage.getItem(key) || fallback;
}

/** 写入字符串（存储失败时静默忽略） */
export function writeString(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

// ---- 天气 ----

/** 冷启动恢复上一次实况天气 */
export const cachedWeatherCurrent = (): WeatherCurrent | null =>
  readJSON<WeatherCurrent | null>('cached_weatherCurrent', null);

/** 冷启动恢复上一次 7 天预报 */
export const cachedWeatherDays = (): WeatherDay[] =>
  readJSON<WeatherDay[] | null>('cached_weatherDays', null) || [];

/** 冷启动恢复上一次「昨日」天气 */
export const cachedWeatherYesterday = (): WeatherYesterday | null =>
  readJSON<WeatherYesterday | null>('cached_weatherYesterday', null);

// ---- 原始 JSON（调试面板读取） ----

export const cachedRawNow = (): Record<string, unknown> | null =>
  readJSON('cached_rawNow', null);

export const cachedRawFc = (): Record<string, unknown> | null =>
  readJSON('cached_rawFc', null);

export const cachedRawYest = (): Record<string, unknown> | null =>
  readJSON('cached_rawYest', null);

export const cachedRawYestDate = (): string => readString('cached_rawYestDate', '');

// ---- 气象预警（CMA） ----

/** 冷启动恢复行政区代码 */
export const cachedCmaAdcode = (): string => readString('cached_cmaAdcode', '');

/** 按 adcode 分区缓存，定位切换地区后不会显示旧地区的预警 */
export const cachedCmaAlarms = (): CmaAlarm[] =>
  readJSON<CmaAlarm[]>('cached_cmaAlarms_' + cachedCmaAdcode(), []);

// ---- 原始数据持久化 ----

export const persistRawNow = (d: Record<string, unknown> | null): void => {
  if (d) localStorage.setItem('cached_rawNow', JSON.stringify(d));
};

export const persistRawFc = (d: Record<string, unknown> | null): void => {
  if (d) localStorage.setItem('cached_rawFc', JSON.stringify(d));
};

export const persistRawYest = (d: Record<string, unknown> | null, date?: string): void => {
  if (d) localStorage.setItem('cached_rawYest', JSON.stringify(d));
  if (date) localStorage.setItem('cached_rawYestDate', date);
};
