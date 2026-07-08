import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Download,
  Eye,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";

const hardcodedDirectoryFallback = [
  { login: "kristina", full_name: "Кристина", role: "Руководитель", access_level: "overview", user_role: "manager" },
  { login: "anastasia", full_name: "Анастасия", role: "Технический специалист", access_level: "readonly_wb", user_role: "tech" },
];

const projectRoleLabels = {
  lead: "Руководитель проекта",
  tech: "Технический специалист",
  manager: "Менеджер",
};

const demoCards = [
  {
    title: "Плед микрофибра 200х220",
    subjectName: "покрывала и пледы",
    nmID: 18492031,
    quality: "Средняя",
    qualityClass: "amber",
    issue: "Название без ключей",
    issueCount: 1,
    status: "Нужна проверка",
    statusClass: "amber",
    photoUrl: "",
  },
  {
    title: "Комплект полотенец хлопок",
    subjectName: "полотенца",
    nmID: 19300482,
    quality: "Низкая",
    qualityClass: "red",
    issue: "Пустые характеристики",
    issueCount: 2,
    status: "Нужна проверка",
    statusClass: "amber",
    photoUrl: "",
  },
  {
    title: "Наволочка декоративная",
    subjectName: "наволочки",
    nmID: 20138477,
    quality: "Хорошая",
    qualityClass: "green",
    issue: "Нет критичных",
    issueCount: 0,
    status: "Можно оставить",
    statusClass: "green",
    photoUrl: "",
  },
];

const initialDemoPortal = {
  id: "demo-wb",
  name: "Кабинет WB",
  marketplace: "Wildberries",
  mode: "api",
  scope: "full",
  status: "API подключен",
  ownerLogin: "manager",
  cardCount: demoCards.length,
  workCount: 0,
  problemCount: demoCards.filter((card) => card.issue !== "Нет критичных").length,
  apiConnected: true,
  isActive: true,
  teamRoles: {
    lead: "manager",
    tech: "specialist",
    manager: "manager",
  },
  memberLogins: ["manager", "specialist"],
  isDemo: true,
  realCards: [],
  syncStatus: "demo",
};

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "request_failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function textOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "Не указано";
}

function safeFilePart(value) {
  return String(value || "card")
    .trim()
    .replace(/[^a-zA-Z0-9а-яА-Я_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "card";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename, rows) {
  const body = rows.map((row) => row.map(csvEscape).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function valueSummary(value) {
  if (isEmptyValue(value)) {
    return "Пусто";
  }
  if (Array.isArray(value)) {
    return `${value.length} ${pluralRu(value.length, "элемент", "элемента", "элементов")}`;
  }
  if (typeof value === "object") {
    return `${Object.keys(value).length} ${pluralRu(Object.keys(value).length, "поле", "поля", "полей")}`;
  }
  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }
  return String(value);
}

function valueCount(value) {
  if (isEmptyValue(value)) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "object") {
    return Object.keys(value).length;
  }
  return 1;
}

function tokenDaysLeftText(tokenMeta) {
  const daysLeft = tokenMeta?.daysLeft;
  if (typeof daysLeft !== "number") {
    return "";
  }
  if (tokenMeta?.status === "expired") {
    return "срок истек";
  }
  return `осталось ${daysLeft} ${pluralRu(daysLeft, "день", "дня", "дней")}`;
}

function pluralRu(value, one, few, many) {
  const number = Math.abs(Number(value) || 0);
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return many;
  }
  if (last === 1) {
    return one;
  }
  if (last >= 2 && last <= 4) {
    return few;
  }
  return many;
}

function knownRawFields(card) {
  return {
    nmID: card?.nmID,
    imtID: card?.imtID,
    nmUUID: card?.nmUUID,
    vendorCode: card?.vendorCode,
    subjectID: card?.subjectID,
    subjectName: card?.subjectName,
    brand: card?.brand,
    title: card?.title,
    description: card?.description,
    photos: card?.photos,
    video: card?.video,
    dimensions: card?.dimensions,
    characteristics: card?.characteristics,
    sizes: card?.sizes,
    tags: card?.tags,
    createdAt: card?.createdAt,
    updatedAt: card?.updatedAt,
  };
}

function rawFieldsForCard(card) {
  return {
    ...knownRawFields(card),
    ...(card?.rawFields || {}),
  };
}

const fieldLabels = {
  nmID: "nmID",
  imtID: "imtID",
  nmUUID: "nmUUID",
  vendorCode: "Артикул продавца",
  subjectID: "ID категории",
  subjectName: "Категория",
  brand: "Бренд",
  title: "Название",
  description: "Описание",
  photos: "Фото",
  video: "Видео",
  dimensions: "Габариты",
  characteristics: "Характеристики",
  sizes: "Размеры",
  tags: "Теги",
  createdAt: "Создано",
  updatedAt: "Обновлено",
};

const preferredFieldOrder = [
  "nmID",
  "imtID",
  "nmUUID",
  "vendorCode",
  "subjectID",
  "subjectName",
  "brand",
  "title",
  "description",
  "characteristics",
  "dimensions",
  "sizes",
  "photos",
  "video",
  "tags",
  "createdAt",
  "updatedAt",
];

function orderedFieldEntries(fields) {
  const source = fields && typeof fields === "object" ? fields : {};
  const used = new Set();
  const ordered = [];
  preferredFieldOrder.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      ordered.push([key, source[key]]);
      used.add(key);
    }
  });
  Object.keys(source)
    .filter((key) => !used.has(key))
    .sort((left, right) => left.localeCompare(right, "ru"))
    .forEach((key) => ordered.push([key, source[key]]));
  return ordered;
}

function fieldLabel(key) {
  return fieldLabels[key] || key;
}

function isKnownField(key) {
  return Boolean(fieldLabels[key]);
}

