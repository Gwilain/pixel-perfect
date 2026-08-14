function setSettingsPanelOpen(open) {
  elements.settingsPanel.hidden = !open;
  elements.settingsButton.classList.toggle("is-active", open);
  elements.settingsButton.setAttribute("aria-expanded", String(open));
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
  ctx.fillStyle = "rgba(23, 26, 31, 0.82)";
  ctx.fillRect(0, 0, size.width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, size.height);
  ctx.fillStyle = "rgba(32, 36, 42, 0.82)";
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
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
  ctx.font = "8px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(165, 173, 184, 0.82)";
  ctx.strokeStyle = "rgba(232, 237, 242, 0.28)";

  for (let x = startX; x <= endX; x += step) {
    const screenX = toScreenPoint({ x, y: 0 }).x;
    if (screenX < RULER_SIZE) continue;
    ctx.beginPath();
    ctx.moveTo(screenX + 0.5, RULER_SIZE);
    ctx.lineTo(screenX + 0.5, x % (step * 2) === 0 ? 4 : 7);
    ctx.stroke();
    if (x % (step * 2) === 0) ctx.fillText(String(Math.round(x)), screenX + 3, 7);
  }

  for (let y = startY; y <= endY; y += step) {
    const screenY = toScreenPoint({ x: 0, y }).y;
    if (screenY < RULER_SIZE) continue;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, screenY + 0.5);
    ctx.lineTo(y % (step * 2) === 0 ? 4 : 7, screenY + 0.5);
    ctx.stroke();
    if (y % (step * 2) !== 0) continue;
    ctx.save();
    ctx.translate(6, screenY - 3);
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
    const color = selected ? state.settings.guideSelected : state.settings.guide;
    const start = {};
    const end = {};
    if (guide.orientation === "vertical") {
      const x = toScreenPoint({ x: guide.value, y: 0 }).x;
      start.x = x;
      start.y = 0;
      end.x = x;
      end.y = size.height;
      drawLabel(`x ${formatCoord(guide.value, "x")}`, x + 6, RULER_SIZE + 18, selected, state.settings.guideSelected);
    } else {
      const y = toScreenPoint({ x: 0, y: guide.value }).y;
      start.x = 0;
      start.y = y;
      end.x = size.width;
      end.y = y;
      drawLabel(`y ${formatCoord(guide.value, "y")}`, RULER_SIZE + 8, y + 18, selected, state.settings.guideSelected);
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

function drawSmartGuides() {
  if (!state.image || !state.smartGuides.length) return;
  const size = screenSize();
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineCap = "butt";
  ctx.strokeStyle = state.settings.guideSelected;
  ctx.lineWidth = 1;

  for (const guide of state.smartGuides) {
    ctx.beginPath();
    if (guide.orientation === "vertical") {
      const x = Math.round(toScreenPoint({ x: guide.value, y: 0 }).x) + 0.5;
      ctx.moveTo(x, RULER_SIZE);
      ctx.lineTo(x, size.height);
    } else {
      const y = Math.round(toScreenPoint({ x: 0, y: guide.value }).y) + 0.5;
      ctx.moveTo(RULER_SIZE, y);
      ctx.lineTo(size.width, y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawMeasurements() {
  const selected = state.measurements.find((item) => item.id === state.selectedId);
  const items = [
    ...state.measurements.filter((item) => item.id !== state.selectedId),
    state.draft,
    selected,
  ].filter(Boolean);

  for (const item of items) {
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
  ctx.strokeStyle = selected ? state.settings.rectSelected : state.settings.rect;
  ctx.fillStyle = colorAlpha(state.settings.rect, 0.12);
  ctx.setLineDash(item.id === "draft" ? [5, 4] : []);
  ctx.beginPath();
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.fill();
  ctx.stroke();
  const guideText = nearestGuideText(rect);
  drawLabel(
    `${formatMeasureValue(rect.w, "x", item)} x ${formatMeasureValue(rect.h, "y", item)} | X ${formatCoord(rect.x, "x", item)} Y ${formatCoord(rect.y, "y", item)}${guideText}`,
    topLeft.x + 8,
    topLeft.y - 10,
    selected,
    state.settings.rectSelected,
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
  ctx.strokeStyle = selected ? state.settings.distanceSelected : state.settings.distance;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  drawPoint(a.x, a.y);
  drawPoint(b.x, b.y);
  const label = effectiveDisplayUnit(item) === "viewport"
    ? `DX ${formatMeasureValue(Math.abs(dx), "x", item)} | DY ${formatMeasureValue(Math.abs(dy), "y", item)}`
    : `DX ${formatMeasureValue(Math.abs(dx), "x", item)} | DY ${formatMeasureValue(Math.abs(dy), "y", item)} | D ${formatMeasureValue(Math.hypot(dx, dy), "diagonal", item)}`;
  drawLabel(
    label,
    (a.x + b.x) / 2 + 8,
    (a.y + b.y) / 2 - 8,
    selected,
    state.settings.distanceSelected,
  );
  if (selected) drawDistanceHandles(item);
  ctx.restore();
}

function drawRectHandles(item) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "#111315";
  ctx.strokeStyle = state.settings.rectSelected;
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
  ctx.strokeStyle = state.settings.distanceSelected;
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

function drawCropOverlay() {
  if (state.tool !== "crop" || !state.crop) return;
  const rect = normalizedRect(state.crop);
  const topLeft = toScreenPoint({ x: rect.x, y: rect.y });
  const bottomRight = toScreenPoint({ x: rect.x + rect.w, y: rect.y + rect.h });
  const size = screenSize();

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.fill("evenodd");
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = state.settings.rectSelected;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  ctx.setLineDash([]);
  drawRectHandles(state.crop);
  ctx.restore();
}

function drawSwatches() {
  if (!state.swatches.length) return;
  const rects = swatchRects();
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  for (const rect of rects) {
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
  }

  const codeRect = swatchCodeRect(rects);
  if (codeRect) {
    ctx.fillStyle = "rgba(10, 12, 15, 0.88)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    roundedRect(codeRect.x, codeRect.y, codeRect.width, codeRect.height, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f5f7fa";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(codeRect.swatch.hex, codeRect.x + codeRect.width / 2, codeRect.y + codeRect.height / 2 + 0.5);
  }
  ctx.restore();
}

function drawCopyToast() {
  if (!state.copyToast) return;
  if (state.copyToast.until <= performance.now()) {
    state.copyToast = null;
    return;
  }
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  const paddingX = 8;
  const width = ctx.measureText(state.copyToast.text).width + paddingX * 2;
  const height = 24;
  const x = clamp(state.copyToast.centerX - width / 2, 8, screenSize().width - width - 8);
  ctx.fillStyle = "rgba(10, 12, 15, 0.92)";
  ctx.strokeStyle = state.settings.rectSelected;
  ctx.lineWidth = 1;
  roundedRect(x, state.copyToast.y, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f5f7fa";
  ctx.textBaseline = "middle";
  ctx.fillText(state.copyToast.text, x + paddingX, state.copyToast.y + height / 2 + 0.5);
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
  return ` | guide ${formatMeasureValue(nearest.min, nearest.guide.orientation === "vertical" ? "x" : "y")}`;
}

function drawPoint(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabel(text, x, y, selected = false, selectedColor = state.settings.rectSelected) {
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
  ctx.fillStyle = "rgba(10, 12, 15, 0.88)";
  ctx.strokeStyle = selected ? selectedColor : "rgba(255, 255, 255, 0.22)";
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

function shouldShowLoupe() {
  if (!state.image || !state.hoverImage) return false;
  if (state.tool === "eyedropper") return true;
  if (state.pixelPerfectMode && state.drag?.type === "guide") return true;
  return state.pixelPerfectMode && (state.tool === "select" || state.tool === "rect" || state.tool === "distance" || state.tool === "crop") && imageBoundsContain(state.hoverImage);
}

function loupeFocusPoint() {
  if (state.drag?.type !== "guide") {
    if (state.tool === "eyedropper") return state.hoverImage;
    return state.hoverSnapPoint ?? snapPointToPixel(state.hoverImage);
  }
  const guide = state.drag.item;
  if (guide.orientation === "vertical") {
    return { x: guide.value, y: snapGuideValue(state.hoverImage.y) };
  }
  return { x: snapGuideValue(state.hoverImage.x), y: guide.value };
}

function loupeMeasurements() {
  if (state.tool === "eyedropper") return [];
  if (state.tool === "crop" && state.crop) return [state.crop];
  if (state.draft) return [state.draft];
  if (state.drag?.item?.type === "rect" || state.drag?.item?.type === "distance") return [state.drag.item];
  return state.measurements.filter((item) => item.id === state.selectedId);
}

function loupeGuide() {
  if (state.drag?.type === "guide") return state.drag.item;
  return state.guides.find((guide) => guide.id === state.selectedId) ?? null;
}

function drawLoupeMeasurementOverlay(origin, imagePoint, pixel) {
  const items = loupeMeasurements();
  if (!items.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x, origin.y, origin.size, origin.size);
  ctx.clip();
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  for (const item of items) {
    const selected = item.id === state.selectedId;
    ctx.strokeStyle = selected
      ? item.type === "rect" ? state.settings.rectSelected : state.settings.distanceSelected
      : item.type === "rect" ? state.settings.rect : state.settings.distance;
    ctx.fillStyle = ctx.strokeStyle;

    if (item.type === "rect") {
      const rect = normalizedRect(item);
      const left = origin.x + (rect.x - imagePoint.x) * pixel;
      const top = origin.y + (rect.y - imagePoint.y) * pixel;
      const right = origin.x + (rect.x + rect.w - imagePoint.x) * pixel;
      const bottom = origin.y + (rect.y + rect.h - imagePoint.y) * pixel;
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(right - left), Math.round(bottom - top));
      ctx.stroke();
    }

    if (item.type === "distance") {
      const a = {
        x: origin.x + (item.a.x - imagePoint.x + 0.5) * pixel,
        y: origin.y + (item.a.y - imagePoint.y + 0.5) * pixel,
      };
      const b = {
        x: origin.x + (item.b.x - imagePoint.x + 0.5) * pixel,
        y: origin.y + (item.b.y - imagePoint.y + 0.5) * pixel,
      };
      ctx.setLineDash(item.id === "draft" ? [pixel, pixel] : []);
      ctx.lineWidth = pixel;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, pixel / 2, 0, Math.PI * 2);
      ctx.arc(b.x, b.y, pixel / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawLoupeGuideOverlay(origin, imagePoint, pixel) {
  const guide = loupeGuide();
  if (!guide) return;
  const position = guide.orientation === "vertical"
    ? origin.x + (guide.value - imagePoint.x) * pixel
    : origin.y + (guide.value - imagePoint.y) * pixel;
  const crispPosition = Math.round(position) + 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x, origin.y, origin.size, origin.size);
  ctx.clip();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = guide.id === state.selectedId ? state.settings.guideSelected : state.settings.guide;
  ctx.beginPath();
  if (guide.orientation === "vertical") {
    ctx.moveTo(crispPosition, origin.y);
    ctx.lineTo(crispPosition, origin.y + origin.size);
  } else {
    ctx.moveTo(origin.x, crispPosition);
    ctx.lineTo(origin.x + origin.size, crispPosition);
  }
  ctx.stroke();
  ctx.restore();
}

function drawLoupeSmartGuideOverlay(origin, imagePoint, pixel) {
  if (!state.smartGuides.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(origin.x, origin.y, origin.size, origin.size);
  ctx.clip();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = state.settings.guideSelected;

  for (const guide of state.smartGuides) {
    const position = guide.orientation === "vertical"
      ? origin.x + (guide.value - imagePoint.x) * pixel
      : origin.y + (guide.value - imagePoint.y) * pixel;
    const crispPosition = Math.round(position) + 0.5;
    ctx.beginPath();
    if (guide.orientation === "vertical") {
      ctx.moveTo(crispPosition, origin.y);
      ctx.lineTo(crispPosition, origin.y + origin.size);
    } else {
      ctx.moveTo(origin.x, crispPosition);
      ctx.lineTo(origin.x + origin.size, crispPosition);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawLoupe(screenPoint) {
  if (!shouldShowLoupe()) return;
  const sourceSize = state.settings.loupeFrameSize;
  const pixel = 9;
  const radius = sourceSize * pixel;
  const rawLoupePoint = loupeFocusPoint();
  const loupePoint = {
    x: clamp(rawLoupePoint.x, 0, state.image.width - 1),
    y: clamp(rawLoupePoint.y, 0, state.image.height - 1),
  };
  const imagePoint = {
    x: clamp(Math.floor(loupePoint.x) - Math.floor(sourceSize / 2), 0, Math.max(0, state.image.width - sourceSize)),
    y: clamp(Math.floor(loupePoint.y) - Math.floor(sourceSize / 2), 0, Math.max(0, state.image.height - sourceSize)),
  };
  const x = Math.round(clamp(screenPoint.x + 18, 8, screenSize().width - radius - 8));
  const y = Math.round(clamp(screenPoint.y + 18, 8, screenSize().height - radius - 30));
  const centerX = (Math.floor(loupePoint.x) - imagePoint.x) * pixel;
  const centerY = (Math.floor(loupePoint.y) - imagePoint.y) * pixel;
  const label = state.tool === "eyedropper"
    ? state.currentColor?.hex ?? "-"
    : loupeGuide()
      ? `${loupeGuide().orientation === "vertical" ? "X" : "Y"} ${Math.round(loupeGuide().value)}`
      : `X ${Math.round(loupePoint.x)} Y ${Math.round(loupePoint.y)}`;

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
  drawLoupeMeasurementOverlay({ x, y, size: radius }, imagePoint, pixel);
  drawLoupeSmartGuideOverlay({ x, y, size: radius }, imagePoint, pixel);
  drawLoupeGuideOverlay({ x, y, size: radius }, imagePoint, pixel);
  if (state.drag?.type !== "guide") {
    ctx.strokeStyle = state.tool === "distance" ? state.settings.distanceSelected : state.settings.rectSelected;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + centerX, y + centerY, pixel, pixel);
  }
  ctx.fillStyle = "#f5f7fa";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(label, x + 6, y + radius + 16);
  ctx.restore();
}

function render() {
  const size = screenSize();
  ctx.clearRect(0, 0, size.width, size.height);
  drawImage();
  drawMeasurements();
  drawCropOverlay();
  drawRulers();
  drawGuides();
  drawSmartGuides();
  drawSwatches();
  drawCopyToast();
  if (state.hoverScreen) drawLoupe(state.hoverScreen);
  elements.applyCrop.hidden = state.tool !== "crop" || !state.crop;
  if (typeof renderContainersPanel === "function") renderContainersPanel();
}

