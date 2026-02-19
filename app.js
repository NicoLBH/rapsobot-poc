
/* ===== Middle row hover effect ===== */
(function injectMiddleHoverStyle(){
  if (document.getElementById("middle-hover-style")) return;
  const style = document.createElement("style");
  style.id = "middle-hover-style";
  style.innerHTML = `
    .issues-table__body .row:hover,
    .issues-table__body .issue-row:hover,
    .issues-table__body .line:hover {
      background: rgb(21, 27, 35) !important;
    }
  `;
  document.head.appendChild(style);
})();

// RAPSOBOT PoC UI — lighter middle list + persistent expand + right details with parent context
// Expected from webhook:
// { status, run_id, situations[], problems[], avis[] }

const qs = new URLSearchParams(location.search);

const STORAGE_KEY = "rapsobot_ui_human_v2";

const state = {
  data: null,

  // persistent expansions
  expandedSituations: new Set(), // situation_id
  expandedProblems: new Set(),   // problem_id

  // selection for right panel
  selectedSituationId: null,
  selectedProblemId: null,
  selectedAvisId: null,

  verdictFilter: "ALL",
  search: "",
  displayDepth: "situations", // situations | sujets | avis

  page: 1,
  pageSize: 80, // paginating avis within a problem if needed

  sidebarCollapsed: false,

  // preserve middle list scroll when re-rendering
  middleScrollTop: 0,
  middleScrollLeft: 0,

  // right panel: sub-issues table (below description)
  rightSubissuesOpen: true,
  rightExpandedProblems: new Set(),

  // details actions
  tempAvisVerdict: null,
  tempAvisVerdictFor: null,

  // drilldown (independent details panel)
  drill: {
    isOpen: false,
    selectedSituationId: null,
    selectedProblemId: null,
    selectedAvisId: null,
    rightSubissuesOpen: true,
    rightExpandedProblems: new Set(),
  },

};

// DOM helpers
function el(id){ return document.getElementById(id); }
function els(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }


function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function badgePriority(p) {
  const v = String(p || "").toUpperCase();
  if (v === "P1") return "badge badge--p1";
  if (v === "P2") return "badge badge--p2";
  return "badge badge--p3";
}
function badgeVerdict(v) {
  const s = String(v || "").toUpperCase();
  return `verdict-badge verdict-${s}`;
}


/* ===== Open/Closed status icons (GitHub-like) ===== */
const SVG_ISSUE_OPEN = `<svg color="var(--fgColor-open)" aria-hidden="true" focusable="false" aria-label="" class="octicon octicon-issue-opened" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align:text-bottom;"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>`;
const SVG_ISSUE_CLOSED = `<svg color="var(--fgColor-done)" aria-hidden="true" focusable="false" aria-label="" class="octicon octicon-issue-closed" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align:text-bottom"><path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"></path><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"></path></svg>`;
const SVG_ISSUE_REOPENED = `<svg aria-hidden="true" focusable="false" class="octicon octicon-issue-reopened" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align:text-bottom; color: var(--fgColor-open);"><path d="M1.5 8a6.5 6.5 0 0 1 11.917-3.468l.69-.69a.75.75 0 0 1 1.28.53V7.25a.75.75 0 0 1-.75.75H12.75a.75.75 0 0 1-.53-1.28l.75-.75A5 5 0 1 0 8 13a.75.75 0 0 1 0 1.5A6.5 6.5 0 0 1 1.5 8Z"></path></svg>`;
const SVG_AVATAR_HUMAN = `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="display:block"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5.06 0-9 2.39-9 5.25V22h18v-2.75C21 16.39 17.06 14 12 14Z"></path></svg>`;


function issueStatusIconHtml(status) {
  const s = String(status || "closed").toLowerCase();
  const svg = (s === "open") ? SVG_ISSUE_OPEN : SVG_ISSUE_CLOSED;
  // Wrapper for spacing/alignment (no extra CSS required)
  return `<span class="issue-status-icon" style="display:inline-flex; align-items:center; margin-right:8px;">${svg}</span>`;
}


/* ===== Sub-issues "closed/total" progress icon (GitHub-like) ===== */
function svgPieProgress(pct) {
  // pct in [0..1]
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const cx = 8, cy = 8, r = 6;
  // start at top (12 o'clock)
  const startX = cx, startY = cy - r;
  if (p <= 0) {
    return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" style="display:block">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(139,148,158,.16)" stroke="rgba(139,148,158,.45)" stroke-width="1.25"></circle>
    </svg>`;
  }
  const endAngle = (-90 + p * 360) * Math.PI / 180;
  const endX = cx + r * Math.cos(endAngle);
  const endY = cy + r * Math.sin(endAngle);
  const largeArc = p > 0.5 ? 1 : 0;
  const wedge = `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)} Z`;
  return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" style="display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(139,148,158,.16)" stroke="rgba(139,148,158,.45)" stroke-width="1.25"></circle>
    <path d="${wedge}" fill="rgba(139,148,158,.55)"></path>
  </svg>`;
}

function subissuesProgressIconHtml(closed, total) {
  const t = Number(total) || 0;
  const c = Math.max(0, Math.min(t, Number(closed) || 0));
  if (t > 0 && c === t) {
    // all closed -> closed icon (purple)
    return `<span class="subissues-progress-icon" aria-hidden="true">${SVG_ISSUE_CLOSED}</span>`;
  }
  const pct = t > 0 ? (c / t) : 0;
  return `<span class="subissues-progress-icon" aria-hidden="true">${svgPieProgress(pct)}</span>`;
}


function setSystemStatus(kind, label, meta) {
  el("sysLabel").textContent = label || "";
  el("sysMeta").textContent = meta || "—";
  const dot = el("sysDot");
  const colors = { idle: "var(--muted)", running: "var(--accent)", done: "var(--success)", error: "var(--danger)" };
  dot.style.background = colors[kind] || colors.idle;
}

function showBanner(kind, msg) {
  const box = el("topBanner");
  if (!box) return;
  if (!msg) {
    box.classList.add("hidden");
    document.body.classList.remove("banner-visible");
    box.textContent = "";
    box.classList.remove("gh-banner--error", "gh-banner--info");
    return;
  }
  box.classList.remove("hidden");
  document.body.classList.add("banner-visible");
  box.classList.toggle("gh-banner--error", kind === "error");
  box.classList.toggle("gh-banner--info", kind !== "error");
  box.textContent = msg;
}


function setRunMeta(run_id) {
  el("runMetaTop").textContent = run_id ? `run_id=${run_id}` : "";
}
function setIssuesTotals(d) {
  const node = el("issuesTotals");
  if (!d) return (node.textContent = "—");
  const s = Array.isArray(d.situations) ? d.situations.length : 0;
  const p = Array.isArray(d.problems) ? d.problems.length : 0;
  const a = Array.isArray(d.avis) ? d.avis.length : 0;
  node.textContent = `${s} situations · ${p} sujets · ${a} avis`;
}


function showError(msg) {
  showBanner("error", msg || "Erreur inconnue");
  console.error("[RAPSOBOT] " + (msg || "Erreur inconnue"));
}


function setDetailsMeta(text) {
  el("detailsMeta").textContent = text || "—";
  if (el("detailsMetaModal")) el("detailsMetaModal").textContent = text || "—";
}

function setDetailsTitle(text) {
  const t = text || "Sélectionner un élément";
  const m = el("detailsTitle");
  if (m) m.textContent = t;
  const mm = el("detailsTitleModal");
  if (mm) mm.textContent = t;
}


/* ===== Details head: HTML title + GitHub-like badges ===== */
function setTitleHtmlFn(html) {
  const m = el("detailsTitle");
  if (m) m.innerHTML = html || "";
  const mm = el("detailsTitleModal");
  if (mm) mm.innerHTML = html || "";
}

// Backward-compat alias (older code paths expect this name)
function setDetailsTitleHtml(html) {
  setTitleHtmlFn(html);
}


function statusBadgeHtml(status) {
  const s = String(status || "OPEN").toUpperCase();
  const isClosed = (s === "CLOSED" || s === "DONE" || s === "OK");
  const label = isClosed ? "Closed" : "Open";
  const cls = isClosed ? "gh-state gh-state--closed" : "gh-state gh-state--open";
  const svg = isClosed ?  SVG_ISSUE_CLOSED : SVG_ISSUE_OPEN;
  return `<span class="${cls}"><span class="gh-state-dot" aria-hidden="true">${svg}</span>${label}</span>`;
}

function verdictLabelFr(v) {
  const s = String(v || "").toUpperCase();
  if (s === "D" || s === "DEFAVORABLE" || s === "DEFAV") return "Défavorable";
  if (s === "S" || s === "SUSPENDU") return "Suspendu";
  if (s === "OK" || s === "F" || s === "FAVORABLE") return "Favorable";
  return s || "—";
}

function verdictDotClass(v) {
  const s = String(v || "").toUpperCase();
  if (s === "D" || s === "DEFAVORABLE" || s === "DEFAV") return "v-dot v-dot--d";
  if (s === "S" || s === "SUSPENDU") return "v-dot v-dot--s";
  if (s === "OK" || s === "F" || s === "FAVORABLE") return "v-dot v-dot--ok";
  return "v-dot";
}

/* ===== Minimal markdown preview (GitHub-like enough for PoC) ===== */
function mdToHtml(md) {
  const raw = String(md || "");
  // escape first
  let s = escapeHtml(raw);
  // code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic (simple)
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // line breaks
  s = s.replace(/\n/g, "<br>");
  return s;
}

function applyQueryParamsToForm() {
  el("communeCp").value = qs.get("communeCp") || qs.get("commune_cp") || "";
  el("importance").value = qs.get("importance") || "je ne sais pas";
  el("soilClass").value = qs.get("soilClass") || qs.get("soil_class") || "je ne sais pas";
  el("liquefaction").value = qs.get("liquefaction") || "je ne sais pas";
  el("referential").value = qs.get("referential") || qs.get("referential_name") || "Eurocode 8";
  el("webhookUrl").value = qs.get("webhookUrl") || "";
}

function readInputs() {
  return {
    communeCp: el("communeCp").value.trim(),
    importance: el("importance").value,
    soilClass: el("soilClass").value,
    liquefaction: el("liquefaction").value,
    referential: el("referential").value,
    webhookUrl: el("webhookUrl").value.trim(),
    pdfFile: el("pdfFile")?.files?.[0] || null,
  };
}

