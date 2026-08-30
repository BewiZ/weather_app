/**
 * 调试面板数据组装（从 App.tsx 的 fetchDebugData 抽出，零 React 依赖）
 *
 * 只负责发请求、读缓存、拼装 DebugSection[]；置 loading 态与 setDebugSections 仍由 App.tsx 负责。
 * 纯数据组装，无 UI。
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { fetchWeatherCom } from '../../api/weatherCom';
import { getLocationId, fetchQw } from '../../api/qweather';
import { loadTdPos, TIANDITU_MIN_DISTANCE_M } from '../../api/tianditu';
import { distanceMeters } from '../../utils/geo';
import { base64urlDecode, ymd, coordKeyOf } from '../../lib/weatherUtils';
import { checkLimit, getRateLimitInfo } from '../../utils/rateLimit';
import { persistRawNow, persistRawFc, persistRawYest, QW_EVER_CALLED_KEY } from '../../utils/cache';
import type { DebugItem, DebugSection } from '../../types/debug';
import type { AddressInfo } from '../../types/location';
import type { JiShuData, UApiResponse, ApiHeziResponse } from '../../types/weather';
import type { MsnData } from '../../api/msn';
import type { XzqhdmResponse } from '../../api/xzqhdm';
import type { CmaAlarm } from '../../api/cmaAlarm';

/** useRef 的结构类型：组件里 useRef 的值可直接传入 */
export interface MutableRef<T> {
  current: T;
}

/** buildDebugSections 需要的上下文（App.tsx 的 position / apiEnabled / address 与 raw* ref） */
export interface DebugContext {
  lat: number;
  lng: number;
  apiEnabled: Record<string, boolean>;
  address: AddressInfo | null;
  rawWeatherNow: MutableRef<Record<string, unknown> | null>;
  rawWeatherFc: MutableRef<Record<string, unknown> | null>;
  rawYesterday: MutableRef<Record<string, unknown> | null>;
  rawYesterdayDate: MutableRef<string>;
  rawJiShu: MutableRef<JiShuData | null>;
  rawMsn: MutableRef<MsnData | null>;
  rawUApi: MutableRef<UApiResponse | null>;
  rawApiHezi: MutableRef<ApiHeziResponse | null>;
  rawXzqhdm: MutableRef<XzqhdmResponse | null>;
  rawCmaAdcode: MutableRef<string>;
  rawCmaAlarms: MutableRef<CmaAlarm[]>;
}

