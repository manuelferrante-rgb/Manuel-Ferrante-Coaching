# Manuel Ferrante Coaching — note per Claude

Manuel è un coach di streetlifting/calisthenics. Scrive in italiano, spesso dal telefono e a voce:
rispondi in italiano semplice, breve, senza gergo tecnico. Vuole cose veloci, curate e oneste
(se qualcosa non funziona o non è verificato, dillo).

## Repository e pubblicazione

- Si lavora sul branch `claude/brief-redesign-sito-jzyaim` e, con il suo consenso già dato, si
  pubblica anche su `main` (`git push origin claude/brief-redesign-sito-jzyaim:main`).
- `main` è servito da GitHub Pages: **https://manuelferrante-rgb.github.io/Manuel-Ferrante-Coaching/**
  (sito di prova). GoodLift di prova: **…/Manuel-Ferrante-Coaching/goodlift/**.
- Il file `CNAME` è stato tolto apposta: il dominio vero `manuelferrante.it` punta ancora a Netlify
  (caricamento a mano della cartella "ManuelPT"). Piano: alla fine si passa tutto su GitHub Pages
  (rimettere `CNAME`, cambiare i DNS su Squarespace Domains, dove è finito il dominio comprato su
  Google Domains). Prima si finisce GoodLift e le modifiche al sito.
- Commit in italiano, con le righe di attribuzione richieste dalla sessione. Mai nomi di modelli.

## Sito (`index.html`)

Pagina unica in italiano, tema scuro con oro `#c9a35a`, font Bebas Neue / DM Sans / DM Mono.
Modulo candidature su Formspree con UTM (`utm_source`/`utm_medium`, testato: funziona).
Foto e video del sito stanno nella cartella locale di Manuel "ManuelPT" (non tutte nel repo):
ricordargli di caricare le immagini quando l'index è definitivo. Manuel vuole poi modificare il
sito in base a un'analisi del suo profilo da coach (te lo dirà lui).

## GoodLift (`goodlift/`) — il giudice delle alzate

App web open source (AGPL-3.0), logo "¿OODLIFT" (il ¿ fa da G). Si registra dall'app (fotocamera
posteriore o frontale) o si carica un video; analisi nel browser con
MediaPipe Pose (modello `heavy` per l'analisi, `lite` per la diretta); verdetto GOOD LIFT / NO REP,
spiegazione, replay con linee e traiettoria. Deve essere semplicissima ("anche mia nonna") e veloce.

File: `index.html` (UI), `app.js` (fotocamera, analisi, replay, comandi), `core.js` (serie, fermi,
ripetizioni, verdetto, consigli), `engine.js` (squat + elenco alzate), `lifts.js` (panca, stacco,
trazioni, dip, muscle up), `plates.js` (trova e segue il disco nell'immagine, Hough),
`tests/squat.test.mjs`.

Regole decise con Manuel (non cambiarle senza chiedere):
- Niente comandi vocali (tolti a novembre 2026: troppo confusionari) e niente giudizio su start,
  rack e giù: nessun fermo iniziale o finale richiesto. Restano tutti gli altri criteri.
- Squat severo e oggettivo: il femore deve rompere il parallelo (anca sotto il ginocchio).
  Niente linea tratteggiata nel replay: linea del femore + angolo ("FEMORE 3° SOTTO IL PARALLELO").
- Panca: conta soprattutto il fermo di 1 s al petto (questo resta); il gomito all'altezza della spalla è regola
  accessoria (no rep solo se chiaramente sopra). Sedere e piedi giù dal fermo a braccia tese in poi
  (l'arco lombare non è "sedere che si alza").
- Stacco: partenza libera, nessuna discesa del bilanciere, chiusura a gambe tese, spalla dietro il
  bilanciere.
- Trazioni: niente kip, gambe fluide senza scatti, mento sopra la sbarra, ritorno a braccia tese. Muscle up: niente kip, anca fluida, ginocchio teso (5° di tolleranza).
  Dip: spalla sotto il gomito.
- Si giudica da qualsiasi lato, anche da davanti (tutte le alzate). Da davanti profondità di squat,
  dip e panca si misurano col dislivello verticale rapportato alla lunghezza del segmento; quello che
  non si vede (es. spalla dietro il bilanciere nello stacco) diventa nota, non "non riesco".
- In palestra ci sono giudici/spotter: l'analisi parte cercando fino a 3 persone per fotogramma
  (modello in modalità IMAGE) e pickPerson sceglie la traccia che fa l'alzata. Se nei primi 6
  fotogrammi c'è una persona sola, passa subito alla modalità veloce (VIDEO, 1 persona): la ricerca
  non deve allungare l'analisi quando non serve.
- Trazioni: se il mento non si vede (ripresa da dietro o di tre quarti da dietro, testa coperta) si
  giudica "a impressione" da quanto le spalle arrivano vicino alle mani: valida con nota.
- Durante l'analisi la schermata mostra già le ripetizioni trovate (chip provvisori).
- Niente intelligenza artificiale online a pagamento per i casi difficili (decisione di Manuel,
  novembre 2026: "per ora no"). Tutto resta nel telefono. Se il modello non trova il segmento che
  conta (es. squat con busto coperto dai dischi: sbaglia l'anca), si spiega il perché.
- Dettaglio non visibile → GOOD LIFT con nota. "Non riesco a giudicare" deve essere rarissimo.
- Valida ma al limite → riquadro giallo "Da migliorare". No rep di poco → "No rep per poco" +
  "Come sistemarla". Mai i due insieme.
- Più ripetizioni: si giudicano tutte (chip "1º 2º 3º", colore = verdetto). Conta solo una
  ripetizione vera (persona presente, movimento completo, mani in presa nel punto chiave: se scende
  dalla sbarra/parallele o lascia il bilanciere e si riposa mentre il video continua, non conta).
- Replay a velocità normale, pulsanti Rallenty e Traiettoria (bilanciere per squat/panca/stacco;
  per trazioni/dip/muscle up un solo pulsante "Traiettoria dischi": segue il disco se lo trova
  nell'immagine, altrimenti i piedi), una ripetizione alla volta, linea sottile da penna.
- Etichette in analisi coerenti con l'alzata (KNEE/HIP, ELBOW, CHIN, SHOULDER), stesso formato.

## Prove

- `node goodlift/tests/squat.test.mjs` (test sintetici, devono passare tutti).
- Server locale: `python3 -m http.server 8933` dalla radice; `?debug&delegate=CPU` nell'indirizzo
  (il modello heavy su GPU va in timeout nella sandbox). Chromium della sandbox non legge H.264:
  convertire i video in webm VP9 con ffmpeg. I video in `videos/` sono clip montate del sito,
  spesso non di lato: non vanno bene per tarare le soglie (servono video veri di Manuel, di lato,
  validi e no rep).
