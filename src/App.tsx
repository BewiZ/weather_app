import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getWeatherIconUrl, isNightTime } from './assets/weatherIcons';
import { getWeatherIconUrlSimple } from './assets/weatherIconsSimple';
import type { Forecast24Style } from './layers/WeatherDetail/hooks/Forecast24Hour';
import { usePullRefresh, LoaderDOM, refreshCompleteAnimation } from './layers/TopMenuBar/hooks/usePullRefresh';
import { TopMenuBar } from './layers/TopMenuBar/TopMenuBar';
import { WeatherRealtime } from './layers/WeatherRealtime/WeatherRealtime';
import { buildWeatherCurrentFromJiShu } from './layers/WeatherRealtime/hooks/convertJiShuFallback';
import { buildWeatherCurrentFromMsn } from './layers/WeatherRealtime/hooks/convertMsn';
import { fetchMsn, type MsnData } from './api/msn';
import { WeatherDetail } from './layers/WeatherDetail/WeatherDetail';
import { fetchJiShu } from './api/jiShu';
import { fetchUApiPro } from './api/uApiPro';
import { fetchApiHezi } from './api/apiHezi';
import { type ForecastSource } from './api/unifiedWeather';
import type { JiShuData, UApiResponse, ApiHeziResponse, UnifiedAlert, WeatherCurrent, WeatherDay, WeatherYesterday } from './types/weather';
import type { Position, AddressInfo, LocationMode, GeocodeEngine } from './types/location';
import { base64urlDecode, windDirToCardinal, windSpeedKmHToLevel } from './lib/weatherUtils';
import { fetchWeatherCom } from './api/weatherCom';
import { getLocationId, fetchQw } from './api/qweather';
import './App.css';
import { checkLimit, recordFetch, scheduleClockAligned, isDryMinutelyPrecip, canLogRateLimit, getDailyRemaining } from './utils/rateLimit';
import type { RateLimitResult } from './utils/rateLimit';
import { fetchXzqhdm, type XzqhdmResponse } from './api/xzqhdm';
import { fetchCmaAlarm, isValidAdcode, type CmaAlarm } from './api/cmaAlarm';


const TIANDITU_KEY = (import.meta as any).env?.VITE_TIANDITU_KEY || '';

// 气象预警轮询间隔可选项（分钟），默认 12
const CMA_INTERVAL_OPTIONS = [5, 10, 12, 15, 30];



