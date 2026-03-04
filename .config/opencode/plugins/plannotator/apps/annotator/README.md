# Plannotator Annotator UI

This directory contains the main Plan Annotation UI for Plannotator. It is used by the OpenCode plugin to provide a visual interface for reviewing and annotating implementation plans.

## Features

- Visual annotation of implementation plans (delete, insert, replace, comment)
- Image attachment and annotation support
- Obsidian and Bear integrations
- Dark/Light mode support

## How It Works

This component is built as a single-file SPA that is embedded into the OpenCode plugin. When the agent submits a plan, the plugin starts a local server serving this UI.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PLANNOTATOR_REMOTE` | Set to `1` for remote mode (devcontainer, SSH). Skips browser auto-open. |
| `PLANNOTATOR_PORT` | Fixed port to use. Default: random locally. |
| `PLANNOTATOR_BROWSER` | Custom browser to open plans in. |
