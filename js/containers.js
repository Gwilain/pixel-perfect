let containerDrag = null;

function setContainersCollapsed(collapsed, options = {}) {
  document.body.classList.remove("containers-opening", "containers-closing");
  if (options.animate !== false) {
    document.body.classList.add(collapsed ? "containers-closing" : "containers-opening");
    window.setTimeout(() => {
      document.body.classList.remove("containers-opening", "containers-closing");
    }, 700);
  }
  document.body.classList.toggle("containers-collapsed", collapsed);
  elements.toggleContainers.title = collapsed ? "Expand containers" : "Collapse containers";
  elements.toggleContainers.setAttribute("aria-label", elements.toggleContainers.title);
  elements.toggleContainers.setAttribute("aria-expanded", String(!collapsed));
  if (options.persist !== false) localStorage.setItem(CONTAINERS_COLLAPSED_KEY, collapsed ? "1" : "0");
  resizeCanvas();
}

function measurementLabel(item) {
  const index = state.measurements.filter((candidate) => candidate.type === item.type).findIndex((candidate) => candidate.id === item.id) + 1;
  return item.name || `${item.type === "rect" ? "Rectangle" : "Distance"} ${index}`;
}

function iconSvg(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
}

const structureIcons = {
  visible: iconSvg("M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"),
  hidden: iconSvg("M3 3l18 18M10.6 5.2A11.2 11.2 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.6 6.7C3.6 8.7 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"),
  unlocked: iconSvg("M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z"),
  locked: iconSvg("M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"),
};

function isDescendantOf(item, parentId) {
  let current = item;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.id)) {
    if (current.parentId === parentId) return true;
    seen.add(current.id);
    current = getMeasurementById(current.parentId);
  }
  return false;
}

function containerDropMode(event, row, target) {
  const rect = row.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height / 3) return "before";
  if (y > rect.height * 2 / 3) return "after";
  if (target.type === "rect") return "child";
  return "after";
}

function clearContainerDropStyles() {
  elements.containerList.querySelectorAll(".container-row").forEach((row) => {
    row.classList.remove("is-drop-before", "is-drop-after", "is-drop-child");
  });
  elements.containerList.classList.remove("is-drop-root");
}

function reorderMeasurement(draggedId, targetId, mode) {
  const dragged = getMeasurementById(draggedId);
  const target = getMeasurementById(targetId);
  if (!dragged || !target || dragged.id === target.id) return false;
  if (mode === "child" && (!canContainMeasurement(target) || isDescendantOf(target, dragged.id))) return false;

  pushUndo();
  state.measurements = state.measurements.filter((item) => item.id !== dragged.id);

  if (mode === "child") {
    dragged.parentId = target.id;
    state.measurements.push(dragged);
  } else {
    dragged.parentId = target.parentId ?? null;
    const targetIndex = state.measurements.findIndex((item) => item.id === target.id);
    const insertIndex = mode === "before" ? targetIndex : targetIndex + 1;
    state.measurements.splice(insertIndex, 0, dragged);
  }

  sanitizeMeasurementTree();
  state.selectedId = dragged.id;
  persist();
  render();
  return true;
}

function unparentMeasurement(draggedId) {
  const dragged = getMeasurementById(draggedId);
  if (!dragged) return false;

  pushUndo();
  state.measurements = state.measurements.filter((item) => item.id !== dragged.id);
  dragged.parentId = null;
  state.measurements.push(dragged);
  sanitizeMeasurementTree();
  state.selectedId = dragged.id;
  persist();
  render();
  return true;
}

function startRenameMeasurement(id) {
  const item = getMeasurementById(id);
  if (!item || (item.type !== "rect" && item.type !== "distance")) return;
  state.selectedId = item.id;
  render();

  const escapedId = window.CSS?.escape ? CSS.escape(item.id) : item.id.replaceAll('"', '\\"');
  const row = elements.containerList.querySelector(`.container-row[data-id="${escapedId}"]`);
  const name = row?.querySelector(".container-name");
  if (!row || !name) return;

  row.draggable = false;
  const input = document.createElement("input");
  input.className = "container-name-input";
  input.type = "text";
  input.value = item.name || measurementLabel(item);
  input.setAttribute("aria-label", "Rename container");
  name.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const nextName = input.value.trim();
    if (nextName && nextName !== item.name) {
      pushUndo();
      item.name = nextName;
      persist();
    }
    render();
  };

  const cancel = () => render();

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);
}

