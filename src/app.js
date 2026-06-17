const STORAGE_KEYS = {
  deviceId: "receiptOcr.deviceId",
  queue: "receiptOcr.pendingUploads"
};

const state = {
  items: [],
  currentIndex: -1,
  selectedFile: null,
  previewUrl: "",
  attachmentId: "",
  capturedAt: "",
  feedbackTimer: 0
};

const elements = {
  deviceIdText: document.querySelector("#deviceIdText"),
  cameraInput: document.querySelector("#cameraInput"),
  albumInput: document.querySelector("#albumInput"),
  previewImage: document.querySelector("#previewImage"),
  rotateButton: document.querySelector("#rotateButton"),
  batchText: document.querySelector("#batchText"),
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
  usageInput: document.querySelector("#usageInput"),
  rawTextInput: document.querySelector("#rawTextInput"),
  feedbackDialog: document.querySelector("#feedbackDialog"),
  feedbackIcon: document.querySelector("#feedbackIcon"),
  feedbackTitle: document.querySelector("#feedbackTitle"),
  feedbackMessage: document.querySelector("#feedbackMessage"),
  feedbackCloseButton: document.querySelector("#feedbackCloseButton")
};

init();

function init() {
  ensureDeviceId();
  removeLegacyDeviceHistory();
  elements.deviceIdText.textContent = shortDeviceId(getDeviceId());
  elements.cameraInput.addEventListener("change", handleFileSelection);
  elements.albumInput.addEventListener("change", handleFileSelection);
  elements.rotateButton.addEventListener("click", rotateCurrentReceipt);
  elements.ocrButton.addEventListener("click", runOcr);
  elements.uploadButton.addEventListener("click", uploadCurrentReceipt);
  elements.retryButton.addEventListener("click", retryQueuedUploads);
  elements.form.addEventListener("input", updateActions);
  elements.usageInput.addEventListener("input", updateActions);
  elements.feedbackCloseButton.addEventListener("click", hideFeedback);

  registerServiceWorker();
  updateQueueCount();
  updateActions();
}

function ensureDeviceId() {
  if (localStorage.getItem(STORAGE_KEYS.deviceId)) {
    return;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.deviceId, id);
}

function removeLegacyDeviceHistory() {
  localStorage.removeItem("receiptOcr.uploadHistory");
}

async function handleFileSelection(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  clearPreviewUrl();
  state.items = files.map((file) => ({
    originalFile: file,
    normalizedFile: null,
    rotation: 0
  }));
  state.currentIndex = 0;

  await loadCurrentReceipt();
  event.target.value = "";
  await runOcr();
}

async function loadCurrentReceipt(options = {}) {
  const item = state.items[state.currentIndex];
  if (!item) {
    clearAfterUpload();
    return;
  }

  clearPreviewUrl();
  setStatus("영수증 이미지를 정리하는 중입니다.");

  try {
    item.normalizedFile = await normalizeReceiptImage(item.originalFile, item.rotation);
  } catch (error) {
    console.warn("Image normalization failed", error);
    item.normalizedFile = item.originalFile;
  }

  state.selectedFile = item.normalizedFile;
  state.previewUrl = URL.createObjectURL(item.normalizedFile);
  state.attachmentId = "";
  state.capturedAt = new Date().toISOString();

  elements.previewImage.src = state.previewUrl;
  elements.previewImage.hidden = false;
  elements.rotateButton.disabled = false;

  if (!options.preserveFields) {
    clearReceiptFields();
    elements.usageInput.value = "";
  }

  updateBatchText();
  setStatus(state.items.length > 1 ? "여러 장이 선택되었습니다. 한 장씩 확인해 주세요." : "영수증이 선택되었습니다.");
  updateActions();
}

async function rotateCurrentReceipt() {
  const item = state.items[state.currentIndex];
  if (!item) {
    return;
  }

  item.rotation = (item.rotation + 90) % 360;
  await loadCurrentReceipt({ preserveFields: true });
  setStatus("영수증 방향을 90도 회전했습니다.");
}

