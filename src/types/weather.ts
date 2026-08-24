// ============================================================
// 极数本源 jiShu — https://v1.apizero.cn/api/weather
// ============================================================

export interface JiShuWind {
  speed_ms: number;
  direction_deg: number;
  direction_text: string;
  level: number;
  level_text: string;
}

export interface JiShuAirQualitySummary {
  aqi: number;
  level: string;
  level_color: string;
  pm25: number;
}

export interface JiShuSummary {
  city: string | null;
  skycon: string;
  skycon_emoji: string;
  skycon_code: string;
  temperature: number;
  apparent_temperature: number;
  humidity_percent: number;
  cloudrate_percent: number;
  visibility_km: number;
  wind: JiShuWind;
  air_quality: JiShuAirQualitySummary;
  alert_count: number;
}

export interface JiShuAlert {
  title: string;
  description: string;
  color: string;
  level: string;
  status: string;
  province: string;
  city: string;
  county: string;
  pub_time: string;
  source: string;
  alert_id: string;
}

export interface JiShuPrecipitationLocal {
  status: string;
  datasource: string;
  intensity: number;
}

export interface JiShuPrecipitationNearest {
  status: string;
  distance: number;
  intensity: number;
}

export interface JiShuRealtime {
  status: string;
  temperature: number;
  humidity: number;       // 0-1
  cloudrate: number;     // 0-1
  skycon: string;        // e.g. "PARTLY_CLOUDY_DAY"
  visibility: number;
  dswrf: number;
  wind: { speed: number; direction: number };
  pressure: number;      // Pa
  apparent_temperature: number;
  precipitation: {
    local: JiShuPrecipitationLocal;
    nearest: JiShuPrecipitationNearest;
  };
  air_quality: {
    pm25: number;
    pm10: number;
    o3: number;
    so2: number;
    no2: number;
    co: number;
    aqi: { chn: number; usa: number };
    description: { chn: string; usa: string };
  };
  life_index: {
    ultraviolet: { index: number; desc: string };
    comfort: { index: number; desc: string };
  };
}

export interface JiShuMinutely {
  status: string;
  datasource: string;
  precipitation_2h: number[];   // 120 items (4h × 2min)
  precipitation: number[];      // 60 items (2h × 2min)
  accumulation: number[];       // 2 items
  probability: number[];        // 4 items
  description: string;
}

export interface JiShuHourlyItem {
  datetime: string;
  value: number;
  probability?: number;
}

export interface JiShuHourlyItem2 {
  datetime: string;
  value: number;
}

// skycon 代码为字符串枚举（CLEAR_DAY / PARTLY_CLOUDY_NIGHT …），非数值，单独定义
export interface JiShuHourlySkyconItem {
  datetime: string;
  value: string;
}

export interface JiShuHourly {
  status: string;
  description: string;
  precipitation: JiShuHourlyItem[];
  temperature: JiShuHourlyItem2[];
  apparent_temperature: JiShuHourlyItem2[];
  wind: JiShuHourlyItem2[];
  humidity: JiShuHourlyItem2[];
  cloudrate: JiShuHourlyItem2[];
  skycon: JiShuHourlySkyconItem[];
  pressure: JiShuHourlyItem2[];
  visibility: JiShuHourlyItem2[];
}

// 15 天预报：daily 对象，每个字段是长度为 15 的对象数组
// 实际结构：daily.temperature[i] = { date, max, min, avg }
//           daily.wind[i]       = { date, max:{speed,direction}, min:{...}, avg:{...} }
export interface JiShuDailyItem {
  date: string;
  max: number;
  min: number;
  avg: number;
}

export interface JiShuDailyWindSub {
  speed: number;
  direction: number;
}

export interface JiShuDailyWindItem {
  date: string;
  max: JiShuDailyWindSub;
  min: JiShuDailyWindSub;
  avg: JiShuDailyWindSub;
}

export interface JiShuDailyPrecipItem {
  date: string;
  max: number;
  min: number;
  avg: number;
  probability: number;
}

export interface JiShuDailyAqiSub {
  chn: number;
  usa: number;
}

export interface JiShuDailyAqiItem {
  date: string;
  max: JiShuDailyAqiSub;
  avg: JiShuDailyAqiSub;
  min: JiShuDailyAqiSub;
}

