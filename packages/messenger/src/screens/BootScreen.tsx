import React, { useEffect, useState } from 'react';

const STAGES = [
  'identity',
  'chain',
  'relay',
  'done',
];

export function BootScreen() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStage(s => (s < STAGES.length - 1 ? s + 1 : s));
    }, 600);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: '16px',
    }}>
      <div style={{ fontSize: '48px', lineHeight: 1, userSelect: 'none' }}>◉</div>
      <div style={{ fontSize: '14px', letterSpacing: '0.1em' }}>DOT MESSENGER</div>
      <div style={{ fontSize: '11px', opacity: 0.4, marginTop: '8px' }}>
        {STAGES.slice(0, stage + 1).map((s, i) => (
          <span key={s}>
            {i > 0 && ' · '}
            <span style={{ opacity: i === stage ? 1 : 0.5 }}>{s}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
