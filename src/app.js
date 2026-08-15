const STORAGE_KEYS = {
  deviceId: "receiptOcr.deviceId",
  queue: "receiptOcr.pendingUploads",
  categoryStats: "receiptOcr.categoryStats",
  improvements: "receiptOcr.improvementRequests"
};

const MAX_RECEIPT_IMAGE_SIDE = 1800;
const RECEIPT_IMAGE_QUALITY = 0.82;
const DEFAULT_SUBCATEGORY = "외부 미팅 식대";
const MAX_QUICK_SUBCATEGORIES = 6;
const PAYMENT_METHOD_LABELS = {
  card: "법인카드",
  transfer: "계좌이체",
  corporate_card: "법인카드",
  personal_card: "개인카드",
  corporate_transfer: "계좌이체",
  transfer_request: "계좌이체"
};
const EXCLUDED_QUICK_SUBCATEGORIES = new Set(["정기구독", "사무용품"]);
const DEFAULT_QUICK_SUBCATEGORIES = ["외부 미팅 식대", "외부 미팅 다과", "직원 식대", "차량 유류비", "교통비", "주차비"];
const EXPENSE_SUBCATEGORY_TREE = {
  "여비·출장비": ["교통비", "출장 유류비", "주차비", "택시비", "숙박비", "출장 식대", "출장 다과", "통행료", "기타 출장비"],
  "업무 추진비": ["외부 미팅 식대", "외부 미팅 다과", "거래처 선물", "회의비", "접대비", "기타 업무추진비"],
  "내부 사업비": ["교육 재료비", "행사 다과", "행사 식대", "인쇄·출력", "운반비", "촬영·편집", "작가·강사료", "기타 내부사업비"],
  "외부 사업비(외주용역)": ["외주 강사료", "외주 재료비", "외주 인쇄·출력", "외주 행사 다과", "외주 운반비", "외주 촬영·편집", "기타 외주용역비"],
  "복리후생비": ["직원 식대", "직원 간식", "회식비", "워크샵", "복지 소모품", "경조사", "기타 복리후생비"],
  "운영비": ["정기구독", "소모품", "사무용품", "서류 발급", "우편·택배", "통신비", "소프트웨어", "서버·도메인", "기타 운영비"],
  "차량비": ["차량 유류비", "차량 소모품", "정비비", "차량 주차비", "차량 통행료", "보험료", "기타 차량비"],
  "홍보비(광고비)": ["온라인 광고", "SNS 광고", "인쇄 홍보물", "촬영·콘텐츠", "홍보 대행", "기타 홍보비"],
  "자산취득비": ["비품 구입", "장비 구입", "가구", "전자기기", "소프트웨어 라이선스", "기타 자산취득"]
};

const state = {
  items: [],
  currentIndex: -1,
  previewUrl: "",
  feedbackTimer: 0,
  isProcessing: false
};

const elements = {
  deviceIdText: document.querySelector("#deviceIdText"),
  cameraInput: document.querySelector("#cameraInput"),
  albumInput: document.querySelector("#albumInput"),
  previewImage: document.querySelector("#previewImage"),
  rotateButton: document.querySelector("#rotateButton"),
  batchText: document.querySelector("#batchText"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  batchSummary: document.querySelector("#batchSummary"),
  batchList: document.querySelector("#batchList"),
  includeUploadInput: document.querySelector("#includeUploadInput"),
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
  categoryShortcuts: document.querySelector("#categoryShortcuts"),
  usageMajorText: document.querySelector("#usageMajorText"),
  paymentMethodInput: document.querySelector("#paymentMethodInput"),
  cardOwnerField: document.querySelector("#cardOwnerField"),
  cardOwnerInput: document.querySelector("#cardOwnerInput"),
  paymentNotice: document.querySelector("#paymentNotice"),
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
  populateSubcategoryOptions();
  renderCategoryShortcuts();
  elements.deviceIdText.textContent = shortDeviceId(getDeviceId());
  elements.cameraInput.addEventListener("change", handleFileSelection);
  elements.albumInput.addEventListener("change", handleFileSelection);
  elements.rotateButton.addEventListener("click", rotateCurrentReceipt);
  elements.prevButton.addEventListener("click", () => moveCurrentReceipt(-1));
  elements.nextButton.addEventListener("click", () => moveCurrentReceipt(1));
  elements.includeUploadInput.addEventListener("change", () => {
    const item = getCurrentItem();
    if (item) {
      item.selectedForUpload = elements.includeUploadInput.checked;
      updateBatchUi();
      updateActions();
    }
  });
  elements.ocrButton.addEventListener("click", analyzeAllReceipts);
  elements.uploadButton.addEventListener("click", uploadCheckedReceipts);
  elements.retryButton.addEventListener("click", retryQueuedUploads);
  elements.form.addEventListener("input", handleFormInput);
  elements.usageInput.addEventListener("input", handleFormInput);
  elements.categoryInput.addEventListener("change", handleCategoryChange);
  elements.paymentMethodInput.addEventListener("change", handlePaymentMethodChange);
  elements.cardOwnerInput.addEventListener("input", handleFormInput);
  elements.feedbackCloseButton.addEventListener("click", hideFeedback);

  registerServiceWorker();
  handleCategoryChange();
  handlePaymentMethodChange();
  updateQueueCount();
  updateBatchUi();
  updateActions();
  initImprovementCapture();
}

function ensureDeviceId() {
  if (localStorage.getItem(STORAGE_KEYS.deviceId)) return;
  const id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.deviceId, id);
}