function indexBy(arr, key) {
  const m = new Map();
  for (const x of (arr || [])) m.set(x?.[key], x);
  return m;
}

/* ===== Relationships (parent mapping) ===== */
function buildParents(d) {
  // problem_id -> situation_id ; avis_id -> problem_id ; avis_id -> situation_id
  const problemToSituation = new Map();
  for (const s of d.situations || []) {
    for (const pid of (s.problem_ids || [])) problemToSituation.set(pid, s.situation_id);
  }

  const avisToProblem = new Map();
  const avisToSituation = new Map();
  for (const pb of d.problems || []) {
    const sid = problemToSituation.get(pb.problem_id) || null;
    for (const aid of (pb.avis_ids || [])) {
      avisToProblem.set(aid, pb.problem_id);
      avisToSituation.set(aid, sid);
    }
  }

  return { problemToSituation, avisToProblem, avisToSituation };
}

function applyAvisFilters(list) {
  let out = list;

  if (state.verdictFilter !== "ALL") {
    out = out.filter((a) => String(a?.verdict || "").toUpperCase() === state.verdictFilter);
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    out = out.filter((a) => {
      const blob = `${a?.topic || ""} ${a?.message || ""} ${a?.source || ""} ${a?.agent || ""} ${a?.produced_by || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }
  return out;
}

function paginate(list) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const end = start + state.pageSize;
  return { total, pages, slice: list.slice(start, end) };
}

/* ===== Local “discussion” store (human actions) ===== */
function nowIso() { return new Date().toISOString(); }
function runKey() { return state.data?.run_id || "no_run"; }

function loadHumanStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { runs: {} };
  } catch { return { runs: {} }; }
}
function saveHumanStore(store) { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
function ensureRunBucket(store) {
  const rk = runKey();
  store.runs[rk] ||= { decisions: {}, comments: [] };
  return store.runs[rk];
}
function entityKey(type, id) { return `${type}:${id}`; }

function setDecision(type, id, decision, note) {
  const store = loadHumanStore();
  const bucket = ensureRunBucket(store);

  bucket.decisions[entityKey(type, id)] = { decision, note: note || "", ts: nowIso() };
  bucket.comments.push({
    ts: nowIso(),
    actor: "Human",
    agent: "human",
    type: "DECISION",
    entity_type: type,
    entity_id: id,
    message: `${decision}${note ? ` — ${note}` : ""}`,
  });

  saveHumanStore(store);
}
function addComment(type, id, message) {
  const store = loadHumanStore();
  const bucket = ensureRunBucket(store);

  bucket.comments.push({
    ts: nowIso(),
    actor: "Human",
    agent: "human",
    type: "COMMENT",
    entity_type: type,
    entity_id: id,
    message: message || "",
  });

  bucket.decisions[entityKey(type, id)] ||= { decision: "COMMENTED", note: "", ts: nowIso() };
  saveHumanStore(store);
}
function getDecision(type, id) {
  const store = loadHumanStore();
  const bucket = store.runs?.[runKey()];
  return bucket?.decisions?.[entityKey(type, id)] || null;
}

function inferAgent(obj) {
  // best-effort: show which agent produced it if present
  return obj?.produced_by || obj?.agent || obj?.by || obj?.source || "system";
}

/* ===== Find helpers ===== */
function findSituation(id) {
  if (!state.data || !id) return null;
  return (state.data.situations || []).find((x) => x.situation_id === id) || null;
}
function findProblem(id) {
  if (!state.data || !id) return null;
  return (state.data.problems || []).find((x) => x.problem_id === id) || null;
}
function findAvis(id) {
  if (!state.data || !id) return null;
  return (state.data.avis || []).find((x) => x.avis_id === id) || null;
}

/* ===== Selection behavior (right panel) ===== */
function selectSituation(sid) {
  state.selectedSituationId = sid || null;
  state.selectedProblemId = null;
  state.selectedAvisId = null;
renderDetails();
}

function selectProblem(pid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const sid = parents.problemToSituation.get(pid) || null;

  state.selectedSituationId = sid;
  state.selectedProblemId = pid;
  state.selectedAvisId = null;
  renderDetails();
}

function selectAvis(aid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const pid = parents.avisToProblem.get(aid) || null;
  const sid = parents.avisToSituation.get(aid) || null;

  state.selectedSituationId = sid;
  state.selectedProblemId = pid;
  state.selectedAvisId = aid;
  renderDetails();
}

/* ===== Right panel thread ===== */
function getThreadForSelection() {
  const d = state.data;
  if (!d) return [];

  const store = loadHumanStore();
  const bucket = store.runs?.[runKey()];
  const humanEvents = bucket?.comments || [];

  const events = [];

  const s = findSituation(selectedSituationId);
  const p = findProblem(selectedProblemId);
  const a = findAvis(selectedAvisId);

  // keep a per-avis temporary verdict selection for the Validate action
  if (a) {
    const aid = a.avis_id;
    if (state.tempAvisVerdictFor !== aid) {
      state.tempAvisVerdictFor = aid;
      state.tempAvisVerdict = String(a.verdict || "F").toUpperCase();
    }
  } else {
    state.tempAvisVerdictFor = null;
    state.tempAvisVerdict = null;
  }


  if (s) {
    events.push({
      ts: d.run_id || "",
      actor: "System",
      agent: inferAgent(s),
      type: "SITUATION",
      entity_type: "situation",
      entity_id: s.situation_id,
      message: `${s.title || "(sans titre)"}\npriority=${s.priority || ""}\nsujets=${(s.problem_ids || []).length}`,
    });
  }
  if (p) {
    events.push({
      ts: d.run_id || "",
      actor: "System",
      agent: inferAgent(p),
      type: "SUJET",
      entity_type: "sujet",
      entity_id: p.problem_id,
      message: `${p.topic || "Non classé"}\npriority=${p.priority || ""}\navis=${(p.avis_ids || []).length}`,
    });
  }
  if (a) {
    events.push({
      ts: d.run_id || "",
      actor: "System",
      agent: inferAgent(a),
      type: "AVIS",
      entity_type: "avis",
      entity_id: a.avis_id,
      message: `${a.topic || ""}\nseverity=${a.severity || ""}\nverdict=${a.verdict || ""}\nagent=${inferAgent(a)}\n\n${a.message || ""}`,
    });
  }

  // allow human events relevant to the current narrow scope:
  // - avis selected: avis + its problem + its situation
  // - problem selected: problem + its situation + its avis
  // - situation selected: situation + its problems + their avis
  const allowed = new Set();
  if (a) {
    allowed.add(entityKey("avis", a.avis_id));
    if (p) allowed.add(entityKey("problem", p.problem_id));
    if (s) allowed.add(entityKey("situation", s.situation_id));
  } else if (p) {
    allowed.add(entityKey("problem", p.problem_id));
    if (s) allowed.add(entityKey("situation", s.situation_id));
    (p.avis_ids || []).forEach((id) => allowed.add(entityKey("avis", id)));
  } else if (s) {
    allowed.add(entityKey("situation", s.situation_id));
    (s.problem_ids || []).forEach((pid) => {
      allowed.add(entityKey("problem", pid));
      const pb = findProblem(pid);
      (pb?.avis_ids || []).forEach((aid) => allowed.add(entityKey("avis", aid)));
    });
  }

  const filteredHuman = humanEvents.filter((e) => allowed.size === 0 || allowed.has(entityKey(e.entity_type, e.entity_id)));
  return [...events, ...filteredHuman].sort((x, y) => (x.ts || "").localeCompare(y.ts || ""));
}


function getThreadForSelectionForIds(sid, pid, aid) {
  // Temporarily read selection from parameters, but reuse the same logic.
  const prev = {
    s: state.selectedSituationId,
    p: state.selectedProblemId,
    a: state.selectedAvisId,
  };
  state.selectedSituationId = sid || null;
  state.selectedProblemId = pid || null;
  state.selectedAvisId = aid || null;
  try {
    return getThreadForSelection();
  } finally {
    state.selectedSituationId = prev.s;
    state.selectedProblemId = prev.p;
    state.selectedAvisId = prev.a;
  }
}

/* ===== Right panel render ===== */
function renderDetails(ctx) {
  ctx ||= {};
  const host = ctx.host || el("detailsBody");
  const hostModal = (ctx.hostModal === undefined) ? el("detailsBodyModal") : ctx.hostModal;
  const d = state.data;

  const selectedSituationId = (ctx.selectedSituationId !== undefined) ? ctx.selectedSituationId : state.selectedSituationId;
  const selectedProblemId   = (ctx.selectedProblemId   !== undefined) ? ctx.selectedProblemId   : state.selectedProblemId;
  const selectedAvisId      = (ctx.selectedAvisId      !== undefined) ? ctx.selectedAvisId      : state.selectedAvisId;

  const setMeta = ctx.setMeta || setDetailsMeta;
  const setTitleHtmlFn = ctx.setTitleHtml || setDetailsTitleHtml;

  const suffixMain = ctx.suffixMain ?? "";
  const suffixModal = ctx.suffixModal ?? "Modal";

  const rightSubissuesOpen = (ctx.rightSubissuesOpen !== undefined) ? ctx.rightSubissuesOpen : state.rightSubissuesOpen;
  const rightExpandedProblems = ctx.rightExpandedProblems || state.rightExpandedProblems;
  const onToggleSubissues = ctx.onToggleSubissues || (() => { state.rightSubissuesOpen = !state.rightSubissuesOpen; renderDetails(); });
  const onToggleProblemExpand = ctx.onToggleProblemExpand || ((pid) => {
    if (!pid) return;
    onToggleProblemExpand(pid);
  });
  const onSelectProblem = ctx.onSelectProblem || ((pid) => openDrilldownForProblem(pid));
  const onSelectAvis = ctx.onSelectAvis || ((aid) => openDrilldownForAvis(aid));

  // Helper: metadata list (stacked label/value)
  const metaItem = (label, valueHtml, extraClass = "") => {
    const v = (valueHtml === undefined || valueHtml === null || String(valueHtml).trim() === "") ? "—" : String(valueHtml);
    return `<div class="meta-item ${extraClass}"><div class="meta-k">${escapeHtml(label)}</div><div class="meta-v">${v}</div></div>`;
  };
  const wrapDetailsGrid = (mainHtml, metaHtml) => {
    const metaBlock = metaHtml && String(metaHtml).trim()
      ? `<aside class="details-meta-col"><div class="meta-title">Metadata</div>${metaHtml}</aside>`
      : ``;
    return `<div class="details-grid"><div class="details-main">${mainHtml || ""}</div>${metaBlock}</div>`;
  };

  const ghDescriptionCard = (agentName, bodyHtml) => {
    const name = String("Agent " + agentName || "Agent System");
    const initial = ("A" + agentName.trim()[0] || "AS").toUpperCase();
    return `
    <div class="gh-comment">
        <div class="gh-avatar" aria-hidden="true"><span class="gh-avatar-initial">${escapeHtml(initial)}</span></div>
        <div class="gh-comment-box">
          <div class="gh-comment-header">
            <div class="gh-comment-author mono">${escapeHtml(name)}</div>
          </div>
          <div class="gh-comment-body">${bodyHtml || "Pas de remarque particulière à formuler."}</div>
        </div>
      </div>
    `;
  };

  // ===== Sub-issues panel (below description, NOT inside .gh-comment-box) =====
  const subIssuesPanel = ({ title, count, metaHtml, isOpen, bodyHtml }) => {
    const chev = isOpen ? "▾" : "▸";
    const meta = metaHtml ? metaHtml : ((count !== undefined && count !== null) ? `<span class="subissues-count mono">${escapeHtml(count)}</span>` : "");
    return `
      <div class="details-subissues">
        <div class="subissues-head click" data-action="toggle-subissues">
          <div class="subissues-head-left">
            <span class="chev">${chev}</span>
            <span class="subissues-title">${escapeHtml(title || "Sub-issues")}</span>
          </div>
          <div class="subissues-head-right">
            ${meta}
          </div>
        </div>
        <div class="subissues-body ${isOpen ? "" : "hidden"}">
          ${bodyHtml || ""}
        </div>
      </div>
    `;
  };


  const buildVerdictBarHtml = (counts) => {
    const order = ["D","S","F","HM","PM","SO"];
    const total = order.reduce((t,v) => t + (Number(counts?.[v]) || 0), 0);
    if (!total) return "";
    const items = order
      .map((v) => ({ v, c: Number(counts?.[v]) || 0 }))
      .filter((x) => x.c > 0);
    const segs = items.map(({v,c}) => {
      const pct = (c * 100) / total;
      return `<span class="verdict-bar__seg verdict-bar__seg--${v.toLowerCase()}" style="width:${pct.toFixed(4)}%"></span>`;
    }).join("");
    const legend = items.map(({v,c}) => {
      const pct = (c * 100) / total;
      return `<span class="verdict-legend__item"><span class="v-dot v-dot--${v.toLowerCase()}" aria-hidden="true"></span><span class="verdict-legend__count"><b>${c} avis</b></span><span class="verdict-legend__pct"> - ${pct.toFixed(1)}%</span></span>`;
    }).join("");
    return `<div class="subissues-counts subissues-counts--verdicts"><div class="verdict-bar" role="img" aria-label="Répartition des avis">${segs}</div><div class="verdict-legend">${legend}</div></div>`;
  };

  const buildSubIssuesForProblem = (pb, selectedAvisId) => {
    const avById = indexBy(d.avis || [], "avis_id");
    const avisAll = (pb?.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
    const avisFiltered = applyAvisFilters(avisAll);

    const COLS = ``;

    const verdictOrder = ["D","S","F","HM","PM","SO"];
    const verdictCounts = Object.fromEntries(verdictOrder.map(v => [v, 0]));
    for (const ax of avisFiltered) {
      const v = String(ax?.verdict || "").toUpperCase();
      if (verdictCounts[v] !== undefined) verdictCounts[v] += 1;
    }
    const verdictCountsHtml = buildVerdictBarHtml(verdictCounts);

    const rows = avisFiltered.map((a2) => {
      const sel = (selectedAvisId && a2.avis_id === selectedAvisId) ? " subissue-row--selected" : "";
      return `
        <div class="issue-row issue-row--avis click${sel}" data-action="right-select-avis" data-avis="${escapeHtml(a2.avis_id)}">
          <div class="cell cell-theme cell-theme--full lvl0">
            <span class="chev chev--spacer"></span>
            <span class="${verdictDotClass(a2.verdict)}" aria-hidden="true"></span>
            <span class="theme-text theme-text--avis">${escapeHtml(a2.topic || "")}</span>
          </div>
        </div>
      `;
    }).join("");

    const body = `
      <div class="issues-table subissues-table">
        ${COLS}
        <div class="issues-table__body">
          ${rows || '<div class="emptyState">Aucun avis (après filtres).</div>'}
        </div>
      </div>
    `;

    return subIssuesPanel({
      title: "Avis rattachés",
      metaHtml: `<div class="subissues-head-meta">${verdictCountsHtml}<div class="subissues-counts subissues-counts--total"><span class="mono">${avisFiltered.length}</span></div></div>`,
      isOpen: rightSubissuesOpen,
      bodyHtml: body,
    });
  };

  const buildSubIssuesForSituation = (sit) => {
    const pbById = indexBy(d.problems || [], "problem_id");
    const avById = indexBy(d.avis || [], "avis_id");

    const problems = (sit?.problem_ids || [])
      .map((pid) => pbById.get(idFromAny(pid)))
      .filter(Boolean);

    const totalPb = problems.length;
    const closedPb = problems.filter((x) => String(x?.status || "closed").toLowerCase() !== "open").length;

    // Verdict counts for all avis attached to this situation (after filters)
    const verdictOrder = ["D","S","F","HM","PM","SO"];
    const verdictCounts = Object.fromEntries(verdictOrder.map(v => [v, 0]));
    for (const pb of problems) {
      const avisAll = (pb?.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
      const avisFiltered = applyAvisFilters(avisAll);
      for (const ax of avisFiltered) {
        const v = String(ax?.verdict || "").toUpperCase();
        if (verdictCounts[v] !== undefined) verdictCounts[v] += 1;
      }
    }

    const verdictCountsHtml = buildVerdictBarHtml(verdictCounts);

    const metaHtml = `<div class="subissues-head-meta">
      <div class="subissues-counts subissues-counts--problems">${subissuesProgressIconHtml(closedPb, totalPb)}<span class="subissues-count-closed mono">${closedPb}</span>/<span class="subissues-count-total mono">${totalPb}</span></div>
      ${verdictCountsHtml}
    </div>`;

    const rows = [];

    for (const pb of problems) {
      const pbId = pb.problem_id;
      const avisAll = (pb?.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
      const avisFiltered = applyAvisFilters(avisAll);

      const hasAvis = avisFiltered.length > 0;
      const open = hasAvis && rightExpandedProblems.has(pbId);
      const chev = hasAvis ? (open ? "▾" : "▸") : "";
      const chevHtml = hasAvis
        ? `<span class="chev click" data-action="right-toggle-pb" data-pb="${escapeHtml(pbId)}">${chev}</span>`
        : `<span class="chev chev--spacer"></span>`;

      const selPb = (state.selectedProblemId && pbId === state.selectedProblemId) ? " subissue-row--selected" : "";

      // Subject row (problem)
      rows.push(`
        <div class="issue-row issue-row--pb click${selPb}" data-action="right-select-pb" data-pb="${escapeHtml(pbId)}">
          <div class="cell cell-theme cell-theme--full lvl0">
            ${chevHtml}
            ${issueStatusIconHtml(pb.status)}
            <span class="theme-text theme-text--pb">${escapeHtml(pb.topic || "")}</span>
            <span class="subissues-inline-count mono">${escapeHtml(String(avisFiltered.length))} avis</span>
          </div>
        </div>
      `);

      if (open) {
        for (const a2 of avisFiltered) {
          const selA = (state.selectedAvisId && a2.avis_id === state.selectedAvisId) ? " subissue-row--selected" : "";
          rows.push(`
            <div class="issue-row issue-row--avis click${selA}" data-action="right-select-avis" data-avis="${escapeHtml(a2.avis_id)}">
              <div class="cell cell-theme cell-theme--full lvl1">
                <span class="chev chev--spacer"></span>
                <span class="${verdictDotClass(a2.verdict)}" aria-hidden="true"></span>
                <span class="theme-text theme-text--avis">${escapeHtml(a2.topic || "")}</span>
              </div>
            </div>
          `);
        }
      }
    }

    const body = `
      <div class="issues-table subissues-table">
        <div class="issues-table__body">
          ${rows.join("") || '<div class="emptyState">Aucun sujet.</div>'}
        </div>
      </div>
    `;

    return subIssuesPanel({
      title: "Sujets rattachés",
      metaHtml,
      isOpen: rightSubissuesOpen,
      bodyHtml: body,
    });
  };

  // Backward-compatible aliases (older calls used different casing)
  const buildSubissuesForProblem = buildSubIssuesForProblem;
  const buildSubissuesForSituation = buildSubIssuesForSituation;


  if (!d) {
    setMeta("—");
    setTitleHtmlFn(escapeHtml("Sélectionner un élément"));
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un sujet / un avis pour afficher les détails.</div>`;
    if (hostModal) hostModal.innerHTML = host.innerHTML;
    return;
  }

  const parents = buildParents(d);
  const s = findSituation(selectedSituationId);
  const p = findProblem(selectedProblemId);
  const a = findAvis(selectedAvisId);

  // Head: GitHub-like title (badge + title + #id). We no longer show the separate meta line.
  setMeta("");

  if (a) {
    const v = verdictLabelFr(a.verdict);
    const badgeCls = badgeVerdict(a.verdict);
    const titleText = escapeHtml(a.topic ? a.topic : a.avis_id);
    const idText = escapeHtml(a.avis_id);
    setTitleHtmlFn(`<span class="${badgeCls} gh-verdict-pill">${escapeHtml(v)}</span><span class="details-title-text"> ${titleText}</span><span class="details-title-id mono"> #${idText}</span>`);
  } else if (p) {
    const titleText = escapeHtml(p.topic ? p.topic : p.problem_id);
    const idText = escapeHtml(p.problem_id);
    setTitleHtmlFn(`${statusBadgeHtml(p.status)}<span class="details-title-text"> ${titleText}</span><span class="details-title-id mono"> #${idText}</span>`);
  } else if (s) {
    const titleText = escapeHtml(s.title ? s.title : s.situation_id);
    const idText = escapeHtml(s.situation_id);
    setTitleHtmlFn(`${statusBadgeHtml(s.status)}<span class="details-title-text"> ${titleText}</span><span class="details-title-id mono"> #${idText}</span>`);
  } else {
    setTitleHtmlFn(escapeHtml("Sélectionner un élément"));
  }

  // decision target = most specific selection
  let decisionTarget = null;
  let decision = null;
  if (a) { decisionTarget = { type: "avis", id: a.avis_id }; decision = getDecision("avis", a.avis_id); }
  else if (p) { decisionTarget = { type: "problem", id: p.problem_id }; decision = getDecision("problem", p.problem_id); }
  else if (s) { decisionTarget = { type: "situation", id: s.situation_id }; decision = getDecision("situation", s.situation_id); }

  const decisionBadge = decision?.decision
    ? `<span class="badge ${decision.decision === "ACCEPT" ? "badge--ok" : (decision.decision === "REFUSE" ? "badge--ko" : "badge--av")}">${escapeHtml(decision.decision)}</span>`
    : `<span class="badge">NO_DECISION</span>`;

  // Narrow context rules (as requested):
  // - if problem selected: show its situation, the problem, and its avis (only)
  // - if avis selected: show its situation + its problem + that avis only
  // - if only situation selected: show situation only (no other situations)
  let title = "Details";
  let main = "";
  let meta = "";
  let subIssuesHtml = "";

  if (a) {
    const pid = parents.avisToProblem.get(a.avis_id);
    const sid = parents.avisToSituation.get(a.avis_id);
    const ps = findSituation(sid);
    const pp = findProblem(pid);

    title = "Avis";

    // Metadata = everything above the 2nd <div class="hr"> in the previous layout
    meta = [
      ps ? [
        metaItem("Situation", escapeHtml(ps.title || "(sans titre)")),
        metaItem("situation_id", `<span class="mono">${escapeHtml(ps.situation_id)}</span>`),
      ].join("") : "",
      pp ? [
        metaItem("Sujet", escapeHtml(pp.topic || "Non classé")),
        metaItem("sujet_id", `<span class="mono">${escapeHtml(pp.problem_id)}</span>`),
      ].join("") : "",
      metaItem("Severity", `<span class="${badgePriority(a.severity)}">${escapeHtml(a.severity)}</span>`),
      metaItem("Verdict", `<span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span>`),
      metaItem("Thème", escapeHtml(a.topic || "")),
      metaItem("Agent", `<span class="mono">${escapeHtml(inferAgent(a))}</span>`),
      metaItem("Source", escapeHtml(a.source || "")),
      metaItem("avis_id", `<span class="mono">${escapeHtml(a.avis_id || "")}</span>`),
    ].join("");

    main = `
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:6px;">Observation</div>
      <div style="white-space: pre-wrap; font-size: 13px;">${escapeHtml(a.message || "")}</div>
    `;

    // Sub-issues: show the other avis of this sujet
    if (pp) subIssuesHtml = buildSubIssuesForProblem(pp, a.avis_id);

  } else if (p) {
    const sid = parents.problemToSituation.get(p.problem_id);
    const ps = findSituation(sid);

    title = "Sujet";
    const avisIds = (p.avis_ids || []);
    const avis = avisIds.map(findAvis).filter(Boolean);

    // Metadata = everything above the 1st <div class="hr"> in the previous layout
    meta = [
      ps ? [
        metaItem("Situation", escapeHtml(ps.title || "(sans titre)")),
        metaItem("situation_id", `<span class="mono">${escapeHtml(ps.situation_id)}</span>`),
      ].join("") : "",
      metaItem("Priority", `<span class="${badgePriority(p.priority)}">${escapeHtml(p.priority)}</span>`),
      metaItem("Topic", escapeHtml(p.topic || "Non classé")),
      metaItem("Agent", `<span class="mono">${escapeHtml(inferAgent(p))}</span>`),
      metaItem("sujet_id", `<span class="mono">${escapeHtml(p.problem_id)}</span>`),
      metaItem("Avis", `<span class="mono">${escapeHtml(avis.length)}</span>`),
    ].join("");

    main = `
      ${(p.summary || (p.stakes||[]).length || (p.recommendations||[]).length || p.why_grouped) ? `
      ${p.summary ? `
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Synthèse</div>
        <div style=\"white-space: pre-wrap; font-size: 13px;\">${escapeHtml(p.summary)}</div>
      ` : ``}
      ${(p.stakes||[]).length ? `
        <div class=\"hr\"></div>
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Enjeux</div>
        <ul class=\"bullets\">${(p.stakes||[]).map(x => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul>
      ` : ``}
      ${(p.recommendations||[]).length ? `
        <div class=\"hr\"></div>
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Recommandations</div>
        <ul class=\"bullets\">${(p.recommendations||[]).map(x => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul>
      ` : ``}
      ${p.why_grouped ? `
        <div class=\"hr\"></div>
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Pourquoi ce regroupement ?</div>
        <div style=\"white-space: pre-wrap; font-size: 13px;\">${escapeHtml(p.why_grouped)}</div>
      ` : ``}
    ` : ``}

      
    `;

    subIssuesHtml = buildSubIssuesForProblem(p, null);
  } else if (s) {
    title = "Situation";

    // Metadata = everything above the 1st <div class="hr"> in the previous layout
    meta = [
      metaItem("Priority", `<span class="${badgePriority(s.priority)}">${escapeHtml(s.priority)}</span>`),
      metaItem("Title", escapeHtml(s.title || "(sans titre)")),
      metaItem("Agent", `<span class="mono">${escapeHtml(inferAgent(s))}</span>`),
      metaItem("situation_id", `<span class="mono">${escapeHtml(s.situation_id)}</span>`),
      metaItem("Sujets", `<span class="mono">${escapeHtml((s.problem_ids || []).length)}</span>`),
    ].join("");

    main = `
      ${(s.summary || (s.key_conflict_ids||[]).length) ? `
      ${s.summary ? `
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Synthèse</div>
        <div style=\"white-space: pre-wrap; font-size: 13px;\">${escapeHtml(s.summary)}</div>
      ` : ``}
      ${(s.key_conflict_ids||[]).length ? `
        <div class=\"hr\"></div>
        <div class=\"mono\" style=\"color: var(--muted); font-size:12px; margin-bottom:6px;\">Conflits clés</div>
        <div class=\"mono-small\">${escapeHtml((s.key_conflict_ids||[]).join(", "))}</div>
      ` : ``}
      ` : ``}
    `;

    subIssuesHtml = buildSubIssuesForSituation(s);

  } else {
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un sujet / un avis pour afficher les détails.</div>`;
    return;
  }

  const decisionRowHtml = decisionTarget ? `
    <div class="actions-row" style="margin-top:8px;">
      ${decisionBadge}
      <button class="gh-btn gh-btn--success" data-action="decide" data-decision="ACCEPT">Accepter</button>
      <button class="gh-btn gh-btn--danger" data-action="decide" data-decision="REFUSE">Refuser</button>
      <button class="gh-btn gh-btn--neutral" data-action="decide" data-decision="NEEDS_REVIEW">À vérifier</button>
    </div>
  ` : "";

  const thread = (ctx.getThread || (() => getThreadForSelectionForIds(selectedSituationId, selectedProblemId, selectedAvisId)))();

  const threadItemsHtml = thread.map((e, idx) => {
    const isComment = String(e?.type || "").toUpperCase() === "COMMENT";
    if (isComment) {
      const ts = e?.ts ? `<div class="mono-small">${escapeHtml(e.ts)}</div>` : "";
      return `
        <div class="thread-item thread-item--comment thread-item--comment--flush" data-thread-kind="comment" data-thread-idx="${idx}">
          <div class="thread-wrapper">
            <div class="gh-comment">
              <div class="gh-avatar gh-avatar--human" aria-hidden="true">${SVG_AVATAR_HUMAN}</div>
              <div class="gh-comment-box">
                <div class="gh-comment-header">
                  <div class="gh-comment-author mono">Human</div>
                  ${ts}
                </div>
                <div class="gh-comment-body">${mdToHtml(e?.message || "")}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="thread-item" data-thread-kind="event" data-thread-idx="${idx}">
        <div class="thread-badge__subissue">
          <svg aria-hidden="true" focusable="false" class="octicon octicon-issue-tracks Octicon__StyledOcticon-sc-jtj3m8-0 TimelineRow-module__Octicon__SMhVa" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M1.5 8a6.5 6.5 0 0 1 13 0A.75.75 0 0 0 16 8a8 8 0 1 0-8 8 .75.75 0 0 0 0-1.5A6.5 6.5 0 0 1 1.5 8Z"></path><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm1.5 1.75a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1-.75-.75Zm2.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z"></path></svg>
        </div>
        <div class="thread-wrapper">
          <div class="thread-item__head">
            <div class="mono">
              <span >${escapeHtml(e.actor || "Agent System")}</span>
              <span> attached this to </span>
              <span >${escapeHtml(e.entity_type || "")} n° ${escapeHtml(e.entity_id || "")}</span>
              <span>·</span>
              <span> (agent=${escapeHtml(e.agent || "system")} )</span>
              <div class="mono">in ${escapeHtml(e.ts || "")}</div>
            </div>
          </div>
          <div class="thread-item__body">${escapeHtml(e.message || "")}</div>
        </div>
      </div>
    `;
  }).join("");
  const threadHtml = thread.length ? `
    <div class="gh-timeline-title mono" style="display:none">Discussion</div>
    <div class="thread gh-thread">
      ${threadItemsHtml}
    </div>
  ` : "";

  // Human response below discussion (GitHub issue ergonomics)
  function commentBoxHtmlFor(suffix) {
    const id = (base) => `${base}${suffix}`;

    const commentBtn = `<button class="gh-btn gh-btn--comment is-disabled" data-action="add-comment" type="button" disabled>Comment</button>`;

    // Situation / Sujet actions (GitHub-like)
    const issueStatus = (p ? p.status : (s ? s.status : "open"));
    const isIssueOpen = String(issueStatus || "open").toLowerCase() === "open";

    const closeBtn = `<button class="gh-btn gh-btn--issue-action" data-action="issue-close" type="button">${SVG_ISSUE_CLOSED}<span class="gh-btn__label">Close with comment</span><span class="gh-caret">▾</span></button>`;
    const reopenBtn = `<button class="gh-btn gh-btn--issue-action" data-action="issue-reopen" type="button">${SVG_ISSUE_REOPENED}<span class="gh-btn__label">Reopen issue</span><span class="gh-caret">▾</span></button>`;

    // Avis actions
    const verdicts = ["F","D","S","HM","PM","SO"];
    const activeVerdict = String(state.tempAvisVerdict || "F").toUpperCase();
    const verdictSwitch = `<div class="verdict-switch" role="group" aria-label="Verdict">
      ${verdicts.map(v => `<button class="verdict-switch__btn ${v===activeVerdict ? "is-active" : ""}" data-action="set-verdict" data-verdict="${v}" type="button">${v}</button>`).join("")}
    </div>`;

    const validateBtn = `<button class="gh-btn" data-action="avis-validate" type="button">Validate with comment</button>`;

    const actionsRowInner = a
      ? `${verdictSwitch}${validateBtn}${commentBtn}`
      : `${isIssueOpen ? closeBtn : reopenBtn}${commentBtn}`;

  
    return decisionTarget ? `
      <div class="human-action">
        <div class="gh-avatar gh-avatar--human" aria-hidden="true">${SVG_AVATAR_HUMAN}</div>
        <div class="comment-general-block">
          <div class="gh-timeline-title mono">Add a comment</div>
          <div class="comment-box gh-comment-boxwrap">
            <div class="comment-tabs" role="tablist" aria-label="Comment tabs">
              <button class="comment-tab" id="${id("tabWrite")}" role="tab" aria-selected="true" data-tab="write">Write</button>
              <button class="comment-tab" id="${id("tabPreview")}" role="tab" aria-selected="false" data-tab="preview">Preview</button>
            </div>
            <div class="comment-editor" id="${id("commentEditor")}">
              <textarea id="${id("humanComment")}" class="textarea" placeholder="Réponse humaine (Markdown) — hypothèses, points à corriger, décision, etc."></textarea>
            </div>
            <div class="comment-editor hidden" id="${id("commentPreviewWrap")}">
              <div class="comment-preview" id="${id("commentPreview")}"></div>         
            </div>
          </div>
          <div class="actions-row actions-row--details" style="margin-top:10px; justify-content:flex-end;">
            ${actionsRowInner}
          </div>
        </div>
      </div>
    ` : "";
  }


  // Everything below <div class="details-grid"> must live inside <div class="details-main">
  // to reproduce the GitHub Issue layout (main thread + editor on the left, metadata sidebar on the right).
  const descAgent = (a ? inferAgent(a) : (p ? inferAgent(p) : (s ? inferAgent(s) : "system")));
  const descCard = ghDescriptionCard(descAgent, main);
  const mainWithThreadAndComment = `<div class="gh-timeline">${descCard}${subIssuesHtml || ""}${threadHtml}{{COMMENT_BOX}}</div>`;
  const detailsBodyHtml = wrapDetailsGrid(mainWithThreadAndComment, meta);

  host.innerHTML = detailsBodyHtml.replace("{{COMMENT_BOX}}", commentBoxHtmlFor(suffixMain));
  if (hostModal) hostModal.innerHTML = detailsBodyHtml.replace("{{COMMENT_BOX}}", commentBoxHtmlFor(suffixModal));

  // wire decision buttons
  // wire decision buttons + comment box (main + modal)
  const wireHost = (root) => {
    if (!root || !decisionTarget) return;
    const ta = root.querySelector("[id^=\'humanComment\']");
    const commentBtns = Array.from(root.querySelectorAll("[data-action='add-comment']"));
    function syncCommentBtnState() {
      const hasText = !!(ta && ta.value.trim());
      for (const b of commentBtns) {
        b.disabled = !hasText;
        b.classList.toggle("is-disabled", !hasText);
        b.classList.toggle("is-enabled", hasText);
      }
    }
    if (ta) {
      ta.addEventListener("input", syncCommentBtnState);
      syncCommentBtnState();
    }

    root.querySelectorAll("[data-action='decide']").forEach((btn) => {
      btn.onclick = () => {
        const decision = btn.getAttribute("data-decision");
        const note = (ta?.value || "").trim();
        setDecision(decisionTarget.type, decisionTarget.id, decision, note);
        renderDetails();
      };
    });

    root.querySelectorAll("[data-action='add-comment']").forEach((addBtn) => {
      addBtn.onclick = () => {
        const msg = (ta?.value || "").trim();
        if (!msg) return;
        addComment(decisionTarget.type, decisionTarget.id, msg);
        ta.value = "";
        renderDetails();
      };
    });

    // GitHub-like issue actions (Situation / Sujet)
    root.querySelectorAll("[data-action='issue-close']").forEach((btn) => {
      btn.onclick = () => {
        const note = (ta?.value || "").trim();
        setDecision(decisionTarget.type, decisionTarget.id, "CLOSED", note);
        renderDetails();
      };
    });
    root.querySelectorAll("[data-action='issue-reopen']").forEach((btn) => {
      btn.onclick = () => {
        const note = (ta?.value || "").trim();
        setDecision(decisionTarget.type, decisionTarget.id, "REOPENED", note);
        renderDetails();
      };
    });

    // Avis validation + verdict selection
    root.querySelectorAll("[data-action='avis-validate']").forEach((btn) => {
      btn.onclick = () => {
        const note = (ta?.value || "").trim();
        const v = String(state.tempAvisVerdict || "F").toUpperCase();
        setDecision(decisionTarget.type, decisionTarget.id, `VALIDATED_${v}`, note);
        renderDetails();
      };
    });

    root.querySelectorAll("[data-action='set-verdict']").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        const v = String(btn.getAttribute("data-verdict") || "").toUpperCase();
        if (!v) return;
        state.tempAvisVerdict = v;
        // Toggle active state without full rerender (preserve textarea content)
        const group = btn.closest(".verdict-switch");
        if (group) {
          group.querySelectorAll(".verdict-switch__btn").forEach((b) => b.classList.remove("is-active"));
        }
        btn.classList.add("is-active");
      };
    });


    // tabs + preview
    const tabWrite = root.querySelector("[id^='tabWrite']");
    const tabPreview = root.querySelector("[id^='tabPreview']");
    const editor = root.querySelector("[id^='commentEditor']");
    const previewWrap = root.querySelector("[id^='commentPreviewWrap']");
    const preview = root.querySelector("[id^='commentPreview']");
    function setTab(which) {
      const isWrite = which === "write";
      if (tabWrite) tabWrite.setAttribute("aria-selected", String(isWrite));
      if (tabPreview) tabPreview.setAttribute("aria-selected", String(!isWrite));
      if (editor) editor.classList.toggle("hidden", !isWrite);
      if (previewWrap) previewWrap.classList.toggle("hidden", isWrite);
      if (!isWrite && preview && ta) preview.innerHTML = mdToHtml(ta.value);
    }

    if (tabWrite) tabWrite.onclick = () => setTab("write");
    if (tabPreview) tabPreview.onclick = () => setTab("preview");
  };

  wireHost(host);
  wireHost(hostModal);

  // wire sub-issues panel (below description)
  const wireSubIssues = (root) => {
    if (!root) return;

    const toggle = root.querySelector("[data-action='toggle-subissues']");
    if (toggle) {
      toggle.onclick = () => {
        onToggleSubissues();
      };
    }

    root.querySelectorAll("[data-action='right-toggle-pb']").forEach((node) => {
      node.onclick = (ev) => {
        ev.stopPropagation();
        const pid = node.getAttribute("data-pb");
        if (!pid) return;
        onToggleProblemExpand(pid);
      };
    });

    root.querySelectorAll("[data-action='right-select-pb']").forEach((node) => {
      node.onclick = () => {
        const pid = node.getAttribute("data-pb");
        if (!pid) return;
        onSelectProblem(pid);
      };
    });

    root.querySelectorAll("[data-action='right-select-avis']").forEach((node) => {
      node.onclick = () => {
        const aid = node.getAttribute("data-avis");
        if (!aid) return;
        onSelectAvis(aid);
      };
    });
  };

  wireSubIssues(host);
  wireSubIssues(hostModal);
}


/* ===== Middle scroll preservation (prevent jump-to-top on re-render) ===== */
function getMiddleScrollEl(host) {
  if (!host) return null;
  // Prefer the inner scrolling body if present
  return host.querySelector(".issues-table__body") || host;
}
function captureMiddleScroll(host) {
  const sc = getMiddleScrollEl(host);
  if (!sc) return { top: 0, left: 0 };
  return { top: sc.scrollTop || 0, left: sc.scrollLeft || 0 };
}
function restoreMiddleScroll(host, pos) {
  const sc = getMiddleScrollEl(host);
  if (!sc || !pos) return;
  // Restore on next frame (after DOM has been rebuilt)
  requestAnimationFrame(() => {
    sc.scrollTop = pos.top || 0;
    sc.scrollLeft = pos.left || 0;
  });
}

/* ===== Middle render (lighter, persistent expand) ===== */
/* ===== Display depth control (situations | sujets | avis) ===== */
function setDisplayDepth(depth) {
  const d = String(depth || "avis").toLowerCase();
  const allowed = new Set(["situations", "sujets", "avis"]);
  state.displayDepth = allowed.has(d) ? d : "avis";

  // Auto-expand according to depth
  if (!state.data) return;

  const hasSituations = Array.isArray(state.data.situations);
  const hasProblems = Array.isArray(state.data.problems);

  if (state.displayDepth === "situations") {
    state.expandedSituations = new Set();
    state.expandedProblems = new Set();
  } else if (state.displayDepth === "sujets") {
    // Expand all situations that have at least one sujet
    const sids = [];
    if (hasSituations) {
      for (const s of state.data.situations) {
        if ((s.problem_ids || []).length) sids.push(s.situation_id);
      }
    }
    state.expandedSituations = new Set(sids);
    state.expandedProblems = new Set(); // keep avis collapsed
  } else {
    // avis => expand everything (situations + sujets)
    const sids = [];
    const pids = [];
    if (hasSituations) {
      for (const s of state.data.situations) {
        if ((s.problem_ids || []).length) sids.push(s.situation_id);
      }
    }
    if (hasProblems) {
      for (const p of state.data.problems) {
        if ((p.avis_ids || []).length) pids.push(p.problem_id);
      }
    }
    state.expandedSituations = new Set(sids);
    state.expandedProblems = new Set(pids);
  }

  // Reset paging when changing depth (especially for avis)
  state.page = 1;

  // Sync UI select if present
  const sel = el("depthSelect");
  if (sel) sel.value = state.displayDepth;

  renderMiddle();
}


function injectDepthControl() {
  if (el("depthSelect")) return;

  const search = el("searchBox");
  const verdictSel = el("verdictFilter");
  if (!search) return;

  const parent = search.parentElement;
  if (!parent) return;

  // Create label like "Search" / "Verdict"
  const label = document.createElement("span");
  label.textContent = "Affichage";
  label.className = "control-label"; // same semantic style
  label.style.marginLeft = "16px";

  const sel = document.createElement("select");
  sel.id = "depthSelect";

  // Clone visual style from Verdict select if available
  if (verdictSel) {
    sel.className = verdictSel.className;
    sel.style.cssText = verdictSel.style.cssText;
  }

  const opts = [
    { v: "situations", t: "Situations" },
    { v: "sujets", t: "Sujets" },
    { v: "avis", t: "Avis" },
  ];

  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.v;
    opt.textContent = o.t;
    sel.appendChild(opt);
  }

  sel.value = state.displayDepth || "situations";
  sel.onchange = () => setDisplayDepth(sel.value);

  parent.appendChild(label);
  parent.appendChild(sel);
}


function idFromAny(x) {
  if (!x) return null;
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (typeof x === "object") return x.avis_id || x.problem_id || x.situation_id || x.id || null;
  return null;
}
function renderMiddle() {
  const host = el("issuesTable");
  const counts = el("counts");
  const d = state.data;

  // preserve scroll position in the middle list across re-renders
  const _prevScroll = captureMiddleScroll(host);

  setIssuesTotals(d);

  if (!d || !Array.isArray(d.situations) || !Array.isArray(d.problems) || !Array.isArray(d.avis)) {
    host.classList.add("emptyState");
    host.innerHTML = `
      <div class="empty-welcome">
        <h1><b>WELCOME</b><span style="font-size:18px;font-weight:400;"> to RAPSOBOT Proof Of Concept 🎉</span></h1>
    
        <h3>Comment ça marche</h3>
        <p>
          Saisissez dans le menu de gauche la <b>"vérité"</b> de votre projet :
          les données d'entrée validées par un humain comme <b>Référence de Vérité</b>.
        </p>
        <p>Chargez votre document PDF</p>
        <p>Cliquez sur le bouton <b>"Run analysis"</b></p>
        <p style="color:var(--muted)">
          ⏳ Les analyses peuvent prendre entre 1 et 6 minutes selon la taille du PDF.
        </p>
    
        <h3>Limites du PoC</h3>
        <p>
          Référentiel supporté :
          <b>Eurocode 8</b> + Annexe Nationale Française + Arrêté du 22 octobre 2010.
        </p>
        <p>
          Seules les <b>Notes de Calcul</b> PDF sont prises en charge (pas de plans, pas de modèle 3D…).
        </p>
        <p>
          La <b>validation humaine</b> (commentaire, validation, refus...) n'est pas implémentée dans cette version du PoC.
        </p>

      </div>
    `;
    if (counts) if (counts) counts.textContent = "—";
    const pageInfoEl = el("pageInfo"); if (pageInfoEl) pageInfoEl.textContent = "1 / 1";
    renderDetails();
    return;
  }

  const pbById = indexBy(d.problems, "problem_id");
  const avById = indexBy(d.avis, "avis_id");


// ----- Priority visibility rules -----
// - A sujet has a visible priority only if it has at least 1 avis AFTER filters (Verdict/Search).
// - A situation has a visible priority only if at least 1 of its sujets has at least 1 avis AFTER filters.
function getFilteredAvisForProblem(pb) {
  const avisAll = (pb?.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
  return applyAvisFilters(avisAll);
}
function problemHasFilteredAvis(pb) {
  return getFilteredAvisForProblem(pb).length > 0;
}
function situationHasFilteredAvis(s) {
  const pbs = (s?.problem_ids || []).map((pid) => pbById.get(idFromAny(pid))).filter(Boolean);
  for (const pb of pbs) {
    if (problemHasFilteredAvis(pb)) return true;
  }
  return false;
}

  if (counts) counts.textContent = `${d.situations.length} situations · ${d.problems.length} sujets · ${d.avis.length} avis`;

  const COLS = `
    <div class="issues-table__head">
      <div class="cell cell-theme">Thème</div>
      <div class="cell cell-verdict">Verdict</div>
      <div class="cell cell-prio">Prio</div>
      <div class="cell cell-agent">Agent</div>
      <div class="cell cell-id">avis_id</div>
    </div>
  `;

  const rows = [];
  for (const s of d.situations) {
    const hasProblems = (s.problem_ids || []).length > 0;
    const sitOpen = hasProblems && state.expandedSituations.has(s.situation_id);
    const sitChev = hasProblems ? (sitOpen ? "▾" : "▸") : "";
    const sitChevHtml = hasProblems ? `<span class="chev">${sitChev}</span>` : `<span class="chev chev--spacer"></span>`;
    
const sitHasFilteredAvis = hasProblems && situationHasFilteredAvis(s);
const sitPrioHtml = sitHasFilteredAvis
  ? `<span class="${badgePriority(s.priority)}">${escapeHtml(s.priority || "")}</span>`
  : `<span class="${badgePriority(s.priority)}" style="visibility:hidden">${escapeHtml(s.priority || "P3")}</span>`;

    rows.push(`
      <div class="issue-row issue-row--sit click" data-action="toggle-sit" data-sit="${escapeHtml(s.situation_id)}">
        <div class="cell cell-theme lvl0">
          ${sitChevHtml}
          ${issueStatusIconHtml(s.status)}<span class="theme-text theme-text--sit">${escapeHtml(s.title || "(sans titre)")}</span>
        </div>
        <div class="cell cell-verdict"></div>
        <div class="cell cell-prio">${sitPrioHtml}</div>
        <div class="cell cell-agent"></div>
        <div class="cell cell-id mono">pb=${escapeHtml((s.problem_ids || []).length)}&nbsp;&nbsp;${escapeHtml(s.situation_id)}</div>
      </div>
    `);

    if (sitOpen) {
      const problems = (s.problem_ids || []).map((pid) => pbById.get(idFromAny(pid))).filter(Boolean);

      for (const pb of problems) {
        const hasAvis = (pb.avis_ids || []).length > 0;
        const pbOpen = hasAvis && state.expandedProblems.has(pb.problem_id);
        const pbChev = hasAvis ? (pbOpen ? "▾" : "▸") : "";
        const pbChevHtml = hasAvis ? `<span class="chev">${pbChev}</span>` : `<span class="chev chev--spacer"></span>`;
        
const pbHasFilteredAvis = hasAvis && problemHasFilteredAvis(pb);
const pbPrioHtml = pbHasFilteredAvis
  ? `<span class="${badgePriority(pb.priority)}">${escapeHtml(pb.priority || "")}</span>`
  : `<span class="${badgePriority(pb.priority)}" style="visibility:hidden">${escapeHtml(pb.priority || "P3")}</span>`;

        rows.push(`
          <div class="issue-row issue-row--pb click" data-action="toggle-pb" data-pb="${escapeHtml(pb.problem_id)}">
            <div class="cell cell-theme lvl1">
              ${pbChevHtml}
              ${issueStatusIconHtml(pb.status)}<span class="theme-text theme-text--pb">${escapeHtml(pb.topic || "Non classé")}</span>
            </div>
            <div class="cell cell-verdict"></div>
            <div class="cell cell-prio">${pbPrioHtml}</div>
            <div class="cell cell-agent"></div>
            <div class="cell cell-id mono">avis=${escapeHtml((pb.avis_ids || []).length)}&nbsp;&nbsp;${escapeHtml(pb.problem_id)}</div>
          </div>
        `);

        if (pbOpen) {
          const avisAll = (pb.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
          const avisFiltered = applyAvisFilters(avisAll);
          // Depth=avis: show all avis for each sujet (no per-sujet pagination)
          const pageInfoEl = el("pageInfo"); if (pageInfoEl) pageInfoEl.textContent = "";

          for (const a of avisFiltered) {
            rows.push(`
              <div class="issue-row issue-row--avis click" data-action="select-avis" data-avis="${escapeHtml(a.avis_id)}">
                <div class="cell cell-theme lvl2">
                  <span class="chev chev--spacer"></span>
                  <span class="theme-text theme-text--avis">${escapeHtml(a.topic || "")}</span>
                </div>
                <div class="cell cell-verdict"><span class="${badgeVerdict(a.verdict)}">${escapeHtml(String(a.verdict || "").toUpperCase())}</span></div>
                <div class="cell cell-prio"></div>
                <div class="cell cell-agent mono-small">${escapeHtml(inferAgent(a))}</div>
                <div class="cell cell-id mono">${escapeHtml(a.avis_id)}</div>
              </div>
            `);
          }
        }
      }
    }
  }

  host.classList.remove("emptyState");
  host.innerHTML = `
    <div class="issues-table">
      ${COLS}
      <div class="issues-table__body">
        ${rows.join("")}
      </div>
    </div>
  `;

  // wire: situation toggle + selection
  host.querySelectorAll("[data-action='toggle-sit']").forEach((node) => {
    node.onclick = () => {
      const sid = node.getAttribute("data-sit");
      if (!sid) return;

      const sObj = findSituation(sid);
      const hasProblems = (sObj?.problem_ids || []).length > 0;

      if (hasProblems) {
        if (state.expandedSituations.has(sid)) state.expandedSituations.delete(sid);
        else state.expandedSituations.add(sid);
      }

      selectSituation(sid);
      renderMiddle();
    };
  });

  // wire: problem toggle + selection
  host.querySelectorAll("[data-action='toggle-pb']").forEach((node) => {
    node.onclick = (ev) => {
      ev.stopPropagation();
      const pid = node.getAttribute("data-pb");
      if (!pid) return;

      const pObj = findProblem(pid);
      const hasAvis = (pObj?.avis_ids || []).length > 0;

      if (hasAvis) {
        if (state.expandedProblems.has(pid)) state.expandedProblems.delete(pid);
        else state.expandedProblems.add(pid);
      }

      onSelectProblem(pid);
      renderMiddle();
    };
  });

  // wire: avis selection
  host.querySelectorAll("[data-action='select-avis']").forEach((row) => {
    row.onclick = (ev) => {
      ev.stopPropagation();
      const aid = row.getAttribute("data-avis");
      if (!aid) return;
      onSelectAvis(aid);
    };
  });
  restoreMiddleScroll(host, _prevScroll);
  renderDetails();
}


/* ===== Network helpers (timeout + delayed status message) ===== */
const FETCH_TIMEOUT_MS = 180_000;      // 3 minutes
const SLOW_NOTICE_MS   = 25_000;       // show "still running" message after 25s

function isAbortError(e) {
  return e && (e.name === "AbortError" || String(e).includes("AbortError"));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/* ===== Async pattern: ACK + Polling (status endpoint) ===== */
// Force STATUS in production, while START remains user-provided (often /webhook-test/...).
const STATUS_URL_PROD = "https://nicolbh.app.n8n.cloud/webhook/rapsobot-poc-status";


/* ===== Supabase direct status (avoids n8n executions) =====
   IMPORTANT:
   - Use ONLY a *publishable/anon* key in the browser (never a secret/service_role key).
   - If you pasted a key starting with "sb_secret_", rotate it immediately (it must not be exposed in a frontend).
*/
const SUPABASE_URL = "https://smsizuijtrqogupgjnyj.supabase.co";
// ⚠️ Replace with your *publishable/anon* key (often starts with "sb_publishable_...").
const SUPABASE_ANON_KEY = "sb_publishable_0JlI9Nc1tyGmjuBZX9Oznw_Zlnfq6gC";

async function fetchRunRowFromSupabase(runId) {
  // Build URL via URLSearchParams to avoid encoding / quoting pitfalls.
  const u = new URL(`${SUPABASE_URL}/rest/v1/rapsobot_runs`);
  u.searchParams.set("select", "run_id,status,phase,phase_progress,phase_msg,payload,updated_at");
  u.searchParams.set("run_id", `eq.${runId}`);
  u.searchParams.set("limit", "1");

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase status fetch failed (${res.status}): ${txt}`);
  }

  const rows = await res.json();

  // If nothing matches, return UNKNOWN (caller will keep polling).
  // (This usually means run_id mismatch or the row hasn't been inserted yet.)
  return (rows && rows[0]) ? rows[0] : { status: "UNKNOWN", payload: null };
}

// Polling strategy (to protect n8n execution quota)
// - Start fast (2s) for quick jobs
// - Exponential backoff up to 20s for long jobs
// - When tab is in background, slow down aggressively
const POLL_BASE_MS         = 2000;
const POLL_MAX_INTERVAL_MS = 20_000;
const POLL_MAX_MS          = 12 * 60_000;  // 12 minutes
const POLL_FAST_TRIES      = 5;            // keep first few polls snappy

function computePollDelayMs(tries, progress) {
  // Background tab → très lent
  if (document.hidden) return 30_000;

  const p = Number.isFinite(Number(progress)) ? Number(progress) : null;

  // Si on a un % : lent au début, rapide à la fin
  if (p !== null) {
    if (p < 20) return 20_000;
    if (p < 40) return 15_000;
    if (p < 60) return 10_000;
    if (p < 80) return 6_000;
    return 2_000; // 80–100 : rapide
  }

  // Fallback sans % (comportement actuel, mais moins agressif)
  if (tries <= POLL_FAST_TRIES) return POLL_BASE_MS;
  const pow = Math.min(tries - POLL_FAST_TRIES, 10);
  const delay = POLL_BASE_MS * Math.pow(1.6, pow);
  return Math.min(POLL_MAX_INTERVAL_MS, Math.round(delay));
}

function deriveStatusUrl(webhookUrl) {
  // Default convention: same base path, replace trailing "/rapsobot-poc" by "/rapsobot-poc-status"
  // Works with both /webhook/rapsobot-poc and /webhook-test/rapsobot-poc
  try {
    const u = new URL(webhookUrl);
    u.pathname = u.pathname.replace(/\/rapsobot-poc\/?$/, "/rapsobot-poc-status");
    return u.toString();
  } catch {
    return webhookUrl.replace(/\/rapsobot-poc\/?$/, "/rapsobot-poc-status");
  }
}

function normalizeStatusResponse(data) {
  // n8n Respond to Webhook can return either an object or an array of entries.
  if (Array.isArray(data)) data = data[0] || {};
  // payload may come back as a JSON string depending on Supabase / n8n serialization.
  if (data && typeof data.payload === "string") {
    const s = data.payload.trim();
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { data.payload = JSON.parse(s); } catch {}
    }
  }
  return data || {};
}

