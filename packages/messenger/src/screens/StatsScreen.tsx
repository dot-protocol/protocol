import React, { useEffect, useState } from 'react';
import { DOT } from '@dot-protocol/engine';

interface Props {
  onBack: () => void;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 2);
  const min = Math.min(...values, 0.9);
  const h = 40;
  const w = Math.min(values.length * 8, 320);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / (max - min + 0.001)) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke="#00FF41" strokeWidth="1.5" />
    </svg>
  );
}

export function StatsScreen({ onBack }: Props) {
  const [stats, setStats] = useState(() => DOT.stats());
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = DOT.stats();
      setStats(s);
      setHistory(h => [...h.slice(-30), s.compressionRatio]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const row = (label: string, value: string) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #001100' }}>
      <span style={{ fontSize: '11px', opacity: 0.6 }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto', fontFamily: 'monospace', color: '#00FF41', background: '#030303', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ ENGINE STATS</span>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>← BACK</button>
      </div>

      {row('total DOTs', stats.totalDots.toString())}
      {row('raw bytes', (stats.totalRawBytes ?? stats.totalDots * 153).toLocaleString() + ' B')}
      {row('compression', stats.compressionRatio.toFixed(2) + '×')}
      {row('predictor accuracy', ((stats.predictorAccuracy ?? 0) * 100).toFixed(1) + '%')}
      {row('active chains', stats.totalChains.toString())}
      {row('relay', stats.relayConnected ? 'connected ●' : 'offline ○')}
      {row('peers online', stats.peersOnline.toString())}

      {history.length > 1 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '4px' }}>COMPRESSION OVER TIME</div>
          <Sparkline values={history} />
        </div>
      )}

      <div style={{ marginTop: '24px', fontSize: '10px', opacity: 0.3, lineHeight: '1.8' }}>
        <div>d = log(N)/log(S)</div>
        <div>at d=1 → classical bit</div>
        <div>at d=2 → qubit equivalent</div>
        <div>at d&gt;2 → fractal depth</div>
        <div style={{ marginTop: '8px' }}>W = 29.2 @ N=1000</div>
      </div>
    </div>
  );
}