function removeLegacyDeviceHistory() {
  localStorage.removeItem("receiptOcr.uploadHistory");
}

async function handleFileSelection(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  clearPreviewUrl();
  state.items = files.map(createReceiptItem);
  state.currentIndex = 0;
  event.target.value = "";
  await showCurrentReceipt();
  await analyzeAllReceipts();
}

function createReceiptItem(file, index) {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    originalFile: file,
    normalizedFile: null,
    rotation: 0,
    receipt: createEmptyReceipt(),
    usageContent: "",
    paymentMethod: "card",
    cardOwnerName: "",
    selectedForUpload: true,
    attachmentId: "",
    capturedAt: new Date().toISOString(),
    status: "pending",
    error: ""
  };
}

function createEmptyReceipt() {
  return {
    merchant: "",
    purchasedAt: "",
    totalAmount: "",
    taxAmount: "",
    currency: "KRW",
    category: DEFAULT_SUBCATEGORY,
    paymentMethod: "card",
    cardLast4: "",
    rawText: ""
  };
}

async function showCurrentReceipt() {
  const item = getCurrentItem();
  if (!item) {
    clearAfterUpload();
    return;
  }

  clearPreviewUrl();
  setStatus("영수증 이미지를 준비하는 중입니다.");

  try {
    item.normalizedFile = item.normalizedFile || await normalizeReceiptImage(item.originalFile, item.rotation);
  } catch (error) {
    console.warn("Image normalization failed", error);
    item.normalizedFile = item.originalFile;
  }

  state.previewUrl = URL.createObjectURL(item.normalizedFile);
  elements.previewImage.src = state.previewUrl;
  elements.previewImage.hidden = false;
  elements.rotateButton.disabled = false;
  fillReceiptFields(item.receipt);
  elements.usageInput.value = item.usageContent;
  setSelectValue(elements.paymentMethodInput, item.paymentMethod || item.receipt.paymentMethod || "card");
  elements.cardOwnerInput.value = item.cardOwnerName || "";
  elements.includeUploadInput.checked = item.selectedForUpload;
  elements.includeUploadInput.disabled = false;
  handleCategoryChange();
  handlePaymentMethodChange();
  updateBatchUi();
  updateActions();
}

async function rotateCurrentReceipt() {
  const item = getCurrentItem();
  if (!item) return;

  saveCurrentItemFromFields();
  item.rotation = (item.rotation + 90) % 360;
  item.normalizedFile = null;
  item.status = item.status === "uploaded" ? "uploaded" : "pending";
  await showCurrentReceipt();
  setStatus("영수증 방향을 90도 회전했습니다. 필요하면 전체 분석을 다시 눌러주세요.");
}

async function moveCurrentReceipt(direction) {
  if (state.isProcessing) return;
  const nextIndex = state.currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.items.length) return;

  saveCurrentItemFromFields();
  state.currentIndex = nextIndex;
  await showCurrentReceipt();
}

