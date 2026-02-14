// RAPSOBOT PoC UI — lighter middle list + persistent expand + right details with parent context
// Expected from webhook:
// { status, run_id, situations[], problems[], avis[] }

const qs = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);

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
  if (s === "KO") return "badge badge--ko";
  if (s === "OK") return "badge badge--ok";
  return "badge badge--av";
}

function setSystemStatus(kind, label, meta) {
  el("sysLabel").textContent = label || "";
  el("sysMeta").textContent = meta || "—";
  const dot = el("sysDot");
  const colors = { idle: "var(--muted)", running: "var(--accent)", done: "var(--success)", error: "var(--danger)" };
  dot.style.background = colors[kind] || colors.idle;
}

function showError(msg) {
  const box = el("errorBox");
  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.classList.remove("hidden");
  box.textContent = msg;
}

function setRunMeta(run_id) {
  el("runMeta").textContent = run_id ? `run_id=${run_id}` : "";
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
  const commentBoxHtml = decisionTarget ? `
    <div class="hr"></div>
    <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Add a comment</div>
    <div class="comment-box">
      <div class="comment-tabs" role="tablist" aria-label="Comment tabs">
        <button class="comment-tab" id="tabWrite" role="tab" aria-selected="true" data-tab="write">Write</button>
        <button class="comment-tab" id="tabPreview" role="tab" aria-selected="false" data-tab="preview">Preview</button>
      </div>
      <div class="comment-editor" id="commentEditor">
        <textarea id="humanComment" class="textarea" placeholder="Réponse humaine (Markdown) — hypothèses, points à corriger, décision, etc."></textarea>
        <div class="actions-row" style="margin-top:10px; justify-content:space-between;">
          <div>${decisionRowHtml}</div>
          <button class="gh-btn" data-action="add-comment">Comment</button>
        </div>
      </div>
      <div class="comment-editor hidden" id="commentPreviewWrap">
        <div class="comment-preview" id="commentPreview"></div>
        <div class="actions-row" style="margin-top:10px; justify-content:space-between;">
          <div>${decisionRowHtml}</div>
          <button class="gh-btn" data-action="add-comment">Comment</button>
        </div>
      </div>
    </div>
  ` : "";

  const contentHtml = `
    <div style="display:flex; align-items: baseline; justify-content: space-between; gap: 12px;">
      <div style="font-weight:700;">${escapeHtml(title)}</div>
      <div class="mono" style="color: var(--muted); font-size:12px;">run_id=${escapeHtml(d.run_id || "")}</div>
    </div>
    ${body}
    ${threadHtml}
    ${commentBoxHtml}
  `;

  host.innerHTML = contentHtml;
  if (hostModal) hostModal.innerHTML = contentHtml;

  // wire decision buttons
  // wire decision buttons + comment box (main + modal)
  const wireHost = (root) => {
    if (!root || !decisionTarget) return;
    root.querySelectorAll("[data-action='decide']").forEach((btn) => {
      btn.onclick = () => {
        const decision = btn.getAttribute("data-decision");
        const note = (el("humanComment")?.value || "").trim();
        setDecision(decisionTarget.type, decisionTarget.id, decision, note);
        renderDetails();
      };
    });

    root.querySelectorAll("[data-action='add-comment']").forEach((addBtn) => {
      addBtn.onclick = () => {
        const msg = (el("humanComment")?.value || "").trim();
        if (!msg) return;
        addComment(decisionTarget.type, decisionTarget.id, msg);
        el("humanComment").value = "";
        renderDetails();
      };
    });

    // tabs + preview
    const tabWrite = root.querySelector("#tabWrite");
    const tabPreview = root.querySelector("#tabPreview");
    const editor = root.querySelector("#commentEditor");
    const previewWrap = root.querySelector("#commentPreviewWrap");
    const preview = root.querySelector("#commentPreview");
    const ta = root.querySelector("#humanComment");

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
function renderMiddle() {
  const host = el("issuesTable");
  const counts = el("counts");
  const d = state.data;

  setIssuesTotals(d);

  if (!d || !Array.isArray(d.situations) || !Array.isArray(d.problems) || !Array.isArray(d.avis)) {
    host.classList.add("emptyState");
    host.textContent = "Run an analysis to display situations.";
    counts.textContent = "—";
    el("pageInfo").textContent = "1 / 1";
    renderDetails();
    return;
  }

  const pbById = indexBy(d.problems, "problem_id");
  const avById = indexBy(d.avis, "avis_id");

  counts.textContent = `${d.situations.length} situations · ${d.problems.length} problèmes · ${d.avis.length} avis`;

  // Header avis once (before first situation)
  const avisHeaderHtml = `
    <div class="avis-header">
      <table>
        <thead>
          <tr>
            <th>Thème</th>
            <th style="width:110px">Verdict</th>
            <th style="width:140px">Agent</th>
            <th style="width:140px">avis_id</th>
          </tr>
        </thead>
      </table>
    </div>
  `;

  const html = [];
  html.push(`<div class="mid-wrap">`);
  html.push(avisHeaderHtml);

  for (const s of d.situations) {
    const sitOpen = state.expandedSituations.has(s.situation_id);
    const sitChev = sitOpen ? "▾" : "▸";

    html.push(`<div class="mid-block">`);

    // Situation line (no table, no header)
    html.push(`
      <div class="line click" data-action="toggle-sit" data-sit="${escapeHtml(s.situation_id)}">
        <div class="line-left">
          <div class="chev">${sitChev}</div>
          <div class="line-title"><b>${escapeHtml(s.title || "(sans titre)")} <span class="${badgePriority(s.priority)}">${escapeHtml(s.priority)}</span></b></div>
        </div>
        <div class="line-meta">
          <span class="mono">pb=${escapeHtml((s.problem_ids || []).length)}</span>
          <span class="mono">${escapeHtml(s.situation_id)}</span>
        </div>
      </div>
    `);

    // If open: show problems as lines
    if (sitOpen) {
      const problems = (s.problem_ids || []).map((pid) => pbById.get(pid)).filter(Boolean);

      for (const pb of problems) {
        const pbOpen = state.expandedProblems.has(pb.problem_id);
        const pbChev = pbOpen ? "▾" : "▸";

        html.push(`
          <div class="line click" style="padding-left:22px;" data-action="toggle-pb" data-pb="${escapeHtml(pb.problem_id)}">
            <div class="line-left">
              <div class="chev">${pbChev}</div>
              <div class="line-title">${escapeHtml(pb.topic || "Non classé")} <span class="${badgePriority(pb.priority)}">${escapeHtml(pb.priority)}</span></div>
            </div>
            <div class="line-meta">
              <span class="mono">avis=${escapeHtml((pb.avis_ids || []).length)}</span>
              <span class="mono">${escapeHtml(pb.problem_id)}</span>
            </div>
          </div>
        `);

        // If open: show avis table (no observation column; clickable)
        if (pbOpen) {
          const avisAll = (pb.avis_ids || []).map((aid) => avById.get(aid)).filter(Boolean);
          const avisFiltered = applyAvisFilters(avisAll);
          const { total, pages, slice } = paginate(avisFiltered);
          el("pageInfo").textContent = `${state.page} / ${pages}`;

          html.push(`
            <div style="padding-left:44px; padding-top:6px; padding-bottom:8px;">
              <table class="avis-table">
                <tbody>
                  ${slice.map((a) => `
                    <tr class="click" data-action="select-avis" data-avis="${escapeHtml(a.avis_id)}">
                      <td>${escapeHtml(a.topic || "")} <span class="${badgePriority(a.severity)}" style="margin-left:8px;">${escapeHtml(a.severity)}</span></td>
                      <td style="width:110px;"><span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span></td>
                      <td style="width:140px;" class="mono-small">${escapeHtml(inferAgent(a))}</td>
                      <td style="width:140px;">${escapeHtml(a.avis_id)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `);
        }
      }
    }

    html.push(`</div>`);
  }

  html.push(`</div>`);

  host.classList.remove("emptyState");
  host.innerHTML = html.join("");

  // wire: situation toggle + selection
  host.querySelectorAll("[data-action='toggle-sit']").forEach((node) => {
    node.onclick = () => {
      const sid = node.getAttribute("data-sit");
      if (!sid) return;

      if (state.expandedSituations.has(sid)) state.expandedSituations.delete(sid);
      else state.expandedSituations.add(sid);

      // selecting situation for right panel (requested behavior)
      selectSituation(sid);
      renderMiddle();
    };
  });

  // wire: problem toggle + selection (persist)
  host.querySelectorAll("[data-action='toggle-pb']").forEach((node) => {
    node.onclick = (ev) => {
      ev.stopPropagation();
      const pid = node.getAttribute("data-pb");
      if (!pid) return;

      if (state.expandedProblems.has(pid)) state.expandedProblems.delete(pid);
      else state.expandedProblems.add(pid);

      // selecting problem for right panel (also sets its parent situation)
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

/* ===== Run / Reset / Sidebar ===== */
async function run() {
  showError("");
  setRunMeta("");
  setSystemStatus("running", "En cours d’analyse", "POST /webhook");

  const inp = readInputs();
  if (!inp.webhookUrl) {
    showError("Webhook URL manquant. Renseigne-le dans le champ (ou via ?webhookUrl=...).");
    setSystemStatus("error", "Erreur", "webhookUrl manquant");
    return;
  }
  if (!inp.pdfFile) {
    showError("PDF manquant. Sélectionne un fichier PDF depuis l’ordinateur.");
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

  try {
    const form = new FormData();
    form.append("user_reference", JSON.stringify(user_reference));
    form.append("pdf", inp.pdfFile, inp.pdfFile.name);

    const res = await fetch(inp.webhookUrl, { method: "POST", body: form });
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`Réponse non-JSON du webhook. Début: ${text.slice(0, 200)}`); }

    const final = data.final_result || data;

    if (!final || typeof final !== "object") throw new Error("Réponse vide/invalide.");
    if (!Array.isArray(final.situations) || !Array.isArray(final.problems) || !Array.isArray(final.avis)) {
      throw new Error("Le webhook ne renvoie pas (situations, problems, avis). Vérifie le node Fusion (final_result).");
    }

    state.data = final;
    state.expandedSituations = new Set();
    state.expandedProblems = new Set();
    state.page = 1;

    // default: expand + select first situation only (but persistent afterwards)
    const firstSit = final.situations?.[0]?.situation_id || null;
    if (firstSit) state.expandedSituations.add(firstSit);
    state.selectedSituationId = firstSit;
    state.selectedProblemId = null;
    state.selectedAvisId = null;

    setRunMeta(final.run_id || "");
    setSystemStatus("done", "Terminé", final.status || "OK");
    renderMiddle();
  } catch (e) {
    state.data = null;
    state.expandedSituations = new Set();
    state.expandedProblems = new Set();
    state.selectedSituationId = null;
    state.selectedProblemId = null;
    state.selectedAvisId = null;
    state.page = 1;

    renderMiddle();
    showError(e?.message || String(e));
    setSystemStatus("error", "Erreur", "voir message");
  }
}

function resetUI() {
  showError("");
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
  el("resetBtn").onclick = resetUI;
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

  el("prevPage").onclick = () => {
    state.page = Math.max(1, state.page - 1);
    renderMiddle();
  };

  el("nextPage").onclick = () => {
    state.page = state.page + 1;
    renderMiddle();
  };
}

/* Boot */
applyQueryParamsToForm();
wireEvents();
resetUI();
