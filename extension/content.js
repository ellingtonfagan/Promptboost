const fieldControls = new WeakMap();
const controlFields = new WeakMap();
const fieldPanels = new WeakMap();
const panelFields = new WeakMap();
const fieldReviewStates = new WeakMap();
const reviewFields = new Set();
const MIN_TEXT_LENGTH = 6;
const MIN_GMAIL_REVIEW_LENGTH = 25;
const MIN_FIELD_WIDTH = 120;
const CONTEXT_LIMIT = 4000;
const GMAIL_REVIEW_DEBOUNCE_MS = 3000;
const DEFAULT_MODE = "simple";

// chrome.runtime disappears from a content script when the extension is
// reloaded or updated while the page stays open. Every call below must check
// first, or the page throws on each keystroke once the 3s review timer fires.
let extensionGone = false;

function isExtensionAlive() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function handleExtensionGone(field) {
  if (extensionGone) {
    return;
  }
  extensionGone = true;
  try {
    for (const f of reviewFields) {
      const s = fieldReviewStates.get(f);
      if (s) {
        window.clearTimeout(s.debounceId);
        s.abortController?.abort();
      }
      clearMarkers(f);
    }
  } catch {
    // teardown is best effort — the extension is already gone
  }
  showToast(field, "PromptBoost was updated. Reload this page to keep using it.");
}

async function sendToWorker(message, field) {
  if (!isExtensionAlive()) {
    handleExtensionGone(field);
    return null;
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (String(error?.message || "").includes("Extension context invalidated")) {
      handleExtensionGone(field);
      return null;
    }
    throw error;
  }
}

const VALID_MODES = new Set(["simple", "structured"]);
const ISSUE_COLORS = {
  grammar: "#d93025",
  spelling: "#d93025",
  punctuation: "#d93025",
  clarity: "#1a73e8",
  tone: "#1a73e8"
};

let lastFocusedField = null;
let scanQueued = false;
let currentMode = DEFAULT_MODE;

loadMode();
queueScan();

document.addEventListener("focusin", (event) => {
  const field = closestPromptField(event.target);
  if (!field) {
    return;
  }

  lastFocusedField = field;
  attachControl(field);
  updateControl(field);
}, true);

document.addEventListener("input", (event) => {
  const field = closestPromptField(event.target);
  if (!field) {
    return;
  }

  lastFocusedField = field;
  attachControl(field);
  handleFieldInput(field);
  updateControl(field);
}, true);

document.addEventListener("mousedown", (event) => {
  if (!event.target.closest?.(".promptboost-control")) {
    closeAllMenus();
  }
  if (!event.target.closest?.(".promptboost-marker-popover, .promptboost-mark")) {
    closeAllMarkerPopovers();
  }
  if (!event.target.closest?.(".promptboost-panel, .promptboost-control")) {
    closeAllPanels();
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAllMenus();
    closeAllPanels();
    closeAllMarkerPopovers();
  }
}, true);

window.addEventListener("scroll", () => {
  repositionAllControls();
  repositionAllUnderlays();
}, true);
window.addEventListener("resize", () => {
  repositionAllControls();
  repositionAllUnderlays();
});

const observer = new MutationObserver(() => queueScan());
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.body, { childList: true, subtree: true });
    queueScan();
  }, { once: true });
}

function loadMode() {
  chrome.storage.local.get({ mode: DEFAULT_MODE }, (values) => {
    currentMode = VALID_MODES.has(values.mode) ? values.mode : DEFAULT_MODE;
    updateModeLabels();
  });
}

function queueScan() {
  if (scanQueued) {
    return;
  }

  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scanForPromptField();
  });
}

function scanForPromptField() {
  cleanupDetachedReviewStates();

  const candidates = getCandidateFields();
  if (!candidates.length) {
    return;
  }

  const preferred = pickPreferredField(candidates);
  attachControl(preferred);
  updateControl(preferred);
}

