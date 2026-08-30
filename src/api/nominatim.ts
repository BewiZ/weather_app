// OSM Nominatim 逆地理编码（天地图不可用时的备用引擎）

import type { AddressInfo } from '../types/location';

export async function fetchNominatimAddress(lat: number, lng: number): Promise<AddressInfo> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&format=json&zoom=18&addressdetails=1&accept-language=zh-CN`;
  const res = await fetch(url, { headers: { 'User-Agent': 'LocateApp/1.0 (tauri-react-gps)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const addr = data.address || {};
  return {
    province: addr.province || addr.state || addr.region || '',
    city: addr.city || addr.town || addr.municipality || addr.county || '',
    district: addr.district || addr.suburb || addr.quarter || addr.neighbourhood || '',
    full: data.display_name || '',
    poi: '',
    poiDetail: '',
  };
}
