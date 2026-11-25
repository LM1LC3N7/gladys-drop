# DROP (Chandler Systems)

Cette intégration affiche dans Gladys les appareils de gestion de l'eau **DROP**
(Chandler Systems, États-Unis) par **votre propre broker MQTT**, en local, sans le
cloud DROP : le hub publie ses données vers votre broker (Mosquitto…), Gladys les y lit.

Non officielle, sans lien avec Chandler Systems. **Jamais testé avec un vrai appareil** :
elle suit les sujets MQTT publiés par le fabricant (dropmqttapi) et l'intégration Home
Assistant. Vos retours sont précieux.

## Ce qui est affiché

| Appareil DROP       | Fonctionnalités                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub                 | eau ouverte, couper l'eau, ouvrir l'eau, fuite, débit, débit maximal du jour, eau consommée aujourd'hui, consommation moyenne par jour, pression (actuelle, maximale et minimale du jour), bypass, mode de protection, notification en attente, pile |
| Vanne de protection | eau ouverte, couper l'eau, ouvrir l'eau, fuite, débit, pression, température, pile                                                                                                                                                                   |
| Détecteur de fuite  | fuite, température, pile                                                                                                                                                                                                                             |
| Adoucisseur         | capacité restante, réserve en service, débit, pression, bypass, pile                                                                                                                                                                                 |
| Filtre              | débit, pression, bypass, pile                                                                                                                                                                                                                        |
| Capteur de sel      | sel bas                                                                                                                                                                                                                                              |
| Alerte              | alerte du capteur, alimenté, température, pile                                                                                                                                                                                                       |
| Contrôleur de pompe | pompe en marche, fuite, débit, pression, température                                                                                                                                                                                                 |
| Osmoseur            | fuite, TDS à l'entrée et à la sortie (ppm), vie des cartouches 1 à 3                                                                                                                                                                                 |

Unités : les gallons deviennent des litres, les gallons par minute des m³/h ; la pression
reste en PSI et la température en °F (Gladys les convertit à l'affichage). Une valeur
absente, vide ou hors limites reste inconnue : jamais publiée comme 0.

## Mise en place

1. Un broker MQTT sur votre réseau (Mosquitto, ou celui de votre box domotique), de
   préférence avec un utilisateur et un mot de passe.
2. Dans l'application DROP Connect, réglez le hub pour qu'il publie vers ce broker
   (la même réglage que pour Home Assistant). Les sujets commencent par `drop_connect/`.
3. Dans Gladys, saisissez l'adresse du broker (`192.168.1.20`, ou
   `mqtts://broker.lan:8883` en TLS), l'utilisateur et le mot de passe, enregistrez.
4. Onglet **Découverte** : ajoutez les appareils annoncés par le hub.

