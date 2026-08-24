// ============================================================
// 归一化层：把 极数本源(jishu) / UApiPro 归一为统一结构
//
// - source === 'jishu'：全部用 jishu 字段
// - source === 'uapi'：优先 uapi 字段，uapi 空/null/NaN → 从 jishu 同名槽回填
// - 15 天：按"今天→今天+N"顺序索引对齐
// - 24 小时：按小时数对齐（uapi.time 的 HH vs jishu datetime 的 HH）
// ============================================================

import type { JiShuData, UApiResponse } from '../types/weather';

export type ForecastSource = 'jishu' | 'uapi';

// -------------------- 天气词映射 --------------------

/** 极数本源 skycon 枚举码 → 中文天气词（组件共享） */
export function skyconToPhrase(code: string): string {
  if (!code) return '';
  const m: Record<string, string> = {
    CLEAR_DAY: '晴', CLEAR_NIGHT: '晴', CLEAR: '晴',
    PARTLY_CLOUDY_DAY: '多云', PARTLY_CLOUDY_NIGHT: '多云', PARTLY_CLOUDY: '多云',
    CLOUDY: '阴',
    LIGHT_HAZE: '轻度雾霾', MODERATE_HAZE: '中度雾霾', HEAVY_HAZE: '重度雾霾',
    LIGHT_RAIN: '小雨', MODERATE_RAIN: '中雨', HEAVY_RAIN: '大雨', STORM_RAIN: '暴雨',
    SHOWER: '阵雨', RAIN: '中雨',
    THUNDER_SHOWER: '雷阵雨', THUNDER_SHOWER_WITH_HAIL: '雷阵雨伴冰雹',
    LIGHT_SNOW: '小雪', MODERATE_SNOW: '中雪', HEAVY_SNOW: '大雪', STORM_SNOW: '暴雪', SNOW: '小雪',
    FOG: '雾', HAZE: '霾', DUST: '浮尘', SAND: '沙尘', DUST_STORM: '沙尘暴', SAND_STORM: '沙尘暴',
    WIND: '大风', FROST: '霜冻',
  };
  return m[code] || '';
}

// -------------------- 风向 / 风级 --------------------

/** 角度 → 八方位中文词 */
function windDegToCardinal(deg: number): string {
  if (deg < 0 || deg > 360) return '';
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}

