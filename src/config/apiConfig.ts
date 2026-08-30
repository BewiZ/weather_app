// API 数据源配置（从 App.tsx 抽出，零 React 依赖）
//
// 管理所有数据源的启用状态；禁用时不发送请求，显示缓存数据 + 红色覆盖。

import { writeJSON, writeString, readString } from '../utils/cache';

// 气象预警轮询间隔可选项（分钟），默认 12
export const CMA_INTERVAL_OPTIONS = [5, 10, 12, 15, 30];

// 实况天气来源
export const REALTIME_SOURCES: { key: string; label: string }[] = [
  { key: 'weather_com', label: 'weather.com' },
  { key: 'jishu',       label: '极数本源' },
  { key: 'msn',         label: 'MSN 中国版' },
];

export const DEFAULT_API_ENABLED: Record<string, boolean> = {
  weather_com: true,    // weather.com（当前天气 + 7天预报）
  jishu: true,           // 极数本源（24小时 / 15天 / AQI / 预警）
  msn: false,            // MSN 中国版（当前天气 + 10天预报）
  uapi: true,            // UApiPro（24小时 / 15天 / 预警）
  api_hezi: true,        // 接口盒子（预警补充）
  qweather: false,       // 和风天气（昨日历史天气）— 默认常闭，仅首次使用时调用一次
  cma: true,             // 中央气象台 CMA（气象预警 map/alarm）
  tianditu: true,        // 天地图（逆地理编码，最少 5 分钟一次 + 位移 200m）
};

// API 元信息：显示名 + 描述（含刷新规则）
export const API_META: Record<string, { label: string; desc: string; cadence: string }> = {
  weather_com: { label: 'weather.com', desc: '当前天气 + 7天预报', cadence: '🕐 自动5分钟 · 手动间隔3分钟' },
  jishu:       { label: '极数本源',     desc: '24小时预报 / 15天预报 / AQI / 预警', cadence: '🕐 自动2分钟（无降水15分钟） · 日限1500次' },
  msn:         { label: 'MSN 中国版',   desc: '当前天气 + 10天预报（可与 weather.com 共存）', cadence: '🕐 自动5分钟 · 手动间隔3分钟' },
  uapi:        { label: 'UApiPro',      desc: '24小时预报 / 15天预报 / 预警', cadence: '🕐 自动1小时 · 日限35次' },
  api_hezi:    { label: '接口盒子',     desc: '预警补充', cadence: '🕐 自动5分钟 · 手动间隔10秒' },
  qweather:    { label: '和风天气 QWeather', desc: '昨日历史天气（默认常闭，仅首次使用调用一次）', cadence: '🕐 仅首次调用 · 其余读今日缓存' },
  cma:         { label: '中央气象台 CMA', desc: '气象预警（map/alarm，需区县级 adcode）', cadence: '🕐 自动轮询 · 间隔见上' },
  tianditu:    { label: '天地图',       desc: '逆地理编码（地址解析，CMA adcode 的前置依赖）', cadence: '🕐 最少间隔5分钟 · 位移>200m 自动请求' },
};

const API_ENABLED_KEY = 'api_enabled';
// 和风天气「默认常闭」迁移标记：旧版本持久化过 true，需一次性修正
const QW_DEFAULT_OFF_MIGRATED_KEY = 'qw_default_off_migrated';

/**
 * 初始化 API 启用状态。
 * 含一次性迁移：和风天气由「默认开启」改为「默认常闭」（旧版本持久化过 true）。
 * 写入 qw_default_off_migrated 后不再重复触发，用户后续手动开启不会被下次启动覆盖。
 */
export function loadApiEnabled(): Record<string, boolean> {
  let merged = DEFAULT_API_ENABLED;
  try {
    const v = localStorage.getItem(API_ENABLED_KEY);
    if (v) { const p = JSON.parse(v); merged = { ...DEFAULT_API_ENABLED, ...p }; }
  } catch (_) { /* ignore */ }

  if (localStorage.getItem(QW_DEFAULT_OFF_MIGRATED_KEY) === null && merged.qweather !== false) {
    merged = { ...merged, qweather: false };
    writeJSON(API_ENABLED_KEY, merged);
    writeString(QW_DEFAULT_OFF_MIGRATED_KEY, '1');
  }
  return merged;
}

/** 气象预警轮询间隔（分钟）：只读配置，面板仅展示当前值，不再提供点击切换 */
export function loadCmaIntervalMin(): number {
  const n = parseInt(readString('cma_interval_min', ''), 10);
  return CMA_INTERVAL_OPTIONS.includes(n) ? n : 12;
}