function cssNumber(value) {
  return String(smartRound(value)).replace(",", ".");
}

function cssMeasureValue(value, axis = "x", item = null) {
  if (!state.image) return `${cssNumber(value)}px`;
  const unit = effectiveDisplayUnit(item);
  const scaled = value * getScaleFactor();
  if (unit === "rem") return `${cssNumber(scaled / state.settings.remBase)}rem`;
  if (unit === "percent") return `${cssNumber((value / getImageBasis(axis, item)) * 100)}%`;
  if (unit === "viewport") {
    const basis = axis === "y" ? state.image.height : state.image.width;
    return `${cssNumber((value / basis) * 100)}${axis === "y" ? "vh" : "vw"}`;
  }
  return `${cssNumber(scaled)}px`;
}

function cssCoordValue(value, axis = "x", item = null) {
  const parent = getParentRect(item);
  const relativeValue = parent ? value - (axis === "y" ? parent.y : parent.x) : value;
  return cssMeasureValue(relativeValue, axis, item);
}

function cssRadiusValue(item) {
  const radii = rectRadii(item);
  const values = [radii.tl, radii.tr, radii.br, radii.bl].map((value) => Math.max(0, value));
  if (!values.some(Boolean)) return null;
  if (values.every((value) => value === values[0])) return cssMeasureValue(values[0], "x", item);
  return values.map((value) => cssMeasureValue(value, "x", item)).join(" ");
}

function selectedPropertiesText() {
  const item = getMeasurementById(state.selectedId) ?? (state.selectedId === state.crop?.id ? state.crop : null);
  if (item?.type === "rect") {
    const rect = normalizedRect(item);
    const lines = [
      `/* ${measurementLabel(item)} */`,
      `left: ${cssCoordValue(rect.x, "x", item)};`,
      `top: ${cssCoordValue(rect.y, "y", item)};`,
      `width: ${cssMeasureValue(rect.w, "x", item)};`,
      `height: ${cssMeasureValue(rect.h, "y", item)};`,
    ];
    const radius = cssRadiusValue(item);
    if (radius) lines.push(`border-radius: ${radius};`);
    return lines.join("\n");
  }

  if (item?.type === "distance") {
    const dx = item.b.x - item.a.x;
    const dy = item.b.y - item.a.y;
    return [
      `/* ${measurementLabel(item)} */`,
      `--x: ${cssCoordValue(Math.min(item.a.x, item.b.x), "x", item)};`,
      `--y: ${cssCoordValue(Math.min(item.a.y, item.b.y), "y", item)};`,
      `--width: ${cssMeasureValue(Math.abs(dx), "x", item)};`,
      `--height: ${cssMeasureValue(Math.abs(dy), "y", item)};`,
      `--distance: ${cssMeasureValue(Math.hypot(dx, dy), "diagonal", item)};`,
    ].join("\n");
  }

  const guide = state.guides.find((candidate) => candidate.id === state.selectedId);
  if (guide) {
    const property = guide.orientation === "vertical" ? "left" : "top";
    const axis = guide.orientation === "vertical" ? "x" : "y";
    return [`/* Guide */`, `${property}: ${cssMeasureValue(guide.value, axis)};`].join("\n");
  }

  const swatch = state.swatches.find((candidate) => candidate.id === state.selectedId);
  if (swatch) {
    return [`/* Swatch */`, `color: ${swatch.hex};`].join("\n");
  }

  return "/* Select something to inspect its CSS values */";
}

function renderSelectedProperties() {
  if (!elements.propertyCode) return;
  const text = selectedPropertiesText();
  elements.propertyCode.value = text;
  if (elements.copyProperties) {
    elements.copyProperties.disabled = text.startsWith("/* Select");
  }
}

