# HydroCalc 2

Cross-platform soil preferential flow image analysis for macOS and Windows.

HydroCalc uses Vue 3 + TypeScript, Electron + Node.js, an independent OpenCV C++ worker, SQLite history, JSON settings, and Electron Forge. It includes no Python runtime or AI dependencies.

## Features

- Automatic color/binary input detection, explicit HSV and binary modes.
- Dual-handle HSV controls with keyboard and precise numeric input; automatic settings persistence.
- Seven physically calibrated indicators and an interactive depth profile.
- K-means clustering with separate blurred/unblurred images and color statistics.
- Multi-image and recursive folder imports, bounded queues, per-image failures, cancellation of waiting items, and retries.
- PNG, Excel pixel matrix, indicator/profile CSV, individual ZIP bundles and streamed batch archives with summary CSV.
- Persistent SQLite history and configuration snapshots.
- Neutral off-white surfaces, muted mint accents, One Dark Pro-inspired dark mode, Chinese and English.

## Development

Requires Node.js 24, CMake 3.24+, and a C++17 compiler. macOS needs Xcode Command Line Tools and Ninja. Windows needs Visual Studio 2022 Desktop development with C++ and CMake.

```sh
npm ci
npm run build:native
npm run dev
```

OpenCV 4.12.0 and nlohmann/json 3.12.0 are downloaded with SHA-256 verification. Only OpenCV core, imgproc, and imgcodecs are built. Electron manages the UI development server and all native processes.

```sh
npm run build:ui
npm test
npm run test:desktop
npm run make
```

Build on each target OS and architecture. Forge creates Mac DMG/ZIP and Windows Squirrel/ZIP artifacts. End users do not need Node.js or OpenCV. Signing and Apple notarization are not configured for local development builds.

The default calibration is a 50 × 50 cm profile at 500 × 500 pixels. Limits: 20 MB / 30 million source pixels per image and 64–2000 pixels per processing dimension. Binary images use black for stained pixels. All images in a batch use the same settings snapshot; individual failures do not stop the batch.

See [architecture](docs/ARCHITECTURE.md), [metric definitions](docs/METRICS.md), and [validation](docs/VALIDATION.md) for implementation details and verification limits. The old README's unimplemented 3D, training, and regression claims are not represented as existing features.
