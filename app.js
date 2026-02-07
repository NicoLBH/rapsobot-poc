const $ = (id) => document.getElementById(id);

function setStatus(text, kind = "muted") {
  const el = $("status");
  el.className = "status " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "muted");
  el.textContent = text;
}

function log(line) {
  const el = $("log");
  el.textContent += (el.textContent ? "\n" : "") + line;
}

function getInputs() {
  return {
    commune_cp: $("communeCp").value.trim(),
    importance: $("importance").value,
    soil_class: $("soilClass").value,
    liquefaction: $("liquefaction").value,
    referential: $("referential").value
  };
}

function validateInputs(inputs, file) {
  const missing = Object.entries(inputs).filter(([_, v]) => !v);
  if (!inputs.commune_cp) missing.push(["commune_cp", ""]);
  if (missing.length) throw new Error("Champs manquants : " + missing.map(([k]) => k).join(", "));
  if (!file) throw new Error("PDF manquant.");
  if (file.type !== "application/pdf") throw new Error("Le fichier doit être un PDF.");
  if (file.size > 8 * 1024 * 1024) throw new Error("PDF trop volumineux (> 8 Mo) pour ce PoC.");
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(data) {
  const root = $("rendered");
  root.innerHTML = "";

  if (!data || !Array.isArray(data.situations)) {
    root.innerHTML = `<p class="muted">Aucune “situations[]” dans la réponse.</p>`;
    return;
  }

  for (const sit of data.situations) {
    const div = document.createElement("div");
    div.className = "situation";

    div.innerHTML = `
      <div>
        <span class="badge">${escapeHtml(sit.priority || "P?")}</span>
        <span class="badge">${escapeHtml(sit.status || "")}</span>
        <strong>${escapeHtml(sit.title || "Situation")}</strong>
      </div>
      <div class="kpi">
        <div><span class="muted">Impact :</span> ${escapeHtml(sit.impact || "-")}</div>
        <div><span class="muted">Action :</span> ${escapeHtml(sit.action || "-")}</div>
      </div>
    `;

    const problems = Array.isArray(sit.problems) ? sit.problems : [];
    for (const pb of problems) {
      const pbEl = document.createElement("div");
      pbEl.className = "problem";
      pbEl.innerHTML = `
        <div>
          <span class="badge">${escapeHtml(pb.code || "")}</span>
          <strong>${escapeHtml(pb.summary || "Problème")}</strong>
        </div>
      `;

      const reviews = Array.isArray(pb.reviews) ? pb.reviews : [];
      for (const rv of reviews) {
        const ev = Array.isArray(rv.evidence) ? rv.evidence : [];
        const evHtml = ev.map(e => `<li>p.${escapeHtml(e.page)} — “${escapeHtml(e.quote)}”</li>`).join("");

        const rvEl = document.createElement("div");
        rvEl.className = "review";
        rvEl.innerHTML = `
          <div class="meta">
            <span class="badge">Verdict: ${escapeHtml(rv.verdict || "")}</span>
            <span class="badge">${escapeHtml(rv.referential || "")}</span>
          </div>
          <div>${escapeHtml(rv.comment || "")}</div>
          ${ev.length ? `<ul class="muted">${evHtml}</ul>` : ""}
        `;
        pbEl.appendChild(rvEl);
      }

      // Interaction “humain” (Phase 1 : UI only)
      const feedback = document.createElement("div");
      feedback.style.marginTop = "8px";
      feedback.innerHTML = `
        <label>Commentaire (refus / relance)
          <input placeholder="Ex: Justifier la classe de sol (référence étude géotechnique)..." />
        </label>
        <div class="row two" style="margin-top:8px">
          <button type="button" data-action="refuse">Refuser</button>
          <button type="button" data-action="relaunch">Relancer</button>
        </div>
      `;
      feedback.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const input = feedback.querySelector("input").value.trim();
        log(`[FEEDBACK] action=${btn.dataset.action} problem_id=${pb.problem_id || "?"} comment="${input}"`);
        alert("Phase 1 : feedback loggé (pas encore envoyé au backend).");
      });

      pbEl.appendChild(feedback);
      div.appendChild(pbEl);
    }

    root.appendChild(div);
  }
}

async function loadMock() {
  const res = await fetch("samples/response.mock.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger samples/response.mock.json");
  return await res.json();
}

async function callWebhook(webhookUrl, inputs, file) {
  const fd = new FormData();
  fd.append("pdf", file, file.name);
  fd.append("user_reference", JSON.stringify(inputs));

  const res = await fetch(webhookUrl, {
    method: "POST",
    body: fd
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Webhook error ${res.status}: ${text.slice(0, 400)}`);

  // Essaye JSON, sinon affiche brut
  try { return JSON.parse(text); }
  catch { return { raw: text }; }
}

function showRaw(data) {
  $("raw").textContent = JSON.stringify(data, null, 2);
  $("rawBox").open = $("showRaw").checked;
}

$("showRaw").addEventListener("change", () => {
  $("rawBox").open = $("showRaw").checked;
});

$("pocForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("log").textContent = "";

  try {
    setStatus("Exécution…");
    const inputs = getInputs();
    const file = $("pdf").files?.[0];

    validateInputs(inputs, file);
    log("[INPUTS] " + JSON.stringify(inputs));
    log("[FILE] " + file.name + " (" + Math.round(file.size/1024) + " Ko)");

    let data;
    if ($("mockMode").checked) {
      log("[MODE] mock");
      data = await loadMock();
    } else {
      const webhookUrl = $("webhookUrl").value.trim();
      if (!webhookUrl) throw new Error("Webhook n8n manquant (désactive mock ou renseigne l’URL).");
      log("[MODE] webhook");
      data = await callWebhook(webhookUrl, inputs, file);
    }

    showRaw(data);
    render(data);
    setStatus("Terminé.", "ok");

  } catch (err) {
    setStatus("Erreur : " + (err?.message || err), "err");
    log("[ERROR] " + (err?.stack || err));
  }
});

function applyQueryParams() {
  function applyQueryParams() {
  const qs = new URLSearchParams(window.location.search);
  if (![...qs.keys()].length) return;

  const setIfPresent = (inputId, paramName) => {
    if (qs.has(paramName) && qs.get(paramName)) {
      const el = document.getElementById(inputId);
      if (el) el.value = qs.get(paramName);
    }
  };

  // Champs métier
  setIfPresent("communeCp", "communeCp");
  setIfPresent("importance", "importance");
  setIfPresent("soilClass", "soilClass");
  setIfPresent("liquefaction", "liquefaction");
  setIfPresent("referential", "referential");

  // Webhook
  setIfPresent("webhookUrl", "webhookUrl");

  // Mode mock : ?mock=1 (défaut) ou ?mock=0
  if (qs.has("mock")) {
    const mock = qs.get("mock");
    document.getElementById("mockMode").checked = (mock !== "0");
  }

  // Information PDF (impossible à précharger pour raisons de sécurité)
  if (qs.has("pdf") && qs.get("pdf")) {
    const pdfName = qs.get("pdf");
    log(`[INFO] PDF indiqué dans l’URL : "${pdfName}"`);
    log(`[INFO] Sélection manuelle du PDF obligatoire (contrainte navigateur).`);
  }

  setStatus(
    "Champs pré-remplis via URL. Sélectionne le PDF manuellement puis clique sur Lancer.",
    "ok"
  );
}

// Exécution au chargement
applyQueryParams();

