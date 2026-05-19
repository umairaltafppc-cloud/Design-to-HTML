const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");

const {
  buildOpenAIRequest,
  buildPrompt,
  buildVisualSpecPrompt,
  buildVisualSpecRequest,
  createServer,
  extractGeneratedHtml,
  generateHtml,
  isLikelyBlankHtml,
  validateGenerateRequest
} = require("../server");

const SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgo=";

test("validateGenerateRequest accepts supported image data urls", () => {
  const result = validateGenerateRequest({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Use a dark theme.",
    width: 1440,
    height: 1024
  });

  assert.equal(result.imageDataUrl, SAMPLE_IMAGE);
  assert.equal(result.instructions, "Use a dark theme.");
  assert.equal(result.width, 1440);
  assert.equal(result.height, 1024);
  assert.equal(result.exactClone, true);
  assert.equal(result.deepAnalysis, false);
});

test("validateGenerateRequest rejects unsupported image payloads", () => {
  assert.throws(
    () => validateGenerateRequest({ imageDataUrl: "data:text/html;base64,PGgxPk5vPC9oMT4=" }),
    /Upload a PNG, JPG, or WebP/
  );
});

test("buildPrompt includes optional user instructions", () => {
  const prompt = buildPrompt({
    instructions: "Make the nav sticky.",
    width: 390,
    height: 844,
    existingHtml: "<!doctype html><html><body>Old attempt</body></html>"
  });

  assert.match(prompt, /Return only the complete HTML document/);
  assert.match(prompt, /390px wide by 844px tall/);
  assert.match(prompt, /Make the nav sticky/);
  assert.match(prompt, /refining an existing attempt/);
  assert.match(prompt, /Old attempt/);
});

test("buildOpenAIRequest sends screenshot and prompt to responses API shape", () => {
  const payload = buildOpenAIRequest({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Prioritize semantic sections.",
    width: 1200,
    height: 900,
    existingHtml: "<!doctype html><html></html>",
    model: "test-model"
  });

  assert.equal(payload.model, "test-model");
  assert.equal(payload.input[0].content[0].type, "input_text");
  assert.match(payload.input[0].content[0].text, /1200px wide by 900px tall/);
  assert.match(payload.input[0].content[0].text, /Current HTML attempt/);
  assert.equal(payload.input[0].content[1].type, "input_image");
  assert.equal(payload.input[0].content[1].image_url, SAMPLE_IMAGE);
  assert.equal(payload.max_output_tokens, 12000);
});

test("buildVisualSpecRequest asks for a concrete landing page spec", () => {
  const payload = buildVisualSpecRequest({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Clone the hero exactly.",
    width: 1440,
    height: 1200,
    model: "test-model"
  });

  assert.equal(payload.model, "test-model");
  assert.equal(payload.input[0].content[0].type, "input_text");
  assert.match(payload.input[0].content[0].text, /detailed visual implementation spec/);
  assert.match(payload.input[0].content[0].text, /1440px wide by 1200px tall/);
  assert.equal(payload.input[0].content[1].image_url, SAMPLE_IMAGE);
});

