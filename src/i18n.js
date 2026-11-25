// -----------------------------------------------------------------------------
// The texts users read, in English and French: feature names, the status of
// the configuration screen, the outcome of the commands.
// -----------------------------------------------------------------------------

import { FEATURES as F, TYPES } from './constants.js';

/** The text of a `{ en, fr }` pair in `language` (French by default). */
export const word = (pair, language) => (language === 'en' ? pair?.en : pair?.fr) ?? '';

const both = (en, fr) => ({ en, fr });

export const TYPE_NAMES = {
  [TYPES.HUB]: both('Hub', 'Hub'),
  [TYPES.VALVE]: both('Protection valve', 'Vanne de protection'),
  [TYPES.LEAK]: both('Leak detector', 'Détecteur de fuite'),
  [TYPES.SOFTENER]: both('Softener', 'Adoucisseur'),
  [TYPES.FILTER]: both('Filter', 'Filtre'),
  [TYPES.SALT]: both('Salt sensor', 'Capteur de sel'),
  [TYPES.ALERT]: both('Alert', 'Alerte'),
  [TYPES.PUMP]: both('Pump controller', 'Contrôleur de pompe'),
  [TYPES.RO]: both('Reverse osmosis filter', 'Osmoseur'),
};

export const FEATURE_NAMES = {
  [F.WATER]: both('Water on', 'Eau ouverte'),
  [F.WATER_CLOSE]: both('Shut the water off', "Couper l'eau"),
  [F.WATER_OPEN]: both('Turn the water on', "Ouvrir l'eau"),
  [F.LEAK]: both('Leak', 'Fuite'),
  [F.FLOW]: both('Flow', 'Débit'),
  [F.PEAK_FLOW]: both('Peak flow today', 'Débit maximal du jour'),
  [F.USED_TODAY]: both('Water used today', "Eau consommée aujourd'hui"),
  [F.AVERAGE_USED]: both('Average daily use', 'Consommation moyenne par jour'),
  [F.CAPACITY]: both('Capacity remaining', 'Capacité restante'),
  [F.PRESSURE]: both('Pressure', 'Pression'),
  [F.PRESSURE_HIGH]: both('Highest pressure today', 'Pression maximale du jour'),
  [F.PRESSURE_LOW]: both('Lowest pressure today', 'Pression minimale du jour'),
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.BATTERY]: both('Battery', 'Pile'),
  [F.NOTIFICATION]: both('Notification pending', 'Notification en attente'),
  [F.RESERVE]: both('Reserve capacity in use', 'Réserve en service'),
  [F.SALT_LOW]: both('Salt low', 'Sel bas'),
  [F.ALERT]: both('Sensor alert', 'Alerte du capteur'),
  [F.POWER]: both('Powered', 'Alimenté'),
  [F.PUMP]: both('Pump running', 'Pompe en marche'),
  [F.TDS_IN]: both('Inlet TDS (ppm)', "TDS à l'entrée (ppm)"),
  [F.TDS_OUT]: both('Outlet TDS (ppm)', 'TDS à la sortie (ppm)'),
  [F.CARTRIDGE_1]: both('Cartridge 1 life', 'Vie de la cartouche 1'),
  [F.CARTRIDGE_2]: both('Cartridge 2 life', 'Vie de la cartouche 2'),
  [F.CARTRIDGE_3]: both('Cartridge 3 life', 'Vie de la cartouche 3'),
  [F.BYPASS]: both('Bypass', 'Bypass'),
  [F.MODE]: both('Protect mode', 'Mode de protection'),
};

export const OPTION_LABELS = {
  off: both('Off', 'Désactivé'),
  on: both('On', 'Activé'),
  home: both('Home', 'Maison'),
  away: both('Away', 'Absent'),
  schedule: both('Schedule', 'Programmé'),
};

// --- Status --------------------------------------------------------------------

const PROBLEMS = {
  'broker:empty': both(
    'enter the address of your MQTT broker',
    'saisissez l’adresse de votre broker MQTT',
  ),
  'broker:invalid': both(
    'the broker address is not valid (an IP address or a host name, mqtt:// or mqtts://)',
    'l’adresse du broker n’est pas valide (adresse IP ou nom d’hôte, mqtt:// ou mqtts://)',
  ),
  'broker:credentials': both(
    'put the user name and the password in their own fields, not in the address',
    'mettez l’utilisateur et le mot de passe dans leurs champs, pas dans l’adresse',
  ),
  username: both('the user name is not valid', 'l’utilisateur n’est pas valide'),
  password: both('the password is not valid', 'le mot de passe n’est pas valide'),
  'password-alone': both('a password needs a user name', 'un mot de passe demande un utilisateur'),
  fingerprint: both(
    'the certificate fingerprint must be 64 hexadecimal digits (SHA-256)',
    'l’empreinte du certificat doit compter 64 caractères hexadécimaux (SHA-256)',
  ),
  'fingerprint-plain': both(
    'a certificate fingerprint needs a broker in TLS (mqtts://)',
    'une empreinte de certificat demande un broker en TLS (mqtts://)',
  ),
};

