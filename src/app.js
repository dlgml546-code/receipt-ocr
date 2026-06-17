const STORAGE_KEYS = {
  apiBase: "receiptOcr.apiBase",
  queue: "receiptOcr.pendingUploads"
};

const state = {
  selectedFile: null,
  previewUrl: "",
  attachmentId: "",
  capturedAt: ""
};

const elements = {
  apiBaseInput: document.querySelector("#apiBaseInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  fileInput: document.querySelector("#fileInput"),
  previewImage: document.querySelector("#previewImage"),
  ocrButton: document.querySelector("#ocrButton"),
  uploadButton: document.querySelector("#uploadButton"),
  retryButton: document.querySelector("#retryButton"),
  queueCount: document.querySelector("#queueCount"),
  statusText: document.querySelector("#statusText"),
  form: document.querySelector("#receiptForm"),
  merchantInput: document.querySelector("#merchantInput"),
  dateInput: document.querySelector("#dateInput"),
  totalInput: document.querySelector("#totalInput"),
  taxInput: document.querySelector("#taxInput"),
  currencyInput: document.querySelector("#currencyInput"),
  categoryInput: document.querySelector("#categoryInput"),
  rawTextInput: document.querySelector("#rawTextInput")
};

init();

function init() {
  elements.apiBaseInput.value = localStorage.getItem(STORAGE_KEYS.apiBase) || "";
  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.fileInput.addEventListener("change", handleFileChange);
  elements.ocrButton.addEventListener("click", runOcr);
  elements.uploadButton.addEventListener("click", uploadCurrentReceipt);
  elements.retryButton.addEventListener("click", retryQueuedUploads);
  elements.form.addEventListener("input", updateActions);

  registerServiceWorker();
  updateQueueCount();
  updateActions();
}

function saveSettings() {
  const apiBase = normalizeApiBase(elements.apiBaseInput.value);
  elements.apiBaseInput.value = apiBase;
  localStorage.setItem(STORAGE_KEYS.apiBase, apiBase);
  setStatus(apiBase ? "연동 설정이 저장되었습니다." : "API 주소가 비어 있습니다.");
  updateActions();
}

function handleFileChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }

  state.selectedFile = file;
  state.previewUrl = URL.createObjectURL(file);
  state.attachmentId = "";
  state.capturedAt = new Date().toISOString();

  elements.previewImage.src = state.previewUrl;
  elements.previewImage.hidden = false;
  clearReceiptFields();
  setStatus("영수증이 선택되었습니다.");
  updateActions();
}

