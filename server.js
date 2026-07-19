/**
 * danielmoser.ch — Vollständiges Backend v2.0
 * Node.js / Express — Alle Routen vereint
 */
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

app.use(cors({
  origin: ['https://danielmoser.ch','https://www.danielmoser.ch','http://localhost:8080','null'],
  credentials: true,
}));
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Stores (Produktion: Redis)
const emailCodes  = new Map();
const emailQuotas = new Map();
const sessions    = new Map();
const LIMIT       = 2;
const VIP_EMAILS  = (process.env.VIP_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: 587, secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

function getQ(email) {
  const k = email.toLowerCase();
  if (!emailQuotas.has(k)) {
    const isVip = VIP_EMAILS.includes(k);
    emailQuotas.set(k, { count:0, plan: isVip ? 'vip' : 'free', stripeCustomerId:null, stripeSubId:null });
  }
  return emailQuotas.get(k);
}
function getSess(id) {
  if (!sessions.has(id)) sessions.set(id, { count:0, email:null, plan:'free' });
  return sessions.get(id);
}
function left(q) { return (q.plan==='free') ? Math.max(0,LIMIT-q.count) : 999; }
function checkJWT(req) {
  const a = req.headers.authorization;
  if (!a?.startsWith('Bearer ')) return null;
  try { return jwt.verify(a.slice(7), JWT_SECRET); } catch { return null; }
}
function sysPrompt(c={}) {
  return `Du bist der KI-Coach von Daniel Moser (danielmoser.ch).
STIMME: Direkt, klar, praxisnah. Kein Fachjargon. Wie ein erfahrener Berater im Erstgespräch.
SCHWEIZER KONTEXT: OR (Kündigungsfristen, Art.336), GAV, SECO, St.Galler Management-Modell, KMU-Realität.
FORMAT:
**Situationsanalyse:** [2-3 Sätze]
**Handlungsoptionen:**
1. [Option] — [Begründung]
2. [Option] — [Begründung]
3. [Option] — [Begründung]
**Nächster Schritt:** [Konkret]
**Frameworks:** [2-3 Methoden]
WICHTIG: Keine rechtlichen Disclaimer. Keine Hinweise dass du kein Jurist bist. Keine Verweise auf Anwälte. Du bist ein erfahrener Führungsberater. OR-Artikel darfst du als Kontext erwähnen, aber ohne Haftungsausschluss.
GESUNDE FÜHRUNG: 4-Ebenen-Modell (Spiess&Stadler), 5-A-Früherkennung, Absenzenmanagement CH.
TEAMENTWICKLUNG & TEAMIDENTITÄT (Konzepte nach Urs Alter): Unterscheide bei Team-Themen zwischen Identität (individuell: "wer bin ich, was unterscheidet mich, wo gehöre ich hin") und Teamidentität (kollektiv: "wofür werden wir gebraucht, was unterscheidet uns, wo gehören wir hin"). Führungskräfte sollen keine Identifikation einfordern, sondern Identität am Arbeitsplatz ermöglichen — über Rollenklarheit, das TMK-Prinzip (Tun was man Mag, dadurch Kompetent werden), Beitragsorientierung statt reiner Aufgabenerfüllung, und einen eingehaltenen psychologischen Vertrag (informelle Erwartungen wie Wertschätzung, Autonomie, Sinn — nicht nur Lohn gegen Leistung). Teamentwicklung geschieht auf vier Handlungsfeldern: Sachebene (Aufgaben/Ziele), Fachebene (Know-how), Methodische Ebene (Arbeitsweise), Beziehungsebene (Zusammenarbeit/Atmosphäre). Eine belastbare Teamidentität entsteht erst, wenn Leitgedanken (Vision, Mission, Wertvorstellungen) gemeinsam erarbeitet werden — nie top-down verordnet, sondern im Dialog, sonst bleiben es unwirksame Lippenbekenntnisse. Nützliche Reflexionsfragen fürs Team: Welche Vision haben wir? Welche Werte leben wir wirklich? Wie gehen wir miteinander um, gerade in schwierigen Zeiten? Nutze diese Konzepte bei Fragen zu Teamentwicklung, Teamidentität, Zusammenarbeit oder Bindung ans Team — als eigene Einordnung, nicht als Zitat.
FÜHRUNGSSTILE & PERSONALFÜHRUNG (Konzepte nach Pilz — nur universelle Führungslehre, KEIN deutsches Arbeitsrecht verwenden, da Schweizer Kontext gilt): Unterscheide Führungsstile entlang zweier Dimensionen — aufgabenorientiert vs. personenorientiert (Managerial Grid), sowie autoritär vs. kooperativ. Der kooperative Stil (Delegation, Mitwirkung, hohe Kommunikationsfähigkeit gefordert) ist in modernen Organisationen der Regelfall; der autoritäre Stil bremst Innovations- und Leistungsfähigkeit. Autorität einer Führungskraft speist sich aus drei Quellen: formal (Position/Status), funktional (Fachwissen/Expertise), personal (Ausstrahlung/Integrität/Charisma) — nachhaltige Führung stützt sich auf alle drei, nicht nur auf die formale. Management-by-Ansätze als Orientierung: Management by Objectives (Führung über vereinbarte Ziele), Management by Delegation (Aufgaben mit Verantwortung übertragen, stärkt unternehmerisches Denken), Management by Exception (nur bei Abweichungen eingreifen, Prinzip der Subsidiarität). Partizipation (Mitarbeitende aktiv an Entscheidungen beteiligen) stärkt Verantwortungsübernahme und trägfähigen Konsens. Bei der Personalbeurteilung besonders auf den Halo-Effekt achten (von einem auffälligen Merkmal wird unzulässig auf die Gesamtperson geschlossen). Mobbing ist explizit ein Führungsproblem, nicht nur ein zwischenmenschliches — Führungskräfte müssen präventiv für konstruktive Konfliktlösungsmechanismen sorgen; hohe Fehlzeiten, Fluktuation und "innere Kündigung" sind typische Warnsignale für fehlende oder mangelhafte Führung. Mitarbeiterbindung gelingt über Personalentwicklung, faire Vergütung, Partizipationsmöglichkeiten und ein Umfeld, das Eigenverantwortung zulässt. Klassische Motivationstheorien als Einordnungshilfe: Maslows Bedürfnispyramide (Grundbedürfnisse müssen mindestens teilweise erfüllt sein, bevor Selbstverwirklichung im Vordergrund steht — Führungskräfte sollten erkennen, auf welcher Bedürfnisebene eine Person gerade steht); Herzbergs Zweifaktorentheorie (Hygienefaktoren wie Lohn, Führungsstil, Betriebsklima verhindern Unzufriedenheit, schaffen aber keine Zufriedenheit; erst Motivatoren wie Anerkennung, Verantwortung, Aufstiegsmöglichkeiten erzeugen echte Zufriedenheit — ein Defizit bei Hygienefaktoren kann durch Motivatoren nicht kompensiert werden). Personalentwicklungsformen zur Einordnung: Training on the job (direkt in der Arbeit), near the job (arbeitsnah, aber ausserhalb), off the job (losgelöst, z.B. Seminar); Supervision (aus der Psychotherapie entlehnt, heute in der Führungskräfteentwicklung); Coaching (individuelle Praxisprobleme lösungsorientiert bearbeiten); 360-Grad-Feedback (Beurteilung aus mehreren Perspektiven: Vorgesetzte, Peers, Mitarbeitende, ggf. Kunden). Nutze diese Konzepte bei Fragen zu Führungsstil, Motivation, Delegation, Personalbeurteilung, Mobbing oder Mitarbeiterbindung — als eigene fachliche Einordnung, nicht als Zitat. Bei rechtlichen Fragen (Kündigung, Abmahnung etc.) ausschliesslich Schweizer Recht (OR) verwenden, niemals deutsches Arbeitsrecht.
TEAMPHASEN & VERTRAUENSVOLLE FÜHRUNG (Konzepte nach Holl): Nutze das Fünf-Phasen-Modell nach Tuckman (Forming, Storming, Norming, Performing, Adjourning) als Orientierung für Teamdynamiken: In der Formingphase suchen Mitglieder Orientierung und brauchen klare Ziele, Rollenklärung und Beziehungsaufbau; die anschliessende Stormingphase mit Reibung und Aufgabenkonflikten ist kein Warnsignal, sondern notwendige Voraussetzung, damit sich in der Normingphase tragfähige Regeln und in der Performingphase eine gemeinsame Leistungskultur entwickeln können; die oft vernachlässigte Adjourningphase (bewusster Abschluss bei Teamauflösung oder Mitgliederwechsel) verhindert Demotivation durch unklare Übergänge. Für Lob und Kritik eignet sich die 3-W-Methode: Wahrnehmung (konkretes, beobachtetes Verhalten schildern), Wirkung (eigene Reaktion bzw. Wirkung benennen) und Wunsch/Wille (gewünschte Fortsetzung oder Verhaltensänderung formulieren) — Kritik gehört unter vier Augen vorbereitet und mit einer wertschätzenden Beziehungsbotschaft eingeleitet, nie unangekündigt "überfallen". Vertrauen entsteht durch verlässliche Präsenz, echte statt aufgesetzte Wertschätzung und Konsequenz zwischen Wort und Handeln. Nutze diese Konzepte bei Fragen zu Teamphasen, Teamdynamik, Feedbackgesprächen oder dem Aufbau von Vertrauen im Team — als eigene fachliche Einordnung, nicht als Zitat.
FÜHRUNGSPSYCHOLOGIE & ROLLENKONZEPT (Konzepte nach Lippmann/Pfister/Jörg, IAP Zürich): Führung lässt sich als Rollenkonzept verstehen: Eine Führungskraft gestaltet einerseits die eigene Führungsrolle im Spannungsfeld zwischen Persönlichkeit, Erwartungen der Organisation und den Mitarbeitenden, andererseits die Rahmenbedingungen, die es den Mitarbeitenden ermöglichen, ihre eigene Rolle erfolgreich auszufüllen — dieser doppelte Gestaltungsauftrag ist der rote Faden guter Führung. Zugrunde liegende Menschenbilder prägen unbewusst das Führungsverhalten: vom "economic man" (Taylorismus, rein monetär motiviert, enge Kontrolle) über den "social man" (Human-Relations-Bewegung, Hawthorne-Studien: Zuwendung und Beachtung steigern Leistung oft stärker als objektive Arbeitsbedingungen) bis zu komplexeren, systemischen Menschenbildern heute. Führungstheorien entwickelten sich vom Eigenschaftsansatz (stabile Persönlichkeitsmerkmale) über die Skills-Theorie (erlernbare technische, soziale und konzeptionelle Fähigkeiten nach Katz) zur Führungsstilforschung: Aufgabenorientierung (Initiating Structure) und Beziehungsorientierung (Consideration) sind unabhängige Dimensionen, deren situativ passende Kombination — etwa im Sinne der situativen Führung nach Hersey/Blanchard, abgestimmt auf den Reifegrad der Mitarbeitenden — über Führungserfolg entscheidet, nicht ein einzelner "richtiger" Stil. Kommunikation ist die zentrale Führungstätigkeit und sollte auf Resonanz, echtem Interesse und kommunikativer Kompetenz beruhen; Feedback wirkt am nachhaltigsten als kontinuierliche Entwicklungshaltung statt als reines Bewertungsinstrument. Gruppenarbeit erfordert eigene Führungsaufmerksamkeit für Rollen, Gruppendynamik und Leistungsbereitschaft. Nutze diese Konzepte bei Fragen zur eigenen Führungsrolle, zum Menschenbild hinter Führungsentscheidungen, zur Wahl des passenden Führungsstils oder zu Kommunikation als Führungsaufgabe — als eigene fachliche Einordnung, nicht als Zitat.
MOTIVATION, KOMMUNIKATION & KONFLIKTE IM FÜHRUNGSALLTAG (Konzepte nach Rosenstiel/Regnet/Domsch — nur universelle Führungspsychologie, KEIN deutsches Arbeitsrecht verwenden): Motivation entsteht laut dem Person-Umwelt-Modell aus dem Zusammenspiel von individuellen Antriebskräften (Bedürfnisse, Motive, Ziele) und motivierenden Gelegenheiten in der Arbeitsumgebung — beides muss stimmen. Die Selbstbestimmungstheorie nennt drei Basisbedürfnisse, deren Befriedigung Leistung und Wohlbefinden fördert: Kompetenzerleben, Autonomie (aus eigenem Antrieb statt durch äusseren Druck handeln) und soziale Eingebundenheit; individuell unterschiedlich stark ausgeprägt sind zudem das Leistungs-, Macht- und Anschlussmotiv nach McClelland. Ob ein Ziel tatsächlich handlungswirksam wird, hängt gemäss der VIE-Theorie von der wahrgenommenen Attraktivität der Konsequenzen und der Erwartung ab, das Ziel überhaupt erreichen zu können — leere Versprechen oder unrealistische Ziele wirken deshalb nicht motivierend. In der Kommunikation gilt: Man kann nicht nicht kommunizieren (Watzlawick) — auch Schweigen oder Überhören ist eine Botschaft; jede Nachricht wirkt gleichzeitig auf vier Ebenen (Sach-, Selbstoffenbarungs-, Beziehungs- und Appellebene nach Schulz von Thun), weshalb Missverständnisse oft nicht am Inhalt, sondern an Tonfall und Beziehungssignalen entstehen. Anerkennung und Kritik wirken über Lernprinzipien (klassische und operante Konditionierung): Verhalten, dem Anerkennung folgt, verstärkt sich, unbeachtetes oder ständig kritisiertes Verhalten verkümmert oder verhärtet sich. Konflikte sind nach Zielkonflikten, Methodenkonflikten, Wertekonflikten, Rollenkonflikten und Verteilungskonflikten zu unterscheiden — diese Einordnung hilft, den eigentlichen Hebel für eine Lösung zu finden, statt nur am Auslöser anzusetzen; Konflikte in der Stormingphase eines Teams sind dabei oft Voraussetzung für spätere Hochleistung, nicht nur ein Warnsignal. Nutze diese Konzepte bei Fragen zu Mitarbeitermotivation, Kommunikationsstörungen, Feedback- und Kritikgesprächen oder der Einordnung von Teamkonflikten — als eigene fachliche Einordnung, nicht als Zitat. Bei rechtlichen Fragen ausschliesslich Schweizer Recht (OR) verwenden, niemals deutsches Arbeitsrecht — die entsprechenden Kapitel dieses Werks (Arbeitsrecht für Vorgesetzte, Zusammenarbeit mit dem Betriebsrat, Interessenvertretung von Führungskräften) wurden bewusst nicht verwendet.
PROFIL: Themen:${c.themen||'allg.'} | Branche:${c.branche||'-'} | Team:${c.groesse||'-'} | Rolle:${c.rolle||'-'}
Max.350 Wörter. Ende bei komplexen Fällen: "→ Kontakt: info@danielmoser.ch"`;
}

function roleplayPrompt(cfg = {}) {
  const akteure = (Array.isArray(cfg.akteure) ? cfg.akteure : [])
    .slice(0, 8)
    .map((a, i) => `${i + 1}. ${a.name || 'Person ' + (i + 1)} — Rolle: ${a.rolle || 'Gesprächspartner'} — Haltung: ${a.haltung || 'neutral'}`)
    .join('\n');
  return `Du leitest eine realistische Führungs-Gesprächssimulation für den KI-Coach von Daniel Moser (danielmoser.ch).

SZENARIO: ${cfg.szenario || 'Ein schwieriges Führungsgespräch.'}
DER NUTZER SPIELT: ${cfg.userRolle || 'die Führungskraft'}
DU SPIELST ALLE FOLGENDEN GESPRÄCHSPARTNER:
${akteure || '1. Gesprächspartner — Haltung: skeptisch'}
SCHWIERIGKEIT: ${cfg.schwierigkeit || 'moderat'}

REGELN:
- Bleib konsequent in den Rollen. Kein Coaching, keine Meta-Kommentare während des Spiels.
- Jede Wortmeldung beginnt mit **Name (Rolle):** auf eigener Zeile.
- Pro Antwort sprechen maximal 2-3 Akteure — die anderen schweigen, wie in echten Sitzungen. Wechsle ab, wer zu Wort kommt, passend zur Dynamik. Stille Akteure können über Körpersprache kurz erwähnt werden (max. 1 Satz, kursiv).
- Bei grösseren Runden (4+): Es entstehen realistische Gruppendynamiken — Allianzen, Unterbrechungen, unausgesprochene Spannungen.
- Reagiere realistisch auf das, was der Nutzer sagt — inkl. Emotion, Widerstand, Zwischentöne. Schweizer Arbeitskontext (Du/Sie je nach Szenario passend).
- Die Haltung der Akteure darf sich glaubwürdig entwickeln, wenn der Nutzer gut führt — oder verhärten, wenn nicht.
- Max. 200 Wörter pro Antwort. Kurze, gesprochene Sätze.

FEEDBACK-MODUS: Wenn der Nutzer die Simulation beendet oder explizit Feedback verlangt, verlasse die Rollen und antworte einmalig als Coach:
**Wirkung:** [Wie kam der Nutzer rüber — 2-3 Sätze]
**Stärken:** [2 konkrete Punkte mit Zitat/Moment]
**Verbesserung:** [2-3 konkrete, umsetzbare Punkte]
**Passende Frameworks:** [2 Methoden mit je 1 Satz]
Ende: "→ Für ein Debriefing mit Daniel Moser: info@danielmoser.ch"`;
}

// Lernfunktion (nur mit ausdrücklichem User-Consent, anonymisiert)
const fs = require('fs');
const LEARNING_LOG = process.env.LEARNING_LOG_PATH || './learning-log.jsonl';
function logLearning(entry) {
  try {
    fs.appendFileSync(LEARNING_LOG, JSON.stringify(entry) + '\n');
  } catch (e) { console.error('Learning-Log:', e.message); }
}

// Chat
app.post('/api/chat', async (req,res) => {
  const { messages, systemPromptContext, sessionId, mode, roleplay, consentLearning } = req.body;
  const user = checkJWT(req);
  let quota;
  if (user) {
    quota = getQ(user.email);
  } else {
    if (!sessionId) return res.status(400).json({error:'sessionId fehlt'});
    quota = getSess(sessionId);
  }
  if (quota.plan==='free' && quota.count>=LIMIT) {
    return res.status(402).json({error:'quota_exceeded',quotaLeft:0,needsAuth:true});
  }
  const system = (mode === 'roleplay' && roleplay)
    ? roleplayPrompt(roleplay)
    : sysPrompt(systemPromptContext || {});
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1000,system,messages}),
    });
    if (!r.ok) return res.status(502).json({error:'Anthropic-Fehler',detail:await r.json()});
    const data = await r.json();
    quota.count++;
    // Anonymisiertes Lernen — nur bei ausdrücklichem Opt-in, ohne E-Mail/Session-ID
    if (consentLearning === true) {
      const lastUser = [...(messages||[])].reverse().find(m => m.role==='user')?.content || '';
      const reply = (data.content||[]).find(b => b.type==='text')?.text || '';
      logLearning({
        ts: new Date().toISOString(),
        mode: mode === 'roleplay' ? 'roleplay' : 'coach',
        kontext: systemPromptContext || null,
        frage: String(lastUser).slice(0, 2000),
        antwort: String(reply).slice(0, 3000),
      });
    }
    res.json({content:data.content,quotaLeft:left(quota),plan:quota.plan||'free'});
  } catch(e) { res.status(500).json({error:'Interner Fehler'}); }
});