async function runOcr() {
  if (!state.selectedFile) {
    setStatus("먼저 영수증을 촬영하거나 앨범에서 선택해 주세요.");
    updateActions();
    return;
  }

  elements.ocrButton.disabled = true;
  setStatus("내용을 분석하는 중입니다.");
  showFeedback({
    type: "loading",
    title: "내용 분석 중",
    message: "영수증 내용을 읽고 있습니다. 잠시만 기다려 주세요.",
    closeable: false
  });

  try {
    const formData = new FormData();
    formData.append("receipt", state.selectedFile);
    formData.append("source", "receipt-ocr-pwa");
    formData.append("workflow", "expense_approval");
    formData.append("deviceId", getDeviceId());
    formData.append("capturedAt", state.capturedAt);

    const response = await fetch("/api/receipts/ocr", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response, `OCR failed with ${response.status}`));
    }

    const payload = await response.json();
    const receipt = normalizeReceipt(payload);
    state.attachmentId = payload.attachmentId || receipt.attachmentId || "";
    fillReceiptFields(receipt);
    setStatus("분석 결과가 반영되었습니다. 사용 내용을 입력하고 확인해 주세요.");
    hideFeedback();
  } catch (error) {
    console.error(error);
    const message = getOcrFailureMessage(error);
    setStatus(message);
    showFeedback({
      type: "error",
      title: "분석 실패",
      message,
      closeable: true
    });
  } finally {
    updateActions();
  }
}

async function uploadCurrentReceipt() {
  const receipt = buildReceiptPayload();

  if (!hasMinimumReceiptFields(receipt)) {
    setStatus("가맹점, 사용일, 총액, 사용 내용을 모두 확인해 주세요.");
    updateActions();
    return;
  }

  elements.uploadButton.disabled = true;
  setStatus("업로드 중입니다.");
  showFeedback({
    type: "loading",
    title: "업로드 중",
    message: "지출결의 대시보드로 보내고 있습니다.",
    closeable: false
  });

  try {
    await uploadReceipt(receipt);
    await advanceAfterUpload();
    showFeedback({
      type: "success",
      title: "업로드 완료 ✅",
      message: "대시보드에 영수증이 등록되었습니다.",
      closeable: true,
      autoHideMs: 2200
    });
  } catch (error) {
    console.error(error);
    queueReceipt(receipt);
    const message = getUploadFailureMessage(error);
    setStatus("업로드가 실패해 대기열에 저장되었습니다.");
    showFeedback({
      type: "error",
      title: "업로드 실패 ❌",
      message,
      closeable: true
    });
  } finally {
    updateQueueCount();
    updateActions();
  }
}

async function advanceAfterUpload() {
  if (state.currentIndex >= 0 && state.currentIndex < state.items.length - 1) {
    state.currentIndex += 1;
    await loadCurrentReceipt();
    setStatus("업로드되었습니다. 다음 영수증을 확인해 주세요.");
    await runOcr();
    return;
  }

  clearAfterUpload();
  setStatus("대시보드에 업로드되었습니다.");
}

async function retryQueuedUploads() {
  const queue = getQueue();

  if (queue.length === 0) {
    setStatus("대기 항목이 없습니다.");
    return;
  }

  setStatus("대기 항목을 업로드 중입니다.");
  showFeedback({
    type: "loading",
    title: "업로드 중",
    message: "대기 항목을 다시 보내고 있습니다.",
    closeable: false
  });

  const remaining = [];
  for (const receipt of queue) {
    try {
      await uploadReceipt(receipt);
    } catch (error) {
      console.error(error);
      remaining.push(receipt);
    }
  }

  setQueue(remaining);
  updateQueueCount();
  if (remaining.length === 0) {
    setStatus("대기 항목이 모두 업로드되었습니다.");
    showFeedback({
      type: "success",
      title: "업로드 완료 ✅",
      message: "대기 항목이 모두 대시보드에 등록되었습니다.",
      closeable: true,
      autoHideMs: 2200
    });
  } else {
    setStatus("일부 항목이 아직 대기 중입니다.");
    showFeedback({
      type: "error",
      title: "업로드 실패 ❌",
      message: "일부 항목은 아직 업로드되지 않았습니다. 네트워크 상태를 확인한 뒤 다시 눌러 주세요.",
      closeable: true
    });
  }
}

