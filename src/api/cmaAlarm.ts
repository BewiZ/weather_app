/**
 * 中央气象台气象预警（CMA map alarm）
 *
 * 端点: https://weather.cma.cn/api/map/alarm?adcode={行政区划代码}
 * 参数: adcode — 6 位国标行政区划代码（xzqhdm 接口的 qydm 字段，如 331004 = 台州市路桥区）
 *
 * 返回（JSON）:
 *   { msg: "success", code: 0,
 *     data: [
 *       { id, headline, effective, description, longitude, latitude, type, title }
 *     ] }
 *
 * 实测结论（2026-08-28）：
 *   - 该端点返回 Access-Control-Allow-Origin: *，可直接用浏览器 fetch（无需 Rust 原生回退）。
 *   - adcode 必须是区县级代码。市级代码（末两位为 00，如 331000）返回空数组，
 *     因此本模块对 `xxx00` 形式的代码直接短路，不发起请求。
 *
 * 由 App.tsx 每 12 分钟轮询一次；结果持久化到 localStorage 供冷启动展示。
 */

export interface CmaAlarm {
  /** 唯一标识，如 "33100441600000_20260828154218" */
  id: string;
  /** 完整标题，含等级括号，如 "台州市路桥区气象台发布台风黄色预警[Ⅲ级/较重]" */
  headline: string;
  /** 生效时间，如 "2026/08/28 15:40" */
  effective: string;
  /** 预警描述正文 */
  description: string;
  longitude: number;
  latitude: number;
  /** CMA 预警类型编码，如 "p0001003" */
  type: string;
  /** 简短名称，如 "浙江省台州市路桥区发布台风黄色预警" */
  title: string;
}

export interface CmaAlarmResponse {
  msg: string;
  code: number;
  data: CmaAlarm[];
}

const CMA_ALARM_BASE = 'https://weather.cma.cn/api/map/alarm';
const FETCH_TIMEOUT_MS = 12000;

/** adcode 校验：6 位数字，且非市级代码（末两位为 00） */
export function isValidAdcode(adcode: string | null | undefined): boolean {
  if (!adcode) return false;
  return /^\d{6}$/.test(adcode) && !adcode.endsWith('00');
}

/**
 * 拉取指定行政区划当前生效的气象预警。
 *
 * @param adcode 6 位区县级行政区划代码（如 331004）
 * @returns 预警数组；无预警、adcode 非法或请求失败时返回空数组（不抛错，避免打断轮询）
 */
export async function fetchCmaAlarm(adcode: string): Promise<CmaAlarm[]> {
  if (!isValidAdcode(adcode)) return [];

  const url = `${CMA_ALARM_BASE}?adcode=${encodeURIComponent(adcode)}`;
  let res: Response;
  try {
    res = await Promise.race([
      fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0' } }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`CMA alarm 请求超时 (${FETCH_TIMEOUT_MS}ms)`)), FETCH_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.warn('[cmaAlarm] fetch failed:', (e as Error).message);
    return [];
  }

  if (!res.ok) {
    console.warn(`[cmaAlarm] HTTP ${res.status}`);
    return [];
  }

  try {
    const body = (await res.json()) as CmaAlarmResponse;
    if (!body || body.code !== 0 || !Array.isArray(body.data)) {
      console.warn(`[cmaAlarm] unexpected response: ${body?.msg || body?.code}`);
      return [];
    }
    return body.data;
  } catch (e) {
    console.warn('[cmaAlarm] json parse failed:', (e as Error).message);
    return [];
  }
}
