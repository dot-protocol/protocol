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

// Compression badge color based on ratio
function compressionColor(ratio: number): string {
  if (ratio >= 10) return '#00FF41';   // phosphor green — great
  if (ratio >= 2)  return '#FFAA00';   // amber — decent
  return '#444444';                    // dim — low
}

export function ChatScreen({ myDid, messages, connected, input, onInput, onSend, stats, messagesEndRef, onCamera, onStats }: Props) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const [online, setOnline] = useState(navigator.onLine);

  // Camera prompt: shown when connected and 0 messages
  const [cameraPromptDismissed, setCameraPromptDismissed] = useState(false);
  const showCameraPrompt = connected && messages.length === 0 && !cameraPromptDismissed;

  // Health badge (engine health, polled every 5s)
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'degraded' | 'critical'>('healthy');
  useEffect(() => {
    // Lazy import to avoid circular dep at module load time
    let intervalId: ReturnType<typeof setInterval>;
    import('@dot-protocol/engine').then(({ DOT }) => {
      const check = () => {
        try { setHealthStatus(DOT.health().status); } catch { /* not booted */ }
      };
      check();
      intervalId = setInterval(check, 5000);
    }).catch(() => { /* engine not available — health stays 'healthy' */ });
    return () => { if (intervalId) clearInterval(intervalId); };
  }, []);

  const healthColor = healthStatus === 'healthy' ? '#00FF41' : healthStatus === 'degraded' ? '#FFAA00' : '#FF4400';

  // Predictor trend tracking
  const prevRatioRef = useRef(stats.compressionRatio);
  const [trend, setTrend] = useState<'up' | 'down' | 'flat'>('flat');

  useEffect(() => {
    const current = stats.compressionRatio;
    const prev = prevRatioRef.current;
    if (current > prev + 0.01) setTrend('up');
    else if (current < prev - 0.01) setTrend('down');
    else setTrend('flat');
    prevRatioRef.current = current;
  }, [stats.compressionRatio]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #003300',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '13px', letterSpacing: '0.05em' }}>◉ DOT MESSENGER</div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ fontSize: '10px', opacity: 0.4, letterSpacing: '0.05em' }}>
            {stats.totalDots} dots · {stats.totalRawBytes}B raw
          </div>
          <button
            onClick={onStats}
            style={{
              background: 'none',
              border: '1px solid #002200',
              color: '#00AA2A',
              fontFamily: 'monospace',
              fontSize: '9px',
              padding: '3px 7px',
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            STATS
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        {/* Camera-first prompt: shown on brand-new connected chat */}
        {showCameraPrompt && (
          <div style={{
            margin: '32px auto 0',
            width: '100%',
            maxWidth: '280px',
            background: '#050505',
            border: '1px solid #003300',
            padding: '28px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}>
            <div style={{ fontSize: '28px', lineHeight: 1 }}>📸</div>
            <div style={{
              color: '#00FF41',
              fontSize: '14px',
              fontWeight: 'bold',
              letterSpacing: '0.08em',
              textAlign: 'center',
            }}>
              Capture the moment
            </div>
            <div style={{
              fontSize: '11px',
              opacity: 0.5,
              textAlign: 'center',
              lineHeight: 1.6,
              letterSpacing: '0.03em',
            }}>
              Photograph something.<br />
              Prove it exists on chain.
            </div>
            <button
              onClick={() => { onCamera(); }}
              style={{
                marginTop: '6px',
                background: '#001a00',
                border: '1px solid #00FF41',
                color: '#00FF41',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '12px',
                padding: '10px 28px',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                width: '100%',
              }}
            >
              Take Photo
            </button>
            <div style={{
              fontSize: '9px',
              opacity: 0.3,
              letterSpacing: '0.05em',
              margin: '2px 0',
            }}>
              ─── or ───
            </div>
            <button
              onClick={() => { setCameraPromptDismissed(true); }}
              style={{
                background: 'none',
                border: '1px solid #002200',
                color: '#006600',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: '11px',
                padding: '7px 16px',
                cursor: 'pointer',
                letterSpacing: '0.05em',
                width: '100%',
              }}
            >
              type a message...
            </button>
          </div>
        )}

        {/* Empty state — when prompt is dismissed but still no messages */}
        {!showCameraPrompt && messages.length === 0 && (
          <div style={{
            opacity: 0.25,
            fontSize: '12px',
            textAlign: 'center',
            marginTop: '48px',
            lineHeight: 1.8,
          }}>
            no dots yet.<br />send the first.
          </div>
        )}

        {messages.map(msg => {
          const isMe = msg.from === myDid;
          return (
            <div
              key={msg.id}
              style={{
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
              }}
            >
              <div style={{
                fontSize: '9px',
                opacity: 0.35,
                marginBottom: '3px',
                textAlign: isMe ? 'right' : 'left',
                letterSpacing: '0.05em',
              }}>
                {isMe ? 'you' : msg.from.slice(4, 14)} · {formatTime(msg.timestamp)}{msg.verified ? ' · ✓' : ''}
              </div>
              <div style={{
                background: isMe ? '#001a00' : '#0a0a0a',
                border: `1px solid ${isMe ? '#003300' : '#002200'}`,
                padding: '9px 13px',
                fontSize: '13px',
                lineHeight: '1.5',
                color: isMe ? '#00FF41' : '#00CC33',
                wordBreak: 'break-word',
              }}>
                {msg.content}
                {msg.imageUrl && (
                  <img src={msg.imageUrl} style={{ maxWidth: '200px', marginTop: '4px', display: 'block', border: '1px solid #003300' }} alt="camera DOT" />
                )}
              </div>
              {/* Compression ratio badge — only on sent messages with ratio data */}
              {isMe && msg.compressionRatio !== undefined && (
                <div
                  onClick={onStats}
                  title={`Compression ratio at send time: ${msg.compressionRatio.toFixed(1)}×`}
                  style={{
                    marginTop: '3px',
                    textAlign: 'right',
                    fontSize: '10px',
                    color: compressionColor(msg.compressionRatio),
                    opacity: 0.7,
                    cursor: 'pointer',
                    letterSpacing: '0.04em',
                    userSelect: 'none',
                  }}
                >
                  {msg.compressionRatio.toFixed(1)}×
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
        borderTop: '1px solid #003300',
        display: 'flex',
        gap: '8px',
        flexShrink: 0,
      }}>
        <button
          onClick={onCamera}
          title="Camera DOT"
          style={{
            background: '#050505',
            border: '1px solid #002200',
            color: '#00AA2A',
            fontFamily: 'monospace',
            fontSize: '16px',
            padding: '10px 12px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          📷
        </button>
        <input
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="type a dot..."
          autoFocus
          style={{
            flex: 1,
            background: '#0a0a0a',
            border: '1px solid #003300',
            color: '#00FF41',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: '13px',
            padding: '10px 12px',
            outline: 'none',
          }}
        />
        <button
          onClick={onSend}
          disabled={!input.trim()}
          style={{
            background: input.trim() ? '#001a00' : '#050505',
            border: `1px solid ${input.trim() ? '#00FF41' : '#002200'}`,
            color: input.trim() ? '#00FF41' : '#004400',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: '13px',
            padding: '10px 16px',
            cursor: input.trim() ? 'pointer' : 'default',
            letterSpacing: '0.05em',
            transition: 'all 0.15s',
          }}
        >
          SEND
        </button>
      </div>

      {/* Stats footer */}
      <div style={{
        padding: '4px 16px',
        borderTop: '1px solid #001100',
        fontSize: '9px',
        opacity: 0.25,
        display: 'flex',
        gap: '16px',
        flexShrink: 0,
        letterSpacing: '0.05em',
      }}>
        <span>chain: {stats.totalDots} dots</span>
        <span>raw: {stats.totalRawBytes}B</span>
        <span>
          ratio: {stats.compressionRatio.toFixed(2)}x{' '}
          <span style={{ color: trend === 'up' ? '#00FF41' : trend === 'down' ? '#FF4400' : '#666', opacity: 1 }}>
            {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '—'}
          </span>
        </span>
        <span style={{ color: online ? '#00FF41' : '#FF4400', opacity: online ? 0.25 : 0.8 }}>
          {online ? '● relay' : '○ offline'}
        </span>
        {/* Health badge — engine self-awareness */}
        <span
          title={`Engine health: ${healthStatus}`}
          style={{ color: healthColor, opacity: 0.8 }}
        >
          ● {healthStatus}
        </span>
        <span style={{ marginLeft: 'auto' }}>153B per dot</span>
      </div>
    </div>
  );
}
