import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import App from './App';
import { QuickNote } from './components/QuickNote';
import { TodayPlanWindow } from './components/TodayPlanWindow';
import { TimerStatsWindow } from './components/TimerStatsWindow';
import './styles/index.css';
import { bootstrap } from '../platform/bootstrap';
import { EV_PANEL_BACK } from '../adapters/ui-events';

// 装配平台桥（ports → adapters）必须在 React 渲染前完成，保证 store 可同步访问。
bootstrap();

// Android 系统返回键：先派发给 ui（覆盖层优先关闭），未处理时回退 WebView 历史或后台。
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener('backButton', async ({ canGoBack }) => {
    const event = new CustomEvent(EV_PANEL_BACK, { cancelable: true });
    const handled = window.dispatchEvent(event);
    if (!handled) {
      if (canGoBack) {
        window.history.back();
      } else {
        await CapApp.minimizeApp();
      }
    }
  });
}

// Apply the persisted theme before React paints to avoid a light-mode flash.
try {
  const settings = JSON.parse(localStorage.getItem('lingxi-settings') || '{}') as { theme?: string };
  if (settings.theme === 'dark') document.documentElement.classList.add('dark');
} catch {}

const hash = window.location.hash;
const isQuickNote = hash === '#/quick-note';
const isTodayPlan = hash === '#/today-plan';
const isTimerStats = hash === '#/timer-stats';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (isQuickNote) {
  root.render(<React.StrictMode><QuickNote /></React.StrictMode>);
} else if (isTodayPlan) {
  root.render(<React.StrictMode><TodayPlanWindow /></React.StrictMode>);
} else if (isTimerStats) {
  root.render(<React.StrictMode><TimerStatsWindow /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}