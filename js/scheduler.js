// Paint scheduler.
//
// render() is the universal "something changed" signal: every module calls it,
// including the ones that do the painting. Holding it here, with painters
// registering themselves, is what keeps that from being a dependency cycle.
// This module imports nothing on purpose.

const painters = [];
let frameHandle = 0;

function registerPainter(painter) {
  painters.push(painter);
}

function paint() {
  for (const painter of painters) painter();
}

// Synchronous repaint. Only for cases that must not show an intermediate frame,
// such as resizing the canvas backing store, which clears it.
function renderNow() {
  if (frameHandle) {
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  paint();
}

// Collapses the several render() calls one event can produce into a single paint.
function render() {
  if (frameHandle) return;
  frameHandle = requestAnimationFrame(() => {
    frameHandle = 0;
    paint();
  });
}
