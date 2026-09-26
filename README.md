# OSINT Command Center

OSINT Command Center is a desktop Electron application for running a small set of lawful, locally installed OSINT command-line tools through a guided interface.

## Current version

2.1.1

## Included integrations

- Sherlock — username discovery
- Maigret — username investigation
- Holehe — email registration checks
- PhoneInfoga — phone-number OSINT
- theHarvester — domain/email/hostname discovery
- Subfinder — passive subdomain discovery
- Amass — passive domain enumeration

The external tools are **not bundled**. Install the tools you intend to use and make sure their native executable or console entry point is available on PATH.

## Development

Requirements:

- Node.js 22.12 or newer
- npm

Install dependencies:

```bash
npm install
```

Run the automated tests:

```bash
npm test
```

Start the app:

```bash
npm start
```

Start with Chromium developer tools:

```bash
npm run dev
```

## Build

Windows:

```bash
npm run build:win
```

macOS:

```bash
npm run build:mac
```

Linux:

```bash
npm run build:linux
```

Build output is written to `dist/`.

The GitHub Actions Windows workflow runs the test suite, builds both the NSIS installer and portable Windows x64 package, and uploads the `dist/` output as a workflow artifact.

## Data and safety model

Investigation data is stored locally under Electron's application user-data directory. The application validates case IDs and target formats, blocks path traversal and symlink traversal in the results store, restricts renderer IPC to the trusted main frame, disables renderer Node integration, denies new-window/navigation requests, and executes tools without a shell.

Use only public, licensed, or otherwise lawfully accessible information and follow the terms and laws that apply to each provider and target.

See [SOURCES.md](SOURCES.md) for upstream tool references.
