// RAPSOBOT PoC UI — GitHub-ish "Issues" + Drill-down + Right Details/Discussion
// Expected from webhook (Fusion final_result):
// { status, run_id, situations[], problems[], avis[] }

const qs = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);

const STORAGE_KEY = "rapsobot_ui_human_v1";

const state = {
  data: null,
  expandedSituationId: null,
  expandedProblemId: null,

  // for right panel
  selectedSituationId: null,
  selectedProblemId: null,
  selectedAvisId: null,

  verdictFilter: "ALL",
  search: "",
  page: 1,
  pageSize: 50,

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

function nowIso() {
  return new Date().toISOString();
}

function loadHumanStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { runs: {} };
  } catch {
    return { runs: {} };
  }
}

function saveHumanStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function runKey() {
  return state.data?.run_id || "no_run";
}

function ensureRunBucket(store) {
  const rk = runKey();
  store.runs[rk] ||= { decisions: {}, comments: [] };
  return store.runs[rk];
}

function entityKey(type, id) {
  return `${type}:${id}`;
}

function setDecision(type, id, decision, note) {
  const store = loadHumanStore();
  const bucket = ensureRunBucket(store);

  bucket.decisions[entityKey(type, id)] = {
    decision, // ACCEPT | REFUSE | COMMENTED | NEEDS_REVIEW
    note: note || "",
    ts: nowIso(),
  };

  // Also push a thread event
  bucket.comments.push({
    ts: nowIso(),
    actor: "Human",
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
    type: "COMMENT",
    entity_type: type,
    entity_id: id,
    message: message || "",
  });

  // Mark as commented (optional)
  bucket.decisions[entityKey(type, id)] ||= { decision: "COMMENTED", note: "", ts: nowIso() };

  saveHumanStore(store);
}

function getDecision(type, id) {
  const store = loadHumanStore();
  const bucket = store.runs?.[runKey()];
  return bucket?.decisions?.[entityKey(type, id)] || null;
}

