// 天地图逆地理编码
//
// 请求门槛（最少 5 分钟一次 + 位移 200m）在 App.tsx 的 reverseGeocode 中判断，
// 本文件只负责发请求与解析返回值。

import type { AddressInfo } from '../types/location';
import { readJSON, writeJSON } from '../utils/cache';

export const TIANDITU_KEY = (import.meta as any).env?.VITE_TIANDITU_KEY || '';

// ===== 天地图请求门槛（API 管理中可开关）=====
/** 位移阈值：距上次请求超过该距离（米）才再次请求逆地理编码 */
export const TIANDITU_MIN_DISTANCE_M = 200;
/** 上次成功请求天地图的坐标（跨启动保留，位移判断依赖它） */
const TD_POS_KEY = 'cached_tianditu_pos';

export function loadTdPos(): { lat: number; lng: number } | null {
  const p = readJSON<{ lat: number; lng: number } | null>(TD_POS_KEY, null);
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' ? p : null;
}
export function saveTdPos(lat: number, lng: number): void {
  writeJSON(TD_POS_KEY, { lat, lng });
}

/** 天地图返回的地址组件（已补齐默认值，可直接用于 geocodeCache / xzqhdm 查询） */
export interface TiandituComponent {
  province: string;
  city: string;
  county: string;
  town: string;
  poi: string;
}

export interface TiandituResult {
  address: AddressInfo;
  component: TiandituComponent;
}

export async function fetchTiandituAddress(lat: number, lng: number): Promise<TiandituResult> {
  const postStr = `{'lon':${lng.toFixed(6)},'lat':${lat.toFixed(6)},'ver':1}`;
  const url = `https://api.tianditu.gov.cn/geocoder?postStr=${encodeURIComponent(postStr)}&type=geocode&tk=${TIANDITU_KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== '0') throw new Error(data.msg || `status=${data.status}`);
  const result = data.result;
  if (!result) throw new Error('No results');
  const raw = result.addressComponent || {};
  const component: TiandituComponent = {
    province: raw.province || '',
    city: raw.city || '',
    county: raw.county || '',
    town: raw.town || '',
    poi: raw.poi || '',
  };
  return {
    component,
    address: {
      province: component.province,
      city: component.city,
      district: component.county,
      full: result.formatted_address ||
        [component.province, component.city, component.county, component.town].filter(Boolean).join(''),
      poi: component.poi,
      poiDetail: component.poi
        ? `${component.poi}${raw.poi_position ? raw.poi_position + '方向' : ''}${raw.poi_distance ? '约' + raw.poi_distance + 'm' : ''}`
        : '',
    },
  };
}
