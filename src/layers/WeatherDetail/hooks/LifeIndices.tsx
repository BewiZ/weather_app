import { useEffect, useState } from 'react';
import type { UApiResponse, UApiLifeIndex } from '../../../types/weather';

/**
 * 18 项生活指数（UApiPro life_indices）
 *
 * 收起态：3 列 × 2 行，只展示 6 项主要指数（穿衣 / 晾晒 / 运动 / 防晒 / 雨伞 / 花粉），
 *         每格自上而下为 图标 → level → 较淡小字名称。
 * 展开态：点击后列出全部 18 项，每行左侧为图标及其下方名称（居左），
 *         右侧为上方 level 与下方 advice（居右）。
 */

/** Life_Indicators/*.svg → URL（key 为不含扩展名的文件名） */
const ICON_MODULES = import.meta.glob(
  '../../../assets/Life_Indicators/*.svg',
  { eager: true, import: 'default' },
) as Record<string, string>;

const ICON_BY_NAME = new Map<string, string>();
for (const [path, url] of Object.entries(ICON_MODULES)) {
  const m = path.match(/([^/\\]+)\.svg$/i);
  if (m) ICON_BY_NAME.set(m[1], url);
}

type LifeKey = keyof NonNullable<UApiResponse['life_indices']>;

interface LifeMeta {
  key: LifeKey;
  name: string;
  icon: string;
  /** 收起态 3×2 网格中展示的主要指数 */
  primary?: boolean;
}

/** 顺序与接口 life_indices 字段一致 */
const LIFE_ITEMS: LifeMeta[] = [
  { key: 'clothing',        name: '穿衣',       icon: 'clothing',        primary: true },
  { key: 'uv',              name: '紫外线',      icon: 'uv' },
  { key: 'car_wash',        name: '洗车',       icon: 'car_wash' },
  { key: 'drying',          name: '晾晒',       icon: 'drying',          primary: true },
  { key: 'air_conditioner', name: '空调开启',    icon: 'air_conditioner' },
  { key: 'cold_risk',       name: '感冒',       icon: 'cold_risk' },
  { key: 'exercise',        name: '运动',       icon: 'exercise',        primary: true },
  { key: 'comfort',         name: '舒适度',      icon: 'comfort' },
  { key: 'travel',          name: '出行',       icon: 'travel' },
  { key: 'fishing',         name: '钓鱼',       icon: 'fishing' },
  { key: 'allergy',         name: '过敏',       icon: 'allergy' },
  { key: 'sunscreen',       name: '防晒',       icon: 'sunscreen',       primary: true },
  // 心情暂统一使用 mood_good.svg
  { key: 'mood',            name: '心情',       icon: 'mood_good' },
  { key: 'beer',            name: '啤酒',       icon: 'beer' },
  { key: 'umbrella',        name: '雨伞',       icon: 'umbrella',        primary: true },
  { key: 'traffic',         name: '交通',       icon: 'traffic' },
  { key: 'air_purifier',    name: '空气净化器',  icon: 'air_purifier' },
  { key: 'pollen',          name: '花粉',       icon: 'pollen',          primary: true },
];

export interface LifeIndicesProps {
  uapiData: UApiResponse | null;
}

export function LifeIndices({ uapiData }: LifeIndicesProps) {
  const [expanded, setExpanded] = useState(false);
  const indices = uapiData?.life_indices;

  // 数据刷新时回到收起态
  useEffect(() => { setExpanded(false); }, [indices]);

  if (!indices) return null;

  const iconUrl = (icon: string) => ICON_BY_NAME.get(icon) || null;

  // 收起态：主要指数 3 列 × 2 行
  if (!expanded) {
    const primary = LIFE_ITEMS.filter(m => m.primary && indices[m.key]);
    if (primary.length === 0) return null;
    return (
      <div className="life-card">
        <div className="life-head">
          <span className="life-title">生活指数</span>
          <span className="life-hint">展开全部 18 项 ›</span>
        </div>
        <div className="life-grid" onClick={() => setExpanded(true)}>
          {primary.map(m => {
            const v = indices[m.key] as UApiLifeIndex;
            return (
              <div className="life-cell" key={m.key}>
                {iconUrl(m.icon)
                  ? <img className="life-cell-ico" src={iconUrl(m.icon)!} alt={m.name} />
                  : <span className="life-cell-ico life-cell-emoji">⚪</span>}
                <span className="life-cell-level">{v.level}</span>
                <span className="life-cell-name">{m.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 展开态：全部 18 项
  const all = LIFE_ITEMS.filter(m => indices[m.key]);
  if (all.length === 0) return null;
  return (
    <div className="life-card life-card-full">
      <div className="life-head">
        <span className="life-title">生活指数 · 全部 18 项</span>
        <span className="life-collapse" onClick={() => setExpanded(false)}>收起 ‹</span>
      </div>
      <div className="life-list">
        {all.map(m => {
          const v = indices[m.key] as UApiLifeIndex;
          return (
            <div className="life-row" key={m.key}>
              <div className="life-row-left">
                {iconUrl(m.icon)
                  ? <img className="life-row-ico" src={iconUrl(m.icon)!} alt={m.name} />
                  : <span className="life-row-ico life-cell-emoji">⚪</span>}
                <span className="life-row-name">{m.name}</span>
              </div>
              <div className="life-row-right">
                <span className="life-row-level">{v.level}</span>
                <span className="life-row-advice">{v.advice}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