async function analyzeAllReceipts() {
  if (state.items.length === 0) {
    setStatus("먼저 영수증을 촬영하거나 사진앨범에서 선택해 주세요.");
    updateActions();
    return;
  }

  saveCurrentItemFromFields();
  state.isProcessing = true;
  updateActions();

  const total = state.items.length;
  let successCount = 0;
  showFeedback({
    type: "loading",
    title: "내용 분석 중",
    message: `${total}장 분석을 시작합니다.\n잠시만 기다려 주세요.`,
    closeable: false
  });

  for (let index = 0; index < total; index += 1) {
    state.currentIndex = index;
    await showCurrentReceipt();
    const item = state.items[index];
    item.status = "analyzing";
    item.error = "";
    updateBatchUi();
    setStatus(`${total}장 중 ${index + 1}번째 영수증을 분석하는 중입니다.`);
    showFeedback({
      type: "loading",
      title: "내용 분석 중",
      message: `${total}장 중 ${index + 1}번째 영수증을 읽고 있습니다.\n잠시만 기다려 주세요.`,
      closeable: false
    });

    try {
      await analyzeReceiptItem(item);
      item.status = "review";
      successCount += 1;
    } catch (error) {
      console.error(error);
      item.status = "error";
      item.error = getOcrFailureMessage(error);
    }
  }

  state.isProcessing = false;
  state.currentIndex = firstReviewableIndex();
  await showCurrentReceipt();

  if (successCount === total) {
    setStatus("모든 영수증 분석이 끝났습니다. 각 내용을 확인한 뒤 업로드할 항목만 체크해 주세요.");
    showFeedback({
      type: "success",
      title: "분석 완료",
      message: "각 영수증 내용을 확인한 뒤 선택 업로드를 눌러주세요.",
      closeable: true,
      autoHideMs: 2200
    });
  } else if (successCount > 0) {
    setStatus("일부 영수증 분석에 실패했습니다. 실패한 항목은 다시 촬영하거나 전체 분석을 다시 눌러주세요.");
    showFeedback({
      type: "error",
      title: "일부 분석 실패",
      message: `${successCount}장은 분석했고 ${total - successCount}장은 실패했습니다.`,
      closeable: true
    });
  } else {
    setStatus("분석에 실패했습니다. 서버 연동 설정과 이미지를 확인해 주세요.");
    showFeedback({
      type: "error",
      title: "분석 실패",
      message: "모든 영수증 분석에 실패했습니다. 서버 연동 설정을 확인해 주세요.",
      closeable: true
    });
  }

  updateBatchUi();
  updateActions();
}

async function analyzeReceiptItem(item) {
  item.normalizedFile = item.normalizedFile || await normalizeReceiptImage(item.originalFile, item.rotation);

  const formData = new FormData();
  formData.append("receipt", item.normalizedFile);
  formData.append("source", "receipt-ocr-pwa");
  formData.append("workflow", "expense_approval");
  formData.append("deviceId", getDeviceId());
  formData.append("capturedAt", item.capturedAt);

  const response = await fetch("/api/receipts/ocr", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, `OCR failed with ${response.status}`));
  }

  const payload = await response.json();
  const receipt = normalizeReceipt(payload);
  item.attachmentId = payload.attachmentId || receipt.attachmentId || "";
  item.receipt = receipt;
  item.paymentMethod = receipt.paymentMethod || item.paymentMethod || "card";
  item.capturedAt = item.capturedAt || new Date().toISOString();
}

async function uploadCheckedReceipts() {
  saveCurrentItemFromFields();
  const selectedItems = state.items.filter((item) => item.selectedForUpload && item.status !== "uploaded");

  if (selectedItems.length === 0) {
    setStatus("업로드할 영수증을 하나 이상 체크해 주세요.");
    updateActions();
    return;
  }

  const invalidItem = selectedItems.find((item) => !hasMinimumReceiptFields(buildReceiptPayload(item)));
  if (invalidItem) {
    state.currentIndex = state.items.indexOf(invalidItem);
    await showCurrentReceipt();
    const message = getValidationMessage(buildReceiptPayload(invalidItem));
    setStatus(message);
    showFeedback({
      type: "error",
      title: "필수 항목 확인",
      message,
      closeable: true
    });
    return;
  }

  state.isProcessing = true;
  updateActions();
  showFeedback({
    type: "loading",
    title: "업로드 중",
    message: `${selectedItems.length}장을 지출 결의 대시보드로 보내고 있습니다.`,
    closeable: false
  });

  let uploadedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    state.currentIndex = state.items.indexOf(item);
    await showCurrentReceipt();
    setStatus(`${selectedItems.length}장 중 ${index + 1}번째 영수증을 업로드하는 중입니다.`);

    const receipt = buildReceiptPayload(item);
    try {
      await uploadReceipt(receipt);
      rememberCategoryUse(receipt.category);
      item.status = "uploaded";
      item.selectedForUpload = false;
      uploadedCount += 1;
    } catch (error) {
      console.error(error);
      queueReceipt(receipt);
      item.status = "queued";
      item.error = getUploadFailureMessage(error);
      failedCount += 1;
    }
    updateBatchUi();
  }

  state.isProcessing = false;
  updateQueueCount();
  await showCurrentReceipt();
  updateActions();

  if (failedCount === 0) {
    setStatus("선택한 영수증이 모두 업로드되었습니다.");
    showFeedback({
      type: "success",
      title: "업로드 완료",
      message: "지출 결의 대시보드에 영수증이 등록되었습니다.",
      closeable: true,
      autoHideMs: 2200
    });
  } else {
    setStatus("일부 업로드에 실패해 대기열에 저장되었습니다.");
    showFeedback({
      type: "error",
      title: "업로드 실패",
      message: `${uploadedCount}장은 업로드했고 ${failedCount}장은 대기열에 저장했습니다.`,
      closeable: true
    });
  }
}