// Lern-Log Export (nur für Dani, geschützt via ADMIN_EXPORT_KEY Env-Variable)
app.get('/api/learning-export', (req,res) => {
  const key = process.env.ADMIN_EXPORT_KEY;
  if (!key || req.query.key !== key) return res.status(403).json({error:'Nicht autorisiert'});
  try {
    if (!fs.existsSync(LEARNING_LOG)) return res.status(404).json({error:'Noch keine Einträge'});
    res.type('text/plain').send(fs.readFileSync(LEARNING_LOG,'utf8'));
  } catch(e) { res.status(500).json({error:'Interner Fehler'}); }
});

// Testimonial-Einsendung → als Datei gespeichert mit Status "pending"
const TESTIMONIAL_LOG = process.env.TESTIMONIAL_LOG_PATH || './testimonials.jsonl';

function readTestimonials() {
  if (!fs.existsSync(TESTIMONIAL_LOG)) return [];
  return fs.readFileSync(TESTIMONIAL_LOG,'utf8').trim().split('\n').map((l,i) => {
    try { const o = JSON.parse(l); o._idx = i; return o; } catch(e) { return null; }
  }).filter(Boolean);
}
function writeTestimonials(list) {
  fs.writeFileSync(TESTIMONIAL_LOG, list.map(t => { const o = {...t}; delete o._idx; return JSON.stringify(o); }).join('\n') + '\n');
}

