// app.js (RAPSOBOT PoC - Phase 1/2)

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
            <span class="badge">Verdict: ${escapeHtml(rv.verdic