function getCandidateFields() {
  return Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]'))
    .filter((element) => isUsablePromptField(element));
}

function isUsablePromptField(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (element.closest(".promptboost-control, .promptboost-toast")) {
    return false;
  }
  if (element instanceof HTMLInputElement && element.type !== "text") {
    return false;
  }
  if (element.isContentEditable || element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width >= MIN_FIELD_WIDTH
      && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none";
  }

  return false;
}

function pickPreferredField(candidates) {
  const surface = getSurface();
  const surfaceField = pickSurfaceField(surface, candidates);
  if (surfaceField) {
    return surfaceField;
  }
  if (lastFocusedField && candidates.includes(lastFocusedField)) {
    return lastFocusedField;
  }
  if (document.activeElement && candidates.includes(document.activeElement)) {
    return document.activeElement;
  }

  return candidates
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0].element;
}

function pickSurfaceField(surface, candidates) {
  if (surface === "gmail") {
    if (document.activeElement && candidates.includes(document.activeElement) && isGmailComposeField(document.activeElement)) {
      return document.activeElement;
    }
    if (lastFocusedField && candidates.includes(lastFocusedField) && isGmailComposeField(lastFocusedField)) {
      return lastFocusedField;
    }
    return candidates.find((element) => element.matches('[role="textbox"][contenteditable="true"]')) || null;
  }
  if (surface === "substack") {
    return candidates.find((element) => element.isContentEditable) || null;
  }
  return null;
}

function isGmailComposeField(element) {
  return element instanceof HTMLElement && element.matches('[role="textbox"][contenteditable="true"]');
}

function closestPromptField(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const field = target.closest('textarea, [contenteditable="true"], input[type="text"]');
  return field && isUsablePromptField(field) ? field : null;
}

function attachControl(field) {
  if (fieldControls.has(field)) {
    return fieldControls.get(field);
  }

  const control = document.createElement("div");
  control.className = "promptboost-control";
  control.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "promptboost-button";
  button.textContent = "Enhance";
  button.addEventListener("mousedown", (event) => handleEnhance(event, control));

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "promptboost-caret";
  caret.setAttribute("aria-label", "PromptBoost mode");
  caret.textContent = "v";
  caret.addEventListener("mousedown", (event) => toggleMenu(event, control));

  const menu = document.createElement("div");
  menu.className = "promptboost-menu";
  menu.hidden = true;
  menu.append(createModeItem("simple", "Simple"), createModeItem("structured", "Structured"));

  control.append(button, caret, menu);
  document.documentElement.append(control);
  fieldControls.set(field, control);
  controlFields.set(control, field);
  updateModeLabel(control);
  return control;
}

function createModeItem(mode, label) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "promptboost-menu-item";
  item.dataset.mode = mode;
  item.textContent = label;
  item.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMode(mode);
  });
  return item;
}

async function handleEnhance(event, control) {
  event.preventDefault();
  event.stopPropagation();

  const field = controlFields.get(control);
  if (!field) {
    return;
  }

  const target = resolveRewriteTarget(field);
  if (target.text.trim().length < MIN_TEXT_LENGTH) {
    return;
  }

  hideToast(control);
  setControlLoading(control, true);
  field.focus();

  try {
    if (target.surface === "gmail") {
      const review = await runGmailReview(field, target, { openPanel: true, force: true });
      if (review) {
        renderReviewPanel(field, target, review);
      }
    } else {
      const response = await sendToWorker({
        type: "REWRITE",
        payload: {
          text: target.text,
          context: target.context,
          mode: currentMode,
          surface: target.surface
        }
      });

      if (response === null) {
        return; // extension reloaded; handleExtensionGone already told the user
      }
      if (!response.ok) {
        throw new Error(response.error || "Prompt rewrite failed.");
      }

      writeTargetText(target, response.text);
      lastFocusedField = field;
      updateControl(field);
    }
  } catch (error) {
    field.focus();
    showToast(control, error.message || "PromptBoost failed.");
  } finally {
    setControlLoading(control, false);
  }
}

