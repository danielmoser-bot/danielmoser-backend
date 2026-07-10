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
  host: process.env.SMTP_HOST || 'mail.infomaniak.com',
  port: 587, secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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

// Testimonial-Einsendung → E-Mail an Daniel
app.post('/api/testimonial', async (req,res) => {
  const { name, firma, text, bewertung, email, website } = req.body;
  if (website) return res.json({sent:true}); // Honeypot: Bots füllen das versteckte Feld
  if (!name || !text) return res.status(400).json({error:'Name und Text erforderlich'});
  if (String(text).length > 2000) return res.status(400).json({error:'Text zu lang (max. 2000 Zeichen)'});
  try {
    await mailer.sendMail({
      from:'"danielmoser.ch" <noreply@danielmoser.ch>',
      to:'info@danielmoser.ch',
      replyTo: email || undefined,
      subject:`Neues Testimonial von ${String(name).slice(0,80)}`,
      html:`<div style="font-family:system-ui;max-width:560px;margin:0 auto;padding:24px;color:#2A2520">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#B8975A">danielmoser.ch · Testimonial</div>
        <h2 style="font-family:Georgia,serif;font-weight:400;margin:12px 0">Neue Kundenstimme eingegangen</h2>
        <p><strong>Name:</strong> ${String(name).slice(0,120)}</p>
        <p><strong>Firma/Funktion:</strong> ${String(firma||'—').slice(0,160)}</p>
        <p><strong>Bewertung:</strong> ${'★'.repeat(Math.min(5,Math.max(1,parseInt(bewertung)||5)))}</p>
        <p><strong>E-Mail:</strong> ${String(email||'—').slice(0,160)}</p>
        <div style="background:#F7F4EF;border-left:3px solid #B8975A;padding:14px 16px;border-radius:6px;margin-top:12px;white-space:pre-wrap">${String(text).slice(0,2000).replace(/</g,'&lt;')}</div>
        <p style="color:#9A8E82;font-size:12px;margin-top:16px">Zum Veröffentlichen: Text prüfen und manuell auf der Stimmen-Seite eintragen.</p>
      </div>`
    });
    res.json({sent:true});
  } catch(e) { console.error('Testimonial-Mail:',e.message); res.status(500).json({error:'Versand fehlgeschlagen'}); }
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
      from:'"Daniel Moser" <noreply@danielmoser.ch>',to:email,
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
