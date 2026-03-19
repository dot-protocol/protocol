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

function MiniSparkline({ values, color = '#00FF41' }: { values: number[]; color?: string }) {
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

  const containerStyle: React.CSSProperties = {
    padding: '16px',
    maxWidth: '480px',
    margin: '0 auto',
    fontFamily: 'monospace',
    color: '#00FF41',
    background: '#030303',
    minHeight: '100vh',
  };
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  };
  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '90px 80px 70px',
    gap: '8px',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid #001100',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: '13px' }}>◉ SENSOR MESH</div>
          <div style={{ fontSize: '10px', opacity: 0.4, marginTop: '2px' }}>
            {availableCount}/{sensorList.length} sensors active
          </div>
        </div>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}
        >
          ← BACK
        </button>
      </div>

      <div style={{
        fontSize: '9px',
        opacity: 0.3,
        marginBottom: '12px',
        display: 'grid',
        gridTemplateColumns: '90px 80px 70px',
        gap: '8px',
      }}>
        <span>SENSOR</span><span>VALUE</span><span>HISTORY</span>
      </div>

      {sensorList.map(([key, sensor]) => (
        <div key={key} style={{ ...rowStyle, opacity: sensor.available ? 1 : 0.3 }}>
          <span style={{ fontSize: '10px' }}>{sensor.label}</span>
          <span style={{ fontSize: '11px', fontWeight: 'bold' }}>
            {sensor.value}{' '}
            <span style={{ opacity: 0.4, fontSize: '9px' }}>{sensor.unit}</span>
          </span>
          <MiniSparkline values={sensor.history} color={sensor.available ? '#00FF41' : '#333'} />
        </div>
      ))}

      <div style={{ marginTop: '20px', fontSize: '9px', opacity: 0.25, lineHeight: '1.8' }}>
        <div>Every sensor is a stream of DOTs waiting to happen.</div>
        <div>Timing jitter is the PUF source — your device's physical fingerprint.</div>
        <div>d = log(N)/log(S) — fractal depth of each observation.</div>
      </div>
    </div>
  );
}