async function pollRunStatus({ statusUrl, runId }) {
  const t0 = Date.now();
  let tries = 0;

  while (Date.now() - t0 < POLL_MAX_MS) {
    tries++;
    setSystemStatus("running", "En cours d’analyse", "IN_PROGRESS");
    showBanner("info", `Analyse en cours… pol #${tries} · status: IN_PROGRESS`);


let data = null;
try {
  data = await fetchRunRowFromSupabase(runId);
} catch (e) {
  // Network/API hiccup during polling → keep waiting
  showBanner("info", `Analyse en cours… pol #${tries} · status: RECOVERING`);
  await new Promise(r => setTimeout(r, computePollDelayMs(tries)));
  continue;
}

    data = normalizeStatusResponse(data);

    const status = String(data?.status || "").toUpperCase();
    if (status === "UNKNOWN") {
      // Helpful diagnostics (open DevTools → Console)
      console.debug("[RAPSOBOT] Supabase returned UNKNOWN for runId:", runId);
    }
    const payload = data?.payload || null;

    const phase = String(data?.phase || "").trim();
    const progress = data?.phase_progress;
    const phaseMsg = String(data?.phase_msg || "").trim();
    
    const meta = [
      status || "IN_PROGRESS",
      phase ? `· ${phase}` : "",
      (progress !== undefined && progress !== null) ? `· ${progress}%` : ""
    ].join(" ").replace(/\s+/g, " ").trim();
    
    const bannerMsg = phaseMsg
      ? `Analyse en cours… pol #${tries} · ${meta} — ${phaseMsg}`
      : `Analyse en cours… pol #${tries} · ${meta}`;
    
    showBanner("info", bannerMsg);
    setSystemStatus("running", "En cours d’analyse", meta);


    // READY + payload => render
    if ((status === "READY_FOR_REVIEW" || status === "DONE" || status === "READY") && payload) {
      let final = payload.final_result || payload;
      if (Array.isArray(final)) final = final[0] || {};
      if (final && Array.isArray(final.final_result)) final = final.final_result[0] || {};

      state.data = final;
      state.expandedSituations = new Set();
      state.expandedProblems = new Set();
      state.page = 1;

      const firstSit = final.situations?.[0]?.situation_id || null;
      if (firstSit) state.expandedSituations.add(firstSit);
      state.selectedSituationId = firstSit;
      state.selectedProblemId = null;
      state.selectedAvisId = null;

      showBanner("info", "");
      setRunMeta(runId);
      setSystemStatus("done", "Terminé", status);
      setDisplayDepth(state.displayDepth || "situations");
      return true;
    }

    // Still running
    setRunMeta(runId);


    await new Promise(r => setTimeout(r, computePollDelayMs(tries, progress)));
  }

  // Timeout polling
  showBanner("error", "Analyse toujours en cours ou résultat non récupéré. Réessaie (ou vérifie l’endpoint /rapsobot-poc-status).");
  setSystemStatus("error", "Timeout", "polling");
  return false;
}