export interface JiShuDailyAstroItem {
  date: string;
  sunrise: { time: string };
  sunset: { time: string };
}

export interface JiShuDailySkyconItem {
  date: string;
  value: string;
}

export interface JiShuDaily {
  status?: string;
  temperature?: JiShuDailyItem[];
  precipitation?: JiShuDailyPrecipItem[];
  wind?: JiShuDailyWindItem[];
  humidity?: JiShuDailyItem[];
  cloudrate?: JiShuDailyItem[];
  pressure?: JiShuDailyItem[];
  visibility?: JiShuDailyItem[];
  dswrf?: JiShuDailyItem[];
  air_quality?: { aqi?: JiShuDailyAqiItem[] };
  astro?: JiShuDailyAstroItem[];
  // 全天天气（对象数组，value 为 skycon 代码）
  skycon?: JiShuDailySkyconItem[];
  // 白天 08h-20h / 夜间 20h-32h 分时段
  skycon_08h_20h?: JiShuDailySkyconItem[];
  skycon_20h_32h?: JiShuDailySkyconItem[];
  temperature_08h_20h?: JiShuDailyItem[];
  temperature_20h_32h?: JiShuDailyItem[];
  precipitation_08h_20h?: JiShuDailyPrecipItem[];
  precipitation_20h_32h?: JiShuDailyPrecipItem[];
  wind_08h_20h?: JiShuDailyWindItem[];
  wind_20h_32h?: JiShuDailyWindItem[];
  // 兼容旧结构（简单数组，实测接口不返回）
  date?: string[];
}

export interface JiShuLocation {
  city: string | null;
  longitude: number;
  latitude: number;
  timezone: string;
}

export interface JiShuData {
  type?: string;
  location?: JiShuLocation;
  server_time?: string;
  forecast_keypoint?: string;
  summary?: JiShuSummary;
  alerts?: JiShuAlert[];
  realtime?: JiShuRealtime;
  minutely?: JiShuMinutely;
  hourly?: JiShuHourly;
  daily?: JiShuDaily;
}

export interface JiShuResponse {
  code: number;
  msg: string;
  data: JiShuData;
  tips: string;
  request_id: string;
}

// ============================================================
// UApiPro — https://uapis.cn/api/v1/misc/weather
// ============================================================

export interface UApiAlert {
  title: string;
  type: string;
  level: string;
  text: string;
  publish_time: string;
  publisher: string;
  guidance: string[];
}

export interface UApiForecastDay {
  date: string;
  week: string;
  temp_max: number;
  temp_min: number;
  weather_day: string;
  weather_night: string;
  wind_dir_day: string;
  wind_dir_night: string;
  wind_scale_day: string;
  wind_scale_night: string;
  wind_speed_day: string;
  humidity: string;
  precip: string;
  visibility: string;
  uv_index: string;
  sunrise: string;
  sunset: string;
}

export interface UApiHourlyItem {
  time: string;
  temperature: number;
  weather: string;
  wind_direction: string;
  wind_speed: string;
  wind_scale: string;
  humidity: number;
  precip: number;
  feels_like: number;
  visibility: number;
  pop: number;
  uv_index: number;
}

export interface UApiMinuteItem {
  time: string;
  precip: number;
  type: string;
}

export interface UApiLifeIndex {
  level: string;
  brief: string;
  advice: string;
}

export interface UApiResponse {
  province: string;
  city: string;
  district: string;
  adcode: string;
  weather: string;
  weather_icon: string;
  temperature: number;
  wind_direction: string;
  wind_power: string;
  humidity: number;
  report_time: string;
  // extended
  feels_like?: number;
  visibility?: number;
  pressure?: number;
  uv?: number;
  precipitation?: number;
  cloud?: number;
  aqi?: number;
  aqi_level?: string;
  aqi_category?: string;
  aqi_primary?: string;
  air_pollutants?: {
    pm25: number;
    pm10: number;
    o3: number;
    no2: number;
    so2: number;
    co: number;
  };
  alerts?: UApiAlert[];
  forecast?: UApiForecastDay[];
  hourly_forecast?: UApiHourlyItem[];
  minutely_precip?: {
    summary: string;
    update_time: string;
    data: UApiMinuteItem[];
  };
  life_indices?: {
    clothing: UApiLifeIndex;
    uv: UApiLifeIndex;
    car_wash: UApiLifeIndex;
    drying: UApiLifeIndex;
    air_conditioner: UApiLifeIndex;
    cold_risk: UApiLifeIndex;
    exercise: UApiLifeIndex;
    comfort: UApiLifeIndex;
    travel: UApiLifeIndex;
    fishing: UApiLifeIndex;
    allergy: UApiLifeIndex;
    sunscreen: UApiLifeIndex;
    mood: UApiLifeIndex;
    beer: UApiLifeIndex;
    umbrella: UApiLifeIndex;
    traffic: UApiLifeIndex;
    air_purifier: UApiLifeIndex;
    pollen: UApiLifeIndex;
  };
}

