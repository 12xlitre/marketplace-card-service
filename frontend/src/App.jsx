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
  { login: "kristina", full_name: "Кристина Январева", role: "Руководитель отдела", access_level: "all", user_role: "manager" },
  { login: "anastasia", full_name: "Анастасия Руднева", role: "Технический специалист", access_level: "readonly_wb", user_role: "tech" },
  { login: "svetlana", full_name: "Светлана Дементьева", role: "Аккаунт-менеджер", access_level: "overview", user_role: "manager" },
];

const appViewStorageKey = "opticards-active-view";
const appScreens = new Set(["cabinets", "seller", "card", "settings"]);

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
  const lead = findPreferredUser(users, ["kristina", "kristina.yanvareva"], "admin");
  const tech = findPreferredUser(users, ["anastasia", "anastasia.rudneva"], "tech");
  const manager = findPreferredUser(users, ["svetlana", "svetlana.dementyeva"], "manager") || lead;
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

function titleAuditReason(card, currentTitle, draftTitle) {
  if (isEmptyValue(card?.title)) {
    return "WB не вернул название, поэтому аудит предлагает собрать его из категории, бренда и текущих данных карточки.";
  }
  if (currentTitle.length > 60) {
    return "Название длиннее лимита WB 60 символов, поэтому аудит предлагает укоротить его.";
  }
  if (draftTitle !== currentTitle) {
    return "Аудит добавил категорию или бренд, потому что их не было в текущем названии.";
  }
  return "Название уже укладывается в лимит WB, поэтому аудит оставил его без изменения.";
}

