const SAVE_FILES_KEY = "gif-ranker-files";
const SAVE_STATE_KEY = "gif-ranker-state";
const MAX_HISTORY = 250;
const MAX_KEEP_COUNT = 1000;
const MAX_FILES_PER_POST = 1000;

const elements = {
  gifInput: document.getElementById("gif-input"),
  topCount: document.getElementById("top-count"),
  recentPanel: document.getElementById("recent-panel"),
  recentList: document.getElementById("recent-list"),
  recentCount: document.getElementById("recent-count"),
  markAllFreshButton: document.getElementById("mark-all-fresh-button"),
  startRankingButton: document.getElementById("start-ranking-button"),
  setupMessage: document.getElementById("setup-message"),
  saveMessage: document.getElementById("save-message"),
  resumeButton: document.getElementById("resume-button"),
  clearSaveButton: document.getElementById("clear-save-button"),
  battlePanel: document.getElementById("battle-panel"),
  resultsPanel: document.getElementById("results-panel"),
  rankedCount: document.getElementById("ranked-count"),
  comparisonCount: document.getElementById("comparison-count"),
  estimatedTotal: document.getElementById("estimated-total"),
  statPrimaryLabel: document.getElementById("stat-primary-label"),
  statSecondaryLabel: document.getElementById("stat-secondary-label"),
  statTertiaryLabel: document.getElementById("stat-tertiary-label"),
  decisionHint: document.getElementById("decision-hint"),
  leftChoice: document.getElementById("left-choice"),
  rightChoice: document.getElementById("right-choice"),
  leftMedia: document.getElementById("left-media"),
  rightMedia: document.getElementById("right-media"),
  leftName: document.getElementById("left-name"),
  rightName: document.getElementById("right-name"),
  undoButton: document.getElementById("undo-button"),
  restartButton: document.getElementById("restart-button"),
  topListHeading: document.getElementById("top-list-heading"),
  cutListHeading: document.getElementById("cut-list-heading"),
  topListCopy: document.getElementById("top-list-copy"),
  topList: document.getElementById("top-list"),
  fullList: document.getElementById("full-list"),
  exportTopButton: document.getElementById("export-top-button"),
  copyTopButton: document.getElementById("copy-top-button"),
  copyAllButton: document.getElementById("copy-all-button"),
  postSize: document.getElementById("post-size"),
  postStartTime: document.getElementById("post-start-time"),
  postSpacingHours: document.getElementById("post-spacing-hours"),
  postTitleTemplate: document.getElementById("post-title-template"),
  subredditRotation: document.getElementById("subreddit-rotation"),
  postList: document.getElementById("post-list"),
  refreshPlanButton: document.getElementById("refresh-plan-button"),
  copyPlanButton: document.getElementById("copy-plan-button"),
  exportPlanButton: document.getElementById("export-plan-button")
};

const state = {
  items: [],
  itemById: new Map(),
  leaders: [],
  cuts: [],
  currentIndex: 0,
  currentItem: null,
  searchLow: 0,
  searchHigh: 0,
  probeIndex: 0,
  comparisons: 0,
  autoSkippedRecent: 0,
  history: [],
  topCount: 20,
  stage: "idle",
  recentIds: new Set(),
  persistenceAvailable: false
};

let dbPromise = null;
let saveTimer = null;

function safeTopCount(value, totalItems) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.min(20, totalItems);
  }

  return Math.min(parsed, totalItems, MAX_KEEP_COUNT);
}

function revokeAllUrls() {
  state.items.forEach((item) => URL.revokeObjectURL(item.url));
}

function setInputsLocked(isLocked) {
  elements.topCount.disabled = isLocked;
}

function resetUiForNewSession() {
  elements.battlePanel.classList.add("hidden");
  elements.resultsPanel.classList.add("hidden");
  elements.recentPanel.classList.add("hidden");
  elements.recentList.innerHTML = "";
  elements.recentCount.textContent = "0 marked";
  elements.postList.innerHTML = "";
  elements.topList.innerHTML = "";
  elements.fullList.innerHTML = "";
  elements.topListCopy.textContent = "";
}

function clearInMemoryState() {
  revokeAllUrls();
  state.items = [];
  state.itemById = new Map();
  state.leaders = [];
  state.cuts = [];
  state.currentIndex = 0;
  state.currentItem = null;
  state.searchLow = 0;
  state.searchHigh = 0;
  state.probeIndex = 0;
  state.comparisons = 0;
  state.autoSkippedRecent = 0;
  state.history = [];
  state.recentIds = new Set();
  state.stage = "idle";
  setInputsLocked(false);
}

