import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props { onScan: (did: string) => void; onCancel: () => void; }

export function QRScanScreen({ onScan, onCancel }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [detected, setDetected] = useState(false);
  const scanningRef = useRef(true);
  const [manualDid, setManualDid] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
        rafId = requestAnimationFrame(scan);
      } catch { setError('Camera access denied'); }
    }

    function scan() {
      if (!scanningRef.current) return;
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafId = requestAnimationFrame(scan); return;
      }
      const ctx = canvas.getContext('2d')!;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, canvas.width, canvas.height);
      if (code?.data?.startsWith('dot:')) {
        scanningRef.current = false;
        stream?.getTracks().forEach(t => t.stop());
        setDetected(true);
        setTimeout(() => onScan(code.data), 400);
        return;
      }
      rafId = requestAnimationFrame(scan);
    }

    start();
    return () => { scanningRef.current = false; cancelAnimationFrame(rafId); stream?.getTracks().forEach(t => t.stop()); };
  }, [onScan]);

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
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16 }}>Scan</span>
          <span style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.12em' }}>DOT PEER</span>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)',
            fontSize: 12, padding: '5px 11px', letterSpacing: '0.08em',
            cursor: 'pointer', borderRadius: 3, transition: 'all 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
        >✕ CANCEL</button>
      </div>

      {/* Viewfinder area */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px', gap: 24,
      }}>
        {error ? (
          <div style={{
            padding: '16px 20px', background: 'rgba(248,113,113,0.06)',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4,
            fontSize: 12, color: 'var(--red)', letterSpacing: '0.03em',
          }}>
            {error}
          </div>
        ) : (
          <div style={{
            position: 'relative', width: '100%', maxWidth: 320,
            border: `1px solid ${detected ? 'rgba(52,211,153,0.5)' : 'rgba(251,191,36,0.18)'}`,
            transition: 'border-color 0.3s ease',
            borderRadius: 3, overflow: 'hidden',
          }}>
            {/* Corner targets */}
            {[
              { top: 0, left: 0, borderTop: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}`, borderLeft: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}` },
              { top: 0, right: 0, borderTop: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}`, borderRight: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}` },
              { bottom: 0, left: 0, borderBottom: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}`, borderLeft: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}` },
              { bottom: 0, right: 0, borderBottom: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}`, borderRight: `2px solid ${detected ? 'var(--mint)' : 'var(--gold)'}` },
            ].map((s, i) => (
              <div key={i} style={{ position: 'absolute', width: 18, height: 18, zIndex: 2, transition: 'border-color 0.3s', ...s }} />
            ))}

            {/* Scan line */}
            {!detected && (
              <div style={{
                position: 'absolute', left: 0, right: 0, height: 1, zIndex: 2,
                background: 'linear-gradient(to right, transparent, rgba(251,191,36,0.5), transparent)',
                animation: 'scan-line 2s ease-in-out infinite',
              }} />
            )}

            <video
              ref={videoRef}
              style={{
                width: '100%', display: 'block',
                opacity: detected ? 0.4 : 1,
                transition: 'opacity 0.4s ease',
              }}
              muted playsInline
            />

            {detected && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(52,211,153,0.08)',
                fontSize: 32, animation: 'fade-in 0.3s ease both',
              }}>
                <div style={{ color: 'var(--mint)', textShadow: '0 0 20px var(--mint)' }}>✓</div>
              </div>
            )}

            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        )}

        <div style={{
          fontSize: 10, color: 'var(--text-dimmer)', letterSpacing: '0.08em',
          textAlign: 'center', lineHeight: 1.7,
        }}>
          Point at a DOT ID QR code
        </div>

        {/* Manual paste */}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <div style={{
            fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.12em',
            textAlign: 'center', marginBottom: 10,
          }}>— or paste a DOT ID —</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={manualDid}
              onChange={e => setManualDid(e.target.value)}
              placeholder="dot:…"
              style={{
                flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'var(--mono)',
                fontSize: 11, padding: '10px 12px', borderRadius: 3, outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'rgba(251,191,36,0.22)'; }}
              onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)'; }}
            />
            <button
              onClick={() => manualDid.startsWith('dot:') && onScan(manualDid)}
              disabled={!manualDid.startsWith('dot:')}
              style={{
                padding: '0 14px',
                background: manualDid.startsWith('dot:') ? 'rgba(251,191,36,0.1)' : 'transparent',
                border: `1px solid ${manualDid.startsWith('dot:') ? 'rgba(251,191,36,0.3)' : 'var(--border)'}`,
                color: manualDid.startsWith('dot:') ? 'var(--gold)' : 'var(--text-dimmer)',
                fontSize: 10, letterSpacing: '0.08em', cursor: manualDid.startsWith('dot:') ? 'pointer' : 'default',
                borderRadius: 3, transition: 'all 0.2s', flexShrink: 0,
              }}
            >
              CONNECT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