function getThreadForSelection() {
  const d = state.data;
  if (!d) return [];

  const store = loadHumanStore();
  const bucket = store.runs?.[runKey()];
  const humanEvents = bucket?.comments || [];

  // Build system “events” for context (like GitHub issue body)
  const events = [];

  const s = findSituation(state.selectedSituationId);
  const p = findProblem(state.selectedProblemId);
  const a = findAvis(state.selectedAvisId);

  if (s) {
    events.push({
      ts: d.run_id ? d.run_id : "",
      actor: "System",
      type: "SITUATION",
      entity_type: "situation",
      entity_id: s.situation_id,
      message: `${s.title || "(sans titre)"}\nPriority: ${s.priority || ""}\nproblem_ids: ${(s.problem_ids || []).length}`,
    });
  }
  if (p) {
    events.push({
      ts: d.run_id ? d.run_id : "",
      actor: "System",
      type: "PROBLEM",
      entity_type: "problem",
      entity_id: p.problem_id,
      message: `${p.topic || "Non classé"}\nPriority: ${p.priority || ""}\navis_ids: ${(p.avis_ids || []).length}`,
    });
  }
  if (a) {
    events.push({
      ts: d.run_id ? d.run_id : "",
      actor: "System",
      type: "AVIS",
      entity_type: "avis",
      entity_id: a.avis_id,
      message: `${a.topic || ""}\nSeverity: ${a.severity || ""}\nVerdict: ${a.verdict || ""}\n\n${a.message || ""}`,
    });
  }

  // Include only human events relevant to selected scope:
  // - if avis selected: events matching avis
  // - else if problem selected: events matching problem or its avis
  // - else if situation selected: events matching situation or its problems/avis
  let allowed = new Set();

  if (a) {
    allowed.add(entityKey("avis", a.avis_id));
  } else if (p) {
    allowed.add(entityKey("problem", p.problem_id));
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

  // Sort with system first, then humans by ts
  return [...events, ...filteredHuman].sort((x, y) => (x.ts || "").localeCompare(y.ts || ""));
}

function indexBy(arr, key) {
  const m = new Map();
  for (const x of (arr || [])) m.set(x?.[key], x);
  return m;
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
  const dot = el("sysDot");
  const lbl = el("sysLabel");
  const m = el("sysMeta");

  lbl.textContent = label || "";
  m.textContent = meta || "—";

  const colors = {
    idle: "var(--muted)",
    running: "var(--accent)",
    done: "var(--success)",
    error: "var(--danger)",
  };
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
  const meta = el("runMeta");
  meta.textContent = run_id ? `run_id=${run_id}` : "";
}

function setIssuesTotals(d) {
  const node = el("issuesTotals");
  if (!d) {
    node.textContent = "—";
    return;
  }
  const s = Array.isArray(d.situations) ? d.situations.length : 0;
  const p = Array.isArray(d.problems) ? d.problems.length : 0;
  const a = Array.isArray(d.avis) ? d.avis.length : 0;
  node.textContent = `${s} situations · ${p} problèmes · ${a} avis`;
}

function setDetailsMeta(text) {
  const node = el("detailsMeta");
  node.textContent = text || "—";
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

function applyQueryParamsToForm() {
  el("communeCp").value = qs.get("communeCp") || qs.get("commune_cp") || "";
  el("importance").value = qs.get("importance") || "je ne sais pas";
  el("soilClass").value = qs.get("soilClass") || qs.get("soil_class") || "je ne sais pas";
  el("liquefaction").value = qs.get("liquefaction") || "je ne sais pas";
  el("referential").value = qs.get("referential") || qs.get("referential_name") || "Eurocode 8";
  el("webhookUrl").value = qs.get("webhookUrl") || "";
}

function applyAvisFilters(list) {
  let out = list;

  if (state.verdictFilter !== "ALL") {
    out = out.filter((a) => String(a?.verdict || "").toUpperCase() === state.verdictFilter);
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    out = out.filter((a) => {
      const blob = `${a?.topic || ""} ${a?.message || ""} ${a?.source || ""}`.toLowerCase();
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

function selectSituation(id) {
  state.selectedSituationId = id || null;
  state.selectedProblemId = null;
  state.selectedAvisId = null;
  renderDetails();
}

function selectProblem(id) {
  state.selectedProblemId = id || null;
  state.selectedAvisId = null;
  renderDetails();
}

function selectAvis(id) {
  state.selectedAvisId = id || null;
  renderDetails();
}

function renderDetails() {
  const host = el("detailsBody");
  const d = state.data;

  if (!d) {
    setDetailsMeta("—");
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un problème / un avis pour afficher les détails.</div>`;
    return;
  }

  const s = findSituation(state.selectedSituationId);
  const p = findProblem(state.selectedProblemId);
  const a = findAvis(state.selectedAvisId);

  // meta line
  if (a) setDetailsMeta(`avis_id=${a.avis_id}`);
  else if (p) setDetailsMeta(`problem_id=${p.problem_id}`);
  else if (s) setDetailsMeta(`situation_id=${s.situation_id}`);
  else setDetailsMeta("—");

  // decision state (if any) for the most specific selection
  let decision = null;
  let decisionTarget = null;
  if (a) { decision = getDecision("avis", a.avis_id); decisionTarget = { type: "avis", id: a.avis_id }; }
  else if (p) { decision = getDecision("problem", p.problem_id); decisionTarget = { type: "problem", id: p.problem_id }; }
  else if (s) { decision = getDecision("situation", s.situation_id); decisionTarget = { type: "situation", id: s.situation_id }; }

  const decisionBadge = decision?.decision
    ? `<span class="badge ${decision.decision === "ACCEPT" ? "badge--ok" : (decision.decision === "REFUSE" ? "badge--ko" : "badge--av")}">${escapeHtml(decision.decision)}</span>`
    : `<span class="badge">NO_DECISION</span>`;

  // lists for navigation in details
  const pbById = indexBy(d.problems, "problem_id");
  const avById = indexBy(d.avis, "avis_id");

  let problemsListHtml = "";
  if (s) {
    const probs = (s.problem_ids || []).map((pid) => pbById.get(pid)).filter(Boolean);
    problemsListHtml = probs.length ? `
      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Problèmes</div>
      <table class="tickets">
        <thead>
          <tr>
            <th style="width:90px">Prio</th>
            <th>Topic</th>
            <th style="width:120px">Avis</th>
            <th style="width:120px">ID</th>
          </tr>
        </thead>
        <tbody>
          ${probs.map((pb) => `
            <tr class="clickable-row" data-detail-action="select-problem" data-problem="${escapeHtml(pb.problem_id)}">
              <td><span class="${badgePriority(pb.priority)}">${escapeHtml(pb.priority)}</span></td>
              <td>${escapeHtml(pb.topic || "Non classé")}</td>
              <td class="mono">${escapeHtml((pb.avis_ids || []).length)}</td>
              <td class="mono">${escapeHtml(pb.problem_id)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : "";
  }

  let avisListHtml = "";
  if (p) {
    const avis = (p.avis_ids || []).map((aid) => avById.get(aid)).filter(Boolean);
    avisListHtml = avis.length ? `
      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:8px;">Avis</div>
      <table class="tickets">
        <thead>
          <tr>
            <th style="width:90px">Sev</th>
            <th style="width:110px">Verdict</th>
            <th>Thème</th>
            <th style="width:140px">Source</th>
            <th style="width:140px">avis_id</th>
          </tr>
        </thead>
        <tbody>
          ${avis.map((x) => `
            <tr class="clickable-row" data-detail-action="select-avis" data-avis="${escapeHtml(x.avis_id)}">
              <td><span class="${badgePriority(x.severity)}">${escapeHtml(x.severity)}</span></td>
              <td><span class="${badgeVerdict(x.verdict)}">${escapeHtml(x.verdict)}</span></td>
              <td>${escapeHtml(x.topic || "")}</td>
              <td>${escapeHtml(x.source || "")}</td>
              <td class="mono">${escapeHtml(x.avis_id || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : "";
  }

  // main detail block
  let title = "Sélection";
  let kv = "";

  if (s && !p && !a) {
    title = `Situation`;
    kv = `
      <div class="kv">
        <div class="k">Priority</div><div class="v"><span class="${badgePriority(s.priority)}">${escapeHtml(s.priority)}</span></div>
        <div class="k">Title</div><div class="v">${escapeHtml(s.title || "(sans titre)")}</div>
        <div class="k">situation_id</div><div class="v mono">${escapeHtml(s.situation_id)}</div>
        <div class="k">Problems</div><div class="v mono">${escapeHtml((s.problem_ids || []).length)}</div>
      </div>
    `;
  } else if (p && !a) {
    title = `Problème`;
    kv = `
      <div class="kv">
        <div class="k">Priority</div><div class="v"><span class="${badgePriority(p.priority)}">${escapeHtml(p.priority)}</span></div>
        <div class="k">Topic</div><div class="v">${escapeHtml(p.topic || "Non classé")}</div>
        <div class="k">problem_id</div><div class="v mono">${escapeHtml(p.problem_id)}</div>
        <div class="k">Avis</div><div class="v mono">${escapeHtml((p.avis_ids || []).length)}</div>
      </div>
    `;
  } else if (a) {
    title = `Avis`;
    kv = `
      <div class="kv">
        <div class="k">Severity</div><div class="v"><span class="${badgePriority(a.severity)}">${escapeHtml(a.severity)}</span></div>
        <div class="k">Verdict</div><div class="v"><span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span></div>
        <div class="k">Thème</div><div class="v">${escapeHtml(a.topic || "")}</div>
        <div class="k">Source</div><div class="v">${escapeHtml(a.source || "")}</div>
        <div class="k">avis_id</div><div class="v mono">${escapeHtml(a.avis_id || "")}</div>
      </div>
      <div class="hr"></div>
      <div class="mono" style="color: var(--muted); font-size:12px; margin-bottom:6px;">Observation</div>
      <div style="white-space: pre-wrap; font-size: 13px;">${escapeHtml(a.message || "")}</div>
    `;
  } else {
    host.innerHTML = `<div class="emptyState">Sélectionne une situation / un problème / un avis pour afficher les détails.</div>`;
    return;
  }

  // actions + thread
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
            </div>
            <div class="mono">${escapeHtml(e.ts || "")}</div>
          </div>
          <div class="thread-item__body">${escapeHtml(e.message || "")}</div>
        </div>
      `).join("")}
    </div>
  ` : "";

  const actionsHtml = decisionTarget ? `
    <div class="actions-row" style="margin-top:8px;">
      ${decisionBadge}
      <button class="gh-btn gh-btn--success" data-action="decide" data-decision="ACCEPT">Accepter</button>
      <button class="gh-btn gh-btn--danger" data-action="decide" data-decision="REFUSE">Refuser</button>
      <button class="gh-btn gh-btn--neutral" data-action="decide" data-decision="NEEDS_REVIEW">À vérifier</button>
    </div>

    <div style="margin-top:10px;">
      <textarea id="humanComment" class="textarea" placeholder="Commentaire humain (raison, hypothèses, points à corriger…)"></textarea>
      <div class="actions-row" style="margin-top:8px;">
        <button class="gh-btn" data-action="add-comment">Ajouter un commentaire</button>
      </div>
    </div>
  ` : "";

  host.innerHTML = `
    <div style="display:flex; align-items: baseline; justify-content: space-between; gap: 12px;">
      <div style="font-weight:700;">${escapeHtml(title)}</div>
      <div class="mono" style="color: var(--muted); font-size:12px;">run_id=${escapeHtml(d.run_id || "")}</div>
    </div>
    ${kv}
    ${actionsHtml}
    ${problemsListHtml}
    ${avisListHtml}
    ${threadHtml}
  `;

  // wire actions
  if (decisionTarget) {
    host.querySelectorAll("[data-action='decide']").forEach((btn) => {
      btn.onclick = () => {
        const decision = btn.getAttribute("data-decision");
        const note = (el("humanComment")?.value || "").trim();
        setDecision(decisionTarget.type, decisionTarget.id, decision, note);
        renderDetails();
      };
    });

    const addBtn = host.querySelector("[data-action='add-comment']");
    if (addBtn) {
      addBtn.onclick = () => {
        const msg = (el("humanComment")?.value || "").trim();
        if (!msg) return;
        addComment(decisionTarget.type, decisionTarget.id, msg);
        el("humanComment").value = "";
        renderDetails();
      };
    }
  }

  // wire detail navigation (inside right panel)
  host.querySelectorAll("[data-detail-action='select-problem']").forEach((row) => {
    row.onclick = () => {
      const pid = row.getAttribute("data-problem");
      state.selectedProblemId = pid;
      state.selectedAvisId = null;
      renderDetails();
    };
  });
  host.querySelectorAll("[data-detail-action='select-avis']").forEach((row) => {
    row.onclick = () => {
      const aid = row.getAttribute("data-avis");
      state.selectedAvisId = aid;
      renderDetails();
    };
  });
}

function render() {
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

  const nbSit = d.situations.length;
  const nbPb = d.problems.length;
  const nbAv = d.avis.length;
  counts.textContent = `${nbSit} situations · ${nbPb} problèmes · ${nbAv} avis`;

  // pagination only for open problem tickets
  let expandedTickets = [];
  let expandedTicketsFiltered = [];
  let pages = 1;

  if (state.expandedProblemId) {
    const pb = pbById.get(state.expandedProblemId);
    if (pb) {
      expandedTickets = (pb.avis_ids || []).map((id) => avById.get(id)).filter(Boolean);
      expandedTicketsFiltered = applyAvisFilters(expandedTickets);
      pages = Math.max(1, Math.ceil(expandedTicketsFiltered.length / state.pageSize));
      state.page = Math.min(state.page, pages);
    }
  } else {
    state.page = 1;
  }

  el("pageInfo").textContent = `${state.page} / ${pages}`;

  const rows = [];
  rows.push(`
    <table class="issues-table">
      <thead>
        <tr>
          <th style="width:110px">Priority</th>
          <th>Situation / Problème / Ticket</th>
          <th style="width:140px">Count</th>
          <th style="width:120px">ID</th>
        </tr>
      </thead>
      <tbody>
  `);

  for (const s of d.situations) {
    const isOpen = s.situation_id === state.expandedSituationId;
    const caret = isOpen ? "▾" : "▸";

    rows.push(`
      <tr>
        <td><span class="${badgePriority(s.priority)}">${escapeHtml(s.priority)}</span></td>
        <td>
          <span class="row-btn" data-action="toggle-sit" data-sit="${escapeHtml(s.situation_id)}">
            <span class="row-btn__caret">${caret}</span>
            <span><b>${escapeHtml(s.title || "(sans titre)")}</b></span>
          </span>
        </td>
        <td class="mono">${escapeHtml((s.problem_ids || []).length)} problems</td>
        <td class="mono">${escapeHtml(s.situation_id)}</td>
      </tr>
    `);

    if (isOpen) {
      const problems = (s.problem_ids || []).map((id) => pbById.get(id)).filter(Boolean);

      rows.push(`
        <tr class="subrow">
          <td class="subcell" colspan="4">
            <div class="subpanel">
              <div class="subpanel__title">Problèmes (clique pour afficher les tickets)</div>
              <table class="tickets">
                <thead>
                  <tr>
                    <th style="width:90px">Prio</th>
                    <th>Problème</th>
                    <th style="width:120px">Tickets</th>
                    <th style="width:120px">ID</th>
                  </tr>
                </thead>
                <tbody>
      `);

      for (const pb of problems) {
        const pbOpen = pb.problem_id === state.expandedProblemId;
        const pbCaret = pbOpen ? "▾" : "▸";

        rows.push(`
          <tr>
            <td><span class="${badgePriority(pb.priority)}">${escapeHtml(pb.priority)}</span></td>
            <td>
              <span class="row-btn" data-action="toggle-pb" data-pb="${escapeHtml(pb.problem_id)}">
                <span class="row-btn__caret">${pbCaret}</span>
                <span><b>${escapeHtml(pb.topic || "Non classé")}</b></span>
              </span>
            </td>
            <td class="mono">${escapeHtml((pb.avis_ids || []).length)}</td>
            <td class="mono">${escapeHtml(pb.problem_id)}</td>
          </tr>
        `);

        if (pbOpen) {
          const filtered = expandedTicketsFiltered;
          const { total, slice } = paginate(filtered);

          // IMPORTANT CHANGE requested:
          // In avis list (middle), REMOVE "Observation" column (the long message).
          rows.push(`
            <tr class="subrow">
              <td class="subcell" colspan="4">
                <div class="subpanel">
                  <div class="subpanel__title">Tickets (avis) — ${escapeHtml(total)} après filtres (clique un avis pour details)</div>
                  <table class="tickets">
                    <thead>
                      <tr>
                        <th style="width:90px">Sev</th>
                        <th style="width:110px">Verdict</th>
                        <th>Thème</th>
                        <th style="width:140px">Source</th>
                        <th style="width:140px">avis_id</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${slice.map((a) => `
                        <tr class="clickable-row" data-action="select-avis" data-avis="${escapeHtml(a.avis_id || "")}">
                          <td><span class="${badgePriority(a.severity)}">${escapeHtml(a.severity)}</span></td>
                          <td><span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span></td>
                          <td>${escapeHtml(a.topic || "")}</td>
                          <td>${escapeHtml(a.source || "")}</td>
                          <td class="mono">${escapeHtml(a.avis_id || "")}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          `);
        }
      }

      rows.push(`
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      `);
    }
  }

  rows.push(`</tbody></table>`);

  host.classList.remove("emptyState");
  host.innerHTML = rows.join("");

  // wire toggle-sit (also selects situation for right panel)
  host.querySelectorAll("[data-action='toggle-sit']").forEach((node) => {
    node.onclick = () => {
      const sitId = node.getAttribute("data-sit");
      if (!sitId) return;

      const willOpen = state.expandedSituationId !== sitId;
      state.expandedSituationId = willOpen ? sitId : null;
      if (!willOpen) state.expandedProblemId = null;
      state.page = 1;

      // Right panel selection
      if (willOpen) {
        state.selectedSituationId = sitId;
        state.selectedProblemId = null;
        state.selectedAvisId = null;
      } else {
        state.selectedSituationId = null;
        state.selectedProblemId = null;
        state.selectedAvisId = null;
      }

      render();
      renderDetails();
    };
  });

  // wire toggle-pb (also selects problem)
  host.querySelectorAll("[data-action='toggle-pb']").forEach((node) => {
    node.onclick = () => {
      const pbId = node.getAttribute("data-pb");
      if (!pbId) return;

      const willOpen = state.expandedProblemId !== pbId;
      state.expandedProblemId = willOpen ? pbId : null;
      state.page = 1;

      // Right panel selection
      if (willOpen) {
        state.selectedProblemId = pbId;
        state.selectedAvisId = null;
      } else {
        state.selectedProblemId = null;
        state.selectedAvisId = null;
      }

      render();
      renderDetails();
    };
  });

  // wire select-avis (only right panel selection)
  host.querySelectorAll("[data-action='select-avis']").forEach((row) => {
    row.onclick = () => {
      const avisId = row.getAttribute("data-avis");
      if (!avisId) return;
      state.selectedAvisId = avisId;
      renderDetails();
    };
  });

  // Keep details in sync
  renderDetails();
}

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

    // Defaults: open first situation; select it for right panel
    state.expandedSituationId = final.situations?.[0]?.situation_id || null;
    state.expandedProblemId = null;
    state.page = 1;

    state.selectedSituationId = state.expandedSituationId;
    state.selectedProblemId = null;
    state.selectedAvisId = null;

    setRunMeta(final.run_id || "");
    setSystemStatus("done", "Terminé", final.status || "OK");
    render();
  } catch (e) {
    state.data = null;
    state.expandedSituationId = null;
    state.expandedProblemId = null;
    state.selectedSituationId = null;
    state.selectedProblemId = null;
    state.selectedAvisId = null;
    state.page = 1;

    render();
    showError(e?.message || String(e));
    setSystemStatus("error", "Erreur", "voir message");
  }
}

function resetUI() {
  showError("");
  setRunMeta("");
  setSystemStatus("idle", "Idle", "—");

  state.data = null;
  state.expandedSituationId = null;
  state.expandedProblemId = null;

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
  render();
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
}

function wireEvents() {
  el("runBtn").onclick = run;
  el("resetBtn").onclick = resetUI;
  el("sidebarToggle").onclick = toggleSidebar;

  el("verdictFilter").onchange = (ev) => {
    state.verdictFilter = ev.target.value;
    state.page = 1;
    render();
  };
  el("searchBox").oninput = (ev) => {
    state.search = ev.target.value;
    state.page = 1;
    render();
  };

  el("prevPage").onclick = () => {
    state.page = Math.max(1, state.page - 1);
    render();
  };
  el("nextPage").onclick = () => {
    state.page = state.page + 1;
    render();
  };
}

// Boot
applyQueryParamsToForm();
wireEvents();
resetUI();
