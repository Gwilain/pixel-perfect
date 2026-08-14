// Viewport, zoom and tool selection.
//
// These used to live in core.js, which forced the lowest layer to call back into
// rendering and interaction. They are application-level operations: they mutate
// state and then ask for a repaint. Keeping them here lets core.js stay a leaf.

const ZOOM_MIN = 0.02;
const ZOOM_MAX = 64;
const FIT_PADDING = 48;

function writeSettings(settings) {
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  writeStorageValue(SETTINGS_KEY, JSON.stringify(state.settings));
  syncSettingsControls();
  render();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Resizing the backing store clears it, so repaint synchronously to avoid a blank frame.
  renderNow();
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

function fitToScreen() {
  if (!state.image) return;
  const size = screenSize();
  const scale = Math.min(
    (size.width - RULER_SIZE - FIT_PADDING) / state.image.width,
    (size.height - RULER_SIZE - FIT_PADDING) / state.image.height,
  );
  state.viewport.scale = clamp(scale, ZOOM_MIN, ZOOM_MAX);
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
  const scale = clamp(nextScale, ZOOM_MIN, ZOOM_MAX);
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