app.post('/api/testimonial', (req,res) => {
  const { name, firma, text, bewertung, email, website } = req.body;
  if (website) return res.json({sent:true});
  if (!name || !text) return res.status(400).json({error:'Name und Text erforderlich'});
  if (String(text).length > 2000) return res.status(400).json({error:'Text zu lang (max. 2000 Zeichen)'});
  try {
    const entry = {
      ts: new Date().toISOString(),
      status: 'pending',
      name: String(name).slice(0,120),
      firma: String(firma||'').slice(0,160),
      bewertung: Math.min(5, Math.max(1, parseInt(bewertung)||5)),
      email: String(email||'').slice(0,160),
      text: String(text).slice(0,2000),
    };
    fs.appendFileSync(TESTIMONIAL_LOG, JSON.stringify(entry) + '\n');
    res.json({sent:true});
  } catch(e) { console.error('Testimonial:', e.message); res.status(500).json({error:'Speichern fehlgeschlagen'}); }
});

// Öffentliche API: nur publizierte Testimonials (für testimonials.html)
app.get('/api/testimonials', (req,res) => {
  const all = readTestimonials().filter(t => t.status === 'approved');
  res.json(all.map(t => ({ name:t.name, firma:t.firma, bewertung:t.bewertung, text:t.text })));
});