async function retryQueuedUploads() {
  const queue = getQueue();
  if (queue.length === 0) {
    setStatus("대기 목록이 없습니다.");
    return;
  }

  setStatus("대기 목록을 업로드하는 중입니다.");
  showFeedback({
    type: "loading",
    title: "업로드 중",
    message: "대기 목록을 다시 보내고 있습니다.",
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
    setStatus("대기 목록이 모두 업로드되었습니다.");
    showFeedback({
      type: "success",
      title: "업로드 완료",
      message: "대기 목록이 모두 대시보드에 등록되었습니다.",
      closeable: true,
      autoHideMs: 2200
    });
  } else {
    setStatus("일부 항목은 아직 대기 중입니다.");
    showFeedback({
      type: "error",
      title: "업로드 실패",
      message: "일부 항목은 아직 업로드되지 않았습니다. 네트워크 상태를 확인하고 다시 눌러 주세요.",
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
  if (message.includes("OpenAI API key")) return "분석에 실패했습니다. 관리자 OCR 설정을 확인해 주세요.";
  if (message.includes("receipt image is required")) return "영수증 이미지를 다시 선택해 주세요.";
  if (message.includes("image could not be processed")) return "사진을 처리하지 못했습니다. 영수증을 화면에 꽉 차게 다시 촬영해 주세요.";
  return "분석에 실패했습니다. 서버 연동 설정을 확인해 주세요.";
}

function getUploadFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invalid JSON")) return "업로드 데이터 전송에 실패했습니다. 앱을 새로고침하고 다시 시도해 주세요.";
  if (message.includes("expense_requests") || message.includes("column")) return "대시보드 지출 결의 항목 연결을 확인해 주세요.";
  return "업로드에 실패했습니다. 대기열에 저장했으니 잠시 후 다시 시도해 주세요.";
}

async function normalizeReceiptImage(file, manualRotation) {
  const image = await loadDrawableImage(file);
  const autoRotation = image.width > image.height ? 90 : 0;
  const rotation = (autoRotation + manualRotation) % 360;
  const rotatedSideways = rotation === 90 || rotation === 270;
  const orientedWidth = rotatedSideways ? image.height : image.width;
  const orientedHeight = rotatedSideways ? image.width : image.height;
  const scale = Math.min(1, MAX_RECEIPT_IMAGE_SIDE / Math.max(orientedWidth, orientedHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.round(orientedWidth * scale);
  canvas.height = Math.round(orientedHeight * scale);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    image.source,
    -(image.width * scale) / 2,
    -(image.height * scale) / 2,
    image.width * scale,
    image.height * scale
  );

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", RECEIPT_IMAGE_QUALITY));
  if (!blob) return file;

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
    category: normalizeSubcategory(receipt.category || DEFAULT_SUBCATEGORY),
    paymentMethod: normalizePaymentMethod(receipt.paymentMethod || receipt.payment_method || "card"),
    cardLast4: receipt.cardLast4 || receipt.card_last4 || "",
    rawText: receipt.rawText || receipt.text || "",
    attachmentId: receipt.attachmentId || ""
  };
}

function fillReceiptFields(receipt) {
  elements.merchantInput.value = receipt.merchant || "";
  elements.dateInput.value = receipt.purchasedAt || "";
  elements.totalInput.value = receipt.totalAmount || "";
  elements.taxInput.value = receipt.taxAmount || "";
  elements.currencyInput.value = receipt.currency || "KRW";
  setSelectValue(elements.categoryInput, receipt.category || DEFAULT_SUBCATEGORY);
  elements.rawTextInput.value = receipt.rawText || "";
}

function saveCurrentItemFromFields() {
  const item = getCurrentItem();
  if (!item) return;
  item.receipt = {
    ...getReceiptFields(),
    cardLast4: item.receipt.cardLast4 || ""
  };
  item.usageContent = elements.usageInput.value.trim();
  item.paymentMethod = elements.paymentMethodInput.value;
  item.cardOwnerName = elements.cardOwnerInput.value.trim();
  item.selectedForUpload = elements.includeUploadInput.checked;
}

function getReceiptFields() {
  return {
    merchant: elements.merchantInput.value.trim(),
    purchasedAt: elements.dateInput.value,
    totalAmount: elements.totalInput.value,
    taxAmount: elements.taxInput.value,
    currency: elements.currencyInput.value,
    category: elements.categoryInput.value || DEFAULT_SUBCATEGORY,
    paymentMethod: elements.paymentMethodInput.value || "card",
    rawText: elements.rawTextInput.value.trim()
  };
}

function buildReceiptPayload(item = getCurrentItem()) {
  const receipt = item?.receipt || getReceiptFields();
  const paymentMethod = item?.paymentMethod || receipt.paymentMethod || elements.paymentMethodInput.value || "card";
  const cardOwnerName = item?.cardOwnerName || "";
  const category = normalizeSubcategory(receipt.category || DEFAULT_SUBCATEGORY);
  const itemIndex = item ? state.items.indexOf(item) : state.currentIndex;

  return {
    merchant: String(receipt.merchant || "").trim(),
    purchasedAt: receipt.purchasedAt || "",
    totalAmount: numberOrNull(receipt.totalAmount),
    taxAmount: numberOrNull(receipt.taxAmount),
    currency: receipt.currency || "KRW",
    category,
    usageCategory: getUsageFromSubcategory(category),
    paymentMethod,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod,
    cardLast4: receipt.cardLast4 || "",
    cardOwnerName,
    submittedBy: paymentMethod === "personal_card" ? cardOwnerName : "",
    usageContent: String(item?.usageContent ?? elements.usageInput.value).trim(),
    rawText: String(receipt.rawText || "").trim(),
    attachmentId: item?.attachmentId || "",
    source: "receipt-ocr-pwa",
    workflow: "expense_approval",
    deviceId: getDeviceId(),
    batchIndex: itemIndex >= 0 ? itemIndex + 1 : null,
    batchTotal: state.items.length || 1,
    capturedAt: item?.capturedAt || new Date().toISOString(),
    status: "confirmed"
  };
}

function clearReceiptFields() {
  elements.form.reset();
  elements.currencyInput.value = "KRW";
  elements.categoryInput.value = DEFAULT_SUBCATEGORY;
  elements.paymentMethodInput.value = "card";
  elements.cardOwnerInput.value = "";
  handleCategoryChange();
  handlePaymentMethodChange();
}

function clearAfterUpload() {
  clearPreviewUrl();
  state.items = [];
  state.currentIndex = -1;
  elements.cameraInput.value = "";
  elements.albumInput.value = "";
  elements.previewImage.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.rotateButton.disabled = true;
  elements.usageInput.value = "";
  elements.batchText.textContent = "";
  elements.includeUploadInput.checked = false;
  elements.includeUploadInput.disabled = true;
  clearReceiptFields();
  updateBatchUi();
  updateActions();
}

function clearPreviewUrl() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
}

function hasMinimumReceiptFields(receipt) {
  return Boolean(
    receipt.merchant &&
    receipt.purchasedAt &&
    receipt.totalAmount !== null &&
    receipt.category &&
    receipt.usageContent &&
    (receipt.paymentMethod !== "personal_card" || receipt.cardOwnerName)
  );
}

function getValidationMessage(receipt) {
  if (!receipt.merchant) return "가맹점을 확인해 주세요.";
  if (!receipt.purchasedAt) return "사용일을 확인해 주세요.";
  if (receipt.totalAmount === null) return "총액을 확인해 주세요.";
  if (!receipt.category) return "지출 소분류를 확인해 주세요.";
  if (!receipt.usageContent) return "사용 내용을 입력해 주세요.";
  if (receipt.paymentMethod === "personal_card" && !receipt.cardOwnerName) return "개인카드 사용 직원 이름을 입력해 주세요.";
  return "필수 항목을 확인해 주세요.";
}

function updateActions() {
  const hasItems = state.items.length > 0;
  const selectedCount = state.items.filter((item) => item.selectedForUpload && item.status !== "uploaded").length;
  elements.ocrButton.disabled = !hasItems || state.isProcessing;
  elements.uploadButton.disabled = selectedCount === 0 || state.isProcessing;
  elements.rotateButton.disabled = !getCurrentItem() || state.isProcessing;
  elements.prevButton.disabled = state.currentIndex <= 0 || state.isProcessing;
  elements.nextButton.disabled = state.currentIndex < 0 || state.currentIndex >= state.items.length - 1 || state.isProcessing;
}

function updateBatchUi() {
  const total = state.items.length;
  const selected = state.items.filter((item) => item.selectedForUpload && item.status !== "uploaded").length;
  elements.batchSummary.textContent = total ? `${total}장 중 ${selected}장 업로드 선택` : "0장 선택";
  elements.batchText.textContent = total > 1 && state.currentIndex >= 0 ? `${state.currentIndex + 1} / ${total}` : "";
  elements.batchList.innerHTML = "";

  state.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `batch-pill is-${item.status}`;
    if (index === state.currentIndex) button.classList.add("is-active");
    button.textContent = `${index + 1} ${getStatusLabel(item)}`;
    button.addEventListener("click", async () => {
      if (state.isProcessing) return;
      saveCurrentItemFromFields();
      state.currentIndex = index;
      await showCurrentReceipt();
    });
    elements.batchList.append(button);
  });
}