/** 风速 m/s → 风级 */
function windSpeedToLevel(speed: number): string {
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

// -------------------- 日期工具 --------------------

function parseDateStr(s: string): string | null {
  if (!s) return null;
  const p = (s.split('T')[0]).split('-');
  if (p.length !== 3) return null;
  return `${p[0]}-${p[1]}-${p[2]}`;
}

function getWeekdayCn(dateStr: string): string {
  const d = new Date(parseDateStr(dateStr) || dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[d.getDay()];
}

function formatDateShort(dateStr: string): string {
  const p = parseDateStr(dateStr)?.split('-');
  if (!p) return dateStr;
  return `${p[1]}/${p[2]}`;
}

function isToday(dateStr: string): boolean {
  const today = new Date();
  const d = new Date(parseDateStr(dateStr) || dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
}

// -------------------- 安全取值 --------------------

function num(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? fallback : n;
}

function str(v: unknown, fallback: string): string {
  if (!v && v !== 0) return fallback;
  return String(v);
}

// ============================================================
// 15 天逐日卡片
// ============================================================

export interface UnifiedDayCard {
  idx: number;
  date: string;         // YYYY-MM-DD
  dateShort: string;    // MM/DD
  weekday: string;      // 今天 / 周一
  isToday: boolean;
  high: number | null;
  low: number | null;
  feelsHigh?: number;
  feelsLow?: number;
  phraseDay: string;
  phraseNight: string;
  precipDay: number;    // 降水概率 0-100
  precipNight: number;
  windDir: string;
  windLevel: string;
  aqi: number | null;
  humidity?: number;
  visibility?: number;
  uv?: number;
  sunrise?: string;
  sunset?: string;
}

export interface BuildDayCtx {
  source: ForecastSource;
  jishu: JiShuData | null;
  uapi: UApiResponse | null;
  now?: Date;
}

function buildJishuDay(i: number, daily: any): Partial<UnifiedDayCard> {
  const t = daily.temperature?.[i];
  const p = daily.precipitation?.[i];
  const wind = daily.wind?.[i];
  const aqi = (daily.air_quality?.aqi || [])[i];
  const humid = daily.humidity?.[i];
  const vis = daily.visibility?.[i];
  const astro = daily.astro?.[i];

  const skyDay = daily.skycon_08h_20h?.[i]?.value || daily.skycon?.[i]?.value;
  const skyNight = daily.skycon_20h_32h?.[i]?.value || skyDay;
  const prob = num(p?.probability, 0);
  const cloudAvg = num(daily.cloudrate?.[i]?.avg, -1);

  // 天气词：先 skycon，其次概率/云量推断
  const infer = (prob: number): string => {
    if (cloudAvg > 0.9 && prob < 20) return '阴';
    if (prob >= 70) return '大雨';
    if (prob >= 50) return '中雨';
    if (prob >= 20) return '小雨';
    if (cloudAvg > 0.6) return '多云';
    return '晴';
  };

  return {
    high: t?.max != null ? Math.round(t.max) : null,
    low: t?.min != null ? Math.round(t.min) : null,
    feelsHigh: t?.max != null ? Math.round(t.max) : undefined,
    feelsLow: t?.min != null ? Math.round(t.min) : undefined,
    phraseDay: skyDay ? skyconToPhrase(skyDay) : infer(prob),
    phraseNight: skyNight ? skyconToPhrase(skyNight) : (skyDay ? skyconToPhrase(skyDay) : infer(prob)),
    precipDay: num(daily.precipitation_08h_20h?.[i]?.probability, prob),
    precipNight: num(daily.precipitation_20h_32h?.[i]?.probability, prob),
    windDir: windDegToCardinal(num(wind?.avg?.direction, -1)),
    windLevel: windSpeedToLevel(num(wind?.avg?.speed, 0)),
    aqi: aqi?.avg?.chn != null ? Math.round(aqi.avg.chn) : null,
    humidity: num(humid?.avg, -1) >= 0 ? num(humid?.avg, -1) : undefined,
    visibility: num(vis?.avg, -1) >= 0 ? num(vis?.avg, -1) : undefined,
    sunrise: astro?.sunrise?.time,
    sunset: astro?.sunset?.time,
  };
}

function buildUApiDay(i: number, days: any[]): Partial<UnifiedDayCard> {
  const d = days[i];
  if (!d) return {};

  // uapi precip 是字符串，尝试解析（可能是 "5" 或 "5%" 或 "5mm"）
  const precip = str(d.precip, '');
  const precipNum = Number(precip.replace(/[^0-9.]/g, ''));

  return {
    high: d.temp_max != null ? Math.round(d.temp_max) : null,
    low: d.temp_min != null ? Math.round(d.temp_min) : null,
    phraseDay: str(d.weather_day, ''),
    phraseNight: str(d.weather_night, d.weather_day),
    precipDay: isNaN(precipNum) ? undefined : precipNum,
    precipNight: isNaN(precipNum) ? undefined : precipNum,
    windDir: str(d.wind_dir_day, str(d.wind_dir_night, '')),
    windLevel: str(d.wind_scale_day, str(d.wind_scale_night, '')),
    humidity: d.humidity != null ? Number(d.humidity) : undefined,
    visibility: d.visibility != null ? Number(d.visibility) : undefined,
    uv: d.uv_index != null ? Number(d.uv_index) : undefined,
    sunrise: d.sunrise,
    sunset: d.sunset,
  };
}

function mergePartialBase(a: Partial<UnifiedDayCard>, b: Partial<UnifiedDayCard>): Partial<UnifiedDayCard> {
  // a 为主，b 回填 undefined / null 字段
  const out: any = {};
  for (const k of Object.keys(a) as (keyof Partial<UnifiedDayCard>)[]) {
    if (a[k] == null && b[k] != null) out[k] = b[k];
    else out[k] = a[k];
  }
  for (const k of Object.keys(b) as (keyof Partial<UnifiedDayCard>)[]) {
    if (!(k in out)) out[k] = b[k];
  }
  return out;
}

export function buildDayCards(ctx: BuildDayCtx): UnifiedDayCard[] {
  const { source, jishu, uapi } = ctx;

  const jDaily = (jishu?.daily as any) || {};
  const jTemps = jDaily.temperature || [];
  const uDays = uapi?.forecast || [];

  // 对齐数量：以两者中较大者为准（缺失位用有数据的一方）
  const n = Math.max(jTemps.length, uDays.length);
  if (n === 0) return [];

  const cards: UnifiedDayCard[] = [];
  for (let i = 0; i < n; i++) {
    let jishuP: Partial<UnifiedDayCard> = {};
    let uapiP: Partial<UnifiedDayCard> = {};
    if (jTemps[i]) jishuP = buildJishuDay(i, jDaily);
    if (uDays[i]) uapiP = buildUApiDay(i, uDays);

    let merged: Partial<UnifiedDayCard>;
    if (source === 'uapi') {
      merged = mergePartialBase(uapiP, jishuP);
    } else {
      merged = mergePartialBase(jishuP, uapiP);
    }

    const dateStr = str(uDays[i]?.date || jTemps[i]?.date, '');
    const weekCn = str(uDays[i]?.week, '');
    const isTodayFlag = !!weekCn || isToday(dateStr) || (i === 0);

    cards.push({
      idx: i,
      date: dateStr,
      dateShort: formatDateShort(dateStr) || `${i + 1}`,
      weekday: isTodayFlag && weekCn ? weekCn : (i === 0 ? '今天' : getWeekdayCn(dateStr)),
      isToday: i === 0,
      high: merged.high ?? null,
      low: merged.low ?? null,
      feelsHigh: merged.feelsHigh,
      feelsLow: merged.feelsLow,
      phraseDay: str(merged.phraseDay, ''),
      phraseNight: str(merged.phraseNight, merged.phraseDay || ''),
      precipDay: num(merged.precipDay, 0),
      precipNight: num(merged.precipNight, 0),
      windDir: str(merged.windDir, ''),
      windLevel: str(merged.windLevel, ''),
      aqi: merged.aqi ?? null,
      humidity: merged.humidity,
      visibility: merged.visibility,
      uv: merged.uv,
      sunrise: merged.sunrise,
      sunset: merged.sunset,
    });
  }
  return cards;
}

// ============================================================
// 24 小时逐时卡片
// ============================================================

export interface UnifiedHourCell {
  hour: number;     // 0-23
  timeStr: string;  // datetime string（供组件判断"现在"）
  temp: number;
  feels?: number;
  phrase: string;
  pop: number;      // 降水概率 0-100
  windDir: string;
  windLevel: string;
  humidity?: number;
  visibility?: number;
  uv?: number;
}

export interface BuildHourCtx {
  source: ForecastSource;
  jishu: JiShuData | null;
  uapi: UApiResponse | null;
  now?: Date;
}

function parseHourFromDatetime(s: string): number | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2}):/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return h >= 0 && h <= 23 ? h : null;
}

