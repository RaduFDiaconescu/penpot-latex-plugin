// plugin.js — runs inside Penpot.

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
      size: shape.getPluginData("size") || "36",
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
  if (sel.length === 1) {
    const data = readLatexShape(sel[0]);
    if (data) {
      editingShape = sel[0];
      penpot.ui.sendMessage({ type: "load-equation", ...data });
      return;
    }
  }
  editingShape = null;
  penpot.ui.sendMessage({ type: "clear-editing" });
}

penpot.on("selectionchange", emitSelection);
emitSelection();
sendLibrary();

function applyMeta(shape, msg, baseW, baseH) {
  shape.name = "LaTeX: " + (msg.latex || "equation");
  try {
    shape.setPluginData("latex", msg.latex || "");
    shape.setPluginData("size", String(msg.size || ""));
    shape.setPluginData("color", String(msg.color || ""));
    shape.setPluginData("display", msg.display ? "true" : "false");
    shape.setPluginData("baseW", String(baseW));
    shape.setPluginData("baseH", String(baseH));
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

      // Intended pixel size from the UI — Penpot otherwise sizes from raw viewBox units.
      const baseW = Number(msg.w) > 0 ? Number(msg.w) : group.width;
      const baseH = Number(msg.h) > 0 ? Number(msg.h) : group.height;

      // On replace, keep the old equation's on-canvas scale and its center point.
      let scale = 1, ocx, ocy;
      if (replacing) {
        try {
          const onw = parseFloat(editingShape.getPluginData("baseW"));
          if (onw > 0 && editingShape.width > 0) scale = editingShape.width / onw;
          ocx = editingShape.x + editingShape.width / 2;
          ocy = editingShape.y + editingShape.height / 2;
        } catch (e) {}
      }

      try { group.resize(baseW * scale, baseH * scale); } catch (e) {}

      if (replacing && ocx !== undefined) {
        group.x = ocx - group.width / 2;
        group.y = ocy - group.height / 2;
      } else {
        const c = (penpot.viewport && penpot.viewport.center) || { x: 0, y: 0 };
        group.x = c.x - group.width / 2;
        group.y = c.y - group.height / 2;
      }

      applyMeta(group, msg, baseW, baseH);
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
