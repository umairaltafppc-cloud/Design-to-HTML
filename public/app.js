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

let screenshotDataUrl = "";
let generatedHtml = "";
let screenshotWidth = null;
let screenshotHeight = null;

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

  screenshotDataUrl = await readFileAsDataUrl(file);
  const dimensions = await getImageDimensions(screenshotDataUrl);
  screenshotWidth = dimensions.width;
  screenshotHeight = dimensions.height;
  generatedHtml = "";
  imagePreview.src = screenshotDataUrl;
  compareImage.src = screenshotDataUrl;
  fileName.textContent = `${file.name} (${screenshotWidth}x${screenshotHeight}, ${Math.round(file.size / 1024)} KB)`;
  imagePreviewCard.hidden = false;
  updatePreviewViewport();
  htmlPreview.srcdoc = "";
  comparePreview.srcdoc = "";
  codeOutput.innerHTML = "&lt;!-- Generated HTML will appear here. --&gt;";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  refineButton.disabled = true;
  generateButton.disabled = false;
  setStatus("Screenshot loaded. Add optional notes, then generate.", "success");
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
  setStatus(refine ? "Refining HTML against the landing page design..." : "Analyzing landing page design and generating HTML...");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageDataUrl: screenshotDataUrl,
        instructions: instructions.value,
        width: screenshotWidth,
        height: screenshotHeight,
        existingHtml: refine ? generatedHtml : "",
        exactClone: exactClone.checked,
        deepAnalysis: deepAnalysis.checked && !refine
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Generation failed.");
    }

    updateOutput(body.html);
    setStatus(refine ? "HTML refined successfully." : "Landing page HTML generated successfully.", "success");
  } catch (error) {
    if (error instanceof TypeError) {
      setStatus("The browser lost the generation connection. Try turning off Deep analysis mode or upload a smaller screenshot.", "error");
    } else {
      setStatus(error.message, "error");
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
