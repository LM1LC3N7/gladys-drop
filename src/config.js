// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The password of
// the broker is kept here and in the MQTT client only: never logged, never in
// /data, never in a status or an error.
// -----------------------------------------------------------------------------

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  broker_url: '',
  username: '',
  password: '',
  broker_fingerprint: '',
  // Shutting the water off is protective: never behind an option. Turning it
  // on, the bypass and the protect mode stay off until the user allows them.
  allow_water_open: false,
  allow_bypass: false,
  allow_mode_change: false,
  language: 'fr',
};

/** The keys without a default in the manifest (a secret never has one). */
export const NO_MANIFEST_DEFAULT = ['password'];

/** TCP or TLS only (the size guard of src/mqtt.js reads the raw MQTT stream). */
const SCHEMES = { 'mqtt:': false, 'tcp:': false, 'mqtts:': true, 'ssl:': true };

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
export const strictTrue = (value) => value === true || value === 'true';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The broker URL, completed: "192.168.1.10" -> "mqtt://192.168.1.10".
 * @returns {{ url: string, host: string, port: number, tls: boolean } | { error: string }}
 */
export function parseBrokerUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { error: 'empty' };
  }
  if (text.length > 300 || CONTROL.test(text)) {
    return { error: 'invalid' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!Object.hasOwn(SCHEMES, url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return { error: 'invalid' };
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (host === '0.0.0.0' || host === '::' || /^(22[4-9]|23\d|255)\./.test(host)) {
    // Never a broadcast, multicast nor "any" address.
    return { error: 'invalid' };
  }
  const secure = SCHEMES[url.protocol];
  return {
    /** scheme://host[:port]: nothing else, so it may be logged. */
    url: `${secure ? 'mqtts' : 'mqtt'}://${url.host}`,
    host,
    port: url.port ? Number(url.port) : secure ? 8883 : 1883,
    tls: secure,
  };
}

/**
 * A SHA-256 fingerprint typed by the user ("AB:CD:..." or 64 hex digits, any
 * case, spaces allowed): normalized as Node prints it (upper case, colons).
 * @returns {{ fingerprint: string | undefined } | { error: string }}
 */
export function parseFingerprint(raw) {
  const text = typeof raw === 'string' ? raw.replace(/[\s:]/g, '').toUpperCase() : '';
  if (text === '') {
    return { fingerprint: undefined };
  }
  if (!/^[0-9A-F]{64}$/.test(text)) {
    return { error: 'fingerprint' };
  }
  return { fingerprint: text.match(/../g).join(':') };
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value !== null && value !== undefined) {
      c[key] = value;
    }
  }
  const broker = parseBrokerUrl(c.broker_url);
  const pin = parseFingerprint(c.broker_fingerprint);
  const username = typeof c.username === 'string' ? c.username.trim() : '';
  const password = typeof c.password === 'string' ? c.password : '';
  let problem = broker.error ? `broker:${broker.error}` : undefined;
  if (!problem && (username.length > 256 || CONTROL.test(username))) {
    problem = 'username';
  } else if (!problem && (password.length > 1024 || CONTROL.test(password))) {
    problem = 'password';
  } else if (!problem && password !== '' && username === '') {
    // A password without a user name is a mistake (a broker never takes one alone).
    problem = 'password-alone';
  } else if (!problem && pin.error) {
    problem = 'fingerprint';
  } else if (!problem && pin.fingerprint && !broker.tls) {
    problem = 'fingerprint-plain';
  }
  return {
    /** Why the configuration cannot be used (shown in the status), else undefined. */
    problem,
    brokerUrl: broker.url,
    host: broker.host,
    port: broker.port,
    tls: broker.tls,
    username: problem ? '' : username,
    password: problem ? '' : password,
    fingerprint: pin.fingerprint,
    allowWaterOpen: strictTrue(c.allow_water_open),
    allowBypass: strictTrue(c.allow_bypass),
    allowModeChange: strictTrue(c.allow_mode_change),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** What a reconnection to the broker depends on (compared in memory only, never stored). */
export const connectionKey = (config) =>
  JSON.stringify([
    config.problem ?? null,
    config.brokerUrl ?? null,
    config.username,
    config.password,
    config.fingerprint ?? null,
  ]);