function createItemsFromFiles(files) {
  state.items = files.map((file, index) => ({
    id: `media-${index}`,
    name: file.name,
    file,
    url: URL.createObjectURL(file),
    mediaType: getMediaType(file),
    recentlyPosted: false
  }));
  state.itemById = new Map(state.items.map((item) => [item.id, item]));
}

function createItemsFromSavedEntries(entries) {
  state.items = entries.map((entry, index) => ({
    id: entry.id || `media-${index}`,
    name: entry.name,
    file: entry.file,
    url: URL.createObjectURL(entry.file),
    mediaType: getMediaType(entry.file),
    recentlyPosted: Boolean(entry.recentlyPosted)
  }));
  state.itemById = new Map(state.items.map((item) => [item.id, item]));
  state.recentIds = new Set(state.items.filter((item) => item.recentlyPosted).map((item) => item.id));
}

function getMediaType(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(name)) {
    return "video";
  }
  return "image";
}

function isSupportedMedia(file) {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    /\.(gif|png|jpe?g|webp|avif|bmp|heic|heif|mp4|mov|m4v|webm)$/i.test(file.name)
  );
}

function getRankedOpponent() {
  if (state.stage === "cutoff") {
    return state.leaders[state.leaders.length - 1];
  }

  return state.leaders[state.probeIndex];
}

function snapshotState() {
  return {
    leaders: [...state.leaders],
    cuts: [...state.cuts],
    currentIndex: state.currentIndex,
    currentItem: state.currentItem,
    searchLow: state.searchLow,
    searchHigh: state.searchHigh,
    probeIndex: state.probeIndex,
    comparisons: state.comparisons,
    autoSkippedRecent: state.autoSkippedRecent,
    stage: state.stage
  };
}

function pushHistory() {
  state.history.push(snapshotState());
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
  }
}

function restoreFromHistory() {
  const previous = state.history.pop();
  if (!previous) {
    return;
  }

  state.leaders = [...previous.leaders];
  state.cuts = [...previous.cuts];
  state.currentIndex = previous.currentIndex;
  state.currentItem = previous.currentItem;
  state.searchLow = previous.searchLow;
  state.searchHigh = previous.searchHigh;
  state.probeIndex = previous.probeIndex;
  state.comparisons = previous.comparisons;
  state.autoSkippedRecent = previous.autoSkippedRecent || 0;
  state.stage = previous.stage;
}

function serializeState() {
  return {
    topCount: state.topCount,
    itemIds: state.items.map((item) => item.id),
    recentIds: [...state.recentIds],
    currentIndex: state.currentIndex,
    currentItemId: state.currentItem ? state.currentItem.id : null,
    searchLow: state.searchLow,
    searchHigh: state.searchHigh,
    probeIndex: state.probeIndex,
    comparisons: state.comparisons,
    autoSkippedRecent: state.autoSkippedRecent,
    stage: state.stage,
    leaderIds: state.leaders.map((item) => item.id),
    cutIds: state.cuts.map((item) => item.id),
    history: state.history.map((entry) => ({
      leaderIds: entry.leaders.map((item) => item.id),
      cutIds: entry.cuts.map((item) => item.id),
      currentIndex: entry.currentIndex,
      currentItemId: entry.currentItem ? entry.currentItem.id : null,
      searchLow: entry.searchLow,
      searchHigh: entry.searchHigh,
      probeIndex: entry.probeIndex,
      comparisons: entry.comparisons,
      autoSkippedRecent: entry.autoSkippedRecent || 0,
      stage: entry.stage
    }))
  };
}

