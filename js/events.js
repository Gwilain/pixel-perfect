function pointerDown(event) {
  if (!state.image) return;
  canvas.setPointerCapture(event.pointerId);
  const screenPoint = eventPoint(event);
  const imagePoint = toImagePoint(screenPoint);
  const dragPoint = snapPointToPixel(imagePoint);

  if (state.spacePressed || event.button === 1) {
    state.drag = { type: "pan", start: screenPoint, viewport: { ...state.viewport } };
    return;
  }

  if (state.tool === "zoom") {
    state.drag = {
      type: "zoom",
      start: screenPoint,
      anchor: screenPoint,
      scale: state.viewport.scale,
      alt: event.altKey,
      moved: false,
    };
    canvas.style.cursor = event.altKey ? "zoom-out" : "zoom-in";
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
    (state.tool === "select" || state.tool === "rect" || state.tool === "distance" || state.tool === "crop")
  ) {
    state.selectedId = selectedHandle.item.id;
    state.drag = {
      type: selectedHandle.type,
      item: selectedHandle.item,
      handle: selectedHandle.handle,
      cursor: selectedHandle.cursor,
      start: dragPoint,
      original: structuredClone(selectedHandle.item),
      undoSnapshot: createUndoSnapshot(),
    };
    render();
    return;
  }

  const selectedBody = hitSelectedMeasurementBody(screenPoint);
  if (
    selectedBody &&
    (state.tool === "select" || state.tool === "rect" || state.tool === "distance" || state.tool === "crop")
  ) {
    state.selectedId = selectedBody.item.id;
    state.drag = {
      type: "measurement",
      item: selectedBody.item,
      cursor: selectedBody.cursor,
      start: dragPoint,
      original: structuredClone(selectedBody.item),
      undoSnapshot: createUndoSnapshot(),
    };
    render();
    return;
  }

  const ruler = rulerHit(screenPoint);
  if (ruler?.type === "ruler") {
    setTool("guide");
    const undoSnapshot = createUndoSnapshot();
    const guide = {
      id: uid(),
      type: "guide",
      orientation: ruler.orientation,
      value: snapGuideValue(ruler.orientation === "vertical" ? imagePoint.x : imagePoint.y),
    };
    state.guides.push(guide);
    state.selectedId = guide.id;
    state.drag = {
      type: "guide",
      item: guide,
      start: imagePoint,
      original: structuredClone(guide),
      created: true,
      undoSnapshot,
    };
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
        undoSnapshot: createUndoSnapshot(),
      };
    }
    render();
    return;
  }

  if (state.tool === "rect" && imageBoundsContain(imagePoint)) {
    const snappedPoint = snapMeasurementPoint(imagePoint);
    state.draft = { id: "draft", type: "rect", x: snappedPoint.x, y: snappedPoint.y, w: 0, h: 0 };
    state.drag = { type: "drawRect", start: snappedPoint, undoSnapshot: createUndoSnapshot() };
  }

  if (state.tool === "crop" && imageBoundsContain(imagePoint)) {
    const snappedPoint = snapMeasurementPoint(imagePoint);
    const undoSnapshot = createUndoSnapshot();
    state.crop = { id: "crop", type: "rect", x: snappedPoint.x, y: snappedPoint.y, w: 0, h: 0 };
    state.selectedId = state.crop.id;
    state.drag = { type: "drawCrop", start: snappedPoint, undoSnapshot };
  }

  if (state.tool === "distance" && imageBoundsContain(imagePoint)) {
    const snappedPoint = snapMeasurementPoint(imagePoint);
    if (!state.draft) {
      state.draft = { id: "draft", type: "distance", a: snappedPoint, b: snappedPoint };
    } else {
      pushUndo();
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
  const dragPoint = snapPointToPixel(imagePoint);
  state.hoverScreen = screenPoint;
  state.hoverImage = imagePoint;
  state.smartGuides = [];
  state.hoverSnapPoint = null;
  if (
    state.settings.smartGuides &&
    !state.drag &&
    !state.draft &&
    (state.tool === "rect" || state.tool === "distance" || state.tool === "crop") &&
    imageBoundsContain(imagePoint)
  ) {
    state.hoverSnapPoint = snapMeasurementPoint(imagePoint, { collectSmartGuides: true });
  }
  updateCanvasCursor(screenPoint);
  if (state.tool === "eyedropper") {
    state.currentColor = getPixelColor(imagePoint);
  }

  if (state.drag?.type === "pan") {
    state.viewport.x = state.drag.viewport.x + screenPoint.x - state.drag.start.x;
    state.viewport.y = state.drag.viewport.y + screenPoint.y - state.drag.start.y;
  }

  if (state.drag?.type === "zoom") {
    const dx = screenPoint.x - state.drag.start.x;
    if (Math.abs(dx) > 2) state.drag.moved = true;
    const direction = state.drag.alt ? -1 : 1;
    zoomAt(state.drag.anchor, state.drag.scale * Math.exp(dx * 0.012 * direction));
  }

  if (state.drag?.type === "drawRect" && state.draft) {
    const snappedPoint = snapMeasurementPoint(imagePoint, { collectSmartGuides: true });
    state.hoverSnapPoint = snappedPoint;
    if (event.shiftKey) {
      const constrained = constrainDrawRect(state.drag.start, snappedPoint);
      state.draft.w = constrained.w;
      state.draft.h = constrained.h;
    } else {
      state.draft.w = snappedPoint.x - state.drag.start.x;
      state.draft.h = snappedPoint.y - state.drag.start.y;
    }
  }

  if (state.drag?.type === "drawCrop" && state.crop) {
    const snappedPoint = snapMeasurementPoint(imagePoint, { collectSmartGuides: true });
    state.hoverSnapPoint = snappedPoint;
    if (event.shiftKey) {
      const constrained = constrainDrawRect(state.drag.start, snappedPoint);
      state.crop.w = constrained.w;
      state.crop.h = constrained.h;
    } else {
      state.crop.w = snappedPoint.x - state.drag.start.x;
      state.crop.h = snappedPoint.y - state.drag.start.y;
    }
  }

  if (state.draft?.type === "distance") {
    const snappedPoint = snapMeasurementPoint(imagePoint, { collectSmartGuides: true });
    state.hoverSnapPoint = snappedPoint;
    state.draft.b = event.shiftKey ? snapDistanceEnd(state.draft.a, snappedPoint) : snappedPoint;
  }

  if (state.drag?.type === "measurement") {
    const dx = dragPoint.x - state.drag.start.x;
    const dy = dragPoint.y - state.drag.start.y;
    const item = state.drag.item;
    if (item.type === "rect") {
      const snappedDelta = snapMovedRect(state.drag.original, dx, dy, {
        excludeIds: new Set([item.id]),
        collectSmartGuides: true,
      });
      item.x = state.drag.original.x + snappedDelta.dx;
      item.y = state.drag.original.y + snappedDelta.dy;
      if (state.pixelPerfectMode) {
        item.x = Math.round(item.x);
        item.y = Math.round(item.y);
      }
    } else {
      const a = snapMeasurementPoint(
        { x: state.drag.original.a.x + dx, y: state.drag.original.a.y + dy },
        { excludeIds: new Set([item.id]), collectSmartGuides: true },
      );
      const snappedDx = a.x - state.drag.original.a.x;
      const snappedDy = a.y - state.drag.original.a.y;
      item.a = { x: state.drag.original.a.x + snappedDx, y: state.drag.original.a.y + snappedDy };
      item.b = { x: state.drag.original.b.x + snappedDx, y: state.drag.original.b.y + snappedDy };
    }
  }

  if (state.drag?.type === "rectHandle") {
    applyRectHandle(
      state.drag.item,
      state.drag.handle,
      state.drag.original,
      snapMeasurementPoint(imagePoint, { excludeIds: new Set([state.drag.item.id]), collectSmartGuides: true }),
      { fromCenter: state.drag.item.type === "rect" && event.altKey, keepRatio: event.shiftKey },
    );
  }

  if (state.drag?.type === "radiusHandle") {
    applyRadiusHandle(
      state.drag.item,
      state.drag.handle,
      state.drag.original,
      snapPointToPixel(imagePoint),
      { singleCorner: event.altKey },
    );
  }

  if (state.drag?.type === "distanceHandle") {
    const item = state.drag.item;
    const other = state.drag.handle === "a" ? item.b : item.a;
    const snappedPoint = snapMeasurementPoint(imagePoint, { excludeIds: new Set([item.id]), collectSmartGuides: true });
    item[state.drag.handle] = event.shiftKey ? snapDistanceEnd(other, snappedPoint) : snappedPoint;
  }

  if (state.drag?.type === "guide") {
    const guide = state.drag.item;
    guide.value = snapGuideValue(guide.orientation === "vertical" ? imagePoint.x : imagePoint.y);
  }

  updateStatus();
  render();
}

function pointerUp() {
  const endingDrag = state.drag;
  if (state.drag?.type === "zoom" && !state.drag.moved) {
    zoomAt(state.drag.anchor, state.viewport.scale * (state.drag.alt ? 0.8 : 1.25));
  }
  if (state.drag?.type === "drawRect" && state.draft) {
    const rect = normalizedRect(state.draft);
    if (rect.w >= 1 || rect.h >= 1) {
      pushExistingUndo(state.drag.undoSnapshot);
      state.draft = { id: uid(), type: "rect", ...rect };
      state.measurements.push(state.draft);
      state.selectedId = state.draft.id;
      persist();
    }
    state.draft = null;
  }
  if (state.drag?.type === "drawCrop" && state.crop) {
    state.crop = normalizedCrop(state.crop);
    state.selectedId = state.crop ? state.crop.id : null;
    if (state.crop && hasChanged(state.drag.undoSnapshot?.crop, state.crop)) {
      pushExistingUndo(state.drag.undoSnapshot);
    }
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
    state.drag?.type === "radiusHandle" ||
    state.drag?.type === "distanceHandle"
  ) {
    const finalItem = state.drag.item.id === "crop"
      ? state.crop
      : [...state.measurements, ...state.guides].find((item) => item.id === state.drag.item.id) ?? null;
    const createdGuide = state.drag.type === "guide" && state.drag.created && finalItem;
    if (createdGuide || hasChanged(state.drag.original, finalItem)) pushExistingUndo(state.drag.undoSnapshot);
    persist();
  }
  state.drag = null;
  state.smartGuides = [];
  state.hoverSnapPoint = null;
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
  const isEditingField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (event.key === "Enter" && state.crop && !isEditingField) {
    event.preventDefault();
    void applyCrop();
    return;
  }
  if (event.code === "Space") {
    state.spacePressed = true;
    canvas.style.cursor = "grab";
  }
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (mod && event.key.toLowerCase() === "z" && !event.shiftKey && !isEditingField) {
    event.preventDefault();
    void undo();
  } else if (mod && event.key === "0") {
    event.preventDefault();
    fitToScreen();
  } else if (mod && event.key === "1") {
    event.preventDefault();
    setActualZoom();
  } else if (event.key === "Escape") {
    if (!elements.infoOverlay.hidden) {
      setInfoPanelOpen(false);
      return;
    }
    if (!elements.settingsPanel.hidden) {
      setSettingsPanelOpen(false);
      return;
    }
    cancelAction();
  } else if (event.key === "F2" && !isEditingField) {
    event.preventDefault();
    if (typeof startRenameMeasurement === "function") startRenameMeasurement(state.selectedId);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelected();
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key.toLowerCase() === "p") {
      togglePixelPerfectMode();
      return;
    }
    const keyMap = { v: "select", r: "rect", d: "distance", i: "eyedropper", z: "zoom", c: "crop" };
    const nextTool = keyMap[event.key.toLowerCase()];
    if (nextTool) setTool(nextTool);
  }
}