function descriptionAuditReason(description) {
  if (String(description || "").trim()) {
    return "Описание уже есть в WB, поэтому аудит перенес его в черновик без изменения.";
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

function buildStructuredCardDraft({
  auditStatus,
  auditHistory,
  title,
  titleSource,
  titleReason,
  description,
  descriptionSource,
  descriptionReason,
  characteristics,
  card,
}) {
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
    prices: {},
    stocks: {},
    meta: {
      auditHistory: Array.isArray(auditHistory) ? auditHistory.slice(0, 20) : [],
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

function contentFromStoredDraft(storedDraft) {
  const payload = storedDraft?.draft || storedDraft || {};
  const content = payload.content || payload;
  const title = content.title || {};
  const description = content.description || {};
  const meta = payload.meta || {};
  return {
    auditStatus: payload.auditStatus || storedDraft?.auditStatus || "idle",
    title: typeof title === "object" ? title.value || "" : payload.title || "",
    description: typeof description === "object" ? description.value || "" : payload.description || "",
    titleSource: typeof title === "object" ? title.source || "" : payload.titleSource || "",
    descriptionSource: typeof description === "object" ? description.source || "" : payload.descriptionSource || "",
    titleReason: typeof title === "object" ? title.reason || "" : payload.titleReason || "",
    descriptionReason: typeof description === "object" ? description.reason || "" : payload.descriptionReason || "",
    characteristics: normalizeDraftCharacteristics(content.characteristics || payload.characteristics || {}),
    auditHistory: Array.isArray(meta.auditHistory) ? meta.auditHistory : [],
    savedAt: storedDraft?.updatedAt || payload.savedAt || "",
  };
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

function buildPricesExportSheets(card) {
  return [
    {
      name: "Цены и скидки",
      freezeRows: 1,
      widths: [18, 24, 24, 22, 20, 22],
      rows: [
        ["Номенклатура WB", "Артикул продавца", "Баркод", "Цена продавца до скидки", "Скидка продавца", "Цена со скидкой"],
        [
          card?.nmID || "",
          card?.vendorCode || "",
          firstSku(card),
          firstDefined(card?.price, card?.rawFields?.price),
          firstDefined(card?.discount, card?.rawFields?.discount),
          firstDefined(card?.discountedPrice, card?.rawFields?.discountedPrice),
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
        ["Ограничение", "Если WB выгрузил свой шаблон со всеми товарами, переносите значения из листа Цены и скидки в строки с тем же nmID/артикулом/баркодом."],
      ],
    },
  ];
}

function buildStocksExportSheets(card) {
  const sizes = Array.isArray(card?.sizes) ? card.sizes : [];
  const uploadRows = [["Баркод", "Количество"]];
  const referenceRows = [["Баркод", "Артикул продавца", "Номенклатура WB", "Размер", "ID размера WB", "Количество"]];

  if (!sizes.length) {
    uploadRows.push(["", ""]);
    referenceRows.push(["", card?.vendorCode || "", card?.nmID || "", "", "", ""]);
  } else {
    sizes.forEach((size) => {
      const skus = Array.isArray(size?.skus) && size.skus.length ? size.skus : [""];
      skus.forEach((sku) => {
        uploadRows.push([sku, ""]);
        referenceRows.push([
          sku,
          card?.vendorCode || "",
          card?.nmID || "",
          size?.techSize || size?.wbSize || "",
          size?.chrtID || "",
          "",
        ]);
      });
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
  const [notice, setNotice] = useState("");

  const displayUsers = users.length ? users : hardcodedDirectoryFallback;
  const canManagePortals = currentUser ? ["admin", "manager"].includes(getUserRoleType(currentUser)) : false;
  const canManageUsers = currentUser ? userCanManageUsers(currentUser) : false;
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

    await loadWbDemoSnapshot();
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

  async function loadPortalCards(portal) {
    if (!portal || portal.isDemo || !portal.apiConnected || portal.realCards?.length) {
      return;
    }
    const portalKey = String(portal.id);
    if (loadingPortalCards[portalKey]) {
      return;
    }
    setLoadingPortalCards((items) => ({ ...items, [portalKey]: true }));
    try {
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(portal, payload);
      replaceUserPortal(updatedPortal);
    } catch {
      replaceUserPortal({ ...portal, syncStatus: "error" });
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
            cards={currentPortalCards}
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

        {screen === "card" && selectedCardFromPortal ? (
          <CardDetailScreen
            key={selectedCardFromPortal?.nmID || selectedCardFromPortal?.vendorCode || selectedCardFromPortal?.title}
            card={selectedCardFromPortal}
            portal={currentPortal}
            onBack={() => setScreen("seller")}
          />
        ) : null}

        {screen === "card" && !selectedCardFromPortal ? (
          <CardRecoveryScreen loading={cardScreenLoading} onBack={() => setScreen("seller")} />
        ) : null}

        {screen === "audit" ? <PlaceholderScreen title="Аудит" copy="MPStats и полноценный аудит подключим отдельным этапом. Сейчас активна загрузка данных WB и ручная проверка карточек." /> : null}
        {screen === "settings" ? (
          <SettingsScreen
            users={displayUsers}
            canManage={canManagePortals}
            canManageUsers={canManageUsers}
            onCreateUser={createUserAccount}
          />
        ) : null}
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
  const [draftTitleReason, setDraftTitleReason] = useState("");
  const [draftDescriptionReason, setDraftDescriptionReason] = useState("");
  const [draftCharacteristics, setDraftCharacteristics] = useState({});
  const [auditHistory, setAuditHistory] = useState([]);
  const [subjectCharacteristics, setSubjectCharacteristics] = useState([]);
  const [subjectCharacteristicsStatus, setSubjectCharacteristicsStatus] = useState("idle");
  const [mpstatsCharacteristics, setMpstatsCharacteristics] = useState([]);
  const [mpstatsCharacteristicsStatus, setMpstatsCharacteristicsStatus] = useState("idle");
  const [mpstatsCharacteristicsMs, setMpstatsCharacteristicsMs] = useState(null);
  const [mpstatsCharacteristicsMeta, setMpstatsCharacteristicsMeta] = useState({});
  const [characteristicSearch, setCharacteristicSearch] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const photoUrl = bestPhotoUrl(card);
  const currentTitle = textOrDash(card?.title);
  const titleLength = currentTitle.length;
  const issueCount = Number(card?.issueCount ?? (card?.issue && card.issue !== "Нет критичных" ? 1 : 0));
  const rawFields = rawFieldsForCard(card);
  const description = card?.description || rawFields.description || "";
  const characteristics = card?.characteristics || rawFields.characteristics || [];
  const characteristicItems = characteristicRows(characteristics);
  const characteristicValueOptions = characteristicValueOptionsByKey(portal, characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const photos = card?.photos || rawFields.photos || (photoUrl ? [photoUrl] : []);
  const sizes = card?.sizes || rawFields.sizes || [];
  const dimensions = card?.dimensions || rawFields.dimensions || {};
  const auditDone = auditStatus === "done";
  const auditRunning = auditStatus === "loading";
  const draftTitleLength = draftTitle.length;
  const draftCardKey = cardDraftKey(card);
  const draftStorageKey = `opticards-draft:${portal?.id || "portal"}:${draftCardKey}`;
  const backendDraftEnabled = Boolean(portal?.id && !portal?.isDemo && portal.id !== "demo-wb");
  const exportFileBase = safeFilePart(`${card?.vendorCode || card?.nmID || "card"}-${card?.subjectName || "wb"}`);
  const mpstatsMatches = countMpstatsMatches(characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const promotionRelevantCount = countPromotionRelevantCharacteristics(characteristicItems, subjectCharacteristics, mpstatsCharacteristics);
  const mpstatsDuration = requestDurationText(mpstatsCharacteristicsMs);
  const mpstatsSourceLabel = mpstatsCharacteristicsMeta.cached ? "кэш" : (mpstatsCharacteristicsMeta.cachedAt ? "сейчас" : "");
  const mpstatsUpdatedAt = mpstatsCharacteristicsMeta.cachedAt
    ? new Date(mpstatsCharacteristicsMeta.cachedAt).toLocaleString("ru-RU")
    : "";
  const mpstatsHintsLabel = {
    loaded: `${mpstatsCharacteristics.length} MPStats · ${mpstatsMatches} совпало${mpstatsSourceLabel ? ` · ${mpstatsSourceLabel}` : ""}${!mpstatsCharacteristicsMeta.cached && mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    loading: "загрузка",
    empty: `MPStats пусто${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    error: `MPStats ошибка${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    unavailable: `MPStats недоступен${mpstatsDuration ? ` · ${mpstatsDuration}` : ""}`,
    "missing-subject": "нет subjectID",
  }[mpstatsCharacteristicsStatus] || (auditDone ? "есть рекомендации" : "ручной черновик");
  const mpstatsHintsTitle = mpstatsUpdatedAt
    ? `MPStats обновлен ${mpstatsUpdatedAt}${mpstatsCharacteristicsMeta.cached ? ". Загружено из backend-кэша." : "."}`
    : "Подтянуть популярные значения характеристик из MPStats";
  const mpstatsHintsTone = ["loaded", "loading"].includes(mpstatsCharacteristicsStatus)
    ? "blue"
    : ["empty", "error", "unavailable", "missing-subject"].includes(mpstatsCharacteristicsStatus)
      ? "amber"
      : auditDone ? "blue" : "green";

  useEffect(() => {
    let active = true;
    setActiveTab("audit");
    setAuditStatus("idle");
    setDraftTitle("");
    setDraftDescription("");
    setDraftTitleSource("");
    setDraftDescriptionSource("");
    setDraftTitleReason("");
    setDraftDescriptionReason("");
    setDraftCharacteristics({});
    setAuditHistory([]);
    setMpstatsCharacteristics([]);
    setMpstatsCharacteristicsStatus("idle");
    setMpstatsCharacteristicsMs(null);
    setMpstatsCharacteristicsMeta({});
    setCharacteristicSearch("");
    setDraftSavedAt("");
    setDraftSaveStatus("");
    const applyDraft = (storedDraft) => {
      const normalized = contentFromStoredDraft(storedDraft);
      setDraftTitle(normalized.title);
      setDraftDescription(normalized.description);
      setDraftTitleSource(normalized.titleSource);
      setDraftDescriptionSource(normalized.descriptionSource);
      setDraftTitleReason(normalized.titleReason);
      setDraftDescriptionReason(normalized.descriptionReason);
      setDraftCharacteristics(normalized.characteristics);
      setAuditHistory(normalized.auditHistory);
      setAuditStatus(normalized.auditStatus);
      setDraftSavedAt(normalized.savedAt);
      setActiveTab("changes");
    };
    try {
      const saved = JSON.parse(localStorage.getItem(draftStorageKey) || "null");
      if (saved) {
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
          applyDraft(payload.draft);
          setDraftSaveStatus("backend");
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

  async function loadMpstatsCharacteristicHints({ forceRefresh = true } = {}) {
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

  async function runAuditStub() {
    setAuditStatus("loading");
    const mpstatsPayload = await loadMpstatsCharacteristicHints({ forceRefresh: true });
    const auditMpstatsCharacteristics = mpstatsPayload?.characteristics || mpstatsCharacteristics;
    const suggestions = titleSuggestions(card);
    const nextTitle = suggestions[1] || suggestions[0] || "";
    const nextDescription = descriptionSuggestion(card, description);
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
      mpstatsGroups: auditMpstatsCharacteristics.length,
      mpstatsMatches: countMpstatsMatches(characteristicItems, subjectCharacteristics, auditMpstatsCharacteristics),
      promotionRelevantCount: countPromotionRelevantCharacteristics(characteristicItems, subjectCharacteristics, auditMpstatsCharacteristics),
      changedCharacteristics,
      status: mpstatsPayload ? "done" : "partial",
    };
    setDraftTitle(nextTitle);
    setDraftDescription(nextDescription);
    setDraftTitleSource("audit");
    setDraftDescriptionSource("audit");
    setDraftTitleReason(titleAuditReason(card, currentTitle, nextTitle));
    setDraftDescriptionReason(descriptionAuditReason(description));
    setDraftCharacteristics(nextDraftCharacteristics);
    setAuditHistory((current) => [auditEntry, ...current].slice(0, 20));
    setAuditStatus("done");
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

  async function saveDraft() {
    const savedAt = new Date().toISOString();
    const structuredDraft = buildStructuredCardDraft({
      auditStatus,
      auditHistory,
      title: draftTitle,
      description: draftDescription,
      titleSource: draftTitleSource,
      descriptionSource: draftDescriptionSource,
      titleReason: draftTitleReason,
      descriptionReason: draftDescriptionReason,
      characteristics: draftCharacteristics,
      card,
    });
    localStorage.setItem(draftStorageKey, JSON.stringify({ ...structuredDraft, savedAt }));
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
        return;
      } catch {
        setDraftSaveStatus("local-fallback");
      }
    } else {
      setDraftSaveStatus("local");
    }
    setDraftSavedAt(savedAt);
  }

  function downloadDraftTable(type) {
    if (type === "content") {
      downloadXlsx(`${exportFileBase}-content-wb.xlsx`, buildContentExportSheets(card, draftTitle, draftDescription, draftCharacteristics));
      return;
    }
    if (type === "prices") {
      downloadXlsx(`${exportFileBase}-prices-wb.xlsx`, buildPricesExportSheets(card));
      return;
    }
    downloadXlsx(`${exportFileBase}-stocks-wb.xlsx`, buildStocksExportSheets(card));
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
                    <p>Запускает аналитику MPStats, сохраняет результат в кэш и готовит черновик изменений.</p>
                  </div>
                  <Tag tone={auditRunning ? "blue" : (auditDone ? "green" : "amber")}>{auditRunning ? "идет аудит" : (auditDone ? "аудит готов" : "не запускался")}</Tag>
                </div>
                <div className="audit-list">
                  <div className="issue">
                    <div className="issue-head">
                      <strong>{issueCount ? card.issue : "Критичных проблем нет"}</strong>
                      <Tag tone={issueCount ? "amber" : "green"}>{issueCount ? "проверка" : "ок"}</Tag>
                    </div>
                    <p>{issueCount ? issueCopy(card.issue) : "Карточка выглядит рабочей по текущему снимку WB API. Перед публикацией все равно нужна ручная проверка."}</p>
                  </div>
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
                  {auditDone ? (
                    <div className="issue">
                      <div className="issue-head">
                        <strong>Предложения подготовлены</strong>
                        <Tag tone="blue">черновик</Tag>
                      </div>
                      <p>Система заполнила вкладку изменений вариантами для ручной проверки.</p>
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
                            <span>{item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU") : "Без даты"}</span>
                            <em>{item.mpstatsGroups || 0} MPStats · {item.mpstatsMatches || 0} совпало · {item.changedCharacteristics || 0} изменено</em>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>После запуска аудита здесь появятся даты и краткий итог. История сохранится вместе с черновиком.</p>
                    )}
                  </div>
                </div>
                <div className="tab-actions">
                  <button className="btn primary" type="button" onClick={runAuditStub} disabled={auditRunning || mpstatsCharacteristicsStatus === "loading"}><ClipboardList size={17} />{auditRunning ? "Аудит идет" : "Запустить аудит"}</button>
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
                    <p>{auditDone ? "Рекомендации аудита помечены, но любые поля можно править вручную." : "Заполняйте колонку Стало вручную. MPStats-аналитика подтянется из кэша аудита, если он уже был."}</p>
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
                  <div className="field-box">
                    <strong>Было: описание</strong>
                    <p>{isEmptyValue(description) ? "Пусто" : description}</p>
                  </div>
                  <div className="field-box">
                    <strong>Стало: описание</strong>
                    <textarea
                      className={`description-editor ${draftDescriptionSource === "audit" ? "audit-suggestion-field" : ""}`}
                      value={draftDescription}
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
                    />
                  </div>
                </div>
                <div className="draft-actions">
                  <div>
                    <strong>Черновик изменений</strong>
                    <p>{draftSavedAt
                      ? `Сохранен ${new Date(draftSavedAt).toLocaleString("ru-RU")}${draftSaveStatus === "backend" ? " на backend" : " локально"}`
                      : "Не сохранен. Сохраните перед выходом, чтобы не потерять колонку Стало."}</p>
                    {draftSaveStatus === "local-fallback" ? <p>Backend недоступен для черновика, временно сохранено в этом браузере.</p> : null}
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
  mpstatsCharacteristics,
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
          <div className="characteristic-diff-title">
            <strong>{row.label}</strong>
            {characteristicIsPromotionRelevant(row.meta, mpstatsCharacteristics) ? <Tag tone="amber">важно</Tag> : null}
          </div>
          {row.draftOnly ? <span className="raw-field-value field-empty">Добавлено в черновик</span> : <RawFieldValue value={row.value} />}
          <DraftCharacteristicEditor
            draft={drafts[row.key]}
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

function DraftCharacteristicEditor({ draft, row, meta, valueOptions, mpstatsValues = [], mpstatsStats = [], mpstatsNearbyNames = [], onAddValue, onReplaceValue, onRemoveValue, onRemove }) {
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
          disabled={isLimitReached && !canReplaceSingleValue}
          placeholder={isLimitReached ? "Выбрать замену" : (strictValues ? "Выбрать из списка WB" : "Подсказки или свое значение")}
        />
      </label>
      {isOptionsOpen ? (
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
      <DraftReason reason={draft?.reason || ""} compact />
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
            <UserSelect label="Руководитель отдела" value={form.lead} users={users} onChange={(value) => update("lead", value)} />
            <UserSelect label="Технический специалист" value={form.tech} users={users} onChange={(value) => update("tech", value)} />
          </div>
          <UserSelect label="Аккаунт-менеджер" value={form.manager} users={users} onChange={(value) => update("manager", value)} />
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
  login: "svetlana",
  fullName: "Светлана Дементьева",
  role: "Аккаунт-менеджер",
  userRole: "manager",
  accessLevel: "overview",
};

function SettingsScreen({ users, canManage = false, canManageUsers = false, onCreateUser }) {
  const [mpstatsIntegration, setMpstatsIntegration] = useState(null);
  const [mpstatsKey, setMpstatsKey] = useState("");
  const [mpstatsStatus, setMpstatsStatus] = useState("idle");
  const [newUserForm, setNewUserForm] = useState(defaultNewUserForm);
  const [newUserStatus, setNewUserStatus] = useState("idle");
  const [newUserResult, setNewUserResult] = useState(null);
  const [newUserError, setNewUserError] = useState("");

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
      setMpstatsKey("");
      setMpstatsStatus(payload.ok ? "saved" : payload.status || "error");
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
    setNewUserForm((current) => ({ ...current, [name]: value }));
    setNewUserResult(null);
    setNewUserError("");
    setNewUserStatus("idle");
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
                    required
                  />
                </label>
              </div>
              <label className="field-label">
                Роль
                <input
                  value={newUserForm.role}
                  onChange={(event) => updateNewUser("role", event.target.value)}
                  disabled={!canManageUsers}
                  autoComplete="off"
                  required
                />
              </label>
              <div className="form-two">
                <label className="field-label">
                  Тип доступа
                  <select
                    className="select"
                    value={newUserForm.userRole}
                    onChange={(event) => updateNewUser("userRole", event.target.value)}
                    disabled={!canManageUsers}
                  >
                    <option value="manager">Менеджер</option>
                    <option value="tech">Технический специалист</option>
                    <option value="admin">Администратор</option>
                  </select>
                </label>
                <label className="field-label">
                  Уровень
                  <select
                    className="select"
                    value={newUserForm.accessLevel}
                    onChange={(event) => updateNewUser("accessLevel", event.target.value)}
                    disabled={!canManageUsers}
                  >
                    <option value="overview">Проекты и обзор</option>
                    <option value="readonly_wb">Карточки WB</option>
                    <option value="all">Полный доступ</option>
                  </select>
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
          <section className="panel">
            <h2>Интеграции</h2>
            <div className="panel-list">
              <div className="list-row"><span>Wildberries</span><strong>read-only API</strong></div>
              <div className="list-row"><span>MPStats</span><strong>{mpstatsStatusLabel}</strong></div>
              <div className="list-row"><span>Токены</span><strong>AES-GCM в SQLite</strong></div>
            </div>
            <form className="integration-form" onSubmit={saveMpstatsKey}>
              <div>
                <strong>MPStats API</strong>
                <p>Глобальный ключ для всех кабинетов и карточек сервиса. Ключ сохраняется только на backend и не показывается повторно.</p>
              </div>
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
                  <strong>••••••••••••</strong>
                  <em>{mpstatsUpdatedAt ? `обновлен ${mpstatsUpdatedAt}` : "хранится на backend"}</em>
                  {mpstatsLastCheckedAt ? <em>проверен {mpstatsLastCheckedAt}</em> : null}
                </div>
              ) : null}
              <div className="panel-actions">
                <button className="btn primary" type="submit" disabled={!canManage || !mpstatsKey.trim() || mpstatsStatus === "saving"}><Save size={16} />Сохранить ключ</button>
                <button className="btn" type="button" disabled={!canManage || !mpstatsConnected || mpstatsStatus === "checking"} onClick={checkMpstatsConnection}>Проверить подключение</button>
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
        </div>
      </div>
    </section>
  );
}