function jishuHourToCell(hourly: any, hh: number): Partial<UnifiedHourCell> {
  const temp = hourly?.temperature;
  const sky = hourly?.skycon;
  const precip = hourly?.precipitation;
  const wind = hourly?.wind;
  const humid = hourly?.humidity;
  const vis = hourly?.visibility;
  const feels = hourly?.apparent_temperature;

  // 按小时匹配：找 datetime HH === hh 的项
  let j = -1;
  for (let k = 0; k < (temp?.length || 0); k++) {
    const h = parseHourFromDatetime(String(temp[k]?.datetime || ''));
    if (h === hh) { j = k; break; }
  }
  if (j < 0) return {};

  const windSpd = num(wind?.[j]?.value, 0);
  const skyCode = sky?.[j]?.value || '';

  return {
    temp: num(temp?.[j]?.value, 0),
    feels: feels?.[j]?.value != null ? num(feels[j].value, 0) : undefined,
    phrase: skyCode ? skyconToPhrase(skyCode) : '',
    pop: num(precip?.[j]?.probability, 0),
    windDir: '',  // jishu 小时级 wind 仅返回速度，无方向
    windLevel: windSpeedToLevel(windSpd),
    humidity: humid?.[j]?.value != null ? num(humid[j].value, -1) : undefined,
    visibility: vis?.[j]?.value != null ? num(vis[j].value, -1) : undefined,
  };
}