function isPrimitiveDisplayValue(value) {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function initials(name) {
  return String(name || "WB")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function uniqueLogins(logins) {
  return [...new Set(logins.filter(Boolean))];
}

function getUserRoleType(user) {
  const marker = `${user?.user_role || ""} ${user?.access_level || ""} ${user?.role || ""}`.toLowerCase();
  if (marker.includes("admin") || marker.includes("all") || marker.includes("полный") || marker.includes("админ")) {
    return "admin";
  }
  if (marker.includes("tech") || marker.includes("readonly") || marker.includes("карточ") || marker.includes("тех") || marker.includes("спец")) {
    return "tech";
  }
  if (marker.includes("manager") || marker.includes("руковод") || marker.includes("менедж")) {
    return "manager";
  }
  return "manager";
}

function userCanFillProjectRole(user, projectRole) {
  const roleType = getUserRoleType(user);
  if (projectRole === "tech") {
    return roleType === "tech" || roleType === "admin";
  }
  return roleType === "manager" || roleType === "admin";
}

function normalizePortal(portal) {
  const teamRoles = portal.teamRoles || {
    lead: portal.ownerLogin || "manager",
    tech: "specialist",
    manager: "manager",
  };
  return {
    ...portal,
    apiConnected: Boolean(portal.apiConnected),
    isActive: portal.isActive !== false,
    status: portal.mode === "api" && !portal.apiConnected ? "API ожидает подключения" : portal.status,
    ownerLogin: teamRoles.lead || portal.ownerLogin,
    teamRoles,
    memberLogins: uniqueLogins(portal.memberLogins?.length
      ? portal.memberLogins
      : [teamRoles.lead, teamRoles.tech, teamRoles.manager]),
    realCards: portal.realCards || [],
    tokenMeta: portal.tokenMeta || {},
  };
}

function normalizeUserList(rawUsers) {
  if (!Array.isArray(rawUsers)) {
    return [];
  }
  return rawUsers
    .filter((item) => item?.login)
    .map((item) => ({
      login: item.login,
      full_name: item.full_name,
      role: item.role,
      access_level: item.access_level,
      user_role: item.user_role || item.access_level || "manager",
    }));
}

function defaultTeamFromUsers(displayUsers) {
  const users = displayUsers.length ? displayUsers : hardcodedDirectoryFallback;
  const lead = users.find((user) => userCanFillProjectRole(user, "lead")) || users[0];
  const tech = users.find((user) => userCanFillProjectRole(user, "tech")) || users[0];
  const manager = users.find((user) => userCanFillProjectRole(user, "manager")) || lead;
  return {
    lead: lead?.login || "manager",
    tech: tech?.login || "specialist",
    manager: manager?.login || lead?.login || "manager",
  };
}

function applyWbSnapshotToPortal(portal, payload) {
  const stats = payload.stats || {};
  return normalizePortal({
    ...portal,
    name: stats.portalName || portal.name,
    status: "WB read-only",
    apiConnected: true,
    cardCount: stats.cardCount || 0,
    workCount: 0,
    problemCount: stats.problemCount || 0,
    realCards: payload.cards || [],
    lastSyncAt: stats.loadedAt || "",
    tokenMeta: payload.tokenMeta || portal.tokenMeta || {},
    syncStatus: "loaded",
  });
}

function getPortalTeam(portal) {
  const roles = portal?.teamRoles || {};
  return {
    lead: roles.lead || portal?.ownerLogin || "manager",
    tech: roles.tech || "specialist",
    manager: roles.manager || "manager",
  };
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function bestPhotoUrl(card) {
  const photos = Array.isArray(card?.photos) ? card.photos : [];
  const preferredKeys = ["big", "c516x688", "c246x328", "square", "tm"];
  for (const photo of photos) {
    if (!photo || typeof photo !== "object") {
      continue;
    }
    for (const key of preferredKeys) {
      const url = safeHttpsUrl(photo[key]);
      if (url) {
        return url;
      }
    }
    const fallback = Object.values(photo).find((value) => safeHttpsUrl(value));
    if (fallback) {
      return safeHttpsUrl(fallback);
    }
  }
  return safeHttpsUrl(card?.photoUrl);
}

function wbCardUrl(card) {
  if (!card?.nmID) {
    return "https://www.wildberries.ru/";
  }
  return `https://www.wildberries.ru/catalog/${encodeURIComponent(card.nmID)}/detail.aspx?targetUrl=MI`;
}

function issueCopy(issue) {
  const copies = {
    "Нет бренда": "WB API не вернул бренд. Нужно проверить бренд в кабинете и не подставлять его вручную без подтверждения.",
    "Нет описания": "В текущем снимке нет описания. Перед правками нужно подтянуть описание или заполнить его вручную.",
    "Пустые характеристики": "WB API не вернул характеристики. Нужно сверить обязательные поля категории перед публикацией.",
    "Нет фото": "В текущем снимке нет фото. Нужно проверить медиа в кабинете WB перед аудитом.",
    "Нет названия": "У карточки нет названия. Нужно заполнить заголовок до 60 символов.",
    "Название длиннее 60": "Название превышает лимит WB. Нужно сократить его до 60 символов без потери смысла.",
    "Габариты требуют проверки": "WB пометил габариты как требующие проверки. Перед публикацией нужно сверить размеры.",
  };
  return copies[issue] || "Карточка требует ручной проверки по данным из WB API.";
}

function titleSuggestions(card) {
  const title = textOrDash(card?.title);
  const subject = String(card?.subjectName || "").trim();
  const brand = String(card?.brand || "").trim();
  const base = title === "Не указано" ? (subject || "Карточка WB") : title;
  const values = [
    base,
    subject && !base.toLowerCase().includes(subject.toLowerCase().slice(0, -1)) ? `${subject} ${base}` : "",
    brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} ${brand}` : "",
  ].filter(Boolean);
  const unique = [...new Set(values.map((value) => value.slice(0, 60)))];
  while (unique.length < 3) {
    unique.push(base.slice(0, 60));
  }
  return unique.slice(0, 3);
}

function descriptionSuggestion(card, description) {
  const current = String(description || "").trim();
  if (current) {
    return current;
  }
  const subject = String(card?.subjectName || "").trim();
  const brand = String(card?.brand || "").trim();
  const title = textOrDash(card?.title);
  return [title, brand, subject]
    .filter((value, index, list) => value && value !== "Не указано" && list.indexOf(value) === index)
    .join(". ");
}

function characteristicRows(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      return {
        key: `characteristic-${index}`,
        label: `Характеристика ${index + 1}`,
        value: item,
        charcID: null,
      };
    }
    const label = item.name || item.charcName || item.id || item.charcID || `Характеристика ${index + 1}`;
    const value = Object.prototype.hasOwnProperty.call(item, "value") ? item.value : (item.values ?? item);
    const charcID = item.charcID || item.id || null;
    return {
      key: charcID ? `charc:${charcID}` : `${label}-${index}`,
      label,
      value,
      charcID,
    };
  });
}

function editableCharacteristicValue(value) {
  if (isEmptyValue(value)) {
    return "";
  }
  if (Array.isArray(value) && value.every(isPrimitiveDisplayValue)) {
    return value.filter((item) => !isEmptyValue(item)).map(String).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function characteristicValueTokens(value) {
  if (isEmptyValue(value)) {
    return [];
  }
  if (Array.isArray(value)) {
    if (value.every(isPrimitiveDisplayValue)) {
      return value.filter((item) => !isEmptyValue(item)).map((item) => String(item).trim()).filter(Boolean);
    }
    return value
      .map((item) => {
        if (isPrimitiveDisplayValue(item)) return String(item).trim();
        if (item && typeof item === "object") return String(item.value || item.name || item.charcName || "").trim();
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return [editableCharacteristicValue(value)].filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function draftCharacteristicValues(draft) {
  if (!draft) {
    return [];
  }
  if (Array.isArray(draft.values)) {
    return draft.values.map((item) => String(item).trim()).filter(Boolean);
  }
  return characteristicValueTokens(draft.value);
}

function characteristicDraftsFromRows(rows, source = "audit") {
  return Object.fromEntries(rows.map((row) => [row.key, {
    charcID: row.charcID,
    label: row.label,
    value: editableCharacteristicValue(row.value),
    values: characteristicValueTokens(row.value),
    source,
  }]));
}

function normalizeDraftCharacteristics(drafts) {
  return Object.fromEntries(Object.entries(drafts || {}).map(([key, draft]) => [key, {
    ...draft,
    values: draftCharacteristicValues(draft),
  }]));
}

function characteristicKeyFromMeta(item) {
  return item?.charcID ? `charc:${item.charcID}` : `charc-name:${String(item?.name || "").toLowerCase()}`;
}

function normalizeCharacteristicMeta(item) {
  return {
    charcID: item?.charcID || null,
    label: item?.name || "Характеристика",
    value: "",
    values: [],
    source: "manual",
    required: Boolean(item?.required),
    popular: Boolean(item?.popular),
    hasFilter: Boolean(item?.hasFilter),
    unitName: item?.unitName || "",
    maxCount: item?.maxCount,
    charcType: item?.charcType,
    strictValues: Boolean(item?.strictValues),
    valueMode: item?.valueMode || "free",
  };
}

function characteristicValueLimit(meta) {
  if (Number(meta?.charcType) === 4) {
    return 1;
  }
  const maxCount = Number(meta?.maxCount || 0);
  return maxCount > 0 ? maxCount : null;
}

function characteristicLimitText(meta, filledCount) {
  const limit = characteristicValueLimit(meta);
  if (limit) {
    return `${filledCount} из ${limit}`;
  }
  if (Number(meta?.charcType) === 1 && Number(meta?.maxCount || 0) === 0) {
    return `${filledCount} заполнено`;
  }
  return filledCount ? `${filledCount} заполнено` : "не заполнено";
}

function draftCharacteristicsList(drafts) {
  return Object.values(drafts || {})
    .filter((item) => item?.label)
    .map((item) => ({
      charcID: item.charcID || "",
      name: item.label,
      value: draftCharacteristicValues(item).join(", "),
      unitName: item.unitName || "",
    }));
}

function normalizedCharacteristicOption(value) {
  return String(value || "").trim().toLowerCase().replaceAll("ё", "е");
}

function uniqueCharacteristicOptions(values) {
  const byNormalizedValue = new Map();
  values.map((value) => String(value).trim()).filter(Boolean).forEach((value) => {
    const key = normalizedCharacteristicOption(value);
    if (!byNormalizedValue.has(key) || value[0] === value[0]?.toUpperCase()) {
      byNormalizedValue.set(key, value);
    }
  });
  return [...byNormalizedValue.values()].sort((left, right) => left.localeCompare(right, "ru"));
}

function fallbackCharacteristicValueOptions(label) {
  const normalizedLabel = normalizedCharacteristicOption(label);
  const words = normalizedLabel.replaceAll("/", " ").replaceAll("-", " ").split(/\s+/);
  if (words.includes("пол") || normalizedLabel.includes("гендер")) {
    return ["Женский", "Мужской", "Детский", "Унисекс"];
  }
  if (normalizedLabel.includes("сезон")) {
    return ["Весна", "Лето", "Осень", "Зима", "Демисезон"];
  }
  return [];
}

function strictCharacteristicByLabel(label) {
  const normalizedLabel = normalizedCharacteristicOption(label);
  const words = normalizedLabel.replaceAll("/", " ").replaceAll("-", " ").split(/\s+/);
  return (
    words.includes("пол")
    || normalizedLabel.includes("гендер")
    || normalizedLabel.includes("цвет")
    || normalizedLabel.includes("страна производства")
    || normalizedLabel.includes("страна изготов")
    || normalizedLabel.includes("сезон")
    || normalizedLabel.includes("ндс")
    || normalizedLabel.includes("тнвэд")
    || normalizedLabel.includes("тн вэд")
  );
}

function characteristicUsesStrictValues(meta) {
  return Boolean(meta?.strictValues || meta?.valueMode === "directory" || strictCharacteristicByLabel(meta?.name || meta?.label || ""));
}

function characteristicValueOptionsByKey(portal, currentRows, availableCharacteristics = []) {
  const options = {};
  const metaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  currentRows.forEach((row) => {
    const meta = metaByKey[row.key] || {};
    const wbOptions = Array.isArray(meta.valueOptions) ? meta.valueOptions : [];
    options[row.key] = [...characteristicValueTokens(row.value), ...wbOptions, ...fallbackCharacteristicValueOptions(row.label)];
  });
  (portal?.realCards || []).forEach((item) => {
    characteristicRows(item?.characteristics || item?.rawFields?.characteristics || []).forEach((row) => {
      const current = options[row.key] || [];
      options[row.key] = [...current, ...characteristicValueTokens(row.value)];
    });
  });
  availableCharacteristics.forEach((item) => {
    const key = characteristicKeyFromMeta(item);
    const current = options[key] || [];
    const wbOptions = Array.isArray(item.valueOptions) ? item.valueOptions : [];
    options[key] = [...current, ...wbOptions, ...fallbackCharacteristicValueOptions(item.name)];
  });
  return Object.fromEntries(Object.entries(options).map(([key, values]) => [
    key,
    uniqueCharacteristicOptions(values),
  ]));
}

function buildContentExportRows(card, draftTitle, draftDescription, draftCharacteristics) {
  const rows = [
    ["nmID", "Артикул продавца", "Название", "Описание", "Характеристика", "charcID", "Значение"],
  ];
  const characteristics = draftCharacteristicsList(draftCharacteristics);
  if (!characteristics.length) {
    rows.push([
      card?.nmID || "",
      card?.vendorCode || "",
      draftTitle || "",
      draftDescription || "",
      "",
      "",
      "",
    ]);
    return rows;
  }
  characteristics.forEach((item) => {
    rows.push([
      card?.nmID || "",
      card?.vendorCode || "",
      draftTitle || "",
      draftDescription || "",
      item.name,
      item.charcID,
      item.value,
    ]);
  });
  return rows;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
}

function buildPricesExportRows(card) {
  return [
    ["nmID", "Артикул продавца", "Цена", "Скидка", "Цена со скидкой"],
    [
      card?.nmID || "",
      card?.vendorCode || "",
      firstDefined(card?.price, card?.rawFields?.price),
      firstDefined(card?.discount, card?.rawFields?.discount),
      firstDefined(card?.discountedPrice, card?.rawFields?.discountedPrice),
    ],
  ];
}

function buildStocksExportRows(card) {
  const rows = [["nmID", "Артикул продавца", "Размер", "Баркод/SKU", "Склад", "Остаток"]];
  const sizes = Array.isArray(card?.sizes) ? card.sizes : [];
  if (!sizes.length) {
    rows.push([card?.nmID || "", card?.vendorCode || "", "", "", "", ""]);
    return rows;
  }
  sizes.forEach((size) => {
    const skus = Array.isArray(size?.skus) && size.skus.length ? size.skus : [""];
    skus.forEach((sku) => {
      rows.push([
        card?.nmID || "",
        card?.vendorCode || "",
        size?.techSize || size?.wbSize || size?.chrtID || "",
        sku,
        "",
        "",
      ]);
    });
  });
  return rows;
}

function Tag({ children, tone = "amber" }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

function IconButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button className="icon-btn" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon size={17} />
    </button>
  );
}

export default function App() {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [userPortals, setUserPortals] = useState([]);
  const [demoPortal, setDemoPortal] = useState(initialDemoPortal);
  const [demoPortalArchived, setDemoPortalArchived] = useState(() => localStorage.getItem("opticards-demo-archived") === "1");
  const [screen, setScreen] = useState("cabinets");
  const [portalStatusFilter, setPortalStatusFilter] = useState("active");
  const [selectedPortalId, setSelectedPortalId] = useState("demo-wb");
  const [selectedCard, setSelectedCard] = useState(demoCards[0]);
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portalModalMode, setPortalModalMode] = useState("api");
  const [notice, setNotice] = useState("");

  const displayUsers = users.length ? users : hardcodedDirectoryFallback;
  const canManagePortals = currentUser ? ["admin", "manager"].includes(getUserRoleType(currentUser)) : false;
  const activeDemoPortal = { ...demoPortal, isActive: !demoPortalArchived };
  const allPortals = [activeDemoPortal, ...userPortals];
  const activePortals = allPortals.filter((portal) => portal.isActive !== false);

  const currentPortal = useMemo(() => {
    if (selectedPortalId === "demo-wb") {
      return activeDemoPortal;
    }
    return userPortals.find((portal) => String(portal.id) === String(selectedPortalId)) || activeDemoPortal;
  }, [activeDemoPortal, selectedPortalId, userPortals]);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const payload = await apiRequest("/api/session");
      if (payload.user) {
        await enterApp(payload.user);
      }
    } finally {
      setSessionLoading(false);
    }
  }

  async function enterApp(user) {
    setCurrentUser(user);
    await loadAppData(user);
    setScreen("cabinets");
  }

  async function loadAppData(user) {
    let nextUsers = [];
    try {
      const payload = await apiRequest("/api/users");
      nextUsers = normalizeUserList(payload.users || []);
    } catch {
      nextUsers = [];
    }
    const teamRoles = defaultTeamFromUsers(nextUsers.length ? nextUsers : [user, ...hardcodedDirectoryFallback]);
    setUsers(nextUsers);
    setDemoPortal((portal) => ({
      ...portal,
      ownerLogin: teamRoles.lead,
      teamRoles,
      memberLogins: uniqueLogins(Object.values(teamRoles)),
    }));

    try {
      const payload = await apiRequest("/api/portals");
      setUserPortals((payload.portals || []).map(normalizePortal));
    } catch {
      setUserPortals([]);
    }

    await loadWbDemoSnapshot();
  }

  async function loadWbDemoSnapshot() {
    try {
      const payload = await apiRequest("/api/wb/cards?portal_id=demo-wb&limit=100");
      setDemoPortal((portal) => applyWbSnapshotToPortal(portal, payload));
    } catch (error) {
      setDemoPortal((portal) => ({
        ...portal,
        apiConnected: false,
        status: error.message === "wb_token_missing" ? "API ожидает токен" : "WB API недоступен",
        cardCount: demoCards.length,
        workCount: 0,
        problemCount: demoCards.filter((card) => card.issue !== "Нет критичных").length,
        syncStatus: error.message === "wb_token_missing" ? "missing-token" : "error",
      }));
    }
  }

  async function login(login, password, remember) {
    const payload = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ login, password, remember }),
    });
    await enterApp(payload.user);
  }

  async function logout() {
    try {
      await apiRequest("/api/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // The local UI should still return to the login screen.
    }
    setCurrentUser(null);
    setScreen("cabinets");
    setSelectedPortalId("demo-wb");
  }

  function findUser(login) {
    return displayUsers.find((item) => item.login === login) || currentUser || displayUsers[0] || hardcodedDirectoryFallback[0];
  }

  function portalMatchesFilter(portal) {
    if (portalStatusFilter === "all") {
      return true;
    }
    const isActive = portal.isActive !== false;
    return portalStatusFilter === "active" ? isActive : !isActive;
  }

  function visiblePortals() {
    return allPortals.filter(portalMatchesFilter);
  }

  function replaceUserPortal(portal) {
    setUserPortals((items) => {
      const normalized = normalizePortal(portal);
      const index = items.findIndex((item) => String(item.id) === String(normalized.id));
      if (index < 0) {
        return [...items, normalized];
      }
      return items.map((item, itemIndex) => (itemIndex === index ? normalized : item));
    });
  }

  async function setPortalActive(portal, isActive) {
    if (!canManagePortals || !portal) {
      return;
    }
    if (portal.isDemo) {
      localStorage.setItem("opticards-demo-archived", isActive ? "0" : "1");
      setDemoPortalArchived(!isActive);
      if (!isActive && selectedPortalId === "demo-wb") {
        setScreen("cabinets");
      }
      return;
    }

    try {
      const action = isActive ? "restore" : "archive";
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      if (!isActive && String(selectedPortalId) === String(portal.id)) {
        setScreen("cabinets");
      }
    } catch {
      setNotice("Не удалось изменить статус кабинета. Попробуйте повторить позже.");
    }
  }

  async function showSeller(portal) {
    if (!portal || portal.isActive === false) {
      return;
    }
    setSelectedPortalId(portal.id);
    setScreen("seller");
    await loadPortalCards(portal);
  }

  async function loadPortalCards(portal) {
    if (!portal || portal.isDemo || !portal.apiConnected || portal.realCards?.length) {
      return;
    }
    try {
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(portal, payload);
      replaceUserPortal(updatedPortal);
    } catch {
      replaceUserPortal({ ...portal, syncStatus: "error" });
    }
  }

  function cardsForPortal(portal) {
    return portal.realCards?.length ? portal.realCards : (portal.isDemo ? demoCards : []);
  }

  function openCard(card) {
    setSelectedCard(card);
    setScreen("card");
  }

  async function createPortal(payload) {
    const response = await apiRequest("/api/portals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const portal = normalizePortal(response.portal);
    setUserPortals((items) => [...items, portal]);
    setPortalModalOpen(false);
    setSelectedPortalId(portal.id);
    setScreen("seller");
  }

  async function updatePortalTeam(portal, teamRoles) {
    if (portal.isDemo) {
      setDemoPortal((item) => ({
        ...item,
        ownerLogin: teamRoles.lead,
        teamRoles,
        memberLogins: uniqueLogins(Object.values(teamRoles)),
      }));
      return;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/team`, {
        method: "POST",
        body: JSON.stringify({ teamRoles }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
    } catch {
      setNotice("Не удалось сохранить состав проекта на backend.");
    }
  }

  if (sessionLoading) {
    return (
      <div className="loading-screen">
        <div className="brand-mark">WO</div>
        <strong>OptiCards</strong>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <Rail
        user={currentUser}
        screen={screen}
        onNavigate={setScreen}
        onLogout={logout}
      />
      <main className="main">
        {notice ? (
          <div className="notice">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}><X size={16} /></button>
          </div>
        ) : null}

        {screen === "cabinets" ? (
          <CabinetsScreen
            portals={visiblePortals()}
            activePortals={activePortals}
            statusFilter={portalStatusFilter}
            onStatusFilter={setPortalStatusFilter}
            canManage={canManagePortals}
            findUser={findUser}
            onOpen={showSeller}
            onArchive={(portal) => setPortalActive(portal, false)}
            onRestore={(portal) => setPortalActive(portal, true)}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalOpen(true);
            }}
          />
        ) : null}

        {screen === "seller" ? (
          <SellerScreen
            portal={currentPortal}
            cards={cardsForPortal(currentPortal)}
            displayUsers={displayUsers}
            findUser={findUser}
            canManage={canManagePortals}
            onBack={() => setScreen("cabinets")}
            onOpenCard={openCard}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalOpen(true);
            }}
            onUpdateTeam={(teamRoles) => updatePortalTeam(currentPortal, teamRoles)}
          />
        ) : null}

        {screen === "card" ? (
          <CardDetailScreen
            key={selectedCard?.nmID || selectedCard?.vendorCode || selectedCard?.title}
            card={selectedCard}
            portal={currentPortal}
            onBack={() => setScreen("seller")}
          />
        ) : null}

        {screen === "audit" ? <PlaceholderScreen title="Аудит" copy="MPStats и полноценный аудит подключим отдельным этапом. Сейчас активна загрузка данных WB и ручная проверка карточек." /> : null}
        {screen === "settings" ? <SettingsScreen users={displayUsers} /> : null}
      </main>

      {portalModalOpen ? (
        <PortalModal
          mode={portalModalMode}
          users={displayUsers}
          onMode={setPortalModalMode}
          onClose={() => setPortalModalOpen(false)}
          onSubmit={createPortal}
        />
      ) : null}
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onLogin(login.trim(), password, remember);
      setPassword("");
    } catch {
      setError("Логин или пароль не совпали.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="login-screen">
      <div className="login-hero">
        <div className="login-brand">
          <div className="brand-mark">WO</div>
          <div>
            <strong>WebOptimize</strong>
            <span>OptiCards</span>
          </div>
        </div>
        <div className="login-copy">
          <h1>OptiCards</h1>
          <p>Рабочее пространство для ведения кабинетов, проверки карточек WB и безопасного подключения API.</p>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div>
          <h2>Авторизация</h2>
          <p>Войдите в рабочий кабинет.</p>
        </div>
        <label className="field-label">
          Логин
          <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
        </label>
        <label className="field-label">
          Пароль
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>Запомнить меня на этом устройстве</span>
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? "Входим..." : "Войти"}
        </button>
      </form>
    </section>
  );
}

