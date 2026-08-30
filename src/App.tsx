import { useState, useEffect, useCallback, useRef } from 'react';
import { getWeatherIconUrl, isNightTime } from './assets/weatherIcons';
import { getWeatherIconUrlSimple } from './assets/weatherIconsSimple';
import type { Forecast24Style } from './layers/WeatherDetail/hooks/Forecast24Hour';
import { usePullRefresh, LoaderDOM, refreshCompleteAnimation, holdLoaderAtReady } from './layers/TopMenuBar/hooks/usePullRefresh';
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
import { windDirToCardinal, windSpeedKmHToLevel, WEEK_CN, ymd, coordKeyOf, buildTodaySnapshot } from './lib/weatherUtils';
import { fetchWeatherCom } from './api/weatherCom';
import { getLocationId, fetchQw } from './api/qweather';
import './App.css';
import { checkLimit, recordFetch, scheduleClockAligned, isDryMinutelyPrecip, canLogRateLimit, getDailyRemaining } from './utils/rateLimit';
import type { RateLimitResult } from './utils/rateLimit';
import { fetchXzqhdm, type XzqhdmResponse } from './api/xzqhdm';
import { fetchCmaAlarm, isValidAdcode, type CmaAlarm } from './api/cmaAlarm';
import { loadTdPos, saveTdPos, fetchTiandituAddress, TIANDITU_MIN_DISTANCE_M } from './api/tianditu';
import { fetchNominatimAddress } from './api/nominatim';
import { distanceMeters } from './utils/geo';
import {
  cachedWeatherCurrent, cachedWeatherDays, cachedWeatherYesterday,
  cachedRawNow, cachedRawFc, cachedRawYest, cachedRawYestDate,
  cachedCmaAdcode, cachedCmaAlarms,
  persistRawNow, persistRawFc, persistRawYest,
  QW_EVER_CALLED_KEY,
} from './utils/cache';
import { REALTIME_SOURCES, API_META, loadApiEnabled, loadCmaIntervalMin } from './config/apiConfig';
import { buildWeatherCurrentFromWeatherCom, buildWeatherDaysFromWeatherCom } from './layers/WeatherRealtime/hooks/convertWeatherCom';
import { buildDebugSections } from './layers/DebugPanel/buildDebugSections';
import { DebugPanel } from './layers/DebugPanel/DebugPanel';
import { weatherTheme, accuracyLevel } from './lib/weatherTheme';
import type { DebugSection } from './types/debug';




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

    // ===== 天地图（API 管理）门槛 =====
    // 放在 setAddressLoading 之前：200m 内的 GPS 抖动不应反复进入加载态
    if (targetEngine === 'tianditu') {
      // 禁用时不发送请求，保留上次地址缓存（与「禁用 API 后显示缓存数据」一致）
      if (!apiEnabledRef.current.tianditu) {
        if (force) console.warn('[天地图] API 已禁用，跳过逆地理编码请求');
        return;
      }
      // 位移门槛：与上次成功请求的坐标比较
      const tdPos = loadTdPos();
      if (!force && tdPos) {
        const d = distanceMeters(lat, lng, tdPos.lat, tdPos.lng);
        if (d < TIANDITU_MIN_DISTANCE_M) {
          if (canLogRateLimit('tianditu')) {
            console.log(`[天地图] 位移 ${d.toFixed(0)}m < ${TIANDITU_MIN_DISTANCE_M}m，跳过`);
          }
          return;
        }
      }
      // 最小间隔（5 分钟，rate_limit_state 中 tianditu.lastAuto）
      if (!force) {
        const lim = checkLimit('tianditu', 'auto');
        if (!lim.allowed) {
          if (canLogRateLimit('tianditu')) console.log(`[RateLimit] tianditu: ${lim.reason}`);
          return;
        }
      }
    }

    setAddressLoading(true);
    try {
      if (targetEngine === 'tianditu') {
        const td = await fetchTiandituAddress(lat, lng);
        const addr = td.component;
        // 缓存天地图 city + county + town 用于天气页显示
        geocodeCache.current = {
          city: addr.city,
          county: addr.county,
          town: addr.town,
          lat,
          lng,
        };
        setAddress(td.address);
        setAddressError('');

        // 成功：刷新限流时间、位移基准、面板「上次请求」
        recordFetch('tianditu', 'auto');
        saveTdPos(lat, lng);
        setApiRequestTimes(prev => ({ ...prev, tianditu: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));

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

      setAddress(await fetchNominatimAddress(lat, lng));
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

  // 冷启动时从 localStorage 恢复上一次天气数据，避免白屏（见 utils/cache.ts）
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
    const wkMap = WEEK_CN;
    let rebuilt = false;

    if (realtimeSource === 'weather_com' && rawWeatherNow.current) {
      const cur = buildWeatherCurrentFromWeatherCom(rawWeatherNow.current);
      if (cur) {
        rebuilt = true;
        setWeatherCurrent(cur);
        // 7 天预报从 rawWeatherFc 重建
        setWeatherDays(buildWeatherDaysFromWeatherCom(rawWeatherFc.current, wkMap));
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
  // 默认值与「和风天气默认常闭」的一次性迁移见 config/apiConfig.ts
  const [apiEnabled, setApiEnabled] = useState<Record<string, boolean>>(loadApiEnabled);
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

  // reverseGeocode 在 GPS watch（deps 为空）的闭包里被调用，
  // apiEnabled 必须经 ref 读取，否则在 API 管理里开关天地图不会立即生效
  const apiEnabledRef = useRef(apiEnabled);
  apiEnabledRef.current = apiEnabled;

  // API 元信息（显示名 + 描述 + 刷新规则）见 config/apiConfig.ts

  // 气象预警轮询间隔（分钟）：只读配置，面板仅展示当前值，不再提供点击切换
  const [cmaIntervalMin] = useState<number>(loadCmaIntervalMin);

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

  // 「今日快照」持久化：和风天气常闭时，次日显示「昨日」直接读它，无需再请求
  // 按日期+坐标分键（ywtoday_YYYYMMDD_x,y），最新一份另存 cached_todaySnapshot 供调试面板查看
  useEffect(() => {
    if (!weatherCurrent || !position) return;
    try {
      const snap = buildTodaySnapshot(weatherCurrent, weatherDays, new Date());
      if (!snap) return;
      const ck = coordKeyOf(position.lat, position.lng);
      localStorage.setItem(`ywtoday_${snap.date}_${ck}`, JSON.stringify(snap));
      localStorage.setItem('cached_todaySnapshot', JSON.stringify({
        date: snap.date, coordKey: ck, lat: position.lat, lng: position.lng, data: snap,
      }));
    } catch (_) { /* ignore */ }
  }, [weatherCurrent, weatherDays, position]);

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
      const wkMap = WEEK_CN;
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
            if (isPrimary) {
              // 当前天气与 7 天预报的映射见 convertWeatherCom.ts
              setWeatherCurrent(buildWeatherCurrentFromWeatherCom(obs));

              // 仅主源控制显示：设置天气天数
              const fc = await fetchWeatherCom('forecast/daily/10day', lat, lng);
              rawWeatherFc.current = fc;
              persistRawFc(fc);
              setApiRequestTimes(prev => ({ ...prev, weather_com: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
              setWeatherDays(buildWeatherDaysFromWeatherCom(fc, wkMap));
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

      // ===== 昨日天气 =====
      // 和风天气默认常闭，解析顺序：
      //   1) QWeather 历史缓存 yw_<昨天>_<坐标>（此前启用过且拉取成功）
      //   2) 本应用「今日快照」缓存 ywtoday_<昨天>_<坐标>（昨日运行本应用时缓存的当日数据）
      //   3) 开关已开启 → 请求 /v7/historical/weather
      //   4) 从未请求过 → 首次使用请求一次（写 qw_ever_called），之后不再自动请求
      //   5) 其余情况跳过，不消耗和风配额
      const now = new Date();
      const ydStr = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      // 粗粒度坐标（整数度，与 GeoAPI 区级缓存一致）
      const coordKey = coordKeyOf(lat, lng);
      const cacheKey = `yw_${ydStr}_${coordKey}`;
      const histCache = localStorage.getItem(cacheKey);
      const snapCache = localStorage.getItem(`ywtoday_${ydStr}_${coordKey}`);
      // 是否允许请求和风：开关已开启，或本设备从未请求过（首次使用单次调用）
      const shouldCallQw = !!_enabled.qweather || !localStorage.getItem(QW_EVER_CALLED_KEY);
      if (histCache) {
        try {
          setWeatherYesterday(JSON.parse(histCache));
          // 调试面板需展示 /historical/weather 原始返回 JSON：从原始缓存读取（无则留空，由调试面板实时拉取）
          const rawCached = localStorage.getItem(`ywraw_${ydStr}_${coordKey}`);
          if (rawCached) {
            const _yFromCache = { 查询日期: ydStr, ...JSON.parse(rawCached) };
            rawYesterday.current = _yFromCache;
            rawYesterdayDate.current = ydStr;
            persistRawYest(_yFromCache, ydStr);
          }
        } catch (_) { /* 缓存损坏：留空，等下次请求刷新 */ }
      } else if (snapCache) {
        // 昨日 = 本应用缓存的「今日快照」，不请求和风天气
        try {
          const snap = JSON.parse(snapCache) as WeatherYesterday;
          setWeatherYesterday(snap);
          rawYesterday.current = {
            查询日期: ydStr,
            来源: '本应用今日快照缓存（未调用和风天气）',
            数据: snap,
          };
          rawYesterdayDate.current = ydStr;
          persistRawYest(rawYesterday.current, ydStr);
        } catch (_) { /* 缓存损坏：留空，等下次快照刷新 */ }
      } else if (!shouldCallQw) {
        // 和风天气常闭且此前已调用过一次：跳过请求，不消耗配额
      } else {
        // QWeather 时间机器（历史天气） — 首次使用 / 开关已开启
        let qwSkip = false;
        if (!force) {
          const _qwLim = checkLimit('qweather', _mode);
          if (!_qwLim.allowed) {
            if (canLogRateLimit('qweather')) console.log(`[RateLimit] qweather: ${_qwLim.reason}`);
            qwSkip = true;
          }
        }
        if (!qwSkip) {
          // 标记「已调用过」：无论成败，之后保持常闭不再自动请求（次日读今日快照）
          try { localStorage.setItem(QW_EVER_CALLED_KEY, String(Date.now())); } catch (_) { /* ignore */ }
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
    if (key === 'weather_com' || key === 'jishu' || key === 'msn' || key === 'qweather') {
      // 开关切换属于用户主动操作，使用 manual 模式（限流窗口更宽松）
      // 传入 next 作为 enabledOverride，绕过闭包捕获旧 apiEnabled 的延迟
      // 和风的「昨日天气」请求在 fetchWeather 内完成，因此归入此分支
      fetchWeather(lat, lng, true, false, next);
    } else if (key === 'uapi' || key === 'api_hezi') {
      fetchNewSources(lat, lng,
        (addressRef.current || address)?.city || '',
        (addressRef.current || address)?.province || '',
        (addressRef.current || address)?.district || '',
        true, false, next);
    } else if (key === 'tianditu') {
      // force=true：绕过 5 分钟间隔与 200m 位移门槛，立即重新解析地址
      void reverseGeocode(lat, lng, true, 'tianditu');
    }
  }, [position, address, addressRef, setApiEnabledCache, fetchWeather, fetchNewSources, reverseGeocode, apiEnabled]);

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
  // showPullDebug 必须进依赖：调试面板是条件渲染，挂载时机晚于首帧，
  // 首帧 effect 取到的 debugEl 恒为 null；开关变化后需重新取一次，
  // 否则面板永远收不到进度更新。
  useEffect(() => {
    loaderDOM.current = {
      loader: pullLoaderRef.current,
      ring: arrowRingRef.current,
      arcTrail: arcTrailRef.current,
      arrowHead: arrowHeadRef.current,
      circleFull: circleFullRef.current,
      debugEl: debugPullRef.current,
    };
  }, [showPullDebug]);

  function getMaxScroll() {
    const c = contentRef.current;
    const p = weatherPageRef.current;
    if (c && p) return Math.max(0, c.scrollHeight - p.clientHeight);
    return 0;
  }

  /**
   * 应用滚动状态（零 React 重渲染，直接操作 DOM transform，120Hz 触摸友好）。
   * 内容 1:1 跟随手指，可滚动范围由 getMaxScroll()（内容高度 − 视口高度）决定。
   */
  function applyScrollState() {
    const sy = pageScrollY.current;
    if (contentRef.current) {
      contentRef.current.style.transform = sy > 0 ? `translateY(${-sy}px)` : 'translateY(0)';
    }
  }

  // 滚动状态用 requestAnimationFrame 批处理：
  // handleTouchMove 每帧（120Hz）都被调用，若同步写入 DOM 会导致大量
  // transform 重排；RAF 保证每帧最多一次 applyScrollState，流畅度提升显著。
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
    if (contentRef.current) contentRef.current.style.transform = 'translateY(0)';
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
    // 钉住加载器在下落位：下拉触发时 handleTouchEnd 已写过，
    // 这里覆盖 F5 键盘等「无下拉直接刷新」的路径（原先靠 CSS `top: 22px !important` 硬补）
    holdLoaderAtReady(loaderDOM.current ?? ({} as LoaderDOM), showPullDebug);
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


      // 数据组装见 buildDebugSections（发请求 / 读缓存 / 拼一级目录）
      const sections = await buildDebugSections({
        lat: position.lat, lng: position.lng,
        apiEnabled, address,
        rawWeatherNow, rawWeatherFc, rawYesterday, rawYesterdayDate,
        rawJiShu, rawMsn, rawUApi, rawApiHezi, rawXzqhdm,
        rawCmaAdcode, rawCmaAlarms,
      });
      setDebugSections(sections);
      // 默认全部展开：和风天气「昨日」返回值与天地图状态需要直接可见
      setDebugExpanded(new Set(sections.map((_, i) => i)));
    } catch (e) {
      setDebugError({ 错误: (e as Error).message, stack: (e as Error).stack });
    } finally {
      setDebugLoading(false);
    }
  }, [position, apiEnabled, address]);


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

  // GPS 精度分级与天气背景主题见 lib/weatherTheme.ts
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
  const theme = weatherTheme(weatherCurrent);
  return (
    <div className="weather-page" ref={weatherPageRef}
        style={{ background: theme.background, touchAction: 'none' }}
        data-scheme={theme.scheme || 'light'}
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
          <span>下落: 0px | A 增长 | 进度: 0% | 弧: 0° | α: 0.40 | 旋转: 0°</span>
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
          <div className="weather-content">
            <WeatherRealtime
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
            />
          </div>
        </div>
      )}
      </div>
      {renderSidebar()}

      {debugOpen && (
        <DebugPanel
          loading={debugLoading}
          sections={debugSections}
          expanded={debugExpanded}
          error={debugError}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
          onToggle={(i) => {
            const next = new Set(debugExpanded);
            if (next.has(i)) next.delete(i); else next.add(i);
            setDebugExpanded(next);
          }}
          onClose={() => setDebugOpen(false)}
        />
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