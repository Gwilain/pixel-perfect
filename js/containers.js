let containerDrag = null;

function setContainersCollapsed(collapsed, options = {}) {
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

function renderContainersPanel() {
  if (!elements.containerList) return;
  elements.containerList.replaceChildren();

  const items = state.measurements.filter((item) => item.type === "rect" || item.type === "distance");
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "container-empty";
    empty.textContent = "No containers yet";
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

    const icon = document.createElement("span");
    icon.className = "container-icon";
    icon.textContent = item.type === "rect" ? "R" : "D";

    const name = document.createElement("span");
    name.className = "container-name";
    name.textContent = measurementLabel(item);

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

    row.append(icon, name, unit);
    elements.containerList.append(row);
    for (const child of childrenByParent.get(item.id) ?? []) appendItem(child, depth + 1);
  };

  for (const item of childrenByParent.get("root") ?? []) appendItem(item);
}

elements.containerList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("select")) return;
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
  if (target?.closest("select")) return;
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

elements.toggleContainers.addEventListener("click", () => {
  setContainersCollapsed(!document.body.classList.contains("containers-collapsed"));
});

setContainersCollapsed(localStorage.getItem(CONTAINERS_COLLAPSED_KEY) === "1", { persist: false });

