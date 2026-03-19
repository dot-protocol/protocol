import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export interface Message {
  id: string;
  from: string;
  content: string;
  timestamp: number;
  verified: boolean;
  imageUrl?: string;
  compressionRatio?: number;
}

interface Props {
  myDid: string;
  messages: Message[];
  connected: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  stats: { totalDots: number; totalRawBytes: number; compressionRatio: number };
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onCamera: () => void;
  onStats: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatScreen({ myDid, messages, connected, input, onInput, onSend, stats, messagesEndRef, onCamera, onStats }: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [cameraPromptDismissed, setCameraPromptDismissed] = useState(false);
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'degraded' | 'critical'>('healthy');
  const prevRatioRef = useRef(stats.compressionRatio);
  const [trend, setTrend] = useState<'up' | 'down' | 'flat'>('flat');
  const inputRef = useRef<HTMLInputElement>(null);

  const showCameraPrompt = connected && messages.length === 0 && !cameraPromptDismissed;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    import('dot-protocol').then(({ DOT }) => {
      const check = () => { try { setHealthStatus(DOT.health().status); } catch {} };
      check(); id = setInterval(check, 5000);
    }).catch(() => {});
    return () => { if (id) clearInterval(id); };
  }, []);

  useEffect(() => {
    const cur = stats.compressionRatio, prev = prevRatioRef.current;
    if (cur > prev + 0.01) setTrend('up');
    else if (cur < prev - 0.01) setTrend('down');
    else setTrend('flat');
    prevRatioRef.current = cur;
  }, [stats.compressionRatio]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  }, [onSend]);

  const healthColor = healthStatus === 'healthy' ? 'var(--mint)' : healthStatus === 'degraded' ? 'var(--gold)' : 'var(--red)';
  const trendColor  = trend === 'up' ? 'var(--mint)' : trend === 'down' ? 'var(--red)' : 'var(--text-dimmer)';
  const trendGlyph  = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'var(--bg-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: online ? 'var(--mint)' : 'var(--text-dimmer)',
            boxShadow: online ? '0 0 6px rgba(52,211,153,0.5)' : 'none',
          }} />
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 16, color: 'var(--text)' }}>
            DOT
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.1em' }}>
            MESSENGER
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dimmer)', letterSpacing: '0.03em' }}>
            <span style={{ color: trendColor, marginRight: 3, fontSize: 9 }}>{trendGlyph}</span>
            {stats.compressionRatio.toFixed(1)}×
          </div>
          <button
            onClick={onStats}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-dim)', fontSize: 9, padding: '4px 9px',
              letterSpacing: '0.1em', cursor: 'pointer', borderRadius: 3,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.25)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
            }}
          >STATS</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Camera-first prompt */}
        {showCameraPrompt && (
          <div style={{
            margin: '24px auto 0', width: '100%', maxWidth: 300,
            background: 'var(--surface)',
            border: '1px solid var(--border-warm)',
            borderRadius: 6, padding: '28px 24px 24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            animation: 'slide-up 0.5s ease both',
          }}>
            {/* Icon ring */}
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              border: '1px solid rgba(251,191,36,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(251,191,36,0.05)',
              fontSize: 22,
            }}>
              ◎
            </div>
            <div>
              <div style={{
                fontFamily: 'var(--serif)', fontStyle: 'italic',
                fontSize: 17, textAlign: 'center', marginBottom: 6, color: 'var(--text)',
              }}>
                Capture the moment
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-dim)', textAlign: 'center',
                lineHeight: 1.7, letterSpacing: '0.02em',
              }}>
                Photograph something.<br />Prove it exists on chain.
              </div>
            </div>
            <button
              onClick={onCamera}
              style={{
                width: '100%', padding: '12px 0',
                background: 'rgba(251,191,36,0.09)',
                border: '1px solid rgba(251,191,36,0.28)',
                color: 'var(--gold)', fontSize: 11, letterSpacing: '0.1em',
                cursor: 'pointer', borderRadius: 3, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.14)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.09)'; }}
            >
              TAKE PHOTO
            </button>
            <div style={{ fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.1em' }}>— or —</div>
            <button
              onClick={() => setCameraPromptDismissed(true)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-dimmer)',
                fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em',
                padding: '4px 0',
              }}
            >
              type a message
            </button>
          </div>
        )}

        {/* Empty state */}
        {!showCameraPrompt && messages.length === 0 && (
          <div style={{
            textAlign: 'center', marginTop: 60, color: 'var(--text-dimmer)',
            fontSize: 12, lineHeight: 2, letterSpacing: '0.03em',
            animation: 'fade-in 0.5s ease both',
          }}>
            no dots yet<br />
            <span style={{ fontSize: 10, opacity: 0.6 }}>send the first</span>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, idx) => {
          const isMe = msg.from === myDid;
          return (
            <div key={msg.id} style={{
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              animation: `${isMe ? 'slide-in-r' : 'slide-in-l'} 0.3s ease both`,
              animationDelay: `${Math.min(idx * 0.04, 0.3)}s`,
            }}>
              {/* Sender + time */}
              <div style={{
                fontSize: 9, color: 'var(--text-dimmer)', marginBottom: 4,
                letterSpacing: '0.04em',
                textAlign: isMe ? 'right' : 'left',
                display: 'flex', gap: 6,
                justifyContent: isMe ? 'flex-end' : 'flex-start',
                alignItems: 'center',
              }}>
                {!isMe && <span>{msg.from.replace('dot:', '').slice(0, 8)}…</span>}
                <span>{formatTime(msg.timestamp)}</span>
                {msg.verified && (
                  <span style={{ color: 'var(--mint)', opacity: 0.7 }}>✓</span>
                )}
                {isMe && <span style={{ fontSize: 8, opacity: 0.6 }}>you</span>}
              </div>

              {/* Bubble */}
              <div style={{
                padding: '10px 14px',
                background: isMe ? 'rgba(251,191,36,0.07)' : 'var(--surface)',
                border: `1px solid ${isMe ? 'rgba(251,191,36,0.2)' : 'var(--border)'}`,
                borderRadius: isMe ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                fontSize: 13, lineHeight: 1.55, color: 'var(--text)',
                wordBreak: 'break-word',
              }}>
                {msg.content}
                {msg.imageUrl && (
                  <img
                    src={msg.imageUrl}
                    style={{ maxWidth: 200, marginTop: 8, display: 'block', borderRadius: 3, border: '1px solid var(--border)' }}
                    alt="camera DOT"
                  />
                )}
              </div>

              {/* Compression badge */}
              {isMe && msg.compressionRatio !== undefined && (
                <div
                  onClick={onStats}
                  style={{
                    marginTop: 4, textAlign: 'right', fontSize: 9,
                    color: msg.compressionRatio >= 10 ? 'var(--mint)' : msg.compressionRatio >= 2 ? 'var(--gold)' : 'var(--text-dimmer)',
                    opacity: 0.6, cursor: 'pointer', letterSpacing: '0.06em',
                  }}
                >
                  {msg.compressionRatio.toFixed(1)}× compressed
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, flexShrink: 0,
        background: 'var(--bg-2)',
      }}>
        <button
          onClick={onCamera}
          title="Camera DOT"
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text-dim)', padding: '0 14px',
            fontSize: 16, cursor: 'pointer', borderRadius: 3, flexShrink: 0,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.25)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
          }}
        >
          ◎
        </button>

        <input
          ref={inputRef}
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="type a dot…"
          autoFocus
          style={{
            flex: 1,
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text)', fontFamily: 'var(--mono)',
            fontSize: 13, padding: '11px 14px', borderRadius: 3,
            outline: 'none', transition: 'border-color 0.2s',
          }}
          onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'rgba(251,191,36,0.22)'; }}
          onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)'; }}
        />

        <button
          onClick={onSend}
          disabled={!input.trim()}
          style={{
            padding: '0 18px',
            background: input.trim() ? 'rgba(251,191,36,0.1)' : 'transparent',
            border: `1px solid ${input.trim() ? 'rgba(251,191,36,0.35)' : 'var(--border)'}`,
            color: input.trim() ? 'var(--gold)' : 'var(--text-dimmer)',
            fontSize: 10, letterSpacing: '0.12em', cursor: input.trim() ? 'pointer' : 'default',
            borderRadius: 3, transition: 'all 0.2s', flexShrink: 0,
          }}
          onMouseEnter={e => {
            if (input.trim()) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.16)';
          }}
          onMouseLeave={e => {
            if (input.trim()) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.1)';
          }}
        >
          SEND
        </button>
      </div>

      {/* Chain telemetry strip */}
      <div style={{
        padding: '5px 16px', borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', gap: 16, flexShrink: 0, background: 'var(--bg)',
        fontSize: 9, letterSpacing: '0.05em',
      }}>
        <span style={{ color: 'var(--text-dimmer)' }}>
          {stats.totalDots} <span style={{ opacity: 0.5 }}>dots</span>
        </span>
        <span style={{ color: trendColor }}>
          {stats.compressionRatio.toFixed(2)}× {trendGlyph}
        </span>
        <span style={{ color: online ? 'var(--mint)' : 'var(--red)', opacity: 0.7 }}>
          {online ? '● relay' : '○ offline'}
        </span>
        <span style={{ color: healthColor, opacity: 0.7 }}>
          ● {healthStatus}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-dimmer)', opacity: 0.5 }}>
          153B·dot
        </span>
      </div>
    </div>
  );
}