function getStatusLabel(item) {
  const labels = {
    pending: "대기",
    analyzing: "분석중",
    review: "확인",
    uploaded: "완료",
    queued: "대기열",
    error: "실패"
  };
  return item.selectedForUpload || item.status === "uploaded" ? labels[item.status] || "확인" : "제외";
}

function handleFormInput() {
  saveCurrentItemFromFields();
  handleCategoryChange();
  handlePaymentMethodChange();
  updateBatchUi();
  updateActions();
}

function getCurrentItem() {
  return state.items[state.currentIndex] || null;
}

function firstReviewableIndex() {
  const index = state.items.findIndex((item) => item.status === "review" || item.status === "error");
  return index >= 0 ? index : 0;
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

function populateSubcategoryOptions() {
  elements.categoryInput.innerHTML = "";
  for (const [major, subcategories] of Object.entries(EXPENSE_SUBCATEGORY_TREE)) {
    const group = document.createElement("optgroup");
    group.label = major;
    for (const subcategory of subcategories) {
      const option = document.createElement("option");
      option.value = subcategory;
      option.textContent = subcategory;
      group.appendChild(option);
    }
    elements.categoryInput.appendChild(group);
  }
  elements.categoryInput.value = DEFAULT_SUBCATEGORY;
}

function handleCategoryChange() {
  const major = getUsageFromSubcategory(elements.categoryInput.value);
  elements.usageMajorText.textContent = major ? `대분류: ${major}` : "대분류 자동 계산";
  renderCategoryShortcuts(elements.categoryInput.value);
  updateCategoryShortcutState();
  updateActions();
}

function handlePaymentMethodChange() {
  const isPersonal = elements.paymentMethodInput.value === "personal_card";
  elements.cardOwnerField.classList.toggle("is-hidden", !isPersonal);
  elements.cardOwnerInput.required = isPersonal;

  if (elements.paymentMethodInput.value === "transfer") {
    elements.paymentNotice.hidden = false;
    elements.paymentNotice.textContent = "계좌이체 항목은 지출결의에서 이체 필요 여부를 확인합니다.";
  } else if (isPersonal) {
    elements.paymentNotice.hidden = false;
    elements.paymentNotice.textContent = "개인카드 사용분은 직원 이름을 함께 기록해 월말 정산 항목으로 올립니다.";
  } else {
    elements.paymentNotice.hidden = true;
    elements.paymentNotice.textContent = "";
  }
  updateActions();
}

function renderCategoryShortcuts(preferredSubcategory = "") {
  const shortcuts = getQuickSubcategories(preferredSubcategory);
  elements.categoryShortcuts.innerHTML = "";
  for (const subcategory of shortcuts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-chip";
    button.textContent = subcategory;
    button.dataset.category = subcategory;
    button.addEventListener("click", () => {
      setSelectValue(elements.categoryInput, subcategory);
      handleCategoryChange();
    });
    elements.categoryShortcuts.appendChild(button);
  }
  updateCategoryShortcutState();
}

function getQuickSubcategories(preferredSubcategory = "") {
  const allSubcategories = getAllSubcategories();
  const stats = getCategoryStats();
  const frequentlyUsed = Object.entries(stats)
    .filter(([subcategory]) => allSubcategories.has(subcategory) && !EXCLUDED_QUICK_SUBCATEGORIES.has(subcategory))
    .sort((a, b) => {
      const countGap = (b[1].count || 0) - (a[1].count || 0);
      if (countGap !== 0) return countGap;
      return String(b[1].lastUsedAt || "").localeCompare(String(a[1].lastUsedAt || ""));
    })
    .map(([subcategory]) => subcategory);

  const preferred = allSubcategories.has(preferredSubcategory) && !EXCLUDED_QUICK_SUBCATEGORIES.has(preferredSubcategory) ? [preferredSubcategory] : [];
  const categories = [...preferred, ...frequentlyUsed, ...DEFAULT_QUICK_SUBCATEGORIES];
  return Array.from(new Set(categories)).slice(0, MAX_QUICK_SUBCATEGORIES);
}

function rememberCategoryUse(subcategory) {
  if (!getAllSubcategories().has(subcategory)) return;

  const stats = getCategoryStats();
  const current = stats[subcategory] || { count: 0, lastUsedAt: "" };
  stats[subcategory] = {
    count: current.count + 1,
    lastUsedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.categoryStats, JSON.stringify(stats));
  renderCategoryShortcuts(subcategory);
}

function getCategoryStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.categoryStats) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getAllSubcategories() {
  return new Set(Object.values(EXPENSE_SUBCATEGORY_TREE).flat());
}

