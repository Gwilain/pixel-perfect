const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const elements = {
  dropZone: document.querySelector("#dropZone"),
  emptyState: document.querySelector("#emptyState"),
  recentProjects: document.querySelector("#recentProjects"),
  recentProjectList: document.querySelector("#recentProjectList"),
  fileInput: document.querySelector("#fileInput"),
  jsonInput: document.querySelector("#jsonInput"),
  newButton: document.querySelector("#newButton"),
  openButton: document.querySelector("#openButton"),
  captureButton: document.querySelector("#captureButton"),
  toolButtons: [...document.querySelectorAll(".tool")],
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  clearMeasurements: document.querySelector("#clearMeasurements"),
  applyCrop: document.querySelector("#applyCrop"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
  theoryWidth: document.querySelector("#theoryWidth"),
  theoryHeight: document.querySelector("#theoryHeight"),
  snapToGuides: document.querySelector("#snapToGuides"),
  pixelPerfectMode: document.querySelector("#pixelPerfectMode"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  colorSettings: [...document.querySelectorAll("[data-color-setting]")],
  loupeFrameSize: document.querySelector("#loupeFrameSize"),
  loupeFrameSizeValue: document.querySelector("#loupeFrameSizeValue"),
  smartGuides: document.querySelector("#smartGuides"),
  resetSettings: document.querySelector("#resetSettings"),
  imageInfo: document.querySelector("#imageInfo"),
  zoomInfo: document.querySelector("#zoomInfo"),
  cursorInfo: document.querySelector("#cursorInfo"),
  colorInfo: document.querySelector("#colorInfo"),
  hintInfo: document.querySelector("#hintInfo"),
};

const DEFAULT_SETTINGS = {
  rect: "#F4C95D",
  rectSelected: "#45D0A0",
  distance: "#D98CFF",
  distanceSelected: "#45D0A0",
  guide: "#00D4FF",
  guideSelected: "#FF3D8B",
  loupeFrameSize: 17,
  smartGuides: true,
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
  hoverSnapPoint: null,
  currentColor: null,
  copyToast: null,
  draft: null,
  drag: null,
  smartGuides: [],
  spacePressed: false,
  theoryWidth: null,
  theoryHeight: null,
  snapToGuides: true,
  pixelPerfectMode: true,
  settings: { ...DEFAULT_SETTINGS },
  recentProjects: [],
  crop: null,
};

state.imageCtx = state.imageCanvas.getContext("2d", { willReadFrequently: true });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const round = (value) => Math.round(value * 100) / 100;
const smartRound = (value) => (Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : round(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isMac = navigator.platform.toLowerCase().includes("mac");
const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(value);
const RULER_SIZE = 12;
const HANDLE_SIZE = 8;
const SWATCH_SIZE = 28;
const SWATCH_GAP = 6;
const SNAP_DISTANCE = 8;
const SETTINGS_KEY = "pixel-perfect:settings";
const RECENT_PROJECTS_KEY = "pixel-perfect:recent-projects";
const DB_NAME = "pixel-perfect-db";
const DB_VERSION = 1;
const UNDO_LIMIT = 40;
const undoStack = [];

function colorAlpha(hex, alpha) {
  if (!isHexColor(hex)) return `rgba(244, 201, 93, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readSettings() {
  try {
    const payload = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    const colorSettings = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS)
        .filter(([, fallback]) => typeof fallback === "string")
        .map(([key, fallback]) => [
          key,
          isHexColor(payload[key]) ? payload[key].toUpperCase() : fallback,
        ]),
    );
    const loupeFrameSize = Number(payload.loupeFrameSize);
    return {
      ...colorSettings,
      loupeFrameSize: Number.isFinite(loupeFrameSize) ? clamp(Math.round(loupeFrameSize), 17, 37) : DEFAULT_SETTINGS.loupeFrameSize,
      smartGuides: typeof payload.smartGuides === "boolean" ? payload.smartGuides : DEFAULT_SETTINGS.smartGuides,
    };
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  syncSettingsControls();
  render();
}

function cloneStateValue(value) {
  return value == null ? value : structuredClone(value);
}

function createUndoSnapshot(imageBlob = null) {
  return {
    imageBlob,
    imageName: state.imageName,
    imageSignature: state.imageSignature,
    measurements: cloneStateValue(state.measurements) ?? [],
    guides: cloneStateValue(state.guides) ?? [],
    swatches: cloneStateValue(state.swatches) ?? [],
    crop: cloneStateValue(state.crop),
    selectedId: state.selectedId,
    currentColor: cloneStateValue(state.currentColor),
    viewport: { ...state.viewport },
    theoryWidth: state.theoryWidth,
    theoryHeight: state.theoryHeight,
    snapToGuides: state.snapToGuides,
    pixelPerfectMode: state.pixelPerfectMode,
  };
}

function pushUndoSnapshot(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function pushUndo() {
  pushUndoSnapshot(createUndoSnapshot());
}

function pushExistingUndo(snapshot) {
  if (snapshot) pushUndoSnapshot(snapshot);
}

function hasChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function pushUndoWithImage() {
  const imageBlob = state.image ? await canvasToBlob(state.imageCanvas) : null;
  if (state.image && !imageBlob) return;
  pushUndoSnapshot(createUndoSnapshot(imageBlob));
}

async function pushUndoBeforeImageChange() {
  if (state.image) await pushUndoWithImage();
}

function syncSettingsControls() {
  for (const input of elements.colorSettings) {
    input.value = state.settings[input.dataset.colorSetting] ?? DEFAULT_SETTINGS[input.dataset.colorSetting];
  }
  elements.loupeFrameSize.value = state.settings.loupeFrameSize;
  elements.loupeFrameSizeValue.textContent = `${state.settings.loupeFrameSize}px view`;
  elements.smartGuides.checked = state.settings.smartGuides;
}

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

function syncToolButtons() {
  elements.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === state.tool);
  });
}

function setTool(tool) {
  const previousTool = state.tool;
  state.tool = tool;
  state.draft = null;
  state.drag = null;
  state.smartGuides = [];
  state.hoverSnapPoint = null;
  if (previousTool === "crop" && tool !== "crop" && state.selectedId === state.crop?.id) {
    state.selectedId = null;
  }
  if (tool === "crop") {
    ensureCrop();
    if (state.crop) state.selectedId = state.crop.id;
  }
  syncToolButtons();
  if (state.hoverScreen) updateCanvasCursor(state.hoverScreen);
  render();
}

function ensureCrop() {
  if (!state.image || state.crop) return;
  state.crop = {
    id: "crop",
    type: "rect",
    x: 0,
    y: 0,
    w: state.image.width,
    h: state.image.height,
  };
}

function normalizedCrop(rect) {
  if (!state.image || !rect) return null;
  const crop = normalizedRect(rect);
  const x = clamp(Math.round(crop.x), 0, state.image.width - 1);
  const y = clamp(Math.round(crop.y), 0, state.image.height - 1);
  const w = clamp(Math.round(crop.w), 1, state.image.width - x);
  const h = clamp(Math.round(crop.h), 1, state.image.height - y);
  return { id: "crop", type: "rect", x, y, w, h };
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

function zoomAroundCenter(nextScale) {
  const size = screenSize();
  zoomAt({ x: size.width / 2, y: size.height / 2 }, nextScale);
}

function applyZoomInput() {
  if (!state.image) {
    updateStatus();
    return;
  }
  const value = Number(elements.zoomInfo.value.replace("%", "").trim());
  if (!Number.isFinite(value) || value <= 0) {
    updateStatus();
    return;
  }
  zoomAroundCenter(value / 100);
}

function getScaleFactor() {
  if (!state.image) return 1;
  if (state.theoryWidth) return state.theoryWidth / state.image.width;
  if (state.theoryHeight) return state.theoryHeight / state.image.height;
  return 1;
}

function syncTheoryInputs(source = null) {
  if (!state.image) {
    elements.theoryWidth.value = state.theoryWidth ?? "";
    elements.theoryHeight.value = state.theoryHeight ?? "";
    return;
  }

  if (source === "height" && state.theoryHeight) {
    state.theoryWidth = state.theoryHeight * state.image.width / state.image.height;
  } else if (state.theoryWidth) {
    state.theoryHeight = state.theoryWidth * state.image.height / state.image.width;
  } else if (state.theoryHeight) {
    state.theoryWidth = state.theoryHeight * state.image.width / state.image.height;
  }

  elements.theoryWidth.value = state.theoryWidth ? smartRound(state.theoryWidth) : "";
  elements.theoryHeight.value = state.theoryHeight ? smartRound(state.theoryHeight) : "";
}

function formatMeasureValue(value) {
  const scaled = value * getScaleFactor();
  return `${smartRound(scaled)} px`;
}

function formatCoord(value) {
  return smartRound(value * getScaleFactor());
}

