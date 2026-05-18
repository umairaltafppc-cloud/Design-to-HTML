const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildOpenAIRequest,
  buildPrompt,
  extractGeneratedHtml,
  validateGenerateRequest
} = require("../server");

const SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgo=";

test("validateGenerateRequest accepts supported image data urls", () => {
  const result = validateGenerateRequest({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Use a dark theme."
  });

  assert.equal(result.imageDataUrl, SAMPLE_IMAGE);
  assert.equal(result.instructions, "Use a dark theme.");
});

test("validateGenerateRequest rejects unsupported image payloads", () => {
  assert.throws(
    () => validateGenerateRequest({ imageDataUrl: "data:text/html;base64,PGgxPk5vPC9oMT4=" }),
    /Upload a PNG, JPG, or WebP/
  );
});

test("buildPrompt includes optional user instructions", () => {
  const prompt = buildPrompt("Make the nav sticky.");

  assert.match(prompt, /Return only the complete HTML document/);
  assert.match(prompt, /Make the nav sticky/);
});

test("buildOpenAIRequest sends screenshot and prompt to responses API shape", () => {
  const payload = buildOpenAIRequest({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Prioritize semantic sections.",
    model: "test-model"
  });

  assert.equal(payload.model, "test-model");
  assert.equal(payload.input[0].content[0].type, "input_text");
  assert.equal(payload.input[0].content[1].type, "input_image");
  assert.equal(payload.input[0].content[1].image_url, SAMPLE_IMAGE);
});

test("extractGeneratedHtml supports output_text", () => {
  assert.equal(
    extractGeneratedHtml({ output_text: "```html\n<!doctype html><html></html>\n```" }),
    "<!doctype html><html></html>"
  );
});

test("extractGeneratedHtml supports nested response output content", () => {
  const html = extractGeneratedHtml({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: "<!doctype html><html><body>Generated</body></html>"
          }
        ]
      }
    ]
  });

  assert.match(html, /Generated/);
});
