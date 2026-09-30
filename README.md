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

## Dashboard research categories

The pearl-and-platinum dashboard groups the research roadmap into six categories.
The People & Identity and Organizations & Websites cards currently open the existing
New Investigation workflow (with an appropriate starting target type).
In a saved case, **Add tool run** offers only detected tools compatible with that case's
target type. It prefills and locks the target and case ID in the runner until the user
returns to normal Tool Runner navigation. Runs are launched individually and recorded
in separate run directories under the same case, with best-effort provenance capture.
The case summary's tool/status refers to its most recent run; earlier run records are
retained separately. This does not imply automatic multi-tool orchestration or cross-source verification.
The other four categories are clearly marked **In development** and are informational,
not buttons: Vehicles & Assets; Public & Legal Records; Media & Documents; Places & History.
They will only become interactive when their underlying workflows are implemented and tested.

Tool detection is under **Settings → System Health** instead of the primary dashboard.
The main dashboard summarizes saved local cases and result files; it does not claim that
planned modules or a complete multi-source evidence engine are already operational.

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

## Per-run evidence foundation (in development)

After a run finishes, the app attempts to capture a local `evidence.json` manifest
next to its `run.json` and output files. Capture failures and interrupted runs can
leave provenance unavailable. Capture status and failure warnings are saved with
the run and shown when the case is reopened. Tool completion is separate from
provenance capture success. A manifest records tool identity, case/run IDs, target,
execution timestamps and status, and for each regular output file up to 500
entries within a 1 MiB manifest limit: relative name, size and SHA-256 (files over
100 MiB are marked unhashed). Entry, traversal-depth or manifest-size limits mark
the artifact listing as truncated. Existing cases with no manifest remain readable.
Unreadable manifests produce warnings without blocking case files or other valid
run records. Output manifests are excluded from dashboard result-file counts;
**Case files** lists all saved files, including metadata. Inspect manifests in **Run provenance**
section and in an exported case ZIP.

The records are a local audit aid, not tamper-proof storage. Hashes are taken
when the run ends; a later change to the file is **not** automatically detected
or independently verified. CLI output is labeled **unreviewed**. A tool match
is not a confirmed identity, and a CLI result is not itself an independently
verified original source. No new paid APIs or third-party accounts are used by
this evidence foundation. Existing external tools still require installation.

This is the first piece of a multi-source engine, **not** automatic cross-source
correlation, verification, or a complete 21-module implementation.

## Data and safety model

Investigation data is stored locally under Electron's application user-data directory. The application validates case IDs and target formats, blocks path traversal and symlink traversal in the results store, restricts renderer IPC to the trusted main frame, disables renderer Node integration, denies new-window/navigation requests, and executes tools without a shell.

Use only public, licensed, or otherwise lawfully accessible information and follow the terms and laws that apply to each provider and target.

See [SOURCES.md](SOURCES.md) for upstream tool references.