/* ===== Run / Reset / Sidebar ===== */
async function run() {
  // Clear prior UI states, but do NOT fail fast visually: long runs are expected.
  showBanner("info", "");
  setRunMeta("");
  setSystemStatus("running", "En cours d’analyse", "POST /webhook");

  const inp = readInputs();
  if (!inp.webhookUrl) {
    showBanner("error", "Webhook URL manquant. Renseigne-le dans le champ (ou via ?webhookUrl=...).");
    setSystemStatus("error", "Erreur", "webhookUrl manquant");
    return;
  }
  if (!inp.pdfFile) {
    showBanner("error", "PDF manquant. Sélectionne un fichier PDF depuis l’ordinateur.");
    setSystemStatus("error", "Erreur", "pdf manquant");
    return;
  }

  const user_reference = {
    commune_cp: inp.communeCp,
    importance: inp.importance,
    soilClass: inp.soilClass,
    liquefaction: inp.liquefaction,
    referential: inp.referential,
  };

  // Client-side run_id so we can poll even if the POST fails.
  const runId = `RUN-${Date.now()}`;
  setRunMeta(runId);
  const statusUrl = STATUS_URL_PROD;
  // Show a gentle notice if the request is still running after a while.
  let slowTimer = null;
  slowTimer = setTimeout(() => {
    showBanner("info", "Analyse en cours… (cela peut prendre 1–3 minutes selon le PDF).");
    setSystemStatus("running", "En cours d’analyse", "toujours en cours…");
  }, SLOW_NOTICE_MS);

  // Start the POST, but do NOT depend on it for rendering (we will poll).
  try {
    const form = new FormData();
    form.append("run_id", runId);
    form.append("user_reference", JSON.stringify(user_reference));
    form.append("pdf", inp.pdfFile, inp.pdfFile.name);

    // If the server returns final_result immediately, we render.
    // If it returns ACK {run_id, status:IN_PROGRESS}, we poll.
    const res = await fetchWithTimeout(inp.webhookUrl, { method: "POST", body: form }, FETCH_TIMEOUT_MS);
    const text = await res.text();

    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    data = normalizeStatusResponse(data);

    const final = data?.final_result || data;

    // Case A: legacy synchronous response (has arrays)
    if (final && typeof final === "object" &&
        Array.isArray(final.situations) && Array.isArray(final.problems) && Array.isArray(final.avis)) {
      state.data = final;
      state.expandedSituations = new Set();
      state.expandedProblems = new Set();
      state.page = 1;

      const firstSit = final.situations?.[0]?.situation_id || null;
      if (firstSit) state.expandedSituations.add(firstSit);
      state.selectedSituationId = firstSit;
      state.selectedProblemId = null;
      state.selectedAvisId = null;

      showBanner("info", "");
      setRunMeta(final.run_id || runId);
      setSystemStatus("done", "Terminé", final.status || "OK");
      setDisplayDepth(state.displayDepth || "situations");
      return;
    }

    // Case B: ACK pattern → poll
    showBanner("info", "Analyse en cours… (ack reçu, récupération du résultat)");
    setSystemStatus("running", "En cours d’analyse", "ACK reçu");
    await pollRunStatus({ statusUrl, runId });
  } catch (e) {
    // POST failed locally → still try to poll (workflow might have started).
    const msg = e?.message || String(e);

    if (isAbortError(e)) {
      showBanner("info", "Analyse en cours… (timeout navigateur). Je tente de récupérer le résultat via le statut…");
      setSystemStatus("running", "En cours d’analyse", "timeout POST → polling");
    } else if (String(msg).toLowerCase().includes("failed to fetch")) {
      showBanner("info", "Connexion instable : le POST a échoué côté navigateur. Je tente de récupérer le résultat via le statut…");
      setSystemStatus("running", "En cours d’analyse", "POST KO → polling");
    } else {
      showError(`POST webhook en erreur: ${msg}. Je tente quand même la récupération via le statut…`);
      setSystemStatus("running", "En cours d’analyse", "POST erreur → polling");
    }

    await pollRunStatus({ statusUrl, runId });
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
  }
}