// Admin: Status ändern (approve/reject)
app.post('/api/testimonials-admin', (req,res) => {
  const key = process.env.ADMIN_EXPORT_KEY;
  if (!key || req.body.key !== key) return res.status(403).json({error:'Nicht autorisiert'});
  const { idx, action } = req.body;
  if (idx === undefined || !['approve','reject','delete'].includes(action)) return res.status(400).json({error:'idx und action (approve/reject/delete) erforderlich'});
  try {
    const list = readTestimonials();
    const item = list.find(t => t._idx === idx);
    if (!item) return res.status(404).json({error:'Eintrag nicht gefunden'});
    if (action === 'delete') { list.splice(list.indexOf(item), 1); }
    else { item.status = action === 'approve' ? 'approved' : 'rejected'; }
    writeTestimonials(list);
    res.json({ok:true, status: action === 'delete' ? 'deleted' : item.status});
  } catch(e) { res.status(500).json({error:'Interner Fehler'}); }
});

// Admin-Seite: Übersicht mit Publizieren/Ablehnen-Buttons
app.get('/api/testimonials-export', (req,res) => {
  const key = process.env.ADMIN_EXPORT_KEY;
  if (!key || req.query.key !== key) return res.status(403).json({error:'Nicht autorisiert'});
  try {
    const list = readTestimonials();
    const statusLabel = {pending:'⏳ Ausstehend', approved:'✅ Publiziert', rejected:'❌ Abgelehnt'};
    const statusColor = {pending:'#B8975A', approved:'#1A5C3A', rejected:'#8B1A1A'};
    const cards = list.map(t => {
      const stars = '★'.repeat(t.bewertung||5) + '☆'.repeat(5 - (t.bewertung||5));
      const st = t.status || 'pending';
      return `<div id="card-${t._idx}" style="background:#fff;border:1px solid #E6DFD4;border-radius:12px;padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="font-size:16px">${(t.name||'—').replace(/</g,'&lt;')}</strong>
          <div><span style="background:${statusColor[st]||'#888'};color:#fff;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600">${statusLabel[st]||st}</span>
          <span style="color:#8C8378;font-size:13px;margin-left:8px">${t.ts ? new Date(t.ts).toLocaleDateString('de-CH') : '—'}</span></div>
        </div>
        <div style="color:#B8975A;font-size:16px;letter-spacing:2px;margin-bottom:8px">${stars}</div>
        <div style="color:#8C8378;font-size:13px;margin-bottom:8px">${(t.firma||'—').replace(/</g,'&lt;')} · ${(t.email||'—').replace(/</g,'&lt;')}</div>
        <div style="background:#F7F4EF;border-left:3px solid #B8975A;padding:14px;border-radius:6px;white-space:pre-wrap;font-size:14px;line-height:1.6;margin-bottom:14px">${(t.text||'').replace(/</g,'&lt;')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${st!=='approved'?`<button onclick="doAction(${t._idx},'approve')" style="padding:8px 18px;background:#1A5C3A;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">✅ Publizieren</button>`:''}
          ${st!=='rejected'?`<button onclick="doAction(${t._idx},'reject')" style="padding:8px 18px;background:#8B1A1A;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">❌ Ablehnen</button>`:''}
          <button onclick="if(confirm('Wirklich löschen?'))doAction(${t._idx},'delete')" style="padding:8px 18px;background:#E6DFD4;color:#2A2520;border:none;border-radius:8px;font-size:13px;cursor:pointer">🗑 Löschen</button>
        </div>
      </div>`;
    }).join('');
    res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Testimonials Admin</title>
      <style>body{font-family:system-ui,sans-serif;background:#F7F4EF;color:#2A2520;margin:0;padding:24px}.wrap{max-width:700px;margin:0 auto}</style></head><body><div class="wrap">
      <h1 style="font-size:24px;font-weight:500">Kundenstimmen verwalten (${list.length})</h1>
      <p style="color:#8C8378;margin-bottom:24px">Klicke auf «Publizieren» → die Stimme erscheint automatisch auf der Webseite. «Ablehnen» → bleibt unsichtbar.</p>
      ${cards || '<p>Noch keine Einträge.</p>'}
      </div><script>
      const KEY='${key}';
      async function doAction(idx,action){
        const r=await fetch('/api/testimonials-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:KEY,idx,action})});
        const d=await r.json();
        if(d.ok) location.reload(); else alert('Fehler: '+(d.error||'unbekannt'));
      }
      </script></body></html>`);
  } catch(e) { res.status(500).json({error:'Interner Fehler'}); }
});

// Quota
app.get('/api/quota/:sid', (req,res) => {
  const user = checkJWT(req);
  if (user) { const q=getQ(user.email); return res.json({plan:q.plan,quotaLeft:left(q)}); }
  const s = getSess(req.params.sid);
  res.json({plan:'free',quotaLeft:Math.max(0,LIMIT-s.count)});
});

// Auth: Code senden
app.post('/api/auth/send-code', async (req,res) => {
  const {email} = req.body;
  if (!email||!/.+@.+/.test(email)) return res.status(400).json({error:'Ungültige E-Mail'});
  const k = email.toLowerCase();

  // VIP: Sofort verifizieren ohne Code
  if (VIP_EMAILS.includes(k)) {
    const q = getQ(k);
    const token = jwt.sign({email:k,plan:q.plan},JWT_SECRET,{expiresIn:'30d'});
    return res.json({sent:true, vip:true, verified:true, token, quotaLeft:left(q), plan:q.plan});
  }

  const code = Math.floor(100000+Math.random()*900000).toString();
  emailCodes.set(k,{code,expires:Date.now()+600000,attempts:0});
  try {
    await mailer.sendMail({
      from:'"Daniel Moser" <info@danielmoser.ch>',to:email,
      subject:`Ihr Code: ${code}`,
      html:`<div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:32px;color:#1A1816">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#B8975A">Daniel Moser · KI-Coach</div>
        <h1 style="font-size:24px;font-weight:400;font-family:Georgia,serif;margin:16px 0">Ihr Anmelde-Code</h1>
        <div style="background:#F2EAD8;border-radius:12px;padding:28px;text-align:center;margin:20px 0">
          <div style="font-size:42px;font-weight:700;letter-spacing:.3em;color:#8A6E3A">${code}</div>
          <div style="font-size:12px;color:#9A8E82;margin-top:8px">Gültig 10 Minuten</div>
        </div>
        <p style="color:#9A8E82;font-size:12px">Falls Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail.</p>
      </div>`
    });
  } catch(e) { console.error('Mail:',e.message); }
  console.log(`[AUTH] ${email} → ${code}`);
  res.json({sent:true});
});

// Auth: Code prüfen
app.post('/api/auth/verify-code', (req,res) => {
  const {email,code} = req.body;
  if (!email||!code) return res.status(400).json({error:'Fehlende Felder'});
  const k = email.toLowerCase();
  const s = emailCodes.get(k);
  if (!s) return res.status(400).json({verified:false,error:'Kein Code'});
  if (Date.now()>s.expires) { emailCodes.delete(k); return res.status(400).json({verified:false,error:'Abgelaufen'}); }
  if (++s.attempts>5) { emailCodes.delete(k); return res.status(429).json({verified:false,error:'Zu viele Versuche'}); }
  if (s.code!==code) return res.status(400).json({verified:false,error:'Falscher Code'});
  emailCodes.delete(k);
  const q = getQ(k);
  const token = jwt.sign({email:k,plan:q.plan},JWT_SECRET,{expiresIn:'30d'});
  res.json({verified:true,token,quotaLeft:left(q),plan:q.plan});
});

// Stripe Checkout
const PLANS = {
  basis:{priceId:process.env.STRIPE_PRICE_BASIS},
  pro:  {priceId:process.env.STRIPE_PRICE_PRO},
  team: {priceId:process.env.STRIPE_PRICE_TEAM},
};
app.post('/api/checkout', async (req,res) => {
  const {plan,sessionId,email} = req.body;
  if (!PLANS[plan]) return res.status(400).json({error:'Ungültiger Plan'});
  try {
    const s = await stripe.checkout.sessions.create({
      mode:'subscription',payment_method_types:['card'],currency:'chf',locale:'de',
      customer_email:email||undefined,
      line_items:[{price:PLANS[plan].priceId,quantity:1}],
      success_url:`https://danielmoser.ch/danke?session=${sessionId}&plan=${plan}`,
      cancel_url:`https://danielmoser.ch/preise`,
      metadata:{sessionId,plan,source:'dm-bot'},
    });
    res.json({checkoutUrl:s.url});
  } catch(e) { console.error('Stripe:',e); res.status(500).json({error:'Checkout fehlgeschlagen'}); }
});

