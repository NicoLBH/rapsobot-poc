// RAPSOBOT PoC UI — Drill-down Situations -> Problems -> Avis
// Expects API response shape:
// { status, run_id, situations[], problems[], avis[] }

const qs = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);

const state = {
  data: null,
  selectedSituationId: null,
  selectedProblemId: null,
  verdictFilter: "ALL",
  search: "",
  page: 1,
  pageSize: 20,
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function indexBy(arr, key) {
  const m = new Map();
  for (const x of (arr || [])) m.set(x[key], x);
  return m;
}

function setStatusPill(status) {
  const pill = el("statusPill");
  pill.textContent = status || "—";
  pill.classList.remove("ok", "todo");
  if (status === "OK") pill.classList.add("ok");
  else if (status) pill.classList.add("todo");
}

function badgeClass(p) {
  const v = String(p || "").toUpperCase();
  if (v === "P1") return "p1";
  if (v === "P2") return "p2";
  return "p3";
}

function resetSelection() {
  state.selectedSituationId = null;
  state.selectedProblemId = null;
  state.page = 1;
}

function getSelectedSituation() {
  return (state.data?.situations || []).find(s => s.situation_id === state.selectedSituationId) || null;
}

function getSelectedProblem() {
  return (state.data?.problems || []).find(p => p.problem_id === state.selectedProblemId) || null;
}

function computeAvisForProblem(pb) {
  if (!pb) return [];
  const avById = indexBy(state.data?.avis || [], "avis_id");
  return (pb.avis_ids || []).map(id => avById.get(id)).filter(Boolean);
}

function applyAvisFilters(list) {
  let out = list;

  if (state.verdictFilter !== "ALL") {
    out = out.filter(a => String(a.verdict || "").toUpperCase() === state.verdictFilter);
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    out = out.filter(a => {
      const blob = `${a.topic || ""} ${a.message || ""} ${a.source || ""}`.toLowerCase();
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

function renderSituations() {
  const d = state.data;
  const sitEl = el("situations");
  if (!d?.situations?.length) {
    sitEl.classList.add("emptyState");
    sitEl.textContent = "Aucune situation.";
    el("sitCount").textContent = "0";
    return;
  }

  el("sitCount").textContent = `${d.situations.length}`;

  sitEl.classList.remove("emptyState");
  sitEl.innerHTML = d.situations.map(s => {
    const active = s.situation_id === state.selectedSituationId ? "active" : "";
    return `
      <div class="item ${active}" data-sit="${escapeHtml(s.situation_id)}">
        <div class="itemTop">
          <div class="badge ${badgeClass(s.priority)}">${escapeHtml(s.priority)}</div>
          <div class="small mono">${escapeHtml(s.situation_id)}</div>
        </div>
        <div class="subline">${escapeHtml(s.title || "")}</div>
        <div class="subline">${(s.problem_ids || []).length} problèmes</div>
      </div>
    `;
  }).join("");

  sitEl.querySelectorAll("[data-sit]").forEach(x => {
    x.onclick = () => {
      state.selectedSituationId = x.getAttribute("data-sit");
      state.selectedProblemId = null;
      state.page = 1;
      renderAll();
    };
  });
}

function renderProblems() {
  const d = state.data;
  const pbEl = el("problems");
  const sit = getSelectedSituation();

  if (!sit) {
    pbEl.classList.add("emptyState");
    pbEl.textContent = "Sélectionne une situation.";
    el("pbCount").textContent = "—";
    return;
  }

  const pbById = indexBy(d.problems || [], "problem_id");
  const list = (sit.problem_ids || []).map(id => pbById.get(id)).filter(Boolean);

  el("pbCount").textContent = `${list.length}`;

  if (!list.length) {
    pbEl.classList.add("emptyState");
    pbEl.textContent = "Aucun problème dans cette situation.";
    return;
  }

  pbEl.classList.remove("emptyState");
  pbEl.innerHTML = list.map(pb => {
    const active = pb.problem_id === state.selectedProblemId ? "active" : "";
    return `
      <div class="item ${active}" data-pb="${escapeHtml(pb.problem_id)}">
        <div class="itemTop">
          <div class="badge ${badgeClass(pb.priority)}">${escapeHtml(pb.priority)}</div>
          <div class="small mono">${escapeHtml(pb.problem_id)}</div>
        </div>
        <div class="subline"><b>${escapeHtml(pb.topic || "Non classé")}</b></div>
        <div class="subline">${(pb.avis_ids || []).length} avis</div>
      </div>
    `;
  }).join("");

  pbEl.querySelectorAll("[data-pb]").forEach(x => {
    x.onclick = () => {
      state.selectedProblemId = x.getAttribute("data-pb");
      state.page = 1;
      renderAll();
    };
  });
}

function renderAvis() {
  const avEl = el("avis");
  const pb = getSelectedProblem();

  if (!pb) {
    avEl.classList.add("emptyState");
    avEl.textContent = "Sélectionne un problème.";
    el("avCount").textContent = "—";
    el("pageInfo").textContent = "1 / 1";
    return;
  }

  const all = computeAvisForProblem(pb);
  const filtered = applyAvisFilters(all);
  const { total, pages, slice } = paginate(filtered);

  el("avCount").textContent = `${total} (cap PoC: 200)`;
  el("pageInfo").textContent = `${state.page} / ${pages}`;

  if (!total) {
    avEl.classList.add("emptyState");
    avEl.textContent = "Aucun avis (après filtres).";
    return;
  }

  avEl.classList.remove("emptyState");
  avEl.innerHTML = `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Sev</th>
            <th>Verdict</th>
            <th>Thème</th>
            <th>Observation (incl. EC8)</th>
            <th>Source</th>
            <th class="mono">avis_id</th>
          </tr>
        </thead>
        <tbody>
          ${slice.map(a => `
            <tr>
              <td><span class="badge ${badgeClass(a.severity)}">${escapeHtml(a.severity)}</span></td>
              <td>${escapeHtml(a.verdict)}</td>
              <td>${escapeHtml(a.topic)}</td>
              <td>${escapeHtml(a.message || "")}</td>
              <td>${escapeHtml(a.source)}</td>
              <td class="mono">${escapeHtml(a.avis_id)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAll() {
  renderSituations();
  renderProblems();
  renderAvis();
}

function setRunMeta(run_id) {
  const meta = el("runMeta");
  if (!run_id) {
    meta.textContent = "";
    return;
  }
  meta.innerHTML = `Run: <span class="mono">${escapeHtml(run_id)}</span>`;
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

function readInputs() {
  const f = el("pdfFile")?.files?.[0] || null;
  return {
    communeCp: el("communeCp").value.trim(),
    importance: el("importance").value,
    soilClass: el("soilClass").value,
    liquefaction: el("liquefaction").value,
    referential: el("referential").value,
    webhookUrl: el("webhookUrl").value.trim(),
    pdfUrl: el("pdfUrl").value.trim(),
    pdfFile: f,
  };
}

function applyQueryParamsToForm() {
  el("communeCp").value = qs.get("communeCp") || qs.get("commune_cp") || "";
  el("importance").value = qs.get("importance") || "je ne sais pas";
  el("soilClass").value = qs.get("soilClass") || qs.get("soil_class") || "je ne sais pas";
  el("liquefaction").value = qs.get("liquefaction") || "je ne sais pas";
  el("referential").value = qs.get("referential") || qs.get("referential_name") || "Eurocode 8";
  el("webhookUrl").value = qs.get("webhookUrl") || "";
  el("pdfUrl").value = qs.get("pdf") || qs.get("pdfUrl") || "";
}

async function run() {
  showError("");
  setStatusPill("…");
  setRunMeta("");

  const inp = readInputs();

  if (!inp.webhookUrl) {
    showError("Webhook URL manquant. Renseigne-le dans le champ (ou via ?webhookUrl=...).");
    setStatusPill("—");
    return;
  }

  const user_reference = {
    commune_cp: inp.communeCp,
    importance: inp.importance,
    soilClass: inp.soilClass,
    liquefaction: inp.liquefaction,
    referential: inp.referential,
    pdfUrl: inp.pdfUrl || undefined
  };

  try {
    let res;

    // ✅ Si un fichier est sélectionné -> multipart/form-data (recommandé)
    if (inp.pdfFile) {
      const form = new FormData();
      form.append("user_reference", JSON.stringify(user_reference));
      form.append("pdf", inp.pdfFile, inp.pdfFile.name);

      res = await fetch(inp.webhookUrl, {
        method: "POST",
        body: form
      });
    } else {
      // Sinon -> JSON (comme avant)
      const payload = { user_reference: JSON.stringify(user_reference) };
      res = await fetch(inp.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

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
    state.selectedSituationId = final.situations[0]?.situation_id || null;
    state.selectedProblemId = null;
    state.page = 1;

    setStatusPill(final.status || "OK");
    setRunMeta(final.run_id || "");
    renderAll();

  } catch (e) {
    showError(e.message || String(e));
    setStatusPill("ERREUR");
    resetSelection();
    state.data = null;
    el("situations").textContent = "Erreur : voir ci-dessus.";
    el("problems").textContent = "—";
    el("avis").textContent = "—";
  }
}

function resetUI() {
  showError("");
  setStatusPill("—");
  setRunMeta("");
  state.data = null;
  resetSelection();

  // reset affichage
  el("situations").classList.add("emptyState");
  el("situations").textContent = "Lance une analyse pour afficher les situations.";
  el("problems").classList.add("emptyState");
  el("problems").textContent = "Sélectionne une situation.";
  el("avis").classList.add("emptyState");
  el("avis").textContent = "Sélectionne un problème.";
  el("sitCount").textContent = "—";
  el("pbCount").textContent = "—";
  el("avCount").textContent = "—";
  el("pageInfo").textContent = "1 / 1";

  // reset file input
  if (el("pdfFile")) el("pdfFile").value = "";
}

function wireEvents() {
  el("runBtn").onclick = run;
  el("resetBtn").onclick = () => { resetUI(); };

  el("verdictFilter").onchange = (ev) => {
    state.verdictFilter = ev.target.value;
    state.page = 1;
    renderAvis();
  };
  el("searchBox").oninput = (ev) => {
    state.search = ev.target.value;
    state.page = 1;
    renderAvis();
  };

  el("prevPage").onclick = () => {
    state.page = Math.max(1, state.page - 1);
    renderAvis();
  };
  el("nextPage").onclick = () => {
    state.page = state.page + 1;
    renderAvis();
  };
}

// Boot
applyQueryParamsToForm();
wireEvents();
resetUI();
