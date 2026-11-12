# ¿oodLift — il giudice delle tue alzate

**GoodLift** ti dice se un'alzata è **GOOD LIFT** o **NO REP**, e perché, come un giudice di gara di streetlifting e powerlifting.
Carichi un video (o ti registri dall'app) e lui analizza il movimento, ti mostra il verdetto e un replay con linee e angoli.

- **Gratis e open source**, licenza [AGPL-3.0](LICENSE).
- **Privato**: il video non lascia mai il telefono. L'analisi avviene nel browser, con [MediaPipe Pose](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker).
- **Nessuna installazione**: è un sito che si apre dal telefono e si può aggiungere alla schermata Home.

Ideato da **[Manuel Ferrante Coaching](https://www.manuelferrante.it)** · Instagram [@_manuelferrante](https://www.instagram.com/_manuelferrante/).

> È un aiuto al giudizio, non un verdetto ufficiale.

## Stato

| Alzata | Stato |
|---|---|
| Squat | prototipo |
| Panca, Stacco, Trazioni, Dip, Muscle up | in arrivo |

## Come riprendere il video

1. **Esattamente di lato** (90° rispetto all'atleta), telefono **fermo**.
2. Telefono **all'altezza dell'anca** (per trazioni, dip e muscle up: all'altezza della sbarra o delle parallele).
3. **Tutto il corpo** nell'inquadratura, con un po' di margine, a circa 3–4 m.
4. Includi **1–2 secondi prima e dopo** l'alzata, così si vedono i fermi.

## Regole di giudizio

In gara il giudice dà i comandi (start, press, rack, down…). Nel video nessuno li sente, quindi GoodLift controlla
il **fermo di 1 secondo** che li precede: prima il fermo, poi il comando, come in gara.
Se un dettaglio non si vede nel video (es. il video inizia a discesa già iniziata) il verdetto resta GOOD LIFT,
ma l'analisi dice cosa non si è potuto controllare.

**Squat** — fermo di 1 s a gambe tese · la parte alta dell'anca scende sotto la parte alta del ginocchio (femore sotto il parallelo) · salita senza movimenti verso il basso del bilanciere · fermo di 1 s a gambe tese (= "rack").

**Panca** — fermo di 1 s a braccia tese · al petto il gomito almeno all'altezza della testa dell'omero (omero parallelo al terreno) · fermo di 1 s al petto (= "press") · spinta senza movimenti verso il basso · fermo di 1 s a braccia tese (= "rack") · il sedere resta sempre a contatto con la panca.

**Stacco** — partenza libera · nessun movimento verso il basso del bilanciere · chiusura a gambe tese con la spalla dietro il bilanciere · fermo di 1 s (= "down").

**Trazioni** — fermo di 1 s a braccia tese · niente kip di spalla (si tira e basta, senza abbassare e rialzare le spalle per prendere slancio) · le gambe possono andare un po' avanti, ma in modo fluido, senza scatti che aiutano la tirata · il mento supera la sbarra salendo in verticale · discesa controllata fino a braccia tese, con almeno 0,5–1 s di fermo.

**Dip** — fermo di 1 s a braccia tese · in basso la parte alta della spalla scende sotto la parte alta del gomito · fermo di 1 s a braccia tese.

**Muscle up** — fermo di 1 s a braccia tese · niente elevazione di spalla in partenza (solo oscillazione in avanti e depressione della spalla) · l'anca può flettersi se il movimento è fluido, ma nessun kip/scatto che spezza l'alzata · il ginocchio non si piega (tolleranza 5°, solo come margine di misura) · sopra la sbarra fermo di 1 s a braccia tese.

## Per chi vuole contribuire

È un sito statico, senza build: `index.html` (interfaccia e stile), `app.js` (fotocamera, analisi, replay) e
`engine.js` (il giudice: regole e soglie, senza dipendenze dal browser).

- Avvio in locale: `python3 -m http.server` dalla cartella che contiene `goodlift/`, poi apri `http://localhost:8000/goodlift/`.
- Test del giudice: `node goodlift/tests/squat.test.mjs`.
- Debug: aggiungi `?debug` all'indirizzo; i dati dell'ultima analisi sono in `window.__goodlift`.
- Le soglie sono in cima a `engine.js` (`SQUAT`): vanno tarate su video reali di alzate valide e no rep.

Librerie incluse: MediaPipe Tasks Vision (Apache-2.0, `vendor/mediapipe`), modelli Pose Landmarker (Apache-2.0, `models/`),
font Bebas Neue, DM Sans, DM Mono (SIL Open Font License, `fonts/`).
