// MGC Weather Icons — colorfill 版本（简约 24 小时预报用）
// 与 weatherIcons.ts 保持同一套中文天气词 → 图标映射，仅把图标换成 fill 风格
// 额外提供"日出 / 日落"两个独立标记图标，供简约视图的日/夜分隔列使用

import sunny from './MGC_Weather_Icons/colorfill/01_sun_fill-1.svg';
import moonStars from './MGC_Weather_Icons/colorfill/02_moon_stars_fill-1.svg';
import cloud from './MGC_Weather_Icons/colorfill/03_cloud_fill-1.svg';
import sunCloudy from './MGC_Weather_Icons/colorfill/04_sun_cloudy_fill-1.svg';
import moonCloudy from './MGC_Weather_Icons/colorfill/05_moon_cloudy_fill-1.svg';
import cloudy from './MGC_Weather_Icons/colorfill/06_clouds_fill-1.svg';
import lightning from './MGC_Weather_Icons/colorfill/07_cloud_lightning_fill-1.svg';
import wet from './MGC_Weather_Icons/colorfill/08_wet_fill-1.svg';
import lightRain from './MGC_Weather_Icons/colorfill/09_drizzle_fill-1.svg';
import moderateRain from './MGC_Weather_Icons/colorfill/10_showers_fill-1.svg';
import heavyRain from './MGC_Weather_Icons/colorfill/11_heavy_rain_fill-1.svg';
import rainstorm from './MGC_Weather_Icons/colorfill/12_rainstom_fill-1.svg';
import heavyRainstorm from './MGC_Weather_Icons/colorfill/13_heavy_rainstom_fill-1.svg';
import thunderstorm from './MGC_Weather_Icons/colorfill/14_thunderstorm_fill-1.svg';
import fog from './MGC_Weather_Icons/colorfill/15_fog_fill-1.svg';
import hail from './MGC_Weather_Icons/colorfill/16_hail_fill-1.svg';
import lightSnow from './MGC_Weather_Icons/colorfill/17_light_sonw_fill-1.svg';
import moderateSnow from './MGC_Weather_Icons/colorfill/18_moderate_snow_fill-1.svg';
import heavySnow from './MGC_Weather_Icons/colorfill/19_heavy_snow_fill-1.svg';
import snowstorm from './MGC_Weather_Icons/colorfill/20_snowstorm_fill-1.svg';
import heavySnowstorm from './MGC_Weather_Icons/colorfill/21_heavy_snowstorm_fill-1.svg';
import snow from './MGC_Weather_Icons/colorfill/22_snow_fill-1.svg';
import windy from './MGC_Weather_Icons/colorfill/23_wind_fill-1.svg';
import blizzard from './MGC_Weather_Icons/colorfill/24_snowstorm_fill-1.svg';
import mist from './MGC_Weather_Icons/colorfill/25_sun_fog_fill-1.svg';
import haze from './MGC_Weather_Icons/colorfill/26_haze_fill-1.svg';
import typhoon from './MGC_Weather_Icons/colorfill/27_typhoon_fill-1.svg';
import na from './MGC_Weather_Icons/colorfill/28_na_fill-1.svg';
import sunriseIcon from './MGC_Weather_Icons/colorfill/29_sunrise_fill-1.svg';
import sunsetIcon from './MGC_Weather_Icons/colorfill/30_sunset_fill-1.svg';
import lowTemp from './MGC_Weather_Icons/colorfill/31_low_temperature_fill-1.svg';
import highTemp from './MGC_Weather_Icons/colorfill/32_high_temperature_fill-1.svg';
import sparkles from './MGC_Weather_Icons/colorfill/33_sparkles_fill-1.svg';
import fullMoon from './MGC_Weather_Icons/colorfill/34_full_moon_fill-1.svg';
import partlyCloudyDay from './MGC_Weather_Icons/colorfill/36_partly_cloud_daytime_fill-1.svg';
import partlyCloudyNight from './MGC_Weather_Icons/colorfill/35_partly_cloud_night_fill-1.svg';
import dry from './MGC_Weather_Icons/colorfill/37_dry_fill-1.svg';
import blowingSand from './MGC_Weather_Icons/colorfill/38_sandstorm_fill-1.svg';
import sandstorm from './MGC_Weather_Icons/colorfill/38_sandstorm_fill-1.svg';
import tornado from './MGC_Weather_Icons/colorfill/39_tornado_fill-1.svg';
import rainbow from './MGC_Weather_Icons/colorfill/40_rainbow_fill-1.svg';