function getReviewState(field) {
  let state = fieldReviewStates.get(field);
  if (state) {
    return state;
  }

  state = {
    debounceId: 0,
    lastSentText: "",
    inFlight: false,
    abortController: null,
    requestId: "",
    review: null,
    markers: [],
    popover: null,
    underlay: null,
    promptboostInputDepth: 0
  };
  fieldReviewStates.set(field, state);
  reviewFields.add(field);
  return state;
}

function handleFieldInput(field) {
  if (getSurface() !== "gmail" || !isGmailComposeField(field)) {
    return;
  }

  const state = getReviewState(field);
  window.clearTimeout(state.debounceId);
  if (state.promptboostInputDepth > 0) {
    return;
  }

  clearGmailMarkers(field);
  abortGmailReview(field);
  scheduleGmailReview(field);
}

function scheduleGmailReview(field) {
  const state = getReviewState(field);
  window.clearTimeout(state.debounceId);
  state.debounceId = window.setTimeout(() => {
    const target = resolveRewriteTarget(field);
    runGmailReview(field, target, { openPanel: false, force: false }).catch(() => {});
  }, GMAIL_REVIEW_DEBOUNCE_MS);
}

async function runGmailReview(field, target, options) {
  const state = getReviewState(field);
  window.clearTimeout(state.debounceId);

  const text = target.text;
  if (!options.force && text.trim().length < MIN_GMAIL_REVIEW_LENGTH) {
    return null;
  }
  if (!options.force && text === state.lastSentText) {
    return null;
  }
  if (state.inFlight) {
    abortGmailReview(field);
  }

  const requestId = createRequestId();
  const abortController = new AbortController();
  state.inFlight = true;
  state.abortController = abortController;
  state.requestId = requestId;
  state.lastSentText = text;
  setControlChecking(field, true);

  abortController.signal.addEventListener("abort", () => {
    if (isExtensionAlive()) {
      try { chrome.runtime.sendMessage({ type: "ABORT_REQUEST", requestId }); } catch {}
    }
  }, { once: true });

  try {
    const response = await sendToWorker({
      type: "REVIEW",
      requestId,
      payload: {
        text,
        context: target.context,
        surface: target.surface
      }
    });

    if (state.requestId !== requestId) {
      return null;
    }

    if (response?.aborted || abortController.signal.aborted) {
      return null;
    }
    if (!response?.ok) {
      throw new Error(response?.error || "Prompt review failed.");
    }
    if (getFieldText(field) !== text) {
      clearGmailMarkers(field);
      return null;
    }

    state.review = response.review;
    renderGmailUnderlines(field, normalizeReviewIssues(response.review?.issues));
    return response.review;
  } finally {
    if (state.requestId === requestId) {
      state.inFlight = false;
      state.abortController = null;
      state.requestId = "";
      setControlChecking(field, false);
    }
  }
}

function abortGmailReview(field) {
  const state = fieldReviewStates.get(field);
  if (!state?.inFlight) {
    return;
  }
  const requestId = state.requestId;
  state.abortController?.abort();
  if (requestId) {
    if (isExtensionAlive()) {
      try { chrome.runtime.sendMessage({ type: "ABORT_REQUEST", requestId }); } catch {}
    }
  }
  state.inFlight = false;
  state.abortController = null;
  state.requestId = "";
  setControlChecking(field, false);
}

