const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const elements = {
  dropZone: document.querySelector("#dropZone"),
  emptyState: document.querySelector("#emptyState"),
  containersPanel: document.querySelector(".containers-panel"),
  toggleContainers: document.querySelector("#toggleContainers"),
  containerList: document.querySelector("#containerList"),
  geometryInputs: {
    x: document.querySelector("#geometryX"),
    y: document.querySelector("#geometryY"),
    w: document.querySelector("#geometryW"),
    h: document.querySelector("#geometryH"),
  },
  geometryUnit: document.querySelector("#geometryUnit"),
  radiusInputs: {
    tl: document.querySelector("#radiusTl"),
    tr: document.querySelector("#radiusTr"),
    br: document.querySelector("#radiusBr"),
    bl: document.querySelector("#radiusBl"),
  },
  radiusModeButtons: [...document.querySelectorAll("[data-radius-mode]")],
  paddingInputs: {
    top: document.querySelector("#paddingTop"),
    right: document.querySelector("#paddingRight"),
    bottom: document.querySelector("#paddingBottom"),
    left: document.querySelector("#paddingLeft"),
  },
  toggleAutoPadding: document.querySelector("#toggleAutoPadding"),
  paddingModeButtons: [...document.querySelectorAll("[data-padding-mode]")],
  swatchList: document.querySelector("#swatchList"),
  swatchMessage: document.querySelector("#swatchMessage"),
  propertyCode: document.querySelector("#propertyCode"),
  copyProperties: document.querySelector("#copyProperties"),
  recentProjects: document.querySelector("#recentProjects"),
  recentProjectList: document.querySelector("#recentProjectList"),
  fileInput: document.querySelector("#fileInput"),
  newButton: document.querySelector("#newButton"),
  openButton: document.querySelector("#openButton"),
  saveButton: document.querySelector("#saveButton"),
  captureButton: document.querySelector("#captureButton"),
  toolButtons: [...document.querySelectorAll(".tool")],
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  clearMeasurements: document.querySelector("#clearMeasurements"),
  applyCrop: document.querySelector("#applyCrop"),
  theoryWidth: document.querySelector("#theoryWidth"),
  theoryHeight: document.querySelector("#theoryHeight"),
  displayUnit: document.querySelector("#displayUnit"),
  snapToGuides: document.querySelector("#snapToGuides"),
  pixelPerfectMode: document.querySelector("#pixelPerfectMode"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  colorSettings: [...document.querySelectorAll("[data-color-setting]")],
  loupeFrameSize: document.querySelector("#loupeFrameSize"),
  loupeFrameSizeValue: document.querySelector("#loupeFrameSizeValue"),
  remBase: document.querySelector("#remBase"),
  smartGuides: document.querySelector("#smartGuides"),
  resetSettings: document.querySelector("#resetSettings"),
  saveInfo: document.querySelector("#saveInfo"),
  imageInfo: document.querySelector("#imageInfo"),
  zoomInfo: document.querySelector("#zoomInfo"),
  cursorInfo: document.querySelector("#cursorInfo"),
  colorInfo: document.querySelector("#colorInfo"),
  hintInfo: document.querySelector("#hintInfo"),
  infoButton: document.querySelector("#infoButton"),
  infoOverlay: document.querySelector("#infoOverlay"),
  closeInfo: document.querySelector("#closeInfo"),
  captureOverlay: document.querySelector("#captureOverlay"),
  startCapture: document.querySelector("#startCapture"),
  cancelCapture: document.querySelector("#cancelCapture"),
  clearOverlay: document.querySelector("#clearOverlay"),
  confirmClear: document.querySelector("#confirmClear"),
  cancelClear: document.querySelector("#cancelClear"),
  unsavedOverlay: document.querySelector("#unsavedOverlay"),
  saveUnsaved: document.querySelector("#saveUnsaved"),
  discardUnsaved: document.querySelector("#discardUnsaved"),
  cancelUnsaved: document.querySelector("#cancelUnsaved"),
  recoveredOverlay: document.querySelector("#recoveredOverlay"),
  restoreRecovered: document.querySelector("#restoreRecovered"),
  keepFileVersion: document.querySelector("#keepFileVersion"),
  dismissRecovered: document.querySelector("#dismissRecovered"),
};

const DEFAULT_SETTINGS = {
  rect: "#F4C95D",
  rectSelected: "#45D0A0",
  distance: "#D98CFF",
  distanceSelected: "#45D0A0",
  guide: "#00D4FF",
  guideSelected: "#FF3D8B",
  loupeCenter: "#45D0A0",
  loupeFrameSize: 17,
  remBase: 16,
  smartGuides: true,
};

const DISPLAY_UNITS = new Set(["px", "rem", "percent", "viewport"]);
const RADIUS_MODES = new Set(["all", "free"]);
const PADDING_MODES = new Set(["all", "axis", "free"]);

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
  swatchCopyMessage: null,
  hoverImage: null,
  hoverSnapPoint: null,
  hoverScreen: null,
  currentColor: null,
  draft: null,
  drag: null,
  smartGuides: [],
  spacePressed: false,
  theoryWidth: null,
  theoryHeight: null,
  displayUnit: "px",
  snapToGuides: true,
  pixelPerfectMode: true,
  settings: { ...DEFAULT_SETTINGS },
  recentProjects: [],
  crop: null,
  // The project file this session is bound to, when the browser can give us one.
  // Without it, saving falls back to a download and every save makes a new copy.
  fileHandle: null,
  fileName: "",
  isDirty: false,
};