export const T = {
  problem: (problem) => {
    const p = PROBLEMS[problem] ?? both('invalid configuration', 'configuration invalide');
    return both(`Configuration: ${p.en}.`, `Configuration : ${p.fr}.`);
  },
  noConfig: both(
    'The configuration could not be read from Gladys: tried again every 30 s.',
    'La configuration n’a pas pu être lue dans Gladys : nouvel essai toutes les 30 s.',
  ),
  storeUnreadable: both(
    'The state in /data cannot be read: read again every 10 s; "Test the connection" connects anyway.',
    'L’état dans /data est illisible : relu toutes les 10 s ; « Tester la connexion » connecte quand même.',
  ),
  connecting: (url) => both(`Connecting to ${url}...`, `Connexion à ${url}...`),
  unreachable: (url, reason) =>
    both(
      `Broker ${url} unreachable (${reason}): tried again every 10 s.`,
      `Broker ${url} injoignable (${reason}) : nouvel essai toutes les 10 s.`,
    ),
  refused: (url, reason) =>
    both(
      `Broker ${url} refused the connection (${reason}). Not tried again by itself: save other credentials or click "Test the connection".`,
      `Le broker ${url} a refusé la connexion (${reason}). Pas de nouvel essai automatique : enregistrez d’autres identifiants ou cliquez sur « Tester la connexion ».`,
    ),
  certificate: (url, seen) =>
    both(
      `The certificate of ${url} is not the pinned one (seen: ${seen ?? 'none'}). Nothing sent. Enter this fingerprint if you trust it.`,
      `Le certificat de ${url} n’est pas celui épinglé (vu : ${seen ?? 'aucun'}). Rien envoyé. Saisissez cette empreinte si vous lui faites confiance.`,
    ),
  waiting: (url) =>
    both(
      `Connected to ${url}, no DROP message heard yet (is the hub set to publish to this broker?).`,
      `Connecté à ${url}, aucun message DROP reçu pour l’instant (le hub publie-t-il vers ce broker ?).`,
    ),
  live: (url, devices) =>
    both(
      `Connected to ${url}: ${devices} DROP device(s) heard.`,
      `Connecté à ${url} : ${devices} appareil(s) DROP entendu(s).`,
    ),
  mqtt311: both(
    ' MQTT 3.1.1 (the broker has no MQTT 5).',
    ' MQTT 3.1.1 (le broker n’a pas MQTT 5).',
  ),
  ignored: (n) =>
    both(
      ` ${n} device(s) ignored (unknown type or over the limit).`,
      ` ${n} appareil(s) ignoré(s) (type inconnu ou au-delà de la limite).`,
    ),
  flood: both(
    ' Messages dropped: the broker sends too many.',
    ' Messages ignorés : le broker en envoie trop.',
  ),
  certSeen: (fingerprint) =>
    both(
      ` Certificate seen: ${fingerprint}; enter it in "Certificate fingerprint" if you trust it.`,
      ` Certificat vu : ${fingerprint} ; saisissez-le dans « Empreinte du certificat » si vous lui faites confiance.`,
    ),
  stopsKept: (n, held) =>
    both(
      ` ${n} shutoff(s) kept until the valve shows the water off${held ? `, ${held} held (sent again every 10 min)` : ''}; given up 24 h after the click, or when the device is deleted in Gladys.`,
      ` ${n} coupure(s) gardée(s) jusqu’à ce que la vanne montre l’eau coupée${held ? `, ${held} retenue(s) (renvoyée(s) toutes les 10 min)` : ''} ; abandonnée(s) 24 h après le clic, ou à la suppression de l’appareil dans Gladys.`,
    ),
  lastCommand: (text) => both(` Last command: ${text.en}`, ` Dernière commande : ${text.fr}`),
};

// --- Commands ------------------------------------------------------------------

const WHAT = {
  close: both('shut the water off', "couper l'eau"),
  open: both('turn the water on', "ouvrir l'eau"),
  bypass: both('change the bypass', 'changer le bypass'),
  mode: both('change the protect mode', 'changer le mode de protection'),
};

