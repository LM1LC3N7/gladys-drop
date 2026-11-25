// -----------------------------------------------------------------------------
// DROP messages as the hub publishes them: the topics of dropmqttapi 1.0.3
// (MIT, Chandler Systems) and the payloads of the Home Assistant drop_connect
// tests (Apache-2.0), the only examples published.
// -----------------------------------------------------------------------------

export const HUB = 'DROP-1_C0FFEE';
export const SELECTOR = 'drop';

export const N = {
  hub: '255',
  softener: '0',
  filter: '4',
  salt: '8',
  leak: '20',
  valve: '78',
  alert: '81',
  pump: '83',
  ro: '95',
};

export const DISCOVERY = {
  hub: { devDesc: 'Hub', devType: 'hub', name: 'Hub DROP-1_C0FFEE' },
  softener: { devDesc: 'Softener', devType: 'soft', name: 'Softener' },
  filter: { devDesc: 'Filter', devType: 'filt', name: 'Filter' },
  salt: { devDesc: 'Salt Sensor', devType: 'salt', name: 'Salt Sensor' },
  leak: { devDesc: 'Leak Detector', devType: 'leak', name: 'Laundry leak' },
  valve: { devDesc: 'Protection Valve', devType: 'pv', name: 'Protection Valve' },
  alert: { devDesc: 'Alert', devType: 'alrt', name: 'Sump alert' },
  pump: { devDesc: 'Pump Controller', devType: 'pc', name: 'Pump' },
  ro: { devDesc: 'RO Filter', devType: 'ro', name: 'RO' },
};

export const DATA = {
  hub: {
    curFlow: 5.77,
    peakFlow: 13.8,
    usedToday: 232.77,
    avgUsed: 76,
    psi: 62.2,
    psiLow: 61,
    psiHigh: 62,
    water: 1,
    bypass: 0,
    pMode: 'home',
    battery: 50,
    notif: 1,
    leak: 0,
  },
  salt: { salt: 1 },
  alert: { battery: 100, sens: 1, pwrOff: 0, temp: 68.2 },
  leak: { battery: 100, leak: 1, temp: 68.2 },
  softener: { curFlow: 5.0, bypass: 0, battery: 20, capacity: 1000, resInUse: 1, psi: 50.5 },
  filter: { curFlow: 19.84, bypass: 0, battery: 12, psi: 38.2 },
  valve: { curFlow: 7.1, psi: 61.3, water: 1, battery: 0, leak: 0, temp: 70.5 },
  pump: { curFlow: 2.2, psi: 62.2, pump: 1, leak: 1, temp: 68.8 },
  ro: { leak: 1, tdsIn: 164, tdsOut: 9, cart1: 59, cart2: 80, cart3: 59 },
};

export const discoveryTopic = (n, hub = HUB) => `drop_connect/discovery/${hub}/${n}`;
export const dataTopic = (n, hub = HUB) => `drop_connect/${hub}/data/${n}`;
export const cmdTopic = (n, hub = HUB) => `drop_connect/${hub}/cmd/${n}`;

/** The external ids of a device of the fixture hub. */
export const ID = (n, hub = HUB) => `ext:${SELECTOR}:drop:${hub}_${n}`;
export const FID = (n, key, hub = HUB) => `${ID(n, hub)}:${key}`;
