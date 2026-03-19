import React, { useEffect, useState } from 'react';

const STAGES = [
  { key: 'identity', label: 'Deriving identity',   detail: 'Ed25519 from device entropy' },
  { key: 'chain',    label: 'Initialising chain',   detail: 'SHA-256 worldline' },
  { key: 'relay',    label: 'Connecting to CHORUS', detail: 'wss://dotdotdot.rocks' },
  { key: 'done',     label: 'Physics online',       detail: '153 bytes ready' },
];

export function BootScreen() {
  const [stage, setStage] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 200);
    const t2 = setInterval(() => setStage(s => (s < STAGES.length - 1 ? s + 1 : s)), 700);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%',
      background: 'var(--bg)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 55% 55% at 50% 48%, rgba(251,191,36,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Dot symbol with pulse rings */}
      <div style={{ position: 'relative', marginBottom: 40, width: 64, height: 64 }}>
        {visible && [0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '1px solid rgba(251,191,36,0.25)',
            animation: `pulse-out 2.6s ease-out ${i * 0.85}s infinite`,
          }} />
        ))}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.03) 60%, transparent 100%)',
          border: '1px solid rgba(251,191,36,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: visible ? 1 : 0, transition: 'opacity 0.7s ease',
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--gold)',
            boxShadow: '0 0 14px 5px rgba(251,191,36,0.35)',
          }} />
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--serif)', fontSize: 30, fontStyle: 'italic',
        letterSpacing: '0.02em', color: 'var(--text)',
        opacity: visible ? 1 : 0, transition: 'opacity 0.8s ease 0.2s',
        marginBottom: 5,
      }}>DOT</div>
      <div style={{
        fontSize: 9, letterSpacing: '0.28em', color: 'var(--text-dim)',
        textTransform: 'uppercase',
        opacity: visible ? 1 : 0, transition: 'opacity 0.8s ease 0.35s',
        marginBottom: 52,
      }}>Universal Messenger</div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: '100%', maxWidth: 280, padding: '0 20px',
        opacity: visible ? 1 : 0, transition: 'opacity 0.6s ease 0.5s',
      }}>
        {STAGES.map((s, i) => {
          const active = i === stage, done = i < stage, pending = i > stage;
          return (
            <div key={s.key} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px',
              background: active ? 'rgba(251,191,36,0.05)' : 'transparent',
              border: `1px solid ${active ? 'rgba(251,191,36,0.14)' : 'transparent'}`,
              borderRadius: 3, transition: 'all 0.35s ease',
              opacity: pending ? 0.22 : 1,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: done ? 'var(--mint)' : active ? 'var(--gold)' : 'rgba(239,237,230,0.2)',
                boxShadow: done ? '0 0 7px var(--mint)' : active ? '0 0 9px rgba(251,191,36,0.55)' : 'none',
                animation: active ? 'breathe 1.1s ease infinite' : 'none',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 11, letterSpacing: '0.03em',
                  color: done ? 'var(--mint)' : active ? 'var(--gold)' : 'var(--text-dim)',
                }}>{s.label}</div>
                <div style={{ fontSize: 9, color: 'var(--text-dimmer)', marginTop: 2, letterSpacing: '0.04em' }}>
                  {s.detail}
                </div>
              </div>
              {done && <div style={{ fontSize: 10, color: 'var(--mint)', opacity: 0.65 }}>✓</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
