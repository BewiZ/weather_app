// MGC Weather Icons — 40 个 SVG 图标 + 中文天气词映射
// Vite 默认将 .svg import 为 URL 字符串，通过 <img src={...}> 渲染

import sunny from './MGC_Weather_Icons/color/01_sunny_color.svg';
import moonStars from './MGC_Weather_Icons/color/02_moon_stars_color.svg';
import cloud from './MGC_Weather_Icons/color/03_cloud_color.svg';
import sunCloudy from './MGC_Weather_Icons/color/04_sun_cloudy_color.svg';
import moonCloudy from './MGC_Weather_Icons/color/05_moon_cloudy_color.svg';
import cloudy from './MGC_Weather_Icons/color/06_cloudy_color.svg';
import lightning from './MGC_Weather_Icons/color/07_lightning_color.svg';
import wet from './MGC_Weather_Icons/color/08_wet_color.svg';
import lightRain from './MGC_Weather_Icons/color/09_light_rain_color.svg';
import moderateRain from './MGC_Weather_Icons/color/10_moderate_rain_color.svg';
import heavyRain from './MGC_Weather_Icons/color/11_heavy_rain_color.svg';
import rainstorm from './MGC_Weather_Icons/color/12_rainstorm_color.svg';
import heavyRainstorm from './MGC_Weather_Icons/color/13_heavy_rainstorm_color.svg';
import thunderstorm from './MGC_Weather_Icons/color/14_thunderstorm_color.svg';
import fog from './MGC_Weather_Icons/color/15_fog_color.svg';
import hail from './MGC_Weather_Icons/color/16_hail_color.svg';
import lightSnow from './MGC_Weather_Icons/color/17_light_sonw_color.svg';
import moderateSnow from './MGC_Weather_Icons/color/18_moderate_snow_color.svg';
import heavySnow from './MGC_Weather_Icons/color/19_heavy_snow_color.svg';
import snowstorm from './MGC_Weather_Icons/color/20_snowstorm_color.svg';
import heavySnowstorm from './MGC_Weather_Icons/color/21_heavy_snowstorm_color.svg';
import snow from './MGC_Weather_Icons/color/22_snow_color.svg';
import windy from './MGC_Weather_Icons/color/23_windy_color.svg';
import blizzard from './MGC_Weather_Icons/color/24_blizzard_color.svg';
import mist from './MGC_Weather_Icons/color/25_mist_color.svg';
import haze from './MGC_Weather_Icons/color/26_haze_color.svg';
import typhoon from './MGC_Weather_Icons/color/27_typhoon_color.svg';
import na from './MGC_Weather_Icons/color/28_NA_color.svg';
import sunrise from './MGC_Weather_Icons/color/29_sunrise_color.svg';
import sunset from './MGC_Weather_Icons/color/30_sunset_color.svg';
import lowTemp from './MGC_Weather_Icons/color/31_low_temperature_color.svg';
import highTemp from './MGC_Weather_Icons/color/32_high_temperature_color.svg';
import sparkles from './MGC_Weather_Icons/color/33_sparkles_color.svg';
import fullMoon from './MGC_Weather_Icons/color/34_full_moon_color.svg';
import partlyCloudyDay from './MGC_Weather_Icons/color/35_partly_cloudy_daytime_color.svg';
import partlyCloudyNight from './MGC_Weather_Icons/color/36_partly_cloudy_night_color.svg';
import dry from './MGC_Weather_Icons/color/37_dry_color.svg';
import blowingSand from './MGC_Weather_Icons/color/38_blowing_sand_color.svg';
import sandstorm from './MGC_Weather_Icons/color/39_sandstorm_color.svg';
import rainbow from './MGC_Weather_Icons/color/40_rainbow_color.svg';

import sunrise_white_line from './MGC_Weather_Icons/whiteline/29_sunrise_line.svg';
import sunset_white_line from './MGC_Weather_Icons/whiteline/30_sunset_line.svg';
// 天气词 → 白天图标 URL / 夜间图标 URL
// 匹配优先级：精确关键词优先（列表前半段先匹配）
export const WEATHER_ICON_MAP: {
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
    // 注意：更长/更具体的关键词（含"日出"/"日落"子串）必须排在
    // 裸"日出"/"日落"之前，否则 includes 子串匹配会先命中后者、返回彩色图标
    { phrases: ['日出_白线'], day: sunrise_white_line, night: sunrise_white_line },
    { phrases: ['日落_白线'], day: sunset_white_line, night: sunset_white_line },
    { phrases: ['日出'], day: sunrise, night: sunrise },
    { phrases: ['日落'], day: sunset, night: sunset },
    { phrases: ['闪耀', '闪耀'], day: sparkles, night: sparkles },
    { phrases: ['满月'], day: fullMoon, night: fullMoon },
  ];

// 匹配函数：返回图标 URL
// isNight 为 true 时返回夜间版本（月亮/星空图标）
export function getWeatherIconUrl(phrase: string, isNight: boolean): string {
  if (!phrase) return na;
  const p = phrase.toLowerCase();
  for (const entry of WEATHER_ICON_MAP) {
    for (const kw of entry.phrases) {
      if (p.includes(kw.toLowerCase())) {
        return isNight ? entry.night : entry.day;
      }
    }
  }
  return na; // 兜底：28_NA
}

// 判断是否夜间
// 夜间范围：18:30–06:30（含 18:30，不含 06:30）
// 即 06:30~18:29 为白天，18:30~06:29 为夜间
export function isNightTime(hour?: number): boolean {
  const now = new Date();
  const totalMinutes = hour !== undefined
    ? hour * 60
    : now.getHours() * 60 + now.getMinutes();
  return totalMinutes < 6 * 60 + 30 || totalMinutes >= 18 * 60 + 30;
}