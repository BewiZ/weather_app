import type { Forecast24Style } from '../WeatherDetail/hooks/Forecast24Hour';
import { SettingsMenu } from './hooks/SettingsMenu';

export interface TopMenuBarProps {
  cityName: string;
  weatherPhrase: string;
  iconUrlFn: (phrase: string, isNight?: boolean) => string;
  gearMenuOpen: boolean;
  styleMenuOpen: boolean;
  debugOpen: boolean;
  showPullDebug: boolean;
  layoutCompact: boolean;
  forecast24Style: Forecast24Style;
  onGearToggle: () => void;
  onSidebarOpen: () => void;
  onStyleMenuToggle: () => void;
  onDebugToggle: () => void;
  onPullDebugToggle: () => void;
  onApiPanelOpen: () => void;
  onLayoutCompactChange: (val: boolean) => void;
  onForecast24StyleChange: (s: Forecast24Style) => void;
}

export function TopMenuBar({
  cityName,
  weatherPhrase,
  iconUrlFn,
  gearMenuOpen,
  styleMenuOpen,
  debugOpen,
  showPullDebug,
  layoutCompact,
  forecast24Style,
  onGearToggle,
  onSidebarOpen,
  onStyleMenuToggle,
  onDebugToggle,
  onPullDebugToggle,
  onApiPanelOpen,
  onLayoutCompactChange,
  onForecast24StyleChange,
}: TopMenuBarProps) {
  return (
    <div className="weather-topbar">
      <div className="weather-city-row">
        <span className="weather-city-icon"><img src={iconUrlFn(weatherPhrase)} alt="" className="weather-icon-img" /></span>
        <span className="weather-city-name">{cityName}</span>
      </div>
      <SettingsMenu
        gearMenuOpen={gearMenuOpen}
        styleMenuOpen={styleMenuOpen}
        debugOpen={debugOpen}
        showPullDebug={showPullDebug}
        layoutCompact={layoutCompact}
        forecast24Style={forecast24Style}
        onGearToggle={onGearToggle}
        onSidebarOpen={onSidebarOpen}
        onStyleMenuToggle={onStyleMenuToggle}
        onDebugToggle={onDebugToggle}
        onPullDebugToggle={onPullDebugToggle}
        onApiPanelOpen={onApiPanelOpen}
        onLayoutCompactChange={onLayoutCompactChange}
        onForecast24StyleChange={onForecast24StyleChange}
      />
    </div>
  );
}