function deserializeState(snapshot) {
  const getItem = (id) => state.itemById.get(id) || null;

  state.recentIds = new Set(snapshot.recentIds || []);
  state.items.forEach((item) => {
    item.recentlyPosted = state.recentIds.has(item.id);
  });
  if (Array.isArray(snapshot.itemIds) && snapshot.itemIds.length > 0) {
    const orderedItems = snapshot.itemIds.map(getItem).filter(Boolean);
    const missingItems = state.items.filter((item) => !snapshot.itemIds.includes(item.id));
    state.items = [...orderedItems, ...missingItems];
  }

  state.topCount = safeTopCount(snapshot.topCount, state.items.length);
  state.currentIndex = snapshot.currentIndex;
  state.currentItem = getItem(snapshot.currentItemId);
  state.searchLow = snapshot.searchLow;
  state.searchHigh = snapshot.searchHigh;
  state.probeIndex = snapshot.probeIndex;
  state.comparisons = snapshot.comparisons;
  state.autoSkippedRecent = snapshot.autoSkippedRecent || 0;
  state.stage = snapshot.stage;
  state.leaders = snapshot.leaderIds.map(getItem).filter(Boolean);
  state.cuts = snapshot.cutIds.map(getItem).filter(Boolean);
  state.history = (snapshot.history || []).map((entry) => ({
    leaders: entry.leaderIds.map(getItem).filter(Boolean),
    cuts: entry.cutIds.map(getItem).filter(Boolean),
    currentIndex: entry.currentIndex,
    currentItem: getItem(entry.currentItemId),
    searchLow: entry.searchLow,
    searchHigh: entry.searchHigh,
    probeIndex: entry.probeIndex,
    comparisons: entry.comparisons,
    autoSkippedRecent: entry.autoSkippedRecent || 0,
    stage: entry.stage
  }));
}

function setMediaPreview(container, item) {
  if (container.dataset.currentUrl === item.url && container.dataset.currentType === item.mediaType) {
    return;
  }

  container.dataset.currentUrl = item.url;
  container.dataset.currentType = item.mediaType;
  container.textContent = "";

  const media = document.createElement(item.mediaType === "video" ? "video" : "img");
  if (item.mediaType === "video") {
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.controls = false;
  } else {
    media.alt = item.name;
  }
  media.src = item.url;
  container.appendChild(media);
}

