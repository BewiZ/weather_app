import type { Forecast24Style } from '../WeatherDetail/hooks/Forecast24Hour';
import type { ForecastSource } from '../../api/unifiedWeather';
import { SettingsMenu } from './hooks/SettingsMenu';

export interface TopMenuBarProps {
  cityName: string;
  weatherPhrase: string;
  iconUrlFn: (phrase: string, isNight?: boolean) => string;
  gearMenuOpen: boolean;
  debugOpen: boolean;
  showPullDebug: boolean;
  forecast24Style: Forecast24Style;
  realtimeSource: string;
  apiEnabled: Record<string, boolean>;
  source24: ForecastSource;
  source15: ForecastSource;
  onGearToggle: () => void;
  onSidebarOpen: () => void;
  onDebugToggle: () => void;
  onPullDebugToggle: () => void;
  onApiPanelOpen: () => void;
  onForecast24StyleChange: (s: Forecast24Style) => void;
  onRealtimeSourceChange: (s: string) => void;
  onSource24Change: (s: ForecastSource) => void;
  onSource15Change: (s: ForecastSource) => void;
}

export function TopMenuBar({
  cityName,
  weatherPhrase,
  iconUrlFn,
  gearMenuOpen,
  debugOpen,
  showPullDebug,
  forecast24Style,
  realtimeSource,
  apiEnabled,
  source24,
  source15,
  onGearToggle,
  onSidebarOpen,
  onDebugToggle,
  onPullDebugToggle,
  onApiPanelOpen,
  onForecast24StyleChange,
  onRealtimeSourceChange,
  onSource24Change,
  onSource15Change,
}: TopMenuBarProps) {
  return (
    <div className="weather-topbar">
      <div className="weather-city-row">
        <span className="weather-city-icon"><img src={iconUrlFn(weatherPhrase)} alt="" className="weather-icon-img" /></span>
        <span className="weather-city-name">{cityName}</span>
      </div>
      <SettingsMenu
        gearMenuOpen={gearMenuOpen}
        debugOpen={debugOpen}
        showPullDebug={showPullDebug}
        forecast24Style={forecast24Style}
        realtimeSource={realtimeSource}
        apiEnabled={apiEnabled}
        source24={source24}
        source15={source15}
        onGearToggle={onGearToggle}
        onSidebarOpen={onSidebarOpen}
        onDebugToggle={onDebugToggle}
        onPullDebugToggle={onPullDebugToggle}
        onApiPanelOpen={onApiPanelOpen}
        onForecast24StyleChange={onForecast24StyleChange}
        onRealtimeSourceChange={onRealtimeSourceChange}
        onSource24Change={onSource24Change}
        onSource15Change={onSource15Change}
      />
    </div>
  );
}
