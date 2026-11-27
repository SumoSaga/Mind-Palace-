import { useSyncExternalStore } from 'react';
import { WebsocketProvider } from 'y-websocket';
import { newId } from './id';
import { doc, persistence, SPACE_ID } from './store';

/**
 * Live connection to the sync server, plus presence: which devices are
 * currently connected to this space.
 */

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'computer' | 'tv';

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  /** True once the person using it has confirmed its name and type. */
  named?: boolean;
}

/** The types a person can choose from, with the words shown for each. */
export const DEVICE_KINDS: Array<{ kind: DeviceKind; label: string }> = [
  { kind: 'phone', label: 'Phone' },
  { kind: 'tablet', label: 'Tablet' },
  { kind: 'laptop', label: 'Laptop' },
  { kind: 'desktop', label: 'Desktop PC' },
  { kind: 'tv', label: 'TV' },
];

/** The word shown for a device's type. */
export function kindLabel(kind: DeviceKind): string {
  return DEVICE_KINDS.find((k) => k.kind === kind)?.label ?? 'Computer';
}

function guessKind(): DeviceKind {
  const ua = navigator.userAgent;
  if (/smart-?tv|tizen|web0s|webos|hbbtv|appletv|googletv|aft[a-z]/i.test(ua)) return 'tv';
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'tablet'; // iPadOS
  if (/iphone|ipod|android|mobile/i.test(ua)) return 'phone';
  return 'computer';
}

const STORAGE_KEY = 'mind-palace-device';

function loadDevice(): Device {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Device;
  } catch {
    /* storage unavailable: fall through to a temporary identity */
  }
  const kind = guessKind();
  const device: Device = { id: newId(), name: kindLabel(kind), kind };
  saveDevice(device);
  return device;
}

function saveDevice(device: Device) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    /* ignore */
  }
}

export let thisDevice: Device = loadDevice();

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
export const provider = new WebsocketProvider(`${scheme}://${location.host}/sync`, SPACE_ID, doc);
const awareness = provider.awareness;
awareness.setLocalStateField('device', thisDevice);

// --- device registry ---------------------------------------------------------
// Every device that has joined the space is remembered in the document, so a
// Stage keeps its name and its items while that device is disconnected.

const registry = doc.getMap<Device>('devices');

function register() {
  if (JSON.stringify(registry.get(thisDevice.id)) !== JSON.stringify(thisDevice)) {
    registry.set(thisDevice.id, thisDevice);
  }
}
void persistence.whenSynced.then(register);

let known = new Map<string, Device>();
const knownListeners = new Set<() => void>();
function rebuildKnown() {
  known = new Map(registry.entries());
  knownListeners.forEach((l) => l());
}
registry.observe(rebuildKnown);
rebuildKnown();

/** Every device that has ever joined this space, by id. */
export function useKnownDevices(): Map<string, Device> {
  return useSyncExternalStore(
    (l) => {
      knownListeners.add(l);
      return () => knownListeners.delete(l);
    },
    () => known,
  );
}

/** Sets this device's name and type, as chosen by the person using it. */
export function describeThisDevice(name: string, kind: DeviceKind) {
  const trimmed = name.trim() || kindLabel(kind);
  thisDevice = { ...thisDevice, name: trimmed, kind, named: true };
  saveDevice(thisDevice);
  awareness.setLocalStateField('device', thisDevice);
  register();
  rebuildDevices();
}

// --- connection status -----------------------------------------------------

let connected = provider.wsconnected;
const statusListeners = new Set<() => void>();
provider.on('status', ({ status }: { status: string }) => {
  connected = status === 'connected';
  statusListeners.forEach((l) => l());
});

export function useConnected(): boolean {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => connected,
  );
}

// --- connected devices -----------------------------------------------------

let devices: Device[] = [thisDevice];
const deviceListeners = new Set<() => void>();

// A function declaration, so renameThisDevice above can call it.
function rebuildDevices() {
  const byId = new Map<string, Device>();
  byId.set(thisDevice.id, thisDevice);
  for (const state of awareness.getStates().values()) {
    const d = (state as { device?: Device }).device;
    if (d && !byId.has(d.id)) byId.set(d.id, d);
  }
  devices = [...byId.values()];
  deviceListeners.forEach((l) => l());
}
awareness.on('change', rebuildDevices);
rebuildDevices();

/** Devices connected to this space right now. This device is always first. */
export function useDevices(): Device[] {
  return useSyncExternalStore(
    (l) => {
      deviceListeners.add(l);
      return () => deviceListeners.delete(l);
    },
    () => devices,
  );
}
