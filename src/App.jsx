import { useState, useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// COURTSIDE AI — Grass Court Season 2026 AI Tennis Analyst
// Stack: React + Vite → Vercel | Claude Sonnet 4.6 | Gumroad licence keys
// Features: Serve Analyser, Choke Point Predictor, Upset Probability,
//           Grass Court Scores, Score Predictor, Brutal Mode, WhatsApp Drop,
//           Championship Predictor, AI Chat, Live Match Ticker
// ─────────────────────────────────────────────────────────────────────────────

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const SEASON_YEAR = 2026; // Grass court season — generic, no tournament trademark
const GUMROAD_URL    = "https://digibiz06.gumroad.com/l/courtsideai";

// Static Grass Court Season 2026 draw data (fallback when API unavailable)
const STATIC_DRAW = {
  mens: [
    { seed:1, player:"N. Djokovic",  flag:"🇷🇸", grass:9.4, ranking:1 },
    { seed:2, player:"C. Alcaraz",   flag:"🇪🇸", grass:8.9, ranking:2 },
    { seed:3, player:"J. Sinner",    flag:"🇮🇹", grass:8.2, ranking:3 },
    { seed:4, player:"A. Zverev",    flag:"🇩🇪", grass:7.8, ranking:4 },
    { seed:5, player:"D. Medvedev",  flag:"🇷🇺", grass:7.4, ranking:5 },
    { seed:6, player:"H. Rune",      flag:"🇩🇰", grass:8.0, ranking:6 },
    { seed:7, player:"H. Hurkacz",   flag:"🇵🇱", grass:8.6, ranking:7 },
    { seed:8, player:"T. Fritz",     flag:"🇺🇸", grass:7.9, ranking:8 },
  ],
  womens: [
    { seed:1, player:"I. Świątek",   flag:"🇵🇱", grass:8.1, ranking:1 },
    { seed:2, player:"A. Sabalenka", flag:"🇧🇾", grass:8.4, ranking:2 },
    { seed:3, player:"C. Gauff",     flag:"🇺🇸", grass:7.9, ranking:3 },
    { seed:4, player:"E. Rybakina",  flag:"🇰🇿", grass:9.1, ranking:4 },
    { seed:5, player:"J. Paolini",   flag:"🇮🇹", grass:8.0, ranking:5 },
    { seed:6, player:"D. Kasatkina", flag:"🇷🇺", grass:7.7, ranking:6 },
    { seed:7, player:"B. Andreescu", flag:"🇨🇦", grass:7.5, ranking:7 },
    { seed:8, player:"V. Azarenka",  flag:"🇧🇾", grass:8.2, ranking:8 },
  ],
};

const SUGGESTIONS = [
  { icon:"🎯", text:"Analyse Djokovic's serve patterns today" },
  { icon:"😰", text:"Who's most likely to choke in a tiebreak?" },
  { icon:"🌿", text:"Which players suit grass best this year?" },
  { icon:"📈", text:"Biggest upset probability today?" },
  { icon:"🏆", text:"Who wins Grass Court Season 2026?" },
  { icon:"😤", text:"Brutal verdict on today's matches" },
];

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function streamChat(messages, system, { onChunk, onDone, onError, signal }) {
  try {
    const res = await fetch("/api/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        stream: true,
        system,
        messages,
      }),
    });
    if (!res.ok) { onError(`API error ${res.status}`); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") { onDone("done"); return; }
        try {
          const ev = JSON.parse(data);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            onChunk(ev.delta.text);
          }
        } catch {}
      }
    }
    onDone("done");
  } catch (e) {
    if (e.name === "AbortError") onDone("stopped");
    else onError(e.message);
  }
}

