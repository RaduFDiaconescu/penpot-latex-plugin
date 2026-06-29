const $ = (id) => document.getElementById(id);
const input = $("input"), display = $("display"), sizeEl = $("size");
const colorEl = $("color"), preview = $("preview"), insertBtn = $("insert");
const status = $("status"), banner = $("banner"), newBtn = $("new");
const libraryEl = $("library"), libraryToggle = $("libraryToggle"), panel = $("libraryPanel");

const DEFAULT_SIZE = 36;
let currentSvg = null, currentW = 0, currentH = 0;
let editing = false, suppressRender = false;
let docItems = [], recentItems = [];

async function ready() {
  while (!(window.MathJax && MathJax.startup && MathJax.startup.promise))
    await new Promise((r) => setTimeout(r, 50));
  await MathJax.startup.promise;
}

function buildSvg(latex) {
  const fontSize = Math.max(8, Number(sizeEl.value) || DEFAULT_SIZE);
  const color = colorEl.value || "#000000";
  const node = MathJax.tex2svg(latex, { display: display.checked });
  const svg = node.querySelector("svg");
  if (!svg) throw new Error("No SVG produced");
  const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const w = (vb[2] / 1000) * fontSize;
  const h = (vb[3] / 1000) * fontSize;
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.removeAttribute("style");
  const out = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color);
  return { svg: out, w, h };
}

async function thumbSvg(item) {
  await ready();
  const node = MathJax.tex2svg(item.latex, { display: item.display !== false });
  const svg = node.querySelector("svg");
  if (!svg) return "";
  svg.removeAttribute("style"); svg.removeAttribute("width"); svg.removeAttribute("height");
  return new XMLSerializer().serializeToString(svg).replace(/currentColor/g, item.color || "#000000");
}

async function render() {
  if (suppressRender) return;
  const latex = input.value.trim();
  status.textContent = "";
  if (!latex) {
    preview.innerHTML = '<span class="hint">Preview appears here</span>';
    insertBtn.disabled = true; currentSvg = null; return;
  }
  try {
    await ready();
    const built = buildSvg(latex);
    currentSvg = built.svg; currentW = built.w; currentH = built.h;
    preview.innerHTML = built.svg;
    insertBtn.disabled = false;
  } catch (e) {
    preview.innerHTML = '<span class="hint err">Could not render</span>';
    status.textContent = String(e.message || e);
    insertBtn.disabled = true; currentSvg = null;
  }
}

function setEditing(on) {
  editing = on;
  banner.style.display = on ? "flex" : "none";
  insertBtn.textContent = on ? "Update equation" : "Insert into Penpot";
}

function loadValues(item) {
  suppressRender = true;
  input.value = item.latex || "";
  sizeEl.value = item.size || String(DEFAULT_SIZE);
  colorEl.value = item.color || "#000000";
  display.checked = item.display !== false;
  suppressRender = false;
}

function label(latex) {
  const s = latex.replace(/\s+/g, " ").trim();
  return s.length > 36 ? s.slice(0, 35) + "…" : s;
}

function openPanel() { panel.hidden = false; libraryToggle.setAttribute("aria-expanded", "true"); }
function closePanel() { panel.hidden = true; libraryToggle.setAttribute("aria-expanded", "false"); }

function groupHeader(text, withClear) {
  const h = document.createElement("div");
  h.className = "lib-group";
  const span = document.createElement("span"); span.textContent = text; h.appendChild(span);
  if (withClear) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lib-clear"; b.textContent = "Clear all";
    h.appendChild(b);
  }
  return h;
}

async function rowEl(item, kind, idx, deletable) {
  const row = document.createElement("div");
  row.className = "lib-row"; row.dataset.kind = kind; row.dataset.idx = String(idx);
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  try { thumb.innerHTML = await thumbSvg(item); } catch (e) { thumb.textContent = "—"; }
  row.appendChild(thumb);
  const lab = document.createElement("span");
  lab.className = "lib-label"; lab.textContent = label(item.latex);
  row.appendChild(lab);
  if (deletable) {
    const del = document.createElement("button");
    del.type = "button"; del.className = "lib-del"; del.title = "Remove from recents";
    del.textContent = "×";
    row.appendChild(del);
  }
  return row;
}

async function rebuildDropdown() {
  panel.innerHTML = "";
  if (!docItems.length && !recentItems.length) {
    const empty = document.createElement("div");
    empty.className = "lib-empty"; empty.textContent = "No saved equations yet.";
    panel.appendChild(empty); return;
  }
  if (docItems.length) {
    panel.appendChild(groupHeader("In this document", false));
    for (let i = 0; i < docItems.length; i++)
      panel.appendChild(await rowEl(docItems[i], "doc", i, false));
  }
  if (recentItems.length) {
    panel.appendChild(groupHeader("Recent", true));
    for (let i = 0; i < recentItems.length; i++)
      panel.appendChild(await rowEl(recentItems[i], "recent", i, true));
  }
}

libraryToggle.addEventListener("click", () => { panel.hidden ? openPanel() : closePanel(); });
document.addEventListener("click", (e) => { if (!libraryEl.contains(e.target)) closePanel(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

panel.addEventListener("click", (e) => {
  if (e.target.closest(".lib-clear")) { parent.postMessage({ type: "clear-recents" }, "*"); return; }
  const row = e.target.closest(".lib-row");
  if (!row) return;
  const kind = row.dataset.kind, idx = Number(row.dataset.idx);
  if (e.target.closest(".lib-del")) {
    e.stopPropagation();
    const it = recentItems[idx];
    if (it) parent.postMessage({ type: "delete-recent", latex: it.latex }, "*");
    return;
  }
  if (kind === "doc") {
    const it = docItems[idx];
    if (it) parent.postMessage({ type: "select-shape", id: it.id }, "*");
  } else {
    const it = recentItems[idx];
    if (it) { loadValues(it); setEditing(false); render(); status.textContent = "Loaded from recent"; }
  }
  closePanel();
});

let t;
input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(render, 250); });
[display, sizeEl, colorEl].forEach((el) => el.addEventListener("input", render));

insertBtn.addEventListener("click", () => {
  if (!currentSvg) return;
  parent.postMessage({
    type: "insert-svg", svg: currentSvg, w: currentW, h: currentH,
    latex: input.value.trim(), size: sizeEl.value, color: colorEl.value,
    display: display.checked, replace: editing
  }, "*");
  status.textContent = editing ? "Updating…" : "Inserting…";
});

newBtn.addEventListener("click", () => { setEditing(false); input.value = ""; render(); input.focus(); });

window.addEventListener("message", async (e) => {
  const msg = e.data; if (!msg) return;
  if (msg.type === "equation-list") {
    docItems = msg.docItems || []; recentItems = msg.recentItems || [];
    await rebuildDropdown();
  }
  if (msg.type === "load-equation") {
    loadValues(msg); setEditing(true); await render();
    status.textContent = "Editing selected equation";
  }
  if (msg.type === "clear-editing") setEditing(false);
  if (msg.type === "inserted") {
    setEditing(true);
    status.textContent = msg.replaced ? "Updated ✓" : "Inserted ✓";
  }
  if (msg.type === "error") status.textContent = "Error: " + msg.message;
});