function renderSwatchList() {
  if (!elements.swatchList) return;
  elements.swatchList.replaceChildren();
  if (elements.swatchMessage) {
    const message = state.swatchCopyMessage;
    elements.swatchMessage.textContent = message?.until > performance.now() ? message.text : "";
  }

  if (!state.swatches.length) {
    const empty = document.createElement("div");
    empty.className = "container-empty";
    empty.textContent = "No swatches yet";
    elements.swatchList.append(empty);
    return;
  }

  for (const swatch of state.swatches) {
    const button = document.createElement("button");
    button.className = "swatch-tile";
    button.type = "button";
    button.dataset.id = swatch.id;
    button.dataset.hex = swatch.hex;
    button.title = "Copy color";
    button.setAttribute("aria-label", `Copy ${swatch.hex}`);

    const chip = document.createElement("span");
    chip.className = "swatch-chip";
    chip.style.background = swatch.hex;

    button.append(chip);
    elements.swatchList.append(button);
  }
}

function renderContainersPanel() {
  if (!elements.containerList) return;
  renderSelectedProperties();
  renderSwatchList();
  elements.containerList.replaceChildren();

  const items = state.measurements.filter((item) => item.type === "rect" || item.type === "distance");
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "container-empty";
    empty.textContent = "No elements yet";
    elements.containerList.append(empty);
    return;
  }

  const childrenByParent = new Map();
  for (const item of items) {
    const parentId = item.parentId ?? "root";
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(item);
  }

  const appendItem = (item, depth = 0) => {
    const row = document.createElement("div");
    row.className = "container-row";
    row.draggable = true;
    row.dataset.id = item.id;
    row.style.paddingLeft = `${6 + depth * 16}px`;
    row.classList.toggle("is-selected", item.id === state.selectedId);
    row.classList.toggle("is-hidden", !isMeasurementVisible(item));
    row.classList.toggle("is-locked", isMeasurementLocked(item));

    const icon = document.createElement("span");
    icon.className = "container-icon";
    icon.textContent = item.type === "rect" ? "R" : "D";

    const name = document.createElement("span");
    name.className = "container-name";
    name.textContent = measurementLabel(item);

    const visibility = document.createElement("button");
    visibility.className = "container-action";
    visibility.type = "button";
    visibility.dataset.action = "visibility";
    visibility.title = isMeasurementVisible(item) ? "Hide in viewport" : "Show in viewport";
    visibility.setAttribute("aria-label", visibility.title);
    visibility.innerHTML = isMeasurementVisible(item) ? structureIcons.visible : structureIcons.hidden;

    const lock = document.createElement("button");
    lock.className = "container-action";
    lock.type = "button";
    lock.dataset.action = "lock";
    lock.title = isMeasurementLocked(item) ? "Unlock viewport editing" : "Lock viewport editing";
    lock.setAttribute("aria-label", lock.title);
    lock.innerHTML = isMeasurementLocked(item) ? structureIcons.locked : structureIcons.unlocked;

    const unit = document.createElement("select");
    unit.className = "container-unit";
    unit.title = "Unit for this item";
    for (const [value, label] of [
      ["inherit", "auto"],
      ["px", "px"],
      ["rem", "rem"],
      ["percent", "%"],
      ["viewport", "vw/vh"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      unit.append(option);
    }
    unit.value = normalizeItemUnit(item.unit);

    row.append(icon, name, visibility, lock, unit);
    elements.containerList.append(row);
    for (const child of childrenByParent.get(item.id) ?? []) appendItem(child, depth + 1);
  };

  for (const item of childrenByParent.get("root") ?? []) appendItem(item);
}

elements.containerList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("select")) return;
  const action = target?.closest(".container-action");
  if (action) {
    const row = action.closest(".container-row");
    const item = getMeasurementById(row?.dataset.id);
    if (!item) return;
    event.preventDefault();
    pushUndo();
    if (action.dataset.action === "visibility") {
      item.visible = !isMeasurementVisible(item);
    } else if (action.dataset.action === "lock") {
      item.locked = !isMeasurementLocked(item);
    }
    persist();
    render();
    return;
  }
  const row = target?.closest(".container-row");
  if (!row?.dataset.id) return;
  if (event.detail >= 2) {
    event.preventDefault();
    startRenameMeasurement(row.dataset.id);
    return;
  }
  state.selectedId = row.dataset.id;
  render();
});

