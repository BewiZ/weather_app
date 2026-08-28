/**
 * 行政区划代码查询（接口盒子 xzqhdm）
 *
 * 根据省份名称和地点（城市/区县）查询行政区划代码。
 *
 * 端点: https://cn.apihz.cn/api/other/xzqhdm.php
 * 参数: id=10020053&key=KEY&sheng=浙江&place=江北
 *
 * 返回（JSON）:
 *   { code: 200, dqdm: "101210409", qydm: "330205",
 *     province: "浙江省", city: "宁波市", district: "江北区",
 *     lon: "121.5", lat: "29.8" }
 *
 * 在 App.tsx 的 reverseGeocode（天地图）成功后调用，
 * 将结果保存到 rawXzqhdm ref，并在调试面板中显示。
 */

const XZQHDM_BASE = 'https://cn.apihz.cn/api/other/xzqhdm.php';
const XZQHDM_KEY = (import.meta as any).env?.VITE_APIHEZI_KEY || '';
const XZQHDM_ID = '10020053';

export interface XzqhdmResponse {
  code: number;
  /** 地区代码 */
  dqdm: string;
  /** 区域代码 */
  qydm: string;
  /** 省 */
  province: string;
  /** 市 */
  city: string;
  /** 区县 */
  district: string;
  /** 经度 */
  lon: string;
  /** 纬度 */
  lat: string;
}

export async function fetchXzqhdm(
  sheng: string,
  place: string,
): Promise<XzqhdmResponse | null> {
  if (!XZQHDM_KEY) {
    console.warn('[xzqhdm] VITE_APIHEZI_KEY not configured');
    return null;
  }
  if (!sheng || !place) return null;

  const url = `${XZQHDM_BASE}?id=${XZQHDM_ID}&key=${XZQHDM_KEY}&sheng=${encodeURIComponent(sheng)}&place=${encodeURIComponent(place)}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0' } });
  if (!response.ok) {
    throw new Error(`[xzqhdm] HTTP ${response.status}`);
  }
  return response.json();
}
