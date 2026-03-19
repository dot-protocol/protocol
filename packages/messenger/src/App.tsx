import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DOT, type PeerInfo } from '@dot-protocol/engine';
import { BootScreen } from './screens/BootScreen.js';
import { IdentityScreen } from './screens/IdentityScreen.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { QRScanScreen } from './screens/QRScanScreen.js';
import { CameraScreen } from './screens/CameraScreen.js';
import { StatsScreen } from './screens/StatsScreen.js';
import { SensorScreen } from './screens/SensorScreen.js';
import type { Message } from './screens/ChatScreen.js';

type Screen = 'boot' | 'identity' | 'qrscan' | 'camera' | 'chat' | 'stats' | 'sensors';

function didToPublicKey(did: string): Uint8Array {
  // DID format: "dot:<base64url(pubkey)>"
  const b64url = did.replace('dot:', '');
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
  const [connected, setConnected] = useState(false);
  const [imageCache, setImageCache] = useState<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function boot() {
      try {
        const relayUrl = import.meta.env.VITE_RELAY_URL ?? 'wss://dotdotdot.rocks';
        await DOT.boot({ relayUrl });
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
      // Send to first peer's channel (private DM) or broadcast if no peers
      const recipient = peers[0] as PeerInfo | undefined;
      await DOT.create({ WHAT: text, WHO: recipient?.publicKey });
    } catch (err) {
      console.error('[DOT] create failed:', err);
    }

    // Capture compression ratio at this moment (after DOT created)
    const currentStats = DOT.stats();
    const compressionRatio = currentStats.compressionRatio;

    // Optimistic local echo
    setMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        from: myDid,
        content: text,
        timestamp: Date.now(),
        verified: true,
        compressionRatio,
      },
    ]);

    setStats(currentStats);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [input, myDid, peers]);

  const handleScan = useCallback((did: string) => {
    // Extract public key from DID and add as peer
    try {
      const publicKey = didToPublicKey(did);
      const newPeer: PeerInfo = { did, publicKey, lastSeen: Date.now(), connectedVia: 'qr' };
      setPeers(prev => {
        const existing = prev.find(x => x.did === did);
        if (existing) return prev;
        return [...prev, newPeer];
      });
    } catch (err) {
      console.error('[QR] Failed to parse DID:', err);
    }
    setConnected(true);
    setScreen('chat');
  }, []);

  const handleCameraCapture = useCallback(async (imageUrl: string, hashPayload: Uint8Array) => {
    // Store image URL in cache keyed by hash hex
    const hashHex = Array.from(hashPayload).map(b => b.toString(16).padStart(2, '0')).join('');

    setImageCache(prev => {
      const next = new Map(prev);
      next.set(hashHex, imageUrl);
      return next;
    });

    // Create a DOT with the hash as payload
    try {
      await DOT.create({ WHAT: hashPayload });
    } catch (err) {
      console.error('[DOT] camera create failed:', err);
    }

    // Capture compression ratio at this moment
    const currentStats = DOT.stats();

    // Add to messages with imageUrl
    setMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        from: myDid,
        content: `[photo: ${hashHex.slice(0, 8)}...]`,
        imageUrl,
        timestamp: Date.now(),
        verified: true,
        compressionRatio: currentStats.compressionRatio,
      },
    ]);

    setStats(currentStats);
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    setScreen('chat');
  }, [myDid]);

  if (screen === 'boot') return <BootScreen />;

  if (screen === 'identity') {
    return (
      <IdentityScreen
        did={myDid}
        peers={peers}
        onConnect={() => setScreen('chat')}
        onScanPeer={() => setScreen('qrscan')}
      />
    );
  }

  if (screen === 'qrscan') {
    return (
      <QRScanScreen
        onScan={handleScan}
        onCancel={() => setScreen('identity')}
      />
    );
  }

  if (screen === 'camera') {
    return (
      <CameraScreen
        onCapture={handleCameraCapture}
        onCancel={() => setScreen('chat')}
      />
    );
  }

  if (screen === 'stats') {
    return <StatsScreen onBack={() => setScreen('chat')} onSensors={() => setScreen('sensors')} />;
  }

  if (screen === 'sensors') {
    return <SensorScreen onBack={() => setScreen('stats')} />;
  }

  return (
    <ChatScreen
      myDid={myDid}
      messages={messages}
      connected={connected}
      input={input}
      onInput={setInput}
      onSend={sendMessage}
      stats={stats}
      messagesEndRef={messagesEndRef}
      onCamera={() => setScreen('camera')}
      onStats={() => setScreen('stats')}
    />
  );
}
