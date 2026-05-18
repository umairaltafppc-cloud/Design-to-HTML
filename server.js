const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (tooLarge) {
        return;
      }

      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function validateGenerateRequest(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("Request body is required."), { statusCode: 400 });
  }

  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
  if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(imageDataUrl)) {
    throw Object.assign(
      new Error("Upload a PNG, JPG, or WebP screenshot before generating code."),
      { statusCode: 400 }
    );
  }

  const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1200) : "";
  const width = Number.isInteger(body.width) && body.width > 0 && body.width <= 10000 ? body.width : null;
  const height = Number.isInteger(body.height) && body.height > 0 && body.height <= 10000 ? body.height : null;

  return { imageDataUrl, instructions, width, height };
}

function buildPrompt({ instructions = "", width = null, height = null } = {}) {
  const extraInstructions = instructions
    ? `\nAdditional user instructions:\n${instructions}\n`
    : "";
  const dimensions = width && height
    ? `\nScreenshot dimensions: ${width}px wide by ${height}px tall. Build the primary artboard at exactly ${width}px by ${height}px before adding any responsive behavior.\n`
    : "";

  return `You are a meticulous senior frontend engineer converting a design screenshot into production-ready frontend code.

Create a single, complete HTML document that visually recreates the screenshot as closely as possible. Include semantic HTML and CSS in a <style> block. Do not use external assets, external fonts, frameworks, build tools, markdown fences, or explanatory text.${dimensions}

Fidelity requirements:
- Return only the complete HTML document.
- Match the screenshot's visible artboard first; avoid inventing new content or changing the composition.
- When screenshot dimensions are provided, create a top-level artboard/page frame that is exactly that width and height in CSS pixels. The design must match at that viewport size.
- Use absolute positioning only where it improves visual fidelity. Otherwise use CSS grid/flex with explicit pixel measurements inferred from the screenshot.
- Recreate the layout hierarchy, alignment, whitespace, border radii, shadows, gradients, colors, and typography from the image.
- Estimate sizes, offsets, line heights, font weights, and spacing in pixels from the screenshot.
- Use CSS shapes, gradients, emoji-free placeholders, and inline SVG/data-URI patterns when image assets or icons are visible but unavailable.
- If text is legible, preserve it exactly. If text is not legible, use similar-length placeholder text so the layout still matches.
- Make the initial viewport match the screenshot composition exactly; add responsive behavior only after preserving the provided screenshot view.
- Include accessible labels where they do not alter the visual output.
- Use CSS reset rules so browser defaults do not distort spacing.${extraInstructions}`;
}

function buildOpenAIRequest({ imageDataUrl, instructions, width, height, model = DEFAULT_MODEL }) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt({ instructions, width, height })
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high"
          }
        ]
      }
    ],
    temperature: 0.1,
    max_output_tokens: MAX_OUTPUT_TOKENS
  };
}

function stripMarkdownFence(value) {
  return value.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractGeneratedHtml(responseBody) {
  if (typeof responseBody?.output_text === "string" && responseBody.output_text.trim()) {
    return stripMarkdownFence(responseBody.output_text);
  }

  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  const textParts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  const html = textParts.join("\n").trim();
  if (!html) {
    throw new Error("The AI response did not include generated HTML.");
  }

  return stripMarkdownFence(html);
}

async function generateHtml({ imageDataUrl, instructions, width, height, apiKey, fetchImpl = fetch, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw Object.assign(new Error("Set OPENAI_API_KEY before generating HTML."), { statusCode: 500 });
  }

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildOpenAIRequest({ imageDataUrl, instructions, width, height, model }))
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = responseBody?.error?.message || "OpenAI request failed.";
    throw Object.assign(new Error(detail), { statusCode: response.status });
  }

  return extractGeneratedHtml(responseBody);
}

async function handleGenerate(req, res, deps = {}) {
  try {
    const body = await parseJsonBody(req, deps.maxBodyBytes);
    const request = validateGenerateRequest(body);
    const html = await generateHtml({
      ...request,
      apiKey: deps.apiKey ?? process.env.OPENAI_API_KEY,
      fetchImpl: deps.fetchImpl,
      model: deps.model
    });

    sendJson(res, 200, { html });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Something went wrong." });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const contents = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(contents);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function createServer(deps = {}) {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      handleGenerate(req, res, deps);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Design-to-HTML converter running at http://localhost:${PORT}`);
  });
}

module.exports = {
  buildOpenAIRequest,
  buildPrompt,
  createServer,
  extractGeneratedHtml,
  generateHtml,
  validateGenerateRequest
};
