import { ApiHeziResponse } from '../types/weather';

const APIHEZI_BASE = 'https://cn.apihz.cn/api/tianqi/tqyb.php';
const APIHEZI_KEY = (import.meta as any).env?.VITE_APIHEZI_KEY || '';
const APIHEZI_ID = '10020053';

/**
 * 接口盒子：备用预警 + 日月时间
 * 单一接口同时返回 alarm（预警）和 suntimes（日月时间）
 *
 * @param sheng 省级，如 "浙江"
 * @param place 市级，如 "路桥"
 */
export async function fetchApiHezi(
  sheng: string,
  place: string
): Promise<ApiHeziResponse | null> {
  if (!APIHEZI_KEY) {
    console.warn('[apiHezi] VITE_APIHEZI_KEY not configured');
    return null;
  }

  const url = `${APIHEZI_BASE}?id=${APIHEZI_ID}&key=${APIHEZI_KEY}&sheng=${encodeURIComponent(sheng)}&place=${encodeURIComponent(place)}&day=1&hourtype=1&suntimetype=1`;
  const response = await fetchWithTimeout(url, 15000);
  if (!response.ok) {
    throw new Error(`[apiHezi] HTTP ${response.status}`);
  }
  return response.json();
}

export type { ApiHeziResponse, ApiHeziAlarm, ApiHeziSunTime, ApiHeziNowInfo } from '../types/weather';

// ============================================================
// Utility: fetch with timeout
// ============================================================

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ]);
}