/** The outcomes of a command, `{ en, fr }`, prefixed with the device name. */
export const C = {
  notAllowed: (name, command) =>
    both(
      `${name}: ${WHAT[command].en} is off in the configuration. Nothing sent.`,
      `${name} : ${WHAT[command].fr} est désactivé dans la configuration. Rien envoyé.`,
    ),
  unknownFeature: both(
    'Unknown DROP feature. Nothing sent.',
    'Fonction DROP inconnue. Rien envoyé.',
  ),
  typeChanged: (name) =>
    both(
      `${name}: the hub now gives another type for this device; scan again. Nothing sent.`,
      `${name} : le hub donne maintenant un autre type pour cet appareil ; relancez une découverte. Rien envoyé.`,
    ),
  badValue: (name) =>
    both(`${name}: value not accepted. Nothing sent.`, `${name} : valeur refusée. Rien envoyé.`),
  offline: (name) =>
    both(
      `${name}: not connected to the broker. Nothing sent.`,
      `${name} : pas connecté au broker. Rien envoyé.`,
    ),
  late: (name) =>
    both(
      `${name}: another command of this device took too long. Nothing sent.`,
      `${name} : une autre commande de cet appareil a pris trop de temps. Rien envoyé.`,
    ),
  cancelled: (name) =>
    both(
      `${name}: cancelled by a shutoff clicked after it. Nothing sent.`,
      `${name} : annulé par une coupure demandée après. Rien envoyé.`,
    ),
  notHeard: (name) =>
    both(
      `${name}: its state was not heard since the connection to the broker. Nothing sent.`,
      `${name} : son état n’a pas été reçu depuis la connexion au broker. Rien envoyé.`,
    ),
  leakUnknown: (name) =>
    both(
      `${name}: its leak state is unknown. Nothing sent.`,
      `${name} : son état de fuite est inconnu. Rien envoyé.`,
    ),
  leak: (name, others) =>
    both(
      `${name}: a leak is reported (${others}). Nothing sent.`,
      `${name} : une fuite est signalée (${others}). Rien envoyé.`,
    ),
  closing: (name) =>
    both(
      `${name}: a shutoff of this hub left less than 20 s ago. Nothing sent.`,
      `${name} : une coupure de ce hub est partie il y a moins de 20 s. Rien envoyé.`,
    ),
  closeKept: (name) =>
    both(
      `${name}: shutoff kept, sent as soon as the broker connection is back.`,
      `${name} : coupure gardée, envoyée dès le retour de la connexion au broker.`,
    ),
  closeSentKept: (name) =>
    both(
      `${name}: shutoff sent, not confirmed yet: sent again until the device shows the water off.`,
      `${name} : coupure envoyée, pas encore confirmée : renvoyée jusqu’à ce que l’appareil montre l’eau coupée.`,
    ),
  leakUnknownOthers: (name, others) =>
    both(
      `${name}: the leak state of ${others} is unknown in this connection. Nothing sent.`,
      `${name} : l’état de fuite de ${others} est inconnu dans cette connexion. Rien envoyé.`,
    ),
  flooded: (name) =>
    both(
      `${name}: messages of the broker were dropped (too many), the state is uncertain. Nothing sent.`,
      `${name} : des messages du broker ont été ignorés (trop nombreux), l’état est incertain. Rien envoyé.`,
    ),
  already: (name) =>
    both(
      `${name}: already in that state. Nothing sent.`,
      `${name} : déjà dans cet état. Rien envoyé.`,
    ),
  notSent: (name) =>
    both(
      `${name}: the broker did not take the command. Nothing sent.`,
      `${name} : le broker n’a pas pris la commande. Rien envoyé.`,
    ),
  unconfirmed: (name) =>
    both(
      `${name}: sent, without confirmation from the device yet.`,
      `${name} : envoyé, sans confirmation de l’appareil pour l’instant.`,
    ),
  confirmed: (name) =>
    both(`${name}: done, confirmed by the device.`, `${name} : fait, confirmé par l’appareil.`),
  noEffect: (name) =>
    both(
      `${name}: sent, but the device did not show it applied within 20 s.`,
      `${name} : envoyé, mais l’appareil ne l’a pas montré appliqué en 20 s.`,
    ),
};

export const TEST = {
  problem: (p) => T.problem(p),
  tooSoon: both(
    'Already tested a moment ago: wait 10 s.',
    'Déjà testé à l’instant : attendez 10 s.',
  ),
  noConfig: T.noConfig,
  started: (url) =>
    both(
      `Connecting to ${url}: the status above shows the result.`,
      `Connexion à ${url} : le statut ci-dessus donne le résultat.`,
    ),
};
