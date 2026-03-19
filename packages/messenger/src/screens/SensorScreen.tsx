import React, { useEffect, useState, useRef } from 'react';

interface SensorReading {
  label: string;
  value: string;
  history: number[];
  unit: string;
  available: boolean;
}

interface Props {
  onBack: () => void;
}

function MiniSparkline({ values, color = 'rgba(251,191,36,0.7)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <span style={{ opacity: 0.3, fontSize: '10px' }}>···</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 60, h = 16;
  const pts = values.slice(-20).map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" />
    </svg>
  );
}

export function SensorScreen({ onBack }: Props) {
  const [sensors, setSensors] = useState<Record<string, SensorReading>>({
    accel_x:      { label: 'Accel X',   value: '—', history: [], unit: 'm/s²', available: false },
    accel_y:      { label: 'Accel Y',   value: '—', history: [], unit: 'm/s²', available: false },
    accel_z:      { label: 'Accel Z',   value: '—', history: [], unit: 'm/s²', available: false },
    gyro_x:       { label: 'Gyro X',    value: '—', history: [], unit: '°/s',  available: false },
    gyro_y:       { label: 'Gyro Y',    value: '—', history: [], unit: '°/s',  available: false },
    gyro_z:       { label: 'Gyro Z',    value: '—', history: [], unit: '°/s',  available: false },
    orient_alpha: { label: 'Orient α',  value: '—', history: [], unit: '°',    available: false },
    orient_beta:  { label: 'Orient β',  value: '—', history: [], unit: '°',    available: false },
    orient_gamma: { label: 'Orient γ',  value: '—', history: [], unit: '°',    available: false },
    battery:      { label: 'Battery',   value: '—', history: [], unit: '%',    available: false },
    memory:       { label: 'Memory',    value: '—', history: [], unit: 'MB',   available: false },
    timing:       { label: 'Jitter',    value: '—', history: [], unit: 'μs',   available: false },
  });

  const frameRef = useRef(0);
  void frameRef;

  function update(key: string, num: number, display?: string) {
    setSensors(prev => {
      const s = prev[key];
      if (!s) return prev;
      const history = [...s.history.slice(-50), num];
      return {
        ...prev,
        [key]: {
          ...s,
          value: display ?? num.toFixed(3),
          history,
          available: true,
        },
      };
    });
  }

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // DeviceMotion (accelerometer + gyroscope)
    function onMotion(e: DeviceMotionEvent) {
      const a = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      if (a) {
        if (a.x != null) update('accel_x', a.x);
        if (a.y != null) update('accel_y', a.y);
        if (a.z != null) update('accel_z', a.z);
      }
      if (r) {
        if (r.alpha != null) update('gyro_x', r.alpha);
        if (r.beta  != null) update('gyro_y', r.beta);
        if (r.gamma != null) update('gyro_z', r.gamma);
      }
    }
    window.addEventListener('devicemotion', onMotion);
    cleanups.push(() => window.removeEventListener('devicemotion', onMotion));

    // DeviceOrientation
    function onOrientation(e: DeviceOrientationEvent) {
      if (e.alpha != null) update('orient_alpha', e.alpha);
      if (e.beta  != null) update('orient_beta',  e.beta);
      if (e.gamma != null) update('orient_gamma', e.gamma);
    }
    window.addEventListener('deviceorientation', onOrientation);
    cleanups.push(() => window.removeEventListener('deviceorientation', onOrientation));

    // Battery API
    async function initBattery() {
      try {
        const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (e: string, fn: () => void) => void; removeEventListener: (e: string, fn: () => void) => void }> };
        if (nav.getBattery) {
          const battery = await nav.getBattery();
          const pct = Math.round(battery.level * 100);
          update('battery', pct, `${pct}%`);
          const onBattery = () => {
            const p = Math.round(battery.level * 100);
            update('battery', p, `${p}%`);
          };
          battery.addEventListener('levelchange', onBattery);
          cleanups.push(() => battery.removeEventListener('levelchange', onBattery));
        }
      } catch {
        // Battery API not available or denied — silent
      }
    }
    void initBattery();

    // Memory (Chrome only)
    function pollMemory() {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      if (perf.memory) {
        const mb = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
        update('memory', mb, `${mb} MB`);
      }
    }
    const memInterval = setInterval(pollMemory, 1000);
    pollMemory();
    cleanups.push(() => clearInterval(memInterval));

    // Timing jitter (PUF source — device physical fingerprint)
    function measureJitter() {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) performance.now();
      const t1 = performance.now();
      const jitter = (t1 - t0) * 1000; // microseconds
      update('timing', Math.round(jitter), `${Math.round(jitter)} μs`);
    }
    const jitterInterval = setInterval(measureJitter, 500);
    measureJitter();
    cleanups.push(() => clearInterval(jitterInterval));

    return () => cleanups.forEach(fn => fn());
  }, []);

  const sensorList = Object.entries(sensors);
  const availableCount = sensorList.filter(([, s]) => s.available).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'var(--bg-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px rgba(251,191,36,0.5)' }} />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16 }}>Sensor</span>
          <span style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.12em' }}>MESH</span>
          <span style={{ fontSize: 9, color: 'var(--text-dimmer)', opacity: 0.5 }}>
            {availableCount}/{sensorList.length} active
          </span>
        </div>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)',
          fontSize: 10, padding: '5px 12px', letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 3,
        }}>← BACK</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '100px 100px 1fr',
          gap: 8, marginBottom: 8,
          fontSize: 8, color: 'var(--text-dimmer)', letterSpacing: '0.14em', textTransform: 'uppercase',
          padding: '0 0 8px', borderBottom: '1px solid var(--border)',
        }}>
          <span>Sensor</span><span>Value</span><span>History</span>
        </div>

        {sensorList.map(([key, sensor]) => (
          <div key={key} style={{
            display: 'grid', gridTemplateColumns: '100px 100px 1fr',
            gap: 8, alignItems: 'center',
            padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
            opacity: sensor.available ? 1 : 0.25,
            transition: 'opacity 0.4s ease',
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
              {sensor.label}
            </span>
            <span style={{ fontSize: 12, color: sensor.available ? 'var(--text)' : 'var(--text-dimmer)', fontWeight: 500 }}>
              {sensor.value}
              <span style={{ fontSize: 9, color: 'var(--text-dimmer)', marginLeft: 3 }}>{sensor.unit}</span>
            </span>
            <MiniSparkline values={sensor.history} color={sensor.available ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.1)'} />
          </div>
        ))}

        <div style={{
          marginTop: 28, padding: '14px 16px',
          background: 'rgba(251,191,36,0.03)', border: '1px solid rgba(251,191,36,0.07)',
          borderRadius: 3, fontSize: 9, lineHeight: 2,
          color: 'var(--text-dimmer)', letterSpacing: '0.04em',
        }}>
          <div>Every sensor is a stream of DOTs waiting to happen.</div>
          <div>Timing jitter is the PUF — your device's physical fingerprint.</div>
          <div style={{ color: 'var(--text-dimmer)', opacity: 0.6 }}>d = log(N)/log(S) — fractal depth of each observation</div>
        </div>
      </div>
    </div>
  );
}
