import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onScan: (did: string) => void;
  onCancel: () => void;
}

export function QRScanScreen({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const scanningRef = useRef(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        requestAnimationFrame(scan);
      } catch {
        setError('Camera access denied. Use manual paste below.');
      }
    }

    function scan() {
      if (!scanningRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafId = requestAnimationFrame(scan);
        return;
      }
      const ctx = canvas.getContext('2d')!;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code?.data?.startsWith('dot:')) {
        scanningRef.current = false;
        stream?.getTracks().forEach(t => t.stop());
        onScan(code.data);
        return;
      }
      rafId = requestAnimationFrame(scan);
    }

    start();
    return () => {
      scanningRef.current = false;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [onScan]);

  const [manualDid, setManualDid] = useState('');

  return (
    <div style={{ padding: '16px', maxWidth: '480px', margin: '0 auto', fontFamily: 'monospace', color: '#00FF41', background: '#030303', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ SCAN DOT ID</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>✕</button>
      </div>

      {error && <div style={{ color: '#FF4400', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

      {!error && (
        <>
          <video ref={videoRef} style={{ width: '100%', border: '1px solid #003300' }} muted playsInline />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </>
      )}

      <div style={{ marginTop: '16px', fontSize: '11px', opacity: 0.5, textAlign: 'center' }}>— or paste manually —</div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input
          value={manualDid}
          onChange={e => setManualDid(e.target.value)}
          placeholder="dot:..."
          style={{ flex: 1, background: '#0a0a0a', border: '1px solid #003300', color: '#00FF41', fontFamily: 'monospace', fontSize: '11px', padding: '8px' }}
        />
        <button
          onClick={() => manualDid.startsWith('dot:') && onScan(manualDid)}
          disabled={!manualDid.startsWith('dot:')}
          style={{ background: '#001a00', border: '1px solid #00FF41', color: '#00FF41', fontFamily: 'monospace', fontSize: '11px', padding: '8px 12px', cursor: 'pointer' }}
        >
          CONNECT
        </button>
      </div>
    </div>
  );
}