function createRequestId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `promptboost-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveRewriteTarget(field) {
  const surface = getSurface();
  const selection = getActiveSelection(field);
  if (selection && selection.text.trim()) {
    return {
      field,
      text: selection.text,
      context: limitContext(getFieldText(field)),
      surface,
      selection
    };
  }

  return {
    field,
    text: getFieldText(field),
    context: contextForSurface(surface, field),
    surface,
    selection: null
  };
}

function getActiveSelection(field) {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    if (document.activeElement === field && Number.isInteger(start) && Number.isInteger(end) && end > start) {
      return {
        type: "input",
        start,
        end,
        text: field.value.slice(start, end)
      };
    }
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!field.contains(range.commonAncestorContainer)) {
    return null;
  }

  return {
    type: "contenteditable",
    range: range.cloneRange(),
    text: selection.toString()
  };
}

function contextForSurface(surface, field) {
  if (surface === "gmail") {
    return getGmailContext();
  }
  if (surface === "substack") {
    return getSubstackContext(field);
  }
  if (surface === "chat") {
    return getChatContext(field);
  }
  return "";
}

function getSurface() {
  const host = window.location.hostname;
  if (host === "mail.google.com") {
    return "gmail";
  }
  if (host === "substack.com" || host.endsWith(".substack.com")) {
    return "substack";
  }
  if (isChatHost(host)) {
    return "chat";
  }
  return "generic";
}

function isChatHost(host) {
  return host === "chatgpt.com"
    || host === "chat.openai.com"
    || host === "claude.ai"
    || host === "cursor.com"
    || host === "bolt.new"
    || host === "lovable.dev"
    || host === "v0.app"
    || host === "v0.dev"
    || host === "replit.com";
}

function getGmailContext() {
  const messages = visibleTextFrom("[role='listitem'], .adn, .a3s, [data-message-id]");
  return limitContext(messages.slice(-3).join("\n\n"));
}

function getSubstackContext(field) {
  const fieldTop = field.getBoundingClientRect().top;
  const title = firstVisibleText("input[name='title'], textarea[name='title'], [data-testid*='title'], h1");
  const paragraphs = Array.from(document.querySelectorAll("p"))
    .filter((element) => isVisible(element) && element.getBoundingClientRect().top < fieldTop)
    .map((element) => cleanText(element.innerText || element.textContent || ""))
    .filter(Boolean)
    .slice(-8);
  return limitContext([title, ...paragraphs].filter(Boolean).join("\n\n"));
}

function getChatContext(field) {
  const fieldRect = field.getBoundingClientRect();
  const turns = Array.from(document.querySelectorAll("[data-message-author-role], article, .markdown, [data-testid*='conversation']"))
    .filter((element) => isVisible(element) && !element.contains(field) && element.getBoundingClientRect().top < fieldRect.top)
    .map((element) => cleanText(element.innerText || element.textContent || ""))
    .filter(Boolean)
    .slice(-6);
  return limitContext(turns.join("\n\n"));
}

function visibleTextFrom(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => isVisible(element))
    .map((element) => cleanText(element.innerText || element.textContent || ""))
    .filter(Boolean);
}

function firstVisibleText(selector) {
  const element = Array.from(document.querySelectorAll(selector)).find((candidate) => isVisible(candidate));
  if (!element) {
    return "";
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return cleanText(element.value);
  }
  return cleanText(element.innerText || element.textContent || "");
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.visibility !== "hidden"
    && style.display !== "none";
}

function limitContext(text) {
  const cleaned = cleanText(text);
  return cleaned.length > CONTEXT_LIMIT ? cleaned.slice(-CONTEXT_LIMIT) : cleaned;
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getFieldText(field) {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.value;
  }

  return field.innerText || field.textContent || "";
}

function writeTargetText(target, text) {
  if (target.selection) {
    writeSelectionText(target, text);
    return;
  }
  writeFieldText(target.field, text);
}

function writeSelectionText(target, text) {
  const { field, selection } = target;
  field.focus();

  if (selection.type === "input") {
    const before = field.value.slice(0, selection.start);
    const after = field.value.slice(selection.end);
    setInputValue(field, `${before}${text}${after}`);
    const cursor = selection.start + text.length;
    field.setSelectionRange(cursor, cursor);
    return;
  }

  const activeSelection = window.getSelection();
  activeSelection.removeAllRanges();
  activeSelection.addRange(selection.range);
  document.execCommand("insertText", false, text);
}

function writeFieldText(field, text) {
  field.focus();
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    setInputValue(field, text);
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("insertText", false, text);
}

function setInputValue(field, text) {
  const proto = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateControl(field) {
  const control = fieldControls.get(field) || attachControl(field);
  const target = resolveRewriteTarget(field);
  const visible = target.text.trim().length >= MIN_TEXT_LENGTH && document.body.contains(field);
  control.hidden = !visible;
  if (visible) {
    positionControl(field, control);
  }
}

function repositionAllControls() {
  document.querySelectorAll(".promptboost-control").forEach((control) => {
    const field = controlFields.get(control);
    if (!field || !document.body.contains(field)) {
      control.remove();
      return;
    }

    updateControl(field);
  });
  repositionAllPanels();
}

function positionControl(field, control) {
  const rect = field.getBoundingClientRect();
  control.style.left = `${Math.max(8, rect.right + window.scrollX - control.offsetWidth)}px`;
  control.style.top = `${Math.max(8, rect.top + window.scrollY - control.offsetHeight - 8)}px`;
}

function setControlLoading(control, isLoading) {
  control._promptboostManualLoading = isLoading;
  control.querySelectorAll("button").forEach((button) => {
    button.disabled = isLoading;
  });
  const button = control.querySelector(".promptboost-button");
  button.textContent = isLoading ? "Enhancing..." : (control._promptboostChecking ? "Checking..." : "Enhance");
}

function setControlChecking(field, isChecking) {
  const control = fieldControls.get(field);
  if (!control) {
    return;
  }
  control._promptboostChecking = isChecking;
  if (!control._promptboostManualLoading) {
    control.querySelector(".promptboost-button").textContent = isChecking ? "Checking..." : "Enhance";
  }
}

function toggleMenu(event, control) {
  event.preventDefault();
  event.stopPropagation();
  const menu = control.querySelector(".promptboost-menu");
  const willOpen = menu.hidden;
  closeAllMenus();
  menu.hidden = !willOpen;
}

function closeAllMenus() {
  document.querySelectorAll(".promptboost-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function setMode(mode) {
  currentMode = VALID_MODES.has(mode) ? mode : DEFAULT_MODE;
  chrome.storage.local.set({ mode: currentMode });
  closeAllMenus();
  updateModeLabels();
}

function updateModeLabels() {
  document.querySelectorAll(".promptboost-control").forEach((control) => updateModeLabel(control));
}

function updateModeLabel(control) {
  control.querySelectorAll(".promptboost-menu-item").forEach((item) => {
    item.setAttribute("aria-checked", String(item.dataset.mode === currentMode));
  });
}

function showToast(control, message) {
  const toast = document.createElement("div");
  toast.className = "promptboost-toast";
  toast.textContent = message;
  document.documentElement.append(toast);

  const rect = control.getBoundingClientRect();
  toast.style.left = `${Math.max(8, rect.right + window.scrollX - toast.offsetWidth)}px`;
  toast.style.top = `${rect.bottom + window.scrollY + 8}px`;
  control._promptboostToast = toast;

  window.setTimeout(() => hideToast(control), 6000);
}

function hideToast(control) {
  if (control._promptboostToast) {
    control._promptboostToast.remove();
    control._promptboostToast = null;
  }
}

function renderReviewPanel(field, target, review) {
  closePanelForField(field);

  const panel = document.createElement("section");
  panel.className = "promptboost-panel";
  panel.setAttribute("aria-label", "PromptBoost email review");

  const header = document.createElement("div");
  header.className = "promptboost-panel-header";
  const title = document.createElement("div");
  title.className = "promptboost-panel-title";
  title.textContent = "Review";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "promptboost-panel-dismiss";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => closePanelForField(field));
  header.append(title, dismiss);

  const body = document.createElement("div");
  body.className = "promptboost-panel-body";
  body.append(
    createIssuesSection(normalizeReviewIssues(review?.issues)),
    createRewriteSection("Good", review?.good || "", () => applyReviewText(field, target, review?.good || "")),
    createRewriteSection("Better", review?.better || "", () => applyReviewText(field, target, review?.better || ""))
  );

  panel.append(header, body);
  document.body.append(panel);
  fieldPanels.set(field, panel);
  panelFields.set(panel, field);
  positionPanel(field, panel);
}

function createIssuesSection(issues) {
  const section = createPanelSection("Issues");

  if (!issues.length) {
    const empty = document.createElement("p");
    empty.className = "promptboost-empty";
    empty.textContent = "No grammar or spelling issues found.";
    section.append(empty);
    return section;
  }

  const groups = new Map();
  issues.forEach((issue) => {
    if (!groups.has(issue.type)) {
      groups.set(issue.type, []);
    }
    groups.get(issue.type).push(issue);
  });

  groups.forEach((groupIssues, type) => {
    const group = document.createElement("div");
    group.className = "promptboost-issue-group";
    const label = document.createElement("div");
    label.className = "promptboost-issue-type";
    label.textContent = type;
    group.append(label);

    groupIssues.forEach((issue) => {
      const row = document.createElement("div");
      row.className = "promptboost-issue";

      const change = document.createElement("div");
      change.className = "promptboost-issue-change";
      const quote = document.createElement("span");
      quote.className = "promptboost-issue-quote";
      quote.textContent = issue.quote;
      const arrow = document.createElement("span");
      arrow.className = "promptboost-issue-arrow";
      arrow.textContent = "->";
      const fix = document.createElement("span");
      fix.className = "promptboost-issue-fix";
      fix.textContent = issue.fix;
      change.append(quote, arrow, fix);

      const why = document.createElement("div");
      why.className = "promptboost-issue-why";
      why.textContent = issue.why;
      row.append(change, why);
      group.append(row);
    });

    section.append(group);
  });

  return section;
}

function createRewriteSection(titleText, text, onApply) {
  const section = createPanelSection(titleText);
  const textBlock = document.createElement("div");
  textBlock.className = "promptboost-review-text";
  textBlock.textContent = text;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "promptboost-apply";
  apply.textContent = "Apply";
  apply.disabled = !text;
  apply.addEventListener("click", onApply);
  section.append(textBlock, apply);
  return section;
}

function createPanelSection(titleText) {
  const section = document.createElement("section");
  section.className = "promptboost-section";
  const title = document.createElement("h2");
  title.className = "promptboost-section-title";
  title.textContent = titleText;
  section.append(title);
  return section;
}

function normalizeReviewIssues(issues) {
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues
    .map((issue) => ({
      type: cleanText(issue?.type || "other"),
      quote: String(issue?.quote || ""),
      fix: String(issue?.fix || ""),
      why: String(issue?.why || "")
    }))
    .filter((issue) => issue.quote || issue.fix || issue.why);
}

function renderGmailUnderlines(field, issues) {
  clearGmailMarkers(field);
  if (!issues.length || getSurface() !== "gmail" || !isGmailComposeField(field) || !document.body.contains(field)) {
    return;
  }

  const state = getReviewState(field);
  const underlay = document.createElement("div");
  underlay.className = "promptboost-underlay";
  document.body.append(underlay);
  state.underlay = underlay;
  state.markers = createIssueMarkers(field, issues)
    .map((marker) => ({ ...marker, elements: [] }));
  paintGmailMarkers(field);
}

function createIssueMarkers(field, issues) {
  const textMap = buildComposeTextMap(field);
  const consumed = new Map();
  const markers = [];

  issues.forEach((issue) => {
    const quote = issue.quote;
    if (!quote) {
      return;
    }

    const searchFrom = consumed.get(quote) || 0;
    const start = textMap.text.indexOf(quote, searchFrom);
    if (start === -1) {
      return;
    }

    consumed.set(quote, start + quote.length);
    const range = rangeFromTextMap(textMap, start, start + quote.length);
    if (!range) {
      return;
    }

    markers.push({ issue, range });
  });

  return markers;
}

function buildComposeTextMap(field) {
  const nodes = [];
  let text = "";
  const walker = document.createTreeWalker(
    field,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(".gmail_quote, blockquote")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || "";
    nodes.push({ node, start: text.length, end: text.length + value.length });
    text += value;
  }

  return { text, nodes };
}

function rangeFromTextMap(textMap, start, end) {
  const startPoint = pointFromTextMap(textMap, start);
  const endPoint = pointFromTextMap(textMap, end);
  if (!startPoint || !endPoint) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function pointFromTextMap(textMap, index) {
  for (const entry of textMap.nodes) {
    if (index >= entry.start && index <= entry.end) {
      return { node: entry.node, offset: index - entry.start };
    }
  }
  return null;
}

function paintGmailMarkers(field) {
  const state = fieldReviewStates.get(field);
  if (!state?.underlay) {
    return;
  }
  if (!document.body.contains(field)) {
    teardownReviewState(field);
    return;
  }

  const fieldRect = field.getBoundingClientRect();
  state.underlay.style.left = `${fieldRect.left + window.scrollX}px`;
  state.underlay.style.top = `${fieldRect.top + window.scrollY}px`;
  state.underlay.style.width = `${fieldRect.width}px`;
  state.underlay.style.height = `${fieldRect.height}px`;
  state.underlay.replaceChildren();

  state.markers.forEach((marker) => {
    marker.elements = [];
    const rects = Array.from(marker.range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    rects.forEach((rect) => {
      const element = document.createElement("div");
      element.className = "promptboost-mark";
      element.style.left = `${rect.left - fieldRect.left}px`;
      element.style.top = `${rect.bottom - fieldRect.top - 2}px`;
      element.style.width = `${rect.width}px`;
      element.style.borderBottomColor = issueColor(marker.issue.type);
      element.title = marker.issue.fix;
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showMarkerPopover(field, marker, element);
      });
      state.underlay.append(element);
      marker.elements.push(element);
    });
  });
}

function issueColor(type) {
  return ISSUE_COLORS[type] || "#d93025";
}

function showMarkerPopover(field, marker, anchor) {
  const state = getReviewState(field);
  closeMarkerPopover(field);

  const popover = document.createElement("div");
  popover.className = "promptboost-marker-popover";

  const fix = document.createElement("div");
  fix.className = "promptboost-marker-fix";
  fix.textContent = marker.issue.fix;
  const why = document.createElement("div");
  why.className = "promptboost-marker-why";
  why.textContent = marker.issue.why;

  const actions = document.createElement("div");
  actions.className = "promptboost-marker-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "promptboost-marker-accept";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => acceptMarkerFix(field, marker));
  const ignore = document.createElement("button");
  ignore.type = "button";
  ignore.className = "promptboost-marker-ignore";
  ignore.textContent = "Ignore";
  ignore.addEventListener("click", () => ignoreMarker(field, marker));
  actions.append(accept, ignore);

  popover.append(fix, why, actions);
  document.body.append(popover);
  state.popover = popover;

  const rect = anchor.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + window.scrollX),
    window.scrollX + window.innerWidth - popover.offsetWidth - 8
  );
  const top = Math.min(
    rect.bottom + window.scrollY + 8,
    window.scrollY + window.innerHeight - popover.offsetHeight - 8
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(8, top)}px`;
}