// 1 个箭头环绕成一圈：弧线 + 箭头头在弧线末端
// 根据进度动态生成 SVG 弧线路径

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSections, setDebugSections] = useState<DebugSection[] | null>(null);
  const [debugExpanded, setDebugExpanded] = useState<Set<number>>(new Set([0, 1]));
  const [debugError, setDebugError] = useState<Record<string, unknown> | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  interface DebugItem {
    key: string;
    value?: unknown;
    children?: DebugItem[];
  }
  interface DebugSection {
    title: string;
    icon: string;
    expanded: boolean;
    items: DebugItem[];
  }

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

        // 查询行政区划代码（xzqhdm）— 用天地图解析出的省份 + 区县
        (async () => {
          const sheng = (addr.province || '').replace(/省|市|区|自治区|特别行政区$/g, '');
          const place = addr.county || addr.city || addr.town || '';
          const cleanPlace = place.replace(/市|区|县|旗|镇|街道$/g, '');
          if (!sheng || !cleanPlace) return;
          try {
            const xzqhdm = await fetchXzqhdm(sheng, cleanPlace);
            if (xzqhdm) {
              rawXzqhdm.current = xzqhdm;
              console.log('[xzqhdm]', xzqhdm.province, xzqhdm.city, xzqhdm.district, 'qydm=', xzqhdm.qydm);
              // CMA 预警接口需要 6 位国标行政区划代码（xzqhdm 的 qydm 字段）；
              // 末两位为 00 的市级代码该接口返回空数组，故此处校验后再使用
              if (isValidAdcode(xzqhdm.qydm)) {
                rawCmaAdcode.current = xzqhdm.qydm;
                setCmaAdcode(xzqhdm.qydm);
                try { localStorage.setItem('cached_cmaAdcode', xzqhdm.qydm); } catch (_) { /* ignore */ }
              }
            }
          } catch (e) {
            console.warn('[xzqhdm] failed:', (e as Error).message);
          }
        })();

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
  // setCmaAdcode 由后文 useState 声明，稳定引用无需入依赖（否则会在 TDZ 期被读取）
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 去重：仅当经纬度实际变化时才重新 setPosition，避免坐标未变时的重复 render
        // （GPS 上报频率可能高于坐标实际变化频率，尤其在信号稳定时）
        const prev = lastGpsPos.current;
        const changed = !prev || Math.abs(lat - prev.lat) > 0.000001 || Math.abs(lng - prev.lng) > 0.000001;
        if (changed) {
          lastGpsPos.current = { lat, lng };
          setPosition({ lat, lng, accuracy: pos.coords.accuracy });
        }
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

  // 冷启动时从 localStorage 恢复上一次天气数据，避免白屏
  const cachedWeatherCurrent = () => {
    try {
      const v = localStorage.getItem('cached_weatherCurrent');
      if (v) return JSON.parse(v);
    } catch (_) { /* ignore */ }
    return null;
  };
  const cachedWeatherDays = () => {
    try {
      const v = localStorage.getItem('cached_weatherDays');
      if (v) return JSON.parse(v);
    } catch (_) { /* ignore */ }
    return [];
  };
  const cachedWeatherYesterday = () => {
    try {
      const v = localStorage.getItem('cached_weatherYesterday');
      if (v) return JSON.parse(v);
    } catch (_) { /* ignore */ }
    return null;
  };
  // 冷启动恢复原始 JSON 缓存，保证调试面板能读取到数据
  const cachedRawNow = () => { try { return JSON.parse(localStorage.getItem('cached_rawNow') || 'null'); } catch (_) { return null; } };
  const cachedRawFc   = () => { try { return JSON.parse(localStorage.getItem('cached_rawFc') || 'null'); }   catch (_) { return null; } };
  const cachedRawYest = () => { try { return JSON.parse(localStorage.getItem('cached_rawYest') || 'null'); } catch (_) { return null; } };
  const cachedRawYestDate = () => localStorage.getItem('cached_rawYestDate') || '';
  // 冷启动恢复气象预警缓存（CMA），保证重启后预警圆角矩形仍能显示
  const cachedCmaAdcode = () => localStorage.getItem('cached_cmaAdcode') || '';
  // 按 adcode 分区缓存，定位切换地区后不会显示旧地区的预警
  const cachedCmaAlarms = () => {
    try { return JSON.parse(localStorage.getItem('cached_cmaAlarms_' + cachedCmaAdcode()) || '[]'); } catch (_) { return []; }
  };

  // 原始数据写入时同步持久化到 localStorage
  const persistRawNow = (d: Record<string, unknown> | null) => { if (d) localStorage.setItem('cached_rawNow', JSON.stringify(d)); };
  const persistRawFc   = (d: Record<string, unknown> | null) => { if (d) localStorage.setItem('cached_rawFc', JSON.stringify(d)); };
  const persistRawYest = (d: Record<string, unknown> | null, date?: string) => {
    if (d) localStorage.setItem('cached_rawYest', JSON.stringify(d));
    if (date) localStorage.setItem('cached_rawYestDate', date);
  };

  const [weatherCurrent, setWeatherCurrent] = useState<WeatherCurrent | null>(cachedWeatherCurrent());
  const [weatherDays, setWeatherDays] = useState<WeatherDay[]>(cachedWeatherDays());
  const [weatherYesterday, setWeatherYesterday] = useState<WeatherYesterday | null>(cachedWeatherYesterday());
  const [weatherError, setWeatherError] = useState('');
  const weatherLoadingRef = useRef(false);
  const newSourcesLoadingRef = useRef(false);
  // 去重：仅当经纬度实际变化时才重新 setPosition
  const lastGpsPos = useRef<{ lat: number; lng: number } | null>(null);
  // 原始 JSON 缓存：fetchWeather 写入，fetchDebugData 读取（避免重复请求）
  const rawWeatherNow = useRef<Record<string, unknown> | null>(cachedRawNow());
  const rawWeatherFc = useRef<Record<string, unknown> | null>(cachedRawFc());
  const rawYesterday = useRef<Record<string, unknown> | null>(cachedRawYest());
  const rawYesterdayDate = useRef<string>(cachedRawYestDate());
  const lastRefresh = useRef(0);

  // 三套新接口的数据状态（极数本源 / UApiPro / 接口盒子 / 统一预警）
  const [jishuData, setJishuData] = useState<JiShuData | null>(null);
  const [uapiData, setUapiData] = useState<UApiResponse | null>(null);
  const [apiHeziData, setApiHeziData] = useState<ApiHeziResponse | null>(null);
  const [unifiedAlerts, setUnifiedAlerts] = useState<UnifiedAlert[]>([]);

  // 气象预警（中央气象台 CMA）
  // adcode 取自 xzqhdm 的 qydm（6 位区县级代码），每 12 分钟轮询一次
  const [cmaAdcode, setCmaAdcode] = useState(cachedCmaAdcode());
  const [cmaAlarms, setCmaAlarms] = useState<CmaAlarm[]>(cachedCmaAlarms());

  // 原始数据缓存（调试面板读取用，避免重复请求）
  const rawJiShu = useRef<JiShuData | null>(null);
  const rawMsn = useRef<MsnData | null>(null);
  const rawUApi = useRef<UApiResponse | null>(null);
  const rawApiHezi = useRef<ApiHeziResponse | null>(null);
  const rawXzqhdm = useRef<XzqhdmResponse | null>(null);
  const rawUnifiedAlerts = useRef<UnifiedAlert[]>([]);
  // CMA 气象预警：供调试面板读取（fetchDebugData 的依赖仅含 position，用 ref 避免闭包过期）
  const rawCmaAdcode = useRef(cachedCmaAdcode());
  const rawCmaAlarms = useRef<CmaAlarm[]>(cachedCmaAlarms());

  // 用于 scheduler callback（避免闭包捕获旧值）
  const positionRef = useRef<Position | null>(null);
  const addressRef = useRef<AddressInfo | null>(null);
  // fetchWeather ref：供 "切换来源" useEffect 在目标源无缓存时触发拉取
  const fetchWeatherRef = useRef<(...args: any[]) => void | Promise<void> | undefined>(() => undefined);

  // 各 API 最近请求完成时间（调试显示用）
  const [apiRequestTimes, setApiRequestTimes] = useState<Record<string, string>>({});

  // 实况天气来源选择
  const REALTIME_SOURCES: { key: string; label: string }[] = [
    { key: 'weather_com', label: 'weather.com' },
    { key: 'jishu',       label: '极数本源' },
    { key: 'msn',         label: 'MSN 中国版' },
  ];
  const [realtimeSource, setRealtimeSource] = useState<string>(() => {
    const v = (localStorage.getItem('realtime_source') || '') as string;
    return REALTIME_SOURCES.find(s => s.key === v) ? v : 'weather_com';
  });
  const setRealtimeSourceCache = useCallback((s: string) => {
    setRealtimeSource(s);
    try { localStorage.setItem('realtime_source', s); } catch (_) { /* ignore */ }
  }, []);

  // 切换实况天气来源时，从缓存的原始数据重新构建 weatherCurrent
  // 不需要重新发起网络请求 —— 三个源的原始数据已缓存在 raw* ref 中
  useEffect(() => {
    const wkMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    let rebuilt = false;

    if (realtimeSource === 'weather_com' && rawWeatherNow.current) {
      const obs = rawWeatherNow.current as any;
      if (obs && typeof obs.temperature === 'number' && !Number.isNaN(obs.temperature)) {
        rebuilt = true;
        setWeatherCurrent({
          temperature: Number(obs.temperature) || 0,
          phrase: obs.wxPhraseLong || obs.wxPhraseMedium || obs.cloudCoverPhrase || '未知',
          cloudCover: obs.cloudCover !== undefined ? Number(obs.cloudCover) : undefined,
          temperatureHeatIndex: Number(obs.temperatureFeelsLike) || 0,
          relativeHumidity: Number(obs.relativeHumidity) || 0,
          windSpeed: Number(obs.windSpeed) || 0,
          windDirectionCardinal: obs.windDirectionCardinal || '',
          windDirectionDegrees: Number(obs.windDirection) || 0,
          uvIndex: obs.uvIndex !== undefined ? Number(obs.uvIndex) : 0,
          pressure: Number(obs.pressureMeanSeaLevel) || 0,
          pressTendencyCode: Number(obs.pressTendencyCode) || 0,
          visibility: Number(obs.visibility) || 0,
          sunrise: obs.sunriseTimeLocal || '',
          sunset: obs.sunsetTimeLocal || '',
          obsQualifierPhrase: '',
          obsTimeLocal: obs.observationTime || '',
          observationTime: obs.observationTime || '',
        });
        // 7 天预报从 rawWeatherFc 重建
        if (rawWeatherFc.current) {
          const fc = rawWeatherFc.current as any;
          const days: WeatherDay[] = [];
          for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().slice(0, 10);
            days.push({
              date: dateStr,
              dayOfWeek: fc.dayOfWeek?.[i] || wkMap[date.getDay()] || '',
              calendarDayTemperatureMax: Number(fc.temperatureMax?.[i]) || 0,
              calendarDayTemperatureMin: Number(fc.temperatureMin?.[i]) || 0,
              narrative: fc.narrative?.[i] || (fc.daypart?.[0]?.narrative?.[i * 2] || ''),
            });
          }
          setWeatherDays(days);
        }
      }
    } else if (realtimeSource === 'jishu' && rawJiShu.current) {
      const fallback = buildWeatherCurrentFromJiShu(rawJiShu.current, wkMap);
      if (fallback) {
        rebuilt = true;
        setWeatherCurrent(fallback.current);
        setWeatherDays(fallback.todayDay ? [fallback.todayDay] : []);
      }
    } else if (realtimeSource === 'msn' && rawMsn.current) {
      const fallback = buildWeatherCurrentFromMsn(rawMsn.current, wkMap);
      if (fallback) {
        rebuilt = true;
        setWeatherCurrent(fallback.current);
        setWeatherDays(fallback.todayDay ? [fallback.todayDay] : []);
      }
    }

    // 目标源无缓存数据 → 触发一次手动请求（尊重 rate limit）
    if (!rebuilt && positionRef.current) {
      const { lat, lng } = positionRef.current;
      if (typeof lat === 'number' && typeof lng === 'number') {
        fetchWeatherRef.current?.(lat, lng, true, false);
      }
    }
  }, [realtimeSource]);

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
    msn: false,            // MSN 中国版（当前天气 + 10天预报）
    uapi: true,            // UApiPro（24小时 / 15天 / 预警）
    api_hezi: true,        // 接口盒子（预警补充）
    qweather: true,        // QWeather（昨日历史天气）
    cma: true,             // 中央气象台 CMA（气象预警 map/alarm）
  };
  const [apiEnabled, setApiEnabled] = useState<Record<string, boolean>>(() => {
    try {
      const v = localStorage.getItem('api_enabled');
      if (v) { const p = JSON.parse(v); return { ...DEFAULT_API_ENABLED, ...p }; }
    } catch (_) { /* ignore */ }
    return DEFAULT_API_ENABLED;
  });
  // MSN 与 weather.com 可共存：实时天气可启用多个源，主源（realtimeSource）决定显示哪个
  const setApiEnabledCache = useCallback((key: string, val: boolean) => {
    setApiEnabled(prev => {
      const next = { ...prev, [key]: val };
      // MSN 与 weather.com 可共存：主源（realtimeSource）决定显示哪个，两者原始数据都拉取
      try { localStorage.setItem('api_enabled', JSON.stringify(next)); } catch (_) { /* ignore */ }
      return next;
    });
  }, []);

  // 开关打开时触发一次自动请求（尊重 rate limit，仅当 checkLimit 放行时才实际发送）
  // 定义在 fetchNewSources 之后，避免 TDZ
  // (移到底部实现)

  // API 元信息：显示名 + 描述（含刷新规则）
  const API_META: Record<string, { label: string; desc: string; cadence: string }> = {
    weather_com: { label: 'weather.com', desc: '当前天气 + 7天预报', cadence: '🕐 自动5分钟 · 手动间隔3分钟' },
    jishu:       { label: '极数本源',     desc: '24小时预报 / 15天预报 / AQI / 预警', cadence: '🕐 自动2分钟（无降水15分钟） · 日限1500次' },
    msn:         { label: 'MSN 中国版',   desc: '当前天气 + 10天预报（可与 weather.com 共存）', cadence: '🕐 自动5分钟 · 手动间隔3分钟' },
    uapi:        { label: 'UApiPro',      desc: '24小时预报 / 15天预报 / 预警', cadence: '🕐 自动1小时 · 日限35次' },
    api_hezi:    { label: '接口盒子',     desc: '预警补充', cadence: '🕐 自动5分钟 · 手动间隔10秒' },
    qweather:    { label: 'QWeather',     desc: '昨日历史天气', cadence: '🕐 自动12小时 · 日限20次' },
    cma:         { label: '中央气象台 CMA', desc: '气象预警（map/alarm，需区县级 adcode）', cadence: '🕐 自动轮询 · 间隔可设' },
  };

  // 气象预警轮询间隔（分钟）；API 管理面板中点击循环切换
  const [cmaIntervalMin, setCmaIntervalMin] = useState<number>(() => {
    const n = parseInt(localStorage.getItem('cma_interval_min') || '', 10);
    return CMA_INTERVAL_OPTIONS.includes(n) ? n : 12;
  });
  const setCmaIntervalMinCache = useCallback((n: number) => {
    setCmaIntervalMin(n);
    try { localStorage.setItem('cma_interval_min', String(n)); } catch (_) { /* ignore */ }
  }, []);
  const cycleCmaInterval = useCallback(() => {
    const next = CMA_INTERVAL_OPTIONS[(CMA_INTERVAL_OPTIONS.indexOf(cmaIntervalMin) + 1) % CMA_INTERVAL_OPTIONS.length];
    setCmaIntervalMinCache(next);
  }, [cmaIntervalMin, setCmaIntervalMinCache]);

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

  // 详情卡片布局：紧凑（24h 在视口底部）vs 松散（自然间距）
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

  // 天气主界面数据持久化 — 冷启动恢复
  useEffect(() => {
    try {
      if (weatherCurrent) localStorage.setItem('cached_weatherCurrent', JSON.stringify(weatherCurrent));
      else localStorage.removeItem('cached_weatherCurrent');
    } catch (_) { /* ignore */ }
  }, [weatherCurrent]);

  useEffect(() => {
    try {
      if (weatherDays.length > 0) localStorage.setItem('cached_weatherDays', JSON.stringify(weatherDays));
      else localStorage.removeItem('cached_weatherDays');
    } catch (_) { /* ignore */ }
  }, [weatherDays]);

  useEffect(() => {
    try {
      if (weatherYesterday) localStorage.setItem('cached_weatherYesterday', JSON.stringify(weatherYesterday));
      else localStorage.removeItem('cached_weatherYesterday');
    } catch (_) { /* ignore */ }
  }, [weatherYesterday]);

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
      if (cu) {
        const d = JSON.parse(cu);
        // 旧版本缓存若缺 life_indices，直接丢弃，
        // 避免展示一份没有生活指数的过期数据，同时触发冷启动补拉
        if (d && d.life_indices) { setUapiData(d); rawUApi.current = d; }
      }
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

  // 天地图地理编码结果缓存（city + county + town）
  const geocodeCache = useRef<{ city: string; county: string; town: string; lat: number; lng: number } | null>(null);

  const fetchWeather = useCallback(async (lat: number, lng: number, isManual: boolean = false, force: boolean = false, enabledOverride?: Record<string, boolean>) => {
    // force=true（首次启动强制拉取）：绕过 loading guard，直接执行
    // 不清空 UI 状态，让旧数据保持显示，直到新数据到来
    if (weatherLoadingRef.current && !force) return;
    weatherLoadingRef.current = true;
    setWeatherError('');

    try {
      // enabledOverride：开关切换等场景传入即时状态，绕过闭包捕获旧值的延迟
      const _enabled = enabledOverride ?? apiEnabled;
      const wkMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const _mode: 'auto' | 'manual' = isManual ? 'manual' : 'auto';

      // 实况天气来源：按用户选择的顺序排列。主源（realtimeSource）决定显示数据，
      // 其余已启用的源仍拉取原始数据（供调试面板展示）。两个源可同时启用。
      const realtimeOrder = (function(): string[] {
        const chosen = realtimeSource;
        const list = ['weather_com', 'jishu', 'msn'].filter(k => k !== chosen);
        return [chosen, ...list];
      })();

      for (const src of realtimeOrder) {
        if (!_enabled[src]) continue;
        // 主源（realtimeSource）控制显示数据，非主源仅拉取原始数据供调试面板
        const isPrimary = src === realtimeSource;

        // 速率限制检查（force=true 时跳过）
        if (!force) {
          const _lim = checkLimit(src, _mode);
          if (!_lim.allowed) {
            if (canLogRateLimit(src)) console.log(`[RateLimit] ${src}: ${_lim.reason}`);
            continue;
          }
        }

        if (src === 'weather_com') {
          try {
            const obs = await fetchWeatherCom('observations/current', lat, lng);
            recordFetch('weather_com', _mode);
            rawWeatherNow.current = obs;
            persistRawNow(obs);
            setApiRequestTimes(prev => ({ ...prev, weather_com: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
            // 验证：weather.com 对偏远坐标（如新疆 43.2°N, 78.1°E）可能返回 HTTP 200 但实况字段全为 null
            // 如果温度字段无效，拒绝该数据源，继续尝试 jishu / MSN
            if (!obs || typeof obs.temperature !== 'number' || Number.isNaN(obs.temperature)) {
              console.warn('[weather.com] observation returned null/invalid fields, falling back to next source');
              continue;
            }
            const sunriseStr = (obs as any).sunriseTimeLocal || '';
            const sunsetStr = (obs as any).sunsetTimeLocal || '';
            if (isPrimary) {
              setWeatherCurrent({
                temperature: Number((obs as any).temperature) || 0,
                phrase: (obs as any).wxPhraseLong || (obs as any).wxPhraseMedium || (obs as any).cloudCoverPhrase || '未知',
                cloudCover: (obs as any).cloudCover !== undefined ? Number((obs as any).cloudCover) : undefined,
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

              // 仅主源控制显示：设置天气天数
              const fc = await fetchWeatherCom('forecast/daily/10day', lat, lng);
              rawWeatherFc.current = fc;
              persistRawFc(fc);
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
            }
          } catch (e) {
            console.warn('[weather.com realtime]', (e as Error).message);
          }
        } else if (src === 'jishu') {
          try {
            const jiShu = await fetchJiShu(lat, lng, 15, 24);
            if (jiShu) {
              recordFetch('jishu', _mode);
              setJishuData(jiShu);
              rawJiShu.current = jiShu;
              setApiRequestTimes(prev => ({ ...prev, jishu: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));

              if (isPrimary) {
                const fallback = buildWeatherCurrentFromJiShu(jiShu, wkMap);
                if (fallback) {
                  setWeatherCurrent(fallback.current);
                  setWeatherDays(fallback.todayDay ? [fallback.todayDay] : []);
                }
              }
            }
          } catch (e) {
            console.warn('[jiShu realtime]', (e as Error).message);
          }
        } else if (src === 'msn') {
          try {
            const msn = await fetchMsn(lat, lng);
            if (msn) {
              recordFetch('msn', _mode);
              rawMsn.current = msn;
              setApiRequestTimes(prev => ({ ...prev, msn: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));

              if (isPrimary) {
                const fallback = buildWeatherCurrentFromMsn(msn, wkMap);
                if (fallback) {
                  setWeatherCurrent(fallback.current);
                  setWeatherDays(fallback.todayDay ? [fallback.todayDay] : []);
                }
              }
            }
          } catch (e) {
            console.warn('[MSN realtime]', (e as Error).message);
          }
        }
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
            const _yFromCache = { 查询日期: ydStr, ...JSON.parse(rawCached) };
            rawYesterday.current = _yFromCache;
            rawYesterdayDate.current = ydStr;
            persistRawYest(_yFromCache, ydStr);
          } catch (_) { /* ignore */ }
        }
      } else if (!apiEnabled.qweather) {
        // QWeather 已禁用：跳过请求，保留缓存数据
      } else {
        // QWeather 时间机器（历史天气） — 当天首次请求 + 速率限制
        let qwSkip = false;
        if (!force) {
          const _qwLim = checkLimit('qweather', _mode);
          if (!_qwLim.allowed) {
            if (canLogRateLimit('qweather')) console.log(`[RateLimit] qweather: ${_qwLim.reason}`);
            qwSkip = true;
          }
        }
        if (!qwSkip) {
          try {
            const locationId = await getLocationId(lat, lng);
            const histData = await fetchQw('historical/weather', locationId, `date=${ydStr}`);
            recordFetch('qweather', _mode);
          rawYesterday.current = { 查询日期: ydStr, ...histData };
          rawYesterdayDate.current = ydStr;
          persistRawYest({ 查询日期: ydStr, ...histData }, ydStr);
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
            persistRawYest({ 查询日期: ydStr, 错误: (e as Error).message });
          }
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
  fetchWeatherRef.current = fetchWeather;

  // 拉取三套新数据源（极数本源 + UApiPro + 接口盒子）
  const fetchNewSources = useCallback(async (
    lat: number,
    lng: number,
    city: string,       // UApiPro 用
    sheng: string,      // 接口盒子用
    place: string,      // 接口盒子用
    _isManual = false,  // true = 手动刷新（用户触发），false = 自动刷新
    _force = false,     // true = 跳过 rate limit（首次启动强制拉取）
    enabledOverride?: Record<string, boolean>
  ) => {
    // 去重：若上一次 fetchNewSources 尚未完成，直接放弃本次调用
    if (newSourcesLoadingRef.current && !_force) return;
    newSourcesLoadingRef.current = true;

    const mode: 'auto' | 'manual' = _isManual ? 'manual' : 'auto';

    try {
      // enabledOverride：开关切换等场景传入即时状态，绕过闭包捕获旧值的延迟
      const _enabled = enabledOverride ?? apiEnabled;
      // _force=true（首次启动强制拉取）按约定跳过 rate limit。
      // 否则若上次退出前刚拉过 UApiPro，本次启动会被 1 小时间隔挡住，
      // 而缓存里若缺 life_indices，生活指数卡片要等到下一个整点才出现。
      const limitOk = (src: string): RateLimitResult =>
        _force ? { allowed: true } : checkLimit(src, mode);
      // UApiPro 定位优先级：adcode（区县级，最精确）> city（城市名称）。
      // adcode 取自 xzqhdm.qydm，不依赖天地图逆地理编码，故 city 为空时仍可定位
      const uapiAdcode = rawCmaAdcode.current || cachedCmaAdcode();
      // 三个数据源独立并行拉取（互不等待、互不阻断），各自受 rate limit 控制
      await Promise.allSettled([
      // 极数本源（每分钟降水全为 0 → 15 分钟慢速档，否则 2 分钟正常档）
      (async () => {
        if (!_enabled.jishu) return;
        const jishuLimitKey = isDryMinutelyPrecip(rawJiShu.current) ? 'jishu_minutely' : 'jishu';
        const limit = limitOk(jishuLimitKey);
        if (!limit.allowed) { if (canLogRateLimit(jishuLimitKey)) console.log(`[RateLimit] jishu(${jishuLimitKey}) ${limit.reason}`); return; }
        try {
          const data = await fetchJiShu(lat, lng);
          // 记录时使用实际档位；daily 计数也归入主 jishu 统计
          recordFetch('jishu', mode);
          if (jishuLimitKey === 'jishu_minutely') recordFetch('jishu_minutely', mode);
          if (data) { setJishuData(data); rawJiShu.current = data; setApiRequestTimes(prev => ({ ...prev, jishu: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[jiShu]', (e as Error).message); }
      })(),
      // UApiPro（city 或 adcode 之一有效即可）
      (async () => {
        if ((!city && !uapiAdcode) || !_enabled.uapi) return;
        const limit = limitOk('uapi');
        if (!limit.allowed) { if (canLogRateLimit('uapi')) console.log(`[RateLimit] uapi ${limit.reason}`); return; }
        try {
          const data = await fetchUApiPro(city, uapiAdcode);
          recordFetch('uapi', mode);
          if (data) { setUapiData(data); rawUApi.current = data; setApiRequestTimes(prev => ({ ...prev, uapi: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[uApiPro]', (e as Error).message); }
      })(),
      // 接口盒子（仅当 sheng/place 有效时）
      (async () => {
        if (!sheng || !place || !_enabled.api_hezi) return;
        const limit = limitOk('api_hezi');
        if (!limit.allowed) { if (canLogRateLimit('api_hezi')) console.log(`[RateLimit] api_hezi ${limit.reason}`); return; }
        try {
          const data = await fetchApiHezi(sheng, place);
          recordFetch('api_hezi', mode);
          if (data) { setApiHeziData(data); rawApiHezi.current = data; setApiRequestTimes(prev => ({ ...prev, api_hezi: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })); }
        } catch (e) { console.warn('[apiHezi]', (e as Error).message); }
      })(),
    ]);
    } finally {
      newSourcesLoadingRef.current = false;
      lastRefresh.current = Date.now();
    }
  }, [apiEnabled]);

  // 冷启动补拉 UApiPro：life_indices 是新增字段。旧版本留下的 cached_uapi 若缺该
  // 字段（已在冷启动恢复处丢弃），而 first_launch_done 已置位不再强制拉取，
  // 正常 1 小时间隔又可能挡住，生活指数卡片就会一直不出现。此处一次性补拉。
  const uapiBackfillRef = useRef(false);
  useEffect(() => {
    if (!position || uapiBackfillRef.current) return;
    let hasLifeIndices = false;
    try {
      const cu = localStorage.getItem('cached_uapi');
      if (cu) hasLifeIndices = !!(JSON.parse(cu) as { life_indices?: unknown })?.life_indices;
    } catch (_) { /* ignore */ }
    if (hasLifeIndices) return;
    uapiBackfillRef.current = true; // 只在首次尝试，失败交由整点定时刷新兜底
    if (getDailyRemaining('uapi') <= 0) return; // 日配额用尽时不再强制
    console.log('[Backfill] cached_uapi 缺 life_indices，强制补拉 UApiPro');
    fetchNewSources(position.lat, position.lng,
      address?.city || '', address?.province || '', address?.district || '', false, true);
  }, [position, address, fetchNewSources]);

  // 开关打开时触发一次自动请求（尊重 rate limit，仅当 checkLimit 放行时才实际发送）
  const onApiToggle = useCallback((key: string, val: boolean) => {
    // 先构造更新后的状态（用于 enabledOverride 和 localStorage）
    const next: Record<string, boolean> = { ...apiEnabled, [key]: val };
    setApiEnabled(prev => {
      const merged = { ...prev, [key]: val };
      try { localStorage.setItem('api_enabled', JSON.stringify(merged)); } catch (_) { /* ignore */ }
      // 禁用当前主源时，自动切换到另一个已启用的实况源
      if (!val && (key === 'weather_com' || key === 'jishu' || key === 'msn')) {
        setRealtimeSource(prevSrc => {
          if (prevSrc !== key) return prevSrc;
          const fallbacks = ['weather_com', 'jishu', 'msn'].filter(k => k !== key && merged[k]);
          const chosen = fallbacks[0] || 'weather_com';
          try { localStorage.setItem('realtime_source', chosen); } catch (_) { /* ignore */ }
          return chosen;
        });
      }
      return merged;
    });
    if (!val) return; // 仅在打开时触发一次请求，关闭不请求
    if (!position) return;
    const { lat, lng } = position;
    if (key === 'weather_com' || key === 'jishu' || key === 'msn') {
      // 开关切换属于用户主动操作，使用 manual 模式（限流窗口更宽松）
      // 传入 next 作为 enabledOverride，绕过闭包捕获旧 apiEnabled 的延迟
      fetchWeather(lat, lng, true, false, next);
    } else if (key === 'uapi' || key === 'api_hezi' || key === 'qweather') {
      fetchNewSources(lat, lng,
        (addressRef.current || address)?.city || '',
        (addressRef.current || address)?.province || '',
        (addressRef.current || address)?.district || '',
        true, false, next);
    }
  }, [position, address, addressRef, setApiEnabledCache, fetchWeather, fetchNewSources, apiEnabled]);

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

  // 差速视差常量：lag + boost 需恰好等于 realtime↔forecast 的卡片间隙，才能把间隙完全闭合
  // LOOSE_GAP = .card-realtime 在 loose 下的 margin-bottom (24px)
  // COMPACT_GAP = compact 下 .card-realtime margin-bottom (6px) + .forecast-24h margin-top (0.4rem ≈ 5px)
  const LOOSE_GAP = 24;
  const COMPACT_GAP = 11;
  const STAGE_END = 24;    // 差速阶段结束 sy，gap 闭合后 lag/boost 固定
  const LOOSE_STAGE = STAGE_END;
  const BLUR_MAX = 4;      // 实况天气最大模糊半径
  // 紧凑/松散使用不同的间隙，lag/boost 按比例分配（realtime 承担 1/3）
  const gapForLayout = layoutCompactRef.current ? COMPACT_GAP : LOOSE_GAP;
  const LAG_MAX = gapForLayout / 3;
  const BOOST_MAX = gapForLayout - LAG_MAX;

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

  // 滚动状态用 requestAnimationFrame 批处理：
  // handleTouchMove 每帧（120Hz）都被调用，若同步写入 DOM 会导致大量
  // transform/filter 重排；RAF 保证每帧最多一次 applyScrollState，流畅度提升显著。
  const scrollRAF = useRef<number>(0);
  function scheduleScrollState() {
    if (scrollRAF.current) return;
    scrollRAF.current = requestAnimationFrame(() => {
      scrollRAF.current = 0;
      applyScrollState();
    });
  }
  function applyScroll(sy: number) {
    pageScrollY.current = Math.max(0, Math.min(sy, pageMaxScroll.current));
    scheduleScrollState();
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
      await fetchWeather(pos.lat, pos.lng, true);
      if (address?.city || address?.province) {
        await fetchNewSources(pos.lat, pos.lng, address.city || '', address.province || '', address.district || '', true);
      }
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

  // 调试：获取原始 API 数据（分一级/二级目录）
  const fetchDebugData = useCallback(async () => {
    setGearMenuOpen(false);
    setDebugOpen(true);
    setDebugSections(null);
    setDebugError(null);
    setDebugLoading(true);

    try {
      if (!position) {
        setDebugError({ 错误: '当前无定位数据，无法获取 API 数据' });
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

      const nowCached = !!rawWeatherNow.current;
      const fcCached = !!rawWeatherFc.current;
      const yestCached = !!(rawYesterday.current && rawYesterdayDate.current === ydStr);

      const needLive = !nowCached || !fcCached || !yestCached;

      // ── Section 1: 环境信息 ──
      const envItems: DebugItem[] = [
        { key: '调试版本', value: 'v2.1 — 缓存优先' },
        { key: '请求坐标', value: `lat=${lat.toFixed(6)}, lng=${lng.toFixed(6)}` },
        { key: 'Tauri 运行时', children: [
          { key: '__TAURI__ 存在', value: !!tauriWin },
          { key: '__TAURI__.invoke 类型', value: typeof (tauriWin?.invoke) },
          { key: '__TAURI_INTERNALS__ 存在', value: !!tauriInt },
          { key: '__TAURI_INTERNALS__.invoke 类型', value: typeof (tauriInt?.invoke) },
          { key: '__TAURI_INTERNALS__ 属性', value: Object.keys(tauriInt || {}).join(', ') },
          { key: 'window tauri 键', value: Object.keys(window).filter(k => k.toLowerCase().includes('tauri')).join(', ') },
        ]},
        { key: '缓存状态', value: `当前=${nowCached?'✓':'✗'} 7天=${fcCached?'✓':'✗'} 昨日=${yestCached?'✓':'✗'}` },
      ];

      const wcItems: DebugItem[] = [];
      const qwItems: DebugItem[] = [];

      const sections: DebugSection[] = [
        { title: '环境信息', icon: '🖥️', expanded: true, items: envItems },
        { title: 'weather.com', icon: '🌤️', expanded: true, items: wcItems },
        { title: 'QWeather / JWT', icon: '🔐', expanded: false, items: qwItems },
      ];

      const otherItems: DebugItem[] = [];

      if (needLive) {
        const batch = await Promise.allSettled([
          (async () => {
            try {
              const r = await Promise.race([tauriInvoke('ping_test'),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000))]);
              return typeof r === 'string' ? r : JSON.stringify(r);
            } catch (e) { return `[ping_test 超时] ${e}`; }
          })(),
          (async () => {
            if (nowCached) return { cached: true, data: rawWeatherNow.current };
            try {
              const r = await fetchWeatherCom('observations/current', lat, lng);
              rawWeatherNow.current = r;
              persistRawNow(r);
              return { cached: false, data: r };
            } catch (e) { return { cached: false, error: (e as Error).message, data: {} }; }
          })(),
          (async () => {
            if (fcCached) return { cached: true, data: rawWeatherFc.current };
            try {
              const r = await fetchWeatherCom('forecast/daily/10day', lat, lng);
              rawWeatherFc.current = r;
              persistRawFc(r);
              return { cached: false, data: r };
            } catch (e) { return { cached: false, error: (e as Error).message, data: {} }; }
          })(),
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
              persistRawYest({ 查询日期: ydStr, ...hist }, ydStr);
              return { cached: false, data: { 查询日期: ydStr, ...hist } };
            } catch (e) {
              rawYesterday.current = { 查询日期: ydStr, 错误: (e as Error).message };
            persistRawYest({ 查询日期: ydStr, 错误: (e as Error).message });
              rawYesterdayDate.current = ydStr;
              return { cached: false, data: { 查询日期: ydStr, 错误: (e as Error).message }, error: (e as Error).message };
            }
          })(),
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

        envItems.push({ key: 'ping_test', value: (batch[0] as PromiseFulfilledResult<any>).value });

        const nowData = (batch[1] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};
        const fcData = (batch[2] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};
        const yestData = (batch[3] as PromiseFulfilledResult<{ cached: boolean, data: any, error?: string }> | undefined)?.value?.data || {};

        const nowRes = batch[1] as PromiseFulfilledResult<any> | undefined;
        const fcRes = batch[2] as PromiseFulfilledResult<any> | undefined;
        const yestRes = batch[3] as PromiseFulfilledResult<any> | undefined;

        wcItems.push(
          { key: '当前天气', children: [
            { key: '数据来源', value: nowRes?.value?.cached ? '从主界面缓存读取' : nowRes?.value?.error || '实时请求完成' },
            { key: '原始数据', value: nowData },
          ]},
          { key: '7天预报', children: [
            { key: '数据来源', value: fcRes?.value?.cached ? '从主界面缓存读取' : fcRes?.value?.error || '实时请求完成' },
            { key: '原始数据', value: fcData },
          ]},
          { key: '昨日天气', children: [
            { key: '数据来源', value: yestRes?.value?.cached ? '从主界面缓存读取' : yestRes?.value?.error || '实时请求完成' },
            { key: '查询日期', value: ydStr },
            { key: '原始数据', value: Object.assign({}, yestData, { 查询日期: ydStr }) },
          ]},
        );

        // JWT 解码
        const debugJwt = (batch[4] as PromiseFulfilledResult<string> | undefined)?.value || '';
        if (debugJwt) {
          const parts = debugJwt.split('.');
          const jwtChildren: DebugItem[] = [
            { key: '总长度', value: debugJwt.length },
            { key: '段数 (3段正确?)', value: parts.length === 3 ? '段数正确' : `段数=${parts.length}` },
            { key: '含 = 号?', value: debugJwt.includes('=') ? '是⚠️' : '否✓' },
            { key: '含 + 或 /?', value: (debugJwt.includes('+') || debugJwt.includes('/')) ? '是⚠️' : '否✓' },
          ];
          if (parts.length >= 1) {
            try { jwtChildren.push({ key: 'Header (解码)', value: JSON.stringify(JSON.parse(base64urlDecode(parts[0]))) }); }
            catch (e) { jwtChildren.push({ key: 'Header 解码失败', value: (e as Error).message }); }
          }
          if (parts.length >= 2) {
            try {
              const payload = JSON.parse(base64urlDecode(parts[1]));
              jwtChildren.push({ key: 'Payload (解码)', value: JSON.stringify(payload) });
              jwtChildren.push({ key: 'iat (UNIX)', value: payload.iat });
              jwtChildren.push({ key: 'iat (时间)', value: new Date(payload.iat * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) });
              jwtChildren.push({ key: 'exp (UNIX)', value: payload.exp });
              jwtChildren.push({ key: 'exp (时间)', value: new Date(payload.exp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) });
              jwtChildren.push({ key: 'sub', value: payload.sub });
              jwtChildren.push({ key: '当前时间 (UNIX)', value: nowUnix });
              jwtChildren.push({ key: '当前时间 (上海)', value: nowShanghai });
              jwtChildren.push({ key: '已过期?', value: payload.exp < nowUnix ? '是⚠️' : `否, 剩余 ${payload.exp - nowUnix}s` });
            } catch (e) { jwtChildren.push({ key: 'Payload 解码失败', value: (e as Error).message }); }
          }
          if (parts.length >= 3) jwtChildren.push({ key: '签名长度', value: parts[2].length });

          qwItems.push({ key: 'JWT 完整', value: `══════════ 复制 JWT 到 https://jwt.io/ 验证 ══════════\n\n${debugJwt}` });
          qwItems.push({ key: 'JWT 详情', children: jwtChildren });

          try {
            const testUrl = 'https://mc57rkjak5.re.qweatherapi.com/v7/weather/now?location=116.4074,39.9042';
            const r = await Promise.race([
              fetch(testUrl, { headers: { 'Authorization': `Bearer ${debugJwt}` } })
                .then(async res => { const body = await res.text(); return { status: res.status, body: body.slice(0, 200) }; }),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('超时')), 3000)),
            ]);
            qwItems.push({ key: 'QWeather 鉴权', value: r.status === 200 ? '✅ 成功' : `❌ HTTP ${r.status}` });
            qwItems.push({ key: 'QWeather 测试详情', value: r });
          } catch (e) { qwItems.push({ key: 'QWeather 鉴权', value: `❌ ${(e as Error).message}` }); }

          const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
          if (cachedGeo) {
            qwItems.push({ key: 'GeoAPI LocationID', value: cachedGeo });
            qwItems.push({ key: 'GeoAPI 说明', value: '来自缓存' });
          } else {
            try {
              const id = await getLocationId(lat, lng, debugJwt);
              qwItems.push({ key: 'GeoAPI LocationID', value: id });
            } catch (e) { qwItems.push({ key: 'GeoAPI 错误', value: (e as Error).message }); }
          }
        }
      } else {
        wcItems.push(
          { key: '当前天气', children: [
            { key: '数据来源', value: '从主界面缓存读取' },
            { key: '原始数据', value: rawWeatherNow.current },
          ]},
          { key: '7天预报', children: [
            { key: '数据来源', value: '从主界面缓存读取' },
            { key: '原始数据', value: rawWeatherFc.current },
          ]},
          { key: '昨日天气', children: [
            { key: '数据来源', value: '从主界面缓存读取' },
            { key: '查询日期', value: ydStr },
            { key: '原始数据', value: Object.assign({}, rawYesterday.current, { 查询日期: ydStr }) },
          ]},
        );
        const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
        if (cachedGeo) qwItems.push({ key: 'GeoAPI LocationID', value: cachedGeo });
      }

      // ── Section 4: 其他数据源 ──
      otherItems.push({ key: '极数本源 jiShu', value: rawJiShu.current || '尚未拉取' });
      otherItems.push({ key: 'MSN 中国版', value: rawMsn.current || '尚未拉取' });
      otherItems.push({ key: 'UApiPro', value: rawUApi.current || '尚未拉取' });
      otherItems.push({ key: '接口盒子 apiHezi', value: rawApiHezi.current || '尚未拉取' });
      otherItems.push({ key: '行政区划代码 xzqhdm', value: rawXzqhdm.current || '尚未查询' });
      otherItems.push({ key: 'CMA 预警 adcode', value: rawCmaAdcode.current || '尚未查询（qydm 需为区县级代码）' });
      otherItems.push({ key: '气象预警 CMA', value: rawCmaAlarms.current.length > 0 ? rawCmaAlarms.current : '当前无预警' });

      sections.push({ title: '其他数据源', icon: '📡', expanded: false, items: otherItems });

      setDebugSections(sections);
      setDebugExpanded(new Set([0, 1]));
    } catch (e) {
      setDebugError({ 错误: (e as Error).message, stack: (e as Error).stack });
    } finally {
      setDebugLoading(false);
    }
  }, [position]);


  // 天气首次获取（无数据时立即拉取实况 + 预报）
  useEffect(() => {
    if (position && !weatherCurrent) {
      fetchWeather(position.lat, position.lng);
      fetchNewSources(position.lat, position.lng, '', '', '', false);
    }
    positionRef.current = position;
  }, [position, weatherCurrent, fetchWeather, fetchNewSources]);

  // 统一调度器（2 分钟基准 tick，clock-aligned）
  // 所有 API 共用同一个 2 分钟调度器，checkLimit 各自控制实际频率：
  //   weather.com:     5 分钟 :00 :05 :10 ... :55
  //   jishu:           2 分钟（降水全 0 时 15 分钟慢速档）
  //   api_hezi:        5 分钟
  //   msn:             10 分钟（fallback，weather.com 不可用时才独立尝试）
  //   uapi:            1 小时
  //   qweather:        12 小时
  useEffect(() => {
    if (!position) return;
    positionRef.current = position;
    addressRef.current = address;

    const p0 = position;
    fetchWeather(p0.lat, p0.lng);
    fetchNewSources(p0.lat, p0.lng, '', '', '', false);

    const cleanup = scheduleClockAligned('jishu', () => {
      const p = positionRef.current;
      const a = addressRef.current;
      if (!p) return;
      // 实况/预报（weather.com / jishu / msn + qweather 历史）
      fetchWeather(p.lat, p.lng);
      // 预报补充（jishu / uapi / api_hezi）
      fetchNewSources(p.lat, p.lng, a?.city || '', a?.province || '', a?.district || '', false);
    });
    return cleanup;
  }, [position, address, fetchWeather, fetchNewSources]);

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

  // 气象预警（中央气象台 CMA）：adcode 就绪后立即拉取一次，随后按设置间隔轮询
  // adcode 取自 xzqhdm.qydm（区县级）；adcode / 间隔 / 开关变化时 effect 重新执行，
  // 因此「首次定位」「跨区移动」「面板里改间隔或重开开关」都会触发一次即时刷新
  useEffect(() => {
    if (!apiEnabled.cma || !isValidAdcode(cmaAdcode)) {
      // 关闭开关或 adcode 无效：清掉上一次的结果，避免展示过期的其它区县预警
      if (rawCmaAlarms.current.length) {
        rawCmaAlarms.current = [];
        setCmaAlarms([]);
      }
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const alarms = await fetchCmaAlarm(cmaAdcode);
      if (cancelled) return;
      setCmaAlarms(alarms);
      rawCmaAlarms.current = alarms;
      try { localStorage.setItem(`cached_cmaAlarms_${cmaAdcode}`, JSON.stringify(alarms)); } catch (_) { /* ignore */ }
      setApiRequestTimes(prev => ({ ...prev, cma: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
    };

    tick();
    const timer = setInterval(tick, cmaIntervalMin * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmaAdcode, cmaIntervalMin, apiEnabled.cma]);

  
  // 首次启动强制拉取所有 API（绕过 rate limit）
  // 用 localStorage 标记 "first_launch_done" 判断是否为首次
  useEffect(() => {
    if (!position || !address) return;

    const already = localStorage.getItem('first_launch_done');
    if (already) return; // 非首次，跳过

    const { lat, lng } = position;
    console.log('[FirstLaunch] Force-fetching all APIs');

    // 强制拉取实况（weather.com / jishu / msn + qweather 历史）
    fetchWeather(lat, lng, false, true);

    // 强制拉取 jishu 预报 / uapi / api_hezi
    fetchNewSources(lat, lng, address.city || '', address.province || '', address.district || '', false, true);

    // 标记首次完成（后续走正常 rate limit 流程）
    localStorage.setItem('first_launch_done', '1');
  }, [position, address, fetchWeather, fetchNewSources]);

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
        onTouchStart={debugOpen || apiPanelOpen ? undefined : handleTouchStart}
        onTouchMove={debugOpen || apiPanelOpen ? undefined : handleTouchMove}
        onTouchEnd={debugOpen || apiPanelOpen ? undefined : handleTouchEnd}>
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
        debugOpen={debugOpen}
        showPullDebug={showPullDebug}
        layoutCompact={layoutCompact}
        forecast24Style={forecast24Style}
        realtimeSource={realtimeSource}
        apiEnabled={apiEnabled}
        source24={source24}
        source15={source15}
        onGearToggle={() => setGearMenuOpen(!gearMenuOpen)}
        onSidebarOpen={() => setSidebarOpen(true)}
        onDebugToggle={() => { setDebugOpen(!debugOpen); if (!debugOpen) fetchDebugData(); }}
        onPullDebugToggle={() => setShowPullDebug(!showPullDebug)}
        onApiPanelOpen={() => setApiPanelOpen(true)}
        onLayoutCompactChange={setLayoutCompactCache}
        onForecast24StyleChange={setForecast24StyleCache}
        onRealtimeSourceChange={setRealtimeSourceCache}
        onSource24Change={setSource24Cache}
        onSource15Change={setSource15Cache}
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
              realtimeSource={realtimeSource}
              isDisabled={!apiEnabled.weather_com && !apiEnabled.jishu && !apiEnabled.msn}
              cmaAlarms={cmaAlarms}
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
              ) : debugSections ? (
                <div className="debug-sections">
                  {(debugSections as DebugSection[]).map((section, si) => {
                    const isOpen = (debugExpanded as Set<number>).has(si);
                    return (
                      <div key={si} className="debug-section">
                        <div className="debug-section-header" onClick={() => {
                          const next = new Set(debugExpanded as Set<number>);
                          if (next.has(si)) next.delete(si); else next.add(si);
                          setDebugExpanded(next);
                        }}>
                          <span className="debug-section-arrow">{isOpen ? '▾' : '▸'}</span>
                          <span className="debug-section-icon">{section.icon}</span>
                          <span className="debug-section-title">{section.title}</span>
                          <span className="debug-section-count">({section.items.length})</span>
                        </div>
                        {isOpen && (
                          <div className="debug-items">
                            {section.items.map((item, ii) => (
                              <div key={ii} className="debug-json-block">
                                {item.children ? (
                                  <>
                                    <div className="debug-json-key">
                                      <span>{item.key}</span>
                                      <button className="debug-copy-btn" onClick={() => copyToClipboard(item.key, item.children)}>
                                        {copiedKey === item.key ? '✓ 已复制' : '📋 复制'}
                                      </button>
                                    </div>
                                    <div className="debug-children">
                                      {item.children.map((c, ci) => (
                                        <div key={ci} className="debug-json-block debug-child-block">
                                          <div className="debug-json-key">
                                            <span>{c.key}</span>
                                            <button className="debug-copy-btn" onClick={() => copyToClipboard(c.key, c.value)}>
                                              {copiedKey === c.key ? '✓ 已复制' : '📋 复制'}
                                            </button>
                                          </div>
                                          <pre className="debug-json-value">{JSON.stringify(c.value, null, 2)}</pre>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="debug-json-key">
                                      <span>{item.key}</span>
                                      <button className="debug-copy-btn" onClick={() => copyToClipboard(item.key, item.value)}>
                                        {copiedKey === item.key ? '✓ 已复制' : '📋 复制'}
                                      </button>
                                    </div>
                                    <pre className="debug-json-value">{JSON.stringify(item.value, null, 2)}</pre>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : debugError ? (
                <div className="debug-json-blocks">
                  {Object.entries(debugError).map(([key, value]) => (
                    <div key={key} className="debug-json-block">
                      <div className="debug-json-key">
                        <span>{key}</span>
                        <button className="debug-copy-btn" onClick={() => copyToClipboard(key, value)}>📋 复制</button>
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
                    <span className="api-panel-item-cadence">
                      {key === 'cma' ? `🕐 自动 ${cmaIntervalMin} 分钟` : meta.cadence}
                    </span>
                    {key === 'cma' && (
                      <button className="api-panel-item-interval" onClick={() => cycleCmaInterval()}>
                        🔁 更新间隔：{cmaIntervalMin} 分钟（点击切换 {CMA_INTERVAL_OPTIONS.join(' / ')}）
                      </button>
                    )}
                    <span className="api-panel-item-time">上次请求: {apiRequestTimes[key] || '暂无'}</span>
                  </div>
                  <button
                    className={`api-panel-toggle${apiEnabled[key] ? ' on' : ' off'}`}
                    onClick={() => onApiToggle(key, !apiEnabled[key])}
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