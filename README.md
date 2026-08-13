# Pixel Perfect

Pixel Perfect is a small local web app for measuring UI screenshots precisely.

It is built as a static app with plain HTML, CSS and JavaScript. There is no backend, no build step and no external dependency.

## Features

- Open an image from disk.
- Drag and drop an image into the viewport.
- Paste an image from the clipboard with `Cmd+V` / `Ctrl+V`.
- Zoom, pan and inspect pixels at high scale.
- Measure rectangles with width, height and image coordinates.
- Measure distances with horizontal, vertical and total distance.
- Edit existing rectangles with handles.
- Edit existing distances by moving endpoints.
- Add draggable guides from the top and left rulers.
- Optional `Snap to guides` for rectangles and distances.
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
- `Delete` / `Backspace`: Delete selected measurement, guide or color swatch
- `Cmd/Ctrl + 0`: Fit to screen
- `Cmd/Ctrl + 1`: Zoom 100%
- `Esc`: Cancel current action
- `Space + drag`: Pan
- `Cmd/Ctrl/Alt + wheel`: Zoom around cursor

## Guides

Guides work like in design tools:

- Drag from the top ruler to create a horizontal guide.
- Drag from the left ruler to create a vertical guide.
- Select and drag an existing guide to move it.
- Drag a guide outside the image or press `Delete` to remove it.

## Local Data

Pixel Perfect stores data only in the browser:

- Measurements, guides, swatches and settings are stored in `localStorage`.
- Recent project images are stored in `IndexedDB`.

No image or measurement data is sent anywhere.

## Project Structure

```text
.
├── index.html
├── styles.css
├── app.js
└── images/
    ├── pixel-perfect.svg
    ├── select.svg
    ├── rectangle.svg
    ├── distance.svg
    └── eyedrop.svg
```

## Deploy With GitHub Pages

This project is static and can be deployed directly with GitHub Pages.

In the GitHub repository:

1. Open `Settings`.
2. Go to `Pages`.
3. Choose `Deploy from a branch`.
4. Select branch `main`.
5. Select folder `/root`.
6. Save.

The site will be available at:

```text
https://Gwilain.github.io/pixel-perfect/
```

## License

MIT
