// Development sync server: relays workspace changes and device presence
// between every browser connected to the same space. It keeps each space in
// memory only; browsers hold their own saved copy and re-send it on connect.
// This is replaced by the hosted backend later.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handleFiles } from './files.mjs';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const PORT = Number(process.env.SYNC_PORT ?? 1234);
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>> }>} */
const rooms = new Map();

function send(ws, encoder) {
  if (ws.readyState === ws.OPEN) ws.send(encoding.toUint8Array(encoder));
}

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const conns = new Map();
  room = { doc, awareness, conns };
  rooms.set(name, room);

  doc.on('update', (update) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    for (const ws of conns.keys()) send(ws, encoder);
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    // Remember which presence entries each connection owns, so they can be
    // cleared when that connection drops.
    const owned = conns.get(origin);
    if (owned) {
      for (const id of [...added, ...updated]) owned.add(id);
      for (const id of removed) owned.delete(id);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]),
    );
    for (const ws of conns.keys()) send(ws, encoder);
  });

  return room;
}

// The same port also serves the file store (see files.mjs): large files such
// as PDFs and videos live on disk here, and items in the workspace point at them.
const server = http.createServer((req, res) => {
  handleFiles(req, res).catch((err) => {
    console.error('[files] error', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
const wss = new WebSocketServer({ server });
server.listen(PORT, '0.0.0.0');

wss.on('connection', (ws, req) => {
  const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]) || 'default';
  const room = getRoom(name);
  room.conns.set(ws, new Set());

  ws.on('message', (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        if (encoding.length(encoder) > 1) send(ws, encoder);
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (err) {
      console.error('[sync] bad message', err);
    }
  });

  ws.on('close', () => {
    const owned = room.conns.get(ws) ?? new Set();
    room.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, [...owned], null);
  });

  ws.on('error', (err) => console.error('[sync] socket error', err.message));

  // Open the exchange: ask the browser for what we are missing, and tell it who is here.
  const hello = encoding.createEncoder();
  encoding.writeVarUint(hello, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(hello, room.doc);
  send(ws, hello);

  const states = room.awareness.getStates();
  if (states.size > 0) {
    const presence = encoding.createEncoder();
    encoding.writeVarUint(presence, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      presence,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    send(ws, presence);
  }
});

console.log(`[sync] listening on port ${PORT}`);
