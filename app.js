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
  page: 1,
  pageSize: 80, // paginating avis within a problem if needed

  sidebarCollapsed: false,
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
  node.textContent = `${s} situations · ${p} problèmes · ${a} avis`;
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

  const s = findSituation(state.selectedSituationId);
  const p = findProblem(state.selectedProblemId);
  const a = findAvis(state.selectedAvisId);

  if (s) {
    events.push({
      ts: d.run_id || "",
      actor: "System",
      agent: inferAgent(s),
      type: "SITUATION",
      entity_type: "situation",
      entity_id: s.situation_id,
      message: `${s.title || "(sans titre)"}\npriority=${s.priority || ""}\nproblems=${(s.problem_ids || []).length}`,
    });
  }
  if (p) {
    events.push({
      ts: d.run_id || "",
      actor: "System",
      agent: inferAgent(p),
      type: "PROBLEM",
      entity_type: "problem",
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

/* ===== Right panel render ===== */
function renderDetails() {
  const host = el("detailsBody");
  const hostModal = el("detailsBodyModal");
  const d = state.data;

  if (!d) {
    setDetailsMeta("—");
    setDetailsTitle("Sélectionner un élément");
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un problème / un avis pour afficher les détails.</div>`;
    if (hostModal) hostModal.innerHTML = host.innerHTML;
    return;
  }

  const parents = buildParents(d);
  const s = findSituation(state.selectedSituationId);
  const p = findProblem(state.selectedProblemId);
  const a = findAvis(state.selectedAvisId);

  if (a) setDetailsMeta(`avis_id=${a.avis_id}`);
  else if (p) setDetailsMeta(`problem_id=${p.problem_id}`);
  else if (s) setDetailsMeta(`situation_id=${s.situation_id}`);
  else setDetailsMeta("—");

  // Title in head: show the *name* (most important)
  if (a) setDetailsTitle(a.topic ? `Avis — ${a.topic}` : `Avis — ${a.avis_id}`);
  else if (p) setDetailsTitle(p.topic ? `Problème — ${p.topic}` : `Problème — ${p.problem_id}`);
  else if (s) setDetailsTitle(s.title ? `Situation — ${s.title}` : `Situation — ${s.situation_id}`);
  else setDetailsTitle("Sélectionner un élément");

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
  let body = "";

  if (a) {
    const pid = parents.avisToProblem.get(a.avis_id);
    const sid = parents.avisToSituation.get(a.avis_id);
    const ps = findSituation(sid);
    const pp = findProblem(pid);

    title = "Avis";
    body = `
      ${ps ? `
      <div class="kv">
        <div class="k">Situation</div><div class="v">${escapeHtml(ps.title || "(sans titre)")}</div>
        <div class="k">situation_id</div><div class="v mono">${escapeHtml(ps.situation_id)}</div>
      </div>` : ""}

      ${pp ? `
      <div class="kv">
        <div class="k">Problème</div><div class="v">${escapeHtml(pp.topic || "Non classé")}</div>
        <div class="k">problem_id</div><div class="v mono">${escapeHtml(pp.problem_id)}</div>
      </div>` : ""}

      <div class="hr"></div>
      <div class="kv">
        <div class="k">Severity</div><div class="v"><span class="${badgePriority(a.severity)}">${escapeHtml(a.severity)}</span></div>
        <div class="k">Verdict</div><div class="v"><span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span></div>
        <div class="k">Thème</div><div class="v">${escapeHtml(a.topic || "")}</div>
        <div class="k">Agent</div><div class="v mono">${escapeHtml(inferAgent(a))}</div>
        <div class="k">Source</div><div class="v">${escapeHtml(a.source || "")}</div>
        <div class="k">avis_id</div><div class="v mono">${escapeHtml(a.avis_id || "")}</div>
      </div>

      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:6px;">Observation</div>
      <div style="white-space: pre-wrap; font-size: 13px;">${escapeHtml(a.message || "")}</div>
    `;
  } else if (p) {
    const sid = parents.problemToSituation.get(p.problem_id);
    const ps = findSituation(sid);

    title = "Problème";
    const avisIds = (p.avis_ids || []);
    const avis = avisIds.map(findAvis).filter(Boolean);

    body = `
      ${ps ? `
      <div class="kv">
        <div class="k">Situation</div><div class="v">${escapeHtml(ps.title || "(sans titre)")}</div>
        <div class="k">situation_id</div><div class="v mono">${escapeHtml(ps.situation_id)}</div>
      </div>` : ""}

      <div class="kv">
        <div class="k">Priority</div><div class="v"><span class="${badgePriority(p.priority)}">${escapeHtml(p.priority)}</span></div>
        <div class="k">Topic</div><div class="v">${escapeHtml(p.topic || "Non classé")}</div>
        <div class="k">Agent</div><div class="v mono">${escapeHtml(inferAgent(p))}</div>
        <div class="k">problem_id</div><div class="v mono">${escapeHtml(p.problem_id)}</div>
        <div class="k">Avis</div><div class="v mono">${escapeHtml(avis.length)}</div>
      </div>

      ${(p.summary || (p.stakes||[]).length || (p.recommendations||[]).length || p.why_grouped) ? `
      <div class=\"hr\"></div>
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

      ${avis.length ? `
      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Avis (ce problème uniquement)</div>
      <table class="avis-table">
        <tbody>
          ${avis.map((x) => `
            <tr class="click" data-detail-action="select-avis" data-avis="${escapeHtml(x.avis_id)}">
              <td style="width:90px;"><span class="${badgePriority(x.severity)}">${escapeHtml(x.severity)}</span></td>
              <td style="width:110px;"><span class="${badgeVerdict(x.verdict)}">${escapeHtml(x.verdict)}</span></td>
              <td>${escapeHtml(x.topic || "")}</td>
              <td style="width:140px;" class="mono-small">${escapeHtml(inferAgent(x))}</td>
              <td style="width:140px;" class="mono">${escapeHtml(x.avis_id)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>` : ""}
    `;
  } else if (s) {
    title = "Situation";
    body = `
      <div class="kv">
        <div class="k">Priority</div><div class="v"><span class="${badgePriority(s.priority)}">${escapeHtml(s.priority)}</span></div>
        <div class="k">Title</div><div class="v">${escapeHtml(s.title || "(sans titre)")}</div>
        <div class="k">Agent</div><div class="v mono">${escapeHtml(inferAgent(s))}</div>
        <div class="k">situation_id</div><div class="v mono">${escapeHtml(s.situation_id)}</div>
        <div class="k">Problems</div><div class="v mono">${escapeHtml((s.problem_ids || []).length)}</div>
      </div>
    
      ${(s.summary || (s.key_conflict_ids||[]).length) ? `
      <div class=\"hr\"></div>
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

  } else {
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un problème / un avis pour afficher les détails.</div>`;
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

  const thread = getThreadForSelection();
  const threadHtml = thread.length ? `
    <div class="hr"></div>
    <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Discussion</div>
    <div class="thread">
      ${thread.map((e) => `
        <div class="thread-item">
          <div class="thread-item__head">
            <div>
              <span class="mono">${escapeHtml(e.actor || "System")}</span>
              <span>·</span>
              <span class="mono">${escapeHtml(e.type || "")}</span>
              <span>·</span>
              <span class="mono">${escapeHtml(e.entity_type || "")}:${escapeHtml(e.entity_id || "")}</span>
              <span>·</span>
              <span class="mono">agent=${escapeHtml(e.agent || "system")}</span>
            </div>
            <div class="mono">${escapeHtml(e.ts || "")}</div>
          </div>
          <div class="thread-item__body">${escapeHtml(e.message || "")}</div>
        </div>
      `).join("")}
    </div>
  ` : "";

  // Human response below discussion (GitHub issue ergonomics)
  function commentBoxHtmlFor(suffix) {
    const id = (base) => `${base}${suffix}`;
  
    return decisionTarget ? `
      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Add a comment</div>
      <div class="comment-box">
        <div class="comment-tabs" role="tablist" aria-label="Comment tabs">
          <button class="comment-tab" id="${id("tabWrite")}" role="tab" aria-selected="true" data-tab="write">Write</button>
          <button class="comment-tab" id="${id("tabPreview")}" role="tab" aria-selected="false" data-tab="preview">Preview</button>
        </div>
        <div class="comment-editor" id="${id("commentEditor")}">
          <textarea id="${id("humanComment")}" class="textarea" placeholder="Réponse humaine (Markdown) — hypothèses, points à corriger, décision, etc."></textarea>
          <div class="actions-row" style="margin-top:10px; justify-content:space-between;">
            <div>${decisionRowHtml}</div>
            <button class="gh-btn" data-action="add-comment">Comment</button>
          </div>
        </div>
        <div class="comment-editor hidden" id="${id("commentPreviewWrap")}">
          <div class="comment-preview" id="${id("commentPreview")}"></div>
          <div class="actions-row" style="margin-top:10px; justify-content:space-between;">
            <div>${decisionRowHtml}</div>
            <button class="gh-btn" data-action="add-comment">Comment</button>
          </div>
        </div>
      </div>
    ` : "";
  }


  const contentHtml = `
    <div style="display:flex; align-items: baseline; justify-content: space-between; gap: 12px;">
      <div style="font-weight:700;">${escapeHtml(title)}</div>
      <div class="mono" style="color: var(--muted); font-size:12px;">run_id=${escapeHtml(d.run_id || "")}</div>
    </div>
    ${body}
    ${threadHtml}
    ${{COMMENT_BOX}}
  `;

  host.innerHTML = contentHtml.replace("{{COMMENT_BOX}}", commentBoxHtmlFor(""));
  if (hostModal) hostModal.innerHTML = contentHtml.replace("{{COMMENT_BOX}}", commentBoxHtmlFor("Modal"));

  // wire decision buttons
  // wire decision buttons + comment box (main + modal)
  const wireHost = (root) => {
    if (!root || !decisionTarget) return;
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

    // tabs + preview
    const tabWrite = root.querySelector("[id^='tabWrite']");
    const tabPreview = root.querySelector("[id^='tabPreview']");
    const editor = root.querySelector("[id^='commentEditor']");
    const previewWrap = root.querySelector("[id^='commentPreviewWrap']");
    const preview = root.querySelector("[id^='commentPreview']");
    const ta = root.querySelector("[id^='humanComment']");
    
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

  // wire avis selection inside right panel (problem view)
  host.querySelectorAll("[data-detail-action='select-avis']").forEach((row) => {
    row.onclick = () => selectAvis(row.getAttribute("data-avis"));
  });
}

/* ===== Middle render (lighter, persistent expand) ===== */
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

  setIssuesTotals(d);

  if (!d || !Array.isArray(d.situations) || !Array.isArray(d.problems) || !Array.isArray(d.avis)) {
    host.classList.add("emptyState");
    host.textContent = "Run an analysis to display situations.";
    if (counts) if (counts) counts.textContent = "—";
    const pageInfoEl = el("pageInfo"); if (pageInfoEl) pageInfoEl.textContent = "1 / 1";
    renderDetails();
    return;
  }

  const pbById = indexBy(d.problems, "problem_id");
  const avById = indexBy(d.avis, "avis_id");

  if (counts) counts.textContent = `${d.situations.length} situations · ${d.problems.length} problèmes · ${d.avis.length} avis`;

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
    const sitOpen = state.expandedSituations.has(s.situation_id);
    const sitChev = sitOpen ? "▾" : "▸";

    rows.push(`
      <div class="issue-row issue-row--sit click" data-action="toggle-sit" data-sit="${escapeHtml(s.situation_id)}">
        <div class="cell cell-theme lvl0">
          <span class="chev">${sitChev}</span>
          <span class="theme-text theme-text--sit">${escapeHtml(s.title || "(sans titre)")}</span>
        </div>
        <div class="cell cell-verdict"></div>
        <div class="cell cell-prio"><span class="${badgePriority(s.priority)}">${escapeHtml(s.priority || "")}</span></div>
        <div class="cell cell-agent"></div>
        <div class="cell cell-id mono">pb=${escapeHtml((s.problem_ids || []).length)}&nbsp;&nbsp;${escapeHtml(s.situation_id)}</div>
      </div>
    `);

    if (sitOpen) {
      const problems = (s.problem_ids || []).map((pid) => pbById.get(idFromAny(pid))).filter(Boolean);

      for (const pb of problems) {
        const pbOpen = state.expandedProblems.has(pb.problem_id);
        const pbChev = pbOpen ? "▾" : "▸";

        rows.push(`
          <div class="issue-row issue-row--pb click" data-action="toggle-pb" data-pb="${escapeHtml(pb.problem_id)}">
            <div class="cell cell-theme lvl1">
              <span class="chev">${pbChev}</span>
              <span class="theme-text theme-text--pb">${escapeHtml(pb.topic || "Non classé")}</span>
            </div>
            <div class="cell cell-verdict"></div>
            <div class="cell cell-prio"><span class="${badgePriority(pb.priority)}">${escapeHtml(pb.priority || "")}</span></div>
            <div class="cell cell-agent"></div>
            <div class="cell cell-id mono">avis=${escapeHtml((pb.avis_ids || []).length)}&nbsp;&nbsp;${escapeHtml(pb.problem_id)}</div>
          </div>
        `);

        if (pbOpen) {
          const avisAll = (pb.avis_ids || []).map((aid) => avById.get(idFromAny(aid))).filter(Boolean);
          const avisFiltered = applyAvisFilters(avisAll);
          const { pages, slice } = paginate(avisFiltered);
          const pageInfoEl = el("pageInfo"); if (pageInfoEl) pageInfoEl.textContent = `${state.page} / ${pages}`;

          for (const a of slice) {
            rows.push(`
              <div class="issue-row issue-row--avis click" data-action="select-avis" data-avis="${escapeHtml(a.avis_id)}">
                <div class="cell cell-theme lvl2">
                  <span class="chev chev--spacer"></span>
                  <span class="theme-text theme-text--avis">${escapeHtml(a.topic || "")}</span>
                </div>
                <div class="cell cell-verdict"><span class="${badgeVerdict(a.verdict)}">${escapeHtml(String(a.verdict || "").toUpperCase())}</span></div>
                <div class="cell cell-prio"><span class="${badgePriority(a.severity)}">${escapeHtml(a.severity || "")}</span></div>
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

      if (state.expandedSituations.has(sid)) state.expandedSituations.delete(sid);
      else state.expandedSituations.add(sid);

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

      if (state.expandedProblems.has(pid)) state.expandedProblems.delete(pid);
      else state.expandedProblems.add(pid);

      selectProblem(pid);
      renderMiddle();
    };
  });

  // wire: avis selection
  host.querySelectorAll("[data-action='select-avis']").forEach((row) => {
    row.onclick = (ev) => {
      ev.stopPropagation();
      const aid = row.getAttribute("data-avis");
      if (!aid) return;
      selectAvis(aid);
    };
  });

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
      renderMiddle();
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
      renderMiddle();
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

  el("verdictFilter").value = "ALL";
  el("searchBox").value = "";
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
resetUI();