state.imageCtx = state.imageCanvas.getContext("2d", { willReadFrequently: true });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const round = (value) => Math.round(value * 100) / 100;
const smartRound = (value) => (Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : round(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isMac = navigator.platform.toLowerCase().includes("mac");
const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(value);
const RULER_SIZE = 14;
const HANDLE_SIZE = 8;
const SNAP_DISTANCE = 8;
const SETTINGS_KEY = "pixel-perfect:settings";
const RECENT_PROJECTS_KEY = "pixel-perfect:recent-projects";
const CONTAINERS_COLLAPSED_KEY = "pixel-perfect:containers-collapsed";
const MEASURE_KEY_PREFIX = "pixel-perfect:measure:";
const LEGACY_MEASURE_KEY_PREFIX = "pixel-measure:";
const MEASURE_LIMIT = 20;
// A recent backed by a file handle costs a pointer (~1.4KB measured); one
// backed by an image blob costs a full copy in IndexedDB (~70KB for a 1080p
// screenshot, measured). Even 6 of the latter is well under a megabyte, so one
// small cap for both kinds is simpler than juggling two, and it is also what
// keeps the recents grid to two clean rows of three.
const RECENT_LIMIT = 6;
const DB_NAME = "pixel-perfect-db";
const DB_VERSION = 1;
const UNDO_LIMIT = 40;
const undoStack = [];

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function colorAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(isHexColor(hex) ? hex : DEFAULT_SETTINGS.rect);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// localStorage. Saved projects are the only store that grows without bound, so
// they are both capped and the first thing dropped when the quota is reached.
// ---------------------------------------------------------------------------

function measureKey(signature = state.imageSignature) {
  return `${MEASURE_KEY_PREFIX}${signature}`;
}

function legacyMeasureKey(signature = state.imageSignature) {
  return `${LEGACY_MEASURE_KEY_PREFIX}${signature}`;
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED" || error?.code === 22;
}

function measureKeys() {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(MEASURE_KEY_PREFIX) || key?.startsWith(LEGACY_MEASURE_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function measureTimestamp(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}").updatedAt ?? 0;
  } catch {
    return 0;
  }
}

function measureKeysByAge() {
  return measureKeys()
    .map((key) => ({ key, updatedAt: measureTimestamp(key) }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

// Returns false instead of throwing: a failed save must never interrupt an edit.
function writeStorageValue(key, value) {
  let evictable = null;
  for (;;) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      if (!isQuotaError(error)) return false;
      evictable ??= measureKeysByAge().filter((entry) => entry.key !== key);
      const oldest = evictable.shift();
      if (!oldest) return false;
      localStorage.removeItem(oldest.key);
    }
  }
}

function trimStoredProjects() {
  const entries = measureKeysByAge();
  for (const entry of entries.slice(0, Math.max(0, entries.length - MEASURE_LIMIT))) {
    localStorage.removeItem(entry.key);
  }
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
    const remBase = Number(payload.remBase);
    return {
      ...colorSettings,
      loupeFrameSize: Number.isFinite(loupeFrameSize) ? clamp(Math.round(loupeFrameSize), 17, 37) : DEFAULT_SETTINGS.loupeFrameSize,
      remBase: Number.isFinite(remBase) && remBase > 0 ? clamp(Math.round(remBase * 100) / 100, 1, 100) : DEFAULT_SETTINGS.remBase,
      smartGuides: typeof payload.smartGuides === "boolean" ? payload.smartGuides : DEFAULT_SETTINGS.smartGuides,
    };
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS };
  }
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
    displayUnit: state.displayUnit,
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
  elements.remBase.value = state.settings.remBase;
  elements.smartGuides.checked = state.settings.smartGuides;
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

// ---------------------------------------------------------------------------
// Rect geometry. Pure functions of their arguments (plus pixelPerfectMode for
// snapping), so they belong to the leaf layer rather than to project I/O.
// ---------------------------------------------------------------------------

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

function constrainDrawRect(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    w: Math.sign(dx || 1) * size,
    h: Math.sign(dy || 1) * size,
  };
}

function constrainRectToRatio(left, top, right, bottom, original, handle, fromCenter) {
  const originalRect = normalizedRect(original);
  if (!originalRect.w || !originalRect.h) return { left, top, right, bottom };

  const ratio = originalRect.w / originalRect.h;
  let width = Math.max(0, right - left);
  let height = Math.max(0, bottom - top);

  if (handle.includes("w") || handle.includes("e")) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }

  if (fromCenter) {
    const centerX = originalRect.x + originalRect.w / 2;
    const centerY = originalRect.y + originalRect.h / 2;
    return {
      left: centerX - width / 2,
      right: centerX + width / 2,
      top: centerY - height / 2,
      bottom: centerY + height / 2,
    };
  }

  if (handle.includes("w")) left = right - width;
  else right = left + width;

  if (handle.includes("n")) top = bottom - height;
  else bottom = top + height;

  return { left, top, right, bottom };
}