function togglePixelPerfectMode(force = null) {
  state.pixelPerfectMode = typeof force === "boolean" ? force : !state.pixelPerfectMode;
  elements.pixelPerfectMode.checked = state.pixelPerfectMode;
  persist();
  render();
}

function keyUp(event) {
  if (event.code === "Space") {
    state.spacePressed = false;
    canvas.style.cursor = "";
  }
}

elements.newButton.addEventListener("click", async () => {
  await pushUndoBeforeImageChange();
  resetProject();
});
elements.openButton.addEventListener("click", () => elements.fileInput.click());
elements.captureButton.addEventListener("click", captureScreen);
elements.fileInput.addEventListener("change", (event) => loadImageFile(event.target.files?.[0]));
elements.toolButtons.forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
elements.zoomOut.addEventListener("click", () => zoomAroundCenter(state.viewport.scale / 1.25));
elements.zoomIn.addEventListener("click", () => zoomAroundCenter(state.viewport.scale * 1.25));
elements.zoomInfo.addEventListener("change", applyZoomInput);
elements.zoomInfo.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applyZoomInput();
  elements.zoomInfo.blur();
});
elements.clearMeasurements.addEventListener("click", () => {
  if (
    state.measurements.length ||
    state.guides.length ||
    state.swatches.length ||
    state.crop ||
    state.currentColor
  ) {
    pushUndo();
  }
  state.measurements = [];
  state.guides = [];
  state.selectedId = null;
  state.draft = null;
  state.drag = null;
  state.crop = null;
  state.currentColor = null;
  persist();
  updateStatus();
  render();
});
elements.applyCrop.addEventListener("click", applyCrop);
elements.exportJson.addEventListener("click", exportMeasurements);
elements.importJson.addEventListener("click", () => elements.jsonInput.click());
elements.jsonInput.addEventListener("change", (event) => importMeasurements(event.target.files?.[0]));
elements.settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSettingsPanelOpen(elements.settingsPanel.hidden);
});
elements.settingsPanel.addEventListener("click", (event) => event.stopPropagation());
elements.colorSettings.forEach((input) => {
  input.addEventListener("input", () => {
    const key = input.dataset.colorSetting;
    if (!key || !isHexColor(input.value)) return;
    writeSettings({ ...state.settings, [key]: input.value.toUpperCase() });
  });
});
elements.loupeFrameSize.addEventListener("input", () => {
  const loupeFrameSize = clamp(Number(elements.loupeFrameSize.value), 17, 37);
  writeSettings({ ...state.settings, loupeFrameSize });
});
elements.remBase.addEventListener("input", () => {
  const remBase = Number(elements.remBase.value);
  if (!Number.isFinite(remBase) || remBase <= 0) return;
  writeSettings({ ...state.settings, remBase: clamp(remBase, 1, 100) });
});
elements.smartGuides.addEventListener("change", () => {
  writeSettings({ ...state.settings, smartGuides: elements.smartGuides.checked });
});
elements.resetSettings.addEventListener("click", () => writeSettings(DEFAULT_SETTINGS));
elements.recentProjectList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(".recent-project");
  if (!button?.dataset.projectId) return;
  reopenRecentProject(button.dataset.projectId);
});
elements.theoryWidth.addEventListener("input", () => {
  const value = Number(elements.theoryWidth.value);
  if (Number.isFinite(value) && value > 0) {
    state.theoryWidth = value;
    syncTheoryInputs("width");
  } else {
    state.theoryWidth = null;
    state.theoryHeight = null;
    syncTheoryInputs();
  }
  persist();
  render();
});
elements.theoryHeight.addEventListener("input", () => {
  const value = Number(elements.theoryHeight.value);
  if (Number.isFinite(value) && value > 0) {
    state.theoryHeight = value;
    syncTheoryInputs("height");
  } else {
    state.theoryWidth = null;
    state.theoryHeight = null;
    syncTheoryInputs();
  }
  persist();
  render();
});
elements.displayUnit.addEventListener("change", () => {
  state.displayUnit = normalizeDisplayUnit(elements.displayUnit.value);
  persist();
  render();
});
elements.snapToGuides.addEventListener("change", () => {
  state.snapToGuides = elements.snapToGuides.checked;
  persist();
  render();
});
elements.pixelPerfectMode.addEventListener("change", () => {
  togglePixelPerfectMode(elements.pixelPerfectMode.checked);
});
elements.colorInfo.addEventListener("click", async () => {
  if (state.currentColor) await copyHex(state.currentColor.hex);
});
elements.infoButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSettingsPanelOpen(false);
  setInfoPanelOpen(elements.infoOverlay.hidden);
});
elements.closeInfo.addEventListener("click", () => setInfoPanelOpen(false));
elements.infoOverlay.addEventListener("click", (event) => {
  if (event.target === elements.infoOverlay) setInfoPanelOpen(false);
});

