// 展示映射（从 App.tsx 抽出，零 React 依赖）：天气背景主题 + GPS 精度分级

import { isNightTime } from '../assets/weatherIcons';
import type { WeatherCurrent } from '../types/weather';

export interface WeatherTheme {
  background: string;
  /** light = 亮色字体（暗背景），dark = 深色字体（亮背景） */
  scheme: 'light' | 'dark';
}

export interface AccuracyLevel {
  label: string;
  level: string;
}

/** 根据天气状况 + 白天/夜间切换背景（返回 { background, scheme }） */
export function weatherTheme(current: WeatherCurrent | null): WeatherTheme {
  const isNight = isNightTime();

  // 默认背景（无天气数据时按时间显示）
  if (!current) {
    return isNight
      ? { background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #374151 100%)', scheme: 'light' }
      : { background: 'linear-gradient(180deg, #60a5fa 0%, #93c5fd 50%, #bfdbfe 100%)', scheme: 'dark' };
  }
  const p = (current.phrase || '').toLowerCase();

  if (p.includes('雨') || p.includes('雪') || p.includes('冰') || p.includes('雹')) {
    return isNight
      ? { background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)', scheme: 'light' }
      : { background: 'linear-gradient(180deg, #64748b 0%, #94a3b8 50%, #cbd5e1 100%)', scheme: 'dark' };
  }
  if (p.includes('雷') || p.includes('电')) {
    return isNight
      ? { background: 'linear-gradient(180deg, #020617 0%, #1e1b4b 50%, #312e81 100%)', scheme: 'light' }
      : { background: 'linear-gradient(180deg, #374151 0%, #4b5563 50%, #6b7280 100%)', scheme: 'light' };
  }
  if (p.includes('雾') || p.includes('霾')) {
    return isNight
      ? { background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #475569 100%)', scheme: 'light' }
      : { background: 'linear-gradient(180deg, #9ca3af 0%, #d1d5db 50%, #e5e7eb 100%)', scheme: 'dark' };
  }
  if (p.includes('晴') || p.includes('sun') || p.includes('sunny')) {
    return isNight
      ? { background: 'linear-gradient(180deg, #0c1445 0%, #1e3a5f 50%, #2d5a87 100%)', scheme: 'light' }
      : { background: 'linear-gradient(180deg, #38bdf8 0%, #7dd3fc 50%, #bae6fd 100%)', scheme: 'dark' };
  }
  // 默认
  return isNight
    ? { background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #374151 100%)', scheme: 'light' }
    : { background: 'linear-gradient(180deg, #60a5fa 0%, #93c5fd 50%, #bfdbfe 100%)', scheme: 'dark' };
}

/** GPS 精度分级（米）：无有效值时返回空 label / level */
export function accuracyLevel(acc?: number): AccuracyLevel {
  if (acc === undefined || acc === null || isNaN(acc)) {
    return { label: '', level: '' };
  }
  if (acc <= 5) return { label: '极佳', level: 'excellent' };
  if (acc <= 15) return { label: '良好', level: 'good' };
  if (acc <= 50) return { label: '一般', level: 'fair' };
  if (acc <= 150) return { label: '较差', level: 'poor' };
  return { label: '很差', level: 'very-poor' };
}
