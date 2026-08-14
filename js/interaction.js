function selectedMeasurement() {
  return state.measurements.find((item) => item.id === state.selectedId) ?? null;
}

function selectedCrop() {
  return state.tool === "crop" && state.crop?.id === state.selectedId ? state.crop : null;
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

function rectRadii(item) {
  const value = item?.radii;
  const single = Number.isFinite(item?.radius) ? item.radius : 0;
  return {
    tl: Number.isFinite(value?.tl) ? value.tl : single,
    tr: Number.isFinite(value?.tr) ? value.tr : single,
    br: Number.isFinite(value?.br) ? value.br : single,
    bl: Number.isFinite(value?.bl) ? value.bl : single,
  };
}

function rectPadding(item) {
  const value = item?.padding;
  return {
    top: Number.isFinite(value?.top) ? value.top : 0,
    right: Number.isFinite(value?.right) ? value.right : 0,
    bottom: Number.isFinite(value?.bottom) ? value.bottom : 0,
    left: Number.isFinite(value?.left) ? value.left : 0,
  };
}

function maxRectRadius(item) {
  const rect = normalizedRect(item);
  return Math.max(0, Math.min(rect.w, rect.h) / 2);
}

function clampRectPaddingValues(item, padding) {
  const rect = normalizedRect(item);
  const next = {
    top: Math.max(0, round(padding.top)),
    right: Math.max(0, round(padding.right)),
    bottom: Math.max(0, round(padding.bottom)),
    left: Math.max(0, round(padding.left)),
  };
  const horizontalScale = next.left + next.right > rect.w && next.left + next.right > 0
    ? rect.w / (next.left + next.right)
    : 1;
  const verticalScale = next.top + next.bottom > rect.h && next.top + next.bottom > 0
    ? rect.h / (next.top + next.bottom)
    : 1;
  next.left = round(next.left * horizontalScale);
  next.right = round(next.right * horizontalScale);
  next.top = round(next.top * verticalScale);
  next.bottom = round(next.bottom * verticalScale);
  return next;
}

function visualRadiusHandleOffset(item, corner) {
  const rect = normalizedRect(item);
  const maxRadius = maxRectRadius(item);
  const scale = Math.max(0.01, state.viewport.scale);
  const actual = rectRadii(item)[corner];
  if (actual > 0) return clamp(actual, 0, maxRadius);
  const fallback = 7 / scale;
  const fallbackMax = Math.min(maxRadius, Math.max(4 / scale, Math.min(rect.w, rect.h) * 0.2));
  return clamp(fallback, 0, fallbackMax);
}

function radiusHandlePoints(item) {
  const rect = normalizedRect(item);
  const offset = (corner) => visualRadiusHandleOffset(item, corner);
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  return [
    { name: "tl", point: { x: left + offset("tl"), y: top + offset("tl") }, cursor: "grab" },
    { name: "tr", point: { x: right - offset("tr"), y: top + offset("tr") }, cursor: "grab" },
    { name: "br", point: { x: right - offset("br"), y: bottom - offset("br") }, cursor: "grab" },
    { name: "bl", point: { x: left + offset("bl"), y: bottom - offset("bl") }, cursor: "grab" },
  ];
}

function paddingInnerRect(item) {
  const rect = normalizedRect(item);
  const padding = rectPadding(item);
  return {
    x: rect.x + padding.left,
    y: rect.y + padding.top,
    w: Math.max(0, rect.w - padding.left - padding.right),
    h: Math.max(0, rect.h - padding.top - padding.bottom),
    padding,
  };
}

function paddingHandleHit(item, screenPoint) {
  if (item.id === "crop" || item.type !== "rect") return null;
  const padding = rectPadding(item);
  if (!padding.top && !padding.right && !padding.bottom && !padding.left) return null;
  const imagePoint = toImagePoint(screenPoint);
  const inner = paddingInnerRect(item);
  const tolerance = Math.max(0.5, 7 / state.viewport.scale);
  const left = inner.x;
  const right = inner.x + inner.w;
  const top = inner.y;
  const bottom = inner.y + inner.h;
  if (imagePoint.x >= left - tolerance && imagePoint.x <= right + tolerance) {
    if (Math.abs(imagePoint.y - top) <= tolerance) return { type: "paddingHandle", item, handle: "top", cursor: "ns-resize" };
    if (Math.abs(imagePoint.y - bottom) <= tolerance) return { type: "paddingHandle", item, handle: "bottom", cursor: "ns-resize" };
  }
  if (imagePoint.y >= top - tolerance && imagePoint.y <= bottom + tolerance) {
    if (Math.abs(imagePoint.x - left) <= tolerance) return { type: "paddingHandle", item, handle: "left", cursor: "ew-resize" };
    if (Math.abs(imagePoint.x - right) <= tolerance) return { type: "paddingHandle", item, handle: "right", cursor: "ew-resize" };
  }
  return null;
}

function hitSelectedHandle(screenPoint) {
  const item = selectedMeasurement() ?? selectedCrop();
  if (!item) return null;
  if (item.id !== "crop" && !isMeasurementViewportEditable(item)) return null;
  const halfSize = HANDLE_SIZE / 2 + 3;

  if (item.type === "rect") {
    if (item.id !== "crop") {
      for (const handle of radiusHandlePoints(item)) {
        const screenHandle = toScreenPoint(handle.point);
        if (distance(screenPoint, screenHandle) <= halfSize + 2) {
          return { type: "radiusHandle", item, handle: handle.name, cursor: handle.cursor };
        }
      }
      const paddingHandle = paddingHandleHit(item, screenPoint);
      if (paddingHandle) return paddingHandle;
    }

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
  const item = selectedMeasurement() ?? selectedCrop();
  if (!item) return null;
  if (item.id !== "crop" && !isMeasurementViewportEditable(item)) return null;
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

function showCopyToast(text) {
  state.swatchCopyMessage = { text, until: performance.now() + 1300 };
  render();
  window.setTimeout(() => {
    if (state.swatchCopyMessage?.until <= performance.now()) {
      state.swatchCopyMessage = null;
      render();
    }
  }, 1350);
}

async function copyHex(hex) {
  try {
    await navigator.clipboard.writeText(hex);
    elements.hintInfo.textContent = `${hex} copied`;
    showCopyToast(`${hex} copied`);
  } catch {
    elements.hintInfo.textContent = `${hex} selected`;
    showCopyToast(`${hex} selected`);
  }
}

function addSwatch(color, imagePoint) {
  const existing = state.swatches.find((swatch) => swatch.hex.toUpperCase() === color.hex.toUpperCase());
  if (existing) {
    state.selectedId = existing.id;
    persist();
    render();
    return existing;
  }
  pushUndo();
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

function applyRectHandle(item, handle, original, imagePoint, options = {}) {
  const rect = normalizedRect(original);
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;

  if (options.fromCenter) {
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const halfWidth = handle.includes("w") || handle.includes("e")
      ? Math.abs(imagePoint.x - centerX)
      : rect.w / 2;
    const halfHeight = handle.includes("n") || handle.includes("s")
      ? Math.abs(imagePoint.y - centerY)
      : rect.h / 2;
    left = centerX - halfWidth;
    right = centerX + halfWidth;
    top = centerY - halfHeight;
    bottom = centerY + halfHeight;
  } else {
    if (handle.includes("w")) left = imagePoint.x;
    if (handle.includes("e")) right = imagePoint.x;
    if (handle.includes("n")) top = imagePoint.y;
    if (handle.includes("s")) bottom = imagePoint.y;
  }

  if (options.keepRatio) {
    ({ left, top, right, bottom } = constrainRectToRatio(left, top, right, bottom, original, handle, options.fromCenter));
  }

  const next = normalizedRect({ x: left, y: top, w: right - left, h: bottom - top });
  item.x = next.x;
  item.y = next.y;
  item.w = next.w;
  item.h = next.h;
}

function radiusFromPoint(item, corner, imagePoint) {
  const rect = normalizedRect(item);
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const dx = corner === "tr" || corner === "br" ? right - imagePoint.x : imagePoint.x - rect.x;
  const dy = corner === "bl" || corner === "br" ? bottom - imagePoint.y : imagePoint.y - rect.y;
  const radius = clamp(Math.min(dx, dy), 0, maxRectRadius(item));
  return state.pixelPerfectMode ? Math.round(radius) : round(radius);
}

function applyRadiusHandle(item, corner, original, imagePoint, options = {}) {
  const radius = radiusFromPoint(original, corner, imagePoint);
  const next = rectRadii(original);
  const singleCorner = options.singleCorner || normalizeRadiusMode(original.radiusMode) === "free";
  if (singleCorner) {
    next[corner] = radius;
    item.radiusMode = "free";
  } else {
    next.tl = radius;
    next.tr = radius;
    next.br = radius;
    next.bl = radius;
    item.radiusMode = "all";
  }
  item.radii = next;
}

function paddingFromPoint(original, side, imagePoint) {
  const rect = normalizedRect(original);
  const padding = rectPadding(original);
  if (side === "top") padding.top = clamp(imagePoint.y - rect.y, 0, rect.h - padding.bottom);
  if (side === "bottom") padding.bottom = clamp(rect.y + rect.h - imagePoint.y, 0, rect.h - padding.top);
  if (side === "left") padding.left = clamp(imagePoint.x - rect.x, 0, rect.w - padding.right);
  if (side === "right") padding.right = clamp(rect.x + rect.w - imagePoint.x, 0, rect.w - padding.left);
  return clampRectPaddingValues(original, padding);
}

function applyPaddingHandle(item, side, original, imagePoint) {
  const changed = paddingFromPoint(original, side, imagePoint);
  const mode = normalizePaddingMode(original.paddingMode);
  item.paddingMode = mode;
  if (mode === "all") {
    const value = changed[side];
    item.padding = clampRectPaddingValues(item, { top: value, right: value, bottom: value, left: value });
  } else if (mode === "axis") {
    const originalPadding = rectPadding(original);
    const vertical = side === "top" || side === "bottom" ? changed[side] : originalPadding.top;
    const horizontal = side === "left" || side === "right" ? changed[side] : originalPadding.right;
    item.padding = clampRectPaddingValues(item, { top: vertical, right: horizontal, bottom: vertical, left: horizontal });
  } else {
    item.padding = changed;
  }
}

function updateCanvasCursor(screenPoint) {
  if (state.spacePressed || state.drag?.type === "pan") {
    canvas.style.cursor = "grab";
    return;
  }
  if (state.drag?.type === "guide" || state.drag?.type === "distanceHandle" || state.drag?.type === "radiusHandle") {
    canvas.style.cursor = "move";
    return;
  }
  if (state.drag?.type === "rectHandle" || state.drag?.type === "paddingHandle") {
    canvas.style.cursor = state.drag.cursor;
    return;
  }
  const ruler = rulerHit(screenPoint);
  if (ruler?.orientation === "horizontal") {
    canvas.style.cursor = "ns-resize";
    return;
  }
  if (ruler?.orientation === "vertical") {
    canvas.style.cursor = "ew-resize";
    return;
  }
  if (state.tool === "zoom") {
    canvas.style.cursor = "zoom-in";
    return;
  }
  const hit = state.tool === "select" || state.tool === "rect" || state.tool === "distance" || state.tool === "crop"
    ? hitSelectedHandle(screenPoint) ?? hitSelectedMeasurementBody(screenPoint) ?? (state.tool === "select" ? hitTest(screenPoint) : null)
    : null;
  canvas.style.cursor = hit?.cursor ?? (hit ? "move" : state.tool === "select" ? "default" : "crosshair");
}

function hitTest(screenPoint) {
  const imagePoint = toImagePoint(screenPoint);
  const tolerance = 8 / state.viewport.scale;

  const handleHit = hitSelectedHandle(screenPoint);
  if (handleHit) return handleHit;

  for (let i = state.guides.length - 1; i >= 0; i -= 1) {
    const guide = state.guides[i];
    const delta = guide.orientation === "vertical" ? Math.abs(imagePoint.x - guide.value) : Math.abs(imagePoint.y - guide.value);
    if (delta <= tolerance) return { type: "guide", item: guide };
  }

  for (let i = state.measurements.length - 1; i >= 0; i -= 1) {
    const item = state.measurements[i];
    if (!isMeasurementViewportEditable(item)) continue;
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
  const deletedId = state.selectedId;
  pushUndo();
  state.measurements = state.measurements.filter((item) => item.id !== state.selectedId);
  for (const item of state.measurements) {
    if (item.parentId === deletedId) item.parentId = null;
  }
  state.guides = state.guides.filter((item) => item.id !== state.selectedId);
  state.swatches = state.swatches.filter((item) => item.id !== state.selectedId);
  if (state.crop?.id === state.selectedId) state.crop = null;
  state.selectedId = null;
  persist();
  render();
}

function cancelAction() {
  state.draft = null;
  state.drag = null;
  state.smartGuides = [];
  state.hoverSnapPoint = null;
  render();
}

function updateStatus() {
  elements.imageInfo.textContent = state.image
    ? `Image: ${state.image.width} x ${state.image.height} px`
    : "Image: -";
  if (document.activeElement !== elements.zoomInfo) {
    elements.zoomInfo.value = `${Math.round(state.viewport.scale * 100)}%`;
  }
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

