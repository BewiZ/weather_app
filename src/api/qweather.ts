// --- QWeather JS fetch (仅历史天气) ---
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export const QW_BASE = 'https://mc57rkjak5.re.qweatherapi.com/v7';
export const QW_GEO_BASE = 'https://mc57rkjak5.re.qweatherapi.com/geo';

// 缓存 LocationID（localStorage，按整数经纬度粗粒度区分区级）
let locationIdCacheData: { key: string; id: string; lat: number; lng: number } | null = null;

export async function getLocationId(lat: number, lng: number, jwt?: string): Promise<string> {
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

export async function fetchQw(path: string, location: string, extra: string, jwt?: string): Promise<Record<string, unknown>> {
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
