import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PeerInfo } from '@dot-protocol/engine';

interface Props {
  did: string;
  peers: PeerInfo[];
  onConnect: () => void;
  onScanPeer: () => void;
}

export function IdentityScreen({ did, peers, onConnect, onScanPeer }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(did, {
      width: 200,
      margin: 1,
      color: { dark: '#00FF41', light: '#000000' },
    }).then(setQrDataUrl).catch(console.error);
  }, [did]);

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ fontSize: '11px', opacity: 0.4, marginBottom: '4px', letterSpacing: '0.1em' }}>
        DOT MESSENGER v0.1
      </div>
      <div style={{ fontSize: '18px', marginBottom: '24px', letterSpacing: '0.05em' }}>
        ◉ IDENTITY
      </div>

      {qrDataUrl ? (
        <div style={{ marginBottom: '16px', border: '1px solid #003300', display: 'inline-block', padding: '8px' }}>
          <img src={qrDataUrl} alt="DOT ID QR code" style={{ width: 200, height: 200, display: 'block' }} />
        </div>
      ) : (
        <div style={{
          width: 216, height: 216, border: '1px solid #003300',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '16px', opacity: 0.3, fontSize: '11px',
        }}>
          generating qr...
        </div>
      )}

      <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '4px', letterSpacing: '0.08em' }}>
        YOUR DOT ID
      </div>
      <div
        onClick={copyDid}
        style={{
          fontFamily: 'monospace',
          fontSize: '11px',
          background: '#0a0a0a',
          border: '1px solid #003300',
          padding: '10px',
          marginBottom: '8px',
          wordBreak: 'break-all',
          cursor: 'pointer',
          color: copied ? '#00FF41' : '#00AA2A',
          transition: 'color 0.2s',
        }}
      >
        {did}
      </div>
      {copied && (
        <div style={{ fontSize: '10px', opacity: 0.5, marginBottom: '8px' }}>copied to clipboard</div>
      )}

      {peers.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', opacity: 0.4, marginBottom: '6px', letterSpacing: '0.08em' }}>
            PEERS ONLINE ({peers.length})
          </div>
          {peers.map(p => (
            <div
              key={p.did}
              style={{
                fontSize: '11px',
                padding: '6px 0',
                borderBottom: '1px solid #001100',
                color: '#00AA2A',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{p.did.slice(0, 28)}...</span>
              <span style={{ opacity: 0.4, fontSize: '9px' }}>
                {Date.now() - p.lastSeen < 30000 ? 'online' : 'away'}
              </span>
            </div>
          ))}
        </div>
      )}

      {peers.length === 0 && (
        <div style={{ fontSize: '11px', opacity: 0.3, marginBottom: '16px' }}>
          share your DOT ID to connect with peers
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button
          onClick={onScanPeer}
          style={{
            background: '#000',
            border: '1px solid #003300',
            color: '#00AA2A',
            padding: '12px 16px',
            fontFamily: 'monospace',
            fontSize: '13px',
            cursor: 'pointer',
            letterSpacing: '0.08em',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = '#001a00'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = '#000'; }}
        >
          SCAN PEER
        </button>
        <button
          onClick={onConnect}
          style={{
            background: '#000',
            border: '1px solid #00FF41',
            color: '#00FF41',
            padding: '12px 24px',
            fontFamily: 'monospace',
            fontSize: '13px',
            cursor: 'pointer',
            flex: 1,
            letterSpacing: '0.08em',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = '#001a00'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = '#000'; }}
        >
          OPEN MESSENGER →
        </button>
      </div>
    </div>
  );
}