async function callAI(prompt, maxTokens = 600) {
  const res = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      stream: false,
      system: "You are a tennis data analyst. Return ONLY valid raw JSON — no markdown, no backticks, no preamble.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = (data?.content?.[0]?.text || "").replace(/```json/g,"").replace(/```/g,"").trim();
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildSystem(brutal) {
  const base = `You are Courtside AI — an elite tennis analyst for the grass court season ${SEASON_YEAR}. You have deep knowledge of ATP and WTA players, grass court tennis, serve patterns, tactical analysis and match history. You have live web search access — use it for current match scores, results and rankings.

Your analysis is specific, tactical and grounded in real data. Explain things in language casual fans understand without dumbing down the insight. Cover serve patterns, grass court suitability, head-to-head records, set-by-set momentum, choke points and upset probability.`;

  if (brutal) return base + `\n\nBRUTAL MODE: You are now John McEnroe with zero diplomatic filter. No hedging, no polite qualifications. Call out errors, criticise poor decisions, and give the unfiltered verdict that broadcast TV won't. Short sentences. High impact. "You cannot be serious."`;

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────
const matchAnalysisCache = {};
const servePatternCache  = {};
const upsetProbCache     = {};
const predCache          = { preds: null, key: "" };

// ─────────────────────────────────────────────────────────────────────────────
// LICENCE GATE
// ─────────────────────────────────────────────────────────────────────────────
function LicenceGate({ onUnlock }) {
  const [key,     setKey]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [show,    setShow]    = useState(false);
  const [winW,    setWinW]    = useState(typeof window !== "undefined" ? window.innerWidth : 375);

  useEffect(() => {
    setTimeout(() => setShow(true), 80);
    const h = () => setWinW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const isWide = winW >= 900;

  const validate = async () => {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) { setError("Please enter your licence key."); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const data = await res.json();
      if (data.valid) {
        try { localStorage.setItem("courtside_key", trimmed); } catch {}
        onUnlock();
      } else {
        setError(data.error || "Invalid key. Check for typos or contact support.");
      }
    } catch {
      setError("Connection error — please check your internet and try again.");
    }
    setLoading(false);
  };

  const FEATS = [
    ["🎯","Serve Pattern Analyser"],["😰","Choke Point Predictor"],
    ["📈","Upset Probability Live"],["🌿","Grass Court Scores"],
    ["🔮","Score Predictor"],["😤","Brutal Mode"],
    ["💬","WhatsApp Drop"],["🏆","Championship Predictor"],
    ["🤖","AI Analyst Chat"],["📊","Player Form"],
    ["⚡","Live Match Analysis"],["🎾","All 127 Matches"],
  ];

  return (
    <div style={{
      minHeight:"100dvh", display:"flex", flexDirection: isWide ? "row" : "column",
      background:"#080C0F", fontFamily:"'Inter',sans-serif", color:"#fff",
      opacity: show ? 1 : 0, transform: show ? "none" : "translateY(12px)",
      transition:"opacity .45s ease, transform .45s ease",
    }}>
      {/* Rainbow bar */}
      <div style={{ position:"fixed", top:0, left:0, right:0, height:3, zIndex:100,
        background:"linear-gradient(90deg,#0A4D2A,#5B2D8C,#C9A84C,#C9A84C,#5B2D8C,#0A4D2A)" }}/>

      {/* LEFT PANEL */}
      {isWide ? (
        <div style={{ flex:"0 0 54%", display:"flex", flexDirection:"column",
          justifyContent:"center", padding:"80px 72px", position:"relative",
          background:"linear-gradient(160deg,#080C0F 0%,#0A2010 50%,#080C0F 100%)", overflow:"hidden" }}>
          <div style={{ position:"absolute", top:-150, left:-50, width:600, height:600,
            borderRadius:"50%", background:"radial-gradient(ellipse,rgba(10,77,42,.35),transparent 70%)", pointerEvents:"none" }}/>
          <div style={{ position:"absolute", bottom:-100, right:0, width:400, height:400,
            borderRadius:"50%", background:"radial-gradient(ellipse,rgba(91,45,140,.2),transparent 70%)", pointerEvents:"none" }}/>

          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:44 }}>
            <div style={{ width:60, height:60, borderRadius:16, fontSize:28,
              background:"linear-gradient(135deg,rgba(201,168,76,.2),rgba(10,77,42,.2))",
              border:"2px solid rgba(201,168,76,.4)", display:"flex", alignItems:"center", justifyContent:"center" }}>🎾</div>
            <div>
              <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:32,
                letterSpacing:"-0.5px", background:"linear-gradient(135deg,#C9A84C,#fff)",
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Courtside AI</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600, fontSize:10,
                color:"rgba(201,168,76,.5)", letterSpacing:2.5, marginTop:4 }}>GRASS COURT SEASON {SEASON_YEAR} · AI TENNIS ANALYST</div>
            </div>
          </div>

          <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:50,
            letterSpacing:"-2px", lineHeight:1.05, marginBottom:18 }}>
            Tennis finally has<br/>
            <span style={{ background:"linear-gradient(135deg,#C9A84C,#E8C96E)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>an intelligent</span><br/>
            voice.
          </div>

          <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:500, fontSize:17,
            color:"rgba(255,255,255,.55)", lineHeight:1.75, marginBottom:44, maxWidth:460 }}>
            Serve pattern analysis · Choke point prediction · Upset probability · Grass Court Scores — for every match at The grass court major.
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, maxWidth:500 }}>
            {FEATS.map(([ic,lbl]) => (
              <div key={lbl} style={{ display:"flex", alignItems:"center", gap:9,
                background:"rgba(255,255,255,.04)", border:"1px solid rgba(201,168,76,.1)",
                borderRadius:10, padding:"9px 13px" }}>
                <span style={{ fontSize:15 }}>{ic}</span>
                <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:500, fontSize:12,
                  color:"rgba(255,255,255,.65)" }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
          padding:"52px 24px 24px", textAlign:"center",
          background:"linear-gradient(160deg,#080C0F,#0A2010)" }}>
          <div style={{ fontSize:48, marginBottom:10 }}>🎾</div>
          <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:32,
            background:"linear-gradient(135deg,#C9A84C,#fff)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:6 }}>Courtside AI</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
            color:"rgba(201,168,76,.5)", letterSpacing:2, marginBottom:18 }}>GRASS COURT SEASON {SEASON_YEAR} · AI TENNIS ANALYST</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center" }}>
            {FEATS.slice(0,8).map(([ic,lbl]) => (
              <div key={lbl} style={{ display:"flex", alignItems:"center", gap:5,
                background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
                borderRadius:20, padding:"5px 12px" }}>
                <span style={{ fontSize:12 }}>{ic}</span>
                <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:500, fontSize:11,
                  color:"rgba(255,255,255,.6)" }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RIGHT PANEL */}
      <div style={{ flex: isWide ? "0 0 46%" : "none", display:"flex", flexDirection:"column",
        justifyContent:"center", alignItems:"center",
        padding: isWide ? "80px 64px" : "0 24px 40px",
        borderLeft: isWide ? "1px solid rgba(201,168,76,.1)" : "none",
        background: isWide ? "rgba(8,12,15,.7)" : "transparent",
        backdropFilter: isWide ? "blur(20px)" : "none", position:"relative" }}>

        <div style={{ width:"100%", maxWidth: isWide ? 400 : 400 }}>
          <div style={{ marginBottom: isWide ? 32 : 22, textAlign: isWide ? "left" : "center" }}>
            <div style={{ fontFamily:"Georgia,serif", fontWeight:700,
              fontSize: isWide ? 30 : 24, color:"#fff", marginBottom:8 }}>
              Enter your key
            </div>
            <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:500,
              fontSize: isWide ? 15 : 13, color:"rgba(255,255,255,.45)", lineHeight:1.65 }}>
              Purchase from Gumroad and receive your licence key instantly by email.
            </div>
          </div>

          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600, fontSize:9,
            color:"rgba(201,168,76,.5)", letterSpacing:2, marginBottom:8 }}>LICENCE KEY</div>

          <input
            type="text" value={key}
            onChange={e => { setKey(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && !loading && validate()}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            maxLength={35} autoCapitalize="characters" spellCheck={false}
            style={{
              width:"100%", background:"rgba(255,255,255,.05)",
              border:`2px solid ${error ? "rgba(220,38,38,.6)" : "rgba(201,168,76,.2)"}`,
              borderRadius:14, padding: isWide ? "15px 18px" : "13px 16px",
              textAlign:"center", fontFamily:"'JetBrains Mono',monospace", fontWeight:600,
              fontSize: isWide ? 17 : 16, color:"#fff", letterSpacing:4, outline:"none",
              marginBottom:10, transition:"border-color .2s",
            }}
          />

          {error && (
            <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:500, fontSize:13,
              color:"#f87171", textAlign:"center", marginBottom:10, lineHeight:1.5,
              padding:"8px 12px", background:"rgba(220,38,38,.08)", borderRadius:8,
              border:"1px solid rgba(220,38,38,.2)" }}>{error}</div>
          )}

          <button onClick={validate} disabled={loading || !key.trim()}
            style={{
              width:"100%", padding: isWide ? "17px 0" : "14px 0",
              borderRadius:14, border:"none",
              background: loading || !key.trim()
                ? "rgba(255,255,255,.07)"
                : "linear-gradient(135deg,#C9A84C,#9A7828)",
              cursor: loading || !key.trim() ? "not-allowed" : "pointer",
              fontFamily:"'Inter',sans-serif", fontWeight:800,
              fontSize: isWide ? 16 : 15,
              color: loading || !key.trim() ? "rgba(255,255,255,.25)" : "#080C0F",
              boxShadow: loading || !key.trim() ? "none" : "0 6px 24px rgba(201,168,76,.4)",
              transition:"all .2s",
            }}>
            {loading ? "Verifying key..." : "Unlock Courtside AI 🎾"}
          </button>

          <div style={{ display:"flex", alignItems:"center", gap:10, margin: isWide ? "24px 0" : "18px 0" }}>
            <div style={{ height:1, flex:1, background:"rgba(255,255,255,.07)" }}/>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
              color:"rgba(255,255,255,.2)", letterSpacing:1 }}>DON'T HAVE A KEY?</span>
            <div style={{ height:1, flex:1, background:"rgba(255,255,255,.07)" }}/>
          </div>

          <a href={GUMROAD_URL} target="_blank" rel="noreferrer"
            style={{ display:"block", textDecoration:"none" }}>
            <div style={{ width:"100%", padding: isWide ? "17px 0" : "14px 0", borderRadius:14,
              border:"1.5px solid rgba(201,168,76,.35)", textAlign:"center",
              background:"rgba(201,168,76,.05)", cursor:"pointer", transition:"all .2s" }}>
              <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:800,
                fontSize: isWide ? 16 : 15, color:"#C9A84C", marginBottom:3 }}>
                Get Season Pass
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600,
                fontSize: isWide ? 12 : 10, color:"rgba(201,168,76,.55)", letterSpacing:1 }}>
                £14.99 · ONE PAYMENT · 127 MATCHES · ALL FEATURES
              </div>
            </div>
          </a>

          <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:18, flexWrap:"wrap" }}>
            {["🔒 Secure","⚡ Instant","📱 Any Device","🔄 No Subscription"].map(b => (
              <span key={b} style={{ fontFamily:"'Inter',sans-serif", fontWeight:500,
                fontSize:11, color:"rgba(255,255,255,.3)" }}>{b}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ position:"fixed", bottom:8, left:0, right:0, textAlign:"center",
        fontFamily:"'JetBrains Mono',monospace", fontSize:8.5,
        color:"rgba(255,255,255,.12)", letterSpacing:1 }}>
        INDEPENDENT ANALYSIS TOOL · NOT AFFILIATED WITH ANY TOURNAMENT ORGANISER · ENTERTAINMENT ONLY · NOT BETTING ADVICE · 18+
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION TOGGLE
// ─────────────────────────────────────────────────────────────────────────────
function SectionToggle({ icon, title, subtitle, open, onToggle, badge }) {
  return (
    <div onClick={onToggle} style={{ display:"flex", alignItems:"center",
      justifyContent:"space-between", padding:"14px 16px",
      cursor:"pointer", userSelect:"none" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, fontSize:17, flexShrink:0,
          background:"linear-gradient(135deg,rgba(201,168,76,.2),rgba(10,77,42,.2))",
          border:"1px solid rgba(201,168,76,.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>{icon}</div>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14, color:"#fff" }}>{title}</div>
            {badge && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              color:"#22C55E", background:"rgba(34,197,94,.12)", border:"1px solid rgba(34,197,94,.2)",
              borderRadius:4, padding:"2px 6px", letterSpacing:1 }}>{badge}</div>}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
            color:"rgba(201,168,76,.45)", letterSpacing:1.5, marginTop:2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ color:"rgba(255,255,255,.3)", fontSize:12, transition:"transform .2s",
        transform: open ? "rotate(180deg)" : "none" }}>▼</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE MATCHES — Uses Claude web search for real the grass court major scores
// ─────────────────────────────────────────────────────────────────────────────
function LiveMatches({ onSelectMatch, onFixtures }) {
  const STATIC_TODAY = [
    { id:"m1", p1:"N. Djokovic",  p1f:"🇷🇸", p2:"C. Alcaraz",  p2f:"🇪🇸", court:"Centre Court",  time:"14:00", status:"UPCOMING", round:"QF",  seed1:1, seed2:2 },
    { id:"m2", p1:"J. Sinner",    p1f:"🇮🇹", p2:"H. Hurkacz", p2f:"🇵🇱", court:"No.1 Court",    time:"13:00", status:"UPCOMING", round:"QF",  seed1:3, seed2:7 },
    { id:"m3", p1:"I. Świątek",   p1f:"🇵🇱", p2:"E. Rybakina",p2f:"🇰🇿", court:"Centre Court",  time:"17:00", status:"UPCOMING", round:"QF",  seed1:1, seed2:4 },
    { id:"m4", p1:"A. Sabalenka", p1f:"🇧🇾", p2:"C. Gauff",   p2f:"🇺🇸", court:"No.1 Court",    time:"17:00", status:"UPCOMING", round:"QF",  seed1:2, seed2:3 },
  ];

  const [matches,  setMatches]  = useState(STATIC_TODAY);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(true);
  const [selected, setSelected] = useState(null);
  const [isLive,   setIsLive]   = useState(false);
  const fetchLock = useRef(false);

  const load = useCallback(async () => {
    if (fetchLock.current) return;
    fetchLock.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          stream: false,
          system: `You are a tennis data assistant. Search the web for today's live the grass court major ${SEASON_YEAR} match scores and schedule. Return ONLY raw JSON, no markdown.`,
          messages: [{ role:"user", content:`Search for the grass court season ${SEASON_YEAR} matches today ${new Date().toLocaleDateString("en-GB")}. Return JSON array:
[{"id":"m1","p1":"N. Djokovic","p1f":"🇷🇸","p2":"C. Alcaraz","p2f":"🇪🇸","court":"Centre Court","time":"14:00","status":"LIVE","score":"6-4, 3-2","round":"QF","seed1":1,"seed2":2}]
status must be LIVE, UPCOMING, or COMPLETE. Include score if LIVE or COMPLETE. Return all matches today.` }],
        }),
      });
      if (res.ok) {
        const raw  = await res.json();
        const text = (raw?.content?.[0]?.text || "").replace(/```json/g,"").replace(/```/g,"").trim();
        const arr  = JSON.parse(text);
        if (Array.isArray(arr) && arr.length > 0) {
          setMatches(arr);
          setIsLive(true);
          if (onFixtures) onFixtures(arr);
        }
      }
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, []);

  useEffect(() => { load(); }, []);

  // Adaptive polling: 2min if live matches, 10min otherwise
  useEffect(() => {
    const interval = matches.some(m => m.status === "LIVE") ? 2 * 60 * 1000 : 10 * 60 * 1000;
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [matches, load]);

  const roundCol = r => r === "F" ? "#C9A84C" : r === "SF" ? "#9A7828" : r === "QF" ? "#5B2D8C" : "rgba(255,255,255,.35)";

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <div onClick={() => setOpen(o=>!o)} style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", padding:"14px 16px", cursor:"pointer" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, fontSize:17,
            background:"linear-gradient(135deg,rgba(201,168,76,.2),rgba(10,77,42,.2))",
            border:"1px solid rgba(201,168,76,.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>🎾</div>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14 }}>Today's Matches</div>
              {matches.some(m=>m.status==="LIVE") && (
                <div style={{ display:"flex", alignItems:"center", gap:4,
                  background:"rgba(239,68,68,.12)", border:"1px solid rgba(239,68,68,.25)",
                  borderRadius:4, padding:"2px 7px" }}>
                  <div style={{ width:5, height:5, borderRadius:"50%", background:"#ef4444", animation:"pulse .8s infinite" }}/>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#ef4444", letterSpacing:1 }}>LIVE</span>
                </div>
              )}
              {isLive && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                color:"#22C55E", background:"rgba(34,197,94,.1)", border:"1px solid rgba(34,197,94,.2)",
                borderRadius:4, padding:"2px 6px", letterSpacing:1 }}>LIVE DATA</div>}
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
              color:"rgba(201,168,76,.45)", letterSpacing:1.5, marginTop:2 }}>
              {new Date().toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long" }).toUpperCase()} · GRASS COURT SEASON {SEASON_YEAR}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={e => { e.stopPropagation(); load(); }} style={{
            background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)",
            borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:12, color:"rgba(255,255,255,.5)" }}>↻</button>
          <div style={{ color:"rgba(255,255,255,.3)", fontSize:12, transition:"transform .2s",
            transform: open ? "rotate(180deg)" : "none" }}>▼</div>
        </div>
      </div>

      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          {loading && !isLive && (
            <div style={{ display:"flex", gap:4, padding:"8px 0" }}>
              {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%",
                background:"#C9A84C", animation:`pulse 1.2s ease-in-out ${i*.15}s infinite` }}/>)}
            </div>
          )}
          {matches.map(m => (
            <div key={m.id} onClick={() => { setSelected(m.id===selected?null:m.id); onSelectMatch?.(m); }}
              style={{ background: selected===m.id ? "rgba(201,168,76,.06)" : "rgba(255,255,255,.02)",
                border:`1px solid ${selected===m.id ? "rgba(201,168,76,.25)" : "rgba(255,255,255,.06)"}`,
                borderRadius:12, padding:"13px 14px", marginBottom:8, cursor:"pointer",
                transition:"all .15s" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                    color:roundCol(m.round), background:`${roundCol(m.round)}18`,
                    border:`1px solid ${roundCol(m.round)}35`, borderRadius:4, padding:"2px 7px",
                    letterSpacing:.5, fontWeight:700 }}>{m.round}</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                    color:"rgba(255,255,255,.3)", letterSpacing:.5 }}>{m.court}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {m.status === "LIVE" && (
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:"#ef4444", animation:"pulse .8s infinite" }}/>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#ef4444", letterSpacing:1 }}>LIVE</span>
                    </div>
                  )}
                  {m.status === "COMPLETE" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"rgba(255,255,255,.35)" }}>COMPLETE</span>}
                  {m.status === "UPCOMING" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#0a84ff" }}>{m.time}</span>}
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <span style={{ fontSize:16 }}>{m.p1f}</span>
                    <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14, color:"#fff" }}>{m.p1}</span>
                    {m.seed1 && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                      color:"rgba(201,168,76,.5)", background:"rgba(201,168,76,.08)",
                      borderRadius:4, padding:"1px 5px" }}>[{m.seed1}]</span>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>{m.p2f}</span>
                    <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14, color:"#fff" }}>{m.p2}</span>
                    {m.seed2 && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                      color:"rgba(201,168,76,.5)", background:"rgba(201,168,76,.08)",
                      borderRadius:4, padding:"1px 5px" }}>[{m.seed2}]</span>}
                  </div>
                </div>
                {m.score && (
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                    fontSize:15, color:"#C9A84C", textAlign:"right" }}>{m.score}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVE PATTERN ANALYSER (exclusive feature)
// ─────────────────────────────────────────────────────────────────────────────
function ServePatternAnalyser({ match }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const fetchLock = useRef(false);

  const analyse = useCallback(async () => {
    if (!match || fetchLock.current) return;
    const key = match.id;
    if (servePatternCache[key]) { setData(servePatternCache[key]); return; }
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Analyse the serving patterns of ${match.p1} and ${match.p2} on grass courts in the grass court major. Return JSON:
{"p1_name":"${match.p1}","p1_first_serve_pct":72,"p1_ace_rate":"8.2%","p1_key_patterns":["Dominant T-serve on deuce court","Body serve under break-point pressure","Wide serve to ad court to open up the forehand"],"p1_weakness":"Second serve exploitable when opponent moves early","p2_name":"${match.p2}","p2_first_serve_pct":68,"p2_ace_rate":"6.1%","p2_key_patterns":["Heavy kick serve to backhand","Varies pace to disrupt rhythm","Aggressive first-serve plus net approach"],"p2_weakness":"Slower ball toss telegraphs direction","tactical_edge":"${match.p1}","insight":"Two-sentence tactical summary of how serving patterns will decide this match"}`, 700);
      servePatternCache[key] = d;
      setData(d);
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, [match]);

  useEffect(() => { if (open && !data) analyse(); }, [open, data, analyse]);

  const PatternRow = ({ patterns, name, pct, ace, weakness }) => (
    <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(201,168,76,.1)",
      borderRadius:12, padding:"14px" }}>
      <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14, marginBottom:10 }}>{name}</div>
      <div style={{ display:"flex", gap:10, marginBottom:12 }}>
        <div style={{ background:"rgba(10,77,42,.2)", border:"1px solid rgba(10,77,42,.3)",
          borderRadius:8, padding:"6px 12px", flex:1, textAlign:"center" }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:18, color:"#22C55E" }}>{pct}%</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.4)", letterSpacing:1 }}>1ST SERVE IN</div>
        </div>
        <div style={{ background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.15)",
          borderRadius:8, padding:"6px 12px", flex:1, textAlign:"center" }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:18, color:"#C9A84C" }}>{ace}</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.4)", letterSpacing:1 }}>ACE RATE</div>
        </div>
      </div>
      <div style={{ marginBottom:8 }}>
        {(patterns||[]).map((p, i) => (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#C9A84C", flexShrink:0, marginTop:5 }}/>
            <span style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.7)", lineHeight:1.5 }}>{p}</span>
          </div>
        ))}
      </div>
      <div style={{ background:"rgba(239,68,68,.06)", border:"1px solid rgba(239,68,68,.15)",
        borderRadius:8, padding:"8px 10px" }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#f87171", letterSpacing:1 }}>WEAKNESS: </span>
        <span style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.6)" }}>{weakness}</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="🎯" title="Serve Pattern Analyser" subtitle="TACTICAL INTELLIGENCE · EXCLUSIVE FEATURE" open={open}
        onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          {!match && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.4)", padding:"8px 0" }}>Tap a match above to analyse serve patterns.</div>}
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {data && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <PatternRow name={data.p1_name} pct={data.p1_first_serve_pct} ace={data.p1_ace_rate} patterns={data.p1_key_patterns} weakness={data.p1_weakness}/>
              <PatternRow name={data.p2_name} pct={data.p2_first_serve_pct} ace={data.p2_ace_rate} patterns={data.p2_key_patterns} weakness={data.p2_weakness}/>
              <div style={{ background:"rgba(91,45,140,.1)", border:"1px solid rgba(91,45,140,.2)",
                borderRadius:12, padding:"12px 14px" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#9B72CF", letterSpacing:1.5, marginBottom:6 }}>TACTICAL EDGE</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:13, color:"#C9A84C", marginBottom:4 }}>{data.tactical_edge} has the serving advantage</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.65)", lineHeight:1.6 }}>{data.insight}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHOKE POINT PREDICTOR (exclusive feature)
// ─────────────────────────────────────────────────────────────────────────────
function ChokePointPredictor({ match }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const fetchLock = useRef(false);

  const analyse = useCallback(async () => {
    if (!match || fetchLock.current) return;
    const key = `choke_${match.id}`;
    if (matchAnalysisCache[key]) { setData(matchAnalysisCache[key]); return; }
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Analyse the choke-point tendencies of ${match.p1} and ${match.p2} in major tournament matches. Return JSON:
{"p1_name":"${match.p1}","p1_choke_risk":"LOW","p1_risk_moments":["Serving for a set at 5-4","Tiebreak at 5-5","After losing a long rally"],"p1_historical":"Wins 82% of sets when serving for them","p2_name":"${match.p2}","p2_choke_risk":"MEDIUM","p2_risk_moments":["Second-set letdown after winning first","Net approach under pressure","Facing break points on fast surfaces"],"p2_historical":"Has been broken while serving for set in 3 of last 5 Slams","critical_moment":"The most likely choke point in this specific match","predicted_momentum":"Who handles pressure better and why in one sentence"}`, 700);
      matchAnalysisCache[key] = d;
      setData(d);
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, [match]);

  useEffect(() => { if (open && !data) analyse(); }, [open, data, analyse]);

  const riskCol = r => r==="LOW" ? "#22C55E" : r==="MEDIUM" ? "#C9A84C" : "#ef4444";

  const PlayerChoke = ({ name, risk, moments, historical }) => (
    <div style={{ background:"rgba(255,255,255,.03)", border:`1px solid ${riskCol(risk)}22`,
      borderRadius:12, padding:"14px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14 }}>{name}</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:10,
          color:riskCol(risk), background:`${riskCol(risk)}18`,
          border:`1px solid ${riskCol(risk)}35`, borderRadius:6, padding:"3px 10px", letterSpacing:1 }}>
          {risk} RISK
        </div>
      </div>
      <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.5)",
        marginBottom:10, padding:"6px 10px", background:"rgba(255,255,255,.03)", borderRadius:8 }}>{historical}</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"rgba(255,255,255,.3)", letterSpacing:1, marginBottom:6 }}>HIGH-PRESSURE MOMENTS</div>
      {(moments||[]).map((m, i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:riskCol(risk), flexShrink:0 }}/>
          <span style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.65)" }}>{m}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="😰" title="Choke Point Predictor" subtitle="PRESSURE ANALYSIS · EXCLUSIVE FEATURE" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          {!match && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.4)", padding:"8px 0" }}>Tap a match above to load choke point analysis.</div>}
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {data && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <PlayerChoke name={data.p1_name} risk={data.p1_choke_risk} moments={data.p1_risk_moments} historical={data.p1_historical}/>
              <PlayerChoke name={data.p2_name} risk={data.p2_choke_risk} moments={data.p2_risk_moments} historical={data.p2_historical}/>
              <div style={{ background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.2)",
                borderRadius:12, padding:"12px 14px" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#C9A84C", letterSpacing:1.5, marginBottom:6 }}>CRITICAL MOMENT TO WATCH</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.8)", lineHeight:1.6, marginBottom:6 }}>{data.critical_moment}</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.5)", lineHeight:1.5 }}>{data.predicted_momentum}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSET PROBABILITY (exclusive feature)
// ─────────────────────────────────────────────────────────────────────────────
function UpsetProbability({ match }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const fetchLock = useRef(false);

  const analyse = useCallback(async () => {
    if (!match || fetchLock.current) return;
    const key = `upset_${match.id}`;
    if (upsetProbCache[key]) { setData(upsetProbCache[key]); return; }
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Calculate upset probability for ${match.p1} (seed ${match.seed1||"?"}) vs ${match.p2} (seed ${match.seed2||"?"}) in the grass court major ${SEASON_YEAR}. An upset is if the lower seed or underdog wins. Return JSON:
{"favourite":"${match.p1}","underdog":"${match.p2}","upset_probability":34,"upset_factors":["Underdog has strong grass court record","Favourite inconsistent on second serve","Head-to-head shows tight matches"],"upset_blockers":["Favourite's experience at this stage","Higher ranking reflects form difference","Serve speed advantage on fast surface"],"verdict":"POSSIBLE UPSET","confidence":"MEDIUM","one_line":"The decisive factor in one sentence"}`, 700);
      upsetProbCache[key] = d;
      setData(d);
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, [match]);

  useEffect(() => { if (open && !data) analyse(); }, [open, data, analyse]);

  const vCol = v => v==="LIKELY UPSET" ? "#ef4444" : v==="POSSIBLE UPSET" ? "#C9A84C" : "#22C55E";

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="📈" title="Upset Probability" subtitle="LIVE UPSET ANALYSIS · EXCLUSIVE FEATURE" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          {!match && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.4)", padding:"8px 0" }}>Tap a match above to calculate upset probability.</div>}
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {data && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {/* Big probability display */}
              <div style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(201,168,76,.15)",
                borderRadius:16, padding:"20px 14px", textAlign:"center" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                  color:"rgba(255,255,255,.35)", letterSpacing:2, marginBottom:8 }}>UPSET PROBABILITY</div>
                <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:64,
                  letterSpacing:"-3px", color:vCol(data.verdict), lineHeight:1 }}>{data.upset_probability}%</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.5)", marginTop:8 }}>
                  {data.underdog} beats {data.favourite}
                </div>
                {/* Probability bar */}
                <div style={{ height:8, background:"rgba(255,255,255,.06)", borderRadius:4, margin:"14px 0 8px", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${data.upset_probability}%`,
                    background:vCol(data.verdict), borderRadius:4, transition:"width 1s ease" }}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#22C55E" }}>{data.favourite} wins {100-data.upset_probability}%</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:vCol(data.verdict) }}>{data.underdog} wins {data.upset_probability}%</span>
                </div>
              </div>

              {/* Verdict */}
              <div style={{ background:`${vCol(data.verdict)}12`, border:`1px solid ${vCol(data.verdict)}30`,
                borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:11,
                  color:vCol(data.verdict) }}>{data.verdict}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                  color:`${vCol(data.verdict)}88` }}>{data.confidence} CONFIDENCE</div>
              </div>

              {/* Factors */}
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1, background:"rgba(239,68,68,.05)", border:"1px solid rgba(239,68,68,.15)",
                  borderRadius:12, padding:"12px" }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#f87171", letterSpacing:1, marginBottom:8 }}>UPSET FACTORS</div>
                  {(data.upset_factors||[]).map((f,i) => (
                    <div key={i} style={{ display:"flex", gap:6, marginBottom:5 }}>
                      <span style={{ color:"#ef4444", fontSize:10, flexShrink:0 }}>↑</span>
                      <span style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"rgba(255,255,255,.6)", lineHeight:1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <div style={{ flex:1, background:"rgba(34,197,94,.05)", border:"1px solid rgba(34,197,94,.15)",
                  borderRadius:12, padding:"12px" }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#22C55E", letterSpacing:1, marginBottom:8 }}>UPSET BLOCKERS</div>
                  {(data.upset_blockers||[]).map((f,i) => (
                    <div key={i} style={{ display:"flex", gap:6, marginBottom:5 }}>
                      <span style={{ color:"#22C55E", fontSize:10, flexShrink:0 }}>↓</span>
                      <span style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"rgba(255,255,255,.6)", lineHeight:1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.6)",
                lineHeight:1.6, padding:"10px 14px", background:"rgba(91,45,140,.08)",
                border:"1px solid rgba(91,45,140,.2)", borderRadius:10 }}>
                💡 {data.one_line}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRASS COURT ADAPTATION SCORES (exclusive feature)
// ─────────────────────────────────────────────────────────────────────────────
function GrassCourtScores() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState("mens");
  const fetchLock = useRef(false);

  const load = useCallback(async () => {
    if (fetchLock.current || data) return;
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Rate the grass court suitability of the top 8 men's and women's players in the grass court major ${SEASON_YEAR}. Consider serve effectiveness, net game, movement on grass, and historical grass results. Return JSON:
{"mens":[{"player":"N. Djokovic","flag":"🇷🇸","seed":1,"score":9.4,"serve":9.5,"movement":9.2,"net_game":8.8,"reason":"Serve-dominant game tailor-made for grass, record 7 titles"},{"player":"C. Alcaraz","flag":"🇪🇸","seed":2,"score":8.9,"serve":8.7,"movement":9.1,"net_game":9.2,"reason":"Natural grass court ability, defending champion, versatile game"}],"womens":[{"player":"I. Świątek","flag":"🇵🇱","seed":1,"score":8.1,"serve":8.4,"movement":8.3,"net_game":7.2,"reason":"Dominant baseline game adapts well but not a natural grass specialist"}]}`, 900);
      setData(d);
    } catch {
      setData({ mens: STATIC_DRAW.mens.map(p => ({
        ...p, score:p.grass, serve:p.grass+0.2>10?10:p.grass+0.2,
        movement:p.grass-0.3>0?p.grass-0.3:p.grass, net_game:p.grass-0.1,
        reason:"Estimated grass court rating based on serve speed and surface history"
      })), womens: STATIC_DRAW.womens.map(p => ({
        ...p, score:p.grass, serve:p.grass+0.1,
        movement:p.grass-0.2, net_game:p.grass-0.3,
        reason:"Estimated grass court rating"
      })) });
    }
    setLoading(false);
    fetchLock.current = false;
  }, [data]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const scoreCol = s => s >= 9 ? "#C9A84C" : s >= 8 ? "#22C55E" : "rgba(255,255,255,.6)";

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="🌿" title="Grass Court Adaptation Scores" subtitle="SURFACE ANALYSIS · EXCLUSIVE FEATURE" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            {["mens","womens"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab===t ? "rgba(201,168,76,.15)" : "rgba(255,255,255,.04)",
                border: `1.5px solid ${tab===t ? "rgba(201,168,76,.45)" : "rgba(255,255,255,.1)"}`,
                borderRadius:8, padding:"5px 14px", cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                color: tab===t ? "#C9A84C" : "rgba(255,255,255,.4)", letterSpacing:1,
              }}>{t === "mens" ? "MEN'S" : "WOMEN'S"}</button>
            ))}
          </div>
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {data && (data[tab]||[]).map((p, i) => (
            <div key={i} style={{ background:"rgba(255,255,255,.03)",
              border:`1px solid ${i===0?"rgba(201,168,76,.25)":"rgba(255,255,255,.06)"}`,
              borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                    color:"rgba(255,255,255,.3)" }}>#{i+1}</span>
                  <span style={{ fontSize:18 }}>{p.flag}</span>
                  <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:14, color:"#fff" }}>{p.player}</span>
                  {p.seed && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                    color:"rgba(201,168,76,.5)", background:"rgba(201,168,76,.08)",
                    borderRadius:4, padding:"1px 5px" }}>[{p.seed}]</span>}
                </div>
                <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:24,
                  color:scoreCol(p.score||p.grass), letterSpacing:"-1px" }}>{(p.score||p.grass)?.toFixed(1)}</div>
              </div>
              {/* Score bars */}
              {[["SERVE",p.serve||p.grass],["MOVEMENT",p.movement||p.grass-0.3],["NET GAME",p.net_game||p.grass-0.5]].map(([label, val]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                    color:"rgba(255,255,255,.3)", width:62, letterSpacing:.5 }}>{label}</div>
                  <div style={{ flex:1, height:5, background:"rgba(255,255,255,.06)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${((val||7)/10)*100}%`,
                      background:`linear-gradient(90deg,${scoreCol(val||7)},${scoreCol(val||7)}88)`,
                      borderRadius:3, transition:"width .8s ease" }}/>
                  </div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                    color:scoreCol(val||7), width:28, textAlign:"right" }}>{(val||7)?.toFixed(1)}</div>
                </div>
              ))}
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11,
                color:"rgba(255,255,255,.45)", lineHeight:1.5, marginTop:6 }}>{p.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────
const scorePredCache = {};
function ScorePredictor({ match }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const fetchLock = useRef(false);

  const predict = useCallback(async (force=false) => {
    if (!match || fetchLock.current) return;
    const key = match.id;
    if (!force && scorePredCache[key]) { setData(scorePredCache[key]); return; }
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Predict the most likely set-by-set scoreline for ${match.p1} vs ${match.p2} in the ${match.round||"match"} in the grass court major ${SEASON_YEAR}. Return JSON:
{"winner":"${match.p1}","score":"7-5, 6-4, 6-3","sets":[{"set":1,"p1":7,"p2":5,"analysis":"Tight opening set, ${match.p1} breaks late"},{"set":2,"p1":6,"p2":4,"analysis":"${match.p1} builds momentum with stronger serving"},{"set":3,"p1":6,"p2":3,"analysis":"Dominant finish, ${match.p2} tires"}],"match_duration":"2h 15m","key_stat":"First serve percentage will decide this match","confidence":"HIGH"}`, 600);
      scorePredCache[key] = d;
      setData(d);
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, [match]);

  useEffect(() => { if (open && !data) predict(); }, [open, data, predict]);

  const confCol = c => c==="HIGH" ? "#22C55E" : c==="MEDIUM" ? "#C9A84C" : "rgba(255,255,255,.4)";

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="🔮" title="Score Predictor" subtitle="SET-BY-SET PREDICTION · AI POWERED" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          {!match && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:13, color:"rgba(255,255,255,.4)", padding:"8px 0" }}>Tap a match above to predict the score.</div>}
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {data && (
            <div>
              <div style={{ background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.2)",
                borderRadius:14, padding:"18px", textAlign:"center", marginBottom:12 }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"rgba(201,168,76,.5)", letterSpacing:2, marginBottom:8 }}>AI PREDICTED SCORE</div>
                <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:32,
                  color:"#C9A84C", letterSpacing:"-1px", marginBottom:6 }}>{data.score}</div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:15, color:"#fff", marginBottom:4 }}>
                  {data.winner} to win
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center" }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                    color:confCol(data.confidence), background:`${confCol(data.confidence)}18`,
                    border:`1px solid ${confCol(data.confidence)}30`, borderRadius:4, padding:"2px 8px", letterSpacing:1 }}>
                    {data.confidence} CONFIDENCE
                  </div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                    color:"rgba(255,255,255,.3)" }}>⏱ {data.match_duration}</div>
                </div>
              </div>
              {(data.sets||[]).map((s, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10,
                  background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.06)",
                  borderRadius:10, padding:"10px 12px", marginBottom:6 }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:11,
                    color:"rgba(201,168,76,.6)", width:46 }}>SET {s.set}</div>
                  <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:18,
                    color:"#fff", width:44 }}>{s.p1}–{s.p2}</div>
                  <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11,
                    color:"rgba(255,255,255,.5)", flex:1, lineHeight:1.4 }}>{s.analysis}</div>
                </div>
              ))}
              <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12,
                color:"rgba(255,255,255,.5)", lineHeight:1.6, marginTop:8,
                padding:"8px 12px", background:"rgba(91,45,140,.08)",
                border:"1px solid rgba(91,45,140,.2)", borderRadius:8 }}>
                🔑 {data.key_stat}
              </div>
              <button onClick={() => predict(true)} disabled={loading}
                style={{ marginTop:10, background:"rgba(255,255,255,.05)",
                  border:"1px solid rgba(255,255,255,.1)", borderRadius:8,
                  padding:"7px 14px", cursor:"pointer", fontFamily:"'JetBrains Mono',monospace",
                  fontSize:9, color:"rgba(255,255,255,.4)", letterSpacing:1 }}>
                ↻ REGENERATE
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAMPIONSHIP PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────
const STATIC_CHAMP = {
  mens: [
    { player:"N. Djokovic", flag:"🇷🇸", chance:32, reasoning:"Seven titles, grass court GOAT, still the most complete player on the surface." },
    { player:"C. Alcaraz",  flag:"🇪🇸", chance:24, reasoning:"Defending champion, improving serve, youth and athleticism could carry him to back-to-back titles." },
    { player:"J. Sinner",   flag:"🇮🇹", chance:18, reasoning:"World No.1 form but grass is not his strongest surface — improving rapidly." },
    { player:"H. Hurkacz",  flag:"🇵🇱", chance:10, reasoning:"Huge serve suits the grass court major perfectly. Dark horse credentials are genuine." },
  ],
  womens: [
    { player:"E. Rybakina",  flag:"🇰🇿", chance:28, reasoning:"2022 champion. Her flat, powerful serve is perfectly built for grass. Returns here every year as a genuine contender." },
    { player:"A. Sabalenka", flag:"🇧🇾", chance:22, reasoning:"Power baseline game translating increasingly well to grass after years of improvement." },
    { player:"I. Świątek",   flag:"🇵🇱", chance:18, reasoning:"Dominant world No.1 but historically inconsistent on grass — 2026 could be the year she adapts." },
    { player:"C. Gauff",     flag:"🇺🇸", chance:14, reasoning:"Improving serve and grass court record. Major title incoming — could be here." },
  ],
  darkHorse: { player:"H. Hurkacz", flag:"🇵🇱", reasoning:"Massive serve, has beaten top players on grass before, and the draw could open up perfectly for him.", tour:"ATP" },
  updated: "Based on seedings, current form and grass court historical data for Grass Court Season 2026.",
};

function ChampionshipPredictor() {
  const [data,    setData]    = useState(STATIC_CHAMP);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState("mens");
  const liveLoaded = useRef(false);
  const fetchLock  = useRef(false);

  const load = useCallback(async (force=false) => {
    if (fetchLock.current || (!force && liveLoaded.current)) return;
    fetchLock.current = true;
    setLoading(true);
    try {
      const d = await callAI(`Based on current form, draw, and grass court ability, rank the top 4 men's and women's players most likely to win the grass court major ${SEASON_YEAR}. Search the web for current the grass court major ${SEASON_YEAR} draw and results. Return JSON:
{"mens":[{"player":"N. Djokovic","flag":"🇷🇸","chance":30,"reasoning":"One sentence on why"}],"womens":[{"player":"E. Rybakina","flag":"🇰🇿","chance":28,"reasoning":"One sentence"}],"darkHorse":{"player":"H. Hurkacz","flag":"🇵🇱","reasoning":"Why they could win","tour":"ATP"},"updated":"One sentence on what's driving these rankings right now"}`, 900);
      if (d?.mens?.length > 0) { setData(d); liveLoaded.current = true; }
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="🏆" title="Championship Predictor" subtitle="WHO WINS THE TITLE · AI RANKED" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            {["mens","womens"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab===t ? "rgba(201,168,76,.15)" : "rgba(255,255,255,.04)",
                border: `1.5px solid ${tab===t ? "rgba(201,168,76,.45)" : "rgba(255,255,255,.1)"}`,
                borderRadius:8, padding:"5px 14px", cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                color: tab===t ? "#C9A84C" : "rgba(255,255,255,.4)", letterSpacing:1,
              }}>{t === "mens" ? "MEN'S" : "WOMEN'S"}</button>
            ))}
            <button onClick={() => load(true)} disabled={loading} style={{
              marginLeft:"auto", background:"rgba(255,255,255,.04)",
              border:"1px solid rgba(255,255,255,.1)", borderRadius:8,
              padding:"5px 10px", cursor:"pointer", fontSize:11,
              color:"rgba(255,255,255,.4)" }}>
              <span style={{ display:"inline-block", animation:loading?"spin .8s linear infinite":"none" }}>↻</span>
            </button>
          </div>

          {loading && !liveLoaded.current && (
            <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {(data[tab]||[]).map((c, i) => {
              const col = i===0 ? "#C9A84C" : i<2 ? "#22C55E" : "rgba(255,255,255,.5)";
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10,
                  background:"rgba(255,255,255,.03)",
                  border:`1px solid ${i===0?"rgba(201,168,76,.2)":"rgba(255,255,255,.06)"}`,
                  borderRadius:12, padding:"11px 13px" }}>
                  <div style={{ fontFamily:"Georgia,serif", fontWeight:900, fontSize:14,
                    color:i===0?"#C9A84C":"rgba(255,255,255,.25)", width:20 }}>{i+1}</div>
                  <span style={{ fontSize:20 }}>{c.flag}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:13, color:"#fff" }}>{c.player}</div>
                    <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11, color:"rgba(255,255,255,.45)", marginTop:2, lineHeight:1.45 }}>{c.reasoning}</div>
                  </div>
                  <div style={{ fontFamily:"Georgia,serif", fontWeight:900, fontSize:22,
                    color:col, flexShrink:0 }}>{c.chance}%</div>
                </div>
              );
            })}
          </div>

          {data.darkHorse && (
            <div style={{ background:"rgba(91,45,140,.08)", border:"1px solid rgba(91,45,140,.2)",
              borderRadius:12, padding:"11px 14px", marginTop:10, display:"flex", gap:10 }}>
              <span style={{ fontSize:16 }}>💡</span>
              <div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#9B72CF", letterSpacing:1.5, marginBottom:4 }}>
                  DARK HORSE · {data.darkHorse.flag} {data.darkHorse.player?.toUpperCase()} · {data.darkHorse.tour}
                </div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontSize:12, color:"rgba(255,255,255,.65)", lineHeight:1.6 }}>{data.darkHorse.reasoning}</div>
              </div>
            </div>
          )}
          {data.updated && <div style={{ fontFamily:"'Inter',sans-serif", fontSize:11,
            color:"rgba(255,255,255,.28)", marginTop:10, fontStyle:"italic" }}>{data.updated}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP DROP
// ─────────────────────────────────────────────────────────────────────────────
function WhatsAppDrop({ match, brutal }) {
  const [drops,   setDrops]   = useState(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState(0);
  const [open,    setOpen]    = useState(false);
  const [copied,  setCopied]  = useState(-1);
  const fetchLock = useRef(false);

  const generate = useCallback(async () => {
    if (fetchLock.current) return;
    fetchLock.current = true;
    setLoading(true);
    const matchCtx = match ? `${match.p1} vs ${match.p2}` : "today's the grass court major matches";
    try {
      const d = await callAI(`Generate 3 different WhatsApp messages about ${matchCtx} in the grass court major ${SEASON_YEAR}. ${brutal ? "Be unfiltered and brutally honest." : "Be sharp and entertaining."} Return JSON:
{"drops":["Message 1 (expert pre-match preview, 2-3 sentences, include key stat)","Message 2 (tactical insight with emoji, what to watch for)","Message 3 (bold prediction with confidence rating)"]}`, 500);
      if (d?.drops?.length === 3) setDrops(d.drops);
    } catch {}
    setLoading(false);
    fetchLock.current = false;
  }, [match, brutal]);

  useEffect(() => { if (open && drops[0] === "") generate(); }, [open]);

  const copy = (txt, i) => {
    navigator.clipboard.writeText(txt).then(() => { setCopied(i); setTimeout(() => setCopied(-1), 2000); });
  };

  return (
    <div style={{ background:"rgba(255,255,255,.02)", borderBottom:"1px solid rgba(201,168,76,.08)", flexShrink:0 }}>
      <SectionToggle icon="💬" title="WhatsApp Drop" subtitle="READY-TO-PASTE TENNIS TAKES" open={open} onToggle={() => setOpen(o=>!o)} />
      {open && (
        <div style={{ padding:"0 14px 14px" }}>
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {["Expert Pick","Tactical","Bold Pred"].map((t,i) => (
              <button key={i} onClick={() => setTab(i)} style={{
                background: tab===i ? "rgba(201,168,76,.15)" : "rgba(255,255,255,.04)",
                border: `1px solid ${tab===i ? "rgba(201,168,76,.4)" : "rgba(255,255,255,.1)"}`,
                borderRadius:8, padding:"5px 12px", cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace", fontSize:8.5, fontWeight:700,
                color: tab===i ? "#C9A84C" : "rgba(255,255,255,.4)", letterSpacing:.5 }}>{t}</button>
            ))}
          </div>
          {loading && <div style={{ display:"flex", gap:4, padding:"8px 0" }}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>}
          {drops[tab] && (
            <div>
              <div style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)",
                borderRadius:12, padding:"14px", marginBottom:10,
                fontFamily:"'Inter',sans-serif", fontSize:14, color:"rgba(255,255,255,.85)",
                lineHeight:1.6, whiteSpace:"pre-wrap" }}>{drops[tab]}</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => copy(drops[tab], tab)} style={{
                  flex:1, background: copied===tab ? "rgba(34,197,94,.15)" : "rgba(201,168,76,.1)",
                  border: `1px solid ${copied===tab ? "rgba(34,197,94,.3)" : "rgba(201,168,76,.2)"}`,
                  borderRadius:10, padding:"10px 0", cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                  color: copied===tab ? "#22C55E" : "#C9A84C", letterSpacing:1 }}>
                  {copied===tab ? "✓ COPIED" : "📋 COPY"}
                </button>
                <button onClick={generate} disabled={loading} style={{
                  background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)",
                  borderRadius:10, padding:"10px 14px", cursor:"pointer",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.4)", letterSpacing:1 }}>↻</button>
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                color:"rgba(255,255,255,.2)", marginTop:8, textAlign:"right" }}>
                {drops[tab]?.length || 0} chars
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTIONS TICKER
// ─────────────────────────────────────────────────────────────────────────────
function PredictionsTicker({ matches }) {
  const [preds,   setPreds]   = useState([]);
  const [loading, setLoading] = useState(false);
  const fetchLock = useRef(false);

  useEffect(() => {
    const upcoming = (matches||[]).filter(m => m.status === "UPCOMING");
    if (!upcoming.length || fetchLock.current) return;
    const key = upcoming.map(m=>`${m.p1}v${m.p2}`).join(",");
    if (!key) return;
    if (predCache.key === key && predCache.preds) { setPreds(predCache.preds); return; }
    fetchLock.current = true;
    setLoading(true);
    fetch("/api/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 400, stream: false,
        system: "Tennis prediction AI. Return ONLY raw JSON.",
        messages: [{ role:"user", content:`Predict scores for: ${upcoming.map(m=>`${m.p1} vs ${m.p2}`).join(", ")}.
Return JSON: [{"p1":"${upcoming[0]?.p1||"Player A"}","p2":"${upcoming[0]?.p2||"Player B"}","score":"7-5, 6-3","winner":"${upcoming[0]?.p1||"Player A"}","confidence":"HIGH","p1f":"${upcoming[0]?.p1f||"🏳️"}","p2f":"${upcoming[0]?.p2f||"🏳️"}"}]` }],
      }),
    }).then(r => r.json()).then(raw => {
      const text = (raw?.content?.[0]?.text||"").replace(/```json/g,"").replace(/```/g,"").trim();
      const arr  = JSON.parse(text);
      if (Array.isArray(arr)) {
        predCache.preds = arr; predCache.key = key;
        setPreds(arr);
      }
    }).catch(()=>{}).finally(()=>{ setLoading(false); fetchLock.current = false; });
  }, [(matches||[]).map(m=>m.p1+m.p2).join("")]);

  const confCol = c => c==="HIGH" ? "#22C55E" : c==="MEDIUM" ? "#C9A84C" : "rgba(255,255,255,.35)";
  const upcoming = (matches||[]).filter(m => m.status === "UPCOMING");

  return (
    <div style={{ height:32, overflow:"hidden", borderTop:"1px solid rgba(201,168,76,.1)",
      display:"flex", alignItems:"center", background:"rgba(10,77,42,.08)",
      backdropFilter:"blur(8px)", flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:7,
        background:"rgba(201,168,76,.12)", borderRight:"1px solid rgba(201,168,76,.2)",
        padding:"0 12px", height:"100%", flexShrink:0 }}>
        {loading
          ? <div style={{ display:"flex", gap:3 }}>{[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:"#C9A84C",animation:`pulse 1.2s ${i*.15}s infinite`}}/>)}</div>
          : <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:9.5, color:"#C9A84C", letterSpacing:2 }}>🤖 AI PICKS</span>
        }
      </div>
      <div style={{ flex:1, overflow:"hidden" }}>
        {preds.length > 0 ? (
          <div style={{ display:"flex", animation:"tickerScroll 45s linear infinite", width:"max-content", alignItems:"center", height:32 }}>
            {[...preds,...preds].map((p, i) => (
              <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:8, marginRight:32, whiteSpace:"nowrap" }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"rgba(201,168,76,.5)", letterSpacing:1 }}>PRED</span>
                <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:12, color:"rgba(255,255,255,.85)" }}>{p.p1f} {p.p1}</span>
                <span style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:15, color:"#C9A84C", padding:"0 3px" }}>{p.score}</span>
                <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:12, color:"rgba(255,255,255,.85)" }}>{p.p2} {p.p2f}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8.5, color:confCol(p.confidence),
                  background:`${confCol(p.confidence)}18`, borderRadius:4, padding:"1px 5px" }}>{p.confidence}</span>
                <span style={{ color:"rgba(201,168,76,.18)", fontSize:10 }}>·</span>
              </span>
            ))}
          </div>
        ) : upcoming.length > 0 ? (
          <div style={{ display:"flex", animation:"tickerScroll 35s linear infinite", width:"max-content", alignItems:"center", height:32 }}>
            {[...upcoming,...upcoming].map((m, i) => (
              <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:7, marginRight:28, whiteSpace:"nowrap",
                fontFamily:"'Inter',sans-serif", fontSize:12, fontWeight:600, color:"rgba(255,255,255,.7)" }}>
                <span>{m.p1f}</span><span>{m.p1}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.2)" }}>vs</span>
                <span>{m.p2}</span><span>{m.p2f}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"#0a84ff" }}>{m.time}</span>
                <span style={{ color:"rgba(201,168,76,.18)", fontSize:10 }}>·</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
            color:"rgba(255,255,255,.2)", padding:"0 16px", letterSpacing:1 }}>
            GRASS COURT SEASON {SEASON_YEAR} · AI-POWERED ANALYSIS
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
function Dots() {
  return (
    <div style={{ display:"flex", gap:4, padding:"4px 0" }}>
      {[0,1,2].map(i => (
        <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#C9A84C",
          animation:`pulse 1.2s ease-in-out ${i * .15}s infinite` }}/>
      ))}
    </div>
  );
}

function ChatMessage({ msg, isStreaming, animate }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display:"flex", flexDirection: isUser ? "row-reverse" : "row",
      alignItems:"flex-end", gap:8, marginBottom:14,
      animation: animate ? "msgIn .35s cubic-bezier(.34,1.56,.64,1)" : "none" }}>
      {!isUser && (
        <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, fontSize:14,
          background:"linear-gradient(135deg,rgba(201,168,76,.2),rgba(10,77,42,.2))",
          border:"1px solid rgba(201,168,76,.3)", display:"flex", alignItems:"center", justifyContent:"center" }}>🎾</div>
      )}
      <div style={{
        maxWidth:"76%",
        background: isUser
          ? "linear-gradient(135deg,rgba(10,77,42,.4),rgba(10,77,42,.25))"
          : "rgba(255,255,255,.05)",
        border: isUser ? "1px solid rgba(201,168,76,.25)" : "1px solid rgba(255,255,255,.07)",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        padding:"12px 14px",
        fontFamily:"'Inter',sans-serif", fontSize:15, lineHeight:1.7,
        color: isUser ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.85)",
        whiteSpace:"pre-wrap",
      }}>
        {isStreaming && msg.content === "" ? <Dots/> : msg.content}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // ── Licence gate ────────────────────────────────────────────────────────
  const [unlocked, setUnlocked] = useState(() => {
    try { return !!localStorage.getItem("courtside_key"); } catch { return false; }
  });

  if (!unlocked) return <LicenceGate onUnlock={() => setUnlocked(true)} />;

  // ── State ────────────────────────────────────────────────────────────────
  const [messages,     setMessages]     = useState([{ role:"assistant", content:`Welcome to Courtside AI 🎾 — your personal tennis analyst for the grass court season ${SEASON_YEAR}.\n\n✅ Today's matches are loading below. Tap any match to unlock Serve Pattern Analysis, Choke Point Prediction, Upset Probability and Score Predictor.\n\n😤 Tap BRUTAL for unfiltered, undiplomatic takes.\n\nAsk me anything about The grass court major.` }]);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [streamingIdx, setStreamingIdx] = useState(null);
  const [newIdx,       setNewIdx]       = useState(null);
  const [showSugg,     setShowSugg]     = useState(true);
  const [brutal,       setBrutal]       = useState(false);
  const brutalRef    = useRef(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [allMatches,  setAllMatches]    = useState([]);
  const [showChat,    setShowChat]      = useState(false);
  const [winW,        setWinW]          = useState(typeof window !== "undefined" ? window.innerWidth : 375);
  const bottomRef = useRef(null);
  const textRef   = useRef(null);
  const abortRef  = useRef(null);

  useEffect(() => {
    const h = () => setWinW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const isDesktop = winW >= 900;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);
  useEffect(() => { brutalRef.current = brutal; }, [brutal]);

  const stop = () => abortRef.current?.abort();

  const send = async (text) => {
    const txt = (text || input).trim();
    if (!txt || loading) return;
    setInput(""); if (textRef.current) textRef.current.style.height = "auto";
    setShowSugg(false);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const userMsg = { role:"user", content: txt };
    const history = [...messages, userMsg];
    const aiMsg   = { role:"assistant", content:"" };
    const withAI  = [...history, aiMsg];
    const aiIdx   = withAI.length - 1;
    setMessages(withAI); setNewIdx(history.length - 1); setStreamingIdx(aiIdx); setLoading(true);
    await streamChat(history, buildSystem(brutalRef.current), {
      signal: ctrl.signal,
      onChunk: c => { setMessages(p => p.map((m,i) => i===aiIdx ? {...m,content:m.content+c} : m)); bottomRef.current?.scrollIntoView({behavior:"smooth"}); },
      onDone:  _ => { setStreamingIdx(null); setLoading(false); abortRef.current = null; },
      onError: e => { setMessages(p => p.map((m,i) => i===aiIdx ? {...m,content:`⚠️ ${e}`} : m)); setStreamingIdx(null); setLoading(false); abortRef.current = null; },
    });
  };

  const CHAT = (
    <>
      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px 8px" }}>
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} isStreaming={i===streamingIdx} animate={i===newIdx}/>
        ))}
        {showSugg && (
          <div style={{ marginTop:4, marginBottom:14 }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.18)",
              letterSpacing:2, marginBottom:10, textAlign:"center" }}>ASK ME ANYTHING</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center" }}>
              {SUGGESTIONS.map((s,i) => (
                <button key={i} onClick={() => send(s.text)} style={{
                  background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)",
                  borderRadius:20, padding:"6px 13px", cursor:"pointer",
                  fontFamily:"'Inter',sans-serif", fontSize:11.5, color:"rgba(255,255,255,.6)",
                  display:"flex", alignItems:"center", gap:6, transition:"all .15s" }}>
                  <span>{s.icon}</span><span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>
      <div style={{ padding:"4px 14px", flexShrink:0, background:"rgba(8,12,15,.9)",
        borderTop:"1px solid rgba(255,255,255,.04)" }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
          color:"rgba(255,255,255,.15)", letterSpacing:.5 }}>
          Statistical analysis · Entertainment only · Independent tool, not affiliated with any tournament organiser · Not betting advice · 18+
        </span>
      </div>
      <div style={{ flexShrink:0, background:"rgba(12,18,12,.96)", backdropFilter:"blur(20px)",
        padding:"10px 12px env(safe-area-inset-bottom,12px)" }}>
        <div style={{ maxWidth:760, margin:"0 auto", display:"flex", gap:8, alignItems:"flex-end",
          background:"rgba(255,255,255,.05)", border:"1.5px solid rgba(255,255,255,.1)",
          borderRadius:22, padding:"8px 12px" }}>
          <textarea ref={textRef} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey && !loading) { e.preventDefault(); send(); }}}
            placeholder={loading ? "Analysing..." : "Ask anything about Grass Court Season 2026..."}
            rows={1}
            style={{ flex:1, background:"transparent", border:"none", fontFamily:"'Inter',sans-serif",
              fontSize:16, color:"#fff", resize:"none", outline:"none", lineHeight:1.5,
              maxHeight:80, overflowY:"auto" }}
            onInput={e => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,80)+"px"; }}
          />
          {loading
            ? <button onClick={stop} style={{ width:40, height:40, borderRadius:12, border:"none",
                background:"rgba(239,68,68,.2)", cursor:"pointer", display:"flex", alignItems:"center",
                justifyContent:"center", color:"#ef4444", fontSize:14 }}>■</button>
            : <button onClick={() => send()} disabled={!input.trim()} style={{
                width:40, height:40, borderRadius:12, border:"none",
                background: input.trim() ? "linear-gradient(135deg,#C9A84C,#9A7828)" : "rgba(255,255,255,.06)",
                cursor: input.trim() ? "pointer" : "not-allowed",
                display:"flex", alignItems:"center", justifyContent:"center",
                color: input.trim() ? "#080C0F" : "rgba(255,255,255,.25)", flexShrink:0,
                boxShadow: input.trim() ? "0 4px 14px rgba(201,168,76,.35)" : "none", transition:"all .18s" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
          }
        </div>
      </div>
    </>
  );

  return (
    <div style={{ height:"100dvh", display:"flex", flexDirection:"column",
      background:"#080C0F", overflow:"hidden", fontFamily:"'Inter',sans-serif",
      color:"#fff", WebkitOverflowScrolling:"touch" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;0,14..32,900&family=JetBrains+Mono:wght@500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
        body,input,textarea,button{font-size:16px}
        @media (max-width:480px){
          body{font-size:15px}
        }
        @keyframes pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
        @keyframes msgIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes tickerScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fabPulse{0%,100%{box-shadow:0 4px 20px rgba(201,168,76,.45)}50%{box-shadow:0 4px 32px rgba(201,168,76,.8)}}
        *{-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(201,168,76,.2);border-radius:2px}
        textarea{scrollbar-width:none}textarea::-webkit-scrollbar{display:none}
        button:hover{filter:brightness(1.1)}
      `}</style>

      {/* HEADER */}
      <div style={{ height:3, flexShrink:0,
        background:"linear-gradient(90deg,#0A4D2A,#5B2D8C,#C9A84C,#C9A84C,#5B2D8C,#0A4D2A)" }}/>

      {brutal && (
        <div style={{ background:"linear-gradient(90deg,rgba(30,0,10,.95),rgba(50,0,15,.9))",
          borderBottom:"1px solid rgba(239,68,68,.3)", padding:"5px 16px",
          display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:13 }}>😤</span>
            <span style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:12, color:"#ef4444" }}>BRUTAL MODE — JOHN McENROE SETTINGS</span>
          </div>
          <button onClick={() => setBrutal(false)} style={{ fontFamily:"'JetBrains Mono',monospace",
            fontSize:9, color:"rgba(255,255,255,.4)", background:"rgba(255,255,255,.06)",
            border:"1px solid rgba(255,255,255,.1)", borderRadius:6, padding:"3px 10px", cursor:"pointer" }}>✕</button>
        </div>
      )}

      <div style={{ flexShrink:0, background:"rgba(8,12,15,.92)", backdropFilter:"blur(20px)",
        borderBottom:"1px solid rgba(201,168,76,.1)" }}>
        <div style={{ height: isDesktop?60:52, display:"flex", alignItems:"center",
          justifyContent:"space-between", padding: isDesktop?"0 24px":"0 16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width: isDesktop?42:36, height: isDesktop?42:36, borderRadius: isDesktop?12:10,
              fontSize: isDesktop?20:16, flexShrink:0,
              background:"linear-gradient(135deg,rgba(201,168,76,.25),rgba(10,77,42,.15))",
              border:"1px solid rgba(201,168,76,.4)", display:"flex", alignItems:"center", justifyContent:"center" }}>🎾</div>
            <div>
              <div style={{ fontFamily:"Georgia,serif", fontWeight:700,
                fontSize: isDesktop?28:19, letterSpacing:"-0.5px",
                background:"linear-gradient(135deg,#C9A84C,#fff)",
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Courtside AI</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                letterSpacing:1.8, marginTop:1, color:"rgba(201,168,76,.4)" }}>GRASS COURT SEASON {SEASON_YEAR} · AI ANALYST</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ display:"flex", alignItems:"center", gap:5,
              background: loading ? "rgba(239,68,68,.1)" : "rgba(34,197,94,.08)",
              border:`1px solid ${loading?"rgba(239,68,68,.3)":"rgba(34,197,94,.2)"}`,
              borderRadius:8, padding:"4px 9px" }}>
              <div style={{ width:6, height:6, borderRadius:"50%",
                background: loading ? "#ef4444" : "#22C55E",
                animation: loading ? "pulse .8s infinite" : "none" }}/>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                color: loading ? "#ef4444" : "#22C55E", letterSpacing:1 }}>
                {loading ? "THINKING" : "LIVE"}
              </span>
            </div>
            <button onClick={() => setBrutal(b=>!b)} style={{
              display:"flex", alignItems:"center", gap:5,
              background: brutal ? "rgba(239,68,68,.2)" : "rgba(255,255,255,.04)",
              border:`1.5px solid ${brutal?"rgba(239,68,68,.6)":"rgba(255,255,255,.12)"}`,
              borderRadius:8, padding:"4px 10px", cursor:"pointer", transition:"all .2s" }}>
              <span style={{ fontSize:11 }}>😤</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                color: brutal?"#ef4444":"rgba(255,255,255,.5)", letterSpacing:1 }}>
                {brutal ? "BRUTAL" : "BRUTAL"}
              </span>
            </button>
          </div>
        </div>
        <PredictionsTicker matches={allMatches} />
      </div>

      {/* MAIN LAYOUT */}
      {isDesktop ? (
        <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>
          {/* LEFT — Match data and features */}
          <div style={{ flex:"0 0 50%", maxWidth:620, overflowY:"auto",
            borderRight:"1px solid rgba(201,168,76,.08)", display:"flex", flexDirection:"column" }}>
            <LiveMatches onSelectMatch={setSelectedMatch} onFixtures={setAllMatches}/>
            <ServePatternAnalyser match={selectedMatch}/>
            <ChokePointPredictor match={selectedMatch}/>
            <UpsetProbability match={selectedMatch}/>
            <GrassCourtScores/>
            <ScorePredictor match={selectedMatch}/>
            <WhatsAppDrop match={selectedMatch} brutal={brutal}/>
            <ChampionshipPredictor/>
            <div style={{ height:20 }}/>
          </div>
          {/* RIGHT — AI Chat */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
            <div style={{ padding:"12px 20px 10px", borderBottom:"1px solid rgba(201,168,76,.08)",
              background:"rgba(0,0,0,.2)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:15 }}>💬 AI Analyst</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                  color:"rgba(201,168,76,.4)", letterSpacing:1.5, marginTop:2 }}>POWERED BY CLAUDE · LIVE WEB SEARCH</div>
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
                color:"rgba(255,255,255,.2)", letterSpacing:1 }}>ASK ANYTHING ABOUT THE SEASON</div>
            </div>
            {CHAT}
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex:1, overflowY:"auto" }}>
            <LiveMatches onSelectMatch={setSelectedMatch} onFixtures={setAllMatches}/>
            <ServePatternAnalyser match={selectedMatch}/>
            <ChokePointPredictor match={selectedMatch}/>
            <UpsetProbability match={selectedMatch}/>
            <GrassCourtScores/>
            <ScorePredictor match={selectedMatch}/>
            <WhatsAppDrop match={selectedMatch} brutal={brutal}/>
            <ChampionshipPredictor/>
            <div style={{ height:90 }}/>
          </div>
          <button onClick={() => setShowChat(true)} style={{
            position:"fixed", bottom:24, right:20, zIndex:200,
            width:56, height:56, borderRadius:"50%",
            background:"linear-gradient(135deg,#C9A84C,#9A7828)",
            border:"none", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:"0 4px 22px rgba(201,168,76,.5)",
            animation:"fabPulse 2.5s ease-in-out infinite" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="#080C0F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          {showChat && (
            <div style={{ position:"fixed", inset:0, zIndex:300, background:"#080C0F",
              display:"flex", flexDirection:"column", animation:"msgIn .25s ease" }}>
              <div style={{ background:"rgba(0,0,0,.7)", backdropFilter:"blur(20px)",
                padding:"12px 16px 10px", display:"flex", alignItems:"center",
                justifyContent:"space-between", borderBottom:"1px solid rgba(201,168,76,.1)", flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:32, height:32, borderRadius:9,
                    background:"linear-gradient(135deg,rgba(201,168,76,.2),rgba(10,77,42,.15))",
                    border:"1px solid rgba(201,168,76,.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🎾</div>
                  <div>
                    <div style={{ fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:15 }}>AI Analyst</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5, color:"rgba(201,168,76,.4)", letterSpacing:1.5 }}>POWERED BY CLAUDE</div>
                  </div>
                </div>
                <button onClick={() => setShowChat(false)} style={{ width:34, height:34, borderRadius:9,
                  background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.12)",
                  cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                  color:"rgba(255,255,255,.6)", fontSize:12 }}>✕</button>
              </div>
              {CHAT}
            </div>
          )}
        </>
      )}
    </div>
  );
}