elements.containerList.addEventListener("dblclick", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("select") || target?.closest(".container-action")) return;
  const row = target?.closest(".container-row");
  if (!row?.dataset.id) return;
  event.preventDefault();
  startRenameMeasurement(row.dataset.id);
});

elements.containerList.addEventListener("change", (event) => {
  const target = event.target instanceof HTMLSelectElement ? event.target : null;
  if (!target?.classList.contains("container-unit")) return;
  const row = target.closest(".container-row");
  const item = getMeasurementById(row?.dataset.id);
  if (!item) return;
  pushUndo();
  item.unit = normalizeItemUnit(target.value);
  persist();
  render();
});

elements.containerList.addEventListener("dragstart", (event) => {
  const row = event.target instanceof Element ? event.target.closest(".container-row") : null;
  if (event.target instanceof Element && event.target.closest(".container-action")) {
    event.preventDefault();
    return;
  }
  if (!row?.dataset.id) return;
  containerDrag = row.dataset.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", containerDrag);
});

elements.containerList.addEventListener("dragover", (event) => {
  const row = event.target instanceof Element ? event.target.closest(".container-row") : null;
  const target = getMeasurementById(row?.dataset.id);
  const dragged = getMeasurementById(containerDrag);
  if (!dragged) return;
  event.preventDefault();
  clearContainerDropStyles();
  if (!row) {
    elements.containerList.classList.add("is-drop-root");
    return;
  }
  if (!target || dragged.id === target.id) return;
  const mode = containerDropMode(event, row, target);
  if (mode === "child" && (!canContainMeasurement(target) || isDescendantOf(target, dragged.id))) return;
  row.classList.add(`is-drop-${mode}`);
});

elements.containerList.addEventListener("dragleave", (event) => {
  if (!elements.containerList.contains(event.relatedTarget)) clearContainerDropStyles();
});

elements.containerList.addEventListener("drop", (event) => {
  const row = event.target instanceof Element ? event.target.closest(".container-row") : null;
  const target = getMeasurementById(row?.dataset.id);
  const draggedId = containerDrag || event.dataTransfer.getData("text/plain");
  clearContainerDropStyles();
  containerDrag = null;
  if (!draggedId) return;
  event.preventDefault();
  if (!row) {
    unparentMeasurement(draggedId);
    return;
  }
  if (!target) return;
  reorderMeasurement(draggedId, target.id, containerDropMode(event, row, target));
});

elements.containerList.addEventListener("dragend", () => {
  clearContainerDropStyles();
  containerDrag = null;
});

elements.swatchList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest(".swatch-tile");
  const swatch = state.swatches.find((candidate) => candidate.id === row?.dataset.id);
  if (!swatch) return;
  state.selectedId = swatch.id;
  state.currentColor = {
    ...swatch.rgb,
    a: 255,
    hex: swatch.hex,
  };
  copyHex(swatch.hex);
  updateStatus();
  render();
});

elements.toggleContainers.addEventListener("click", () => {
  setContainersCollapsed(!document.body.classList.contains("containers-collapsed"));
});

elements.copyProperties?.addEventListener("click", async () => {
  if (!elements.propertyCode?.value || elements.copyProperties.disabled) return;
  try {
    await navigator.clipboard.writeText(elements.propertyCode.value);
    elements.copyProperties.textContent = "Copied";
    window.setTimeout(() => {
      elements.copyProperties.textContent = "Copy";
    }, 1000);
  } catch {
    elements.propertyCode.focus();
    elements.propertyCode.select();
  }
});

elements.propertyCode?.addEventListener("focus", () => {
  elements.propertyCode.select();
});

setContainersCollapsed(localStorage.getItem(CONTAINERS_COLLAPSED_KEY) === "1", { persist: false, animate: false });