Broker en TLS au certificat auto-signé : saisissez l'empreinte SHA-256 de son certificat.
La connexion n'est alors acceptée que pour ce certificat ; un autre certificat arrête tout
avant l'envoi du mot de passe et le statut affiche l'empreinte vue. Sans empreinte, le
certificat doit être signé par une autorité connue ; un certificat refusé affiche aussi son
empreinte dans le statut (lue sur une connexion qui n'envoie rien), à coller dans le champ
si vous lui faites confiance.

## Commandes

Ce ne sont jamais des interrupteurs : un « tout éteindre » ou un assistant vocal ne peut
pas toucher la vanne. Couper et ouvrir l'eau sont deux boutons ; le bypass et le mode de
protection sont des listes.

### Couper l'eau : toujours permis

**Couper l'eau** (hub, vanne de protection) n'a pas d'option : c'est la sécurité de
l'appareil. Elle ne lit rien avant de partir et ne passe pas derrière les autres commandes :
elle part tout de suite et annule celles du même hub qui attendent encore leur tour (rien de
cliqué avant une coupure ne part après elle). Elle part même si la vanne semble déjà fermée.

Elle est **gardée** (en mémoire et dans `/data`) jusqu'à ce que l'appareil montre l'eau
coupée après l'envoi (message en direct, ou message retenu reçu à la reconnexion), ou
qu'une ouverture de ce hub parte de Gladys après elle (écriture acceptée par le broker) :

- cliquée sans connexion au broker : réponse « coupure gardée », envoi juste après la
  connexion suivante, sans attendre de message du hub ;
- après un redémarrage de l'intégration : renvoyée d'après `/data` dès la connexion ;
- renvoyée si l'appareil montre encore l'eau ouverte au moins 2 s après l'envoi, et 20 s
  après chaque envoi sans confirmation : 3 fois, puis toutes les 10 min (« retenue »,
  dit dans le statut), jusqu'à confirmation ;
- une écriture de `/data` qui échoue ne la retarde jamais ;
- si la vanne était connue fermée quand la coupure est partie, une ouverture vue ensuite
  (faite dans l'application DROP, par exemple) la lève : elle n'est jamais renvoyée contre
  cette ouverture ;
- jamais confirmée : elle est abandonnée 24 h après le clic, ou dès que vous supprimez
  l'appareil dans Gladys (le statut le dit).

Elle n'est pas envoyée seulement si l'identité ne va pas : une valeur autre que l'appui du
bouton, ou un appareil dont le hub annonce maintenant un autre type (relancez une
découverte). Sans connexion possible au broker (identifiants refusés, certificat refusé),
elle reste gardée et part dès que la connexion revient.

### Les autres commandes : désactivées par défaut

Chacune a sa case dans la configuration, relue au clic et encore juste avant l'envoi. Une
commande part dans les 2 s de son clic, une seule fois, sinon elle n'est pas envoyée.
Gladys a sa réponse en 3,5 s au plus : « fait, confirmé par l'appareil » (un message de
l'appareil reçu après l'envoi montre la valeur demandée), « envoyé, sans confirmation » (le
statut dit ensuite si l'appareil l'a montré dans les 20 s), ou un refus qui finit par
« Rien envoyé ». La dernière commande s'affiche dans le statut de la page de configuration.

**Ouvrir l'eau** n'est envoyé que si tout cela est vrai, d'après ce que le hub a publié
depuis la connexion au broker (DROP n'a pas de requête de lecture ; à chaque connexion ou
déconnexion, tout redevient inconnu jusqu'aux messages suivants) :

- « Autoriser l'ouverture de l'eau » est cochée, au clic et juste avant l'envoi ;
- l'état de la vanne de l'appareil est connu ; déjà ouverte : rien n'est envoyé ;
- son état de fuite est connu et sans fuite ;
- chaque appareil du même hub qui peut signaler une fuite (hub, vanne, détecteurs, pompe,
  osmoseur, alerte), annoncé par le hub ou créé dans Gladys, a un état connu, sans fuite
  ni alerte. Une fuite signalée par n'importe quel appareil du hub, même d'un type que
  l'intégration ne connaît pas, refuse aussi. Un détecteur retiré ou hors service bloque
  l'ouverture : supprimez-le dans Gladys et retirez-le du hub (tant que le hub l'annonce,
  il compte). Après une reconnexion, un détecteur qui ne publie que sur changement bloque
  l'ouverture jusqu'à son prochain message (à vérifier sur un vrai hub) ;
- aucun message du broker n'a été ignoré (plus de 200 par seconde) dans les 2 dernières
  secondes ; après des messages ignorés, chaque valeur redevient inconnue jusqu'au message
  suivant de son appareil ;
- aucune coupure de ce hub n'est partie depuis moins de 20 s, et aucune n'a été cliquée
  depuis ce clic.

Une ouverture qui part abandonne les coupures gardées de ce hub.

**Bypass** (hub, adoucisseur, filtre ; activé : l'eau contourne le traitement) et **mode de
protection** (hub : Maison, Absent, Programmé ; Absent est le plus strict) : refusés si leur
option est décochée ; rien n'est envoyé s'ils sont déjà dans l'état demandé. Passer en
Absent n'est pas une coupure : cela reste derrière l'option du mode de protection.

## Sécurité

- Toute personne qui peut publier sur votre broker peut commander la vanne et inventer des
  messages du hub : protégez le broker par un mot de passe et des droits (ACL), gardez-le
  sur un réseau de confiance.
- Le mot de passe est gardé par Gladys dans sa base, jamais réaffiché, envoyé seulement à
  votre broker ; il n'apparaît ni dans les journaux, ni dans `/data`, ni dans le statut.
- Identifiants refusés par le broker : l'intégration s'arrête et ne réessaie pas d'elle-même,
  même après un redémarrage (elle garde dans `/data` une marque de 8 bits, inutilisable pour
  retrouver le mot de passe). Enregistrez d'autres identifiants ou cliquez sur « Tester la
  connexion ». Un mot de passe sur 256 tombe sur la même marque : le bouton lève alors l'arrêt.
- Chaque message du broker est limité à 16 Ko avant d'être lu ; au-delà de 200 messages par
  seconde, les suivants sont ignorés ; 8 hubs et 64 appareils au plus.

## Limites

- Jamais testé avec un vrai appareil ; le nom du réglage MQTT dans l'application DROP
  Connect peut différer.
- Le hub publie à son rythme : une valeur peut rester longtemps sans mise à jour (rien
  n'est inventé entre deux messages).
- Un type d'appareil que le hub annonce et que l'intégration ne connaît pas est ignoré
  (compté dans le statut).
