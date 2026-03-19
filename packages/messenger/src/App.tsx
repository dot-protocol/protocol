import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DOT, type PeerInfo } from '@dot-protocol/engine';
import { BootScreen } from './screens/BootScreen.js';
import { IdentityScreen } from './screens/IdentityScreen.js';
import { ChatScreen } from './screens/ChatScreen.js';
import type { Message } from './screens/ChatScreen.js';

type Screen = 'boot' | 'identity' | 'chat';

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [myDid, setMyDid] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [stats, setStats] = useState({
    totalDots: 0,
    totalRawBytes: 0,
    compressionRatio: 1,
  });
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function boot() {
      try {
        await DOT.boot({ relayUrl: 'wss://dotdotdot.rocks' });
        const did = DOT.me?.did ?? '';
        setMyDid(did);
        setScreen('identity');

        // Listen for incoming dots
        DOT.on('dot', (dotBytes: unknown, from: unknown) => {
          const bytes = dotBytes as Uint8Array;
          const sender = from as string;

          // Decode WHAT from payload [137..152]
          const payload = bytes.slice(137, 153);
          let content = '';
          try {
            content = new TextDecoder().decode(payload).replace(/\0/g, '').trim();
          } catch {
            content = '[binary payload]';
          }

          setMessages(prev => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2),
              from: sender,
              content,
              timestamp: Date.now(),
              verified: true,
            },
          ]);

          setStats(DOT.stats());
          // Scroll to bottom on next tick
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        });

        // Listen for peer changes
        DOT.on('peer', (peer: unknown) => {
          const p = peer as PeerInfo;
          setPeers(prev => {
            const existing = prev.find(x => x.did === p.did);
            if (existing) return prev.map(x => (x.did === p.did ? p : x));
            return [...prev, p];
          });
        });
      } catch (err) {
        console.error('[DOT] Boot failed:', err);
        // Still proceed to identity screen with fallback DID
        setMyDid('dot:error-booting');
        setScreen('identity');
      }
    }

    boot();
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    try {
      await DOT.create({ WHAT: text });
    } catch (err) {
      console.error('[DOT] create failed:', err);
    }

    // Optimistic local echo
    setMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        from: myDid,
        content: text,
        timestamp: Date.now(),
        verified: true,
      },
    ]);

    setStats(DOT.stats());
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [input, myDid]);

  if (screen === 'boot') return <BootScreen />;

  if (screen === 'identity') {
    return (
      <IdentityScreen
        did={myDid}
        peers={peers}
        onConnect={() => setScreen('chat')}
      />
    );
  }

  return (
    <ChatScreen
      myDid={myDid}
      messages={messages}
      input={input}
      onInput={setInput}
      onSend={sendMessage}
      stats={stats}
      messagesEndRef={messagesEndRef}
    />
  );
}