function acceptMarkerFix(field, marker) {
  const state = getReviewState(field);
  closeMarkerPopover(field);
  field.focus();

  state.promptboostInputDepth += 1;
  try {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(marker.range);
    document.execCommand("insertText", false, marker.issue.fix);
  } finally {
    window.setTimeout(() => {
      state.promptboostInputDepth = Math.max(0, state.promptboostInputDepth - 1);
    }, 0);
  }

  const remainingIssues = state.markers
    .filter((candidate) => candidate !== marker)
    .map((candidate) => candidate.issue);
  renderGmailUnderlines(field, remainingIssues);
  updateControl(field);
}

function ignoreMarker(field, marker) {
  const state = getReviewState(field);
  closeMarkerPopover(field);
  state.markers = state.markers.filter((candidate) => candidate !== marker);
  paintGmailMarkers(field);
}

function clearGmailMarkers(field) {
  const state = fieldReviewStates.get(field);
  if (!state) {
    return;
  }
  closeMarkerPopover(field);
  state.underlay?.remove();
  state.underlay = null;
  state.markers = [];
}

function closeMarkerPopover(field) {
  const state = fieldReviewStates.get(field);
  if (!state?.popover) {
    return;
  }
  state.popover.remove();
  state.popover = null;
}

function closeAllMarkerPopovers() {
  reviewFields.forEach((field) => closeMarkerPopover(field));
}