// ============================================================
// 接口盒子 — https://cn.apihz.cn/api/tianqi/tqyb.php
// ============================================================

export interface ApiHeziNowInfo {
  precipitation: number;
  temperature: number;
  pressure: number;
  humidity: number;
  windDirection: string;
  windDirectionDegree: number;
  windSpeed: number;
  windScale: string;
  feelst: number;
  uptime: string;
}

export interface ApiHeziAlarm {
  id: string;
  title: string;
  signaltype: string;
  signallevel: string;
  effective: string;
  eventType: string;
  severity: string;
  type: string;
}

export interface ApiHeziHourItem {
  时间: string;
  天气: string;
  图标: string;
  气温: string;
  降水: string;
  风速: string;
  风向: string;
  气压: string;
  湿度: string;
  云量: string;
}

export interface ApiHeziSunTime {
  date: string;
  date_formatted: string;
  weekday: string;
  weekday_short: string;
  weekday_cn: string;
  weekday_short_cn: string;
  civil_twilight_begin: string;
  sunrise: string;
  transit: string;
  sunset: string;
  civil_twilight_end: string;
  astronomical_twilight_begin: string;
  nautical_twilight_begin: string;
  nautical_twilight_end: string;
  astronomical_twilight_end: string;
  day_length_seconds: number;
  night_length_seconds: number;
  night_length_accurate_seconds: number;
  twilight_morning_seconds: number;
  twilight_evening_seconds: number;
  daylight_duration_seconds: number;
  day_length: string;
  night_length: string;
  night_length_accurate: string;
  twilight_morning: string;
  twilight_evening: string;
  daylight_duration: string;
  day_percentage: number;
  night_percentage: number;
}

export interface ApiHeziResponse {
  code: number;
  guo: string;
  sheng: string;
  shi: string;
  name: string;
  weather1: string;
  weather2: string;
  wd1: string;
  wd2: string;
  winddirection1: string;
  winddirection2: string;
  windleve1: string;
  windleve2: string;
  weather1img: string;
  weather2img: string;
  lon: string;
  lat: string;
  uptime: string;
  nowinfo: ApiHeziNowInfo;
  alarm: ApiHeziAlarm[];
  hourtime: string;
  hour1: ApiHeziHourItem[];
  suntimes: ApiHeziSunTime[];
}

// ============================================================
// 统一预警格式（归一化三种来源）
// ============================================================

export interface UnifiedAlert {
  source: 'jishu' | 'uapi' | 'apihezi';
  id: string;
  title: string;
  description: string;
  color: string;
  level: string;
  status: string;
  province: string;
  city: string;
  county: string;
  pub_time: string;
}

// ============================================================
// 本地天气数据模型（从 App.tsx 抽出，供 UI 层使用）
// ============================================================

export interface WeatherCurrent {
  temperature: number;
  phrase: string;
  temperatureHeatIndex: number;
  relativeHumidity: number;
  windSpeed: number;
  windDirectionCardinal: string;
  windDirectionDegrees: number;
  uvIndex: number;
  pressure: number;
  pressTendencyCode: number;
  visibility: number;
  sunrise: string;
  sunset: string;
  obsQualifierPhrase: string;
  obsTimeLocal?: string;
  observationTime?: string;
}

export interface WeatherDay {
  date: string;
  dayOfWeek: string;
  calendarDayTemperatureMax: number;
  calendarDayTemperatureMin: number;
  narrative: string;
}

export interface WeatherYesterday {
  date: string;
  dayOfWeek: string;
  tempMax: number;
  tempMin: number;
  textDay: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: number;
}
