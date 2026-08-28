// ============================================================
// Per-API rate limiter + clock-aligned scheduler
//
// Tracks last auto/manual fetch times and daily request counts
// per source, persisted to localStorage ("rate_limit_state").
//
// Auto-refresh is CLOCK-ALIGNED (fires at exact clock ticks),
// not elapsed-time intervals:
//   weather_com:        :00 :05 :10 :15 :20 :25 :30 :35 :40 :45 :50 :55 (every 5 min)
//   msn:                :00 :10 :20 :30 :40 :50 (every 10 min)
//   jishu:              :00 :02 :04 ... :58 (every 2 min, 慢速档 15 min 见 jishu_minutely)
//   api_hezi:           :00 :05 :10 :15 :20 :25 :30 :35 :40 :45 :50 :55 (every 5 min)
//   uapi:               00:00 01:00 02:00 ... (every 1 hour)
//   qweather:           00:00 12:00 (every 12 hours)
//
// Manual refresh has sliding-window quotas and min-interval rules.
// ============================================================

const STORAGE_KEY = 'rate_limit_state';

interface RateLimitConfig {
  autoIntervalMs: number;
  manualMaxInWindow: number;
  manualWindowMs: number;
  manualMinIntervalMs: number;
  dailyMax: number;
}

const INFINITY = Number.MAX_SAFE_INTEGER;

const CONFIG: Record<string, RateLimitConfig> = {
  weather_com: {
    autoIntervalMs: 5 * 60 * 1000,
    manualMaxInWindow: 2,
    manualWindowMs: 5 * 60 * 1000,
    manualMinIntervalMs: 3 * 60 * 1000,
    dailyMax: INFINITY,
  },
  msn: {
    autoIntervalMs: 10 * 60 * 1000,
    manualMaxInWindow: 1,
    manualWindowMs: 10 * 60 * 1000,
    manualMinIntervalMs: 3 * 60 * 1000,
    dailyMax: INFINITY,
  },
  jishu: {
    autoIntervalMs: 2 * 60 * 1000,
    manualMaxInWindow: 1,
    manualWindowMs: 2 * 60 * 1000,
    manualMinIntervalMs: 2 * 60 * 1000,
    dailyMax: 1500,
  },
  api_hezi: {
    autoIntervalMs: 5 * 60 * 1000,
    manualMaxInWindow: 1,
    manualWindowMs: INFINITY,
    manualMinIntervalMs: 10 * 1000,
    dailyMax: INFINITY,
  },
  // jishu 慢速档：当每分钟降水数据全为 0 时启用（15 分钟一次，:00 :15 :30 :45）
  jishu_minutely: {
    autoIntervalMs: 15 * 60 * 1000,
    manualMaxInWindow: 1,
    manualWindowMs: 15 * 60 * 1000,
    manualMinIntervalMs: 15 * 60 * 1000,
    dailyMax: INFINITY,
  },
  uapi: {
    autoIntervalMs: 60 * 60 * 1000,
    manualMaxInWindow: 1,
    manualWindowMs: 60 * 60 * 1000,
    manualMinIntervalMs: 60 * 60 * 1000,
    dailyMax: 35,
  },
  qweather: {
    autoIntervalMs: 12 * 60 * 60 * 1000,
    manualMaxInWindow: 10,
    manualWindowMs: 12 * 60 * 60 * 1000,
    manualMinIntervalMs: 60 * 60 * 1000,
    dailyMax: 20,
  },
};

interface SourceState {
  lastAuto: number;
  lastManual: number;
  manualTimestamps: number[];
  dailyCount: number;
  dayStr: string;
}

