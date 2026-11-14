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

File: `index.html` (UI), `app.js` (fotocamera, analisi, replay, comandi), `second.js` (secondo occhio:
YOLOX-nano + RTMPose-s con onnxruntime-web), `core.js` (serie, fermi,
ripetizioni, verdetto, consigli), `engine.js` (squat + elenco alzate), `lifts.js` (panca, stacco,
trazioni, dip, muscle up), `plates.js` (trova e segue il disco nell'immagine, Hough),
`tests/squat.test.mjs`.

Regole decise con Manuel (non cambiarle senza chiedere):
- Niente comandi vocali (tolti a novembre 2026: troppo confusionari) e niente giudizio su start,
  rack e giù: nessun fermo iniziale o finale richiesto. Restano tutti gli altri criteri.
- Squat severo e oggettivo: il femore deve rompere il parallelo (anca sotto il ginocchio).
  Niente linea tratteggiata nel replay: linea del femore + angolo ("FEMORE 3° SOTTO IL PARALLELO").
- Panca: conta soprattutto il fermo al petto, **0,8 s** (deciso il 14 nov, prima era 1 s); il gomito all'altezza della spalla è regola
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
- Video che finisce prima della chiusura (davvero: controllo "Il video finisce prima…") → quella
  ripetizione non si giudica, messaggio "Il video finisce prima della fine dell'alzata: riprendi
  tutta l'alzata, fino a …" (tutte le alzate; deciso con Manuel). Errori veri già visti restano no rep.
  Eccezione trazioni: se manca solo il ritorno a braccia tese (mento sopra già visto) → GOOD LIFT
  con nota "Il video finisce prima del ritorno a braccia tese: non l'ho potuto controllare"
  (Manuel: Elisabetta è valida).
  Muscle up: valida dopo la chiusura sopra a braccia tese; se il video finisce prima che torni giù →
  nota. Stacco: chiusura a gambe tese fondamentale; se finisce prima di riportare il bilanciere a
  terra → valida con nota. Dip, panca (braccia tese) e squat (gambe tese): chiusura fondamentale.
- Riconoscere l'atleta tra più persone (gare: giudici, spotter) vale per tutte le alzate e va fatto
  "dal contesto" (Manuel). pickPerson (core.js): le tracce si collegano anche con la posizione
  delle mani (uno spotter dietro l'atleta ha il busto nello stesso punto ma le mani altrove); i
  pezzi di traccia spezzati da movimenti veloci si riattaccano (fine e inizio vicini, entro 0,5 s);
  a trazioni/muscle up conta chi ha le mani all'altezza della sbarra (stimata dalle mani di chi è
  appeso), anche sopra la sbarra. Muscle up di Nicolò (`videos/nicolo-muscleup-2875kg.mp4`):
  su 4 prove salvate da 1 valida a 3 valide (la 4ª: no rep per ginocchio, transizione confusa).
- Telefono in mano che si muove (tutte le alzate, `motion.js`): non deve cambiare il verdetto.
  Si misura lo spostamento dello sfondo rispetto al primo fotogramma (sulle copie in grigio,
  persone escluse) e lo si toglie dai punti prima di pickPerson/analyze; il replay lo rimette
  (`result.replay.shift`) per disegnare sopra il video vero. Solo se serve: controllo veloce su 4
  fotogrammi, se il telefono è fermo non si fa nulla (~50–150 ms nella sandbox). Manuel: tutto
  standard, semplice e veloce; correzioni in più solo quando servono. Giacomo trazioni ora valida.
- Prova senza browser: salvare `state.raw` (poses per fotogramma) da `?debug&nosecond` e
  rifare pickPerson + analyze in Node: stesso input, confronto vecchio/nuovo deterministico.
- Fine serie (Manuel l'ha chiesto più volte, per tutte le alzate): quello che succede dopo l'ultima
  ripetizione NON è una ripetizione. Dip e trazioni: nelle ripetizioni vere i polsi restano fermi in
  presa (spostamento ~0,01 del braccio); se si spostano più di 0,15 del braccio tra partenza e punto
  chiave non è una ripetizione (video di Manuel: piedi a terra, lascia le parallele, si piega a
  sganciare il disco → prima contava una 4ª no rep). Squat, panca, dip: l'ultima "ripetizione" che
  scende e non prova più a risalire (meno del 30%) mentre il video continua almeno 1 s non conta.
  Provate e scartate (sbagliavano su video veri): anca/caviglie che devono seguire le spalle.
- **L'alzata non si sceglie più (14 nov, richiesta di Manuel):** GoodLift la riconosce dal video
  (`detectLift` in core.js, `recognize` in engine.js). Per ogni alzata si sceglie la persona con
  pickPerson e si guarda la postura: appeso (mani sopra le spalle) → trazioni, o muscle up se poi
  le spalle passano sopra le mani a braccia tese; sdraiato (o "seduto" per tutto il video, panca
  vista dai piedi) → panca; poi squat (mani alle spalle, ginocchia piegate), stacco (mani vicino
  alle ginocchia a braccia tese), dip (gomiti piegati, mani all'anca). Se il giudice dell'alzata
  scelta dice "non riesco" si provano le altre plausibili. Dopo il secondo occhio si riconosce di
  nuovo con i suoi punti. Nel risultato: pillola "TRAZIONI ▾" (tocca → elenco → rigiudica subito,
  senza rianalizzare) e una riga sotto il verdetto solo quando serve: "Era un muscle up?" (spalle
  oltre le mani di più di 0,25 braccia ma senza chiusura), "È uno squat? Se no, tocca l'alzata
  giusta" (prove deboli), "Che alzata è?" (non riesco a giudicare: elenco già aperto).
  `?lift=squat` nell'indirizzo impone l'alzata (prove). Prove sui 18 video: 17/18 e 16/18 giusti;
  gli errori solo su video "non riesco" (dip di Nicolò con 10 fotogrammi nella sandbox, panca
  intera di Jasmin vista dai piedi), sempre con la domanda "Che alzata è?".
- Spotter e panca (video di Manuel, IMG_8776, 14 nov): da quell'angolazione MediaPipe NON vede chi è
  sdraiato, solo lo spotter in piedi (1 persona in tutti i fotogrammi) → prima giudicava lo spotter
  come muscle up. Ora: (1) in detectLift l'atleta deve fare il movimento dell'alzata (spostamento
  verticale minimo del punto che si muove: anca nello squat, polsi in panca, spalle a trazioni/
  muscle up/dip); uno spotter fermo non è nessuna alzata → "non riesco" → secondo occhio, che trova
  tutte le persone (anche sdraiate). (2) Se il primo giudizio è "non riesco", il secondo occhio
  guarda tutto il video (non il pezzo stimato dai punti di MediaPipe), a 8 fotogrammi/s se il pezzo
  è lungo più di 10 s. (3) Pillola: se con l'alzata scelta non c'è niente da giudicare si riprova
  con i punti del secondo occhio, o lo si fa partire ("Riguardo il video con più attenzione…").
  Risultato su IMG_8776: panca, 5 ripetizioni, tutte no rep per fermo al petto ~0,4-0,5 s
  (verificato a parte seguendo il disco: fermo vero ~0,4-0,6 s).
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

- `node goodlift/tests/squat.test.mjs` e `node goodlift/tests/fine-serie.test.mjs` (devono passare
  tutti). Il secondo contiene anche lo scheletro del dip vero di Manuel (`tests/fixtures/`).
- Server locale: `python3 -m http.server 8933` dalla radice; `?debug&delegate=CPU` nell'indirizzo
  (il modello heavy su GPU va in timeout nella sandbox). Chromium della sandbox non legge H.264:
  convertire i video in webm VP9 con ffmpeg. I video in `videos/` sono clip montate del sito,
  spesso non di lato: non vanno bene per tarare le soglie (servono video veri di Manuel, di lato,
  validi e no rep).

## Lavoro in corso (novembre 2026): squat con busto coperto dai dischi

Manuel vuole che alzate come lo squat di Jasmin (`videos/jasmin-squat-200kg.mp4`: busto e testa
coperti dai dischi, femore ben visibile, chiaramente sotto il parallelo) siano giudicabili.
"Non puoi non giudicare per una cosa che non influenza il giudizio": vale per tutte le alzate.
- Problema verificato: MediaPipe (BlazePose) trova la persona partendo da faccia e busto. Coperti
  quelli, sbaglia anca e ginocchio a caso (provato con 5 varianti per fotogramma: femore da -89° a
  +59° sullo stesso fotogramma). Non è un problema di soglie.
- Piano: provare un modello che trova le articolazioni una per una e regge le parti coperte
  (RTMPose / RTMO di OpenMMLab in ONNX, con onnxruntime-web nel browser; detector di persona tipo
  YOLOX-nano o RTMDet-nano). Prima verificare in Python (onnxruntime) sui fotogrammi di Jasmin che
  anca e ginocchio siano giusti; solo dopo integrarlo in GoodLift come "secondo occhio" quando
  MediaPipe non trova anca/ginocchio affidabili (o al posto suo, se è migliore e veloce).
  Idea di Manuel: partire da caviglia e ginocchio (visibili) per arrivare all'anca.
- Per scaricare i modelli serve l'ambiente cloud "manuel-ferrante-coaching" (creato apposta, con
  download.openmmlab.com e huggingface.co aperti). La sessione vecchia non poteva spostarsi lì.
- Niente servizi online a pagamento (decisione di Manuel): tutto deve girare nel telefono.

### Risultato delle prove (13 novembre 2026)
- Provati in Python (onnxruntime) RTMO-s (40 MB, un solo modello) e RTMPose t/s/m (13/22/54 MB) +
  detector YOLOX nano/tiny, anche la versione con i piedi (Halpe26). Tutti d'accordo e sicuri
  (fiducia 0.9+), stabili da un fotogramma all'altro: su Jasmin anca e ginocchio sono **giusti**
  (Jasmin guarda a sinistra: ginocchio = ginocchiera nera a sinistra, anca nel gluteo a destra).
  Attenzione: a prima vista sembra il contrario, ma punta delle scarpe e ginocchiera lo confermano.
- Però in buca (~2.0 s) il femore *in foto* è circa **18° sopra il parallelo** (anca ~30 px più
  alta del ginocchio). Ripresa di tre quarti dall'alto: il ginocchio è più vicino alla camera e
  sembra più basso; la correzione di prospettiva non è affidabile. Quindi il nuovo modello, così
  com'è, darebbe NO REP a Jasmin.
- **Decisione di Manuel (14 nov):** lo squat di Jasmin è no rep di poco ("può essere anche
  l'angolazione, ma accetto che sia no rep"). Quindi il nuovo modello è giusto ed è **integrato**.
- Come funziona (`second.js` + `app.js`): MediaPipe fa il primo giro. Il secondo occhio rifà
  l'analisi (a salti, solo nel pezzo con l'alzata) se (a) il risultato è "non riesco a giudicare"
  (tutte le alzate) o (b) nello squat, nel punto più basso di ogni ripetizione, il femore di
  MediaPipe e quello del secondo occhio differiscono di più di 10° (controllo su 1 fotogramma per
  ripetizione, saltato da davanti). Si usa il nuovo risultato se non è "non riesco". Il detector
  gira ogni 3 fotogrammi, negli altri il riquadro viene dai punti del fotogramma prima.
  Si scarica **solo se serve, per tutte le alzate** (richiesta di Manuel): nello squat il controllo
  in buca parte solo se MediaPipe è incerto (anca/ginocchio con visibilità < 0.8, femore che salta
  di oltre 12° rispetto ai fotogrammi vicini, buca ricostruita). Prima volta ~37 MB, poi in cache.
  Non parte se il "non riesco" è perché il video finisce prima della chiusura.
  `?nosecond` nell'indirizzo lo spegne (per confronti). Risultati: Jasmin NO REP (femore ~17°
  sopra), Arianna squat da "non riesco" a no rep per poco (femore ~parallelo, anca dietro i
  dischi); trazioni, dip, muscle up, stacco invariati.
- Velocità (CPU desktop, 1 thread): RTMPose-s 10 ms + YOLOX-nano 12 ms; RTMO-s 160 ms (troppo lento).
  Se si integra: RTMPose-s + YOLOX-nano (~26 MB) con onnxruntime-web.
- Trazioni di Elisabetta e muscle up frontale di Lorenzo: scheletro buono, non peggio di MediaPipe.
- Modelli: download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/ (zip con end2end.onnx;
  ingresso 256x192, normalizzazione mean 123.675/116.28/103.53, std 58.395/57.12/57.375, RGB, box
  allargato 1.25; uscite simcc_x/simcc_y, argmax/2). YOLOX: 416x416, pad 114, BGR senza normalizzare.

