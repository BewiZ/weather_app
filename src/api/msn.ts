// ============================================================
// MSN 天气（中国版）— 实况 + 10 天预报 + 生活指数
// 端点：https://assets.msn.cn/service/weather/overview
// 中国版仅需静态 API key，无 JWT / HMAC 签名。
// （区别于全球版 weather.api.msn.com，后者需要 JWT + 签名。）
// ============================================================

const MSN_API_KEY = 'j5i4gDqHL6nGYwx5wi5kRhXjtf2c5qgFX9fzfk0TOo';
const MSN_APP_ID = '9e21380c-ff19-4c78-b4ea-19558e93a5d3';

const MSN_BASE = 'https://assets.msn.cn/service/weather/overview';

const MSN_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// 请求级活动标识（链路追踪用，每次请求唯一）
// 部分 Android WebView 不提供 crypto.randomUUID()，需兜底
function randomUuid(): string {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) { /* ignore */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function randomActivityId(): string {
  return randomUuid();
}

// 用户匿名标识（scn=APP_ANON 需要的匿名会话 ID）
// 生成一次后存 localStorage，跨会话复用（符合浏览器"匿名用户"语义）
const MSN_USER_KEY = 'msn_anon_user';
function anonUserId(): string {
  try {
    const stored = localStorage.getItem(MSN_USER_KEY);
    if (stored && stored.startsWith('m-')) return stored;
  } catch (_) { /* ignore */ }
  const id = 'm-' + randomUuid().replace(/-/g, '').toUpperCase();
  try { localStorage.setItem(MSN_USER_KEY, id); } catch (_) { /* ignore */ }
  return id;
}

interface MsnCurrent {
  cap?: string;           // 天气描述
  temp?: number;          // 温度 ℃
  feels?: number;         // 体感
  rh?: number;            // 相对湿度 %
  pvdrWindDir?: string;   // 风向文字 "东风"
  windSpd?: number;       // 风速 km/h
  windGust?: number;      // 阵风 km/h
  windDir?: string | number; // 备用风向：数值角度（如 83）
  windSpeed?: number;     // 备用风速
  baro?: number;          // 气压 hPa
  vis?: number;           // 能见度 km
  uv?: number;            // 紫外线
  uvDesc?: string;
  cloudCover?: number;    // 云量 %
  sky?: string;           // 云况：FEW / SCT / BKN / OVC / CLR
  dewPt?: number;         // 露点 ℃
  aqi?: number;           // AQI
  aqiSeverity?: string;   // 空气质量描述
  primaryPollutant?: string;
  created?: string;       // 数据时间 ISO
}

interface MsnDaypart {
  cap?: string;
  tempHi?: number;
  tempLo?: number;
  feelsHi?: number;
  feelsLo?: number;
}

interface MsnDaily {
  day?: MsnDaypart;
  night?: MsnDaypart;
  tempHi?: number;
  tempLo?: number;
  precip?: number;        // 降水概率 %
  windMax?: number;
  windMaxDir?: number;    // 角度
  valid?: string;
  rh?: number;
  rhHi?: number;
  rhLo?: number;
  uv?: number;
  uvDesc?: string;
  aqi?: number;
  rainAmount?: number;
}

interface MsnAlmanac {
  sunrise?: string;
  sunset?: string;
}

interface MsnForecastDay {
  daily?: MsnDaily;
  almanac?: MsnAlmanac;
  hourly?: any[];
}

interface MsnWeatherEntry {
  current?: MsnCurrent;
  forecast?: {
    days?: MsnForecastDay[];
  };
}

export interface MsnData {
  current?: MsnCurrent;
  forecastDays?: MsnForecastDay[];
}

export async function fetchMsn(lat: number, lon: number): Promise<MsnData | null> {
  console.log('[MSN] fetchMsn called lat=' + lat + ' lon=' + lon);
  const params = new URLSearchParams({
    apikey: MSN_API_KEY,
    activityId: randomActivityId(),
    ocid: 'msftweather',
    cm: 'zh-cn',
    it: 'edgeid',
    user: anonUserId(),
    scn: 'APP_ANON',
    units: 'C',
    appId: MSN_APP_ID,
    wrapodata: 'false',
    includemapsmetadata: 'true',
    cuthour: 'true',
    lifeDays: '2',
    lifeModes: '18',
    includestorm: 'true',
    includeLifeActivity: 'true',
    lifeSubTypes: '1%2C3%2C4%2C10%2C26',
    insights: '65536',
    startDate: '-1',
    endDate: '+9',
    discardFutureInsightTimeseries: 'true',
    distanceinkm: '0',
    regionDataCount: '20',
    orderby: 'distance',
    days: '10',
    pageOcid: 'prime-weather%3A%3Aweathertoday-peregrine',
    source: 'weather_csr',
    fdhead:
      'PRG-1SW-WXWPDEL,PRG-1SW-WXWPDS,PRG-1SW-WXWPTLI,prg-1sw-wxncvf,prg-1sw-wxtrlog,prg-1sw-wxrbaw',
    region: 'cn',
    market: 'zh-cn',
    locale: 'zh-cn',
    lat: String(lat),
    lon: String(lon),
  });

  const url = `${MSN_BASE}?${params.toString()}`;

  // 1) 先用浏览器 fetch（桌面 Tauri 无 CORS，走这条路最快）
  let root: any;
  try {
    root = await Promise.race([
      fetch(url, { headers: MSN_HEADERS }).then(async r => {
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`MSN HTTP ${r.status}: ${body.slice(0, 200)}`);
        }
        return r.json();
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('MSN 请求超时 (12s)')), 12000),
      ),
    ]);
    console.log('[MSN] browser fetch OK');
  } catch (e) {
    // 2) 浏览器 fetch 失败（Android WebView CORS 等），回退到 Rust 原生命令
    console.warn('[MSN] browser fetch failed: ' + (e as Error).message + ', falling back to native');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      root = await Promise.race([
        invoke('fetch_msn_weather', { url }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('MSN native 请求超时 (15s)')), 15000),
        ),
      ]);
      console.log('[MSN] native fetch OK');
    } catch (ne) {
      throw new Error('MSN native fetch: ' + (ne as Error).message);
    }
  }

  const wx = root?.responses?.[0]?.weather?.[0] as MsnWeatherEntry | undefined;
  if (!wx) {
    throw new Error('MSN 响应结构异常: 无 weather 数据');
  }

  return {
    current: wx.current,
    forecastDays: wx.forecast?.days || [],
  };
}
