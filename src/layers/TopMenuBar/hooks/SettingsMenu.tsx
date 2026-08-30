import { useState } from 'react';
import type { Forecast24Style } from '../../WeatherDetail/hooks/Forecast24Hour';
import type { ForecastSource } from '../../../api/unifiedWeather';
import { REALTIME_SOURCES } from '../../../config/apiConfig';

type SubMenu = 'main' | 'style' | 'source';

export interface SettingsMenuProps {
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

// 各分类可选来源（实况来源定义见 config/apiConfig.ts）
const FORECAST_SOURCES: { key: ForecastSource; label: string }[] = [
  { key: 'jishu', label: '极数本源' },
  { key: 'uapi',  label: 'UApiPro' },
];

export function SettingsMenu({
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
}: SettingsMenuProps) {
  const [subMenu, setSubMenu] = useState<SubMenu>('main');

  const closeAnd = (fn: () => void) => {
    onGearToggle();
    fn();
  };

  // 仅显示已启用的实况来源；禁用项从列表中移除
  const enabledRealtimeSources = REALTIME_SOURCES.filter(s => apiEnabled[s.key]);
  const cycleRealtimeSource = () => {
    if (enabledRealtimeSources.length === 0) return;
    const idx = enabledRealtimeSources.findIndex(s => s.key === realtimeSource);
    const next = enabledRealtimeSources[(idx + 1) % enabledRealtimeSources.length];
    onRealtimeSourceChange(next.key);
  };
  const cycleSource24 = () => {
    const idx = FORECAST_SOURCES.findIndex(s => s.key === source24);
    const next = FORECAST_SOURCES[(idx + 1) % FORECAST_SOURCES.length];
    onSource24Change(next.key);
  };
  const cycleSource15 = () => {
    const idx = FORECAST_SOURCES.findIndex(s => s.key === source15);
    const next = FORECAST_SOURCES[(idx + 1) % FORECAST_SOURCES.length];
    onSource15Change(next.key);
  };

  const realtimeLabel = REALTIME_SOURCES.find(s => s.key === realtimeSource)?.label || 'weather.com';
  const s24Label = FORECAST_SOURCES.find(s => s.key === source24)?.label || '极数本源';
  const s15Label = FORECAST_SOURCES.find(s => s.key === source15)?.label || '极数本源';

  return (
    <div className="gear-menu-wrap">
      <button className={`gear-btn ${gearMenuOpen ? 'open' : ''}`}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGearToggle(); }}
        onClick={(e) => e.stopPropagation()}
        aria-label="菜单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      {gearMenuOpen && (
        <div className="gear-dropdown">
          {subMenu === 'main' && (
            <>
              <div className="gear-dropdown-item" onClick={() => closeAnd(onSidebarOpen)}>
                <span className="gear-dropdown-icon">📍</span>
                <span className="gear-dropdown-text">GPS 定位</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => setSubMenu('source')}>
                <span className="gear-dropdown-icon">📡</span>
                <span className="gear-dropdown-text">来源</span>
                <span className="gear-dropdown-arrow">›</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => setSubMenu('style')}>
                <span className="gear-dropdown-icon">🎨</span>
                <span className="gear-dropdown-text">样式</span>
                <span className="gear-dropdown-arrow">›</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => closeAnd(onDebugToggle)}>
                <span className="gear-dropdown-icon">🔧</span>
                <span className="gear-dropdown-text">调试面板</span>
                {debugOpen && <span className="gear-dropdown-check">✓</span>}
              </div>
              <div className="gear-dropdown-item" onClick={() => closeAnd(onPullDebugToggle)}>
                <span className="gear-dropdown-icon">📊</span>
                <span className="gear-dropdown-text">下拉进度</span>
                {showPullDebug && <span className="gear-dropdown-check">✓</span>}
              </div>
              <div className="gear-dropdown-item" onClick={() => closeAnd(onApiPanelOpen)}>
                <span className="gear-dropdown-icon">🔌</span>
                <span className="gear-dropdown-text">API 管理</span>
              </div>
            </>
          )}
          {subMenu === 'style' && (
            <>
              <div className="gear-dropdown-back" onClick={() => setSubMenu('main')}>
                <span className="gear-dropdown-back-arrow">‹</span>
                <span className="gear-dropdown-back-text">样式</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => onForecast24StyleChange(forecast24Style === 'complex' ? 'simple' : 'complex')}>
                <span className="gear-dropdown-text">24小时预报样式</span>
                <span className="gear-dropdown-setting">{forecast24Style === 'complex' ? '复杂' : '简约'}</span>
              </div>
            </>
          )}
          {subMenu === 'source' && (
            <>
              <div className="gear-dropdown-back" onClick={() => setSubMenu('main')}>
                <span className="gear-dropdown-back-arrow">‹</span>
                <span className="gear-dropdown-back-text">来源</span>
              </div>
              {enabledRealtimeSources.length > 0 && (
                <div className="gear-dropdown-item" onClick={cycleRealtimeSource}>
                  <span className="gear-dropdown-text">实况天气</span>
                  <span className="gear-dropdown-setting">{realtimeLabel}</span>
                </div>
              )}
              <div className="gear-dropdown-item" onClick={cycleSource24}>
                <span className="gear-dropdown-text">24小时预报</span>
                <span className="gear-dropdown-setting">{s24Label}</span>
              </div>
              <div className="gear-dropdown-item" onClick={cycleSource15}>
                <span className="gear-dropdown-text">15日预报</span>
                <span className="gear-dropdown-setting">{s15Label}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}