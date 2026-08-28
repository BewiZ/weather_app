import { useEffect, useMemo, useState } from 'react';
import type { CmaAlarm } from '../../../api/cmaAlarm';

/**
 * 气象预警滚动条（CMA）
 *
 * 置于「最高/最低温度」与「六项指标」之间，仅在存在预警时渲染。
 *
 * 收起态：圆角矩形，固定高度，每 2.5s 内容整体上滚，循环展示所有预警；
 *         每屏只显示一条：预警信号图标 + 简短名称 title。
 * 展开态：点击矩形后展示完整内容 —— 图标 + title，下方 description 描述，
 *         再空一行，末行居右显示 effective + "发布"。
 */

const CYCLE_MS = 2500;

// 预警信号图标（assets/Meteorological_Warning_Signal_svg/*.svg → URL）
const ICON_MODULES = import.meta.glob(
  '../../../assets/Meteorological_Warning_Signal_svg/*.svg',
  { eager: true, import: 'default' },
) as Record<string, string>;

// 文件名 → URL（key 为不含扩展名的文件名，如 "台风黄色"）
const ICON_BY_NAME = new Map<string, string>();
for (const [path, url] of Object.entries(ICON_MODULES)) {
  const m = path.match(/([^/\\]+)\.svg$/i);
  if (m) ICON_BY_NAME.set(m[1], url);
}

// 灾害种类关键词 → 图标文件名前缀
// 顺序重要：长词/组合词在前（如 "雷暴大风" 必须先于 "雷电" / "大风" 匹配）
const DISASTER_KEYWORDS: [string, string][] = [
  ['山体滑坡', '山体滑坡'],
  ['雷暴大风', '雷暴大风'],
  ['道路结冰', '道路结冰'],
  ['森林火险', '森林火险'],
  ['森林火灾', '森林火险'],
  ['沙尘暴', '沙尘暴'],
  ['强季风', '强季风'],
  ['台风', '台风'],
  ['暴雨', '暴雨'],
  ['暴雪', '暴雪'],
  ['大雾', '大雾'],
  ['大风', '大风'],
  ['寒潮', '寒潮'],
  ['冰雹', '冰雹'],
  ['雷电', '雷电'],
  ['霜冻', '霜冻'],
  ['干旱', '干旱'],
  ['高温', '高温'],
  ['霾', '霾'],
];

// 预警等级词 → 图标文件名后缀
const LEVEL_WORDS = ['红色', '橙色', '黄色', '蓝色'] as const;

const FALLBACK_ICON = '⚠️';

/** 从 title（或 headline 兜底）解析预警信号图标 URL；解析失败返回 null */
function resolveWarningIcon(alarm: CmaAlarm): string | null {
  const text = alarm.title || alarm.headline || '';
  if (!text) return null;

  let prefix = '';
  for (const [kw, name] of DISASTER_KEYWORDS) {
    if (text.includes(kw)) { prefix = name; break; }
  }
  if (!prefix) return null;

  let level = '';
  for (const lv of LEVEL_WORDS) {
    if (text.includes(lv)) { level = lv; break; }
  }

  // 1) 精确匹配：如 台风 + 黄色 → "台风黄色"
  const exact = level ? ICON_BY_NAME.get(`${prefix}${level}`) : undefined;
  if (exact) return exact;

  // 2) 该灾害缺少此等级图标时，退而求其次取任意可用等级
  for (const lv of LEVEL_WORDS) {
    const alt = ICON_BY_NAME.get(`${prefix}${lv}`);
    if (alt) return alt;
  }
  return null;
}

export interface WeatherWarningBarProps {
  alarms: CmaAlarm[];
}

export function WeatherWarningBar({ alarms }: WeatherWarningBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [idx, setIdx] = useState(0);

  // 预警列表刷新（新增/解除）时回到第一条
  useEffect(() => {
    setIdx(0);
    setExpanded(false);
  }, [alarms]);

  // 收起态下每 2.5s 上滚一条；单条预警无需循环
  useEffect(() => {
    if (expanded || alarms.length <= 1) return;
    const timer = setInterval(() => {
      setIdx(i => (i + 1) % alarms.length);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [expanded, alarms.length]);

  const icons = useMemo(
    () => alarms.map(resolveWarningIcon),
    [alarms],
  );

  if (alarms.length === 0) return null;

  // 收起态圆角矩形：图标 + title + 序号，点击展开
  if (!expanded) {
    return (
      <div className="cma-warning cma-warning-bar"
        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>
        <div className="cma-warning-viewport">
          <div className="cma-warning-track"
            style={{ transform: `translateY(-${idx * 100}%)` }}>
            {alarms.map((a, i) => (
              <div className="cma-warning-slide" key={a.id || i}>
                {icons[i] ? (
                  <img className="cma-warning-icon" src={icons[i]} alt={a.title} />
                ) : (
                  <span className="cma-warning-icon cma-warning-emoji">{FALLBACK_ICON}</span>
                )}
                <span className="cma-warning-title">{a.title}</span>
                {alarms.length > 1 && (
                  <span className="cma-warning-count">{i + 1}/{alarms.length}</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <span className="cma-warning-hint">点击展开</span>
      </div>
    );
  }

  // 展开态：全部预警完整内容
  return (
    <div className="cma-warning cma-warning-expanded">
      <div className="cma-warning-expand-head">
        <span className="cma-warning-expand-title">
          当前有 {alarms.length} 条气象预警
        </span>
        <span className="cma-warning-collapse"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}>
          收起 ‹
        </span>
      </div>
      {alarms.map((a, i) => (
        <div className="cma-warning-item" key={a.id || i}>
          {icons[i] ? (
            <img className="cma-warning-item-icon" src={icons[i]} alt={a.title} />
          ) : (
            <span className="cma-warning-item-icon cma-warning-emoji">{FALLBACK_ICON}</span>
          )}
          <div className="cma-warning-item-body">
            <div className="cma-warning-item-title">{a.title}</div>
            <div className="cma-warning-desc">{a.description}</div>
            <div className="cma-warning-gap" aria-hidden="true"></div>
            <div className="cma-warning-pub">{a.effective} 发布</div>
          </div>
        </div>
      ))}
    </div>
  );
}
