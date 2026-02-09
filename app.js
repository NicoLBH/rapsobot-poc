// RAPSOBOT PoC UI — GitHub-ish "Issues" + Drill-down
// Expected from webhook (Fusion final_result):
// { status, run_id, situations[], problems[], avis[] }

const qs = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);

const state = {
  data: null,
  expandedSituationId: null,
  expandedProblemId: null,
  verdictFilter: "ALL",
  search: "",
  page: 1,
  pageSize: 50,
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
          const all = expandedTickets;
          const filtered = expandedTicketsFiltered;
          const { total, slice } = paginate(filtered);

          rows.push(`
            <tr class="subrow">
              <td class="subcell" colspan="4">
                <div class="subpanel">
                  <div class="subpanel__title">Tickets (avis) — ${escapeHtml(total)} après filtres</div>
                  <table class="tickets">
                    <thead>
                      <tr>
                        <th style="width:90px">Sev</th>
                        <th style="width:110px">Verdict</th>
                        <th style="width:220px">Thème</th>
                        <th>Observation (EC8 obligatoire)</th>
                        <th style="width:140px">Source</th>
                        <th style="width:140px">avis_id</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${slice.map((a) => `
                        <tr>
                          <td><span class="${badgePriority(a.severity)}">${escapeHtml(a.severity)}</span></td>
                          <td><span class="${badgeVerdict(a.verdict)}">${escapeHtml(a.verdict)}</span></td>
                          <td>${escapeHtml(a.topic || "")}</td>
                          <td class="ticket-msg">${escapeHtml(a.message || "")}</td>
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

  host.querySelectorAll("[data-action='toggle-sit']").forEach((node) => {
    node.onclick = () => {
      const sitId = node.getAttribute("data-sit");
      if (!sitId) return;

      const willOpen = state.expandedSituationId !== sitId;
      state.expandedSituationId = willOpen ? sitId : null;
      if (!willOpen) state.expandedProblemId = null;
      state.page = 1;
      render();
    };
  });

  host.querySelectorAll("[data-action='toggle-pb']").forEach((node) => {
    node.onclick = () => {
      const pbId = node.getAttribute("data-pb");
      if (!pbId) return;

      const willOpen = state.expandedProblemId !== pbId;
      state.expandedProblemId = willOpen ? pbId : null;
      state.page = 1;
      render();
    };
  });
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
    state.expandedSituationId = final.situations?.[0]?.situation_id || null;
    state.expandedProblemId = null;
    state.page = 1;

    setRunMeta(final.run_id || "");
    setSystemStatus("done", "Terminé", final.status || "OK");
    render();
  } catch (e) {
    state.data = null;
    state.expandedSituationId = null;
    state.expandedProblemId = null;
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
  state.page = 1;
  state.search = "";
  state.verdictFilter = "ALL";

  el("verdictFilter").value = "ALL";
  el("searchBox").value = "";
  if (el("pdfFile")) el("pdfFile").value = "";
  setIssuesTotals(null);
  render();
}

function wireEvents() {
  el("runBtn").onclick = run;
  el("resetBtn").onclick = resetUI;

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
