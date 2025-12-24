# Testing Luma Tools

This project uses [Playwright](https://playwright.dev/) for End-to-End (E2E) testing. These tests verify the application by running it in a real browser and simulating user interactions like mode switching, drag-and-drop, and MIDI communication.

The test files are located in `public/tests/e2e/`.

## 1. Installation

Before running the tests for the first time, you need to install the project dependencies and the Playwright browser binaries.

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)

### Step-by-Step Setup
1. **Install Node dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright browsers:**
   This command downloads the specific browser versions required for testing (Chromium).
   ```bash
   npx playwright install --with-deps chromium
   ```

## 2. Running Tests

You can run the tests in different modes depending on whether you are debugging or running them in a CI environment.

### Run All Tests (Headless)
This is the fastest way to run all tests. It runs in the background without opening a browser window.
```bash
npm run test:e2e
```

### Run with UI Mode (Recommended for Debugging)
Playwright includes a powerful UI mode that lets you see the tests running in real-time, inspect the DOM at every step, and see console logs.
```bash
npx playwright test --ui
```

### Run a Specific Test File
If you only want to run one set of tests (e.g., the MIDI tests):
```bash
npx playwright test public/tests/e2e/midi_read.spec.ts
```

### View Test Report
If a test fails in headless mode, Playwright generates a detailed HTML report.
```bash
npx playwright show-report
```

## 3. Test Suite Overview (Located in `public/tests/e2e/`)
- `smoke.spec.ts`: Basic page load and mode switching.
- `drag_drop.spec.ts`: Moving waveforms between the editor and bank slots.
- `midi_read.spec.ts`: Mocking MIDI hardware to test sample loading.
- `editor_ui.spec.ts`: Selection handles, text input, and sample manipulation (Reverse/Select All).
- `file_upload.spec.ts`: Dragging and dropping .wav and .bin files from your computer.
- `audio_processing.spec.ts`: Integrity tests for audio manipulation (Reverse round-trip).
- `export_zip.spec.ts`: Validating the bank export process and ZIP content.

