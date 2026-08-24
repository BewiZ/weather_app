// 纯工具函数（从 App.tsx 抽出，零 React 依赖）

export function base64urlDecode(s: string): string {
  // base64url → base64：替换 - _ 并补全 =
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

export function windDirToCardinal(dir: string): string {
  const d = dir.trim();
  if (d.length === 0) return '';
  // QWeather 返回中文风向（可能带"风"字），提取方位词
  const m = d.match(/(东北|东南|西南|西北|北|东|南|西)/);
  if (m) return m[1];
  // 数字角度转风向
  const deg = parseInt(d, 10);
  if (isNaN(deg)) return d;
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}

export function windSpeedKmHToLevel(speed: number): string {
  // 风速 km/h → 风级（蒲福风级标准）
  if (speed < 1.6) return '0级';
  if (speed < 3.4) return '1级';
  if (speed < 5.5) return '2级';
  if (speed < 8.0) return '3级';
  if (speed < 10.8) return '4级';
  if (speed < 13.9) return '5级';
  if (speed < 17.2) return '6级';
  if (speed < 20.8) return '7级';
  return '8级以上';
}
