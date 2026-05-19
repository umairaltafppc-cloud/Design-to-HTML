const form = document.querySelector("#converterForm");
const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#screenshotInput");
const browseButton = document.querySelector("#browseButton");
const imagePreviewCard = document.querySelector("#imagePreviewCard");
const imagePreview = document.querySelector("#imagePreview");
const fileName = document.querySelector("#fileName");
const instructions = document.querySelector("#instructions");
const exactClone = document.querySelector("#exactClone");
const deepAnalysis = document.querySelector("#deepAnalysis");
const generateButton = document.querySelector("#generateButton");
const refineButton = document.querySelector("#refineButton");
const statusMessage = document.querySelector("#statusMessage");
const codeOutput = document.querySelector("#codeOutput");
const htmlPreview = document.querySelector("#htmlPreview");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const tabButtons = document.querySelectorAll(".tab");
const codePanel = document.querySelector("#codePanel");
const previewPanel = document.querySelector("#previewPanel");
const comparePanel = document.querySelector("#comparePanel");
const previewMeta = document.querySelector("#previewMeta");
const previewStage = document.querySelector("#previewStage");
const compareMeta = document.querySelector("#compareMeta");
const compareGrid = document.querySelector("#compareGrid");
const compareImage = document.querySelector("#compareImage");
const comparePreview = document.querySelector("#comparePreview");

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATION_IMAGE_BYTES = 1.8 * 1024 * 1024;
const MAX_GENERATION_WIDTH = 1200;
const MAX_GENERATION_HEIGHT = 4500;
const JPEG_QUALITIES = [0.84, 0.74, 0.64, 0.54, 0.44];
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_TIMEOUT_MS = 7 * 60 * 1000;

let screenshotDataUrl = "";
let generatedHtml = "";
let screenshotWidth = null;
let screenshotHeight = null;
let originalScreenshotWidth = null;
let originalScreenshotHeight = null;
let optimizedImageBytes = 0;

function setStatus(message, kind = "") {
  statusMessage.textContent = message;
  if (kind) {
    statusMessage.dataset.kind = kind;
  } else {
    delete statusMessage.dataset.kind;
  }
}

function setBusy(isBusy, action = "generate") {
  generateButton.disabled = isBusy || !screenshotDataUrl;
  refineButton.disabled = isBusy || !screenshotDataUrl || !generatedHtml;
  generateButton.textContent = isBusy && action === "generate" ? "Generating..." : "Generate frontend code";
  refineButton.textContent = isBusy && action === "refine" ? "Refining..." : "Refine current result";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Could not read the selected image.")));
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    });
    image.addEventListener("error", () => reject(new Error("Could not read the screenshot dimensions.")));
    image.src = dataUrl;
  });
}

function dataUrlByteSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not optimize the screenshot for upload."));
      }
    }, type, quality);
  });
}

async function blobToDataUrl(blob) {
  return readFileAsDataUrl(blob);
}

function getOptimizedSize(width, height) {
  const scale = Math.min(1, MAX_GENERATION_WIDTH / width, MAX_GENERATION_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function optimizeScreenshotForGeneration(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const originalDimensions = await getImageDimensions(originalDataUrl);
  const { width, height } = getOptimizedSize(originalDimensions.width, originalDimensions.height);

  if (
    originalDataUrl.length <= MAX_GENERATION_IMAGE_BYTES * 1.37
    && width === originalDimensions.width
    && height === originalDimensions.height
    && file.type !== "image/png"
  ) {
    return {
      dataUrl: originalDataUrl,
      width,
      height,
      bytes: dataUrlByteSize(originalDataUrl),
      originalWidth: originalDimensions.width,
      originalHeight: originalDimensions.height,
      optimized: false
    };
  }

  const image = new Image();
  image.src = originalDataUrl;
  await new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("Could not optimize the screenshot image.")), { once: true });
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let bestBlob = null;
  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    bestBlob = blob;
    if (blob.size <= MAX_GENERATION_IMAGE_BYTES) {
      break;
    }
  }

  const dataUrl = await blobToDataUrl(bestBlob);
  return {
    dataUrl,
    width,
    height,
    bytes: bestBlob.size,
    originalWidth: originalDimensions.width,
    originalHeight: originalDimensions.height,
    optimized: true
  };
}

async function handleFile(file) {
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    setStatus("Please upload a PNG, JPG, or WebP screenshot.", "error");
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    setStatus("Please upload a screenshot smaller than 20 MB.", "error");
    return;
  }

  setStatus("Optimizing screenshot for reliable generation...");
  const optimized = await optimizeScreenshotForGeneration(file);
  screenshotDataUrl = optimized.dataUrl;
  screenshotWidth = optimized.width;
  screenshotHeight = optimized.height;
  originalScreenshotWidth = optimized.originalWidth;
  originalScreenshotHeight = optimized.originalHeight;
  optimizedImageBytes = optimized.bytes;
  generatedHtml = "";
  imagePreview.src = screenshotDataUrl;
  compareImage.src = screenshotDataUrl;
  const optimizedNote = optimized.optimized
    ? ` optimized from ${originalScreenshotWidth}x${originalScreenshotHeight} / ${Math.round(file.size / 1024)} KB`
    : "";
  fileName.textContent = `${file.name} (${screenshotWidth}x${screenshotHeight}, ${Math.round(optimizedImageBytes / 1024)} KB${optimizedNote})`;
  imagePreviewCard.hidden = false;
  updatePreviewViewport();
  htmlPreview.srcdoc = "";
  comparePreview.srcdoc = "";
  codeOutput.innerHTML = "&lt;!-- Generated HTML will appear here. --&gt;";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  refineButton.disabled = true;
  generateButton.disabled = false;
  setStatus("Screenshot optimized and loaded. Add optional notes, then generate.", "success");
}

