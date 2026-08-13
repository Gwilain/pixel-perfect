const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const elements = {
  dropZone: document.querySelector("#dropZone"),
  emptyState: document.querySelector("#emptyState"),
  recentProjects: document.querySelector("#recentProjects"),
  recentProjectList: document.querySelector("#recentProjectList"),
  fileInput: document.querySelector("#fileInput"),
  jsonInput: document.querySelector("#jsonInput"),
  openButton: document.querySelector("#openButton"),
  toolButtons: [...document.querySelectorAll(".tool")],
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomActual: document.querySelector("#zoomActual"),
  zoomFit: document.querySelector("#zoomFit"),
  clearMeasurements: document.querySelector("#clearMeasurements"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
  theoryWidth: document.querySelector("#theoryWidth"),
  snapToGuides: document.querySelector("#snapToGuides"),
  imageInfo: document.querySelector("#imageInfo"),
  zoomInfo: document.querySelector("#zoomInfo"),
  cursorInfo: document.querySelector("#cursorInfo"),
  colorInfo: document.querySelector("#colorInfo"),
  hintInfo: document.querySelector("#hintInfo"),
};

const state = {
  image: null,
  imageName: "",
  imageSignature: "",
  imageCanvas: document.createElement("canvas"),
  imageCtx: null,
  imageData: null,
  viewport: { scale: 1, x: 0, y: 0 },
  tool: "select",
  measurements: [],
  guides: [],
  swatches: [],
  selectedId: null,
  hoverImage: null,
  currentColor: null,
  draft: null,
  drag: null,
  spacePressed: false,
  theoryWidth: null,
  snapToGuides: false,
  recentProjects: [],
};

state.imageCtx = state.imageCanvas.getContext("2d", { willReadFrequently: true });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const round = (value) => Math.round(value * 100) / 100;
const smartRound = (value) => (Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : round(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isMac = navigator.platform.toLowerCase().includes("mac");
const RULER_SIZE = 18;
const HANDLE_SIZE = 8;
const SWATCH_SIZE = 28;
const SWATCH_GAP = 6;
const SNAP_DISTANCE = 8;
const RECENT_PROJECTS_KEY = "pixel-perfect:recent-projects";
const DB_NAME = "pixel-perfect-db";
const DB_VERSION = 1;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function screenSize() {
  return {
    width: canvas.width / (window.devicePixelRatio || 1),
    height: canvas.height / (window.devicePixelRatio || 1),
  };
}

function toImagePoint(screenPoint) {
  return {
    x: (screenPoint.x - state.viewport.x) / state.viewport.scale,
    y: (screenPoint.y - state.viewport.y) / state.viewport.scale,
  };
}

function toScreenPoint(imagePoint) {
  return {
    x: imagePoint.x * state.viewport.scale + state.viewport.x,
    y: imagePoint.y * state.viewport.scale + state.viewport.y,
  };
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function imageBoundsContain(point) {
  return (
    state.image &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < state.image.width &&
    point.y < state.image.height
  );
}

function setTool(tool) {
  state.tool = tool;
  state.draft = null;
  state.drag = null;
  elements.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  render();
}

function fitToScreen() {
  if (!state.image) return;
  const size = screenSize();
  const padding = 48;
  const scale = Math.min(
    (size.width - RULER_SIZE - padding) / state.image.width,
    (size.height - RULER_SIZE - padding) / state.image.height,
  );
  state.viewport.scale = clamp(scale, 0.02, 64);
  state.viewport.x = RULER_SIZE + (size.width - RULER_SIZE - state.image.width * state.viewport.scale) / 2;
  state.viewport.y = RULER_SIZE + (size.height - RULER_SIZE - state.image.height * state.viewport.scale) / 2;
  updateStatus();
  render();
}

function setActualZoom() {
  if (!state.image) return;
  const size = screenSize();
  state.viewport.scale = 1;
  state.viewport.x = RULER_SIZE + (size.width - RULER_SIZE - state.image.width) / 2;
  state.viewport.y = RULER_SIZE + (size.height - RULER_SIZE - state.image.height) / 2;
  updateStatus();
  render();
}

function zoomAt(screenPoint, nextScale) {
  if (!state.image) return;
  const oldScale = state.viewport.scale;
  const scale = clamp(nextScale, 0.02, 64);
  const imagePoint = toImagePoint(screenPoint);
  state.viewport.scale = scale;
  state.viewport.x = screenPoint.x - imagePoint.x * scale;
  state.viewport.y = screenPoint.y - imagePoint.y * scale;
  if (oldScale !== scale) {
    updateStatus();
    render();
  }
}

function getScaleFactor() {
  if (!state.theoryWidth || !state.image) return 1;
  return state.theoryWidth / state.image.width;
}

function formatMeasureValue(value) {
  const scaled = value * getScaleFactor();
  return `${smartRound(scaled)} px`;
}

function formatCoord(value) {
  return smartRound(value * getScaleFactor());
}

async function loadImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  await loadImageBlob(file, file.name || "Untitled image");
}

async function loadImageBlob(blob, name, options = {}) {
  if (!blob || !blob.type.startsWith("image/")) return;
  const bitmap = await createImageBitmap(blob);
  state.image = bitmap;
  state.imageName = name;
  state.imageSignature = `${name}:${blob.size}:${bitmap.width}x${bitmap.height}`;
  state.imageCanvas.width = bitmap.width;
  state.imageCanvas.height = bitmap.height;
  state.imageCtx.clearRect(0, 0, bitmap.width, bitmap.height);
  state.imageCtx.drawImage(bitmap, 0, 0);
  state.imageData = state.imageCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  state.measurements = [];
  state.guides = [];
  state.swatches = [];
  state.selectedId = null;
  restoreFromStorage();
  elements.emptyState.hidden = true;
  renderRecentProjects();
  fitToScreen();
  if (options.saveRecent !== false) {
    await saveRecentProject(blob, name, bitmap.width, bitmap.height);
  }
  updateStatus();
}

function openProjectDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("images", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putImageRecord(record) {
  const db = await openProjectDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getImageRecord(id) {
  const db = await openProjectDatabase();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}

function readRecentProjects() {
  try {
    const projects = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]");
    return Array.isArray(projects) ? projects.slice(0, 3) : [];
  } catch {
    localStorage.removeItem(RECENT_PROJECTS_KEY);
    return [];
  }
}

function writeRecentProjects(projects) {
  state.recentProjects = projects.slice(0, 3);
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(state.recentProjects));
  renderRecentProjects();
}

function createThumbnail() {
  const maxSize = 180;
  const scale = Math.min(maxSize / state.imageCanvas.width, maxSize / state.imageCanvas.height, 1);
  const width = Math.max(1, Math.round(state.imageCanvas.width * scale));
  const height = Math.max(1, Math.round(state.imageCanvas.height * scale));
  const thumbCanvas = document.createElement("canvas");
  const thumbCtx = thumbCanvas.getContext("2d");
  thumbCanvas.width = width;
  thumbCanvas.height = height;
  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.drawImage(state.imageCanvas, 0, 0, width, height);
  return thumbCanvas.toDataURL("image/jpeg", 0.78);
}

async function saveRecentProject(blob, name, width, height) {
  const id = state.imageSignature;
  const thumbnail = createThumbnail();
  await putImageRecord({ id, blob, name, width, height, type: blob.type, updatedAt: Date.now() });
  const nextProjects = [
    { id, name, width, height, thumbnail, updatedAt: Date.now() },
    ...state.recentProjects.filter((project) => project.id !== id),
  ].slice(0, 3);
  writeRecentProjects(nextProjects);
}

async function reopenRecentProject(id) {
  const record = await getImageRecord(id);
  if (!record) {
    writeRecentProjects(state.recentProjects.filter((project) => project.id !== id));
    return;
  }
  await loadImageBlob(record.blob, record.name, { saveRecent: true });
}

function renderRecentProjects() {
  const shouldShow = !state.image && state.recentProjects.length > 0;
  elements.recentProjects.hidden = !shouldShow;
  elements.recentProjectList.replaceChildren();
  if (!shouldShow) return;

  for (const project of state.recentProjects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-project";
    button.title = `Open ${project.name}`;
    button.dataset.projectId = project.id;

    const image = document.createElement("img");
    image.src = project.thumbnail;
    image.alt = "";

    const label = document.createElement("span");
    label.textContent = `${project.name} (${project.width} x ${project.height})`;

    button.append(image, label);
    elements.recentProjectList.append(button);
  }
}

function getPixelColor(point) {
  if (!imageBoundsContain(point) || !state.imageData) return null;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  const index = (y * state.imageData.width + x) * 4;
  const data = state.imageData.data;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];
  return {
    r,
    g,
    b,
    a,
    hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
  };
}

function normalizedRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.w);
  const y = Math.min(rect.y, rect.y + rect.h);
  return {
    x,
    y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

function snapDistanceEnd(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angleSlack = 8 / state.viewport.scale;
  if (Math.abs(dy) < angleSlack) return { x: end.x, y: start.y };
  if (Math.abs(dx) < angleSlack) return { x: start.x, y: end.y };
  return end;
}

function nearestGuideSnap(value, orientation) {
  if (!state.snapToGuides || !state.guides.length) return null;
  const threshold = SNAP_DISTANCE / state.viewport.scale;
  let nearest = null;
  for (const guide of state.guides) {
    if (guide.orientation !== orientation) continue;
    const delta = Math.abs(value - guide.value);
    if (delta <= threshold && (!nearest || delta < nearest.delta)) {
      nearest = { value: guide.value, delta };
    }
  }
  return nearest;
}

function snapPointToGuides(point) {
  const xSnap = nearestGuideSnap(point.x, "vertical");
  const ySnap = nearestGuideSnap(point.y, "horizontal");
  return {
    x: xSnap ? xSnap.value : point.x,
    y: ySnap ? ySnap.value : point.y,
  };
}

function snapMovedRect(original, dx, dy) {
  const rect = normalizedRect(original);
  let nextDx = dx;
  let nextDy = dy;
  const xCandidates = [
    { value: rect.x + dx, offset: rect.x },
    { value: rect.x + rect.w / 2 + dx, offset: rect.x + rect.w / 2 },
    { value: rect.x + rect.w + dx, offset: rect.x + rect.w },
  ];
  const yCandidates = [
    { value: rect.y + dy, offset: rect.y },
    { value: rect.y + rect.h / 2 + dy, offset: rect.y + rect.h / 2 },
    { value: rect.y + rect.h + dy, offset: rect.y + rect.h },
  ];

  const xSnap = xCandidates
    .map((candidate) => {
      const snap = nearestGuideSnap(candidate.value, "vertical");
      return snap ? { dx: snap.value - candidate.offset, delta: snap.delta } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta)[0];
  const ySnap = yCandidates
    .map((candidate) => {
      const snap = nearestGuideSnap(candidate.value, "horizontal");
      return snap ? { dy: snap.value - candidate.offset, delta: snap.delta } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta)[0];

  if (xSnap) nextDx = xSnap.dx;
  if (ySnap) nextDy = ySnap.dy;
  return { dx: nextDx, dy: nextDy };
}

function persist() {
  if (!state.imageSignature) return;
  if (!state.measurements.length && !state.guides.length && !state.swatches.length && !state.theoryWidth && !state.snapToGuides) {
    localStorage.removeItem(`pixel-measure:${state.imageSignature}`);
    return;
  }
  const payload = {
    version: 1,
    imageSignature: state.imageSignature,
    theoryWidth: state.theoryWidth,
    snapToGuides: state.snapToGuides,
    measurements: state.measurements,
    guides: state.guides,
    swatches: state.swatches,
  };
  localStorage.setItem(`pixel-measure:${state.imageSignature}`, JSON.stringify(payload));
}

function restoreFromStorage() {
  const raw = localStorage.getItem(`pixel-measure:${state.imageSignature}`);
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload.imageSignature !== state.imageSignature) return;
    state.measurements = Array.isArray(payload.measurements) ? payload.measurements : [];
    state.guides = Array.isArray(payload.guides) ? payload.guides : [];
    state.swatches = Array.isArray(payload.swatches) ? payload.swatches : [];
    state.theoryWidth = Number.isFinite(payload.theoryWidth) ? payload.theoryWidth : null;
    state.snapToGuides = Boolean(payload.snapToGuides);
    elements.theoryWidth.value = state.theoryWidth ?? "";
    elements.snapToGuides.checked = state.snapToGuides;
  } catch {
    localStorage.removeItem(`pixel-measure:${state.imageSignature}`);
  }
}

function exportMeasurements() {
  const payload = {
    version: 1,
    image: {
      name: state.imageName,
      width: state.image?.width ?? 0,
      height: state.image?.height ?? 0,
      signature: state.imageSignature,
    },
    theoryWidth: state.theoryWidth,
    snapToGuides: state.snapToGuides,
    measurements: state.measurements,
    guides: state.guides,
    swatches: state.swatches,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${state.imageName || "measurements"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function importMeasurements(file) {
  if (!file) return;
  const payload = JSON.parse(await file.text());
  state.measurements = Array.isArray(payload.measurements) ? payload.measurements : [];
  state.guides = Array.isArray(payload.guides) ? payload.guides : [];
  state.swatches = Array.isArray(payload.swatches) ? payload.swatches : [];
  state.theoryWidth = Number.isFinite(payload.theoryWidth) ? payload.theoryWidth : null;
  state.snapToGuides = Boolean(payload.snapToGuides);
  elements.theoryWidth.value = state.theoryWidth ?? "";
  elements.snapToGuides.checked = state.snapToGuides;
  state.selectedId = null;
  persist();
  updateStatus();
  render();
}

function selectedMeasurement() {
  return state.measurements.find((item) => item.id === state.selectedId) ?? null;
}

function rectHandlePoints(item) {
  const rect = normalizedRect(item);
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  return [
    { name: "nw", point: { x: left, y: top }, cursor: "nwse-resize" },
    { name: "n", point: { x: centerX, y: top }, cursor: "ns-resize" },
    { name: "ne", point: { x: right, y: top }, cursor: "nesw-resize" },
    { name: "e", point: { x: right, y: centerY }, cursor: "ew-resize" },
    { name: "se", point: { x: right, y: bottom }, cursor: "nwse-resize" },
    { name: "s", point: { x: centerX, y: bottom }, cursor: "ns-resize" },
    { name: "sw", point: { x: left, y: bottom }, cursor: "nesw-resize" },
    { name: "w", point: { x: left, y: centerY }, cursor: "ew-resize" },
  ];
}

function hitSelectedHandle(screenPoint) {
  const item = selectedMeasurement();
  if (!item) return null;
  const halfSize = HANDLE_SIZE / 2 + 3;

  if (item.type === "rect") {
    for (const handle of rectHandlePoints(item)) {
      const screenHandle = toScreenPoint(handle.point);
      if (
        Math.abs(screenPoint.x - screenHandle.x) <= halfSize &&
        Math.abs(screenPoint.y - screenHandle.y) <= halfSize
      ) {
        return { type: "rectHandle", item, handle: handle.name, cursor: handle.cursor };
      }
    }
  }

  if (item.type === "distance") {
    for (const handle of [
      { name: "a", point: item.a },
      { name: "b", point: item.b },
    ]) {
      const screenHandle = toScreenPoint(handle.point);
      if (distance(screenPoint, screenHandle) <= halfSize + 2) {
        return { type: "distanceHandle", item, handle: handle.name, cursor: "move" };
      }
    }
  }

  return null;
}

function hitSelectedMeasurementBody(screenPoint) {
  const item = selectedMeasurement();
  if (!item) return null;
  const imagePoint = toImagePoint(screenPoint);
  const tolerance = 8 / state.viewport.scale;

  if (item.type === "rect") {
    const rect = normalizedRect(item);
    if (
      imagePoint.x >= rect.x - tolerance &&
      imagePoint.x <= rect.x + rect.w + tolerance &&
      imagePoint.y >= rect.y - tolerance &&
      imagePoint.y <= rect.y + rect.h + tolerance
    ) {
      return { type: "measurement", item, cursor: "move" };
    }
  }

  if (item.type === "distance") {
    const a = item.a;
    const b = item.b;
    const length = distance(a, b);
    const t = length === 0 ? 0 : clamp(((imagePoint.x - a.x) * (b.x - a.x) + (imagePoint.y - a.y) * (b.y - a.y)) / (length * length), 0, 1);
    const closest = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (distance(imagePoint, closest) <= tolerance) return { type: "measurement", item, cursor: "move" };
  }

  return null;
}

function rulerHit(screenPoint) {
  if (screenPoint.x < RULER_SIZE && screenPoint.y < RULER_SIZE) return { type: "rulerCorner" };
  if (screenPoint.y < RULER_SIZE) return { type: "ruler", orientation: "horizontal" };
  if (screenPoint.x < RULER_SIZE) return { type: "ruler", orientation: "vertical" };
  return null;
}

function swatchRects() {
  const size = screenSize();
  const perRow = Math.max(1, Math.floor((size.width - RULER_SIZE - 16) / (SWATCH_SIZE + SWATCH_GAP)));
  return state.swatches.map((swatch, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const x = size.width - 8 - SWATCH_SIZE - col * (SWATCH_SIZE + SWATCH_GAP);
    const y = RULER_SIZE + 8 + row * (SWATCH_SIZE + SWATCH_GAP);
    return { swatch, x, y, width: SWATCH_SIZE, height: SWATCH_SIZE };
  });
}

function swatchHit(screenPoint) {
  for (const rect of swatchRects()) {
    if (
      screenPoint.x >= rect.x &&
      screenPoint.x <= rect.x + rect.width &&
      screenPoint.y >= rect.y &&
      screenPoint.y <= rect.y + rect.height
    ) {
      return { type: "swatch", item: rect.swatch, cursor: "pointer" };
    }
  }
  return null;
}

async function copyHex(hex) {
  try {
    await navigator.clipboard.writeText(hex);
    elements.hintInfo.textContent = `${hex} copied`;
  } catch {
    elements.hintInfo.textContent = `${hex} selected`;
  }
}

function addSwatch(color, imagePoint) {
  const last = state.swatches[0];
  if (last?.hex === color.hex) {
    state.selectedId = last.id;
    persist();
    render();
    return last;
  }
  const swatch = {
    id: uid(),
    type: "swatch",
    hex: color.hex,
    rgb: { r: color.r, g: color.g, b: color.b },
    x: Math.floor(imagePoint.x),
    y: Math.floor(imagePoint.y),
  };
  state.swatches.unshift(swatch);
  state.selectedId = swatch.id;
  persist();
  render();
  return swatch;
}

function guideIsInsideImage(guide) {
  if (!state.image) return false;
  return guide.value >= 0 && guide.value <= (guide.orientation === "vertical" ? state.image.width : state.image.height);
}

function applyRectHandle(item, handle, original, imagePoint) {
  const rect = normalizedRect(original);
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;

  if (handle.includes("w")) left = imagePoint.x;
  if (handle.includes("e")) right = imagePoint.x;
  if (handle.includes("n")) top = imagePoint.y;
  if (handle.includes("s")) bottom = imagePoint.y;

  const next = normalizedRect({ x: left, y: top, w: right - left, h: bottom - top });
  item.x = next.x;
  item.y = next.y;
  item.w = next.w;
  item.h = next.h;
}

function updateCanvasCursor(screenPoint) {
  if (state.spacePressed || state.drag?.type === "pan") {
    canvas.style.cursor = "grab";
    return;
  }
  if (state.drag?.type === "guide" || state.drag?.type === "distanceHandle") {
    canvas.style.cursor = "move";
    return;
  }
  if (state.drag?.type === "rectHandle") {
    canvas.style.cursor = state.drag.cursor;
    return;
  }
  const ruler = rulerHit(screenPoint);
  const swatch = swatchHit(screenPoint);
  if (swatch) {
    canvas.style.cursor = swatch.cursor;
    return;
  }
  if (ruler?.orientation === "horizontal") {
    canvas.style.cursor = "ns-resize";
    return;
  }
  if (ruler?.orientation === "vertical") {
    canvas.style.cursor = "ew-resize";
    return;
  }
  const hit = state.tool === "select" || state.tool === "rect" || state.tool === "distance"
    ? hitSelectedHandle(screenPoint) ?? hitSelectedMeasurementBody(screenPoint) ?? (state.tool === "select" ? hitTest(screenPoint) : null)
    : null;
  canvas.style.cursor = hit?.cursor ?? (hit ? "move" : "crosshair");
}

function hitTest(screenPoint) {
  const imagePoint = toImagePoint(screenPoint);
  const tolerance = 8 / state.viewport.scale;

  const swatch = swatchHit(screenPoint);
  if (swatch) return swatch;

  const handleHit = hitSelectedHandle(screenPoint);
  if (handleHit) return handleHit;

  for (let i = state.guides.length - 1; i >= 0; i -= 1) {
    const guide = state.guides[i];
    const delta = guide.orientation === "vertical" ? Math.abs(imagePoint.x - guide.value) : Math.abs(imagePoint.y - guide.value);
    if (delta <= tolerance) return { type: "guide", item: guide };
  }

  for (let i = state.measurements.length - 1; i >= 0; i -= 1) {
    const item = state.measurements[i];
    if (item.type === "rect") {
      const rect = normalizedRect(item);
      if (
        imagePoint.x >= rect.x - tolerance &&
        imagePoint.x <= rect.x + rect.w + tolerance &&
        imagePoint.y >= rect.y - tolerance &&
        imagePoint.y <= rect.y + rect.h + tolerance
      ) {
        return { type: "measurement", item };
      }
    }
    if (item.type === "distance") {
      const a = item.a;
      const b = item.b;
      const length = distance(a, b);
      const t = length === 0 ? 0 : clamp(((imagePoint.x - a.x) * (b.x - a.x) + (imagePoint.y - a.y) * (b.y - a.y)) / (length * length), 0, 1);
      const closest = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (distance(imagePoint, closest) <= tolerance) return { type: "measurement", item };
    }
  }
  return null;
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.measurements = state.measurements.filter((item) => item.id !== state.selectedId);
  state.guides = state.guides.filter((item) => item.id !== state.selectedId);
  state.swatches = state.swatches.filter((item) => item.id !== state.selectedId);
  state.selectedId = null;
  persist();
  render();
}

function cancelAction() {
  state.draft = null;
  state.drag = null;
  render();
}

function updateStatus() {
  elements.imageInfo.textContent = state.image
    ? `Image: ${state.image.width} x ${state.image.height} px`
    : "Image: -";
  elements.zoomInfo.textContent = `Zoom: ${Math.round(state.viewport.scale * 100)}%`;
  if (state.hoverImage && imageBoundsContain(state.hoverImage)) {
    elements.cursorInfo.textContent = `X: ${Math.floor(state.hoverImage.x)} Y: ${Math.floor(state.hoverImage.y)}`;
  } else {
    elements.cursorInfo.textContent = "X: - Y: -";
  }
  if (state.currentColor) {
    elements.colorInfo.textContent = `Color: ${state.currentColor.hex} rgb(${state.currentColor.r}, ${state.currentColor.g}, ${state.currentColor.b})`;
    elements.colorInfo.style.color = state.currentColor.hex;
  } else {
    elements.colorInfo.textContent = "Color: -";
    elements.colorInfo.style.color = "";
  }
}

function drawImage() {
  if (!state.image) return;
  ctx.imageSmoothingEnabled = state.viewport.scale < 1;
  ctx.drawImage(
    state.imageCanvas,
    state.viewport.x,
    state.viewport.y,
    state.image.width * state.viewport.scale,
    state.image.height * state.viewport.scale,
  );
}

function chooseTickStep() {
  const target = 80 / state.viewport.scale;
  const powers = [1, 2, 5];
  const exponent = Math.floor(Math.log10(Math.max(target, 1)));
  const base = 10 ** exponent;
  for (const multiplier of powers) {
    const step = multiplier * base;
    if (step >= target) return step;
  }
  return 10 * base;
}

function drawRulers() {
  const size = screenSize();
  ctx.save();
  ctx.fillStyle = "#171a1f";
  ctx.fillRect(0, 0, size.width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, size.height);
  ctx.fillStyle = "#20242a";
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE + 0.5);
  ctx.lineTo(size.width, RULER_SIZE + 0.5);
  ctx.moveTo(RULER_SIZE + 0.5, 0);
  ctx.lineTo(RULER_SIZE + 0.5, size.height);
  ctx.stroke();

  if (!state.image) {
    ctx.restore();
    return;
  }

  const step = chooseTickStep();
  const startX = Math.floor(toImagePoint({ x: RULER_SIZE, y: 0 }).x / step) * step;
  const endX = toImagePoint({ x: size.width, y: 0 }).x;
  const startY = Math.floor(toImagePoint({ x: 0, y: RULER_SIZE }).y / step) * step;
  const endY = toImagePoint({ x: 0, y: size.height }).y;
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#a5adb8";
  ctx.strokeStyle = "rgba(232, 237, 242, 0.42)";

  for (let x = startX; x <= endX; x += step) {
    const screenX = toScreenPoint({ x, y: 0 }).x;
    if (screenX < RULER_SIZE) continue;
    ctx.beginPath();
    ctx.moveTo(screenX + 0.5, RULER_SIZE);
    ctx.lineTo(screenX + 0.5, x % (step * 2) === 0 ? 5 : 10);
    ctx.stroke();
    ctx.fillText(String(Math.round(x)), screenX + 3, 8);
  }

  for (let y = startY; y <= endY; y += step) {
    const screenY = toScreenPoint({ x: 0, y }).y;
    if (screenY < RULER_SIZE) continue;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, screenY + 0.5);
    ctx.lineTo(y % (step * 2) === 0 ? 5 : 10, screenY + 0.5);
    ctx.stroke();
    ctx.save();
    ctx.translate(7, screenY - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(Math.round(y)), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawGuides() {
  if (!state.image) return;
  const size = screenSize();
  ctx.save();
  for (const guide of state.guides) {
    const selected = guide.id === state.selectedId;
    const color = selected ? "#ff3d8b" : "#00d4ff";
    const start = {};
    const end = {};
    if (guide.orientation === "vertical") {
      const x = toScreenPoint({ x: guide.value, y: 0 }).x;
      start.x = x;
      start.y = 0;
      end.x = x;
      end.y = size.height;
      drawLabel(`x ${Math.round(guide.value)}`, x + 6, RULER_SIZE + 18, selected);
    } else {
      const y = toScreenPoint({ x: 0, y: guide.value }).y;
      start.x = 0;
      start.y = y;
      end.x = size.width;
      end.y = y;
      drawLabel(`y ${Math.round(guide.value)}`, RULER_SIZE + 8, y + 18, selected);
    }
    const crispStart = { ...start };
    const crispEnd = { ...end };
    if (guide.orientation === "vertical") {
      crispStart.x = Math.round(start.x) + 0.5;
      crispEnd.x = crispStart.x;
    } else {
      crispStart.y = Math.round(start.y) + 0.5;
      crispEnd.y = crispStart.y;
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crispStart.x, crispStart.y);
    ctx.lineTo(crispEnd.x, crispEnd.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeasurements() {
  for (const item of [...state.measurements, state.draft].filter(Boolean)) {
    if (item.type === "rect") drawRectMeasurement(item);
    if (item.type === "distance") drawDistanceMeasurement(item);
  }
}

function drawRectMeasurement(item) {
  const rect = normalizedRect(item);
  const topLeft = toScreenPoint({ x: rect.x, y: rect.y });
  const bottomRight = toScreenPoint({ x: rect.x + rect.w, y: rect.y + rect.h });
  const selected = item.id === state.selectedId;
  ctx.save();
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = selected ? "#45d0a0" : "#f4c95d";
  ctx.fillStyle = "rgba(244, 201, 93, 0.12)";
  ctx.setLineDash(item.id === "draft" ? [5, 4] : []);
  ctx.beginPath();
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.fill();
  ctx.stroke();
  const guideText = nearestGuideText(rect);
  drawLabel(
    `${formatMeasureValue(rect.w)} x ${formatMeasureValue(rect.h)} | X ${formatCoord(rect.x)} Y ${formatCoord(rect.y)}${guideText}`,
    topLeft.x + 8,
    topLeft.y - 10,
    selected,
  );
  if (selected) drawRectHandles(item);
  ctx.restore();
}

function drawDistanceMeasurement(item) {
  const a = toScreenPoint(item.a);
  const b = toScreenPoint(item.b);
  const selected = item.id === state.selectedId;
  const dx = item.b.x - item.a.x;
  const dy = item.b.y - item.a.y;
  ctx.save();
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = selected ? "#45d0a0" : "#d98cff";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  drawPoint(a.x, a.y);
  drawPoint(b.x, b.y);
  drawLabel(
    `DX ${formatMeasureValue(Math.abs(dx))} | DY ${formatMeasureValue(Math.abs(dy))} | D ${formatMeasureValue(Math.hypot(dx, dy))}`,
    (a.x + b.x) / 2 + 8,
    (a.y + b.y) / 2 - 8,
    selected,
  );
  if (selected) drawDistanceHandles(item);
  ctx.restore();
}

function drawRectHandles(item) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "#111315";
  ctx.strokeStyle = "#45d0a0";
  ctx.lineWidth = 1.5;
  for (const handle of rectHandlePoints(item)) {
    const point = toScreenPoint(handle.point);
    ctx.fillRect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
  ctx.restore();
}

function drawDistanceHandles(item) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "#111315";
  ctx.strokeStyle = "#45d0a0";
  ctx.lineWidth = 1.5;
  for (const point of [item.a, item.b]) {
    const screenPoint = toScreenPoint(point);
    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSwatches() {
  if (!state.swatches.length) return;
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  for (const rect of swatchRects()) {
    const selected = rect.swatch.id === state.selectedId;
    ctx.fillStyle = rect.swatch.hex;
    ctx.strokeStyle = selected ? "#ffffff" : "rgba(0, 0, 0, 0.78)";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
    ctx.shadowBlur = 4;
    roundedRect(rect.x, rect.y, rect.width, rect.height, 5);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (selected) {
      drawLabel(`${rect.swatch.hex} | X ${rect.swatch.x} Y ${rect.swatch.y}`, rect.x - 154, rect.y + 24, true);
    }
  }
  ctx.restore();
}

function nearestGuideText(rect) {
  if (!state.guides.length) return "";
  const edges = [
    { orientation: "vertical", value: rect.x },
    { orientation: "vertical", value: rect.x + rect.w },
    { orientation: "horizontal", value: rect.y },
    { orientation: "horizontal", value: rect.y + rect.h },
  ];
  const nearest = state.guides
    .map((guide) => {
      const candidates = edges.filter((edge) => edge.orientation === guide.orientation);
      const min = Math.min(...candidates.map((edge) => Math.abs(edge.value - guide.value)));
      return { guide, min };
    })
    .sort((a, b) => a.min - b.min)[0];
  if (!nearest || nearest.min > 500) return "";
  return ` | guide ${formatMeasureValue(nearest.min)}`;
}

function drawPoint(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabel(text, x, y, selected = false) {
  const size = screenSize();
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  const paddingX = 7;
  const paddingY = 5;
  const metrics = ctx.measureText(text);
  const width = metrics.width + paddingX * 2;
  const height = 24;
  const left = clamp(x, 6, size.width - width - 6);
  const top = clamp(y - height, 6, size.height - height - 6);
  ctx.fillStyle = selected ? "rgba(20, 35, 30, 0.94)" : "rgba(10, 12, 15, 0.88)";
  ctx.strokeStyle = selected ? "#45d0a0" : "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1;
  roundedRect(left, top, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f5f7fa";
  ctx.fillText(text, left + paddingX, top + paddingY + 12);
  ctx.restore();
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawLoupe(screenPoint) {
  if (state.tool !== "eyedropper" || !state.image || !state.hoverImage) return;
  const sourceSize = 17;
  const pixel = 9;
  const radius = sourceSize * pixel;
  const imagePoint = {
    x: Math.floor(state.hoverImage.x) - Math.floor(sourceSize / 2),
    y: Math.floor(state.hoverImage.y) - Math.floor(sourceSize / 2),
  };
  const x = clamp(screenPoint.x + 18, 8, screenSize().width - radius - 8);
  const y = clamp(screenPoint.y + 18, 8, screenSize().height - radius - 30);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(x - 1, y - 1, radius + 2, radius + 23);
  ctx.drawImage(
    state.imageCanvas,
    imagePoint.x,
    imagePoint.y,
    sourceSize,
    sourceSize,
    x,
    y,
    radius,
    radius,
  );
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= sourceSize; i += 1) {
    ctx.beginPath();
    ctx.moveTo(x + i * pixel, y);
    ctx.lineTo(x + i * pixel, y + radius);
    ctx.moveTo(x, y + i * pixel);
    ctx.lineTo(x + radius, y + i * pixel);
    ctx.stroke();
  }
  ctx.strokeStyle = "#45d0a0";
  const center = Math.floor(sourceSize / 2) * pixel;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + center, y + center, pixel, pixel);
  ctx.fillStyle = "#f5f7fa";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(state.currentColor?.hex ?? "-", x + 6, y + radius + 16);
  ctx.restore();
}

function render() {
  const size = screenSize();
  ctx.clearRect(0, 0, size.width, size.height);
  drawImage();
  drawMeasurements();
  drawRulers();
  drawGuides();
  drawSwatches();
  if (state.hoverScreen) drawLoupe(state.hoverScreen);
}

function pointerDown(event) {
  if (!state.image) return;
  canvas.setPointerCapture(event.pointerId);
  const screenPoint = eventPoint(event);
  const imagePoint = toImagePoint(screenPoint);

  if (state.spacePressed || event.button === 1) {
    state.drag = { type: "pan", start: screenPoint, viewport: { ...state.viewport } };
    return;
  }

  const swatch = swatchHit(screenPoint);
  if (swatch) {
    state.selectedId = swatch.item.id;
    state.currentColor = {
      ...swatch.item.rgb,
      a: 255,
      hex: swatch.item.hex,
    };
    copyHex(swatch.item.hex);
    updateStatus();
    render();
    return;
  }

  const selectedHandle = hitSelectedHandle(screenPoint);
  if (
    selectedHandle &&
    (state.tool === "select" || state.tool === "rect" || state.tool === "distance")
  ) {
    state.selectedId = selectedHandle.item.id;
    state.drag = {
      type: selectedHandle.type,
      item: selectedHandle.item,
      handle: selectedHandle.handle,
      cursor: selectedHandle.cursor,
      start: imagePoint,
      original: structuredClone(selectedHandle.item),
    };
    render();
    return;
  }

  const selectedBody = hitSelectedMeasurementBody(screenPoint);
  if (
    selectedBody &&
    (state.tool === "select" || state.tool === "rect" || state.tool === "distance")
  ) {
    state.selectedId = selectedBody.item.id;
    state.drag = {
      type: "measurement",
      item: selectedBody.item,
      cursor: selectedBody.cursor,
      start: imagePoint,
      original: structuredClone(selectedBody.item),
    };
    render();
    return;
  }

  const ruler = rulerHit(screenPoint);
  if (ruler?.type === "ruler") {
    setTool("guide");
    const guide = {
      id: uid(),
      type: "guide",
      orientation: ruler.orientation,
      value: ruler.orientation === "vertical" ? imagePoint.x : imagePoint.y,
    };
    state.guides.push(guide);
    state.selectedId = guide.id;
    state.drag = { type: "guide", item: guide, start: imagePoint, original: structuredClone(guide), created: true };
    render();
    return;
  }

  if (state.tool === "select") {
    const hit = hitTest(screenPoint);
    state.selectedId = hit?.item.id ?? null;
    if (hit) {
      state.selectedId = hit.item.id;
      state.drag = {
        type: hit.type,
        item: hit.item,
        handle: hit.handle,
        cursor: hit.cursor,
        start: imagePoint,
        original: structuredClone(hit.item),
      };
    }
    render();
    return;
  }

  if (state.tool === "rect" && imageBoundsContain(imagePoint)) {
    const snappedPoint = snapPointToGuides(imagePoint);
    state.draft = { id: "draft", type: "rect", x: snappedPoint.x, y: snappedPoint.y, w: 0, h: 0 };
    state.drag = { type: "drawRect", start: snappedPoint };
  }

  if (state.tool === "distance" && imageBoundsContain(imagePoint)) {
    const snappedPoint = snapPointToGuides(imagePoint);
    if (!state.draft) {
      state.draft = { id: "draft", type: "distance", a: snappedPoint, b: snappedPoint };
    } else {
      state.draft.b = event.shiftKey ? snapDistanceEnd(state.draft.a, snappedPoint) : snappedPoint;
      state.draft.id = uid();
      state.measurements.push(state.draft);
      state.selectedId = state.draft.id;
      state.draft = null;
      persist();
    }
  }

  if (state.tool === "eyedropper" && imageBoundsContain(imagePoint)) {
    state.currentColor = getPixelColor(imagePoint);
    if (state.currentColor) {
      const swatch = addSwatch(state.currentColor, imagePoint);
      copyHex(swatch.hex);
    }
    updateStatus();
  }

  render();
}

function pointerMove(event) {
  const screenPoint = eventPoint(event);
  const imagePoint = toImagePoint(screenPoint);
  state.hoverScreen = screenPoint;
  state.hoverImage = imagePoint;
  updateCanvasCursor(screenPoint);
  if (state.tool === "eyedropper") {
    state.currentColor = getPixelColor(imagePoint);
  }

  if (state.drag?.type === "pan") {
    state.viewport.x = state.drag.viewport.x + screenPoint.x - state.drag.start.x;
    state.viewport.y = state.drag.viewport.y + screenPoint.y - state.drag.start.y;
  }

  if (state.drag?.type === "drawRect" && state.draft) {
    const snappedPoint = snapPointToGuides(imagePoint);
    state.draft.w = snappedPoint.x - state.drag.start.x;
    state.draft.h = snappedPoint.y - state.drag.start.y;
  }

  if (state.draft?.type === "distance") {
    const snappedPoint = snapPointToGuides(imagePoint);
    state.draft.b = event.shiftKey ? snapDistanceEnd(state.draft.a, snappedPoint) : snappedPoint;
  }

  if (state.drag?.type === "measurement") {
    const dx = imagePoint.x - state.drag.start.x;
    const dy = imagePoint.y - state.drag.start.y;
    const item = state.drag.item;
    if (item.type === "rect") {
      const snappedDelta = snapMovedRect(state.drag.original, dx, dy);
      item.x = state.drag.original.x + snappedDelta.dx;
      item.y = state.drag.original.y + snappedDelta.dy;
    } else {
      const a = snapPointToGuides({ x: state.drag.original.a.x + dx, y: state.drag.original.a.y + dy });
      const snappedDx = a.x - state.drag.original.a.x;
      const snappedDy = a.y - state.drag.original.a.y;
      item.a = { x: state.drag.original.a.x + snappedDx, y: state.drag.original.a.y + snappedDy };
      item.b = { x: state.drag.original.b.x + snappedDx, y: state.drag.original.b.y + snappedDy };
    }
  }

  if (state.drag?.type === "rectHandle") {
    applyRectHandle(state.drag.item, state.drag.handle, state.drag.original, snapPointToGuides(imagePoint));
  }

  if (state.drag?.type === "distanceHandle") {
    const item = state.drag.item;
    const other = state.drag.handle === "a" ? item.b : item.a;
    const snappedPoint = snapPointToGuides(imagePoint);
    item[state.drag.handle] = event.shiftKey ? snapDistanceEnd(other, snappedPoint) : snappedPoint;
  }

  if (state.drag?.type === "guide") {
    const guide = state.drag.item;
    guide.value = guide.orientation === "vertical" ? imagePoint.x : imagePoint.y;
  }

  updateStatus();
  render();
}

function pointerUp() {
  const endingDrag = state.drag;
  if (state.drag?.type === "drawRect" && state.draft) {
    const rect = normalizedRect(state.draft);
    if (rect.w >= 1 || rect.h >= 1) {
      state.draft = { id: uid(), type: "rect", ...rect };
      state.measurements.push(state.draft);
      state.selectedId = state.draft.id;
      persist();
    }
    state.draft = null;
  }
  if (state.drag?.type === "guide" && !guideIsInsideImage(state.drag.item)) {
    const removedId = state.drag.item.id;
    state.guides = state.guides.filter((guide) => guide.id !== removedId);
    if (state.selectedId === removedId) state.selectedId = null;
  }
  if (
    state.drag?.type === "measurement" ||
    state.drag?.type === "guide" ||
    state.drag?.type === "rectHandle" ||
    state.drag?.type === "distanceHandle"
  ) {
    persist();
  }
  state.drag = null;
  if (endingDrag) updateCanvasCursor(state.hoverScreen ?? { x: 0, y: 0 });
  render();
}

function wheel(event) {
  if (!state.image) return;
  event.preventDefault();
  const screenPoint = eventPoint(event);
  if (event.metaKey || event.ctrlKey || event.altKey) {
    const factor = Math.exp(-event.deltaY * 0.002);
    zoomAt(screenPoint, state.viewport.scale * factor);
  } else {
    state.viewport.x -= event.deltaX;
    state.viewport.y -= event.deltaY;
    render();
  }
}

function keyDown(event) {
  if (event.code === "Space") {
    state.spacePressed = true;
    canvas.style.cursor = "grab";
  }
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (mod && event.key === "0") {
    event.preventDefault();
    fitToScreen();
  } else if (mod && event.key === "1") {
    event.preventDefault();
    setActualZoom();
  } else if (event.key === "Escape") {
    cancelAction();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelected();
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    const keyMap = { v: "select", r: "rect", d: "distance", i: "eyedropper" };
    const nextTool = keyMap[event.key.toLowerCase()];
    if (nextTool) setTool(nextTool);
  }
}

function keyUp(event) {
  if (event.code === "Space") {
    state.spacePressed = false;
    canvas.style.cursor = "";
  }
}

elements.openButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => loadImageFile(event.target.files?.[0]));
elements.toolButtons.forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
elements.zoomOut.addEventListener("click", () => {
  const size = screenSize();
  zoomAt({ x: size.width / 2, y: size.height / 2 }, state.viewport.scale / 1.25);
});
elements.zoomIn.addEventListener("click", () => {
  const size = screenSize();
  zoomAt({ x: size.width / 2, y: size.height / 2 }, state.viewport.scale * 1.25);
});
elements.zoomActual.addEventListener("click", setActualZoom);
elements.zoomFit.addEventListener("click", fitToScreen);
elements.clearMeasurements.addEventListener("click", () => {
  state.measurements = [];
  state.guides = [];
  state.selectedId = null;
  state.draft = null;
  state.drag = null;
  state.currentColor = null;
  persist();
  updateStatus();
  render();
});
elements.exportJson.addEventListener("click", exportMeasurements);
elements.importJson.addEventListener("click", () => elements.jsonInput.click());
elements.jsonInput.addEventListener("change", (event) => importMeasurements(event.target.files?.[0]));
elements.recentProjectList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(".recent-project");
  if (!button?.dataset.projectId) return;
  reopenRecentProject(button.dataset.projectId);
});
elements.theoryWidth.addEventListener("input", () => {
  const value = Number(elements.theoryWidth.value);
  state.theoryWidth = Number.isFinite(value) && value > 0 ? value : null;
  persist();
  render();
});
elements.snapToGuides.addEventListener("change", () => {
  state.snapToGuides = elements.snapToGuides.checked;
  persist();
  render();
});
elements.colorInfo.addEventListener("click", async () => {
  if (state.currentColor) await navigator.clipboard.writeText(state.currentColor.hex);
});

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("is-dragover");
});
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragover"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragover");
  loadImageFile(event.dataTransfer.files?.[0]);
});

for (const eventName of ["dragenter", "dragover", "drop"]) {
  document.addEventListener(
    eventName,
    (event) => {
      event.preventDefault();
      if (eventName === "drop" && !elements.dropZone.contains(event.target)) {
        elements.dropZone.classList.remove("is-dragover");
        loadImageFile(event.dataTransfer?.files?.[0]);
      }
    },
    { capture: true },
  );
}

canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
canvas.addEventListener("wheel", wheel, { passive: false });
window.addEventListener("keydown", keyDown);
window.addEventListener("keyup", keyUp);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("paste", (event) => {
  const imageItem = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return;
  event.preventDefault();
  const extension = file.type.split("/")[1] || "png";
  loadImageBlob(file, `Pasted image ${new Date().toLocaleString("en-US")}.${extension}`);
});

state.recentProjects = readRecentProjects();
resizeCanvas();
updateStatus();
renderRecentProjects();
