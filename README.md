# Landing Page Design-to-HTML

Upload a landing page design screenshot and generate a complete HTML document with AI. The app serves a browser UI for drag-and-drop upload, exact-clone mode, optional fidelity notes, generated-code copy/download, same-size preview, side-by-side comparison, and iterative refinement.

## Requirements

- Node.js 18 or newer
- An OpenAI API key with access to a vision-capable model

## Run locally

```bash
export OPENAI_API_KEY="your-api-key"
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

By default the server uses `gpt-4.1` for better visual fidelity. You can override it with:

```bash
OPENAI_MODEL="your-model" npm start
```

For closer matches, upload a sharp full-page screenshot and keep **Exact landing page clone mode** enabled. If the first result is not close enough, describe what is wrong and use **Refine current result** to revise the generated HTML against the same screenshot. **Deep analysis mode** is available for smaller screenshots, but it is slower and may hit browser/proxy timeouts on large uploads.

## Test

```bash
npm test
```
