// 调试面板（API 原始数据）的数据结构

export interface DebugItem {
  key: string;
  value?: unknown;
  children?: DebugItem[];
}

export interface DebugSection {
  title: string;
  icon: string;
  expanded: boolean;
  items: DebugItem[];
}
