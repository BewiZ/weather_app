import { JiShuResponse, JiShuData } from '../types/weather';

const JISHU_BASE = 'https://v1.apizero.cn/api/weather';
const JISHU_KEY = (import.meta as any).env?.VITE_JISHU_KEY || '';

/**
 * 极数本源：单次请求拉取全量数据
 * 包含实况、分钟级降水、小时预报、15 天预报、预警、空气质量
 */
export async function fetchJiShu(
  lat: number,
  lng: number,
  days = 15,
  hours = 24
): Promise<JiShuData | null> {
  if (!JISHU_KEY) {
    console.warn('[jiShu] VITE_JISHU_KEY not configured');
    return null;
  }
  const url = `${JISHU_BASE}?location=${lng},${lat}&key=${JISHU_KEY}&alert=true&days=${days}&hours=${hours}`;
  const response = await fetchWithTimeout(url, 15000);
  if (!response.ok) {
    throw new Error(`[jiShu] HTTP ${response.status}`);
  }
  const json: JiShuResponse = await response.json();
  if (json.code !== 0) {
    throw new Error(`[jiShu] API error: ${json.msg}`);
  }
  return json.data;
}

export type { JiShuData, JiShuAlert, JiShuRealtime, JiShuMinutely, JiShuHourly, JiShuDaily } from '../types/weather';

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