function createTextRankingItem(item, index, tagText) {
  const li = document.createElement("li");
  li.className = "ranking-item ranking-item-simple";

  const number = document.createElement("span");
  number.className = "ranking-number";
  number.textContent = String(index + 1);

  const copy = document.createElement("div");
  copy.className = "ranking-copy";

  const name = document.createElement("span");
  name.className = "ranking-name";
  name.textContent = item.name;

  const tag = document.createElement("span");
  tag.className = item.recentlyPosted ? "ranking-tag ranking-tag-recent" : "ranking-tag";
  tag.textContent = item.recentlyPosted ? `${tagText} - recent` : tagText;

  copy.append(name, tag);
  li.append(number, copy);

  return li;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function toDatetimeLocalValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function parseDatetimeLocalValue(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatPlanTime(date) {
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getSubredditRotation() {
  return elements.subredditRotation.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("r/") ? line : `r/${line.replace(/^\/?r\//i, "")}`));
}

function getPlannerSettings() {
  const postSize = clampNumber(elements.postSize.value, 20, 1, MAX_FILES_PER_POST);
  const spacingHours = clampNumber(elements.postSpacingHours.value, 12, 1, 168);
  const startTime = parseDatetimeLocalValue(elements.postStartTime.value) || new Date(Date.now() + 60 * 60 * 1000);
  const titleTemplate = elements.postTitleTemplate.value.trim() || "Ranked set #{number}";

  elements.postSize.value = postSize;
  elements.postSpacingHours.value = spacingHours;
  elements.postStartTime.value = toDatetimeLocalValue(startTime);
  elements.postTitleTemplate.value = titleTemplate;

  return {
    postSize,
    spacingHours,
    startTime,
    titleTemplate,
    subreddits: getSubredditRotation()
  };
}

function createPostGroups() {
  const settings = getPlannerSettings();
  const groups = [];

  for (let start = 0; start < state.leaders.length; start += settings.postSize) {
    const postNumber = groups.length + 1;
    const scheduledAt = new Date(settings.startTime.getTime() + (postNumber - 1) * settings.spacingHours * 60 * 60 * 1000);
    const subreddit = settings.subreddits.length > 0 ? settings.subreddits[(postNumber - 1) % settings.subreddits.length] : "Choose subreddit";
    const title = settings.titleTemplate
      .replace(/\{number\}/g, String(postNumber))
      .replace(/\{count\}/g, String(Math.min(settings.postSize, state.leaders.length - start)))
      .replace(/\{subreddit\}/g, subreddit);

    groups.push({
      number: postNumber,
      scheduledAt,
      subreddit,
      title,
      items: state.leaders.slice(start, start + settings.postSize),
      startRank: start + 1
    });
  }

  return groups;
}

function createPlanText(groups) {
  return groups.map((group) => {
    const files = group.items
      .map((item, index) => `  ${group.startRank + index}. ${item.name}`)
      .join("\n");
    return [
      `Post ${group.number}: ${group.title}`,
      `Time: ${formatPlanTime(group.scheduledAt)}`,
      `Subreddit: ${group.subreddit}`,
      "Files:",
      files
    ].join("\n");
  }).join("\n\n");
}

function renderPostPlan() {
  const groups = createPostGroups();
  elements.postList.innerHTML = "";

  groups.forEach((group) => {
    const article = document.createElement("article");
    article.className = "post-card";

    const header = document.createElement("div");
    header.className = "post-card-header";

    const title = document.createElement("h4");
    title.textContent = `Post ${group.number}`;

    const meta = document.createElement("span");
    meta.textContent = `${formatPlanTime(group.scheduledAt)} · ${group.subreddit}`;

    const heading = document.createElement("p");
    heading.className = "post-title";
    heading.textContent = group.title;

    const list = document.createElement("ol");
    list.className = "post-files";
    list.start = group.startRank;
    group.items.forEach((item) => {
      const file = document.createElement("li");
      file.textContent = item.recentlyPosted ? `${item.name} (recent)` : item.name;
      list.appendChild(file);
    });

    header.append(title, meta);
    article.append(header, heading, list);
    elements.postList.appendChild(article);
  });

  if (groups.length === 0) {
    elements.postList.textContent = "Rank a keep list first, then the planner will appear here.";
  }
}

function renderBattle() {
  const remainingCount = Math.max(state.items.length - state.currentIndex, 0);
  const rankedItem = getRankedOpponent();

  elements.statPrimaryLabel.textContent = "Shortlist";
  elements.statSecondaryLabel.textContent = "Comparisons";
  elements.statTertiaryLabel.textContent = "Remaining media";
  elements.rankedCount.textContent = `${state.leaders.length} / ${state.topCount}`;
  elements.comparisonCount.textContent = String(state.comparisons);
  elements.estimatedTotal.textContent = String(remainingCount);

  if (state.stage === "cutoff") {
    elements.decisionHint.textContent = `${state.currentItem.name} only needs to beat your current #${state.topCount} pick to enter the shortlist.`;
  } else if (state.stage === "seed") {
    elements.decisionHint.textContent = `Building your shortlist with ${state.currentItem.name}.`;
  } else {
    elements.decisionHint.textContent = `Placing ${state.currentItem.name} inside your current shortlist.`;
  }

  setMediaPreview(elements.leftMedia, state.currentItem);
  setMediaPreview(elements.rightMedia, rankedItem);
  elements.leftName.textContent = state.currentItem.recentlyPosted ? `${state.currentItem.name} (recent)` : state.currentItem.name;
  elements.rightName.textContent = rankedItem.recentlyPosted ? `${rankedItem.name} (recent)` : rankedItem.name;
  elements.undoButton.disabled = state.history.length === 0;
}

function renderResults() {
  elements.battlePanel.classList.add("hidden");
  elements.resultsPanel.classList.remove("hidden");

  elements.statPrimaryLabel.textContent = "Shortlist";
  elements.statSecondaryLabel.textContent = "Compared";
  elements.statTertiaryLabel.textContent = "Trimmed";
  elements.rankedCount.textContent = `${state.leaders.length} / ${state.topCount}`;
  elements.comparisonCount.textContent = String(state.comparisons);
  elements.estimatedTotal.textContent = String(state.cuts.length);

  elements.topListHeading.textContent = `Top ${state.topCount}`;
  elements.cutListHeading.textContent = state.cuts.length > 0 ? "Trimmed away" : "No trimmed media";
  const skippedCopy = state.autoSkippedRecent > 0 ? ` ${state.autoSkippedRecent} recent picks were skipped after the shortlist filled.` : "";
  elements.topListCopy.textContent = `${state.leaders.length} files are ready for your post, already in order.${skippedCopy}`;

  elements.topList.innerHTML = "";
  state.leaders.forEach((item, index) => {
    elements.topList.appendChild(createTextRankingItem(item, index, "Keep"));
  });

  elements.fullList.innerHTML = "";
  state.cuts.forEach((item, index) => {
    elements.fullList.appendChild(createTextRankingItem(item, index, "Cut"));
  });

  if (!elements.postStartTime.value) {
    elements.postStartTime.value = toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000));
  }
  renderPostPlan();
}

function shouldAutoCutRecentItem(item) {
  return item.recentlyPosted && state.leaders.length >= state.topCount && state.leaders.some((leader) => !leader.recentlyPosted);
}

