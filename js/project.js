function resetProject() {
  state.image = null;
  state.imageName = "";
  state.imageSignature = "";
  state.imageData = null;
  state.measurements = [];
  state.guides = [];
  state.swatches = [];
  state.selectedId = null;
  state.hoverImage = null;
  state.hoverSnapPoint = null;
  state.currentColor = null;
  state.copyToast = null;
  state.draft = null;
  state.drag = null;
  state.smartGuides = [];
  state.crop = null;
  state.viewport = { scale: 1, x: 0, y: 0 };
  state.theoryWidth = null;
  state.theoryHeight = null;
  syncTheoryInputs();
  elements.emptyState.hidden = false;
  renderRecentProjects();
  updateStatus();
  render();
}

async function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;

  if (snapshot.imageBlob) {
    await loadImageBlob(snapshot.imageBlob, snapshot.imageName || "Restored image.png", {
      saveRecent: false,
      restoreStored: false,
    });
    state.imageName = snapshot.imageName;
    state.imageSignature = snapshot.imageSignature;
  }

  state.measurements = cloneStateValue(snapshot.measurements) ?? [];
  state.guides = cloneStateValue(snapshot.guides) ?? [];
  state.swatches = cloneStateValue(snapshot.swatches) ?? [];
  state.crop = cloneStateValue(snapshot.crop);
  state.selectedId = snapshot.selectedId;
  state.currentColor = cloneStateValue(snapshot.currentColor);
  state.viewport = snapshot.viewport ? { ...snapshot.viewport } : state.viewport;
  state.theoryWidth = snapshot.theoryWidth;
  state.theoryHeight = snapshot.theoryHeight;
  state.displayUnit = normalizeDisplayUnit(snapshot.displayUnit);
  state.snapToGuides = snapshot.snapToGuides;
  state.pixelPerfectMode = snapshot.pixelPerfectMode;
  state.draft = null;
  state.drag = null;
  state.smartGuides = [];
  state.hoverSnapPoint = null;
  elements.snapToGuides.checked = state.snapToGuides;
  elements.pixelPerfectMode.checked = state.pixelPerfectMode;
  elements.displayUnit.value = state.displayUnit;
  syncTheoryInputs(snapshot.theoryHeight && !snapshot.theoryWidth ? "height" : "width");
  syncToolButtons();
  persist();
  updateStatus();
  render();
}

async function loadImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  await pushUndoBeforeImageChange();
  await loadImageBlob(file, file.name || "Untitled image");
}

function droppedImageFile(dataTransfer) {
  const files = [...(dataTransfer?.files ?? [])];
  return files.find((file) => file.type.startsWith("image/")) ?? null;
}

function hasFileDrop(dataTransfer) {
  return [...(dataTransfer?.types ?? [])].includes("Files");
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
  state.crop = null;
  state.theoryWidth = null;
  state.theoryHeight = null;
  state.snapToGuides = true;
  state.pixelPerfectMode = true;
  elements.snapToGuides.checked = state.snapToGuides;
  elements.pixelPerfectMode.checked = state.pixelPerfectMode;
  state.selectedId = null;
  if (options.restoreStored !== false) restoreFromStorage();
  syncTheoryInputs();
  elements.emptyState.hidden = true;
  renderRecentProjects();
  fitToScreen();
  if (options.saveRecent !== false) {
    await saveRecentProject(blob, name, bitmap.width, bitmap.height);
  }
  updateStatus();
}

