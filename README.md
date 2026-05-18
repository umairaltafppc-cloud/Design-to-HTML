# Design-to-HTML

Upload a design screenshot and generate a complete HTML document with AI. The app serves a browser UI for drag-and-drop screenshot upload, optional generation notes, generated-code copy/download, and an iframe preview.

## Requirements

- Node.js 18 or newer
- An OpenAI API key with access to a vision-capable model

## Run locally

```bash
export OPENAI_API_KEY="your-api-key"
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

By default the server uses `gpt-4.1-mini`. You can override it with:

```bash
OPENAI_MODEL="your-model" npm start
```

## Test

```bash
npm test
```
