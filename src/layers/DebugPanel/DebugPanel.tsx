/**
 * 调试面板（纯展示：加载态 / 一级目录折叠 / JSON 块复制）
 *
 * 数据由 buildDebugSections 组装，状态与回调全部由 App.tsx 传入。
 */

import type { DebugSection } from '../../types/debug';

export interface DebugPanelProps {
  loading: boolean;
  sections: DebugSection[] | null;
  expanded: Set<number>;
  error: Record<string, unknown> | null;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
  onToggle: (index: number) => void;
  onClose: () => void;
}

export function DebugPanel({
  loading, sections, expanded, error, copiedKey,
  onCopy, onToggle, onClose,
}: DebugPanelProps) {
  return (
    <>
      <div className="debug-panel-overlay active" onClick={onClose} />
      <div className="debug-panel open">
        <div className="debug-panel-header">
          <span className="debug-panel-title">🔧 调试 · API 原始数据</span>
          <button className="debug-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="debug-panel-body">
          {loading ? (
            <div className="debug-loading">
              <span className="debug-loading-text">正在获取 API 数据…</span>
            </div>
          ) : sections ? (
            <div className="debug-sections">
              {sections.map((section, si) => {
                const isOpen = expanded.has(si);
                return (
                  <div key={si} className="debug-section">
                    <div className="debug-section-header" onClick={() => onToggle(si)}>
                      <span className="debug-section-arrow">{isOpen ? '▾' : '▸'}</span>
                      <span className="debug-section-icon">{section.icon}</span>
                      <span className="debug-section-title">{section.title}</span>
                      <span className="debug-section-count">({section.items.length})</span>
                    </div>
                    {isOpen && (
                      <div className="debug-items">
                        {section.items.map((item, ii) => (
                          <div key={ii} className="debug-json-block">
                            {item.children ? (
                              <>
                                <div className="debug-json-key">
                                  <span>{item.key}</span>
                                  <button className="debug-copy-btn" onClick={() => onCopy(item.key, item.children)}>
                                    {copiedKey === item.key ? '✓ 已复制' : '📋 复制'}
                                  </button>
                                </div>
                                <div className="debug-children">
                                  {item.children.map((c, ci) => (
                                    <div key={ci} className="debug-json-block debug-child-block">
                                      <div className="debug-json-key">
                                        <span>{c.key}</span>
                                        <button className="debug-copy-btn" onClick={() => onCopy(c.key, c.value)}>
                                          {copiedKey === c.key ? '✓ 已复制' : '📋 复制'}
                                        </button>
                                      </div>
                                      <pre className="debug-json-value">{JSON.stringify(c.value, null, 2)}</pre>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="debug-json-key">
                                  <span>{item.key}</span>
                                  <button className="debug-copy-btn" onClick={() => onCopy(item.key, item.value)}>
                                    {copiedKey === item.key ? '✓ 已复制' : '📋 复制'}
                                  </button>
                                </div>
                                <pre className="debug-json-value">{JSON.stringify(item.value, null, 2)}</pre>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : error ? (
            <div className="debug-json-blocks">
              {Object.entries(error).map(([key, value]) => (
                <div key={key} className="debug-json-block">
                  <div className="debug-json-key">
                    <span>{key}</span>
                    <button className="debug-copy-btn" onClick={() => onCopy(key, value)}>📋 复制</button>
                  </div>
                  <pre className="debug-json-value">{JSON.stringify(value, null, 2)}</pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="debug-empty">
              <span className="debug-empty-text">暂无调试数据</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
