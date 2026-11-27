// Spaces ("rooms"): one shared Yjs document per space, relayed to every
// connected browser and saved to disk so it survives a restart.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SAVE_DELAY_MS = 2000;

/** Space names become file names, so they are kept to plain characters. */
export const validRoomName = (name) => /^[A-Za-z0-9_-]{1,64}$/.test(name);

function send(ws, encoder) {
  if (ws.readyState === ws.OPEN) ws.send(encoding.toUint8Array(encoder));
}

/**
 * @param {string} dir where spaces are saved
 */
export function createRooms(dir) {
  /** @type {Map<string, { doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<any, Set<number>>, save: () => Promise<void> }>} */
  const rooms = new Map();
  mkdirSync(dir, { recursive: true });

  function getRoom(name) {
    let room = rooms.get(name);
    if (room) return room;

    const file = path.join(dir, `${name}.bin`);
    const doc = new Y.Doc();
    if (existsSync(file)) {
      try {
        Y.applyUpdate(doc, readFileSync(file));
      } catch (err) {
        // Keep the unreadable file aside rather than overwrite it with an empty space.
        console.error(`[sync] could not read saved space "${name}"`, err);
        throw new Error(`Saved space "${name}" is unreadable`);
      }
    }
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    const conns = new Map();

    let timer = null;
    let saving = Promise.resolve();
    const save = () => {
      clearTimeout(timer);
      timer = null;
      // Write to a temporary file first, so a crash mid-write cannot corrupt the saved space.
      saving = saving
        .then(async () => {
          await writeFile(`${file}.tmp`, Y.encodeStateAsUpdate(doc));
          await rename(`${file}.tmp`, file);
        })
        .catch((err) => console.error(`[sync] could not save space "${name}"`, err));
      return saving;
    };

    room = { doc, awareness, conns, save };
    rooms.set(name, room);

    doc.on('update', (update) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      for (const ws of conns.keys()) send(ws, encoder);
      if (!timer) timer = setTimeout(save, SAVE_DELAY_MS);
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

  /** Joins a newly connected browser to a space. */
  function connect(ws, name) {
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
  }

  /** Saves every space now; used when the server is shutting down. */
  const saveAll = () => Promise.all([...rooms.values()].map((r) => r.save()));

  return { getRoom, connect, saveAll };
}