function updateCategoryShortcutState() {
  Array.from(elements.categoryShortcuts.querySelectorAll("button")).forEach((button) => {
    button.classList.toggle("active", button.dataset.category === elements.categoryInput.value);
  });
}

function getUsageFromSubcategory(subcategory) {
  for (const [major, subcategories] of Object.entries(EXPENSE_SUBCATEGORY_TREE)) {
    if (subcategories.includes(subcategory)) return major;
  }
  return "";
}

function normalizeSubcategory(value) {
  const legacyMap = {
    meals: "외부 미팅 식대",
    transport: "교통비",
    supplies: "소모품",
    lodging: "숙박비",
    general: DEFAULT_SUBCATEGORY,
    "유류비": "차량 유류비"
  };
  return legacyMap[value] || value || DEFAULT_SUBCATEGORY;
}

function normalizePaymentMethod(value) {
  if (value === "transfer" || value === "corporate_transfer" || value === "transfer_request") return "transfer";
  if (value === "personal_card") return "personal_card";
  return "card";
}

function setSelectValue(select, value) {
  const hasOption = Array.from(select.options).some((option) => option.value === value);
  select.value = hasOption ? value : select.options[0]?.value || "";
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function showFeedback({ type, title, message, closeable, autoHideMs }) {
  window.clearTimeout(state.feedbackTimer);
  elements.feedbackDialog.className = `feedback-dialog is-${type}`;
  elements.feedbackIcon.textContent = type === "success" ? "" : type === "error" ? "!" : "";
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
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function numberOrEmpty(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? String(Math.round(number)) : "";
}

function numberOrNull(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

function initImprovementCapture() {
  const root = document.createElement("div");
  root.className = "improvement-root";
  root.innerHTML = `
    <button class="improvement-fab" type="button" title="개선 메모 열기 (Ctrl+Shift+M)" aria-label="개선 메모 열기">개선</button>
    <div class="improvement-backdrop" hidden>
      <section class="improvement-modal" role="dialog" aria-modal="true" aria-label="개선 메모">
        <div class="improvement-head">
          <div>
            <p class="eyebrow">영수증 OCR 개선함</p>
            <h2>개선 메모</h2>
          </div>
          <button class="improvement-close" type="button" aria-label="닫기">×</button>
        </div>
        <p class="improvement-guide">현재 화면과 입력값이 함께 저장됩니다. Ctrl+Shift+M으로 바로 열 수 있습니다.</p>
        <div class="improvement-form">
          <label class="field">
            <span>유형</span>
            <select data-improvement-type>
              <option value="bug">오류</option>
              <option value="ux">불편</option>
              <option value="design">디자인</option>
              <option value="feature">기능요청</option>
              <option value="data">데이터</option>
            </select>
          </label>
          <label class="field">
            <span>메모</span>
            <textarea data-improvement-note rows="4" placeholder="어떤 점을 고치면 좋을까요?"></textarea>
          </label>
          <button class="primary-button" type="button" data-improvement-save>개선함에 저장</button>
          <p class="improvement-message" data-improvement-message></p>
        </div>
        <div class="improvement-list-head">
          <strong>최근 개선 요청</strong>
          <button class="text-button" type="button" data-improvement-clear>완료 항목 비우기</button>
        </div>
        <div class="improvement-list" data-improvement-list></div>
      </section>
    </div>
  `;

  document.body.appendChild(root);

  const fab = root.querySelector(".improvement-fab");
  const backdrop = root.querySelector(".improvement-backdrop");
  const modal = root.querySelector(".improvement-modal");
  const closeButton = root.querySelector(".improvement-close");
  const saveButton = root.querySelector("[data-improvement-save]");
  const clearButton = root.querySelector("[data-improvement-clear]");
  const noteInput = root.querySelector("[data-improvement-note]");
  const typeInput = root.querySelector("[data-improvement-type]");
  const message = root.querySelector("[data-improvement-message]");
  const list = root.querySelector("[data-improvement-list]");

  function open() {
    backdrop.hidden = false;
    renderImprovementList(list);
    noteInput.focus();
  }

  function close() {
    backdrop.hidden = true;
    message.textContent = "";
  }

  fab.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  modal.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) close();
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      if (backdrop.hidden) open();
      else close();
    }
  });

  saveButton.addEventListener("click", () => {
    const note = noteInput.value.trim();
    if (!note) {
      message.textContent = "개선 메모를 입력해 주세요.";
      return;
    }

    saveImprovementRequest({
      type: typeInput.value,
      note
    });
    noteInput.value = "";
    message.textContent = "개선함에 저장했습니다.";
    renderImprovementList(list);
  });

  clearButton.addEventListener("click", () => {
    const rows = getImprovementRequests().filter((row) => row.status !== "done");
    setImprovementRequests(rows);
    renderImprovementList(list);
  });
}

