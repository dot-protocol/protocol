import React, { useEffect, useState } from 'react';
import { DOT } from 'dot-protocol';

interface Props { onBack: () => void; onSensors: () => void; }

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 2);
  const min = Math.min(...values, 0.9);
  const w = 280, h = 44;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / (max - min + 0.001)) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const last = values[values.length - 1];
  const lastX = w, lastY = h - ((last - min) / (max - min + 0.001)) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(251,191,36,0.15)" />
          <stop offset="100%" stopColor="rgba(251,191,36,0)" />
        </linearGradient>
      </defs>
      <polyline points={`${pts} ${lastX},${h} 0,${h}`} fill="url(#spark-grad)" stroke="none" />
      <polyline points={pts} fill="none" stroke="rgba(251,191,36,0.7)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="3" fill="var(--gold)" opacity="0.9" />
    </svg>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-dimmer)', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 500, letterSpacing: '0.02em',
        color: accent ? 'var(--gold)' : 'var(--text)',
      }}>
        {value}
      </span>
    </div>
  );
}

export function StatsScreen({ onBack, onSensors }: Props) {
  const [stats, setStats] = useState(() => DOT.stats());
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = DOT.stats();
      setStats(s);
      setHistory(h => [...h.slice(-40), s.compressionRatio]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const weissman = stats.compressionRatio > 1
    ? (Math.log(stats.compressionRatio) / Math.log(2)).toFixed(2)
    : '—';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg)', fontFamily: 'var(--mono)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'var(--bg-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px rgba(251,191,36,0.5)' }} />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16 }}>Chain</span>
          <span style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.12em' }}>TELEMETRY</span>
        </div>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: '1px solid var(--border)',
            color: 'var(--text-dim)', fontSize: 10, padding: '5px 12px',
            letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 3,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.2)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
          }}
        >← BACK</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {/* Hero metric */}
        <div style={{
          padding: '24px', marginBottom: 20,
          background: 'var(--surface)', border: '1px solid var(--border-warm)',
          borderRadius: 4, textAlign: 'center',
          animation: 'fade-in 0.4s ease both',
        }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-dimmer)', marginBottom: 10, textTransform: 'uppercase' }}>
            Compression Ratio
          </div>
          <div style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic',
            fontSize: 56, lineHeight: 1, color: 'var(--gold)',
            letterSpacing: '-0.02em',
          }}>
            {stats.compressionRatio.toFixed(1)}
            <span style={{ fontSize: 22, opacity: 0.6 }}>×</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dimmer)', marginTop: 8, letterSpacing: '0.05em' }}>
            W = {weissman} &nbsp;·&nbsp; {((stats.predictorAccuracy ?? 0) * 100).toFixed(1)}% predictor accuracy
          </div>
        </div>

        {/* Sparkline */}
        {history.length > 2 && (
          <div style={{
            padding: '16px 20px', marginBottom: 20,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 4, animation: 'slide-up 0.4s ease 0.1s both',
          }}>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-dimmer)', marginBottom: 12, textTransform: 'uppercase' }}>
              Ratio over time
            </div>
            <Sparkline values={history} />
          </div>
        )}

        {/* Stats table */}
        <div style={{
          padding: '4px 20px', marginBottom: 16,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 4, animation: 'slide-up 0.4s ease 0.15s both',
        }}>
          <StatRow label="Total DOTs" value={stats.totalDots.toLocaleString()} />
          <StatRow label="Raw bytes" value={((stats.totalRawBytes ?? stats.totalDots * 153)).toLocaleString() + ' B'} />
          <StatRow label="Active chains" value={stats.totalChains.toString()} />
          <StatRow label="Peers online" value={stats.peersOnline.toString()} />
          <StatRow label="BLS seals" value={(stats.sealCount ?? 0).toString()} />
          <StatRow label="Relay" value={stats.relayConnected ? '● connected' : '○ offline'} accent={stats.relayConnected} />
        </div>

        {/* DOT format legend */}
        <div style={{
          padding: '14px 20px',
          background: 'rgba(251,191,36,0.03)',
          border: '1px solid rgba(251,191,36,0.08)',
          borderRadius: 4, fontSize: 9, lineHeight: 1.9,
          color: 'var(--text-dimmer)', letterSpacing: '0.04em',
          animation: 'fade-in 0.5s ease 0.3s both',
        }}>
          <div style={{ color: 'var(--text-dim)', marginBottom: 8, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 8 }}>
            153 byte format
          </div>
          <div>0–31 &nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--gold)', opacity: 0.6 }}>pubkey</span>&nbsp;&nbsp; Ed25519 identity</div>
          <div>32–95 &nbsp;&nbsp;<span style={{ color: 'var(--gold)', opacity: 0.6 }}>sig &nbsp;&nbsp;&nbsp;</span>&nbsp; Ed25519 proof</div>
          <div>96–127 &nbsp;<span style={{ color: 'var(--gold)', opacity: 0.6 }}>chain &nbsp;</span>&nbsp; SHA-256 link</div>
          <div>128–135 <span style={{ color: 'var(--gold)', opacity: 0.6 }}>ts &nbsp;&nbsp;&nbsp;</span>&nbsp;&nbsp; Unix ms</div>
          <div>136 &nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--gold)', opacity: 0.6 }}>type &nbsp;</span>&nbsp; visibility</div>
          <div>137–152 <span style={{ color: 'var(--gold)', opacity: 0.6 }}>payload</span> 16B content</div>
        </div>

        <button
          onClick={onSensors}
          style={{
            marginTop: 16, width: '100%', padding: '12px 0',
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.1em',
            cursor: 'pointer', borderRadius: 3, transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.2)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
          }}
        >
          SENSOR MESH →
        </button>
      </div>
    </div>
  );
}
