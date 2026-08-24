import dIconWind from '../../../assets/Daily_Icons/wind_2.svg';
import dIconHumidity from '../../../assets/Daily_Icons/humidity.svg';
import dIconPressure from '../../../assets/Daily_Icons/pressure.svg';
import dIconVisibility from '../../../assets/Daily_Icons/eye.svg';
import dIconUv from '../../../assets/Daily_Icons/ultraviolet_ray.svg';
import dIconSunrise from '../../../assets/Daily_Icons/sun_rise_set.svg';

export interface WeatherMetricData {
  windSpeed: number;
  windDirectionCardinal: string;
  windDirectionDegrees: number;
  relativeHumidity: number;
  pressure: number;
  pressTendencyCode: number;
  visibility: number;
  uvIndex: number;
  sunrise: string;
  sunset: string;
}

function humidityDesc(h: number): string {
  if (h < 30) return '干燥';
  if (h < 50) return '偏干';
  if (h < 65) return '适宜';
  if (h < 80) return '潮湿';
  if (h < 95) return '高湿';
  return '饱和';
}

function pressureTendencyDesc(code: number): string {
  if (code === 1) return '气压上升';
  if (code === 2) return '气压下降';
  return '气压稳定';
}

function visibilityDesc(v: number): string {
  // v 单位：km
  if (v >= 10) return '优';
  if (v >= 2) return '良';
  if (v >= 1) return '一般';
  if (v >= 0.5) return '较差';
  if (v >= 0.05) return '差';
  return '极差';
}

function uvDesc(uv: number): string {
  if (uv <= 2) return '最弱';
  if (uv <= 4) return '弱';
  if (uv <= 6) return '中等';
  if (uv <= 9) return '强';
  return '很强';
}

function visibilityKmToString(v: number): string {
  const km = Number(v) || 0;
  let s: string;
  if (km >= 10) {
    s = km % 1 === 0 ? km.toFixed(0) : km.toFixed(1);
  } else {
    s = km.toFixed(2);
  }
  s = s.replace(/\.?0+$/, '');
  return s + 'km';
}

function formatSunTime(timeStr: string): string {
  if (!timeStr) return '--';
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (m) return m[1] + ':' + m[2];
  return timeStr.slice(0, 5);
}

export interface WeatherMetricsProps {
  data: WeatherMetricData;
}

export function WeatherMetrics({ data }: WeatherMetricsProps) {
  return (
    <div className="detail-metrics">
      <div className="detail-metric">
        <div className="detail-metric-ico detail-wind-ico">
          <img
            src={dIconWind}
            alt=""
            className="detail-wind-arrow"
            style={{ transform: `rotate(${data.windDirectionDegrees}deg)` }}
          />
        </div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">风速</span>
          <span className="detail-metric-val">{data.windSpeed}<em>km/h</em></span>
          <span className="detail-metric-desc">{data.windDirectionCardinal}风</span>
        </div>
      </div>
      <div className="detail-metric">
        <div className="detail-metric-ico"><img src={dIconHumidity} alt="" /></div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">湿度</span>
          <span className="detail-metric-val">{data.relativeHumidity}<em>%</em></span>
          <span className="detail-metric-desc">{humidityDesc(data.relativeHumidity)}</span>
        </div>
      </div>
      <div className="detail-metric">
        <div className="detail-metric-ico"><img src={dIconPressure} alt="" /></div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">海平面气压</span>
          <span className="detail-metric-val">{data.pressure}<em>hPa</em></span>
          <span className="detail-metric-desc">{pressureTendencyDesc(data.pressTendencyCode)}</span>
        </div>
      </div>
      <div className="detail-metric">
        <div className="detail-metric-ico"><img src={dIconVisibility} alt="" /></div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">能见度</span>
          <span className="detail-metric-val">{visibilityKmToString(data.visibility)}</span>
          <span className="detail-metric-desc">{visibilityDesc(data.visibility)}</span>
        </div>
      </div>
      <div className="detail-metric">
        <div className="detail-metric-ico"><img src={dIconUv} alt="" /></div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">紫外线指数</span>
          <span className="detail-metric-val">{data.uvIndex}</span>
          <span className="detail-metric-desc">{uvDesc(data.uvIndex)}</span>
        </div>
      </div>
      <div className="detail-metric">
        <div className="detail-metric-ico detail-sun-ico"><img src={dIconSunrise} alt="" /></div>
        <div className="detail-metric-info">
          <span className="detail-metric-name">日出/日落</span>
          <span className="detail-metric-val-sr">
            <span className="sr-row">{formatSunTime(data.sunrise)}</span>
            <span className="sr-row">{formatSunTime(data.sunset)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