function resetUI() {
  showBanner("info", "");
  setRunMeta("");
  setSystemStatus("idle", "Idle", "—");

  state.data = null;
  state.expandedSituations = new Set();
  state.expandedProblems = new Set();

  state.selectedSituationId = null;
  state.selectedProblemId = null;
  state.selectedAvisId = null;

  state.page = 1;
  state.search = "";
  state.verdictFilter = "ALL";

  state.displayDepth = "situations";

  el("verdictFilter").value = "ALL";
  el("searchBox").value = "";
  if (el("depthSelect")) el("depthSelect").value = "situations";
  if (el("pdfFile")) el("pdfFile").value = "";

  setIssuesTotals(null);
  setDetailsMeta("—");
  renderMiddle();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const btn = el("sidebarToggleFloating");
  if (btn) btn.setAttribute("aria-label", state.sidebarCollapsed ? "Afficher le menu" : "Rétracter le menu");
}

/* ===== Details fullscreen modal ===== */
function openDetailsModal() {
  const modal = el("detailsModal");
  if (!modal) return;

  // Affiche la modale
  modal.classList.remove("hidden");

  // Bloque le scroll du background
  document.body.classList.add("modal-open");

  // Sécurité : s'assurer que seul le body de la modale scrolle
  const modalBody = modal.querySelector(".modal__body");
  if (modalBody) {
    modalBody.scrollTop = 0;
  }

  // Sync contenu (titre, meta, discussion, réponse humaine)
  renderDetails();
}