function repositionAllUnderlays() {
  reviewFields.forEach((field) => {
    if (!document.body.contains(field)) {
      teardownReviewState(field);
      return;
    }
    paintGmailMarkers(field);
  });
}

function cleanupDetachedReviewStates() {
  reviewFields.forEach((field) => {
    if (!document.body.contains(field)) {
      teardownReviewState(field);
    }
  });
}

function teardownReviewState(field) {
  const state = fieldReviewStates.get(field);
  if (!state) {
    reviewFields.delete(field);
    return;
  }
  window.clearTimeout(state.debounceId);
  abortGmailReview(field);
  closeMarkerPopover(field);
  state.underlay?.remove();
  reviewFields.delete(field);
  fieldReviewStates.delete(field);
}

function applyReviewText(field, target, text) {
  if (!text) {
    return;
  }
  const state = getReviewState(field);
  clearGmailMarkers(field);
  state.promptboostInputDepth += 1;
  try {
    writeTargetText(target, text);
  } finally {
    window.setTimeout(() => {
      state.promptboostInputDepth = Math.max(0, state.promptboostInputDepth - 1);
    }, 0);
  }
  lastFocusedField = field;
  closePanelForField(field);
  updateControl(field);
}

function repositionAllPanels() {
  document.querySelectorAll(".promptboost-panel").forEach((panel) => {
    const field = panelFields.get(panel);
    if (!field || !document.body.contains(field)) {
      if (field) {
        fieldPanels.delete(field);
      }
      panelFields.delete(panel);
      panel.remove();
      return;
    }
    positionPanel(field, panel);
  });
}

function positionPanel(field, panel) {
  const rect = field.getBoundingClientRect();
  const panelWidth = Math.min(420, Math.max(280, window.innerWidth - 16));
  const desiredTop = rect.bottom + window.scrollY + 8;
  const left = Math.min(
    Math.max(8, rect.right + window.scrollX - panelWidth),
    window.scrollX + window.innerWidth - panelWidth - 8
  );
  const top = Math.min(
    Math.max(8, desiredTop),
    window.scrollY + window.innerHeight - 120
  );
  panel.style.width = `${panelWidth}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.maxHeight = `${Math.max(96, window.scrollY + window.innerHeight - top - 8)}px`;
}

function closeAllPanels() {
  document.querySelectorAll(".promptboost-panel").forEach((panel) => {
    const field = panelFields.get(panel);
    if (field) {
      fieldPanels.delete(field);
    }
    panelFields.delete(panel);
    panel.remove();
  });
}

function closePanelForField(field) {
  const panel = fieldPanels.get(field);
  if (!panel) {
    return;
  }
  panelFields.delete(panel);
  fieldPanels.delete(field);
  panel.remove();
}