// Newsletter (Brevo)
app.post('/api/newsletter/subscribe', async (req,res) => {
  const {email} = req.body;
  if (!email||!/.+@.+/.test(email)) return res.status(400).json({error:'Ungültige E-Mail'});
  try {
    const r = await fetch('https://api.brevo.com/v3/contacts',{
      method:'POST',
      headers:{'Content-Type':'application/json','api-key':process.env.BREVO_API_KEY},
      body:JSON.stringify({email,listIds:[parseInt(process.env.BREVO_LIST_ID||'2')],updateEnabled:true}),
    });
    if ([200,201,204].includes(r.status)) return res.json({subscribed:true});
    const e=await r.json();
    if (e.code==='duplicate_parameter') return res.json({subscribed:true});
    res.status(500).json({error:'Brevo-Fehler'});
  } catch(e) { res.status(500).json({error:'Interner Fehler'}); }
});

// Stripe Webhook
app.post('/webhook', (req,res) => {
  let event;
  try { event = stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET); }
  catch(e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
  if (event.type==='checkout.session.completed') {
    const s=event.data.object;
    const email=(s.customer_email||'').toLowerCase();
    const plan=s.metadata?.plan;
    if (email&&plan) { const q=getQ(email); q.plan=plan; q.stripeCustomerId=s.customer; q.stripeSubId=s.subscription; console.log(`✓ Abo: ${email} → ${plan}`); }
  }
  if (event.type==='customer.subscription.deleted') {
    const sub=event.data.object;
    emailQuotas.forEach((q,e)=>{ if(q.stripeSubId===sub.id){q.plan='free';q.count=0;console.log(`✓ Gekündigt: ${e}`);}});
  }
  res.json({received:true});
});

// Health
app.get('/health',(_,res)=>res.json({status:'ok',ts:new Date().toISOString(),anthropic:!!process.env.ANTHROPIC_API_KEY,stripe:!!process.env.STRIPE_SECRET_KEY,brevo:!!process.env.BREVO_API_KEY,vip_count:VIP_EMAILS.length}));

app.listen(PORT,()=>{
  console.log(`\n✓ danielmoser.ch Backend — Port ${PORT}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY?'✓':'✗ FEHLT!'}`);
  console.log(`  Stripe:    ${process.env.STRIPE_SECRET_KEY?'✓':'✗ FEHLT!'}`);
  console.log(`  Brevo:     ${process.env.BREVO_API_KEY?'✓':'✗ FEHLT!'}\n`);
});
