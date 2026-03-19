import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PeerInfo } from 'dot-protocol';

interface Props {
  did: string;
  peers: PeerInfo[];
  onConnect: () => void;
  onScanPeer: () => void;
}

export function IdentityScreen({ did, peers, onConnect, onScanPeer }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const shortId = did.replace('dot:', '').slice(0, 8);

  useEffect(() => {
    setTimeout(() => setVisible(true), 80);
    QRCode.toDataURL(did, {
      width: 220, margin: 2,
      color: { dark: '#FBBF24', light: '#09090b' },
    }).then(setQrDataUrl).catch(console.error);
  }, [did]);

  async function copyDid() {
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--gold)',
            boxShadow: '0 0 8px rgba(251,191,36,0.5)',
          }} />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 17, letterSpacing: '0.01em' }}>
            DOT
          </span>
          <span style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-dim)', textTransform: 'uppercase', marginLeft: 4 }}>
            Messenger
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.08em' }}>
          v0.2
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 24px 24px',
        gap: 0,
      }}>
        {/* Identity label */}
        <div style={{
          fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'var(--text-dimmer)', marginBottom: 20,
          opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease',
        }}>
          Your Identity
        </div>

        {/* QR code frame */}
        <div style={{
          position: 'relative', marginBottom: 24,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.6s ease 0.1s, transform 0.6s ease 0.1s',
        }}>
          {/* Corner decorations */}
          {[
            { top: -1, left: -1, borderTop: '2px solid var(--gold)', borderLeft: '2px solid var(--gold)' },
            { top: -1, right: -1, borderTop: '2px solid var(--gold)', borderRight: '2px solid var(--gold)' },
            { bottom: -1, left: -1, borderBottom: '2px solid var(--gold)', borderLeft: '2px solid var(--gold)' },
            { bottom: -1, right: -1, borderBottom: '2px solid var(--gold)', borderRight: '2px solid var(--gold)' },
          ].map((style, i) => (
            <div key={i} style={{
              position: 'absolute', width: 14, height: 14, ...style, zIndex: 2,
            }} />
          ))}
          <div style={{
            padding: 12,
            background: '#09090b',
            border: '1px solid rgba(251,191,36,0.14)',
          }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="DOT ID QR" style={{ width: 220, height: 220, display: 'block' }} />
            ) : (
              <div style={{
                width: 220, height: 220,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-dimmer)', fontSize: 10, letterSpacing: '0.05em',
                animation: 'breathe 1.5s ease infinite',
              }}>
                generating…
              </div>
            )}
          </div>
        </div>

        {/* DID display */}
        <div style={{
          width: '100%', maxWidth: 360,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.6s ease 0.2s, transform 0.6s ease 0.2s',
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-dimmer)',
            textTransform: 'uppercase', marginBottom: 8,
          }}>
            DOT Identifier
          </div>
          <div
            onClick={copyDid}
            title="Click to copy"
            style={{
              padding: '12px 14px',
              background: 'var(--surface)',
              border: `1px solid ${copied ? 'rgba(52,211,153,0.35)' : 'var(--border)'}`,
              borderRadius: 3, cursor: 'pointer',
              transition: 'border-color 0.25s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}
            onMouseEnter={e => { if (!copied) (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(251,191,36,0.2)'; }}
            onMouseLeave={e => { if (!copied) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
          >
            <span style={{
              fontSize: 10, letterSpacing: '0.02em',
              color: copied ? 'var(--mint)' : 'var(--text-dim)',
              wordBreak: 'break-all', lineHeight: 1.6,
              transition: 'color 0.25s ease',
            }}>
              {did}
            </span>
            <span style={{
              fontSize: 9, color: copied ? 'var(--mint)' : 'var(--text-dimmer)',
              flexShrink: 0, letterSpacing: '0.08em', transition: 'color 0.25s',
            }}>
              {copied ? '✓ copied' : 'copy'}
            </span>
          </div>
        </div>

        {/* Peers */}
        {peers.length > 0 && (
          <div style={{
            width: '100%', maxWidth: 360, marginTop: 20,
            opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease 0.4s',
          }}>
            <div style={{
              fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-dimmer)',
              textTransform: 'uppercase', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Peers nearby</span>
              <span style={{ color: 'var(--mint)', opacity: 0.7 }}>{peers.length} online</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {peers.map(p => (
                <div key={p.did} style={{
                  padding: '9px 12px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.02em' }}>
                    {p.did.replace('dot:', '').slice(0, 24)}…
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: Date.now() - p.lastSeen < 30000 ? 'var(--mint)' : 'var(--text-dimmer)',
                    }} />
                    <span style={{ fontSize: 9, color: 'var(--text-dimmer)' }}>
                      {Date.now() - p.lastSeen < 30000 ? 'online' : 'away'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {peers.length === 0 && (
          <div style={{
            marginTop: 24, fontSize: 11, color: 'var(--text-dimmer)',
            textAlign: 'center', lineHeight: 1.7,
            opacity: visible ? 1 : 0, transition: 'opacity 0.5s ease 0.4s',
          }}>
            Share your QR code or DOT ID<br />to connect with a peer
          </div>
        )}
      </div>

      {/* CTA buttons */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, flexShrink: 0,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease 0.3s',
      }}>
        <button
          onClick={onScanPeer}
          style={{
            flex: 1, padding: '13px 0',
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-dim)', borderRadius: 3,
            fontSize: 11, letterSpacing: '0.1em', cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.25)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
          }}
        >
          SCAN PEER
        </button>
        <button
          onClick={onConnect}
          style={{
            flex: 2, padding: '13px 0',
            background: 'rgba(251,191,36,0.09)',
            border: '1px solid rgba(251,191,36,0.3)',
            color: 'var(--gold)', borderRadius: 3,
            fontSize: 11, letterSpacing: '0.1em', cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.14)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.45)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.09)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.3)';
          }}
        >
          OPEN MESSENGER →
        </button>
      </div>
    </div>
  );
}
