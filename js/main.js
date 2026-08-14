// Entry point. Every other module only declares things; nothing runs on import.
// The order below is the whole bootstrap: register painters, wire listeners,
// then read persisted state and paint the first frame.


initCanvasPainter();
initContainersPanel();
initEvents();
startApp();
