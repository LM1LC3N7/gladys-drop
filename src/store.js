// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), in drop-state.json, readable by the container user only (0600):
//   - `refused`: `{ salt, mark }` after the broker refused the credentials:
//     `mark` is 8 bits of a salted SHA-256 of the broker address, user name
//     and password: enough to never send the refused credentials again by
//     itself after a restart, far too little to guess a password from (256
//     values: every other password shares one). Never the password nor a
//     full hash of it; nothing is kept for credentials the broker accepted;
//   - `stops`: the shutoffs clicked and not yet seen applied, `{ hub,
//     device, name, at }` (`at`: wall time of the click, a future one taken
//     as now): sent again at the next connection and after a restart, until
//     the device shows its water off or a turn-on leaves after them.
// Read back strictly (only the known keys of the expected shape, never an
// inherited or `__proto__` key). A file that cannot be read (I/O error) is
// never taken for an empty one: src/app.js reads it again every 10 s.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { LIMITS } from './constants.js';

export const STATE_FILE = '/data/drop-state.json';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `load()` -> `{ ok: true, data }` (data null when there is no file) |
 * `{ ok: false, reason: 'io' | 'invalid' }`. `save(data)`: one write at a
 * time, replaced atomically.
 */
export function fileStore(path = STATE_FILE) {
  let chain = Promise.resolve();
  return {
    async load() {
      let handle;
      try {
        handle = await open(path, 'r');
      } catch (err) {
        return err?.code === 'ENOENT' ? { ok: true, data: null } : { ok: false, reason: 'io' };
      }
      try {
        const { size } = await handle.stat();
        if (size > LIMITS.stateFile) {
          return { ok: false, reason: 'invalid' };
        }
        const text = await readFile(handle, 'utf8');
        return { ok: true, data: JSON.parse(text) };
      } catch (err) {
        return { ok: false, reason: err instanceof SyntaxError ? 'invalid' : 'io' };
      } finally {
        await handle.close().catch(() => {});
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file; `failing` refuses every save. */
export function memoryStore(initial = null, { failing = false, unreadable } = {}) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    loads: 0,
    failing,
    /** 'io' | 'invalid' | undefined: what `load()` answers while set. */
    unreadable,
    async load() {
      this.loads += 1;
      if (this.unreadable) {
        return { ok: false, reason: this.unreadable };
      }
      return { ok: true, data: this.data === null ? null : JSON.parse(JSON.stringify(this.data)) };
    },
    async save(data) {
      if (this.failing) {
        throw new Error('EROFS');
      }
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

/** The shutoffs kept in /data, at most this many. */
export const MAX_STOPS = 16;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const HUB = /^DROP-[A-Za-z0-9_-]{1,40}$/;
const DEVICE = /^(0|[1-9]\d{0,2})$/;

function normalizeStops(raw, now) {
  const stops = [];
  for (const s of Array.isArray(raw) ? raw.slice(0, MAX_STOPS) : []) {
    if (!isObject(s) || typeof s.hub !== 'string' || typeof s.device !== 'string') continue;
    if (!HUB.test(s.hub) || !DEVICE.test(s.device) || Number(s.device) > 255) continue;
    if (stops.some((o) => o.hub === s.hub && o.device === s.device)) continue;
    const at = Number.isFinite(s.at) && s.at > 0 ? Math.min(s.at, now) : now;

    const name = typeof s.name === 'string' ? s.name.replace(CONTROL, ' ').slice(0, 60) : '';
    stops.push({ hub: s.hub, device: s.device, name, at });
  }
  return stops;
}

/** The persisted state, repaired: `{ refused: { salt, mark } | undefined, stops: [...] }`. */
export function normalizeMemory(raw, now = Date.now()) {
  const stops = normalizeStops(isObject(raw) && Object.hasOwn(raw, 'stops') ? raw.stops : [], now);
  const refused = isObject(raw) && Object.hasOwn(raw, 'refused') ? raw.refused : undefined;
  if (
    isObject(refused) &&
    typeof refused.salt === 'string' &&
    /^[0-9a-f]{32}$/.test(refused.salt) &&
    Number.isInteger(refused.mark) &&
    refused.mark >= 0 &&
    refused.mark <= 255
  ) {
    return { refused: { salt: refused.salt, mark: refused.mark }, stops };
  }
  return { refused: undefined, stops };
}

export const serializeMemory = ({ refused, stops = [] }) => ({
  ...(refused ? { refused: { salt: refused.salt, mark: refused.mark } } : {}),
  ...(stops.length > 0
    ? {
        stops: stops
          .slice(0, MAX_STOPS)
          .map(({ hub, device, name, at }) => ({ hub, device, name, at })),
      }
    : {}),
});

/** The 8-bit mark of credentials (the broker address, user name and password) under a salt. */
export function credentialMark(config, salt) {
  const digest = createHash('sha256')
    .update(salt)
    .update('\0')
    .update(config.brokerUrl ?? '')
    .update('\0')
    .update(config.username ?? '')
    .update('\0')
    .update(config.password ?? '')
    .digest();
  return digest[0];
}

export const newSalt = () => randomBytes(16).toString('hex');
