import { UApiResponse } from '../types/weather';

const UAPI_BASE = 'https://uapis.cn/api/v1/misc/weather';
const UAPI_KEY = (import.meta as any).env?.VITE_UAPI_KEY || '';

/**
 * UApiPro：生活方式指数 + 18 项 + 小时/分钟预报
 * 主要用途：18 项生活方式指数（每小时更新）
 * 也可选拉 forecast / hourly / minutely
 */
export async function fetchUApiPro(
  city: string,
  adcode?: string
): Promise<UApiResponse | null> {
  if (!UAPI_KEY) {
    console.warn('[uApiPro] VITE_UAPI_KEY not configured');
    return null;
  }

  const params: string[] = [
    'city=' + encodeURIComponent(city),
    'extended=true',
    'forecast=true',
    'hourly=true',
    'minutely=true',
    'indices=true',
    'lang=zh',
  ];
  if (adcode) {
    params.push('adcode=' + encodeURIComponent(adcode));
  }

  const url = `${UAPI_BASE}?${params.join('&')}`;
  const response = await fetchWithTimeout(url, 15000, {
    headers: {
      'Authorization': `Bearer ${UAPI_KEY}`,
    },
  });
  if (!response.ok) {
    throw new Error(`[uApiPro] HTTP ${response.status}`);
  }
  return response.json();
}

export type { UApiResponse, UApiLifeIndex, UApiForecastDay, UApiHourlyItem, UApiAlert } from '../types/weather';

// ============================================================
// Utility: fetch with timeout
// ============================================================

function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  opts?: RequestInit
): Promise<Response> {
  return Promise.race([
    fetch(url, opts),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ]);
}