interface RateLimitState {
  [source: string]: SourceState;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

export interface RateLimitInfo {
  dailyCount: number;
  dailyMax: number;
  lastAuto: number;
  lastManual: number;
}

// ---- pure helpers ----

import type { JiShuData } from '../types/weather';

function nowMs(): number {
  return Date.now();
}

function getDayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 判断 jishu 每分钟降水数据是否全为 0（干）。
 * 若全干，jishu 自动刷新降为 15 分钟一次（:00 :15 :30 :45）。
 * 只要任一字段有非零值，即视为有降水，维持 2 分钟自动刷新。
 *
 * 返回 true = 全干（可用 jishu_minutely 慢速档）
 * 返回 false = 有降水或数据缺失（维持 jishu 正常档）
 */
export function isDryMinutelyPrecip(jiShu: JiShuData | null): boolean {
  const m = jiShu?.minutely;
  if (!m) return true; // 无分钟数据，视为干（不频繁拉取）

  const checkArr = (arr?: number[]) => {
    if (!arr || arr.length === 0) return true;
    return arr.every(v => v === 0);
  };

  return checkArr(m.precipitation_2h) && checkArr(m.precipitation);
}

function emptySourceState(): SourceState {
  return {
    lastAuto: 0,
    lastManual: 0,
    manualTimestamps: [],
    dailyCount: 0,
    dayStr: getDayStr(),
  };
}

function loadState(): RateLimitState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RateLimitState;
      for (const key of Object.keys(CONFIG)) {
        if (!parsed[key]) parsed[key] = emptySourceState();
      }
      return parsed;
    }
  } catch (_) { /* ignore */ }
  const state: RateLimitState = {};
  for (const key of Object.keys(CONFIG)) {
    state[key] = emptySourceState();
  }
  return state;
}

function saveState(state: RateLimitState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* storage full */ }
}

function ensureSource(state: RateLimitState, source: string): SourceState {
  if (!state[source]) state[source] = emptySourceState();
  return state[source];
}

// ============================================================
// Clock-aligned scheduling
// ============================================================

/**
 * Compute milliseconds until the next clock-aligned tick for the given source.
 * Ticks are anchored to :00 (top of minute/hour):
 *   - 10 min  → :00 :10 :20 :30 :40 :50
 *   -  2 min  → :00 :02 :04 ... :58
 *   -  1 min  → every :00
 *   -  1 hr   → 00:00 01:00 02:00 ...
 *   - 12 hr   → 00:00 12:00
 *
 * Returns ms >= 0. If the next tick is in the past (very unlikely),
 * rounds to 0 so the caller fires immediately.
 */
export function msUntilNextTick(source: string): number {
  const cfg = CONFIG[source];
  if (!cfg) return 0;

  const period = cfg.autoIntervalMs;
  if (period <= 0) return 0;

  // Anchor: midnight of today in local time (ms since epoch)
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const elapsed = now.getTime() - midnight;

  // Find next multiple of period after elapsed
  let next = Math.ceil((elapsed + 1) / period) * period;
  if (next <= elapsed) next += period;

  let delay = next - now.getTime();
  if (delay < 0) delay = 0;
  return delay;
}

/**
 * Schedule a callback on the clock-aligned tick schedule.
 * Fires at the next clock tick, then recursively reschedules for
 * the tick after that (with a few seconds of drift tolerance baked
 * into msUntilNextTick via the `+1` guard).
 *
 * Returns a cleanup function that stops the scheduler.
 */
export function scheduleClockAligned(
  _source: string,
  callback: (source: string) => void,
): (() => void) {
  function tick() {
    callback(_source);
    const d = msUntilNextTick(_source);
    timer = setTimeout(tick, d);
  }
  let timer = setTimeout(tick, msUntilNextTick(_source));
  return () => clearTimeout(timer);
}

// ============================================================
// Rate limit checks
// ============================================================