function saveImprovementRequest({ type, note }) {
  const rows = getImprovementRequests();
  const currentReceipt = buildReceiptPayload();
  const request = {
    id: crypto.randomUUID ? crypto.randomUUID() : `improvement-${Date.now()}`,
    app: "receipt-ocr",
    menu_id: "receipt_ocr",
    menu_label: "영수증 OCR",
    page_title: document.title,
    page_path: `${location.pathname}${location.search}`,
    request_type: type,
    note,
    status: "open",
    context: {
      deviceId: getDeviceId(),
      merchant: currentReceipt.merchant,
      amount: currentReceipt.totalAmount,
      category: currentReceipt.category,
      usageCategory: currentReceipt.usageCategory,
      paymentMethod: currentReceipt.paymentMethod,
      cardOwnerName: currentReceipt.cardOwnerName,
      capturedAt: currentReceipt.capturedAt
    },
    user_agent: navigator.userAgent,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    created_at: new Date().toISOString()
  };

  setImprovementRequests([request, ...rows].slice(0, 100));
}

function getImprovementRequests() {
  try {
    const rows = JSON.parse(localStorage.getItem(STORAGE_KEYS.improvements) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function setImprovementRequests(rows) {
  localStorage.setItem(STORAGE_KEYS.improvements, JSON.stringify(rows));
}

function renderImprovementList(list) {
  const rows = getImprovementRequests();
  list.innerHTML = "";
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "아직 저장된 개선 요청이 없습니다.";
    list.appendChild(empty);
    return;
  }

  for (const row of rows.slice(0, 8)) {
    const item = document.createElement("article");
    item.className = "improvement-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(row.note)}</strong>
        <span>${formatImprovementMeta(row)}</span>
      </div>
      <button class="text-button" type="button">${row.status === "done" ? "완료됨" : "완료"}</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      const next = getImprovementRequests().map((saved) => (
        saved.id === row.id ? { ...saved, status: "done", updated_at: new Date().toISOString() } : saved
      ));
      setImprovementRequests(next);
      renderImprovementList(list);
    });
    list.appendChild(item);
  }
}

function formatImprovementMeta(row) {
  const date = row.created_at ? new Date(row.created_at) : null;
  const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const typeMap = {
    bug: "오류",
    ux: "불편",
    design: "디자인",
    feature: "기능요청",
    data: "데이터"
  };
  return [typeMap[row.request_type] || row.request_type, row.context?.category, row.context?.paymentMethod, dateText].filter(Boolean).join(" · ");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
