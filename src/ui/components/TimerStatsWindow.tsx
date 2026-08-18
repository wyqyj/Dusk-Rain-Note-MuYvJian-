import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TimeRecord } from '../store/timerStore';
import { getBridge } from '../../platform/container';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4'];

type Tab = 'today' | 'week' | 'month';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}时${m}分${sec}秒`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getDateRange(tab: Tab): { start: string; end: string } {
  const now = new Date();
  const today = formatDate(now.getTime());
  if (tab === 'today') return { start: today, end: today };
  if (tab === 'week') {
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    return { start: formatDate(monday.getTime()), end: today };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: formatDate(first.getTime()), end: today };
}

function filterRecords(records: TimeRecord[], tab: Tab): TimeRecord[] {
  const { start, end } = getDateRange(tab);
  return records.filter(r => r.date >= start && r.date <= end);
}

function groupByTask(records: TimeRecord[]): { name: string; value: number; count: number }[] {
  const map = new Map<string, { value: number; count: number }>();
  for (const r of records) {
    const key = r.taskText;
    const prev = map.get(key) || { value: 0, count: 0 };
    map.set(key, { value: prev.value + r.durationMs, count: prev.count + 1 });
  }
  return Array.from(map.entries())
    .map(([name, { value, count }]) => ({ name: name.length > 20 ? name.slice(0, 20) + '…' : name, value, count }))
    .sort((a, b) => b.value - a.value);
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value, count } = payload[0].payload;
  return (
    <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 text-xs">
      <p className="font-medium text-gray-800 dark:text-gray-200">{name}</p>
      <p className="text-gray-500 dark:text-gray-400">{formatDuration(value)} · {count}次</p>
    </div>
  );
};

export const TimerStatsWindow: React.FC = () => {
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [tab, setTab] = useState<Tab>('today');

  const loadRecords = async () => {
    try {
      const raw = await getBridge().timers.getTimerRecords();
      const data = JSON.parse(raw || '{"records":[]}');
      setRecords(data.records || []);
    } catch {}
  };

  useEffect(() => {
    loadRecords();
    // 窗口获得焦点时重新加载
    const onFocus = () => loadRecords();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const filtered = useMemo(() => filterRecords(records, tab), [records, tab]);
  const pieData = useMemo(() => groupByTask(filtered), [filtered]);
  const totalMs = useMemo(() => filtered.reduce((sum, r) => sum + r.durationMs, 0), [filtered]);

  const handleClose = () => getBridge().window.closeTimerStatsWindow();
  const handleMinimize = () => getBridge().window.minimizeTimerStatsWindow();

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-900 dark:to-gray-950 overflow-hidden select-none">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-slate-100 to-gray-50 dark:from-gray-800 dark:to-gray-800 border-b border-slate-200/60 dark:border-gray-700"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300 tracking-wide">任务统计</span>
          <span className="text-xs text-slate-400">累计 {formatDuration(totalMs)}</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={handleMinimize}
            className="p-1.5 rounded-md hover:bg-white/60 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
          </button>
          <button onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-gray-800">
        {([['today', '今日'], ['week', '本周'], ['month', '本月']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${tab === key
              ? 'bg-indigo-500 text-white shadow-sm font-medium'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600">
            <svg className="w-16 h-16 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">暂无计时记录</p>
            <p className="text-xs mt-1 opacity-60">在待办悬浮窗中对任务点击▶开始计时</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 饼状图 */}
            {pieData.length > 0 && (
              <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-slate-100/40 dark:border-gray-700/50 shadow-sm">
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">用时分布</h3>
                <div className="flex items-center gap-4">
                  <div className="w-40 h-40 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={65} paddingAngle={2} dataKey="value">
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {pieData.slice(0, 6).map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="flex-1 text-gray-600 dark:text-gray-300 truncate">{item.name}</span>
                        <span className="text-gray-400 font-mono tabular-nums">{formatDuration(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 文字记录 */}
            <div className="bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-slate-100/40 dark:border-gray-700/50 shadow-sm">
              <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">时间线</h3>
              <div className="space-y-2">
                {[...filtered].reverse().map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 dark:border-gray-700/30 last:border-0">
                    <span className="text-gray-400 font-mono tabular-nums w-12">{formatTime(r.startedAt)}</span>
                    <span className="w-1 h-1 rounded-full bg-indigo-300 flex-shrink-0" />
                    <span className="flex-1 text-gray-600 dark:text-gray-300 truncate">{r.taskText}</span>
                    <span className="text-gray-400 font-mono tabular-nums">{formatDuration(r.durationMs)}</span>
                    <span className="text-[10px] text-gray-300 dark:text-gray-600">{r.noteTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
