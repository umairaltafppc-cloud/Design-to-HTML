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
  const existingHtml = typeof body.existingHtml === "string" ? body.existingHtml.trim().slice(0, 80000) : "";
  const exactClone = body.exactClone !== false;
  const deepAnalysis = body.deepAnalysis === true;

  return { imageDataUrl, instructions, width, height, existingHtml, exactClone, deepAnalysis };
}

function buildVisualSpecPrompt({ instructions = "", width = null, height = null } = {}) {
  const extraInstructions = instructions
    ? `\nUser notes to honor while analyzing:\n${instructions}\n`
    : "";
  const dimensions = width && height
    ? `The screenshot artboard is ${width}px wide by ${height}px tall.\n`
    : "";

  return `You are a design QA analyst preparing a landing-page screenshot for exact HTML recreation.

Analyze the screenshot and produce a detailed visual implementation spec. Return plain text only.

${dimensions}Describe:
- Overall page structure and section order.
- Exact visible text, labels, CTA copy, navigation items, badges, and headings.
- Background colors, gradients, images, decorative shapes, shadows, borders, and radii.
- Layout measurements in CSS pixels: artboard, columns, margins, gaps, card sizes, button sizes, image/icon positions, and vertical offsets.
- Typography: likely font family style, font sizes, weights, line heights, letter spacing, and colors.
- Responsive/artboard constraints needed to make the first render match the screenshot.
- Any assets/icons/images that must be approximated with CSS, inline SVG, gradients, or placeholders.

Be exhaustive and concrete. Prefer pixel estimates over vague language.${extraInstructions}`;
}

function buildPrompt({ instructions = "", width = null, height = null, existingHtml = "", visualSpec = "" } = {}) {
  const extraInstructions = instructions
    ? `\nAdditional user instructions:\n${instructions}\n`
    : "";
  const dimensions = width && height
    ? `\nScreenshot dimensions: ${width}px wide by ${height}px tall. Build the primary artboard at exactly ${width}px by ${height}px before adding any responsive behavior.\n`
    : "";
  const refinement = existingHtml
    ? `\nYou are refining an existing attempt. Compare the screenshot to the current HTML and rewrite the document so it matches the screenshot more closely. Keep any parts that are already correct, but freely replace layout, spacing, typography, colors, and shapes that do not match.\n\nCurrent HTML attempt:\n${existingHtml}\n`
    : "";
  const specContext = visualSpec
    ? `\nDetailed visual spec extracted from the screenshot:\n${visualSpec}\n`
    : "";

  return `You are a meticulous senior frontend engineer cloning a landing-page design screenshot into production-ready frontend code.

Create a single, complete HTML document that visually recreates the screenshot as closely as possible. Include semantic HTML and CSS in a <style> block. Do not use external assets, external fonts, frameworks, build tools, markdown fences, or explanatory text.${dimensions}

Fidelity requirements:
- Return only the complete HTML document.
- Before writing code, silently analyze the screenshot as a visual spec: section order, exact text, colors, spacing, typography, assets, and component dimensions.
- Match the screenshot's visible landing-page artboard first; avoid inventing new content or changing the composition.
- The rendered first viewport must never be blank or plain white unless the screenshot itself is blank. Include visible text, sections, cards, buttons, images/placeholders, or decorative shapes from the screenshot.
- Preserve all visible text exactly when readable, including line breaks and CTA labels.
- When screenshot dimensions are provided, create a top-level artboard/page frame that is exactly that width and height in CSS pixels. The design must match at that viewport size.
- Use absolute positioning only where it improves visual fidelity. Otherwise use CSS grid/flex with explicit pixel measurements inferred from the screenshot.
- Recreate the layout hierarchy, alignment, whitespace, border radii, shadows, gradients, colors, and typography from the image.
- Estimate sizes, offsets, line heights, font weights, and spacing in pixels from the screenshot.
- Use CSS shapes, gradients, emoji-free placeholders, and inline SVG/data-URI patterns when image assets or icons are visible but unavailable.
- If text is legible, preserve it exactly. If text is not legible, use similar-length placeholder text so the layout still matches.
- Make the initial viewport match the screenshot composition exactly; add responsive behavior only after preserving the provided screenshot view.
- Include accessible labels where they do not alter the visual output.
- Use CSS reset rules so browser defaults do not distort spacing.${extraInstructions}${specContext}${refinement}`;
}

function buildVisualSpecRequest({ imageDataUrl, instructions, width, height, model = DEFAULT_MODEL }) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildVisualSpecPrompt({ instructions, width, height })
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high"
          }
        ]
      }
    ],
    temperature: 0.05,
    max_output_tokens: 5000
  };
}

