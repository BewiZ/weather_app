import type { Forecast24Style } from '../../WeatherDetail/hooks/Forecast24Hour';

export interface SettingsMenuProps {
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

export function SettingsMenu({
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
}: SettingsMenuProps) {
  return (
    <div className="gear-menu-wrap">
      <button className={`gear-btn ${gearMenuOpen ? 'open' : ''}`}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onGearToggle(); onStyleMenuToggle(); }}
        onClick={(e) => e.stopPropagation()}
        aria-label="菜单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      {gearMenuOpen && (
        <div className="gear-dropdown">
          {!styleMenuOpen ? (
            <>
              <div className="gear-dropdown-item" onClick={() => { onGearToggle(); onSidebarOpen(); }}>
                <span className="gear-dropdown-icon">📍</span>
                <span className="gear-dropdown-text">GPS 定位</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => onStyleMenuToggle()}>
                <span className="gear-dropdown-icon">🎨</span>
                <span className="gear-dropdown-text">样式</span>
                <span className="gear-dropdown-arrow">›</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => { onGearToggle(); onDebugToggle(); }}>
                <span className="gear-dropdown-icon">🔧</span>
                <span className="gear-dropdown-text">调试面板</span>
                {debugOpen && <span className="gear-dropdown-check">✓</span>}
              </div>
              <div className="gear-dropdown-item" onClick={() => { onGearToggle(); onPullDebugToggle(); }}>
                <span className="gear-dropdown-icon">📊</span>
                <span className="gear-dropdown-text">下拉进度</span>
                {showPullDebug && <span className="gear-dropdown-check">✓</span>}
              </div>
              <div className="gear-dropdown-item" onClick={() => { onGearToggle(); onApiPanelOpen(); }}>
                <span className="gear-dropdown-icon">🔌</span>
                <span className="gear-dropdown-text">API 管理</span>
              </div>
            </>
          ) : (
            <>
              <div className="gear-dropdown-back" onClick={() => onStyleMenuToggle()}>
                <span className="gear-dropdown-back-arrow">‹</span>
                <span className="gear-dropdown-back-text">样式</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => onLayoutCompactChange(!layoutCompact)}>
                <span className="gear-dropdown-text">结构</span>
                <span className="gear-dropdown-setting">{layoutCompact ? '紧致' : '松散'}</span>
              </div>
              <div className="gear-dropdown-item" onClick={() => onForecast24StyleChange(forecast24Style === 'complex' ? 'simple' : 'complex')}>
                <span className="gear-dropdown-text">24小时预报样式</span>
                <span className="gear-dropdown-setting">{forecast24Style === 'complex' ? '复杂' : '简约'}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
