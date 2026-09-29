# OSINT Command Center

OSINT Command Center is a desktop Electron application for running a small set of lawful, locally installed OSINT command-line tools through a guided interface.

## Current version

2.1.1

## Chromebook

**Primary Chromebook build:** ChromeOS x86_64 using the built-in Linux development environment.

GitHub now builds a Chromebook-ready Debian package automatically:

`OSINT Command Center-2.1.1-linux-x64.deb`

On the Chromebook:

1. Open **Settings → Advanced → Developers → Linux development environment** and turn Linux on.
2. Download the Chromebook build artifact from this repository's **Actions → Build Chromebook Package** workflow.
3. Extract the downloaded artifact ZIP.
4. In the Files app, double-click the `.deb` file and choose **Install with Linux**.
5. Open **OSINT Command Center** from the ChromeOS launcher under **Linux apps**.

The external OSINT command-line tools still run inside the Chromebook Linux environment, so any tool you want to use must also be installed there.

To build it yourself inside Linux:

```bash
npm install
npm run build:chromebook
```

The Chromebook build output is written to `dist/`.

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

Start the app:

```bash
npm start
```

Start with Chromium developer tools:

```bash
npm run dev
```

Check the core and dashboard behavior:

```bash
npm test
npm run test:ui
```

The UI smoke check uses isolated sample cases and simulated tools. It checks
the approved emblem, image failure handling, header layout at 1366×768 and
1000×700, status contrast, and tool shortcuts during and after a run. It does
not execute external OSINT tools or read your saved cases. A successful check
does not replace opening the app with `npm start` on the Chromebook.

## Other builds

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

## Data and safety model

Investigation data is stored locally under Electron's application user-data directory. The application validates case IDs and target formats, blocks path traversal and symlink traversal in the results store, restricts renderer IPC to the trusted main frame, disables renderer Node integration, denies new-window/navigation requests, and executes tools without a shell.

Use only public, licensed, or otherwise lawfully accessible information and follow the terms and laws that apply to each provider and target.

See [SOURCES.md](SOURCES.md) for upstream tool references.
