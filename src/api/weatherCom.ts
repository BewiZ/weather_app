// --- Weather.com API (当前天气 + 7天预报) ---

export const WC_API_KEY = '6532d6454b8aa370768e63d6ba5a832e';
export const WC_BASE = 'https://api.weather.com/v3/wx';

export async function fetchWeatherCom(endpoint: string, lat: number, lng: number): Promise<Record<string, unknown>> {
  const url = `${WC_BASE}/${endpoint}?geocode=${lat},${lng}&format=json&units=m&language=zh-CN&apiKey=${WC_API_KEY}`;
  const resp = await Promise.race([
    fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(async r => {
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`weather.com HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      return r.json();
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('weather.com fetch 超时 (10s)')), 10000)),
  ]);
  return resp as Record<string, unknown>;
}
