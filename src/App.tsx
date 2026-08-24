import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getWeatherIconUrl, isNightTime } from './assets/weatherIcons';
import { getWeatherIconUrlSimple } from './assets/weatherIconsSimple';
import type { Forecast24Style } from './layers/WeatherDetail/hooks/Forecast24Hour';
import { usePullRefresh, LoaderDOM, refreshCompleteAnimation } from './layers/TopMenuBar/hooks/usePullRefresh';
import { TopMenuBar } from './layers/TopMenuBar/TopMenuBar';
import { WeatherRealtime } from './layers/WeatherRealtime/WeatherRealtime';
import { WeatherDetail } from './layers/WeatherDetail/WeatherDetail';
import { fetchJiShu } from './api/jiShu';
import { fetchUApiPro } from './api/uApiPro';
import { fetchApiHezi } from './api/apiHezi';
import { type ForecastSource } from './api/unifiedWeather';
import type { JiShuData, UApiResponse, ApiHeziResponse, UnifiedAlert } from './types/weather';
import './App.css';

interface Position {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface AddressInfo {
  province: string;
  city: string;
  district: string;
  full: string;
  poi: string;
  poiDetail: string;
}

type LocationMode = 'gps' | 'auto';
type GeocodeEngine = 'tianditu' | 'nominatim';

const TIANDITU_KEY = (import.meta as any).env?.VITE_TIANDITU_KEY || '';

export interface WeatherCurrent {
  temperature: number;
  phrase: string;
  temperatureHeatIndex: number;
  relativeHumidity: number;
  windSpeed: number;
  windDirectionCardinal: string;
  windDirectionDegrees: number;
  uvIndex: number;
  pressure: number;
  pressTendencyCode: number;
  visibility: number;
  sunrise: string;
  sunset: string;
  obsQualifierPhrase: string;
  obsTimeLocal?: string;
  observationTime?: string;
}

interface WeatherDay {
  date: string;
  dayOfWeek: string;
  calendarDayTemperatureMax: number;
  calendarDayTemperatureMin: number;
  narrative: string;
}

export interface WeatherYesterday {
  date: string;
  dayOfWeek: string;
  tempMax: number;
  tempMin: number;
  textDay: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: number;
}

function base64urlDecode(s: string): string {
  // base64url → base64：替换 - _ 并补全 =
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}
function windDirToCardinal(dir: string): string {
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

function windSpeedKmHToLevel(speed: number): string {
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

// 1 个箭头环绕成一圈：弧线 + 箭头头在弧线末端
// 根据进度动态生成 SVG 弧线路径

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  // 样式二级菜单：true 时下拉显示"结构 / 24小时预报样式"子项
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<Record<string, unknown> | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 复制 JSON 到剪贴板
  const copyToClipboard = useCallback((key: string, value: unknown) => {
    navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }).catch(() => {
      // 降级方案
      const el = document.createElement('textarea');
      el.value = JSON.stringify(value, null, 2);
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }, []);

  // 生成三套新数据源的摘要
  const getNewSourcesSummary = useCallback((): Record<string, unknown> | null => {
    if (!rawJiShu.current && !rawUApi.current && !rawApiHezi.current) return null;

    const sum: Record<string, unknown> = {};

    // 极数本源摘要
    const js = rawJiShu.current;
    if (js) {
      const summary: Record<string, unknown> = {};
      summary['字段列表'] = Object.keys(js).join(', ');
      if (js.summary) {
        summary['summary.temperature'] = js.summary.temperature;
        summary['summary.skycon'] = js.summary.skycon;
        summary['summary.aqi'] = js.summary.air_quality?.aqi;
      }
      if (js.alerts) summary['alerts 数量'] = js.alerts.length;
      if (js.realtime) {
        summary['realtime.temperature'] = js.realtime.temperature;
        summary['realtime.skycon'] = js.realtime.skycon;
      }
      if (js.daily) {
        summary['daily 字段'] = Object.keys(js.daily).join(', ');
        const tempArr = (js.daily as any).temperature;
        if (Array.isArray(tempArr)) summary['daily.temperature'] = `数组(${tempArr.length}) [0]={date:${tempArr[0]?.date}, max:${tempArr[0]?.max}, min:${tempArr[0]?.min}}`;
        const precArr = (js.daily as any).precipitation;
        if (Array.isArray(precArr)) summary['daily.precipitation'] = `数组(${precArr.length}) [0]={prob:${precArr[0]?.probability}}`;
        const astroArr = (js.daily as any).astro;
        if (Array.isArray(astroArr)) summary['daily.astro'] = `数组(${astroArr.length}) [0]={sunrise:${astroArr[0]?.sunrise?.time}}`;
        const skyDay = (js.daily as any).skycon_08h_20h;
        const skyNight = (js.daily as any).skycon_20h_32h;
        summary['daily.skycon_08h_20h'] = Array.isArray(skyDay) ? `数组(${skyDay.length}) [0]=${skyDay[0]?.value}` : '不存在';
        summary['daily.skycon_20h_32h'] = Array.isArray(skyNight) ? `数组(${skyNight.length}) [0]=${skyNight[0]?.value}` : '不存在';
      } else {
        summary['daily'] = '不存在';
      }
      sum['极数本源 jiShu'] = summary;
    }

    // UApiPro 摘要
    const ua = rawUApi.current;
    if (ua) {
      const summary: Record<string, unknown> = {};
      summary['字段列表'] = Object.keys(ua).join(', ');
      summary['city'] = (ua as any).city;
      summary['weather'] = (ua as any).weather;
      summary['temperature'] = (ua as any).temperature;
      if ((ua as any).forecast) summary['forecast 数量'] = (ua as any).forecast.length;
      if ((ua as any).life_indices) summary['life_indices'] = Object.keys((ua as any).life_indices).join(', ');
      sum['UApiPro'] = summary;
    }

    // 接口盒子摘要
    const ah = rawApiHezi.current;
    if (ah) {
      const summary: Record<string, unknown> = {};
      summary['字段列表'] = Object.keys(ah).join(', ');
      summary['name'] = (ah as any).name;
      summary['weather1'] = (ah as any).weather1;
      summary['wd1'] = (ah as any).wd1;
      if ((ah as any).alarm) summary['alarm 数量'] = (ah as any).alarm.length;
      if ((ah as any).suntimes) summary['suntimes 数量'] = (ah as any).suntimes.length;
      sum['接口盒子 apiHezi'] = summary;
    }

    return sum;
  }, []);
  const [debugLoading, setDebugLoading] = useState(false);
  const [showPullDebug, setShowPullDebug] = useState(false);

  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string>('');
  const [locMode, setLocMode] = useState<LocationMode>('gps');
  const [address, setAddress] = useState<AddressInfo | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [geocodeEngine, setGeocodeEngine] = useState<GeocodeEngine>('tianditu');
  const lastAddrRef = useRef({ lat: 0, lng: 0 });
  const debounceRef = useRef(0);

  const switchMode = useCallback((mode: LocationMode) => {
    setLocMode(mode);
    if ((window as any).NativeGps) {
      (window as any).NativeGps.stop();
      (window as any).NativeGps.setMode(mode);
      (window as any).NativeGps.start();
    }
  }, []);

  useEffect(() => {
    (window as any).__nativeGpsMode = (mode: LocationMode) => {
      setLocMode(mode);
    };
  }, []);

  const reverseGeocode = useCallback(async (lat: number, lng: number, force = false, engine: GeocodeEngine | null = null) => {
    const targetEngine = engine !== null ? engine : geocodeEngine;
    const now = Date.now();
    if (!force && now - debounceRef.current < 3000) return;
    if (!force) debounceRef.current = now;
    if (!force && Math.abs(lat - lastAddrRef.current.lat) < 0.001 && Math.abs(lng - lastAddrRef.current.lng) < 0.001) {
      return;
    }
    lastAddrRef.current.lat = lat;
    lastAddrRef.current.lng = lng;

    setAddressLoading(true);
    try {
      if (targetEngine === 'tianditu') {
        const postStr = `{'lon':${lng.toFixed(6)},'lat':${lat.toFixed(6)},'ver':1}`;
        const url = `https://api.tianditu.gov.cn/geocoder?postStr=${encodeURIComponent(postStr)}&type=geocode&tk=${TIANDITU_KEY}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== '0') throw new Error(data.msg || `status=${data.status}`);
        const result = data.result;
        if (!result) throw new Error('No results');
        const addr = result.addressComponent || {};
        // 缓存天地图 city + county + town 用于天气页显示
        geocodeCache.current = {
          city: addr.city || '',
          county: addr.county || '',
          town: addr.town || '',
          lat,
          lng,
        };
        setAddress({
          province: addr.province || '',
          city: addr.city || '',
          district: addr.county || '',
          full: result.formatted_address ||
            [addr.province, addr.city, addr.county, addr.town].filter(Boolean).join(''),
          poi: addr.poi || '',
          poiDetail: addr.poi ? `${addr.poi}${addr.poi_position ? addr.poi_position + '方向' : ''}${addr.poi_distance ? '约' + addr.poi_distance + 'm' : ''}` : '',
        });
        setAddressError('');
        return;
      }

      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&format=json&zoom=18&addressdetails=1&accept-language=zh-CN`;
      const res = await fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0 (tauri-react-gps)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const addr = data.address || {};
      setAddress({
        province: addr.province || addr.state || addr.region || '',
        city: addr.city || addr.town || addr.municipality || addr.county || '',
        district: addr.district || addr.suburb || addr.quarter || addr.neighbourhood || '',
        full: data.display_name || '',
        poi: '',
        poiDetail: '',
      });
      setAddressError('');
    } catch (e) {
      console.warn('[Geocode] failed:', e);
      setAddressError(
        targetEngine === 'tianditu'
          ? '天地图查询失败'
          : '地理编码服务暂不可用'
      );
    } finally {
      setAddressLoading(false);
    }
  }, [geocodeEngine]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('当前环境不支持地理定位');
      return;
    }

    if ((window as any).NativeGps) {
      (window as any).NativeGps.setMode(locMode);
      (window as any).NativeGps.start();
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPosition({ lat, lng, accuracy: pos.coords.accuracy });
        setError('');
        reverseGeocode(lat, lng);
      },
      (err) => {
        if (locMode !== 'gps') {
          setError(`定位失败：${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if ((window as any).NativeGps) {
        (window as any).NativeGps.stop();
      }
    };
  }, []);

  const handleReset = useCallback(() => {
    setPosition(null);
    setAddress(null);
    setAddressError('');
    lastAddrRef.current = { lat: 0, lng: 0 };
    debounceRef.current = 0;
    setError('');
  }, []);

  const [weatherCurrent, setWeatherCurrent] = useState<WeatherCurrent | null>(null);
  const [weatherDays, setWeatherDays] = useState<WeatherDay[]>([]);
  const [weatherYesterday, setWeatherYesterday] = useState<WeatherYesterday | null>(null);
  const [weatherError, setWeatherError] = useState('');
  const weatherLoadingRef = useRef(false);
  // 原始 JSON 缓存：fetchWeather 写入，fetchDebugData 读取（避免重复请求）
  const rawWeatherNow = useRef<Record<string, unknown> | null>(null);
  const rawWeatherFc = useRef<Record<string, unknown> | null>(null);
  const rawYesterday = useRef<Record<string, unknown> | null>(null);
  const rawYesterdayDate = useRef<string>('');
  const lastRefresh = useRef(0);

  // 三套新接口的数据状态（极数本源 / UApiPro / 接口盒子 / 统一预警）
  const [jishuData, setJishuData] = useState<JiShuData | null>(null);
  const [uapiData, setUapiData] = useState<UApiResponse | null>(null);
  const [apiHeziData, setApiHeziData] = useState<ApiHeziResponse | null>(null);
  const [unifiedAlerts, setUnifiedAlerts] = useState<UnifiedAlert[]>([]);

  // 原始数据缓存（调试面板读取用，避免重复请求）
  const rawJiShu = useRef<JiShuData | null>(null);
  const rawUApi = useRef<UApiResponse | null>(null);
  const rawApiHezi = useRef<ApiHeziResponse | null>(null);
  const rawUnifiedAlerts = useRef<UnifiedAlert[]>([]);

  // 防重复拉取时间戳（同一接口 30s 内不重复）
  const lastJiShuFetch = useRef(0);
  const lastUApiFetch = useRef(0);
  const lastApiHeziFetch = useRef(0);

  // 各 API 最近请求完成时间（调试显示用）
  const [apiRequestTimes, setApiRequestTimes] = useState<Record<string, string>>({});

  // 预报来源切换（极数本源 / UApiPro）— 24 小时预报模型
  const [source24, setSource24] = useState<ForecastSource>(() => {
    const v = localStorage.getItem('forecast_source_24');
    return (v === 'uapi' || v === 'jishu') ? v : 'jishu';
  });

  const setSource24Cache = useCallback((s: ForecastSource) => {
    setSource24(s);
    try { localStorage.setItem('forecast_source_24', s); } catch (_) { /* ignore */ }
  }, []);

  // 15 天预报来源切换
  const [source15, setSource15] = useState<ForecastSource>(() => {
    const v = localStorage.getItem('forecast_source_15');
    return (v === 'uapi' || v === 'jishu') ? v : 'jishu';
  });
  const setSource15Cache = useCallback((s: ForecastSource) => {
    setSource15(s);
    try { localStorage.setItem('forecast_source_15', s); } catch (_) { /* ignore */ }
  }, []);

  // ===== API 启用/禁用管理 =====
  // 管理所有数据源的启用状态；禁用时不发送请求，显示缓存数据 + 红色覆盖
  const DEFAULT_API_ENABLED: Record<string, boolean> = {
    weather_com: true,    // weather.com（当前天气 + 7天预报）
    jishu: true,           // 极数本源（24小时 / 15天 / AQI / 预警）
    uapi: true,            // UApiPro（24小时 / 15天 / 预警）
    api_hezi: true,        // 接口盒子（预警补充）
    qweather: true,        // QWeather（昨日历史天气）
  };
  const [apiEnabled, setApiEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const v = localStorage.getItem('api_enabled');
      if (v) { const p = JSON.parse(v); return { ...DEFAULT_API_ENABLED, ...p }; }
    } catch (_) { /* ignore */ }
    return DEFAULT_API_ENABLED;
  });
  const setApiEnabledCache = useCallback((key: string, val: boolean) => {
    setApiEnabled(prev => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem('api_enabled', JSON.stringify(next)); } catch (_) { /* ignore */ }
      return next;
    });
  }, []);

  // API 元信息：显示名 + 描述
  const API_META: Record<string, { label: string; desc: string }> = {
    weather_com: { label: 'weather.com', desc: '当前天气 + 7天预报' },
    jishu:       { label: '极数本源',     desc: '24小时预报 / 15天预报 / AQI / 预警' },
    uapi:        { label: 'UApiPro',      desc: '24小时预报 / 15天预报 / 预警' },
    api_hezi:    { label: '接口盒子',     desc: '预警补充' },
    qweather:    { label: 'QWeather',     desc: '昨日历史天气' },
  };

  // API 管理面板
  const [apiPanelOpen, setApiPanelOpen] = useState(false);

  // ===== 24 小时预报样式切换（复杂 / 简约） =====
  const [forecast24Style, setForecast24Style] = useState<Forecast24Style>(() => {
    const v = localStorage.getItem('forecast24_style');
    return (v === 'simple' || v === 'complex') ? v : 'complex';
  });
  const setForecast24StyleCache = useCallback((s: Forecast24Style) => {
    setForecast24Style(s);
    try { localStorage.setItem('forecast24_style', s); } catch (_) { /* ignore */ }
  }, []);

  // 详情卡片布局：紧致（24h 在视口底部）vs 松散（自然间距）
  const [layoutCompact, setLayoutCompact] = useState<boolean>(() => {
    const v = localStorage.getItem('layout_compact');
    return v !== 'false'; // 默认紧致
  });
  const setLayoutCompactCache = useCallback((val: boolean) => {
    setLayoutCompact(val);
    try { localStorage.setItem('layout_compact', String(val)); } catch (_) { /* ignore */ }
  }, []);

  // layoutCompact 镜像 ref：recompute effect 的依赖不含 layoutCompact，
  // 用 ref 让 getMaxScroll 始终读到当前布局，避免闭包过期导致松散模式下量错
  const layoutCompactRef = useRef(layoutCompact);
  useEffect(() => {
    layoutCompactRef.current = layoutCompact;
    // 布局切换会改变 scrollHeight，需立即重算并归位（夹紧当前滚动量、重放 transform）
    pageMaxScroll.current = getMaxScroll();
    applyScroll(pageScrollY.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutCompact]);

  // 数据持久化：jishuData / uapiData / position / address 落地 localStorage
  // 以便下次启动时直接显示上次数据（冷启动不白屏）
  useEffect(() => {
    try {
      if (jishuData) localStorage.setItem('cached_jishu', JSON.stringify(jishuData));
      else localStorage.removeItem('cached_jishu');
    } catch (_) { /* ignore */ }
  }, [jishuData]);

  useEffect(() => {
    try {
      if (uapiData) localStorage.setItem('cached_uapi', JSON.stringify(uapiData));
      else localStorage.removeItem('cached_uapi');
    } catch (_) { /* ignore */ }
  }, [uapiData]);

  useEffect(() => {
    try {
      if (position) localStorage.setItem('cached_position', JSON.stringify(position));
      else localStorage.removeItem('cached_position');
    } catch (_) { /* ignore */ }
  }, [position]);

  useEffect(() => {
    try {
      if (address) localStorage.setItem('cached_address', JSON.stringify(address));
      else localStorage.removeItem('cached_address');
    } catch (_) { /* ignore */ }
  }, [address]);

  // 冷启动：从 localStorage 恢复上次退出的数据，避免进入软件时白屏
  // （定时器启动后会在 30s 冷却期内不重复请求，自然过渡到实时数据）
  useEffect(() => {
    try {
      const cj = localStorage.getItem('cached_jishu');
      if (cj) { const d = JSON.parse(cj); setJishuData(d); rawJiShu.current = d; }
      const cu = localStorage.getItem('cached_uapi');
      if (cu) { const d = JSON.parse(cu); setUapiData(d); rawUApi.current = d; }
      const cp = localStorage.getItem('cached_position');
      if (cp) {
        const pos = JSON.parse(cp);
        setPosition(pos);
      }
      const ca = localStorage.getItem('cached_address');
      if (ca) {
        const addr = JSON.parse(ca);
        setAddress(addr);
      }
    } catch (_) { /* ignore */ }
  }, []);

// --- Weather.com API (当前天气 + 7天预报) ---
const WC_API_KEY = '6532d6454b8aa370768e63d6ba5a832e';
const WC_BASE = 'https://api.weather.com/v3/wx';

async function fetchWeatherCom(endpoint: string, lat: number, lng: number): Promise<Record<string, unknown>> {
  const url = `${WC_BASE}/${endpoint}?geocode=${lat},${lng}&format=json&units=m&language=zh-CN&apiKey=${WC_API_KEY}`;
  const resp = await Promise.race([
    fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(async r => {
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`weather.com HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      return r.json();
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('weather.com fetch 超时 (10s)')), 10000)),
  ]);
  return resp as Record<string, unknown>;
}

// --- QWeather JS fetch (仅历史天气) ---
const QW_BASE = 'https://mc57rkjak5.re.qweatherapi.com/v7';
const QW_GEO_BASE = 'https://mc57rkjak5.re.qweatherapi.com/geo';

// 缓存 LocationID（localStorage，按整数经纬度粗粒度区分区级）
let locationIdCacheData: { key: string; id: string; lat: number; lng: number } | null = null;

async function getLocationId(lat: number, lng: number, jwt?: string): Promise<string> {
  // 粗粒度坐标（整数度，约区级），区级不变则不重新请求
  const key = `${Math.round(lat)},${Math.round(lng)}`;

  // 内存缓存
  if (locationIdCacheData && locationIdCacheData.key === key) return locationIdCacheData.id;

  // 持久缓存（localStorage）
  try {
    const cached = localStorage.getItem(`geo_${key}`);
    if (cached) {
      locationIdCacheData = { key, id: cached, lat, lng };
      return cached;
    }
  } catch (_) { /* ignore */ }

  const token = jwt ?? ((await tauriInvoke('generate_jwt')) as string);
  const url = `${QW_GEO_BASE}/v2/city/lookup?location=${lng.toFixed(2)},${lat.toFixed(2)}`;

  const resp = await Promise.race([
    fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Authorization': `Bearer ${token}` },
    }).then(async r => {
      if (!r.ok) { const body = await r.text(); throw new Error(`GeoAPI HTTP ${r.status}: ${body.slice(0, 200)}`); }
      return r.json();
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('GeoAPI 超时 (10s)')), 10000)),
  ]);

  const data = resp as Record<string, unknown>;
  if (data.code !== '200') throw new Error(`GeoAPI: ${data.code} ${data.msg}`);
  if (!data.location || !(data.location as any[]).length) throw new Error('GeoAPI: 未找到位置信息');
  const id = (data.location as any[])[0].id as string;
  locationIdCacheData = { key, id, lat, lng };
  try { localStorage.setItem(`geo_${key}`, id); } catch (_) { /* ignore */ }
  return id;
}

