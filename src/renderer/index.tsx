import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { QuickNote } from './components/QuickNote';
import { TodayPlanWindow } from './components/TodayPlanWindow';
import { TimerStatsWindow } from './components/TimerStatsWindow';
import './styles/index.css';

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