function prepareNextStep() {
  while (state.currentIndex < state.items.length && shouldAutoCutRecentItem(state.items[state.currentIndex])) {
    state.cuts.push(state.items[state.currentIndex]);
    state.currentIndex += 1;
    state.autoSkippedRecent += 1;
  }

  if (state.currentIndex >= state.items.length) {
    state.stage = "done";
    renderResults();
    queueStateSave();
    return;
  }

  state.currentItem = state.items[state.currentIndex];

  if (state.leaders.length < state.topCount) {
    state.stage = "seed";
    state.searchLow = 0;
    state.searchHigh = state.leaders.length;
    state.probeIndex = Math.floor((state.searchLow + state.searchHigh) / 2);
  } else {
    state.stage = "cutoff";
    state.searchLow = 0;
    state.searchHigh = 0;
    state.probeIndex = state.leaders.length - 1;
  }

  elements.resultsPanel.classList.add("hidden");
  elements.battlePanel.classList.remove("hidden");
  renderBattle();
  queueStateSave();
}

function finishCurrentInsertion() {
  state.leaders.splice(state.searchLow, 0, state.currentItem);

  if (state.leaders.length > state.topCount) {
    const removed = state.leaders.pop();
    if (removed) {
      state.cuts.push(removed);
    }
  }

  state.currentIndex += 1;
  state.currentItem = null;
  prepareNextStep();
}

function beginInsertionAfterCutoffWin() {
  state.stage = "insert";
  state.searchLow = 0;
  state.searchHigh = state.leaders.length - 1;

  if (state.searchLow >= state.searchHigh) {
    finishCurrentInsertion();
    return;
  }

  state.probeIndex = Math.floor((state.searchLow + state.searchHigh) / 2);
  renderBattle();
  queueStateSave();
}

function startRanking() {
  state.items.forEach((item) => {
    item.recentlyPosted = state.recentIds.has(item.id);
  });
  state.items.sort((first, second) => {
    if (first.recentlyPosted === second.recentlyPosted) {
      return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
    }
    return first.recentlyPosted ? 1 : -1;
  });
  state.itemById = new Map(state.items.map((item) => [item.id, item]));

  state.leaders = [state.items[0]];
  state.cuts = [];
  state.currentIndex = 1;
  state.currentItem = null;
  state.searchLow = 0;
  state.searchHigh = 0;
  state.probeIndex = 0;
  state.comparisons = 0;
  state.autoSkippedRecent = 0;
  state.history = [];
  state.stage = "seed";
  setInputsLocked(true);
  prepareNextStep();
}

function handleDecision(preferCurrentItem) {
  if (!state.currentItem) {
    return;
  }

  pushHistory();
  state.comparisons += 1;

  if (state.stage === "cutoff") {
    if (preferCurrentItem) {
      beginInsertionAfterCutoffWin();
      return;
    }

    state.cuts.push(state.currentItem);
    state.currentIndex += 1;
    state.currentItem = null;
    prepareNextStep();
    return;
  }

  if (preferCurrentItem) {
    state.searchHigh = state.probeIndex;
  } else {
    state.searchLow = state.probeIndex + 1;
  }

  if (state.searchLow >= state.searchHigh) {
    finishCurrentInsertion();
    return;
  }

  state.probeIndex = Math.floor((state.searchLow + state.searchHigh) / 2);
  renderBattle();
  queueStateSave();
}

function undoLastDecision() {
  if (state.history.length === 0) {
    return;
  }

  restoreFromHistory();
  if (state.stage === "done") {
    renderResults();
  } else {
    elements.resultsPanel.classList.add("hidden");
    elements.battlePanel.classList.remove("hidden");
    renderBattle();
  }
  queueStateSave();
}

function buildListText(items) {
  return items.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function padRank(index, total) {
  const width = Math.max(2, String(total).length);
  return String(index + 1).padStart(width, "0");
}

function createOrderedExportName(item, index, total) {
  const safeName = sanitizeFilename(item.name) || `media-${index + 1}`;
  return `${padRank(index, total)}-${safeName}`;
}

function createZipEntryName(item, index, total, prefix = "") {
  const exportName = createOrderedExportName(item, index, total);
  return prefix ? `${prefix}/${exportName}` : exportName;
}

async function copyLines(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    elements.topListCopy.textContent = successMessage;
  } catch (error) {
    elements.topListCopy.textContent = "Clipboard access failed on this browser. You can still copy the list manually.";
  }
}

function updateSavedSessionButtons(hasSavedSession) {
  elements.resumeButton.classList.toggle("hidden", !hasSavedSession);
  elements.clearSaveButton.classList.toggle("hidden", !hasSavedSession);
}

function getDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open("gif-ranker-db", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("session");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

async function dbGet(key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("session", "readonly").objectStore("session").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(key, value) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("session", "readwrite");
    transaction.objectStore("session").put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function dbDelete(key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("session", "readwrite");
    transaction.objectStore("session").delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function persistFiles() {
  try {
    await dbPut(
      SAVE_FILES_KEY,
      state.items.map((item) => ({
        id: item.id,
        name: item.name,
        file: item.file,
        recentlyPosted: item.recentlyPosted
      }))
    );
    state.persistenceAvailable = true;
    elements.saveMessage.textContent = "Auto-save is on. You can refresh later and resume on this device.";
    updateSavedSessionButtons(true);
  } catch (error) {
    state.persistenceAvailable = false;
    elements.saveMessage.textContent = "This browser could not save the files for resume, but ranking still works.";
    updateSavedSessionButtons(false);
  }
}

function queueStateSave() {
  if (!state.persistenceAvailable || state.items.length === 0) {
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(async () => {
    try {
      await dbPut(SAVE_STATE_KEY, serializeState());
      updateSavedSessionButtons(true);
    } catch (error) {
      elements.saveMessage.textContent = "Saving progress stopped working in this browser, but your current session can still continue.";
    }
  }, 120);
}

async function clearSavedSession() {
  try {
    await Promise.all([dbDelete(SAVE_FILES_KEY), dbDelete(SAVE_STATE_KEY)]);
  } catch (error) {
    // Ignore failures and still reset the UI.
  }

  updateSavedSessionButtons(false);
  elements.saveMessage.textContent = "";
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) === 1 ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
    }
    table[index] = current >>> 0;
  }

  return table;
}

const crc32Table = createCrc32Table();

function crc32(data) {
  let crc = 0xffffffff;

  for (let index = 0; index < data.length; index += 1) {
    crc = crc32Table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDosParts(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosTime, dosDate };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function readBlobAsArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    if (typeof FileReader !== "function") {
      reject(new Error("This browser cannot read files for ZIP export."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsArrayBuffer(blob);
  });
}

function getErrorMessage(error) {
  if (error && error.message) {
    return error.message;
  }
  return "Unknown export error";
}

async function buildZipBlob(items) {
  const entries = items.map((item, index) => ({
    item,
    name: createZipEntryName(item, index, items.length)
  }));
  return buildZipEntriesBlob(entries);
}

async function buildZipEntriesBlob(entries) {
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosTime, dosDate } = dateToDosParts(now);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const nameBytes = encoder.encode(entry.name);
    const file = entry.file || (entry.item && entry.item.file);
    if (!file) {
      throw new Error(`Missing file for ZIP entry: ${entry.name}`);
    }
    const fileBytes = new Uint8Array(await readBlobAsArrayBuffer(file));
    const checksum = crc32(fileBytes);

    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const localView = new DataView(localHeader);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, fileBytes.length);
    writeUint32(localView, 22, fileBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    new Uint8Array(localHeader, 30).set(nameBytes);

    localParts.push(localHeader, fileBytes);

    const centralHeader = new ArrayBuffer(46 + nameBytes.length);
    const centralView = new DataView(centralHeader);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, fileBytes.length);
    writeUint32(centralView, 24, fileBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    new Uint8Array(centralHeader, 46).set(nameBytes);

    centralParts.push(centralHeader);
    localOffset += localHeader.byteLength + fileBytes.byteLength;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const endRecord = new ArrayBuffer(22);
  const endView = new DataView(endRecord);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectorySize);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

async function deliverZipBlob(blob, filename) {
  if (typeof File === "function" && navigator.share && navigator.canShare) {
    try {
      const zipFile = new File([blob], filename, { type: "application/zip" });
      if (navigator.canShare({ files: [zipFile] })) {
        await navigator.share({
          title: filename,
          files: [zipFile]
        });
        return "shared";
      }
    } catch (error) {
      // If sharing is unavailable after ZIP preparation, continue with a download.
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return "downloaded";
}

async function exportTopGifs() {
  if (state.leaders.length === 0) {
    return;
  }

  const button = elements.exportTopButton;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing ZIP...";
  elements.topListCopy.textContent = "Preparing your top media ZIP...";

  try {
    const blob = await buildZipBlob(state.leaders);
    const datePart = new Date().toISOString().slice(0, 10);
    const action = await deliverZipBlob(blob, `media-top-${state.leaders.length}-${datePart}.zip`);

    if (action === "shared") {
      elements.topListCopy.textContent = "Shared your ordered top media as a ZIP with numbered filenames.";
    } else {
      elements.topListCopy.textContent = "Downloaded your ordered top media as a ZIP with numbered filenames.";
    }
  } catch (error) {
    elements.topListCopy.textContent = `Export failed: ${getErrorMessage(error)}. Your top list text export still works.`;
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function exportGroupedPosts() {
  const groups = createPostGroups();
  if (groups.length === 0) {
    return;
  }

  const button = elements.exportPlanButton;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing ZIP...";
  elements.topListCopy.textContent = "Preparing grouped post ZIP...";

  try {
    const entries = [];
    groups.forEach((group) => {
      const folder = `post-${padRank(group.number - 1, groups.length)}-${sanitizeFilename(group.subreddit.replace("/", "-"))}`;
      group.items.forEach((item, index) => {
        entries.push({
          item,
          name: createZipEntryName(item, index, group.items.length, folder)
        });
      });
    });

    const planBlob = new Blob([createPlanText(groups)], { type: "text/plain" });
    entries.push({ file: planBlob, name: "posting-plan.txt" });

    const blob = await buildZipEntriesBlob(entries);
    const datePart = new Date().toISOString().slice(0, 10);
    const action = await deliverZipBlob(blob, `media-post-plan-${groups.length}-${datePart}.zip`);
    elements.topListCopy.textContent = action === "shared"
      ? "Shared grouped post folders and posting-plan.txt."
      : "Downloaded grouped post folders and posting-plan.txt.";
  } catch (error) {
    elements.topListCopy.textContent = `Grouped export failed: ${getErrorMessage(error)}. You can still copy the plan text.`;
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function createRecentToggle(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = item.recentlyPosted ? "recent-toggle is-recent" : "recent-toggle";
  button.dataset.itemId = item.id;
  button.setAttribute("aria-pressed", String(item.recentlyPosted));

  const thumb = document.createElement(item.mediaType === "video" ? "video" : "img");
  thumb.className = "recent-thumb";
  thumb.src = item.url;
  if (item.mediaType === "video") {
    thumb.muted = true;
    thumb.loop = true;
    thumb.autoplay = true;
    thumb.playsInline = true;
  } else {
    thumb.alt = "";
  }

  const name = document.createElement("span");
  name.textContent = item.name;
  button.append(thumb, name);
  return button;
}

function updateRecentSelectionUi() {
  state.items.forEach((item) => {
    item.recentlyPosted = state.recentIds.has(item.id);
  });

  const count = state.recentIds.size;
  elements.recentCount.textContent = `${count} marked`;
  elements.recentList.querySelectorAll(".recent-toggle").forEach((button) => {
    const isRecent = state.recentIds.has(button.dataset.itemId);
    button.classList.toggle("is-recent", isRecent);
    button.setAttribute("aria-pressed", String(isRecent));
  });
}

function renderRecentSelector() {
  elements.recentList.innerHTML = "";
  state.items.forEach((item) => {
    elements.recentList.appendChild(createRecentToggle(item));
  });
  elements.recentPanel.classList.remove("hidden");
  updateRecentSelectionUi();
}

async function loadFiles(fileList) {
  const files = Array.from(fileList).filter(isSupportedMedia);

  if (files.length < 2) {
    elements.setupMessage.textContent = "Choose at least 2 image, GIF, or short video files to start ranking.";
    resetUiForNewSession();
    return;
  }

  clearInMemoryState();
  createItemsFromFiles(files);
  state.topCount = safeTopCount(elements.topCount.value, state.items.length);
  elements.topCount.value = state.topCount;
  setInputsLocked(false);

  elements.setupMessage.textContent = `${state.items.length} files loaded. Mark recent posts, then start ranking.`;
  elements.saveMessage.textContent = "Video files are previewed and exported as originals; automatic video-to-GIF conversion is skipped in this browser version.";

  renderRecentSelector();
}

async function restoreSavedSession() {
  const filesRecord = await dbGet(SAVE_FILES_KEY);
  const snapshot = await dbGet(SAVE_STATE_KEY);

  if (!filesRecord || !snapshot) {
    elements.setupMessage.textContent = "No saved session was found anymore.";
    updateSavedSessionButtons(false);
    return;
  }

  clearInMemoryState();

  const savedEntries = filesRecord
    .map((entry) => {
      if (!entry || !(entry.file instanceof Blob)) {
        return null;
      }
      return {
        id: entry.id,
        name: entry.name,
        recentlyPosted: Boolean(entry.recentlyPosted),
        file: new File([entry.file], entry.name, { type: entry.file.type || "application/octet-stream" })
      };
    })
    .filter(Boolean);

  if (savedEntries.length < 2) {
    elements.setupMessage.textContent = "The saved session was incomplete, so it could not be restored.";
    await clearSavedSession();
    return;
  }

  createItemsFromSavedEntries(savedEntries);
  state.persistenceAvailable = true;
  deserializeState(snapshot);
  setInputsLocked(true);

  elements.topCount.value = state.topCount;
  elements.setupMessage.textContent = `Restored ${state.items.length} files and your saved progress.`;
  elements.saveMessage.textContent = "Auto-save is on for this restored session too.";
  updateSavedSessionButtons(true);

  if (state.stage === "done") {
    renderResults();
  } else {
    elements.resultsPanel.classList.add("hidden");
    elements.battlePanel.classList.remove("hidden");
    renderBattle();
  }
}

async function initSavedSessionUi() {
  try {
    const [filesRecord, snapshot] = await Promise.all([dbGet(SAVE_FILES_KEY), dbGet(SAVE_STATE_KEY)]);
    const hasSavedSession = Boolean(filesRecord && snapshot);
    updateSavedSessionButtons(hasSavedSession);

    if (hasSavedSession) {
      elements.setupMessage.textContent = "A saved session is available on this device.";
      elements.saveMessage.textContent = "You can resume where you left off or clear it and start fresh.";
    } else {
      elements.setupMessage.textContent = "Waiting for your media.";
    }
  } catch (error) {
    updateSavedSessionButtons(false);
    elements.setupMessage.textContent = "Waiting for your media.";
    elements.saveMessage.textContent = "This browser may not support saved sessions, but you can still rank your media.";
  }
}

elements.gifInput.addEventListener("change", async (event) => {
  try {
    await loadFiles(event.target.files);
  } catch (error) {
    elements.setupMessage.textContent = "Those files could not be loaded cleanly. Try selecting them again.";
  }
});
elements.recentList.addEventListener("click", (event) => {
  const button = event.target.closest(".recent-toggle");
  if (!button) {
    return;
  }

  const itemId = button.dataset.itemId;
  if (state.recentIds.has(itemId)) {
    state.recentIds.delete(itemId);
  } else {
    state.recentIds.add(itemId);
  }
  updateRecentSelectionUi();
});
elements.markAllFreshButton.addEventListener("click", () => {
  state.recentIds.clear();
  updateRecentSelectionUi();
});
elements.startRankingButton.addEventListener("click", async () => {
  if (state.items.length > 1) {
    state.topCount = safeTopCount(elements.topCount.value, state.items.length);
    elements.topCount.value = state.topCount;
    elements.recentPanel.classList.add("hidden");
    await persistFiles();
    startRanking();
  }
});
elements.leftChoice.addEventListener("click", () => handleDecision(true));
elements.rightChoice.addEventListener("click", () => handleDecision(false));
elements.undoButton.addEventListener("click", undoLastDecision);
elements.restartButton.addEventListener("click", () => {
  if (state.items.length > 1) {
    startRanking();
  }
});
elements.exportTopButton.addEventListener("click", () => {
  exportTopGifs();
});
elements.copyTopButton.addEventListener("click", () => {
  copyLines(buildListText(state.leaders), `Copied your top ${state.leaders.length} list to the clipboard.`);
});
elements.copyAllButton.addEventListener("click", () => {
  copyLines(buildListText(state.cuts), "Copied your cut list to the clipboard.");
});
elements.refreshPlanButton.addEventListener("click", renderPostPlan);
elements.copyPlanButton.addEventListener("click", () => {
  copyLines(createPlanText(createPostGroups()), "Copied your grouped posting plan to the clipboard.");
});
elements.exportPlanButton.addEventListener("click", () => {
  exportGroupedPosts();
});
[elements.postSize, elements.postStartTime, elements.postSpacingHours, elements.postTitleTemplate, elements.subredditRotation].forEach((input) => {
  input.addEventListener("change", renderPostPlan);
});
elements.resumeButton.addEventListener("click", async () => {
  try {
    await restoreSavedSession();
  } catch (error) {
    elements.setupMessage.textContent = "The saved session could not be restored cleanly. Clear it and start fresh.";
  }
});
elements.clearSaveButton.addEventListener("click", async () => {
  await clearSavedSession();
  if (state.items.length === 0) {
    elements.setupMessage.textContent = "Saved session cleared. Load media to start fresh.";
  }
});

window.addEventListener("beforeunload", () => {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  revokeAllUrls();
});

resetUiForNewSession();
initSavedSessionUi();
