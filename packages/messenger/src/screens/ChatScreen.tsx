import React, { RefObject, useCallback } from 'react';

export interface Message {
  id: string;
  from: string;
  content: string;
  timestamp: number;
  verified: boolean;
}

interface Props {
  myDid: string;
  messages: Message[];
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  stats: { totalDots: number; totalRawBytes: number; compressionRatio: number };
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatScreen({ myDid, messages, input, onInput, onSend, stats, messagesEndRef }: Props) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

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
        <div style={{ fontSize: '10px', opacity: 0.4, letterSpacing: '0.05em' }}>
          {stats.totalDots} dots · {stats.totalRawBytes}B raw
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
        {messages.length === 0 && (
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
              </div>
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
        <span>ratio: {stats.compressionRatio.toFixed(2)}x</span>
        <span style={{ marginLeft: 'auto' }}>153B per dot</span>
      </div>
    </div>
  );
}