export const WEATHER_ICON_MAP_SIMPLE: {
  phrases: string[];
  day: string;
  night: string;
}[] = [
    // ── 晴 / 月 ──
    { phrases: ['晴'], day: sunny, night: moonStars },
    { phrases: ['晴间多云', '晴转多云'], day: sunCloudy, night: moonCloudy },
    { phrases: ['少云'], day: partlyCloudyDay, night: partlyCloudyNight },
    { phrases: ['多云间晴'], day: partlyCloudyDay, night: partlyCloudyNight },
    { phrases: ['多云'], day: sunCloudy, night: moonCloudy },
    { phrases: ['阴', '阴天'], day: cloudy, night: cloud },

    // ── 雨 ──
    { phrases: ['小阵雨'], day: lightRain, night: lightRain },
    { phrases: ['小雨'], day: lightRain, night: lightRain },
    { phrases: ['小到中雨'], day: moderateRain, night: moderateRain },
    { phrases: ['中雨'], day: moderateRain, night: moderateRain },
    { phrases: ['阵雨'], day: lightRain, night: lightRain },
    { phrases: ['中到大雨'], day: heavyRain, night: heavyRain },
    { phrases: ['大雨'], day: heavyRain, night: heavyRain },
    { phrases: ['暴雨'], day: rainstorm, night: rainstorm },
    { phrases: ['大暴雨', '特大暴雨'], day: heavyRainstorm, night: heavyRainstorm },

    // ── 雷 / 电 ──
    { phrases: ['雷阵雨'], day: thunderstorm, night: thunderstorm },
    { phrases: ['雷电'], day: lightning, night: lightning },

    // ── 雪 ──
    { phrases: ['小雪', '小到中雪'], day: lightSnow, night: lightSnow },
    { phrases: ['中雪'], day: moderateSnow, night: moderateSnow },
    { phrases: ['中到大雪'], day: heavySnow, night: heavySnow },
    { phrases: ['大雪'], day: heavySnow, night: heavySnow },
    { phrases: ['暴雪'], day: heavySnowstorm, night: heavySnowstorm },
    { phrases: ['阵雪', '雪'], day: snow, night: snow },
    { phrases: ['冻雨'], day: heavyRain, night: heavyRain },

    // ── 冰雹 / 雨夹雪 ──
    { phrases: ['冰雹'], day: hail, night: hail },
    { phrases: ['雨夹雪'], day: snow, night: snow },

    // ── 雾 / 霾 / 尘 ──
    { phrases: ['浓雾', '特强浓雾'], day: fog, night: fog },
    { phrases: ['雾'], day: fog, night: fog },
    { phrases: ['霾'], day: haze, night: haze },
    { phrases: ['浮尘', '扬沙'], day: blowingSand, night: blowingSand },
    { phrases: ['沙尘暴', '强沙尘暴'], day: sandstorm, night: sandstorm },
    { phrases: ['雾转霾', '霾转雾'], day: haze, night: haze },

    // ── 风 / 台风 ──
    { phrases: ['台风'], day: typhoon, night: typhoon },
    { phrases: ['龙卷风'], day: tornado, night: tornado },
    { phrases: ['大风', '大风降温'], day: windy, night: windy },
    { phrases: ['暴风雪'], day: blizzard, night: blizzard },

    // ── 雪暴 ──
    { phrases: ['雪暴'], day: snowstorm, night: snowstorm },

    // ── 轻雾 ──
    { phrases: ['轻雾'], day: mist, night: mist },

    // ── 其他 ──
    { phrases: ['低温'], day: lowTemp, night: lowTemp },
    { phrases: ['高温'], day: highTemp, night: highTemp },
    { phrases: ['干燥'], day: dry, night: dry },
    { phrases: ['湿润', '潮湿'], day: wet, night: wet },
    { phrases: ['彩虹'], day: rainbow, night: rainbow },
    // 更长/更具体的关键词必须先匹配
    { phrases: ['日出_白线'], day: sunriseIcon, night: sunriseIcon },
    { phrases: ['日落_白线'], day: sunsetIcon, night: sunsetIcon },
    { phrases: ['日出'], day: sunriseIcon, night: sunriseIcon },
    { phrases: ['日落'], day: sunsetIcon, night: sunsetIcon },
    { phrases: ['闪耀'], day: sparkles, night: sparkles },
    { phrases: ['满月'], day: fullMoon, night: fullMoon },
];

/**
 * 简约视图用图标：返回色块填充风格的图标 URL
 * isNight 为 true 时返回夜间版本
 */
export function getWeatherIconUrlSimple(phrase: string, isNight: boolean): string {
  if (!phrase) return na;
  const p = phrase.toLowerCase();
  for (const entry of WEATHER_ICON_MAP_SIMPLE) {
    for (const kw of entry.phrases) {
      if (p.includes(kw.toLowerCase())) {
        return isNight ? entry.night : entry.day;
      }
    }
  }
  return na;
}

/**
 * 从时间字符串 "HH:MM" 解析出分钟数（0..1440）。
 * 供简约视图判断日出/日落落在哪个小时。
 */
export function parseTimeToMinutes(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export { sunriseIcon, sunsetIcon };