function showTab(tabName) {
  const showCode = tabName === "code";
  const showPreview = tabName === "preview";
  const showCompare = tabName === "compare";
  codePanel.hidden = !showCode;
  previewPanel.hidden = !showPreview;
  comparePanel.hidden = !showCompare;
  codePanel.classList.toggle("active", showCode);
  previewPanel.classList.toggle("active", showPreview);
  comparePanel.classList.toggle("active", showCompare);

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function updatePreviewViewport() {
  if (!screenshotWidth || !screenshotHeight) {
    previewMeta.textContent = "Upload a screenshot to set the preview viewport.";
    compareMeta.textContent = "Generate HTML to compare it with the uploaded design.";
    previewStage.style.removeProperty("--preview-width");
    previewStage.style.removeProperty("--preview-height");
    compareGrid.style.removeProperty("--preview-width");
    compareGrid.style.removeProperty("--preview-height");
    htmlPreview.removeAttribute("width");
    htmlPreview.removeAttribute("height");
    comparePreview.removeAttribute("width");
    comparePreview.removeAttribute("height");
    return;
  }

  previewMeta.textContent = `Preview viewport: ${screenshotWidth}x${screenshotHeight}px to match the uploaded screenshot. Scroll inside this panel if the artboard is larger than the available space.`;
  compareMeta.textContent = `Side-by-side comparison at ${screenshotWidth}x${screenshotHeight}px. Scroll each pane to inspect full landing-page length.`;
  previewStage.style.setProperty("--preview-width", `${screenshotWidth}px`);
  previewStage.style.setProperty("--preview-height", `${screenshotHeight}px`);
  compareGrid.style.setProperty("--preview-width", `${screenshotWidth}px`);
  compareGrid.style.setProperty("--preview-height", `${screenshotHeight}px`);
  htmlPreview.setAttribute("width", String(screenshotWidth));
  htmlPreview.setAttribute("height", String(screenshotHeight));
  comparePreview.setAttribute("width", String(screenshotWidth));
  comparePreview.setAttribute("height", String(screenshotHeight));
}

function updateOutput(html) {
  generatedHtml = html;
  codeOutput.innerHTML = escapeHtml(html);
  updatePreviewViewport();
  htmlPreview.srcdoc = html;
  comparePreview.srcdoc = html;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  refineButton.disabled = false;
  showTab("preview");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startGenerationJob(payload) {
  const response = await fetch("/api/generate-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Could not start generation.");
  }

  return body.jobId;
}

async function pollGenerationJob(jobId, { refine = false } = {}) {
  const startedAt = Date.now();
  let transientFailures = 0;

  while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
    await wait(JOB_POLL_INTERVAL_MS);
    setStatus(refine ? "Still refining HTML..." : "Still generating HTML...");

    try {
      const response = await fetch(`/api/generate-jobs/${encodeURIComponent(jobId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Could not check generation status.");
      }

      if (body.status === "completed") {
        return body.html;
      }

      if (body.status === "failed") {
        throw new Error(body.error || "Generation failed.");
      }

      transientFailures = 0;
    } catch (error) {
      if (!(error instanceof TypeError) || transientFailures >= 3) {
        throw error;
      }
      transientFailures += 1;
    }
  }

  throw new Error("Generation is taking too long. Try a shorter screenshot crop or fewer fidelity notes.");
}

browseButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (event) => {
  handleFile(event.target.files[0]).catch((error) => {
    setStatus(error.message, "error");
  });
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (event) => {
  handleFile(event.dataTransfer.files[0]).catch((error) => {
    setStatus(error.message, "error");
  });
});

async function requestGeneration({ refine = false } = {}) {
  if (!screenshotDataUrl) {
    setStatus("Add a screenshot before generating code.", "error");
    return;
  }

  if (refine && !generatedHtml) {
    setStatus("Generate HTML before refining the result.", "error");
    return;
  }

  setBusy(true, refine ? "refine" : "generate");
  setStatus(refine ? "Starting refinement job..." : "Starting generation job...");

  try {
    const jobId = await startGenerationJob({
      imageDataUrl: screenshotDataUrl,
      instructions: instructions.value,
      width: screenshotWidth,
      height: screenshotHeight,
      existingHtml: refine ? generatedHtml : "",
      exactClone: exactClone.checked,
      deepAnalysis: deepAnalysis.checked && !refine
    });

    setStatus(refine ? "Refinement job started. Waiting for result..." : "Generation job started. Waiting for result...");
    const html = await pollGenerationJob(jobId, { refine });

    if (!html || html.trim().length < 80) {
      throw new Error("The generated HTML looked blank. Add notes describing the visible layout and try again.");
    }

    updateOutput(html);
    setStatus(refine ? "HTML refined successfully." : "Landing page HTML generated successfully.", "success");
  } catch (error) {
    if (error instanceof TypeError) {
      setStatus("The browser lost a short status connection. Refresh and try again; if it repeats, use a shorter screenshot crop.", "error");
    } else {
      const blankOutput = /blank-looking|blank|white page/i.test(error.message);
      setStatus(
        blankOutput
          ? `${error.message} Add notes like "dark text on white background, hero headline at top, blue CTA button, three cards below" and generate again.`
          : error.message,
        "error"
      );
    }
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await requestGeneration();
});

refineButton.addEventListener("click", () => {
  requestGeneration({ refine: true });
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(generatedHtml);
  setStatus("Generated HTML copied to clipboard.", "success");
});

downloadButton.addEventListener("click", () => {
  const blob = new Blob([generatedHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "generated-design.html";
  link.click();
  URL.revokeObjectURL(url);
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => showTab(button.dataset.tab));
});