function buildOpenAIRequest({ imageDataUrl, instructions, width, height, existingHtml, visualSpec, model = DEFAULT_MODEL }) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt({ instructions, width, height, existingHtml, visualSpec })
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

function extractResponseText(responseBody) {
  if (typeof responseBody?.output_text === "string" && responseBody.output_text.trim()) {
    return responseBody.output_text.trim();
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
    throw new Error("The AI response did not include text.");
  }

  return html;
}

function extractGeneratedHtml(responseBody) {
  return stripMarkdownFence(extractResponseText(responseBody));
}

function stripHtmlForAnalysis(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyBlankHtml(html) {
  if (typeof html !== "string" || html.trim().length < 80) {
    return true;
  }

  const normalized = html.toLowerCase();
  const bodyMatch = normalized.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : normalized;
  const visibleText = stripHtmlForAnalysis(bodyHtml);
  const hasMediaOrShapes = /<(img|svg|canvas|picture)\b/i.test(bodyHtml);
  const hasCommonContent = /<(h[1-6]|p|a|button|section|article|main|nav|header|footer|span|div)\b/i.test(bodyHtml);
  const hasVisualCss = /(background|gradient|box-shadow|border|color|transform|position|display\s*:|grid|flex|width\s*:|height\s*:)/i.test(html);
  const hasOnlyWhitespaceBody = bodyHtml.replace(/<!--[\s\S]*?-->/g, "").replace(/&nbsp;/g, "").trim().length === 0;
  const hasMostlyEmptyWhitePage = /background(?:-color)?\s*:\s*(white|#fff|#ffffff|rgb\(255,\s*255,\s*255\))/i.test(html)
    && visibleText.length < 12
    && !hasMediaOrShapes;

  return hasOnlyWhitespaceBody || (!hasMediaOrShapes && !hasCommonContent) || (!hasVisualCss && visibleText.length < 12) || hasMostlyEmptyWhitePage;
}

function buildBlankRetryInstructions(instructions = "") {
  const prefix = instructions ? `${instructions}\n\n` : "";
  return `${prefix}The previous HTML rendered as a blank white page. Regenerate the landing page so the first viewport contains visible, high-contrast content matching the screenshot: header/navigation, hero section, readable text, CTA buttons, cards/images/placeholders, backgrounds, borders, and spacing. Do not return an empty body, a plain white page, or invisible white-on-white content.`;
}

async function postOpenAIRequest({ payload, apiKey, fetchImpl }) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = responseBody?.error?.message || "OpenAI request failed.";
    throw Object.assign(new Error(detail), { statusCode: response.status });
  }

  return responseBody;
}

async function generateHtml({ imageDataUrl, instructions, width, height, existingHtml, exactClone = true, deepAnalysis = false, apiKey, fetchImpl = fetch, model = DEFAULT_MODEL }) {
  if (!apiKey) {
    throw Object.assign(new Error("Set OPENAI_API_KEY before generating HTML."), { statusCode: 500 });
  }

  let visualSpec = "";
  if (exactClone && deepAnalysis && !existingHtml) {
    const specResponseBody = await postOpenAIRequest({
      apiKey,
      fetchImpl,
      payload: buildVisualSpecRequest({ imageDataUrl, instructions, width, height, model })
    });
    visualSpec = extractResponseText(specResponseBody);
  }

  const htmlResponseBody = await postOpenAIRequest({
    apiKey,
    fetchImpl,
    payload: buildOpenAIRequest({ imageDataUrl, instructions, width, height, existingHtml, visualSpec, model })
  });

  const html = extractGeneratedHtml(htmlResponseBody);
  if (!isLikelyBlankHtml(html)) {
    return html;
  }

  const retryResponseBody = await postOpenAIRequest({
    apiKey,
    fetchImpl,
    payload: buildOpenAIRequest({
      imageDataUrl,
      instructions: buildBlankRetryInstructions(instructions),
      width,
      height,
      existingHtml: html,
      visualSpec,
      model
    })
  });
  const retryHtml = extractGeneratedHtml(retryResponseBody);
  if (isLikelyBlankHtml(retryHtml)) {
    throw Object.assign(
      new Error("The AI returned a blank-looking page. Try a clearer screenshot or add notes describing the visible hero, text, colors, and sections."),
      { statusCode: 502 }
    );
  }

  return retryHtml;
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
  buildVisualSpecPrompt,
  buildVisualSpecRequest,
  createServer,
  extractGeneratedHtml,
  extractResponseText,
  generateHtml,
  isLikelyBlankHtml,
  validateGenerateRequest
};
