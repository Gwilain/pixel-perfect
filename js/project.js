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
  state.swatchCopyMessage = null;
  state.draft = null;
  state.drag = null;
  state.smartGuides = [];
  state.crop = null;
  state.viewport = { scale: 1, x: 0, y: 0 };
  state.theoryWidth = null;
  state.theoryHeight = null;
  detachProjectFile();
  syncTheoryInputs();
  elements.emptyState.hidden = false;
  renderRecentProjects();
  updateStatus();
  render();
}

// Autosave is a safety net; the project file is the document. These two track
// whether the document has drifted from the file, which is what the status bar
// shows and what the close warning is based on.
function markDirty() {
  if (state.isDirty) return;
  state.isDirty = true;
  updateStatus();
}

function markSaved(fileName = state.fileName) {
  state.fileName = fileName || "";
  state.isDirty = false;
  elements.hintInfo.textContent = state.fileName ? `Saved to ${state.fileName}.` : "Project saved.";
  updateStatus();
}

// Opening a different image starts a new document, so it must not keep writing
// over the previous project's file.
function detachProjectFile() {
  state.fileHandle = null;
  state.fileName = "";
  state.isDirty = false;
}

// ---------------------------------------------------------------------------
// Guarding destructive project switches (New, Open, Capture, Paste, reopening a
// different recent). Each resolves the pending promise below; only one of
// these dialogs is ever open at a time, so a single pending variable is enough.
// ---------------------------------------------------------------------------

let pendingUnsavedResolve = null;

// True means proceed with the destructive action. Nothing to lose (no image,
// or already saved): resolves immediately without asking.
function confirmDiscardUnsaved() {
  if (!state.image || !state.isDirty) return Promise.resolve(true);
  return new Promise((resolve) => {
    pendingUnsavedResolve = resolve;
    setUnsavedPanelOpen(true);
  });
}

function resolveUnsavedPrompt(proceed) {
  setUnsavedPanelOpen(false);
  pendingUnsavedResolve?.(proceed);
  pendingUnsavedResolve = null;
}

async function saveThenProceed() {
  await saveProject();
  // saveProject() reports its own failure or a cancelled picker through the
  // hint bar; either way, isDirty stays true and the caller must not proceed.
  resolveUnsavedPrompt(!state.isDirty);
}

// ---------------------------------------------------------------------------
// Recovering a newer local autosave than the file being opened.
// ---------------------------------------------------------------------------

// Reads what persist() has stored for this image without touching it, so it
// can be inspected before applyProjectPayload()+persist() would overwrite it
// with the file's own content.
function readStoredProjectPayload(signature) {
  try {
    const raw = localStorage.getItem(measureKey(signature)) ?? localStorage.getItem(legacyMeasureKey(signature));
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload.imageSignature === signature ? payload : null;
  } catch {
    return null;
  }
}

function newerAutosavePayload(signature, fileSavedAt) {
  const stored = readStoredProjectPayload(signature);
  if (!stored || !Number.isFinite(stored.updatedAt)) return null;
  const fileTime = Date.parse(fileSavedAt ?? "") || 0;
  return stored.updatedAt > fileTime ? stored : null;
}

let pendingRecoveredResolve = null;

function confirmRestoreAutosave() {
  return new Promise((resolve) => {
    pendingRecoveredResolve = resolve;
    setRecoveredPanelOpen(true);
  });
}

function resolveRecoveredPrompt(restore) {
  setRecoveredPanelOpen(false);
  pendingRecoveredResolve?.(restore);
  pendingRecoveredResolve = null;
}

function hasClearableContent() {
  return Boolean(
    state.measurements.length ||
      state.guides.length ||
      state.swatches.length ||
      state.crop ||
      state.currentColor,
  );
}

// Empties every annotation layer but keeps the image, so the user can start the
// measuring over without reopening the file. Undoable in one step.
function clearProject() {
  if (!hasClearableContent()) return;
  pushUndo();
  state.measurements = [];
  state.guides = [];
  state.swatches = [];
  state.selectedId = null;
  state.draft = null;
  state.drag = null;
  state.crop = null;
  state.currentColor = null;
  state.swatchCopyMessage = null;
  persist();
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
  detachProjectFile();
  await loadImageBlob(file, file.name || "Untitled image");
}

