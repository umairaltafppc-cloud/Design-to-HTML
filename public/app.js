const form = document.querySelector("#converterForm");
const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#screenshotInput");
const browseButton = document.querySelector("#browseButton");
const imagePreviewCard = document.querySelector("#imagePreviewCard");
const imagePreview = document.querySelector("#imagePreview");
const fileName = document.querySelector("#fileName");
const instructions = document.querySelector("#instructions");
const generateButton = document.querySelector("#generateButton");
const statusMessage = document.querySelector("#statusMessage");
const codeOutput = document.querySelector("#codeOutput");
const htmlPreview = document.querySelector("#htmlPreview");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const tabButtons = document.querySelectorAll(".tab");
const codePanel = document.querySelector("#codePanel");
const previewPanel = document.querySelector("#previewPanel");

let screenshotDataUrl = "";
let generatedHtml = "";

function setStatus(message, kind = "") {
  statusMessage.textContent = message;
  if (kind) {
    statusMessage.dataset.kind = kind;
  } else {
    delete statusMessage.dataset.kind;
  }
}

function setBusy(isBusy) {
  generateButton.disabled = isBusy || !screenshotDataUrl;
  generateButton.textContent = isBusy ? "Generating..." : "Generate frontend code";
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

async function handleFile(file) {
  if (!file) return;

  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    setStatus("Please upload a PNG, JPG, or WebP screenshot.", "error");
    return;
  }

  screenshotDataUrl = await readFileAsDataUrl(file);
  imagePreview.src = screenshotDataUrl;
  fileName.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  imagePreviewCard.hidden = false;
  generateButton.disabled = false;
  setStatus("Screenshot loaded. Add optional notes, then generate.", "success");
}

function showTab(tabName) {
  const showCode = tabName === "code";
  codePanel.hidden = !showCode;
  previewPanel.hidden = showCode;
  codePanel.classList.toggle("active", showCode);
  previewPanel.classList.toggle("active", !showCode);

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function updateOutput(html) {
  generatedHtml = html;
  codeOutput.innerHTML = escapeHtml(html);
  htmlPreview.srcdoc = html;
  copyButton.disabled = false;
  downloadButton.disabled = false;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!screenshotDataUrl) {
    setStatus("Add a screenshot before generating code.", "error");
    return;
  }

  setBusy(true);
  setStatus("Analyzing screenshot and generating HTML...");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageDataUrl: screenshotDataUrl,
        instructions: instructions.value
      })
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Generation failed.");
    }

    updateOutput(body.html);
    setStatus("HTML generated successfully.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
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
