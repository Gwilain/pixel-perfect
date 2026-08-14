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

function hitSelectedHandle(screenPoint) {
  const item = selectedMeasurement() ?? selectedCrop();
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
  const item = selectedMeasurement() ?? selectedCrop();
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

function swatchBounds(rects = swatchRects()) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function selectedSwatch() {
  return state.swatches.find((swatch) => swatch.id === state.selectedId) ?? state.swatches[0] ?? null;
}

function swatchCodeRect(rects = swatchRects()) {
  const swatch = selectedSwatch();
  const bounds = swatchBounds(rects);
  if (!swatch || !bounds) return null;
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  const width = Math.max(74, ctx.measureText(swatch.hex).width + 18);
  ctx.restore();
  return {
    swatch,
    x: bounds.left + (bounds.width - width) / 2,
    y: bounds.bottom + 7,
    width,
    height: 24,
  };
}

function swatchHit(screenPoint) {
  const rects = swatchRects();
  const codeRect = swatchCodeRect(rects);
  if (
    codeRect &&
    screenPoint.x >= codeRect.x &&
    screenPoint.x <= codeRect.x + codeRect.width &&
    screenPoint.y >= codeRect.y &&
    screenPoint.y <= codeRect.y + codeRect.height
  ) {
    return { type: "swatch", item: codeRect.swatch, cursor: "pointer" };
  }

  for (const rect of rects) {
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

function showCopyToast(text) {
  const size = screenSize();
  const rects = swatchRects();
  const codeRect = swatchCodeRect(rects);
  const anchor = codeRect
    ? { x: codeRect.x + codeRect.width / 2, y: codeRect.y + codeRect.height + 6 }
    : { x: size.width - 64, y: RULER_SIZE + 64 };
  state.copyToast = {
    text,
    centerX: clamp(anchor.x, 64, size.width - 64),
    y: clamp(anchor.y, RULER_SIZE + 8, size.height - 30),
    until: performance.now() + 1300,
  };
  render();
  window.setTimeout(() => {
    if (state.copyToast?.until <= performance.now()) {
      state.copyToast = null;
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
  const last = state.swatches[0];
  if (last?.hex === color.hex) {
    state.selectedId = last.id;
    persist();
    render();
    return last;
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