export function checkLimit(source: string, mode: 'auto' | 'manual'): RateLimitResult {
  const cfg = CONFIG[source];
  if (!cfg) return { allowed: true };

  const state = loadState();
  const today = getDayStr();
  const s = ensureSource(state, source);

  if (s.dayStr !== today) {
    s.dailyCount = 0;
    s.dayStr = today;
  }

  const now = nowMs();

  if (cfg.dailyMax < INFINITY && s.dailyCount >= cfg.dailyMax) {
    saveState(state);
    return {
      allowed: false,
      reason: `今日已达上限 ${s.dailyCount}/${cfg.dailyMax}`,
    };
  }

  if (mode === 'auto') {
    const elapsed = now - s.lastAuto;
    if (elapsed < cfg.autoIntervalMs) {
      const remaining = Math.ceil((cfg.autoIntervalMs - elapsed) / 1000);
      saveState(state);
      return {
        allowed: false,
        reason: `自动刷新间隔未到期（还需${remaining}s）`,
      };
    }
    return { allowed: true };
  }

  // Manual
  const sinceManual = now - s.lastManual;
  if (sinceManual < cfg.manualMinIntervalMs) {
    const remaining = Math.ceil((cfg.manualMinIntervalMs - sinceManual) / 1000);
    saveState(state);
    return {
      allowed: false,
      reason: `手动刷新间隔未到期（还需${remaining}s）`,
    };
  }

  const windowStart = now - cfg.manualWindowMs;
  const inWindow = cfg.manualWindowMs < INFINITY
    ? s.manualTimestamps.filter(t => t > windowStart)
    : [];
  if (inWindow.length >= cfg.manualMaxInWindow) {
    const oldest = inWindow[0];
    const remaining = Math.ceil((oldest + cfg.manualWindowMs - now) / 1000);
    saveState(state);
    return {
      allowed: false,
      reason: `${Math.floor(cfg.manualWindowMs / 60000)}分钟内已用满${cfg.manualMaxInWindow}次（还需${remaining}s）`,
    };
  }

  return { allowed: true };
}

export function recordFetch(source: string, mode: 'auto' | 'manual'): void {
  const cfg = CONFIG[source];
  if (!cfg) return;

  const state = loadState();
  const s = ensureSource(state, source);
  const today = getDayStr();
  if (s.dayStr !== today) {
    s.dailyCount = 0;
    s.dayStr = today;
  }

  if (mode === 'auto') {
    s.lastAuto = nowMs();
  } else {
    s.lastManual = nowMs();
    s.manualTimestamps.push(nowMs());
    const windowStart = nowMs() - Math.max(cfg.manualWindowMs, cfg.autoIntervalMs);
    s.manualTimestamps = s.manualTimestamps.filter(t => t > windowStart);
    if (s.manualTimestamps.length > 50) {
      s.manualTimestamps = s.manualTimestamps.slice(-50);
    }
  }

  s.dailyCount += 1;
  saveState(state);
}

/**
 * Per-source 10-second throttle on [RateLimit] log output.
 * Prevents log spam when checkLimit is called at high frequency (e.g. render-loop).
 * Returns true if the message should be emitted; false if throttled.
 */
const _logLastTime: Record<string, number> = {};
const _LOG_THROTTLE_MS = 10 * 1000;

export function canLogRateLimit(source: string): boolean {
  const now = Date.now();
  const last = _logLastTime[source] || 0;
  if (now - last >= _LOG_THROTTLE_MS) {
    _logLastTime[source] = now;
    return true;
  }
  return false;
}

export function getRateLimitInfo(source: string): RateLimitInfo {
  const cfg = CONFIG[source];
  if (!cfg) return { dailyCount: 0, dailyMax: INFINITY, lastAuto: 0, lastManual: 0 };

  const state = loadState();
  const s = ensureSource(state, source);
  const today = getDayStr();
  if (s.dayStr !== today) {
    s.dailyCount = 0;
    s.dayStr = today;
  }

  return {
    dailyCount: s.dailyCount,
    dailyMax: cfg.dailyMax,
    lastAuto: s.lastAuto,
    lastManual: s.lastManual,
  };
}

export function getDailyRemaining(source: string): number {
  const cfg = CONFIG[source];
  if (!cfg) return INFINITY;
  const info = getRateLimitInfo(source);
  return Math.max(0, info.dailyMax - info.dailyCount);
}

export { CONFIG };