function isProjectFile(file) {
  return Boolean(file && (
    file.name?.toLowerCase().endsWith(".pixelperfect") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed"
  ));
}

async function openFile(file) {
  if (!file) return;
  if (!(await confirmDiscardUnsaved())) return;
  if (isProjectFile(file)) {
    await openProjectFile(file);
    return;
  }
  await loadImageFile(file);
}

function droppedProjectFile(dataTransfer) {
  const files = [...(dataTransfer?.files ?? [])];
  return files.find((file) => isProjectFile(file) || file.type.startsWith("image/")) ?? null;
}

function hasFileDrop(dataTransfer) {
  return [...(dataTransfer?.types ?? [])].includes("Files");
}

async function loadImageBlob(blob, name, options = {}) {
  if (!blob || !blob.type.startsWith("image/")) return;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    elements.hintInfo.textContent = "This image could not be decoded.";
    return;
  }
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
  state.swatchCopyMessage = null;
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
    await rememberRecent({ blob, name });
  }
  updateStatus();
}

async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    elements.hintInfo.textContent = "Screen capture is unavailable here. Use a system screenshot, then paste it.";
    return;
  }
  if (!(await confirmDiscardUnsaved())) return;

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
    detachProjectFile();
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
  // The image itself changed, which loadImageBlob does not persist on its own.
  markDirty();
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

async function deleteImageRecord(id) {
  const db = await openProjectDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function trimRecentProjects(projects) {
  return projects.slice(0, RECENT_LIMIT);
}

function readRecentProjects() {
  try {
    const projects = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]");
    return Array.isArray(projects) ? trimRecentProjects(projects) : [];
  } catch {
    localStorage.removeItem(RECENT_PROJECTS_KEY);
    return [];
  }
}