async function uploadReceipt(receipt) {
  const response = await fetch("/api/receipts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(receipt)
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, `Upload failed with ${response.status}`));
  }

  return response.json().catch(() => ({}));
}

async function getErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

function getOcrFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("OpenAI API key")) {
    return "분석에 실패했습니다. 관리자 OCR 키를 확인해 주세요.";
  }

  if (message.includes("receipt image is required")) {
    return "영수증 이미지를 다시 선택해 주세요.";
  }

  return "분석에 실패했습니다. 서버 연동 설정을 확인해 주세요.";
}

function getUploadFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Invalid JSON")) {
    return "업로드 데이터 전송에 실패했습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.";
  }

  if (message.includes("expense_requests") || message.includes("column")) {
    return "대시보드 지출결의 항목 연결을 확인해 주세요.";
  }

  return "업로드에 실패했습니다. 대기열에 저장했으니 잠시 뒤 다시 시도해 주세요.";
}

async function normalizeReceiptImage(file, manualRotation) {
  const image = await loadDrawableImage(file);
  const autoRotation = image.width > image.height ? 90 : 0;
  const rotation = (autoRotation + manualRotation) % 360;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const rotatedSideways = rotation === 90 || rotation === 270;

  canvas.width = rotatedSideways ? image.height : image.width;
  canvas.height = rotatedSideways ? image.width : image.height;

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(image.source, -image.width / 2, -image.height / 2);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) {
    return file;
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}-receipt.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function loadDrawableImage(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height
      };
    } catch (error) {
      console.warn("createImageBitmap failed, falling back to Image", error);
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  } finally {
    URL.revokeObjectURL(url);
  }
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
    usageContent: elements.usageInput.value.trim(),
    rawText: elements.rawTextInput.value.trim(),
    attachmentId: state.attachmentId,
    source: "receipt-ocr-pwa",
    workflow: "expense_approval",
    deviceId: getDeviceId(),
    batchIndex: state.currentIndex >= 0 ? state.currentIndex + 1 : null,
    batchTotal: state.items.length || 1,
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
  clearPreviewUrl();
  state.items = [];
  state.currentIndex = -1;
  state.selectedFile = null;
  state.attachmentId = "";
  state.capturedAt = "";
  elements.cameraInput.value = "";
  elements.albumInput.value = "";
  elements.previewImage.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.rotateButton.disabled = true;
  elements.usageInput.value = "";
  elements.batchText.textContent = "";
  clearReceiptFields();
}

function clearPreviewUrl() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
}

function hasMinimumReceiptFields(receipt) {
  return Boolean(receipt.merchant && receipt.purchasedAt && receipt.totalAmount !== null && receipt.usageContent);
}

function updateActions() {
  const receipt = buildReceiptPayload();
  elements.ocrButton.disabled = !state.selectedFile;
  elements.uploadButton.disabled = !hasMinimumReceiptFields(receipt);
}

function updateBatchText() {
  if (state.items.length <= 1) {
    elements.batchText.textContent = "";
    return;
  }

  elements.batchText.textContent = `${state.currentIndex + 1} / ${state.items.length}`;
}

function getDeviceId() {
  return localStorage.getItem(STORAGE_KEYS.deviceId) || "";
}

function shortDeviceId(id) {
  return id ? id.slice(0, 8) : "미등록";
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

function showFeedback({ type, title, message, closeable, autoHideMs }) {
  window.clearTimeout(state.feedbackTimer);
  elements.feedbackDialog.className = `feedback-dialog is-${type}`;
  elements.feedbackIcon.textContent = type === "success" ? "✓" : type === "error" ? "!" : "";
  elements.feedbackTitle.textContent = title;
  elements.feedbackMessage.textContent = message;
  elements.feedbackCloseButton.hidden = !closeable;
  elements.feedbackDialog.hidden = false;

  if (autoHideMs) {
    state.feedbackTimer = window.setTimeout(hideFeedback, autoHideMs);
  }
}

function hideFeedback() {
  window.clearTimeout(state.feedbackTimer);
  elements.feedbackDialog.hidden = true;
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