function snapPointToPixel(point) {
  if (!state.pixelPerfectMode) return point;
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function snapGuideValue(value) {
  return state.pixelPerfectMode ? Math.round(value) : value;
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

function getScaleFactor() {
  if (!state.image) return 1;
  if (state.theoryWidth) return state.theoryWidth / state.image.width;
  if (state.theoryHeight) return state.theoryHeight / state.image.height;
  return 1;
}

function getImageBasis(axis = "x", item = null) {
  const basisRect = getBasisRect(item);
  if (basisRect) {
    if (axis === "y") return basisRect.h;
    if (axis === "diagonal") return Math.hypot(basisRect.w, basisRect.h);
    return basisRect.w;
  }
  if (!state.image) return 1;
  if (axis === "y") return state.image.height;
  if (axis === "diagonal") return Math.hypot(state.image.width, state.image.height);
  return state.image.width;
}

function normalizeDisplayUnit(unit) {
  if (unit === "vw" || unit === "vh") return "viewport";
  return DISPLAY_UNITS.has(unit) ? unit : "px";
}

function normalizeItemUnit(unit) {
  if (unit === "inherit" || unit == null) return "inherit";
  return normalizeDisplayUnit(unit);
}

function normalizeRadiusMode(mode) {
  return RADIUS_MODES.has(mode) ? mode : "all";
}

function normalizePaddingMode(mode) {
  return PADDING_MODES.has(mode) ? mode : "all";
}

function getMeasurementById(id) {
  return state.measurements.find((item) => item.id === id) ?? null;
}

function isRectMeasurement(item) {
  return item?.type === "rect";
}

function canContainMeasurement(item) {
  return isRectMeasurement(item);
}

function isMeasurementVisible(item) {
  return item?.visible !== false;
}

function isMeasurementLocked(item) {
  return item?.locked === true;
}

function isMeasurementViewportEditable(item) {
  return isMeasurementVisible(item) && !isMeasurementLocked(item);
}

function effectiveDisplayUnit(item = null) {
  const itemUnit = normalizeItemUnit(item?.unit);
  return itemUnit === "inherit" ? normalizeDisplayUnit(state.displayUnit) : itemUnit;
}

function layoutPadding(item) {
  const value = item?.padding;
  return {
    top: Number.isFinite(value?.top) ? Math.max(0, value.top) : 0,
    right: Number.isFinite(value?.right) ? Math.max(0, value.right) : 0,
    bottom: Number.isFinite(value?.bottom) ? Math.max(0, value.bottom) : 0,
    left: Number.isFinite(value?.left) ? Math.max(0, value.left) : 0,
  };
}

function rectContentBox(item) {
  const rect = normalizedRect(item);
  const padding = layoutPadding(item);
  return {
    x: rect.x + padding.left,
    y: rect.y + padding.top,
    w: Math.max(0, rect.w - padding.left - padding.right),
    h: Math.max(0, rect.h - padding.top - padding.bottom),
  };
}

function getParentRect(item) {
  if (!item?.parentId) return null;
  const parent = getMeasurementById(item.parentId);
  return isRectMeasurement(parent) ? rectContentBox(parent) : null;
}

function getBasisRect(item = null) {
  return getParentRect(item);
}

function sanitizeMeasurementTree() {
  const ids = new Set(state.measurements.map((item) => item.id));
  for (const item of state.measurements) {
    item.unit = normalizeItemUnit(item.unit);
    item.visible = item.visible !== false;
    item.locked = item.locked === true;
    if (item.type === "rect") {
      item.radiusMode = normalizeRadiusMode(item.radiusMode);
      item.paddingMode = normalizePaddingMode(item.paddingMode);
    }
    if (!item.parentId || !ids.has(item.parentId) || item.parentId === item.id) {
      item.parentId = null;
      continue;
    }
    let parent = getMeasurementById(item.parentId);
    const seen = new Set([item.id]);
    while (parent) {
      if (!canContainMeasurement(parent) || seen.has(parent.id)) {
        item.parentId = null;
        break;
      }
      seen.add(parent.id);
      parent = parent.parentId ? getMeasurementById(parent.parentId) : null;
    }
  }
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function sanitizeMeasurements(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => {
    if (!item || typeof item.id !== "string") return false;
    if (item.type === "rect") {
      return Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.w) && Number.isFinite(item.h);
    }
    if (item.type === "distance") return isFinitePoint(item.a) && isFinitePoint(item.b);
    return false;
  });
}

function sanitizeGuides(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (guide) =>
      guide &&
      typeof guide.id === "string" &&
      (guide.orientation === "vertical" || guide.orientation === "horizontal") &&
      Number.isFinite(guide.value),
  );
}