function writeRecentProjects(projects) {
  const previousIds = state.recentProjects.map((project) => project.id);
  state.recentProjects = trimRecentProjects(projects);
  const keptIds = new Set(state.recentProjects.map((project) => project.id));
  writeStorageValue(RECENT_PROJECTS_KEY, JSON.stringify(state.recentProjects));
  // Evicted projects used to leave their full-size blob in IndexedDB forever.
  for (const id of previousIds) {
    if (!keptIds.has(id)) void deleteImageRecord(id).catch(() => {});
  }
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

// A file handle is structured-cloneable, so IndexedDB can hold it directly and
// the recent becomes a pointer to the file on disk rather than a copy of it.
async function rememberRecent({ blob = null, handle = null, name }) {
  if (!state.image) return;
  const id = state.imageSignature;
  const updatedAt = Date.now();
  const kind = handle ? "project" : "image";
  const record = handle
    ? { id, handle, name, kind, updatedAt }
    : { id, blob, name, kind, type: blob.type, updatedAt };
  try {
    await putImageRecord(record);
  } catch {
    // Private browsing or a full disk: the image is loaded, it just is not remembered.
    elements.hintInfo.textContent = "This project could not be added to recents.";
    return;
  }
  writeRecentProjects([
    {
      id,
      name,
      kind,
      width: state.image.width,
      height: state.image.height,
      thumbnail: createThumbnail(),
      updatedAt,
    },
    ...state.recentProjects.filter((project) => project.id !== id),
  ]);
}

function forgetRecent(id) {
  writeRecentProjects(state.recentProjects.filter((project) => project.id !== id));
}

async function reopenRecentProject(id) {
  if (!(await confirmDiscardUnsaved())) return;
  let record = null;
  try {
    record = await getImageRecord(id);
  } catch {
    elements.hintInfo.textContent = "This project could not be reopened.";
    return;
  }
  if (!record) {
    forgetRecent(id);
    return;
  }

  if (record.handle) {
    if (!(await ensureHandlePermission(record.handle, "read"))) {
      elements.hintInfo.textContent = "Permission to read that file was refused.";
      return;
    }
    let file = null;
    try {
      file = await record.handle.getFile();
    } catch {
      // The file was moved, renamed or deleted since it was last opened.
      elements.hintInfo.textContent = `${record.name} is no longer where it was saved.`;
      forgetRecent(id);
      return;
    }
    await openProjectFile(file, record.handle);
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

// True when the project holds anything worth saving. The previous form required
// snapToGuides and pixelPerfectMode to both be false, which they never are by
// default, so the cleanup branch below could never run and empty projects piled up.
function hasStoredProjectData() {
  return Boolean(
    state.measurements.length ||
      state.guides.length ||
      state.swatches.length ||
      state.theoryWidth ||
      state.theoryHeight ||
      state.displayUnit !== "px" ||
      !state.snapToGuides ||
      !state.pixelPerfectMode,
  );
}

function persist() {
  // Every project mutation funnels through here, so this is where the document
  // is known to have drifted from its file.
  markDirty();
  if (!state.imageSignature) return;
  localStorage.removeItem(legacyMeasureKey());
  if (!hasStoredProjectData()) {
    localStorage.removeItem(measureKey());
    return;
  }
  const payload = {
    version: 2,
    updatedAt: Date.now(),
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
  writeStorageValue(measureKey(), JSON.stringify(payload));
  trimStoredProjects();
}

function applyProjectPayload(payload) {
  state.measurements = sanitizeMeasurements(payload.measurements);
  sanitizeMeasurementTree();
  state.guides = sanitizeGuides(payload.guides);
  state.swatches = sanitizeSwatches(payload.swatches);
  state.theoryWidth = Number.isFinite(payload.theoryWidth) ? payload.theoryWidth : null;
  state.theoryHeight = Number.isFinite(payload.theoryHeight) ? payload.theoryHeight : null;
  state.displayUnit = normalizeDisplayUnit(payload.displayUnit);
  state.snapToGuides = typeof payload.snapToGuides === "boolean" ? payload.snapToGuides : true;
  state.pixelPerfectMode = typeof payload.pixelPerfectMode === "boolean" ? payload.pixelPerfectMode : true;
  syncTheoryInputs(state.theoryHeight && !state.theoryWidth ? "height" : "width");
  elements.displayUnit.value = state.displayUnit;
  elements.snapToGuides.checked = state.snapToGuides;
  elements.pixelPerfectMode.checked = state.pixelPerfectMode;
}

function restoreFromStorage() {
  // Projects saved before the prefix was unified still load; persist() then
  // rewrites them under the new key and drops the legacy one.
  const raw = localStorage.getItem(measureKey()) ?? localStorage.getItem(legacyMeasureKey());
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload.imageSignature !== state.imageSignature) return;
    applyProjectPayload(payload);
  } catch {
    localStorage.removeItem(measureKey());
    localStorage.removeItem(legacyMeasureKey());
  }
}

function projectPayload(imageFile) {
  return {
    version: 1,
    app: "Pixel Perfect",
    savedAt: new Date().toISOString(),
    image: {
      file: imageFile,
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
}

function projectBaseName() {
  const raw = (state.imageName || "pixel-perfect-project").replace(/\.[^.]+$/, "");
  return raw.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").trim() || "pixel-perfect-project";
}

function canvasPngBlob() {
  return new Promise((resolve) => {
    state.imageCanvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

const PROJECT_FILE_TYPES = [
  { description: "Pixel Perfect project", accept: { "application/zip": [".pixelperfect"] } },
];

// Chromium desktop only. Firefox and Safari expose no disk picker at all, so
// everything below falls back to a plain download for them.
function supportsFilePicker() {
  return typeof window.showSaveFilePicker === "function";
}

// A handle restored from IndexedDB in a later session starts unauthorised, and
// the prompt only works from a user gesture, which is why this is called from
// click and keyboard handlers rather than on load.
async function ensureHandlePermission(handle, mode = "readwrite") {
  if (typeof handle?.queryPermission !== "function") return true;
  try {
    if ((await handle.queryPermission({ mode })) === "granted") return true;
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

async function buildProjectBlob() {
  if (!window.fflate?.zipSync || !window.fflate?.strToU8) return null;
  const imageBlob = await canvasPngBlob();
  if (!imageBlob) return null;
  const imageFile = "image.png";
  const files = {
    "project.json": fflate.strToU8(JSON.stringify(projectPayload(imageFile), null, 2)),
    [imageFile]: new Uint8Array(await imageBlob.arrayBuffer()),
  };
  return new Blob([fflate.zipSync(files, { level: 6 })], { type: "application/zip" });
}

function downloadProjectBlob(blob) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${projectBaseName()}.pixelperfect`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function saveProject(options = {}) {
  if (!state.image || !state.imageCanvas.width || !state.imageCanvas.height) {
    elements.hintInfo.textContent = "Open or capture an image before saving a project.";
    return;
  }
  const blob = await buildProjectBlob();
  if (!blob) {
    elements.hintInfo.textContent = "Save failed: the project could not be packaged.";
    return;
  }

  if (!supportsFilePicker()) {
    downloadProjectBlob(blob);
    markSaved(`${projectBaseName()}.pixelperfect`);
    return;
  }

  let handle = options.saveAs ? null : state.fileHandle;
  try {
    handle ??= await window.showSaveFilePicker({
      suggestedName: `${projectBaseName()}.pixelperfect`,
      types: PROJECT_FILE_TYPES,
    });
    if (!(await ensureHandlePermission(handle))) {
      elements.hintInfo.textContent = "Not saved: permission to write that file was refused.";
      return;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    if (error?.name === "AbortError") return;
    elements.hintInfo.textContent = "Save failed: the file could not be written.";
    return;
  }

  state.fileHandle = handle;
  markSaved(handle.name);
  await rememberRecent({ handle, name: handle.name });
}

async function openWithPicker() {
  if (typeof window.showOpenFilePicker !== "function") {
    elements.fileInput.click();
    return;
  }
  let handle = null;
  try {
    [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        ...PROJECT_FILE_TYPES,
        { description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"] } },
      ],
    });
  } catch (error) {
    if (error?.name !== "AbortError") elements.fileInput.click();
    return;
  }
  const file = await handle.getFile();
  if (!(await confirmDiscardUnsaved())) return;
  if (isProjectFile(file)) await openProjectFile(file, handle);
  else await loadImageFile(file);
}

async function openProjectFile(file, handle = null) {
  if (!window.fflate?.unzipSync || !window.fflate?.strFromU8) {
    elements.hintInfo.textContent = "Open failed: the zip library is unavailable.";
    return;
  }
  let files;
  try {
    files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    elements.hintInfo.textContent = "Open failed: this .pixelperfect file is not valid.";
    return;
  }
  const manifestBytes = files["project.json"];
  if (!manifestBytes) {
    elements.hintInfo.textContent = "Open failed: project.json is missing.";
    return;
  }
  let payload;
  try {
    payload = JSON.parse(fflate.strFromU8(manifestBytes));
  } catch {
    elements.hintInfo.textContent = "Open failed: project.json is invalid.";
    return;
  }
  const imagePath = payload?.image?.file;
  const imageBytes = imagePath ? files[imagePath] : null;
  if (!imageBytes) {
    elements.hintInfo.textContent = "Open failed: project image is missing.";
    return;
  }
  await pushUndoBeforeImageChange();
  const imageName = payload.image.name || imagePath || "Project image.png";
  await loadImageBlob(new Blob([imageBytes], { type: "image/png" }), imageName, {
    restoreStored: false,
  });
  applyProjectPayload(payload);
  state.selectedId = null;

  // Read before persist() below would overwrite it with the file's own data.
  const recovered = newerAutosavePayload(state.imageSignature, payload.savedAt);
  render();
  elements.hintInfo.textContent = `Opened ${file.name}.`;

  let usedRecovered = false;
  if (recovered) {
    usedRecovered = await confirmRestoreAutosave();
    if (usedRecovered) {
      applyProjectPayload(recovered);
      state.selectedId = null;
      render();
    }
  }

  persist();
  // Bind the session to the file it came from, so Ctrl+S writes back in place.
  state.fileHandle = handle;
  if (usedRecovered) {
    // The working copy now differs from what is on disk until the next save.
    state.fileName = handle?.name ?? file.name;
    markDirty();
    elements.hintInfo.textContent = "Restored unsaved changes. Save to write them to the file.";
  } else {
    markSaved(handle?.name ?? file.name);
  }
  if (handle) await rememberRecent({ handle, name: handle.name });
}