elements.dropZone.addEventListener("dragover", (event) => {
  if (!hasFileDrop(event.dataTransfer)) return;
  event.preventDefault();
  elements.dropZone.classList.add("is-dragover");
});
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragover"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragover");
  loadImageFile(droppedImageFile(event.dataTransfer));
});

for (const eventName of ["dragenter", "dragover", "drop"]) {
  document.addEventListener(
    eventName,
    (event) => {
      if (!hasFileDrop(event.dataTransfer)) return;
      event.preventDefault();
      if (eventName === "drop" && !elements.dropZone.contains(event.target)) {
        elements.dropZone.classList.remove("is-dragover");
        loadImageFile(droppedImageFile(event.dataTransfer));
      }
    },
    { capture: true },
  );
}

elements.recentProjectList.addEventListener("dragstart", (event) => {
  if (event.target instanceof Element && event.target.closest(".recent-project")) {
    event.preventDefault();
  }
});

canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerup", pointerUp);
canvas.addEventListener("pointercancel", pointerUp);
canvas.addEventListener("wheel", wheel, { passive: false });
window.addEventListener("keydown", keyDown);
window.addEventListener("keyup", keyUp);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("click", () => setSettingsPanelOpen(false));
window.addEventListener("paste", async (event) => {
  const imageItem = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"));
  const file = imageItem?.getAsFile();
  if (!file) return;
  event.preventDefault();
  const extension = file.type.split("/")[1] || "png";
  await pushUndoBeforeImageChange();
  await loadImageBlob(file, `Pasted image ${new Date().toLocaleString("en-US")}.${extension}`);
});

state.settings = readSettings();
syncSettingsControls();
elements.snapToGuides.checked = state.snapToGuides;
elements.pixelPerfectMode.checked = state.pixelPerfectMode;
elements.displayUnit.value = state.displayUnit;
state.recentProjects = readRecentProjects();
resizeCanvas();
updateStatus();
renderRecentProjects();