function uapiHourToCell(item: any): Partial<UnifiedHourCell> {
  return {
    temp: num(item.temperature, 0),
    feels: item.feels_like != null ? num(item.feels_like, 0) : undefined,
    phrase: str(item.weather, ''),
    pop: num(item.pop, 0),
    windDir: str(item.wind_direction, ''),
    windLevel: str(item.wind_scale, ''),
    humidity: num(item.humidity, -1) >= 0 ? num(item.humidity, -1) : undefined,
    visibility: item.visibility != null ? Number(item.visibility) : undefined,
    uv: item.uv_index != null ? Number(item.uv_index) : undefined,
  };
}

export function buildHourCells(ctx: BuildHourCtx): UnifiedHourCell[] {
  const { source, jishu, uapi, now } = ctx;
  const nowDate = now || new Date();
  const currentHour = nowDate.getHours();

  const jHourly = jishu?.hourly || {};
  const jTemps = (jHourly as any)?.temperature || [];
  const uHourly = uapi?.hourly_forecast || [];

  // 24 小时窗口：从"当前整点"开始（含），连续 24 小时
  // 例：03:20 → 03,04,...,23,00,01,02（首格"03"是现在的数据；末尾 00/01/02 是明天）
  const startHour = currentHour;
  const hours: number[] = [];
  for (let i = 0; i < 24; i++) hours.push((startHour + i) % 24);

  // 建立 jishu 索引映射：hour -> index in jTemps
  const jIdxMap = new Map<number, number>();
  for (let k = 0; k < jTemps.length; k++) {
    const h = parseHourFromDatetime(String(jTemps[k]?.datetime || ''));
    if (h == null) continue;
    jIdxMap.set(h, k);
  }

  // 建立 uapi 索引映射：hour -> item
  const uItemMap = new Map<number, any>();
  for (const item of uHourly) {
    const h = parseHourFromDatetime(String(item.time || ''));
    if (h == null) continue;
    uItemMap.set(h, item);
  }

  // 取两者覆盖的并集小时范围，保证至少能出 24 个
  const sourceHours = new Set<number>();
  for (const [h] of jIdxMap) sourceHours.add(h);
  for (const [h] of uItemMap) sourceHours.add(h);
  if (sourceHours.size === 0) return [];

  const cells: UnifiedHourCell[] = [];
  // 若 sourceHours 非空，以 startHour（下一个整点）为首，循环 24 次
  for (let i = 0; i < 24; i++) {
    const hh = (startHour + i) % 24;
    let merged: Partial<UnifiedHourCell>;

    let jishuP: Partial<UnifiedHourCell> = {};
    let uapiP: Partial<UnifiedHourCell> = {};

    const jIdx = jIdxMap.get(hh);
    if (jIdx !== undefined) jishuP = jishuHourToCell(jHourly, hh);
    const uItem = uItemMap.get(hh);
    if (uItem) uapiP = uapiHourToCell(uItem);

    if (source === 'uapi') {
      merged = mergePartialBase(uapiP, jishuP);
    } else {
      merged = mergePartialBase(jishuP, uapiP);
    }

    cells.push({
      hour: hh,
      timeStr: String(uItem?.time || ''),
      temp: num(merged.temp, 0),
      feels: merged.feels,
      phrase: str(merged.phrase, ''),
      pop: num(merged.pop, 0),
      windDir: str(merged.windDir, ''),
      windLevel: str(merged.windLevel, ''),
      humidity: merged.humidity,
      visibility: merged.visibility,
      uv: merged.uv,
    });
  }

  return cells;
}