async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    elements.hintInfo.textContent = "Screen capture is unavailable here. Use a system screenshot, then paste it.";
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "never", displaySurface: "browser" },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.onloadeddata = resolve;
    });

    const snapshotCanvas = document.createElement("canvas");
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    snapshotCanvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((resolve) => snapshotCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Snapshot failed");
    await pushUndoBeforeImageChange();
    await loadImageBlob(blob, `Capture ${new Date().toLocaleString("en-US")}.png`);
  } catch (error) {
    if (error.name !== "NotAllowedError") {
      elements.hintInfo.textContent = "Snapshot failed. Use a system screenshot, then paste it.";
    }
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

async function applyCrop() {
  if (!state.image || !state.crop) return;
  const rect = normalizedCrop(state.crop);
  if (!rect) return;
  await pushUndoWithImage();
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = rect.w;
  cropCanvas.height = rect.h;
  cropCanvas.getContext("2d").drawImage(state.imageCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const blob = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  state.crop = null;
  await loadImageBlob(blob, `Cropped ${state.imageName || "image"}.png`);
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
  await pushUndoBeforeImageChange();
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
    button.draggable = false;

    const image = document.createElement("img");
    image.src = project.thumbnail;
    image.alt = "";
    image.draggable = false;

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

function smartGuideReferences(excludeIds = new Set()) {
  const references = [];
  if (!state.settings.smartGuides || !state.image) return references;

  for (const item of state.measurements) {
    if (excludeIds.has(item.id)) continue;

    if (item.type === "rect") {
      const rect = normalizedRect(item);
      references.push(
        { orientation: "vertical", value: rect.x },
        { orientation: "vertical", value: rect.x + rect.w / 2 },
        { orientation: "vertical", value: rect.x + rect.w },
        { orientation: "horizontal", value: rect.y },
        { orientation: "horizontal", value: rect.y + rect.h / 2 },
        { orientation: "horizontal", value: rect.y + rect.h },
      );
    }

    if (item.type === "distance") {
      references.push(
        { orientation: "vertical", value: item.a.x },
        { orientation: "vertical", value: item.b.x },
        { orientation: "horizontal", value: item.a.y },
        { orientation: "horizontal", value: item.b.y },
      );
    }
  }

  return references;
}

function nearestSmartGuideSnap(value, orientation, excludeIds = new Set()) {
  const threshold = SNAP_DISTANCE / state.viewport.scale;
  let nearest = null;
  for (const reference of smartGuideReferences(excludeIds)) {
    if (reference.orientation !== orientation) continue;
    const delta = Math.abs(value - reference.value);
    if (delta <= threshold && (!nearest || delta < nearest.delta)) {
      nearest = { ...reference, delta };
    }
  }
  return nearest;
}

function smartGuideLine(reference) {
  if (!state.image || !reference) return null;
  return reference.orientation === "vertical"
    ? { orientation: "vertical", value: reference.value, from: 0, to: state.image.height }
    : { orientation: "horizontal", value: reference.value, from: 0, to: state.image.width };
}

function snapPointToSmartGuides(point, excludeIds = new Set()) {
  const xSnap = nearestSmartGuideSnap(point.x, "vertical", excludeIds);
  const ySnap = nearestSmartGuideSnap(point.y, "horizontal", excludeIds);
  return {
    point: {
      x: xSnap ? xSnap.value : point.x,
      y: ySnap ? ySnap.value : point.y,
    },
    guides: [smartGuideLine(xSnap), smartGuideLine(ySnap)].filter(Boolean),
  };
}

function nearestAlignmentSnap(value, orientation, excludeIds = new Set()) {
  const guideSnap = nearestGuideSnap(value, orientation);
  const smartSnap = nearestSmartGuideSnap(value, orientation, excludeIds);
  if (guideSnap && (!smartSnap || guideSnap.delta <= smartSnap.delta)) return { ...guideSnap, smart: false };
  return smartSnap ? { ...smartSnap, smart: true } : null;
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

function snapMeasurementPoint(point, options = {}) {
  const guidePoint = snapPointToGuides(point);
  const smartSnap = snapPointToSmartGuides(guidePoint, options.excludeIds);
  if (options.collectSmartGuides) state.smartGuides = smartSnap.guides;
  return snapPointToPixel(smartSnap.point);
}

function snapMovedRect(original, dx, dy, options = {}) {
  const rect = normalizedRect(original);
  let nextDx = dx;
  let nextDy = dy;
  const smartGuides = [];
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
      const snap = nearestAlignmentSnap(candidate.value, "vertical", options.excludeIds);
      return snap ? { dx: snap.value - candidate.offset, delta: snap.delta, smart: snap.smart, snap } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta)[0];
  const ySnap = yCandidates
    .map((candidate) => {
      const snap = nearestAlignmentSnap(candidate.value, "horizontal", options.excludeIds);
      return snap ? { dy: snap.value - candidate.offset, delta: snap.delta, smart: snap.smart, snap } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta)[0];

  if (xSnap) nextDx = xSnap.dx;
  if (ySnap) nextDy = ySnap.dy;
  if (xSnap?.smart) smartGuides.push(smartGuideLine(xSnap.snap));
  if (ySnap?.smart) smartGuides.push(smartGuideLine(ySnap.snap));
  if (options.collectSmartGuides) state.smartGuides = smartGuides.filter(Boolean);
  return { dx: nextDx, dy: nextDy };
}

function persist() {
  if (!state.imageSignature) return;
  if (
    !state.measurements.length &&
    !state.guides.length &&
    !state.swatches.length &&
    !state.theoryWidth &&
    !state.theoryHeight &&
    state.displayUnit === "px" &&
    !state.snapToGuides &&
    !state.pixelPerfectMode
  ) {
    localStorage.removeItem(`pixel-measure:${state.imageSignature}`);
    return;
  }
  const payload = {
    version: 1,
    imageSignature: state.imageSignature,
    theoryWidth: state.theoryWidth,
    theoryHeight: state.theoryHeight,
    displayUnit: state.displayUnit,
    snapToGuides: state.snapToGuides,
    pixelPerfectMode: state.pixelPerfectMode,
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
    sanitizeMeasurementTree();
    state.guides = Array.isArray(payload.guides) ? payload.guides : [];
    state.swatches = Array.isArray(payload.swatches) ? payload.swatches : [];
    state.theoryWidth = Number.isFinite(payload.theoryWidth) ? payload.theoryWidth : null;
    state.theoryHeight = Number.isFinite(payload.theoryHeight) ? payload.theoryHeight : null;
    state.displayUnit = normalizeDisplayUnit(payload.displayUnit);
    state.snapToGuides = typeof payload.snapToGuides === "boolean" ? payload.snapToGuides : true;
    state.pixelPerfectMode = typeof payload.pixelPerfectMode === "boolean" ? payload.pixelPerfectMode : true;
    syncTheoryInputs(state.theoryHeight && !state.theoryWidth ? "height" : "width");
    elements.displayUnit.value = state.displayUnit;
    elements.snapToGuides.checked = state.snapToGuides;
    elements.pixelPerfectMode.checked = state.pixelPerfectMode;
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
    theoryHeight: state.theoryHeight,
    displayUnit: state.displayUnit,
    snapToGuides: state.snapToGuides,
    pixelPerfectMode: state.pixelPerfectMode,
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
  pushUndo();
  state.measurements = Array.isArray(payload.measurements) ? payload.measurements : [];
  sanitizeMeasurementTree();
  state.guides = Array.isArray(payload.guides) ? payload.guides : [];
  state.swatches = Array.isArray(payload.swatches) ? payload.swatches : [];
  state.theoryWidth = Number.isFinite(payload.theoryWidth) ? payload.theoryWidth : null;
  state.theoryHeight = Number.isFinite(payload.theoryHeight) ? payload.theoryHeight : null;
  state.displayUnit = normalizeDisplayUnit(payload.displayUnit);
  state.snapToGuides = typeof payload.snapToGuides === "boolean" ? payload.snapToGuides : true;
  state.pixelPerfectMode = typeof payload.pixelPerfectMode === "boolean" ? payload.pixelPerfectMode : true;
  syncTheoryInputs(state.theoryHeight && !state.theoryWidth ? "height" : "width");
  elements.displayUnit.value = state.displayUnit;
  elements.snapToGuides.checked = state.snapToGuides;
  elements.pixelPerfectMode.checked = state.pixelPerfectMode;
  state.selectedId = null;
  persist();
  updateStatus();
  render();
}

