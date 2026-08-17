import React, { useState } from 'react';

const steps = [
  { eyebrow: '欢迎使用', title: '从今天开始管理你的备考节奏', body: '暮雨笺以学习工作台作为首页。倒计时、今日任务、专注记录、书架、题册、笔记与无限画布都只保存在本机。' },
  { eyebrow: '先做规划', title: '先安排今天，再安排长期', body: '在“规划”添加每日任务或导入 Markdown 计划。昨天未完成项会自动顺延，并标明来源；暂缓任务会转入月综合任务。' },
  { eyebrow: '记录与复盘', title: '用题册、笔记和画布串起知识', body: '题册用于归档正确题与错题；笔记支持 Markdown；画布可放入图片、文本和关联笔记。选中元素可调整尺寸，双击可聚焦，右键可复制或粘贴。' },
  { eyebrow: '本地备份', title: '资料始终由你掌控', body: '在“设置”可以修改并迁移数据目录、查看文件案例或导出综合备份。综合备份包含工作台数据、笔记、附件与导入资料。' },
];

export const OnboardingGuide: React.FC<{ onFinish: () => void; onSkip: () => void }> = ({ onFinish, onSkip }) => {
  const [step, setStep] = useState(0);
  const current = steps[step] || { eyebrow: '', title: '', body: '' };
  const isLast = step === steps.length - 1;

  return <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
    <section className="onboarding-card">
      <div className="onboarding-progress" aria-label={`第 ${step + 1} 步，共 ${steps.length} 步`}>{steps.map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}</div>
      <span className="onboarding-eyebrow">{current.eyebrow}</span>
      <h2 id="onboarding-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="onboarding-note">完整说明已保存在“笔记”中的《暮雨笺 v3 使用指南》。</div>
      <footer><button className="onboarding-skip" onClick={onSkip}>跳过引导</button><div>{step > 0 && <button className="onboarding-back" onClick={() => setStep((value) => value - 1)}>上一步</button>}<button className="onboarding-next" onClick={() => isLast ? onFinish() : setStep((value) => value + 1)}>{isLast ? '开始使用' : '下一步'}</button></div></footer>
    </section>
  </div>;
};
