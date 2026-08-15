# Pixel Perfect

Pixel Perfect is a small local web app for measuring UI screenshots precisely.

It is built as a static app with plain HTML, CSS and JavaScript. There is no backend, no build step and no external dependency.

## Features

- Open an image from disk.
- Start a new empty project without reloading the app.
- Drag and drop an image into the viewport.
- Paste an image from the clipboard with `Cmd+V` / `Ctrl+V`.
- Capture a browser tab or window through the browser screen picker.
- Crop a captured or imported image before measuring.
- Zoom, pan and inspect pixels at high scale.
- Scale measurements from a theoretical width or height while preserving the image ratio.
- Display measurement labels as `px`, `rem`, `%` or viewport units (`vw` horizontally and `vh` vertically).
- Organize rectangles and distances in a Containers panel with parent-relative percentages.
- Measure rectangles with width, height and image coordinates.
- Measure distances with horizontal, vertical and total distance.
- Edit existing rectangles with handles.
- Measure rectangle corner radius with inner radius handles.
- Edit existing distances by moving endpoints.
- Reorder and parent measurements from the Containers panel.
- Add draggable guides from the top and left rulers.
- Optional `Snap to guides` for rectangles and distances.
- Smart guides for temporary alignment with existing rectangle edges and distance points.
- Optional `Pixel perfect` mode with a cursor loupe and whole-pixel snapping for rectangles and distances.
- Custom colors for rectangles, distances, guides and their selected states.
- Custom `rem` base for converted measurement labels.
- Adjustable loupe frame size for pixel-perfect inspection.
- Pick colors with the eyedropper.
- Keep copied color swatches and copy them again by clicking.
- Export and import measurements as JSON.
- Store recent local projects in the browser with IndexedDB/localStorage.

## Run Locally

The app can be opened directly from `index.html`, but a local server is recommended because browser APIs are more consistent that way.

From the project folder:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

## Keyboard Shortcuts

- `V`: Select
- `R`: Rectangle measurement
- `D`: Distance measurement
- `I`: Eyedropper
- `Z`: Zoom
- `C`: Crop
- `P`: Toggle pixel perfect mode
- `Enter`: Apply current crop
- `Cmd/Ctrl + Z`: Undo recent drawing, crop, guide, swatch, import, clear or image replacement actions
- `Delete` / `Backspace`: Delete selected measurement, guide or color swatch
- `Cmd/Ctrl + S`: Save the project (writes back to its file where supported; a fresh download otherwise)
- `Cmd/Ctrl + Shift + S`: Save the project as a new file
- `0`: Back to 100% and recenter the image (numpad zero, or the top-row zero, which needs `Shift` on AZERTY)
- `Cmd/Ctrl + 0`: Fit to screen
- `Cmd/Ctrl + 1`: Back to 100% and recenter, same as `0`

Zoom is expressed against the theoretical size, like every other measurement. With
`Theo W` set to 400 on an 800px image, 100% draws the image 400px wide, so one
theoretical pixel is one screen pixel. Without a theoretical size, 100% is a plain 1:1.
- `Esc`: Cancel current action
- `Space + drag`: Pan
- Zoom tool: click to zoom in, `Alt`+click to zoom out, drag right/left to zoom in/out
- Crop tool: `Alt`+drag a handle to resize from center
- Rectangle and crop tools: hold `Shift` to constrain proportions
- Rectangle radius handles: drag to apply one radius to all corners, hold `Alt` to edit only that corner
- `Cmd/Ctrl/Alt + wheel`: Zoom around cursor

## Guides

Guides work like in design tools:

- Drag from the top ruler to create a horizontal guide.
- Drag from the left ruler to create a vertical guide.
- Select and drag an existing guide to move it.
- Drag a guide outside the image or press `Delete` to remove it.

## Saving a Project

A `.pixelperfect` file is a zip archive holding the image and every measurement,
guide and swatch. Saving it is two different things depending on the browser:

- **Chrome and Edge** can write to a file on disk directly (the File System
  Access API). The first save shows a picker; every save after that writes back
  to the same file in place, no picker, no growing pile of copies in
  Downloads. `Cmd/Ctrl + Shift + S` picks a different file.
- **Firefox and Safari** don't expose that API at all, so saving is a plain
  download of a new `.pixelperfect` file each time — the only thing a web page
  can do there.

The status bar shows **Saved** once the project is written, or **• Unsaved**
after any change. Closing the tab with unsaved changes asks for confirmation.

Autosave is a separate, smaller safety net, not a replacement for saving: it
keeps the current annotations for the current image so a crash or an accidental
reload doesn't lose everything, but it is browser storage, which the browser is
free to clear under storage pressure. The `.pixelperfect` file is the actual
document.

## Local Data

Pixel Perfect stores data only in the browser:

- Measurements, guides, swatches and settings are stored in `localStorage`.
- Recent projects are stored in `IndexedDB`: a project opened or saved through
  the file picker is remembered as a pointer to that file, so reopening it asks
  to read the file itself and never goes stale; a project without picker
  support is remembered as a full copy of the image, capped at 3 recents to
  keep storage bounded.

No image or measurement data is sent anywhere.

## Project Structure

Scripts load in dependency order. `scheduler.js` and `core.js` depend on nothing;
`main.js` runs the bootstrap once every other file has been declared. No file does
any work when it loads, which is what keeps that order safe to reason about.

```text
.
|-- index.html
|-- styles.css
|-- js/
|   |-- scheduler.js    paint scheduling; every render() call goes through it
|   |-- core.js         state, DOM handles, geometry, units, undo, storage
|   |-- app.js          viewport, zoom and tool selection
|   |-- project.js      image loading, capture, crop, snapping, persistence
|   |-- interaction.js  hit testing, handles, swatches, status bar
|   |-- render.js       canvas painting
|   |-- containers.js   properties panel
|   |-- events.js       pointer and keyboard handling, listener wiring
|   `-- main.js         entry point
`-- images/
    |-- pixel-perfect.svg
    |-- new.svg
    |-- open.svg
    |-- capture.svg
    |-- select.svg
    |-- rectangle.svg
    |-- distance.svg
    |-- zoom.svg
    |-- crop.svg
    `-- eyedrop.svg
```

## Deploy With GitHub Pages

This project is static and is deployed by the workflow in
`.github/workflows/pages.yml`, which uploads the repository root on every push to
`main`. There is no build step.

In the GitHub repository:

1. Open `Settings`.
2. Go to `Pages`.
3. Under `Source`, choose `GitHub Actions`.

The site will be available at:

```text
https://Gwilain.github.io/pixel-perfect/
```

## License

MIT