test("buildVisualSpecPrompt includes user notes", () => {
  const prompt = buildVisualSpecPrompt({
    instructions: "Use the exact navy background.",
    width: 1280,
    height: 900
  });

  assert.match(prompt, /design QA analyst/);
  assert.match(prompt, /1280px wide by 900px tall/);
  assert.match(prompt, /exact navy background/);
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

test("isLikelyBlankHtml detects empty or plain white output", () => {
  assert.equal(isLikelyBlankHtml("<!doctype html><html><body></body></html>"), true);
  assert.equal(
    isLikelyBlankHtml("<!doctype html><html><head><style>body{background:white}</style></head><body><div></div></body></html>"),
    true
  );
  assert.equal(
    isLikelyBlankHtml("<!doctype html><html><head><style>body{background:#fff;color:#fff}.hero{padding:40px}</style></head><body><main class=\"hero\"><h1>Invisible hero</h1><p>White text</p></main></body></html>"),
    true
  );
  assert.equal(
    isLikelyBlankHtml("<!doctype html><html><head><style>.hero{display:none;background:#111;color:#fff}</style></head><body><main class=\"hero\"><h1>Hidden hero</h1></main></body></html>"),
    true
  );
  assert.equal(
    isLikelyBlankHtml("<!doctype html><html><head><style>.hero{background:#111;color:#fff;padding:48px}.cta{border:1px solid #fff}</style></head><body><main class=\"hero\"><h1>Launch faster</h1><button class=\"cta\">Get started</button></main></body></html>"),
    false
  );
  assert.equal(
    isLikelyBlankHtml("<!doctype html><html><head><style>body{background:white;color:#111}.hero{padding:48px;border:1px solid #ddd}</style></head><body><main class=\"hero\"><h1>Visible light design</h1><p>Dark text on white is valid.</p></main></body></html>"),
    false
  );
});

test("createServer handles generation through an injected fetch client", async (t) => {
  const server = createServer({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-key");

      const payload = JSON.parse(options.body);
      assert.equal(payload.input[0].content[1].image_url, SAMPLE_IMAGE);
      assert.match(payload.input[0].content[0].text, /1024px wide by 768px tall/);

      return {
        ok: true,
        json: async () => ({
          output_text: "<!doctype html><html><body>Generated route HTML</body></html>"
        })
      };
    }
  });

  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageDataUrl: SAMPLE_IMAGE,
      instructions: "Use semantic HTML.",
      width: 1024,
      height: 768,
      exactClone: false
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.html, /Generated route HTML/);
});

test("createServer returns JSON when the request body is too large", async (t) => {
  const server = createServer({
    apiKey: "test-key",
    maxBodyBytes: 100,
    fetchImpl: async () => {
      throw new Error("fetch should not be called for oversized bodies");
    }
  });

  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${"a".repeat(200)}`
    })
  });

  assert.equal(response.status, 413);
  const body = await response.json();
  assert.match(body.error, /too large/);
});

test("generateHtml runs a visual spec pass in exact clone mode", async () => {
  const calls = [];
  const html = await generateHtml({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Clone the landing page exactly.",
    width: 1440,
    height: 1000,
    deepAnalysis: true,
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          output_text: calls.length === 1
            ? "Visual spec: navy hero, centered headline, two CTA buttons."
            : "<!doctype html><html><body>Exact clone</body></html>"
        })
      };
    }
  });

  assert.equal(html, "<!doctype html><html><body>Exact clone</body></html>");
  assert.equal(calls.length, 2);
  assert.match(calls[0].input[0].content[0].text, /visual implementation spec/);
  assert.match(calls[1].input[0].content[0].text, /Visual spec: navy hero/);
});

test("generateHtml keeps exact clone mode to one request by default", async () => {
  const calls = [];
  const html = await generateHtml({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Clone the landing page exactly.",
    width: 1440,
    height: 1000,
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          output_text: "<!doctype html><html><body>One request clone</body></html>"
        })
      };
    }
  });

  assert.equal(html, "<!doctype html><html><body>One request clone</body></html>");
  assert.equal(calls.length, 1);
  assert.match(calls[0].input[0].content[0].text, /silently analyze the screenshot/);
});

test("generateHtml retries when the first response looks blank", async () => {
  const calls = [];
  const html = await generateHtml({
    imageDataUrl: SAMPLE_IMAGE,
    instructions: "Clone the page.",
    width: 1200,
    height: 900,
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          output_text: calls.length === 1
            ? "<!doctype html><html><head><style>body{background:white}</style></head><body></body></html>"
            : "<!doctype html><html><head><style>.hero{background:#101827;color:white;padding:40px}.card{border:1px solid #fff}</style></head><body><main class=\"hero\"><h1>Visible landing page</h1><button>Start</button><section class=\"card\">Feature</section></main></body></html>"
        })
      };
    }
  });

  assert.match(html, /Visible landing page/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].input[0].content[0].text, /previous HTML rendered as a blank white or invisible page/);
});
