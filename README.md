# QAPilot

**Real-time PostHog log viewer for VS Code**

QAPilot brings your PostHog event logs directly into VS Code, so you can monitor user analytics and debug events without leaving your editor.

## Features

- **Real-time log streaming** — Poll your PostHog project for the latest events as you develop
- **Filterable log view** — Search and filter events by name, properties, or timestamp
- **Chat with logs** - Ask questions to your logs and get deeper insights

## Getting Started

1. Open the **QAPilot** panel from the bottom panel bar
2. Click **Get Started**
3. Enter your **PostHog API key**, **project ID** and **OpenAI API Key** when prompted
4. Wait a few seconds for live stream to start!

## Requirements

- A [PostHog](https://posthog.com) account and project
- VS Code 1.85 or later

## Extension Settings

API keys are stored securely via VS Code's built-in secret storage. No configuration files are written to disk.

## Release Notes

### 0.0.3

Initial release with bug fixes — real-time PostHog log viewer connected to an intelligence layer for log insights
