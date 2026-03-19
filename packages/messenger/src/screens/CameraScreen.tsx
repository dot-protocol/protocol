import React, { useRef, useState, useEffect } from 'react';

interface Props {
  onCapture: (imageUrl: string, hashPayload: Uint8Array) => void;
  onCancel: () => void;
}

export function CameraScreen({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }
      })
      .catch(() => setError('Camera access denied'));

    return () => {
      setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    };
  }, []);

  async function capture() {
    const canvas = canvasRef.current!;
    const video = videoRef.current!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
    const arrayBuf = await blob.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuf);
    const hashPayload = new Uint8Array(hashBuf).slice(0, 16);

    stream?.getTracks().forEach(t => t.stop());
    const url = URL.createObjectURL(blob);
    onCapture(url, hashPayload);
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#00FF41', background: '#030303', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px' }}>◉ CAMERA DOT</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: '#00FF41', cursor: 'pointer', fontSize: '13px' }}>✕</button>
      </div>
      {error ? (
        <div style={{ color: '#FF4400', fontSize: '12px' }}>{error}</div>
      ) : (
        <>
          <video ref={videoRef} muted playsInline style={{ width: '100%', border: '1px solid #003300' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <button
            onClick={capture}
            style={{ marginTop: '12px', width: '100%', background: '#001a00', border: '1px solid #00FF41', color: '#00FF41', fontFamily: 'monospace', fontSize: '14px', padding: '14px', cursor: 'pointer' }}
          >
            ◉ CAPTURE
          </button>
        </>
      )}
    </div>
  );
}
