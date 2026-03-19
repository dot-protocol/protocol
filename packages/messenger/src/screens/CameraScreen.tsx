import React, { useRef, useState, useEffect } from 'react';

interface Props {
  onCapture: (imageUrl: string, hashPayload: Uint8Array) => void;
  onCancel: () => void;
}

export function CameraScreen({ onCapture, onCancel }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream]     = useState<MediaStream | null>(null);
  const [error, setError]       = useState('');
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured]   = useState(false);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        setStream(s);
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
      })
      .catch(() => setError('Camera access denied'));
    return () => { setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; }); };
  }, []);

  async function capture() {
    if (capturing || captured) return;
    setCapturing(true);
    const canvas = canvasRef.current!, video = videoRef.current!;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob     = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.8));
    const buf      = await blob.arrayBuffer();
    const hashBuf  = await crypto.subtle.digest('SHA-256', buf);
    const payload  = new Uint8Array(hashBuf).slice(0, 16);
    stream?.getTracks().forEach(t => t.stop());
    const url = URL.createObjectURL(blob);
    setCaptured(true);
    setTimeout(() => onCapture(url, payload), 350);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      {/* Header overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '20px 20px 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 6px rgba(251,191,36,0.6)' }} />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 15, color: '#fff' }}>Camera</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>DOT</span>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.7)', fontSize: 11, padding: '5px 12px',
            letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 3,
          }}
        >✕</button>
      </div>

      {error ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
        }}>
          <div style={{
            padding: '16px 20px', background: 'rgba(248,113,113,0.07)',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4,
            fontSize: 12, color: 'var(--red)', letterSpacing: '0.03em',
          }}>{error}</div>
          <button onClick={onCancel} style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)',
            padding: '10px 20px', fontSize: 11, letterSpacing: '0.1em', cursor: 'pointer', borderRadius: 3,
          }}>GO BACK</button>
        </div>
      ) : (
        <>
          {/* Viewfinder — full bleed */}
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              muted playsInline
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                opacity: captured ? 0.3 : 1, transition: 'opacity 0.35s ease',
              }}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Reticle */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 180, height: 180, position: 'relative',
                opacity: captured ? 0 : 0.6, transition: 'opacity 0.3s',
              }}>
                {[
                  { top: 0, left: 0, borderTop: '2px solid var(--gold)', borderLeft: '2px solid var(--gold)' },
                  { top: 0, right: 0, borderTop: '2px solid var(--gold)', borderRight: '2px solid var(--gold)' },
                  { bottom: 0, left: 0, borderBottom: '2px solid var(--gold)', borderLeft: '2px solid var(--gold)' },
                  { bottom: 0, right: 0, borderBottom: '2px solid var(--gold)', borderRight: '2px solid var(--gold)' },
                ].map((s, i) => (
                  <div key={i} style={{ position: 'absolute', width: 24, height: 24, ...s }} />
                ))}
              </div>
            </div>

            {/* Captured checkmark */}
            {captured && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                animation: 'fade-in 0.3s ease both',
              }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: 'rgba(52,211,153,0.12)',
                  border: '2px solid var(--mint)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, color: 'var(--mint)',
                  boxShadow: '0 0 30px rgba(52,211,153,0.3)',
                }}>✓</div>
              </div>
            )}
          </div>

          {/* Capture button */}
          <div style={{
            padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.9)', flexShrink: 0,
          }}>
            <button
              onClick={capture}
              disabled={capturing}
              style={{
                width: 72, height: 72, borderRadius: '50%',
                background: captured ? 'var(--mint)' : 'rgba(251,191,36,0.12)',
                border: `3px solid ${captured ? 'var(--mint)' : 'var(--gold)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: capturing ? 'default' : 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: captured ? '0 0 24px rgba(52,211,153,0.4)' : '0 0 20px rgba(251,191,36,0.2)',
              }}
              onMouseEnter={e => { if (!capturing) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.2)'; } }}
              onMouseLeave={e => { if (!capturing) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.12)'; } }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: captured ? '#fff' : 'var(--gold)',
                transition: 'all 0.3s',
              }} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