function closeDetailsModal() {
  const modal = el("detailsModal");
  if (!modal) return;

  // Ferme la modale
  modal.classList.add("hidden");

  // Restaure le scroll global
  document.body.classList.remove("modal-open");

  // Sécurité : reset du scroll interne (évite état sale à la prochaine ouverture)
  const modalBody = modal.querySelector(".modal__body");
  if (modalBody) {
    modalBody.scrollTop = 0;
  }
}


/* ===== Drilldown panel (independent details) ===== */
function ensureDrilldownDom() {
  if (el("drilldownOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "drilldownOverlay";
  overlay.className = "drilldown-overlay hidden";
  overlay.innerHTML = `
    <div class="drilldown-panel" role="dialog" aria-modal="true" aria-label="Détail">
      <div class="drilldown-head">
        <div id="drilldownTitle" class="drilldown-title"></div>
        <button id="drilldownClose" class="icon-btn drilldown-close" type="button" aria-label="Fermer">✕</button>
      </div>
      <div id="drilldownBody" class="drilldown-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close actions
  el("drilldownClose").onclick = closeDrilldown;
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeDrilldown();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.drill.isOpen) closeDrilldown();
  });
}

function openDrilldownWithSelection({ situationId = null, problemId = null, avisId = null } = {}) {
  ensureDrilldownDom();
  state.drill.isOpen = true;
  state.drill.selectedSituationId = situationId;
  state.drill.selectedProblemId = problemId;
  state.drill.selectedAvisId = avisId;
  el("drilldownOverlay").classList.remove("hidden");
  requestAnimationFrame(() => el("drilldownOverlay").classList.add("is-open"));
  renderDrilldown();
}

function closeDrilldown() {
  const ov = el("drilldownOverlay");
  if (!ov) return;
  state.drill.isOpen = false;
  ov.classList.remove("is-open");
  // keep DOM, just hide after transition
  setTimeout(() => {
    if (!state.drill.isOpen) ov.classList.add("hidden");
  }, 220);
}

function openDrilldownForProblem(pid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const sid = parents.problemToSituation.get(pid) || null;
  openDrilldownWithSelection({ situationId: sid, problemId: pid, avisId: null });
}

function openDrilldownForAvis(aid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const pid = parents.avisToProblem.get(aid) || null;
  const sid = parents.avisToSituation.get(aid) || null;
  openDrilldownWithSelection({ situationId: sid, problemId: pid, avisId: aid });
}

function drillSelectProblem(pid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const sid = parents.problemToSituation.get(pid) || null;
  state.drill.selectedSituationId = sid;
  state.drill.selectedProblemId = pid;
  state.drill.selectedAvisId = null;
  renderDrilldown();
}

function drillSelectAvis(aid) {
  const d = state.data;
  if (!d) return;
  const parents = buildParents(d);
  const pid = parents.avisToProblem.get(aid) || null;
  const sid = parents.avisToSituation.get(aid) || null;
  state.drill.selectedSituationId = sid;
  state.drill.selectedProblemId = pid;
  state.drill.selectedAvisId = aid;
  renderDrilldown();
}

function renderDrilldown() {
  if (!state.drill.isOpen) return;
  const titleEl = el("drilldownTitle");
  const bodyEl = el("drilldownBody");
  if (!bodyEl || !titleEl) return;

  renderDetails({
    host: bodyEl,
    hostModal: null,
    selectedSituationId: state.drill.selectedSituationId,
    selectedProblemId: state.drill.selectedProblemId,
    selectedAvisId: state.drill.selectedAvisId,
    setTitleHtml: (html) => { titleEl.innerHTML = html || ""; },
    setMeta: () => {},
    suffixMain: "Drill",
    rightSubissuesOpen: state.drill.rightSubissuesOpen,
    rightExpandedProblems: state.drill.rightExpandedProblems,
    onToggleSubissues: () => { state.drill.rightSubissuesOpen = !state.drill.rightSubissuesOpen; renderDrilldown(); },
    onToggleProblemExpand: (pid) => {
      if (!pid) return;
      if (state.drill.rightExpandedProblems.has(pid)) state.drill.rightExpandedProblems.delete(pid);
      else state.drill.rightExpandedProblems.add(pid);
      renderDrilldown();
    },
    onSelectProblem: drillSelectProblem,
    onSelectAvis: drillSelectAvis,
  });
}


/* ===== Splitter: resize right Details panel up to 750px ===== */
function initRightSplitter() {
  const page = document.querySelector(".gh-page--3col");
  const results = document.querySelector(".gh-panel--results");
  const details = document.querySelector(".gh-panel--details");
  if (!page || !results || !details) return;

  // avoid double insert
  if (page.querySelector(".gh-splitter")) return;

  // create splitter element (between results and details)
  const splitter = document.createElement("div");
  splitter.className = "gh-splitter";
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Redimensionner la section Détails");
  // splitter visual handled in CSS
  splitter.innerHTML = "";

  // Insert splitter before details panel
  details.parentNode.insertBefore(splitter, details);

  const MAX_W = 750;
  const MIN_W = (() => {
    // derive from current computed width; if 0 (e.g., during reflow/sidebar toggle), fallback to CSS var or 420
    const rectW = Math.round(details.getBoundingClientRect().width || 0);
    const cssVar = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rightW"), 10);
    const w = (rectW >= 80) ? rectW : (Number.isFinite(cssVar) && cssVar > 0 ? cssVar : 420);
    return Math.max(280, w);
  })();

  function setRightWidth(px) {
    const clamped = Math.max(MIN_W, Math.min(MAX_W, Math.round(px)));
    document.documentElement.style.setProperty("--rightW", clamped + "px");
  }

  let startX = 0;
  let startW = 0;
  let dragging = false;

  function onMove(ev) {
    if (!dragging) return;
    const x = (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;
    const dx = x - startX;
    // moving right decreases details width; moving left increases
    setRightWidth(startW - dx);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("is-resizing");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchmove", onMove, { passive: false });
    window.removeEventListener("touchend", onUp);
  }

  function onDown(ev) {
    // ignore if collapsed layout (splitter hidden)
    if (window.getComputedStyle(splitter).display === "none") return;

    dragging = true;
    document.body.classList.add("is-resizing");
    startX = (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;
    startW = Math.round(details.getBoundingClientRect().width || MIN_W);

    // prevent page selection / scroll on touch
    if (ev.cancelable) ev.preventDefault();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  splitter.addEventListener("mousedown", onDown);
  splitter.addEventListener("touchstart", onDown, { passive: false });

  // Initialize CSS var to current width (bounded)
  setRightWidth(MIN_W);
}


function wireEvents() {
  el("runBtnTop").onclick = run;
  el("resetBtnTop").onclick = resetUI;
  if (el("sidebarToggle")) el("sidebarToggle").onclick = toggleSidebar;
  if (el("sidebarToggleFloating")) el("sidebarToggleFloating").onclick = toggleSidebar;

  if (el("detailsExpand")) el("detailsExpand").onclick = openDetailsModal;
  if (el("detailsClose")) el("detailsClose").onclick = closeDetailsModal;

  // close modal on overlay click or ESC
  const modal = el("detailsModal");
  if (modal) {
    modal.onclick = (ev) => {
      if (ev.target === modal) closeDetailsModal();
    };
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeDetailsModal();
  });

  // Drilldown container
  ensureDrilldownDom();

  el("verdictFilter").onchange = (ev) => {
    state.verdictFilter = ev.target.value;
    state.page = 1;
    renderMiddle();
  };

  el("searchBox").oninput = (ev) => {
    state.search = ev.target.value;
    state.page = 1;
    renderMiddle();
  };

  // Depth control dropdown (situations | sujets | avis)
  injectDepthControl();
  setDisplayDepth(state.displayDepth || "situations");

  const prevBtn = el("prevPage"); if (prevBtn) prevBtn.onclick = () => {
    state.page = Math.max(1, state.page - 1);
    renderMiddle();
  };

  const nextBtn = el("nextPage"); if (nextBtn) nextBtn.onclick = () => {
    state.page = state.page + 1;
    renderMiddle();
  };
}

/* Boot */
applyQueryParamsToForm();
wireEvents();
initRightSplitter();
resetUI();