async function fetchQw(path: string, location: string, extra: string, jwt?: string): Promise<Record<string, unknown>> {
  const token = jwt ?? ((await tauriInvoke('generate_jwt')) as string);

  const params = new URLSearchParams();
  if (extra) {
    for (const pair of extra.split('&')) {
      const idx = pair.indexOf('=');
      if (idx > 0) params.append(pair.slice(0, idx), pair.slice(idx + 1));
      else params.append(pair, '');
    }
  }
  const url = `${QW_BASE}/${path}?location=${encodeURIComponent(location)}&${params.toString()}`;

  const resp = await Promise.race([
    fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Authorization': `Bearer ${token}`,
      },
    }).then(async r => {
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      return r.json();
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('fetch 超时 (10s)')), 10000)),
  ]);

  const data = resp as Record<string, unknown>;
  if (data.code !== '200') throw new Error(`QWeather ${path}: ${data.code} ${data.msg}`);
  return data;
}

  // 天地图地理编码结果缓存（city + county + town）
  const geocodeCache = useRef<{ city: string; county: string; town: string; lat: number; lng: number } | null>(null);

  const fetchWeather = useCallback(async (lat: number, lng: number) => {
    if (weatherLoadingRef.current) return;
    weatherLoadingRef.current = true;
    setWeatherError('');
    // 不清空缓存 refs — 让调试面板在主界面刷新期间仍能读到旧数据
    setWeatherCurrent(null);
    setWeatherDays([]);
    setWeatherYesterday(null);

    try {
      const wkMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

      if (apiEnabled.weather_com) {
        // 当前天气 — weather.com
        const obs = await fetchWeatherCom('observations/current', lat, lng);
        rawWeatherNow.current = obs;
        setApiRequestTimes(prev => ({ ...prev, weather_com: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
        const sunriseStr = (obs as any).sunriseTimeLocal || '';
        const sunsetStr = (obs as any).sunsetTimeLocal || '';
        setWeatherCurrent({
          temperature: Number((obs as any).temperature) || 0,
          phrase: (obs as any).wxPhraseLong || (obs as any).wxPhraseMedium || (obs as any).cloudCoverPhrase || '未知',
          temperatureHeatIndex: Number((obs as any).temperatureFeelsLike) || 0,
          relativeHumidity: Number((obs as any).relativeHumidity) || 0,
          windSpeed: Number((obs as any).windSpeed) || 0,
          windDirectionCardinal: (obs as any).windDirectionCardinal || '',
          windDirectionDegrees: Number((obs as any).windDirection) || 0,
          uvIndex: (obs as any).uvIndex !== undefined ? Number((obs as any).uvIndex) : 0,
          pressure: Number((obs as any).pressureMeanSeaLevel) || 0,
          pressTendencyCode: Number((obs as any).pressTendencyCode) || 0,
          visibility: Number((obs as any).visibility) || 0,
          sunrise: sunriseStr,
          sunset: sunsetStr,
          obsQualifierPhrase: '',
          obsTimeLocal: (obs as any).observationTime || '',
          observationTime: (obs as any).observationTime || '',
        });

        // 7天预报 — weather.com
        const fc = await fetchWeatherCom('forecast/daily/10day', lat, lng);
        rawWeatherFc.current = fc;
        setApiRequestTimes(prev => ({ ...prev, weather_com: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
        const days: WeatherDay[] = [];
        const f = fc as any;
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
        setWeatherDays(days);
      } else {
        // weather.com 已禁用：保留缓存数据，跳过请求
      }

      // 昨日天气（本地缓存，每天只请求一次）
      const now = new Date();
      const todayY = now.getFullYear();
      const todayM = now.getMonth();
      const todayD = now.getDate();
      const yesterday = new Date(todayY, todayM, todayD - 1);
      const ydStr = yesterday.getFullYear().toString() +
        String(yesterday.getMonth() + 1).padStart(2, '0') +
        String(yesterday.getDate()).padStart(2, '0');
      // 粗粒度坐标（整数度，与 GeoAPI 区级缓存一致）
      const coordKey = `${Math.round(lat)},${Math.round(lng)}`;
      const cacheKey = `yw_${ydStr}_${coordKey}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setWeatherYesterday(JSON.parse(cached));
        // 调试面板需展示 /historical/weather 原始返回 JSON：从原始缓存读取（无则留空，由调试面板实时拉取）
        const rawCached = localStorage.getItem(`ywraw_${ydStr}_${coordKey}`);
        if (rawCached) {
          try {
            rawYesterday.current = { 查询日期: ydStr, ...JSON.parse(rawCached) };
            rawYesterdayDate.current = ydStr;
          } catch (_) { /* ignore */ }
        }
      } else if (!apiEnabled.qweather) {
        // QWeather 已禁用：跳过请求，保留缓存数据
      } else {
        // QWeather 时间机器（历史天气） — 当天首次请求
        try {
          const locationId = await getLocationId(lat, lng);
          const histData = await fetchQw('historical/weather', locationId, `date=${ydStr}`);
          rawYesterday.current = { 查询日期: ydStr, ...histData };
          rawYesterdayDate.current = ydStr;
          try { localStorage.setItem(`ywraw_${ydStr}_${coordKey}`, JSON.stringify(histData)); } catch (_) { /* ignore */ }
          const wd = (histData as any).weatherDaily as Record<string, string> | undefined;
          if (wd) {
            const hourly = (histData as any).weatherHourly as any[] | undefined;
            let textDay = '';
            let windDir = '';
            if (hourly && hourly.length > 0) {
              const dayHour = hourly.find((h: any) => {
                const t = (h.time || '').slice(11, 16);
                return t >= '08:00' && t <= '18:00' && h.text;
              });
              textDay = dayHour?.text || hourly[0]?.text || '';
              windDir = dayHour?.windDir || hourly[0]?.windDir || '';
            }
            // 计算全天平均风速（km/h），再转换为风级
            let avgWindSpeed = 0;
            if (hourly && hourly.length > 0) {
              const speeds = hourly.map((h: any) => Number(h.windSpeed) || 0).filter((v) => v > 0);
              avgWindSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
            }
            const yw: WeatherYesterday = {
              date: wd.date ? wd.date.replace(/-/g, '') : ydStr,
              dayOfWeek: wkMap[new Date((wd.date || ydStr) + 'T12:00:00').getDay()] || '',
              tempMax: Number(wd.tempMax) || 0,
              tempMin: Number(wd.tempMin) || 0,
              textDay,
              windDir: windDirToCardinal(windDir),
              windScale: avgWindSpeed > 0 ? windSpeedKmHToLevel(avgWindSpeed) : 'N/A',
              windSpeed: avgWindSpeed > 0 ? Math.round(avgWindSpeed).toString() + ' km/h' : 'N/A',
              humidity: Number(wd.humidity) || 0,
            };
            setWeatherYesterday(yw);
            try { localStorage.setItem(cacheKey, JSON.stringify(yw)); } catch (_) { /* ignore */ }
          }
        } catch (e) {
          console.warn('[Weather] QWeather history failed (non-fatal):', e);
          rawYesterday.current = { 查询日期: ydStr, 错误: (e as Error).message };
        }
      }

      // 调试数据缓存（不再写入 debugData，避免覆盖诊断面板）
      // 天气数据已写入 weatherCurrent/weatherDays/weatherYesterday
    } catch (e) {
      console.warn('[Weather] failed:', e);
      setWeatherError('天气数据获取失败，请检查网络');
    } finally {
      weatherLoadingRef.current = false;
      lastRefresh.current = Date.now();
    }
  }, []);

  // 拉取三套新数据源（极数本源 + UApiPro + 接口盒子）
  const fetchNewSources = useCallback(async (
    lat: number,
    lng: number,
    city: string,       // UApiPro 用
    sheng: string,      // 接口盒子用
    place: string,      // 接口盒子用
    forceAll = false    // 强制拉取所有接口（绕过 30s 时间戳守卫）
  ) => {
    const now = Date.now();
    const cooldown = 30 * 1000; // 30 秒防重复

    // 三个数据源独立并行拉取（互不等待、互不阻断）
    await Promise.allSettled([
      // 极数本源
      (async () => {
        if (!apiEnabled.jishu) return;
        if (!forceAll && now - lastJiShuFetch.current < cooldown) return;
        lastJiShuFetch.current = now;
        try {
          const data = await fetchJiShu(lat, lng);
          if (data) { setJishuData(data); rawJiShu.current = data; setApiRequestTimes(prev => ({ ...prev, jishu: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[jiShu]', (e as Error).message); }
      })(),
      // UApiPro（仅当 city 有效时）
      (async () => {
        if (!city || !apiEnabled.uapi) return;
        if (!forceAll && now - lastUApiFetch.current < cooldown) return;
        lastUApiFetch.current = now;
        try {
          const data = await fetchUApiPro(city);
          if (data) { setUapiData(data); rawUApi.current = data; setApiRequestTimes(prev => ({ ...prev, uapi: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[uApiPro]', (e as Error).message); }
      })(),
      // 接口盒子（仅当 sheng/place 有效时）
      (async () => {
        if (!sheng || !place || !apiEnabled.api_hezi) return;
        if (!forceAll && now - lastApiHeziFetch.current < cooldown) return;
        lastApiHeziFetch.current = now;
        try {
          const data = await fetchApiHezi(sheng, place);
          if (data) { setApiHeziData(data); rawApiHezi.current = data; setApiRequestTimes(prev => ({ ...prev, api_hezi: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[apiHezi]', (e as Error).message); }
      })(),
    ]);
  }, [apiEnabled]);

  // 合并预警：极数本源为主，接口盒子为备，UApiPro 补充
  useEffect(() => {
    const alerts: UnifiedAlert[] = [];

    // 1. 极数本源（最权威）
    if (jishuData?.alerts) {
      for (const a of jishuData.alerts) {
        alerts.push({
          source: 'jishu',
          id: a.alert_id || '',
          title: a.title || '',
          description: a.description || '',
          color: a.color || '',
          level: a.level || '',
          status: a.status || '',
          province: a.province || '',
          city: a.city || '',
          county: a.county || '',
          pub_time: a.pub_time || '',
        });
      }
    }

    // 2. 接口盒子（去重）
    if (apiHeziData?.alarm) {
      for (const a of apiHeziData.alarm) {
        if (alerts.find(x => x.title === a.title)) continue;
        alerts.push({
          source: 'apihezi',
          id: a.id || '',
          title: a.title || '',
          description: '',
          color: '',
          level: a.signallevel || a.severity || '',
          status: a.type || '',
          province: '',
          city: '',
          county: '',
          pub_time: a.effective || '',
        });
      }
    }

    // 3. UApiPro（去重补充）
    if (uapiData?.alerts) {
      for (const a of uapiData.alerts) {
        if (alerts.find(x => x.title === a.title)) continue;
        alerts.push({
          source: 'uapi',
          id: '',
          title: a.title || '',
          description: a.text || '',
          color: '',
          level: a.level || '',
          status: a.type || '',
          province: '',
          city: '',
          county: '',
          pub_time: a.publish_time || '',
        });
      }
    }

    setUnifiedAlerts(alerts);
    rawUnifiedAlerts.current = alerts;
  }, [jishuData, uapiData, apiHeziData]);

  // 预警变更时 console 输出（调试用，Phase 5 UI 渲染时启用）
  useEffect(() => {
    if (unifiedAlerts.length > 0) {
      console.debug('[UnifiedAlerts] 当前有效预警数:', unifiedAlerts.length, unifiedAlerts);
    }
  }, [unifiedAlerts]);

  // 下拉刷新 — 自定义滚动：内容1:1跟随手指，顶部圆圈线性淡入
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pageScrollY = useRef(0);
  const pageMaxScroll = useRef(0);
  const weatherPageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardRealtimeRef = useRef<HTMLDivElement>(null);
  const cardForecastRef = useRef<HTMLDivElement>(null);
  const card15dayRef = useRef<HTMLDivElement>(null);
  const scrollPlaceholderRef = useRef<HTMLDivElement>(null);
  const contentOffset = useRef(0);
  // 新加载器 refs（loaderDOM 由 usePullRefresh hook 直接操作）
  const pullLoaderRef = useRef<HTMLDivElement>(null);
  const arrowRingRef = useRef<SVGGElement>(null);
  const arcTrailRef = useRef<SVGPathElement>(null);
  const arrowHeadRef = useRef<SVGPolygonElement>(null);
  const circleFullRef = useRef<SVGCircleElement>(null);
  const debugPullRef = useRef<HTMLDivElement>(null);
  // 调试面板拖动（从右侧划出）

  // 同步单个 ref → hook 的 loaderDOM 聚合对象
  useEffect(() => {
    loaderDOM.current = {
      loader: pullLoaderRef.current,
      ring: arrowRingRef.current,
      arcTrail: arcTrailRef.current,
      arrowHead: arrowHeadRef.current,
      circleFull: circleFullRef.current,
      debugEl: debugPullRef.current,
    };
  }, []);

  // 松散模式差速视差常量
  // LOOSE_GAP = .card-realtime 在 loose 下的 margin-bottom (24px)
  // LAG_MAX + BOOST_MAX = LOOSE_GAP → gap 完全闭合
  const LOOSE_GAP = 24;
  const LAG_MAX = LOOSE_GAP / 3;  // 8px — realtime 最大滞后量
  const BOOST_MAX = LOOSE_GAP - LAG_MAX; // 16px — forecast 最大提前量
  const STAGE_END = 24;    // 差速阶段结束 sy，gap 闭合后 lag/boost 固定
  const LOOSE_STAGE = STAGE_END;
  const BLUR_MAX = 4;      // 实况天气最大模糊半径

  function getMaxScroll() {
    const c = contentRef.current;
    const p = weatherPageRef.current;
    if (c && p) {
      const natural = Math.max(0, c.scrollHeight - p.clientHeight);
      // 松散：至少保证 LOOSE_STAGE 的滚动量完成差速，其他情况自然溢出
      return layoutCompactRef.current ? natural : Math.max(natural, LOOSE_STAGE);
    }
    return 0;
  }

  /**
   * 应用滚动状态（零 React 重渲染，直接操作 DOM transform，120Hz 触摸友好）。
   * - 紧致：realtime 滞后（lag） + forecast 提前（boost）→ 间距被压缩至 0，
   *   同时 realtime 逐渐模糊（0 → BLUR_MAX px）。
   * - 松散：整体 1:1 平移，卡片无独立差速，无模糊。
   *   差速结束后 lag/boost 固定，content 继续 1:1 平移露出占位符区域。
   */
  function applyScrollState() {
    const sy = pageScrollY.current;

    // 内容始终 1:1 跟随手指
    if (contentRef.current) {
      contentRef.current.style.transform = sy > 0 ? `translateY(${-sy}px)` : 'translateY(0)';
    }

    if (sy <= 0) {
      cardRealtimeRef.current?.style.removeProperty('transform');
      cardRealtimeRef.current?.style.removeProperty('filter');
      cardForecastRef.current?.style.setProperty('transform', 'translateY(0px)');
      return;
    }

    if (layoutCompactRef.current) {
      // 紧致差速：realtime 滞后 + forecast 提前 → gap 闭合
      const u = Math.min(sy / STAGE_END, 1);
      const lag = LAG_MAX * u;      // realtime 滞后量
      const boost = BOOST_MAX * u;   // forecast 提前量
      const blur = BLUR_MAX * u;     // 模糊半径
      cardRealtimeRef.current?.style.setProperty('transform', `translateY(${lag}px)`);
      cardForecastRef.current?.style.setProperty('transform', `translateY(${-boost}px)`);
      cardRealtimeRef.current?.style.setProperty('filter', `blur(${blur}px)`);
      cardRealtimeRef.current?.style.setProperty('will-change', 'filter, transform');
    } else {
      // 松散：无差速
      cardRealtimeRef.current?.style.removeProperty('transform');
      cardRealtimeRef.current?.style.removeProperty('filter');
      cardForecastRef.current?.style.setProperty('transform', 'translateY(0px)');
    }
  }

  function applyScroll(sy: number) {
    pageScrollY.current = Math.max(0, Math.min(sy, pageMaxScroll.current));
    applyScrollState();
  }

  function resetPullTransforms() {
    // 全部归位：content 归零，卡片差速/模糊归零
    if (contentRef.current) contentRef.current.style.transform = 'translateY(0)';
    cardForecastRef.current?.style.setProperty('transform', 'translateY(0px)');
    cardRealtimeRef.current?.style.removeProperty('transform');
    cardRealtimeRef.current?.style.removeProperty('filter');
  }

  // 下拉刷新加载器 DOM（由 usePullRefresh hook 操作，App.tsx 不再重复实现动画逻辑）
  const loaderDOM = useRef<LoaderDOM>({
    loader: null,
    ring: null,
    arcTrail: null,
    arrowHead: null,
    circleFull: null,
    debugEl: null,
  });

  const refreshAll = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    lastRefresh.current = Date.now();
    let pos = position;
    try {
      if (navigator.geolocation) {
        const newPos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 })
        );
        pos = { lat: newPos.coords.latitude, lng: newPos.coords.longitude, accuracy: newPos.coords.accuracy };
        setPosition(pos);
        setError("");
        reverseGeocode(pos.lat, pos.lng, true);
      }
    } catch (err) {
      console.warn("[PullRefresh] position failed:", err);
    }
    if (pos) {
      await fetchWeather(pos.lat, pos.lng);
    }
    setIsRefreshing(false);
    lastRefresh.current = Date.now();

    // 刷新完成：加载器从 progress=1.0 平滑 ease-out 回到 0，完成后重置卡片 transform
    refreshCompleteAnimation(loaderDOM.current ?? ({} as LoaderDOM), showPullDebug, 350, resetPullTransforms);
  }, [position, fetchWeather, reverseGeocode, showPullDebug]);

  const pullHook = usePullRefresh({
    domRef: loaderDOM,
    contentOffsetRef: contentOffset,
    showPullDebug,
    isRefreshing,
    pageScrollYRef: pageScrollY,
    pageMaxScrollRef: pageMaxScroll,
    applyScroll,
    onRefreshTriggered: refreshAll,
    onRefreshComplete: resetPullTransforms,
  });

  // 下拉进度浮动元素拖动
  // 下拉进度浮动元素拖动：由 usePullRefresh hook 提供
  const { onPullDebugStart, onPullDebugMove, onPullDebugEnd } = pullHook;
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = pullHook;

  // 最大可滚动量：ResizeObserver 监听 .scroll-content 尺寸变化，
  // 任意数据源（weather.com / 极数本源 24h+15天 …）异步渲染后均自动重算。
  // 依赖 [jishuData, weatherYesterday]：预报数据异步到位、内容撑高时强制再算一次，
  // 与 ResizeObserver 双保险，避免首次 mount（空依赖、预报未加载）时 maxScroll 停死在 0
  useEffect(() => {
    const recompute = () => { pageMaxScroll.current = getMaxScroll(); };
    recompute();
    const c = contentRef.current;
    let ro: ResizeObserver | null = null;
    if (c) { ro = new ResizeObserver(recompute); ro.observe(c); }
    window.addEventListener('resize', recompute);
    return () => { ro?.disconnect(); window.removeEventListener('resize', recompute); };
  }, [jishuData, weatherYesterday]);

  // 测量 15 天预报高度，按 2 倍设置占位符高度
  useEffect(() => {
    const card = card15dayRef.current;
    const placeholder = scrollPlaceholderRef.current;
    if (!card || !placeholder) return;
    const update = () => {
      const h = card.offsetHeight;
      if (h > 0) { placeholder.style.height = `${h * 2}px`; }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(card);
    return () => ro.disconnect();
  }, [jishuData, weatherYesterday]);

  // 调试：获取原始 API 数据
  const fetchDebugData = useCallback(async () => {
    setGearMenuOpen(false);
    setDebugOpen(true);
    setDebugData(null);
    setDebugLoading(true);

    try {
      if (!position) {
        setDebugData({ 错误: '当前无定位数据，无法获取 API 数据' });
        setDebugLoading(false);
        return;
      }

    const lat = position.lat;
    const lng = position.lng;

    const today = new Date();
    const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();
    const yesterday = new Date(todayY, todayM, todayD - 1);
    const ydStr = yesterday.getFullYear().toString() +
      String(yesterday.getMonth() + 1).padStart(2, '0') +
      String(yesterday.getDate()).padStart(2, '0');
    const coordKey = `${Math.round(lat)},${Math.round(lng)}`;
    const nowUnix = Math.floor(Date.now() / 1000);
    const nowShanghai = new Date(Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const tauriWin = (window as any).__TAURI__;
    const tauriInt = (window as any).__TAURI_INTERNALS__;

    const flat: Record<string, unknown> = {};
    flat['调试版本'] = 'v2.1 — 缓存优先';
    flat['请求坐标'] = `lat=${lat.toFixed(6)}, lng=${lng.toFixed(6)}`;
    flat['__TAURI__ 存在'] = !!tauriWin;
    flat['__TAURI__.invoke 存在'] = typeof (tauriWin?.invoke);
    flat['__TAURI_INTERNALS__ 存在'] = !!tauriInt;
    flat['__TAURI_INTERNALS__.invoke 类型'] = typeof (tauriInt?.invoke);
    flat['__TAURI_INTERNALS__ 属性'] = Object.keys(tauriInt || {}).join(', ');
    flat['window tauri 键'] = Object.keys(window).filter(k => k.toLowerCase().includes('tauri')).join(', ');

    // 检查缓存命中情况
    const nowCached = !!rawWeatherNow.current;
    const fcCached = !!rawWeatherFc.current;
    const yestCached = !!(rawYesterday.current && rawYesterdayDate.current === ydStr);

    flat['缓存状态'] = `当前=${nowCached?'✓':'✗'} 7天=${fcCached?'✓':'✗'} 昨日=${yestCached?'✓':'✗'}`;

    // 如果有未命中缓存，才做网络请求
    const needLive = !nowCached || !fcCached || !yestCached;

    if (needLive) {
      // 并行：weather.com + yesterday 实时请求 + generate_jwt（tairiInvoke）
      const batch = await Promise.allSettled([
        // 1. ping_test（快速检查 invoke 链路）
        (async () => {
          try {
            const r = await Promise.race([tauriInvoke('ping_test'),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000))]);
            return typeof r === 'string' ? r : JSON.stringify(r);
          } catch (e) { return `[ping_test 超时] ${e}`; }
        })(),

        // 2. weather.com 当前天气
        (async () => {
          if (nowCached) return { cached: true, data: rawWeatherNow.current };
          try {
            const r = await fetchWeatherCom('observations/current', lat, lng);
            rawWeatherNow.current = r;
            return { cached: false, data: r };
          } catch (e) { return { cached: false, error: (e as Error).message, data: {} }; }
        })(),

        // 3. weather.com 7天预报
        (async () => {
          if (fcCached) return { cached: true, data: rawWeatherFc.current };
          try {
            const r = await fetchWeatherCom('forecast/daily/10day', lat, lng);
            rawWeatherFc.current = r;
            return { cached: false, data: r };
          } catch (e) { return { cached: false, error: (e as Error).message, data: {} }; }
        })(),

        // 4. 昨日天气
        (async () => {
          if (yestCached) return { cached: true, data: rawYesterday.current };
          try {
            const jwt = (await Promise.race([
              tauriInvoke('generate_jwt'),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000)),
            ])) as string;
            const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
            const locationId = cachedGeo || await getLocationId(lat, lng, jwt);
            const hist = await fetchQw('historical/weather', locationId, `date=${ydStr}`, jwt);
            rawYesterday.current = { 查询日期: ydStr, ...hist };
            rawYesterdayDate.current = ydStr;
            try { localStorage.setItem(`ywraw_${ydStr}_${coordKey}`, JSON.stringify(hist)); } catch (_) { /* ignore */ }
            return { cached: false, data: { 查询日期: ydStr, ...hist } };
          } catch (e) {
            rawYesterday.current = { 查询日期: ydStr, 错误: (e as Error).message };
            rawYesterdayDate.current = ydStr;
            return { cached: false, data: { 查询日期: ydStr, 错误: (e as Error).message }, error: (e as Error).message };
          }
        })(),

        // 5. generate_jwt（为 QWeather 测试用）
        (async () => {
          try {
            const r = (await Promise.race([
              tauriInvoke('generate_jwt'),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000)),
            ])) as string;
            return typeof r === 'string' ? r : String(r);
          } catch (e) { return ''; }
        })(),
      ]);

      flat['ping_test'] = (batch[0] as PromiseFulfilledResult<any>).value;

      const nowData = (batch[1] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};
      const fcData = (batch[2] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};
      const yestData = (batch[3] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};

      flat['当前天气 (weather.com)'] = nowData;
      flat['7天预报 (weather.com)'] = fcData;
      flat['昨日天气 /history/daily'] = Object.assign({}, yestData, { 查询日期: ydStr });

      const nowRes = batch[1] as PromiseFulfilledResult<any> | undefined;
      flat['weather.com 当前天气'] = nowRes?.value?.cached ? '从主界面缓存读取' : nowRes?.value?.error || '实时请求完成';
      const fcRes = batch[2] as PromiseFulfilledResult<any> | undefined;
      flat['weather.com 7天预报'] = fcRes?.value?.cached ? '从主界面缓存读取' : fcRes?.value?.error || '实时请求完成';
      const yestRes = batch[3] as PromiseFulfilledResult<any> | undefined;
      flat['昨日天气'] = yestRes?.value?.cached ? '从主界面缓存读取' : yestRes?.value?.error || '实时请求完成';

      // JWT 解码
      const debugJwt = (batch[4] as PromiseFulfilledResult<string> | undefined)?.value || '';
      if (debugJwt) {
        const parts = debugJwt.split('.');
        flat['JWT 完整 (3段)'] = parts.length === 3 ? '段数正确' : `段数=${parts.length}`;
        flat['JWT 总长度'] = debugJwt.length;
        if (parts.length >= 1) {
          try { flat['JWT Header (解码)'] = JSON.stringify(JSON.parse(base64urlDecode(parts[0]))); }
          catch (e) { flat['JWT Header 解码失败'] = (e as Error).message; }
        }
        if (parts.length >= 2) {
          try {
            const payload = JSON.parse(base64urlDecode(parts[1]));
            flat['JWT Payload (解码)'] = JSON.stringify(payload);
            flat['iat (UNIX)'] = payload.iat;
            flat['iat (时间)'] = new Date(payload.iat * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            flat['exp (UNIX)'] = payload.exp;
            flat['exp (时间)'] = new Date(payload.exp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            flat['sub'] = payload.sub;
            flat['当前时间 (UNIX)'] = nowUnix;
            flat['当前时间 (上海)'] = nowShanghai;
            flat['已过期?'] = payload.exp < nowUnix ? '是⚠️' : `否, 剩余 ${payload.exp - nowUnix}s`;
          } catch (e) { flat['JWT Payload 解码失败'] = (e as Error).message; }
        }
        if (parts.length >= 3) flat['JWT 签名长度'] = parts[2].length;
        flat['JWT 含 = 号?'] = debugJwt.includes('=') ? '是⚠️' : '否✓';
        flat['JWT 含 + 或 /?'] = (debugJwt.includes('+') || debugJwt.includes('/')) ? '是⚠️' : '否✓';
        flat['══════════ 复制 JWT 到 https://jwt.io/ 验证 ══════════'] = debugJwt;

        // QWeather 鉴权测试（快速 3s 超时）
        try {
          const testUrl = 'https://mc57rkjak5.re.qweatherapi.com/v7/weather/now?location=116.4074,39.9042';
          const r = await Promise.race([
            fetch(testUrl, { headers: { 'Authorization': `Bearer ${debugJwt}` } })
              .then(async res => { const body = await res.text(); return { status: res.status, body: body.slice(0, 200) }; }),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000)),
          ]);
          flat['QWeather 鉴权'] = r.status === 200 ? '✅ 成功' : `❌ HTTP ${r.status}`;
          flat['QWeather 测试详情'] = JSON.stringify(r);
        } catch (e) { flat['QWeather 鉴权'] = `❌ ${(e as Error).message}`; }

        // GeoAPI 显示（缓存优先）
        const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
        if (cachedGeo) {
          flat['GeoAPI LocationID'] = cachedGeo;
          flat['GeoAPI 说明'] = '来自缓存';
        } else {
          try {
            const id = await getLocationId(lat, lng, debugJwt);
            flat['GeoAPI LocationID'] = id;
          } catch (e) { flat['GeoAPI 错误'] = (e as Error).message; }
        }
      }
    } else {
      // 全部缓存命中 — 无需任何网络请求，直接渲染
      flat['当前天气 (weather.com)'] = rawWeatherNow.current;
      flat['7天预报 (weather.com)'] = rawWeatherFc.current;
      flat['昨日天气 /history/daily'] = Object.assign({}, rawYesterday.current, { 查询日期: ydStr });
      flat['weather.com 当前天气'] = '从主界面缓存读取';
      flat['weather.com 7天预报'] = '从主界面缓存读取';
      flat['昨日天气'] = '从主界面缓存读取';

      const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
      if (cachedGeo) flat['GeoAPI LocationID'] = cachedGeo;
    }

    // 三套新数据源原始返回（写入调试面板）
    flat['极数本源 jiShu'] = rawJiShu.current || '尚未拉取';
    flat['UApiPro'] = rawUApi.current || '尚未拉取';
    flat['接口盒子 apiHezi'] = rawApiHezi.current || '尚未拉取';

    setDebugData(flat);
    } catch (e) {
      setDebugData({ 错误: (e as Error).message, stack: (e as Error).stack });
    } finally {
      setDebugLoading(false);
    }
  }, [position]);


  // 天气首次获取 + 每10分钟自动刷新
  useEffect(() => {
    if (position && !weatherCurrent) {
      fetchWeather(position.lat, position.lng);
    }
    const timer = setInterval(() => {
      if (position) {
        fetchWeather(position.lat, position.lng);
      }
    }, 5 * 60 * 1000); // 5 分钟
    return () => clearInterval(timer);
  }, [position, weatherCurrent, fetchWeather]);

  // 定位首次获取 + 每30分钟自动刷新
  useEffect(() => {
    const timer = setInterval(() => {
      if (navigator.geolocation && position) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            setPosition({ lat, lng, accuracy: pos.coords.accuracy });
            setError('');
            reverseGeocode(lat, lng, true);
            lastRefresh.current = Date.now();
          },
          (err) => {
            console.warn('[AutoRefresh] position update failed:', err);
          },
          { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
        );
      }
    }, 30 * 60 * 1000); // 30 分钟
    return () => clearInterval(timer);
  }, [position, reverseGeocode]);

  // 极数本源 1 分钟全量刷新（AQI + 预警 1min；小时预报/15天预报 API 全量返回，无法分字段，同频 1min）
  useEffect(() => {
    if (!position) return;
    fetchNewSources(position.lat, position.lng, '', '', '', true);
    const timer = setInterval(() => {
      if (position) {
        fetchNewSources(position.lat, position.lng, '', '', '', true);
      }
    }, 1 * 60 * 1000);
    return () => clearInterval(timer);
  }, [position, fetchNewSources]);

  // UApiPro：每 2 小时整点刷新（00:00/02:00/04:00…），避免频繁请求
  useEffect(() => {
    const city = geocodeCache.current?.city || (address?.city || '');
    if (!city || !position) return;

    function fetchOnce() {
      if (position) {
        fetchNewSources(position.lat, position.lng, city, '', '', true);
      }
    }
    fetchOnce();

    function scheduleNext() {
      const now = new Date();
      const nextEven = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() % 2 === 0 ? now.getHours() + 2 : now.getHours() + 1, 0, 0, 0);
      if (nextEven.getTime() <= now.getTime()) {
        nextEven.setHours(nextEven.getHours() + 2);
      }
      const delay = nextEven.getTime() - now.getTime();
      const t = setTimeout(fetchOnce, delay);
      return t;
    }
    const t1 = scheduleNext();
    const interval = setInterval(scheduleNext, 2 * 60 * 60 * 1000);
    return () => { clearTimeout(t1); clearInterval(interval); };
  }, [position, address, fetchNewSources]);

  // 接口盒子：位置变更时 + 每日 0:00 刷新（备用预警 + 日月时间）
  // place 传区级（address.district），预警按区级区分
  useEffect(() => {
    if (!position || !address || !apiEnabled.api_hezi) return;
    const sheng = address.province || '';
    const place = address.district || '';
    if (!sheng || !place) return;
    fetchNewSources(position.lat, position.lng, '', sheng, place, true);
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const delay = tomorrow.getTime() - now.getTime();
    const timer = setTimeout(() => {
      if (position && apiEnabled.api_hezi) {
        fetchNewSources(position.lat, position.lng, '', sheng, place, true);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [position, address, fetchNewSources, apiEnabled.api_hezi]);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    // 关闭侧边栏时不触发刷新——避免"进入 GPS 面板再返回主界面"时
    // 自动拉一次数据；刷新仅由下拉刷新 / 位置变更 / 定时刷新负责。
  }, []);

  const accuracyLevel = (acc?: number) => {
    if (acc === undefined || acc === null || isNaN(acc)) {
      return { label: '', level: '' };
    }
    if (acc <= 5) return { label: '极佳', level: 'excellent' };
    if (acc <= 15) return { label: '良好', level: 'good' };
    if (acc <= 50) return { label: '一般', level: 'fair' };
    if (acc <= 150) return { label: '较差', level: 'poor' };
    return { label: '很差', level: 'very-poor' };
  };

  const accInfo = accuracyLevel(position?.accuracy);
  const hasRealAcc = position?.accuracy !== undefined && position?.accuracy !== null && !isNaN(position!.accuracy);
  const accValue = hasRealAcc ? position!.accuracy! : 0;
  const accPercent = hasRealAcc ? Math.max(0, Math.min(100, 100 - accValue * 0.7)) : 0;

  const weatherIconUrl = (phrase: string, isNightOverride?: boolean): string => {
    const night = isNightOverride !== undefined ? isNightOverride : isNightTime();
    return getWeatherIconUrl(phrase, night);
  };

  const weatherIconUrlSimple = (phrase: string, isNightOverride?: boolean): string => {
    const night = isNightOverride !== undefined ? isNightOverride : isNightTime();
    return getWeatherIconUrlSimple(phrase, night);
  };

  
  // 根据天气状况 + 白天/夜间切换背景
  // 返回 { background, textScheme }：textScheme = 'light' | 'dark' 决定字体颜色
  const getWeatherTheme = useCallback(() => {
    const isNight = isNightTime();
    // light = 亮色字体（暗背景），dark = 深色字体（亮背景）
    type Theme = { background: string; scheme: 'light' | 'dark' };

    // 默认背景（无天气数据时按时间显示）
    if (!weatherCurrent) {
      return isNight
        ? ({ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #374151 100%)', scheme: 'light' } as Theme)
        : ({ background: 'linear-gradient(180deg, #60a5fa 0%, #93c5fd 50%, #bfdbfe 100%)', scheme: 'dark' } as Theme);
    }
    const p = (weatherCurrent.phrase || '').toLowerCase();

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
  }, []);

  // 天地图 city + county + town 组合
  const getGeocodeText = useCallback(() => {
    if (geocodeCache.current) {
      const parts = [geocodeCache.current.city, geocodeCache.current.county, geocodeCache.current.town].filter(Boolean);
      if (parts.length > 0) return parts.join(' · ');
    }
    if (position) return `${position.lat.toFixed(2)}°, ${position.lng.toFixed(2)}°`;
    return '';
  }, [position]);

  // ===== 侧边栏 =====
  const renderSidebar = () => (
    <>
      <div className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`} onClick={closeSidebar} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h3>📍 GPS 定位</h3>
          <button className="sidebar-close" onClick={closeSidebar}>✕</button>
        </div>

        <div className={`status-bar ${error ? 'error' : position ? 'success' : 'loading'}`}>
          <span className="status-dot"></span>
          {error
            ? error
            : position
              ? '定位成功 · 实时更新中'
              : '正在搜索 GPS 卫星…'}
        </div>

        <div className="mode-toggle">
          <div className={`mode-option ${locMode === 'gps' ? 'active' : ''}`} onClick={() => switchMode('gps')}>
            <span className="mode-dot"></span>
            <span className="mode-text">🛰️ GPS 卫星</span>
          </div>
          <div className={`mode-option ${locMode === 'auto' ? 'active' : ''}`} onClick={() => switchMode('auto')}>
            <span className="mode-dot"></span>
            <span className="mode-text">📡 自动融合</span>
          </div>
        </div>

        {position ? (
          <div className="coords-grid">
            <div className="coord-card">
              <div className="coord-icon lat">
                <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="none" stroke="#a5b4fc" stroke-width="1.8"/><circle cx="12" cy="9" r="2.5" fill="none" stroke="#a5b4fc" stroke-width="1.8"/></svg>
              </div>
              <div className="coord-info">
                <div className="coord-label">纬度</div>
                <div className="coord-value lat">{position.lat.toFixed(6)}°</div>
              </div>
            </div>

            <div className="coord-card">
              <div className="coord-icon lng">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#67e8f9" stroke-width="1.8"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" fill="none" stroke="#67e8f9" stroke-width="1.8"/></svg>
              </div>
              <div className="coord-info">
                <div className="coord-label">经度</div>
                <div className="coord-value lng">{position.lng.toFixed(6)}°</div>
              </div>
            </div>

            <div className="accuracy-card">
              <div className="accuracy-info">
                <div className="accuracy-label">精度 {accInfo.label}</div>
                <div className="accuracy-bar-wrap">
                  <div className="accuracy-bar">
                    <div className="accuracy-bar-fill" style={{
                      width: `${accPercent}%`,
                      background: accPercent > 80
                        ? 'linear-gradient(90deg, #10b981, #34d399)'
                        : accPercent > 50
                          ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                          : 'linear-gradient(90deg, #ef4444, #f87171)',
                    }}></div>
                  </div>
                  <span className="accuracy-value">{hasRealAcc ? `≈ ${accValue.toFixed(1)} m` : '待获取'}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="loading-area">
            <div className="loading-radar">
              <span className="radar-sweep"></span>
              <span className="radar-dot"></span>
            </div>
            <p className="loading-text">正在搜索卫星信号…</p>
          </div>
        )}

        <div className="address-card">
          <div className="address-header">
            <span className="address-title">📍 当前位置</span>
            {addressLoading && <span className="address-loading">更新中…</span>}
          </div>

          <div className="engine-toggle">
            <span className={`engine-option ${geocodeEngine === 'tianditu' ? 'active' : ''}`} onClick={() => {
              setGeocodeEngine('tianditu'); setAddress(null); setAddressError('');
              if (position) reverseGeocode(position.lat, position.lng, true, 'tianditu');
            }}>天地图</span>
            <span className={`engine-option ${geocodeEngine === 'nominatim' ? 'active' : ''}`} onClick={() => {
              setGeocodeEngine('nominatim'); setAddress(null); setAddressError('');
              if (position) reverseGeocode(position.lat, position.lng, true, 'nominatim');
            }}>OpenStreetMap</span>
          </div>

          {addressError && !address ? (
            <div className="address-empty"><span className="address-empty-text">⚠️ {addressError}</span></div>
          ) : addressLoading && !address ? (
            <div className="address-empty"><span className="address-empty-text">正在查询地址…</span></div>
          ) : address ? (
            <>
              {(address.province || address.city) && (
                <div className="address-province">
                  <span className="address-tag">{address.province}</span>
                  <span className="address-sep">·</span>
                  <span className="address-tag">{address.city}</span>
                  <span className="address-sep">·</span>
                  <span className="address-tag">{address.district || ''}</span>
                </div>
              )}
              {address.full && (
                <div className="address-main">
                  <span className="address-main-text">{address.full}</span>
                </div>
              )}
              {address.poiDetail && (
                <div className="address-detail">
                  <div className="address-row">
                    <span className="address-key">附近</span>
                    <span className="address-val">{address.poiDetail}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="address-empty"><span className="address-empty-text">等待定位数据…</span></div>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="footer-btn" onClick={handleReset}>重新定位</button>
        </div>
      </aside>
    </>
  );

  // ===== 主页面：天气 =====
  return (
    <div className="weather-page" ref={weatherPageRef}
        style={{ ...(getWeatherTheme() ? { background: getWeatherTheme().background as string } : {}), touchAction: 'none' }}
        data-scheme={getWeatherTheme()?.scheme || 'light'}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>
        <div
          ref={pullLoaderRef}
          className={`pull-loader${isRefreshing ? ' refreshing' : ''}`}
          style={{ top: '0px', opacity: '0' }}>
          <div className="pull-loader-bg">
            <svg className="arrow-ring" viewBox="0 0 60 60">
              <g className="arrow-ring-inner" ref={arrowRingRef}>
                <circle className="arc-full" ref={circleFullRef} cx="30" cy="30" r="20" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path className="arc-trail" ref={arcTrailRef} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <polygon className="arrow-head" ref={arrowHeadRef} fill="currentColor" />
              </g>
            </svg>
          </div>
          <span className="pull-loader-text">释放刷新</span>
        </div>
        {showPullDebug && (
        <div className="debug-pull-value" ref={debugPullRef}
          onTouchStart={onPullDebugStart}
          onTouchMove={onPullDebugMove}
          onTouchEnd={onPullDebugEnd}
          onMouseDown={onPullDebugStart}
          onMouseMove={onPullDebugMove}
          onMouseUp={onPullDebugEnd}>
          <span>进度: 0% | 角度: 0° | 旋转: 0°</span><br/>
          <span style={{ fontSize: '0.7rem', opacity: 0.85, color: '#fca5a5' }}>
            未触发
          </span>
        </div>
      )}
            <TopMenuBar
        cityName={getGeocodeText()}
        weatherPhrase={weatherCurrent?.phrase || ''}
        iconUrlFn={weatherIconUrl}
        gearMenuOpen={gearMenuOpen}
        styleMenuOpen={styleMenuOpen}
        debugOpen={debugOpen}
        showPullDebug={showPullDebug}
        layoutCompact={layoutCompact}
        forecast24Style={forecast24Style}
        onGearToggle={() => { setGearMenuOpen(!gearMenuOpen); setStyleMenuOpen(false); }}
        onSidebarOpen={() => setSidebarOpen(true)}
        onStyleMenuToggle={() => setStyleMenuOpen(!styleMenuOpen)}
        onDebugToggle={() => { setDebugOpen(!debugOpen); if (!debugOpen) fetchDebugData(); }}
        onPullDebugToggle={() => setShowPullDebug(!showPullDebug)}
        onApiPanelOpen={() => setApiPanelOpen(true)}
        onLayoutCompactChange={setLayoutCompactCache}
        onForecast24StyleChange={setForecast24StyleCache}
      />
      <div className="scroll-content" ref={contentRef}>
      {!weatherCurrent ? (
        <div className="weather-empty">
          {weatherError ? (
            <><span className="weather-empty-icon">⚠️</span><span className="weather-empty-text">{weatherError}</span></>
          ) : (
            <span className="weather-empty-text" style={{ fontSize: '2rem', fontWeight: 'bold' }}>—</span>
          )}
        </div>
      ) : (
        <div className="weather-wrapper">
          {weatherError && (
            <div className="weather-error-banner">
              <span>⚠️ </span>
              <span>{weatherError}</span>
            </div>
          )}
          <div className={`weather-content${layoutCompact ? ' compact' : ' loose'}`}>
            <WeatherRealtime
              ref={cardRealtimeRef}
              current={weatherCurrent}
              todayMax={Math.round(weatherDays[0]?.calendarDayTemperatureMax || weatherCurrent.temperature)}
              todayMin={Math.round(weatherDays[0]?.calendarDayTemperatureMin || 0)}
              isDisabled={!apiEnabled.weather_com}
            />

            <WeatherDetail
              jishuData={jishuData}
              uapiData={uapiData}
              source24={source24}
              source15={source15}
              onSource24Change={setSource24Cache}
              onSource15Change={setSource15Cache}
              forecast24Style={forecast24Style}
              iconUrlFn={weatherIconUrl}
              simpleIconUrlFn={weatherIconUrlSimple}
              yesterday={weatherYesterday}
              is24Disabled={!apiEnabled[source24]}
              is15Disabled={!apiEnabled[source15]}
              cardForecastRef={cardForecastRef}
              card15dayRef={card15dayRef}
            />
          </div>
          <div className="scroll-placeholder" ref={scrollPlaceholderRef} />
        </div>
      )}
      </div>
      {renderSidebar()}

      {debugOpen && (
        <>
          <div className="debug-panel-overlay active" onClick={() => setDebugOpen(false)} />
          <div className="debug-panel open">
            <div className="debug-panel-header">
              <span className="debug-panel-title">🔧 调试 · API 原始数据</span>
              <button className="debug-panel-close" onClick={() => setDebugOpen(false)}>✕</button>
            </div>
            <div className="debug-panel-body">
              {debugLoading ? (
                <div className="debug-loading">
                  <span className="debug-loading-text">正在获取 API 数据…</span>
                </div>
              ) : debugData ? (
                <div className="debug-json-blocks">
                  {/* 三套新数据源摘要 */}
                  {(function(){
                    const summary = getNewSourcesSummary();
                    if (!summary) return null;
                    return (
                      <div className="debug-summary">
                        {Object.entries(summary).map(([key, value]) => (
                          <div key={key} className="debug-json-block">
                            <div className="debug-json-key">
                              <span>{key}</span>
                              <button className="debug-copy-btn" onClick={() => copyToClipboard(key, value)}>📋 复制</button>
                            </div>
                            <pre className="debug-json-value">{JSON.stringify(value, null, 2)}</pre>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {Object.entries(debugData).map(([key, value], idx) => (
                    <div key={idx} className="debug-json-block">
                      <div className="debug-json-key">
                        <span>{key}</span>
                        <button className="debug-copy-btn" onClick={() => copyToClipboard(key, value)}>
                          {copiedKey === key ? '✓ 已复制' : '📋 复制'}
                        </button>
                      </div>
                      <pre className="debug-json-value">{JSON.stringify(value, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="debug-empty">
                  <span className="debug-empty-text">暂无调试数据</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {apiPanelOpen && (
        <>
          <div className="api-panel-overlay active" onClick={() => setApiPanelOpen(false)} />
          <div className="api-panel open">
            <div className="api-panel-header">
              <span className="api-panel-title">🔌 API 管理</span>
              <button className="api-panel-close" onClick={() => setApiPanelOpen(false)}>✕</button>
            </div>
            <div className="api-panel-body">
              <div className="api-panel-desc">
                禁用 API 后不发送请求，显示缓存数据，对应卡片将被红色覆盖。
              </div>
              {Object.entries(API_META).map(([key, meta]) => (
                <div className="api-panel-item" key={key}>
                  <div className="api-panel-item-main">
                    <span className="api-panel-item-label">{meta.label}</span>
                    <span className="api-panel-item-desc">{meta.desc}</span>
                    <span className="api-panel-item-time">上次请求: {apiRequestTimes[key] || '暂无'}</span>
                  </div>
                  <button
                    className={`api-panel-toggle${apiEnabled[key] ? ' on' : ' off'}`}
                    onClick={() => setApiEnabledCache(key, !apiEnabled[key])}
                    aria-label={`${meta.label} ${apiEnabled[key] ? '已启用' : '已禁用'}`}
                  >
                    <span className="api-panel-toggle-knob" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;