function sanitizeSwatches(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((swatch) => swatch && typeof swatch.id === "string" && isHexColor(swatch.hex))
    .map((swatch) => ({ ...swatch, hex: swatch.hex.toUpperCase(), rgb: hexToRgb(swatch.hex) }));
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

// ---------------------------------------------------------------------------
// Unit conversion. Single source of truth: everything that shows or reads a
// length goes through these four functions. Canvas labels, CSS output and the
// panel fields only differ in how they format the result, never in how they
// convert it.
// ---------------------------------------------------------------------------

function viewportBasis(axis = "x") {
  return axis === "y" ? state.image.height : state.image.width;
}

// Image-space length -> display unit of `item`.
function toDisplayValue(value, axis = "x", item = null) {
  if (!state.image) return value;
  const unit = effectiveDisplayUnit(item);
  if (unit === "rem") return (value * getScaleFactor()) / state.settings.remBase;
  if (unit === "percent") return (value / getImageBasis(axis, item)) * 100;
  if (unit === "viewport") return (value / viewportBasis(axis)) * 100;
  return value * getScaleFactor();
}

// Display unit of `item` -> image-space length. Inverse of toDisplayValue.
function fromDisplayValue(value, axis = "x", item = null) {
  if (!state.image) return value;
  const unit = effectiveDisplayUnit(item);
  if (unit === "rem") return (value * state.settings.remBase) / getScaleFactor();
  if (unit === "percent") return (value / 100) * getImageBasis(axis, item);
  if (unit === "viewport") return (value / 100) * viewportBasis(axis);
  return value / getScaleFactor();
}

// Coordinates are the same conversion, relative to the parent content box.
function parentOrigin(axis = "x", item = null) {
  const parent = getParentRect(item);
  if (!parent) return 0;
  return axis === "y" ? parent.y : parent.x;
}

function toDisplayCoord(value, axis = "x", item = null) {
  return toDisplayValue(value - parentOrigin(axis, item), axis, item);
}

function fromDisplayCoord(value, axis = "x", item = null) {
  return fromDisplayValue(value, axis, item) + parentOrigin(axis, item);
}

function displayUnitSuffix(axis = "x", item = null) {
  if (!state.image) return "px";
  const unit = effectiveDisplayUnit(item);
  if (unit === "rem") return "rem";
  if (unit === "percent") return "%";
  if (unit === "viewport") return axis === "y" ? "vh" : "vw";
  return "px";
}

// Shared numeric rendering for CSS output and panel fields.
function displayNumber(value) {
  return String(smartRound(value)).replace(",", ".");
}

// Canvas labels: "12 px", "1.5 rem", "50%".
function formatWithUnit(shown, axis, item) {
  const suffix = displayUnitSuffix(axis, item);
  return suffix === "%" ? `${shown}%` : `${shown} ${suffix}`;
}

function formatMeasureValue(value, axis = "x", item = null) {
  return formatWithUnit(smartRound(toDisplayValue(value, axis, item)), axis, item);
}

function formatCoord(value, axis = "x", item = null) {
  return formatWithUnit(smartRound(toDisplayCoord(value, axis, item)), axis, item);
}
