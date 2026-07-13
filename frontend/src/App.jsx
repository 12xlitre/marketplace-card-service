import { useEffect, useState } from "react";
import {
  Archive,
  AlertTriangle,
  ArrowLeft,
  CheckSquare,
  ClipboardList,
  FileText,
  Download,
  Eye,
  ExternalLink,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Tags,
  Trash2,
  Upload,
  WandSparkles,
  Warehouse,
  X,
} from "lucide-react";

const hardcodedDirectoryFallback = [
  { login: "kristina.manager", full_name: "Кристина Январева", role: "Руководитель отдела", access_level: "overview", user_role: "manager" },
  { login: "anastasia.tech", full_name: "Анастасия Руднева", role: "Технический специалист", access_level: "readonly_wb", user_role: "tech" },
  { login: "svetlana.manager", full_name: "Светлана Дементьева", role: "Аккаунт-менеджер", access_level: "overview", user_role: "manager" },
];

const appViewStorageKey = "opticards-active-view";
const helpModeStorageKey = "opticards-help-mode";
const appScreens = new Set(["cabinets", "seller", "card", "settings", "admin"]);
const topCompetitorLimit = 3;

const projectRoleLabels = {
  lead: "Руководитель отдела",
  tech: "Технический специалист",
  manager: "Аккаунт-менеджер",
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

function readSavedAppView() {
  try {
    const saved = JSON.parse(localStorage.getItem(appViewStorageKey) || "null");
    if (!saved || typeof saved !== "object") {
      return {};
    }
    return {
      screen: appScreens.has(saved.screen) ? saved.screen : "cabinets",
      portalId: saved.portalId ? String(saved.portalId) : "demo-wb",
      cardKey: saved.cardKey ? String(saved.cardKey) : "",
    };
  } catch {
    return {};
  }
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function setUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function setUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const fileChunks = [];
  const centralChunks = [];
  const stamp = dosDateTime();
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    setUint32(localView, 0, 0x04034b50);
    setUint16(localView, 4, 20);
    setUint16(localView, 6, 0);
    setUint16(localView, 8, 0);
    setUint16(localView, 10, stamp.time);
    setUint16(localView, 12, stamp.date);
    setUint32(localView, 14, checksum);
    setUint32(localView, 18, dataBytes.length);
    setUint32(localView, 22, dataBytes.length);
    setUint16(localView, 26, nameBytes.length);
    setUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    fileChunks.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 8, 0);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, stamp.time);
    setUint16(centralView, 14, stamp.date);
    setUint32(centralView, 16, checksum);
    setUint32(centralView, 20, dataBytes.length);
    setUint32(centralView, 24, dataBytes.length);
    setUint16(centralView, 28, nameBytes.length);
    setUint16(centralView, 30, 0);
    setUint16(centralView, 32, 0);
    setUint16(centralView, 34, 0);
    setUint16(centralView, 36, 0);
    setUint32(centralView, 38, 0);
    setUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  });

  const centralDirectory = concatBytes(centralChunks);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 8, files.length);
  setUint16(endView, 10, files.length);
  setUint32(endView, 12, centralDirectory.length);
  setUint32(endView, 16, offset);
  setUint16(endView, 20, 0);

  return concatBytes([...fileChunks, centralDirectory, endRecord]);
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const lastCell = `${columnName(maxColumns - 1)}${Math.max(rows.length, 1)}`;
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = sheet.widths?.[index] || 18;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const freezePane = sheet.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, columnIndex) => {
      const value = cell && typeof cell === "object" && !Array.isArray(cell) ? cell.value : cell;
      const style = rowIndex === 0 ? 1 : 0;
      const ref = `${columnName(columnIndex)}${rowNumber}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  const autoFilter = rows.length > 1 ? `<autoFilter ref="A1:${lastCell}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freezePane}<cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${autoFilter}</worksheet>`;
}

function xlsxFiles(sheets) {
  const contentSheetTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const worksheetFiles = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: sheetXml(sheet),
  }));

  return [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentSheetTypes}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...worksheetFiles,
  ];
}

function downloadXlsx(filename, sheets) {
  const bytes = createZip(xlsxFiles(sheets));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
  const expiresAt = tokenMeta?.expiresAt ? new Date(tokenMeta.expiresAt) : null;
  const expiresText = expiresAt && !Number.isNaN(expiresAt.getTime())
    ? ` · до ${expiresAt.toLocaleDateString("ru-RU")}`
    : "";
  return `осталось ${daysLeft} ${pluralRu(daysLeft, "полный день", "полных дня", "полных дней")}${expiresText}`;
}

function apiConnectButtonText(portal) {
  return portal?.apiConnected ? "Заменить API" : "Подключить API";
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
    price: card?.price,
    discount: card?.discount,
    discountedPrice: card?.discountedPrice,
    stock: card?.stock,
    sellerStock: card?.sellerStock,
    wbStock: card?.wbStock,
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

function firstUsefulPortalCardName(cards = []) {
  const candidates = [];
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    const raw = card?.rawFields || {};
    candidates.push(
      card?.sellerName,
      raw.sellerName,
      raw.supplierName,
      raw.shopName,
      raw.storeName,
      card?.brand,
      raw.brand,
      raw.brandName,
    );
  });
  return candidates
    .map((value) => String(value || "").trim())
    .find((value) => value && !["wildberries", "wb", "не указано"].includes(value.toLowerCase())) || "";
}

function portalDisplayName(portal) {
  const currentName = String(portal?.name || "").trim();
  const cardName = firstUsefulPortalCardName(portal?.realCards || []);
  if (cardName && (!currentName || / wb$/i.test(currentName) || currentName === "Кабинет WB" || currentName === "Wildberries")) {
    return cardName;
  }
  return currentName || cardName || "Кабинет WB";
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

function userCanManageUsers(user) {
  const marker = `${user?.user_role || ""} ${user?.access_level || ""} ${user?.role || ""}`.toLowerCase();
  return marker.includes("admin")
    || marker.includes("all")
    || marker.includes("полный")
    || marker.includes("админ")
    || marker.includes("руковод");
}

function userCanFillProjectRole(user, projectRole) {
  const roleType = getUserRoleType(user);
  if (projectRole === "tech") {
    return roleType === "tech" || roleType === "admin";
  }
  return roleType === "manager" || roleType === "admin";
}

function findPreferredUser(users, logins, fallbackRole) {
  return users.find((user) => logins.includes(user.login))
    || users.find((user) => getUserRoleType(user) === fallbackRole)
    || users[0];
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
    storeUrl: String(portal.storeUrl || portal.store_url || "").trim(),
    manualSource: String(portal.manualSource || portal.manual_source || "").trim(),
    isActive: portal.isActive !== false,
    status: portal.mode === "api" && !portal.apiConnected ? "API ожидает подключения" : portal.status,
    ownerLogin: teamRoles.lead || portal.ownerLogin,
    teamRoles,
    memberLogins: uniqueLogins(portal.memberLogins?.length
      ? portal.memberLogins
      : [teamRoles.lead, teamRoles.tech, teamRoles.manager]),
    realCards: portal.realCards || [],
    tokenMeta: portal.tokenMeta || {},
    draftSummary: {
      draftCount: Number(portal.draftSummary?.draftCount || 0),
      auditCount: Number(portal.draftSummary?.auditCount || 0),
      approvalPendingCount: Number(portal.draftSummary?.approvalPendingCount || 0),
      approvalReturnedCount: Number(portal.draftSummary?.approvalReturnedCount || 0),
      approvalApprovedCount: Number(portal.draftSummary?.approvalApprovedCount || 0),
      lastDraftAt: portal.draftSummary?.lastDraftAt || "",
    },
  };
}

function emptyDraftSummary() {
  return {
    draftCount: 0,
    auditCount: 0,
    approvalPendingCount: 0,
    approvalReturnedCount: 0,
    approvalApprovedCount: 0,
    lastDraftAt: "",
  };
}

function defaultApprovalState() {
  return {
    status: "draft",
    assigneeLogin: "",
    submittedBy: "",
    submittedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    returnReason: "",
    history: [],
  };
}

function normalizeApprovalState(value) {
  const source = value && typeof value === "object" ? value : {};
  const status = ["draft", "submitted", "changes_requested", "approved", "exported"].includes(source.status)
    ? source.status
    : "draft";
  return {
    ...defaultApprovalState(),
    ...source,
    status,
    assigneeLogin: String(source.assigneeLogin || ""),
    submittedBy: String(source.submittedBy || ""),
    submittedAt: String(source.submittedAt || ""),
    reviewedBy: String(source.reviewedBy || ""),
    reviewedAt: String(source.reviewedAt || ""),
    returnReason: String(source.returnReason || ""),
    history: Array.isArray(source.history) ? source.history.slice(0, 20) : [],
  };
}

const APPROVAL_SECTION_KEYS = ["content", "prices", "stocks"];

const APPROVAL_SECTION_LABELS = {
  content: "Контент",
  prices: "Цены",
  stocks: "Остатки",
};

function defaultApprovalSections() {
  return APPROVAL_SECTION_KEYS.reduce((acc, key) => {
    acc[key] = defaultApprovalState();
    return acc;
  }, {});
}

function approvalSectionLabel(section) {
  return APPROVAL_SECTION_LABELS[section] || "Изменения";
}

function normalizeApprovalSections(value, fallbackApproval = null) {
  const source = value && typeof value === "object" ? value : {};
  const hasSectionState = APPROVAL_SECTION_KEYS.some((key) => source[key] && typeof source[key] === "object");
  const fallback = normalizeApprovalState(fallbackApproval);
  return APPROVAL_SECTION_KEYS.reduce((acc, key) => {
    acc[key] = normalizeApprovalState(hasSectionState ? source[key] : fallback);
    return acc;
  }, {});
}

function approvalEventTime(approval) {
  const historyTime = approval?.history?.[0]?.createdAt || "";
  const candidates = [historyTime, approval?.reviewedAt, approval?.submittedAt].filter(Boolean);
  const timestamps = candidates
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function latestApprovalByStatus(sections, statuses) {
  const statusSet = new Set(statuses);
  return APPROVAL_SECTION_KEYS
    .map((key) => normalizeApprovalState(sections?.[key]))
    .filter((item) => statusSet.has(item.status))
    .sort((a, b) => approvalEventTime(b) - approvalEventTime(a))[0];
}

function deriveOverallApproval(approvalSections) {
  const sections = normalizeApprovalSections(approvalSections);
  const statuses = APPROVAL_SECTION_KEYS.map((key) => sections[key].status);
  const submitted = latestApprovalByStatus(sections, ["submitted"]);
  if (submitted) return submitted;
  const returned = latestApprovalByStatus(sections, ["changes_requested"]);
  if (returned) return returned;
  if (statuses.every((status) => status === "approved" || status === "exported")) {
    return latestApprovalByStatus(sections, ["approved", "exported"]) || normalizeApprovalState({ status: "approved" });
  }
  return defaultApprovalState();
}

function approvalStatusLabel(status) {
  return {
    draft: "в работе",
    submitted: "на согласовании",
    changes_requested: "на доработке",
    approved: "принято",
    exported: "выгружено",
  }[status] || "черновик";
}

function approvalStatusTone(status) {
  if (status === "submitted") return "amber";
  if (status === "approved" || status === "exported") return "green";
  if (status === "changes_requested") return "red";
  return "blue";
}

const workTypeOptions = [
  { key: "content", label: "Контент" },
  { key: "prices", label: "Цены" },
  { key: "stocks", label: "Остатки" },
];

function normalizeWorkTypes(value) {
  const allowed = new Set(workTypeOptions.map((item) => item.key));
  const output = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const key = String(item || "").trim();
    if (allowed.has(key) && !output.includes(key)) {
      output.push(key);
    }
  });
  return output.length ? output : ["content"];
}

function workTypeLabels(value) {
  const labelByKey = Object.fromEntries(workTypeOptions.map((item) => [item.key, item.label]));
  return normalizeWorkTypes(value).map((key) => labelByKey[key] || key);
}

function defaultApprovalWorkflow() {
  return {
    tasks: [],
    analytics: {
      pendingCount: 0,
      returnedCount: 0,
      approvedCount: 0,
      eventCount: 0,
      avgApprovalMinutes: null,
      avgPendingMinutes: null,
      lastEventAt: "",
    },
    recentEvents: [],
  };
}

function normalizeApprovalWorkflow(value) {
  const analytics = value?.analytics || {};
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    analytics: {
      pendingCount: Number(analytics.pendingCount || 0),
      returnedCount: Number(analytics.returnedCount || 0),
      approvedCount: Number(analytics.approvedCount || 0),
      eventCount: Number(analytics.eventCount || 0),
      avgApprovalMinutes: analytics.avgApprovalMinutes ?? null,
      avgPendingMinutes: analytics.avgPendingMinutes ?? null,
      lastEventAt: analytics.lastEventAt || "",
    },
    recentEvents: Array.isArray(value?.recentEvents) ? value.recentEvents : [],
  };
}

function durationShort(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) {
    return "нет данных";
  }
  const total = Math.max(0, Number(minutes));
  if (total < 60) {
    return `${Math.round(total)} мин`;
  }
  if (total < 60 * 24) {
    return `${Math.round(total / 60)} ч`;
  }
  return `${Math.round(total / (60 * 24))} дн`;
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
      isActive: item.is_active !== false && item.isActive !== false,
    }));
}

function defaultTeamFromUsers(displayUsers) {
  const activeUsers = displayUsers.filter((user) => user.isActive !== false);
  const users = activeUsers.length ? activeUsers : (displayUsers.length ? displayUsers : hardcodedDirectoryFallback);
  const lead = findPreferredUser(users, ["kristina.manager", "kristina", "kristina.yanvareva"], "admin");
  const tech = findPreferredUser(users, ["anastasia.tech", "anastasia", "anastasia.rudneva"], "tech");
  const manager = findPreferredUser(users, ["svetlana.manager", "svetlana", "svetlana.dementyeva"], "manager") || lead;
  return {
    lead: lead?.login || "manager",
    tech: tech?.login || "specialist",
    manager: manager?.login || lead?.login || "manager",
  };
}

function applyWbSnapshotToPortal(portal, payload) {
  const stats = payload.stats || {};
  const realCards = payload.cards || [];
  return normalizePortal({
    ...portal,
    realCards,
    name: stats.portalName || firstUsefulPortalCardName(realCards) || portal.name,
    status: "WB read-only",
    apiConnected: true,
    cardCount: stats.cardCount || 0,
    workCount: 0,
    problemCount: stats.problemCount || 0,
    lastSyncAt: stats.loadedAt || "",
    tokenMeta: payload.tokenMeta || portal.tokenMeta || {},
    syncStatus: "loaded",
  });
}

function manualBootstrapNotice(portal, action = "create") {
  const bootstrap = portal?.manualBootstrap || {};
  const count = Number(bootstrap.cardCount || portal?.cardCount || 0);
  if (count > 0) {
    return action === "refresh"
      ? `MPStats обновил витрину: ${count} ${pluralRu(count, "карточка", "карточки", "карточек")}.`
      : `Кабинет создан, MPStats загрузил ${count} ${pluralRu(count, "карточку", "карточки", "карточек")}.`;
  }
  const warning = Array.isArray(bootstrap.warnings) ? bootstrap.warnings[0] : "";
  if (warning) {
    return warning;
  }
  if (bootstrap.status === "skipped") {
    return "Кабинет создан без API. Добавьте ссылку на магазин или список nmID, чтобы загрузить карточки через MPStats.";
  }
  return action === "refresh"
    ? "MPStats не нашел карточки по сохраненной ссылке или описанию."
    : "Кабинет создан без API, карточки пока не загружены.";
}

function getPortalTeam(portal) {
  const roles = portal?.teamRoles || {};
  return {
    lead: roles.lead || portal?.ownerLogin || "manager",
    tech: roles.tech || "specialist",
    manager: roles.manager || "manager",
  };
}

function portalCreatedDateLabel(portal) {
  const createdAt = portal?.createdAt || "";
  if (!createdAt) {
    return "";
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ru-RU");
}

function portalCreatorInfo(portal, findUser) {
  const login = portal?.createdBy || "";
  const user = login ? findUser?.(login) : null;
  return {
    login,
    name: user?.full_name || login || "не указан",
    date: portalCreatedDateLabel(portal),
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

function issueCopy(issue, sourceLabel = "WB API") {
  const copies = {
    "Нет бренда": `${sourceLabel} не вернул бренд. Нужно проверить бренд в кабинете и не подставлять его вручную без подтверждения.`,
    "Нет описания": "В текущем снимке нет описания. Перед правками нужно подтянуть описание или заполнить его вручную.",
    "Пустые характеристики": `${sourceLabel} не вернул характеристики. Нужно сверить обязательные поля категории перед публикацией.`,
    "Нет фото": "В текущем снимке нет фото. Нужно проверить медиа в кабинете WB перед аудитом.",
    "Нет названия": "У карточки нет названия. Нужно заполнить заголовок до 60 символов.",
    "Название длиннее 60": "Название превышает лимит WB. Нужно сократить его до 60 символов без потери смысла.",
    "Габариты требуют проверки": "WB пометил габариты как требующие проверки. Перед публикацией нужно сверить размеры.",
  };
  return copies[issue] || `Карточка требует ручной проверки по данным из ${sourceLabel}.`;
}

function cardProblemReasons(card) {
  if (Number(card?.issueCount || 0) === 0 || card?.issue === "Нет критичных") {
    return [];
  }
  const reasons = [];
  const title = String(card?.title || "").trim();
  if (!title || title === "Карточка WB") {
    reasons.push("нет названия");
  } else if (title.length > 60) {
    reasons.push("название длиннее 60");
  }
  if (!String(card?.description || "").trim()) {
    reasons.push("нет описания");
  }
  if (!rawCharacteristicItems(card).length) {
    reasons.push("пустые характеристики");
  }
  const photos = Array.isArray(card?.photos) ? card.photos : [];
  if (!photos.length && !card?.photoUrl) {
    reasons.push("нет фото");
  }
  if (card?.dimensions?.isValid === false) {
    reasons.push("габариты требуют проверки");
  }
  if (!reasons.length && Number(card?.issueCount || 0) > 0 && card?.issue && !["Нет критичных", "Нет бренда"].includes(card.issue)) {
    reasons.push(String(card.issue).toLowerCase());
  }
  return [...new Set(reasons)];
}

function cardDataSignals(card) {
  const signals = [];
  if (!String(card?.brand || "").trim()) {
    signals.push("бренд не указан в WB");
  }
  return signals;
}

function cardCompleteness(card) {
  const issues = cardProblemReasons(card);
  if (!issues.length) {
    return { label: "Достаточная", tone: "green" };
  }
  if (issues.length === 1) {
    return { label: "Есть пробел", tone: "amber" };
  }
  return { label: "Есть пробелы", tone: "red" };
}

function cardWorkStateForTask(card, selectedSet, task) {
  if (task) {
    const labels = workTypeLabels(task.workTypes);
    return {
      label: labels.length ? labels.join(", ") : approvalStatusLabel(task.status),
      tone: approvalStatusTone(task.status),
    };
  }
  if (selectedSet.has(cardStableKey(card))) {
    return { label: "В наборе", tone: "blue" };
  }
  return { label: "Нет задачи", tone: "green" };
}

function cardTaskLookupKeys(card) {
  return [
    cardStableKey(card),
    card?.nmID ? `nm:${card.nmID}` : "",
    card?.vendorCode ? `vendor:${card.vendorCode}` : "",
  ].filter(Boolean).map(String);
}

function approvalTaskLookupKeys(task) {
  return [
    task?.cardKey,
    task?.nmID ? `nm:${task.nmID}` : "",
    task?.vendorCode ? `vendor:${task.vendorCode}` : "",
  ].filter(Boolean).map(String);
}

function buildApprovalTaskLookup(tasks) {
  const lookup = new Map();
  const priority = { submitted: 4, changes_requested: 3, approved: 2, exported: 1, draft: 0 };
  (tasks || []).forEach((task) => {
    approvalTaskLookupKeys(task).forEach((key) => {
      const current = lookup.get(key);
      if (!current || (priority[task.status] || 0) > (priority[current.status] || 0)) {
        lookup.set(key, task);
      }
    });
  });
  return lookup;
}

function approvalTaskForCard(card, lookup) {
  for (const key of cardTaskLookupKeys(card)) {
    const task = lookup.get(key);
    if (task) {
      return task;
    }
  }
  return null;
}

function normalizedCardSearchText(card) {
  return [
    card?.title,
    card?.nmID,
    card?.vendorCode,
    card?.brand,
    card?.subjectName,
    card?.status,
    card?.issue,
    ...cardDataSignals(card),
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function cardStableKey(card) {
  return cardDraftKey(card);
}

function cardWorksetPayload(card) {
  return {
    cardKey: cardStableKey(card),
    nmID: card?.nmID || "",
    vendorCode: card?.vendorCode || "",
    title: card?.title || "",
    subjectName: card?.subjectName || "",
  };
}

function readCardWorkset(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeCardWorkset(storageKey, keys) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...new Set(keys.map(String).filter(Boolean))]));
  } catch {
    // Local persistence is a convenience layer only.
  }
}

function titleSuggestions(card) {
  const title = textOrDash(card?.title);
  const subject = String(card?.subjectName || "").trim();
  const brand = String(card?.brand || "").trim();
  const base = title === "Не указано" ? (subject || "Карточка WB") : title;
  const compactBase = base
    .replace(/\s+/g, " ")
    .replace(/[|/]+/g, " ")
    .trim();
  const signals = contentAuditSignals(card);
  const generatedTitle = titleQualityIssues(compactBase, card).length
    ? buildContentTitleCandidate(compactBase, subject, brand, signals)
    : "";
  const values = [
    generatedTitle,
    compactBase,
    subject && !compactBase.toLowerCase().includes(subject.toLowerCase().slice(0, -1)) ? `${subject} ${compactBase}` : "",
    brand && !compactBase.toLowerCase().includes(brand.toLowerCase()) ? `${compactBase} ${brand}` : "",
  ].filter(Boolean);
  const unique = [...new Set(values.map((value) => value.slice(0, 60)))];
  while (unique.length < 3) {
    unique.push(compactBase.slice(0, 60));
  }
  return unique.slice(0, 3);
}

function titleQualityIssues(title, card) {
  const text = String(title || "").trim();
  const issues = [];
  if (!text || text === "Не указано") {
    issues.push("нет названия");
  }
  if (text.length > 60) {
    issues.push("длиннее лимита WB");
  }
  if (/[|/]{2,}|\s{2,}/.test(text)) {
    issues.push("лишние разделители или пробелы");
  }
  const subject = String(card?.subjectName || "").trim().toLowerCase();
  if (subject && text.length < 24 && !text.toLowerCase().includes(subject.slice(0, Math.max(4, subject.length - 1)))) {
    issues.push("слишком общее название");
  }
  return issues;
}

function rawCharacteristicItems(card) {
  const raw = card?.characteristics || card?.rawFields?.characteristics || [];
  return Array.isArray(raw) ? raw : [];
}

function rawCharacteristicValueTokens(value) {
  if (isEmptyValue(value)) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(rawCharacteristicValueTokens);
  }
  if (typeof value === "object") {
    return rawCharacteristicValueTokens(value.value || value.name || value.charcName || value.values || "");
  }
  return String(value)
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function characteristicValuesByAliases(card, aliases) {
  const normalizedAliases = aliases.map(normalizedCharacteristicOption);
  const values = [];
  for (const item of rawCharacteristicItems(card)) {
    const label = normalizedCharacteristicOption(item?.name || item?.charcName || "");
    if (!label || !normalizedAliases.some((alias) => label.includes(alias))) {
      continue;
    }
    values.push(...rawCharacteristicValueTokens(item.value ?? item.values ?? item));
  }
  return [...new Set(values)].slice(0, 4);
}

function materialAdjective(value) {
  const normalized = normalizedCharacteristicOption(value);
  if (normalized.includes("хлоп")) return "хлопковая";
  if (normalized.includes("трикотаж")) return "трикотажная";
  if (normalized.includes("шелк") || normalized.includes("шёлк")) return "шелковая";
  if (normalized.includes("вискоз")) return "вискозная";
  if (normalized.includes("фланел")) return "фланелевая";
  if (normalized.includes("махр")) return "махровая";
  return String(value || "").trim();
}

function genderAdjective(value) {
  const normalized = normalizedCharacteristicOption(value);
  if (normalized.includes("жен")) return "женская";
  if (normalized.includes("муж")) return "мужская";
  if (normalized.includes("дет")) return "детская";
  if (normalized.includes("унисекс")) return "унисекс";
  return "";
}

function subjectForTitle(subject, fallbackTitle) {
  const normalizedSubject = normalizedCharacteristicOption(subject);
  if (normalizedSubject.includes("пижам")) {
    return "Пижама";
  }
  if (subject) {
    return subject.replace(/\s+/g, " ").trim();
  }
  return fallbackTitle.split(/\s+/).slice(0, 2).join(" ");
}

function contentAuditSignals(card) {
  return {
    gender: characteristicValuesByAliases(card, ["пол", "гендер"])[0] || "",
    material: characteristicValuesByAliases(card, ["состав", "материал", "ткань"])[0] || "",
    color: characteristicValuesByAliases(card, ["цвет"])[0] || "",
    texture: characteristicValuesByAliases(card, ["фактура"])[0] || "",
    kit: characteristicValuesByAliases(card, ["комплектация", "комплект"])[0] || "",
    sleeve: characteristicValuesByAliases(card, ["длина рукава", "рукав"])[0] || "",
    features: characteristicValuesByAliases(card, ["особенности", "назначение"]).slice(0, 3),
  };
}

function buildContentTitleCandidate(currentTitle, subject, brand, signals) {
  const title = currentTitle || "";
  const titleLower = title.toLowerCase();
  const base = subjectForTitle(subject, title);
  const parts = [
    base,
    genderAdjective(signals.gender),
    materialAdjective(signals.material),
  ].filter(Boolean);
  const kit = normalizedCharacteristicOption(signals.kit || title).includes("штан")
    ? "со штанами"
    : "";
  if (kit) {
    parts.push(kit);
  }
  if (signals.color && !titleLower.includes(String(signals.color).toLowerCase())) {
    parts.push(signals.color);
  }
  if (brand && !parts.join(" ").toLowerCase().includes(brand.toLowerCase()) && !titleLower.includes(brand.toLowerCase())) {
    parts.push(brand);
  }
  const candidate = parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate && candidate.length >= 8 ? candidate : title;
}

function descriptionQualityIssues(description, card) {
  const text = String(description || "").trim();
  if (!text) {
    return ["нет описания"];
  }
  const lower = text.toLowerCase();
  const subject = String(card?.subjectName || "").trim().toLowerCase();
  const titleWords = String(card?.title || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 4);
  const issues = [];
  if (text.length < 250) {
    issues.push("короткое описание");
  }
  if (text.length > 5000) {
    issues.push("слишком длинное описание");
  }
  if (subject && !lower.includes(subject.slice(0, Math.max(4, subject.length - 1)))) {
    issues.push("категория не раскрыта в тексте");
  }
  if (titleWords.length && titleWords.filter((word) => lower.includes(word)).length < Math.min(2, titleWords.length)) {
    issues.push("мало связки с заголовком");
  }
  if (!/[.!?]\s+\S/.test(text) && text.length > 180) {
    issues.push("текст выглядит как один длинный блок");
  }
  if (!/(состав|материал|уход|размер|посадк|комплект|назначен|подход)/i.test(text)) {
    issues.push("мало покупательских деталей");
  }
  return issues;
}

function descriptionSuggestion(card, description) {
  const current = String(description || "").trim();
  const issues = descriptionQualityIssues(current, card);
  const subject = String(card?.subjectName || "").trim();
  const brand = String(card?.brand || "").trim();
  const title = textOrDash(card?.title);
  const signals = contentAuditSignals(card);
  const detailParts = [
    signals.material ? `материал: ${signals.material}` : "",
    signals.color ? `цвет: ${signals.color}` : "",
    signals.texture ? `фактура: ${signals.texture}` : "",
    signals.kit ? `комплектация: ${signals.kit}` : "",
    signals.sleeve ? `рукав: ${signals.sleeve}` : "",
    signals.features.length ? `особенности: ${signals.features.join(", ")}` : "",
  ].filter(Boolean);
  const structuredDraft = [
    [title, brand, subject].filter((value, index, list) => value && value !== "Не указано" && list.indexOf(value) === index).join(". "),
    detailParts.length ? `В карточке стоит усилить покупательские детали: ${detailParts.join("; ")}.` : "",
    "Опишите посадку, состав, ощущения от ткани, комплектацию, сезонность, уход и сценарии использования простым языком для покупателя.",
  ].filter(Boolean).join("\n\n");
  if (current && !issues.length) {
    return current;
  }
  if (current) {
    const additions = [
      subject ? `Подходит для категории: ${subject}.` : "",
      brand && !current.toLowerCase().includes(brand.toLowerCase()) ? `Бренд: ${brand}.` : "",
      detailParts.length ? `Добавьте в текст: ${detailParts.join("; ")}.` : "",
      "Проверьте состав, посадку, комплектацию, уход и сценарии использования перед публикацией.",
    ].filter(Boolean);
    return [current, ...additions].join("\n\n");
  }
  return structuredDraft;
}

function titleAuditReason(card, currentTitle, draftTitle) {
  const issues = titleQualityIssues(currentTitle, card);
  if (issues.includes("нет названия")) {
    return "WB не вернул название, поэтому аудит предлагает собрать его из категории, бренда и текущих данных карточки.";
  }
  if (issues.includes("лишние разделители или пробелы")) {
    return "В названии есть лишние разделители или пробелы; аудит предлагает более чистый вариант в лимите WB.";
  }
  if (issues.includes("длиннее лимита WB")) {
    return "Название длиннее лимита WB 60 символов, поэтому аудит предлагает укоротить его.";
  }
  if (issues.includes("слишком общее название")) {
    return "Название слишком общее, поэтому аудит предлагает добавить категорию или понятные товарные признаки.";
  }
  if (draftTitle !== currentTitle) {
    return "Аудит предложил вариант на основе текущей категории и характеристик WB.";
  }
  return "Название уже укладывается в лимит WB, поэтому аудит оставил его без изменения.";
}

function descriptionAuditReason(description, card) {
  const issues = descriptionQualityIssues(description, card);
  if (String(description || "").trim()) {
    if (issues.length) {
      return `Описание есть, но аудит нашел зоны улучшения: ${issues.join(", ")}. Черновик добавляет структуру и детали для ручной доработки.`;
    }
    return "Описание проходит базовую проверку, поэтому аудит оставил его без изменения.";
  }
  return "В WB нет описания, поэтому аудит собрал базовый черновик из названия, бренда и категории.";
}

function formatMarketShare(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (value >= 10) {
    return `${Math.round(value)}%`;
  }
  return `${Math.round(value * 10) / 10}%`;
}

function mpstatsValueLabel(item) {
  const share = formatMarketShare(item?.share);
  return `${item?.value || ""}${share ? ` ${share}` : ""}`.trim();
}

function characteristicAuditReason(row, mpstatsStats = [], nextValues = [], currentValues = []) {
  if (mpstatsStats.length) {
    const marketValues = mpstatsStats.slice(0, 3).map(mpstatsValueLabel).filter(Boolean).join(", ");
    const currentSet = new Set(currentValues.map(normalizedCharacteristicOption));
    const changedByMarket = nextValues.some((value) => !currentSet.has(normalizedCharacteristicOption(value)));
    if (changedByMarket) {
      return `В топе категории чаще встречается: ${marketValues}. Аудит предложил значения из MPStats для сравнения с текущим заполнением.`;
    }
    return `Текущее значение совпадает с частыми вариантами в топе категории: ${marketValues}.`;
  }
  if (isEmptyValue(row.value)) {
    return "Характеристика пустая в WB, ее нужно проверить перед публикацией.";
  }
  return "Значение уже заполнено в WB; аудит перенес его в черновик как базу для ручной правки.";
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

function characteristicDraftValuesFromMarket(row, meta, mpstatsCharacteristics = []) {
  const currentValues = characteristicValueTokens(row.value);
  const stats = mpstatsValueStatsForCharacteristic(meta || row, mpstatsCharacteristics);
  if (!stats.length) {
    return { values: currentValues, stats };
  }
  const limit = characteristicValueLimit(meta || row);
  const maxValues = limit || Math.max(currentValues.length, 3);
  const values = stats.slice(0, maxValues).map((item) => item.value).filter(Boolean);
  return { values: values.length ? values : currentValues, stats };
}

function characteristicDraftsFromRows(rows, source = "audit", mpstatsCharacteristics = [], availableCharacteristics = []) {
  const metaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  return Object.fromEntries(rows.map((row) => {
    const meta = metaByKey[row.key] || row;
    const marketDraft = source === "audit"
      ? characteristicDraftValuesFromMarket(row, meta, mpstatsCharacteristics)
      : null;
    const values = marketDraft ? marketDraft.values : characteristicValueTokens(row.value);
    return [row.key, {
      charcID: row.charcID,
      label: row.label,
      value: values.length ? values.join(", ") : editableCharacteristicValue(row.value),
      values,
      source,
      reason: source === "audit"
        ? characteristicAuditReason(row, marketDraft.stats, values, characteristicValueTokens(row.value))
        : "",
    }];
  }));
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
    return `${filledCount}/${limit}`;
  }
  if (Number(meta?.charcType) === 1 && Number(meta?.maxCount || 0) === 0) {
    return filledCount ? `${filledCount}` : "";
  }
  return filledCount ? `${filledCount}` : "";
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

const CHARACTERISTIC_NAME_STOPWORDS = new Set([
  "для",
  "вид",
  "тип",
  "товар",
  "товара",
  "изделие",
  "изделия",
  "модель",
  "модели",
  "материал",
  "материала",
  "характеристика",
  "значение",
]);

const AMBIGUOUS_SINGLE_CHARACTERISTIC_TOKENS = new Set([
  "длин",
  "ширин",
  "высот",
  "размер",
  "объем",
  "вес",
]);

const CHARACTERISTIC_ALIAS_GROUPS = [
  ["тип рукавов", "тип рукава", "длина рукава", "длина рукавов", "длина рукава изделия", "длина рукавов изделия", "рукав", "рукава", "рукава модель"],
  ["тип карманов", "карманы", "вид кармана", "карман"],
  ["фактура материала", "фактура", "структура материала", "текстура материала"],
  ["особенности модели", "особенности", "особенности товара"],
  ["декоративные элементы", "декор", "элементы декора"],
  ["конструктивные элементы", "конструктивные особенности", "элементы конструкции"],
  ["назначение", "назначение товара", "назначение модели"],
  ["покрой", "силуэт", "крой"],
  ["тип застежки", "застежка", "вид застежки"],
  ["вырез горловины", "горловина", "тип горловины"],
  ["рисунок", "принт", "узор"],
];

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

function normalizedCharacteristicName(value) {
  return normalizedCharacteristicOption(value)
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemCharacteristicToken(token) {
  let output = String(token || "");
  if (output.length > 5) {
    output = output.replace(/(ыми|ими|ого|его|ому|ему|ами|ями|ах|ях|ов|ев|ей|ом|ем)$/u, "");
  }
  if (output.length > 4) {
    output = output.replace(/(ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ам|ям|а|я|ы|и|у|ю|е)$/u, "");
  }
  return output;
}

function characteristicNameTokens(value) {
  return normalizedCharacteristicName(value)
    .split(" ")
    .map(stemCharacteristicToken)
    .filter((token) => token.length > 1 && !CHARACTERISTIC_NAME_STOPWORDS.has(token));
}

function characteristicAliasMatches(left, right) {
  const leftName = normalizedCharacteristicName(left);
  const rightName = normalizedCharacteristicName(right);
  return CHARACTERISTIC_ALIAS_GROUPS.some((group) => {
    const names = group.map(normalizedCharacteristicName);
    return names.includes(leftName) && names.includes(rightName);
  });
}

function characteristicNameMatchScore(left, right) {
  const leftName = normalizedCharacteristicName(left);
  const rightName = normalizedCharacteristicName(right);
  if (!leftName || !rightName) {
    return 0;
  }
  if (leftName === rightName) {
    return 1;
  }
  if (characteristicAliasMatches(leftName, rightName)) {
    return 0.96;
  }
  const leftTokens = [...new Set(characteristicNameTokens(leftName))];
  const rightTokens = [...new Set(characteristicNameTokens(rightName))];
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  if (!overlap) {
    return 0;
  }
  const leftCoverage = overlap / leftTokens.length;
  const rightCoverage = overlap / rightTokens.length;
  if (leftTokens.includes("рукав") && rightTokens.includes("рукав")) {
    return 0.9;
  }
  if (leftTokens.length === 1 && rightTokens.includes(leftTokens[0]) && !AMBIGUOUS_SINGLE_CHARACTERISTIC_TOKENS.has(leftTokens[0])) {
    return 0.82;
  }
  if (leftCoverage >= 0.66 && rightCoverage >= 0.5) {
    return 0.72 + Math.min(leftCoverage, rightCoverage) * 0.18;
  }
  return 0;
}

function matchingMpstatsCharacteristics(meta, mpstatsCharacteristics = []) {
  const label = meta?.name || meta?.label || "";
  return scoredMpstatsCharacteristics(label, mpstatsCharacteristics)
    .filter((match) => match.score >= 0.72)
    .sort((left, right) => right.score - left.score);
}

function characteristicIsPromotionRelevant(meta, mpstatsCharacteristics = []) {
  return Boolean(
    meta?.required
    || meta?.popular
    || meta?.hasFilter
    || matchingMpstatsCharacteristics(meta, mpstatsCharacteristics).some((match) => match.item?.promotionRelevant)
  );
}

function scoredMpstatsCharacteristics(label, mpstatsCharacteristics = []) {
  return (mpstatsCharacteristics || [])
    .map((item) => ({
      item,
      score: characteristicNameMatchScore(label, item?.name || ""),
    }));
}

function nearbyMpstatsCharacteristicNames(meta, mpstatsCharacteristics = []) {
  const label = meta?.name || meta?.label || "";
  const labelTokens = characteristicNameTokens(label);
  return scoredMpstatsCharacteristics(label, mpstatsCharacteristics)
    .filter((match) => {
      if (match.score >= 0.72) {
        return false;
      }
      const mpstatsTokens = characteristicNameTokens(match.item?.name || "");
      return labelTokens.some((token) => mpstatsTokens.includes(token));
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((match) => match.item?.name)
    .filter(Boolean);
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

function characteristicValueSourceText(meta, hasOptions) {
  if (characteristicUsesStrictValues(meta)) {
    return "WB";
  }
  if (hasOptions) {
    return "подсказки";
  }
  return "свое";
}

function characteristicValueMetaTitle(meta, hasOptions, valuesCount, isAuditSuggestion, hasDraft, mpstatsCount = 0) {
  const details = [];
  const limit = characteristicValueLimit(meta);
  if (limit) {
    details.push(`Заполнено ${valuesCount} из ${limit}`);
  } else if (valuesCount) {
    details.push(`Заполнено ${valuesCount}`);
  }
  if (characteristicUsesStrictValues(meta)) {
    details.push("Выбор из справочника WB");
  } else if (hasOptions) {
    details.push("Подсказки собраны из карточек и справочников, свое значение разрешено");
  } else {
    details.push("Свое значение разрешено");
  }
  if (isAuditSuggestion) {
    details.push("Рекомендация аудита");
  } else if (hasDraft) {
    details.push("Ручная правка");
  }
  if (mpstatsCount) {
    details.push(`MPStats дал ${mpstatsCount} значений для этой характеристики`);
  }
  return details.join(". ");
}

function characteristicValueOptionsByKey(portal, currentRows, availableCharacteristics = [], mpstatsCharacteristics = []) {
  const options = {};
  const metaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  currentRows.forEach((row) => {
    const meta = metaByKey[row.key] || row;
    const wbOptions = Array.isArray(meta.valueOptions) ? meta.valueOptions : [];
    const mpstatsOptions = mpstatsValuesForCharacteristic(meta, mpstatsCharacteristics);
    options[row.key] = [...characteristicValueTokens(row.value), ...wbOptions, ...mpstatsOptions, ...fallbackCharacteristicValueOptions(row.label)];
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
    const mpstatsOptions = mpstatsValuesForCharacteristic(item, mpstatsCharacteristics);
    options[key] = [...current, ...wbOptions, ...mpstatsOptions, ...fallbackCharacteristicValueOptions(item.name)];
  });
  return Object.fromEntries(Object.entries(options).map(([key, values]) => [
    key,
    uniqueCharacteristicOptions(values),
  ]));
}

function mpstatsValuesForCharacteristic(meta, mpstatsCharacteristics = []) {
  return uniqueCharacteristicOptions(
    matchingMpstatsCharacteristics(meta, mpstatsCharacteristics)
      .flatMap((match) => match.item?.values || [])
      .map((value) => value?.value || value)
      .filter(Boolean)
  );
}

function mpstatsValueStatsForCharacteristic(meta, mpstatsCharacteristics = []) {
  const byValue = new Map();
  matchingMpstatsCharacteristics(meta, mpstatsCharacteristics)
    .flatMap((match) => match.item?.values || [])
    .forEach((item) => {
      const value = String(item?.value || item || "").trim();
      if (!value) {
        return;
      }
      const key = normalizedCharacteristicOption(value);
      const score = Number(item?.score);
      const current = byValue.get(key) || { value, score: 0, hasScore: false };
      if (Number.isFinite(score)) {
        current.score += Math.max(0, score);
        current.hasScore = true;
      }
      byValue.set(key, current);
    });
  const values = [...byValue.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.value.localeCompare(right.value, "ru");
  });
  const total = values.reduce((sum, item) => sum + (item.hasScore ? item.score : 0), 0);
  return values.map((item) => ({
    value: item.value,
    score: item.hasScore ? item.score : null,
    share: item.hasScore && total > 0 ? (item.score / total) * 100 : null,
  }));
}

function countMpstatsMatches(rows, availableCharacteristics = [], mpstatsCharacteristics = []) {
  const metaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  return rows.filter((row) => {
    const meta = metaByKey[row.key] || row;
    return mpstatsValuesForCharacteristic(meta, mpstatsCharacteristics).length > 0;
  }).length;
}

function countPromotionRelevantCharacteristics(rows, availableCharacteristics = [], mpstatsCharacteristics = []) {
  const metaByKey = Object.fromEntries((availableCharacteristics || []).map((item) => [characteristicKeyFromMeta(item), item]));
  return rows.filter((row) => characteristicIsPromotionRelevant(metaByKey[row.key] || row, mpstatsCharacteristics)).length;
}

function requestDurationText(milliseconds) {
  if (typeof milliseconds !== "number") {
    return "";
  }
  return `${Math.max(0.1, milliseconds / 1000).toFixed(1)}с`;
}

function characteristicExportText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("; ");
  }
  return String(value ?? "").trim();
}

function buildContentExportSheets(card, draftTitle, draftDescription, draftCharacteristics) {
  const characteristics = draftCharacteristicsList(draftCharacteristics);
  const characteristicHeaders = characteristics.map((item) => item.name);
  const characteristicValues = characteristics.map((item) => characteristicExportText(item.value));
  const baseHeaders = ["Артикул продавца", "Номенклатура WB", "Предмет", "ID предмета", "Бренд", "Название", "Описание"];
  const baseValues = [
    card?.vendorCode || "",
    card?.nmID || "",
    card?.subjectName || "",
    card?.subjectID || card?.rawFields?.subjectID || "",
    card?.brand || "",
    draftTitle || "",
    draftDescription || "",
  ];
  const characteristicRows = [
    ["Артикул продавца", "Номенклатура WB", "Характеристика", "charcID", "Значение"],
    ...characteristics.map((item) => [
      card?.vendorCode || "",
      card?.nmID || "",
      item.name,
      item.charcID,
      characteristicExportText(item.value),
    ]),
  ];

  return [
    {
      name: "Контент WB",
      freezeRows: 1,
      widths: [24, 18, 26, 14, 18, 42, 70, ...characteristicHeaders.map(() => 28)],
      rows: [
        [...baseHeaders, ...characteristicHeaders],
        [...baseValues, ...characteristicValues],
      ],
    },
    {
      name: "Характеристики",
      freezeRows: 1,
      widths: [24, 18, 32, 14, 48],
      rows: characteristicRows,
    },
    {
      name: "Инструкция",
      widths: [34, 96],
      rows: [
        ["Раздел WB", "Что делать"],
        ["Карточка товара", "В ЛК WB откройте Товары и цены -> Карточка товара, выберите карточки и используйте массовое редактирование или категорийный XLSX-шаблон."],
        ["Категория", "WB формирует точный шаблон под предмет/категорию. Перенесите значения из листа Контент WB в соответствующие колонки шаблона WB."],
        ["Характеристики", "Лист Характеристики дублирует значения в построчном виде: удобно сверять charcID и переносить спорные поля вручную."],
      ],
    },
  ];
}

function cardDraftKey(card) {
  return String(card?.nmID || card?.vendorCode || card?.nmUUID || "card").trim();
}

const MPSTATS_NICHE_PATH_WARNING = "Рыночный контекст MPStats по нише не загрузился: не удалось определить путь категории. Конкуренты, ценовые зоны и выводы по нише рассчитаны только по доступным данным карточки.";

function auditPublicWarningText(message) {
  const text = String(message || "").trim();
  if (!text) return "";
  if (
    text.startsWith("MPStats /analytics/v1/wb/subject/")
    || text.includes("MPStats niche path missing")
    || text.includes("Не удалось выбрать конкурентов из MPStats subject/items")
  ) {
    return MPSTATS_NICHE_PATH_WARNING;
  }
  if (text.includes("Доли значений характеристик рассчитаны по MPStats/выборке")) {
    return "MPStats-значения характеристик — статистическая подсказка по выборке ниши, не официальный справочник WB; перед публикацией специалист должен подтвердить релевантность.";
  }
  if (text.includes("items/") && text.includes("/keywords")) {
    return "SEO-запросы MPStats по карточке не загрузились. Рекомендации по заголовку и описанию нужно дополнительно сверить вручную.";
  }
  if (text.includes("items/") && text.includes("/full")) {
    return "Метрики продаж MPStats по карточке не загрузились. Выводы по динамике продаж и выкупу не использовались.";
  }
  if (text.startsWith("MPStats ") && text.includes("items/")) {
    return "Данные MPStats по карточке загрузились не полностью. Аудит использовал доступные WB-данные и локальные правила.";
  }
  if (text === "MPStats key missing" || text.includes("MPStats ключ не настроен")) {
    return "MPStats не подключен или временно недоступен: аудит выполнен по WB snapshot и локальным правилам.";
  }
  if (text.includes("characteristics-analysis") || text.includes("MPStats characteristics-analysis")) {
    return "MPStats-подсказки характеристик не загрузились. Значения характеристик нужно сверить по WB и вручную.";
  }
  if (text.startsWith("WB CDN")) {
    return "Публичный снимок карточки WB CDN не загрузился; использован сохраненный WB snapshot.";
  }
  if (text.includes("WB справочник характеристик")) {
    return "Справочник характеристик WB не загрузился. Лимиты и обязательность некоторых полей нужно проверить вручную.";
  }
  if (text.includes("LLM refinement") || text.includes("LLM вернул")) {
    return "LLM-переформулировка недоступна; показан базовый аудит по фактам без дополнительной текстовой обработки.";
  }
  return text;
}

function auditPublicWarnings(warnings, limit = 8) {
  const seen = new Set();
  const result = [];
  (Array.isArray(warnings) ? warnings : []).forEach((item) => {
    const text = auditPublicWarningText(item);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result.slice(0, limit);
}

function sanitizeAuditSummary(summary) {
  if (!summary || typeof summary !== "object") return summary || {};
  const next = { ...summary };
  if (Array.isArray(next.riskNotes)) {
    next.riskNotes = auditPublicWarnings(next.riskNotes);
  }
  return next;
}

function sanitizeAuditHistory(history) {
  return (Array.isArray(history) ? history : []).map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    return {
      ...entry,
      summary: sanitizeAuditSummary(entry.summary),
    };
  });
}

function sanitizeAuditResult(result) {
  if (!result || typeof result !== "object") return result || null;
  return {
    ...result,
    summary: sanitizeAuditSummary(result.summary),
  };
}

function sanitizeEvidenceSummary(summary) {
  if (!summary || typeof summary !== "object") return summary || null;
  return {
    ...summary,
    warnings: Array.isArray(summary.warnings) ? auditPublicWarnings(summary.warnings) : summary.warnings,
  };
}

function buildStructuredCardDraft({
  auditStatus,
  auditHistory,
  approval,
  approvalSections,
  title,
  titleSource,
  titleReason,
  description,
  descriptionSource,
  descriptionReason,
  characteristics,
  prices,
  stocks,
  semanticCoreSelected,
  semanticCoreReports,
  card,
  auditResult,
  evidenceSummary,
}) {
  const normalizedApprovalSections = normalizeApprovalSections(approvalSections, approval);
  return {
    version: 2,
    auditStatus,
    content: {
      title: {
        value: title || "",
        source: titleSource || "",
        reason: titleReason || "",
      },
      description: {
        value: description || "",
        source: descriptionSource || "",
        reason: descriptionReason || "",
      },
      characteristics: characteristics || {},
    },
    prices: prices || {},
    stocks: stocks || {},
    meta: {
      approval: deriveOverallApproval(normalizedApprovalSections),
      approvalSections: normalizedApprovalSections,
      auditContract: {
        version: "sergey-audit-v1",
        sections: ["title", "description", "characteristics"],
        expectedOutputs: ["value", "reason", "evidence", "confidence"],
      },
      auditHistory: sanitizeAuditHistory(auditHistory).slice(0, 20),
      semanticCoreSelected: normalizeSemanticSelection(semanticCoreSelected),
      semanticCoreReports: normalizeSemanticReports(semanticCoreReports),
      auditResult: sanitizeAuditResult(auditResult),
      evidenceSummary: sanitizeEvidenceSummary(evidenceSummary),
      card: {
        nmID: card?.nmID || "",
        vendorCode: card?.vendorCode || "",
        subjectID: card?.subjectID || card?.rawFields?.subjectID || "",
        subjectName: card?.subjectName || "",
      },
      updatedIn: "opticards-card-detail",
    },
  };
}

function contentFromStoredDraft(storedDraft, card = {}) {
  const payload = storedDraft?.draft || storedDraft || {};
  const content = payload.content || payload;
  const title = content.title || {};
  const description = content.description || {};
  const meta = payload.meta || {};
  const approval = normalizeApprovalState(meta.approval);
  const approvalSections = normalizeApprovalSections(meta.approvalSections, approval);
  return {
    auditStatus: payload.auditStatus || storedDraft?.auditStatus || "idle",
    title: typeof title === "object" ? title.value || "" : payload.title || "",
    description: typeof description === "object" ? description.value || "" : payload.description || "",
    titleSource: typeof title === "object" ? title.source || "" : payload.titleSource || "",
    descriptionSource: typeof description === "object" ? description.source || "" : payload.descriptionSource || "",
    titleReason: typeof title === "object" ? title.reason || "" : payload.titleReason || "",
    descriptionReason: typeof description === "object" ? description.reason || "" : payload.descriptionReason || "",
    characteristics: normalizeDraftCharacteristics(content.characteristics || payload.characteristics || {}),
    prices: normalizeDraftPrices(payload.prices, card),
    stocks: normalizeDraftStocks(payload.stocks, card),
    semanticCoreSelected: normalizeSemanticSelection(meta.semanticCoreSelected),
    semanticCoreReports: normalizeSemanticReports(meta.semanticCoreReports),
    auditHistory: sanitizeAuditHistory(meta.auditHistory),
    approval: deriveOverallApproval(approvalSections),
    approvalSections,
    savedAt: storedDraft?.updatedAt || payload.savedAt || "",
  };
}

function storedDraftPayload(storedDraft) {
  return storedDraft?.draft && typeof storedDraft.draft === "object"
    ? storedDraft.draft
    : storedDraft || {};
}

function storedDraftMeta(storedDraft) {
  const payload = storedDraftPayload(storedDraft);
  return payload.meta && typeof payload.meta === "object" ? payload.meta : {};
}

function storedDraftTimestamp(storedDraft) {
  const payload = storedDraftPayload(storedDraft);
  return Date.parse(storedDraft?.updatedAt || storedDraft?.savedAt || payload.savedAt || "") || 0;
}

function storedDraftSemanticReports(storedDraft) {
  return normalizeSemanticReports(storedDraftMeta(storedDraft).semanticCoreReports);
}

function mergeStoredDraftSemantics(primaryDraft, fallbackDraft) {
  if (!primaryDraft || !fallbackDraft) return primaryDraft;
  const primaryReports = storedDraftSemanticReports(primaryDraft);
  const fallbackReports = storedDraftSemanticReports(fallbackDraft);
  if (!fallbackReports.length) return primaryDraft;
  const fallbackIsBetter = !primaryReports.length
    || fallbackReports.length > primaryReports.length
    || (storedDraftTimestamp(fallbackDraft) > storedDraftTimestamp(primaryDraft) && fallbackReports.length >= primaryReports.length);
  if (!fallbackIsBetter) return primaryDraft;
  const primaryPayload = storedDraftPayload(primaryDraft);
  const fallbackMeta = storedDraftMeta(fallbackDraft);
  const mergedPayload = {
    ...primaryPayload,
    meta: {
      ...(primaryPayload.meta && typeof primaryPayload.meta === "object" ? primaryPayload.meta : {}),
      semanticCoreSelected: normalizeSemanticSelection(fallbackMeta.semanticCoreSelected),
      semanticCoreReports: fallbackReports,
    },
  };
  return primaryDraft?.draft && typeof primaryDraft.draft === "object"
    ? { ...primaryDraft, draft: mergedPayload }
    : mergedPayload;
}

function countChangedDraftCharacteristics(drafts, rows) {
  return Object.entries(drafts || {}).filter(([key, draft]) => {
    const currentRow = rows.find((row) => row.key === key);
    if (!currentRow) {
      return true;
    }
    const currentSet = new Set(characteristicValueTokens(currentRow.value).map(normalizedCharacteristicOption));
    return draftCharacteristicValues(draft).some((value) => !currentSet.has(normalizedCharacteristicOption(value)));
  }).length;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? "";
}

function firstSku(card) {
  const sizes = Array.isArray(card?.sizes) ? card.sizes : [];
  for (const size of sizes) {
    if (Array.isArray(size?.skus) && size.skus.length) {
      return size.skus[0];
    }
  }
  return "";
}

function sizeStockValue(size) {
  return firstDefined(size?.stock, size?.stocks?.total, size?.sellerStock, size?.wbStock);
}

function sizeStockText(size) {
  const total = sizeStockValue(size);
  if (total === "") {
    return "остаток не загружен";
  }
  const parts = [`остаток ${total}`];
  if (firstDefined(size?.sellerStock) !== "") {
    parts.push(`FBS ${size.sellerStock}`);
  }
  if (firstDefined(size?.wbStock) !== "") {
    parts.push(`WB ${size.wbStock}`);
  }
  return parts.join(" · ");
}

function sizeCommercialRows(sizes) {
  return (Array.isArray(sizes) ? sizes : []).map((size, index) => {
    const skus = Array.isArray(size?.skus) && size.skus.length ? size.skus : [""];
    return {
      key: `${size?.chrtID || size?.chrtId || size?.sizeID || index}:${skus.join("-") || index}`,
      sizeName: size?.techSize || size?.wbSize || `Размер ${index + 1}`,
      skus,
      price: firstDefined(size?.price),
      discountedPrice: firstDefined(size?.discountedPrice),
      clubDiscountedPrice: firstDefined(size?.clubDiscountedPrice),
      stock: sizeStockValue(size),
      sellerStock: firstDefined(size?.sellerStock),
      wbStock: firstDefined(size?.wbStock),
    };
  });
}

function semanticQueryKey(value) {
  const query = typeof value === "string" ? value : value?.query;
  return normalizedCharacteristicOption(query);
}

const semanticSelectionLimit = 2000;

function semanticRankValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function semanticRankExportValue(value) {
  const number = semanticRankValue(value);
  return number === "" ? "" : number;
}

function semanticHasKeywordRank(item) {
  return Boolean(semanticRankValue(item?.orgPos) || semanticRankValue(item?.avgPos) || semanticRankValue(item?.adPos));
}

function semanticKeywordRankParts(item) {
  const parts = [];
  const orgPos = semanticRankValue(item?.orgPos);
  const avgPos = semanticRankValue(item?.avgPos);
  const adPos = semanticRankValue(item?.adPos);
  if (orgPos) parts.push(`органика #${formatNumber(orgPos)}`);
  if (avgPos) parts.push(`средняя #${formatNumber(avgPos)}`);
  if (adPos) parts.push(`реклама #${formatNumber(adPos)}`);
  return parts;
}

function semanticKeywordRankLabel(item) {
  const parts = semanticKeywordRankParts(item);
  return parts.length ? parts.join(" · ") : "позиция не получена";
}

function semanticRankFields(item, period = null) {
  const fields = {};
  const orgPos = semanticRankValue(item?.orgPos);
  const adPos = semanticRankValue(item?.adPos);
  const avgPos = semanticRankValue(item?.avgPos);
  const totalFound = Number(item?.totalFound || 0);
  if (orgPos) fields.orgPos = orgPos;
  if (adPos) fields.adPos = adPos;
  if (avgPos) fields.avgPos = avgPos;
  if (Number.isFinite(totalFound) && totalFound > 0) fields.totalFound = totalFound;
  if (period && Object.keys(fields).length) fields.rankPeriod = period;
  return fields;
}

function semanticMergeKeywordRankings(core, payload) {
  if (!core || typeof core !== "object" || !payload || typeof payload !== "object") return core;
  const rankingRows = [
    ...(Array.isArray(payload.keywords) ? payload.keywords : []),
    ...(Array.isArray(payload.semanticCore?.current) ? payload.semanticCore.current : []),
    ...(Array.isArray(payload.semanticCore?.missing) ? payload.semanticCore.missing : []),
    ...(Array.isArray(payload.semanticCore?.recommended) ? payload.semanticCore.recommended : []),
  ];
  const rankingByKey = new Map();
  const rankedKeywords = [];
  rankingRows.forEach((item) => {
    const key = semanticQueryKey(item);
    const fields = semanticRankFields(item, payload.period || null);
    if (key && Object.keys(fields).length) {
      rankingByKey.set(key, fields);
      rankedKeywords.push({ ...item, ...fields });
    }
  });
  if (!rankingByKey.size) return core;
  const mergeItems = (items) => (Array.isArray(items) ? items : []).map((item) => {
    const fields = rankingByKey.get(semanticQueryKey(item));
    return fields ? { ...item, ...fields } : item;
  });
  return {
    ...core,
    current: mergeItems(core.current),
    recommended: mergeItems(core.recommended),
    missing: mergeItems(core.missing),
    allKeywords: mergeItems(core.allKeywords),
    rankedKeywords,
    rankingSource: payload.source || "mpstats",
    rankingPeriod: payload.period || core.rankingPeriod,
  };
}

function normalizeSemanticSelection(items) {
  const output = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const query = String(typeof item === "string" ? item : item?.query || "").trim();
    const key = semanticQueryKey(query);
    if (!query || seen.has(key)) return;
    seen.add(key);
    output.push({
      ...(typeof item === "object" && item ? item : {}),
      query,
      status: "selected",
      field: "work",
    });
  });
  return output.slice(0, semanticSelectionLimit);
}

function compactSemanticCore(core) {
  if (!core || typeof core !== "object") return null;
  const compactItems = (items, limit, options = {}) => {
    const sourceItems = Array.isArray(items) ? [...items] : [];
    if (options.prioritizeRanked) {
      sourceItems.sort((left, right) => {
        const leftRanked = semanticHasKeywordRank(left) ? 1 : 0;
        const rightRanked = semanticHasKeywordRank(right) ? 1 : 0;
        if (leftRanked !== rightRanked) return rightRanked - leftRanked;
        return Number(right?.wbCount || 0) - Number(left?.wbCount || 0);
      });
    }
    const seen = new Set();
    const output = [];
    sourceItems.forEach((item) => {
      const query = String(item?.query || "").trim();
      const key = semanticQueryKey(query);
      if (!query || seen.has(key) || output.length >= limit) return;
      seen.add(key);
      output.push({
        query: item.query || "",
        cluster: item.cluster || "",
        prioritySubject: item.prioritySubject || "",
        prioritySubjectId: item.prioritySubjectId || "",
        wbCount: Number(item.wbCount || 0),
        ozonCount: Number(item.ozonCount || 0),
        results: Number(item.results || 0),
        orgPos: semanticRankValue(item.orgPos),
        adPos: semanticRankValue(item.adPos),
        avgPos: semanticRankValue(item.avgPos),
        totalFound: Number(item.totalFound || 0),
        frequency365: item.frequency365 || "",
        uniqueDays: Number(item.uniqueDays || 0),
        source: item.source || "mpstats-expanding",
        rankPeriod: item.rankPeriod || "",
        priority: item.priority || "",
        field: item.field || "",
        status: item.status || "",
        reason: item.reason || "",
      });
    });
    return output;
  };
  const recommendedSource = Array.isArray(core.recommended) && core.recommended.length ? core.recommended : core.missing;
  const rankedSource = Array.isArray(core.rankedKeywords) && core.rankedKeywords.length
    ? core.rankedKeywords
    : [
      ...(Array.isArray(core.allKeywords) ? core.allKeywords : []),
      ...(Array.isArray(core.current) ? core.current : []),
      ...(Array.isArray(recommendedSource) ? recommendedSource : []),
    ].filter(semanticHasKeywordRank);
  const compactCurrent = compactItems(core.current, 800, { prioritizeRanked: true });
  const compactRecommended = compactItems(recommendedSource, 1200);
  const compactRankedKeywords = compactItems(rankedSource, 800, { prioritizeRanked: true });
  return {
    source: core.source || "mpstats-expanding",
    seedQuery: core.seedQuery || "",
    period: core.period || {},
    current: compactCurrent,
    recommended: compactRecommended,
    missing: [],
    allKeywords: [],
    rankedKeywords: compactRankedKeywords,
    subjectOptions: (Array.isArray(core.subjectOptions) ? core.subjectOptions : []).slice(0, 200),
    totalKeywords: Number(core.totalKeywords || 0),
    coveragePercent: core.coveragePercent ?? null,
    rankingSource: core.rankingSource || "",
    rankingPeriod: core.rankingPeriod || null,
    reason: core.reason || "",
  };
}

function normalizeSemanticReports(reports) {
  return (Array.isArray(reports) ? reports : [])
    .map((report) => {
      const semanticCore = compactSemanticCore(report?.semanticCore);
      if (!semanticCore) return null;
      const createdAt = report.createdAt || new Date().toISOString();
      return {
        id: report.id || `semantic-${Date.parse(createdAt) || Date.now()}`,
        createdAt,
        seedQuery: report.seedQuery || semanticCore.seedQuery || "",
        subjectFilter: report.subjectFilter || "",
        search: report.search || "",
        excludeWords: report.excludeWords || "",
        selected: normalizeSemanticSelection(report.selected),
        semanticCore,
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function semanticCoreWithSelection(core, selectedItems) {
  const selected = normalizeSemanticSelection(selectedItems);
  if (!core || typeof core !== "object") {
    return selected.length ? {
      coveragePercent: null,
      current: selected,
      missing: [],
      recommended: [],
      selectedCount: selected.length,
      totalKeywords: selected.length,
      workKeywords: 0,
      reason: "Запросы взяты в работу вручную. Для обновления вариантов соберите СЯ через MPStats.",
    } : null;
  }
  const selectedByKey = new Map(selected.map((item) => [semanticQueryKey(item), item]));
  const selectedKeys = new Set(selectedByKey.keys());
  const current = (Array.isArray(core.current) ? core.current : []).map((item) => {
    const key = semanticQueryKey(item);
    const selectedItem = selectedByKey.get(key);
    return selectedItem ? { ...item, ...selectedItem, status: "selected", field: "work" } : item;
  });
  const currentKeys = new Set(current.map(semanticQueryKey));
  const selectedCurrent = selected.filter((item) => !currentKeys.has(semanticQueryKey(item)));
  const removeSelected = (items) => (Array.isArray(items) ? items : []).filter((item) => !selectedKeys.has(semanticQueryKey(item)));
  const recommended = removeSelected(core.recommended);
  const missing = removeSelected(core.missing);
  return {
    ...core,
    current: [...selectedCurrent, ...current],
    recommended,
    missing,
    selectedCount: selected.length,
    workKeywords: recommended.length,
  };
}

function defaultSemanticSeedQuery(card) {
  const title = String(card?.title || "").trim();
  const titleWords = title.split(/\s+/).filter(Boolean);
  if (titleWords.length) {
    return titleWords.slice(0, 3).join(" ").toLowerCase();
  }
  const subject = String(card?.subjectName || "").split("/").pop().trim();
  return subject.toLowerCase();
}

function numberFromInput(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  const normalized = String(value).replace(",", ".").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : "";
}

function priceDraftFromCard(card) {
  const draft = {
    price: firstDefined(card?.price, card?.rawFields?.price),
    discount: firstDefined(card?.discount, card?.rawFields?.discount),
  };
  return {
    ...draft,
    recommendation: buildPriceRecommendation(card, draft),
    recommendationSource: "system",
  };
}

function normalizeDraftPrices(value, card) {
  const base = priceDraftFromCard(card);
  const source = value && typeof value === "object" ? value : {};
  const normalized = {
    price: firstDefined(source.price, source.basePrice, base.price),
    discount: firstDefined(source.discount, base.discount),
  };
  const recommendation = firstDefined(
    source.recommendation,
    source.recommendationText,
    buildPriceRecommendation(card, normalized),
  );
  return {
    ...normalized,
    recommendation,
    recommendationSource: source.recommendationSource || (source.recommendation || source.recommendationText ? "manual" : "system"),
  };
}

function discountedPriceFromValues(price, discount) {
  const priceNumber = numberFromInput(price);
  const discountNumber = numberFromInput(discount);
  if (priceNumber === "") {
    return "";
  }
  if (discountNumber === "") {
    return priceNumber;
  }
  return Math.round(priceNumber * (100 - discountNumber)) / 100;
}

function signedPercent(value) {
  if (!Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 10) / 10}%`;
}

function buildPriceRecommendation(card, prices = {}) {
  const currentPrice = firstDefined(card?.price, card?.rawFields?.price);
  const currentDiscount = firstDefined(card?.discount, card?.rawFields?.discount);
  const currentDiscounted = firstDefined(
    card?.discountedPrice,
    card?.rawFields?.discountedPrice,
    discountedPriceFromValues(currentPrice, currentDiscount),
  );
  const draftPrice = firstDefined(prices.price, currentPrice);
  const draftDiscount = firstDefined(prices.discount, currentDiscount);
  const draftDiscounted = discountedPriceFromValues(draftPrice, draftDiscount);
  if (draftPrice === "" || draftDiscounted === "") {
    return "Не хватает цены до скидки, чтобы сформировать рекомендацию.";
  }
  const currentNumber = numberFromInput(currentDiscounted);
  const draftNumber = numberFromInput(draftDiscounted);
  const discountNumber = numberFromInput(draftDiscount);
  if (currentNumber === "" || currentNumber <= 0) {
    return `Рекомендация: поставить цену со скидкой ${valueSummary(draftDiscounted)} и после выгрузки проверить динамику продаж. Текущая цена WB не найдена для сравнения.`;
  }
  const deltaPercent = ((draftNumber - currentNumber) / currentNumber) * 100;
  const deltaText = signedPercent(deltaPercent);
  const discountWarning = discountNumber !== "" && discountNumber >= 70
    ? " Скидка высокая, перед выгрузкой проверьте маржинальность и ограничения WB."
    : "";
  if (deltaPercent <= -10) {
    return `Рекомендация: снизить цену со скидкой до ${valueSummary(draftDiscounted)} (${deltaText} к текущей). Подходит для ускорения продаж или распродажи остатка.${discountWarning}`;
  }
  if (deltaPercent >= 10) {
    return `Рекомендация: повысить цену со скидкой до ${valueSummary(draftDiscounted)} (${deltaText} к текущей). Используйте, если маржа важнее объема продаж или товар хорошо продается.${discountWarning}`;
  }
  return `Рекомендация: оставить цену близко к текущей, ${valueSummary(draftDiscounted)} (${deltaText} к текущей). Изменение мягкое, можно согласовывать без сильного риска для конверсии.${discountWarning}`;
}

function stockDraftRowsFromCard(card) {
  const sizes = Array.isArray(card?.sizes) ? card.sizes : [];
  if (!sizes.length) {
    return [];
  }
  return sizes.flatMap((size, sizeIndex) => {
    const skus = Array.isArray(size?.skus) && size.skus.length ? size.skus : [""];
    return skus.map((sku, skuIndex) => {
      const key = `${size?.chrtID || size?.chrtId || size?.sizeID || sizeIndex}:${sku || skuIndex}`;
      const currentAmount = sizeStockValue(size);
      return {
        key,
        sku,
        chrtID: size?.chrtID || size?.chrtId || size?.sizeID || "",
        sizeName: size?.techSize || size?.wbSize || `Размер ${sizeIndex + 1}`,
        currentAmount,
        amount: currentAmount,
        sellerStock: firstDefined(size?.sellerStock),
        wbStock: firstDefined(size?.wbStock),
      };
    });
  });
}

function normalizeDraftStocks(value, card) {
  const baseRows = stockDraftRowsFromCard(card);
  const rowsByKey = {};
  const sourceRows = Array.isArray(value?.rows) ? value.rows : [];
  sourceRows.forEach((row) => {
    if (row?.key) {
      rowsByKey[row.key] = row;
    }
  });
  return {
    rows: baseRows.map((row) => ({
      ...row,
      amount: firstDefined(rowsByKey[row.key]?.amount, row.amount),
    })),
  };
}

function buildPricesExportSheets(card, draftPrices = {}) {
  const price = firstDefined(draftPrices.price, card?.price, card?.rawFields?.price);
  const discount = firstDefined(draftPrices.discount, card?.discount, card?.rawFields?.discount);
  const discountedPrice = discountedPriceFromValues(price, discount) || firstDefined(card?.discountedPrice, card?.rawFields?.discountedPrice);
  const recommendation = firstDefined(draftPrices.recommendation, buildPriceRecommendation(card, draftPrices));
  return [
    {
      name: "Цены и скидки",
      freezeRows: 1,
      widths: [18, 24, 24, 22, 20, 22, 72],
      rows: [
        ["Номенклатура WB", "Артикул продавца", "Баркод", "Цена продавца до скидки", "Скидка продавца", "Цена со скидкой", "Рекомендация"],
        [
          card?.nmID || "",
          card?.vendorCode || "",
          firstSku(card),
          price,
          discount,
          discountedPrice,
          recommendation,
        ],
      ],
    },
    {
      name: "Инструкция",
      widths: [34, 96],
      rows: [
        ["Раздел WB", "Что делать"],
        ["Цены и скидки", "В ЛК WB откройте Товары и цены -> Цены и скидки -> Обновить через Excel -> Цены или скидки."],
        ["Редактируемые поля", "В WB-шаблоне обычно редактируются цена продавца до скидки и скидка продавца. Итоговая цена пересчитывается WB."],
        ["Рекомендация", "Поле с рекомендацией не загружается в WB автоматически, оно нужно для согласования решения внутри команды."],
        ["Ограничение", "Если WB выгрузил свой шаблон со всеми товарами, переносите значения из листа Цены и скидки в строки с тем же nmID/артикулом/баркодом."],
      ],
    },
  ];
}

function buildStocksExportSheets(card, draftStocks = {}) {
  const stockRows = normalizeDraftStocks(draftStocks, card).rows;
  const uploadRows = [["Баркод", "Количество"]];
  const referenceRows = [["Баркод", "Артикул продавца", "Номенклатура WB", "Размер", "ID размера WB", "Текущий остаток", "Новый остаток"]];

  if (!stockRows.length) {
    uploadRows.push(["", ""]);
    referenceRows.push(["", card?.vendorCode || "", card?.nmID || "", "", "", ""]);
  } else {
    stockRows.forEach((row) => {
      uploadRows.push([row.sku, row.amount]);
      referenceRows.push([
        row.sku,
        card?.vendorCode || "",
        card?.nmID || "",
        row.sizeName,
        row.chrtID,
        row.currentAmount,
        row.amount,
      ]);
    });
  }

  return [
    {
      name: "Остатки WB",
      freezeRows: 1,
      widths: [24, 16],
      rows: uploadRows,
    },
    {
      name: "Справка по размерам",
      freezeRows: 1,
      widths: [24, 24, 18, 18, 18, 16],
      rows: referenceRows,
    },
    {
      name: "Инструкция",
      widths: [34, 96],
      rows: [
        ["Раздел WB", "Что делать"],
        ["Управление остатками FBS", "В ЛК WB откройте Управление остатками -> Действия с Excel -> загрузка XLSX-шаблона."],
        ["Формат импорта", "Первый лист Остатки WB оставлен в формате WB для FBS: только две колонки Баркод и Количество."],
        ["Количество", "Заполните количество по нужному баркоду. Служебные поля вынесены на отдельный лист, чтобы не мешать загрузке."],
      ],
    },
  ];
}

function clientReportDateLabel(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("ru-RU");
}

function clientReportPeriodLabel(date = new Date()) {
  const end = new Date(date);
  const start = new Date(date);
  start.setDate(start.getDate() - 6);
  return `${start.toLocaleDateString("ru-RU")} - ${end.toLocaleDateString("ru-RU")}`;
}

function dateInputValue(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function defaultClientReportRange() {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    start: dateInputValue(start),
    end: dateInputValue(end),
  };
}

function clientReportRangeLabel(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "период не выбран";
  }
  return `${startDate.toLocaleDateString("ru-RU")} - ${endDate.toLocaleDateString("ru-RU")}`;
}

function clientReportPeriodQuery(start, end) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return params.toString();
}

const sellerReportTemplates = [
  {
    id: "wb-client-xlsx",
    title: "WB клиентский XLSX",
    format: "XLSX",
    description: "Контент, цены, остатки, заказы, продажи, реклама, акции и доступность источников.",
  },
];

function sellerReportTemplate(reportId) {
  return sellerReportTemplates.find((item) => item.id === reportId) || sellerReportTemplates[0];
}

function reportHistoryStorageKey(portalId) {
  return `opticards-report-history:${portalId || "portal"}`;
}

function readReportHistory(portalId) {
  try {
    const items = JSON.parse(localStorage.getItem(reportHistoryStorageKey(portalId)) || "[]");
    return Array.isArray(items) ? items.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveReportHistory(portalId, history) {
  try {
    localStorage.setItem(reportHistoryStorageKey(portalId), JSON.stringify(history.slice(0, 20)));
  } catch {
    // Report generation should not fail because the browser rejected local history storage.
  }
}

function normalizeReportHistory(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    id: item.id || `report-${item.generatedAt || Date.now()}`,
    reportId: item.reportId || item.report_id || "wb-client-xlsx",
    title: item.title || item.reportTitle || "WB клиентский XLSX",
    format: item.format || "XLSX",
    period: item.period || { start: item.start || "", end: item.end || "" },
    fileName: item.fileName || item.file_name || "",
    status: item.status || "done",
    generatedAt: item.generatedAt || item.createdAt || "",
    source: item.source || "",
  })).slice(0, 20);
}

function reportHistoryStatusLabel(status) {
  if (status === "done") return "сформирован";
  if (status === "partial") return "частично";
  if (status === "error") return "ошибка";
  return "черновик";
}

function reportHistoryStatusTone(status) {
  if (status === "done") return "green";
  if (status === "partial") return "amber";
  if (status === "error") return "blue";
  return "amber";
}

function reportNumber(value, digits = null) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  return digits === null ? number : Number(number.toFixed(digits));
}

function reportPercent(value) {
  return reportNumber(value, 2);
}

function reportPercentDynamic(current, previous) {
  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber) || previousNumber === 0) {
    return "";
  }
  return Number((((currentNumber - previousNumber) / previousNumber) * 100).toFixed(1));
}

function reportPrice(value) {
  return reportNumber(value, 2);
}

function reportMetric(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
}

function reportReadyTime(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const parts = [];
  if (Number(value.days || 0)) parts.push(`${value.days} д`);
  if (Number(value.hours || 0)) parts.push(`${value.hours} ч`);
  if (Number(value.mins || 0)) parts.push(`${value.mins} мин`);
  return parts.join(" ") || "";
}

function reportPeriodRange(period, fallbackDate = new Date()) {
  if (period?.rangeLabel) {
    return period.rangeLabel;
  }
  return clientReportPeriodLabel(fallbackDate);
}

function reportPeriodDays(period) {
  if (!period?.start || !period?.end) {
    return 7;
  }
  const start = new Date(`${period.start}T00:00:00`);
  const end = new Date(`${period.end}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 7;
  }
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function reportCardKey(card) {
  return String(card?.nmID || card?.nmId || card?.vendorCode || "").trim();
}

function reportNmKey(card) {
  return String(card?.nmID || card?.nmId || "").trim();
}

function reportAnalyticsEntry(reportData, period, card) {
  const nmKey = reportNmKey(card);
  if (!nmKey || !period?.label) {
    return {};
  }
  return reportData?.analyticsByPeriod?.[period.label]?.[nmKey] || {};
}

function reportOrdersEntry(reportData, period, card) {
  const nmKey = reportNmKey(card);
  if (!nmKey || !period?.label) {
    return {};
  }
  return reportData?.ordersByPeriod?.[period.label]?.[nmKey] || {};
}

function reportSalesEntry(reportData, period, card) {
  const nmKey = reportNmKey(card);
  if (!nmKey || !period?.label) {
    return {};
  }
  return reportData?.salesByPeriod?.[period.label]?.[nmKey] || {};
}

function reportPreviousPeriod(periods, period) {
  const index = periods.findIndex((item) => item.label === period?.label);
  return index >= 0 ? periods[index + 1] : null;
}

function reportAdMetricsForCard(reportData, period, card) {
  const nmKey = reportNmKey(card);
  const ads = reportData?.ads?.stats || [];
  const metrics = { views: 0, clicks: 0, carts: 0, orders: 0, spend: 0, orderSum: 0, present: false };
  for (const advert of ads) {
    for (const day of advert?.days || []) {
      const dayText = String(day?.date || "").slice(0, 10);
      if (period?.start && period?.end && (dayText < period.start || dayText > period.end)) {
        continue;
      }
      for (const app of day?.apps || []) {
        for (const nm of app?.nms || []) {
          if (String(nm?.nmId || "") === nmKey) {
            metrics.present = true;
            metrics.views += Number(nm.views || 0);
            metrics.clicks += Number(nm.clicks || 0);
            metrics.carts += Number(nm.atbs || 0);
            metrics.orders += Number(nm.orders || 0);
            metrics.spend += Number(nm.sum || 0);
            metrics.orderSum += Number(nm.sum_price || 0);
          }
        }
      }
    }
  }
  metrics.ctr = metrics.views ? (metrics.clicks / metrics.views) * 100 : "";
  return metrics;
}

function cardReportPrice(card) {
  return firstDefined(card?.discountedPrice, card?.price, card?.rawFields?.discountedPrice, card?.rawFields?.price);
}

function cardReportStock(card) {
  return firstDefined(card?.stock, card?.wbStock, card?.sellerStock, card?.rawFields?.stock);
}

function cardReportPhotoCount(card) {
  const photos = Array.isArray(card?.photos) ? card.photos : [];
  return photos.length || Number(card?.rawFields?.photosCount || 0) || "";
}

function cardReportCharacteristicsCount(card) {
  return rawCharacteristicItems(card).length;
}

function cardReportColor(card) {
  return characteristicValuesByAliases(card, ["цвет"])[0] || "";
}

function cardReportIssueText(card) {
  const reasons = cardProblemReasons(card);
  const signals = cardDataSignals(card);
  if (reasons.length) {
    return reasons.join("; ");
  }
  if (signals.length) {
    return signals.join("; ");
  }
  return "без замечаний";
}

function reportStatusLabel(status) {
  if (status === "ok") return "есть";
  if (status === "partial") return "частично";
  if (status === "empty") return "нет данных";
  if (status === "skipped") return "пропущено";
  if (status === "error") return "ошибка";
  return status || "неизвестно";
}

function clientReportAvailability(cards, portal, reportData = null) {
  if (Array.isArray(reportData?.sources) && reportData.sources.length) {
    return reportData.sources.map((source) => [
      source.title || source.key || "Источник",
      reportStatusLabel(source.status),
      [source.source, source.message, source.records !== undefined ? `строк: ${source.records}` : ""].filter(Boolean).join(" · "),
    ]);
  }
  const hasCards = cards.length > 0;
  const hasPrices = cards.some((card) => cardReportPrice(card) !== "");
  const hasStocks = cards.some((card) => cardReportStock(card) !== "");
  const hasContent = cards.some((card) => String(card?.description || "").trim() || rawCharacteristicItems(card).length);
  const hasApi = Boolean(portal?.apiConnected);
  return [
    ["Карточки WB", hasCards ? "есть" : "нет данных", hasApi ? "WB API" : "ручная витрина"],
    ["Контент карточек", hasContent ? "есть" : "частично", "название, описание, характеристики, фото"],
    ["Цены и скидки", hasPrices ? "есть" : "нет данных", hasApi ? "WB Prices API" : "данные витрины"],
    ["Остатки", hasStocks ? "есть" : "нет данных", hasApi ? "WB Marketplace/Analytics API" : "данные витрины"],
    ["Воронка продаж", hasApi ? "частично" : "не подключено", hasApi ? "запрашивается из WB Analytics при скачивании отчета" : "нужен WB API"],
    ["Локальность и доставка", hasApi ? "частично" : "не подключено", hasApi ? "запрашивается из WB Analytics при скачивании отчета" : "нужен WB API"],
    ["Акции", hasApi ? "частично" : "не подключено", hasApi ? "запрашивается из календаря акций WB" : "нужен WB API"],
    ["Реклама", hasApi ? "частично" : "не подключено", hasApi ? "запрашивается из WB Promotion; WB может ограничить частоту" : "нужен WB API"],
  ];
}

function reportComment(reportData, period, card) {
  const analytics = reportAnalyticsEntry(reportData, period, card);
  const comments = [];
  if (!analytics.selected) {
    comments.push("воронка WB не получена за период");
  }
  if (!cardReportPrice(card)) {
    comments.push("нет текущей цены");
  }
  return comments.join("; ") || "данные собраны автоматически";
}

function reportOrdersCurrent(reportData, period, card) {
  const selected = reportAnalyticsEntry(reportData, period, card).selected || {};
  const orders = reportOrdersEntry(reportData, period, card);
  return firstDefined(selected.orderCount, orders.ordersCount);
}

function reportOrdersPast(reportData, periods, period, card) {
  const entry = reportAnalyticsEntry(reportData, period, card);
  if (entry.past?.orderCount !== undefined) {
    return entry.past.orderCount;
  }
  const previous = reportPreviousPeriod(periods, period);
  if (!previous) {
    return "";
  }
  return reportOrdersCurrent(reportData, previous, card);
}

function reportOrderSum(reportData, period, card) {
  const selected = reportAnalyticsEntry(reportData, period, card).selected || {};
  const orders = reportOrdersEntry(reportData, period, card);
  return firstDefined(selected.orderSum, orders.ordersSum);
}

function reportPromotionItems(reportData) {
  const promotions = reportData?.promotions;
  if (Array.isArray(promotions)) {
    return promotions;
  }
  return Array.isArray(promotions?.nomenclatures) ? promotions.nomenclatures : [];
}

function reportPromotionName(item) {
  return item?.promotionName || item?.name || item?.promoName || item?.actionName || "";
}

function reportPromotionEntriesForCard(reportData, card, onlyInAction = false) {
  const nmKey = reportNmKey(card);
  if (!nmKey) {
    return [];
  }
  return reportPromotionItems(reportData).filter((item) => {
    const itemNm = String(item?.id || item?.nmID || item?.nmId || "").trim();
    if (itemNm !== nmKey) {
      return false;
    }
    return !onlyInAction || Boolean(item?.inAction);
  });
}

function reportPromotionNamesForCard(reportData, card) {
  const names = reportPromotionEntriesForCard(reportData, card, true)
    .map(reportPromotionName)
    .filter(Boolean);
  return [...new Set(names)].join(", ");
}

function reportPromotionPriceForCard(reportData, card) {
  const entry = reportPromotionEntriesForCard(reportData, card, true)
    .find((item) => firstDefined(item?.planPrice, item?.price) !== "");
  return entry ? reportPrice(firstDefined(entry?.planPrice, entry?.price)) : "";
}

function reportStockRows(reportData, cards, periods) {
  const period = periods[0] || {};
  const periodDays = reportPeriodDays(period);
  const rows = [
    ["Артикул продавца", "Артикул WB", "Товар", "Остаток на складах, шт", "Среднее заказов в день", "Дней до конца остатка"],
    ...cards.map((card) => {
      const selected = reportAnalyticsEntry(reportData, period, card).selected || {};
      const orders = reportOrdersEntry(reportData, period, card);
      const avgOrdersPerDay = firstDefined(selected.avgOrdersCountPerDay, orders.ordersCount ? Number((Number(orders.ordersCount) / periodDays).toFixed(2)) : "");
      const stock = cardReportStock(card);
      const daysToStockEnd = stock && avgOrdersPerDay ? reportNumber(Number(stock) / Number(avgOrdersPerDay), 1) : "";
      return [
        card?.vendorCode || "",
        reportNmKey(card),
        card?.title || card?.subjectName || "",
        reportNumber(stock),
        reportNumber(avgOrdersPerDay, 2),
        daysToStockEnd,
      ];
    }).sort((left, right) => {
      const leftDays = left[5] === "" ? Number.POSITIVE_INFINITY : Number(left[5]);
      const rightDays = right[5] === "" ? Number.POSITIVE_INFINITY : Number(right[5]);
      return leftDays - rightDays;
    }),
  ];
  if (rows.length === 1) {
    rows.push(["нет данных", "", "", "", "", ""]);
  }
  return rows;
}

function reportWeeklyRows(reportData, portal, cards, period, periods) {
  const periodDays = reportPeriodDays(period);
  return [
    ["Проверка на (дата):", period?.label || clientReportDateLabel(reportData?.generatedAt || new Date())],
    ["За период:", reportPeriodRange(period, reportData?.generatedAt || new Date())],
    ["Кабинет:", portalDisplayName(portal)],
    [],
    [
      "Товар",
      "Цвет",
      "Артикул",
      "Артикул WB",
      "Текущая цена",
      "Показы РК",
      "Клики РК",
      "CTR РК",
      "Перешли в карточку WB",
      "Положили в корзину WB",
      "Cреднее время доставки",
      "Остаток на складах, шт",
      "Дней до конца остатка",
      "Локальные заказы %",
      "Кол-во заказов (прошлый период)",
      "Кол-во заказов (выбранный период)",
      "Динамика заказов",
      "Сумма заказов",
      "Среднее количество заказов в день, шт",
      "Есть в РК",
      "Акции",
      "Цена в акции",
    ],
    ...cards.map((card) => {
      const analytics = reportAnalyticsEntry(reportData, period, card);
      const selected = analytics.selected || {};
      const comparison = analytics.comparison || {};
      const orders = reportOrdersEntry(reportData, period, card);
      const currentOrders = reportOrdersCurrent(reportData, period, card);
      const pastOrders = reportOrdersPast(reportData, periods, period, card);
      const adMetrics = reportAdMetricsForCard(reportData, period, card);
      const openCount = reportMetric(selected, ["openCount", "openCardCount", "clickCount"]);
      const avgOrdersPerDay = firstDefined(selected.avgOrdersCountPerDay, orders.ordersCount ? Number((Number(orders.ordersCount) / periodDays).toFixed(2)) : "");
      const stock = cardReportStock(card);
      const daysToStockEnd = stock && avgOrdersPerDay ? reportNumber(Number(stock) / Number(avgOrdersPerDay), 1) : "";
      return [
        card?.subjectName || card?.title || "",
        cardReportColor(card),
        card?.vendorCode || "",
        reportNmKey(card),
        reportPrice(cardReportPrice(card)),
        reportNumber(adMetrics.views),
        reportNumber(adMetrics.clicks),
        reportPercent(adMetrics.ctr),
        reportNumber(openCount),
        reportNumber(firstDefined(selected.cartCount, selected.addToCartCount)),
        reportReadyTime(selected.timeToReady),
        reportNumber(stock),
        daysToStockEnd,
        reportPercent(selected.localizationPercent),
        reportNumber(pastOrders),
        reportNumber(currentOrders),
        firstDefined(reportPercent(comparison.orderCountDynamic), reportPercentDynamic(currentOrders, pastOrders)),
        reportPrice(reportOrderSum(reportData, period, card)),
        reportNumber(avgOrdersPerDay, 2),
        adMetrics.present ? "да" : "нет",
        reportPromotionNamesForCard(reportData, card),
        reportPromotionPriceForCard(reportData, card),
      ];
    }),
  ];
}

function reportCharacteristicRows(cards) {
  const rows = [["Артикул", "Артикул WB", "Название", "Характеристика", "Значение"]];
  for (const card of cards) {
    const characteristics = rawCharacteristicItems(card);
    if (!characteristics.length) {
      rows.push([card?.vendorCode || "", card?.nmID || "", card?.title || "", "нет данных", ""]);
      continue;
    }
    for (const item of characteristics) {
      rows.push([
        card?.vendorCode || "",
        card?.nmID || "",
        card?.title || "",
        item?.name || item?.charcName || "",
        rawCharacteristicValueTokens(item?.value ?? item?.values ?? item).join(", "),
      ]);
    }
  }
  return rows;
}

function reportPeriodMetricRows(reportData, cards, periods, metricName, dataKey) {
  const rows = [["Период", "Артикул", "Артикул WB", "Название", ...Object.keys(metricName)]];
  for (const period of periods) {
    for (const card of cards) {
      const entry = reportData?.[dataKey]?.[period.label]?.[reportNmKey(card)] || {};
      rows.push([
        period.rangeLabel || period.label,
        card?.vendorCode || "",
        card?.nmID || "",
        card?.title || "",
        ...Object.values(metricName).map((key) => reportNumber(entry[key], String(key).includes("Sum") || key === "forPay" ? 2 : null)),
      ]);
    }
  }
  return rows;
}

function reportAdRows(reportData) {
  const rows = [["Кампания", "Дата", "Артикул WB", "Название", "Показы", "Клики", "CTR", "Корзина", "Заказы", "ШК", "Расход", "Сумма заказов", "CPC", "CR"]];
  for (const advert of reportData?.ads?.stats || []) {
    for (const day of advert?.days || []) {
      for (const app of day?.apps || []) {
        for (const nm of app?.nms || []) {
          rows.push([
            advert?.advertId || "",
            String(day?.date || "").slice(0, 10),
            nm?.nmId || "",
            nm?.name || "",
            reportNumber(nm?.views),
            reportNumber(nm?.clicks),
            reportPercent(nm?.ctr),
            reportNumber(nm?.atbs),
            reportNumber(nm?.orders),
            reportNumber(nm?.shks),
            reportPrice(nm?.sum),
            reportPrice(nm?.sum_price),
            reportPrice(nm?.cpc),
            reportPercent(nm?.cr),
          ]);
        }
      }
    }
  }
  if (rows.length === 1) {
    rows.push(["нет данных", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  return rows;
}

function reportPromotionRows(reportData, cards) {
  const cardByNm = new Map(cards.map((card) => [reportNmKey(card), card]));
  const rows = [[
    "Акция",
    "Артикул поставщика",
    "Артикул WB",
    "Предмет",
    "Наименование",
    "Остаток WB, шт.",
    "Остаток продавца WB, шт.",
    "Текущая цена, ₽",
    "Цена входа в акцию, ₽",
    "Загружаемая скидка, %",
    "Статус WB",
    "Рекомендация",
  ]];
  for (const item of reportPromotionItems(reportData)) {
    const nmKey = String(item?.id || item?.nmID || item?.nmId || "").trim();
    const card = cardByNm.get(nmKey) || {};
    const currentPrice = firstDefined(item?.price, cardReportPrice(card));
    const planPrice = firstDefined(item?.planPrice, item?.actionPrice, item?.promoPrice);
    const inAction = Boolean(item?.inAction);
    const status = inAction
      ? "Участвует: добавлен, цена равна или ниже плановой"
      : "Не участвует: не добавлен или цена выше плановой";
    const recommendation = inAction
      ? "Оставить в акции и контролировать цену"
      : (planPrice ? "Можно добавить по плановой цене WB" : "Проверить условия акции");
    rows.push([
      reportPromotionName(item),
      card?.vendorCode || item?.vendorCode || "",
      nmKey,
      card?.subjectName || item?.subjectName || item?.subject || "",
      card?.title || item?.name || item?.title || "",
      reportNumber(firstDefined(card?.wbStock, item?.wbStock, item?.stockWb)),
      reportNumber(firstDefined(card?.sellerStock, item?.sellerStock, item?.stockSeller)),
      reportPrice(currentPrice),
      reportPrice(planPrice),
      reportPercent(item?.discount || item?.planDiscount),
      status,
      recommendation,
    ]);
  }
  if (rows.length === 1) {
    rows.push(["нет данных", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  return rows;
}

function buildClientWbReportSheets(portal, cards, reportData = null) {
  const generatedAt = reportData?.generatedAt ? new Date(reportData.generatedAt) : new Date();
  const reportCards = Array.isArray(reportData?.cards) && reportData.cards.length ? reportData.cards : cards;
  const periods = Array.isArray(reportData?.periods) && reportData.periods.length
    ? reportData.periods
    : [{ label: clientReportDateLabel(generatedAt), rangeLabel: clientReportPeriodLabel(generatedAt) }];
  const weeklySheets = periods.map((period) => ({
    name: period.label || "Период",
    freezeRows: 5,
    widths: [22, 16, 20, 18, 16, 14, 14, 12, 22, 22, 20, 18, 18, 18, 24, 26, 18, 16, 26, 12, 48, 18],
    rows: reportWeeklyRows(reportData || {}, portal, reportCards, period, periods),
  }));
  return [
    { name: "Остатки", freezeRows: 1, widths: [22, 18, 56, 22, 24, 22], rows: reportStockRows(reportData || {}, reportCards, periods) },
    { name: "Акции", freezeRows: 1, widths: [42, 22, 18, 24, 52, 18, 22, 18, 22, 22, 48, 42], rows: reportPromotionRows(reportData || {}, reportCards) },
    ...weeklySheets,
  ];
}

function Tag({ children, tone = "amber", title = "" }) {
  return <span className={`tag ${tone}`} title={title}>{children}</span>;
}

function IconButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button className="icon-btn" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon size={17} />
    </button>
  );
}

function HelpHint({ enabled, title, children }) {
  if (!enabled) {
    return null;
  }
  return (
    <div className="help-hint">
      <HelpCircle size={18} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

function HelpList({ enabled, title, items }) {
  if (!enabled) {
    return null;
  }
  return (
    <div className="help-hint help-list">
      <HelpCircle size={18} />
      <div>
        <strong>{title}</strong>
        <ul>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  const [initialView] = useState(readSavedAppView);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [userPortals, setUserPortals] = useState([]);
  const [demoPortal, setDemoPortal] = useState(initialDemoPortal);
  const [demoPortalArchived, setDemoPortalArchived] = useState(() => localStorage.getItem("opticards-demo-archived") === "1");
  const [screen, setScreen] = useState(initialView.screen || "cabinets");
  const [portalStatusFilter, setPortalStatusFilter] = useState("active");
  const [selectedPortalId, setSelectedPortalId] = useState(initialView.portalId || "demo-wb");
  const [selectedCardKey, setSelectedCardKey] = useState(initialView.cardKey || cardDraftKey(demoCards[0]));
  const [selectedCard, setSelectedCard] = useState(
    demoCards.find((card) => cardDraftKey(card) === initialView.cardKey) || demoCards[0],
  );
  const [loadingPortalCards, setLoadingPortalCards] = useState({});
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portalModalMode, setPortalModalMode] = useState("api");
  const [portalModalTarget, setPortalModalTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [portalWorkSummaries, setPortalWorkSummaries] = useState({});
  const [mpstatsIntegration, setMpstatsIntegration] = useState(null);
  const [helpEnabled, setHelpEnabled] = useState(() => localStorage.getItem(helpModeStorageKey) === "1");

  const displayUsers = users.length ? users : hardcodedDirectoryFallback;
  const canManagePortals = currentUser ? ["admin", "manager"].includes(getUserRoleType(currentUser)) : false;
  const canManageUsers = currentUser ? userCanManageUsers(currentUser) : false;
  const activeDemoPortal = { ...demoPortal, isActive: !demoPortalArchived };
  const allPortals = [activeDemoPortal, ...userPortals].map(mergePortalWorkSummary);
  const activePortals = allPortals.filter((portal) => portal.isActive !== false);

  const currentPortal = allPortals.find((portal) => String(portal.id) === String(selectedPortalId)) || allPortals[0];

  function mergePortalWorkSummary(portal) {
    const localSummary = portalWorkSummaries[String(portal?.id || "")];
    if (!localSummary) {
      return portal;
    }
    const backendSummary = portal.draftSummary || {};
    const draftCount = Math.max(Number(backendSummary.draftCount || 0), localSummary.draftKeys?.length || 0);
    const auditCount = Math.max(Number(backendSummary.auditCount || 0), localSummary.auditKeys?.length || 0);
    return {
      ...portal,
      draftSummary: {
        ...backendSummary,
        draftCount,
        auditCount,
        approvalPendingCount: Number(backendSummary.approvalPendingCount || 0),
        approvalReturnedCount: Number(backendSummary.approvalReturnedCount || 0),
        approvalApprovedCount: Number(backendSummary.approvalApprovedCount || 0),
        lastDraftAt: localSummary.lastActivityAt || backendSummary.lastDraftAt || "",
      },
    };
  }

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    localStorage.setItem(appViewStorageKey, JSON.stringify({
      screen,
      portalId: selectedPortalId,
      cardKey: selectedCardKey,
    }));
  }, [currentUser, screen, selectedPortalId, selectedCardKey]);

  useEffect(() => {
    localStorage.setItem(helpModeStorageKey, helpEnabled ? "1" : "0");
  }, [helpEnabled]);

  useEffect(() => {
    if (screen !== "card") {
      return;
    }
    const cards = cardsForPortal(currentPortal);
    if (!cards.length) {
      return;
    }
    const nextCard = cards.find((card) => cardDraftKey(card) === selectedCardKey) || cards[0];
    if (!selectedCard || cardDraftKey(selectedCard) !== cardDraftKey(nextCard)) {
      setSelectedCard(nextCard);
    }
  }, [screen, currentPortal, selectedCardKey, selectedCard]);

  useEffect(() => {
    if (!currentUser || !currentPortal || currentPortal.isDemo || !currentPortal.apiConnected) {
      return;
    }
    if (!["seller", "card"].includes(screen)) {
      return;
    }
    loadPortalCards(currentPortal);
  }, [currentUser, screen, currentPortal?.id, currentPortal?.apiConnected, currentPortal?.realCards?.length]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [screen, selectedPortalId, selectedCardKey]);

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

    try {
      const payload = await apiRequest("/api/integrations/mpstats");
      setMpstatsIntegration(payload.integration || null);
    } catch {
      setMpstatsIntegration(null);
    }

    await loadWbDemoSnapshot();
  }

  async function refreshPortals() {
    const payload = await apiRequest("/api/portals");
    setUserPortals((current) => {
      const currentById = Object.fromEntries(current.map((portal) => [String(portal.id), portal]));
      return (payload.portals || []).map((portal) => {
        const normalized = normalizePortal(portal);
        const existing = currentById[String(normalized.id)];
        return existing ? { ...normalized, realCards: existing.realCards || [] } : normalized;
      });
    });
  }

  function markPortalWorkActivity(portalId, cardKey, { audit = false, draft = false } = {}) {
    const normalizedPortalId = String(portalId || "");
    const normalizedCardKey = String(cardKey || "");
    if (!normalizedPortalId || !normalizedCardKey) {
      return;
    }
    setPortalWorkSummaries((current) => {
      const summary = current[normalizedPortalId] || { draftKeys: [], auditKeys: [], lastActivityAt: "" };
      const draftKeys = draft ? [...new Set([...summary.draftKeys, normalizedCardKey])] : summary.draftKeys;
      const auditKeys = audit ? [...new Set([...summary.auditKeys, normalizedCardKey])] : summary.auditKeys;
      return {
        ...current,
        [normalizedPortalId]: {
          draftKeys,
          auditKeys,
          lastActivityAt: new Date().toISOString(),
        },
      };
    });
  }

  function resetPortalWorkActivity(portalId, cardKey) {
    const normalizedPortalId = String(portalId || "");
    const normalizedCardKey = String(cardKey || "");
    if (!normalizedPortalId || !normalizedCardKey) {
      return;
    }
    setPortalWorkSummaries((current) => {
      const summary = current[normalizedPortalId];
      if (!summary) {
        return current;
      }
      const draftKeys = (summary.draftKeys || []).filter((key) => key !== normalizedCardKey);
      const auditKeys = (summary.auditKeys || []).filter((key) => key !== normalizedCardKey);
      return {
        ...current,
        [normalizedPortalId]: {
          draftKeys,
          auditKeys,
          lastActivityAt: new Date().toISOString(),
        },
      };
    });
  }

  function resetPortalWorkSummary(portalId) {
    const normalizedPortalId = String(portalId || "");
    if (!normalizedPortalId) {
      return;
    }
    setPortalWorkSummaries((current) => ({
      ...current,
      [normalizedPortalId]: {
        draftKeys: [],
        auditKeys: [],
        lastActivityAt: new Date().toISOString(),
      },
    }));
  }

  function resetPortalAuditSummary(portalId) {
    const normalizedPortalId = String(portalId || "");
    if (!normalizedPortalId) {
      return;
    }
    setPortalWorkSummaries((current) => {
      const summary = current[normalizedPortalId] || { draftKeys: [], auditKeys: [], lastActivityAt: "" };
      return {
        ...current,
        [normalizedPortalId]: {
          ...summary,
          auditKeys: [],
          lastActivityAt: new Date().toISOString(),
        },
      };
    });
  }

  function clearLocalDraftsForPortal(portalId) {
    const prefix = `opticards-draft:${portalId}:`;
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => localStorage.removeItem(key));
  }

  function localDraftHasAuditData(draft) {
    if (draft?.auditStatus === "done") {
      return true;
    }
    const content = draft?.content || {};
    const meta = draft?.meta || {};
    if (Array.isArray(meta.auditHistory) && meta.auditHistory.length) {
      return true;
    }
    if (content.title?.source === "audit" || content.description?.source === "audit") {
      return true;
    }
    return Object.values(content.characteristics || {}).some((item) => item?.source === "audit");
  }

  function invalidateLocalDraftAuditsForPortal(portalId) {
    const prefix = `opticards-draft:${portalId}:`;
    const invalidatedAt = new Date().toISOString();
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => {
        try {
          const draft = JSON.parse(localStorage.getItem(key) || "null");
          if (!draft || typeof draft !== "object") {
            return;
          }
          if (!localDraftHasAuditData(draft)) {
            return;
          }
          const meta = draft.meta && typeof draft.meta === "object" ? draft.meta : {};
          localStorage.setItem(key, JSON.stringify({
            ...draft,
            auditStatus: "stale",
            meta: {
              ...meta,
              auditHistory: [],
              auditInvalidatedAt: invalidatedAt,
              auditInvalidatedReason: "wb_snapshot_refresh",
            },
          }));
        } catch {
          localStorage.removeItem(key);
        }
      });
  }

  async function refreshUsers() {
    const payload = await apiRequest("/api/users");
    const nextUsers = normalizeUserList(payload.users || []);
    setUsers(nextUsers);
    return nextUsers;
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

  async function createUserAccount(userPayload) {
    const payload = await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify(userPayload),
    });
    await refreshUsers();
    return payload;
  }

  async function resetUserPassword(login) {
    return apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({ action: "reset_password", login }),
    });
  }

  async function updateUserAccount(userPayload) {
    const payload = await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({ action: "update_user", ...userPayload }),
    });
    await refreshUsers();
    return payload;
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
    setSelectedCardKey(cardDraftKey(demoCards[0]));
    setSelectedCard(demoCards[0]);
    localStorage.removeItem(appViewStorageKey);
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

  async function refreshPortalCards(portal) {
    if (!portal || portal.isDemo) {
      return;
    }
    if (!portal.apiConnected) {
      if (!portal.storeUrl && !portal.manualSource) {
        setNotice("Для загрузки через MPStats добавьте ссылку на магазин, карточку или список nmID.");
        return;
      }
      const confirmed = window.confirm(
        "Обновить ручной кабинет через MPStats? Система попробует заново получить карточки по ссылке на магазин, бренду, продавцу или nmID.",
      );
      if (!confirmed) {
        return;
      }
      const portalKey = String(portal.id);
      setLoadingPortalCards((items) => ({ ...items, [portalKey]: true }));
      try {
        await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/reset-analysis-cache`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        invalidateLocalDraftAuditsForPortal(portal.id);
        resetPortalAuditSummary(portal.id);
        const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/mpstats-bootstrap`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        const updatedPortal = normalizePortal(response.portal);
        replaceUserPortal(updatedPortal);
        setNotice(manualBootstrapNotice(updatedPortal, "refresh"));
      } catch (error) {
        if (error.message === "mpstats_api_error" && error.payload?.message === "mpstats_key_missing") {
          setNotice("MPStats не подключен: карточки по ссылке магазина загрузить нельзя.");
        } else {
          setNotice("Не удалось обновить ручной кабинет через MPStats. Проверьте ссылку и подключение MPStats.");
        }
      } finally {
        setLoadingPortalCards((items) => {
          const next = { ...items };
          delete next[portalKey];
          return next;
        });
      }
      return;
    }
    const confirmed = window.confirm(
      "Загрузить свежие данные WB? MPStats-кэш и статус аудита будут сброшены, но черновики и задачи согласования останутся.",
    );
    if (!confirmed) {
      return;
    }
    try {
      await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/reset-analysis-cache`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      invalidateLocalDraftAuditsForPortal(portal.id);
      resetPortalAuditSummary(portal.id);
      const portalAfterAnalysisReset = {
        ...portal,
        draftSummary: {
          ...portal.draftSummary,
          auditCount: 0,
        },
      };
      replaceUserPortal(portalAfterAnalysisReset);
      await loadPortalCards(portalAfterAnalysisReset, { force: true });
    } catch {
      setNotice("Не удалось сбросить аудит и MPStats-кэш. Свежие данные WB не загружены.");
      return;
    }
  }

  async function resetPortalWork(portal) {
    if (!portal || portal.isDemo || !portal.apiConnected) {
      return;
    }
    const confirmed = window.confirm(
      "Обнулить работу по кабинету? Удалятся аудиты, черновики, задачи и история согласования. Карточки WB и API-ключ останутся.",
    );
    if (!confirmed) {
      return;
    }
    const portalKey = String(portal.id);
    if (loadingPortalCards[portalKey]) {
      return;
    }
    setLoadingPortalCards((items) => ({ ...items, [portalKey]: true }));
    try {
      await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/reset-work-cache`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      clearLocalDraftsForPortal(portal.id);
      resetPortalWorkSummary(portal.id);
      const resetPortal = {
        ...portal,
        draftSummary: emptyDraftSummary(),
        realCards: portal.realCards || [],
      };
      replaceUserPortal(resetPortal);
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(resetPortal, payload);
      replaceUserPortal({
        ...updatedPortal,
        draftSummary: emptyDraftSummary(),
      });
      setNotice("Работа по кабинету обнулена: аудиты, черновики и согласование удалены.");
    } catch {
      setNotice("Не удалось обнулить работу по кабинету. Попробуйте повторить позже.");
      replaceUserPortal({
        ...portal,
        syncStatus: "error",
      });
    } finally {
      setLoadingPortalCards((items) => {
        const next = { ...items };
        delete next[portalKey];
        return next;
      });
    }
  }

  async function loadPortalCards(portal, { force = false, resetWork = false } = {}) {
    if (!portal || portal.isDemo || !portal.apiConnected || (!force && portal.realCards?.length)) {
      return;
    }
    const portalKey = String(portal.id);
    if (loadingPortalCards[portalKey]) {
      return;
    }
    setLoadingPortalCards((items) => ({ ...items, [portalKey]: true }));
    try {
      if (resetWork) {
        await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/reset-work-cache`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        clearLocalDraftsForPortal(portal.id);
        resetPortalWorkSummary(portal.id);
        replaceUserPortal({
          ...portal,
          draftSummary: emptyDraftSummary(),
          realCards: portal.realCards || [],
        });
      }
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(portal, payload);
      replaceUserPortal(resetWork ? {
        ...updatedPortal,
        draftSummary: emptyDraftSummary(),
      } : updatedPortal);
    } catch {
      replaceUserPortal({
        ...portal,
        syncStatus: "error",
        draftSummary: resetWork ? emptyDraftSummary() : portal.draftSummary,
      });
    } finally {
      setLoadingPortalCards((items) => {
        const next = { ...items };
        delete next[portalKey];
        return next;
      });
    }
  }

  function cardsForPortal(portal) {
    return portal.realCards?.length ? portal.realCards : (portal.isDemo ? demoCards : []);
  }

  function openCard(card) {
    setSelectedCard(card);
    setSelectedCardKey(cardDraftKey(card));
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
    if (portal.mode === "manual") {
      setNotice(manualBootstrapNotice(portal, "create"));
    }
  }

  async function replacePortalApiToken(targetPortal, payload) {
    const response = await apiRequest(`/api/portals/${encodeURIComponent(targetPortal.id)}/wb-token`, {
      method: "POST",
      body: JSON.stringify({ apiKey: payload.apiKey }),
    });
    const portal = normalizePortal(response.portal);
    replaceUserPortal(portal);
    setPortalModalOpen(false);
    setPortalModalTarget(null);
    setSelectedPortalId(portal.id);
    setScreen("seller");
    const firstCard = (portal.realCards || [])[0] || null;
    if (firstCard) {
      setSelectedCard(firstCard);
      setSelectedCardKey(cardDraftKey(firstCard));
    }
    setNotice("WB API ключ заменен, свежие данные кабинета загружены.");
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

  async function updatePortalName(portal, name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      setNotice("Название кабинета не может быть пустым.");
      return false;
    }
    if (portal.isDemo) {
      setDemoPortal((item) => ({ ...item, name: cleanName }));
      return true;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/name`, {
        method: "POST",
        body: JSON.stringify({ name: cleanName }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      setNotice("Название кабинета сохранено.");
      return true;
    } catch (error) {
      if (error.message === "portal_name_too_long") {
        setNotice("Название слишком длинное. Оставьте до 120 символов.");
      } else {
        setNotice("Не удалось сохранить название кабинета.");
      }
      return false;
    }
  }

  const currentPortalCards = cardsForPortal(currentPortal);
  const selectedCardFromPortal = currentPortalCards.find((card) => cardDraftKey(card) === selectedCardKey) || null;
  const currentPortalKey = String(currentPortal?.id || "");
  const cardScreenLoading = Boolean(
    screen === "card"
    && !selectedCardFromPortal
    && currentPortal
    && !currentPortal.isDemo
    && currentPortal.apiConnected
    && (loadingPortalCards[currentPortalKey] || !currentPortal.realCards?.length)
  );

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
        canManage={canManagePortals}
        helpEnabled={helpEnabled}
        onHelpToggle={setHelpEnabled}
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
            helpEnabled={helpEnabled}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalTarget(null);
              setPortalModalOpen(true);
            }}
          />
        ) : null}

        {screen === "seller" ? (
          <SellerScreen
            portal={currentPortal}
            cards={currentPortalCards}
            cardsLoading={Boolean(loadingPortalCards[currentPortalKey])}
            mpstatsIntegration={mpstatsIntegration}
            displayUsers={displayUsers}
            findUser={findUser}
            canManage={canManagePortals}
            onBack={() => setScreen("cabinets")}
            onOpenCard={openCard}
            onRefreshCards={() => refreshPortalCards(currentPortal)}
            onResetWork={() => resetPortalWork(currentPortal)}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalTarget(currentPortal?.isDemo ? null : currentPortal);
              setPortalModalOpen(true);
            }}
            onUpdateTeam={(teamRoles) => updatePortalTeam(currentPortal, teamRoles)}
            onUpdateName={(name) => updatePortalName(currentPortal, name)}
            onNotice={setNotice}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {screen === "card" && selectedCardFromPortal ? (
          <CardDetailScreen
            key={selectedCardFromPortal?.nmID || selectedCardFromPortal?.vendorCode || selectedCardFromPortal?.title}
            card={selectedCardFromPortal}
            portal={currentPortal}
            currentUser={currentUser}
            onBack={() => setScreen("seller")}
            onDraftSaved={refreshPortals}
            onDraftActivity={(payload) => markPortalWorkActivity(currentPortal.id, cardDraftKey(selectedCardFromPortal), payload)}
            onDraftReset={() => resetPortalWorkActivity(currentPortal.id, cardDraftKey(selectedCardFromPortal))}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {screen === "card" && !selectedCardFromPortal ? (
          <CardRecoveryScreen loading={cardScreenLoading} onBack={() => setScreen("seller")} />
        ) : null}

        {screen === "audit" ? <PlaceholderScreen title="Аудит" copy="MPStats и полноценный аудит подключим отдельным этапом. Сейчас активна загрузка данных WB и ручная проверка карточек." /> : null}
        {(screen === "admin" || screen === "settings") && canManagePortals ? (
          <SettingsScreen
            users={displayUsers}
            portals={allPortals}
            canManage={canManagePortals}
            canManageUsers={canManageUsers}
            mpstatsIntegration={mpstatsIntegration}
            onMpstatsIntegrationChange={setMpstatsIntegration}
            onCreateUser={createUserAccount}
            onUpdateUser={updateUserAccount}
            onResetPassword={resetUserPassword}
            onUpdatePortalTeam={updatePortalTeam}
            helpEnabled={helpEnabled}
          />
        ) : null}
      </main>

      {portalModalOpen ? (
          <PortalModal
            mode={portalModalMode}
            users={displayUsers}
            targetPortal={portalModalTarget}
            onMode={setPortalModalMode}
            onClose={() => {
              setPortalModalOpen(false);
              setPortalModalTarget(null);
            }}
            onSubmit={(payload) => (
              portalModalTarget
                ? replacePortalApiToken(portalModalTarget, payload)
                : createPortal(payload)
            )}
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

function Rail({ user, screen, canManage = false, helpEnabled, onHelpToggle, onNavigate, onLogout }) {
  const nav = [
    { key: "cabinets", label: "Кабинеты", Icon: LayoutDashboard },
    { key: "audit", label: "Аудит", Icon: ClipboardList, disabled: true, status: "скоро" },
    canManage ? { key: "admin", label: "Админка", Icon: Settings } : null,
  ].filter(Boolean);
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
            className={(screen === key || (key === "admin" && screen === "settings")) ? "active" : ""}
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
      <button
        className={`help-switch ${helpEnabled ? "active" : ""}`}
        type="button"
        onClick={() => onHelpToggle(!helpEnabled)}
        aria-pressed={helpEnabled}
      >
        <span className="switch-track"><span /></span>
        <div>
          <strong>Подсказки</strong>
          <em>{helpEnabled ? "включены" : "выключены"}</em>
        </div>
      </button>
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

function CabinetsScreen({ portals, activePortals, statusFilter, onStatusFilter, canManage, findUser, onOpen, onArchive, onRestore, onOpenModal, helpEnabled = false }) {
  const apiCount = activePortals.filter((portal) => portal.apiConnected).length;
  const manualCount = activePortals.filter((portal) => !portal.apiConnected).length;
  const apiCardsCount = activePortals
    .filter((portal) => portal.apiConnected)
    .reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
  const manualCardsCount = activePortals
    .filter((portal) => !portal.apiConnected)
    .reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
  const cardsCount = activePortals.reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
  const approvalTasksCount = activePortals.reduce((sum, portal) => sum + Number(portal.draftSummary?.approvalPendingCount || 0), 0);
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
        <HelpList
          enabled={helpEnabled}
          title="Как начать работу"
          items={[
            "Нажмите Добавить кабинет, чтобы подключить новый WB-кабинет или завести ручной кабинет.",
            "Откройте нужный кабинет, чтобы увидеть карточки, отчеты и маршрут работы по клиенту.",
            "Фильтр Активные / Неактивные помогает спрятать завершенные кабинеты без удаления истории.",
          ]}
        />
        <div className="summary-grid">
          <Metric
            label="Кабинеты в работе"
            value={formatNumber(activePortals.length)}
            hint={`${formatNumber(apiCount)} API · ${formatNumber(manualCount)} ручной`}
          />
          <Metric
            label="Карточки всего"
            value={formatNumber(cardsCount)}
            hint={`${formatNumber(apiCardsCount)} из API · ${formatNumber(manualCardsCount)} ручной импорт`}
          />
          <Metric
            label="API-кабинеты"
            value={formatNumber(apiCount)}
            hint={apiCount ? "данные обновляются по WB API" : "нет подключенных API"}
          />
          <Metric
            label="На согласовании"
            value={formatNumber(approvalTasksCount)}
            hint={approvalTasksCount ? "ожидают решения" : "нет активных задач"}
          />
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
  const displayName = portalDisplayName(portal);
  const creator = portalCreatorInfo(portal, findUser);
  return (
    <article className={`workspace-card ${inactive ? "inactive" : ""}`}>
      <div className="card-head">
        <div className="seller">
          <div className="seller-logo">{initials(displayName || "WB")}</div>
          <div>
            <h2>{displayName}</h2>
            <p>{portal.marketplace} · {owner?.full_name || "ответственный не указан"}</p>
          </div>
        </div>
        <Tag tone={inactive ? "amber" : (portal.apiConnected ? "blue" : "amber")}>{inactive ? "Неактивен" : portal.status}</Tag>
      </div>
      <div className="scope-row">
        <span>Охват</span>
        <strong>{portal.scope === "selected" ? "Выбранные карточки" : "Полный магазин"}</strong>
      </div>
      <div className="scope-row">
        <span>Создал</span>
        <strong>{creator.name}{creator.date ? ` · ${creator.date}` : ""}</strong>
      </div>
      <div className="card-stats">
        <MiniStat value={portal.cardCount} label="карточки" />
        <MiniStat value={portal.problemCount} label="к проверке" />
        <MiniStat value={portal.draftSummary?.approvalPendingCount || 0} label="задачи" />
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

function SellerScreen({ portal, cards, cardsLoading = false, mpstatsIntegration = null, displayUsers, findUser, canManage = false, onBack, onOpenCard, onOpenModal, onRefreshCards, onResetWork, onUpdateTeam, onUpdateName, onNotice, helpEnabled = false }) {
  const owner = findUser(portal.ownerLogin);
  const creator = portalCreatorInfo(portal, findUser);
  const displayName = portalDisplayName(portal);
  const isApi = portal.mode === "api";
  const isManual = !isApi;
  const isMpstatsLoaded = portal.syncStatus === "mpstats-loaded";
  const canRefreshSource = portal.apiConnected || (isManual && Boolean(portal.storeUrl || portal.manualSource));
  const scopeLabel = portal.scope === "selected" ? "выбранные карточки" : "полный магазин";
  const sourceRows = sourceFlowRows(portal, mpstatsIntegration);
  const workRoute = workRouteRows(portal);
  const team = getPortalTeam(portal);
  const [teamEditing, setTeamEditing] = useState(false);
  const [teamDraft, setTeamDraft] = useState(team);
  const [approvalWorkflow, setApprovalWorkflow] = useState(defaultApprovalWorkflow());
  const [approvalWorkflowStatus, setApprovalWorkflowStatus] = useState("idle");
  const [sellerTab, setSellerTab] = useState("work");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [nameSaving, setNameSaving] = useState(false);

  useEffect(() => {
    if (!teamEditing) {
      setTeamDraft(team);
    }
  }, [portal.id, team.lead, team.tech, team.manager, teamEditing]);

  useEffect(() => {
    if (!nameEditing) {
      setNameDraft(displayName);
    }
  }, [displayName, nameEditing]);

  useEffect(() => {
    let active = true;
    if (!portal?.id || portal.isDemo) {
      setApprovalWorkflow(defaultApprovalWorkflow());
      setApprovalWorkflowStatus("idle");
      return () => {
        active = false;
      };
    }
    setApprovalWorkflowStatus("loading");
    apiRequest(`/api/approval-workflow?portal_id=${encodeURIComponent(portal.id)}`)
      .then((payload) => {
        if (!active) return;
        setApprovalWorkflow(normalizeApprovalWorkflow(payload));
        setApprovalWorkflowStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setApprovalWorkflow(defaultApprovalWorkflow());
        setApprovalWorkflowStatus("error");
      });
    return () => {
      active = false;
    };
  }, [
    portal?.id,
    portal?.isDemo,
    portal.draftSummary?.approvalPendingCount,
    portal.draftSummary?.approvalReturnedCount,
    portal.draftSummary?.approvalApprovedCount,
  ]);

  function updateTeamDraft(roleKey, login) {
    setTeamDraft((current) => ({ ...current, [roleKey]: login }));
  }

  function saveTeamDraft() {
    onUpdateTeam(teamDraft);
    setTeamEditing(false);
  }

  async function saveNameDraft() {
    const cleanName = nameDraft.trim();
    if (!cleanName) {
      onNotice?.("Название кабинета не может быть пустым.");
      return;
    }
    setNameSaving(true);
    try {
      const saved = await onUpdateName?.(cleanName);
      if (saved !== false) {
        setNameEditing(false);
      }
    } finally {
      setNameSaving(false);
    }
  }

  function openApprovalTask(task) {
    const card = cards.find((item) => (
      cardDraftKey(item) === task.cardKey
      || String(item?.nmID || "") === String(task.nmID || "")
      || String(item?.vendorCode || "") === String(task.vendorCode || "")
    ));
    if (card) {
      onOpenCard(card);
    }
  }

  function replaceApprovalWorkflow(workflow) {
    setApprovalWorkflow(normalizeApprovalWorkflow(workflow));
    setApprovalWorkflowStatus("loaded");
  }

  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <div className="seller-title-row">
            {nameEditing ? (
              <div className="seller-name-editor">
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  maxLength={120}
                  autoFocus
                />
                <button className="btn primary" type="button" onClick={saveNameDraft} disabled={nameSaving}>
                  {nameSaving ? "Сохраняем" : "Сохранить"}
                </button>
                <button className="btn ghost" type="button" onClick={() => { setNameDraft(displayName); setNameEditing(false); }} disabled={nameSaving}>
                  Отмена
                </button>
              </div>
            ) : (
              <>
                <h1>{displayName}</h1>
                {canManage ? (
                  <IconButton icon={Pencil} label="Редактировать название кабинета" onClick={() => setNameEditing(true)} />
                ) : null}
              </>
            )}
          </div>
          <p>{portal.marketplace} · {scopeLabel} · {portal.syncStatus === "loaded" ? "read-only WB API" : (isMpstatsLoaded ? "MPStats витрина" : (isApi ? "API подключение" : "ручной режим"))} · ответственный {owner?.full_name} · создал {creator.name}{creator.date ? ` · ${creator.date}` : ""}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={onBack}><ArrowLeft size={17} />Кабинеты</button>
          <button className="btn" type="button" onClick={() => onOpenModal("api")}><Upload size={17} />{apiConnectButtonText(portal)}</button>
          <button className="btn primary" type="button" disabled title="Черновики и задачи включим после настройки хранения"><Plus size={17} />Создать задачу</button>
        </div>
      </header>

      <div className="content">
        <div className="seller-layout">
          <div className="seller-main">
            <div className="seller-tabs">
              <button className={sellerTab === "work" ? "active" : ""} type="button" onClick={() => setSellerTab("work")}>Работа</button>
              <button className={sellerTab === "reports" ? "active" : ""} type="button" onClick={() => setSellerTab("reports")}>Отчеты</button>
            </div>
            <HelpHint enabled={helpEnabled} title="Где что находится">
              Вкладка Работа нужна для карточек, аудита и согласования. Вкладка Отчеты нужна, когда сотруднику нужно выбрать период и скачать готовую XLSX-выгрузку по этому кабинету.
            </HelpHint>

            {sellerTab === "work" ? (
              <>
            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Обзор кабинета</h2>
                  <p>Фактическое состояние источника данных и карточек.</p>
                </div>
                <Tag tone={portal.apiConnected ? "blue" : "amber"}>{portal.apiConnected ? "API подключен" : (isManual ? "Без API" : "API ожидает")}</Tag>
              </div>
              <div className="summary-grid">
                <Metric label="Карточек в кабинете" value={formatNumber(portal.cardCount)} />
                <Metric label="К проверке" value={formatNumber(portal.problemCount)} />
                <Metric label="Черновики правок" value={formatNumber(portal.draftSummary?.draftCount || 0)} />
                <Metric label="На согласовании" value={formatNumber(portal.draftSummary?.approvalPendingCount || 0)} />
              </div>
            </section>

            <div className="seller-context-grid">
              <section className="workspace-strip project-strip">
                <div className="panel-title-row">
                  <div>
                    <h2>Состав проекта</h2>
                    <p>Роли команды по этому кабинету.</p>
                  </div>
                  {!teamEditing && canManage ? <button className="btn" type="button" onClick={() => setTeamEditing(true)}>Редактировать</button> : null}
                </div>

                {!teamEditing ? (
                  <div className="project-team-list compact">
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
                  <div className="team-editor compact">
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

              <section className="workspace-strip security-strip">
                <div>
                  <h2>Контур безопасности</h2>
                  <p>{portal.apiConnected ? "Как сейчас разрешено использовать API по этому кабинету." : "Что хранится по кабинету без ключа WB."}</p>
                </div>
                <div className="security-inline-list">
                  <div><span>Чтение WB</span><strong>{portal.apiConnected ? "включено" : (isManual ? "без API" : "ожидает ключ")}</strong></div>
                  <div><span>Запись в WB</span><strong>{portal.wbWriteEnabled ? "включена" : (isManual ? "недоступна без API" : "отдельное включение")}</strong></div>
                  <div><span>Токен</span><strong>{portal.apiConnected ? "backend + AES-GCM" : "не хранится"}</strong></div>
                </div>
              </section>
            </div>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Источник данных</h2>
                  <p>{portal.syncStatus === "loaded"
                    ? "Список карточек загружен из WB API через backend. Сейчас OptiCards читает данные и готовит черновики; запись в WB включается отдельно по договоренности с клиентом."
                    : (isMpstatsLoaded
                      ? "Кабинет заведен без WB API, а карточки загружены через MPStats по ссылке на магазин, бренд, продавца или nmID. API можно подключить позже."
                    : (isManual
                      ? "Кабинет заведен без WB API. Здесь фиксируем ссылку на магазин, исходные данные от клиента и команду; карточки можно добавить вручную или позже подключить API."
                      : "Кабинет подключается для чтения данных. Возможность записи в WB настраивается отдельным режимом работы."))}</p>
                </div>
                <Tag tone={portal.apiConnected || isMpstatsLoaded ? "blue" : "amber"}>{portal.apiConnected ? "API подключен" : (isMpstatsLoaded ? "MPStats витрина" : (isManual ? "Без API" : "ручной режим"))}</Tag>
              </div>
              <HelpHint enabled={helpEnabled} title="Когда нажимать обновление">
                Нажимайте Загрузить свежие данные перед новой волной аудита или отчетом. Это обновит снимок карточек из WB, а старые рекомендации аудита пометит как устаревшие.
              </HelpHint>
              <div className="panel-actions">
                <button className="btn" type="button" onClick={onRefreshCards} disabled={!canRefreshSource || cardsLoading}>
                  <RefreshCw size={16} />{cardsLoading ? "Загружаем данные" : (portal.apiConnected ? "Загрузить свежие данные" : "Обновить из MPStats")}
                </button>
                <button className="btn ghost" type="button" onClick={onResetWork} disabled={!portal.apiConnected || cardsLoading}>
                  <Trash2 size={16} />Обнулить работу
                </button>
                <button className="btn" type="button" onClick={() => onOpenModal("api")}>{apiConnectButtonText(portal)}</button>
              </div>
              <div className="source-flow">
                {sourceRows.map(([label, value]) => (
                  <div className="list-row source-flow-row" key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
              {isManual ? <ManualPortalSource portal={portal} /> : null}
            </section>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Маршрут работы</h2>
                  <p>{workRoute.copy}</p>
                </div>
                <Tag tone={workRoute.done ? "blue" : "amber"}>{workRoute.done ? `Факт: ${workRoute.done} из 5` : "Ожидает данные"}</Tag>
              </div>
              <HelpHint enabled={helpEnabled} title="Маршрут работы по кабинету">
                Идите слева направо: загрузили данные, открыли карточки, запустили аудит, проверили изменения, отправили на согласование. Счетчики показывают, где работа уже началась.
              </HelpHint>
              <div className="pipeline">
                {workRoute.rows.map((step) => (
                  <div className={`step ${step.className}`} key={step.title}>
                    <strong>{step.title}</strong>
                    <span>{step.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <ApprovalWorkflowPanel
              workflow={approvalWorkflow}
              status={approvalWorkflowStatus}
              cards={cards}
              findUser={findUser}
              onOpenTask={openApprovalTask}
            />

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Карточки</h2>
                  <p>Фильтрация реальных карточек, причины проверки и ограниченный рабочий набор специалиста.</p>
                </div>
                <Tag tone={portal.scope === "selected" ? "blue" : "amber"}>{portal.scope === "selected" ? "выборочно" : "полный магазин"}</Tag>
              </div>
              <HelpHint enabled={helpEnabled} title="Как открыть аудит карточки">
                Найдите карточку по артикулу или WB ID и нажмите Открыть. Внутри карточки перейдите на вкладку Аудит и нажмите Запустить аудит.
              </HelpHint>
              <CardsTable
                cards={cards}
                portal={portal}
                workflow={approvalWorkflow}
                onOpenCard={onOpenCard}
                onWorkflowChange={replaceApprovalWorkflow}
              />
            </section>
              </>
            ) : (
              <ReportsPanel portal={portal} cards={cards} onNotice={onNotice} helpEnabled={helpEnabled} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReportsPanel({ portal, cards, onNotice, helpEnabled = false }) {
  const [period, setPeriod] = useState(defaultClientReportRange);
  const [selectedReportId, setSelectedReportId] = useState(sellerReportTemplates[0].id);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("idle");
  const [reportStatus, setReportStatus] = useState("idle");
  const selectedReport = sellerReportTemplate(selectedReportId);
  const availability = clientReportAvailability(cards, portal);
  const availableCount = availability.filter((row) => row[1] === "есть").length;
  const partialCount = availability.filter((row) => row[1] === "частично").length;
  const unavailableCount = availability.filter((row) => row[1] === "не подключено" || row[1] === "нет данных").length;
  const isLoading = reportStatus === "loading";

  useEffect(() => {
    setReportStatus("idle");
    loadReportHistory();
  }, [portal?.id]);

  async function loadReportHistory() {
    if (!portal) {
      setHistory([]);
      return;
    }
    if (portal.isDemo) {
      setHistory(readReportHistory(portal.id));
      setHistoryStatus("local");
      return;
    }
    setHistoryStatus("loading");
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/report-history?limit=20`);
      setHistory(normalizeReportHistory(payload.history || []));
      setHistoryStatus("loaded");
    } catch {
      setHistory(readReportHistory(portal.id));
      setHistoryStatus("error");
    }
  }

  async function rememberReport(entry) {
    const nextHistory = [entry, ...history].slice(0, 20);
    setHistory(nextHistory);
    if (portal?.isDemo) {
      saveReportHistory(portal?.id, nextHistory);
      return entry;
    }
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/report-history`, {
        method: "POST",
        body: JSON.stringify(entry),
      });
      const savedItem = normalizeReportHistory([payload.item])[0];
      if (savedItem) {
        setHistory((current) => [savedItem, ...current.filter((item) => item.id !== entry.id)].slice(0, 20));
        return savedItem;
      }
    } catch {
      saveReportHistory(portal?.id, nextHistory);
      onNotice?.("Отчет скачан, но backend-история временно недоступна. Запись оставлена локально.");
    }
    return entry;
  }

  async function generateReport({ reportId = selectedReportId, reportPeriod = period } = {}) {
    if (!portal) {
      return;
    }
    if (!reportPeriod.start || !reportPeriod.end || reportPeriod.start > reportPeriod.end) {
      onNotice?.("Выберите корректный период отчета.");
      return;
    }
    const template = sellerReportTemplate(reportId);
    const datePart = `${reportPeriod.start}_${reportPeriod.end}`;
    const fileName = `${safeFilePart(portalDisplayName(portal))}-wb-client-report-${datePart}.xlsx`;
    setReportStatus("loading");
    try {
      const query = clientReportPeriodQuery(reportPeriod.start, reportPeriod.end);
      const reportPayload = portal.apiConnected && !portal.isDemo
        ? await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/wb-client-report?${query}`)
        : { report: null };
      downloadXlsx(
        fileName,
        buildClientWbReportSheets(portal, cards, reportPayload.report || null),
      );
      await rememberReport({
        id: `report-${Date.now()}`,
        reportId,
        title: template.title,
        format: template.format,
        period: reportPeriod,
        fileName,
        status: "done",
        generatedAt: new Date().toISOString(),
        source: portal.apiConnected && !portal.isDemo ? "WB API" : "снимок карточек",
      });
      setReportStatus("done");
    } catch (error) {
      downloadXlsx(
        fileName,
        buildClientWbReportSheets(portal, cards),
      );
      await rememberReport({
        id: `report-${Date.now()}`,
        reportId,
        title: template.title,
        format: template.format,
        period: reportPeriod,
        fileName,
        status: "partial",
        generatedAt: new Date().toISOString(),
        source: "снимок карточек",
      });
      setReportStatus("error");
      onNotice?.("WB не отдал часть данных отчета. Скачал файл по текущему снимку карточек; попробуйте повторить позже.");
    }
  }

  function repeatReport(item) {
    const nextPeriod = item?.period || period;
    setSelectedReportId(item?.reportId || sellerReportTemplates[0].id);
    setPeriod(nextPeriod);
    generateReport({ reportId: item?.reportId || sellerReportTemplates[0].id, reportPeriod: nextPeriod });
  }

  return (
    <>
      <section className="workspace-strip reports-strip">
        <div className="strip-head">
          <div>
            <h2>Нужен отчет</h2>
            <p>{portal ? `Кабинет: ${portalDisplayName(portal)} · выберите отчет и период.` : "Кабинет не выбран."}</p>
          </div>
          <Tag tone={portal?.apiConnected ? "blue" : "amber"}>{portal?.apiConnected ? "WB API" : "снимок карточек"}</Tag>
        </div>
        <HelpList
          enabled={helpEnabled}
          title="Как скачать отчет"
          items={[
            "Выберите тип отчета. Сейчас доступен клиентский WB-отчет.",
            "Выберите период С какого числа и По какое число.",
            "Нажмите Сформировать. Файл XLSX с вкладками Остатки, Акции и выбранным периодом скачается автоматически.",
          ]}
        />
        <div className="report-builder">
          <div className="report-template-list">
            {sellerReportTemplates.map((template) => (
              <button
                className={`report-template ${selectedReportId === template.id ? "active" : ""}`}
                key={template.id}
                type="button"
                onClick={() => setSelectedReportId(template.id)}
              >
                <span>{template.title}</span>
                <em>{template.description}</em>
                <Tag tone="blue">{template.format}</Tag>
              </button>
            ))}
          </div>
          <div className="report-period-form">
            <label className="field-label">
              С какого числа
              <input type="date" value={period.start} onChange={(event) => setPeriod((current) => ({ ...current, start: event.target.value }))} />
            </label>
            <label className="field-label">
              По какое число
              <input type="date" value={period.end} onChange={(event) => setPeriod((current) => ({ ...current, end: event.target.value }))} />
            </label>
            <button className="btn primary" type="button" onClick={() => generateReport()} disabled={!portal || isLoading}>
              <Download size={17} />{isLoading ? "Формируем" : "Сформировать"}
            </button>
          </div>
        </div>
      </section>

      <div className="report-catalog">
        <article className="workspace-strip report-card">
          <div className="strip-head">
            <div>
              <h2>{selectedReport.title}</h2>
              <p>{selectedReport.description}</p>
            </div>
            <Tag tone="blue">первый отчет</Tag>
          </div>
          <div className="summary-grid">
            <Metric label="Карточек" value={formatNumber(cards.length || portal?.cardCount || 0)} hint={portal?.apiConnected ? "источник: WB API" : "ручной источник"} />
            <Metric label="Данные есть" value={formatNumber(availableCount)} hint="доступные блоки" />
            <Metric label="Частично" value={formatNumber(partialCount)} hint="нужна проверка" />
            <Metric label="Нет данных" value={formatNumber(unavailableCount)} hint="зависит от API" />
          </div>
          <HelpHint enabled={helpEnabled} title="Что означает доступность данных">
            Эти строки показывают, какие блоки WB API доступны для отчета. Если часть данных недоступна, файл все равно скачивается, но соответствующие колонки будут пустыми или частичными.
          </HelpHint>
          <div className="report-availability">
            {availability.map(([label, status, source]) => (
              <div className="report-availability-row" key={label}>
                <span>{label}</span>
                <Tag tone={status === "есть" ? "green" : status === "частично" ? "amber" : "blue"}>{status}</Tag>
                <em>{source}</em>
              </div>
            ))}
          </div>
          <div className="report-card-actions">
            <span>Период: {clientReportRangeLabel(period.start, period.end)}</span>
            <span>Файл скачивается сразу после формирования.</span>
          </div>
        </article>
      </div>

      <section className="workspace-strip report-history">
        <div className="strip-head">
          <div>
            <h2>История отчетов</h2>
            <p>Последние сформированные выгрузки по этому кабинету.</p>
          </div>
          <Tag tone={historyStatus === "error" ? "amber" : history.length ? "blue" : "amber"}>
            {historyStatus === "loading"
              ? "загрузка"
              : historyStatus === "error"
                ? "локально"
                : history.length || "пусто"}
          </Tag>
        </div>
        <HelpHint enabled={helpEnabled} title="Зачем нужна история">
          История хранится внутри этого кабинета и доступна сотрудникам с доступом к нему. По кнопке Скачать снова можно повторить выгрузку с тем же периодом.
        </HelpHint>
        {history.length ? (
          <div className="report-history-list">
            {history.map((item) => (
              <div className="report-history-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{clientReportRangeLabel(item.period?.start, item.period?.end)} · {item.generatedAt ? new Date(item.generatedAt).toLocaleString("ru-RU") : "без даты"}</span>
                  <em>{item.fileName}</em>
                </div>
                <Tag tone={reportHistoryStatusTone(item.status)}>{reportHistoryStatusLabel(item.status)}</Tag>
                <button className="btn mini" type="button" onClick={() => repeatReport(item)} disabled={isLoading}>Скачать снова</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">После формирования отчета здесь появятся дата, период и имя файла.</p>
        )}
      </section>
    </>
  );
}

function CardsTable({ cards, portal, workflow = defaultApprovalWorkflow(), onOpenCard, onWorkflowChange }) {
  const storageKey = `opticards-workset:${portal?.id || "portal"}`;
  const [query, setQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState("all");
  const [workFilter, setWorkFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState(() => readCardWorkset(storageKey));
  const [workPackageOpen, setWorkPackageOpen] = useState(false);
  const [workPackageForm, setWorkPackageForm] = useState({ workTypes: ["content"], comment: "" });
  const [worksetLoaded, setWorksetLoaded] = useState(Boolean(portal?.isDemo));
  const [worksetStatus, setWorksetStatus] = useState("idle");
  const [batchStatus, setBatchStatus] = useState("idle");
  const cardKeySignature = cards.map(cardStableKey).join("|");

  useEffect(() => {
    setSelectedKeys(readCardWorkset(storageKey));
    setWorkPackageOpen(false);
    setWorkPackageForm({ workTypes: ["content"], comment: "" });
    setWorksetLoaded(Boolean(portal?.isDemo));
    setWorksetStatus("idle");
    setBatchStatus("idle");
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    if (!portal?.id || portal.isDemo) {
      setWorksetLoaded(true);
      return () => {
        active = false;
      };
    }
    setWorksetStatus("loading");
    apiRequest(`/api/card-workset?portal_id=${encodeURIComponent(portal.id)}`)
      .then((payload) => {
        if (!active) return;
        const keys = (payload.cards || payload.workset?.cards || []).map((card) => String(card.cardKey || "")).filter(Boolean);
        setSelectedKeys(keys);
        writeCardWorkset(storageKey, keys);
        setWorksetLoaded(true);
        setWorksetStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setWorksetLoaded(true);
        setWorksetStatus("local-fallback");
      });
    return () => {
      active = false;
    };
  }, [portal?.id, portal?.isDemo, storageKey]);

  useEffect(() => {
    const validKeys = new Set(cards.map(cardStableKey));
    setSelectedKeys((current) => current.filter((key) => validKeys.has(key)));
  }, [cardKeySignature]);

  useEffect(() => {
    writeCardWorkset(storageKey, selectedKeys);
    if (!worksetLoaded || !portal?.id || portal.isDemo) {
      return;
    }
    const selectedCardsForSave = cards
      .filter((card) => selectedKeys.includes(cardStableKey(card)))
      .map(cardWorksetPayload);
    setWorksetStatus("saving");
    apiRequest("/api/card-workset", {
      method: "POST",
      body: JSON.stringify({ portalId: portal.id, cards: selectedCardsForSave }),
    })
      .then(() => setWorksetStatus("saved"))
      .catch(() => setWorksetStatus("local-fallback"));
  }, [storageKey, selectedKeys, worksetLoaded, portal?.id, portal?.isDemo, cardKeySignature]);

  if (!cards.length) {
    const isManualPortal = portal.mode === "manual";
    const hasManualSource = Boolean(portal.storeUrl || portal.manualSource);
    return (
      <div className="empty-state">
        <strong>{portal.apiConnected ? "Карточки еще не загружены" : (isManualPortal ? "Кабинет заведен без API" : "Нет источника карточек")}</strong>
        <span>{portal.apiConnected
          ? "Обновите данные WB, чтобы увидеть список."
          : (isManualPortal
            ? (hasManualSource ? "Ссылка или исходные данные сохранены. Нажмите «Обновить из MPStats», чтобы повторить загрузку карточек." : "Можно сохранить ссылку на магазин, список nmID или позже подключить API.")
            : "Подключите API или добавьте ручной импорт.")}</span>
      </div>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const categories = [...new Set(cards.map((card) => String(card.subjectName || "категория не указана").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"));
  const selectedSet = new Set(selectedKeys);
  const approvalTaskLookup = buildApprovalTaskLookup(workflow.tasks || []);
  const problemCards = cards.filter((card) => cardProblemReasons(card).length);
  const signalCards = cards.filter((card) => cardDataSignals(card).length);
  const signalOnlyCards = signalCards.filter((card) => !cardProblemReasons(card).length);
  const cleanCards = cards.filter((card) => !cardProblemReasons(card).length && !cardDataSignals(card).length).length;
  const selectedCards = cards.filter((card) => selectedSet.has(cardStableKey(card)));
  const taskCards = cards.filter((card) => approvalTaskForCard(card, approvalTaskLookup));
  const visibleCards = cards.filter((card) => {
    const key = cardStableKey(card);
    const hasProblems = cardProblemReasons(card).length > 0;
    const hasSignals = cardDataSignals(card).length > 0;
    const hasTask = Boolean(approvalTaskForCard(card, approvalTaskLookup));
    if (issueFilter === "problems" && !hasProblems) {
      return false;
    }
    if (issueFilter === "clean" && (hasProblems || hasSignals)) {
      return false;
    }
    if (issueFilter === "selected" && !selectedSet.has(key)) {
      return false;
    }
    if (issueFilter === "signals" && (!hasSignals || hasProblems)) {
      return false;
    }
    if (workFilter === "tasks" && !hasTask) {
      return false;
    }
    if (workFilter === "selected" && !selectedSet.has(key)) {
      return false;
    }
    if (workFilter === "none" && (selectedSet.has(key) || hasTask)) {
      return false;
    }
    if (categoryFilter !== "all" && String(card.subjectName || "категория не указана") !== categoryFilter) {
      return false;
    }
    if (normalizedQuery && !normalizedCardSearchText(card).includes(normalizedQuery)) {
      return false;
    }
    return true;
  });
  const visibleKeys = visibleCards.map(cardStableKey);
  const allVisibleSelected = Boolean(visibleKeys.length) && visibleKeys.every((key) => selectedSet.has(key));
  const selectedProblemCount = selectedCards.filter((card) => cardProblemReasons(card).length).length;
  const dominantCategory = selectedCards.length
    ? [...new Set(selectedCards.map((card) => card.subjectName || "категория не указана"))][0]
    : "не выбран";

  function toggleCard(card) {
    const key = cardStableKey(card);
    setSelectedKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  }

  function toggleVisible() {
    setSelectedKeys((current) => {
      const currentSet = new Set(current);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => currentSet.delete(key));
      } else {
        visibleKeys.forEach((key) => currentSet.add(key));
      }
      return [...currentSet];
    });
  }

  function resetFilters() {
    setQuery("");
    setIssueFilter("all");
    setWorkFilter("all");
    setCategoryFilter("all");
  }

  function isSummaryFilterActive({ issue = "all", work = "all" }) {
    return issueFilter === issue && workFilter === work;
  }

  function applySummaryFilter({ issue = "all", work = "all" }) {
    setQuery("");
    setCategoryFilter("all");
    if (isSummaryFilterActive({ issue, work })) {
      setIssueFilter("all");
      setWorkFilter("all");
      return;
    }
    setIssueFilter(issue);
    setWorkFilter(work);
  }

  async function createWorkPackage(options = workPackageForm) {
    if (!selectedCards.length || portal?.isDemo) {
      return;
    }
    const workTypes = normalizeWorkTypes(options.workTypes);
    setBatchStatus("saving");
    try {
      const payload = await apiRequest("/api/card-workset/create-tasks", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          cards: selectedCards.map(cardWorksetPayload),
          workTypes,
          comment: String(options.comment || "").trim(),
        }),
      });
      if (payload.workflow && onWorkflowChange) {
        onWorkflowChange(payload.workflow);
      }
      const keys = (payload.workset?.cards || []).map((card) => String(card.cardKey || "")).filter(Boolean);
      if (keys.length) {
        setSelectedKeys(keys);
      }
      setWorkPackageOpen(false);
      setBatchStatus("created");
    } catch {
      setBatchStatus("error");
    }
  }

  return (
    <div className="cards-workspace">
      <div className="cards-control-panel">
        <div className="cards-work-summary">
          <button
            className={`work-summary-item ${isSummaryFilterActive({ issue: "problems" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ issue: "problems" })}
            title={isSummaryFilterActive({ issue: "problems" }) ? "Показать все карточки" : "Показать карточки, требующие внимания"}
          >
            <span>Требуют внимания</span>
            <strong>{formatNumber(problemCards.length)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ issue: "signals" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ issue: "signals" })}
            title={isSummaryFilterActive({ issue: "signals" }) ? "Показать все карточки" : "Показать карточки с некритичными замечаниями"}
          >
            <span>Некритичные замечания</span>
            <strong>{formatNumber(signalOnlyCards.length)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ issue: "clean" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ issue: "clean" })}
            title={isSummaryFilterActive({ issue: "clean" }) ? "Показать все карточки" : "Показать карточки без замечаний"}
          >
            <span>Без проблем</span>
            <strong>{formatNumber(cleanCards)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ work: "tasks" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ work: "tasks" })}
            title={isSummaryFilterActive({ work: "tasks" }) ? "Показать все карточки" : "Показать карточки в задачах"}
          >
            <span>В задачах</span>
            <strong>{formatNumber(taskCards.length)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ work: "selected" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ work: "selected" })}
            title={isSummaryFilterActive({ work: "selected" }) ? "Показать все карточки" : "Показать рабочий набор"}
          >
            <span>В рабочем наборе</span>
            <strong>{formatNumber(selectedCards.length)}</strong>
          </button>
          <div className="work-summary-note">
            <strong>{selectedCards.length ? `${selectedProblemCount} с проблемами` : "Набор пуст"}</strong>
            <span>{selectedCards.length ? `первая категория: ${dominantCategory}` : "выберите видимые строки или отдельные карточки"}</span>
          </div>
        </div>

        <div className="card-filters">
          <label className="search-field card-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию, nmID, артикулу, бренду" />
          </label>
          <select className="select" value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}>
            <option value="all">Все карточки</option>
            <option value="problems">Требуют внимания</option>
            <option value="signals">Некритичные замечания</option>
            <option value="clean">Без проблем</option>
            <option value="selected">Рабочий набор</option>
          </select>
          <select className="select" value={workFilter} onChange={(event) => setWorkFilter(event.target.value)}>
            <option value="all">Любая работа</option>
            <option value="tasks">Есть задача</option>
            <option value="selected">В рабочем наборе</option>
            <option value="none">Нет задачи</option>
          </select>
          <select className="select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">Все категории</option>
            {categories.map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
        </div>

        <div className="cards-toolbar">
          <span>
            Показано {formatNumber(visibleCards.length)} из {formatNumber(cards.length)}
            {worksetStatus === "saving" ? " · сохраняем набор" : ""}
            {worksetStatus === "local-fallback" ? " · набор только в браузере" : ""}
            {batchStatus === "created" ? " · взято в работу" : ""}
            {batchStatus === "error" ? " · не удалось взять в работу" : ""}
          </span>
          <div className="toolbar">
            <button className="btn primary" type="button" onClick={() => setWorkPackageOpen(true)} disabled={portal?.isDemo || !selectedCards.length || batchStatus === "saving"}>
              <Plus size={16} />{batchStatus === "saving" ? "Берем в работу" : "Взять в работу"}
            </button>
            <button className="btn" type="button" onClick={toggleVisible} disabled={!visibleCards.length}>
              <CheckSquare size={16} />{allVisibleSelected ? "Убрать видимые" : "Выбрать видимые"}
            </button>
            <button className="btn" type="button" onClick={() => setSelectedKeys([])} disabled={!selectedKeys.length}>Очистить набор</button>
            <button className="btn ghost" type="button" onClick={resetFilters}>Сбросить фильтры</button>
          </div>
        </div>
      </div>

      {workPackageOpen ? (
        <WorkPackageModal
          selectedCount={selectedCards.length}
          value={workPackageForm}
          loading={batchStatus === "saving"}
          onChange={setWorkPackageForm}
          onClose={() => setWorkPackageOpen(false)}
          onSubmit={(nextValue) => createWorkPackage(nextValue)}
        />
      ) : null}

      {visibleCards.length ? (
        <div className="table-wrap cards-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="select-col">
                  <input type="checkbox" aria-label="Выбрать видимые карточки" checked={allVisibleSelected} onChange={toggleVisible} />
                </th>
                <th>Карточка</th>
                <th>nmID</th>
                <th>Заполненность</th>
                <th>Замечания по данным</th>
                <th>Работа</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {visibleCards.map((card, index) => {
                const key = cardStableKey(card);
                const reasons = cardProblemReasons(card);
                const signals = cardDataSignals(card);
                const completeness = cardCompleteness(card);
                const task = approvalTaskForCard(card, approvalTaskLookup);
                const workState = cardWorkStateForTask(card, selectedSet, task);
                return (
                  <tr key={key || `${card.nmID || index}-${card.title}`} className={selectedSet.has(key) ? "selected-row" : ""}>
                    <td className="select-col">
                      <input type="checkbox" aria-label="Добавить карточку в рабочий набор" checked={selectedSet.has(key)} onChange={() => toggleCard(card)} />
                    </td>
                    <td>
                      <div className="product-cell">
                        <Thumb url={bestPhotoUrl(card)} alt={index % 2 === 1} />
                        <div className="product-name">
                          <strong>{card.title || "Карточка WB"}</strong>
                          <span>категория: {card.subjectName || "не указана"} · артикул {textOrDash(card.vendorCode)}</span>
                        </div>
                      </div>
                    </td>
                    <td>{card.nmID || "Не указано"}</td>
                    <td><Tag tone={completeness.tone}>{completeness.label}</Tag></td>
                    <td>
                      <div className="problem-reasons">
                        {reasons.map((reason) => <Tag tone="amber" key={reason}>{reason}</Tag>)}
                        {!reasons.length && signals.length ? signals.map((signal) => <Tag tone="blue" key={signal}>{signal}</Tag>) : null}
                        {!reasons.length && !signals.length ? <Tag tone="green">без замечаний</Tag> : null}
                      </div>
                    </td>
                    <td><Tag tone={workState.tone}>{workState.label}</Tag></td>
                    <td><IconButton icon={Eye} label="Открыть детальную карточку" onClick={() => onOpenCard(card)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <strong>По текущим фильтрам карточек нет</strong>
          <span>Измените поиск, статус или категорию.</span>
        </div>
      )}
    </div>
  );
}

function WorkPackageModal({ selectedCount, value, loading, onChange, onClose, onSubmit }) {
  const workTypes = normalizeWorkTypes(value.workTypes);
  const comment = value.comment || "";
  const toggleType = (key) => {
    if (workTypes.length === 1 && workTypes.includes(key)) {
      return;
    }
    const nextTypes = workTypes.includes(key)
      ? workTypes.filter((item) => item !== key)
      : [...workTypes, key];
    onChange({ ...value, workTypes: nextTypes });
  };
  const updateComment = (event) => {
    onChange({ ...value, comment: event.target.value });
  };
  const submit = (event) => {
    event.preventDefault();
    onSubmit({ workTypes, comment });
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal work-package-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Взять карточки в работу</h2>
            <p>{formatNumber(selectedCount)} {pluralRu(selectedCount, "карточка", "карточки", "карточек")} попадет в задачу техническому специалисту.</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          <div className="work-type-picker">
            {workTypeOptions.map((option) => (
              <label className={`work-type-option ${workTypes.includes(option.key) ? "active" : ""}`} key={option.key}>
                <input type="checkbox" checked={workTypes.includes(option.key)} onChange={() => toggleType(option.key)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <label className="field-label">
            Комментарий
            <textarea value={comment} onChange={updateComment} placeholder="Например: проверить заголовки и описание перед согласованием." />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className="btn primary" type="submit" disabled={loading || !workTypes.length}>
            {loading ? "Создаем задачу" : "Создать задачу"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ApprovalWorkflowPanel({ workflow, status, cards, findUser, onOpenTask }) {
  const tasks = workflow.tasks || [];
  const activeTasks = tasks.filter((task) => ["draft", "submitted", "changes_requested"].includes(task.status));
  const analytics = workflow.analytics || {};
  const recentEvents = workflow.recentEvents || [];
  const cardKeys = new Set(cards.map(cardDraftKey));
  return (
    <section className="workspace-strip approval-workflow-strip">
      <div className="strip-head">
        <div>
          <h2>Задачи и согласование</h2>
          <p>Очередь карточек для технического специалиста, согласование и история решений по кабинету.</p>
        </div>
        <Tag tone={activeTasks.length ? "amber" : "green"}>
          {status === "loading" ? "загрузка" : `${activeTasks.length} ${pluralRu(activeTasks.length, "задача", "задачи", "задач")}`}
        </Tag>
      </div>

      {status === "error" ? (
        <div className="empty-state"><span>Не удалось загрузить задачи согласования</span></div>
      ) : null}

      <div className="approval-task-list">
        {activeTasks.length ? activeTasks.map((task) => {
          const canOpen = cardKeys.has(task.cardKey);
          const assignee = findUser(task.assigneeLogin);
          const author = findUser(task.submittedBy);
          const labels = Array.isArray(task.workTypeLabels) && task.workTypeLabels.length ? task.workTypeLabels : workTypeLabels(task.workTypes);
          return (
            <article className="approval-task-card" key={`${task.cardKey}-${task.status}`}>
              <div className="approval-task-main">
                <div>
                  <strong>{task.title}</strong>
                  <span>WB {textOrDash(task.nmID)} · артикул {textOrDash(task.vendorCode)} · {textOrDash(task.subjectName)}</span>
                </div>
                <Tag tone={approvalStatusTone(task.status)}>{approvalStatusLabel(task.status)}</Tag>
              </div>
              <div className="approval-task-tags">
                {labels.map((label) => <Tag tone="blue" key={label}>{label}</Tag>)}
                {task.batchCardsCount ? <Tag tone="amber">{formatNumber(task.batchCardsCount)} в пачке</Tag> : null}
              </div>
              <div className="approval-task-meta">
                <span>Автор: {author?.full_name || task.submittedBy || "не указан"}</span>
                <span>Исполнитель: {assignee?.full_name || task.assigneeLogin || "техспециалист не задан"}</span>
                <span>{task.submittedAt ? new Date(task.submittedAt).toLocaleString("ru-RU") : "без даты"}</span>
              </div>
              {task.workComment ? <p className="approval-task-reason">{task.workComment}</p> : null}
              {task.returnReason ? <p className="approval-task-reason">{task.returnReason}</p> : null}
              <div className="approval-task-actions">
                <button className="btn primary" type="button" onClick={() => onOpenTask(task)} disabled={!canOpen}>
                  <Eye size={17} />{task.status === "draft" ? "Открыть карточку" : "Открыть изменения"}
                </button>
              </div>
            </article>
          );
        }) : (
          <div className="empty-state"><span>{status === "loading" ? "Загружаем задачи..." : "Нет карточек, ожидающих решения"}</span></div>
        )}
      </div>

      <div className="approval-analytics-grid">
        <Metric label="Ждет решения" value={formatNumber(analytics.pendingCount || 0)} />
        <Metric label="На доработке" value={formatNumber(analytics.returnedCount || 0)} />
        <Metric label="Принято" value={formatNumber(analytics.approvedCount || 0)} />
        <Metric label="Среднее согласование" value={durationShort(analytics.avgApprovalMinutes)} />
      </div>

      <div className="approval-events">
        <div className="approval-events-head">
          <strong>История решений</strong>
          <span>{recentEvents.length ? `${recentEvents.length} последних событий` : "пока пусто"}</span>
        </div>
        {recentEvents.length ? recentEvents.slice(0, 8).map((event) => {
          const actor = findUser(event.actorLogin);
          return (
            <div className="approval-event-row" key={event.id}>
              <div>
                <strong>{approvalEventLabel(event.action)}</strong>
                <span>{event.title} · {actor?.full_name || event.actorLogin || "пользователь"}</span>
                {event.reason ? <p>{event.reason}</p> : null}
              </div>
              <time>{event.eventAt ? new Date(event.eventAt).toLocaleString("ru-RU") : "без даты"}</time>
            </div>
          );
        }) : (
          <div className="empty-state"><span>История появится после отправки, возврата или принятия правок.</span></div>
        )}
      </div>
    </section>
  );
}

function CardDetailScreen({ card, portal, currentUser, onBack, onDraftSaved, onDraftActivity, onDraftReset, helpEnabled = false }) {
  const [activeTab, setActiveTab] = useState("card");
  const [changesTab, setChangesTab] = useState("content");
  const [auditStatus, setAuditStatus] = useState("idle");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTitleSource, setDraftTitleSource] = useState("");
  const [draftDescriptionSource, setDraftDescriptionSource] = useState("");
  const [draftTitleReason, setDraftTitleReason] = useState("");
  const [draftDescriptionReason, setDraftDescriptionReason] = useState("");
  const [draftCharacteristics, setDraftCharacteristics] = useState({});
  const [draftPrices, setDraftPrices] = useState(() => priceDraftFromCard(card));
  const [draftStocks, setDraftStocks] = useState(() => normalizeDraftStocks({}, card));
  const [approval, setApproval] = useState(defaultApprovalState());
  const [approvalSections, setApprovalSections] = useState(defaultApprovalSections());
  const [approvalComment, setApprovalComment] = useState("");
  const [auditHistory, setAuditHistory] = useState([]);
  const [subjectCharacteristics, setSubjectCharacteristics] = useState([]);
  const [subjectCharacteristicsStatus, setSubjectCharacteristicsStatus] = useState("idle");
  const [mpstatsCharacteristics, setMpstatsCharacteristics] = useState([]);
  const [mpstatsCharacteristicsStatus, setMpstatsCharacteristicsStatus] = useState("idle");
  const [mpstatsCharacteristicsMs, setMpstatsCharacteristicsMs] = useState(null);
  const [mpstatsCharacteristicsMeta, setMpstatsCharacteristicsMeta] = useState({});
  const [semanticCore, setSemanticCore] = useState(null);
  const [semanticCoreStatus, setSemanticCoreStatus] = useState("idle");
  const [semanticCoreError, setSemanticCoreError] = useState("");
  const [semanticRankStatus, setSemanticRankStatus] = useState("idle");
  const [semanticSaveStatus, setSemanticSaveStatus] = useState("");
  const [semanticContentStatus, setSemanticContentStatus] = useState("");
  const [semanticContentError, setSemanticContentError] = useState("");
  const [semanticCoreSelected, setSemanticCoreSelected] = useState([]);
  const [semanticCoreReports, setSemanticCoreReports] = useState([]);
  const [semanticActiveReportId, setSemanticActiveReportId] = useState("");
  const [semanticSeedQuery, setSemanticSeedQuery] = useState(() => defaultSemanticSeedQuery(card));
  const [semanticSubjectFilter, setSemanticSubjectFilter] = useState("");
  const [semanticSearch, setSemanticSearch] = useState("");
  const [semanticExcludeWords, setSemanticExcludeWords] = useState("");
  const [characteristicSearch, setCharacteristicSearch] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorStatus, setCompetitorStatus] = useState("idle");
  const [auditCompetitorInput, setAuditCompetitorInput] = useState("");
  const photoUrl = bestPhotoUrl(card);
  const currentTitle = textOrDash(card?.title);
  const portalName = portalDisplayName(portal);
  const titleLength = currentTitle.length;
  const issueCount = Number(card?.issueCount ?? (card?.issue && card.issue !== "Нет критичных" ? 1 : 0));
  const rawFields = rawFieldsForCard(card);
  const isMpstatsCard = portal?.syncStatus === "mpstats-loaded" || Boolean(rawFields.mpstats);
  const cardSourceLabel = isMpstatsCard ? "MPStats" : "WB API";
  const description = card?.description || rawFields.description || "";
  const characteristics = card?.characteristics || rawFields.characteristics || [];
  const characteristicItems = characteristicRows(characteristics);
  const characteristicValueOptions = characteristicValueOptionsByKey(portal, characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const photos = card?.photos || rawFields.photos || (photoUrl ? [photoUrl] : []);
  const sizes = card?.sizes || rawFields.sizes || [];
  const dimensions = card?.dimensions || rawFields.dimensions || {};
  const priceValue = firstDefined(card?.price, rawFields.price);
  const discountValue = firstDefined(card?.discount, rawFields.discount);
  const discountedPriceValue = firstDefined(card?.discountedPrice, rawFields.discountedPrice);
  const clubDiscountedPriceValue = firstDefined(card?.clubDiscountedPrice, rawFields.clubDiscountedPrice);
  const stockValue = firstDefined(card?.stock, rawFields.stock);
  const sellerStockValue = firstDefined(card?.sellerStock, rawFields.sellerStock);
  const wbStockValue = firstDefined(card?.wbStock, rawFields.wbStock);
  const commercialSizeRows = sizeCommercialRows(sizes);
  const hasCommercialData = [priceValue, discountValue, discountedPriceValue, clubDiscountedPriceValue, stockValue, sellerStockValue, wbStockValue]
    .some((value) => !isEmptyValue(value))
    || commercialSizeRows.some((row) => [row.price, row.discountedPrice, row.clubDiscountedPrice, row.stock, row.sellerStock, row.wbStock].some((value) => !isEmptyValue(value)));
  const draftDiscountedPriceValue = discountedPriceFromValues(draftPrices.price, draftPrices.discount);
  const draftStockRows = Array.isArray(draftStocks.rows) ? draftStocks.rows : normalizeDraftStocks(draftStocks, card).rows;
  const auditDone = auditStatus === "done";
  const auditRunning = auditStatus === "loading";
  const auditStale = auditStatus === "stale";
  const draftTitleLength = draftTitle.length;
  const draftCardKey = cardDraftKey(card);
  const draftStorageKey = `opticards-draft:${portal?.id || "portal"}:${draftCardKey}`;
  const backendDraftEnabled = Boolean(portal?.id && !portal?.isDemo && portal.id !== "demo-wb");
  const competitorsEnabled = backendDraftEnabled;
  const exportFileBase = safeFilePart(`${card?.vendorCode || card?.nmID || "card"}-${card?.subjectName || "wb"}`);
  const mpstatsMatches = countMpstatsMatches(characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const promotionRelevantCount = countPromotionRelevantCharacteristics(characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const mpstatsDuration = requestDurationText(mpstatsCharacteristicsMs);
  const mpstatsSourceLabel = mpstatsCharacteristicsMeta.cached ? "кэш" : (mpstatsCharacteristicsMeta.cachedAt ? "сейчас" : "");
  const mpstatsUpdatedAt = mpstatsCharacteristicsMeta.cachedAt
    ? new Date(mpstatsCharacteristicsMeta.cachedAt).toLocaleString("ru-RU")
    : "";
  const mpstatsRefreshFailed = Boolean(mpstatsCharacteristicsMeta.refreshError);
  const mpstatsHintsLabel = {
    loaded: `${mpstatsCharacteristics.length} MPStats · ${mpstatsMatches} совпало${mpstatsRefreshFailed ? " · кэш, ошибка обновления" : (mpstatsSourceLabel ? ` · ${mpstatsSourceLabel}` : "")}${!mpstatsCharacteristicsMeta.cached && mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    loading: "загрузка",
    empty: `MPStats пусто${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    error: `MPStats ошибка${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    unavailable: `MPStats недоступен${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    "missing-subject": "нет subjectID",
  }[mpstatsCharacteristicsStatus] || (auditDone ? "есть рекомендации" : "ручной черновик");
  const mpstatsHintsTitle = mpstatsRefreshFailed
    ? `MPStats не обновился: ${mpstatsCharacteristicsMeta.refreshError?.message || "ошибка запроса"}. Показан кэш от ${mpstatsUpdatedAt || "предыдущего запроса"}.`
    : mpstatsUpdatedAt
      ? `MPStats обновлен ${mpstatsUpdatedAt}${mpstatsCharacteristicsMeta.cached ? ". Загружено из backend-кэша." : "."}`
    : "Подтянуть популярные значения характеристик из MPStats";
  const mpstatsHintsTone = ["loaded", "loading"].includes(mpstatsCharacteristicsStatus)
    ? "blue"
    : ["empty", "error", "unavailable", "missing-subject"].includes(mpstatsCharacteristicsStatus)
      ? "amber"
      : auditDone ? "blue" : (auditStale ? "amber" : "green");
  const changedDraftCharacteristicsCount = countChangedDraftCharacteristics(draftCharacteristics, characteristicItems);
  const auditDraftCharacteristicsCount = Object.values(draftCharacteristics).filter((draft) => draft?.source === "audit").length;
  const portalTeam = getPortalTeam(portal || {});
  const userRoleType = getUserRoleType(currentUser);
  const isApprovalReviewer = Boolean(currentUser?.login && (currentUser.login === portalTeam.manager || userRoleType === "admin"));
  const isProjectLead = Boolean(currentUser?.login && currentUser.login === portalTeam.lead && !isApprovalReviewer);
  const activeApprovalSection = APPROVAL_SECTION_KEYS.includes(changesTab) ? changesTab : "content";
  const activeApproval = normalizeApprovalState(approvalSections[activeApprovalSection]);
  const approvalReadOnly = isProjectLead || (activeApproval.status === "submitted" && isApprovalReviewer);
  const canSubmitApproval = !approvalReadOnly && ["draft", "changes_requested"].includes(activeApproval.status);
  const canReviewApproval = activeApproval.status === "submitted" && isApprovalReviewer;
  const latestAuditEntry = auditHistory.find((item) => item?.summary || item?.competitorSelection) || {};
  const latestAuditSummary = latestAuditEntry.summary || {};
  const latestMainProblems = Array.isArray(latestAuditSummary.mainProblems) ? latestAuditSummary.mainProblems : [];
  const latestQuickWins = Array.isArray(latestAuditSummary.quickWins) ? latestAuditSummary.quickWins : [];
  const latestRiskNotes = auditPublicWarnings(latestAuditSummary.riskNotes);
  const latestCompetitorSelection = latestAuditEntry.competitorSelection || null;
  const latestAuditInsight = auditInsightText({
    mainProblems: latestMainProblems,
    quickWins: latestQuickWins,
    riskNotes: latestRiskNotes,
    mpstatsMatches,
    promotionRelevantCount,
    competitorSelection: latestCompetitorSelection,
  });
  const latestAuditFacts = auditFactRows({
    mpstatsGroups: mpstatsCharacteristics.length,
    mpstatsMatches,
    promotionRelevantCount,
    competitorSelection: latestCompetitorSelection,
    riskNotes: latestRiskNotes,
  });
  const activeSemanticCore = semanticCoreWithSelection(semanticCore, semanticCoreSelected);
  const semanticContentRunning = semanticContentStatus === "loading";
  const canReoptimizeContent = Boolean(semanticCoreSelected.length && !approvalReadOnly && !semanticContentRunning);
  const auditCompetitorIds = auditCompetitorIdsFromInput(auditCompetitorInput);
  const auditContentChanged = normalizedCharacteristicOption(draftTitle) !== normalizedCharacteristicOption(currentTitle)
    || normalizedCharacteristicOption(draftDescription) !== normalizedCharacteristicOption(description);
  const auditPreparedChangesCount = changedDraftCharacteristicsCount + (auditContentChanged ? 1 : 0);
  const priceBaseDraft = priceDraftFromCard(card);
  const priceChangeCount = [
    normalizedCharacteristicOption(draftPrices.price) !== normalizedCharacteristicOption(priceBaseDraft.price),
    normalizedCharacteristicOption(draftPrices.discount) !== normalizedCharacteristicOption(priceBaseDraft.discount),
    draftPrices.recommendationSource === "manual"
      && normalizedCharacteristicOption(draftPrices.recommendation) !== normalizedCharacteristicOption(buildPriceRecommendation(card, draftPrices)),
  ].filter(Boolean).length;
  const stockChangeCount = draftStockRows.filter((row) => (
    normalizedCharacteristicOption(row.amount) !== normalizedCharacteristicOption(row.currentAmount)
  )).length;
  const changesReadinessSections = [
    {
      key: "content",
      label: "Контент",
      Icon: FileText,
      approval: approvalSections.content,
      changesCount: auditPreparedChangesCount,
      detail: [
        auditContentChanged ? "текст" : "",
        changedDraftCharacteristicsCount ? `${changedDraftCharacteristicsCount} ${pluralRu(changedDraftCharacteristicsCount, "характеристика", "характеристики", "характеристик")}` : "",
      ].filter(Boolean).join(" · ") || "нет правок",
      downloadLabel: "Скачать контент",
    },
    {
      key: "prices",
      label: "Цены",
      Icon: Tags,
      approval: approvalSections.prices,
      changesCount: priceChangeCount,
      detail: priceChangeCount ? `${priceChangeCount} ${pluralRu(priceChangeCount, "правка", "правки", "правок")}` : "нет правок",
      downloadLabel: "Скачать цены",
    },
    {
      key: "stocks",
      label: "Остатки",
      Icon: Warehouse,
      approval: approvalSections.stocks,
      changesCount: stockChangeCount,
      detail: stockChangeCount ? `${stockChangeCount} ${pluralRu(stockChangeCount, "размер", "размера", "размеров")}` : "нет правок",
      downloadLabel: "Скачать остатки",
    },
  ];
  const approvalCounts = changesReadinessSections.reduce((acc, section) => {
    const status = section.approval.status;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const approvedOrExportedCount = (approvalCounts.approved || 0) + (approvalCounts.exported || 0);
  const readyForApprovalCount = changesReadinessSections.filter((section) => (
    ["draft", "changes_requested"].includes(section.approval.status) && section.changesCount > 0
  )).length;
  const changesReadinessCopy = approvalCounts.submitted
    ? `${approvalCounts.submitted} ${pluralRu(approvalCounts.submitted, "блок", "блока", "блоков")} на согласовании у аккаунт-менеджера.`
    : approvalCounts.changes_requested
      ? `${approvalCounts.changes_requested} ${pluralRu(approvalCounts.changes_requested, "блок", "блока", "блоков")} вернули на доработку.`
      : approvedOrExportedCount
        ? `${approvedOrExportedCount} ${pluralRu(approvedOrExportedCount, "блок", "блока", "блоков")} принято, можно выгружать.`
        : readyForApprovalCount
          ? `${readyForApprovalCount} ${pluralRu(readyForApprovalCount, "блок готов", "блока готовы", "блоков готовы")} к отправке на согласование.`
          : "Подготовьте черновик, затем отправьте нужный блок на согласование.";
  const auditStatusText = auditRunning ? "Идет аудит" : auditDone ? "Аудит готов" : auditStale ? "Аудит устарел" : "Аудит не запускался";
  const auditStatusTone = auditRunning ? "blue" : auditDone ? "green" : auditStale ? "amber" : "amber";
  const auditNextStep = auditRunning
    ? {
      title: "Дождитесь результата",
      copy: "MPStats и backend собирают рекомендации. После завершения появится краткий вывод и кнопка перехода к изменениям.",
      action: "Аудит идет",
    }
    : auditDone
      ? {
        title: "Проверьте черновик",
        copy: "Аудит подготовил черновик. Откройте вкладку Изменения, примите или поправьте поля и отправьте результат на согласование.",
        action: "Перейти к черновику",
      }
      : auditStale
        ? {
          title: "Запустите аудит заново",
          copy: "Данные WB обновились, поэтому прежняя аналитика устарела. Черновик сохранен, но рекомендации лучше пересчитать.",
          action: "Запустить заново",
        }
        : {
          title: "Запустите аудит",
          copy: "Можно оставить конкурентов пустыми: система сама подберет похожие карточки через MPStats и подготовит черновик правок.",
          action: "Запустить аудит",
        };
  const auditFlowSteps = [
    { title: "Подготовка", status: auditRunning || auditDone ? "done" : "active", copy: auditCompetitorIds.length ? `${auditCompetitorIds.length}/3 конкурента задано` : "конкуренты необязательны" },
    { title: "Результат аудита", status: auditDone ? "done" : auditRunning ? "active" : "pending", copy: auditDone ? "выводы готовы" : auditRunning ? "собираем данные" : "появится после запуска" },
    { title: "Черновик готов", status: auditDone ? "active" : "pending", copy: auditDone ? `${auditPreparedChangesCount} ${pluralRu(auditPreparedChangesCount, "правка", "правки", "правок")}` : "после аудита" },
  ];

  useEffect(() => {
    setSemanticSeedQuery(defaultSemanticSeedQuery(card));
    setSemanticSubjectFilter("");
    setSemanticSearch("");
    setSemanticExcludeWords("");
    setSemanticSaveStatus("");
    setSemanticContentStatus("");
    setSemanticContentError("");
    setSemanticRankStatus("idle");
  }, [card?.nmID, card?.vendorCode, card?.title, card?.subjectName]);

  useEffect(() => {
    let active = true;
    setActiveTab("semantic");
    setAuditStatus("idle");
    setDraftTitle("");
    setDraftDescription("");
    setDraftTitleSource("");
    setDraftDescriptionSource("");
    setDraftTitleReason("");
    setDraftDescriptionReason("");
    setDraftCharacteristics({});
    setDraftPrices(priceDraftFromCard(card));
    setDraftStocks(normalizeDraftStocks({}, card));
    setApproval(defaultApprovalState());
    setApprovalSections(defaultApprovalSections());
    setApprovalComment("");
    setAuditHistory([]);
    setMpstatsCharacteristics([]);
    setMpstatsCharacteristicsStatus("idle");
    setMpstatsCharacteristicsMs(null);
    setMpstatsCharacteristicsMeta({});
    setSemanticCore(null);
    setSemanticCoreStatus("idle");
    setSemanticRankStatus("idle");
    setSemanticContentStatus("");
    setSemanticContentError("");
    setSemanticCoreSelected([]);
    setSemanticCoreReports([]);
    setSemanticActiveReportId("");
    setCharacteristicSearch("");
    setDraftSavedAt("");
    setDraftSaveStatus("");
    setAuditCompetitorInput("");
    let localStoredDraft = null;
    const applyDraft = (storedDraft) => {
      const normalized = contentFromStoredDraft(storedDraft, card);
      setDraftTitle(normalized.title);
      setDraftDescription(normalized.description);
      setDraftTitleSource(normalized.titleSource);
      setDraftDescriptionSource(normalized.descriptionSource);
      setDraftTitleReason(normalized.titleReason);
      setDraftDescriptionReason(normalized.descriptionReason);
      setDraftCharacteristics(normalized.characteristics);
      setDraftPrices(normalized.prices);
      setDraftStocks(normalized.stocks);
      setSemanticCoreSelected(normalized.semanticCoreSelected);
      setSemanticCoreReports(normalized.semanticCoreReports);
      if (normalized.semanticCoreReports.length) {
        const latestReport = normalized.semanticCoreReports[0];
        setSemanticActiveReportId(latestReport.id);
        setSemanticCore(latestReport.semanticCore);
        setSemanticSeedQuery(latestReport.seedQuery || defaultSemanticSeedQuery(card));
        setSemanticSubjectFilter(latestReport.subjectFilter || "");
        setSemanticSearch(latestReport.search || "");
        setSemanticExcludeWords(latestReport.excludeWords || "");
      } else {
        setSemanticActiveReportId("");
        setSemanticCore(null);
      }
      setApproval(normalized.approval);
      setApprovalSections(normalized.approvalSections);
      setApprovalComment("");
      setAuditHistory(normalized.auditHistory);
      setAuditStatus(normalized.auditStatus);
      setDraftSavedAt(normalized.savedAt);
    };
    try {
      const saved = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
      if (saved) {
        localStoredDraft = saved;
        applyDraft(saved);
      } else {
        setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
      }
    } catch {
      localStorage.removeItem(draftStorageKey);
      setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
    }
    if (backendDraftEnabled && draftCardKey) {
      apiRequest(`/api/card-drafts?portal_id=${encodeURIComponent(portal.id)}&card_key=${encodeURIComponent(draftCardKey)}`)
        .then((payload) => {
          if (!active || !payload.draft) return;
          const mergedDraft = mergeStoredDraftSemantics(payload.draft, localStoredDraft);
          applyDraft(mergedDraft);
          if (mergedDraft !== payload.draft) {
            const repaired = contentFromStoredDraft(mergedDraft, card);
            persistStructuredDraft(storedDraftPayload(mergedDraft), { auditDone: repaired.auditStatus === "done" }).catch(() => {});
          } else {
            setDraftSaveStatus("backend");
          }
        })
        .catch(() => {
          if (active) {
            setDraftSaveStatus("local-fallback");
          }
        });
    }
    return () => {
      active = false;
    };
  }, [draftStorageKey, draftCardKey, backendDraftEnabled, portal?.id, card?.nmID, card?.vendorCode]);

  useEffect(() => {
    let active = true;
    setCompetitors([]);
    setCompetitorInput("");
    setCompetitorStatus(competitorsEnabled ? "loading" : "unavailable");
    if (!competitorsEnabled || !draftCardKey) {
      return () => {
        active = false;
      };
    }
    const params = new URLSearchParams({
      portal_id: String(portal.id),
      card_key: String(draftCardKey),
    });
    apiRequest(`/api/card-competitors?${params.toString()}`)
      .then((payload) => {
        if (!active) return;
        setCompetitors(Array.isArray(payload.competitors) ? payload.competitors : []);
        setCompetitorStatus("idle");
      })
      .catch(() => {
        if (!active) return;
        setCompetitors([]);
        setCompetitorStatus("error");
      });
    return () => {
      active = false;
    };
  }, [competitorsEnabled, portal?.id, draftCardKey]);

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

  function mpstatsCharacteristicsPath(subjectID, { forceRefresh = false, cacheOnly = false } = {}) {
    const params = new URLSearchParams({
      portal_id: String(portal.id),
      type: "subject",
      value: String(subjectID),
      num_top: "300",
      min_cats: "0",
    });
    if (forceRefresh) {
      params.set("refresh", "1");
    }
    if (cacheOnly) {
      params.set("cache_only", "1");
    }
    return `/api/mpstats/characteristics?${params.toString()}`;
  }

  function applyMpstatsCharacteristicsPayload(payload, elapsedMs) {
    const characteristics = payload.characteristics || [];
    setMpstatsCharacteristicsMs(elapsedMs);
    setMpstatsCharacteristics(characteristics);
    setMpstatsCharacteristicsMeta({
      cached: Boolean(payload.cached),
      cachedAt: payload.cachedAt || "",
      expiresAt: payload.expiresAt || "",
      refreshError: payload.refreshError || null,
    });
    setMpstatsCharacteristicsStatus(characteristics.length ? "loaded" : "empty");
  }

  useEffect(() => {
    const subjectID = Number(card?.subjectID || rawFields.subjectID || 0);
    if (!subjectID || !portal?.id) {
      return;
    }
    let active = true;
    const startedAt = performance.now();
    apiRequest(mpstatsCharacteristicsPath(subjectID, { cacheOnly: true }))
      .then((payload) => {
        if (!active || payload.status === "cache-miss") return;
        applyMpstatsCharacteristicsPayload(payload, Math.round(performance.now() - startedAt));
      })
      .catch(() => {
        if (!active) return;
        setMpstatsCharacteristics([]);
        setMpstatsCharacteristicsMeta({});
      });
    return () => {
      active = false;
    };
  }, [card?.subjectID, rawFields.subjectID, portal?.id]);

  async function loadMpstatsCharacteristicHints({ forceRefresh = false } = {}) {
    const subjectID = Number(card?.subjectID || rawFields.subjectID || 0);
    if (!subjectID || !portal?.id) {
      setMpstatsCharacteristicsStatus("missing-subject");
      setMpstatsCharacteristicsMs(null);
      setMpstatsCharacteristicsMeta({});
      return null;
    }
    const startedAt = performance.now();
    setMpstatsCharacteristicsStatus("loading");
    setMpstatsCharacteristicsMs(null);
    try {
      const payload = await apiRequest(mpstatsCharacteristicsPath(subjectID, { forceRefresh }));
      applyMpstatsCharacteristicsPayload(payload, Math.round(performance.now() - startedAt));
      return payload;
    } catch (error) {
      setMpstatsCharacteristicsMs(Math.round(performance.now() - startedAt));
      setMpstatsCharacteristics([]);
      setMpstatsCharacteristicsMeta({});
      setMpstatsCharacteristicsStatus(error.message === "mpstats_api_error" ? "error" : "unavailable");
      return null;
    }
  }

  function semanticReportFromCore(core, selected, overrides = {}) {
    const createdAt = overrides.createdAt || new Date().toISOString();
    const compactCore = compactSemanticCore(core);
    if (!compactCore) return null;
    return {
      id: overrides.id || `semantic-${Date.now()}`,
      createdAt,
      seedQuery: overrides.seedQuery || compactCore.seedQuery || semanticSeedQuery.trim(),
      subjectFilter: overrides.subjectFilter ?? semanticSubjectFilter,
      search: overrides.search ?? semanticSearch,
      excludeWords: overrides.excludeWords ?? semanticExcludeWords,
      selected: normalizeSemanticSelection(selected),
      semanticCore: compactCore,
    };
  }

  function semanticReportsWithSelection(reports, selection) {
    const normalizedSelection = normalizeSemanticSelection(selection);
    const normalizedReports = normalizeSemanticReports(reports);
    if (!normalizedReports.length) {
      return normalizedReports;
    }
    const targetId = semanticActiveReportId || normalizedReports[0].id;
    return normalizedReports.map((report, index) => (
      report.id === targetId || (!semanticActiveReportId && index === 0)
        ? {
          ...report,
          seedQuery: semanticSeedQuery.trim() || report.seedQuery,
          subjectFilter: semanticSubjectFilter,
          search: semanticSearch,
          excludeWords: semanticExcludeWords,
          selected: normalizedSelection,
        }
        : report
    ));
  }

  async function enrichSemanticCoreWithRanks(core, { forceRefresh = false } = {}) {
    if (!core || !portal?.id || !card?.nmID) {
      setSemanticRankStatus("idle");
      return core;
    }
    setSemanticRankStatus("loading");
    try {
      const payload = await apiRequest("/api/mpstats/keywords", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          card,
          refresh: forceRefresh,
        }),
      });
      const enrichedCore = semanticMergeKeywordRankings(core, payload);
      setSemanticRankStatus(enrichedCore === core ? "empty" : "loaded");
      return enrichedCore;
    } catch {
      setSemanticRankStatus("error");
      return core;
    }
  }

  useEffect(() => {
    let active = true;
    if (!semanticCore || semanticCore.rankingSource || !portal?.id || !card?.nmID) {
      return () => {
        active = false;
      };
    }
    enrichSemanticCoreWithRanks(semanticCore, { forceRefresh: false }).then((enrichedCore) => {
      if (active && enrichedCore !== semanticCore) {
        setSemanticCore(enrichedCore);
      }
    });
    return () => {
      active = false;
    };
  }, [semanticCore, portal?.id, card?.nmID]);

  async function loadSemanticCore({ forceRefresh = false } = {}) {
    if (!portal?.id || !card?.nmID || !semanticSeedQuery.trim()) {
      setSemanticCoreStatus("missing-card");
      setSemanticCoreError("");
      setSemanticRankStatus("idle");
      return null;
    }
    setSemanticCoreStatus("loading");
    setSemanticCoreError("");
    setSemanticRankStatus("idle");
    setSemanticSaveStatus("");
    try {
      const payload = await apiRequest("/api/mpstats/semantic-expansion", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          card,
          query: semanticSeedQuery.trim(),
          refresh: forceRefresh,
        }),
      });
      const nextSemanticCore = await enrichSemanticCoreWithRanks(payload.semanticCore || null, { forceRefresh });
      setSemanticCore(nextSemanticCore);
      const cardSubject = String(card?.subjectName || "").trim().toLowerCase();
      let nextSubjectFilter = semanticSubjectFilter;
      if (nextSemanticCore?.subjectOptions?.length && cardSubject && !semanticSubjectFilter) {
        const matchedSubject = nextSemanticCore.subjectOptions.find((item) => String(item.name || "").trim().toLowerCase() === cardSubject)
          || nextSemanticCore.subjectOptions.find((item) => String(item.name || "").toLowerCase().includes(cardSubject.split("/").pop().trim()));
        if (matchedSubject?.name) {
          nextSubjectFilter = matchedSubject.name;
          setSemanticSubjectFilter(nextSubjectFilter);
        }
      }
      const nextReport = semanticReportFromCore(nextSemanticCore, semanticCoreSelected, {
        seedQuery: semanticSeedQuery.trim(),
        subjectFilter: nextSubjectFilter,
      });
      if (nextReport) {
        const nextReports = normalizeSemanticReports([nextReport, ...semanticCoreReports.filter((report) => report.id !== nextReport.id)]);
        setSemanticCoreReports(nextReports);
        setSemanticActiveReportId(nextReport.id);
        const structuredDraft = buildStructuredCardDraft({
          auditStatus,
          auditHistory,
          approval,
          approvalSections,
          title: draftTitle,
          description: draftDescription,
          titleSource: draftTitleSource,
          descriptionSource: draftDescriptionSource,
          titleReason: draftTitleReason,
          descriptionReason: draftDescriptionReason,
          characteristics: draftCharacteristics,
          prices: draftPrices,
          stocks: draftStocks,
          semanticCoreSelected,
          semanticCoreReports: nextReports,
          card,
        });
        setSemanticSaveStatus("saving");
        const persistStatus = await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
        setSemanticSaveStatus(["backend", "local", "local-fallback"].includes(persistStatus) ? "saved" : "error");
      }
      setSemanticCoreStatus(payload.cached ? "cached" : "loaded");
      return nextSemanticCore;
    } catch (error) {
      const message = error.payload?.message || error.message || "";
      const readableMessage = message === "mpstats_expanding_report_not_ready"
        ? "MPStats еще готовит SEO-отчет. Повторите подбор через минуту."
        : message === "mpstats_key_missing"
          ? "MPStats ключ не подключен."
          : message && message !== "mpstats_api_error"
            ? `MPStats: ${message}`
            : "MPStats SEO expansion не загрузился. Повторите позже.";
      setSemanticCoreStatus(error.payload?.status === 202 || message === "mpstats_expanding_report_not_ready" ? "pending" : error.message === "mpstats_api_error" ? "error" : "unavailable");
      setSemanticCoreError(readableMessage);
      return null;
    }
  }

  async function persistSemanticSelection(nextSelection) {
    const normalizedSelection = normalizeSemanticSelection(nextSelection);
    const nextReports = semanticReportsWithSelection(semanticCoreReports, normalizedSelection);
    setSemanticCoreSelected(normalizedSelection);
    setSemanticCoreReports(nextReports);
    setSemanticSaveStatus("saving");
    const structuredDraft = buildStructuredCardDraft({
      auditStatus,
      auditHistory,
      approval,
      approvalSections,
      title: draftTitle,
      description: draftDescription,
      titleSource: draftTitleSource,
      descriptionSource: draftDescriptionSource,
      titleReason: draftTitleReason,
      descriptionReason: draftDescriptionReason,
      characteristics: draftCharacteristics,
      prices: draftPrices,
      stocks: draftStocks,
      semanticCoreSelected: normalizedSelection,
      semanticCoreReports: nextReports,
      card,
    });
    try {
      await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
      setSemanticSaveStatus("saved");
    } catch {
      setSemanticSaveStatus("error");
    }
  }

  function takeSemanticKeyword(item) {
    const key = semanticQueryKey(item);
    if (!key || semanticCoreSelected.some((selected) => semanticQueryKey(selected) === key)) {
      return;
    }
    persistSemanticSelection([...semanticCoreSelected, item]);
  }

  function removeSemanticKeyword(item) {
    const key = semanticQueryKey(item);
    if (!key) return;
    persistSemanticSelection(semanticCoreSelected.filter((selected) => semanticQueryKey(selected) !== key));
  }

  async function reoptimizeContentFromSemanticCore() {
    if (!semanticCoreSelected.length || approvalReadOnly) {
      return;
    }
    setSemanticContentStatus("loading");
    setSemanticContentError("");
    try {
      const payload = await apiRequest("/api/card-content-reoptimize", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          selectedKeywords: semanticCoreSelected,
          currentKeywords: activeSemanticCore?.current || [],
          draft: {
            title: draftTitle,
            description: draftDescription,
          },
        }),
      });
      const titleDraft = payload.draftContent?.title || {};
      const descriptionDraft = payload.draftContent?.description || {};
      const nextTitle = titleDraft.value || draftTitle || currentTitle;
      const nextDescription = descriptionDraft.value || draftDescription || description;
      const nextTitleReason = titleDraft.reason || "Заголовок переписан с учетом выбранного СЯ.";
      const nextDescriptionReason = descriptionDraft.reason || "Описание переписано с учетом выбранного СЯ.";
      const structuredDraft = buildStructuredCardDraft({
        auditStatus,
        auditHistory,
        approval,
        approvalSections,
        title: nextTitle,
        description: nextDescription,
        titleSource: "semantic",
        descriptionSource: "semantic",
        titleReason: nextTitleReason,
        descriptionReason: nextDescriptionReason,
        characteristics: draftCharacteristics,
        prices: draftPrices,
        stocks: draftStocks,
        semanticCoreSelected,
        semanticCoreReports,
        card,
      });
      setDraftTitle(nextTitle);
      setDraftDescription(nextDescription);
      setDraftTitleSource("semantic");
      setDraftDescriptionSource("semantic");
      setDraftTitleReason(nextTitleReason);
      setDraftDescriptionReason(nextDescriptionReason);
      setChangesTab("content");
      setActiveTab("changes");
      if (onDraftActivity) {
        onDraftActivity({ draft: true });
      }
      await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
      setSemanticContentStatus("done");
    } catch (error) {
      const message = error.message === "llm_key_missing"
        ? "GigaChat не подключен: добавьте ключ на backend."
        : error.status === 502
          ? "GigaChat не смог подготовить текст. Повторите позже."
          : "Не удалось переоптимизировать контент по СЯ.";
      setSemanticContentError(message);
      setSemanticContentStatus("error");
    }
  }

  async function runAudit(nextTab = "changes") {
    const targetTab = typeof nextTab === "string" ? nextTab : "changes";
    setAuditStatus("loading");
    try {
      const payload = await apiRequest("/api/card-audit", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          auditCompetitors: auditCompetitorIds.map((id) => ({ nmID: id, url: wbCompetitorUrl(id) })),
        }),
      });
      const returnedMpstats = Array.isArray(payload.mpstatsCharacteristics) ? payload.mpstatsCharacteristics : [];
      if (returnedMpstats.length) {
        setMpstatsCharacteristics(returnedMpstats);
        setMpstatsCharacteristicsStatus("loaded");
        setMpstatsCharacteristicsMeta({
          cached: false,
          cachedAt: new Date().toISOString(),
          expiresAt: "",
          refreshError: null,
        });
      }
      const draftContent = payload.draftContent || {};
      const titleDraft = draftContent.title || {};
      const descriptionDraft = draftContent.description || {};
      const nextTitle = titleDraft.value || currentTitle;
      const nextDescription = descriptionDraft.value || description;
      const nextTitleReason = titleDraft.reason || payload.auditResult?.title?.reason || "";
      const nextDescriptionReason = descriptionDraft.reason || payload.auditResult?.description?.reason || "";
      const nextDraftCharacteristics = normalizeDraftCharacteristics(
        draftContent.characteristics || characteristicDraftsFromRows(characteristicItems, "audit", returnedMpstats.length ? returnedMpstats : mpstatsCharacteristics, subjectCharacteristics)
      );
      const fallbackEntry = {
        id: `audit-${Date.now()}`,
        createdAt: new Date().toISOString(),
        engine: payload.auditResult?._meta?.engine || "opticards-backend-audit",
        sourceInputs: ["wb_snapshot", "mpstats_market", "sergey_methodology"],
        mpstatsGroups: returnedMpstats.length || mpstatsCharacteristics.length,
        mpstatsMatches: countMpstatsMatches(characteristicItems, subjectCharacteristics, returnedMpstats.length ? returnedMpstats : mpstatsCharacteristics),
        competitors: payload.evidenceSummary?.competitors || 0,
        manualCompetitors: payload.evidenceSummary?.manualCompetitors || 0,
        promotionRelevantCount: countPromotionRelevantCharacteristics(characteristicItems, subjectCharacteristics, returnedMpstats.length ? returnedMpstats : mpstatsCharacteristics),
        changedCharacteristics: Object.keys(nextDraftCharacteristics).length,
        content: {
          titleChanged: normalizedCharacteristicOption(nextTitle) !== normalizedCharacteristicOption(currentTitle),
          descriptionChanged: normalizedCharacteristicOption(nextDescription) !== normalizedCharacteristicOption(description),
          titleReason: nextTitleReason,
          descriptionReason: nextDescriptionReason,
        },
        summary: payload.auditResult?.summary || {},
        status: payload.evidenceSummary?.warnings?.length ? "partial" : "done",
      };
      const auditEntry = {
        ...fallbackEntry,
        ...(payload.auditEntry || {}),
        summary: payload.auditEntry?.summary || payload.auditResult?.summary || fallbackEntry.summary,
      };
      const nextAuditHistory = [auditEntry, ...auditHistory].slice(0, 20);
      const structuredDraft = buildStructuredCardDraft({
        auditStatus: "done",
        auditHistory: nextAuditHistory,
        approval,
        approvalSections,
        title: nextTitle,
        description: nextDescription,
        titleSource: "audit",
        descriptionSource: "audit",
        titleReason: nextTitleReason,
        descriptionReason: nextDescriptionReason,
        characteristics: nextDraftCharacteristics,
        prices: draftPrices,
        stocks: draftStocks,
        semanticCoreSelected,
        semanticCoreReports,
        card,
        auditResult: payload.auditResult,
        evidenceSummary: payload.evidenceSummary,
      });
      setDraftTitle(nextTitle);
      setDraftDescription(nextDescription);
      setDraftTitleSource("audit");
      setDraftDescriptionSource("audit");
      setDraftTitleReason(nextTitleReason);
      setDraftDescriptionReason(nextDescriptionReason);
      setDraftCharacteristics(nextDraftCharacteristics);
      setAuditHistory(nextAuditHistory);
      setAuditStatus("done");
      if (onDraftActivity) {
        onDraftActivity({ audit: true, draft: true });
      }
      const persistPromise = persistStructuredDraft(structuredDraft, { auditDone: true });
      setActiveTab(targetTab);
      await persistPromise;
    } catch (error) {
      await runAuditLocalStub(targetTab);
    }
  }

  async function runAuditLocalStub(nextTab = "changes") {
    const targetTab = typeof nextTab === "string" ? nextTab : "changes";
    setAuditStatus("loading");
    const mpstatsPayload = await loadMpstatsCharacteristicHints({ forceRefresh: false });
    const auditMpstatsCharacteristics = mpstatsPayload?.characteristics || mpstatsCharacteristics;
    const suggestions = titleSuggestions(card);
    const titleIssues = titleQualityIssues(currentTitle, card);
    const nextTitle = titleIssues.length
      ? suggestions.find((value) => normalizedCharacteristicOption(value) !== normalizedCharacteristicOption(currentTitle)) || suggestions[0] || ""
      : currentTitle;
    const nextDescription = descriptionSuggestion(card, description);
    const nextTitleReason = titleAuditReason(card, currentTitle, nextTitle);
    const nextDescriptionReason = descriptionAuditReason(description, card);
    const nextDraftCharacteristics = characteristicDraftsFromRows(characteristicItems, "audit", auditMpstatsCharacteristics, subjectCharacteristics);
    const changedCharacteristics = Object.entries(nextDraftCharacteristics)
      .filter(([key, draft]) => {
        const currentRow = characteristicItems.find((row) => row.key === key);
        const currentValues = characteristicValueTokens(currentRow?.value);
        const currentSet = new Set(currentValues.map(normalizedCharacteristicOption));
        return draftCharacteristicValues(draft).some((value) => !currentSet.has(normalizedCharacteristicOption(value)));
      })
      .length;
    const auditEntry = {
      id: `audit-${Date.now()}`,
      createdAt: new Date().toISOString(),
      engine: "opticards-basic-v1",
      sourceInputs: ["wb_snapshot", "mpstats_characteristics_cache", "manual_rules"],
      mpstatsGroups: auditMpstatsCharacteristics.length,
      mpstatsMatches: countMpstatsMatches(characteristicItems, subjectCharacteristics, auditMpstatsCharacteristics),
      promotionRelevantCount: countPromotionRelevantCharacteristics(characteristicItems, subjectCharacteristics, auditMpstatsCharacteristics),
      changedCharacteristics,
      content: {
        titleChanged: normalizedCharacteristicOption(nextTitle) !== normalizedCharacteristicOption(currentTitle),
        descriptionChanged: normalizedCharacteristicOption(nextDescription) !== normalizedCharacteristicOption(description),
        titleReason: nextTitleReason,
        descriptionReason: nextDescriptionReason,
      },
      status: mpstatsPayload ? "done" : "partial",
    };
    const nextAuditHistory = [auditEntry, ...auditHistory].slice(0, 20);
    const structuredDraft = buildStructuredCardDraft({
      auditStatus: "done",
      auditHistory: nextAuditHistory,
      approval,
      approvalSections,
      title: nextTitle,
      description: nextDescription,
      titleSource: "audit",
      descriptionSource: "audit",
      titleReason: nextTitleReason,
      descriptionReason: nextDescriptionReason,
      characteristics: nextDraftCharacteristics,
      prices: draftPrices,
      stocks: draftStocks,
      semanticCoreSelected,
      semanticCoreReports,
      card,
    });
    setDraftTitle(nextTitle);
    setDraftDescription(nextDescription);
    setDraftTitleSource("audit");
    setDraftDescriptionSource("audit");
    setDraftTitleReason(nextTitleReason);
    setDraftDescriptionReason(nextDescriptionReason);
    setDraftCharacteristics(nextDraftCharacteristics);
    setAuditHistory(nextAuditHistory);
    setAuditStatus("done");
    if (onDraftActivity) {
      onDraftActivity({ audit: true, draft: true });
    }
    const persistPromise = persistStructuredDraft(structuredDraft, { auditDone: true });
    setActiveTab(targetTab);
    await persistPromise;
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
          reason: source === "manual" ? "" : currentDraft?.reason || "",
        },
      };
    });
  }

  function addDraftCharacteristicValue(row, value, options = {}) {
    const currentValues = draftCharacteristicValues(draftCharacteristics[row.key]);
    setDraftCharacteristicValues(row, options.replace ? [value] : [...currentValues, value], "manual");
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

  function updateDraftPrice(field, value) {
    setDraftPrices((current) => {
      const next = {
        ...current,
        [field]: value,
        source: "manual",
      };
      if (current.recommendationSource !== "manual") {
        next.recommendation = buildPriceRecommendation(card, next);
        next.recommendationSource = "system";
      }
      return next;
    });
  }

  function updatePriceRecommendation(value) {
    setDraftPrices((current) => ({
      ...current,
      recommendation: value,
      recommendationSource: "manual",
    }));
  }

  function regeneratePriceRecommendation() {
    setDraftPrices((current) => ({
      ...current,
      recommendation: buildPriceRecommendation(card, current),
      recommendationSource: "system",
    }));
  }

  function updateDraftStock(rowKey, value) {
    setDraftStocks((current) => ({
      rows: (current.rows || []).map((row) => (
        row.key === rowKey
          ? { ...row, amount: value, source: "manual" }
          : row
      )),
    }));
  }

  function competitorRequestBody(nextCompetitors) {
    return {
      portalId: portal?.id,
      cardKey: draftCardKey,
      nmID: card?.nmID || "",
      vendorCode: card?.vendorCode || "",
      competitors: nextCompetitors.slice(0, topCompetitorLimit).map((item, index) => ({
        competitorNmID: item.competitorNmID || item.nmID || "",
        url: item.url || item.competitorUrl || "",
        note: item.note || "",
        position: index,
      })),
    };
  }

  async function saveCompetitorList(nextCompetitors, { refreshAfter = false } = {}) {
    if (!competitorsEnabled) {
      setCompetitorStatus("unavailable");
      return;
    }
    setCompetitorStatus("saving");
    try {
      const payload = await apiRequest("/api/card-competitors", {
        method: "POST",
        body: JSON.stringify(competitorRequestBody(nextCompetitors)),
      });
      const savedCompetitors = Array.isArray(payload.competitors) ? payload.competitors : [];
      setCompetitors(savedCompetitors);
      setCompetitorStatus("saved");
      if (refreshAfter && savedCompetitors.length) {
        const suggestedPayload = await apiRequest("/api/card-competitors/suggest", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal?.id,
            cardKey: draftCardKey,
            card,
            competitors: savedCompetitors.map((item) => ({
              competitorNmID: item.competitorNmID,
              url: item.url,
              note: item.note,
            })),
          }),
        });
        setCompetitors(Array.isArray(suggestedPayload.competitors) ? suggestedPayload.competitors : savedCompetitors);
      }
    } catch {
      setCompetitorStatus("error");
    }
  }

  async function addCompetitor() {
    const nmID = competitorNmIdFromInput(competitorInput);
    if (!nmID) {
      setCompetitorStatus("invalid");
      return;
    }
    if (competitors.some((item) => String(item.competitorNmID) === nmID)) {
      setCompetitorStatus("duplicate");
      return;
    }
    if (competitors.length >= topCompetitorLimit) {
      setCompetitorStatus("limit");
      return;
    }
    const nextCompetitors = [
      ...competitors,
      {
        competitorNmID: nmID,
        url: wbCompetitorUrl(nmID),
        note: "",
      },
    ];
    setCompetitorInput("");
    await saveCompetitorList(nextCompetitors, { refreshAfter: true });
  }

  async function removeCompetitor(competitor) {
    const nextCompetitors = competitors.filter((item) => item.competitorNmID !== competitor.competitorNmID);
    await saveCompetitorList(nextCompetitors);
  }

  async function refreshCompetitors({ statusOnDone = "refreshed", force = false } = {}) {
    if (!competitorsEnabled || (!force && !competitors.length)) {
      setCompetitorStatus(competitorsEnabled ? "empty" : "unavailable");
      return;
    }
    setCompetitorStatus("refreshing");
    try {
      const payload = await apiRequest("/api/card-competitors/suggest", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          competitors: competitors.map((item) => ({
            competitorNmID: item.competitorNmID,
            url: item.url,
            note: item.note,
          })),
        }),
      });
      setCompetitors(Array.isArray(payload.competitors) ? payload.competitors : []);
      setCompetitorStatus(statusOnDone);
    } catch {
      setCompetitorStatus("error");
    }
  }

  async function suggestCompetitors() {
    if (!competitorsEnabled) {
      setCompetitorStatus("unavailable");
      return;
    }
    if (!competitors.length) {
      setCompetitorStatus("empty");
      return;
    }
    setCompetitorStatus("suggesting");
    try {
      const payload = await apiRequest("/api/card-competitors/suggest", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          competitors: competitors.map((item) => ({
            competitorNmID: item.competitorNmID,
            url: item.url,
            note: item.note,
          })),
        }),
      });
      setCompetitors(Array.isArray(payload.competitors) ? payload.competitors : []);
      setCompetitorStatus("suggested");
    } catch {
      setCompetitorStatus("error");
    }
  }

  function competitorChangeActionBody(competitor, action) {
    return {
      portalId: portal?.id,
      cardKey: draftCardKey,
      competitorNmID: competitor?.competitorNmID || "",
      action,
    };
  }

  async function skipCompetitorChange(competitor) {
    if (!competitorsEnabled || !competitor?.competitorNmID) {
      return;
    }
    const confirmed = window.confirm(
      `Пропустить изменение конкурента WB ${competitor.competitorNmID}? Нажмите OK = Да, Отмена = Нет. Решение сохранится в журнале.`,
    );
    if (!confirmed) {
      return;
    }
    setCompetitorStatus("change-skipping");
    try {
      const payload = await apiRequest("/api/card-competitors/change-action", {
        method: "POST",
        body: JSON.stringify(competitorChangeActionBody(competitor, "skip")),
      });
      setCompetitors(Array.isArray(payload.competitors) ? payload.competitors : competitors);
      setCompetitorStatus("change-skipped");
    } catch {
      setCompetitorStatus("change-error");
    }
  }

  async function reoptimizeContentFromCompetitorChange(competitor) {
    if (!competitorsEnabled || !competitor?.competitorNmID || approvalReadOnly) {
      return;
    }
    const confirmed = window.confirm(
      `Переоптимизировать черновик с учетом изменения конкурента WB ${competitor.competitorNmID}? Нажмите OK = Да, Отмена = Нет.`,
    );
    if (!confirmed) {
      return;
    }
    setCompetitorStatus("change-reoptimizing");
    try {
      const payload = await apiRequest("/api/card-competitors/reoptimize", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          competitorNmID: competitor.competitorNmID,
          draft: {
            title: draftTitle,
            description: draftDescription,
          },
        }),
      });
      const titleDraft = payload.draftContent?.title || {};
      const descriptionDraft = payload.draftContent?.description || {};
      const nextTitle = titleDraft.value || draftTitle || currentTitle;
      const nextDescription = descriptionDraft.value || draftDescription || description;
      const nextTitleReason = titleDraft.reason || "Заголовок подготовлен с учетом изменений у конкурента.";
      const nextDescriptionReason = descriptionDraft.reason || "Описание подготовлено с учетом изменений у конкурента.";
      const structuredDraft = buildStructuredCardDraft({
        auditStatus,
        auditHistory,
        approval,
        approvalSections,
        title: nextTitle,
        description: nextDescription,
        titleSource: "competitor",
        descriptionSource: "competitor",
        titleReason: nextTitleReason,
        descriptionReason: nextDescriptionReason,
        characteristics: draftCharacteristics,
        prices: draftPrices,
        stocks: draftStocks,
        semanticCoreSelected,
        semanticCoreReports,
        card,
      });
      setDraftTitle(nextTitle);
      setDraftDescription(nextDescription);
      setDraftTitleSource("competitor");
      setDraftDescriptionSource("competitor");
      setDraftTitleReason(nextTitleReason);
      setDraftDescriptionReason(nextDescriptionReason);
      setChangesTab("content");
      setActiveTab("changes");
      if (onDraftActivity) {
        onDraftActivity({ draft: true });
      }
      await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
      const actionPayload = await apiRequest("/api/card-competitors/change-action", {
        method: "POST",
        body: JSON.stringify(competitorChangeActionBody(competitor, "apply")),
      });
      setCompetitors(Array.isArray(actionPayload.competitors) ? actionPayload.competitors : competitors);
      setCompetitorStatus("change-applied");
    } catch (error) {
      if (error.message === "llm_key_missing") {
        setSemanticContentError("GigaChat не подключен: добавьте ключ на backend.");
      }
      setCompetitorStatus("change-error");
    }
  }

  async function persistStructuredDraft(structuredDraft, { auditDone = false } = {}) {
    const savedAt = new Date().toISOString();
    let savedLocally = false;
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ ...structuredDraft, savedAt }));
      savedLocally = true;
      setDraftSavedAt(savedAt);
      setDraftSaveStatus(backendDraftEnabled ? "saving" : "local");
    } catch {
      setDraftSaveStatus("local-error");
    }
    if (backendDraftEnabled) {
      try {
        const response = await apiRequest("/api/card-drafts", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal.id,
            cardKey: draftCardKey,
            nmID: card?.nmID || "",
            vendorCode: card?.vendorCode || "",
            draft: structuredDraft,
          }),
        });
        setDraftSavedAt(response.draft?.updatedAt || savedAt);
        setDraftSaveStatus("backend");
        if (onDraftActivity) {
          onDraftActivity({ audit: auditDone, draft: true });
        }
        if (onDraftSaved) {
          await onDraftSaved(response.draft);
        }
        return "backend";
      } catch {
        setDraftSaveStatus(savedLocally ? "local-fallback" : "error");
        return savedLocally ? "local-fallback" : "error";
      }
    } else {
      setDraftSaveStatus(savedLocally ? "local" : "error");
      return savedLocally ? "local" : "error";
    }
  }

  async function saveDraft() {
    const structuredDraft = buildStructuredCardDraft({
      auditStatus,
      auditHistory,
      approval,
      approvalSections,
      title: draftTitle,
      description: draftDescription,
      titleSource: draftTitleSource,
      descriptionSource: draftDescriptionSource,
      titleReason: draftTitleReason,
      descriptionReason: draftDescriptionReason,
      characteristics: draftCharacteristics,
      prices: draftPrices,
      stocks: draftStocks,
      semanticCoreSelected,
      semanticCoreReports,
      card,
    });
    await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
  }

  function buildCurrentStructuredDraft(nextApprovalSections = approvalSections) {
    const nextApproval = deriveOverallApproval(nextApprovalSections);
    return buildStructuredCardDraft({
      auditStatus,
      auditHistory,
      approval: nextApproval,
      approvalSections: nextApprovalSections,
      title: draftTitle,
      description: draftDescription,
      titleSource: draftTitleSource,
      descriptionSource: draftDescriptionSource,
      titleReason: draftTitleReason,
      descriptionReason: draftDescriptionReason,
      characteristics: draftCharacteristics,
      prices: draftPrices,
      stocks: draftStocks,
      semanticCoreSelected,
      semanticCoreReports,
      card,
    });
  }

  async function applyApprovalChange(nextApproval, statusMessage) {
    const previousApproval = approval;
    const previousSections = approvalSections;
    const normalized = normalizeApprovalState(nextApproval);
    const nextSections = normalizeApprovalSections({
      ...approvalSections,
      [activeApprovalSection]: normalized,
    });
    const nextOverallApproval = deriveOverallApproval(nextSections);
    setApprovalSections(nextSections);
    setApproval(nextOverallApproval);
    const persistStatus = await persistStructuredDraft(buildCurrentStructuredDraft(nextSections), { auditDone: auditStatus === "done" });
    if (backendDraftEnabled && persistStatus !== "backend") {
      setApprovalSections(previousSections);
      setApproval(previousApproval);
      setDraftSaveStatus("approval-save-error");
      return false;
    }
    setDraftSaveStatus(statusMessage);
    return true;
  }

  function approvalHistoryItem(action, reason = "") {
    return {
      id: `approval-${Date.now()}`,
      action,
      section: activeApprovalSection,
      sectionLabel: approvalSectionLabel(activeApprovalSection),
      reason,
      userLogin: currentUser?.login || "",
      userName: currentUser?.full_name || currentUser?.login || "",
      createdAt: new Date().toISOString(),
    };
  }

  async function submitForApproval() {
    const now = new Date().toISOString();
    const nextApproval = normalizeApprovalState({
      ...activeApproval,
      status: "submitted",
      assigneeLogin: portalTeam.manager || "",
      submittedBy: currentUser?.login || "",
      submittedAt: now,
      reviewedBy: "",
      reviewedAt: "",
      returnReason: "",
      history: [approvalHistoryItem("submitted"), ...(activeApproval.history || [])],
    });
    await applyApprovalChange(nextApproval, "approval-submitted");
  }

  async function approveChanges() {
    const now = new Date().toISOString();
    const nextApproval = normalizeApprovalState({
      ...activeApproval,
      status: "approved",
      reviewedBy: currentUser?.login || "",
      reviewedAt: now,
      returnReason: "",
      history: [approvalHistoryItem("approved"), ...(activeApproval.history || [])],
    });
    setApprovalComment("");
    await applyApprovalChange(nextApproval, "approval-approved");
  }

  async function requestChanges() {
    const reason = approvalComment.trim();
    if (!reason) {
      setDraftSaveStatus("approval-reason-required");
      return;
    }
    const now = new Date().toISOString();
    const nextApproval = normalizeApprovalState({
      ...activeApproval,
      status: "changes_requested",
      reviewedBy: currentUser?.login || "",
      reviewedAt: now,
      returnReason: reason,
      history: [approvalHistoryItem("changes_requested", reason), ...(activeApproval.history || [])],
    });
    const saved = await applyApprovalChange(nextApproval, "approval-returned");
    if (saved) {
      setApprovalComment("");
    }
  }

  async function resetDraft() {
    const confirmed = window.confirm("Сбросить черновик и историю аудита по этой карточке? Это действие нельзя отменить.");
    if (!confirmed) {
      return;
    }
    setDraftSaveStatus("resetting");
    try {
      localStorage.removeItem(draftStorageKey);
      if (backendDraftEnabled) {
        await apiRequest(`/api/card-drafts?portal_id=${encodeURIComponent(portal.id)}&card_key=${encodeURIComponent(draftCardKey)}`, {
          method: "DELETE",
        });
      }
      setAuditStatus("idle");
      setAuditHistory([]);
      setDraftTitle("");
      setDraftDescription("");
      setDraftTitleSource("");
      setDraftDescriptionSource("");
      setDraftTitleReason("");
      setDraftDescriptionReason("");
      setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
      setDraftPrices(priceDraftFromCard(card));
      setDraftStocks(normalizeDraftStocks({}, card));
      setSemanticCoreSelected([]);
      setSemanticCoreReports([]);
      setSemanticActiveReportId("");
      setSemanticCore(null);
      setApproval(defaultApprovalState());
      setApprovalSections(defaultApprovalSections());
      setApprovalComment("");
      setDraftSavedAt("");
      setDraftSaveStatus("reset");
      setActiveTab("semantic");
      if (onDraftReset) {
        onDraftReset();
      }
      if (onDraftSaved) {
        await onDraftSaved(null);
      }
    } catch {
      setDraftSaveStatus("reset-error");
    }
  }

  function downloadDraftTable(type) {
    if (type === "content") {
      downloadXlsx(`${exportFileBase}-content-wb.xlsx`, buildContentExportSheets(card, draftTitle, draftDescription, draftCharacteristics));
      return;
    }
    if (type === "prices") {
      downloadXlsx(`${exportFileBase}-prices-wb.xlsx`, buildPricesExportSheets(card, draftPrices));
      return;
    }
    downloadXlsx(`${exportFileBase}-stocks-wb.xlsx`, buildStocksExportSheets(card, draftStocks));
  }

  function downloadSemanticCoreSelection({ selectedRows = semanticCoreSelected, core = activeSemanticCore, suffix = "semantic-core" } = {}) {
    const selectedRowsNormalized = normalizeSemanticSelection(selectedRows);
    const currentRows = (Array.isArray(core?.current) ? core.current : [])
      .filter((item) => item?.status !== "selected")
      .filter((item) => semanticQueryKey(item));
    const rowCount = Math.max(currentRows.length, selectedRowsNormalized.length);
    downloadXlsx(`${exportFileBase}-${suffix}.xlsx`, [{
      name: "СЯ в работу",
      freezeRows: 1,
      widths: [44, 16, 16, 16, 16, 44],
      rows: [
        ["Действующие до подбора", "Органика", "Средняя", "Реклама", "Найдено товаров", "Добавленные в работу"],
        ...Array.from({ length: rowCount }, (_, index) => [
          currentRows[index]?.query || "",
          semanticRankExportValue(currentRows[index]?.orgPos),
          semanticRankExportValue(currentRows[index]?.avgPos),
          semanticRankExportValue(currentRows[index]?.adPos),
          Number(currentRows[index]?.totalFound || 0) || "",
          selectedRowsNormalized[index]?.query || "",
        ]),
      ],
    }]);
  }

  function openSemanticReport(report) {
    if (!report?.semanticCore) return;
    setSemanticCore(report.semanticCore);
    setSemanticCoreSelected(normalizeSemanticSelection(report.selected));
    setSemanticActiveReportId(report.id);
    setSemanticSeedQuery(report.seedQuery || report.semanticCore.seedQuery || defaultSemanticSeedQuery(card));
    setSemanticSubjectFilter(report.subjectFilter || "");
    setSemanticSearch(report.search || "");
    setSemanticExcludeWords(report.excludeWords || "");
    setSemanticCoreStatus("loaded");
    setSemanticCoreError("");
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
          <Tag tone={approvalStatusTone(approval.status)}>{approvalStatusLabel(approval.status)}</Tag>
        </div>
      </header>

      <div className="content">
        <div className={`detail-layout ${activeTab === "changes" || activeTab === "competitors" ? "wide-changes" : ""}`}>
          <aside className="detail-aside">
            <div className={`photo-preview ${photoUrl ? "has-image" : ""}`}>
              {photoUrl ? <img src={photoUrl} alt={currentTitle} loading="eager" decoding="async" /> : null}
            </div>
            <section className="panel">
              <h2>Данные карточки</h2>
              <div className="panel-list">
                <div className="list-row"><span>Кабинет</span><strong>{portalName}</strong></div>
                <div className="list-row"><span>WB ID</span><strong>{valueSummary(card?.nmID)}</strong></div>
                <div className="list-row"><span>Артикул продавца</span><strong>{valueSummary(card?.vendorCode)}</strong></div>
                <div className="list-row"><span>Категория</span><strong>{valueSummary(card?.subjectName)}</strong></div>
                <div className="list-row"><span>Бренд</span><strong>{valueSummary(card?.brand)}</strong></div>
                <div className="list-row"><span>Описание</span><strong>{isEmptyValue(description) ? "Пусто" : "есть"}</strong></div>
                <div className="list-row"><span>Характеристики</span><strong>{valueSummary(characteristics)}</strong></div>
                <div className="list-row"><span>Фото</span><strong>{valueSummary(photos)}</strong></div>
                <div className="list-row"><span>Размеры</span><strong>{valueSummary(sizes)}</strong></div>
                <div className="list-row"><span>Цена</span><strong>{valueSummary(priceValue)}</strong></div>
                <div className="list-row"><span>Цена со скидкой</span><strong>{valueSummary(discountedPriceValue)}</strong></div>
                <div className="list-row"><span>Остаток всего</span><strong>{valueSummary(stockValue)}</strong></div>
                <div className="list-row"><span>FBO / WB</span><strong>{valueSummary(wbStockValue)}</strong></div>
                <div className="list-row"><span>FBS / продавец</span><strong>{valueSummary(sellerStockValue)}</strong></div>
                <div className="list-row"><span>Габариты</span><strong>{valueSummary(dimensions)}</strong></div>
                <div className="list-row"><span>Статус</span><strong>{valueSummary(card?.status)}</strong></div>
              </div>
            </section>
          </aside>

          <div className="detail-main">
            <nav className="detail-tabs" aria-label="Разделы карточки">
              <button className={activeTab === "semantic" ? "active" : ""} type="button" onClick={() => setActiveTab("semantic")}>Семантическое ядро</button>
              <button className={activeTab === "card" ? "active" : ""} type="button" onClick={() => setActiveTab("card")}>Карточка</button>
              <button className={activeTab === "audit" ? "active" : ""} type="button" onClick={() => setActiveTab("audit")}>Аудит</button>
              <button className={activeTab === "changes" ? "active" : ""} type="button" onClick={() => setActiveTab("changes")}>Изменения</button>
              <button className={activeTab === "competitors" ? "active" : ""} type="button" onClick={() => setActiveTab("competitors")}>ТОП конкурентов</button>
            </nav>
            <HelpHint enabled={helpEnabled} title="Как работать с карточкой">
              Сначала можно собрать Семантическое ядро, затем запустить Аудит. После аудита проверьте вкладку Изменения и отправьте готовые правки на согласование.
            </HelpHint>

            {activeTab === "semantic" ? (
              <section className="workspace-strip semantic-core-workspace">
                <div className="strip-head">
                  <div>
                    <h2>Семантическое ядро</h2>
                    <p>Отдельный SEO-запрос MPStats: расширение запросов по стартовой фразе без запуска аудита.</p>
                  </div>
                  <Tag tone={activeSemanticCore ? "blue" : (semanticCoreStatus === "loading" ? "blue" : "amber")}>
                    {semanticCoreStatus === "loading" ? "собираем" : semanticCoreStatus === "pending" ? "готовится" : activeSemanticCore ? `${activeSemanticCore.selectedCount || 0} выбрано` : "нет данных"}
                  </Tag>
                </div>
                <div className="semantic-query-bar">
                  <label className="field-label">
                    <span>Стартовый запрос</span>
                    <input value={semanticSeedQuery} onChange={(event) => setSemanticSeedQuery(event.target.value)} placeholder="пижама женская" />
                  </label>
                  <label className="field-label">
                    <span>Приоритетный предмет</span>
                    <select className="select" value={semanticSubjectFilter} onChange={(event) => setSemanticSubjectFilter(event.target.value)} disabled={!activeSemanticCore}>
                      <option value="">Все предметы</option>
                      {(activeSemanticCore?.subjectOptions || []).map((item) => (
                        <option value={item.name} key={item.name}>{item.name} · {formatNumber(item.count)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    <span>Поиск в запросах</span>
                    <input value={semanticSearch} onChange={(event) => setSemanticSearch(event.target.value)} placeholder="рибана, хлопок, розовая" disabled={!activeSemanticCore} />
                  </label>
                  <label className="field-label">
                    <span>Слова исключения</span>
                    <input value={semanticExcludeWords} onChange={(event) => setSemanticExcludeWords(event.target.value)} placeholder="шорты, костюм" disabled={!activeSemanticCore} />
                  </label>
                </div>
                {semanticSaveStatus === "saving" || semanticSaveStatus === "saved" || semanticSaveStatus === "error" ? (
                  <div className={`semantic-save-banner ${semanticSaveStatus}`}>
                    <strong>{semanticSaveStatus === "saved" ? "История СЯ сохранена" : semanticSaveStatus === "saving" ? "Сохраняем историю СЯ" : "История СЯ не сохранилась"}</strong>
                    <span>{semanticSaveStatus === "saved"
                      ? "Теперь можно обновлять страницу: подборка должна остаться в старых подборках."
                      : semanticSaveStatus === "saving"
                        ? "Не обновляйте страницу, пока сохранение не завершится."
                        : "Повторите подбор или попробуйте сохранить выбранные запросы еще раз."}</span>
                  </div>
                ) : null}
                {semanticCoreReports.length ? (
                  <div className="semantic-history">
                    <span>Старые подборки</span>
                    {semanticCoreReports.map((report) => (
                      <div className={`semantic-history-row ${report.id === semanticActiveReportId ? "active" : ""}`} key={report.id}>
                        <div>
                          <strong>{report.seedQuery || "Без запроса"}</strong>
                          <em>{report.createdAt ? new Date(report.createdAt).toLocaleString("ru-RU") : "без даты"} · {formatNumber(report.semanticCore?.totalKeywords || 0)} запросов · {formatNumber(report.selected?.length || 0)} выбрано</em>
                        </div>
                        <button className="btn mini" type="button" onClick={() => openSemanticReport(report)}>Открыть</button>
                        <button className="btn mini" type="button" onClick={() => downloadSemanticCoreSelection({ selectedRows: report.selected, core: report.semanticCore, suffix: `semantic-core-${String(report.createdAt || "").slice(0, 10)}` })} disabled={!report.selected?.length && !report.semanticCore?.current?.length}>
                          <Download size={14} />Скачать
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {activeSemanticCore ? (
                  <SemanticCorePanel
                    semanticCore={activeSemanticCore}
                    standalone
                    subjectFilter={semanticSubjectFilter}
                    search={semanticSearch}
                    excludeWords={semanticExcludeWords}
                    onTakeKeyword={takeSemanticKeyword}
                    onRemoveKeyword={removeSemanticKeyword}
                  />
                ) : (
                  <div className="empty-state">
                    <strong>Семантическое ядро еще не собрано</strong>
                    <span>Введите релевантный запрос и запустите подбор. MPStats вернет расширение запросов, кластеры, предметы и частотность.</span>
                  </div>
                )}
                <div className="tab-actions">
                  {semanticCoreError ? <span className="status-note">{semanticCoreError}</span> : null}
                  {semanticRankStatus === "loading" ? <span className="status-note">Подтягиваем позиции действующих ключей...</span> : null}
                  {semanticRankStatus === "empty" ? <span className="status-note">MPStats не вернул позиции по действующим ключам.</span> : null}
                  {semanticRankStatus === "error" ? <span className="status-note">СЯ собрано, но позиции ключей сейчас не загрузились.</span> : null}
                  {semanticSaveStatus === "saving" ? <span className="status-note">Сохраняем выбранное СЯ...</span> : null}
                  {semanticSaveStatus === "saved" ? <span className="status-note">СЯ сохранено в истории карточки.</span> : null}
                  {semanticSaveStatus === "error" ? <span className="status-note">Выбрано на экране, но не сохранилось в черновик. Повторите действие позже.</span> : null}
                  {semanticContentStatus === "loading" ? <span className="status-note">GigaChat переписывает заголовок и описание...</span> : null}
                  {semanticContentStatus === "done" ? <span className="status-note">Черновик контента переоптимизирован по выбранному СЯ.</span> : null}
                  {semanticContentError ? <span className="status-note">{semanticContentError}</span> : null}
                  {semanticCoreStatus === "missing-card" ? <span className="status-note">Укажите стартовый запрос для СЯ.</span> : null}
                  <button className="btn" type="button" onClick={() => downloadSemanticCoreSelection()} disabled={!activeSemanticCore}>
                    <Download size={17} />Скачать выбранное
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={reoptimizeContentFromSemanticCore}
                    disabled={!canReoptimizeContent}
                    title={semanticCoreSelected.length ? "Переписать заголовок и описание с учетом выбранных запросов" : "Сначала добавьте запросы в работу"}
                  >
                    <WandSparkles size={17} />{semanticContentRunning ? "Переоптимизируем" : "Переоптимизировать"}
                  </button>
                  <button className="btn primary" type="button" onClick={() => loadSemanticCore({ forceRefresh: Boolean(activeSemanticCore) })} disabled={semanticCoreStatus === "loading" || !semanticSeedQuery.trim()}>
                    <Search size={17} />{semanticCoreStatus === "loading" ? "Подбираем запросы" : semanticCoreStatus === "pending" ? "Повторить подбор" : activeSemanticCore ? "Обновить подбор" : "Подобрать запросы"}
                  </button>
                </div>
              </section>
            ) : null}

            {activeTab === "audit" ? (
              <section className="workspace-strip audit-workspace">
                <div className="strip-head">
                  <div>
                    <h2>Аудит карточки</h2>
                    <p>{auditNextStep.copy}</p>
                  </div>
                  <Tag tone={auditStatusTone}>{auditStatusText}</Tag>
                </div>
                <HelpList
                  enabled={helpEnabled}
                  title="Как сделать аудит"
                  items={[
                    "Если есть важные конкуренты, вставьте ссылки WB или nmID в поле Конкуренты для этого аудита.",
                    "Если конкурентов нет, оставьте поле пустым: система сама подберет похожие карточки через MPStats.",
                    "Нажмите Запустить аудит. После завершения появятся выводы, история и черновик правок. Проверять его нужно во вкладке Изменения.",
                  ]}
                />
                <div className="audit-flow">
                  {auditFlowSteps.map((step) => (
                    <div className={`audit-flow-step ${step.status}`} key={step.title}>
                      <strong>{step.title}</strong>
                      <span>{step.copy}</span>
                    </div>
                  ))}
                </div>

                <div className="audit-next-step">
                  <div>
                    <span>Следующий шаг</span>
                    <strong>{auditNextStep.title}</strong>
                    <p>{auditNextStep.copy}</p>
                  </div>
                  <div className="audit-next-actions">
                    {auditDone ? (
                      <button className="btn primary" type="button" onClick={() => setActiveTab("changes")}>
                        <CheckSquare size={17} />{auditNextStep.action}
                      </button>
                    ) : (
                      <button className="btn primary" type="button" onClick={() => runAudit("audit")} disabled={auditRunning || mpstatsCharacteristicsStatus === "loading"}>
                        <ClipboardList size={17} />{auditRunning ? "Аудит идет" : auditNextStep.action}
                      </button>
                    )}
                    {auditDone ? (
                      <button className="btn" type="button" onClick={() => runAudit("audit")} disabled={auditRunning || mpstatsCharacteristicsStatus === "loading"}>
                        <RefreshCw size={16} />Запустить заново
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="audit-list audit-main-list">
                  {auditStale ? (
                    <div className="issue">
                      <div className="issue-head">
                        <strong>Аудит сброшен после обновления WB</strong>
                        <Tag tone="amber">нужен новый запуск</Tag>
                      </div>
                      <p>Черновик изменений и задача согласования сохранены, но аналитика MPStats и история аудита очищены, потому что карточки были загружены заново.</p>
                    </div>
                  ) : null}
                  <div className="issue">
                    <div className="issue-head">
                      <strong>{issueCount ? card.issue : "Критичных проблем нет"}</strong>
                      <Tag tone={issueCount ? "amber" : "green"}>{issueCount ? "проверка" : "ок"}</Tag>
                    </div>
                    <p>{issueCount ? issueCopy(card.issue, cardSourceLabel) : `Карточка выглядит рабочей по текущему снимку ${cardSourceLabel}. Перед публикацией все равно нужна ручная проверка.`}</p>
                  </div>
                  <div className="issue audit-competitors-input">
                    <div className="issue-head">
                      <strong>Конкуренты для этого аудита</strong>
                      <Tag tone={auditCompetitorIds.length ? "blue" : "green"}>{auditCompetitorIds.length ? `${auditCompetitorIds.length}/3` : "необязательно"}</Tag>
                    </div>
                    <textarea
                      value={auditCompetitorInput}
                      onChange={(event) => setAuditCompetitorInput(event.target.value)}
                      disabled={auditRunning}
                      rows={3}
                      placeholder="Ссылки WB или nmID, по одной строке"
                    />
                    <p>{auditCompetitorIds.length ? "Эти карточки будут проверены на коммерческую схожесть и получат приоритет в аудите." : "Если оставить поле пустым, аудит сам подберет конкурентов через MPStats."}</p>
                  </div>
                  {auditDone ? (
                    <div className="issue audit-result-card">
                      <div className="issue-head">
                        <strong>Результат аудита</strong>
                        <Tag tone={latestRiskNotes.length ? "amber" : "green"}>{latestRiskNotes.length ? "есть ручная проверка" : "готово"}</Tag>
                      </div>
                      <p className="audit-finding-lead">{latestAuditInsight}</p>
                      <div className="audit-result-columns">
                        <div>
                          <span>Что не так</span>
                          {latestMainProblems.length ? latestMainProblems.slice(0, 3).map((item, index) => <p key={`problem-${index}`}>{item}</p>) : <p>Критичных проблем по текущим данным не найдено.</p>}
                        </div>
                        <div>
                          <span>Что предлагаем изменить</span>
                          {latestQuickWins.length ? latestQuickWins.slice(0, 4).map((item, index) => <p key={`quick-${index}`}>{item}</p>) : <p>Черновик подготовлен во вкладке Изменения.</p>}
                        </div>
                        <div>
                          <span>Что проверить вручную</span>
                          {latestRiskNotes.length ? latestRiskNotes.slice(0, 3).map((item, index) => <p key={`risk-${index}`}>{item}</p>) : <p>Особых ограничений в ответах API нет.</p>}
                        </div>
                      </div>
                      <div className="audit-result-actions">
                        <button className="btn primary" type="button" onClick={() => setActiveTab("changes")}>
                          <CheckSquare size={17} />Перейти к черновику
                        </button>
                        <span>{auditPreparedChangesCount} {pluralRu(auditPreparedChangesCount, "правка", "правки", "правок")} в черновике</span>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state audit-empty-state">
                      <strong>{auditRunning ? "Аудит выполняется" : "Результат появится здесь"}</strong>
                      <span>{auditRunning ? "После завершения мы покажем выводы и подготовим черновик изменений." : "Запустите аудит, чтобы получить краткие выводы и готовые поля для проверки."}</span>
                    </div>
                  )}
                </div>

                <details className="audit-technical-details">
                  <summary>
                    <span>Технические детали аудита</span>
                    <Tag tone={auditHistory.length ? "blue" : "green"}>{auditHistory.length || "пусто"}</Tag>
                  </summary>
                  <div className="audit-list">
                    <div className="issue">
                      <div className="issue-head">
                        <strong>Аналитика MPStats</strong>
                        <Tag tone={mpstatsHintsTone}>{mpstatsHintsLabel}</Tag>
                      </div>
                      <p>{mpstatsCharacteristicsStatus === "loaded"
                        ? `Найдено ${mpstatsCharacteristics.length} групп характеристик, ${mpstatsMatches} совпало с карточкой. Эти значения уже подмешиваются в правки.`
                        : mpstatsCharacteristicsStatus === "loading"
                          ? "Запрашиваем отчет MPStats. Это расходует запрос аналитики и может занять несколько секунд."
                          : "Будет запрошена при запуске аудита. После этого результат сохранится в кэше и будет использоваться в ручных правках."}</p>
                    </div>
                    <div className="issue">
                      <div className="issue-head">
                        <strong>Характеристики для продвижения</strong>
                        <Tag tone={promotionRelevantCount ? "amber" : "green"}>{promotionRelevantCount || "нет"} в фокусе</Tag>
                      </div>
                      <p>В фокус попадают обязательные, популярные и фильтруемые поля WB. Если MPStats отдаст отдельный признак влияния на продвижение, он тоже будет учтен.</p>
                    </div>
                    {auditDone && latestCompetitorSelection ? (
                      <div className="issue audit-competitor-selection">
                        <div className="issue-head">
                          <strong>Конкурентный набор аудита</strong>
                          <Tag tone={latestCompetitorSelection.summary?.rejectedManual ? "amber" : "blue"}>
                            {latestCompetitorSelection.summary?.finalCount || 0}/{topCompetitorLimit}
                          </Tag>
                        </div>
                        <AuditCompetitorSelection selection={latestCompetitorSelection} />
                      </div>
                    ) : null}
                    {auditDone ? (
                      <div className="issue audit-findings">
                        <div className="issue-head">
                          <strong>Факты аудита</strong>
                          <Tag tone={latestRiskNotes.length ? "amber" : "green"}>{latestRiskNotes.length ? "есть ограничения" : "доказательно"}</Tag>
                        </div>
                        <div className="audit-fact-grid">
                          {latestAuditFacts.map(([label, value]) => (
                            <div key={label}>
                              <span>{label}</span>
                              <strong>{value}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="issue audit-history">
                      <div className="issue-head">
                        <strong>История аудитов</strong>
                        <Tag tone={auditHistory.length ? "blue" : "green"}>{auditHistory.length || "пусто"}</Tag>
                      </div>
                      {auditHistory.length ? (
                        <div className="audit-history-list">
                          {auditHistory.slice(0, 5).map((item) => (
                            <div className="audit-history-row" key={item.id || item.createdAt}>
                              <span>{item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU") : "Без даты"} · {auditEngineLabel(item.engine)}</span>
                              <em>
                                {item.mpstatsGroups || 0} MPStats · {Number.isFinite(Number(item.mpstatsCredits)) ? `${item.mpstatsCredits} кредитов · ` : ""}
                                {Number.isFinite(Number(item.mpstatsCacheHits)) ? `${item.mpstatsCacheHits} кэш · ` : ""}
                                {item.competitors || 0} конкурентов{item.manualCompetitors ? `, ${item.manualCompetitors} вручную` : ""} ·
                                {item.mpstatsMatches || 0} совпало · {item.changedCharacteristics || 0} изменено
                              </em>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>{auditStale ? "История аудита очищена после обновления данных WB. Черновик изменений сохранен." : "После запуска аудита здесь появятся даты и краткий итог. История сохранится вместе с черновиком."}</p>
                      )}
                    </div>
                  </div>
                </details>
              </section>
            ) : null}

            {activeTab === "card" ? (
              <>
                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Заголовок</h2>
                      <p>Исходное название и описание из текущего снимка WB.</p>
                    </div>
                    <Tag tone={titleLength <= 60 ? "green" : "amber"}>лимит WB 60</Tag>
                  </div>
                  <div className="option-list">
                    <div className="option-row">
                      <div className="option-head">
                        <strong>{currentTitle}</strong>
                        <span className={`char-counter ${titleLength <= 60 ? "ok" : ""}`}>{titleLength}/60</span>
                      </div>
                      <p>Это текущее название карточки из {cardSourceLabel}.</p>
                    </div>
                  </div>
                  <div className="snapshot-description">
                    <span>Описание</span>
                    <p>{isEmptyValue(description) ? "Пусто" : description}</p>
                  </div>
                </section>

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

                <section className="workspace-strip commerce-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Цены и остатки</h2>
                      <p>Текущие данные из {cardSourceLabel}: цена, скидка и доступные остатки.</p>
                    </div>
                    <Tag tone={hasCommercialData ? "blue" : "amber"}>{hasCommercialData ? `данные ${cardSourceLabel}` : "нет данных"}</Tag>
                  </div>
                  <div className="commerce-summary">
                    <div><span>Цена до скидки</span><strong>{valueSummary(priceValue)}</strong></div>
                    <div><span>Скидка продавца</span><strong>{valueSummary(discountValue)}</strong></div>
                    <div><span>Цена со скидкой</span><strong>{valueSummary(discountedPriceValue)}</strong></div>
                    <div><span>СПП / клубная</span><strong>{valueSummary(clubDiscountedPriceValue)}</strong></div>
                    <div><span>FBO / WB</span><strong>{valueSummary(wbStockValue)}</strong></div>
                    <div><span>FBS / продавец</span><strong>{valueSummary(sellerStockValue)}</strong></div>
                    <div><span>Остаток всего</span><strong>{valueSummary(stockValue)}</strong></div>
                    <div><span>Баркод</span><strong>{valueSummary(firstSku(card))}</strong></div>
                  </div>
                  <div className="commerce-size-scroll">
                    <div className="commerce-size-table">
                      <div className="commerce-size-row commerce-size-head">
                        <span>Размер</span>
                        <span>Баркод</span>
                        <span>Цена</span>
                        <span>Со скидкой</span>
                        <span>СПП</span>
                        <span>FBO / WB</span>
                        <span>FBS</span>
                        <span>Всего</span>
                      </div>
                      {commercialSizeRows.length ? commercialSizeRows.map((row) => (
                        <div className="commerce-size-row" key={row.key}>
                          <strong>{row.sizeName}</strong>
                          <span>{row.skus.filter(Boolean).join(", ") || "Баркод не указан"}</span>
                          <span>{valueSummary(row.price)}</span>
                          <span>{valueSummary(row.discountedPrice)}</span>
                          <span>{valueSummary(row.clubDiscountedPrice)}</span>
                          <span>{valueSummary(row.wbStock)}</span>
                          <span>{valueSummary(row.sellerStock)}</span>
                          <span>{valueSummary(row.stock)}</span>
                        </div>
                      )) : (
                        <div className="empty-state"><span>{cardSourceLabel} не вернул размерные строки с ценами и остатками.</span></div>
                      )}
                    </div>
                  </div>
                </section>

                <details className="workspace-strip technical-fields">
                  <summary>
                    <span>Служебные данные {cardSourceLabel}</span>
                    <Tag tone="blue">{Object.keys(rawFields).length} полей</Tag>
                  </summary>
                  <RawFieldsView fields={rawFields} />
                </details>
              </>
            ) : null}

            {activeTab === "competitors" ? (
              <TopCompetitorsPanel
                competitors={competitors}
                competitorInput={competitorInput}
                status={competitorStatus}
                enabled={competitorsEnabled}
                onInput={setCompetitorInput}
                onAdd={addCompetitor}
                onSuggest={suggestCompetitors}
                onRefresh={() => refreshCompetitors()}
                onRemove={removeCompetitor}
                onReoptimizeChange={reoptimizeContentFromCompetitorChange}
                onSkipChange={skipCompetitorChange}
              />
            ) : null}

            {activeTab === "changes" ? (
              <section className="workspace-strip">
                <div className="changes-context">
                  <Thumb url={photoUrl} alt={false} />
                  <div className="changes-context-main">
                    <strong>{currentTitle}</strong>
                    <span>WB {textOrDash(card?.nmID)} · артикул {textOrDash(card?.vendorCode)} · {textOrDash(card?.subjectName)}</span>
                  </div>
                  <Tag tone={issueCount ? "amber" : "green"}>{card?.status || "Статус не указан"}</Tag>
                </div>
                <div className="strip-head">
                  <div>
                    <h2>Изменения и согласование</h2>
                    <p>{auditDone
                      ? "Рекомендации аудита помечены, но любые поля можно править вручную."
                      : auditStale
                        ? "Черновик и задача сохранены после обновления WB. Аудит сброшен, поэтому для новых рекомендаций запустите его заново."
                        : "Заполняйте колонку Черновик вручную. MPStats-аналитика подтянется из кэша аудита, если он уже был."}</p>
                  </div>
                  <div className="strip-actions">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => loadMpstatsCharacteristicHints({ forceRefresh: true })}
                      disabled={mpstatsCharacteristicsStatus === "loading"}
                      title="Принудительно обновить аналитику MPStats. Расходует запрос MPStats."
                    >
                      <RefreshCw size={16} />Обновить аналитику
                    </button>
                    <Tag tone={mpstatsHintsTone} title={mpstatsHintsTitle}>{mpstatsHintsLabel}</Tag>
                  </div>
                </div>
                <ChangesReadinessPanel
                  sections={changesReadinessSections}
                  activeSection={activeApprovalSection}
                  summary={changesReadinessCopy}
                  onSelect={setChangesTab}
                  onDownload={downloadDraftTable}
                />
                <div className="changes-tabs" aria-label="Тип изменений">
                  <button className={changesTab === "content" ? "active" : ""} type="button" onClick={() => setChangesTab("content")}>
                    <span className="changes-tab-title"><FileText size={17} />Контент</span>
                    <span className={`changes-tab-status status-${approvalSections.content.status}`}>{approvalStatusLabel(approvalSections.content.status)}</span>
                  </button>
                  <button className={changesTab === "prices" ? "active" : ""} type="button" onClick={() => setChangesTab("prices")}>
                    <span className="changes-tab-title"><Tags size={17} />Цены</span>
                    <span className={`changes-tab-status status-${approvalSections.prices.status}`}>{approvalStatusLabel(approvalSections.prices.status)}</span>
                  </button>
                  <button className={changesTab === "stocks" ? "active" : ""} type="button" onClick={() => setChangesTab("stocks")}>
                    <span className="changes-tab-title"><Warehouse size={17} />Остатки</span>
                    <span className={`changes-tab-status status-${approvalSections.stocks.status}`}>{approvalStatusLabel(approvalSections.stocks.status)}</span>
                  </button>
                </div>
                {changesTab === "content" ? (
                <>
                <ContentAuditSummary
                  titleChanged={normalizedCharacteristicOption(draftTitle) !== normalizedCharacteristicOption(currentTitle)}
                  titleSource={draftTitleSource}
                  titleReason={draftTitleReason}
                  descriptionChanged={normalizedCharacteristicOption(draftDescription) !== normalizedCharacteristicOption(description)}
                  descriptionSource={draftDescriptionSource}
                  descriptionReason={draftDescriptionReason}
	                  changedCharacteristicsCount={changedDraftCharacteristicsCount}
	                  auditCharacteristicsCount={auditDraftCharacteristicsCount}
	                  mpstatsStatus={mpstatsHintsLabel}
	                />
	                <div className="before-after">
                  <div className="field-box">
                    <strong>Текущий заголовок</strong>
                    <p>{currentTitle}</p>
                  </div>
                  <div className="field-box">
                    <strong>Черновик заголовка</strong>
                    <textarea
                      className={["audit", "semantic"].includes(draftTitleSource) ? "short audit-suggestion-field" : "short"}
                      value={draftTitle}
                      disabled={approvalReadOnly}
                      onChange={(event) => {
                        setDraftTitle(event.target.value);
                        setDraftTitleSource(event.target.value.trim() ? "manual" : "");
                        setDraftTitleReason("");
                      }}
                      placeholder="Введите новый заголовок или запустите аудит для рекомендации."
                    />
                    <p className="draft-source-line">
                      <span className={`char-counter ${draftTitleLength <= 60 ? "ok" : ""}`}>{draftTitleLength}/60 символов</span>
                      <DraftSourceMark source={draftTitleSource} />
                    </p>
                    <DraftReason reason={draftTitleReason} />
                  </div>
                  <div className="field-box description-box">
                    <strong>Текущее описание</strong>
                    <p>{isEmptyValue(description) ? "Пусто" : description}</p>
                  </div>
                  <div className="field-box description-box">
                    <strong>Черновик описания</strong>
                    <textarea
                      className={`description-editor ${["audit", "semantic"].includes(draftDescriptionSource) ? "audit-suggestion-field" : ""}`}
                      value={draftDescription}
                      disabled={approvalReadOnly}
                      onChange={(event) => {
                        setDraftDescription(event.target.value);
                        setDraftDescriptionSource(event.target.value.trim() ? "manual" : "");
                        setDraftDescriptionReason("");
                      }}
                      placeholder="Введите новое описание или запустите аудит для рекомендации."
                    />
                    <DraftSourceMark source={draftDescriptionSource} />
                    <DraftReason reason={draftDescriptionReason} />
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
                      mpstatsCharacteristics={mpstatsCharacteristics}
                      valueOptionsByKey={characteristicValueOptions}
                      onSearch={setCharacteristicSearch}
                      onAdd={addDraftCharacteristic}
                      onRemove={removeDraftCharacteristic}
                      onAddValue={addDraftCharacteristicValue}
                      onRemoveValue={removeDraftCharacteristicValue}
                      readOnly={approvalReadOnly}
                    />
                  </div>
                </div>
                <div className="tab-actions">
                  <button className="btn" type="button" onClick={() => downloadDraftTable("content")}><Download size={17} />Скачать контент</button>
                </div>
                </>
                ) : null}
	                {changesTab === "prices" ? (
	                  <div className="before-after">
	                    <div className="field-box">
	                      <strong>Текущие цены</strong>
	                      <div className="panel-list compact-list">
	                        <div className="list-row"><span>Цена до скидки</span><strong>{valueSummary(priceValue)}</strong></div>
	                        <div className="list-row"><span>Скидка продавца</span><strong>{valueSummary(discountValue)}</strong></div>
	                        <div className="list-row"><span>Цена со скидкой</span><strong>{valueSummary(discountedPriceValue)}</strong></div>
	                        <div className="list-row"><span>Баркод</span><strong>{valueSummary(firstSku(card))}</strong></div>
	                      </div>
	                    </div>
	                    <div className="field-box">
	                      <strong>Черновик цен</strong>
	                      <label className="field-label">
	                        Цена до скидки
	                        <input
	                          type="number"
	                          min="0"
	                          value={draftPrices.price ?? ""}
	                          disabled={approvalReadOnly}
	                          onChange={(event) => updateDraftPrice("price", event.target.value)}
	                        />
	                      </label>
	                      <label className="field-label">
	                        Скидка продавца, %
	                        <input
	                          type="number"
	                          min="0"
	                          max="99"
	                          value={draftPrices.discount ?? ""}
	                          disabled={approvalReadOnly}
	                          onChange={(event) => updateDraftPrice("discount", event.target.value)}
	                        />
	                      </label>
	                      <div className="panel-list compact-list">
	                        <div className="list-row"><span>Расчетная цена со скидкой</span><strong>{valueSummary(draftDiscountedPriceValue)}</strong></div>
	                      </div>
	                      <label className="field-label price-recommendation-field">
	                        Рекомендация по цене
	                        <textarea
	                          value={draftPrices.recommendation || ""}
	                          disabled={approvalReadOnly}
	                          onChange={(event) => updatePriceRecommendation(event.target.value)}
	                          placeholder="Система сформирует рекомендацию после заполнения цены."
	                        />
	                      </label>
	                      <div className="price-recommendation-actions">
	                        <span>{draftPrices.recommendationSource === "manual" ? "Текст изменен вручную" : "Системная рекомендация"}</span>
	                        <button className="btn" type="button" onClick={regeneratePriceRecommendation} disabled={approvalReadOnly}><RefreshCw size={16} />Обновить</button>
	                      </div>
	                      <button className="btn" type="button" onClick={() => downloadDraftTable("prices")}><Download size={17} />Скачать цены</button>
	                    </div>
	                  </div>
	                ) : null}
                {changesTab === "stocks" ? (
                  <div className="before-after">
                    <div className="field-box">
                      <strong>Текущие размеры и баркоды</strong>
                      <div className="panel-list compact-list">
                        {(Array.isArray(sizes) && sizes.length ? sizes : [{}]).slice(0, 8).map((size, index) => (
                          <div className="list-row" key={`${size?.chrtID || index}-${size?.techSize || ""}`}>
                            <span>{size?.techSize || size?.wbSize || `Размер ${index + 1}`} · {sizeStockText(size)}</span>
                            <strong>{Array.isArray(size?.skus) && size.skus.length ? size.skus.join(", ") : "Баркод не указан"}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
	                    <div className="field-box">
	                      <strong>Черновик остатков</strong>
	                      <div className="panel-list compact-list">
	                        {(draftStockRows.length ? draftStockRows : [{}]).slice(0, 12).map((row, index) => (
	                          <div className="list-row" key={row.key || index}>
	                            <span>{row.sizeName || `Размер ${index + 1}`} · {row.sku || "без баркода"}</span>
	                            <input
	                              type="number"
	                              min="0"
	                              value={row.amount ?? ""}
	                              disabled={approvalReadOnly || !row.key}
	                              onChange={(event) => updateDraftStock(row.key, event.target.value)}
	                            />
	                          </div>
	                        ))}
	                      </div>
	                      <button className="btn" type="button" onClick={() => downloadDraftTable("stocks")}><Download size={17} />Скачать остатки</button>
	                    </div>
                  </div>
                ) : null}
                <ApprovalPanel
                  approval={activeApproval}
                  sectionLabel={approvalSectionLabel(activeApprovalSection)}
                  currentUser={currentUser}
                  team={portalTeam}
                  canSubmit={canSubmitApproval}
                  canReview={canReviewApproval}
                  readOnly={approvalReadOnly}
                  comment={approvalComment}
                  onComment={setApprovalComment}
                  onSubmit={submitForApproval}
                  onApprove={approveChanges}
                  onReturn={requestChanges}
                  status={draftSaveStatus}
                />
                <div className="draft-actions">
                  <div>
                    <strong>Черновик изменений</strong>
                    <p>{draftSavedAt
                      ? `Сохранен ${new Date(draftSavedAt).toLocaleString("ru-RU")}${draftSaveStatus === "backend" ? " на backend" : " локально"}`
                      : "Не сохранен. Сохраните перед выходом, чтобы не потерять черновик."}</p>
                    {draftSaveStatus === "local-fallback" ? <p>Backend недоступен для черновика, временно сохранено в этом браузере.</p> : null}
                    {draftSaveStatus === "saving" ? <p>Сохраняем копию на backend.</p> : null}
                    {draftSaveStatus === "resetting" ? <p>Сбрасываем черновик.</p> : null}
                    {draftSaveStatus === "reset" ? <p>Черновик сброшен. В черновике снова текущие данные WB.</p> : null}
                    {draftSaveStatus === "reset-error" ? <p>Не удалось сбросить черновик на backend. Попробуйте еще раз.</p> : null}
                    {draftSaveStatus === "approval-submitted" ? <p>Задача отправлена аккаунт-менеджеру на согласование.</p> : null}
                    {draftSaveStatus === "approval-approved" ? <p>Правки приняты. Можно выгружать таблицы WB.</p> : null}
	                    {draftSaveStatus === "approval-returned" ? <p>Правки возвращены на доработку с комментарием.</p> : null}
	                    {draftSaveStatus === "approval-reason-required" ? <p>Укажите причину, чтобы вернуть правки на доработку.</p> : null}
	                    {draftSaveStatus === "approval-save-error" ? <p>Решение не сохранилось на backend. Статус вернули назад, попробуйте еще раз.</p> : null}
	                    {draftSaveStatus === "error" || draftSaveStatus === "local-error" ? <p>Черновик не удалось сохранить. Не обновляйте страницу и попробуйте еще раз.</p> : null}
                  </div>
                  <div className="draft-buttons">
                    <button className="btn primary" type="button" onClick={saveDraft} disabled={approvalReadOnly}><Save size={17} />Сохранить</button>
                    <button className="btn" type="button" onClick={resetDraft} disabled={approvalReadOnly || draftSaveStatus === "resetting"}><RotateCcw size={17} />Сбросить</button>
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

function competitorNmIdFromInput(value) {
  const matches = String(value || "").match(/\d{6,12}/g);
  return matches?.length ? matches[matches.length - 1] : "";
}

function auditCompetitorIdsFromInput(value, limit = 3) {
  const seen = new Set();
  const ids = [];
  const matches = String(value || "").match(/\d{6,12}/g) || [];
  matches.forEach((id) => {
    if (seen.has(id) || ids.length >= limit) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function wbCompetitorUrl(nmID) {
  const id = competitorNmIdFromInput(nmID);
  return id ? `https://www.wildberries.ru/catalog/${id}/detail.aspx` : "";
}

function competitorPriceText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "нет данных";
  }
  return `${formatNumber(Math.round(number))} ₽`;
}

function competitorSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (Math.abs(number) < 0.1) return "рядом";
  return `${number > 0 ? "+" : ""}${number}%`;
}

function competitorSignedNumber(value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return `${number > 0 ? "+" : ""}${formatNumber(number)}${suffix}`;
}

function competitorDateText(value) {
  if (!value) return "еще не обновляли";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU");
}

function competitorContentVersionText(snapshot) {
  const versions = Array.isArray(snapshot?.mpstatsVersions) ? snapshot.mpstatsVersions : [];
  const parts = [];
  if (snapshot?.mpstatsVersionAt) {
    parts.push(`MPStats увидел ${competitorDateText(snapshot.mpstatsVersionAt)}`);
  }
  if (versions.length) {
    parts.push(`последние ${formatNumber(versions.length)} верс.`);
  }
  return parts.join(" · ") || "версия не найдена";
}

function competitorPriceUpdatedText(snapshot) {
  if (snapshot?.mpstatsUpdatedAt) {
    return `MPStats обновил ${competitorDateText(snapshot.mpstatsUpdatedAt)}`;
  }
  return "дата цены не найдена";
}

function competitorPhotoHistoryText(snapshot) {
  const history = Array.isArray(snapshot?.photoHistory) ? snapshot.photoHistory : [];
  const lastChangedAt = snapshot?.lastPhotoChangedAt || history[0]?.changedAt || "";
  const parts = [];
  if (Number(snapshot?.photosCount) > 0) {
    parts.push(`${formatNumber(snapshot.photosCount)} фото`);
  }
  if (lastChangedAt) {
    parts.push(`MPStats увидел смену ${competitorDateText(lastChangedAt)}`);
  }
  if (history.length) {
    parts.push(`история ${formatNumber(history.length)} сним.`);
  }
  return parts.join(" · ") || "нет данных";
}

function competitorPeriodText(previousSnapshot, snapshot, fallbackDate) {
  const fromVersion = previousSnapshot?.mpstatsVersionAt || "";
  const toVersion = snapshot?.mpstatsVersionAt || "";
  if (fromVersion && toVersion && fromVersion !== toVersion) {
    return `По версиям MPStats с ${competitorDateText(fromVersion)} по ${competitorDateText(toVersion)} поменялось следующее:`;
  }
  const from = previousSnapshot?.checkedAt || previousSnapshot?.updatedAt || "";
  const to = snapshot?.checkedAt || fallbackDate || "";
  if (from && to) return `За период проверок с ${competitorDateText(from)} по ${competitorDateText(to)} поменялось следующее:`;
  return "С прошлого сохраненного снимка поменялось следующее:";
}

function competitorChangeTimingText(change, previousSnapshot, snapshot, fallbackDate) {
  if (change?.detectedAt) {
    return `${change.detectedBy === "mpstats" ? "MPStats увидел" : "Обнаружено"} ${competitorDateText(change.detectedAt)}.`;
  }
  const from = previousSnapshot?.checkedAt || previousSnapshot?.updatedAt || "";
  const to = snapshot?.checkedAt || fallbackDate || "";
  if (from && to) {
    return `Появилось между ${competitorDateText(from)} и ${competitorDateText(to)}.`;
  }
  if (to) {
    return `Обнаружено при обновлении ${competitorDateText(to)}; нужен следующий снимок для точного периода.`;
  }
  return "Обнаружено на текущем снимке.";
}

function competitorMonitoringConclusion(changes, hasPreviousSnapshot, previousSnapshot, snapshot) {
  const visible = Array.isArray(changes) ? changes : [];
  if (!hasPreviousSnapshot) {
    return "Зафиксировали стартовое состояние конкурента: цену, текст и товарные характеристики. После следующего обновления будет видно, что именно поменялось.";
  }
  if (!visible.length) {
    const sameMpstatsVersion = previousSnapshot?.mpstatsVersionAt && snapshot?.mpstatsVersionAt && previousSnapshot.mpstatsVersionAt === snapshot.mpstatsVersionAt;
    const parts = [];
    parts.push(sameMpstatsVersion ? "MPStats не показал новой версии контента" : "Новых отличий между сохраненными снимками не найдено");
    parts.push("цена, заголовок, описание и товарные характеристики остались без изменений");
    if (snapshot?.mpstatsUpdatedAt) {
      parts.push(`цена актуальна на ${competitorDateText(snapshot.mpstatsUpdatedAt)}`);
    }
    return `${parts.join("; ")}.`;
  }
  const labels = visible.map((change) => change?.label).filter(Boolean);
  const uniqueLabels = [...new Set(labels)];
  const hints = [];
  if (visible.some((change) => ["discountedPrice", "price"].includes(change?.field))) {
    hints.push("проверьте ценовую позицию относительно нашей карточки");
  }
  if (visible.some((change) => ["title", "descriptionHash"].includes(change?.field))) {
    hints.push("сравните, не усилили ли конкурентный текст");
  }
  if (visible.some((change) => change?.field === "characteristics")) {
    hints.push("посмотрите, не добавили ли они важные товарные свойства");
  }
  return `За период изменилось: ${uniqueLabels.join(", ") || "контент конкурента"}. ${hints.join("; ") || "Изменения стоит учитывать при следующей переоптимизации"}.`;
}

function competitorCharacteristicRows(characteristics, limit = 6) {
  return (Array.isArray(characteristics) ? characteristics : [])
    .map((item) => ({
      name: textOrDash(item?.name),
      value: Array.isArray(item?.values) ? item.values.filter(Boolean).join(", ") : item?.value,
    }))
    .filter((item) => item.name && item.name !== "—" && item.value)
    .filter((item) => !competitorIsServiceCharacteristic(item))
    .slice(0, limit);
}

function competitorCharacteristicLine(item) {
  return `${item?.name || "Характеристика"}: ${item?.value || item?.current || item?.competitor || "нет данных"}`;
}

function competitorNormalizedText(value) {
  return String(value || "").trim().toLowerCase().replaceAll("ё", "е");
}

function competitorIsServiceCharacteristic(item) {
  const name = competitorNormalizedText(item?.name);
  if (["документы проверены", "тнвэд", "декларация соответствия", "сертификат соответствия"].includes(name)) {
    return true;
  }
  if (!["основная информация", "дополнительная информация"].includes(name)) return false;
  return [item?.value, item?.previous, item?.current, item?.competitor]
    .some((value) => competitorNormalizedText(value) === name);
}

function competitorCharacteristicsComparisonText(comparison) {
  const data = comparison?.characteristics || {};
  const same = Number(data.sameCount || 0);
  const different = Number(data.differentCount || 0);
  const extra = Number(data.onlyCompetitorCount || 0);
  const missing = Number(data.onlyCurrentCount || 0);
  const parts = [];
  if (same) parts.push(`совпадает ${same}`);
  if (different) parts.push(`отличается ${different}`);
  if (extra) parts.push(`у конкурента дополнительно ${extra}`);
  if (missing) parts.push(`у нас дополнительно ${missing}`);
  return parts.join(" · ") || "нет данных для сравнения";
}

function competitorChangeText(change) {
  if (change?.summary) return change.summary;
  if (change?.field === "discountedPrice") {
    return `финальная цена: было ${competitorPriceText(change.previous)}, стало ${competitorPriceText(change.current)}`;
  }
  if (change?.field === "price") {
    return `цена до скидки: было ${competitorPriceText(change.previous)}, стало ${competitorPriceText(change.current)}`;
  }
  if (change?.field === "title") {
    return `заголовок: было ${textOrDash(change.previous)}, стало ${textOrDash(change.current)}`;
  }
  if (change?.field === "brand") {
    return `бренд: было ${textOrDash(change.previous)}, стало ${textOrDash(change.current)}`;
  }
  if (change?.field === "subjectName") {
    return `категория: было ${textOrDash(change.previous)}, стало ${textOrDash(change.current)}`;
  }
  return `${change?.label || "Поле"}: было ${textOrDash(change?.previous)}, стало ${textOrDash(change?.current)}`;
}

function competitorCharacteristicChangeLines(change) {
  const details = change?.details || {};
  const lines = [];
  (details.changed || []).filter((item) => !competitorIsServiceCharacteristic(item)).slice(0, 3).forEach((item) => {
    lines.push(`${item.name}: было ${item.previous || "пусто"}, стало ${item.current || "пусто"}`);
  });
  (details.added || []).filter((item) => !competitorIsServiceCharacteristic(item)).slice(0, 3).forEach((item) => {
    lines.push(`добавили ${competitorCharacteristicLine(item)}`);
  });
  (details.removed || []).filter((item) => !competitorIsServiceCharacteristic(item)).slice(0, 3).forEach((item) => {
    lines.push(`убрали ${competitorCharacteristicLine(item)}`);
  });
  return lines;
}

function competitorVisibleChanges(changes) {
  return (Array.isArray(changes) ? changes : [])
    .filter((change) => change?.field !== "characteristics" || competitorCharacteristicChangeLines(change).length);
}

function competitorStatusText(status, enabled) {
  if (!enabled) return "Сохранение конкурентов доступно для backend-кабинета.";
  return {
    loading: "Загружаем конкурентов...",
    saving: "Сохраняем список...",
    refreshing: "Проверяем конкурентов...",
    suggesting: "Обновляем цены, текст, характеристики и версии MPStats...",
    saved: "Список сохранен.",
    refreshed: "Данные конкурентов обновлены.",
    suggested: "Карточки конкурентов обновлены.",
    "change-reoptimizing": "Готовим черновик по изменению конкурента...",
    "change-skipping": "Фиксируем пропуск изменения...",
    "change-applied": "Черновик подготовлен, изменение отмечено как примененное.",
    "change-skipped": "Изменение пропущено и сохранено в журнале.",
    "change-error": "Не удалось обработать изменение конкурента. Попробуйте еще раз.",
    invalid: "Вставьте ссылку WB или nmID конкурента.",
    duplicate: "Этот конкурент уже добавлен.",
    limit: `Можно добавить до ${topCompetitorLimit} конкурентов.`,
    empty: "Добавьте конкурентов вручную перед проверкой.",
    error: "Не удалось обновить конкурентов. Попробуйте еще раз.",
  }[status] || "";
}

function competitorReviewStatusText(review) {
  if (!review?.status) return "";
  if (review.status === "skipped") {
    const date = review.skippedAt ? competitorDateText(review.skippedAt) : "";
    return `Изменение пропущено${date ? ` ${date}` : ""}${review.skippedBy ? ` · ${review.skippedBy}` : ""}.`;
  }
  if (review.status === "applied") {
    const date = review.appliedAt ? competitorDateText(review.appliedAt) : "";
    return `Черновик подготовлен${date ? ` ${date}` : ""}${review.appliedBy ? ` · ${review.appliedBy}` : ""}.`;
  }
  if (review.status === "open") {
    const date = review.detectedAt ? competitorDateText(review.detectedAt) : "";
    return `Задача техспецу${review.assigneeLogin ? `: ${review.assigneeLogin}` : ""}${date ? ` · MPStats: ${date}` : ""}.`;
  }
  return "";
}

function auditInsightText({ mainProblems, quickWins, riskNotes, mpstatsMatches, promotionRelevantCount, competitorSelection }) {
  const problems = Array.isArray(mainProblems) ? mainProblems : [];
  const wins = Array.isArray(quickWins) ? quickWins : [];
  const risks = Array.isArray(riskNotes) ? riskNotes : [];
  const competitorCount = Number(competitorSelection?.summary?.finalCount || competitorSelection?.finalCompetitors?.length || 0);
  const parts = [];
  if (problems.length) {
    parts.push(`Главный фокус: ${problems[0]}`);
  } else {
    parts.push("Критичных блокеров по текущему снимку не видно, но карточку все равно стоит сверить по фактам ниже.");
  }
  if (wins.length) {
    parts.push(`Ближайшая правка: ${wins[0]}`);
  }
  if (Number(mpstatsMatches) > 0 || Number(promotionRelevantCount) > 0) {
    parts.push(`MPStats подтвердил ${formatNumber(mpstatsMatches)} совпадений с текущими характеристиками; в фокусе ${formatNumber(promotionRelevantCount)} полей для продвижения.`);
  }
  if (competitorCount > 0) {
    parts.push(`Для сравнения учтено ${competitorCount}/${topCompetitorLimit} конкурентов.`);
  }
  if (risks.length) {
    parts.push(`Вручную проверить: ${risks[0]}`);
  }
  return parts.join(" ");
}

function auditFactRows({ mpstatsGroups, mpstatsMatches, promotionRelevantCount, competitorSelection, riskNotes }) {
  const competitorCount = Number(competitorSelection?.summary?.finalCount || competitorSelection?.finalCompetitors?.length || 0);
  return [
    ["MPStats групп", formatNumber(mpstatsGroups || 0)],
    ["Совпало с карточкой", formatNumber(mpstatsMatches || 0)],
    ["Поля в фокусе", formatNumber(promotionRelevantCount || 0)],
    ["Конкуренты", `${competitorCount}/${topCompetitorLimit}`],
    ["Ручная проверка", formatNumber((riskNotes || []).length)],
  ];
}

function auditCompetitorSourceText(source) {
  return source === "manual" ? "вручную" : "MPStats";
}

function auditEngineLabel(engine) {
  const value = String(engine || "").toLowerCase();
  if (value.includes("gigachat")) return "GigaChat";
  if (value.includes("llm")) return "LLM";
  if (value.includes("deterministic")) return "базовый аудит";
  if (value.includes("basic")) return "локальный fallback";
  return engine || "аудит";
}

function auditCompetitorMetricText(item) {
  const parts = [];
  const displayPrice = Number(item?.discountedPrice) > 0 ? item.discountedPrice : item?.price;
  if (Number(displayPrice) > 0) {
    parts.push(competitorPriceText(displayPrice));
  }
  if (Number(item?.sales) > 0) {
    parts.push(`${formatNumber(item.sales)} продаж`);
  }
  if (Number(item?.revenue) > 0) {
    parts.push(`${formatNumber(Math.round(item.revenue))} ₽`);
  }
  if (Number(item?.similarityScore) > 0) {
    parts.push(`схожесть ${item.similarityScore}`);
  }
  return parts.join(" · ");
}

function competitorVerdict(snapshot, competitor) {
  const comparison = snapshot?.comparison || {};
  const parts = [];
  if (Number.isFinite(Number(comparison.priceDeltaPercent))) {
    const delta = Number(comparison.priceDeltaPercent);
    if (delta <= -7) parts.push(`дешевле нашей карточки на ${Math.abs(delta)}%`);
    else if (delta >= 7) parts.push(`дороже нашей карточки на ${delta}%`);
    else parts.push("в близком ценовом сегменте");
  }
  if (snapshot?.descriptionPreview) parts.push("описание зафиксировано");
  parts.push(`характеристики: ${competitorCharacteristicsComparisonText(comparison)}`);
  if (!parts.length && competitor?.note) {
    parts.push(competitor.note);
  }
  if (!parts.length && Array.isArray(snapshot?.warnings) && snapshot.warnings.length) {
    return "Данных недостаточно для вывода: источник конкурента не отдал метрики.";
  }
  return parts.length ? parts.join(". ") + "." : "Конкурент сохранен: текущие данные зафиксированы для следующего сравнения.";
}

function AuditCompetitorSelection({ selection }) {
  const finalCompetitors = Array.isArray(selection?.finalCompetitors) ? selection.finalCompetitors : [];
  const rejected = Array.isArray(selection?.manualRejected) ? selection.manualRejected : [];
  const accepted = Array.isArray(selection?.manualAccepted) ? selection.manualAccepted : [];
  const autoSkippedReason = selection?.autoSkippedReason || "";
  return (
    <>
      <p>
        {accepted.length ? `${accepted.length} ручн. принято. ` : ""}
        {rejected.length ? `${rejected.length} ручн. отклонено. ` : ""}
        {autoSkippedReason || "Автодобор выключен: используются только конкуренты специалиста."}
      </p>
      {finalCompetitors.length ? (
        <div className="audit-competitor-rows">
          {finalCompetitors.map((item) => {
            const url = item.url || wbCompetitorUrl(item.nmId);
            return (
              <div className="audit-competitor-row" key={`final-${item.nmId}`}>
                <div>
                  <a className="audit-competitor-title" href={url} target="_blank" rel="noreferrer">
                    <strong>{item.title || `WB ${item.nmId}`}</strong>
                    <ExternalLink size={15} />
                  </a>
                  <a className="audit-competitor-meta" href={url} target="_blank" rel="noreferrer">
                    WB {item.nmId} · {auditCompetitorSourceText(item.source)}{item.subjectName ? ` · ${item.subjectName}` : ""}
                  </a>
                  {item.reason ? <p>{item.reason}</p> : null}
                </div>
                <div className="audit-competitor-side">
                  <Tag tone={item.source === "manual" ? "blue" : "green"}>{auditCompetitorSourceText(item.source)}</Tag>
                  <em>{auditCompetitorMetricText(item)}</em>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>Итоговый список конкурентов не собран. Проверьте MPStats и категорию карточки.</p>
      )}
      {rejected.length ? (
        <div className="audit-competitor-rejected">
          <span>Отклонены из ручного ввода</span>
          {rejected.map((item) => {
            const url = item.url || wbCompetitorUrl(item.nmId);
            return (
              <p key={`rejected-${item.nmId}`}>
                <a href={url} target="_blank" rel="noreferrer">WB {item.nmId}</a> · {item.reason || "не прошел проверку схожести"}
              </p>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function TopCompetitorsPanel({
  competitors,
  competitorInput,
  status,
  enabled,
  onInput,
  onAdd,
  onSuggest,
  onRefresh,
  onRemove,
  onReoptimizeChange,
  onSkipChange,
}) {
  const busy = ["loading", "saving", "refreshing", "suggesting", "change-reoptimizing", "change-skipping"].includes(status);
  const criticalCount = competitors.filter((item) => item.hasCriticalChanges).length;
  const lastCheckedAt = competitors
    .map((item) => item.lastCheckedAt || item.snapshot?.checkedAt || "")
    .filter(Boolean)
    .sort();
  const latestCheckedAt = lastCheckedAt.length ? lastCheckedAt[lastCheckedAt.length - 1] : "";
  const statusText = competitorStatusText(status, enabled);
  return (
    <section className="workspace-strip competitors-strip">
      <div className="strip-head">
        <div>
          <h2>ТОП конкурентов</h2>
          <p>Только конкуренты, добавленные специалистом вручную: до {topCompetitorLimit} карточек для сравнения цены, текста, характеристик и изменений по версиям MPStats.</p>
        </div>
        <Tag tone={criticalCount ? "amber" : competitors.length ? "blue" : "green"}>
          {criticalCount ? `${criticalCount} сигнал` : `${competitors.length}/${topCompetitorLimit}`}
        </Tag>
      </div>
      {competitors.length ? (
        <div className="competitor-summary">
          <div><span>В списке</span><strong>{competitors.length}/{topCompetitorLimit}</strong></div>
          <div><span>Вручную</span><strong>{competitors.length}</strong></div>
          <div><span>Последняя проверка</span><strong>{latestCheckedAt ? competitorDateText(latestCheckedAt) : "нет"}</strong></div>
          <div><span>Изменения</span><strong>{criticalCount || "нет"}</strong></div>
        </div>
      ) : null}
      <div className="competitor-toolbar">
        <label className="competitor-input">
          <span>Добавить вручную</span>
          <input
            value={competitorInput}
            onChange={(event) => onInput(event.target.value)}
            disabled={!enabled || busy || competitors.length >= topCompetitorLimit}
            placeholder="https://www.wildberries.ru/catalog/123456789/detail.aspx"
          />
        </label>
        <button className="btn primary" type="button" onClick={onSuggest} disabled={!enabled || busy || !competitors.length}>
          <Search size={17} />{status === "suggesting" ? "Проверяем" : "Проверить карточки"}
        </button>
        <button className="btn" type="button" onClick={onAdd} disabled={!enabled || busy || competitors.length >= topCompetitorLimit}>
          <Plus size={17} />Добавить
        </button>
        <button className="btn" type="button" onClick={onRefresh} disabled={!enabled || busy || !competitors.length}>
          <RefreshCw size={17} />Обновить снимки
        </button>
      </div>
      {statusText ? <div className={`competitor-status status-${status}`}>{statusText}</div> : null}
      {competitors.length ? (
        <div className="competitor-grid">
          {competitors.map((item) => (
            <CompetitorCard
              key={item.competitorNmID}
              competitor={item}
              busy={busy}
              onRemove={onRemove}
              onReoptimizeChange={onReoptimizeChange}
              onSkipChange={onSkipChange}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>ТОП еще не подобран</strong>
          <span>Добавьте до {topCompetitorLimit} WB-конкурентов вручную, затем зафиксируйте цену, текст и характеристики через MPStats.</span>
        </div>
      )}
    </section>
  );
}

function CompetitorCard({ competitor, busy, onRemove, onReoptimizeChange, onSkipChange }) {
  const snapshot = competitor.snapshot || {};
  const changes = Array.isArray(competitor.changes) ? competitor.changes : [];
  const visibleChanges = competitorVisibleChanges(changes);
  const changeReview = competitor.changeReview || {};
  const reviewStatus = changeReview.status || "";
  const reviewStatusText = competitorReviewStatusText(changeReview);
  const canResolveChange = visibleChanges.length && !["skipped", "applied"].includes(reviewStatus);
  const title = snapshot.title || `WB ${competitor.competitorNmID}`;
  const price = snapshot.discountedPrice || snapshot.price;
  const comparison = snapshot.comparison || {};
  const hasPreviousSnapshot = Boolean(competitor.previousSnapshot && Object.keys(competitor.previousSnapshot).length);
  const priceDelta = competitorSignedPercent(comparison.priceDeltaPercent);
  const descriptionDelta = competitorSignedNumber(comparison.descriptionDelta, " зн.");
  const titleOverlap = Number(comparison.titleOverlap);
  const characteristicRows = competitorCharacteristicRows(snapshot.characteristics, 7);
  const comparisonCharacteristics = comparison.characteristics || {};
  const firstDifferentCharacteristic = Array.isArray(comparisonCharacteristics.different) ? comparisonCharacteristics.different[0] : null;
  const firstExtraCharacteristic = Array.isArray(comparisonCharacteristics.onlyCompetitor) ? comparisonCharacteristics.onlyCompetitor[0] : null;
  const verdict = competitorVerdict(snapshot, competitor);
  return (
    <article className={`competitor-card ${competitor.hasCriticalChanges ? "critical" : ""}`}>
      <div className="competitor-card-head">
        <div>
          <strong>{title}</strong>
          <span>WB {competitor.competitorNmID} · {snapshot.subjectName || "категория не указана"} · {competitorDateText(competitor.lastCheckedAt || snapshot.checkedAt)}</span>
        </div>
        <div className="competitor-actions">
          {snapshot.source ? <Tag tone={snapshot.source === "manual" ? "blue" : "green"}>{auditCompetitorSourceText(snapshot.source)}</Tag> : null}
          {competitor.hasCriticalChanges ? <Tag tone="amber"><AlertTriangle size={13} />важно</Tag> : null}
          <a className="icon-link" href={competitor.url || wbCompetitorUrl(competitor.competitorNmID)} target="_blank" rel="noreferrer" title="Открыть WB">
            <ExternalLink size={16} />
          </a>
          <button className="icon-link" type="button" onClick={() => onRemove(competitor)} disabled={busy} title="Удалить конкурента">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="competitor-data-grid">
        <div className="competitor-data-section">
          <span>Как написано сейчас</span>
          <p><strong>Версия</strong><em>{competitorContentVersionText(snapshot)}</em></p>
          <p><strong>Заголовок</strong><em>{title}</em></p>
          <p><strong>Описание</strong><em>{snapshot.descriptionPreview || "нет данных"}</em></p>
          <p><strong>Длина</strong><em>{snapshot.descriptionLength ? `${formatNumber(snapshot.descriptionLength)} зн.${descriptionDelta ? ` · к нашей ${descriptionDelta}` : ""}` : "нет данных"}</em></p>
          <p><strong>Фото</strong><em>{competitorPhotoHistoryText(snapshot)}</em></p>
        </div>
        <div className="competitor-data-section">
          <span>Цена</span>
          <p><strong>Финальная</strong><em>{competitorPriceText(price)}</em></p>
          <p><strong>До скидки</strong><em>{competitorPriceText(snapshot.price)}</em></p>
          <p><strong>К нашей</strong><em>{priceDelta || "нет данных"}</em></p>
          <p><strong>Данные</strong><em>{competitorPriceUpdatedText(snapshot)}</em></p>
        </div>
        <div className="competitor-data-section">
          <span>Характеристики конкурента</span>
          {characteristicRows.length ? (
            <div className="competitor-characteristics-list">
              {characteristicRows.map((item) => (
                <p key={`${item.name}-${item.value}`}><strong>{item.name}</strong><em>{item.value}</em></p>
              ))}
            </div>
          ) : (
            <p><strong>Данные</strong><em>нет данных</em></p>
          )}
        </div>
        <div className="competitor-data-section">
          <span>Сравнение с нашей</span>
          <p><strong>Название</strong><em>{Number.isFinite(titleOverlap) ? `${Math.round(titleOverlap * 100)}% схожести` : "нет данных"}</em></p>
          <p><strong>Характеристики</strong><em>{competitorCharacteristicsComparisonText(comparison)}</em></p>
          {firstDifferentCharacteristic ? (
            <p><strong>{firstDifferentCharacteristic.name}</strong><em>у нас: {firstDifferentCharacteristic.current || "пусто"} · у них: {firstDifferentCharacteristic.competitor || "пусто"}</em></p>
          ) : firstExtraCharacteristic ? (
            <p><strong>{firstExtraCharacteristic.name}</strong><em>есть у конкурента: {firstExtraCharacteristic.value}</em></p>
          ) : null}
        </div>
      </div>
      <div className="competitor-verdict">
        <span>Вывод</span>
        <p>{verdict}</p>
      </div>
      {visibleChanges.length ? (
        <div className="competitor-changes">
          <span>Что изменилось за период</span>
          <p className="competitor-change-period">{competitorPeriodText(competitor.previousSnapshot, snapshot, competitor.lastCheckedAt)}</p>
          {reviewStatusText ? (
            <p className={`competitor-review-status status-${reviewStatus || "open"}`}>
              <strong>Статус изменения</strong>
              <small>{reviewStatusText}</small>
            </p>
          ) : null}
          <p>
            <strong>Вывод за период</strong>
            <small>{competitorMonitoringConclusion(visibleChanges, hasPreviousSnapshot, competitor.previousSnapshot, snapshot)}</small>
          </p>
          {visibleChanges.slice(0, 5).map((change, index) => {
            const characteristicLines = change.field === "characteristics" ? competitorCharacteristicChangeLines(change) : [];
            return (
              <p key={`${change.field}-${index}`}>
                <strong>{change.label}</strong>
                {change.deltaPercent ? <em>{change.deltaPercent > 0 ? "+" : ""}{change.deltaPercent}%</em> : null}
                {change.detectedAt || change.field === "characteristics" ? (
                  <small>{competitorChangeTimingText(change, competitor.previousSnapshot, snapshot, competitor.lastCheckedAt)}</small>
                ) : null}
                <small>{change.field === "characteristics" ? characteristicLines.slice(0, 5).join(" · ") : competitorChangeText(change)}</small>
              </p>
            );
          })}
          {canResolveChange ? (
            <div className="competitor-change-actions">
              <button className="btn primary" type="button" onClick={() => onReoptimizeChange(competitor)} disabled={busy}>
                <WandSparkles size={17} />Переоптимизировать
              </button>
              <button className="btn" type="button" onClick={() => onSkipChange(competitor)} disabled={busy}>
                <X size={17} />Пропустить изменение
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="competitor-changes empty">
          <span>Мониторинг изменений</span>
          <p className="competitor-change-period">{hasPreviousSnapshot ? "За этот период изменений в цене, тексте или характеристиках не найдено." : "Первый снимок сохранен."}</p>
          {reviewStatusText ? (
            <p className={`competitor-review-status status-${reviewStatus || "open"}`}>
              <strong>Последнее решение</strong>
              <small>{reviewStatusText}</small>
            </p>
          ) : null}
          <p>
            <strong>Вывод за период</strong>
            <small>{competitorMonitoringConclusion([], hasPreviousSnapshot, competitor.previousSnapshot, snapshot)}</small>
          </p>
        </div>
      )}
      {Array.isArray(snapshot.warnings) && snapshot.warnings.length ? (
        <div className="competitor-warning">{snapshot.warnings[0]}</div>
      ) : null}
    </article>
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

function changesReadinessActionLabel(section) {
  if (section.approval.status === "approved" || section.approval.status === "exported") {
    return section.downloadLabel;
  }
  if (section.approval.status === "submitted") {
    return "Открыть";
  }
  if (section.approval.status === "changes_requested") {
    return "Доработать";
  }
  return section.changesCount ? "Открыть и отправить" : "Открыть";
}

function changesReadinessStatusText(section) {
  if (section.approval.status === "approved" || section.approval.status === "exported") {
    return "принято, можно выгружать";
  }
  if (section.approval.status === "submitted") {
    return "ждет решения аккаунт-менеджера";
  }
  if (section.approval.status === "changes_requested") {
    return "нужно доработать";
  }
  return section.changesCount ? "готово к согласованию" : "в работе";
}

function ChangesReadinessPanel({ sections, activeSection, summary, onSelect, onDownload }) {
  return (
    <div className="changes-readiness">
      <div className="changes-readiness-head">
        <div>
          <span>Что готово к согласованию</span>
          <strong>{summary}</strong>
        </div>
      </div>
      <div className="changes-readiness-grid">
        {sections.map((section) => {
          const Icon = section.Icon;
          const accepted = section.approval.status === "approved" || section.approval.status === "exported";
          return (
            <article className={`changes-readiness-card ${activeSection === section.key ? "active" : ""}`} key={section.key}>
              <div className="changes-readiness-title">
                <Icon size={18} />
                <strong>{section.label}</strong>
                <Tag tone={approvalStatusTone(section.approval.status)}>{approvalStatusLabel(section.approval.status)}</Tag>
              </div>
              <p>{changesReadinessStatusText(section)}</p>
              <span>{section.detail}</span>
              <div className="changes-readiness-actions">
                <button
                  className={accepted ? "btn primary mini" : "btn mini"}
                  type="button"
                  onClick={() => accepted ? onDownload(section.key) : onSelect(section.key)}
                >
                  {accepted ? <Download size={14} /> : null}{changesReadinessActionLabel(section)}
                </button>
                {!accepted && section.changesCount > 0 ? <em>{section.changesCount} {pluralRu(section.changesCount, "правка", "правки", "правок")}</em> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalPanel({
  approval,
  sectionLabel,
  currentUser,
  team,
  canSubmit,
  canReview,
  readOnly,
  comment,
  onComment,
  onSubmit,
  onApprove,
  onReturn,
  status,
}) {
  const assignee = approval.assigneeLogin || team.manager || "";
  const lastEvent = approval.history?.[0];
  const busy = status === "saving";
  return (
    <section className={`approval-panel approval-${approval.status}`}>
      <div className="approval-panel-head">
        <div>
          <strong>Согласование: {sectionLabel}</strong>
          <p>{approval.status === "submitted"
            ? `Задача у аккаунт-менеджера${assignee ? `: ${assignee}` : ""}.`
            : approval.status === "approved"
              ? "Этот блок принят и готов к выгрузке."
              : approval.status === "changes_requested"
                ? "Этот блок возвращен специалисту на доработку."
                : "Когда блок готов, отправьте его аккаунт-менеджеру на согласование."}</p>
        </div>
        <Tag tone={approvalStatusTone(approval.status)}>{approvalStatusLabel(approval.status)}</Tag>
      </div>
      {approval.returnReason ? (
        <div className="approval-note">
          <span>Причина доработки</span>
          <p>{approval.returnReason}</p>
        </div>
      ) : null}
      {readOnly ? (
        <div className="approval-note">
          <span>Режим просмотра</span>
          <p>{canReview
            ? "Поля заблокированы для правки. Можно принять изменения или вернуть специалисту с причиной."
            : "Поля доступны только для просмотра. Руководитель отдела видит процесс и статистику без ручного изменения карточки."}</p>
        </div>
      ) : null}
      {canReview ? (
        <div className="approval-review">
          <div className="approval-return-field">
            <textarea
              value={comment}
              onChange={(event) => onComment(event.target.value)}
              placeholder="Причина возврата на доработку"
            />
            <span>{status === "approval-reason-required" ? "Чтобы вернуть задачу, нужно указать причину." : "Комментарий обязателен только для возврата на доработку."}</span>
          </div>
          <div className="approval-buttons">
            <button className="btn" type="button" onClick={onReturn} disabled={busy || !comment.trim()}><RotateCcw size={17} />На доработку</button>
            <button className="btn primary" type="button" onClick={onApprove} disabled={busy}><CheckSquare size={17} />Принято</button>
          </div>
        </div>
      ) : null}
      {canSubmit ? (
        <div className="approval-buttons">
            <button className="btn primary" type="button" onClick={onSubmit} disabled={busy}>
              <Upload size={17} />Отправить на согласование
            </button>
        </div>
      ) : null}
      {lastEvent ? (
        <div className="approval-history-line">
          <span>Последнее действие: {approvalEventLabel(lastEvent.action)} · {lastEvent.createdAt ? new Date(lastEvent.createdAt).toLocaleString("ru-RU") : "без даты"} · {lastEvent.userName || lastEvent.userLogin || currentUser?.login}</span>
        </div>
      ) : null}
    </section>
  );
}

function approvalEventLabel(action) {
  return {
    submitted: "отправлено на согласование",
    approved: "принято",
    changes_requested: "возвращено на доработку",
    competitor_change_detected: "найдено изменение конкурента",
    competitor_change_skipped: "изменение конкурента пропущено",
    competitor_change_applied: "черновик обновлен по конкуренту",
  }[action] || "обновлено";
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

function contentSummaryState({ changed, source, reason, emptyText }) {
  if (!reason && !source) {
    return { tone: "green", label: emptyText || "без черновика", reason: "Запустите аудит или внесите ручную правку." };
  }
  if (source === "manual") {
    return { tone: "blue", label: "ручная правка", reason: reason || "Значение изменено специалистом вручную." };
  }
  if (source === "audit") {
    return {
      tone: changed ? "amber" : "green",
      label: changed ? "предложение аудита" : "аудит оставил",
      reason: reason || "Аудит не нашел причины менять значение.",
    };
  }
  if (source === "semantic") {
    return {
      tone: changed ? "amber" : "green",
      label: changed ? "по СЯ" : "СЯ оставило",
      reason: reason || "Контент переоптимизирован по выбранным запросам.",
    };
  }
  return {
    tone: changed ? "amber" : "green",
    label: changed ? "изменено" : "без изменения",
    reason: reason || "Черновик совпадает с текущими данными WB.",
  };
}

function ContentAuditSummary({
  titleChanged,
  titleSource,
  titleReason,
  descriptionChanged,
  descriptionSource,
  descriptionReason,
  changedCharacteristicsCount,
  auditCharacteristicsCount,
  mpstatsStatus,
}) {
  const titleState = contentSummaryState({ changed: titleChanged, source: titleSource, reason: titleReason, emptyText: "нет заголовка" });
  const descriptionState = contentSummaryState({ changed: descriptionChanged, source: descriptionSource, reason: descriptionReason, emptyText: "нет описания" });
  return (
    <div className="content-audit-summary">
      <div className="content-audit-card">
        <div>
          <strong>Заголовок</strong>
          <Tag tone={titleState.tone}>{titleState.label}</Tag>
        </div>
        <p>{titleState.reason}</p>
      </div>
      <div className="content-audit-card">
        <div>
          <strong>Описание</strong>
          <Tag tone={descriptionState.tone}>{descriptionState.label}</Tag>
        </div>
        <p>{descriptionState.reason}</p>
      </div>
      <div className="content-audit-card">
        <div>
          <strong>Характеристики</strong>
          <Tag tone={changedCharacteristicsCount ? "amber" : "green"}>{changedCharacteristicsCount ? `${changedCharacteristicsCount} изменено` : "без изменений"}</Tag>
        </div>
        <p>{auditCharacteristicsCount ? `Аудит подготовил ${auditCharacteristicsCount} ${pluralRu(auditCharacteristicsCount, "поле", "поля", "полей")}. ${mpstatsStatus}.` : "Можно править вручную или добавить поля из справочника WB."}</p>
      </div>
      <div className="content-audit-card">
        <div>
          <strong>Методика</strong>
          <Tag tone="blue">MP Audit</Tag>
        </div>
        <p>Рекомендации строятся только на доступных данных WB, MPStats и карточек конкурентов. Если данных недостаточно, аудит помечает пункт для ручной проверки.</p>
      </div>
    </div>
  );
}

function semanticKeywordMeta(item) {
  const parts = [];
  if (Number(item?.wbCount || 0) > 0) {
    parts.push(`${formatNumber(item.wbCount)} частота WB`);
  }
  if (Number(item?.ozonCount || 0) > 0) {
    parts.push(`${formatNumber(item.ozonCount)} Ozon`);
  }
  if (item?.cluster) {
    parts.push(`кластер: ${item.cluster}`);
  }
  if (item?.prioritySubject) {
    parts.push(item.prioritySubject);
  }
  parts.push(...semanticKeywordRankParts(item));
  if (Number(item?.totalFound || 0) > 0) {
    parts.push(`найдено ${formatNumber(item.totalFound)}`);
  }
  if (item?.status === "selected") {
    parts.push("в работе");
  } else if (item?.field === "title") {
    parts.push("найдено в заголовке");
  } else if (item?.field === "description") {
    parts.push("найдено в описании");
  } else if (item?.field === "title_description") {
    parts.push("заголовок и описание");
  }
  return parts.join(" · ");
}

function semanticFilterWords(value) {
  return String(value || "")
    .split(/[\s,;\n]+/)
    .map((item) => normalizedCharacteristicOption(item))
    .filter(Boolean);
}

function semanticExclusionStem(value) {
  const normalized = normalizedCharacteristicOption(value);
  return normalized.length > 4
    ? normalized.replace(/(ами|ями|ого|его|ыми|ими|ые|ие|ой|ая|яя|ое|ее|ом|ем|ам|ям|ах|ях|у|а|ы|и|е|о)$/u, "")
    : normalized;
}

function semanticMatchesExclusion(query, excludedWords) {
  const normalizedQuery = normalizedCharacteristicOption(query);
  return excludedWords.some((word) => {
    const stem = semanticExclusionStem(word);
    return normalizedQuery.includes(word) || (stem.length >= 4 && normalizedQuery.includes(stem));
  });
}

function SemanticMetric({ active = false, label, value, hint, onClick }) {
  return (
    <button
      className={`semantic-metric ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={`${label}: ${value}. ${hint}`}
    >
      <span className="semantic-metric-label">
        {label}
        <HelpCircle size={13} aria-hidden="true" />
      </span>
      <strong>{value}</strong>
    </button>
  );
}

function SemanticCorePanel({ semanticCore, compact = false, standalone = false, subjectFilter = "", search = "", excludeWords = "", onTakeKeyword = null, onRemoveKeyword = null }) {
  const current = Array.isArray(semanticCore?.current) ? semanticCore.current : [];
  const recommended = Array.isArray(semanticCore?.recommended) ? semanticCore.recommended : [];
  const missing = Array.isArray(semanticCore?.missing) ? semanticCore.missing : [];
  const allKeywords = Array.isArray(semanticCore?.allKeywords) ? semanticCore.allKeywords : [];
  const rankedKeywords = Array.isArray(semanticCore?.rankedKeywords) ? semanticCore.rankedKeywords : [];
  const selectedItems = current.filter((item) => item.status === "selected");
  const currentItems = current.filter((item) => item.status !== "selected");
  const rankedCurrentItems = currentItems.filter(semanticHasKeywordRank);
  const rankedCurrentCount = rankedCurrentItems.length;
  const workItems = recommended.length ? recommended : missing;
  const coverage = semanticCore?.coveragePercent;
  const selectedLimit = compact ? 4 : standalone ? 500 : 8;
  const currentLimit = compact ? 4 : standalone ? 120 : 8;
  const workLimit = compact ? 4 : standalone ? 250 : 8;
  const workPageSize = standalone ? 250 : workLimit;
  const [visibleWorkLimit, setVisibleWorkLimit] = useState(workLimit);
  const [metricFilter, setMetricFilter] = useState("all");
  const searchText = String(search || "").trim().toLowerCase();
  const excludedWords = semanticFilterWords(excludeWords);
  const selectedKeys = new Set(selectedItems.map(semanticQueryKey));
  const sourceItems = allKeywords.length ? allKeywords : workItems;
  const allRankedItems = rankedKeywords.length ? rankedKeywords : sourceItems.filter(semanticHasKeywordRank);
  const reportTotal = semanticCore?.totalKeywords || sourceItems.length || current.length + missing.length;
  const filteredSourceItems = sourceItems
    .filter((item) => !subjectFilter || item.prioritySubject === subjectFilter)
    .filter((item) => !semanticMatchesExclusion(item.query, excludedWords))
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredAllRankedItems = allRankedItems
    .filter((item) => !semanticMatchesExclusion(item.query, excludedWords))
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredWorkItems = filteredSourceItems
    .filter((item) => !selectedKeys.has(semanticQueryKey(item)));
  useEffect(() => {
    setVisibleWorkLimit(workLimit);
  }, [workLimit, subjectFilter, searchText, excludeWords, semanticCore?.seedQuery, reportTotal]);
  useEffect(() => {
    setMetricFilter("all");
  }, [semanticCore?.seedQuery, reportTotal]);
  const visibleWorkCount = Math.min(visibleWorkLimit, filteredWorkItems.length);
  const toggleMetricFilter = (filter) => {
    setMetricFilter((currentFilter) => (currentFilter === filter ? "all" : filter));
  };
  const displayedSelectedItems = metricFilter === "selected" || metricFilter === "all" ? selectedItems : [];
  const displayedCurrentItems = metricFilter === "allRanked"
    ? filteredAllRankedItems
    : metricFilter === "ranked"
    ? rankedCurrentItems
    : metricFilter === "current" || metricFilter === "all"
      ? currentItems
      : [];
  const leftListTitle = metricFilter === "allRanked"
    ? "Все запросы с позициями MPStats"
    : metricFilter === "ranked"
    ? "Действующие с позициями"
    : metricFilter === "current"
      ? "Действующие ключи"
      : metricFilter === "selected"
        ? "Добавленные в работу"
        : "Выбранные и добавленные";
  const showWorkColumn = metricFilter === "all";
  return (
    <div className={`issue semantic-core-panel ${compact ? "compact" : ""} ${standalone ? "standalone" : ""}`}>
      <div className="issue-head">
        <strong>Семантическое ядро</strong>
        <Tag tone={filteredWorkItems.length ? "amber" : "green"}>{coverage === null || coverage === undefined ? "MPStats" : `${coverage}% покрытие`}</Tag>
      </div>
      <p>{semanticCore?.reason || "MPStats анализирует текущий заголовок и описание по поисковым запросам карточки."}</p>
      {standalone ? (
        <div className="semantic-core-metrics">
          <SemanticMetric
            active={metricFilter === "current"}
            label="Действующие"
            value={formatNumber(currentItems.length)}
            hint="Запросы из SEO-отчета MPStats, все значимые слова которых уже есть в текущем названии или описании карточки."
            onClick={() => toggleMetricFilter("current")}
          />
          <SemanticMetric
            active={metricFilter === "ranked"}
            label="Действ. с позициями"
            value={formatNumber(rankedCurrentCount)}
            hint="Часть действующих запросов, для которых MPStats дополнительно отдал позицию карточки: органическую, среднюю или рекламную."
            onClick={() => toggleMetricFilter("ranked")}
          />
          <SemanticMetric
            active={metricFilter === "allRanked"}
            label="Все позиции MPStats"
            value={formatNumber(filteredAllRankedItems.length)}
            hint="Все запросы с позициями из отдельного отчета MPStats по карточке, независимо от того, есть эти слова в текущем контенте или нет."
            onClick={() => toggleMetricFilter("allRanked")}
          />
          <SemanticMetric
            active={metricFilter === "selected"}
            label="Добавленные"
            value={formatNumber(selectedItems.length)}
            hint="Запросы, которые сотрудник уже добавил в рабочий набор для будущей оптимизации контента."
            onClick={() => toggleMetricFilter("selected")}
          />
          <SemanticMetric
            label="По фильтрам"
            value={formatNumber(filteredSourceItems.length)}
            hint="Сколько запросов осталось после выбранного предмета, поиска по строке и слов-исключений."
            onClick={() => setMetricFilter("all")}
          />
          <SemanticMetric
            label="Отчет MPStats"
            value={formatNumber(reportTotal)}
            hint="Общий размер SEO-отчета MPStats по стартовой фразе до фильтров и ручного отбора."
            onClick={() => setMetricFilter("all")}
          />
        </div>
      ) : null}
      <div className={`semantic-core-grid ${showWorkColumn ? "" : "single"}`}>
        <div>
          <span>{leftListTitle}</span>
          <div className="semantic-keyword-list">
            {displayedSelectedItems.length ? displayedSelectedItems.slice(0, selectedLimit).map((item) => (
              <div className="semantic-keyword selected" key={`selected-${item.query}`}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{semanticKeywordMeta(item) || "взято в работу"}</em>
                  {semanticHasKeywordRank(item) ? <span className="semantic-keyword-rank">{semanticKeywordRankLabel(item)}</span> : null}
                </div>
                {standalone && onRemoveKeyword ? (
                  <button className="btn mini" type="button" onClick={() => onRemoveKeyword(item)}>
                    <X size={14} />Убрать
                  </button>
                ) : null}
              </div>
            )) : null}
            {displayedSelectedItems.length > selectedLimit ? <p>Показано {formatNumber(selectedLimit)} из {formatNumber(displayedSelectedItems.length)} выбранных. Полный список попадет в Excel.</p> : null}
            {displayedCurrentItems.length ? displayedCurrentItems.slice(0, currentLimit).map((item) => (
              <div className="semantic-keyword" key={`current-${item.query}`}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{semanticKeywordMeta(item) || (metricFilter === "allRanked" ? "позиция MPStats" : "найдено в текущем контенте")}</em>
                  {standalone ? (
                    <span className={`semantic-keyword-rank ${semanticHasKeywordRank(item) ? "" : "muted"}`}>
                      {semanticKeywordRankLabel(item)}
                    </span>
                  ) : null}
                </div>
              </div>
            )) : null}
            {displayedCurrentItems.length > currentLimit ? <p>Показано {formatNumber(currentLimit)} из {formatNumber(displayedCurrentItems.length)} {metricFilter === "allRanked" ? "запросов с позициями" : "действующих"}. Полный список попадет в Excel.</p> : null}
            {!displayedSelectedItems.length && !displayedCurrentItems.length ? <p>{metricFilter === "allRanked" ? "Запросов MPStats с позициями нет." : metricFilter === "ranked" ? "Действующих ключей с позициями нет." : "Пока нет выбранных запросов."}</p> : null}
          </div>
        </div>
        {showWorkColumn ? (
        <div>
          <span>Найденные запросы MPStats · к добавлению {formatNumber(filteredWorkItems.length)}</span>
          <div className="semantic-keyword-list">
            {filteredWorkItems.slice(0, visibleWorkLimit).map((item) => (
              <div className="semantic-keyword recommended" key={`recommended-${item.query}`}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{semanticKeywordMeta(item) || item.reason || "нет в текущем контенте"}</em>
                </div>
                <div className="semantic-keyword-actions">
                  {item.priority ? <Tag tone={item.priority === "high" ? "amber" : "blue"}>{item.priority === "high" ? "высокий" : item.priority === "medium" ? "средний" : "низкий"}</Tag> : null}
                  {standalone && onTakeKeyword ? (
                    <button className="btn mini" type="button" onClick={() => onTakeKeyword(item)}>
                      <Plus size={14} />В работу
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {filteredWorkItems.length > visibleWorkLimit ? (
              <div className="semantic-list-footer">
                <p>Показано {formatNumber(visibleWorkCount)} из {formatNumber(filteredWorkItems.length)}. Можно раскрыть список или сузить его поиском.</p>
                {standalone ? (
                  <div>
                    <button className="btn mini" type="button" onClick={() => setVisibleWorkLimit((value) => Math.min(value + workPageSize, filteredWorkItems.length))}>
                      Показать еще {formatNumber(Math.min(workPageSize, filteredWorkItems.length - visibleWorkCount))}
                    </button>
                    <button className="btn mini" type="button" onClick={() => setVisibleWorkLimit(filteredWorkItems.length)}>
                      Показать все
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!filteredWorkItems.length ? <p>По текущим фильтрам запросы не найдены.</p> : null}
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

function CharacteristicsDiffTable({
  rows,
  drafts,
  availableCharacteristics,
  search,
  status,
  mpstatsCharacteristics,
  valueOptionsByKey,
  onSearch,
  onAdd,
  onRemove,
  onAddValue,
  onRemoveValue,
  readOnly = false,
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
        <span>Текущее</span>
        <span>Черновик</span>
      </div>
      {!visibleRows.length ? <div className="empty-state"><span>Характеристики не заполнены</span></div> : null}
      {visibleRows.map((row) => {
        const draft = drafts[row.key];
        return (
          <div className="characteristics-diff-row" key={row.key}>
            <div className="characteristic-diff-title">
              <div className="characteristic-title-line">
                <strong>{row.label}</strong>
                {characteristicIsPromotionRelevant(row.meta, mpstatsCharacteristics) ? <Tag tone="amber">важно</Tag> : null}
                <DraftSourceMark source={draft?.source || ""} />
              </div>
              {draft?.reason ? <span className="characteristic-reason">{draft.reason}</span> : null}
            </div>
            {row.draftOnly ? <span className="raw-field-value field-empty">Добавлено в черновик</span> : <RawFieldValue value={row.value} />}
            <DraftCharacteristicEditor
              draft={draft}
              row={row}
              meta={row.meta}
              valueOptions={valueOptionsByKey[row.key] || []}
              mpstatsValues={mpstatsValuesForCharacteristic(row.meta, mpstatsCharacteristics)}
              mpstatsStats={mpstatsValueStatsForCharacteristic(row.meta, mpstatsCharacteristics)}
              mpstatsNearbyNames={nearbyMpstatsCharacteristicNames(row.meta, mpstatsCharacteristics)}
              onAddValue={(value) => onAddValue(row, value)}
              onReplaceValue={(value) => onAddValue(row, value, { replace: true })}
              onRemoveValue={(value) => onRemoveValue(row, value)}
              onRemove={() => onRemove(row.key)}
              readOnly={readOnly}
            />
          </div>
        );
      })}
      {!readOnly ? <div className="characteristics-search">
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
      </div> : null}
    </div>
  );
}

function DraftCharacteristicEditor({ draft, row, meta, valueOptions, mpstatsValues = [], mpstatsStats = [], mpstatsNearbyNames = [], onAddValue, onReplaceValue, onRemoveValue, onRemove, readOnly = false }) {
  const [query, setQuery] = useState("");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const isAuditSuggestion = draft?.source === "audit";
  const values = draftCharacteristicValues(draft);
  const limit = characteristicValueLimit(meta);
  const isLimitReached = Boolean(limit && values.length >= limit);
  const canReplaceSingleValue = Boolean(limit === 1 && values.length >= 1);
  const strictValues = characteristicUsesStrictValues(meta);
  const selectedValues = new Set(values.map(normalizedCharacteristicOption));
  const normalizedQuery = normalizedCharacteristicOption(query);
  const customValue = query.trim();
  const availableValues = valueOptions
    .filter((value) => !selectedValues.has(normalizedCharacteristicOption(value)))
    .filter((value) => !normalizedQuery || normalizedCharacteristicOption(value).includes(normalizedQuery));
  const mpstatsStatsByValue = Object.fromEntries(mpstatsStats.map((item) => [normalizedCharacteristicOption(item.value), item]));
  const topMarketValues = mpstatsStats.slice(0, 3).map(mpstatsValueLabel).filter(Boolean);
  const hasKnownOptions = valueOptions.length > 0;
  const canAddCustomValue = Boolean(
    customValue
    && !strictValues
    && (!isLimitReached || canReplaceSingleValue)
    && !selectedValues.has(normalizedCharacteristicOption(customValue))
    && !availableValues.some((value) => normalizedCharacteristicOption(value) === normalizedCharacteristicOption(customValue))
  );

  function addValue(value) {
    if (readOnly) {
      return;
    }
    if (isLimitReached) {
      if (canReplaceSingleValue) {
        onReplaceValue(value);
        setQuery("");
        setIsOptionsOpen(false);
      }
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
          <button className="draft-chip" type="button" key={value} onClick={() => readOnly ? undefined : onRemoveValue(value)} disabled={readOnly} title={readOnly ? "Просмотр значения" : "Убрать значение"}>
            <span>{value}</span>
            {!readOnly ? <X size={14} /> : null}
          </button>
        ))}
        {!values.length ? <span className="raw-field-value field-empty">Пусто в черновике</span> : null}
        {row.draftOnly && !readOnly ? (
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
          disabled={readOnly || (isLimitReached && !canReplaceSingleValue)}
          placeholder={readOnly ? "Только просмотр" : (isLimitReached ? "Выбрать замену" : (strictValues ? "Выбрать из списка WB" : "Подсказки или свое значение"))}
        />
      </label>
      {isOptionsOpen && !readOnly ? (
        <div className="draft-value-options">
          {!strictValues && hasKnownOptions ? (
            <span className="draft-option-source">
              {mpstatsValues.length ? `Подсказки из карточек + MPStats (${mpstatsValues.length})` : "Ниже не полный список WB, а подсказки из карточек"}
            </span>
          ) : null}
          {isLimitReached && canReplaceSingleValue ? <span className="field-empty">Лимит 1/1: выбранный вариант заменит текущее значение</span> : null}
          {isLimitReached && !canReplaceSingleValue ? <span className="field-empty">Сначала удалите одно значение</span> : null}
          {canAddCustomValue ? (
            <button className="characteristic-option custom-option" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addValue(customValue)}>
              <Plus size={14} />
              <span>{canReplaceSingleValue ? "Заменить на свое" : "Добавить свое"}: {customValue}</span>
            </button>
          ) : null}
          {(!isLimitReached || canReplaceSingleValue) && availableValues.length ? availableValues.map((value) => (
            <button className="characteristic-option" type="button" key={value} onMouseDown={(event) => event.preventDefault()} onClick={() => addValue(value)}>
              <span>{value}</span>
              {formatMarketShare(mpstatsStatsByValue[normalizedCharacteristicOption(value)]?.share) ? (
                <small>топ {formatMarketShare(mpstatsStatsByValue[normalizedCharacteristicOption(value)]?.share)}</small>
              ) : null}
              {canReplaceSingleValue ? <small>замена</small> : null}
            </button>
          )) : null}
          {(!isLimitReached || canReplaceSingleValue) && !availableValues.length && !canAddCustomValue ? <span className="field-empty">{strictValues ? "Можно выбрать только из списка WB" : "Введите свое значение"}</span> : null}
        </div>
      ) : null}
      <div className="draft-editor-meta" title={characteristicValueMetaTitle(meta, hasKnownOptions, values.length, isAuditSuggestion, Boolean(draft), mpstatsValues.length)}>
        <span>{characteristicLimitText(meta, values.length)}</span>
        <span>{characteristicValueSourceText(meta, hasKnownOptions)}</span>
        {mpstatsValues.length ? <span className="draft-editor-mpstats">MPStats {mpstatsValues.length}</span> : null}
        {!mpstatsValues.length && mpstatsNearbyNames.length ? <span className="draft-editor-nearby" title={`Похожие поля MPStats: ${mpstatsNearbyNames.join(", ")}`}>MPStats рядом</span> : null}
        {isAuditSuggestion ? <Tag tone="blue">аудит</Tag> : null}
      </div>
      {topMarketValues.length ? <p className="market-compare">Топ категории: {topMarketValues.join(", ")}</p> : null}
    </div>
  );
}

function DraftReason({ reason, compact = false }) {
  if (!reason) {
    return null;
  }
  return <p className={`draft-reason ${compact ? "compact" : ""}`}>{reason}</p>;
}

function DraftSourceMark({ source }) {
  if (source === "audit") {
    return <Tag tone="blue">рекомендация аудита</Tag>;
  }
  if (source === "semantic") {
    return <Tag tone="blue">переоптимизация СЯ</Tag>;
  }
  if (source === "competitor") {
    return <Tag tone="blue">по изменению конкурента</Tag>;
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

function PortalModal({ mode, users, targetPortal = null, onMode, onClose, onSubmit }) {
  const isReplacement = Boolean(targetPortal);
  const [form, setForm] = useState({
    name: "",
    marketplace: "",
    scope: "",
    lead: "",
    tech: "",
    manager: "",
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
    if (errorObject.message === "store_url_too_long") return "Ссылка или ориентир по магазину слишком длинные. Оставьте ссылку на магазин или первую карточку.";
    if (errorObject.message === "manual_source_too_long") return "Описание первичного источника слишком длинное. Оставьте кратко: таблица, список nmID или комментарий от клиента.";
    if (errorObject.message === "secret_storage_unavailable") return "На backend не настроен ключ шифрования.";
    if (errorObject.status === 401) return "Сессия истекла. Войдите заново.";
    return isReplacement ? "Не удалось заменить WB API ключ. Проверьте ключ и попробуйте еще раз." : "Не удалось добавить кабинет. Проверьте данные и попробуйте еще раз.";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if ((isReplacement || mode === "api") && !form.apiKey.trim()) {
      setError("Введите WB API ключ.");
      return;
    }
    if (!isReplacement && !form.marketplace) {
      setError("Выберите маркетплейс.");
      return;
    }
    if (!isReplacement && !form.scope) {
      setError("Выберите охват кабинета.");
      return;
    }
    if (!isReplacement && (!form.lead || !form.tech || !form.manager)) {
      setError("Выберите руководителя отдела, технического специалиста и аккаунт-менеджера.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        name: mode === "api" || isReplacement ? "" : form.name.trim(),
        marketplace: form.marketplace,
        mode: isReplacement ? "api" : mode,
        scope: form.scope,
        teamRoles: { lead: form.lead, tech: form.tech, manager: form.manager },
        apiKey: mode === "api" || isReplacement ? form.apiKey.trim() : "",
        storeUrl: !isReplacement && mode === "manual" ? form.storeUrl.trim() : "",
        manualSource: !isReplacement && mode === "manual" ? form.manualSource.trim() : "",
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
            <h2>{isReplacement ? "Заменить WB API ключ" : "Добавить кабинет"}</h2>
            <p>{isReplacement
              ? `Ключ будет заменен только в кабинете ${targetPortal?.name || "Wildberries"}, после проверки read-only запросом WB.`
              : (mode === "api"
                ? "API-ключ отправляется только на backend, проверяется read-only запросом WB и не хранится в браузере."
                : "Создаем рабочий кабинет без ключа WB: команда, ссылка на магазин и первичный источник сохраняются в OptiCards.")}</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          {!isReplacement ? <div className="connect-mode">
            <button className={mode === "api" ? "active" : ""} type="button" onClick={() => onMode("api")}>
              <strong>WB API</strong>
              <span>Определить кабинет и загрузить карточки.</span>
            </button>
            <button className={mode === "manual" ? "active" : ""} type="button" onClick={() => onMode("manual")}>
              <strong>Без API</strong>
              <span>Завести магазин по ссылке, таблице или списку карточек.</span>
            </button>
          </div> : null}
          {!isReplacement && mode === "manual" ? (
            <label className="field-label">
              Название кабинета
              <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
            </label>
          ) : null}
          {!isReplacement ? <div className="form-two">
            <label className="field-label">
              Маркетплейс
              <select className="select" value={form.marketplace} onChange={(event) => update("marketplace", event.target.value)} required>
                <option value="" disabled>Выберите маркетплейс</option>
                <option value="Wildberries">Wildberries</option>
              </select>
            </label>
            <label className="field-label">
              Охват
              <select className="select" value={form.scope} onChange={(event) => update("scope", event.target.value)} required>
                <option value="" disabled>Выберите охват</option>
                <option value="full">Полный магазин</option>
                <option value="selected">Выбранные карточки</option>
              </select>
            </label>
          </div> : null}
          {!isReplacement ? <div className="form-two">
            <UserSelect label="Руководитель отдела" value={form.lead} users={users} onChange={(value) => update("lead", value)} />
            <UserSelect label="Технический специалист" value={form.tech} users={users} onChange={(value) => update("tech", value)} />
          </div> : null}
          {!isReplacement ? <UserSelect label="Аккаунт-менеджер" value={form.manager} users={users} onChange={(value) => update("manager", value)} /> : null}
          {mode === "api" || isReplacement ? (
            <label className="field-label">
              WB API ключ
              <input type="password" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" />
            </label>
          ) : (
            <>
              <label className="field-label">
                Ссылка на магазин или первую карточку
                <input value={form.storeUrl} onChange={(event) => update("storeUrl", event.target.value)} placeholder="https://www.wildberries.ru/brands/... или ссылка на карточку" />
              </label>
              <label className="field-label">
                Что есть на старте
                <textarea value={form.manualSource} onChange={(event) => update("manualSource", event.target.value)} placeholder="Например: клиент прислал Excel, список nmID, ссылку на магазин или 3 карточки для ручного старта." />
              </label>
            </>
          )}
          {error ? <div className="form-error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>Отмена</button>
          <button className="btn primary" type="submit" disabled={loading}>{loading ? (mode === "manual" && !isReplacement ? "Создаем..." : "Проверяем...") : (isReplacement ? "Заменить ключ" : (mode === "manual" ? "Создать без API" : "Добавить кабинет"))}</button>
        </div>
      </form>
    </div>
  );
}

function UserSelect({ label, value, users, onChange }) {
  return (
    <label className="field-label">
      {label}
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="" disabled>Выберите сотрудника</option>
        {users.map((user) => <option value={user.login} key={user.login}>{user.full_name}</option>)}
      </select>
    </label>
  );
}

function mpstatsIntegrationStatusText(integration) {
  const connected = Boolean(integration?.connected);
  return {
    verified: "подключен и проверен",
    stored: "ключ сохранен",
    auth_error: "ошибка авторизации",
    rate_limited: "лимит MPStats",
    error: "ошибка проверки",
    missing: "не подключен",
  }[integration?.status] || (connected ? "ключ сохранен" : "не подключен");
}

function sourceFlowRows(portal, mpstatsIntegration = null) {
  if (portal.mode === "api") {
    const tokenDays = tokenDaysLeftText(portal.tokenMeta);
    const tokenStatus = portal.apiConnected ? `готово${tokenDays ? `, ${tokenDays}` : ""}` : "ожидает подключения";
    return [
      ["Проверка WB API ключа", tokenStatus],
      ["Карточки из кабинета", portal.apiConnected ? formatNumber(portal.cardCount) : "после подключения"],
      ["MPStats", mpstatsIntegrationStatusText(mpstatsIntegration)],
      ["Режим WB API", portal.wbWriteEnabled ? "чтение + запись" : "чтение сейчас · запись отдельно"],
    ];
  }
  return [
    ["Режим запуска", "без API"],
    ["Ссылка или ориентир", portal.storeUrl ? "сохранено" : "не указано"],
    ["Первичный источник", portal.manualSource ? "описан" : "нужно добавить"],
    ["Карточки MPStats", portal.cardCount ? formatNumber(portal.cardCount) : "ожидают загрузку"],
    ["MPStats", mpstatsIntegrationStatusText(mpstatsIntegration)],
  ];
}

function ManualPortalSource({ portal }) {
  const storeUrl = String(portal.storeUrl || "").trim();
  const manualSource = String(portal.manualSource || "").trim();
  const safeUrl = safeHttpsUrl(storeUrl);
  return (
    <div className="manual-source-box">
      <div className="manual-source-row">
        <span>Ссылка или ориентир</span>
        {storeUrl ? (
          safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">{storeUrl}</a> : <strong>{storeUrl}</strong>
        ) : <strong>не указано</strong>}
      </div>
      <div className="manual-source-row">
        <span>Исходные данные</span>
        <p>{manualSource || "Пока не описаны"}</p>
      </div>
    </div>
  );
}

function workRouteRows(portal) {
  const hasCards = Number(portal.cardCount || 0) > 0 || Boolean(portal.realCards?.length);
  const draftCount = Number(portal.draftSummary?.draftCount || 0);
  const auditCount = Number(portal.draftSummary?.auditCount || 0);
  const approvalPendingCount = Number(portal.draftSummary?.approvalPendingCount || 0);
  const approvalReturnedCount = Number(portal.draftSummary?.approvalReturnedCount || 0);
  const approvalApprovedCount = Number(portal.draftSummary?.approvalApprovedCount || 0);
  const hasAudit = auditCount > 0;
  const hasDrafts = draftCount > 0;
  const hasApproval = approvalPendingCount > 0 || approvalReturnedCount > 0 || approvalApprovedCount > 0;
  const rows = [
    { title: "Загрузка", status: hasCards ? "данные получены" : "ожидает загрузку", className: hasCards ? "active" : "paused" },
    {
      title: "Аудит",
      status: hasAudit
        ? `${auditCount} ${pluralRu(auditCount, "аудит", "аудита", "аудитов")}`
        : (hasCards ? "по карточкам не запускался" : "ожидает карточки"),
      className: hasAudit ? "active" : "paused",
    },
    {
      title: "Правки",
      status: hasDrafts
        ? `${draftCount} ${pluralRu(draftCount, "черновик", "черновика", "черновиков")}`
        : "0 черновиков",
      className: hasDrafts ? "active" : "off",
    },
    {
      title: "Согласование",
      status: approvalPendingCount
        ? `${approvalPendingCount} ${pluralRu(approvalPendingCount, "задача", "задачи", "задач")}`
        : approvalReturnedCount
          ? `${approvalReturnedCount} на доработке`
          : approvalApprovedCount
            ? `${approvalApprovedCount} принято`
            : "нет задач",
      className: hasApproval ? "active" : "off",
    },
    {
      title: "Конкуренты",
      status: hasCards ? "мониторинг раз в 7 дней" : "после загрузки карточек",
      className: hasCards ? "active" : "paused",
    },
  ];
  const done = rows.filter((step) => step.className === "active").length;
  return {
    rows,
    done,
    copy: hasApproval
      ? `Данные WB загружены. В согласовании: ${approvalPendingCount}, на доработке: ${approvalReturnedCount}, принято: ${approvalApprovedCount}.`
      : hasDrafts
        ? `Данные WB загружены. Найдено ${draftCount} ${pluralRu(draftCount, "черновик правок", "черновика правок", "черновиков правок")}${hasAudit ? ` и ${auditCount} ${pluralRu(auditCount, "аудит", "аудита", "аудитов")}` : ""}.`
      : hasCards
        ? "Данные WB загружены. Аудит, черновики и мониторинг конкурентов появятся здесь после начала работы."
        : "Сначала нужен источник данных: WB API или ручной импорт. Остальные этапы пока не активны.",
  };
}

function Metric({ label, value, hint = "" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
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
  return (
    <div className={`thumb ${alt ? "alt" : ""} ${photoUrl ? "has-image" : ""}`}>
      {photoUrl ? <img src={photoUrl} alt="" loading="lazy" decoding="async" /> : null}
    </div>
  );
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

function CardRecoveryScreen({ loading, onBack }) {
  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>{loading ? "Загружаем карточку" : "Карточка не найдена"}</h1>
          <p>{loading ? "Ждем данные WB API и восстановим детальную карточку автоматически." : "Карточка могла не попасть в текущую загрузку или была удалена в кабинете."}</p>
        </div>
        <button className="btn" type="button" onClick={onBack}>К списку карточек</button>
      </header>
      <div className="content">
        <section className="workspace-strip">
          <div className="empty-state">
            <strong>{loading ? "Идет загрузка" : "Нет данных карточки"}</strong>
            <span>{loading ? "Обычно это занимает несколько секунд после обновления страницы." : "Вернитесь к списку и откройте карточку заново."}</span>
          </div>
        </section>
      </div>
    </section>
  );
}

const defaultNewUserForm = {
  login: "",
  fullName: "",
  profile: "account",
  role: "",
  userRole: "manager",
  accessLevel: "overview",
};

const rolePresets = {
  admin: {
    label: "Администратор",
    role: "Администратор",
    userRole: "admin",
    accessLevel: "all",
  },
  lead: {
    label: "Руководитель",
    role: "Руководитель отдела",
    userRole: "manager",
    accessLevel: "all",
  },
  account: {
    label: "Аккаунт-менеджер",
    role: "Аккаунт-менеджер",
    userRole: "manager",
    accessLevel: "overview",
  },
  tech: {
    label: "Техспец",
    role: "Технический специалист",
    userRole: "tech",
    accessLevel: "readonly_wb",
  },
};

const userRoleLabels = {
  admin: "Администратор",
  manager: "Менеджер",
  tech: "Технический специалист",
};

const accessLevelLabels = {
  all: "Полный доступ",
  overview: "Проекты и обзор",
  readonly_wb: "Карточки WB",
};

const adminEventLabels = {
  user_created: "Создан сотрудник",
  user_updated: "Изменен сотрудник",
  password_reset: "Сброшен пароль",
  portal_team_updated: "Изменены доступы",
  portal_created: "Кабинет создан",
  portal_name_updated: "Переименован кабинет",
  portal_archived: "Кабинет отправлен в архив",
  portal_restored: "Кабинет восстановлен",
  wb_token_replaced: "Заменен WB API ключ",
  service_integration_saved: "Сохранена интеграция",
};

function activeDirectoryUsers(users) {
  return users.filter((user) => user.isActive !== false);
}

function userProfileKey(user) {
  if (user.user_role === "admin") return "admin";
  if (user.user_role === "tech") return "tech";
  if (user.access_level === "all") return "lead";
  return "account";
}

function applyRolePresetToUserPayload(profileKey) {
  const preset = rolePresets[profileKey] || rolePresets.account;
  return {
    profile: profileKey,
    role: preset.role,
    userRole: preset.userRole,
    accessLevel: preset.accessLevel,
  };
}

function adminEventTitle(event) {
  return adminEventLabels[event?.action] || event?.action || "Событие";
}

function adminEventDetailsText(event) {
  const details = event?.details || {};
  if (event?.action === "user_updated" || event?.action === "user_created") {
    const profile = userRoleLabels[details.userRole] || details.userRole || "";
    const access = accessLevelLabels[details.accessLevel] || details.accessLevel || "";
    return [details.fullName, details.role, profile, access].filter(Boolean).join(" · ");
  }
  if (event?.action === "portal_team_updated") {
    return details.portalName || event.targetId || "Кабинет";
  }
  if (event?.action === "portal_created") {
    return [details.portalName || event.targetId || "Кабинет", details.mode === "api" ? "WB API" : "ручной режим"].filter(Boolean).join(" · ");
  }
  if (event?.action === "portal_name_updated") {
    return `${details.oldName || "Без названия"} -> ${details.newName || "Без названия"}`;
  }
  if (event?.action === "wb_token_replaced") {
    return [details.portalName, details.tokenExpiresAt ? `до ${details.tokenExpiresAt}` : ""].filter(Boolean).join(" · ");
  }
  if (event?.action === "service_integration_saved") {
    return [details.provider, details.status].filter(Boolean).join(" · ");
  }
  return details.portalName || event?.targetId || "";
}

function userDraftFromAccount(user) {
  return {
    fullName: user.full_name || "",
    role: user.role || "",
    profile: userProfileKey(user),
    userRole: user.user_role || "manager",
    accessLevel: user.access_level || "overview",
    isActive: user.isActive !== false,
  };
}

function userDraftPayload(draft) {
  const preset = applyRolePresetToUserPayload(draft.profile);
  return {
    fullName: draft.fullName,
    role: draft.role,
    userRole: preset.userRole,
    accessLevel: preset.accessLevel,
    isActive: draft.isActive,
  };
}

function adminUserSearchText(user) {
  return [
    user.login,
    user.full_name,
    user.role,
    userRoleLabels[user.user_role] || user.user_role,
    accessLevelLabels[user.access_level] || user.access_level,
  ].filter(Boolean).join(" ").toLowerCase();
}

function AdminUserRow({ user, canManageUsers, saving, resetting, onSave, onResetPassword }) {
  const [draft, setDraft] = useState(() => userDraftFromAccount(user));

  useEffect(() => {
    setDraft(userDraftFromAccount(user));
  }, [user.login, user.full_name, user.role, user.user_role, user.access_level, user.isActive]);

  const savedDraft = userDraftFromAccount(user);
  const isDirty = JSON.stringify(userDraftPayload(draft)) !== JSON.stringify(userDraftPayload(savedDraft));
  const disabled = !canManageUsers || saving;

  function updateDraft(name, value) {
    if (name === "profile") {
      setDraft((current) => ({ ...current, profile: value }));
      return;
    }
    setDraft((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className={`admin-user-row ${draft.isActive ? "" : "inactive"}`}>
      <div className="admin-user-main">
        <strong>{user.login}</strong>
        <span>{draft.isActive ? "активен" : "отключен"}</span>
      </div>
      <label className="field-label compact">
        ФИО
        <input
          value={draft.fullName}
          disabled={disabled}
          onChange={(event) => updateDraft("fullName", event.target.value)}
        />
      </label>
      <label className="field-label compact">
        Должность
        <input
          value={draft.role}
          disabled={disabled}
          onChange={(event) => updateDraft("role", event.target.value)}
        />
      </label>
      <label className="field-label compact">
        Профиль
        <select
          className="select"
          value={draft.profile}
          disabled={disabled}
          onChange={(event) => updateDraft("profile", event.target.value)}
        >
          {Object.entries(rolePresets).map(([value, preset]) => <option value={value} key={value}>{preset.label}</option>)}
        </select>
      </label>
      <div className="admin-user-access">
        <span>{userRoleLabels[userDraftPayload(draft).userRole] || userDraftPayload(draft).userRole}</span>
        <strong>{accessLevelLabels[userDraftPayload(draft).accessLevel] || userDraftPayload(draft).accessLevel}</strong>
      </div>
      <div className="admin-user-actions">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={draft.isActive}
            disabled={disabled}
            onChange={(event) => updateDraft("isActive", event.target.checked)}
          />
          <span>{draft.isActive ? "Активен" : "Отключен"}</span>
        </label>
        <div className="admin-user-button-row">
          <button
            className="btn mini primary"
            type="button"
            disabled={disabled || !isDirty}
            onClick={() => onSave(user, userDraftPayload(draft))}
          >
            {saving ? "Сохраняем" : "Сохранить"}
          </button>
          <button
            className="btn mini"
            type="button"
            onClick={() => onResetPassword(user.login)}
            disabled={!canManageUsers || resetting || !draft.isActive}
          >
            {resetting ? "Сбрасываем" : "Сброс пароля"}
          </button>
        </div>
        {isDirty ? <span className="admin-unsaved">Есть изменения</span> : null}
      </div>
    </div>
  );
}

function SettingsScreen({ users, portals = [], canManage = false, canManageUsers = false, mpstatsIntegration: initialMpstatsIntegration = null, onMpstatsIntegrationChange, onCreateUser, onUpdateUser, onResetPassword, onUpdatePortalTeam }) {
  const [adminTab, setAdminTab] = useState("users");
  const [mpstatsIntegration, setMpstatsIntegration] = useState(initialMpstatsIntegration);
  const [adminEvents, setAdminEvents] = useState([]);
  const [adminEventsStatus, setAdminEventsStatus] = useState("idle");
  const [adminStatus, setAdminStatus] = useState(null);
  const [mpstatsKey, setMpstatsKey] = useState("");
  const [mpstatsStatus, setMpstatsStatus] = useState("idle");
  const [newUserForm, setNewUserForm] = useState(defaultNewUserForm);
  const [newUserStatus, setNewUserStatus] = useState("idle");
  const [newUserResult, setNewUserResult] = useState(null);
  const [newUserError, setNewUserError] = useState("");
  const [userSaveStatus, setUserSaveStatus] = useState("");
  const [userSaveError, setUserSaveError] = useState("");
  const [passwordResetStatus, setPasswordResetStatus] = useState("");
  const [passwordResetResult, setPasswordResetResult] = useState(null);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [accessSaveStatus, setAccessSaveStatus] = useState("");
  const [accessSaveError, setAccessSaveError] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("active");
  const [userProfileFilter, setUserProfileFilter] = useState("all");

  useEffect(() => {
    let active = true;
    apiRequest("/api/integrations/mpstats")
      .then((payload) => {
        if (active) {
          setMpstatsIntegration(payload.integration || null);
        }
      })
      .catch(() => {
        if (active) {
          setMpstatsStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setMpstatsIntegration(initialMpstatsIntegration);
  }, [initialMpstatsIntegration]);

  useEffect(() => {
    loadAdminEvents();
    loadAdminStatus();
  }, []);

  async function loadAdminEvents() {
    if (!canManage) {
      return;
    }
    setAdminEventsStatus("loading");
    try {
      const payload = await apiRequest("/api/admin-events?limit=80");
      setAdminEvents(payload.events || []);
      setAdminEventsStatus("loaded");
    } catch {
      setAdminEvents([]);
      setAdminEventsStatus("error");
    }
  }

  async function loadAdminStatus() {
    if (!canManage) {
      return;
    }
    try {
      const payload = await apiRequest("/api/admin-status");
      setAdminStatus(payload);
    } catch {
      setAdminStatus(null);
    }
  }

  async function saveMpstatsKey(event) {
    event.preventDefault();
    if (!canManage || !mpstatsKey.trim()) {
      return;
    }
    setMpstatsStatus("saving");
    try {
      const payload = await apiRequest("/api/integrations/mpstats", {
        method: "POST",
        body: JSON.stringify({ apiKey: mpstatsKey.trim() }),
      });
      setMpstatsIntegration(payload.integration || null);
      if (onMpstatsIntegrationChange) {
        onMpstatsIntegrationChange(payload.integration || null);
      }
      setMpstatsKey("");
      setMpstatsStatus(payload.ok ? "saved" : payload.status || "error");
      loadAdminEvents();
    } catch {
      setMpstatsStatus("error");
    }
  }

  async function checkMpstatsConnection() {
    if (!canManage || !mpstatsConnected) {
      return;
    }
    setMpstatsStatus("checking");
    try {
      const payload = await apiRequest("/api/integrations/mpstats", {
        method: "POST",
        body: JSON.stringify({ action: "check" }),
      });
      setMpstatsIntegration(payload.integration || null);
      if (onMpstatsIntegrationChange) {
        onMpstatsIntegrationChange(payload.integration || null);
      }
      setMpstatsStatus(payload.ok ? "verified" : payload.status || "error");
    } catch {
      setMpstatsStatus("error");
    }
  }

  async function createUser(event) {
    event.preventDefault();
    if (!canManageUsers || !onCreateUser) {
      return;
    }
    setNewUserStatus("saving");
    setNewUserError("");
    setNewUserResult(null);
    try {
      const payload = await onCreateUser(newUserForm);
      setNewUserResult(payload);
      setNewUserStatus("created");
      setNewUserForm(defaultNewUserForm);
      loadAdminEvents();
    } catch (error) {
      setNewUserStatus("error");
      if (error.message === "forbidden") {
        setNewUserError("Создавать сотрудников может только руководитель отдела или администратор.");
      } else if (error.message === "weak_password") {
        setNewUserError("Пароль должен быть не короче 12 символов.");
      } else {
        setNewUserError("Не удалось создать сотрудника. Проверьте логин и поля формы.");
      }
    }
  }

  function updateNewUser(name, value) {
    if (name === "profile") {
      setNewUserForm((current) => ({ ...current, ...applyRolePresetToUserPayload(value) }));
      setNewUserResult(null);
      setNewUserError("");
      setNewUserStatus("idle");
      return;
    }
    setNewUserForm((current) => ({ ...current, [name]: value }));
    setNewUserResult(null);
    setNewUserError("");
    setNewUserStatus("idle");
  }

  async function saveExistingUser(user, patch) {
    if (!canManageUsers || !onUpdateUser) {
      return;
    }
    const payload = {
      login: user.login,
      fullName: user.full_name,
      role: user.role,
      userRole: user.user_role,
      accessLevel: user.access_level,
      isActive: user.isActive !== false,
      ...patch,
    };
    setUserSaveStatus(user.login);
    setUserSaveError("");
    setPasswordResetError("");
    try {
      await onUpdateUser(payload);
      setUserSaveStatus("");
      loadAdminEvents();
    } catch (error) {
      setUserSaveStatus("");
      if (error.message === "forbidden") {
        setUserSaveError("Недостаточно прав для изменения этого сотрудника.");
      } else if (error.message === "user_not_found") {
        setUserSaveError("Сотрудник не найден.");
      } else {
        setUserSaveError("Не удалось сохранить изменения сотрудника.");
      }
    }
  }

  async function resetPassword(login) {
    if (!canManageUsers || !onResetPassword) {
      return;
    }
    setPasswordResetStatus(login);
    setPasswordResetResult(null);
    setPasswordResetError("");
    try {
      const payload = await onResetPassword(login);
      setPasswordResetResult(payload);
      setPasswordResetStatus("");
      loadAdminEvents();
    } catch (error) {
      setPasswordResetStatus("");
      if (error.message === "forbidden") {
        setPasswordResetError("Недостаточно прав для сброса пароля этого сотрудника.");
      } else if (error.message === "user_not_found") {
        setPasswordResetError("Сотрудник не найден или отключен.");
      } else {
        setPasswordResetError("Не удалось сбросить пароль. Попробуйте еще раз.");
      }
    }
  }

  async function updatePortalAccess(portal, roleKey, login) {
    if (!canManage || !onUpdatePortalTeam || !portal || portal.isDemo) {
      return;
    }
    const nextTeam = {
      ...getPortalTeam(portal),
      [roleKey]: login,
    };
    setAccessSaveStatus(`${portal.id}:${roleKey}`);
    setAccessSaveError("");
    try {
      await onUpdatePortalTeam(portal, nextTeam);
      setAccessSaveStatus("");
      loadAdminEvents();
    } catch {
      setAccessSaveStatus("");
      setAccessSaveError("Не удалось сохранить доступы по кабинету.");
    }
  }

  const mpstatsConnected = Boolean(mpstatsIntegration?.connected);
  const mpstatsVerified = mpstatsIntegration?.status === "verified";
  const mpstatsUpdatedAt = mpstatsIntegration?.updatedAt
    ? new Date(mpstatsIntegration.updatedAt).toLocaleString("ru-RU")
    : "";
  const mpstatsLastCheckedAt = mpstatsIntegration?.lastCheckedAt
    ? new Date(mpstatsIntegration.lastCheckedAt).toLocaleString("ru-RU")
    : "";
  const mpstatsStatusLabel = {
    verified: "подключение проверено",
    stored: "ключ сохранен",
    auth_error: "ошибка авторизации",
    rate_limited: "лимит MPStats",
    error: "ошибка проверки",
    missing: "не подключен",
  }[mpstatsIntegration?.status] || (mpstatsConnected ? "ключ сохранен" : "не подключен");
  const activeUsers = activeDirectoryUsers(users);
  const managedPortals = portals.filter((portal) => !portal.isDemo);
  const activeUserOptions = activeUsers.length ? activeUsers : users;
  const apiPortals = managedPortals.filter((portal) => portal.apiConnected || portal.mode === "api");
  const wbTokenIssues = apiPortals.filter((portal) => ["expired", "expiring"].includes(portal.tokenMeta?.status));
  const llmStatus = adminStatus?.llm || {};
  const inactiveUsers = users.filter((user) => user.isActive === false);
  const integrationWarnings = wbTokenIssues.length
    + (mpstatsVerified ? 0 : 1)
    + (llmStatus.configured ? 0 : 1)
    + (adminStatus?.storage?.secretKeyConfigured ? 0 : 1);
  const filteredUsers = users.filter((user) => {
    const matchesSearch = !userSearch.trim() || adminUserSearchText(user).includes(userSearch.trim().toLowerCase());
    const matchesStatus = userStatusFilter === "all"
      || (userStatusFilter === "active" && user.isActive !== false)
      || (userStatusFilter === "inactive" && user.isActive === false);
    const matchesProfile = userProfileFilter === "all" || userProfileKey(user) === userProfileFilter;
    return matchesSearch && matchesStatus && matchesProfile;
  });
  const adminTabs = [
    { key: "users", label: "Пользователи" },
    { key: "access", label: "Доступы" },
    { key: "events", label: "Журнал" },
    { key: "integrations", label: "Интеграции" },
  ];

  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <h1>Админка</h1>
          <p>Пользователи, доступы к кабинетам и сервисные интеграции.</p>
        </div>
      </header>
      <div className="content">
        <div className="admin-overview">
          <Metric label="Активных сотрудников" value={formatNumber(activeUsers.length)} hint={`${inactiveUsers.length} отключено`} />
          <Metric label="Кабинетов" value={formatNumber(managedPortals.length)} hint="рабочие кабинеты селлеров" />
          <Metric label="API кабинетов" value={formatNumber(apiPortals.length)} hint={wbTokenIssues.length ? "есть токены с риском" : "критичных предупреждений нет"} />
          <Metric label="Интеграции" value={integrationWarnings ? formatNumber(integrationWarnings) : "OK"} hint={integrationWarnings ? "требуют внимания" : "готовы к работе"} />
        </div>
        <div className="admin-tabs" role="tablist" aria-label="Разделы админки">
          {adminTabs.map((tab) => (
            <button
              className={adminTab === tab.key ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={adminTab === tab.key}
              onClick={() => setAdminTab(tab.key)}
              key={tab.key}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="admin-panel-grid">
          {adminTab === "users" ? (
          <section className="panel">
            <div className="panel-title-row">
              <div>
                <h2>Пользователи</h2>
                <p>Создание аккаунтов, роли, отключение доступа и сброс пароля.</p>
              </div>
              <Tag tone={filteredUsers.length ? "blue" : "amber"}>{filteredUsers.length} из {users.length}</Tag>
            </div>
            <div className="admin-toolbar">
              <div className="search">
                <Search size={16} />
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Поиск по логину, ФИО или роли"
                />
              </div>
              <select className="select" value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value)}>
                <option value="active">Активные</option>
                <option value="all">Все</option>
                <option value="inactive">Отключенные</option>
              </select>
              <select className="select" value={userProfileFilter} onChange={(event) => setUserProfileFilter(event.target.value)}>
                <option value="all">Все профили</option>
                {Object.entries(rolePresets).map(([value, preset]) => <option value={value} key={value}>{preset.label}</option>)}
              </select>
            </div>
            <div className="panel-list">
              {filteredUsers.map((user) => (
                <AdminUserRow
                  user={user}
                  canManageUsers={canManageUsers}
                  saving={userSaveStatus === user.login}
                  resetting={passwordResetStatus === user.login}
                  onSave={saveExistingUser}
                  onResetPassword={resetPassword}
                  key={user.login}
                />
              ))}
              {!filteredUsers.length ? (
                <div className="empty-state">
                  <strong>Сотрудники не найдены</strong>
                  <span>Измените поиск или фильтры, чтобы увидеть список аккаунтов.</span>
                </div>
              ) : null}
            </div>
            {userSaveError ? <div className="form-error">{userSaveError}</div> : null}
            {passwordResetError ? <div className="form-error">{passwordResetError}</div> : null}
            {passwordResetResult?.user ? (
              <div className="created-user-secret">
                <span>Новый пароль</span>
                <strong>Логин: {passwordResetResult.user.login}</strong>
                <strong>Пароль: {passwordResetResult.password}</strong>
                <em>Сохраните пароль сейчас. Повторно он не показывается.</em>
              </div>
            ) : null}
            <form className="integration-form user-create-form" onSubmit={createUser}>
              <div>
                <strong>Добавить сотрудника</strong>
                <p>Создание доступно руководителю отдела и администратору. Пароль показывается один раз после сохранения.</p>
              </div>
              <div className="form-two">
                <label className="field-label">
                  Логин
                  <input
                    value={newUserForm.login}
                    onChange={(event) => updateNewUser("login", event.target.value)}
                    disabled={!canManageUsers}
                    autoComplete="off"
                    placeholder="ivan.manager"
                    required
                  />
                </label>
                <label className="field-label">
                  ФИО
                  <input
                    value={newUserForm.fullName}
                    onChange={(event) => updateNewUser("fullName", event.target.value)}
                    disabled={!canManageUsers}
                    autoComplete="off"
                    placeholder="Имя Фамилия"
                    required
                  />
                </label>
              </div>
              <div className="form-two">
                <label className="field-label">
                  Профиль
                  <select
                    className="select"
                    value={newUserForm.profile}
                    onChange={(event) => updateNewUser("profile", event.target.value)}
                    disabled={!canManageUsers}
                  >
                    {Object.entries(rolePresets).map(([value, preset]) => <option value={value} key={value}>{preset.label}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  Должность
                  <input
                    value={newUserForm.role}
                    onChange={(event) => updateNewUser("role", event.target.value)}
                    disabled={!canManageUsers}
                    autoComplete="off"
                    placeholder="Например: Аккаунт-менеджер"
                    required
                  />
                </label>
              </div>
              <div className="panel-actions">
                <button className="btn primary" type="submit" disabled={!canManageUsers || newUserStatus === "saving"}><Save size={16} />Создать сотрудника</button>
              </div>
              {!canManageUsers ? <div className="integration-status">Создавать сотрудников может только руководитель отдела или администратор.</div> : null}
              {newUserStatus === "saving" ? <div className="integration-status">Создаем сотрудника...</div> : null}
              {newUserError ? <div className="form-error">{newUserError}</div> : null}
              {newUserResult?.user ? (
                <div className="created-user-secret">
                  <span>Данные для входа</span>
                  <strong>Логин: {newUserResult.user.login}</strong>
                  <strong>Пароль: {newUserResult.password}</strong>
                  <em>Сохраните пароль сейчас. Повторно он не показывается.</em>
                </div>
              ) : null}
            </form>
          </section>
          ) : null}
          {adminTab === "access" ? (
          <section className="panel admin-access-panel">
            <div className="panel-title-row">
              <div>
                <h2>Доступы по кабинетам</h2>
                <p>Назначайте команду проекта без перехода внутрь каждого кабинета.</p>
              </div>
              <Tag tone={managedPortals.length ? "blue" : "amber"}>{managedPortals.length ? `${managedPortals.length} кабинетов` : "нет кабинетов"}</Tag>
            </div>
            {accessSaveError ? <div className="form-error">{accessSaveError}</div> : null}
            <div className="admin-access-table">
              <div className="admin-access-head">
                <span>Кабинет</span>
                {Object.values(projectRoleLabels).map((label) => <span key={label}>{label}</span>)}
              </div>
              {managedPortals.map((portal) => {
                const team = getPortalTeam(portal);
                return (
                  <div className={`admin-access-row ${portal.isActive === false ? "inactive" : ""}`} key={portal.id}>
                    <div className="admin-access-portal">
                      <strong>{portalDisplayName(portal)}</strong>
                      <span>{portal.status} · {portal.isActive === false ? "архив" : "активен"}</span>
                    </div>
                    {Object.entries(projectRoleLabels).map(([roleKey, label]) => {
                      const roleUsers = activeUserOptions.filter((user) => userCanFillProjectRole(user, roleKey));
                      const options = roleUsers.length ? roleUsers : activeUserOptions;
                      const saveKey = `${portal.id}:${roleKey}`;
                      return (
                        <label className="field-label compact" key={roleKey}>
                          {label}
                          <select
                            className="select"
                            value={team[roleKey] || ""}
                            disabled={!canManage || accessSaveStatus === saveKey}
                            onChange={(event) => updatePortalAccess(portal, roleKey, event.target.value)}
                          >
                            <option value="">Не назначен</option>
                            {options.map((user) => (
                              <option value={user.login} key={user.login}>{user.full_name}</option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
              {!managedPortals.length ? (
                <div className="empty-state">
                  <strong>Нет рабочих кабинетов</strong>
                  <span>Когда появятся кабинеты селлеров, здесь будет матрица доступов.</span>
                </div>
              ) : null}
            </div>
          </section>
          ) : null}
          {adminTab === "events" ? (
          <section className="panel">
            <div className="panel-title-row">
              <div>
                <h2>Журнал действий</h2>
                <p>Последние изменения пользователей, доступов и интеграций.</p>
              </div>
              <button className="btn" type="button" onClick={loadAdminEvents} disabled={adminEventsStatus === "loading"}>
                <RefreshCw size={16} />{adminEventsStatus === "loading" ? "Обновляем" : "Обновить"}
              </button>
            </div>
            <div className="admin-events-list">
              {adminEvents.map((event) => (
                <div className="admin-event-row" key={event.id}>
                  <div>
                    <strong>{adminEventTitle(event)}</strong>
                    <span>{adminEventDetailsText(event) || event.targetId || "Без деталей"}</span>
                  </div>
                  <em>{event.actorLogin || "система"}</em>
                  <time>{event.createdAt ? new Date(event.createdAt).toLocaleString("ru-RU") : ""}</time>
                </div>
              ))}
              {!adminEvents.length ? (
                <div className="empty-state">
                  <strong>{adminEventsStatus === "loading" ? "Загружаем журнал" : "Журнал пока пуст"}</strong>
                  <span>Новые изменения пользователей, доступов и интеграций появятся здесь.</span>
                </div>
              ) : null}
            </div>
          </section>
          ) : null}
          {adminTab === "integrations" ? (
          <section className="admin-integrations">
            <div className="panel integration-overview-panel">
              <div className="panel-title-row">
                <div>
                  <h2>Интеграции</h2>
                  <p>WB API по кабинетам, MPStats, LLM и состояние backend-хранилища ключей.</p>
                </div>
                <button className="btn" type="button" onClick={loadAdminStatus}><RefreshCw size={16} />Обновить статус</button>
              </div>
              <div className="integration-card-grid">
                <div className="integration-card">
                  <div>
                    <strong>Wildberries API</strong>
                    <span>{apiPortals.length ? `${apiPortals.length} ${pluralRu(apiPortals.length, "кабинет", "кабинета", "кабинетов")}` : "нет API-кабинетов"}</span>
                  </div>
                  <Tag tone={wbTokenIssues.length ? "amber" : "blue"}>{wbTokenIssues.length ? "требует внимания" : "read-only"}</Tag>
                </div>
                <div className="integration-card">
                  <div>
                    <strong>MPStats</strong>
                    <span>{mpstatsStatusLabel}</span>
                  </div>
                  <Tag tone={mpstatsVerified ? "green" : (mpstatsConnected ? "amber" : "red")}>{mpstatsConnected ? "ключ сохранен" : "нет ключа"}</Tag>
                </div>
                <div className="integration-card">
                  <div>
                    <strong>LLM</strong>
                    <span>{llmStatus.source || "OpenAI-compatible"} · {llmStatus.model || "модель не указана"}</span>
                  </div>
                  <Tag tone={llmStatus.configured ? "green" : "amber"}>{llmStatus.configured ? "настроен" : "не настроен"}</Tag>
                </div>
                <div className="integration-card">
                  <div>
                    <strong>Хранилище ключей</strong>
                    <span>{adminStatus?.storage?.secretKeyConfigured ? "AES-GCM ключ настроен" : "ключ шифрования не найден"}</span>
                  </div>
                  <Tag tone={adminStatus?.storage?.secretKeyConfigured ? "green" : "red"}>backend</Tag>
                </div>
              </div>
            </div>

            <section className="panel integration-section">
              <div className="panel-title-row">
                <div>
                  <h2>Wildberries API</h2>
                  <p>Токены привязаны к кабинетам селлеров. Замена ключа выполняется внутри карточки кабинета.</p>
                </div>
                <Tag tone={wbTokenIssues.length ? "amber" : "blue"}>{wbTokenIssues.length ? `${wbTokenIssues.length} риск` : "без критичных рисков"}</Tag>
              </div>
              {apiPortals.length ? (
                <div className="admin-wb-token-list">
                  {apiPortals.map((portal) => (
                    <div className="integration-token-row" key={portal.id}>
                      <div>
                        <strong>{portalDisplayName(portal)}</strong>
                        <span>{portal.status} · {portal.isActive === false ? "архив" : "активен"}</span>
                      </div>
                      <Tag tone={["expired", "expiring"].includes(portal.tokenMeta?.status) ? "amber" : "green"}>
                        {tokenDaysLeftText(portal.tokenMeta) || "срок не указан"}
                      </Tag>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <strong>Нет API-кабинетов</strong>
                  <span>Когда кабинет будет подключен через WB API, его токен появится здесь.</span>
                </div>
              )}
            </section>

            <section className="panel integration-section">
              <div className="panel-title-row">
                <div>
                  <h2>MPStats API</h2>
                  <p>Глобальный ключ для аудита, семантики, отчетов и загрузки карточек по ссылке.</p>
                </div>
                <Tag tone={mpstatsVerified ? "green" : (mpstatsConnected ? "amber" : "red")}>{mpstatsStatusLabel}</Tag>
              </div>
              <form className="integration-form flat" onSubmit={saveMpstatsKey}>
                <label className="field-label">
                  API ключ
                  <input
                    type="password"
                    value={mpstatsKey}
                    onChange={(event) => setMpstatsKey(event.target.value)}
                    disabled={!canManage}
                    autoComplete="off"
                    placeholder={canManage
                      ? (mpstatsConnected ? "Введите новый ключ, чтобы заменить сохраненный" : "Введите ключ MPStats")
                      : "Недостаточно прав для изменения"}
                  />
                </label>
                {mpstatsConnected ? (
                  <div className="integration-saved">
                    <span>Сохраненный ключ</span>
                    <strong>************</strong>
                    <em>{mpstatsUpdatedAt ? `обновлен ${mpstatsUpdatedAt}` : "хранится на backend"}</em>
                    {mpstatsLastCheckedAt ? <em>проверен {mpstatsLastCheckedAt}</em> : null}
                  </div>
                ) : null}
                <div className="panel-actions">
                  <button className="btn primary" type="submit" disabled={!canManage || !mpstatsKey.trim() || mpstatsStatus === "saving"}><Save size={16} />Сохранить ключ</button>
                  <button className="btn" type="button" disabled={!canManage || !mpstatsConnected || mpstatsStatus === "checking"} onClick={checkMpstatsConnection}><RefreshCw size={16} />Проверить</button>
                </div>
                <div className="integration-status">
                  {mpstatsStatus === "saving" ? "Сохраняем..." : null}
                  {mpstatsStatus === "checking" ? "Проверяем соединение с MPStats..." : null}
                  {mpstatsStatus === "saved" ? (mpstatsVerified ? "Ключ сохранен и соединение проверено." : "Ключ сохранен. Поле очищено специально: сам ключ не показываем повторно.") : null}
                  {mpstatsStatus === "verified" ? "Соединение с MPStats работает." : null}
                  {mpstatsStatus === "auth_error" ? "MPStats отклонил ключ. Проверьте токен в аккаунте MPStats." : null}
                  {mpstatsStatus === "rate_limited" ? "MPStats ответил лимитом запросов. Ключ сохранен, проверку можно повторить позже." : null}
                  {mpstatsStatus === "error" ? "Не удалось обновить статус MPStats." : null}
                  {!mpstatsStatus || mpstatsStatus === "idle" ? (mpstatsConnected ? (mpstatsVerified ? "MPStats подключен и проверен." : "MPStats ключ сохранен, но соединение еще не проверено.") : "MPStats пока не настроен.") : null}
                </div>
              </form>
            </section>

            <section className="panel integration-section">
              <div className="panel-title-row">
                <div>
                  <h2>Backend и LLM</h2>
                  <p>Сервисные настройки берутся из окружения сервера и меняются через deploy-конфигурацию.</p>
                </div>
                <Tag tone={llmStatus.configured && adminStatus?.storage?.secretKeyConfigured ? "green" : "amber"}>system</Tag>
              </div>
              <div className="integration-system-grid">
                <div className="integration-system-row">
                  <span>LLM provider</span>
                  <strong>{llmStatus.source || "OpenAI-compatible"}</strong>
                  <em>{llmStatus.configured ? "настроен" : "не настроен"}</em>
                </div>
                <div className="integration-system-row">
                  <span>LLM model</span>
                  <strong>{llmStatus.model || "модель не указана"}</strong>
                  <em>{llmStatus.configured ? "готов к аудиту" : "аудит работает без LLM-доработки"}</em>
                </div>
                <div className="integration-system-row">
                  <span>Secret storage</span>
                  <strong>{adminStatus?.storage?.secretKeyConfigured ? "AES-GCM" : "нет ключа"}</strong>
                  <em>{adminStatus?.storage?.secretKeyConfigured ? "секреты можно шифровать" : "нужен ключ окружения"}</em>
                </div>
              </div>
            </section>
          </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