function Rail({ user, screen, onNavigate, onLogout }) {
  const nav = [
    { key: "cabinets", label: "Кабинеты", Icon: LayoutDashboard },
    { key: "audit", label: "Аудит", Icon: ClipboardList, disabled: true, status: "скоро" },
    { key: "settings", label: "Настройки", Icon: Settings },
  ];
  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="brand-mark">WO</div>
        <div>
          <strong>OptiCards</strong>
          <span>React</span>
        </div>
      </div>
      <nav className="nav">
        {nav.map(({ key, label, Icon, disabled, status }) => (
          <button
            key={key}
            className={screen === key ? "active" : ""}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                onNavigate(key);
              }
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
            {status ? <span className="nav-status">{status}</span> : null}
          </button>
        ))}
      </nav>
      <div className="rail-user">
        <div className="avatar">{initials(user.full_name)}</div>
        <div>
          <strong>{user.full_name}</strong>
          <span>{user.role}</span>
        </div>
      </div>
      <button className="btn ghost rail-logout" type="button" onClick={onLogout}>
        <LogOut size={17} />
        Выйти
      </button>
    </aside>
  );
}

function CabinetsScreen({ portals, activePortals, statusFilter, onStatusFilter, canManage, findUser, onOpen, onArchive, onRestore, onOpenModal }) {
  const apiCount = activePortals.filter((portal) => portal.apiConnected).length;
  const cardsCount = activePortals.reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>Кабинеты</h1>
          <p>Активные рабочие кабинеты и подключенные источники данных.</p>
        </div>
        <button className="btn primary" type="button" onClick={() => onOpenModal("api")}>
          <Plus size={17} />
          Добавить кабинет
        </button>
      </header>

      <div className="content">
        <div className="summary-grid">
          <Metric label="Активные кабинеты" value={formatNumber(activePortals.length)} />
          <Metric label="Карточки загружены" value={formatNumber(cardsCount)} />
          <Metric label="Подключены через API" value={formatNumber(apiCount)} />
          <Metric label="Ручные порталы" value={formatNumber(activePortals.length - apiCount)} />
        </div>

        <div className="band">
          <div className="filters">
            <label className="search-field">
              <Search size={16} />
              <input type="search" placeholder="Поиск по клиенту, бренду, артикулу" />
            </label>
            <select className="select" aria-label="Маркетплейс">
              <option>Все маркетплейсы</option>
              <option>Wildberries</option>
            </select>
            <select className="select" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)} aria-label="Статус кабинета">
              <option value="active">Активные</option>
              <option value="inactive">Неактивные</option>
              <option value="all">Все кабинеты</option>
            </select>
          </div>
        </div>

        <div className="workspace-grid">
          {portals.map((portal) => (
            <PortalCard
              key={portal.id}
              portal={portal}
              owner={findUser(portal.ownerLogin)}
              findUser={findUser}
              canManage={canManage}
              onOpen={() => onOpen(portal)}
              onArchive={() => onArchive(portal)}
              onRestore={() => onRestore(portal)}
            />
          ))}
          {statusFilter !== "inactive" ? (
            <article className="workspace-card add-card">
              <div className="seller-logo">+</div>
              <h2>Добавить кабинет</h2>
              <p>Подключить Wildberries через API или начать вручную с таблицами и списками карточек.</p>
              <button className="btn primary" type="button" onClick={() => onOpenModal("api")}>
                <Plus size={17} />
                Добавить
              </button>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PortalCard({ portal, owner, findUser, canManage, onOpen, onArchive, onRestore }) {
  const inactive = portal.isActive === false;
  return (
    <article className={`workspace-card ${inactive ? "inactive" : ""}`}>
      <div className="card-head">
        <div className="seller">
          <div className="seller-logo">{initials(portal.name || "WB")}</div>
          <div>
            <h2>{portal.name}</h2>
            <p>{portal.marketplace} · {owner?.full_name || "ответственный не указан"}</p>
          </div>
        </div>
        <Tag tone={inactive ? "amber" : (portal.apiConnected ? "blue" : "amber")}>{inactive ? "Неактивен" : portal.status}</Tag>
      </div>
      <div className="scope-row">
        <span>Охват</span>
        <strong>{portal.scope === "selected" ? "Выбранные карточки" : "Полный магазин"}</strong>
      </div>
      <div className="card-stats">
        <MiniStat value={portal.cardCount} label="карточки" />
        <MiniStat value={portal.problemCount} label="к проверке" />
        <MiniStat value={portal.apiConnected ? 1 : 0} label="API" />
      </div>
      <TeamSummary portal={portal} findUser={findUser} fallbackOwner={owner} />
      <div className="card-actions">
        <Tag tone={inactive ? "amber" : (portal.apiConnected ? "blue" : "amber")}>
          {inactive ? "В архиве" : (portal.apiConnected ? "API подключен" : "Ручной режим")}
        </Tag>
        <div className="portal-actions">
          {inactive ? (
            canManage ? <button className="btn primary" type="button" onClick={onRestore}><RotateCcw size={16} />Вернуть</button> : null
          ) : (
            <>
              {canManage ? <button className="btn" type="button" onClick={onArchive}><Archive size={16} />В архив</button> : null}
              <button className="btn primary" type="button" onClick={onOpen}>Открыть</button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function SellerScreen({ portal, cards, displayUsers, findUser, canManage = false, onBack, onOpenCard, onOpenModal, onUpdateTeam }) {
  const owner = findUser(portal.ownerLogin);
  const isApi = portal.mode === "api";
  const scopeLabel = portal.scope === "selected" ? "выбранные карточки" : "полный магазин";
  const sourceRows = sourceFlowRows(portal);
  const workRoute = workRouteRows(portal);
  const team = getPortalTeam(portal);
  const [teamEditing, setTeamEditing] = useState(false);
  const [teamDraft, setTeamDraft] = useState(team);

  useEffect(() => {
    if (!teamEditing) {
      setTeamDraft(team);
    }
  }, [portal.id, team.lead, team.tech, team.manager, teamEditing]);

  function updateTeamDraft(roleKey, login) {
    setTeamDraft((current) => ({ ...current, [roleKey]: login }));
  }

  function saveTeamDraft() {
    onUpdateTeam(teamDraft);
    setTeamEditing(false);
  }

  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>{portal.name}</h1>
          <p>{portal.marketplace} · {scopeLabel} · {portal.syncStatus === "loaded" ? "read-only WB API" : (isApi ? "API подключение" : "ручной режим")} · ответственный {owner?.full_name}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={onBack}><ArrowLeft size={17} />Кабинеты</button>
          <button className="btn" type="button" onClick={() => onOpenModal("api")}><Upload size={17} />Подключить API</button>
          <button className="btn primary" type="button" disabled title="Черновики и задачи включим после настройки хранения"><Plus size={17} />Создать задачу</button>
        </div>
      </header>

      <div className="content">
        <div className="seller-layout">
          <div className="seller-main">
            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Обзор кабинета</h2>
                  <p>Фактическое состояние подключенного источника и карточек.</p>
                </div>
                <Tag tone={portal.apiConnected ? "blue" : "amber"}>{portal.apiConnected ? "API подключен" : "API ожидает"}</Tag>
              </div>
              <div className="summary-grid">
                <Metric label="Карточек в кабинете" value={formatNumber(portal.cardCount)} />
                <Metric label="К проверке" value={formatNumber(portal.problemCount)} />
                <Metric label="Черновики правок" value="0" />
                <Metric label="Участников проекта" value={formatNumber(uniqueLogins(Object.values(team)).length)} />
              </div>
            </section>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Источник данных</h2>
                  <p>{portal.syncStatus === "loaded"
                    ? "Список карточек загружен из WB API через backend. Создание, обновление, удаление и публикация изменений отключены."
                    : "Кабинет подключается только для чтения данных. Запись в WB отключена."}</p>
                </div>
                <Tag tone={portal.apiConnected ? "blue" : "amber"}>{portal.apiConnected ? "API подключен" : "ручной режим"}</Tag>
              </div>
              <div className="panel-actions">
                <button className="btn readonly" type="button"><RefreshCw size={16} />Загрузить свежие данные</button>
                <button className="btn" type="button" onClick={() => onOpenModal("api")}>Подключить API</button>
              </div>
              <div className="source-flow">
                {sourceRows.map(([label, value]) => (
                  <div className="list-row source-flow-row" key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
            </section>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Маршрут работы</h2>
                  <p>{workRoute.copy}</p>
                </div>
                <Tag tone={workRoute.done ? "blue" : "amber"}>{workRoute.done ? `Факт: ${workRoute.done} из 5` : "Ожидает данные"}</Tag>
              </div>
              <div className="pipeline">
                {workRoute.rows.map((step) => (
                  <div className={`step ${step.className}`} key={step.title}>
                    <strong>{step.title}</strong>
                    <span>{step.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Карточки</h2>
                  <p>Таблица для первичной проверки и перехода в детальную карточку.</p>
                </div>
                <div className="toolbar">
                  <button className="btn"><ChevronDown size={16} />Фильтр</button>
                  <button className="btn primary" disabled>Массовая правка</button>
                </div>
              </div>
              <CardsTable cards={cards} portal={portal} onOpenCard={onOpenCard} />
            </section>
          </div>

          <aside className="seller-aside">
            <section className="panel">
              <div className="panel-title-row">
                <div>
                  <h2>Состав проекта</h2>
                  <p>Роли команды по этому кабинету.</p>
                </div>
                {!teamEditing && canManage ? <button className="btn" type="button" onClick={() => setTeamEditing(true)}>Редактировать</button> : null}
              </div>

              {!teamEditing ? (
                <div className="project-team-list">
                  {Object.entries(projectRoleLabels).map(([roleKey, label]) => {
                    const user = findUser(team[roleKey]);
                    return (
                      <div className="project-team-row" key={roleKey}>
                        <span>{label}</span>
                        <strong>{user?.full_name || "Не назначен"}</strong>
                        <small>{user?.role || "Выберите сотрудника"}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="team-editor">
                  {Object.entries(projectRoleLabels).map(([roleKey, label]) => {
                    const users = displayUsers.filter((user) => userCanFillProjectRole(user, roleKey));
                    return (
                      <label className="team-editor-row" key={roleKey}>
                        <span>{label}</span>
                        <select className="select" value={teamDraft[roleKey] || ""} onChange={(event) => updateTeamDraft(roleKey, event.target.value)}>
                          <option value="">Не назначен</option>
                          {users.map((user) => <option value={user.login} key={user.login}>{user.full_name}</option>)}
                        </select>
                      </label>
                    );
                  })}
                  <div className="team-editor-actions">
                    <button className="btn primary" type="button" onClick={saveTeamDraft}>Сохранить состав</button>
                    <button className="btn ghost" type="button" onClick={() => { setTeamDraft(team); setTeamEditing(false); }}>Отмена</button>
                  </div>
                </div>
              )}
            </section>

            <section className="panel">
              <h2>Контур безопасности</h2>
              <div className="panel-list">
                <div className="list-row"><span>Wildberries API</span><strong>только чтение</strong></div>
                <div className="list-row"><span>Публикация</span><strong>отключена</strong></div>
                <div className="list-row"><span>Токен</span><strong>backend + AES-GCM</strong></div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function CardsTable({ cards, portal, onOpenCard }) {
  if (!cards.length) {
    return (
      <div className="empty-state">
        <strong>{portal.apiConnected ? "Карточки еще не загружены" : "Нет источника карточек"}</strong>
        <span>{portal.apiConnected ? "Обновите данные WB, чтобы увидеть список." : "Подключите API или добавьте ручной импорт."}</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Карточка</th>
            <th>nmID</th>
            <th>Качество</th>
            <th>Проблема</th>
            <th>Статус</th>
            <th>Детали</th>
          </tr>
        </thead>
        <tbody>
          {cards.slice(0, 20).map((card, index) => (
            <tr key={`${card.nmID || index}-${card.title}`}>
              <td>
                <div className="product-cell">
                  <Thumb url={card.photoUrl} alt={index % 2 === 1} />
                  <div className="product-name">
                    <strong>{card.title || "Карточка WB"}</strong>
                    <span>категория: {card.subjectName || "не указана"}</span>
                  </div>
                </div>
              </td>
              <td>{card.nmID || "Не указано"}</td>
              <td><Tag tone={card.qualityClass || "amber"}>{card.quality || "Средняя"}</Tag></td>
              <td>{card.issue || "Нет критичных"}</td>
              <td><Tag tone={card.statusClass || "amber"}>{card.status || "Нужна проверка"}</Tag></td>
              <td><IconButton icon={Eye} label="Открыть детальную карточку" onClick={() => onOpenCard(card)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardDetailScreen({ card, portal, onBack }) {
  const [activeTab, setActiveTab] = useState("audit");
  const [auditStatus, setAuditStatus] = useState("idle");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTitleSource, setDraftTitleSource] = useState("");
  const [draftDescriptionSource, setDraftDescriptionSource] = useState("");
  const [draftCharacteristics, setDraftCharacteristics] = useState({});
  const [subjectCharacteristics, setSubjectCharacteristics] = useState([]);
  const [subjectCharacteristicsStatus, setSubjectCharacteristicsStatus] = useState("idle");
  const [characteristicSearch, setCharacteristicSearch] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const photoUrl = bestPhotoUrl(card);
  const currentTitle = textOrDash(card?.title);
  const titleLength = currentTitle.length;
  const issueCount = Number(card?.issueCount ?? (card?.issue && card.issue !== "Нет критичных" ? 1 : 0));
  const rawFields = rawFieldsForCard(card);
  const description = card?.description || rawFields.description || "";
  const characteristics = card?.characteristics || rawFields.characteristics || [];
  const characteristicItems = characteristicRows(characteristics);
  const characteristicValueOptions = characteristicValueOptionsByKey(portal, characteristicItems, subjectCharacteristics);
  const photos = card?.photos || rawFields.photos || (photoUrl ? [photoUrl] : []);
  const sizes = card?.sizes || rawFields.sizes || [];
  const dimensions = card?.dimensions || rawFields.dimensions || {};
  const auditDone = auditStatus === "done";
  const draftTitleLength = draftTitle.length;
  const draftStorageKey = `opticards-draft:${portal?.id || "portal"}:${card?.nmID || card?.vendorCode || "card"}`;
  const exportFileBase = safeFilePart(`${card?.vendorCode || card?.nmID || "card"}-${card?.subjectName || "wb"}`);

  useEffect(() => {
    setActiveTab("audit");
    setAuditStatus("idle");
    setDraftTitle("");
    setDraftDescription("");
    setDraftTitleSource("");
    setDraftDescriptionSource("");
    setDraftCharacteristics({});
    setCharacteristicSearch("");
    setDraftSavedAt("");
    try {
      const saved = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
      if (saved) {
        setDraftTitle(saved.title || "");
        setDraftDescription(saved.description || "");
        setDraftTitleSource(saved.titleSource || "");
        setDraftDescriptionSource(saved.descriptionSource || "");
        setDraftCharacteristics(normalizeDraftCharacteristics(saved.characteristics || {}));
        setAuditStatus(saved.auditStatus || "done");
        setDraftSavedAt(saved.savedAt || "");
        setActiveTab("changes");
      } else {
        setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
      }
    } catch {
      localStorage.removeItem(draftStorageKey);
      setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
    }
  }, [draftStorageKey, card?.nmID, card?.vendorCode]);

  useEffect(() => {
    const subjectID = Number(card?.subjectID || rawFields.subjectID || 0);
    if (!subjectID || !portal?.id || portal.mode !== "api") {
      setSubjectCharacteristics([]);
      setSubjectCharacteristicsStatus(subjectID ? "unavailable" : "missing-subject");
      return;
    }
    let active = true;
    setSubjectCharacteristicsStatus("loading");
    apiRequest(`/api/wb/characteristics?portal_id=${encodeURIComponent(portal.id)}&subject_id=${encodeURIComponent(subjectID)}`)
      .then((payload) => {
        if (!active) return;
        setSubjectCharacteristics(payload.characteristics || []);
        setSubjectCharacteristicsStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setSubjectCharacteristics([]);
        setSubjectCharacteristicsStatus("error");
      });
    return () => {
      active = false;
    };
  }, [card?.subjectID, rawFields.subjectID, portal?.id, portal?.mode]);

  function runAuditStub() {
    const suggestions = titleSuggestions(card);
    setAuditStatus("done");
    setDraftTitle(suggestions[1] || suggestions[0] || "");
    setDraftDescription(descriptionSuggestion(card, description));
    setDraftTitleSource("audit");
    setDraftDescriptionSource("audit");
    setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems));
    setActiveTab("changes");
  }

  function removeDraftCharacteristic(key) {
    setDraftCharacteristics((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setDraftCharacteristicValues(row, values, source = "manual") {
    const normalizedValues = [...new Set((values || []).map((item) => String(item).trim()).filter(Boolean))];
    setDraftCharacteristics((current) => {
      const currentDraft = current[row.key];
      if (!normalizedValues.length) {
        const next = { ...current };
        delete next[row.key];
        return next;
      }
      return {
        ...current,
        [row.key]: {
          ...currentDraft,
          charcID: currentDraft?.charcID || row.charcID,
          label: currentDraft?.label || row.label,
          value: normalizedValues.join(", "),
          values: normalizedValues,
          source,
        },
      };
    });
  }

  function addDraftCharacteristicValue(row, value) {
    const currentValues = draftCharacteristicValues(draftCharacteristics[row.key]);
    setDraftCharacteristicValues(row, [...currentValues, value], "manual");
  }

  function removeDraftCharacteristicValue(row, value) {
    const currentValues = draftCharacteristicValues(draftCharacteristics[row.key]);
    setDraftCharacteristicValues(row, currentValues.filter((item) => item !== value), "manual");
  }

  function addDraftCharacteristic(item) {
    const key = characteristicKeyFromMeta(item);
    const draft = normalizeCharacteristicMeta(item);
    setDraftCharacteristics((current) => current[key] ? current : { ...current, [key]: draft });
    setCharacteristicSearch("");
  }

  function saveDraft() {
    const savedAt = new Date().toISOString();
    localStorage.setItem(draftStorageKey, JSON.stringify({
      version: 1,
      savedAt,
      auditStatus,
      title: draftTitle,
      description: draftDescription,
      titleSource: draftTitleSource,
      descriptionSource: draftDescriptionSource,
      characteristics: draftCharacteristics,
    }));
    setDraftSavedAt(savedAt);
  }

  function downloadDraftTable(type) {
    if (type === "content") {
      downloadCsv(`${exportFileBase}-content.csv`, buildContentExportRows(card, draftTitle, draftDescription, draftCharacteristics));
      return;
    }
    if (type === "prices") {
      downloadCsv(`${exportFileBase}-prices.csv`, buildPricesExportRows(card));
      return;
    }
    downloadCsv(`${exportFileBase}-stocks.csv`, buildStocksExportRows(card));
  }

  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>Детальная карточка</h1>
          <p>{textOrDash(card?.title)} · WB {textOrDash(card?.nmID)} · артикул {textOrDash(card?.vendorCode)}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={onBack}><ArrowLeft size={17} />Карточки</button>
          <a className="btn" href={wbCardUrl(card)} target="_blank" rel="noreferrer"><ExternalLink size={17} />Открыть WB</a>
          <button className="btn primary" type="button" disabled><CheckSquare size={17} />Утвердить</button>
        </div>
      </header>

      <div className="content">
        <div className="detail-layout">
          <aside className="detail-aside">
            <div className={`photo-preview ${photoUrl ? "has-image" : ""}`}>
              {photoUrl ? <img src={photoUrl} alt={currentTitle} loading="eager" decoding="async" /> : null}
            </div>
            <section className="panel">
              <h2>Данные карточки</h2>
              <div className="panel-list">
                <div className="list-row"><span>Кабинет</span><strong>{portal?.name}</strong></div>
                <div className="list-row"><span>WB ID</span><strong>{valueSummary(card?.nmID)}</strong></div>
                <div className="list-row"><span>Артикул продавца</span><strong>{valueSummary(card?.vendorCode)}</strong></div>
                <div className="list-row"><span>Категория</span><strong>{valueSummary(card?.subjectName)}</strong></div>
                <div className="list-row"><span>Бренд</span><strong>{valueSummary(card?.brand)}</strong></div>
                <div className="list-row"><span>Описание</span><strong>{isEmptyValue(description) ? "Пусто" : "есть"}</strong></div>
                <div className="list-row"><span>Характеристики</span><strong>{valueSummary(characteristics)}</strong></div>
                <div className="list-row"><span>Фото</span><strong>{valueSummary(photos)}</strong></div>
                <div className="list-row"><span>Размеры</span><strong>{valueSummary(sizes)}</strong></div>
                <div className="list-row"><span>Габариты</span><strong>{valueSummary(dimensions)}</strong></div>
                <div className="list-row"><span>Статус</span><strong>{valueSummary(card?.status)}</strong></div>
              </div>
            </section>
          </aside>

          <div className="detail-main">
            <nav className="detail-tabs" aria-label="Разделы карточки">
              <button className={activeTab === "audit" ? "active" : ""} type="button" onClick={() => setActiveTab("audit")}>Аудит</button>
              <button className={activeTab === "card" ? "active" : ""} type="button" onClick={() => setActiveTab("card")}>Карточка</button>
              <button className={activeTab === "changes" ? "active" : ""} type="button" onClick={() => setActiveTab("changes")}>Изменения</button>
            </nav>

            {activeTab === "audit" ? (
              <section className="workspace-strip">
                <div className="strip-head">
                  <div>
                    <h2>Аудит карточки</h2>
                    <p>Пока это локальная заглушка для проверки рабочего сценария.</p>
                  </div>
                  <Tag tone={auditDone ? "green" : "amber"}>{auditDone ? "аудит готов" : "не запускался"}</Tag>
                </div>
                <div className="audit-list">
                  <div className="issue">
                    <div className="issue-head">
                      <strong>{issueCount ? card.issue : "Критичных проблем нет"}</strong>
                      <Tag tone={issueCount ? "amber" : "green"}>{issueCount ? "проверка" : "ок"}</Tag>
                    </div>
                    <p>{issueCount ? issueCopy(card.issue) : "Карточка выглядит рабочей по текущему снимку WB API. Перед публикацией все равно нужна ручная проверка."}</p>
                  </div>
                  {auditDone ? (
                    <div className="issue">
                      <div className="issue-head">
                        <strong>Предложения подготовлены</strong>
                        <Tag tone="blue">черновик</Tag>
                      </div>
                      <p>Система заполнила вкладку изменений вариантами для ручной проверки.</p>
                    </div>
                  ) : null}
                </div>
                <div className="tab-actions">
                  <button className="btn primary" type="button" onClick={runAuditStub}><ClipboardList size={17} />Запустить аудит</button>
                </div>
              </section>
            ) : null}

            {activeTab === "card" ? (
              <>
                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Характеристики</h2>
                      <p>Значения из карточки WB без технического JSON-формата.</p>
                    </div>
                    <Tag tone="blue">{valueCount(characteristics)} {pluralRu(valueCount(characteristics), "поле", "поля", "полей")}</Tag>
                  </div>
                  <CharacteristicsBlock items={characteristics} />
                </section>

                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Заголовок</h2>
                      <p>Сейчас это исходное значение из WB. SEO-варианты появятся после подключения MPStats и правил категории.</p>
                    </div>
                    <Tag tone={titleLength <= 60 ? "green" : "amber"}>лимит WB 60</Tag>
                  </div>
                  <div className="option-list">
                    <div className="option-row">
                      <div className="option-head">
                        <strong>{currentTitle}</strong>
                        <span className={`char-counter ${titleLength <= 60 ? "ok" : ""}`}>{titleLength}/60</span>
                      </div>
                      <p>Это не рекомендация, а текущее название карточки из WB snapshot.</p>
                    </div>
                  </div>
                </section>

                <details className="workspace-strip technical-fields">
                  <summary>
                    <span>Служебные данные WB</span>
                    <Tag tone="blue">{Object.keys(rawFields).length} полей</Tag>
                  </summary>
                  <RawFieldsView fields={rawFields} />
                </details>
              </>
            ) : null}

            {activeTab === "changes" ? (
              <section className="workspace-strip">
                <div className="strip-head">
                  <div>
                    <h2>Было / стало</h2>
                    <p>{auditDone ? "Рекомендации аудита помечены, но любые поля можно править вручную." : "Заполняйте колонку Стало вручную. Аудит позже добавит помеченные рекомендации."}</p>
                  </div>
                  <Tag tone={auditDone ? "blue" : "green"}>{auditDone ? "есть рекомендации" : "ручной черновик"}</Tag>
                </div>
                <div className="before-after">
                  <div className="field-box">
                    <strong>Было: заголовок</strong>
                    <p>{currentTitle}</p>
                  </div>
                  <div className="field-box">
                    <strong>Стало: заголовок</strong>
                    <textarea
                      className={draftTitleSource === "audit" ? "short audit-suggestion-field" : "short"}
                      value={draftTitle}
                      onChange={(event) => {
                        setDraftTitle(event.target.value);
                        setDraftTitleSource(event.target.value.trim() ? "manual" : "");
                      }}
                      placeholder="Введите новый заголовок или запустите аудит для рекомендации."
                    />
                    <p className="draft-source-line">
                      <span className={`char-counter ${draftTitleLength <= 60 ? "ok" : ""}`}>{draftTitleLength}/60 символов</span>
                      <DraftSourceMark source={draftTitleSource} />
                    </p>
                  </div>
                  <div className="field-box">
                    <strong>Было: описание</strong>
                    <p>{isEmptyValue(description) ? "Пусто" : description}</p>
                  </div>
                  <div className="field-box">
                    <strong>Стало: описание</strong>
                    <textarea
                      className={draftDescriptionSource === "audit" ? "audit-suggestion-field" : ""}
                      value={draftDescription}
                      onChange={(event) => {
                        setDraftDescription(event.target.value);
                        setDraftDescriptionSource(event.target.value.trim() ? "manual" : "");
                      }}
                      placeholder="Введите новое описание или запустите аудит для рекомендации."
                    />
                    <DraftSourceMark source={draftDescriptionSource} />
                  </div>
                  <div className="field-box characteristics-diff-box">
                    <strong>Характеристики</strong>
                    <CharacteristicsDiffTable
                      rows={characteristicItems}
                      drafts={draftCharacteristics}
                      auditDone={auditDone}
                      availableCharacteristics={subjectCharacteristics}
                      search={characteristicSearch}
                      status={subjectCharacteristicsStatus}
                      valueOptionsByKey={characteristicValueOptions}
                      onSearch={setCharacteristicSearch}
                      onAdd={addDraftCharacteristic}
                      onRemove={removeDraftCharacteristic}
                      onAddValue={addDraftCharacteristicValue}
                      onRemoveValue={removeDraftCharacteristicValue}
                    />
                  </div>
                </div>
                <div className="draft-actions">
                  <div>
                    <strong>Черновик изменений</strong>
                    <p>{draftSavedAt ? `Сохранен ${new Date(draftSavedAt).toLocaleString("ru-RU")}` : "Не сохранен. Сохраните перед выходом, чтобы не потерять колонку Стало."}</p>
                  </div>
                  <div className="draft-buttons">
                    <button className="btn primary" type="button" onClick={saveDraft}><Save size={17} />Сохранить</button>
                    <button className="btn" type="button" onClick={() => downloadDraftTable("content")}><Download size={17} />Контент</button>
                    <button className="btn" type="button" onClick={() => downloadDraftTable("prices")}><Download size={17} />Цены</button>
                    <button className="btn" type="button" onClick={() => downloadDraftTable("stocks")}><Download size={17} />Остатки</button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function RawFieldsView({ fields }) {
  const entries = orderedFieldEntries(fields);
  return (
    <div className="raw-field-list">
      {entries.map(([key, value]) => (
        <div className="raw-field-row" key={key}>
          <div className="raw-field-name">
            <strong>{fieldLabel(key)}</strong>
            {!isKnownField(key) ? <span>{key}</span> : null}
          </div>
          <RawFieldValue value={value} />
        </div>
      ))}
    </div>
  );
}

function RawFieldValue({ value }) {
  if (isEmptyValue(value)) {
    return <span className="raw-field-value field-empty">Пусто</span>;
  }
  if (typeof value === "boolean") {
    return <span className="raw-field-value">{value ? "Да" : "Нет"}</span>;
  }
  if (typeof value !== "object") {
    return <span className="raw-field-value">{String(value)}</span>;
  }
  if (Array.isArray(value) && value.every(isPrimitiveDisplayValue)) {
    return <PrimitiveValueList values={value} />;
  }
  if (Array.isArray(value) && value.every((item) => item && typeof item === "object" && ("name" in item || "charcName" in item))) {
    return <CharacteristicsList items={value} />;
  }
  return <pre className="json-value">{JSON.stringify(value, null, 2)}</pre>;
}

function PrimitiveValueList({ values }) {
  const visibleValues = values.filter((item) => !isEmptyValue(item));
  if (!visibleValues.length) {
    return <span className="raw-field-value field-empty">Пусто</span>;
  }
  return (
    <div className="value-chip-list">
      {visibleValues.map((value, index) => (
        <span className="value-chip" key={`${String(value)}-${index}`}>{String(value)}</span>
      ))}
    </div>
  );
}

function CharacteristicsBlock({ items }) {
  if (isEmptyValue(items)) {
    return <div className="empty-state"><span>Характеристики не заполнены</span></div>;
  }
  if (Array.isArray(items) && items.every((item) => item && typeof item === "object" && ("name" in item || "charcName" in item))) {
    return <CharacteristicsList items={items} />;
  }
  return <RawFieldValue value={items} />;
}

function CharacteristicsDiffTable({
  rows,
  drafts,
  availableCharacteristics,
  search,
  status,
  valueOptionsByKey,
  onSearch,
  onAdd,
  onRemove,
  onAddValue,
  onRemoveValue,
}) {
  const baseKeys = new Set(rows.map((row) => row.key));
  const characteristicMetaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  const draftOnlyRows = Object.entries(drafts)
    .filter(([key]) => !baseKeys.has(key))
    .map(([key, draft]) => ({
      key,
      label: draft.label,
      value: "",
      charcID: draft.charcID,
      meta: characteristicMetaByKey[key] || draft,
      draftOnly: true,
    }));
  const visibleRows = [
    ...rows.map((row) => ({
      ...row,
      meta: characteristicMetaByKey[row.key] || drafts[row.key] || row,
    })),
    ...draftOnlyRows,
  ];
  const selectedKeys = new Set(Object.keys(drafts));
  const normalizedSearch = search.trim().toLowerCase();
  const availableOptions = (availableCharacteristics || [])
    .filter((item) => {
      const key = characteristicKeyFromMeta(item);
      if (selectedKeys.has(key)) {
        return false;
      }
      if (!normalizedSearch) {
        return item.required || item.popular || item.hasFilter;
      }
      return String(item.name || "").toLowerCase().includes(normalizedSearch);
    })
    .slice(0, 8);

  return (
    <div className="characteristics-diff">
      <div className="characteristics-diff-head">
        <span>Характеристика</span>
        <span>Было</span>
        <span>Стало</span>
      </div>
      {!visibleRows.length ? <div className="empty-state"><span>Характеристики не заполнены</span></div> : null}
      {visibleRows.map((row) => (
        <div className="characteristics-diff-row" key={row.key}>
          <strong>{row.label}</strong>
          {row.draftOnly ? <span className="raw-field-value field-empty">Добавлено в черновик</span> : <RawFieldValue value={row.value} />}
          <DraftCharacteristicEditor
            draft={drafts[row.key]}
            row={row}
            meta={row.meta}
            valueOptions={valueOptionsByKey[row.key] || []}
            onAddValue={(value) => onAddValue(row, value)}
            onRemoveValue={(value) => onRemoveValue(row, value)}
            onRemove={() => onRemove(row.key)}
          />
        </div>
      ))}
      <div className="characteristics-search">
        <label className="search">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Найти характеристику WB для этой категории"
          />
        </label>
        <div className="characteristics-options">
          {status === "loading" ? <span className="field-empty">Загружаем характеристики категории...</span> : null}
          {status === "error" ? <span className="field-empty">Не удалось загрузить характеристики WB</span> : null}
          {status === "missing-subject" ? <span className="field-empty">У карточки нет subjectID</span> : null}
          {status === "unavailable" ? <span className="field-empty">Справочник доступен после API-подключения кабинета</span> : null}
          {status === "loaded" && !availableOptions.length ? <span className="field-empty">Ничего не найдено</span> : null}
          {availableOptions.map((item) => (
            <button className="characteristic-option" type="button" key={characteristicKeyFromMeta(item)} onClick={() => onAdd(item)}>
              <span>{item.name}</span>
              {item.required ? <Tag tone="amber">обязательная</Tag> : null}
              {!item.required && item.popular ? <Tag tone="blue">популярная</Tag> : null}
              <small>{characteristicValueLimit(item) ? `до ${characteristicValueLimit(item)}` : "без лимита"}</small>
              {item.unitName ? <small>{item.unitName}</small> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftCharacteristicEditor({ draft, row, meta, valueOptions, onAddValue, onRemoveValue, onRemove }) {
  const [query, setQuery] = useState("");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const isAuditSuggestion = draft?.source === "audit";
  const values = draftCharacteristicValues(draft);
  const limit = characteristicValueLimit(meta);
  const isLimitReached = Boolean(limit && values.length >= limit);
  const strictValues = characteristicUsesStrictValues(meta);
  const selectedValues = new Set(values.map(normalizedCharacteristicOption));
  const normalizedQuery = normalizedCharacteristicOption(query);
  const customValue = query.trim();
  const availableValues = valueOptions
    .filter((value) => !selectedValues.has(normalizedCharacteristicOption(value)))
    .filter((value) => !normalizedQuery || normalizedCharacteristicOption(value).includes(normalizedQuery));
  const canAddCustomValue = Boolean(
    customValue
    && !strictValues
    && !isLimitReached
    && !selectedValues.has(normalizedCharacteristicOption(customValue))
    && !availableValues.some((value) => normalizedCharacteristicOption(value) === normalizedCharacteristicOption(customValue))
  );

  function addValue(value) {
    if (isLimitReached) {
      return;
    }
    onAddValue(value);
    setQuery("");
    setIsOptionsOpen(false);
  }

  return (
    <div className={`draft-editor ${isAuditSuggestion ? "audit-suggestion" : ""}`}>
      <div className="draft-chip-list">
        {values.map((value) => (
          <button className="draft-chip" type="button" key={value} onClick={() => onRemoveValue(value)} title="Убрать значение">
            <span>{value}</span>
            <X size={14} />
          </button>
        ))}
        {!values.length ? <span className="raw-field-value field-empty">Пусто в черновике</span> : null}
        {row.draftOnly ? (
          <button className="icon-btn" type="button" onClick={onRemove} aria-label="Убрать характеристику" title="Убрать характеристику">
            <X size={15} />
          </button>
        ) : null}
      </div>
      <label className="draft-value-search">
        <Search size={15} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsOptionsOpen(true)}
          onBlur={() => setIsOptionsOpen(false)}
          disabled={isLimitReached}
          placeholder={isLimitReached ? "Лимит значений достигнут" : (strictValues ? "Выбрать из списка WB" : "Выбрать или ввести свое")}
        />
      </label>
      {isOptionsOpen ? (
        <div className="draft-value-options">
          {isLimitReached ? <span className="field-empty">Сначала удалите одно значение</span> : null}
          {!isLimitReached && canAddCustomValue ? (
            <button className="characteristic-option custom-option" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addValue(customValue)}>
              <Plus size={14} />
              <span>Добавить свое: {customValue}</span>
            </button>
          ) : null}
          {!isLimitReached && availableValues.length ? availableValues.map((value) => (
            <button className="characteristic-option" type="button" key={value} onMouseDown={(event) => event.preventDefault()} onClick={() => addValue(value)}>
              <span>{value}</span>
            </button>
          )) : null}
          {!isLimitReached && !availableValues.length && !canAddCustomValue ? <span className="field-empty">{strictValues ? "Можно выбрать только из списка WB" : "Введите свое значение"}</span> : null}
        </div>
      ) : null}
      <div className="draft-editor-meta">
        <span>{characteristicLimitText(meta, values.length)}</span>
        <span>{strictValues ? "только список WB" : "можно свое значение"}</span>
        {isAuditSuggestion ? <Tag tone="blue">рекомендация аудита</Tag> : null}
        {draft && !isAuditSuggestion ? <span>ручная правка</span> : null}
      </div>
    </div>
  );
}

function DraftSourceMark({ source }) {
  if (source === "audit") {
    return <Tag tone="blue">рекомендация аудита</Tag>;
  }
  if (source === "manual") {
    return <span className="draft-source-manual">ручная правка</span>;
  }
  return null;
}

function CharacteristicsList({ items }) {
  return (
    <div className="characteristics-list">
      {characteristicRows(items).map((row) => {
        return (
          <div className="characteristic-row" key={row.key}>
            <span>{row.label}</span>
            <RawFieldValue value={row.value} />
          </div>
        );
      })}
    </div>
  );
}

function PortalModal({ mode, users, onMode, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: "",
    marketplace: "Wildberries",
    scope: "full",
    lead: users[0]?.login || "",
    tech: users.find((user) => getUserRoleType(user) === "tech")?.login || users[0]?.login || "",
    manager: users.find((user) => getUserRoleType(user) === "manager")?.login || users[0]?.login || "",
    apiKey: "",
    storeUrl: "",
    manualSource: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function errorText(errorObject) {
    if (errorObject.message === "portal_already_connected") {
      return `Этот WB кабинет уже подключен: ${errorObject.payload?.portal?.name || "существующий кабинет"}. Повторно добавить его нельзя.`;
    }
    if (errorObject.message === "portal_already_archived") {
      return `Этот WB кабинет уже подключен, но находится в архиве: ${errorObject.payload?.portal?.name || "существующий кабинет"}. Верните его из архива вместо повторного добавления.`;
    }
    if (errorObject.message === "wb_token_required") return "Введите WB API ключ для подключения кабинета.";
    if (errorObject.message === "wb_api_error") return `WB API не подключился: ${errorObject.payload?.message || "WB отклонил запрос."}`;
    if (errorObject.message === "secret_storage_unavailable") return "На backend не настроен ключ шифрования.";
    if (errorObject.status === 401) return "Сессия истекла. Войдите заново.";
    return "Не удалось добавить кабинет. Проверьте данные и попробуйте еще раз.";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (mode === "api" && !form.apiKey.trim()) {
      setError("Введите WB API ключ.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        name: mode === "api" ? "" : form.name.trim(),
        marketplace: form.marketplace,
        mode,
        scope: form.scope,
        teamRoles: { lead: form.lead, tech: form.tech, manager: form.manager },
        apiKey: mode === "api" ? form.apiKey.trim() : "",
        storeUrl: mode === "manual" ? form.storeUrl.trim() : "",
        manualSource: mode === "manual" ? form.manualSource.trim() : "",
      });
      update("apiKey", "");
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setLoading(false);
      update("apiKey", "");
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Добавить кабинет</h2>
            <p>API-ключ отправляется только на backend, проверяется read-only запросом WB и не хранится в браузере.</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          <div className="connect-mode">
            <button className={mode === "api" ? "active" : ""} type="button" onClick={() => onMode("api")}>
              <strong>WB API</strong>
              <span>Определить кабинет и загрузить карточки.</span>
            </button>
            <button className={mode === "manual" ? "active" : ""} type="button" onClick={() => onMode("manual")}>
              <strong>Ручной портал</strong>
              <span>Подготовить пространство под таблицы.</span>
            </button>
          </div>
          {mode === "manual" ? (
            <label className="field-label">
              Название кабинета
              <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
            </label>
          ) : null}
          <div className="form-two">
            <label className="field-label">
              Маркетплейс
              <select className="select" value={form.marketplace} onChange={(event) => update("marketplace", event.target.value)}>
                <option>Wildberries</option>
              </select>
            </label>
            <label className="field-label">
              Охват
              <select className="select" value={form.scope} onChange={(event) => update("scope", event.target.value)}>
                <option value="full">Полный магазин</option>
                <option value="selected">Выбранные карточки</option>
              </select>
            </label>
          </div>
          <div className="form-two">
            <UserSelect label="Руководитель проекта" value={form.lead} users={users} onChange={(value) => update("lead", value)} />
            <UserSelect label="Технический специалист" value={form.tech} users={users} onChange={(value) => update("tech", value)} />
          </div>
          <UserSelect label="Менеджер" value={form.manager} users={users} onChange={(value) => update("manager", value)} />
          {mode === "api" ? (
            <label className="field-label">
              WB API ключ
              <input type="password" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" />
            </label>
          ) : (
            <>
              <label className="field-label">
                Ссылка на магазин или первую карточку
                <input value={form.storeUrl} onChange={(event) => update("storeUrl", event.target.value)} />
              </label>
              <label className="field-label">
                Первичный источник карточек
                <textarea value={form.manualSource} onChange={(event) => update("manualSource", event.target.value)} />
              </label>
            </>
          )}
          {error ? <div className="form-error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>Отмена</button>
          <button className="btn primary" type="submit" disabled={loading}>{loading ? "Проверяем..." : "Добавить кабинет"}</button>
        </div>
      </form>
    </div>
  );
}

function UserSelect({ label, value, users, onChange }) {
  return (
    <label className="field-label">
      {label}
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {users.map((user) => <option value={user.login} key={user.login}>{user.full_name}</option>)}
      </select>
    </label>
  );
}

function sourceFlowRows(portal) {
  if (portal.mode === "api") {
    const tokenDays = tokenDaysLeftText(portal.tokenMeta);
    const tokenStatus = portal.apiConnected ? `готово${tokenDays ? `, ${tokenDays}` : ""}` : "ожидает подключения";
    return [
      ["Проверка WB API ключа", tokenStatus],
      ["Карточки из кабинета", portal.apiConnected ? formatNumber(portal.cardCount) : "после подключения"],
      ["MPStats", "витрина/аналитика позже"],
      ["Запись в WB", "отключена"],
    ];
  }
  return [
    ["Ссылка на магазин/карточку", portal.storeUrl ? "добавлена" : "не указана"],
    ["Первичный источник", portal.manualSource ? "описан" : "ожидает таблицу"],
    ["Автозагрузка карточек", "нужен API"],
    ["MPStats", "может подтянуть витрину"],
  ];
}

function workRouteRows(portal) {
  const hasCards = Number(portal.cardCount || 0) > 0 || Boolean(portal.realCards?.length);
  const rows = [
    { title: "Загрузка", status: hasCards ? "данные получены" : "ожидает загрузку", className: hasCards ? "active" : "paused" },
    { title: "Аудит", status: "MPStats не подключен", className: "paused" },
    { title: "Правки", status: "0 черновиков", className: "off" },
    { title: "Согласование", status: "нет правок", className: "off" },
    { title: "Публикация", status: "запись в WB отключена", className: "off" },
  ];
  const done = rows.filter((step) => step.className === "active").length;
  return {
    rows,
    done,
    copy: hasCards
      ? "Данные WB загружены. Аудит MPStats, черновики правок, согласование и запись в WB пока не подключены."
      : "Сначала нужен источник данных: WB API или ручной импорт. Остальные этапы пока не активны.",
  };
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniStat({ value, label }) {
  return (
    <div className="mini-stat">
      <strong>{formatNumber(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function TeamSummary({ portal, findUser, fallbackOwner }) {
  const team = getPortalTeam(portal);
  return (
    <div className="team-summary">
      <span className="team-summary-title">Команда проекта</span>
      {Object.entries(projectRoleLabels).map(([key, label]) => {
        const user = findUser(team[key]) || fallbackOwner;
        return (
          <div className="team-summary-row" key={key}>
            <span>{label}</span>
            <strong>{user?.full_name || "Не назначен"}</strong>
          </div>
        );
      })}
    </div>
  );
}

function Thumb({ url, alt = false }) {
  const photoUrl = safeHttpsUrl(url);
  const style = photoUrl ? { backgroundImage: `url("${photoUrl}")` } : undefined;
  return <div className={`thumb ${alt ? "alt" : ""} ${photoUrl ? "has-image" : ""}`} style={style} />;
}

function PlaceholderScreen({ title, copy }) {
  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>{title}</h1>
          <p>{copy}</p>
        </div>
      </header>
      <div className="content">
        <section className="workspace-strip">
          <div className="empty-state">
            <strong>Раздел готовится</strong>
            <span>Сначала фиксируем безопасную загрузку WB и структуру кабинетов, затем подключаем следующий рабочий слой.</span>
          </div>
        </section>
      </div>
    </section>
  );
}

function SettingsScreen({ users }) {
  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>Настройки</h1>
          <p>Пользователи, роли, источники данных и будущие интеграции.</p>
        </div>
      </header>
      <div className="content">
        <div className="settings-grid">
          <section className="panel">
            <h2>Пользователи</h2>
            <div className="panel-list">
              {users.map((user) => (
                <div className="list-row" key={user.login}>
                  <span>{user.full_name}</span>
                  <strong>{user.role}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Интеграции</h2>
            <div className="panel-list">
              <div className="list-row"><span>Wildberries</span><strong>read-only API</strong></div>
              <div className="list-row"><span>MPStats</span><strong>позже</strong></div>
              <div className="list-row"><span>Токены</span><strong>AES-GCM в SQLite</strong></div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