/** 组装调试面板的四个一级目录：环境信息 / weather.com / QWeather·JWT / 其他数据源 */
export async function buildDebugSections(ctx: DebugContext): Promise<DebugSection[]> {
  const {
    lat, lng, apiEnabled, address,
    rawWeatherNow, rawWeatherFc, rawYesterday, rawYesterdayDate,
    rawJiShu, rawMsn, rawUApi, rawApiHezi, rawXzqhdm, rawCmaAdcode, rawCmaAlarms,
  } = ctx;

  const today = new Date();
  const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();
  const yesterday = new Date(todayY, todayM, todayD - 1);
  const ydStr = ymd(yesterday);
  const coordKey = coordKeyOf(lat, lng);
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

  // ── 和风天气状态（默认常闭）──
  // 常闭时调试面板不发送实时请求（/historical/weather 与 weather/now 鉴权测试），
  // 仅展示缓存返回值；在 API 管理中打开开关后调试面板恢复实时请求。
  const qwEnabled = !!apiEnabled.qweather;
  const qwEverCalledAt = localStorage.getItem(QW_EVER_CALLED_KEY);
  const histCacheKey = `yw_${ydStr}_${coordKey}`;
  const snapCacheKey = `ywtoday_${ydStr}_${coordKey}`;
  const histCacheRaw = localStorage.getItem(histCacheKey);
  const snapCacheRaw = localStorage.getItem(snapCacheKey);
  const latestSnapRaw = localStorage.getItem('cached_todaySnapshot');
  const yestSource = histCacheRaw
    ? `QWeather 历史缓存 ${histCacheKey}`
    : snapCacheRaw
      ? `本应用今日快照 ${snapCacheKey}`
      : (rawYesterdayDate.current === ydStr ? '主界面已解析' : '无缓存');
  let yestDesc = '未请求';

  // ── 天地图状态（最少 5 分钟 + 位移 200m）──
  const tdPos = loadTdPos();
  const tdDistM = tdPos ? distanceMeters(lat, lng, tdPos.lat, tdPos.lng) : null;
  const tdLimit = checkLimit('tianditu', 'auto');
  const tdInfo = getRateLimitInfo('tianditu');

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
        if (!qwEnabled) {
          // 和风天气常闭：调试面板也不发送实时请求，仅展示缓存
          return { cached: false, skipped: true, error: '和风天气已禁用，未发送请求', data: rawYesterday.current || {} };
        }
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
    );
    yestDesc = yestRes?.value?.cached
      ? '从主界面缓存读取'
      : yestRes?.value?.skipped
        ? '未请求（和风天气已禁用）'
        : yestRes?.value?.error || '实时请求完成';

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

      const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
      if (cachedGeo) {
        qwItems.push({ key: 'GeoAPI LocationID', value: cachedGeo });
        qwItems.push({ key: 'GeoAPI 说明', value: '来自缓存' });
      } else if (qwEnabled) {
        try {
          const id = await getLocationId(lat, lng, debugJwt);
          qwItems.push({ key: 'GeoAPI LocationID', value: id });
        } catch (e) { qwItems.push({ key: 'GeoAPI 错误', value: (e as Error).message }); }
      } else {
        qwItems.push({ key: 'GeoAPI LocationID', value: `无缓存（已跳过实时请求，键 geo_${coordKey}）` });
      }

      if (!qwEnabled) {
        qwItems.push({ key: 'QWeather 鉴权', value: '已跳过（和风天气常闭；在 API 管理中打开开关后实时验证）' });
      } else {
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
    );
    yestDesc = '从主界面缓存读取';
    const cachedGeo = localStorage.getItem(`geo_${coordKey}`);
    if (cachedGeo) qwItems.push({ key: 'GeoAPI LocationID', value: cachedGeo });
  }

  // ── 和风天气「昨日」返回值汇总（缓存 / 实时请求统一在此展示）──
  const parseSafe = (s: string | null): unknown => {
    if (!s) return null;
    try { return JSON.parse(s); } catch (_) { return `缓存损坏: ${s.slice(0, 60)}`; }
  };
  qwItems.push(
    { key: '和风配置', value: `启用=${qwEnabled ? '是' : '否（默认常闭）'} · 首次调用=${qwEverCalledAt ? new Date(Number(qwEverCalledAt)).toLocaleString('zh-CN') : '从未调用'} · 昨日数据源=${yestSource}` },
    { key: '昨日天气 /v7/historical/weather', children: [
      { key: '数据来源', value: yestDesc },
      { key: '查询日期', value: ydStr },
      { key: '原始数据', value: rawYesterday.current ? Object.assign({}, rawYesterday.current, { 查询日期: ydStr }) : `无（键 ${histCacheKey} / ${snapCacheKey} 均无缓存）` },
    ]},
    { key: 'QWeather 历史缓存（已解析）', value: histCacheRaw ? parseSafe(histCacheRaw) : `无（键 ${histCacheKey}）` },
    { key: 'QWeather 历史原始缓存', value: parseSafe(localStorage.getItem(`ywraw_${ydStr}_${coordKey}`)) ?? `无（键 ywraw_${ydStr}_${coordKey}）` },
    { key: '昨日今日快照缓存', value: snapCacheRaw ? parseSafe(snapCacheRaw) : `无（键 ${snapCacheKey}）` },
    { key: '最新今日快照', value: latestSnapRaw ? parseSafe(latestSnapRaw) : '无（实况数据到位后自动写入）' },
  );

  // ── Section 4: 其他数据源 ──
  otherItems.push({ key: '天地图 逆地理编码', children: [
    { key: '启用状态', value: apiEnabled.tianditu ? '是' : '否（不发送请求，保留缓存地址）' },
    { key: '位移门槛', value: tdDistM === null
      ? `无上次请求记录（门槛 ${TIANDITU_MIN_DISTANCE_M}m，下次必请求）`
      : `${tdDistM.toFixed(0)}m / ${TIANDITU_MIN_DISTANCE_M}m（${tdDistM >= TIANDITU_MIN_DISTANCE_M ? '已达阈值，将请求' : '未达阈值，跳过'}）` },
    { key: '上次请求坐标', value: tdPos ? `lat=${tdPos.lat.toFixed(6)}, lng=${tdPos.lng.toFixed(6)}` : '无' },
    { key: '5分钟间隔', value: tdLimit.allowed ? '已到期' : tdLimit.reason },
    { key: '今日请求次数', value: tdInfo.dailyCount },
    { key: '当前地址', value: address || '未解析' },
  ]});
  otherItems.push({ key: '极数本源 jiShu', value: rawJiShu.current || '尚未拉取' });
  otherItems.push({ key: 'MSN 中国版', value: rawMsn.current || '尚未拉取' });
  otherItems.push({ key: 'UApiPro', value: rawUApi.current || '尚未拉取' });
  otherItems.push({ key: '接口盒子 apiHezi', value: rawApiHezi.current || '尚未拉取' });
  otherItems.push({ key: '行政区划代码 xzqhdm', value: rawXzqhdm.current || '尚未查询' });
  otherItems.push({ key: 'CMA 预警 adcode', value: rawCmaAdcode.current || '尚未查询（qydm 需为区县级代码）' });
  otherItems.push({ key: '气象预警 CMA', value: rawCmaAlarms.current.length > 0 ? rawCmaAlarms.current : '当前无预警' });

  sections.push({ title: '其他数据源', icon: '📡', expanded: false, items: otherItems });

  return sections;
}
