// 定位相关类型（从 App.tsx 抽出）

export interface Position {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface AddressInfo {
  province: string;
  city: string;
  district: string;
  full: string;
  poi: string;
  poiDetail: string;
}

export type LocationMode = 'gps' | 'auto';
export type GeocodeEngine = 'tianditu' | 'nominatim';
