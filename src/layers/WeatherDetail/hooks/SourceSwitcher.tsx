/**
 * SourceSwitcher
 *
 * 结构：独立 label（当前源名）+ 单按钮（⇄ 图标），两个 DOM 元素。
 *
 * Android WebView 上"浮窗点一下立刻消失"的根因：
 *   按钮同时注册 onTouchStart + onClick，一次轻触 → onTouchStart 触发
 *   open=true → 浏览器再合成 click → onClick 触发 open=false → 浮窗闪灭。
 *
 * 修复：
 *   - 按钮只保留 onClick，彻底消除双触发源；
 *   - 浮窗外关闭用 document pointerdown capture + preventDefault：
 *     preventDefault 让本事件链后续不再合成 click，且关闭在 click 之前
 *     完成，不会"关掉又被 click 打开"；
 *   - 浮窗通过 createPortal 挂到 body，用 getBoundingClientRect 定位到
 *     当前按钮下方——15 天 / 24 小时浮窗各就各位。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ForecastSource } from '../../../api/unifiedWeather';

export interface SourceSwitcherProps {
  source: ForecastSource;
  onChange: (s: ForecastSource) => void;
}

const SOURCE_OPTIONS: { key: ForecastSource; label: string }[] = [
  { key: 'jishu', label: '极数' },
  { key: 'uapi', label: 'UApi' },
];

const LABEL_OF: Record<ForecastSource, string> = {
  jishu: '极数',
  uapi: 'UApi',
};

export function SourceSwitcher({ source, onChange }: SourceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [panelRect, setPanelRect] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) setPanelRect({ top: 0, left: 0 });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function positionPanel() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const panelMinW = 128;
      const availRight = window.innerWidth - r.right;
      let left = r.left;
      if (availRight < panelMinW) left = r.right - panelMinW;
      if (left < 8) left = 8;
      setPanelRect({
        top: Math.min(r.bottom + 4, window.innerHeight - 90),
        left,
      });
    }
    positionPanel();
    const onScroll = () => positionPanel();
    const onResize = () => positionPanel();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize, true);
    };
  }, [open]);

  // 浮窗外点击关闭（pointerdown capture，先于 click 执行）
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      const target = e.target;
      if (target instanceof Node) {
        if (btnRef.current?.contains(target)) return;
        if ((target as Element)?.closest('.forecast-source-panel')) return;
      }
      e.preventDefault();
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  // 浮窗打开期间禁止页面滚动
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <span className="forecast-source-switcher">
      <span className="forecast-source-label">{LABEL_OF[source]}</span>
      <button
        ref={btnRef}
        className="forecast-source-btn"
        aria-label="切换数据源"
        onClick={() => setOpen(o => !o)}
      >
        <span className="forecast-source-icon">⇄</span>
      </button>

      {open && typeof document !== 'undefined' && document.body &&
        createPortal(
          <span className="forecast-source-panel"
                style={{ top: panelRect.top, left: panelRect.left }}>
            {SOURCE_OPTIONS.map(o => (
              <button
                key={o.key}
                className={`forecast-source-option${source === o.key ? ' on' : ''}`}
                onClick={() => { onChange(o.key); setOpen(false); }}
                onPointerDown={e => e.preventDefault()}
                onTouchStart={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(o.key);
                  setOpen(false);
                }}
              >
                <span className="forecast-source-label">{o.label}</span>
                <span className="forecast-source-icon">⇄</span>
                {source === o.key && <span className="forecast-source-check">✓</span>}
              </button>
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}