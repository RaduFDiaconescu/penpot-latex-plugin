// plugin.js — runs inside Penpot. The `penpot` global is ONLY available here.

penpot.ui.open("LaTeX Equations", "index.html", { width: 460, height: 740 });

let editingShape = null;
const RECENTS_KEY = "latex-recents";
const MAX_RECENTS = 15;

function readLatexShape(shape) {
  if (!shape) return null;
  try {
    const latex = shape.getPluginData("latex");
    if (!latex) return null;
    return {
      latex,
      size: shape.getPluginData("size") || "48",
      color: shape.getPluginData("color") || "#000000",
      display: shape.getPluginData("display") !== "false"
    };
  } catch (e) { return null; }
}

function collectLatexShapes() {
  const acc = [], seen = new Set();
  (function walk(shape) {
    if (!shape || seen.has(shape)) return;
    seen.add(shape);
    const data = readLatexShape(shape);
    if (data) acc.push({ id: shape.id, ...data });
    const kids = shape.children;
    if (Array.isArray(kids)) kids.forEach(walk);
  })(penpot.root);
  return acc;
}

function findShapeById(id) {
  let found = null; const seen = new Set();
  (function walk(shape) {
    if (found || !shape || seen.has(shape)) return;
    seen.add(shape);
    if (shape.id === id) { found = shape; return; }
    const kids = shape.children;
    if (Array.isArray(kids)) kids.forEach(walk);
  })(penpot.root);
  return found;
}

async function getRecents() {
  try {
    const raw = penpot.localStorage && await penpot.localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
async function pushRecent(entry) {
  try {
    let list = await getRecents();
    list = list.filter((e) => e.latex !== entry.latex);
    list.unshift(entry);
    list = list.slice(0, MAX_RECENTS);
    if (penpot.localStorage) await penpot.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch (e) {}
}

async function sendLibrary() {
  const docItems = collectLatexShapes();
  const docLatex = new Set(docItems.map((d) => d.latex));
  const recentItems = (await getRecents()).filter((r) => !docLatex.has(r.latex));
  penpot.ui.sendMessage({ type: "equation-list", docItems, recentItems });
}

function emitSelection() {
  const sel = penpot.selection || [];
  if (sel.length !== 1) {
    editingShape = null;
    penpot.ui.sendMessage({ type: "clear-editing" });
    penpot.ui.sendMessage({ type: "error", message: "Selected " + sel.length + " shapes." });
    return;
  }
  const shape = sel[0];
  const data = readLatexShape(shape);
  if (data) {
    editingShape = shape;
    penpot.ui.sendMessage({ type: "load-equation", ...data });
  } else {
    editingShape = null;
    penpot.ui.sendMessage({ type: "clear-editing" });
    let raw = "";
    try { raw = shape.getPluginData("latex"); } catch (e) { raw = "getPluginData threw: " + e; }
    penpot.ui.sendMessage({
      type: "error",
      message: "Selected '" + (shape.name || shape.type) + "', latex data = '" + raw + "'"
    });
  }
}

penpot.on("selectionchange", emitSelection);
emitSelection();
sendLibrary();

function applyMeta(shape, msg) {
  shape.name = "LaTeX: " + (msg.latex || "equation");
  try {
    shape.setPluginData("latex", msg.latex || "");
    shape.setPluginData("size", String(msg.size || ""));
    shape.setPluginData("color", String(msg.color || ""));
    shape.setPluginData("display", msg.display ? "true" : "false");
  } catch (e) {}
}

penpot.ui.onMessage(async (msg) => {
  if (!msg) return;

  if (msg.type === "select-shape") {
    const shape = findShapeById(msg.id);
    if (shape) {
      penpot.selection = [shape];
      try { penpot.viewport.zoomIntoView && penpot.viewport.zoomIntoView([shape]); } catch (e) {}
      editingShape = shape;
      const data = readLatexShape(shape);
      if (data) penpot.ui.sendMessage({ type: "load-equation", ...data });
    }
    return;
  }

  if (msg.type === "delete-recent") {
    try {
      let list = await getRecents();
      list = list.filter((e) => e.latex !== msg.latex);
      if (penpot.localStorage) await penpot.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
    } catch (e) {}
    await sendLibrary();
    return;
  }

  if (msg.type === "clear-recents") {
    try {
      if (penpot.localStorage) {
        if (penpot.localStorage.removeItem) await penpot.localStorage.removeItem(RECENTS_KEY);
        else await penpot.localStorage.setItem(RECENTS_KEY, "[]");
      }
    } catch (e) {}
    await sendLibrary();
    return;
  }

  if (msg.type === "insert-svg") {
    try {
      const group = penpot.createShapeFromSvg(msg.svg);
      if (!group) {
        penpot.ui.sendMessage({ type: "error", message: "Penpot could not parse the SVG." });
        return;
      }

      const replacing = msg.replace && editingShape;
      let x, y;
      if (replacing) { try { x = editingShape.x; y = editingShape.y; } catch (e) {} }
      if (x === undefined) {
        const c = (penpot.viewport && penpot.viewport.center) || { x: 0, y: 0 };
        x = c.x - group.width / 2;
        y = c.y - group.height / 2;
      }
      group.x = x; group.y = y;

      applyMeta(group, msg);
      if (replacing) { try { editingShape.remove(); } catch (e) {} }

      editingShape = group;
      penpot.selection = [group];

      await pushRecent({
        latex: msg.latex, size: String(msg.size || ""),
        color: String(msg.color || ""), display: !!msg.display
      });
      await sendLibrary();

      penpot.ui.sendMessage({ type: "inserted", replaced: !!replacing });
    } catch (e) {
      penpot.ui.sendMessage({ type: "error", message: String(e) });
    }
  }
});
