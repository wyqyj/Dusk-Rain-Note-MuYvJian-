import React, { useState, useEffect } from 'react';
import { getDeadlineInfo, formatDeadlineDate } from '../../core/utils/markdown';

let sharedInterval: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;
const subscribers = new Set<() => void>();

function subscribeToTimer(callback: () => void): () => void {
  subscribers.add(callback);
  subscriberCount++;
  if (!sharedInterval) {
    sharedInterval = setInterval(() => {
      subscribers.forEach((cb) => cb());
    }, 10000);
  }
  return () => {
    subscribers.delete(callback);
    subscriberCount--;
    if (subscriberCount === 0 && sharedInterval) {
      clearInterval(sharedInterval);
      sharedInterval = null;
    }
  };
}

interface CountdownBadgeProps {
  deadline: number;
  showFull?: boolean;
}

export const CountdownBadge: React.FC<CountdownBadgeProps> = ({ deadline, showFull = false }) => {
  const [info, setInfo] = useState(() => getDeadlineInfo(deadline));

  useEffect(() => {
    const update = () => {
      const newInfo = getDeadlineInfo(deadline);
      setInfo(newInfo);
    };
    update();
    if (info.isExpired) return;
    return subscribeToTimer(update);
  }, [deadline]);

  const renderCountdown = () => {
    const now = Date.now();
    const diff = deadline - now;
    const absDiff = Math.abs(diff);
    const days = Math.floor(absDiff / 86400000);
    const hours = Math.floor((absDiff % 86400000) / 3600000);
    const minutes = Math.floor((absDiff % 3600000) / 60000);

    const unitClass = 'inline-flex flex-col items-center leading-none';
    const numClass = 'text-sm font-bold tabular-nums';
    const labelClass = 'text-[9px] opacity-60 mt-0.5';

    return (
      <div className="flex items-center gap-1">
        {days > 0 && (
          <span className={unitClass}>
            <span className={numClass}>{days}</span>
            <span className={labelClass}>天</span>
          </span>
        )}
        <span className={unitClass}>
          <span className={numClass}>{String(hours).padStart(2, '0')}</span>
          <span className={labelClass}>时</span>
        </span>
        <span className="text-xs opacity-40 -mt-2">:</span>
        <span className={unitClass}>
          <span className={numClass}>{String(minutes).padStart(2, '0')}</span>
          <span className={labelClass}>分</span>
        </span>
      </div>
    );
  };

  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium ${info.bgColor} ${info.color} transition-all`}>
      {info.isExpired ? (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : info.urgent ? (
        <svg className="w-4 h-4 flex-shrink-0 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      {showFull ? (
        <div className="flex flex-col gap-0.5">
          {renderCountdown()}
          <span className="text-[10px] opacity-50">{formatDeadlineDate(deadline)}</span>
        </div>
      ) : (
        renderCountdown()
      )}
    </div>
  );
};