async function runOcr() {
  const apiBase = getApiBase();
  if (!apiBase || !state.selectedFile) {
    updateActions();
    return;
  }

  elements.ocrButton.disabled = true;
  setStatus("분석 중입니다.");

  try {
    const formData = new FormData();
    formData.append("receipt", state.selectedFile);
    formData.append("source", "receipt-ocr-pwa");
    formData.append("capturedAt", state.capturedAt);

    const response = await fetch(`${apiBase}/receipts/ocr`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OCR failed with ${response.status}`);
    }

    const payload = await response.json();
    const receipt = normalizeReceipt(payload);
    state.attachmentId = payload.attachmentId || receipt.attachmentId || "";
    fillReceiptFields(receipt);
    setStatus("분석 결과가 반영되었습니다.");
  } catch (error) {
    console.error(error);
    setStatus("분석에 실패했습니다. 내용을 직접 입력하실 수 있습니다.");
  } finally {
    updateActions();
  }
}

async function uploadCurrentReceipt() {
  const apiBase = getApiBase();
  const receipt = buildReceiptPayload();

  if (!apiBase || !hasMinimumReceiptFields(receipt)) {
    updateActions();
    return;
  }

  elements.uploadButton.disabled = true;
  setStatus("업로드 중입니다.");

  try {
    await uploadReceipt(apiBase, receipt);
    clearAfterUpload();
    setStatus("대시보드에 업로드되었습니다.");
  } catch (error) {
    console.error(error);
    queueReceipt(receipt);
    setStatus("업로드가 대기열에 저장되었습니다.");
  } finally {
    updateQueueCount();
    updateActions();
  }
}

async function retryQueuedUploads() {
  const apiBase = getApiBase();
  const queue = getQueue();

  if (!apiBase || queue.length === 0) {
    setStatus(queue.length === 0 ? "대기 항목이 없습니다." : "API 주소를 확인해 주세요.");
    return;
  }

  setStatus("대기 항목을 업로드 중입니다.");

  const remaining = [];
  for (const receipt of queue) {
    try {
      await uploadReceipt(apiBase, receipt);
    } catch (error) {
      console.error(error);
      remaining.push(receipt);
    }
  }

  setQueue(remaining);
  updateQueueCount();
  setStatus(remaining.length === 0 ? "대기 항목이 모두 업로드되었습니다." : "일부 항목이 아직 대기 중입니다.");
}

async function uploadReceipt(apiBase, receipt) {
  const response = await fetch(`${apiBase}/receipts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(receipt)
  });

  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

function normalizeReceipt(payload) {
  const receipt = payload.receipt || payload;
  return {
    merchant: receipt.merchant || receipt.storeName || "",
    purchasedAt: toDateInputValue(receipt.purchasedAt || receipt.date || ""),
    totalAmount: numberOrEmpty(receipt.totalAmount || receipt.total || receipt.amount),
    taxAmount: numberOrEmpty(receipt.taxAmount || receipt.tax || ""),
    currency: receipt.currency || "KRW",
    category: receipt.category || "general",
    rawText: receipt.rawText || receipt.text || "",
    attachmentId: receipt.attachmentId || ""
  };
}

function fillReceiptFields(receipt) {
  elements.merchantInput.value = receipt.merchant;
  elements.dateInput.value = receipt.purchasedAt;
  elements.totalInput.value = receipt.totalAmount;
  elements.taxInput.value = receipt.taxAmount;
  elements.currencyInput.value = receipt.currency;
  elements.categoryInput.value = receipt.category;
  elements.rawTextInput.value = receipt.rawText;
}

function buildReceiptPayload() {
  return {
    merchant: elements.merchantInput.value.trim(),
    purchasedAt: elements.dateInput.value,
    totalAmount: numberOrNull(elements.totalInput.value),
    taxAmount: numberOrNull(elements.taxInput.value),
    currency: elements.currencyInput.value,
    category: elements.categoryInput.value,
    rawText: elements.rawTextInput.value.trim(),
    attachmentId: state.attachmentId,
    source: "receipt-ocr-pwa",
    capturedAt: state.capturedAt || new Date().toISOString(),
    status: "confirmed"
  };
}

function clearReceiptFields() {
  elements.form.reset();
  elements.currencyInput.value = "KRW";
  elements.categoryInput.value = "general";
}

function clearAfterUpload() {
  state.selectedFile = null;
  state.attachmentId = "";
  state.capturedAt = "";
  elements.fileInput.value = "";
  elements.previewImage.hidden = true;
  elements.previewImage.removeAttribute("src");
  clearReceiptFields();
}

function hasMinimumReceiptFields(receipt) {
  return Boolean(receipt.merchant && receipt.purchasedAt && receipt.totalAmount !== null);
}

function updateActions() {
  const hasApi = Boolean(getApiBase());
  const receipt = buildReceiptPayload();
  elements.ocrButton.disabled = !hasApi || !state.selectedFile;
  elements.uploadButton.disabled = !hasApi || !hasMinimumReceiptFields(receipt);
}

function getApiBase() {
  return normalizeApiBase(elements.apiBaseInput.value || localStorage.getItem(STORAGE_KEYS.apiBase) || "");
}

function normalizeApiBase(value) {
  return value.trim().replace(/\/+$/, "");
}

function queueReceipt(receipt) {
  const queue = getQueue();
  queue.push({ ...receipt, queuedAt: new Date().toISOString() });
  setQueue(queue);
}

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.queue) || "[]");
  } catch {
    return [];
  }
}

function setQueue(queue) {
  localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(queue));
}

function updateQueueCount() {
  elements.queueCount.textContent = String(getQueue().length);
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function numberOrEmpty(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? String(Math.round(number)) : "";
}

function numberOrNull(value) {
  if (value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

