/**
 * OpenTrack -> browser bridge.
 *
 * A page cannot open a UDP socket, and OpenTrack cannot speak WebSocket, so this
 * sits between them: it binds OpenTrack's "UDP over network" output and rebroadcasts
 * each pose to any browser that connects.
 *
 * OpenTrack setup:
 *   Output      -> "UDP over network"
 *   Remote host -> 127.0.0.1   (or this machine's LAN address)
 *   Remote port -> 4242
 *
 * Then:
 *   npm run track
 *
 * The wire format is six little-endian float64s in one 48-byte datagram:
 *   x, y, z (translation, millimetres) and yaw, pitch, roll (degrees).
 *
 * The game connects opportunistically and falls back to mouse-only look if this is
 * not running, so it is never required.
 */
import dgram from 'node:dgram';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const UDP_PORT = Number(process.env.OPENTRACK_UDP_PORT ?? 4242);
const WS_PORT = Number(process.env.OPENTRACK_WS_PORT ?? 4243);
/**
 * Bind on every interface, not just loopback.
 *
 * OpenTrack's "Remote IP address" is usually the machine's LAN address (192.168.x.x)
 * rather than 127.0.0.1 — that is what its default dialog offers, and it is what you
 * must use if OpenTrack and the browser are on different machines. A socket bound to
 * 127.0.0.1 silently ignores everything addressed to the LAN address, which looks
 * exactly like the tracker not working at all.
 */
const HOST = process.env.OPENTRACK_HOST ?? '0.0.0.0';
/** Cap the rebroadcast rate; OpenTrack can emit far faster than anyone can see. */
const MAX_HZ = Number(process.env.OPENTRACK_MAX_HZ ?? 120);

const wss = new WebSocketServer({ host: HOST, port: WS_PORT });
const udp = dgram.createSocket('udp4');

let clients = 0;
let packets = 0;
let dropped = 0;
let lastSent = 0;
let lastLog = Date.now();

wss.on('connection', (socket) => {
  clients++;
  console.log(`[bridge] browser connected (${clients} total)`);
  socket.on('close', () => {
    clients--;
    console.log(`[bridge] browser disconnected (${clients} remaining)`);
  });
  socket.on('error', () => {});
});

udp.on('message', (msg, rinfo) => {
  if (msg.length < 48) {
    dropped++;
    return;
  }
  if (packets === 0) {
    console.log(`[bridge] receiving from ${rinfo.address}:${rinfo.port} — tracker is live.`);
    if (clients === 0) {
      console.log('[bridge] no browser connected yet; load the game and it will attach.');
    }
  }
  packets++;

  const now = Date.now();
  if (now - lastSent < 1000 / MAX_HZ) return;
  lastSent = now;

  const pose = {
    x: msg.readDoubleLE(0),
    y: msg.readDoubleLE(8),
    z: msg.readDoubleLE(16),
    yaw: msg.readDoubleLE(24),
    pitch: msg.readDoubleLE(32),
    roll: msg.readDoubleLE(40),
    t: now,
  };
  const payload = JSON.stringify(pose);
  for (const socket of wss.clients) {
    if (socket.readyState === 1) socket.send(payload);
  }
});

udp.on('error', (err) => {
  console.error(`[bridge] UDP error: ${err.message}`);
  process.exit(1);
});

udp.bind(UDP_PORT, HOST, () => {
  console.log(`[bridge] listening for OpenTrack on udp://${HOST}:${UDP_PORT}`);
  console.log(`[bridge] serving poses on ws://${HOST}:${WS_PORT}`);
  console.log('');
  console.log('[bridge] In OpenTrack: Output -> "UDP over network", port ' + UDP_PORT + ',');
  console.log('[bridge] and Remote IP address set to any one of these:');
  console.log('[bridge]     127.0.0.1        (OpenTrack on this same machine)');
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`[bridge]     ${a.address.padEnd(16)} (${name})`);
      }
    }
  }
  console.log('');
  console.log('[bridge] waiting for the first packet...');
});

let quietFor = 0;
setInterval(() => {
  const elapsed = (Date.now() - lastLog) / 1000;
  if (packets > 0) {
    quietFor = 0;
    console.log(
      `[bridge] ${(packets / elapsed).toFixed(0)} Hz in, ${clients} client(s)` +
      (dropped ? `, ${dropped} short packet(s) ignored` : ''),
    );
  } else {
    quietFor += elapsed;
    // Say something useful rather than sitting there silently doing nothing.
    if (quietFor > 9 && quietFor < 40) {
      console.log(
        '[bridge] no packets yet. Check OpenTrack is *started* (the Start button),'
        + ` that its output is "UDP over network" on port ${UDP_PORT}, and that its`
        + ' Remote IP address is one of the addresses listed above.',
      );
    }
  }
  packets = 0;
  dropped = 0;
  lastLog = Date.now();
}, 5000).unref?.();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[bridge] shutting down');
    udp.close();
    wss.close();
    process.exit(0);
  });
}
