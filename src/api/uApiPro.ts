import { UApiResponse } from '../types/weather';

const UAPI_BASE = 'https://uapis.cn/api/v1/misc/weather';
const UAPI_KEY = (import.meta as any).env?.VITE_UAPI_KEY || '';

/**
 * UApiPro：生活方式指数 + 18 项 + 小时/分钟预报
 * 主要用途：18 项生活方式指数（每小时更新）
 * 也可选拉 forecast / hourly / minutely
 *
 * 定位优先级：adcode（6 位国标行政区划代码，最精确，区县级）> city（城市名称）。
 * 服务端同样是 adcode 优先（同时传 city=上海 + adcode=110105 时返回北京朝阳区），
 * 客户端显式只发送其一，避免歧义。
 */
export async function fetchUApiPro(
  city: string,
  adcode?: string
): Promise<UApiResponse | null> {
  if (!UAPI_KEY) {
    console.warn('[uApiPro] VITE_UAPI_KEY not configured');
    return null;
  }

  // 定位参数优先级：adcode（6 位国标行政区划代码）> city（城市名称）。
  // 两者互斥发送，避免同时携带时服务端静默覆盖城市名带来的歧义；
  // 均缺省时不发送定位参数，交由服务端默认地区。
  const locationParam = adcode
    ? 'adcode=' + encodeURIComponent(adcode)
    : city
      ? 'city=' + encodeURIComponent(city)
      : null;

  const params: string[] = [
    ...(locationParam ? [locationParam] : []),
    'extended=true',
    'forecast=true',
    'hourly=true',
    'minutely=true',
    'indices=true',
    'lang=zh',
  ];

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
