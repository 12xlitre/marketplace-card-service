import { useEffect, useRef, useState } from "react";
import {
  Archive,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  ClipboardList,
  FileText,
  GripVertical,
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
  ShoppingBag,
  Store,
  Tags,
  Trash2,
  Unlink,
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
const appScreens = new Set(["cabinets", "client", "seller", "card", "settings", "admin"]);
const sellerTabs = new Set(["cabinet", "tasks", "reports", "work-periods"]);
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
  clientContact: { name: "", phone: "", email: "", comment: "" },
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

function draftSaveErrorText(errorObject) {
  if (errorObject?.message === "approval_forbidden") {
    return "Этот статус может поставить только аккаунт-менеджер проекта или администратор.";
  }
  if (errorObject?.message === "forbidden" || errorObject?.status === 403) {
    return "Backend отклонил сохранение из-за прав доступа к кабинету.";
  }
  if (errorObject?.status === 401) {
    return "Сессия истекла. Войдите заново и повторите действие.";
  }
  if (errorObject?.message === "draft_payload_too_large" || errorObject?.status === 413) {
    return "Черновик получился слишком большим для backend. Сохраните итоговую подборку и попробуйте еще раз.";
  }
  if (errorObject?.message === "invalid_json") {
    return "Backend не прочитал тело запроса. Обновите страницу и повторите сохранение.";
  }
  if (errorObject?.message === "invalid_portal_id" || errorObject?.message === "invalid_card_key") {
    return "Backend не получил идентификатор кабинета или карточки. Откройте карточку заново из кабинета.";
  }
  return "Backend не принял черновик. Проверьте доступ и попробуйте еще раз.";
}

function semanticImportErrorText(errorObject) {
  if (errorObject?.status === 413 || errorObject?.message === "semantic_import_payload_too_large" || errorObject?.message === "semantic_import_file_too_large") {
    return "Файл слишком большой для загрузки. Разделите его на несколько файлов и повторите импорт.";
  }
  if (errorObject?.message === "semantic_import_unsupported_file") {
    return "Поддерживаются XLSX, CSV, TXT или TSV.";
  }
  if (errorObject?.message === "semantic_import_invalid_xlsx" || errorObject?.message === "semantic_import_invalid_csv") {
    return "Файл не удалось прочитать. Сохраните его заново в XLSX или CSV и повторите загрузку.";
  }
  if (errorObject?.message === "unsupported_marketplace") {
    return "Обратная загрузка согласованного СЯ сейчас включена только для WB-кабинета.";
  }
  if (errorObject?.message === "forbidden" || errorObject?.status === 403) {
    return "Нет доступа к этому кабинету.";
  }
  if (errorObject?.status === 401) {
    return "Сессия истекла. Войдите заново и повторите загрузку.";
  }
  return "Не удалось разобрать согласованное СЯ. Проверьте шаблон, листы и колонку Да/Нет.";
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
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

function exportDatePart() {
  return new Date().toISOString().slice(0, 10);
}

function safeSheetName(value, fallback = "Лист", usedNames = new Set()) {
  const base = String(value || fallback)
    .trim()
    .replace(/[\\/?*\[\]:]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 31)
    .trim() || fallback;
  let name = base;
  let index = 2;
  while (usedNames.has(name.toLowerCase())) {
    const suffix = ` ${index}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length)).trim()}${suffix}`;
    index += 1;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

function readSavedAppView() {
  try {
    const saved = JSON.parse(localStorage.getItem(appViewStorageKey) || "null");
    if (!saved || typeof saved !== "object") {
      return {};
    }
    return {
      screen: appScreens.has(saved.screen) ? saved.screen : "cabinets",
      clientId: saved.clientId ? String(saved.clientId) : "",
      portalId: saved.portalId ? String(saved.portalId) : "",
      cardKey: saved.cardKey ? String(saved.cardKey) : "",
      sellerTab: sellerTabs.has(saved.sellerTab) ? saved.sellerTab : "cabinet",
    };
  } catch {
    return {};
  }
}

function normalizeSellerTab(value) {
  return sellerTabs.has(value) ? value : "cabinet";
}

function sellerBackLabel(tab) {
  return {
    tasks: "Задачи",
    reports: "Отчеты",
    "work-periods": "Отчетный период",
  }[tab] || "Карточки";
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
      const explicitStyle = cell && typeof cell === "object" && !Array.isArray(cell) ? cell.style : null;
      const style = explicitStyle ?? (rowIndex === 0 ? 1 : 0);
      const ref = `${columnName(columnIndex)}${rowNumber}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  const autoFilter = rows.length > 1 ? `<autoFilter ref="A1:${lastCell}"/>` : "";
  const dataValidations = (sheet.dataValidations || []).length
    ? `<dataValidations count="${sheet.dataValidations.length}">${sheet.dataValidations.map((item) => `<dataValidation type="${item.type || "list"}" allowBlank="${item.allowBlank === false ? 0 : 1}" showErrorMessage="1" sqref="${xmlEscape(item.range)}"><formula1>${xmlEscape(item.formula1 || "")}</formula1></dataValidation>`).join("")}</dataValidations>`
    : "";
  const sheetProtection = sheet.protected ? '<sheetProtection sheet="1" objects="1" scenarios="1" insertRows="0"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freezePane}<cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${sheetProtection}${autoFilter}${dataValidations}</worksheet>`;
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
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="0"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
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

function downloadDataUrl(filename, dataUrl) {
  if (!dataUrl) return;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = safeDownloadFileName(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  const fallbackName = portalMarketplaceKey(portal) === "ozon" ? "Кабинет Ozon" : "Кабинет WB";
  return currentName || cardName || fallbackName;
}

function portalMarketplaceName(portal) {
  return String(portal?.marketplace || "Wildberries").trim() || "Wildberries";
}

function portalMarketplaceKey(portal) {
  const marketplace = portalMarketplaceName(portal).toLowerCase();
  if (marketplace.includes("ozon") || marketplace.includes("озон")) {
    return "ozon";
  }
  return "wildberries";
}

function isOzonPortal(portal) {
  return portalMarketplaceKey(portal) === "ozon";
}

function marketplaceTitle(key) {
  return key === "ozon" ? "Ozon" : "Wildberries";
}

function isGenericPortalName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || ["кабинет wb", "кабинет wildberries", "wildberries", "wb", "кабинет ozon", "ozon"].includes(normalized);
}

function clientKeyFromName(value) {
  return String(value || "").trim().toLowerCase() || "client";
}

function portalClientName(portal) {
  const explicitName = String(portal?.clientName || portal?.client_name || portal?.customerName || portal?.customer_name || "").trim();
  if (explicitName) {
    return explicitName;
  }
  const cardName = firstUsefulPortalCardName(portal?.realCards || []);
  if (cardName) {
    return cardName;
  }
  const displayName = portalDisplayName(portal);
  if (!isGenericPortalName(displayName)) {
    return displayName;
  }
  return "Клиент без названия";
}

function portalClientKey(portal) {
  const explicitName = String(portal?.clientName || portal?.client_name || portal?.customerName || portal?.customer_name || "").trim();
  const clientId = String(portal?.clientId || portal?.client_id || "").trim();
  if (clientId) {
    return clientKeyFromName(clientId);
  }
  if (explicitName) {
    return clientKeyFromName(explicitName);
  }
  const displayName = portalClientName(portal);
  if (displayName && !isGenericPortalName(displayName) && displayName !== "Клиент без названия") {
    return clientKeyFromName(displayName);
  }
  return `portal:${String(portal?.id || "client")}`;
}

function normalizeClientContact(contact = {}) {
  const source = contact && typeof contact === "object" ? contact : {};
  return {
    name: String(source.name || "").trim(),
    phone: String(source.phone || "").trim(),
    email: String(source.email || "").trim(),
    comment: String(source.comment || "").trim(),
  };
}

function clientContactHasValue(contact) {
  const normalized = normalizeClientContact(contact);
  return Boolean(normalized.name || normalized.phone || normalized.email || normalized.comment);
}

function clientContactFromClient(client) {
  const portals = Array.isArray(client?.portals) ? client.portals : [];
  const portalWithContact = portals.find((portal) => clientContactHasValue(portal.clientContact));
  return normalizeClientContact((portalWithContact || portals[0] || {}).clientContact);
}

function buildClientWorkspaces(portals) {
  const clients = new Map();
  (Array.isArray(portals) ? portals : []).forEach((portal) => {
    const key = portalClientKey(portal);
    const existing = clients.get(key) || {
      id: key,
      name: portalClientName(portal),
      portals: [],
    };
    existing.portals.push(portal);
    clients.set(key, existing);
  });
  return Array.from(clients.values());
}

function clientMarketplacePortals(client, marketplaceKey) {
  return (client?.portals || []).filter((portal) => portalMarketplaceKey(portal) === marketplaceKey);
}

function clientPortalCount(client, marketplaceKey = "") {
  const portals = marketplaceKey ? clientMarketplacePortals(client, marketplaceKey) : (client?.portals || []);
  return portals.length;
}

function clientCardCount(client, marketplaceKey = "") {
  const portals = marketplaceKey ? clientMarketplacePortals(client, marketplaceKey) : (client?.portals || []);
  return portals.reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
}

function clientTaskCount(client, marketplaceKey = "") {
  const portals = marketplaceKey ? clientMarketplacePortals(client, marketplaceKey) : (client?.portals || []);
  return portals.reduce((sum, portal) => sum + portalActiveTaskCount(portal), 0);
}

function userCanSeeOzonBeta(user) {
  const marker = `${user?.login || ""} ${user?.full_name || ""}`.toLowerCase();
  return marker.includes("dmitriy") || marker.includes("dmitry") || marker.includes("дмитрий") || marker.includes("сафиуллин");
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
    clientName: String(portal.clientName || portal.client_name || "").trim(),
    clientContact: normalizeClientContact(portal.clientContact || portal.client_contact),
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
      taskTotalCount: Number(portal.draftSummary?.taskTotalCount || 0),
      taskActiveCount: Number(portal.draftSummary?.taskActiveCount || 0),
      taskDraftCount: Number(portal.draftSummary?.taskDraftCount || 0),
      taskPendingCount: Number(portal.draftSummary?.taskPendingCount || 0),
      taskReturnedCount: Number(portal.draftSummary?.taskReturnedCount || 0),
      taskApprovedCount: Number(portal.draftSummary?.taskApprovedCount || 0),
      lastDraftAt: portal.draftSummary?.lastDraftAt || "",
      lastTaskAt: portal.draftSummary?.lastTaskAt || "",
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
    taskTotalCount: 0,
    taskActiveCount: 0,
    taskDraftCount: 0,
    taskPendingCount: 0,
    taskReturnedCount: 0,
    taskApprovedCount: 0,
    lastDraftAt: "",
    lastTaskAt: "",
  };
}

function portalActiveTaskCount(portal) {
  const summary = portal?.draftSummary || {};
  const explicitCount = Number(summary.taskActiveCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }
  return Number(summary.approvalPendingCount || 0) + Number(summary.approvalReturnedCount || 0);
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

function normalizeApprovalSectionKey(section, fallback = "content") {
  const fallbackKey = APPROVAL_SECTION_KEYS.includes(fallback) ? fallback : "content";
  return APPROVAL_SECTION_KEYS.includes(section) ? section : fallbackKey;
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
    completed: "завершено",
  }[status] || "черновик";
}

function approvalStatusTone(status) {
  if (status === "submitted") return "amber";
  if (status === "approved" || status === "exported") return "green";
  if (status === "changes_requested") return "red";
  return "blue";
}

const workTypeOptions = [
  { key: "semantic", label: "СЯ" },
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

const taskSectionOptions = [
  { key: "semantic", label: "Семантика" },
  { key: "content", label: "Контент" },
  { key: "prices", label: "Цены" },
  { key: "stocks", label: "Остатки" },
];

const workPeriodTaskGroups = [
  { key: "analysis", label: "Аналитика и стратегия" },
  { key: "card-content", label: "Карточки и контент" },
  { key: "reputation", label: "Отзывы и лояльность" },
  { key: "ads", label: "Реклама и трафик" },
  { key: "storefront", label: "Витрина и продвижение магазина" },
  { key: "operations", label: "Поставки, остатки и экономика" },
  { key: "reports", label: "Отчеты" },
];

const workPeriodTaskOptions = [
  { key: "supplier_matrix_analysis", label: "Анализ матрицы поставщика", group: "analysis" },
  { key: "semantic_core_collection", label: "Сбор семантического ядра с ключевыми словами", group: "card-content" },
  { key: "optimized_product_title", label: "Составление оптимизированного наименования товара", group: "card-content" },
  { key: "optimized_characteristics", label: "Заполнение оптимизированных характеристик для каждой карточки товаров", group: "card-content" },
  { key: "optimized_description", label: "Подготовка описаний с учетом ключевых слов и ограничений по объему", group: "card-content" },
  { key: "infographic_preparation", label: "Подготовка инфографики для карточки товара", group: "card-content" },
  { key: "review_reply_templates", label: "Разработка шаблона ответа на отзывы", group: "reputation" },
  { key: "reviews_questions_monitoring", label: "Отслеживание отзывов и вопросов покупателей", group: "reputation" },
  { key: "marketplace_promo_alerts", label: "Своевременное оповещение о предстоящих акциях на маркетплейсе", group: "storefront" },
  { key: "internal_ads_recommendations", label: "Составление рекомендаций по внутренней рекламе", group: "ads" },
  { key: "external_ads_recommendations", label: "Составление рекомендаций по внешней рекламе", group: "ads" },
  { key: "ad_bids_monitoring", label: "Корректировка и мониторинг ставок рекламной кампании", group: "ads" },
  { key: "infographic_ab_test", label: "A/B тест инфографики", group: "card-content" },
  { key: "rich_content_proposal", label: "Предложение по подготовке Рич-контента", group: "card-content" },
  { key: "external_ads_plan_launch", label: "Рекомендации и запуск внешней рекламы", group: "ads" },
  { key: "recommendations_block_setup", label: "Подготовка рекомендаций по настройке блока «с товаром рекомендуют»", group: "storefront" },
  { key: "video_content_recommendations", label: "Составление рекомендаций по видео-контенту", group: "card-content" },
  { key: "warehouse_supply_recommendations", label: "Составление рекомендаций по поставкам на склад", group: "operations" },
  { key: "storefront_design_recommendations", label: "Рекомендации по оформлению витрины магазина", group: "storefront" },
  { key: "store_banner_preparation", label: "Подготовка баннера для магазина", group: "storefront" },
  { key: "rich_content_preparation", label: "Подготовка Rich-контента для карточки товара", group: "card-content" },
  { key: "margin_calculation", label: "Расчет маржинальности", group: "operations" },
  { key: "stock_monitoring", label: "Мониторинг остатков", group: "operations" },
  { key: "review_points_proposal", label: "Предложение по подключению инструмента «Баллы за отзывы»", group: "reputation" },
  { key: "abc_analysis", label: "ABC-анализ", group: "analysis" },
  { key: "supply_proposal", label: "Предложение по поставке", group: "operations" },
  { key: "ad_campaign_report", label: "Составление отчета по рекламной кампании", group: "ads" },
  { key: "external_ads_proposal", label: "Предложение по внешней рекламе", group: "ads" },
  { key: "external_ads_connection", label: "Подключение внешней рекламы", group: "ads" },
  { key: "external_ads_report", label: "Составление отчета по внешней рекламе", group: "ads" },
  { key: "wb_guru_article_recommendations", label: "Подготовка рекомендаций по статье", group: "storefront" },
  { key: "wb_guru_article_content", label: "Подготовка визуала и текстового контента для статьи", group: "storefront" },
  { key: "keyword_positions_report", label: "Составление отчета по позициям ключевых запросов в карточках товара", group: "reports" },
  { key: "self_purchase_recommendations", label: "Рекомендации по самовыкупам", group: "ads" },
  { key: "sales_report", label: "Составление отчета о продажах", group: "reports" },
  { key: "work_done_report", label: "Составление отчета о проделанной работе", group: "reports" },
];

const legacyWorkPeriodTaskOptions = taskSectionOptions.map((item) => ({
  ...item,
  group: "legacy",
}));
const allWorkPeriodTaskOptions = [...workPeriodTaskOptions, ...legacyWorkPeriodTaskOptions];
const defaultWorkPeriodTaskKeys = workPeriodTaskOptions.map((item) => item.key);
const manualWorkPeriodTaskPrefix = "manual:";
const workPeriodAttachmentMaxBytes = 2 * 1024 * 1024;
const workPeriodActiveTaskStatuses = ["planned", "in_progress", "review", "done"];
const workPeriodTaskStatuses = [...workPeriodActiveTaskStatuses, "returned", "excluded"];

function taskWorkTypes(task) {
  return Array.isArray(task?.workTypes) && task.workTypes.length ? normalizeWorkTypes(task.workTypes) : [];
}

function taskSectionLabel(type) {
  return taskSectionOptions.find((item) => item.key === type)?.label || workTypeLabels([type])[0] || "Задача";
}

function taskBatchGroupTitle(group) {
  if (group.batchTitle) return group.batchTitle;
  const count = group.tasks.length;
  const comment = String(group.comment || "").trim();
  if (comment) {
    return `${taskSectionLabel(group.type)}: ${comment}`;
  }
  return `${taskSectionLabel(group.type)}: ${formatNumber(count)} ${pluralRu(count, "карточка", "карточки", "карточек")}`;
}

function taskGroupStatus(tasks) {
  const statuses = (tasks || []).map((task) => task.status);
  if (statuses.includes("submitted")) return "submitted";
  if (statuses.includes("changes_requested")) return "changes_requested";
  if (statuses.includes("approved")) return "approved";
  return "draft";
}

function taskBatchPosition(task, fallback = 0) {
  const value = Number(task?.batchPosition ?? task?.taskPosition ?? task?.position);
  return Number.isFinite(value) ? value : fallback;
}

function taskTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderedTaskItems(tasks) {
  return [...(Array.isArray(tasks) ? tasks : [])].sort((left, right) => (
    taskBatchPosition(left, 999999) - taskBatchPosition(right, 999999)
    || taskTimestamp(left.batchCreatedAt || left.submittedAt || left.updatedAt) - taskTimestamp(right.batchCreatedAt || right.submittedAt || right.updatedAt)
    || String(left.cardKey || "").localeCompare(String(right.cardKey || ""))
  ));
}

function moveArrayItem(items, index, delta) {
  const source = Array.isArray(items) ? items : [];
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || index >= source.length || targetIndex >= source.length) {
    return source;
  }
  const next = [...source];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function normalizeWorkPeriodTaskKeys(value, fallbackKeys = defaultWorkPeriodTaskKeys) {
  const allowed = new Set(allWorkPeriodTaskOptions.map((item) => item.key));
  const output = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const key = String(typeof item === "object" ? item?.key : item || "").trim();
    if (allowed.has(key) && !output.includes(key)) {
      output.push(key);
    }
  });
  return output.length ? output : fallbackKeys;
}

function cleanAttachmentFileName(value) {
  return String(value || "work-file")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .trim()
    .slice(0, 160) || "work-file";
}

function safeDownloadFileName(value) {
  return cleanAttachmentFileName(value).replace(/^\.+/, "") || "work-file";
}

function attachmentSizeLabel(size) {
  const bytes = Number(size) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("ru-RU")} КБ`;
  return `${formatNumber(bytes)} Б`;
}

function normalizeWorkPeriodAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const dataUrl = String(attachment.dataUrl || "");
  const name = cleanAttachmentFileName(attachment.name);
  const size = Math.max(0, Math.min(Number(attachment.size) || 0, workPeriodAttachmentMaxBytes));
  if (!dataUrl.startsWith("data:") || !name) return null;
  return {
    id: String(attachment.id || `attachment-${Date.now()}`).slice(0, 80),
    name,
    type: String(attachment.type || "application/octet-stream").slice(0, 120),
    size,
    dataUrl,
    uploadedAt: attachment.uploadedAt || "",
    uploadedBy: attachment.uploadedBy || "",
  };
}

function normalizeWorkPeriodAttachments(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeWorkPeriodAttachment)
    .filter(Boolean)
    .slice(0, 1);
}

function workPeriodAttachmentNames(task) {
  return normalizeWorkPeriodAttachments(task?.attachments).map((item) => item.name).join("; ");
}

function manualWorkPeriodTaskKey() {
  return `${manualWorkPeriodTaskPrefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isManualWorkPeriodTask(task) {
  return Boolean(task?.manual) || String(task?.key || "").startsWith(manualWorkPeriodTaskPrefix);
}

function normalizeWorkPeriodManualTasks(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((task) => {
      const key = String(task?.key || "").startsWith(manualWorkPeriodTaskPrefix) ? String(task.key) : manualWorkPeriodTaskKey();
      const label = String(task?.label || "").trim().slice(0, 180) || "Внеплановая работа";
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        key,
        label,
        manual: true,
        description: String(task?.description || "").trim().slice(0, 1600),
      };
    })
    .filter(Boolean);
}

function normalizeWorkPeriodTask(task) {
  const key = String(task?.key || "").trim();
  const option = allWorkPeriodTaskOptions.find((item) => item.key === key);
  const manualTask = !option && key.startsWith(manualWorkPeriodTaskPrefix);
  const fallbackOption = option || workPeriodTaskOptions[0];
  const status = workPeriodTaskStatuses.includes(task?.status) ? task.status : "planned";
  return {
    key: manualTask ? key : fallbackOption.key,
    label: manualTask ? (String(task?.label || "").trim() || "Внеплановая работа") : (task?.label || fallbackOption.label),
    manual: manualTask || Boolean(task?.manual),
    description: String(task?.description || "").trim(),
    status,
    comment: task?.comment || "",
    statusUpdatedAt: task?.statusUpdatedAt || "",
    statusUpdatedBy: task?.statusUpdatedBy || "",
    completedAt: task?.completedAt || "",
    completedBy: task?.completedBy || "",
    returnReason: task?.returnReason || "",
    returnedAt: task?.returnedAt || "",
    returnedBy: task?.returnedBy || "",
    exclusionReason: task?.exclusionReason || "",
    excludedAt: task?.excludedAt || "",
    excludedBy: task?.excludedBy || "",
    linkedTaskIds: Array.isArray(task?.linkedTaskIds) ? task.linkedTaskIds.map(String).filter(Boolean) : [],
    linkedBatchIds: Array.isArray(task?.linkedBatchIds) ? task.linkedBatchIds.map(String).filter(Boolean) : [],
    attachments: normalizeWorkPeriodAttachments(task?.attachments),
    history: Array.isArray(task?.history) ? task.history : [],
  };
}

function normalizeWorkPeriod(period) {
  const tasks = (Array.isArray(period?.tasks) ? period.tasks : [])
    .map(normalizeWorkPeriodTask)
    .filter((task, index, items) => items.findIndex((item) => item.key === task.key) === index);
  const cleanTasks = tasks.length ? tasks : defaultWorkPeriodTaskKeys.map((key) => normalizeWorkPeriodTask({ key }));
  const activeTasks = cleanTasks.filter((task) => task.status !== "excluded");
  const summary = period?.summary || {};
  const done = Number(summary.done ?? activeTasks.filter((task) => task.status === "done").length);
  const inProgress = Number(summary.inProgress ?? activeTasks.filter((task) => task.status === "in_progress").length);
  const review = Number(summary.review ?? activeTasks.filter((task) => task.status === "review").length);
  const returned = Number(summary.returned ?? activeTasks.filter((task) => task.status === "returned").length);
  const excluded = Number(summary.excluded ?? cleanTasks.filter((task) => task.status === "excluded").length);
  const total = Number(summary.total ?? activeTasks.length);
  return {
    id: String(period?.id || ""),
    portalId: String(period?.portalId || ""),
    title: period?.title || "",
    period: {
      start: period?.period?.start || period?.start || "",
      end: period?.period?.end || period?.end || "",
    },
    status: period?.status || "active",
    tasks: cleanTasks,
    summary: {
      total,
      done,
      inProgress,
      review,
      returned,
      excluded,
      planned: Number(summary.planned ?? activeTasks.filter((task) => task.status === "planned").length),
      progress: Number(summary.progress ?? (total ? Math.round((done / total) * 100) : 0)),
    },
    report: period?.report && typeof period.report === "object" ? period.report : {},
    createdBy: period?.createdBy || "",
    updatedBy: period?.updatedBy || "",
    createdAt: period?.createdAt || "",
    updatedAt: period?.updatedAt || "",
  };
}

function normalizeWorkPeriods(value) {
  return (Array.isArray(value) ? value : []).map(normalizeWorkPeriod);
}

function defaultWorkPeriodForm() {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 29);
  return {
    title: "",
    start: dateInputValue(start),
    end: dateInputValue(end),
    taskKeys: defaultWorkPeriodTaskKeys,
    manualTasks: [],
  };
}

function workPeriodTaskGroupMeta(groupKey) {
  if (groupKey === "legacy") return { key: "legacy", label: "Старые укрупненные пункты" };
  return workPeriodTaskGroups.find((group) => group.key === groupKey) || { key: "other", label: "Прочие работы" };
}

function workPeriodTaskGroupKey(task) {
  if (isManualWorkPeriodTask(task)) return "other";
  const option = allWorkPeriodTaskOptions.find((item) => item.key === task?.key);
  return option?.group || "other";
}

function workPeriodGroupedTasks(tasks) {
  const buckets = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const groupKey = workPeriodTaskGroupKey(task);
    const group = workPeriodTaskGroupMeta(groupKey);
    if (!buckets.has(group.key)) {
      buckets.set(group.key, { ...group, tasks: [] });
    }
    buckets.get(group.key).tasks.push(task);
  });
  const order = [...workPeriodTaskGroups.map((group) => group.key), "legacy", "other"];
  return Array.from(buckets.values()).sort((left, right) => {
    const leftIndex = order.includes(left.key) ? order.indexOf(left.key) : order.length;
    const rightIndex = order.includes(right.key) ? order.indexOf(right.key) : order.length;
    return leftIndex - rightIndex;
  });
}

function workPeriodFormFromPeriod(period) {
  const normalized = normalizeWorkPeriod(period);
  return {
    title: normalized.title,
    start: normalized.period.start,
    end: normalized.period.end,
    taskKeys: normalized.tasks
      .filter((task) => task.status !== "excluded" && !isManualWorkPeriodTask(task))
      .map((task) => task.key),
    manualTasks: normalizeWorkPeriodManualTasks(normalized.tasks.filter((task) => task.status !== "excluded" && isManualWorkPeriodTask(task))),
  };
}

function workPeriodTaskStatusLabel(status) {
  if (status === "in_progress") return "в работе";
  if (status === "review") return "на согласовании";
  if (status === "done") return "выполнено";
  if (status === "returned") return "возврат";
  if (status === "excluded") return "исключено";
  return "в плане";
}

function workPeriodTaskStatusTone(status) {
  if (status === "done") return "green";
  if (status === "review") return "violet";
  if (status === "in_progress") return "amber";
  if (status === "returned") return "red";
  if (status === "excluded") return "amber";
  return "blue";
}

function workPeriodStatus(period) {
  if (period?.status === "reported") return { label: "отчет готов", tone: "blue" };
  if (period?.summary?.total && period.summary.done >= period.summary.total) return { label: "выполнено", tone: "green" };
  if (period?.summary?.returned) return { label: "есть возврат", tone: "red" };
  if (period?.summary?.review) return { label: "на согласовании", tone: "violet" };
  if (period?.summary?.inProgress) return { label: "в работе", tone: "amber" };
  return { label: "в работе", tone: "amber" };
}

function workPeriodTaskDate(task) {
  const value = task.status === "done"
    ? task.completedAt
    : task.status === "returned"
      ? task.returnedAt
      : task.status === "excluded"
        ? task.excludedAt
        : task.statusUpdatedAt;
  return value ? new Date(value).toLocaleString("ru-RU") : "";
}

function workPeriodIsClosed(period, currentDate = new Date()) {
  const end = period?.period?.end || period?.end || "";
  if (!end) return false;
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(endDate.getTime())) return false;
  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);
  return today.getTime() >= endDate.getTime();
}

function workPeriodTodayKey(currentDate = new Date()) {
  return new Date(currentDate).toISOString().slice(0, 10);
}

function workPeriodLinkCandidates(periods, currentDate = new Date()) {
  const today = workPeriodTodayKey(currentDate);
  const active = normalizeWorkPeriods(periods)
    .filter((period) => period.status === "active" && !workPeriodIsClosed(period, currentDate));
  const current = active.filter((period) => {
    const start = period.period.start || "";
    return !start || start <= today;
  });
  return current.length ? current : active;
}

function workPeriodTaskLinkOptions(periods) {
  return workPeriodLinkCandidates(periods).flatMap((period) => (
    period.tasks
      .filter((task) => task.status !== "excluded")
      .map((task) => ({
        period,
        task,
        value: `${period.id}:${task.key}`,
        label: `${period.title || "Отчетный период"} · ${task.label}`,
      }))
  ));
}

function parseWorkPeriodTaskLinkValue(value) {
  const [periodId, ...taskParts] = String(value || "").split(":");
  return { periodId, taskKey: taskParts.join(":") };
}

function parseWorkPeriodTaskLinkValues(values) {
  const rawValues = Array.isArray(values) ? values : [values].filter(Boolean);
  const seen = new Set();
  return rawValues
    .map((item) => (typeof item === "object" && item !== null ? item : parseWorkPeriodTaskLinkValue(item)))
    .filter((target) => {
      if (!target.periodId || !target.taskKey) return false;
      const key = workPeriodTargetValue(target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function workPeriodTargetValue(target) {
  if (!target?.periodId || !target?.taskKey) return "";
  return `${target.periodId}:${target.taskKey}`;
}

function workPeriodLinkedLabel(task) {
  const taskCount = task.linkedTaskIds?.length || 0;
  const batchCount = task.linkedBatchIds?.length || 0;
  if (!taskCount && !batchCount) return "не привязано";
  return [`${taskCount} задач`, `${batchCount} пачек`].filter((item) => !item.startsWith("0 ")).join(", ");
}

function workPeriodTaskHasTaskLink(task, taskIds = [], batchIds = []) {
  const linkedTaskIds = new Set(task?.linkedTaskIds || []);
  const linkedBatchIds = new Set(task?.linkedBatchIds || []);
  return taskIds.some((item) => linkedTaskIds.has(item)) || batchIds.some((item) => linkedBatchIds.has(item));
}

function workPeriodLinksForGroup(periods, group) {
  const taskIds = [group?.key].filter(Boolean);
  const batchIds = taskIds.length ? [] : [group?.batchId].filter(Boolean);
  const links = [];
  for (const period of normalizeWorkPeriods(periods)) {
    period.tasks.forEach((task) => {
      if (!workPeriodTaskHasTaskLink(task, taskIds, batchIds)) return;
      links.push({
        period,
        task,
        value: `${period.id}:${task.key}`,
        label: `${period.title || "Отчетный период"} · ${task.label}`,
      });
    });
  }
  return links;
}

function workPeriodLinkLabelForGroup(periods, group) {
  const links = workPeriodLinksForGroup(periods, group);
  if (!links.length) return "";
  if (links.length <= 2) return links.map((link) => link.label).join("; ");
  return `${links.length} пунктов плана`;
}

function workPeriodRangeLabel(period) {
  const start = period?.period?.start || "";
  const end = period?.period?.end || "";
  return [start ? clientReportDateLabel(`${start}T00:00:00`) : "", end ? clientReportDateLabel(`${end}T00:00:00`) : ""].filter(Boolean).join(" - ");
}

function workPeriodEndDateLabel(period) {
  const end = period?.period?.end || period?.end || "";
  return end ? clientReportDateLabel(`${end}T00:00:00`) : "окончания периода";
}

function workPeriodTaskExportReason(task) {
  if (task.status === "returned") return task.returnReason || "возвращено без причины";
  if (task.status === "excluded") return task.exclusionReason || "исключено при корректировке плана";
  if (task.status === "in_progress") return "взято в работу";
  if (task.status === "review") return "ожидает согласования";
  if (task.status === "planned") return "не выполнено к моменту выгрузки";
  return "";
}

function workPeriodTaskExportComment(task) {
  return [task.description, task.comment].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
}

function workPeriodTaskExportDate(task) {
  if (task.status === "done") return task.completedAt ? new Date(task.completedAt).toLocaleString("ru-RU") : "";
  if (task.status === "returned") return task.returnedAt ? new Date(task.returnedAt).toLocaleString("ru-RU") : "";
  if (task.status === "excluded") return task.excludedAt ? new Date(task.excludedAt).toLocaleString("ru-RU") : "";
  if (["in_progress", "review", "planned"].includes(task.status)) return task.statusUpdatedAt ? new Date(task.statusUpdatedAt).toLocaleString("ru-RU") : "";
  return "";
}

function workPeriodTaskExportGroupLabel(task) {
  return workPeriodTaskGroupMeta(workPeriodTaskGroupKey(task)).label;
}

function workPeriodGroupSummary(group) {
  const activeTasks = group.tasks.filter((task) => task.status !== "excluded");
  const done = activeTasks.filter((task) => task.status === "done").length;
  const inProgress = activeTasks.filter((task) => task.status === "in_progress").length;
  const review = activeTasks.filter((task) => task.status === "review").length;
  const returned = activeTasks.filter((task) => task.status === "returned").length;
  const planned = activeTasks.filter((task) => task.status === "planned").length;
  const excluded = group.tasks.length - activeTasks.length;
  const total = activeTasks.length;
  return {
    ...group,
    total,
    done,
    inProgress,
    review,
    returned,
    planned,
    excluded,
    progress: total ? Math.round((done / total) * 100) : 0,
    notCompleted: activeTasks.filter((task) => task.status !== "done"),
    completed: activeTasks.filter((task) => task.status === "done"),
  };
}

function workPeriodReportGroupSummaries(period) {
  return workPeriodGroupedTasks(normalizeWorkPeriod(period).tasks).map(workPeriodGroupSummary);
}

function workPeriodReportStatusText(period) {
  const normalized = normalizeWorkPeriod(period);
  if (!normalized.summary.total) return "Нет активных работ";
  if (normalized.summary.done >= normalized.summary.total) return "Все активные работы выполнены";
  if (normalized.summary.returned) return "Есть возвраты и невыполненные пункты";
  if (normalized.summary.review) return "Есть пункты на согласовании";
  if (normalized.summary.inProgress) return "Есть пункты в работе";
  return "Есть невыполненные пункты";
}

function buildWorkPeriodWorkbookSheets(portal, period, mode = "plan") {
  const normalized = normalizeWorkPeriod(period);
  const generatedAt = new Date();
  const activeTasks = normalized.tasks.filter((task) => task.status !== "excluded");
  const groupSummaries = workPeriodReportGroupSummaries(normalized);
  const notCompletedTasks = activeTasks.filter((task) => task.status !== "done");
  const completedTasks = activeTasks.filter((task) => task.status === "done");
  const excludedTasks = normalized.tasks.filter((task) => task.status === "excluded");
  const rows = [
    [mode === "final" ? "Итоговый отчет по плану работ" : "План работ по кабинету", ""],
    ["Кабинет", portalDisplayName(portal)],
    ["Период", clientReportRangeLabel(normalized.period.start, normalized.period.end)],
    ["Название", normalized.title || "Рабочий период"],
    ["Дата выгрузки", generatedAt.toLocaleString("ru-RU")],
    ["Всего в плане", normalized.summary.total],
    ["Выполнено", normalized.summary.done],
    ["В работе", normalized.summary.inProgress || 0],
    ["На согласовании", normalized.summary.review || 0],
    ["Возвраты", normalized.summary.returned],
    ["Исключено из плана", normalized.summary.excluded || 0],
    ...(mode === "final" ? [["Итог", workPeriodReportStatusText(normalized)]] : []),
    [],
    ["Раздел", "Пункт плана", "Статус", "Дата действия", "Описание / комментарий", "Причина / пояснение", "Связанные задачи", "Файл"],
    ...normalized.tasks.map((task) => [
      workPeriodTaskExportGroupLabel(task),
      task.label,
      workPeriodTaskStatusLabel(task.status),
      workPeriodTaskExportDate(task),
      workPeriodTaskExportComment(task),
      workPeriodTaskExportReason(task),
      workPeriodLinkedLabel(task),
      workPeriodAttachmentNames(task),
    ]),
  ];
  const sheets = [{
    name: mode === "final" ? "Итоговый отчет" : "План работ",
    freezeRows: mode === "final" ? 14 : 13,
    widths: [30, 42, 18, 24, 52, 52, 28, 34],
    rows,
  }];
  if (mode === "final") {
    sheets.push({
      name: "Сводка",
      freezeRows: 1,
      widths: [34, 18, 72],
      rows: [
        ["Показатель", "Значение", "Комментарий"],
        ["Работ в плане", activeTasks.length, "Исключенные при корректировке пункты не входят в активный план."],
        ["Выполнено", normalized.summary.done, "Пункты со статусом выполнено."],
        ["В работе", normalized.summary.inProgress || 0, "Пункты со статусом в работе."],
        ["На согласовании", normalized.summary.review || 0, "Пункты, ожидающие согласования."],
        ["Не выполнено", Math.max(0, normalized.summary.total - normalized.summary.done), "Плановые, рабочие, согласуемые и возвращенные пункты на момент выгрузки."],
        ["Возвраты", normalized.summary.returned, "Пункты, возвращенные с причиной."],
        ["Исключено", normalized.summary.excluded || 0, "Пункты, убранные из плана в процессе периода."],
        ["Итог", workPeriodReportStatusText(normalized), "Короткий статус периода для руководителя."],
      ],
    });
    sheets.push({
      name: "По разделам",
      freezeRows: 1,
      widths: [34, 16, 16, 16, 16, 16, 16, 16, 16, 72],
      rows: [
        ["Раздел", "В плане", "Выполнено", "В работе", "На согласовании", "Не выполнено", "Возвраты", "Исключено", "Прогресс", "Причины / комментарии"],
        ...groupSummaries.map((group) => [
          group.label,
          group.total,
          group.done,
          group.inProgress || 0,
          group.review || 0,
          Math.max(0, group.total - group.done),
          group.returned,
          group.excluded,
          `${group.progress}%`,
          group.notCompleted.map((task) => `${task.label}: ${workPeriodTaskExportReason(task)}`).join("; "),
        ]),
      ],
    });
    sheets.push({
      name: "Не выполнено",
      freezeRows: 1,
      widths: [34, 48, 18, 28, 72, 40, 34],
      rows: [
        ["Раздел", "Пункт", "Статус", "Дата", "Причина / пояснение", "Описание / комментарий", "Файл"],
        ...(notCompletedTasks.length ? notCompletedTasks : []).map((task) => [
          workPeriodTaskExportGroupLabel(task),
          task.label,
          workPeriodTaskStatusLabel(task.status),
          workPeriodTaskExportDate(task),
          workPeriodTaskExportReason(task),
          workPeriodTaskExportComment(task),
          workPeriodAttachmentNames(task),
        ]),
        ...(!notCompletedTasks.length ? [["", "Все активные пункты выполнены", "", "", "", "", ""]] : []),
      ],
    });
    sheets.push({
      name: "Выполнено",
      freezeRows: 1,
      widths: [34, 48, 24, 32, 64, 34],
      rows: [
        ["Раздел", "Пункт", "Дата выполнения", "Исполнитель", "Описание / комментарий", "Файл"],
        ...(completedTasks.length ? completedTasks : []).map((task) => [
          workPeriodTaskExportGroupLabel(task),
          task.label,
          workPeriodTaskExportDate(task),
          task.completedBy || "",
          workPeriodTaskExportComment(task),
          workPeriodAttachmentNames(task),
        ]),
        ...(!completedTasks.length ? [["", "Нет выполненных пунктов", "", "", "", ""]] : []),
      ],
    });
    sheets.push({
      name: "Исключено",
      freezeRows: 1,
      widths: [34, 48, 24, 32, 72, 52],
      rows: [
        ["Раздел", "Пункт", "Дата исключения", "Кто исключил", "Причина", "Описание"],
        ...(excludedTasks.length ? excludedTasks : []).map((task) => [
          workPeriodTaskExportGroupLabel(task),
          task.label,
          workPeriodTaskExportDate(task),
          task.excludedBy || "",
          workPeriodTaskExportReason(task),
          task.description || "",
        ]),
        ...(!excludedTasks.length ? [["", "Исключенных пунктов нет", "", "", "", ""]] : []),
      ],
    });
  }
  return sheets;
}

function workPeriodExportFileName(portal, period, mode = "plan") {
  const normalized = normalizeWorkPeriod(period);
  const type = mode === "final" ? "итоговый-отчет" : "план-работ";
  const periodPart = `${normalized.period.start || "start"}-${normalized.period.end || "end"}`;
  return `${type}-${safeFilePart(portalDisplayName(portal))}-${safeFilePart(normalized.title || periodPart)}-${exportDatePart()}.xlsx`;
}

function buildTaskGroupsByType(tasks) {
  const groupsByType = Object.fromEntries(taskSectionOptions.map((section) => [section.key, []]));
  const groupMap = new Map();
  (tasks || []).forEach((task) => {
    taskWorkTypes(task).forEach((type) => {
      if (!groupsByType[type]) {
        groupsByType[type] = [];
      }
      const groupKey = `${type}:${task.batchId || task.cardKey || `${task.nmID || ""}-${task.vendorCode || ""}`}`;
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          type,
          batchId: task.batchId || "",
          batchTitle: task.batchTitle || "",
          comment: task.workComment || "",
          createdBy: task.batchCreatedBy || task.submittedBy || "",
          createdAt: task.batchCreatedAt || task.submittedAt || "",
          assigneeLogin: task.assigneeLogin || "",
          tasks: [],
        };
        groupMap.set(groupKey, group);
        groupsByType[type].push(group);
      }
      group.tasks.push(task);
    });
  });
  Object.values(groupsByType).forEach((groups) => {
    groups.forEach((group) => {
      group.tasks = orderedTaskItems(group.tasks);
    });
    groups.sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
  });
  return groupsByType;
}

function defaultApprovalWorkflow() {
  return {
    tasks: [],
    completedTasks: [],
    analytics: {
      pendingCount: 0,
      returnedCount: 0,
      approvedCount: 0,
      completedCount: 0,
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
    completedTasks: Array.isArray(value?.completedTasks) ? value.completedTasks : [],
    analytics: {
      pendingCount: Number(analytics.pendingCount || 0),
      returnedCount: Number(analytics.returnedCount || 0),
      approvedCount: Number(analytics.approvedCount || 0),
      completedCount: Number(analytics.completedCount || 0),
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
  const source = bootstrap.source || {};
  const isWbSeller = source.source === "wb-public-seller";
  const sourceLabel = isWbSeller ? "WB seller" : "MPStats";
  if (count > 0) {
    return action === "refresh"
      ? `${sourceLabel} обновил витрину: ${count} ${pluralRu(count, "карточка", "карточки", "карточек")}.`
      : `Кабинет создан, ${sourceLabel} загрузил ${count} ${pluralRu(count, "карточку", "карточки", "карточек")}.`;
  }
  const warning = Array.isArray(bootstrap.warnings) ? bootstrap.warnings[0] : "";
  if (warning) {
    return warning;
  }
  if (bootstrap.status === "skipped") {
    return "Кабинет создан без API. Добавьте ссылку на магазин, seller-ссылку или список nmID, чтобы загрузить карточки.";
  }
  return action === "refresh"
    ? `${sourceLabel} не нашел карточки по сохраненной ссылке или описанию.`
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

function wbPublicBasketNumber(nmID) {
  const nm = Number.parseInt(String(nmID || "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(nm)) {
    return 0;
  }
  const vol = Math.floor(nm / 100000);
  const limits = [
    143, 287, 431, 719, 1007, 1061, 1115, 1169, 1313, 1601,
    1655, 1919, 2045, 2189, 2405, 2621, 2837, 3053, 3269, 3485,
    3701, 3917, 4133, 4349, 4565, 4781, 5183, 5501, 5797, 6235,
    6553, 6861, 7205, 7597, 8081, 8533, 9017, 9437, 9885, 10293,
    10709, 11157, 11621, 12093, 12597, 13045, 13505, 13969, 14457,
    14941, 15421, 15881, 16369, 16853, 17333, 17817, 18297, 18777,
    19257,
  ];
  const index = limits.findIndex((limit) => vol <= limit);
  return index >= 0 ? index + 1 : limits.length;
}

function wbPublicImageUrl(nmID, size = "c246x328") {
  const nm = Number.parseInt(String(nmID || "").replace(/\D/g, ""), 10);
  const basket = wbPublicBasketNumber(nm);
  if (!Number.isFinite(nm) || !basket) {
    return "";
  }
  const vol = Math.floor(nm / 100000);
  const part = Math.floor(nm / 1000);
  return `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nm}/images/${size}/1.webp`;
}

function bestPhotoUrl(card) {
  const rawFields = rawFieldsForCard(card);
  const photos = Array.isArray(card?.photos) && card.photos.length
    ? card.photos
    : (Array.isArray(rawFields.photos) ? rawFields.photos : []);
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
  const storedUrl = safeHttpsUrl(card?.photoUrl || rawFields.photoUrl);
  if (storedUrl) {
    return storedUrl;
  }
  const rawMpstats = rawFields.mpstats || {};
  const cardMpstats = card?.mpstats || {};
  const isPublicSeller = rawMpstats.source === "wb-public-seller" || cardMpstats.source === "wb-public-seller";
  if (isPublicSeller) {
    return safeHttpsUrl(wbPublicImageUrl(card?.nmID || rawFields.nmID, "c246x328"));
  }
  return "";
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
    "нет описания": "В текущем снимке нет описания. Перед правками нужно подтянуть описание или заполнить его вручную.",
    "Пустые характеристики": `${sourceLabel} не вернул характеристики. Нужно сверить обязательные поля категории перед публикацией.`,
    "пустые характеристики": `${sourceLabel} не вернул характеристики. Нужно сверить обязательные поля категории перед публикацией.`,
    "Нет фото": "В текущем снимке нет фото. Нужно проверить медиа в кабинете WB перед аудитом.",
    "нет фото": "В текущем снимке нет фото. Нужно проверить медиа в кабинете WB перед аудитом.",
    "Нет названия": "У карточки нет названия. Нужно заполнить заголовок до 60 символов.",
    "нет названия": "У карточки нет названия. Нужно заполнить заголовок до 60 символов.",
    "Название длиннее 60": "Название превышает лимит WB. Нужно сократить его до 60 символов без потери смысла.",
    "название длиннее 60": "Название превышает лимит WB. Нужно сократить его до 60 символов без потери смысла.",
    "Габариты требуют проверки": "WB пометил габариты как требующие проверки. Перед публикацией нужно сверить размеры.",
    "габариты требуют проверки": "WB пометил габариты как требующие проверки. Перед публикацией нужно сверить размеры.",
  };
  return copies[issue] || `Карточка требует ручной проверки по данным из ${sourceLabel}.`;
}

function cardProblemReasons(card) {
  const reasons = [];
  const rawFields = rawFieldsForCard(card);
  const title = String(card?.title || "").trim();
  if (!title || title === "Карточка WB") {
    reasons.push("нет названия");
  } else if (title.length > 60) {
    reasons.push("название длиннее 60");
  }
  if (!String(card?.description || rawFields.description || "").trim()) {
    reasons.push("нет описания");
  }
  if (!rawCharacteristicItems(card).length) {
    reasons.push("пустые характеристики");
  }
  const photos = Array.isArray(card?.photos) ? card.photos : (Array.isArray(rawFields.photos) ? rawFields.photos : []);
  if (!photos.length && !card?.photoUrl && !rawFields.photoUrl) {
    reasons.push("нет фото");
  }
  const dimensions = card?.dimensions || rawFields.dimensions || {};
  if (dimensions?.isValid === false) {
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

function cardSourceLabelFromRaw(rawFields, portal) {
  const source = rawFields?.mpstats?.source || "";
  if (source === "wb-public-seller") {
    return "WB seller-витрина";
  }
  if (source === "wb-public-card-details") {
    return "публичный WB";
  }
  if (portal?.syncStatus === "mpstats-loaded" || Boolean(rawFields?.mpstats)) {
    return "MPStats";
  }
  return "WB API";
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
    ...cardDraftKeyCandidates(card),
    cardNmIdValue(card) ? `nm:${cardNmIdValue(card)}` : "",
    cardVendorCodeValue(card) ? `vendor:${cardVendorCodeValue(card)}` : "",
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

function cardMatchesApprovalTask(card, task) {
  if (!card || !task) return false;
  const taskCardKey = normalizeDraftKeyValue(task.cardKey);
  const taskNmId = normalizeDraftKeyValue(task.nmID);
  const taskVendorCode = normalizeDraftKeyValue(task.vendorCode);
  return Boolean(
    (taskCardKey && cardMatchesDraftKey(card, taskCardKey))
    || (taskNmId && cardNmIdValue(card) === taskNmId)
    || (taskVendorCode && cardVendorCodeValue(card) === taskVendorCode)
  );
}

function findCardForApprovalTask(cards, task) {
  return (Array.isArray(cards) ? cards : []).find((card) => cardMatchesApprovalTask(card, task)) || null;
}

function taskRunItemKey(item) {
  return item?.cardKey || item?.nmID || item?.vendorCode || "";
}

function taskHasSemanticFinal(task) {
  return Boolean(task?.hasSemanticCoreFinal || task?.semanticCoreFinalSaved || task?.semanticCoreFinal);
}

const taskBatchFilterOptions = [
  { key: "all", label: "Все" },
  { key: "todo", label: "Незавершенные" },
  { key: "returned", label: "Возвращенные" },
  { key: "semantic-missing", label: "Без итогового СЯ", semanticOnly: true },
];

function taskMatchesBatchFilter(task, filterKey, workType) {
  if (filterKey === "todo") {
    return task?.status === "draft";
  }
  if (filterKey === "returned") {
    return task?.status === "changes_requested";
  }
  if (filterKey === "semantic-missing") {
    return workType === "semantic" && !taskHasSemanticFinal(task);
  }
  return true;
}

function batchAuditTaskKey(task) {
  return String(task?.cardKey || task?.nmID || task?.vendorCode || "").trim();
}

function batchAuditErrorText(errorObject) {
  const code = String(errorObject?.payload?.error || errorObject?.message || "request_failed");
  const reason = String(errorObject?.payload?.reason || "");
  if (errorObject?.status === 401) return "Сессия истекла";
  if (errorObject?.status === 403 || code === "forbidden") return "Нет доступа к кабинету";
  if (code === "card_not_found") return "Карточка не найдена в кабинете";
  if (code === "task_not_found") return "Задача карточки не найдена";
  if (code === "secret_storage_unavailable") return "Не удалось прочитать ключи интеграций";
  if (reason === "invalid_audit_result") return "Некорректный формат ответа аудита";
  if (reason === "timeout") return "Таймаут внешнего источника";
  if (reason === "service_secret_unavailable") return "Не удалось прочитать ключи интеграций";
  if (code === "audit_task_failed") return reason ? `Ошибка аудита: ${reason}` : "Backend не завершил аудит";
  if (errorObject?.status >= 500) return reason ? `Ошибка backend: ${reason}` : "Ошибка backend";
  return code;
}

function batchContentErrorText(errorObject) {
  const code = String(errorObject?.payload?.error || errorObject?.message || "request_failed");
  const reason = String(errorObject?.payload?.reason || "");
  if (errorObject?.status === 401) return "Сессия истекла";
  if (errorObject?.status === 403 || code === "forbidden") return "Нет доступа к кабинету";
  if (code === "unsupported_marketplace" || reason === "unsupported_marketplace") return "Для этого маркетплейса нужна своя методология";
  if (code === "semantic_final_missing" || reason === "semantic_final_missing") return "Нет итогового СЯ";
  if (code === "missing_semantic_keywords" || reason === "missing_semantic_keywords") return "Нет ключей для переоптимизации";
  if (code === "llm_key_missing" || reason === "llm_key_missing") return "GigaChat не подключен";
  if (code === "card_not_found") return "Карточка не найдена в кабинете";
  if (code === "task_not_found") return "Задача карточки не найдена";
  if (code === "content_reoptimization_task_failed") return reason ? `Ошибка переоптимизации: ${reason}` : "Backend не завершил переоптимизацию";
  if (errorObject?.status === 502) return reason ? `LLM: ${reason}` : "LLM не подготовил контент";
  if (errorObject?.status >= 500) return reason ? `Ошибка backend: ${reason}` : "Ошибка backend";
  return code;
}

function batchAuditFailureLabel(item) {
  return item?.title || item?.vendorCode || item?.nmID || item?.cardKey || "Карточка";
}

function taskCardWorkStatus(task, workType) {
  if (workType === "semantic") {
    return taskHasSemanticFinal(task)
      ? { label: "СЯ готово", tone: "green" }
      : { label: "без итогового СЯ", tone: "amber" };
  }
  if (task?.status === "changes_requested") {
    return { label: "возврат", tone: "red" };
  }
  if (task?.status === "submitted") {
    const submittedLabel = {
      content: "контент отправлен",
      prices: "цены отправлены",
      stocks: "остатки отправлены",
    }[workType] || "отправлено";
    return { label: submittedLabel, tone: "amber" };
  }
  if (task?.status === "approved" || task?.status === "exported") {
    return { label: task.status === "exported" ? "выгружено" : "принято", tone: "green" };
  }
  return { label: "в работе", tone: "blue" };
}

function buildTaskRunContext(cards, group, workType, startTask) {
  const taskItems = Array.isArray(group?.tasks) ? group.tasks : [];
  const seen = new Set();
  const items = taskItems.map((task) => {
    const card = findCardForApprovalTask(cards, task);
    if (!card) return null;
    const key = cardDraftKey(card) || task.cardKey || String(task.nmID || task.vendorCode || "");
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return {
      cardKey: key,
      nmID: cardNmIdValue(card) || task.nmID || "",
      vendorCode: cardVendorCodeValue(card) || task.vendorCode || "",
      title: card.title || task.title || "Карточка",
      subjectName: card.subjectName || task.subjectName || "",
      status: task.status || "",
      hasSemanticCoreFinal: taskHasSemanticFinal(task),
    };
  }).filter(Boolean);
  if (!items.length) return null;
  const startCard = findCardForApprovalTask(cards, startTask);
  const startKey = startCard ? cardDraftKey(startCard) : normalizeDraftKeyValue(startTask?.cardKey);
  const currentIndex = Math.max(0, items.findIndex((item) => taskRunItemKey(item) === startKey));
  return {
    title: taskBatchGroupTitle(group),
    workType,
    workTypeLabel: taskSectionLabel(workType),
    batchId: group?.batchId || "",
    total: items.length,
    currentIndex,
    items,
  };
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

function normalizeBulkCardToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/gi, "")
    .trim();
}

function bulkCardTokensFromText(value) {
  const seen = new Set();
  const output = [];
  const addToken = (token) => {
    const normalized = normalizeBulkCardToken(token);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  };
  String(value || "")
    .split(/[\n\r\t,;]+/)
    .forEach((chunk) => {
      const raw = chunk.trim();
      if (!raw) return;
      const catalogMatch = raw.match(/\/catalog\/(\d+)/i);
      const longNumberMatches = raw.match(/\d{5,}/g) || [];
      if (catalogMatch) addToken(catalogMatch[1]);
      longNumberMatches.forEach(addToken);
      if (!catalogMatch && !(longNumberMatches.length && /\s/.test(raw))) {
        addToken(raw);
      }
    });
  return output;
}

function cardBulkIdentifiers(card) {
  const rawFields = card?.rawFields && typeof card.rawFields === "object" ? card.rawFields : {};
  const values = [
    cardStableKey(card),
    card?.nmID,
    card?.nmId,
    card?.id,
    card?.vendorCode,
    card?.supplierArticle,
    card?.barcode,
    rawFields.nmID,
    rawFields.nmId,
    rawFields.vendorCode,
    rawFields.supplierArticle,
    rawFields.barcode,
  ];
  const sizes = Array.isArray(card?.sizes) ? card.sizes : Array.isArray(rawFields.sizes) ? rawFields.sizes : [];
  sizes.forEach((size) => {
    values.push(size?.chrtID, size?.chrtId, size?.techSize, size?.wbSize);
    (Array.isArray(size?.skus) ? size.skus : []).forEach((sku) => values.push(sku));
  });
  return new Set(values.map(normalizeBulkCardToken).filter(Boolean));
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

function currentCardCharacteristicItems(card) {
  const raw = card?.rawFields?.characteristics;
  return Array.isArray(raw) ? raw : rawCharacteristicItems(card);
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
  const seenKeys = new Map();
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
    const baseKey = charcID ? `charc:${charcID}` : characteristicKeyFromName(label);
    const keyCount = (seenKeys.get(baseKey) || 0) + 1;
    seenKeys.set(baseKey, keyCount);
    return {
      key: keyCount > 1 ? `${baseKey}#${keyCount}` : baseKey,
      label,
      value,
      charcID,
    };
  });
}

function characteristicDisplayValue(value) {
  if (isEmptyValue(value)) {
    return "Пусто";
  }
  if (Array.isArray(value)) {
    const values = value
      .map(characteristicDisplayValue)
      .filter((item) => item && item !== "Пусто");
    return values.length ? values.join(", ") : "Пусто";
  }
  if (typeof value === "object") {
    return characteristicDisplayValue(value.value || value.name || value.charcName || value.values || "");
  }
  return String(value);
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

function characteristicKeyFromName(name) {
  const normalizedName = normalizedCharacteristicName(name);
  return normalizedName ? `charc-name:${normalizedName}` : "";
}

function characteristicKeyFromDraft(key, draft) {
  const draftObject = draft && typeof draft === "object" ? draft : {};
  if (draftObject.charcID) {
    return `charc:${draftObject.charcID}`;
  }
  const labelKey = characteristicKeyFromName(draftObject.label || draftObject.name || "");
  if (labelKey) {
    return labelKey;
  }
  if (String(key || "").startsWith("charc-name:")) {
    return key;
  }
  return key || "";
}

function characteristicMetaLookup(items = []) {
  return (items || []).reduce((lookup, item) => {
    const primaryKey = characteristicKeyFromMeta(item);
    const nameKey = characteristicKeyFromName(item?.name || item?.label || "");
    if (primaryKey && !lookup[primaryKey]) {
      lookup[primaryKey] = item;
    }
    if (nameKey && !lookup[nameKey]) {
      lookup[nameKey] = item;
    }
    return lookup;
  }, {});
}

function mergeDraftCharacteristic(left, right) {
  const values = [];
  [...draftCharacteristicValues(left), ...draftCharacteristicValues(right)].forEach((value) => {
    const normalizedValue = normalizedCharacteristicOption(value);
    if (normalizedValue && !values.some((item) => normalizedCharacteristicOption(item) === normalizedValue)) {
      values.push(value);
    }
  });
  const next = {
    ...(left || {}),
    ...(right || {}),
  };
  if (values.length) {
    next.value = values.join(", ");
    next.values = values;
  } else {
    next.values = draftCharacteristicValues(next);
  }
  return next;
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
  const metaByKey = characteristicMetaLookup(availableCharacteristics);
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
  return Object.entries(drafts || {}).reduce((normalized, [key, draft]) => {
    const draftObject = draft && typeof draft === "object" ? draft : { value: draft };
    const normalizedKey = characteristicKeyFromDraft(key, draftObject);
    if (!normalizedKey) {
      return normalized;
    }
    const nextDraft = {
      ...draftObject,
      values: draftCharacteristicValues(draftObject),
    };
    normalized[normalizedKey] = normalized[normalizedKey]
      ? mergeDraftCharacteristic(normalized[normalizedKey], nextDraft)
      : nextDraft;
    return normalized;
  }, {});
}

function characteristicKeyFromMeta(item) {
  return item?.charcID ? `charc:${item.charcID}` : characteristicKeyFromName(item?.name || item?.label || "");
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

const descriptionKeywordStopwords = new Set([
  "для",
  "без",
  "или",
  "при",
  "под",
  "над",
  "как",
  "что",
  "это",
  "все",
]);

const descriptionGenericSingleKeywords = new Set([
  "очк",
  "очки",
  "очков",
  "очкам",
  "очками",
  "линз",
  "линза",
  "линзы",
  "товар",
  "модель",
  "аксессуар",
]);

const descriptionKeywordTones = ["blue", "green", "amber", "violet", "red", "slate"];

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
  const metaByKey = characteristicMetaLookup(availableCharacteristics);
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
  const metaByKey = characteristicMetaLookup(availableCharacteristics);
  return rows.filter((row) => {
    const meta = metaByKey[row.key] || row;
    return mpstatsValuesForCharacteristic(meta, mpstatsCharacteristics).length > 0;
  }).length;
}

function countPromotionRelevantCharacteristics(rows, availableCharacteristics = [], mpstatsCharacteristics = []) {
  const metaByKey = characteristicMetaLookup(availableCharacteristics);
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

function cardExportArticle(card, draft = null) {
  return String(
    card?.vendorCode
    || draft?.vendorCode
    || card?.nmID
    || draft?.nmID
    || card?.cardKey
    || draft?.cardKey
    || "card"
  ).trim();
}

function cardExportSheetName(card, draft, usedNames) {
  return safeSheetName(cardExportArticle(card, draft), `WB ${card?.nmID || draft?.nmID || "card"}`, usedNames);
}

function semanticCoreExportSheetRows(currentRows, rankingRows, selectedRows, removalRows, appendRows = 0) {
  const rowCount = Math.max(currentRows.length, rankingRows.length, selectedRows.length, removalRows.length) + appendRows;
  return [
    [
      "Ключи в карточке (действующие)",
      "Ранжируемые ключи",
      "Позиция ранжируемого ключа",
      "Ключ к добавлению",
      "Частота запроса ключа к добавлению",
      "Согласование добавления",
      "Ключ к удалению из карточки",
      "Причина удаления",
      "Согласование удаления",
    ],
    ...Array.from({ length: rowCount }, (_, index) => [
      currentRows[index]?.query || "",
      rankingRows[index]?.query || "",
      semanticRankExportValue(rankingRows[index]?.position),
      selectedRows[index]?.query || { value: "", style: 2 },
      selectedRows[index]?.query ? semanticFrequencyValue(selectedRows[index]) : { value: "", style: 2 },
      selectedRows[index]?.query ? { value: "Да", style: 2 } : { value: "", style: 2 },
      removalRows[index]?.query || { value: "", style: 2 },
      removalRows[index]?.query ? { value: semanticRemovalReason(removalRows[index]), style: 2 } : { value: "", style: 2 },
      removalRows[index]?.query ? { value: "Да", style: 2 } : { value: "", style: 2 },
    ]),
  ];
}

function buildSemanticCoreExportSheet(name, core, selectedRows, removalRows = []) {
  const currentRows = semanticCurrentContentRows(core);
  const selectedRowsNormalized = semanticSelectedExportRows(selectedRows, core);
  const removalRowsNormalized = semanticRemovalExportRows(removalRows, core);
  const rankingRows = semanticCurrentPositionRows(core);
  if (!currentRows.length && !rankingRows.length && !selectedRowsNormalized.length && !removalRowsNormalized.length) {
    return null;
  }
  const tableRowCount = Math.max(currentRows.length, rankingRows.length, selectedRowsNormalized.length, removalRowsNormalized.length) + semanticManualAppendRows;
  const agreementEndRow = Math.max(tableRowCount + 1, 2);
  return {
    name,
    freezeRows: 1,
    widths: [48, 48, 22, 48, 32, 22, 48, 54, 22],
    rows: semanticCoreExportSheetRows(currentRows, rankingRows, selectedRowsNormalized, removalRowsNormalized, semanticManualAppendRows),
    protected: true,
    dataValidations: tableRowCount ? [{
      type: "list",
      range: `F2:F${agreementEndRow}`,
      formula1: '"Да,Нет"',
      allowBlank: true,
    }, {
      type: "list",
      range: `I2:I${agreementEndRow}`,
      formula1: '"Да,Нет"',
      allowBlank: true,
    }] : [],
  };
}

function buildSemanticCoreInstructionSheet(card = null) {
  const hasCard = Boolean(card?.nmID || card?.vendorCode || card?.title);
  const target = hasCard
    ? `карточки WB ${card?.nmID || ""}, артикул ${cardExportArticle(card)}`
    : "по выбранным карточкам кабинета";
  return {
    name: "Инструкция",
    widths: [34, 100],
    rows: [
      ["Раздел", "Описание"],
      ["Файл", `Семантическое ядро ${target}. Файл нужен для согласования новых ключей и запросов к исключению перед обновлением контента.`],
      ["Ключи в карточке (действующие)", "Ключи, которые уже заложены в текущий заголовок или описание карточки. По ним карточка может не иметь позиции."],
      ["Ранжируемые ключи", "Запросы из MPStats, по которым карточка уже ранжируется."],
      ["Позиция ранжируемого ключа", "Позиция карточки по ранжируемому запросу за период MPStats."],
      ["Ключ к добавлению", "Новый запрос из MPStats, которого нет среди действующих ключей карточки и ранжируемых запросов."],
      ["Частота запроса ключа к добавлению", "Частотность WB по запросу из MPStats."],
      ["Согласование добавления", "Поменяйте только этот столбец: Да - ключ согласован, Нет - ключ не нужно добавлять. По умолчанию для всех ключей к добавлению стоит Да."],
      ["Ключ к удалению из карточки", "Действующий ключ или ранжирующийся запрос, который специалист предлагает исключить перед переоптимизацией."],
      ["Причина удаления", "Почему ключ не нужен: нерелевантный, спорный, мешает позиционированию или больше не должен участвовать в переоптимизации."],
      ["Согласование удаления", "Да - после согласования специалист вручную удаляет ключ в SEO карточки WB и переоптимизирует текст без него. Нет - ключ оставить."],
      ["Защита", "Заполненные данные защищены от редактирования. Для будущей обратной загрузки меняйте только значения Да/Нет в столбцах согласования. Дополнительные ключи можно дописать в пустые строки блоков добавления или удаления."],
    ],
  };
}

function normalizeSemanticFinalExport(value) {
  if (!value || typeof value !== "object") return null;
  const semanticCore = compactSemanticCore(value.semanticCore);
  if (!semanticCore) return null;
  return {
    id: String(value.id || value.reportId || `semantic-final-${Date.parse(value.createdAt || "") || "draft"}`).trim(),
    reportId: String(value.reportId || value.id || "").trim(),
    createdAt: value.createdAt || "",
    updatedAt: value.updatedAt || value.createdAt || "",
    createdBy: String(value.createdBy || ""),
    updatedBy: String(value.updatedBy || value.createdBy || ""),
    seedQuery: value.seedQuery || semanticCore.seedQuery || "",
    subjectFilter: value.subjectFilter || "",
    selected: normalizeSemanticSelection(value.selected),
    removal: normalizeSemanticRemoval(value.removal || value.removed || value.toRemove),
    semanticCore,
  };
}

function semanticFinalExportFromCore(core, selectedRows, options = {}) {
  const semanticCore = compactSemanticCore(core);
  if (!semanticCore) return null;
  const createdAt = options.createdAt || new Date().toISOString();
  const reportId = String(options.reportId || "").trim();
  return normalizeSemanticFinalExport({
    id: `semantic-final-${reportId || Date.parse(createdAt) || Date.now()}`,
    reportId,
    createdAt,
    updatedAt: createdAt,
    createdBy: options.createdBy || "",
    updatedBy: options.updatedBy || options.createdBy || "",
    seedQuery: options.seedQuery || semanticCore.seedQuery || "",
    subjectFilter: options.subjectFilter || "",
    selected: normalizeSemanticSelection(selectedRows),
    removal: normalizeSemanticRemoval(options.removalRows),
    semanticCore,
  });
}

function semanticFinalExportSignature(finalExport) {
  const normalized = normalizeSemanticFinalExport(finalExport);
  if (!normalized) return "";
  const selectedKeys = normalized.selected.map(semanticQueryKey).filter(Boolean).sort().join("|");
  const removalKeys = normalized.removal.map(semanticQueryKey).filter(Boolean).sort().join("|");
  const core = normalized.semanticCore || {};
  const contentKeys = semanticCurrentContentRows(core).map(semanticQueryKey).filter(Boolean).sort().join("|");
  const rankingKeys = semanticCurrentPositionRows(core)
    .map((row) => {
      const key = semanticQueryKey(row);
      return key ? `${key}:${semanticRankExportValue(row.position)}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");
  const selectedExportKeys = semanticSelectedExportRows(normalized.selected, core)
    .map((row) => {
      const key = semanticQueryKey(row);
      return key ? `${key}:${semanticFrequencyValue(row)}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");
  return [
    normalized.reportId,
    normalized.seedQuery,
    selectedKeys,
    removalKeys,
    contentKeys,
    rankingKeys,
    selectedExportKeys,
  ].join("::");
}

function semanticExportCoreFromDraft(draft, card) {
  const normalized = contentFromStoredDraft(draft, card);
  const finalExport = normalizeSemanticFinalExport(normalized.semanticCoreFinal);
  if (!finalExport) {
    return { core: null, selected: [], removal: [] };
  }
  const selected = normalizeSemanticSelection(finalExport.selected);
  const removal = normalizeSemanticRemoval(finalExport.removal);
  const core = semanticCoreWithSelection(finalExport.semanticCore, selected);
  return { core, selected, removal };
}

function buildPortalSemanticCoreSheets(cards, drafts) {
  const cardsByKey = cardsByDraftKey(cards);
  const cardsByNm = new Map(cards.map((card) => [String(card?.nmID || ""), card]).filter(([key]) => key));
  const cardsByVendor = new Map(cards.map((card) => [String(card?.vendorCode || ""), card]).filter(([key]) => key));
  const usedNames = new Set();
  const cardSheets = (Array.isArray(drafts) ? drafts : [])
    .map((draft) => {
      const card = cardsByKey.get(draft.cardKey) || cardsByNm.get(String(draft.nmID || "")) || cardsByVendor.get(String(draft.vendorCode || "")) || {};
      const { core, selected, removal } = semanticExportCoreFromDraft(draft, card);
      return buildSemanticCoreExportSheet(cardExportSheetName(card, draft, usedNames), core, selected, removal);
    })
    .filter(Boolean);
  return cardSheets.length ? [buildSemanticCoreInstructionSheet(), ...cardSheets] : [];
}

function semanticImportHasChanges(preview) {
  const summary = preview?.summary || {};
  return Boolean(
    Number(summary.selectedToAdd || 0)
    || Number(summary.removalToApply || 0)
    || Number(summary.rejectedAdditions || 0)
    || Number(summary.rejectedRemovals || 0)
  );
}

function semanticImportSummaryText(preview) {
  const summary = preview?.summary || {};
  const parts = [
    `${formatNumber(summary.cardsMatched)} ${pluralRu(summary.cardsMatched, "карточка", "карточки", "карточек")}`,
    `${formatNumber(summary.selectedToAdd)} к добавлению`,
    `${formatNumber(summary.removalToApply)} к удалению`,
  ];
  const rejected = Number(summary.rejectedAdditions || 0) + Number(summary.rejectedRemovals || 0);
  if (rejected) parts.push(`${formatNumber(rejected)} отклонено`);
  if (summary.unmatchedRows) parts.push(`${formatNumber(summary.unmatchedRows)} не сопоставлено`);
  if (summary.unknownRows) parts.push(`${formatNumber(summary.unknownRows)} без понятного Да/Нет`);
  return parts.join(" · ");
}

function semanticImportStatusLabel(status, error) {
  if (status === "reading") return "Читаем файл...";
  if (status === "previewing") return "Проверяем сопоставление...";
  if (status === "applying") return "Применяем согласование...";
  if (status === "applied") return "Согласованное СЯ загружено.";
  if (status === "preview") return "Предпросмотр готов.";
  if (status === "error") return error || "Импорт не выполнен.";
  return "";
}

function SemanticCoreImportPanel({ status = "", error = "", preview = null, onPickFile, onApply, disabled = false, title = "Загрузить согласованное СЯ", applyTitle = "Применить СЯ" }) {
  const inputRef = useRef(null);
  const busy = ["reading", "previewing", "applying"].includes(status);
  const canApply = Boolean(preview && semanticImportHasChanges(preview) && !busy && !disabled);
  const statusLabel = semanticImportStatusLabel(status, error);
  const visibleCards = (Array.isArray(preview?.cards) ? preview.cards : [])
    .filter((item) => (item.selected?.length || item.removal?.length || item.rejectedSelected?.length || item.rejectedRemoval?.length))
    .slice(0, 5);
  const usesDefaultAgreement = (Array.isArray(preview?.sheets) ? preview.sheets : [])
    .some((sheet) => sheet.agreementDefaults?.addition || sheet.agreementDefaults?.removal);
  return (
    <div className="semantic-import-panel">
      <div className="panel-actions semantic-import-actions">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv,.txt,.tsv"
          className="hidden-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPickFile?.(file);
            event.target.value = "";
          }}
        />
        <button className={loadingButtonClass("btn", busy && status !== "applying")} type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy} aria-busy={(busy && status !== "applying") || undefined}>
          <Upload size={16} />{busy && status !== "applying" ? "Проверяем файл" : title}
        </button>
        <button className={loadingButtonClass("btn primary", status === "applying")} type="button" onClick={onApply} disabled={!canApply} aria-busy={status === "applying" || undefined}>
          <CheckSquare size={16} />{status === "applying" ? "Применяем" : applyTitle}
        </button>
      </div>
      {statusLabel ? <p className={`status-note ${status === "error" ? "error" : ""}`}>{statusLabel}</p> : null}
      {preview ? (
        <div className="semantic-import-preview">
          <div className="semantic-import-preview-head">
            <strong>{semanticImportSummaryText(preview)}</strong>
            <Tag tone={preview.summary?.unmatchedRows || preview.summary?.unknownRows ? "amber" : "green"}>{preview.fileName || "файл"}</Tag>
          </div>
          {visibleCards.length ? (
            <div className="semantic-import-card-list">
              {visibleCards.map((item) => (
                <div className="semantic-import-card-row" key={item.cardKey}>
                  <span>{item.vendorCode || item.nmID || item.cardKey}</span>
                  <strong>{formatNumber(item.selected?.length || 0)} добавить · {formatNumber(item.removal?.length || 0)} удалить</strong>
                  <em>{item.matchStrategy || "сопоставлено"}</em>
                </div>
              ))}
            </div>
          ) : null}
          {preview.unmatched?.length ? <span className="status-note">Есть строки без карточки: проверьте артикулы, WB ID или название листа.</span> : null}
          {usesDefaultAgreement ? <span className="status-note">В части листов нет колонки Да/Нет: предпросмотр считает найденные ключи согласованными только после кнопки Применить.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function buildFinalContentCardSheets(card, draftTitle, draftDescription, draftCharacteristics) {
  const characteristics = draftCharacteristicsList(draftCharacteristics);
  return [
    {
      name: "Заголовок",
      freezeRows: 1,
      widths: [24, 18, 64],
      rows: [
        ["Артикул продавца", "Номенклатура WB", "Итоговый заголовок"],
        [card?.vendorCode || "", card?.nmID || "", draftTitle || ""],
      ],
    },
    {
      name: "Описание",
      freezeRows: 1,
      widths: [24, 18, 96],
      rows: [
        ["Артикул продавца", "Номенклатура WB", "Итоговое описание"],
        [card?.vendorCode || "", card?.nmID || "", draftDescription || ""],
      ],
    },
    {
      name: "Характеристики",
      freezeRows: 1,
      widths: [24, 18, 34, 14, 56],
      rows: [
        ["Артикул продавца", "Номенклатура WB", "Характеристика", "charcID", "Значение"],
        ...characteristics.map((item) => [
          card?.vendorCode || "",
          card?.nmID || "",
          item.name,
          item.charcID,
          characteristicExportText(item.value),
        ]),
      ],
    },
  ];
}

function contentApprovalStatusExportable(status) {
  return ["submitted", "approved", "exported"].includes(String(status || ""));
}

function buildPortalContentSheet(card, draft, usedNames) {
  const normalized = contentFromStoredDraft(draft, card);
  const contentApproval = normalizeApprovalState(normalized.approvalSections.content);
  if (!contentApprovalStatusExportable(contentApproval.status)) {
    return null;
  }
  const characteristics = draftCharacteristicsList(normalized.characteristics);
  const characteristicHeaders = characteristics.map((item) => item.name);
  const characteristicValues = characteristics.map((item) => characteristicExportText(item.value));
  return {
    name: cardExportSheetName(card, draft, usedNames),
    freezeRows: 1,
    widths: [24, 18, 28, 22, 64, 96, ...characteristicHeaders.map(() => 28)],
    rows: [
      ["Артикул продавца", "Номенклатура WB", "Предмет", "Статус", "Заголовок", "Описание", ...characteristicHeaders],
      [
        card?.vendorCode || draft?.vendorCode || "",
        card?.nmID || draft?.nmID || "",
        card?.subjectName || "",
        approvalStatusLabel(contentApproval.status),
        normalized.title || "",
        normalized.description || "",
        ...characteristicValues,
      ],
    ],
  };
}

function buildPortalContentSheets(cards, drafts) {
  const cardsByKey = cardsByDraftKey(cards);
  const cardsByNm = new Map(cards.map((card) => [String(card?.nmID || ""), card]).filter(([key]) => key));
  const cardsByVendor = new Map(cards.map((card) => [String(card?.vendorCode || ""), card]).filter(([key]) => key));
  const usedNames = new Set();
  return (Array.isArray(drafts) ? drafts : [])
    .map((draft) => {
      const card = cardsByKey.get(draft.cardKey) || cardsByNm.get(String(draft.nmID || "")) || cardsByVendor.get(String(draft.vendorCode || "")) || {};
      return buildPortalContentSheet(card, draft, usedNames);
    })
    .filter(Boolean);
}

function normalizeDraftKeyValue(value) {
  const text = String(value ?? "").trim();
  return text && text !== "undefined" && text !== "null" ? text : "";
}

function uniqueDraftKeyValues(values) {
  const seen = new Set();
  const output = [];
  values.forEach((value) => {
    const text = normalizeDraftKeyValue(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });
  return output;
}

function cardNmIdValue(card) {
  const rawFields = rawFieldsForCard(card);
  return uniqueDraftKeyValues([
    card?.nmID,
    card?.nmId,
    card?.nm_id,
    rawFields.nmID,
    rawFields.nmId,
    rawFields.nm_id,
    card?.id,
    rawFields.id,
  ])[0] || "";
}

function cardVendorCodeValue(card) {
  const rawFields = rawFieldsForCard(card);
  return uniqueDraftKeyValues([
    card?.vendorCode,
    card?.vendor_code,
    card?.supplierArticle,
    rawFields.vendorCode,
    rawFields.vendor_code,
    rawFields.supplierArticle,
  ])[0] || "";
}

function cardDraftKeyCandidates(card) {
  const rawFields = rawFieldsForCard(card);
  return uniqueDraftKeyValues([
    cardNmIdValue(card),
    cardVendorCodeValue(card),
    card?.nmUUID,
    card?.nmUuid,
    card?.nm_uuid,
    rawFields.nmUUID,
    rawFields.nmUuid,
    rawFields.nm_uuid,
    card?.cardKey,
    rawFields.cardKey,
  ]);
}

function cardDraftKey(card) {
  return cardDraftKeyCandidates(card)[0] || "card";
}

function cardMatchesDraftKey(card, key) {
  const normalizedKey = normalizeDraftKeyValue(key);
  return Boolean(normalizedKey && cardDraftKeyCandidates(card).includes(normalizedKey));
}

function cardsByDraftKey(cards) {
  const output = new Map();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    cardDraftKeyCandidates(card).forEach((key) => {
      if (!output.has(key)) {
        output.set(key, card);
      }
    });
  });
  return output;
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
  semanticCoreRemoval,
  semanticCoreReports,
  semanticCoreFinal,
  card,
  auditResult,
  evidenceSummary,
  contentOptimization,
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
      semanticCoreRemoval: normalizeSemanticRemoval(semanticCoreRemoval),
      semanticCoreReports: normalizeSemanticReports(semanticCoreReports),
      semanticCoreFinal: normalizeSemanticFinalExport(semanticCoreFinal),
      auditResult: sanitizeAuditResult(auditResult),
      evidenceSummary: sanitizeEvidenceSummary(evidenceSummary),
      contentOptimization: contentOptimization && typeof contentOptimization === "object" ? contentOptimization : undefined,
      card: {
        nmID: cardNmIdValue(card),
        vendorCode: cardVendorCodeValue(card),
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
  const semanticCoreReports = normalizeSemanticReports(meta.semanticCoreReports);
  const semanticCoreFinal = normalizeSemanticFinalExport(meta.semanticCoreFinal);
  const semanticCoreRemoval = normalizeSemanticRemoval(meta.semanticCoreRemoval || meta.semanticCoreRemoved || meta.semanticCoreToRemove);
  const auditHistory = sanitizeAuditHistory(meta.auditHistory);
  const auditResult = sanitizeAuditResult(meta.auditResult);
  const evidenceSummary = sanitizeEvidenceSummary(meta.evidenceSummary);
  const hasStoredAuditResult = Boolean(auditResult && Object.keys(auditResult).length);
  const fallbackAuditHistory = !auditHistory.length && hasStoredAuditResult
    ? [{
      id: `audit-${Date.parse(storedDraft?.updatedAt || payload.savedAt || "") || "stored"}`,
      createdAt: storedDraft?.updatedAt || payload.savedAt || "",
      engine: auditResult?._meta?.engine || "opticards-audit",
      summary: auditResult.summary || {},
      competitorSelection: evidenceSummary?.competitorSelection || null,
      status: "done",
    }]
    : [];
  const semanticCoreSelected = normalizeSemanticSelection(
    Array.isArray(meta.semanticCoreSelected) && meta.semanticCoreSelected.length
      ? meta.semanticCoreSelected
      : semanticCoreReports.flatMap((report) => report.selected || [])
  );
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
    semanticCoreSelected,
    semanticCoreRemoval,
    semanticCoreReports,
    semanticCoreFinal,
    auditHistory: auditHistory.length ? auditHistory : fallbackAuditHistory,
    auditResult,
    evidenceSummary,
    approval: deriveOverallApproval(approvalSections),
    approvalSections,
    savedAt: storedDraft?.updatedAt || payload.savedAt || "",
  };
}

function countChangedDraftCharacteristics(drafts, rows) {
  return Object.entries(drafts || {}).filter(([key, draft]) => {
    const currentRow = rows.find((row) => row.key === key)
      || rows.find((row) => row.charcID && draft?.charcID && String(row.charcID) === String(draft.charcID))
      || rows.find((row) => normalizedCharacteristicName(row.label) === normalizedCharacteristicName(draft?.label || draft?.name || ""));
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
const semanticReportHistoryLimit = 3;
const semanticCurrentRowsLimit = 600;
const semanticRecommendedRowsLimit = 1200;
const semanticAllKeywordRowsLimit = 5000;
const semanticRankedRowsLimit = 600;
const semanticSubjectOptionsLimit = 120;
const semanticManualAppendRows = 100;
const semanticFrequencyHighThreshold = 5000;
const semanticFrequencyMediumThreshold = 2000;
const semanticAutoAddTotalLimit = 36;
const semanticAutoAddBucketLimit = 12;
const semanticExcludeWordsLimit = 10;

function semanticRankValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function semanticRankExportValue(value) {
  const number = semanticRankValue(value);
  return number === "" ? "" : number;
}

function semanticCountExportValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function semanticFrequencyValue(item) {
  return semanticCountExportValue(item?.wbCount);
}

function semanticFrequencyBucket(item) {
  const frequency = Number(semanticFrequencyValue(item) || 0);
  if (frequency >= semanticFrequencyHighThreshold) return "high";
  if (frequency >= semanticFrequencyMediumThreshold) return "medium";
  return "low";
}

function semanticFrequencyBucketLabel(bucket) {
  return bucket === "high" ? "высокий" : bucket === "medium" ? "средний" : "низкий";
}

function semanticHasKeywordRank(item) {
  return Boolean(semanticRankValue(item?.orgPos) || semanticRankValue(item?.avgPos) || semanticRankValue(item?.adPos));
}

function semanticPrimaryPositionValue(item) {
  return semanticRankValue(item?.orgPos) || semanticRankValue(item?.avgPos) || semanticRankValue(item?.adPos);
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

function semanticPeriodLabel(period) {
  if (!period || typeof period !== "object" || !period.d1 || !period.d2) {
    return "";
  }
  return clientReportRangeLabel(period.d1, period.d2);
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

function semanticRemovalReason(item) {
  return String(item?.removalReason || item?.reason || "предлагаем удалить из SEO карточки перед переоптимизацией").trim();
}

function normalizeSemanticRemoval(items) {
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
      status: "remove",
      field: typeof item === "object" && item?.field ? item.field : "content",
      removalReason: semanticRemovalReason(item),
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
      const compactItem = { query };
      [
        ["cluster", item.cluster],
        ["prioritySubject", item.prioritySubject],
        ["prioritySubjectId", item.prioritySubjectId],
        ["frequency365", item.frequency365],
        ["source", item.source && item.source !== "mpstats-expanding" ? item.source : ""],
        ["priority", item.priority],
        ["field", item.field],
        ["status", item.status],
        ["reason", item.reason],
      ].forEach(([field, value]) => {
        const text = String(value || "").trim();
        if (text) compactItem[field] = text;
      });
      [
        ["wbCount", Number(item.wbCount || 0)],
        ["ozonCount", Number(item.ozonCount || 0)],
        ["results", Number(item.results || 0)],
        ["totalFound", Number(item.totalFound || 0)],
        ["uniqueDays", Number(item.uniqueDays || 0)],
      ].forEach(([field, value]) => {
        if (Number.isFinite(value) && value > 0) compactItem[field] = value;
      });
      [
        ["orgPos", semanticRankValue(item.orgPos)],
        ["adPos", semanticRankValue(item.adPos)],
        ["avgPos", semanticRankValue(item.avgPos)],
      ].forEach(([field, value]) => {
        if (value) compactItem[field] = value;
      });
      output.push(compactItem);
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
  const compactCurrent = compactItems(core.current, semanticCurrentRowsLimit, { prioritizeRanked: true });
  const compactRecommended = compactItems(recommendedSource, semanticRecommendedRowsLimit);
  const compactAllKeywords = compactItems(core.allKeywords, semanticAllKeywordRowsLimit);
  const compactRankedKeywords = compactItems(rankedSource, semanticRankedRowsLimit, { prioritizeRanked: true });
  return {
    source: core.source || "mpstats-expanding",
    seedQuery: core.seedQuery || "",
    seedQueries: Array.isArray(core.seedQueries) ? core.seedQueries.slice(0, 6) : [],
    period: core.period || {},
    current: compactCurrent,
    recommended: compactRecommended,
    missing: [],
    allKeywords: compactAllKeywords,
    rankedKeywords: compactRankedKeywords,
    subjectOptions: (Array.isArray(core.subjectOptions) ? core.subjectOptions : []).slice(0, semanticSubjectOptionsLimit),
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
    .slice(0, semanticReportHistoryLimit);
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

function semanticRowsByKey(rows) {
  const output = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((item) => {
    const key = semanticQueryKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(item);
  });
  return output;
}

function semanticRankedSourceRows(core) {
  if (!core || typeof core !== "object") return [];
  const sourceRows = Array.isArray(core.rankedKeywords) && core.rankedKeywords.length
    ? core.rankedKeywords
    : [
      ...(Array.isArray(core.current) ? core.current : []),
      ...(Array.isArray(core.recommended) ? core.recommended : []),
      ...(Array.isArray(core.missing) ? core.missing : []),
      ...(Array.isArray(core.allKeywords) ? core.allKeywords : []),
    ];
  return semanticRowsByKey(sourceRows.filter((item) => item?.status !== "selected" && semanticHasKeywordRank(item)));
}

function semanticCurrentContentRows(core) {
  if (!core || typeof core !== "object") return [];
  return semanticRowsByKey((Array.isArray(core.current) ? core.current : [])
    .filter((item) => item?.status !== "selected" && semanticQueryKey(item))
    .map((item) => ({ ...item, position: semanticPrimaryPositionValue(item) })))
    .sort((left, right) => Number(semanticFrequencyValue(right) || 0) - Number(semanticFrequencyValue(left) || 0));
}

function semanticCurrentPositionRows(core) {
  return semanticRankedSourceRows(core)
    .map((item) => ({ ...item, position: semanticPrimaryPositionValue(item) }))
    .filter((item) => item.position)
    .sort((left, right) => Number(left.position || 9999) - Number(right.position || 9999));
}

function semanticExistingQueryKeys(core) {
  return new Set([
    ...semanticCurrentContentRows(core),
    ...semanticCurrentPositionRows(core),
  ].map(semanticQueryKey).filter(Boolean));
}

function semanticCandidateSourceRows(core) {
  if (!core || typeof core !== "object") return [];
  const rows = [
    ...(Array.isArray(core.allKeywords) && core.allKeywords.length ? core.allKeywords : []),
    ...(Array.isArray(core.recommended) ? core.recommended : []),
    ...(Array.isArray(core.missing) ? core.missing : []),
  ];
  return semanticRowsByKey(rows).filter((item) => semanticFrequencyValue(item));
}

function semanticReportCandidateCount(report) {
  return semanticCandidateSourceRows(report?.semanticCore).length;
}

function semanticPreferredReport(reports) {
  const normalizedReports = Array.isArray(reports) ? reports : [];
  return normalizedReports.find((report) => semanticReportCandidateCount(report))
    || normalizedReports.find((report) => report?.semanticCore?.source === "mpstats-expanding")
    || normalizedReports[0]
    || null;
}

function semanticSelectedExportRows(selectedRows, core) {
  const sourceByKey = new Map(semanticCandidateSourceRows(core).map((item) => [semanticQueryKey(item), item]));
  const currentKeys = semanticExistingQueryKeys(core);
  const output = [];
  const seen = new Set();
  normalizeSemanticSelection(selectedRows).forEach((item) => {
    const key = semanticQueryKey(item);
    if (!key || seen.has(key) || currentKeys.has(key)) return;
    const merged = { ...(sourceByKey.get(key) || {}), ...item };
    const importedAgreement = merged.source === "semantic-import" || merged.fileName || merged.sheetName;
    if (!semanticFrequencyValue(merged) && !importedAgreement) return;
    seen.add(key);
    output.push(merged);
  });
  return output.sort((left, right) => Number(semanticFrequencyValue(right) || 0) - Number(semanticFrequencyValue(left) || 0));
}

function semanticRemovalExportRows(removalRows, core) {
  const contentRows = semanticCurrentContentRows(core);
  const contentKeys = new Set(contentRows.map(semanticQueryKey).filter(Boolean));
  const rankingOnlyRows = semanticCurrentPositionRows(core)
    .filter((item) => !contentKeys.has(semanticQueryKey(item)));
  const sourceRows = [...contentRows, ...rankingOnlyRows];
  const sourceByKey = new Map(sourceRows.map((item, index) => [semanticQueryKey(item), { item, index }]));
  const output = [];
  const seen = new Set();
  normalizeSemanticRemoval(removalRows).forEach((item, index) => {
    const key = semanticQueryKey(item);
    const source = sourceByKey.get(key);
    if (!key || seen.has(key) || (sourceRows.length && !source)) return;
    seen.add(key);
    const sourceField = source?.item?.field || (contentKeys.has(key) ? "content" : "ranking");
    output.push({
      ...(source?.item || {}),
      ...item,
      status: "remove",
      field: item.field && item.field !== "content" ? item.field : sourceField,
      removalReason: semanticRemovalReason(item),
      _sourceIndex: source?.index ?? index,
    });
  });
  return output
    .sort((left, right) => Number(left._sourceIndex || 0) - Number(right._sourceIndex || 0))
    .map(({ _sourceIndex, ...item }) => item);
}

function semanticCoreFromRankingPayload(payload) {
  const currentRows = semanticRowsByKey(Array.isArray(payload?.semanticCore?.current) ? payload.semanticCore.current : [])
    .map((item) => ({
      ...item,
      ...semanticRankFields(item, payload?.period || item?.rankPeriod || null),
      status: item.status || "current",
      source: item.source || "card-content",
    }));
  const rankedKeywords = semanticRowsByKey(Array.isArray(payload?.keywords) ? payload.keywords : [])
    .map((item) => ({
      ...item,
      ...semanticRankFields(item, payload?.period || null),
      status: "current",
      source: item.source || "mpstats-keywords",
    }))
    .filter(semanticHasKeywordRank);
  return {
    source: "mpstats-keywords",
    seedQuery: "",
    period: payload?.period || {},
    current: currentRows,
    recommended: Array.isArray(payload?.semanticCore?.recommended) ? payload.semanticCore.recommended : [],
    missing: Array.isArray(payload?.semanticCore?.missing) ? payload.semanticCore.missing : [],
    allKeywords: Array.isArray(payload?.semanticCore?.allKeywords) ? payload.semanticCore.allKeywords : [],
    rankedKeywords,
    subjectOptions: [],
    totalKeywords: Number(payload?.semanticCore?.totalKeywords || rankedKeywords.length),
    coveragePercent: payload?.semanticCore?.coveragePercent ?? null,
    rankingSource: payload?.source || "mpstats",
    rankingPeriod: payload?.period || null,
    reason: payload?.semanticCore?.reason || "MPStats позиции карточки собраны отдельным отчетом.",
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

function loadingButtonClass(className, loading) {
  return `${className}${loading ? " loading" : ""}`;
}

function IconButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button className="icon-btn" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon size={17} />
    </button>
  );
}

function ActionHelp({ label }) {
  return (
    <span className="action-help-icon" role="img" tabIndex={0} aria-label={label} title={label}>
      <HelpCircle size={15} />
    </span>
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
  const [selectedClientId, setSelectedClientId] = useState(initialView.clientId || "");
  const [selectedPortalId, setSelectedPortalId] = useState(initialView.portalId || "");
  const [sellerTab, setSellerTab] = useState(normalizeSellerTab(initialView.sellerTab));
  const [cardReturnTarget, setCardReturnTarget] = useState(() => ({
    sellerTab: normalizeSellerTab(initialView.sellerTab),
    label: sellerBackLabel(normalizeSellerTab(initialView.sellerTab)),
  }));
  const [taskRun, setTaskRun] = useState(null);
  const [selectedCardKey, setSelectedCardKey] = useState(initialView.cardKey || cardDraftKey(demoCards[0]));
  const [selectedCard, setSelectedCard] = useState(
    demoCards.find((card) => cardDraftKey(card) === initialView.cardKey) || demoCards[0],
  );
  const [loadingPortalCards, setLoadingPortalCards] = useState({});
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portalModalMode, setPortalModalMode] = useState("api");
  const [portalModalTarget, setPortalModalTarget] = useState(null);
  const [ozonModalOpen, setOzonModalOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [portalWorkSummaries, setPortalWorkSummaries] = useState({});
  const [mpstatsIntegration, setMpstatsIntegration] = useState(null);
  const [helpEnabled, setHelpEnabled] = useState(() => localStorage.getItem(helpModeStorageKey) === "1");

  const displayUsers = users.length ? users : hardcodedDirectoryFallback;
  const canManagePortals = currentUser ? ["admin", "manager"].includes(getUserRoleType(currentUser)) : false;
  const canManageUsers = currentUser ? userCanManageUsers(currentUser) : false;
  const allPortals = userPortals.map(mergePortalWorkSummary);
  const activePortals = allPortals.filter((portal) => portal.isActive !== false);
  const allClients = buildClientWorkspaces(allPortals);
  const currentClient = allClients.find((client) => client.id === selectedClientId) || allClients[0] || null;

  const currentPortal = allPortals.find((portal) => String(portal.id) === String(selectedPortalId)) || allPortals[0] || null;
  const screenNeedsClient = screen === "client";
  const screenNeedsPortal = ["seller", "card", "ozon-card"].includes(screen);
  const displayScreen = (screenNeedsClient && !currentClient) || (screenNeedsPortal && !currentPortal) ? "cabinets" : screen;

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
        taskTotalCount: Number(backendSummary.taskTotalCount || 0),
        taskActiveCount: Number(backendSummary.taskActiveCount || 0),
        taskDraftCount: Number(backendSummary.taskDraftCount || 0),
        taskPendingCount: Number(backendSummary.taskPendingCount || 0),
        taskReturnedCount: Number(backendSummary.taskReturnedCount || 0),
        taskApprovedCount: Number(backendSummary.taskApprovedCount || 0),
        lastDraftAt: localSummary.lastActivityAt || backendSummary.lastDraftAt || "",
        lastTaskAt: backendSummary.lastTaskAt || "",
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
      screen: displayScreen,
      clientId: selectedClientId,
      portalId: selectedPortalId,
      cardKey: selectedCardKey,
      sellerTab,
    }));
  }, [currentUser, displayScreen, selectedClientId, selectedPortalId, selectedCardKey, sellerTab]);

  useEffect(() => {
    localStorage.setItem(helpModeStorageKey, helpEnabled ? "1" : "0");
  }, [helpEnabled]);

  useEffect(() => {
    if (!["card", "ozon-card"].includes(displayScreen)) {
      return;
    }
    const cards = cardsForPortal(currentPortal);
    if (!cards.length) {
      return;
    }
    const nextCard = cards.find((card) => cardMatchesDraftKey(card, selectedCardKey)) || cards[0];
    if (!selectedCard || !cardMatchesDraftKey(selectedCard, cardDraftKey(nextCard))) {
      setSelectedCard(nextCard);
    }
  }, [displayScreen, currentPortal, selectedCardKey, selectedCard]);

  useEffect(() => {
    if (!currentUser || !currentPortal || currentPortal.isDemo || !currentPortal.apiConnected) {
      return;
    }
    if (!["seller", "card"].includes(displayScreen)) {
      return;
    }
    loadPortalCards(currentPortal);
  }, [currentUser, displayScreen, currentPortal?.id, currentPortal?.apiConnected, currentPortal?.realCards?.length]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [displayScreen, selectedPortalId, selectedCardKey]);

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
    setSelectedClientId("");
    setSelectedPortalId("");
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

  function showClient(client) {
    if (!client) {
      return;
    }
    setSelectedClientId(client.id);
    setScreen("client");
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

  function removeUserPortal(portalId) {
    const normalizedPortalId = String(portalId || "");
    if (!normalizedPortalId) {
      return;
    }
    setUserPortals((items) => items.filter((item) => String(item.id) !== normalizedPortalId));
    setPortalWorkSummaries((current) => {
      const next = { ...current };
      delete next[normalizedPortalId];
      return next;
    });
    clearLocalDraftsForPortal(normalizedPortalId);
  }

  async function setPortalActive(portal, isActive, options = {}) {
    const silent = Boolean(options.silent);
    const navigateOnCurrent = options.navigateOnCurrent !== false;
    if (!canManagePortals || !portal) {
      return false;
    }
    if (portal.isDemo) {
      localStorage.setItem("opticards-demo-archived", isActive ? "0" : "1");
      setDemoPortalArchived(!isActive);
      if (isActive) {
        setPortalStatusFilter("active");
        if (!silent) setNotice("Кабинет восстановлен из архива.");
      } else if (!silent) {
        setNotice("Кабинет отправлен в архив.");
      }
      if (!isActive && navigateOnCurrent && selectedPortalId === "demo-wb") {
        setScreen("cabinets");
      }
      return true;
    }

    try {
      const action = isActive ? "restore" : "archive";
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      if (!isActive && navigateOnCurrent && String(selectedPortalId) === String(portal.id)) {
        setScreen("cabinets");
      }
      if (isActive) {
        setPortalStatusFilter("active");
        if (!silent) setNotice("Кабинет восстановлен из архива.");
      } else {
        if (!silent) setNotice("Кабинет отправлен в архив.");
      }
      return true;
    } catch {
      if (!silent) setNotice("Не удалось изменить статус кабинета. Попробуйте повторить позже.");
      return false;
    }
  }

  async function deletePortal(portal, options = {}) {
    const silent = Boolean(options.silent);
    const skipConfirm = Boolean(options.skipConfirm);
    const navigateOnCurrent = options.navigateOnCurrent !== false;
    if (!canManagePortals || !portal || portal.isDemo) {
      return false;
    }
    if (portal.isActive !== false) {
      if (!silent) setNotice("Сначала отправьте кабинет в архив, затем его можно удалить.");
      return false;
    }
    const displayName = portalDisplayName(portal);
    if (!skipConfirm) {
      const confirmed = window.confirm(
        `Удалить кабинет "${displayName}" без восстановления? Будут удалены карточки, состав проекта, черновики, задачи, конкуренты и история отчетов по этому кабинету.`,
      );
      if (!confirmed) {
        return false;
      }
    }
    try {
      await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/delete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      removeUserPortal(portal.id);
      if (navigateOnCurrent && String(selectedPortalId) === String(portal.id)) {
        setSelectedPortalId("");
        setScreen("cabinets");
      }
      if (!silent) setNotice("Кабинет удален.");
      return true;
    } catch (error) {
      if (!silent) {
        setNotice(error.message === "portal_must_be_archived"
          ? "Сначала отправьте кабинет в архив, затем его можно удалить."
          : "Не удалось удалить кабинет. Попробуйте повторить позже.");
      }
      return false;
    }
  }

  async function archiveClient(client) {
    if (!canManagePortals || !client) {
      return false;
    }
    const activeClientPortals = (client.portals || []).filter((portal) => portal.isActive !== false);
    if (!activeClientPortals.length) {
      setNotice("У клиента нет активных кабинетов для архива.");
      return false;
    }
    const confirmed = window.confirm(
      `Отправить клиента "${client.name}" в архив? В архив уйдут все активные кабинеты клиента: ${activeClientPortals.length}.`,
    );
    if (!confirmed) {
      return false;
    }
    const results = [];
    for (const portal of activeClientPortals) {
      results.push(await setPortalActive(portal, false, { silent: true, navigateOnCurrent: false }));
    }
    const savedCount = results.filter(Boolean).length;
    if (savedCount === activeClientPortals.length) {
      setPortalStatusFilter("inactive");
      setScreen("cabinets");
      setNotice(`Клиент "${client.name}" отправлен в архив.`);
      return true;
    }
    setNotice(`В архив отправлено ${savedCount} из ${activeClientPortals.length} кабинетов клиента.`);
    return false;
  }

  async function restoreClient(client) {
    if (!canManagePortals || !client) {
      return false;
    }
    const inactiveClientPortals = (client.portals || []).filter((portal) => portal.isActive === false);
    if (!inactiveClientPortals.length) {
      setNotice("У клиента нет архивных кабинетов для восстановления.");
      return false;
    }
    const results = [];
    for (const portal of inactiveClientPortals) {
      results.push(await setPortalActive(portal, true, { silent: true, navigateOnCurrent: false }));
    }
    const savedCount = results.filter(Boolean).length;
    if (savedCount === inactiveClientPortals.length) {
      setPortalStatusFilter("active");
      setScreen("cabinets");
      setNotice(`Клиент "${client.name}" восстановлен из архива.`);
      return true;
    }
    setNotice(`Восстановлено ${savedCount} из ${inactiveClientPortals.length} кабинетов клиента.`);
    return false;
  }

  async function deleteClient(client) {
    if (!canManagePortals || !client) {
      return false;
    }
    const portals = (client.portals || []).filter((portal) => !portal.isDemo);
    const activeClientPortals = portals.filter((portal) => portal.isActive !== false);
    if (activeClientPortals.length) {
      setNotice("Сначала отправьте клиента в архив, затем его можно удалить.");
      return false;
    }
    if (!portals.length) {
      setNotice("У клиента нет удаляемых кабинетов.");
      return false;
    }
    const confirmed = window.confirm(
      `Удалить клиента "${client.name}" без восстановления? Будут удалены все кабинеты клиента (${portals.length}) вместе с карточками, задачами, черновиками, конкурентами и историей отчетов.`,
    );
    if (!confirmed) {
      return false;
    }
    const results = [];
    for (const portal of portals) {
      results.push(await deletePortal(portal, { silent: true, skipConfirm: true, navigateOnCurrent: false }));
    }
    const deletedCount = results.filter(Boolean).length;
    if (deletedCount === portals.length) {
      setSelectedClientId("");
      setSelectedPortalId("");
      setPortalStatusFilter("active");
      setScreen("cabinets");
      setNotice(`Клиент "${client.name}" удален.`);
      return true;
    }
    setNotice(`Удалено ${deletedCount} из ${portals.length} кабинетов клиента.`);
    return false;
  }

  async function showSeller(portal) {
    if (!portal || portal.isActive === false) {
      return;
    }
    setSelectedClientId(portalClientKey(portal));
    setSelectedPortalId(portal.id);
    setSellerTab("cabinet");
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
    if (!portal || portal.isDemo) {
      return;
    }
    const confirmed = window.confirm(
      "Очистить черновики и СЯ по кабинету? Задачи останутся. Удалятся аудиты, черновики контента, итоговое СЯ и переоптимизация по карточкам. Карточки, источник данных и API-ключ останутся.",
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
      const result = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/clear-draft-work`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      clearLocalDraftsForPortal(portal.id);
      resetPortalWorkSummary(portal.id);
      const resetPortal = normalizePortal({
        ...portal,
        ...(result.portal || {}),
        realCards: portal.realCards || result.portal?.realCards || [],
      });
      replaceUserPortal(resetPortal);
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(resetPortal, payload);
      replaceUserPortal(updatedPortal);
      setNotice(`Черновики и СЯ очищены. Задачи сохранены: ${formatNumber(result.taskDraftsKept || 0)}.`);
    } catch {
      setNotice("Не удалось очистить черновики и СЯ по кабинету. Попробуйте повторить позже.");
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
      let portalForLoad = portal;
      if (resetWork) {
        const result = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/clear-draft-work`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        clearLocalDraftsForPortal(portal.id);
        resetPortalWorkSummary(portal.id);
        portalForLoad = normalizePortal({
          ...portal,
          ...(result.portal || {}),
          realCards: portal.realCards || [],
        });
        replaceUserPortal(portalForLoad);
      }
      const payload = await apiRequest(`/api/wb/cards?portal_id=${encodeURIComponent(portal.id)}&limit=100`);
      const updatedPortal = applyWbSnapshotToPortal(portalForLoad, payload);
      replaceUserPortal(updatedPortal);
    } catch {
      replaceUserPortal({
        ...portal,
        syncStatus: "error",
        draftSummary: portal.draftSummary,
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
    if (!portal) {
      return [];
    }
    return portal.realCards?.length ? portal.realCards : (portal.isDemo ? demoCards : []);
  }

  function openCard(card, context = {}) {
    const nextSellerTab = normalizeSellerTab(context.sellerTab || sellerTab);
    const nextTaskRun = context.taskRun?.items?.length ? {
      ...context.taskRun,
      currentIndex: Math.max(0, Math.min(Number(context.taskRun.currentIndex || 0), context.taskRun.items.length - 1)),
      total: context.taskRun.items.length,
    } : null;
    setSelectedCard(card);
    setSelectedCardKey(cardDraftKey(card));
    setCardReturnTarget({
      sellerTab: nextSellerTab,
      label: context.backLabel || sellerBackLabel(nextSellerTab),
    });
    setTaskRun(nextTaskRun);
    setScreen("card");
  }

  function openOzonCard(card) {
    setSelectedCard(card);
    setSelectedCardKey(cardDraftKey(card));
    setCardReturnTarget({
      sellerTab: "cabinet",
      label: "Карточки Ozon",
    });
    setTaskRun(null);
    setScreen("ozon-card");
  }

  function backFromCard() {
    const nextSellerTab = normalizeSellerTab(cardReturnTarget.sellerTab);
    setTaskRun(null);
    setSellerTab(nextSellerTab);
    setScreen("seller");
  }

  function openTaskRunIndex(nextTaskRun, nextIndex, notice = "") {
    const item = nextTaskRun.items[nextIndex];
    const cards = cardsForPortal(currentPortal);
    const nextCard = cards.find((card) => cardMatchesDraftKey(card, item.cardKey)) || null;
    if (!nextCard) {
      setNotice("Карточка из пачки не найдена в текущем списке кабинета.");
      return false;
    }
    setSelectedCard(nextCard);
    setSelectedCardKey(cardDraftKey(nextCard));
    setTaskRun({ ...nextTaskRun, currentIndex: nextIndex, total: nextTaskRun.items.length });
    if (notice) {
      setNotice(notice);
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return true;
  }

  function navigateTaskRun(command) {
    if (!taskRun?.items?.length) {
      return;
    }
    const action = typeof command === "number" ? { type: "move", delta: command } : (command || {});
    const currentIndex = Math.max(0, Math.min(Number(taskRun.currentIndex || 0), taskRun.items.length - 1));
    if (action.type === "defer-current") {
      if (taskRun.items.length < 2) {
        setNotice("В текущем проходе только одна карточка.");
        return;
      }
      const currentItem = taskRun.items[currentIndex];
      const remainingItems = taskRun.items.filter((_, index) => index !== currentIndex);
      const nextItems = [...remainingItems, { ...currentItem, deferred: true }];
      const nextIndex = Math.min(currentIndex, remainingItems.length - 1);
      openTaskRunIndex(
        { ...taskRun, items: nextItems, total: nextItems.length },
        nextIndex,
        "Карточка перенесена в конец текущего прохода.",
      );
      return;
    }
    const delta = Number(action.delta || 0);
    const nextIndex = Math.max(0, Math.min(currentIndex + delta, taskRun.items.length - 1));
    if (nextIndex === currentIndex) {
      return;
    }
    openTaskRunIndex(taskRun, nextIndex);
  }

  async function createPortal(payload) {
    const response = await apiRequest("/api/portals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const portal = normalizePortal(response.portal);
    setUserPortals((items) => [...items, portal]);
    setPortalModalOpen(false);
    setSelectedClientId(portalClientKey(portal));
    setSelectedPortalId(portal.id);
    setSellerTab("cabinet");
    setScreen("seller");
    if (portal.mode === "manual") {
      setNotice(manualBootstrapNotice(portal, "create"));
    }
  }

  async function createOzonPortal(client, source = {}) {
    if (!client) {
      setNotice("Сначала откройте клиента для добавления Ozon.");
      return false;
    }
    const storeUrl = String(source.storeUrl || "").trim();
    const manualSource = String(source.manualSource || "").trim();
    const cabinetName = String(source.name || "").trim();
    const scope = source.scope === "full" ? "full" : "selected";
    if (!storeUrl && !manualSource) {
      setNotice("Для Ozon-кабинета укажите ссылку, Seller ID или SKU.");
      return false;
    }
    const leadPortal = (client.portals || [])[0] || null;
    const teamRoles = leadPortal ? getPortalTeam(leadPortal) : defaultTeamFromUsers(displayUsers);
    try {
      const response = await apiRequest("/api/portals", {
        method: "POST",
        body: JSON.stringify({
          mode: "manual",
          marketplace: "Ozon",
          scope,
          name: cabinetName || `${client.name} Ozon`,
          clientName: client.name,
          teamRoles,
          storeUrl,
          manualSource,
        }),
      });
      const portal = normalizePortal(response.portal);
      setUserPortals((items) => [...items, portal]);
      setOzonModalOpen(false);
      setSelectedClientId(client.id);
      setSelectedPortalId(portal.id);
      setSellerTab("cabinet");
      setScreen("seller");
      setNotice("Ozon beta-кабинет создан с источником. Нажмите «Обновить из MPStats», чтобы посмотреть доступные данные.");
      return true;
    } catch (error) {
      if (error.message === "client_name_too_long") {
        setNotice("Название клиента слишком длинное для Ozon-кабинета.");
      } else if (error.message === "store_url_too_long") {
        setNotice("Ссылка или идентификатор Ozon слишком длинные.");
      } else if (error.message === "manual_source_too_long") {
        setNotice("Описание Ozon-источника слишком длинное.");
      } else {
        setNotice("Не удалось создать тестовый Ozon-кабинет.");
      }
      return false;
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
    setSellerTab("cabinet");
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
      return true;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/team`, {
        method: "POST",
        body: JSON.stringify({ teamRoles }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      return true;
    } catch {
      setNotice("Не удалось сохранить состав проекта на backend.");
      return false;
    }
  }

  async function updateClientTeam(client, teamRoles) {
    const portals = Array.isArray(client?.portals) ? client.portals : [];
    if (!portals.length) {
      setNotice("У клиента пока нет кабинетов для сохранения команды.");
      return false;
    }
    const results = [];
    for (const portal of portals) {
      results.push(await updatePortalTeam(portal, teamRoles));
    }
    const savedCount = results.filter(Boolean).length;
    if (savedCount === portals.length) {
      setNotice("Команда клиента сохранена во всех кабинетах.");
      return true;
    }
    setNotice(`Команда сохранена в ${savedCount} из ${portals.length} кабинетов клиента.`);
    return false;
  }

  async function updatePortalClientContact(portal, clientContact) {
    const normalizedContact = normalizeClientContact(clientContact);
    if (portal.isDemo) {
      setDemoPortal((item) => ({ ...item, clientContact: normalizedContact }));
      return true;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/client-contact`, {
        method: "POST",
        body: JSON.stringify({ clientContact: normalizedContact }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      return true;
    } catch (error) {
      if (String(error.message || "").includes("too_long")) {
        setNotice("Контактные данные слишком длинные. Сократите текст и сохраните еще раз.");
      } else {
        setNotice("Не удалось сохранить контактные данные клиента.");
      }
      return false;
    }
  }

  async function updateClientContact(client, clientContact) {
    const portals = Array.isArray(client?.portals) ? client.portals : [];
    if (!portals.length) {
      setNotice("У клиента пока нет кабинетов для сохранения контактов.");
      return false;
    }
    const results = [];
    for (const portal of portals) {
      results.push(await updatePortalClientContact(portal, clientContact));
    }
    const savedCount = results.filter(Boolean).length;
    if (savedCount === portals.length) {
      setNotice("Контактные данные клиента сохранены.");
      return true;
    }
    setNotice(`Контакты сохранены в ${savedCount} из ${portals.length} кабинетов клиента.`);
    return false;
  }

  async function updatePortalClientName(portal, clientName) {
    const cleanName = String(clientName || "").trim();
    if (!cleanName) {
      setNotice("Название клиента не может быть пустым.");
      return false;
    }
    if (portal.isDemo) {
      setDemoPortal((item) => ({ ...item, clientName: cleanName }));
      return true;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/client-name`, {
        method: "POST",
        body: JSON.stringify({ clientName: cleanName }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      return true;
    } catch (error) {
      if (error.message === "client_name_too_long") {
        setNotice("Название клиента слишком длинное. Оставьте до 120 символов.");
      } else if (error.message === "client_name_required") {
        setNotice("Название клиента не может быть пустым.");
      } else {
        setNotice("Не удалось сохранить название клиента.");
      }
      return false;
    }
  }

  async function updateClientName(client, clientName) {
    const cleanName = String(clientName || "").trim();
    const portals = Array.isArray(client?.portals) ? client.portals : [];
    if (!cleanName) {
      setNotice("Название клиента не может быть пустым.");
      return false;
    }
    if (!portals.length) {
      setNotice("У клиента пока нет кабинетов для сохранения названия.");
      return false;
    }
    const results = [];
    for (const portal of portals) {
      results.push(await updatePortalClientName(portal, cleanName));
    }
    const savedCount = results.filter(Boolean).length;
    if (savedCount === portals.length) {
      setSelectedClientId(clientKeyFromName(cleanName));
      setNotice("Название клиента сохранено во всех кабинетах.");
      return true;
    }
    setNotice(`Название клиента сохранено в ${savedCount} из ${portals.length} кабинетов.`);
    return false;
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

  async function updatePortalSource(portal, source) {
    const storeUrl = String(source?.storeUrl || "").trim();
    const manualSource = String(source?.manualSource || "").trim();
    if (portal.isDemo) {
      setDemoPortal((item) => ({ ...item, storeUrl, manualSource }));
      return true;
    }
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/manual-source`, {
        method: "POST",
        body: JSON.stringify({ storeUrl, manualSource }),
      });
      replaceUserPortal({ ...portal, ...response.portal, realCards: portal.realCards || [] });
      setNotice(isOzonPortal(portal) ? "Источник Ozon сохранен." : "Источник кабинета сохранен.");
      return true;
    } catch (error) {
      if (error.message === "store_url_too_long") {
        setNotice("Ссылка или идентификатор источника слишком длинные.");
      } else if (error.message === "manual_source_too_long") {
        setNotice("Описание источника слишком длинное. Сократите комментарий.");
      } else if (error.message === "portal_source_manual_only") {
        setNotice("Источник можно менять только у manual-кабинета.");
      } else {
        setNotice("Не удалось сохранить источник кабинета.");
      }
      return false;
    }
  }

  const currentPortalCards = cardsForPortal(currentPortal);
  const selectedCardFromPortal = currentPortalCards.find((card) => cardMatchesDraftKey(card, selectedCardKey)) || null;
  const currentPortalKey = String(currentPortal?.id || "");
  const cardScreenLoading = Boolean(
    displayScreen === "card"
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
        screen={displayScreen}
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

        {displayScreen === "cabinets" ? (
          <CabinetsScreen
            portals={visiblePortals()}
            activePortals={activePortals}
            currentUser={currentUser}
            statusFilter={portalStatusFilter}
            onStatusFilter={setPortalStatusFilter}
            canManage={canManagePortals}
            findUser={findUser}
            onOpenClient={showClient}
            onArchive={(portal) => setPortalActive(portal, false)}
            onRestore={(portal) => setPortalActive(portal, true)}
            onDelete={deletePortal}
            helpEnabled={helpEnabled}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalTarget(null);
              setPortalModalOpen(true);
            }}
          />
        ) : null}

        {displayScreen === "client" && currentClient ? (
          <ClientWorkspaceScreen
            client={currentClient}
            currentUser={currentUser}
            displayUsers={displayUsers}
            canManage={canManagePortals}
            findUser={findUser}
            onBack={() => setScreen("cabinets")}
            onOpenPortal={showSeller}
            onArchive={(portal) => setPortalActive(portal, false)}
            onRestore={(portal) => setPortalActive(portal, true)}
            onDelete={deletePortal}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalTarget(null);
              setPortalModalOpen(true);
            }}
            onAddOzon={() => setOzonModalOpen(true)}
            onUpdateName={(clientName) => updateClientName(currentClient, clientName)}
            onUpdateTeam={(teamRoles) => updateClientTeam(currentClient, teamRoles)}
            onUpdateContact={(clientContact) => updateClientContact(currentClient, clientContact)}
            onArchiveClient={() => archiveClient(currentClient)}
            onRestoreClient={() => restoreClient(currentClient)}
            onDeleteClient={() => deleteClient(currentClient)}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {displayScreen === "seller" && currentPortal && isOzonPortal(currentPortal) ? (
          <OzonSellerScreen
            portal={currentPortal}
            displayUsers={displayUsers}
            findUser={findUser}
            canManage={canManagePortals}
            onBack={() => setScreen("client")}
            sellerTab={sellerTab}
            onSellerTabChange={setSellerTab}
            onUpdateTeam={(teamRoles) => updatePortalTeam(currentPortal, teamRoles)}
            onUpdateName={(name) => updatePortalName(currentPortal, name)}
            onUpdateSource={(source) => updatePortalSource(currentPortal, source)}
            onPortalUpdated={replaceUserPortal}
            onOpenCard={openOzonCard}
            onNotice={setNotice}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {displayScreen === "seller" && currentPortal && !isOzonPortal(currentPortal) ? (
          <SellerScreen
            portal={currentPortal}
            cards={currentPortalCards}
            cardsLoading={Boolean(loadingPortalCards[currentPortalKey])}
            mpstatsIntegration={mpstatsIntegration}
            displayUsers={displayUsers}
            findUser={findUser}
            canManage={canManagePortals}
            onBack={() => setScreen("client")}
            onOpenCard={openCard}
            sellerTab={sellerTab}
            onSellerTabChange={setSellerTab}
            onRefreshCards={() => refreshPortalCards(currentPortal)}
            onResetWork={() => resetPortalWork(currentPortal)}
            onOpenModal={(mode) => {
              setPortalModalMode(mode);
              setPortalModalTarget(currentPortal?.isDemo ? null : currentPortal);
              setPortalModalOpen(true);
            }}
            onUpdateTeam={(teamRoles) => updatePortalTeam(currentPortal, teamRoles)}
            onUpdateName={(name) => updatePortalName(currentPortal, name)}
            onPortalUpdated={replaceUserPortal}
            onNotice={setNotice}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {displayScreen === "card" && selectedCardFromPortal ? (
          <CardDetailScreen
            key={cardDraftKey(selectedCardFromPortal)}
            card={selectedCardFromPortal}
            portal={currentPortal}
            currentUser={currentUser}
            onBack={backFromCard}
            backLabel={cardReturnTarget.label}
            taskRun={taskRun}
            onTaskRunNavigate={navigateTaskRun}
            onDraftSaved={refreshPortals}
            onDraftActivity={(payload) => markPortalWorkActivity(currentPortal.id, cardDraftKey(selectedCardFromPortal), payload)}
            onDraftReset={() => resetPortalWorkActivity(currentPortal.id, cardDraftKey(selectedCardFromPortal))}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {displayScreen === "card" && !selectedCardFromPortal ? (
          <CardRecoveryScreen loading={cardScreenLoading} onBack={backFromCard} />
        ) : null}

        {displayScreen === "ozon-card" && selectedCardFromPortal ? (
          <OzonCardDetailScreen
            key={cardDraftKey(selectedCardFromPortal)}
            card={selectedCardFromPortal}
            portal={currentPortal}
            onBack={backFromCard}
            backLabel={cardReturnTarget.label}
            helpEnabled={helpEnabled}
          />
        ) : null}

        {displayScreen === "ozon-card" && !selectedCardFromPortal ? (
          <CardRecoveryScreen loading={false} onBack={backFromCard} />
        ) : null}

        {displayScreen === "audit" ? <PlaceholderScreen title="Рыночный аудит" copy="MPStats и полноценный рыночный аудит подключим отдельным этапом. Сейчас активна загрузка данных WB и ручная проверка карточек." /> : null}
        {(displayScreen === "admin" || displayScreen === "settings") && canManagePortals ? (
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
      {ozonModalOpen && currentClient ? (
        <OzonPortalModal
          client={currentClient}
          onClose={() => setOzonModalOpen(false)}
          onSubmit={(payload) => createOzonPortal(currentClient, payload)}
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
        <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? "Входим..." : "Войти"}
        </button>
      </form>
    </section>
  );
}

function Rail({ user, screen, canManage = false, helpEnabled, onHelpToggle, onNavigate, onLogout }) {
  const nav = [
    { key: "cabinets", label: "Кабинеты", Icon: LayoutDashboard },
    { key: "audit", label: "Рыночный аудит", Icon: ClipboardList, disabled: true, status: "скоро" },
    canManage ? { key: "admin", label: "Админка", Icon: Settings } : null,
  ].filter(Boolean);
  const cabinetScreens = new Set(["cabinets", "client", "seller", "card"]);
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
            className={(screen === key || (key === "cabinets" && cabinetScreens.has(screen)) || (key === "admin" && screen === "settings")) ? "active" : ""}
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

function CabinetsScreen({ portals, activePortals, currentUser, statusFilter, onStatusFilter, onOpenClient, onOpenModal, helpEnabled = false }) {
  const canSeeOzonBeta = userCanSeeOzonBeta(currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchedPortals = portals.filter((portal) => {
    if (!normalizedSearchQuery) {
      return true;
    }
    const haystack = [
      portalClientName(portal),
      portalDisplayName(portal),
      portalMarketplaceName(portal),
      portal.ownerLogin,
      portal.storeUrl,
      portal.manualSource,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedSearchQuery);
  });
  const clientWorkspaces = buildClientWorkspaces(searchedPortals);
  const activeClients = buildClientWorkspaces(activePortals);
  const wbPortals = activePortals.filter((portal) => portalMarketplaceKey(portal) === "wildberries");
  const ozonPortals = activePortals.filter((portal) => portalMarketplaceKey(portal) === "ozon");
  const cardsCount = activePortals.reduce((sum, portal) => sum + (Number(portal.cardCount) || 0), 0);
  const activeTasksCount = activePortals.reduce((sum, portal) => sum + portalActiveTaskCount(portal), 0);
  return (
    <section className="screen active marketplace-theme-wildberries">
      <header className="topbar">
        <div className="title">
          <h1>Клиенты</h1>
          <p>Клиентские кабинеты с разделами Wildberries и Ozon.</p>
        </div>
        <button className="btn primary" type="button" onClick={() => onOpenModal("api")}>
          <Plus size={17} />
          Добавить клиента
        </button>
      </header>

      <div className="content">
        <HelpList
          enabled={helpEnabled}
          title="Как начать работу"
          items={[
            "Откройте клиента, чтобы увидеть общую информацию и перейти в раздел WB или Ozon.",
            "Новый клиент создается через первый WB-кабинет, а Ozon beta добавляется уже внутри клиента.",
            "Фильтр Активные / Неактивные помогает спрятать завершенные кабинеты без удаления истории.",
          ]}
        />
        <div className="summary-grid">
          <Metric
            label="Клиенты"
            value={formatNumber(activeClients.length)}
            hint={`${formatNumber(wbPortals.length)} WB${canSeeOzonBeta ? ` · ${formatNumber(ozonPortals.length)} Ozon` : ""}`}
          />
          <Metric
            label="Карточки всего"
            value={formatNumber(cardsCount)}
            hint="по активным кабинетам"
          />
          <Metric
            label="Wildberries"
            value={formatNumber(wbPortals.length)}
            hint="рабочий поток активен"
          />
          <Metric
            label="Активные задачи"
            value={formatNumber(activeTasksCount)}
            hint={activeTasksCount ? "в работе по карточкам" : "нет активных задач"}
          />
        </div>

        <div className="band">
          <div className="filters">
            <label className="search-field">
              <Search size={16} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск по клиенту, бренду, артикулу"
              />
            </label>
            <select className="select" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)} aria-label="Статус кабинета">
              <option value="active">Активные</option>
              <option value="inactive">Неактивные</option>
              <option value="all">Все кабинеты</option>
            </select>
          </div>
        </div>

        <div className="client-grid">
          {clientWorkspaces.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              canSeeOzonBeta={canSeeOzonBeta}
              onOpen={() => onOpenClient(client)}
            />
          ))}
          {statusFilter !== "inactive" ? (
            <article className="workspace-card add-card">
              <div className="seller-logo">+</div>
              <h2>Добавить клиента</h2>
              <p>Создайте первый WB-кабинет, и клиент появится в списке.</p>
              <button className="btn primary" type="button" onClick={() => onOpenModal("api")}>
                <Plus size={17} />
                Добавить клиента
              </button>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ClientCard({ client, canSeeOzonBeta, onOpen }) {
  const wbCount = clientPortalCount(client, "wildberries");
  const ozonCount = clientPortalCount(client, "ozon");
  const cardCount = clientCardCount(client);
  const taskCount = clientTaskCount(client);
  return (
    <article className="workspace-card client-card">
      <div className="card-head">
        <div className="seller">
          <div className="seller-logo">{initials(client.name || "КЛ")}</div>
          <div>
            <h2>{client.name}</h2>
            <p>Клиент · {formatNumber(client.portals.length)} {pluralRu(client.portals.length, "кабинет", "кабинета", "кабинетов")}</p>
          </div>
        </div>
        <Tag tone="blue">Клиент</Tag>
      </div>
      <div className="card-stats">
        <MiniStat value={wbCount} label="WB" />
        <MiniStat value={canSeeOzonBeta ? ozonCount : "—"} label="Ozon" />
        <MiniStat value={taskCount} label="задачи" />
      </div>
      <div className="client-marketplace-badges">
        <span className="client-marketplace-badge wb">Wildberries · {formatNumber(wbCount)}</span>
        {canSeeOzonBeta ? <span className="client-marketplace-badge ozon">Ozon beta · {formatNumber(ozonCount)}</span> : null}
      </div>
      <div className="scope-row">
        <span>Карточки</span>
        <strong>{formatNumber(cardCount)}</strong>
      </div>
      <div className="card-actions">
        <Tag tone={taskCount ? "amber" : "green"}>{taskCount ? "есть задачи" : "без активных задач"}</Tag>
        <button className="btn primary" type="button" onClick={onOpen}>Открыть клиента</button>
      </div>
    </article>
  );
}

function ClientWorkspaceScreen({ client, currentUser, displayUsers, canManage, findUser, onBack, onOpenPortal, onArchive, onRestore, onDelete, onOpenModal, onAddOzon, onUpdateName, onUpdateTeam, onUpdateContact, onArchiveClient, onRestoreClient, onDeleteClient, helpEnabled = false }) {
  const canSeeOzonBeta = userCanSeeOzonBeta(currentUser);
  const [marketplaceTab, setMarketplaceTab] = useState("overview");
  const wbPortals = clientMarketplacePortals(client, "wildberries");
  const ozonPortals = clientMarketplacePortals(client, "ozon");
  const activeClientPortals = (client.portals || []).filter((portal) => portal.isActive !== false);
  const inactiveClientPortals = (client.portals || []).filter((portal) => portal.isActive === false);
  const canDeleteClient = inactiveClientPortals.length > 0 && activeClientPortals.length === 0 && inactiveClientPortals.some((portal) => !portal.isDemo);
  const leadPortal = client.portals[0] || null;
  const team = leadPortal ? getPortalTeam(leadPortal) : defaultTeamFromUsers(displayUsers);
  const clientContact = clientContactFromClient(client);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(client.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [teamEditing, setTeamEditing] = useState(false);
  const [teamDraft, setTeamDraft] = useState(team);
  const [teamSaving, setTeamSaving] = useState(false);
  const [contactEditing, setContactEditing] = useState(false);
  const [contactDraft, setContactDraft] = useState(clientContact);
  const [contactSaving, setContactSaving] = useState(false);

  useEffect(() => {
    setMarketplaceTab("overview");
    setNameEditing(false);
    setTeamEditing(false);
    setContactEditing(false);
  }, [client.id]);

  useEffect(() => {
    if (!canSeeOzonBeta && marketplaceTab === "ozon") {
      setMarketplaceTab("overview");
    }
  }, [canSeeOzonBeta, marketplaceTab]);

  useEffect(() => {
    if (!nameEditing) {
      setNameDraft(client.name || "");
    }
  }, [client.name, nameEditing]);

  useEffect(() => {
    if (!teamEditing) {
      setTeamDraft(team);
    }
  }, [team.lead, team.tech, team.manager, teamEditing]);

  useEffect(() => {
    if (!contactEditing) {
      setContactDraft(clientContact);
    }
  }, [clientContact.name, clientContact.phone, clientContact.email, clientContact.comment, contactEditing]);

  function updateTeamDraft(roleKey, login) {
    setTeamDraft((current) => ({ ...current, [roleKey]: login }));
  }

  function updateContactDraft(field, value) {
    setContactDraft((current) => ({ ...current, [field]: value }));
  }

  function openMarketplace(marketplaceKey, portals) {
    if (portals.length === 1) {
      onOpenPortal(portals[0]);
      return;
    }
    setMarketplaceTab(marketplaceKey);
  }

  async function saveTeam() {
    if (!teamDraft.lead || !teamDraft.tech || !teamDraft.manager || teamSaving) {
      return;
    }
    setTeamSaving(true);
    try {
      const saved = await onUpdateTeam?.(teamDraft);
      if (saved !== false) {
        setTeamEditing(false);
      }
    } finally {
      setTeamSaving(false);
    }
  }

  async function saveName() {
    const cleanName = nameDraft.trim();
    if (!cleanName || nameSaving) {
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

  async function saveContact() {
    if (contactSaving) {
      return;
    }
    setContactSaving(true);
    try {
      const saved = await onUpdateContact?.(normalizeClientContact(contactDraft));
      if (saved !== false) {
        setContactEditing(false);
      }
    } finally {
      setContactSaving(false);
    }
  }

  return (
    <section className="screen active">
      <header className="topbar">
        <div className="title">
          <div className="seller-title-row">
            {nameEditing ? (
              <div className="seller-name-editor">
                <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={120} autoFocus />
                <button className={loadingButtonClass("btn primary", nameSaving)} type="button" onClick={saveName} disabled={nameSaving || !nameDraft.trim()} aria-busy={nameSaving || undefined}>
                  {nameSaving ? "Сохраняем" : "Сохранить"}
                </button>
                <button className="btn ghost" type="button" onClick={() => { setNameDraft(client.name || ""); setNameEditing(false); }} disabled={nameSaving}>Отмена</button>
              </div>
            ) : (
              <>
                <h1>{client.name}</h1>
                {canManage ? <IconButton icon={Pencil} label="Редактировать название клиента" onClick={() => setNameEditing(true)} /> : null}
              </>
            )}
          </div>
          <p>Общая информация клиента и разделы маркетплейсов.</p>
        </div>
        <div className="toolbar">
          {canManage && activeClientPortals.length ? (
            <button className="btn" type="button" onClick={onArchiveClient}>
              <Archive size={17} />
              В архив
            </button>
          ) : null}
          {canManage && !activeClientPortals.length && inactiveClientPortals.length ? (
            <button className="btn" type="button" onClick={onRestoreClient}>
              <RotateCcw size={17} />
              Вернуть
            </button>
          ) : null}
          {canManage && canDeleteClient ? (
            <button className="btn danger" type="button" onClick={onDeleteClient}>
              <Trash2 size={17} />
              Удалить
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onBack}>
            <ArrowLeft size={17} />
            Клиенты
          </button>
        </div>
      </header>

      <div className="content">
        <HelpList
          enabled={helpEnabled}
          title="Структура клиента"
          items={[
            "Общая информация остается на уровне клиента.",
            "Wildberries и Ozon открываются отдельными разделами внутри клиента.",
            "Рабочий WB-поток открывается из раздела Wildberries без изменения текущих карточек и задач.",
          ]}
        />

        <div className="client-overview-grid">
          <section className="panel client-info-panel">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">Общее</span>
                <h2>Информация клиента</h2>
                <p>{formatNumber(client.portals.length)} {pluralRu(client.portals.length, "кабинет", "кабинета", "кабинетов")} · {formatNumber(clientCardCount(client))} карточек · {formatNumber(clientTaskCount(client))} активных задач</p>
              </div>
              {!teamEditing && canManage ? <button className="btn" type="button" onClick={() => setTeamEditing(true)}><Pencil size={16} />Команду</button> : null}
            </div>
            {!teamEditing ? (
              <div className="client-info-list">
                <div>
                  <span>Название клиента</span>
                  <strong>{client.name}</strong>
                </div>
                {Object.entries(projectRoleLabels).map(([roleKey, label]) => {
                  const user = findUser(team[roleKey]);
                  return (
                    <div key={roleKey}>
                      <span>{label}</span>
                      <strong>{user?.full_name || "не указан"}</strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="client-team-editor">
                {Object.entries(projectRoleLabels).map(([roleKey, label]) => (
                  <UserSelect
                    key={roleKey}
                    label={label}
                    value={teamDraft[roleKey] || ""}
                    users={displayUsers}
                    onChange={(value) => updateTeamDraft(roleKey, value)}
                  />
                ))}
                <div className="client-team-actions">
                  <button className="btn ghost" type="button" onClick={() => { setTeamDraft(team); setTeamEditing(false); }} disabled={teamSaving}>Отмена</button>
                  <button className={loadingButtonClass("btn primary", teamSaving)} type="button" onClick={saveTeam} disabled={teamSaving || !teamDraft.lead || !teamDraft.tech || !teamDraft.manager} aria-busy={teamSaving || undefined}>Сохранить команду</button>
                </div>
              </div>
            )}
          </section>

          <section className="panel client-info-panel">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">Контакты</span>
                <h2>Контактные данные</h2>
                <p>Контакт клиента для согласований и рабочих вопросов.</p>
              </div>
              {!contactEditing && canManage ? <button className="btn" type="button" onClick={() => setContactEditing(true)}><Pencil size={16} />Редактировать</button> : null}
            </div>
            {!contactEditing ? (
              <div className="client-info-list">
                <div>
                  <span>Контактное лицо</span>
                  <strong>{clientContact.name || "не заполнено"}</strong>
                </div>
                <div>
                  <span>Телефон</span>
                  <strong>{clientContact.phone || "не заполнено"}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{clientContact.email || "не заполнено"}</strong>
                </div>
                <div>
                  <span>Комментарий</span>
                  <strong>{clientContact.comment || "не заполнено"}</strong>
                </div>
              </div>
            ) : (
              <div className="client-team-editor">
                <label className="field-label">
                  Контактное лицо
                  <input value={contactDraft.name || ""} onChange={(event) => updateContactDraft("name", event.target.value)} maxLength={120} disabled={contactSaving} />
                </label>
                <div className="form-two">
                  <label className="field-label">
                    Телефон
                    <input type="tel" value={contactDraft.phone || ""} onChange={(event) => updateContactDraft("phone", event.target.value)} maxLength={80} disabled={contactSaving} />
                  </label>
                  <label className="field-label">
                    Email
                    <input type="email" value={contactDraft.email || ""} onChange={(event) => updateContactDraft("email", event.target.value)} maxLength={160} disabled={contactSaving} />
                  </label>
                </div>
                <label className="field-label">
                  Комментарий
                  <textarea value={contactDraft.comment || ""} onChange={(event) => updateContactDraft("comment", event.target.value)} maxLength={1000} disabled={contactSaving} rows={3} />
                </label>
                <div className="client-team-actions">
                  <button className="btn ghost" type="button" onClick={() => { setContactDraft(clientContact); setContactEditing(false); }} disabled={contactSaving}>Отмена</button>
                  <button className={loadingButtonClass("btn primary", contactSaving)} type="button" onClick={saveContact} disabled={contactSaving} aria-busy={contactSaving || undefined}>Сохранить контакты</button>
                </div>
              </div>
            )}
          </section>

          <section className="panel client-info-panel client-marketplaces-panel">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">Маркетплейсы</span>
                <h2>Разделы работы</h2>
                <p>Один кабинет откроется сразу, несколько покажем списком.</p>
              </div>
            </div>
            <div className="client-marketplace-picker">
              <button
                className={`client-marketplace-button wb ${marketplaceTab === "wildberries" ? "active" : ""}`}
                type="button"
                onClick={() => openMarketplace("wildberries", wbPortals)}
              >
                <Store size={18} />
                <span>Wildberries</span>
                <strong>{formatNumber(wbPortals.length)} {pluralRu(wbPortals.length, "кабинет", "кабинета", "кабинетов")}</strong>
              </button>
              {canSeeOzonBeta ? (
                <button
                  className={`client-marketplace-button ozon ${marketplaceTab === "ozon" ? "active" : ""}`}
                  type="button"
                  onClick={() => openMarketplace("ozon", ozonPortals)}
                >
                  <ShoppingBag size={18} />
                  <span>Ozon</span>
                  <strong>beta · {formatNumber(ozonPortals.length)}</strong>
                </button>
              ) : null}
            </div>
          </section>
        </div>

        {marketplaceTab === "overview" ? (
          <div className="empty-marketplace-state">
            <LayoutDashboard size={20} />
            <div>
              <strong>Выберите маркетплейс клиента</strong>
              <p>Wildberries откроет текущую работу сразу, если у клиента один WB-кабинет. Ozon пока доступен как beta-каркас.</p>
            </div>
          </div>
        ) : null}

        {marketplaceTab === "wildberries" ? (
          <ClientMarketplaceSection
            client={client}
            marketplaceKey="wildberries"
            portals={wbPortals}
            canManage={canManage}
            findUser={findUser}
            onOpenPortal={onOpenPortal}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            onOpenModal={onOpenModal}
          />
        ) : null}

        {marketplaceTab === "ozon" && canSeeOzonBeta ? (
          <ClientMarketplaceSection
            client={client}
            marketplaceKey="ozon"
            portals={ozonPortals}
            canManage={canManage}
            findUser={findUser}
            onOpenPortal={onOpenPortal}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            onAddOzon={onAddOzon}
          />
        ) : null}
      </div>
    </section>
  );
}

function ClientMarketplaceSection({ client, marketplaceKey, portals, canManage, findUser, onOpenPortal, onArchive, onRestore, onDelete, onOpenModal, onAddOzon }) {
  const isOzon = marketplaceKey === "ozon";
  const label = marketplaceTitle(marketplaceKey);
  const hasPortals = portals.length > 0;
  const emptyOzonTitle = "Ozon-кабинет еще не создан";
  return (
    <section className={`client-marketplace-shell marketplace-theme-${marketplaceKey}`}>
      <div className="client-marketplace-head">
        <div>
          <span className="section-eyebrow">{label}</span>
          <h2>{isOzon && !hasPortals ? emptyOzonTitle : `${label}: кабинеты клиента`}</h2>
          <p>
            {isOzon && !hasPortals
              ? "У клиента пока нет Ozon-контура. Создайте beta-кабинет, чтобы тестировать Ozon отдельно от WB."
              : `${label}: карточки, задачи и отчетные периоды внутри клиента.`}
          </p>
        </div>
        {isOzon ? <Tag tone="amber">{hasPortals ? "beta" : "не создан"}</Tag> : <Tag tone="blue">рабочий поток</Tag>}
      </div>

      <div className="workspace-grid">
        {portals.map((portal) => (
          <PortalCard
            key={portal.id}
            portal={portal}
            owner={findUser(portal.ownerLogin)}
            findUser={findUser}
            canManage={canManage}
            onOpen={() => onOpenPortal(portal)}
            onArchive={() => onArchive(portal)}
            onRestore={() => onRestore(portal)}
            onDelete={() => onDelete(portal)}
          />
        ))}
        {isOzon && !hasPortals ? (
          <OzonEmptyCard client={client} onAddOzon={onAddOzon} />
        ) : (
          <article className="workspace-card add-card">
            <div className={`seller-logo ${isOzon ? "ozon-logo" : ""}`}>{isOzon ? "OZ" : "+"}</div>
            <h2>Добавить {label} кабинет</h2>
            <p>{isOzon ? "Добавить Ozon beta-кабинет со ссылкой, Seller ID или SKU для проверки MPStats." : "Подключить WB через API или завести ручной кабинет."}</p>
            <button className="btn primary" type="button" onClick={() => (isOzon ? onAddOzon?.() : onOpenModal?.("api"))}>
              <Plus size={17} />
              {isOzon ? "Подключить Ozon" : `Добавить ${label}`}
            </button>
          </article>
        )}
      </div>
    </section>
  );
}

function OzonEmptyCard({ client, onAddOzon }) {
  return (
    <article className="workspace-card ozon-empty-card">
      <div className="card-head">
        <div className="seller">
          <div className="seller-logo ozon-logo">OZ</div>
          <div>
            <h2>Создать Ozon beta-кабинет</h2>
            <p>{client.name} · отдельный тестовый контур</p>
          </div>
        </div>
        <Tag tone="amber">beta</Tag>
      </div>
      <div className="ozon-empty-list">
        <span>Сначала укажите ссылку на кабинет, Seller ID или SKU.</span>
        <span>После создания можно проверить источник через MPStats.</span>
        <span>Карточки, задачи и периоды будут отдельными от WB.</span>
      </div>
      <div className="card-actions">
        <Tag tone="amber">MPStats beta</Tag>
        <button className="btn primary" type="button" onClick={() => onAddOzon?.()}>
          <Plus size={17} />
          Подключить Ozon
        </button>
      </div>
    </article>
  );
}

function EmptyMarketplaceState({ marketplaceTab }) {
  return (
    <div className="empty-marketplace-state">
      <Tags size={20} />
      <div>
        <strong>{marketplaceTitle(marketplaceTab)}: кабинетов пока нет</strong>
        <p>{marketplaceTab === "ozon" ? "Раздел включен как beta-каркас без API и без влияния на WB." : "Добавьте WB-кабинет, чтобы начать работу по клиенту."}</p>
      </div>
    </div>
  );
}

function PortalCard({ portal, owner, findUser, canManage, onOpen, onArchive, onRestore, onDelete }) {
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
        <MiniStat value={portalActiveTaskCount(portal)} label="задачи" />
      </div>
      <TeamSummary portal={portal} findUser={findUser} fallbackOwner={owner} />
      <div className="card-actions">
        <Tag tone={inactive ? "amber" : (portal.apiConnected ? "blue" : "amber")}>
          {inactive ? "В архиве" : (portal.apiConnected ? "API подключен" : "Ручной режим")}
        </Tag>
        <div className="portal-actions">
          {inactive ? (
            canManage ? (
              <>
                <button className="btn primary" type="button" onClick={onRestore}><RotateCcw size={16} />Вернуть</button>
                <button className="btn danger" type="button" onClick={onDelete}><Trash2 size={16} />Удалить</button>
              </>
            ) : null
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

function OzonSellerScreen({ portal, displayUsers, findUser, canManage = false, onBack, sellerTab = "cabinet", onSellerTabChange, onUpdateTeam, onUpdateName, onUpdateSource, onPortalUpdated, onOpenCard, onNotice, helpEnabled = false }) {
  const owner = findUser(portal.ownerLogin);
  const creator = portalCreatorInfo(portal, findUser);
  const displayName = portalDisplayName(portal);
  const sourceStoreUrl = String(portal.storeUrl || "").trim();
  const sourceManualText = String(portal.manualSource || "").trim();
  const sourceConfigured = Boolean(sourceStoreUrl || sourceManualText);
  const sourceSafeUrl = safeHttpsUrl(sourceStoreUrl);
  const scopeLabel = portal.scope === "selected" ? "выбранные карточки" : "полный кабинет";
  const team = getPortalTeam(portal);
  const activeSellerTab = normalizeSellerTab(sellerTab);
  const setSellerTab = onSellerTabChange || (() => {});
  const [teamEditing, setTeamEditing] = useState(false);
  const [teamDraft, setTeamDraft] = useState(team);
  const [teamSaving, setTeamSaving] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [nameSaving, setNameSaving] = useState(false);
  const [sourceEditing, setSourceEditing] = useState(false);
  const [sourceDraft, setSourceDraft] = useState({
    storeUrl: sourceStoreUrl,
    manualSource: sourceManualText,
  });
  const [sourceSaving, setSourceSaving] = useState(false);
  const [probeStatus, setProbeStatus] = useState("idle");
  const [probeResult, setProbeResult] = useState(null);
  const [probeSaveStatus, setProbeSaveStatus] = useState("idle");
  const [sourceExpanded, setSourceExpanded] = useState(!sourceConfigured);
  const [ozonWorkState, setOzonWorkState] = useState(() => readOzonWorkState(portal.id));
  const [ozonWorkStatus, setOzonWorkStatus] = useState("idle");
  const [ozonSemanticDrafts, setOzonSemanticDrafts] = useState([]);
  const [ozonCardDrafts, setOzonCardDrafts] = useState([]);
  const [ozonDraftStatus, setOzonDraftStatus] = useState("idle");
  const [cabinetExportStatus, setCabinetExportStatus] = useState("");

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
    if (!sourceEditing) {
      setSourceDraft({
        storeUrl: sourceStoreUrl,
        manualSource: sourceManualText,
      });
    }
  }, [portal.id, sourceStoreUrl, sourceManualText, sourceEditing]);

  useEffect(() => {
    writeOzonWorkState(portal.id, ozonWorkState);
  }, [portal.id, ozonWorkState]);

  useEffect(() => {
    let active = true;
    const localState = readOzonWorkState(portal.id);
    setOzonWorkState(localState);
    if (!portal?.id || portal.isDemo) {
      setOzonWorkStatus("local");
      return () => {
        active = false;
      };
    }
    setOzonWorkStatus("loading");
    apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-tasks`)
      .then(async (payload) => {
        if (!active) return;
        const backendState = {
          selectedKeys: localState.selectedKeys || [],
          tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
          recentEvents: Array.isArray(payload.recentEvents) ? payload.recentEvents : [],
        };
        if (!backendState.tasks.length && localState.tasks?.length) {
          try {
            const migrated = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-tasks`, {
              method: "POST",
              body: JSON.stringify({ tasks: localState.tasks }),
            });
            if (!active) return;
            setOzonWorkState({
              selectedKeys: localState.selectedKeys || [],
              tasks: Array.isArray(migrated.tasks) ? migrated.tasks : localState.tasks,
              recentEvents: Array.isArray(migrated.recentEvents) ? migrated.recentEvents : localState.recentEvents || [],
            });
            setOzonWorkStatus("saved");
            return;
          } catch {
            if (!active) return;
            setOzonWorkState(localState);
            setOzonWorkStatus("local-fallback");
            return;
          }
        }
        setOzonWorkState(backendState);
        setOzonWorkStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setOzonWorkState(localState);
        setOzonWorkStatus("local-fallback");
      });
    return () => {
      active = false;
    };
  }, [portal.id, portal.isDemo]);

  useEffect(() => {
    loadOzonResultDrafts();
  }, [portal.id, portal.isDemo, activeSellerTab]);

  function updateTeamDraft(roleKey, login) {
    setTeamDraft((current) => ({ ...current, [roleKey]: login }));
  }

  async function saveTeamDraft() {
    if (teamSaving) return;
    setTeamSaving(true);
    try {
      await onUpdateTeam?.(teamDraft);
      setTeamEditing(false);
    } finally {
      setTeamSaving(false);
    }
  }

  async function saveNameDraft() {
    const cleanName = nameDraft.trim();
    if (!cleanName) {
      onNotice?.("Название Ozon-кабинета не может быть пустым.");
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

  function updateSourceDraft(field, value) {
    setSourceDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveSourceDraft() {
    if (sourceSaving) return;
    setSourceSaving(true);
    try {
      const saved = await onUpdateSource?.({
        storeUrl: sourceDraft.storeUrl,
        manualSource: sourceDraft.manualSource,
      });
      if (saved !== false) {
        setSourceEditing(false);
      }
    } finally {
      setSourceSaving(false);
    }
  }

  async function saveOzonCards(cards, { silent = false } = {}) {
    if (!canManage || !cards.length || probeSaveStatus === "saving") {
      return null;
    }
    setProbeSaveStatus("saving");
    try {
      const response = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-mpstats-cards`, {
        method: "POST",
        body: JSON.stringify({ cards }),
      });
      if (response.portal) {
        onPortalUpdated?.(response.portal);
      }
      const total = Number(response.saved?.total || response.portal?.cardCount || cards.length || 0);
      const added = Number(response.saved?.added || 0);
      const updated = Number(response.saved?.updated || 0);
      setProbeSaveStatus("saved");
      if (!silent) {
        onNotice?.(`Обновили Ozon-карточки: всего ${formatNumber(total)}, новых ${formatNumber(added)}, обновлено ${formatNumber(updated)}.`);
      }
      return response;
    } catch (error) {
      setProbeSaveStatus("error");
      const message = error.message === "ozon_cards_missing"
        ? "Нет найденных карточек для сохранения."
        : error.message === "ozon_portal_required"
          ? "Сохранять Ozon-карточки можно только в Ozon-кабинет."
          : "Не удалось сохранить Ozon-карточки.";
      onNotice?.(message);
      return null;
    }
  }

  async function runOzonMpstatsProbe({ autoSave = true } = {}) {
    if (!canManage || !sourceConfigured || probeStatus === "loading") {
      return;
    }
    setProbeStatus("loading");
    setProbeResult(null);
    setProbeSaveStatus("idle");
    try {
      const result = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-mpstats-probe`, {
        method: "POST",
        body: JSON.stringify({ limit: 50 }),
      });
      setProbeResult(result);
      setProbeStatus("loaded");
      const count = Number(result.cardCount || result.totalEstimate || result.cards?.length || 0);
      if (count > 0) {
        if (autoSave && Array.isArray(result.cards) && result.cards.length) {
          const saved = await saveOzonCards(result.cards, { silent: true });
          if (saved) {
            const total = Number(saved.saved?.total || saved.portal?.cardCount || result.cards.length || 0);
            const added = Number(saved.saved?.added || 0);
            const updated = Number(saved.saved?.updated || 0);
            onNotice?.(`MPStats нашел ${formatNumber(count)} Ozon-карточек и обновил кабинет: всего ${formatNumber(total)}, новых ${formatNumber(added)}, обновлено ${formatNumber(updated)}.`);
          }
        } else {
          onNotice?.(`MPStats нашел Ozon-данные: ${count} ${pluralRu(count, "карточка", "карточки", "карточек")}.`);
        }
      } else {
        onNotice?.("MPStats не нашел Ozon-карточки по этому источнику. Проверьте ссылку, Seller ID или SKU.");
      }
    } catch (error) {
      setProbeStatus("error");
      const message = error.message === "mpstats_api_error" && error.payload?.message === "mpstats_key_missing"
        ? "MPStats не подключен: проверьте ключ в настройках."
        : error.message === "manual_source_missing"
          ? "Сначала заполните источник Ozon."
          : error.message === "ozon_source_unrecognized"
            ? "Не удалось распознать Ozon seller/SKU из источника."
            : "Не удалось проверить Ozon через MPStats.";
      setProbeResult({ status: "error", message });
      onNotice?.(message);
    }
  }

  async function saveOzonProbeCards() {
    const cards = Array.isArray(probeResult?.cards) ? probeResult.cards : [];
    await saveOzonCards(cards);
  }

  async function loadOzonResultDrafts() {
    if (!portal?.id || portal.isDemo) {
      setOzonSemanticDrafts([]);
      setOzonCardDrafts([]);
      setOzonDraftStatus("idle");
      return { semanticDrafts: [], cardDrafts: [] };
    }
    setOzonDraftStatus("loading");
    try {
      const [semanticPayload, cardPayload] = await Promise.all([
        apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-semantic-drafts`),
        apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-card-drafts`),
      ]);
      const semanticDrafts = Array.isArray(semanticPayload.drafts) ? semanticPayload.drafts : [];
      const cardDrafts = Array.isArray(cardPayload.drafts) ? cardPayload.drafts : [];
      setOzonSemanticDrafts(semanticDrafts);
      setOzonCardDrafts(cardDrafts);
      setOzonDraftStatus("loaded");
      return { semanticDrafts, cardDrafts };
    } catch {
      setOzonDraftStatus("error");
      return { semanticDrafts: ozonSemanticDrafts, cardDrafts: ozonCardDrafts };
    }
  }

  async function persistOzonWorkState(nextState) {
    writeOzonWorkState(portal.id, nextState);
    if (!portal?.id || portal.isDemo) {
      setOzonWorkStatus("local");
      return nextState;
    }
    setOzonWorkStatus("saving");
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-tasks`, {
        method: "POST",
        body: JSON.stringify({ tasks: nextState.tasks || [] }),
      });
      const savedState = {
        selectedKeys: nextState.selectedKeys || [],
        tasks: Array.isArray(payload.tasks) ? payload.tasks : nextState.tasks || [],
        recentEvents: Array.isArray(payload.recentEvents) ? payload.recentEvents : nextState.recentEvents || [],
      };
      setOzonWorkState(savedState);
      setOzonWorkStatus("saved");
      return savedState;
    } catch {
      setOzonWorkStatus("local-fallback");
      return nextState;
    }
  }

  function applyOzonWorkState(nextState) {
    setOzonWorkState(nextState);
    persistOzonWorkState(nextState);
  }

  async function downloadOzonSemanticCore() {
    setCabinetExportStatus("semantic-loading");
    try {
      const { semanticDrafts } = await loadOzonResultDrafts();
      const sheets = buildOzonSemanticCoreSheets(portal.realCards || [], semanticDrafts);
      if (!sheets.length) {
        setCabinetExportStatus("semantic-empty");
        onNotice?.("В Ozon-кабинете пока нет сохраненного итогового СЯ.");
        return;
      }
      downloadXlsx(`ozon семантическое ядро - ${safeFilePart(displayName)} - ${exportDatePart()}.xlsx`, sheets);
      setCabinetExportStatus("semantic-done");
    } catch {
      setCabinetExportStatus("semantic-error");
      onNotice?.("Не удалось скачать итоговое СЯ Ozon.");
    }
  }

  async function downloadOzonFinalContent() {
    setCabinetExportStatus("content-loading");
    try {
      const { cardDrafts } = await loadOzonResultDrafts();
      const sheets = buildOzonContentSheets(portal.realCards || [], cardDrafts);
      if (!sheets.length) {
        setCabinetExportStatus("content-empty");
        onNotice?.("В Ozon-кабинете пока нет принятого итогового контента.");
        return;
      }
      downloadXlsx(`ozon итоговый контент - ${safeFilePart(displayName)} - ${exportDatePart()}.xlsx`, sheets);
      setCabinetExportStatus("content-done");
    } catch {
      setCabinetExportStatus("content-error");
      onNotice?.("Не удалось скачать итоговый контент Ozon.");
    }
  }

  function updateOzonTaskStatus(taskId, status) {
    const now = new Date().toISOString();
    setOzonWorkState((current) => {
      const tasks = (current.tasks || []).map((task) => (
        task.id === taskId ? { ...task, status, updatedAt: now } : task
      ));
      const task = tasks.find((item) => item.id === taskId);
      const nextState = {
        ...current,
        tasks,
        recentEvents: [
          {
            id: `event-${Date.now()}`,
            action: status,
            label: `${task?.title || "Ozon карточка"}: ${ozonTaskStatusMeta(status).label}`,
            at: now,
          },
          ...(current.recentEvents || []),
        ].slice(0, 30),
      };
      persistOzonWorkState(nextState);
      return nextState;
    });
  }

  function deleteOzonTask(taskId) {
    setOzonWorkState((current) => {
      const nextState = {
        ...current,
        tasks: (current.tasks || []).filter((task) => task.id !== taskId),
        recentEvents: [
          { id: `event-${Date.now()}`, action: "deleted", label: "Ozon-задача удалена из beta-набора", at: new Date().toISOString() },
          ...(current.recentEvents || []),
        ].slice(0, 30),
      };
      persistOzonWorkState(nextState);
      return nextState;
    });
  }

  const ozonFlowRows = [
    ["Кабинет", "Ozon beta · отдельный от WB поток"],
    ["Источник", sourceConfigured ? "сохранен в кабинете" : "нужно указать"],
    ["Охват", scopeLabel],
    ["Карточки", sourceConfigured ? "можно проверять и сохранять" : "ожидают Ozon-specific источник"],
    ["СЯ", "MPStats по WB keyword-базе"],
    ["Задачи", "будут храниться отдельно от WB задач"],
    ["Отчеты", "отдельные Ozon периоды и выгрузки"],
  ];
  const ozonRouteRows = [
    { title: "Кабинет Ozon", status: "создан", className: "active" },
    { title: "Источник Ozon", status: sourceConfigured ? "задан" : "не задан", className: sourceConfigured ? "active" : "paused" },
    { title: "Карточки Ozon", status: sourceConfigured ? "следующий шаг" : "после источника", className: "pending" },
    { title: "СЯ через MPStats", status: "WB keyword-база", className: "pending" },
    { title: "Задачи Ozon", status: "после карточек", className: "pending" },
    { title: "Отчеты Ozon", status: "после периодов", className: "pending" },
  ];
  const probeCards = Array.isArray(probeResult?.cards) ? probeResult.cards : [];
  const hasProbeCards = probeCards.length > 0;
  const sourceTag = sourceConfigured ? "MPStats витрина" : "Без API";
  const sourceDescription = sourceConfigured
    ? "Кабинет заведен без Ozon Seller API, а карточки загружаются через MPStats по ссылке на магазин, бренд, продавца, Seller ID или SKU. Ozon API можно подключить позже."
    : "Кабинет заведен без Ozon Seller API. Здесь фиксируем ссылку на магазин, Seller ID, список SKU или исходные данные клиента; карточки можно загрузить через MPStats или позже подключить API.";
  const sourceDetailsOpen = sourceExpanded || sourceEditing || !sourceConfigured || probeStatus === "loading" || probeSaveStatus === "saving";

  return (
    <section className="screen active marketplace-theme-ozon">
      <header className="topbar">
        <div className="title">
          <div className="seller-title-row">
            {nameEditing ? (
              <div className="seller-name-editor">
                <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={120} autoFocus />
                <button className={loadingButtonClass("btn primary", nameSaving)} type="button" onClick={saveNameDraft} disabled={nameSaving} aria-busy={nameSaving || undefined}>
                  {nameSaving ? "Сохраняем" : "Сохранить"}
                </button>
                <button className="btn ghost" type="button" onClick={() => { setNameDraft(displayName); setNameEditing(false); }} disabled={nameSaving}>Отмена</button>
              </div>
            ) : (
              <>
                <h1>{displayName}</h1>
                {canManage ? <IconButton icon={Pencil} label="Редактировать название Ozon-кабинета" onClick={() => setNameEditing(true)} /> : null}
              </>
            )}
          </div>
          <p>Ozon · beta-кабинет · {scopeLabel} · отдельная логика данных · ответственный {owner?.full_name} · создал {creator.name}{creator.date ? ` · ${creator.date}` : ""}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={onBack}><ArrowLeft size={17} />Клиент</button>
          <button className="btn primary" type="button" onClick={() => setSellerTab("tasks")}><ClipboardList size={17} />Задачи</button>
        </div>
      </header>

      <div className="content">
        <div className="seller-layout">
          <div className="seller-main">
            <div className="seller-tabs">
              <button className={activeSellerTab === "cabinet" ? "active" : ""} type="button" onClick={() => setSellerTab("cabinet")}>Кабинет</button>
              <button className={activeSellerTab === "tasks" ? "active" : ""} type="button" onClick={() => setSellerTab("tasks")}>Задачи</button>
              <button className={activeSellerTab === "reports" ? "active" : ""} type="button" onClick={() => setSellerTab("reports")}>Отчеты</button>
              <button className={activeSellerTab === "work-periods" ? "active" : ""} type="button" onClick={() => setSellerTab("work-periods")}>Отчетный период</button>
            </div>
            <HelpHint enabled={helpEnabled} title="Ozon beta">
              Этот кабинет не использует WB API. Карточки, задачи и отчетные периоды будут развиваться как отдельный Ozon-поток, а семантика может брать ключи из MPStats по WB keyword-базе.
            </HelpHint>

            {activeSellerTab === "cabinet" ? (
              <>
                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Обзор Ozon-кабинета</h2>
                      <p>Каркас для теста Ozon внутри клиента без влияния на текущий WB-поток.</p>
                    </div>
                    <Tag tone="amber">beta</Tag>
                  </div>
                  <div className="summary-grid">
                    <Metric label="Карточек Ozon" value={formatNumber(portal.cardCount)} />
                    <Metric label="К проверке" value={formatNumber(portal.problemCount)} />
                    <Metric label="Активные задачи" value={formatNumber(portalActiveTaskCount(portal))} />
                    <Metric label="Источник" value="Ozon" hint="отдельно от WB" />
                  </div>
                </section>

                <div className="seller-context-grid">
                  <section className="workspace-strip project-strip">
                    <div className="panel-title-row">
                      <div>
                        <h2>Состав проекта</h2>
                        <p>Команда Ozon-кабинета внутри клиента.</p>
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
                              <select className="select" value={teamDraft[roleKey] || ""} onChange={(event) => updateTeamDraft(roleKey, event.target.value)} disabled={teamSaving}>
                                <option value="">Не назначен</option>
                                {users.map((user) => <option value={user.login} key={user.login}>{user.full_name}</option>)}
                              </select>
                            </label>
                          );
                        })}
                        <div className="team-editor-actions">
                          <button className={loadingButtonClass("btn primary", teamSaving)} type="button" onClick={saveTeamDraft} disabled={teamSaving} aria-busy={teamSaving || undefined}>{teamSaving ? "Сохраняем" : "Сохранить состав"}</button>
                          <button className="btn ghost" type="button" onClick={() => { setTeamDraft(team); setTeamEditing(false); }} disabled={teamSaving}>Отмена</button>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="workspace-strip security-strip">
                    <div>
                      <h2>Контур Ozon</h2>
                      <p>Отдельные данные и ограничения beta-кабинета.</p>
                    </div>
                    <div className="security-inline-list">
                      <div><span>Ozon API</span><strong>не подключен</strong></div>
                      <div><span>WB API</span><strong>не используется</strong></div>
                      <div><span>MPStats</span><strong>WB ключи для СЯ</strong></div>
                    </div>
                  </section>
                </div>

                <section className={`workspace-strip source-strip ${sourceDetailsOpen ? "expanded" : "collapsed"}`}>
                  <div className="strip-head">
                    <div>
                      <h2>Источник данных</h2>
                      <p>{sourceDescription}</p>
                    </div>
                    <div className="strip-actions">
                      <Tag tone={sourceConfigured ? "blue" : "amber"}>{sourceTag}</Tag>
                      <button className="btn" type="button" onClick={() => setSourceExpanded((value) => !value)}>
                        {sourceDetailsOpen ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                        {sourceDetailsOpen ? "Свернуть" : "Развернуть"}
                      </button>
                    </div>
                  </div>
                  {sourceDetailsOpen ? (
                    <div className="source-details">
                      <HelpHint enabled={helpEnabled} title="Ozon и MPStats">
                        Нажимайте Обновить карточки, чтобы проверить сохраненный Ozon-источник через MPStats и сразу сохранить найденные карточки в Ozon-кабинет.
                      </HelpHint>
                      {sourceEditing ? (
                        <div className="ozon-source-editor">
                          <label className="field-label">
                            Ссылка, Seller ID или ориентир Ozon
                            <input
                              value={sourceDraft.storeUrl}
                              onChange={(event) => updateSourceDraft("storeUrl", event.target.value)}
                              placeholder="https://www.ozon.ru/seller/... или Seller ID"
                              disabled={sourceSaving}
                            />
                          </label>
                          <label className="field-label">
                            Что есть на старте
                            <textarea
                              value={sourceDraft.manualSource}
                              onChange={(event) => updateSourceDraft("manualSource", event.target.value)}
                              placeholder="Например: список SKU, ссылка на витрину, файл клиента или комментарий по тестовой пачке."
                              disabled={sourceSaving}
                            />
                          </label>
                          <div className="team-editor-actions">
                            <button className={loadingButtonClass("btn primary", sourceSaving)} type="button" onClick={saveSourceDraft} disabled={sourceSaving} aria-busy={sourceSaving || undefined}>
                              <Save size={16} />{sourceSaving ? "Сохраняем" : "Сохранить источник"}
                            </button>
                            <button className="btn ghost" type="button" onClick={() => { setSourceDraft({ storeUrl: sourceStoreUrl, manualSource: sourceManualText }); setSourceEditing(false); }} disabled={sourceSaving}>Отмена</button>
                          </div>
                        </div>
                      ) : (
                        <div className="manual-source-box ozon-source-box">
                          <div className="manual-source-row">
                            <span>Ozon ориентир</span>
                            {sourceStoreUrl ? (
                              sourceSafeUrl ? <a href={sourceSafeUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{sourceStoreUrl}</a> : <strong>{sourceStoreUrl}</strong>
                            ) : <strong>не указан</strong>}
                          </div>
                          <div className="manual-source-row">
                            <span>Исходные данные</span>
                            <p>{sourceManualText || "Пока не описаны"}</p>
                          </div>
                          {canManage ? (
                            <div className="manual-source-actions">
                              <button className="btn" type="button" onClick={() => setSourceEditing(true)}><Pencil size={16} />Редактировать источник</button>
                            </div>
                          ) : null}
                        </div>
                      )}
                      <div className="source-flow">
                        {ozonFlowRows.map(([label, value]) => (
                          <div className="list-row source-flow-row" key={label}><span>{label}</span><strong>{value}</strong></div>
                        ))}
                      </div>
                      <div className="panel-actions ozon-source-actions">
                        <button className={loadingButtonClass("btn primary", probeStatus === "loading" || probeSaveStatus === "saving")} type="button" onClick={() => runOzonMpstatsProbe({ autoSave: true })} disabled={!canManage || !sourceConfigured || probeStatus === "loading" || probeSaveStatus === "saving"} aria-busy={probeStatus === "loading" || probeSaveStatus === "saving" || undefined}>
                          <RefreshCw size={16} />{probeStatus === "loading" ? "Ищем данные" : probeSaveStatus === "saving" ? "Сохраняем" : "Обновить карточки"}
                        </button>
                        <button className="btn" type="button" onClick={() => runOzonMpstatsProbe({ autoSave: false })} disabled={!canManage || !sourceConfigured || probeStatus === "loading" || probeSaveStatus === "saving"}>
                          <Search size={16} />Проверить источник
                        </button>
                        <button className={loadingButtonClass("btn", probeSaveStatus === "saving")} type="button" onClick={saveOzonProbeCards} disabled={!canManage || !hasProbeCards || probeSaveStatus === "saving" || probeSaveStatus === "saved"} aria-busy={probeSaveStatus === "saving" || undefined} title={hasProbeCards ? "Сохранить найденные MPStats карточки в Ozon-кабинет" : "Сначала проверьте источник через MPStats"}>
                          <Save size={16} />{probeSaveStatus === "saved" ? "Карточки обновлены" : probeSaveStatus === "saving" ? "Сохраняем" : "Сохранить найденные"}
                        </button>
                        <button className="btn ghost" type="button" disabled title="Появится после подключения Ozon-задач и Ozon-черновиков">
                          <Trash2 size={16} />Обнулить работу
                        </button>
                        <button className="btn" type="button" disabled title="Ozon Seller API подключим отдельным шагом">
                          <Upload size={16} />Подключить API
                        </button>
                      </div>
                      <OzonMpstatsProbeResult result={probeResult} status={probeStatus} canSave={false} saveStatus={probeSaveStatus} onSave={saveOzonProbeCards} />
                    </div>
                  ) : (
                    <div className="source-collapsed-summary">
                      <span>{sourceStoreUrl || sourceManualText ? "Источник сохранен" : "Источник не заполнен"}</span>
                      <strong>{formatNumber(portal.cardCount)} {pluralRu(portal.cardCount, "карточка", "карточки", "карточек")}</strong>
                    </div>
                  )}
                </section>

                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Маршрут Ozon</h2>
                      <p>Форма работы похожа на WB, но карточки, задачи и отчеты будут храниться в Ozon-контуре.</p>
                    </div>
                    <Tag tone="blue">{sourceConfigured ? "2 из 6" : "1 из 6"}</Tag>
                  </div>
                  <div className="pipeline">
                    {ozonRouteRows.map((step) => (
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
                      <h2>Итоговые выгрузки</h2>
                      <p>Файлы Ozon собираются только из сохраненных результатов Ozon-карточек.</p>
                    </div>
                    <Tag tone={cabinetExportStatus.endsWith("loading") ? "blue" : "green"}>
                      {cabinetExportStatus.endsWith("loading") ? "готовим файл" : "XLSX"}
                    </Tag>
                  </div>
                  <div className="panel-actions">
                    <button className={loadingButtonClass("btn", cabinetExportStatus === "semantic-loading")} type="button" onClick={downloadOzonSemanticCore} disabled={portal.isDemo || cabinetExportStatus === "semantic-loading"} aria-busy={cabinetExportStatus === "semantic-loading" || undefined}>
                      <Download size={16} />{cabinetExportStatus === "semantic-loading" ? "Собираем СЯ" : "Скачать итоговое СЯ по кабинету"}
                    </button>
                    <button className={loadingButtonClass("btn", cabinetExportStatus === "content-loading")} type="button" onClick={downloadOzonFinalContent} disabled={portal.isDemo || cabinetExportStatus === "content-loading"} aria-busy={cabinetExportStatus === "content-loading" || undefined}>
                      <Download size={16} />{cabinetExportStatus === "content-loading" ? "Собираем контент" : "Скачать итоговый контент"}
                    </button>
                  </div>
                  {cabinetExportStatus === "semantic-empty" ? <p className="status-note">Сохраненного итогового Ozon-СЯ пока нет.</p> : null}
                  {cabinetExportStatus === "content-empty" ? <p className="status-note">Принятого Ozon-контента пока нет.</p> : null}
                </section>

                <OzonCardsPanel
                  cards={portal.realCards || []}
                  portalId={portal.id}
                  workState={ozonWorkState}
                  workStatus={ozonWorkStatus}
                  semanticDrafts={ozonSemanticDrafts}
                  cardDrafts={ozonCardDrafts}
                  draftStatus={ozonDraftStatus}
                  onWorkStateChange={applyOzonWorkState}
                  onOpenCard={onOpenCard}
                  onOpenTasks={() => setSellerTab("tasks")}
                />
              </>
            ) : null}

            {activeSellerTab === "tasks" ? (
              <OzonTasksPanel
                cards={portal.realCards || []}
                workState={ozonWorkState}
                workStatus={ozonWorkStatus}
                semanticDrafts={ozonSemanticDrafts}
                cardDrafts={ozonCardDrafts}
                draftStatus={ozonDraftStatus}
                onOpenCard={onOpenCard}
                onUpdateTaskStatus={updateOzonTaskStatus}
                onDeleteTask={deleteOzonTask}
              />
            ) : null}
            {activeSellerTab === "reports" ? (
              <OzonPlaceholderPanel
                title="Отчеты Ozon"
                copy="Здесь будут Ozon-периоды и выгрузки. WB XLSX-отчет в этот поток не подключается."
                tag="Ozon"
              />
            ) : null}
            {activeSellerTab === "work-periods" ? (
              <WorkPeriodsPanel portal={portal} findUser={findUser} canManage={canManage} onNotice={onNotice} helpEnabled={helpEnabled} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function OzonPlaceholderPanel({ title, copy, tag }) {
  return (
    <section className="workspace-strip">
      <div className="strip-head">
        <div>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
        <Tag tone="amber">{tag}</Tag>
      </div>
      <div className="empty-state">
        <strong>Ozon beta</strong>
        <span>{copy}</span>
      </div>
    </section>
  );
}

function ozonCardIdentity(card) {
  const rawFields = rawFieldsForCard(card);
  const sku = textOrDash(card?.sku || card?.id || rawFields.sku || rawFields.id || rawFields.productId);
  const offerId = textOrDash(card?.offerId || card?.vendorCode || rawFields.offerId || rawFields.offer_id || rawFields.vendorCode);
  return { sku, offerId };
}

function ozonCardCategory(card) {
  const rawFields = rawFieldsForCard(card);
  return textOrDash(card?.subjectName || card?.category || rawFields.category || rawFields.categoryName);
}

function ozonCardCharacteristicItems(card) {
  const rawFields = rawFieldsForCard(card);
  const source = card?.characteristics || rawFields.characteristics || [];
  if (Array.isArray(source)) {
    return source.filter((item) => !isEmptyValue(item));
  }
  if (source && typeof source === "object") {
    return Object.entries(source)
      .filter(([, value]) => !isEmptyValue(value))
      .map(([name, value]) => ({ name, value }));
  }
  return [];
}

function ozonCardPhotoCount(card) {
  const rawFields = rawFieldsForCard(card);
  const photos = Array.isArray(card?.photos) ? card.photos : (Array.isArray(rawFields.photos) ? rawFields.photos : []);
  return photos.length || (bestPhotoUrl(card) ? 1 : 0);
}

function ozonCardMetricValue(card, keys) {
  const rawFields = rawFieldsForCard(card);
  const mpstats = card?.mpstats && typeof card.mpstats === "object" ? card.mpstats : {};
  for (const key of keys) {
    const value = firstDefined(card?.[key], rawFields[key], mpstats[key]);
    if (!isEmptyValue(value)) {
      return value;
    }
  }
  return "";
}

function ozonCardProblemReasons(card) {
  const reasons = [];
  const rawFields = rawFieldsForCard(card);
  const title = String(card?.title || rawFields.title || rawFields.name || "").trim();
  const { sku } = ozonCardIdentity(card);
  if (!title) {
    reasons.push("нет названия");
  }
  if (sku === "Не указано") {
    reasons.push("нет SKU");
  }
  if (!ozonCardPhotoCount(card)) {
    reasons.push("нет фото");
  }
  if (!ozonCardCharacteristicItems(card).length) {
    reasons.push("нет характеристик");
  }
  return reasons;
}

function ozonCardDataSignals(card) {
  const signals = [];
  const rawFields = rawFieldsForCard(card);
  const brand = String(card?.brand || rawFields.brand || "").trim();
  const category = ozonCardCategory(card);
  const price = ozonCardMetricValue(card, ["price", "finalPrice", "final_price"]);
  const stock = ozonCardMetricValue(card, ["stock", "balance", "available_stock"]);
  const description = String(card?.description || rawFields.description || "").trim();
  if (!brand) {
    signals.push("бренд не указан");
  }
  if (category === "Не указано") {
    signals.push("категория не указана");
  }
  if (!description) {
    signals.push("нет описания");
  }
  if (isEmptyValue(price)) {
    signals.push("нет цены");
  }
  if (isEmptyValue(stock)) {
    signals.push("нет остатка");
  }
  return signals;
}

function ozonCardCompleteness(card) {
  const rawFields = rawFieldsForCard(card);
  const { sku, offerId } = ozonCardIdentity(card);
  const checks = [
    String(card?.title || rawFields.title || rawFields.name || "").trim(),
    sku !== "Не указано",
    offerId !== "Не указано",
    ozonCardCategory(card) !== "Не указано",
    String(card?.brand || rawFields.brand || "").trim(),
    ozonCardPhotoCount(card) > 0,
    ozonCardCharacteristicItems(card).length > 0,
    !isEmptyValue(ozonCardMetricValue(card, ["price", "finalPrice", "final_price"])),
  ];
  const filled = checks.filter(Boolean).length;
  const total = checks.length;
  if (filled >= 7) {
    return { label: `${filled}/${total}`, tone: "green" };
  }
  if (filled >= 5) {
    return { label: `${filled}/${total}`, tone: "amber" };
  }
  return { label: `${filled}/${total}`, tone: "red" };
}

function ozonCardWorkState(card) {
  const problems = ozonCardProblemReasons(card);
  const status = String(card?.status || "").trim();
  if (status && status.toLowerCase().includes("error")) {
    return { label: "Ошибка источника", tone: "red" };
  }
  if (problems.length) {
    return { label: "Проверить данные", tone: "amber" };
  }
  return { label: "Ozon snapshot", tone: "green" };
}

function ozonCardSearchText(card) {
  const rawFields = rawFieldsForCard(card);
  const { sku, offerId } = ozonCardIdentity(card);
  return [
    card?.title,
    sku,
    offerId,
    card?.brand || rawFields.brand,
    ozonCardCategory(card),
    card?.sellerName || rawFields.sellerName || rawFields.seller || rawFields.shopName,
    card?.status,
    ...ozonCardProblemReasons(card),
    ...ozonCardDataSignals(card),
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function ozonCardStableKey(card) {
  const { sku, offerId } = ozonCardIdentity(card);
  return normalizeDraftKeyValue(sku !== "Не указано" ? sku : offerId) || cardDraftKey(card);
}

function ozonWorkStorageKey(portalId) {
  return `opticards-ozon-work:${portalId || "portal"}`;
}

function readOzonWorkState(portalId) {
  if (typeof window === "undefined") {
    return { selectedKeys: [], tasks: [], recentEvents: [] };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(ozonWorkStorageKey(portalId)) || "{}");
    return {
      selectedKeys: Array.isArray(parsed.selectedKeys) ? parsed.selectedKeys.map(String).filter(Boolean) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
    };
  } catch {
    return { selectedKeys: [], tasks: [], recentEvents: [] };
  }
}

function writeOzonWorkState(portalId, state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ozonWorkStorageKey(portalId), JSON.stringify({
    selectedKeys: Array.isArray(state?.selectedKeys) ? state.selectedKeys : [],
    tasks: Array.isArray(state?.tasks) ? state.tasks : [],
    recentEvents: Array.isArray(state?.recentEvents) ? state.recentEvents.slice(0, 30) : [],
  }));
}

function ozonTaskStatusMeta(status) {
  if (status === "done") return { label: "готово", tone: "green" };
  if (status === "skipped") return { label: "пропущено", tone: "amber" };
  if (status === "later") return { label: "вернуться позже", tone: "blue" };
  if (status === "returned") return { label: "возврат", tone: "red" };
  return { label: "в работе", tone: "blue" };
}

function ozonTaskForCard(card, tasks = []) {
  const key = ozonCardStableKey(card);
  return (Array.isArray(tasks) ? tasks : []).find((task) => task.cardKey === key) || null;
}

function ozonWorkStateForCard(card, selectedSet, tasks = []) {
  const task = ozonTaskForCard(card, tasks);
  if (task) {
    return ozonTaskStatusMeta(task.status);
  }
  if (selectedSet.has(ozonCardStableKey(card))) {
    return { label: "В наборе", tone: "blue" };
  }
  return ozonCardWorkState(card);
}

function ozonKeywordTokens(...values) {
  const stopWords = new Set(["для", "или", "это", "как", "без", "при", "над", "под", "что", "the", "and", "with", "ozon", "mpstats"]);
  const seen = new Set();
  const tokens = [];
  values
    .join(" ")
    .toLowerCase()
    .replace(/[^0-9a-zа-яё\s-]+/gi, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !stopWords.has(item))
    .forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        tokens.push(item);
      }
    });
  return tokens;
}

function ozonSemanticDraftRows(card, seedQuery = "") {
  const rawFields = rawFieldsForCard(card);
  const title = card?.title || rawFields.title || rawFields.name || "";
  const description = card?.description || rawFields.description || "";
  const brand = card?.brand || rawFields.brand || "";
  const category = ozonCardCategory(card);
  const currentTokens = ozonKeywordTokens(title, description).slice(0, 12);
  const seedTokens = ozonKeywordTokens(seedQuery, brand, category).slice(0, 10);
  const current = currentTokens.map((query, index) => ({
    query,
    status: "selected",
    frequency: "",
    position: index < 4 ? index + 1 : "",
    source: "Ozon карточка",
  }));
  const recommendations = [...new Set([...seedTokens, ...ozonKeywordTokens(category, brand, title).slice(0, 10)])]
    .filter((query) => !currentTokens.includes(query))
    .slice(0, 16)
    .map((query, index) => ({
      query,
      status: "recommended",
      frequency: "",
      position: "",
      source: index < seedTokens.length ? "MPStats/WB keyword-база" : "Ozon snapshot",
    }));
  return { current, recommendations };
}

function ozonDraftMap(drafts = []) {
  return new Map((Array.isArray(drafts) ? drafts : []).map((draft) => [String(draft.cardKey || ""), draft]).filter(([key]) => key));
}

function ozonSemanticDraftHasFinal(draft) {
  const finalRows = draft?.draft?.final;
  return Array.isArray(finalRows) && finalRows.some((item) => String(item?.query || "").trim());
}

function ozonCardDraftHasFinalContent(draft) {
  if (draft?.hasFinalContent) return true;
  const approval = draft?.draft?.approval || {};
  const content = draft?.draft?.content || {};
  return ["approved", "exported"].includes(approval.contentStatus) && Boolean(String(content.title || content.description || "").trim());
}

function ozonCardContentStatusMeta(draft) {
  const status = draft?.draft?.approval?.contentStatus || "draft";
  if (status === "approved" || status === "exported") return { label: "контент принят", tone: "green" };
  if (status === "submitted") return { label: "контент на проверке", tone: "amber" };
  return { label: "контент черновик", tone: "blue" };
}

function ozonTaskResultMeta(task, semanticDrafts = [], cardDrafts = []) {
  const semanticDraft = ozonDraftMap(semanticDrafts).get(task.cardKey);
  const cardDraft = ozonDraftMap(cardDrafts).get(task.cardKey);
  const hasSemanticFinal = Boolean(task.hasSemanticFinal || ozonSemanticDraftHasFinal(semanticDraft));
  const hasFinalContent = Boolean(task.hasFinalContent || ozonCardDraftHasFinalContent(cardDraft));
  if (task.status === "returned") return { label: "возврат", tone: "red", hasSemanticFinal, hasFinalContent };
  if (task.status === "later") return { label: "вернуться позже", tone: "blue", hasSemanticFinal, hasFinalContent };
  if (task.status === "skipped") return { label: "пропущено", tone: "amber", hasSemanticFinal, hasFinalContent };
  if (hasSemanticFinal && hasFinalContent) return { label: "СЯ + контент готовы", tone: "green", hasSemanticFinal, hasFinalContent };
  if (hasSemanticFinal) return { label: "СЯ готово", tone: "blue", hasSemanticFinal, hasFinalContent };
  if (hasFinalContent) return { label: "контент готов", tone: "blue", hasSemanticFinal, hasFinalContent };
  if (task.status === "done") return { label: "готово вручную", tone: "green", hasSemanticFinal, hasFinalContent };
  return { label: "без итогового СЯ", tone: "amber", hasSemanticFinal, hasFinalContent };
}

function buildOzonSemanticCoreSheets(cards, drafts) {
  const cardsByKey = new Map((Array.isArray(cards) ? cards : []).map((card) => [ozonCardStableKey(card), card]));
  const usedNames = new Set();
  const sheets = (Array.isArray(drafts) ? drafts : [])
    .filter(ozonSemanticDraftHasFinal)
    .map((draft) => {
      const card = cardsByKey.get(draft.cardKey) || {};
      const data = draft.draft || {};
      const rows = [
        ["SKU", "Offer ID", "Название", "Текущий ключ", "К добавлению", "К исключению", "Итоговое СЯ"],
      ];
      const current = Array.isArray(data.current) ? data.current : [];
      const selected = Array.isArray(data.selected) ? data.selected : [];
      const removal = Array.isArray(data.removal) ? data.removal : [];
      const finalRows = Array.isArray(data.final) ? data.final : [];
      const maxRows = Math.max(current.length, selected.length, removal.length, finalRows.length, 1);
      for (let index = 0; index < maxRows; index += 1) {
        rows.push([
          draft.sku || data.sku || "",
          draft.offerId || data.offerId || "",
          draft.title || data.title || card.title || "",
          current[index]?.query || "",
          selected[index]?.query || "",
          removal[index]?.query || "",
          finalRows[index]?.query || "",
        ]);
      }
      return {
        name: cardExportSheetName({ vendorCode: draft.offerId || draft.sku, nmID: draft.sku, title: draft.title }, draft, usedNames),
        freezeRows: 1,
        widths: [22, 22, 52, 34, 34, 34, 34],
        rows,
      };
    });
  return sheets.length ? [
    {
      name: "Инструкция",
      widths: [32, 96],
      rows: [
        ["Раздел", "Описание"],
        ["Ozon СЯ", "Файл собран из сохраненных итоговых СЯ Ozon-карточек. WB API и WB card_drafts не используются."],
        ["Итоговое СЯ", "Финальный набор ключей, сохраненный во вкладке Семантическое ядро Ozon."],
      ],
    },
    ...sheets,
  ] : [];
}

function buildOzonContentSheets(cards, drafts) {
  const cardsByKey = new Map((Array.isArray(cards) ? cards : []).map((card) => [ozonCardStableKey(card), card]));
  const usedNames = new Set();
  return (Array.isArray(drafts) ? drafts : [])
    .filter(ozonCardDraftHasFinalContent)
    .map((draft) => {
      const card = cardsByKey.get(draft.cardKey) || {};
      const content = draft.draft?.content || {};
      const characteristics = content.characteristics;
      const characteristicRows = Array.isArray(characteristics)
        ? characteristics.map((item) => [item?.name || "", valueSummary(item?.value)])
        : Object.entries(characteristics || {}).map(([name, value]) => [name, valueSummary(value)]);
      return {
        name: cardExportSheetName({ vendorCode: draft.offerId || draft.sku, nmID: draft.sku, title: draft.title }, draft, usedNames),
        freezeRows: 1,
        widths: [22, 22, 52, 96, 36, 64],
        rows: [
          ["SKU", "Offer ID", "Итоговый заголовок", "Итоговое описание", "Характеристика", "Значение"],
          [draft.sku || "", draft.offerId || "", content.title || card.title || "", content.description || "", "", ""],
          ...characteristicRows.map(([name, value]) => [draft.sku || "", draft.offerId || "", "", "", name, value]),
        ],
      };
    });
}

function OzonCardsPanel({ cards, portalId, workState, workStatus = "idle", semanticDrafts = [], cardDrafts = [], draftStatus = "idle", onWorkStateChange, onOpenCard, onOpenTasks }) {
  const [query, setQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState("all");
  const [workFilter, setWorkFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const visibleCards = Array.isArray(cards) ? cards : [];
  const selectedKeys = Array.isArray(workState?.selectedKeys) ? workState.selectedKeys : [];
  const selectedSet = new Set(selectedKeys);
  const tasks = Array.isArray(workState?.tasks) ? workState.tasks : [];
  const semanticDraftMap = ozonDraftMap(semanticDrafts);
  const contentDraftMap = ozonDraftMap(cardDrafts);
  if (!visibleCards.length) {
    return (
      <OzonPlaceholderPanel
        title="Карточки Ozon"
        copy="Карточки появятся после проверки MPStats и явного сохранения найденного результата. WB-карточки сюда не подмешиваются."
        tag="нет данных"
      />
    );
  }
  const normalizedQuery = query.trim().toLowerCase();
  const categories = [...new Set(visibleCards.map(ozonCardCategory).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"));
  const problemCards = visibleCards.filter((card) => ozonCardProblemReasons(card).length);
  const signalCards = visibleCards.filter((card) => ozonCardDataSignals(card).length);
  const signalOnlyCards = signalCards.filter((card) => !ozonCardProblemReasons(card).length);
  const cleanCards = visibleCards.filter((card) => !ozonCardProblemReasons(card).length && !ozonCardDataSignals(card).length);
  const readyCards = visibleCards.filter((card) => !ozonCardProblemReasons(card).length);
  const taskCards = visibleCards.filter((card) => ozonTaskForCard(card, tasks));
  const semanticFinalCards = visibleCards.filter((card) => ozonSemanticDraftHasFinal(semanticDraftMap.get(ozonCardStableKey(card))));
  const contentFinalCards = visibleCards.filter((card) => ozonCardDraftHasFinalContent(contentDraftMap.get(ozonCardStableKey(card))));
  const selectedCards = visibleCards.filter((card) => selectedSet.has(ozonCardStableKey(card)));
  const filteredCards = visibleCards.filter((card) => {
    const hasProblems = ozonCardProblemReasons(card).length > 0;
    const hasSignals = ozonCardDataSignals(card).length > 0;
    const cardWorkState = ozonWorkStateForCard(card, selectedSet, tasks);
    if (issueFilter === "problems" && !hasProblems) {
      return false;
    }
    if (issueFilter === "signals" && (!hasSignals || hasProblems)) {
      return false;
    }
    if (issueFilter === "clean" && (hasProblems || hasSignals)) {
      return false;
    }
    if (workFilter === "ready" && hasProblems) {
      return false;
    }
    if (workFilter === "check" && cardWorkState.label !== "Проверить данные") {
      return false;
    }
    if (workFilter === "tasks" && !ozonTaskForCard(card, tasks)) {
      return false;
    }
    if (workFilter === "without-semantic" && ozonSemanticDraftHasFinal(semanticDraftMap.get(ozonCardStableKey(card)))) {
      return false;
    }
    if (workFilter === "semantic-final" && !ozonSemanticDraftHasFinal(semanticDraftMap.get(ozonCardStableKey(card)))) {
      return false;
    }
    if (workFilter === "content-final" && !ozonCardDraftHasFinalContent(contentDraftMap.get(ozonCardStableKey(card)))) {
      return false;
    }
    if (workFilter === "selected" && !selectedSet.has(ozonCardStableKey(card))) {
      return false;
    }
    if (categoryFilter !== "all" && ozonCardCategory(card) !== categoryFilter) {
      return false;
    }
    if (normalizedQuery && !ozonCardSearchText(card).includes(normalizedQuery)) {
      return false;
    }
    return true;
  });
  const visibleKeys = filteredCards.map(ozonCardStableKey);
  const allVisibleSelected = Boolean(visibleKeys.length) && visibleKeys.every((key) => selectedSet.has(key));

  function updateWorkState(nextPatch) {
    const next = { selectedKeys, tasks, recentEvents: workState?.recentEvents || [], ...nextPatch };
    onWorkStateChange?.(next);
  }

  function toggleCard(card) {
    const key = ozonCardStableKey(card);
    const nextKeys = selectedSet.has(key)
      ? selectedKeys.filter((item) => item !== key)
      : [...selectedKeys, key];
    updateWorkState({ selectedKeys: nextKeys });
  }

  function toggleVisible() {
    const nextSet = new Set(selectedKeys);
    if (allVisibleSelected) {
      visibleKeys.forEach((key) => nextSet.delete(key));
    } else {
      visibleKeys.forEach((key) => nextSet.add(key));
    }
    updateWorkState({ selectedKeys: [...nextSet] });
  }

  function createOzonTaskBatch() {
    const now = new Date().toISOString();
    const existingKeys = new Set(tasks.map((task) => task.cardKey));
    const nextTasks = [
      ...tasks,
      ...selectedCards
        .filter((card) => !existingKeys.has(ozonCardStableKey(card)))
        .map((card, index) => {
          const rawFields = rawFieldsForCard(card);
          const { sku, offerId } = ozonCardIdentity(card);
          return {
            id: `ozon-task-${Date.now()}-${index}`,
            cardKey: ozonCardStableKey(card),
            title: card.title || rawFields.title || rawFields.name || "Ozon карточка",
            sku,
            offerId,
            category: ozonCardCategory(card),
            status: "draft",
            workType: "semantic-content",
            createdAt: now,
            updatedAt: now,
          };
        }),
    ];
    updateWorkState({
      tasks: nextTasks,
      selectedKeys: [],
      recentEvents: [
        { id: `event-${Date.now()}`, action: "created", label: `Создан Ozon-набор: ${selectedCards.length} карточек`, at: now },
        ...(workState?.recentEvents || []),
      ],
    });
    onOpenTasks?.();
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

  return (
    <section className="workspace-strip ozon-cards-workspace">
      <div className="strip-head">
        <div>
          <h2>Карточки Ozon</h2>
          <p>Сохраненные карточки из Ozon MPStats probe. Вид повторяет рабочий блок WB, но статусы и замечания считаются по Ozon snapshot.</p>
        </div>
        <Tag tone="blue">{formatNumber(visibleCards.length)}</Tag>
      </div>

      <div className="cards-workspace">
        <div className="cards-control-panel ozon-cards-control-panel">
          <div className="cards-work-summary">
            <button className={`work-summary-item ${isSummaryFilterActive({ issue: "problems" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ issue: "problems" })}>
              <span>Требуют внимания</span>
              <strong>{formatNumber(problemCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ issue: "signals" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ issue: "signals" })}>
              <span>Некритичные замечания</span>
              <strong>{formatNumber(signalOnlyCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ issue: "clean" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ issue: "clean" })}>
              <span>Без замечаний</span>
              <strong>{formatNumber(cleanCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ work: "ready" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ work: "ready" })}>
              <span>Готовы к работе</span>
              <strong>{formatNumber(readyCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ work: "tasks" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ work: "tasks" })}>
              <span>В задачах</span>
              <strong>{formatNumber(taskCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ work: "semantic-final" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ work: "semantic-final" })}>
              <span>Итоговое СЯ</span>
              <strong>{formatNumber(semanticFinalCards.length)}</strong>
            </button>
            <button className={`work-summary-item ${isSummaryFilterActive({ work: "content-final" }) ? "active" : ""}`} type="button" onClick={() => applySummaryFilter({ work: "content-final" })}>
              <span>Итоговый контент</span>
              <strong>{formatNumber(contentFinalCards.length)}</strong>
            </button>
            <div className="work-summary-note">
              <strong>{selectedCards.length ? `${formatNumber(selectedCards.length)} в наборе` : "Набор пуст"}</strong>
              <span>{selectedCards.length ? "можно создать Ozon-задачу" : "выберите строки для работы"}</span>
            </div>
          </div>

          <div className="card-filters ozon-card-filters">
            <label className="search-field card-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию, SKU, offer, бренду" />
            </label>
            <select className="select" value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}>
              <option value="all">Все карточки</option>
              <option value="problems">Требуют внимания</option>
              <option value="signals">Некритичные замечания</option>
              <option value="clean">Без замечаний</option>
            </select>
            <select className="select" value={workFilter} onChange={(event) => setWorkFilter(event.target.value)}>
              <option value="all">Любой статус</option>
              <option value="ready">Готовы к работе</option>
              <option value="check">Проверить данные</option>
              <option value="tasks">В задачах</option>
              <option value="without-semantic">Без итогового СЯ</option>
              <option value="semantic-final">Есть итоговое СЯ</option>
              <option value="content-final">Есть итоговый контент</option>
              <option value="selected">В рабочем наборе</option>
            </select>
            <select className="select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Все категории</option>
              {categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
          </div>

          <div className="cards-toolbar">
            <span>
              Показано {formatNumber(filteredCards.length)} из {formatNumber(visibleCards.length)} · Ozon snapshot из MPStats
              {workStatus === "loading" ? " · загружаем задачи" : ""}
              {workStatus === "saving" ? " · сохраняем задачи" : ""}
              {workStatus === "saved" || workStatus === "loaded" ? " · задачи в backend" : ""}
              {workStatus === "local-fallback" ? " · задачи временно локально" : ""}
              {draftStatus === "loading" ? " · загружаем результаты" : ""}
            </span>
            <div className="toolbar">
              <button className="btn primary" type="button" onClick={createOzonTaskBatch} disabled={!selectedCards.length}>
                <Plus size={16} />Взять в работу
              </button>
              <button className="btn" type="button" onClick={toggleVisible} disabled={!filteredCards.length}>
                <CheckSquare size={16} />{allVisibleSelected ? "Убрать видимые" : "Выбрать видимые"}
              </button>
              <button className="btn" type="button" onClick={() => updateWorkState({ selectedKeys: [] })} disabled={!selectedKeys.length}>Очистить набор</button>
              <button className="btn ghost" type="button" onClick={resetFilters}>Сбросить фильтры</button>
            </div>
          </div>
        </div>

        {filteredCards.length ? (
          <div className="table-wrap cards-table-wrap ozon-cards-table">
            <table>
              <thead>
                <tr>
                  <th className="select-col">
                    <input type="checkbox" aria-label="Выбрать видимые Ozon-карточки" checked={allVisibleSelected} onChange={toggleVisible} />
                  </th>
                  <th>Карточка</th>
                  <th>SKU / offer</th>
                  <th>Заполненность</th>
                  <th>Замечания по данным</th>
                  <th>Статус работы</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((card, index) => {
                  const rawFields = rawFieldsForCard(card);
                  const { sku, offerId } = ozonCardIdentity(card);
                  const reasons = ozonCardProblemReasons(card);
                  const signals = ozonCardDataSignals(card);
                  const completeness = ozonCardCompleteness(card);
                  const rowWorkState = ozonWorkStateForCard(card, selectedSet, tasks);
                  const resultState = ozonTaskResultMeta({ cardKey: ozonCardStableKey(card), status: rowWorkState.label === "готово" ? "done" : "draft" }, semanticDrafts, cardDrafts);
                  const title = card.title || rawFields.title || rawFields.name || "Ozon карточка";
                  const brand = card.brand || rawFields.brand || "бренд не указан";
                  const price = ozonCardMetricValue(card, ["price", "finalPrice", "final_price"]);
                  const stock = ozonCardMetricValue(card, ["stock", "balance", "available_stock"]);
                  return (
                    <tr key={`${sku}-${offerId}-${index}`} className={selectedSet.has(ozonCardStableKey(card)) ? "selected-row" : ""}>
                      <td className="select-col">
                        <input type="checkbox" aria-label="Добавить Ozon-карточку в рабочий набор" checked={selectedSet.has(ozonCardStableKey(card))} onChange={() => toggleCard(card)} />
                      </td>
                      <td>
                        <div className="product-cell">
                          <Thumb url={bestPhotoUrl(card)} alt={index % 2 === 1} />
                          <div className="product-name">
                            <strong>{title}</strong>
                            <span>категория: {ozonCardCategory(card)} · {brand}</span>
                            <small>{[!isEmptyValue(price) ? `цена ${formatNumber(price)}` : "", !isEmptyValue(stock) ? `остаток ${formatNumber(stock)}` : ""].filter(Boolean).join(" · ") || "коммерческие метрики ожидают расширения Ozon-логики"}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="ozon-id-cell">
                          <strong>{sku}</strong>
                          <span>{offerId}</span>
                        </div>
                      </td>
                      <td><Tag tone={completeness.tone}>{completeness.label}</Tag></td>
                      <td>
                        <div className="problem-reasons">
                          {reasons.map((reason) => <Tag tone="amber" key={reason}>{reason}</Tag>)}
                          {!reasons.length && signals.length ? signals.map((signal) => <Tag tone="blue" key={signal}>{signal}</Tag>) : null}
                          {!reasons.length && !signals.length ? <Tag tone="green">без замечаний</Tag> : null}
                        </div>
                      </td>
                      <td>
                        <div className="problem-reasons">
                          <Tag tone={rowWorkState.tone}>{rowWorkState.label}</Tag>
                          <Tag tone={resultState.tone}>{resultState.label}</Tag>
                        </div>
                      </td>
                      <td><IconButton icon={Eye} label="Открыть Ozon-карточку" onClick={() => onOpenCard?.(card)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>По текущим фильтрам Ozon-карточек нет</strong>
            <span>Измените поиск, статус, замечания или категорию.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function OzonTasksPanel({ cards, workState, workStatus = "idle", semanticDrafts = [], cardDrafts = [], draftStatus = "idle", onOpenCard, onUpdateTaskStatus, onDeleteTask }) {
  const tasks = Array.isArray(workState?.tasks) ? workState.tasks : [];
  const events = Array.isArray(workState?.recentEvents) ? workState.recentEvents : [];
  const [taskFilter, setTaskFilter] = useState("all");
  const cardsByKey = new Map((Array.isArray(cards) ? cards : []).map((card) => [ozonCardStableKey(card), card]));
  const enrichedTasks = tasks.map((task) => ({ ...task, resultMeta: ozonTaskResultMeta(task, semanticDrafts, cardDrafts) }));
  const activeTasks = enrichedTasks.filter((task) => !["done", "skipped"].includes(task.status) && !(task.resultMeta.hasSemanticFinal && task.resultMeta.hasFinalContent));
  const doneTasks = enrichedTasks.filter((task) => task.status === "done" || (task.resultMeta.hasSemanticFinal && task.resultMeta.hasFinalContent));
  const skippedTasks = tasks.filter((task) => task.status === "skipped");
  const laterTasks = tasks.filter((task) => task.status === "later");
  const returnedTasks = tasks.filter((task) => task.status === "returned");
  const withoutSemanticTasks = enrichedTasks.filter((task) => !task.resultMeta.hasSemanticFinal);
  const filteredTasks = enrichedTasks.filter((task) => {
    if (taskFilter === "unfinished") return !["done", "skipped"].includes(task.status) && !(task.resultMeta.hasSemanticFinal && task.resultMeta.hasFinalContent);
    if (taskFilter === "returned") return task.status === "returned";
    if (taskFilter === "without-semantic") return !task.resultMeta.hasSemanticFinal;
    if (taskFilter === "done") return task.status === "done" || (task.resultMeta.hasSemanticFinal && task.resultMeta.hasFinalContent);
    return true;
  });

  if (!tasks.length) {
    return (
      <OzonPlaceholderPanel
        title="Задачи Ozon"
        copy="Выберите карточки во вкладке Кабинет и нажмите Взять в работу. Задачи Ozon пока хранятся отдельно от WB-пачек в beta-контуре."
        tag="нет задач"
      />
    );
  }

  return (
    <section className="workspace-strip ozon-task-workspace">
      <div className="strip-head">
        <div>
          <h2>Задачи Ozon</h2>
          <p>Beta-набор задач по Ozon-карточкам. Статусы читают сохраненное итоговое СЯ и итоговый контент Ozon, не WB workflow.</p>
        </div>
        <Tag tone={workStatus === "local-fallback" ? "amber" : "blue"}>{workStatus === "saving" ? "сохраняем" : workStatus === "local-fallback" ? "локально" : `${formatNumber(tasks.length)} задач`}</Tag>
      </div>

      <div className="cards-work-summary">
        <div className="work-summary-note">
          <span>В работе</span>
          <strong>{formatNumber(activeTasks.length)}</strong>
        </div>
        <div className="work-summary-note">
          <span>Готово</span>
          <strong>{formatNumber(doneTasks.length)}</strong>
        </div>
        <div className="work-summary-note">
          <span>Вернуться позже</span>
          <strong>{formatNumber(laterTasks.length)}</strong>
        </div>
        <div className="work-summary-note">
          <span>Возвраты</span>
          <strong>{formatNumber(returnedTasks.length)}</strong>
        </div>
        <div className="work-summary-note">
          <span>Пропущено</span>
          <strong>{formatNumber(skippedTasks.length)}</strong>
        </div>
        <div className="work-summary-note">
          <span>Без итогового СЯ</span>
          <strong>{formatNumber(withoutSemanticTasks.length)}</strong>
        </div>
      </div>

      <div className="task-batch-filter" role="group" aria-label="Фильтр Ozon-задач">
        {[
          ["all", "Все"],
          ["unfinished", "Незавершенные"],
          ["returned", "Возвращенные"],
          ["without-semantic", "Без итогового СЯ"],
          ["done", "Готовые"],
        ].map(([key, label]) => (
          <button className={taskFilter === key ? "active" : ""} type="button" onClick={() => setTaskFilter(key)} key={key}>
            {label}
          </button>
        ))}
        <span>{draftStatus === "loading" ? "загружаем результаты" : `${formatNumber(filteredTasks.length)} из ${formatNumber(tasks.length)}`}</span>
      </div>

      <div className="task-card-list ozon-task-list">
        {filteredTasks.map((task) => {
          const card = cardsByKey.get(task.cardKey);
          const statusMeta = ozonTaskStatusMeta(task.status);
          const resultMeta = task.resultMeta || ozonTaskResultMeta(task, semanticDrafts, cardDrafts);
          return (
            <div className="task-card-row" key={task.id}>
              <div className="task-card-row-main">
                <Thumb url={card ? bestPhotoUrl(card) : ""} />
                <div>
                  <strong>{task.title}</strong>
                  <span>Ozon SKU {textOrDash(task.sku)} · offer {textOrDash(task.offerId)} · {textOrDash(task.category)}</span>
                </div>
              </div>
              <div className="task-card-row-actions">
                <Tag tone={statusMeta.tone}>{statusMeta.label}</Tag>
                <Tag tone={resultMeta.tone}>{resultMeta.label}</Tag>
                <button className="btn mini" type="button" onClick={() => card && onOpenCard?.(card)} disabled={!card}>Открыть</button>
                <button className="btn mini" type="button" onClick={() => onUpdateTaskStatus?.(task.id, "done")} disabled={!resultMeta.hasSemanticFinal && !resultMeta.hasFinalContent}>Готово</button>
                <button className="btn mini" type="button" onClick={() => onUpdateTaskStatus?.(task.id, "later")}>Вернуться позже</button>
                <button className="btn mini" type="button" onClick={() => onUpdateTaskStatus?.(task.id, "skipped")}>Пропустить</button>
                <button className="btn mini" type="button" onClick={() => onUpdateTaskStatus?.(task.id, "returned")}>Возврат</button>
                <button className="btn mini danger" type="button" onClick={() => onDeleteTask?.(task.id)}>Удалить</button>
              </div>
            </div>
          );
        })}
        {!filteredTasks.length ? <div className="empty-state compact"><span>По выбранному фильтру Ozon-задач нет.</span></div> : null}
      </div>

      <details className="task-batch-log">
        <summary>Журнал Ozon beta</summary>
        {events.length ? (
          <div className="task-batch-event-list">
            {events.slice(0, 12).map((event) => (
              <div className="task-batch-event" key={event.id}>
                <div>
                  <strong>{event.label}</strong>
                  <span>{event.action || "событие"}</span>
                </div>
                <time>{event.at ? new Date(event.at).toLocaleString("ru-RU") : "без даты"}</time>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact"><span>Событий пока нет.</span></div>
        )}
      </details>
    </section>
  );
}

function OzonMpstatsProbeResult({ result, status, canSave = false, saveStatus = "idle", onSave }) {
  if (status === "idle" || !result) {
    return null;
  }
  if (status === "loading") {
    return (
      <div className="ozon-probe-result">
        <strong>Проверяем MPStats</strong>
        <span>Ищем Ozon-карточки по сохраненному источнику.</span>
      </div>
    );
  }
  if (status === "error" || result.status === "error") {
    return (
      <div className="ozon-probe-result error">
        <strong>Проверка не прошла</strong>
        <span>{result.message || "MPStats временно недоступен для Ozon-проверки."}</span>
      </div>
    );
  }
  const cards = Array.isArray(result.cards) ? result.cards : [];
  const attempts = Array.isArray(result.attempts) ? result.attempts : [];
  const count = Number(result.totalEstimate || result.cardCount || cards.length || 0);
  const source = result.source || {};
  return (
    <div className={`ozon-probe-result ${cards.length ? "loaded" : "empty"}`}>
      <div className="ozon-probe-head">
        <div>
          <strong>{cards.length ? `MPStats нашел ${formatNumber(count)} ${pluralRu(count, "карточку", "карточки", "карточек")}` : "MPStats не нашел карточки"}</strong>
          <span>{source.kind ? `${source.kind}: ${source.path || "источник"}` : "Источник Ozon"}</span>
        </div>
        <Tag tone={cards.length ? "blue" : "amber"}>{result.status || "probe"}</Tag>
      </div>
      {cards.length ? (
        <div className="ozon-probe-cards">
          {cards.slice(0, 5).map((card, index) => (
            <div className="ozon-probe-card" key={`${card.id || card.offerId || card.title}-${index}`}>
              <strong>{card.title || card.id || "Ozon карточка"}</strong>
              <span>{[card.id ? `SKU ${card.id}` : "", card.offerId ? `offer ${card.offerId}` : "", card.brand, card.category].filter(Boolean).join(" · ") || "данные MPStats"}</span>
              <small>{[card.price ? `цена ${formatNumber(card.price)}` : "", card.stock !== null && card.stock !== undefined ? `остаток ${formatNumber(card.stock)}` : "", card.rating ? `рейтинг ${card.rating}` : ""].filter(Boolean).join(" · ")}</small>
            </div>
          ))}
        </div>
      ) : null}
      {cards.length && canSave ? (
        <div className="ozon-probe-save-row">
          <button className={loadingButtonClass("btn primary", saveStatus === "saving")} type="button" onClick={onSave} disabled={saveStatus === "saving"} aria-busy={saveStatus === "saving" || undefined}>
            <Save size={16} />{saveStatus === "saving" ? "Сохраняем" : saveStatus === "saved" ? "Сохранено" : "Сохранить карточки"}
          </button>
          <span>
            {saveStatus === "saved"
              ? "Найденные карточки добавлены в Ozon-кабинет."
              : saveStatus === "error"
                ? "Сохранение не прошло, попробуйте еще раз."
                : "Сохранит найденные карточки в раздел Ozon этого клиента."}
          </span>
        </div>
      ) : null}
      {attempts.length ? (
        <div className="ozon-probe-attempts">
          {attempts.slice(0, 4).map((attempt, index) => (
            <span key={`${attempt.path}-${index}`}>{attempt.status}: {attempt.path}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OzonCardDetailScreen({ card, portal, onBack, backLabel = "Карточки Ozon", helpEnabled = false }) {
  const [activeTab, setActiveTab] = useState("card");
  const [ozonCardDraft, setOzonCardDraft] = useState(null);
  const [ozonCardDraftStatus, setOzonCardDraftStatus] = useState("idle");
  const rawFields = rawFieldsForCard(card);
  const mpstats = card?.mpstats && typeof card.mpstats === "object" ? card.mpstats : {};
  const photoUrl = bestPhotoUrl(card);
  const title = textOrDash(card?.title || rawFields.title || rawFields.name);
  const sku = textOrDash(card?.sku || card?.id || rawFields.sku || rawFields.id || rawFields.productId);
  const offerId = textOrDash(card?.offerId || card?.vendorCode || rawFields.offerId || rawFields.offer_id || rawFields.vendorCode);
  const category = textOrDash(card?.subjectName || card?.category || rawFields.category || rawFields.categoryName);
  const brand = textOrDash(card?.brand || rawFields.brand);
  const sellerName = textOrDash(card?.sellerName || rawFields.sellerName || rawFields.seller || rawFields.shopName);
  const description = card?.description || rawFields.description || "";
  const characteristics = card?.characteristics || rawFields.characteristics || [];
  const photos = card?.photos || rawFields.photos || (photoUrl ? [photoUrl] : []);
  const sizes = card?.sizes || rawFields.sizes || [];
  const price = firstDefined(card?.price, rawFields.price, rawFields.finalPrice, rawFields.final_price);
  const stock = firstDefined(card?.stock, rawFields.stock, rawFields.balance, rawFields.available_stock);
  const sales = firstDefined(card?.sales, mpstats.sales, rawFields.sales);
  const revenue = firstDefined(card?.revenue, mpstats.revenue, rawFields.revenue);
  const rating = firstDefined(card?.rating, rawFields.rating);
  const feedbacks = firstDefined(card?.feedbacks, rawFields.feedbacks, rawFields.reviews, rawFields.comments);
  const status = card?.status || "MPStats";
  const externalUrl = safeHttpsUrl(card?.url || rawFields.url || rawFields.productUrl || rawFields.link);
  const sourceLabel = mpstats.source || rawFields.source || "Ozon MPStats";
  const portalName = portalDisplayName(portal);
  const issueReasons = ozonCardProblemReasons(card);
  const dataSignals = ozonCardDataSignals(card);
  const completeness = ozonCardCompleteness(card);
  const workState = ozonCardWorkState(card);
  const issueCount = issueReasons.length || Number(card?.issueCount || 0);
  const rawTechnicalFields = Object.keys(rawFields).length ? rawFields : card;
  const cardKey = ozonCardStableKey(card);

  useEffect(() => {
    let active = true;
    if (!portal?.id || portal.isDemo || !cardKey) {
      setOzonCardDraft(null);
      setOzonCardDraftStatus("idle");
      return () => {
        active = false;
      };
    }
    setOzonCardDraftStatus("loading");
    apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-card-draft?card_key=${encodeURIComponent(cardKey)}`)
      .then((payload) => {
        if (!active) return;
        setOzonCardDraft(payload.draft || null);
        setOzonCardDraftStatus(payload.draft ? "loaded" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setOzonCardDraftStatus("error");
      });
    return () => {
      active = false;
    };
  }, [portal?.id, portal?.isDemo, cardKey]);

  function replaceOzonCardDraft(draft) {
    setOzonCardDraft(draft || null);
    setOzonCardDraftStatus(draft ? "saved" : "empty");
  }

  return (
    <section className="screen active marketplace-theme-ozon">
      <header className="topbar">
        <div className="title">
          <h1>Детальная карточка Ozon</h1>
          <p>{title} · SKU {sku} · offer {offerId} · {category}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={onBack}><ArrowLeft size={17} />{backLabel}</button>
          {externalUrl ? <a className="btn" href={externalUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />Открыть Ozon</a> : null}
          <Tag tone={issueCount ? "amber" : "green"}>{status}</Tag>
        </div>
      </header>

      <div className="content">
        <div className={`detail-layout ${activeTab === "technical" ? "wide-changes" : ""}`}>
          <aside className="detail-aside">
            <div className={`photo-preview ${photoUrl ? "has-image" : ""}`}>
              {photoUrl ? <img src={photoUrl} alt={title} loading="eager" decoding="async" /> : <span>OZ</span>}
            </div>
            <section className="panel">
              <h2>Данные карточки</h2>
              <div className="panel-list">
                <div className="list-row"><span>Кабинет</span><strong>{portalName}</strong></div>
                <div className="list-row"><span>SKU Ozon</span><strong>{sku}</strong></div>
                <div className="list-row"><span>Offer ID</span><strong>{offerId}</strong></div>
                <div className="list-row"><span>Категория</span><strong>{category}</strong></div>
                <div className="list-row"><span>Бренд</span><strong>{brand}</strong></div>
                <div className="list-row"><span>Продавец</span><strong>{sellerName}</strong></div>
                <div className="list-row"><span>Фото</span><strong>{valueSummary(photos)}</strong></div>
                <div className="list-row"><span>Характеристики</span><strong>{valueSummary(characteristics)}</strong></div>
                <div className="list-row"><span>Цена</span><strong>{valueSummary(price)}</strong></div>
                <div className="list-row"><span>Остаток</span><strong>{valueSummary(stock)}</strong></div>
                <div className="list-row"><span>Источник</span><strong>{sourceLabel}</strong></div>
              </div>
            </section>
          </aside>

          <div className="detail-main">
            <nav className="detail-tabs" aria-label="Разделы Ozon-карточки">
              <button className={activeTab === "semantic" ? "active" : ""} type="button" onClick={() => setActiveTab("semantic")}>Семантическое ядро</button>
              <button className={activeTab === "card" ? "active" : ""} type="button" onClick={() => setActiveTab("card")}>Карточка</button>
              <button className={activeTab === "audit" ? "active" : ""} type="button" onClick={() => setActiveTab("audit")}>Рыночный аудит</button>
              <button className={activeTab === "changes" ? "active" : ""} type="button" onClick={() => setActiveTab("changes")}>Изменения</button>
              <button className={activeTab === "technical" ? "active" : ""} type="button" onClick={() => setActiveTab("technical")}>Техполя</button>
            </nav>
            <HelpHint enabled={helpEnabled} title="Ozon-карточка">
              Экран повторяет рабочий контур WB-карточки, но использует сохраненный Ozon snapshot. WB API, WB-аудит и WB-экспорты здесь не запускаются.
            </HelpHint>

            {activeTab === "card" ? (
              <>
                <section className="workspace-strip ozon-card-quality">
                  <div className="strip-head">
                    <div>
                      <h2>Статус карточки</h2>
                      <p>Рабочая сводка по заполненности и замечаниям Ozon snapshot.</p>
                    </div>
                    <Tag tone={workState.tone}>{workState.label}</Tag>
                  </div>
                  <div className="commerce-summary">
                    <div><span>Заполненность</span><strong>{completeness.label}</strong></div>
                    <div><span>Замечания</span><strong>{formatNumber(issueReasons.length)}</strong></div>
                    <div><span>Сигналы</span><strong>{formatNumber(dataSignals.length)}</strong></div>
                    <div><span>Фото</span><strong>{formatNumber(ozonCardPhotoCount(card))}</strong></div>
                    <div><span>Характеристики</span><strong>{formatNumber(ozonCardCharacteristicItems(card).length)}</strong></div>
                    <div><span>Источник</span><strong>{sourceLabel}</strong></div>
                  </div>
                  <div className="problem-reasons ozon-detail-reasons">
                    {issueReasons.map((reason) => <Tag tone="amber" key={reason}>{reason}</Tag>)}
                    {!issueReasons.length && dataSignals.map((signal) => <Tag tone="blue" key={signal}>{signal}</Tag>)}
                    {!issueReasons.length && !dataSignals.length ? <Tag tone="green">без замечаний</Tag> : null}
                  </div>
                </section>

                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Заголовок</h2>
                      <p>Название и описание из сохраненного Ozon snapshot.</p>
                    </div>
                    <Tag tone="blue">Ozon</Tag>
                  </div>
                  <div className="option-list">
                    <div className="option-row">
                      <div className="option-head">
                        <strong>{title}</strong>
                        <span className="char-counter">{title.length} симв.</span>
                      </div>
                      <p>Это текущее название карточки из {sourceLabel}.</p>
                    </div>
                  </div>
                  <div className="snapshot-description">
                    <span>Описание</span>
                    <p>{isEmptyValue(description) ? "Пусто" : description}</p>
                  </div>
                  {Array.isArray(photos) && photos.length ? (
                    <div className="ozon-photo-strip">
                      {photos.slice(0, 8).map((photo, index) => {
                        const url = typeof photo === "string" ? safeHttpsUrl(photo) : safeHttpsUrl(photo?.big || photo?.c516x688 || photo?.square || photo?.url);
                        return (
                          <div className={`ozon-photo-cell ${url ? "has-image" : ""}`} key={`${url || index}`}>
                            {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span>OZ</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>

                <section className="workspace-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Характеристики</h2>
                      <p>Значения из Ozon/MPStats без подмешивания WB-справочников.</p>
                    </div>
                    <Tag tone="blue">{valueCount(characteristics)} {pluralRu(valueCount(characteristics), "поле", "поля", "полей")}</Tag>
                  </div>
                  <CharacteristicsBlock items={characteristics} />
                </section>

                <section className="workspace-strip commerce-strip">
                  <div className="strip-head">
                    <div>
                      <h2>Цены, остатки и метрики</h2>
                      <p>Доступные коммерческие данные из Ozon MPStats snapshot.</p>
                    </div>
                    <Tag tone="blue">MPStats</Tag>
                  </div>
                  <div className="commerce-summary">
                    <div><span>Цена</span><strong>{valueSummary(price)}</strong></div>
                    <div><span>Остаток</span><strong>{valueSummary(stock)}</strong></div>
                    <div><span>Продажи</span><strong>{valueSummary(sales)}</strong></div>
                    <div><span>Выручка</span><strong>{valueSummary(revenue)}</strong></div>
                    <div><span>Рейтинг</span><strong>{valueSummary(rating)}</strong></div>
                    <div><span>Отзывы</span><strong>{valueSummary(feedbacks)}</strong></div>
                    <div><span>SKU</span><strong>{sku}</strong></div>
                    <div><span>Offer</span><strong>{offerId}</strong></div>
                  </div>
                  {Array.isArray(sizes) && sizes.length ? (
                    <div className="commerce-size-scroll">
                      <div className="commerce-size-table">
                        <div className="commerce-size-row commerce-size-head">
                          <span>Размер</span><span>Цена</span><span>Остаток</span><span>SKU</span>
                        </div>
                        {sizes.slice(0, 12).map((size, index) => (
                          <div className="commerce-size-row" key={`${size?.techSize || index}-${size?.stock || ""}`}>
                            <strong>{size?.techSize || size?.ozonSize || `Размер ${index + 1}`}</strong>
                            <strong>{valueSummary(size?.price || size?.discountedPrice)}</strong>
                            <strong>{valueSummary(size?.stock || size?.sellerStock || size?.wbStock)}</strong>
                            <strong>{Array.isArray(size?.skus) && size.skus.length ? size.skus.join(", ") : sku}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {activeTab === "semantic" ? (
              <OzonSemanticDraftPanel card={card} portal={portal} />
            ) : null}

            {activeTab === "audit" ? (
              <OzonAuditPanel card={card} portal={portal} draft={ozonCardDraft} status={ozonCardDraftStatus} onDraftSaved={replaceOzonCardDraft} />
            ) : null}

            {activeTab === "changes" ? (
              <OzonChangesPanel card={card} portal={portal} draft={ozonCardDraft} status={ozonCardDraftStatus} onDraftSaved={replaceOzonCardDraft} />
            ) : null}

            {activeTab === "technical" ? (
              <details className="workspace-strip technical-fields" open>
                <summary>
                  <span>Технические поля Ozon snapshot</span>
                  <Tag tone="blue">{Object.keys(rawTechnicalFields || {}).length}</Tag>
                </summary>
                <RawFieldsView fields={rawTechnicalFields} />
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function OzonSemanticDraftPanel({ card, portal }) {
  const rawFields = rawFieldsForCard(card);
  const defaultSeed = [card?.brand || rawFields.brand, ozonCardCategory(card), card?.title || rawFields.title || rawFields.name]
    .filter((item) => item && item !== "Не указано")
    .join(" ");
  const cardKey = ozonCardStableKey(card);
  const { sku, offerId } = ozonCardIdentity(card);
  const title = card?.title || rawFields.title || rawFields.name || "Ozon карточка";
  const [seedQuery, setSeedQuery] = useState(defaultSeed);
  const [selectedQueries, setSelectedQueries] = useState([]);
  const [removalQueries, setRemovalQueries] = useState([]);
  const [draftStatus, setDraftStatus] = useState("idle");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState("");
  const semanticDraft = ozonSemanticDraftRows(card, seedQuery);
  const selectedSet = new Set(selectedQueries);
  const removalSet = new Set(removalQueries);
  const selectedRows = semanticDraft.recommendations.filter((item) => selectedSet.has(item.query));
  const currentRows = semanticDraft.current;
  const finalRows = [
    ...currentRows.filter((item) => !removalSet.has(item.query)),
    ...selectedRows,
  ];
  const finalCount = finalRows.length;

  useEffect(() => {
    let active = true;
    setSeedQuery(defaultSeed);
    setSelectedQueries([]);
    setRemovalQueries([]);
    setDraftUpdatedAt("");
    if (!portal?.id || portal.isDemo || !cardKey) {
      setDraftStatus(portal?.isDemo ? "local" : "idle");
      return () => {
        active = false;
      };
    }
    setDraftStatus("loading");
    apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-semantic-draft?card_key=${encodeURIComponent(cardKey)}`)
      .then((payload) => {
        if (!active) return;
        const saved = payload?.draft?.draft;
        if (saved) {
          setSeedQuery(saved.seedQuery || defaultSeed);
          setSelectedQueries((Array.isArray(saved.selected) ? saved.selected : []).map((item) => String(item?.query || "")).filter(Boolean));
          setRemovalQueries((Array.isArray(saved.removal) ? saved.removal : []).map((item) => String(item?.query || "")).filter(Boolean));
          setDraftUpdatedAt(payload.draft?.updatedAt || "");
          setDraftStatus("loaded");
          return;
        }
        setDraftStatus("empty");
      })
      .catch(() => {
        if (!active) return;
        setDraftStatus("error");
      });
    return () => {
      active = false;
    };
  }, [portal?.id, portal?.isDemo, cardKey, defaultSeed]);

  function toggleSelected(query) {
    setSelectedQueries((current) => (
      current.includes(query) ? current.filter((item) => item !== query) : [...current, query]
    ));
  }

  function toggleRemoval(query) {
    setRemovalQueries((current) => (
      current.includes(query) ? current.filter((item) => item !== query) : [...current, query]
    ));
  }

  async function saveSemanticDraft() {
    if (!portal?.id || portal.isDemo || !cardKey || draftStatus === "saving") {
      return;
    }
    setDraftStatus("saving");
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-semantic-draft`, {
        method: "POST",
        body: JSON.stringify({
          cardKey,
          sku: sku === "Не указано" ? "" : sku,
          offerId: offerId === "Не указано" ? "" : offerId,
          title,
          seedQuery,
          current: currentRows,
          recommendations: semanticDraft.recommendations,
          selected: selectedRows,
          removal: currentRows.filter((item) => removalSet.has(item.query)),
          final: finalRows,
          meta: { source: "ozon-semantic-beta" },
        }),
      });
      setDraftUpdatedAt(payload?.draft?.updatedAt || new Date().toISOString());
      setDraftStatus("saved");
    } catch {
      setDraftStatus("error");
    }
  }

  const saveDisabled = !portal?.id || portal.isDemo || draftStatus === "saving";
  const statusLabel = draftStatus === "loading"
    ? "загружаем"
    : draftStatus === "saving"
      ? "сохраняем"
      : draftStatus === "saved"
        ? "сохранено"
        : draftStatus === "loaded"
          ? "черновик"
          : draftStatus === "error"
            ? "ошибка"
            : draftStatus === "local"
              ? "локально"
              : "новый";
  const statusTone = draftStatus === "error" ? "red" : ["saved", "loaded"].includes(draftStatus) ? "green" : "amber";
  const savedAtLabel = draftUpdatedAt ? new Date(draftUpdatedAt).toLocaleString("ru-RU") : "";

  return (
    <section className="workspace-strip ozon-semantic-workspace">
      <div className="strip-head">
        <div>
          <h2>Семантическое ядро Ozon</h2>
          <p>Beta-черновик: карточка Ozon, текущий контент и будущая MPStats/WB keyword-база без запуска WB API.</p>
        </div>
        <Tag tone={statusTone}>{statusLabel}</Tag>
      </div>

      <div className="semantic-seed-row">
        <label className="search-field card-search">
          <Search size={16} />
          <input value={seedQuery} onChange={(event) => setSeedQuery(event.target.value)} placeholder="Стартовая фраза для Ozon-СЯ" />
        </label>
        <button className={loadingButtonClass("btn primary", draftStatus === "saving")} type="button" onClick={saveSemanticDraft} disabled={saveDisabled} aria-busy={draftStatus === "saving" || undefined}>
          <Save size={16} />{draftStatus === "saving" ? "Сохраняем" : "Сохранить СЯ"}
        </button>
        <Tag tone="blue">MPStats/WB</Tag>
      </div>
      {savedAtLabel ? <p className="status-note">Последнее сохранение: {savedAtLabel}</p> : null}
      {draftStatus === "error" ? <p className="status-note">Не удалось загрузить или сохранить Ozon-СЯ. Проверьте доступ к кабинету и повторите действие.</p> : null}

      <div className="semantic-final-bar">
        <div>
          <span>Текущие ключи</span>
          <strong>{formatNumber(currentRows.length)}</strong>
          <em>из названия и описания Ozon</em>
        </div>
        <div>
          <span>К добавлению</span>
          <strong>{formatNumber(selectedRows.length)}</strong>
          <em>выбрано из рекомендаций</em>
        </div>
        <div>
          <span>К исключению</span>
          <strong>{formatNumber(removalQueries.length)}</strong>
          <em>ручная пометка</em>
        </div>
        <div>
          <span>Итоговый черновик</span>
          <strong>{formatNumber(finalCount)}</strong>
          <em>сохраняется в Ozon-кабинете</em>
        </div>
      </div>

      <div className="semantic-core-grid">
        <div className="semantic-keyword-list">
          <div className="semantic-list-head">
            <strong>Текущий контент Ozon</strong>
            <span>{formatNumber(currentRows.length)}</span>
          </div>
          {currentRows.length ? currentRows.map((item) => {
            const marked = removalSet.has(item.query);
            return (
              <div className={`semantic-keyword ${marked ? "remove" : ""}`} key={item.query}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{marked ? "к исключению" : item.source}</em>
                </div>
                <div className="semantic-keyword-actions">
                  <button className="btn mini" type="button" onClick={() => toggleRemoval(item.query)}>
                    {marked ? "Оставить" : "Убрать"}
                  </button>
                </div>
              </div>
            );
          }) : <div className="empty-state compact"><span>В текущем Ozon-контенте ключей не найдено.</span></div>}
        </div>

        <div className="semantic-keyword-list">
          <div className="semantic-list-head">
            <strong>Рекомендации MPStats/WB</strong>
            <span>{formatNumber(semanticDraft.recommendations.length)}</span>
          </div>
          {semanticDraft.recommendations.length ? semanticDraft.recommendations.map((item) => {
            const selected = selectedSet.has(item.query);
            return (
              <div className={`semantic-keyword recommended ${selected ? "selected" : ""}`} key={item.query}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{item.source}</em>
                </div>
                <div className="semantic-keyword-actions">
                  <Tag tone={selected ? "green" : "blue"}>{selected ? "в работе" : "кандидат"}</Tag>
                  <button className="btn mini" type="button" onClick={() => toggleSelected(item.query)}>
                    {selected ? "Убрать" : "Добавить"}
                  </button>
                </div>
              </div>
            );
          }) : <div className="empty-state compact"><span>Добавьте стартовую фразу, чтобы собрать кандидаты.</span></div>}
        </div>
      </div>
    </section>
  );
}

function OzonAuditPanel({ card, portal, draft, status = "idle", onDraftSaved }) {
  const [auditStatus, setAuditStatus] = useState("idle");
  const cardKey = ozonCardStableKey(card);
  const auditResult = draft?.draft?.auditResult || null;
  const warnings = Array.isArray(auditResult?.summary?.warnings) ? auditResult.summary.warnings : [];

  async function runAudit() {
    if (!portal?.id || portal.isDemo || auditStatus === "loading") return;
    setAuditStatus("loading");
    try {
      const { sku, offerId } = ozonCardIdentity(card);
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-card-audit`, {
        method: "POST",
        body: JSON.stringify({
          cardKey,
          sku: sku === "Не указано" ? "" : sku,
          offerId: offerId === "Не указано" ? "" : offerId,
          title: card?.title || rawFieldsForCard(card).title || "",
          card,
        }),
      });
      onDraftSaved?.(payload.draft || null);
      setAuditStatus("done");
    } catch {
      setAuditStatus("error");
    }
  }

  return (
    <section className="workspace-strip">
      <div className="strip-head">
        <div>
          <h2>Рыночный аудит Ozon</h2>
          <p>Отдельный Ozon-аудит по сохраненному snapshot: заполненность, фото, характеристики, цена, остаток и базовые рекомендации контента.</p>
        </div>
        <Tag tone={auditStatus === "error" ? "red" : auditResult ? "green" : "amber"}>{auditStatus === "loading" ? "аудит идет" : auditResult ? "аудит готов" : "Ozon"}</Tag>
      </div>
      <div className="panel-actions">
        <button className={loadingButtonClass("btn primary", auditStatus === "loading")} type="button" onClick={runAudit} disabled={portal?.isDemo || auditStatus === "loading"} aria-busy={auditStatus === "loading" || undefined}>
          <WandSparkles size={16} />{auditStatus === "loading" ? "Проверяем" : auditResult ? "Перезапустить аудит" : "Запустить аудит"}
        </button>
        <span>{status === "loading" ? "загружаем сохраненный результат" : "WB-аудит и WB API не используются"}</span>
      </div>
      {auditStatus === "error" ? <p className="status-note">Не удалось выполнить Ozon-аудит. Проверьте доступ к кабинету и повторите действие.</p> : null}
      {auditResult ? (
        <>
          <div className="commerce-summary">
            <div><span>Статус</span><strong>{auditResult.summary?.status === "ok" ? "без критичных замечаний" : "требует внимания"}</strong></div>
            <div><span>Заполнено</span><strong>{formatNumber(auditResult.summary?.filledBlocks || 0)}/{formatNumber(auditResult.summary?.totalBlocks || 0)}</strong></div>
            <div><span>Замечания</span><strong>{formatNumber(warnings.length)}</strong></div>
            <div><span>Источник</span><strong>{auditResult.engine || "Ozon snapshot"}</strong></div>
          </div>
          <div className="problem-reasons">
            {warnings.map((warning) => <Tag tone="amber" key={warning}>{warning}</Tag>)}
            {!warnings.length ? <Tag tone="green">без замечаний</Tag> : null}
          </div>
          <section className="workspace-strip compact-inner">
            <div className="strip-head">
              <div>
                <h2>Рекомендации аудита</h2>
                <p>Черновик можно сохранить и принять во вкладке Изменения.</p>
              </div>
              <Tag tone="blue">контент</Tag>
            </div>
            <div className="option-list">
              <div className="option-row">
                <div className="option-head"><strong>{auditResult.recommendations?.title || "Название не предложено"}</strong></div>
                <p>{auditResult.recommendations?.description || "Описание не предложено."}</p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="empty-state">
          <span>Запустите аудит, чтобы получить Ozon-замечания и стартовый черновик контента.</span>
        </div>
      )}
    </section>
  );
}

function OzonChangesPanel({ card, portal, draft, status = "idle", onDraftSaved }) {
  const rawFields = rawFieldsForCard(card);
  const cardKey = ozonCardStableKey(card);
  const { sku, offerId } = ozonCardIdentity(card);
  const savedContent = draft?.draft?.content || {};
  const savedApproval = draft?.draft?.approval || {};
  const [titleDraft, setTitleDraft] = useState(savedContent.title || card?.title || rawFields.title || rawFields.name || "");
  const [descriptionDraft, setDescriptionDraft] = useState(savedContent.description || card?.description || rawFields.description || "");
  const [saveStatus, setSaveStatus] = useState("idle");
  const approvalMeta = ozonCardContentStatusMeta(draft);

  useEffect(() => {
    setTitleDraft(savedContent.title || card?.title || rawFields.title || rawFields.name || "");
    setDescriptionDraft(savedContent.description || card?.description || rawFields.description || "");
  }, [draft?.updatedAt, cardKey]);

  async function saveContent(nextStatus = savedApproval.contentStatus || "draft") {
    if (!portal?.id || portal.isDemo || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/ozon-card-draft`, {
        method: "POST",
        body: JSON.stringify({
          cardKey,
          sku: sku === "Не указано" ? "" : sku,
          offerId: offerId === "Не указано" ? "" : offerId,
          title: card?.title || rawFields.title || rawFields.name || "",
          content: {
            title: titleDraft,
            description: descriptionDraft,
            characteristics: card?.characteristics || rawFields.characteristics || [],
          },
          approval: { contentStatus: nextStatus },
          auditResult: draft?.draft?.auditResult || {},
          auditStatus: draft?.draft?.auditStatus || draft?.auditStatus || "idle",
          source: "ozon-content",
        }),
      });
      onDraftSaved?.(payload.draft || null);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  return (
    <section className="workspace-strip">
      <div className="strip-head">
        <div>
          <h2>Изменения Ozon</h2>
          <p>Черновик итогового контента Ozon хранится отдельно от WB и попадает в Ozon-выгрузку после принятия.</p>
        </div>
        <Tag tone={saveStatus === "error" ? "red" : approvalMeta.tone}>{saveStatus === "saving" ? "сохраняем" : approvalMeta.label}</Tag>
      </div>
      <div className="form-grid">
        <label className="field-label">
          Итоговый заголовок
          <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={300} />
        </label>
        <label className="field-label">
          Итоговое описание
          <textarea value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} rows={8} />
        </label>
      </div>
      <div className="panel-actions">
        <button className={loadingButtonClass("btn", saveStatus === "saving")} type="button" onClick={() => saveContent("draft")} disabled={saveStatus === "saving"}>
          <Save size={16} />Сохранить черновик
        </button>
        <button className={loadingButtonClass("btn primary", saveStatus === "saving")} type="button" onClick={() => saveContent("approved")} disabled={saveStatus === "saving" || !titleDraft.trim()}>
          <CheckSquare size={16} />Принять контент
        </button>
      </div>
      {saveStatus === "error" ? <p className="status-note">Не удалось сохранить Ozon-контент.</p> : null}
      {status === "loading" ? <p className="status-note">Загружаем сохраненный Ozon-черновик.</p> : null}
    </section>
  );
}

function OzonDetailPendingPanel({ title, copy, tag }) {
  return (
    <section className="workspace-strip">
      <div className="strip-head">
        <div>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
        <Tag tone="amber">{tag}</Tag>
      </div>
      <div className="empty-state">
        <span>Раздел будет подключен к Ozon-логике отдельно, без WB API и WB-экспортов.</span>
      </div>
    </section>
  );
}

function SellerScreen({ portal, cards, cardsLoading = false, mpstatsIntegration = null, displayUsers, findUser, canManage = false, onBack, onOpenCard, sellerTab = "cabinet", onSellerTabChange, onOpenModal, onRefreshCards, onResetWork, onUpdateTeam, onUpdateName, onPortalUpdated, onNotice, helpEnabled = false }) {
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
  const [workPeriods, setWorkPeriods] = useState([]);
  const [workPeriodsStatus, setWorkPeriodsStatus] = useState("idle");
  const activeSellerTab = normalizeSellerTab(sellerTab);
  const setSellerTab = onSellerTabChange || (() => {});
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [nameSaving, setNameSaving] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);
  const [taskActionStatus, setTaskActionStatus] = useState("");
  const [importJob, setImportJob] = useState(null);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [cabinetExportStatus, setCabinetExportStatus] = useState("");
  const [semanticImportStatus, setSemanticImportStatus] = useState("");
  const [semanticImportError, setSemanticImportError] = useState("");
  const [semanticImportPreview, setSemanticImportPreview] = useState(null);
  const [semanticImportFile, setSemanticImportFile] = useState(null);

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
      setWorkPeriods([]);
      setWorkPeriodsStatus("idle");
      return () => {
        active = false;
      };
    }
    setWorkPeriodsStatus("loading");
    apiRequest(`/api/portal-work-periods?portal_id=${encodeURIComponent(portal.id)}`)
      .then((payload) => {
        if (!active) return;
        setWorkPeriods(normalizeWorkPeriods(payload.periods));
        setWorkPeriodsStatus("loaded");
      })
      .catch(() => {
        if (!active) return;
        setWorkPeriods([]);
        setWorkPeriodsStatus("error");
      });
    return () => {
      active = false;
    };
  }, [portal?.id, portal?.isDemo, activeSellerTab]);

  useEffect(() => {
    setImportJob(null);
    setSemanticImportStatus("");
    setSemanticImportError("");
    setSemanticImportPreview(null);
    setSemanticImportFile(null);
  }, [portal.id]);

  useEffect(() => {
    if (!importJob?.id || !["queued", "running"].includes(importJob.status)) {
      return undefined;
    }
    let active = true;
    const poll = async () => {
      try {
        const payload = await apiRequest(`/api/portal-imports/${encodeURIComponent(importJob.id)}?portal_id=${encodeURIComponent(portal.id)}`);
        if (!active) return;
        if (payload.job) {
          setImportJob(payload.job);
        }
        if (payload.portal) {
          onPortalUpdated?.(payload.portal);
        }
        if (payload.job?.status === "done") {
          onNotice?.(payload.job.message || "Карточки загружены.");
        }
        if (payload.job?.status === "error") {
          onNotice?.(payload.job.error ? `Загрузка карточек прервалась: ${payload.job.error}` : "Загрузка карточек прервалась. Можно повторить.");
        }
        if (payload.job?.status === "paused") {
          onNotice?.(payload.job.message || "Загрузка остановлена лимитом источника. Можно повторить позже.");
        }
      } catch {
        if (active) {
          setImportJob((current) => current ? { ...current, status: "error", message: "Не удалось получить прогресс загрузки" } : current);
        }
      }
    };
    const timer = window.setInterval(poll, 1200);
    poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [importJob?.id, importJob?.status, portal.id, onNotice, onPortalUpdated]);

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

  async function saveTeamDraft() {
    if (teamSaving) return;
    setTeamSaving(true);
    try {
      await onUpdateTeam(teamDraft);
      setTeamEditing(false);
    } finally {
      setTeamSaving(false);
    }
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

  function logApprovalTaskEvent(task, group = null, workType = "", action = "opened", reason = "") {
    if (!portal?.id || portal.isDemo || !task?.cardKey) return;
    apiRequest("/api/card-workset/log-event", {
      method: "POST",
      body: JSON.stringify({
        portalId: portal.id,
        cardKey: task.cardKey,
        nmID: task.nmID || "",
        vendorCode: task.vendorCode || "",
        batchId: group?.batchId || task.batchId || "",
        workType,
        action,
        reason,
      }),
    })
      .then((payload) => {
        if (payload?.workflow) {
          setApprovalWorkflow(normalizeApprovalWorkflow(payload.workflow));
        }
      })
      .catch(() => {});
  }

  function openApprovalTask(task, group = null, workType = "") {
    const card = findCardForApprovalTask(cards, task);
    if (card) {
      logApprovalTaskEvent(task, group, workType, "opened");
      onOpenCard(card, {
        sellerTab: "tasks",
        backLabel: "Задачи",
        taskRun: group ? buildTaskRunContext(cards, group, workType, task) : null,
      });
    } else {
      onNotice?.("Карточка задачи не найдена в текущем списке кабинета.");
    }
  }

  function replaceSellerWorkPeriod(period) {
    if (!period?.id) return;
    const normalized = normalizeWorkPeriod(period);
    setWorkPeriods((current) => {
      const exists = current.some((item) => String(item.id) === normalized.id);
      if (!exists) {
        return [normalized, ...current];
      }
      return current.map((item) => (String(item.id) === normalized.id ? normalized : item));
    });
    setWorkPeriodsStatus("loaded");
  }

  async function linkApprovalTaskGroupToWorkPeriod(group, workType, targets) {
    if (!portal?.id || portal.isDemo || taskActionStatus) return;
    const targetItems = Array.isArray(targets) ? targets : [targets];
    const nextTargets = parseWorkPeriodTaskLinkValues(targetItems.map((item) => (typeof item === "string" ? item : workPeriodTargetValue(item))));
    const currentLinks = workPeriodLinksForGroup(workPeriods, group);
    const currentValues = new Set(currentLinks.map((link) => link.value));
    const nextValues = new Set(nextTargets.map(workPeriodTargetValue));
    const linksToRemove = currentLinks.filter((link) => !nextValues.has(link.value));
    const targetsToAdd = nextTargets.filter((target) => !currentValues.has(workPeriodTargetValue(target)));
    if (!linksToRemove.length && !targetsToAdd.length) {
      onNotice?.("Пункты плана не изменились.");
      return;
    }
    const actionKey = `link:${group.key || `${workType}:${group.batchId || ""}`}`;
    setTaskActionStatus(actionKey);
    try {
      for (const linkedPlan of linksToRemove) {
        const payload = await apiRequest("/api/portal-work-periods", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal.id,
            periodId: linkedPlan.period.id,
            action: "unlink_task",
            taskKey: linkedPlan.task.key,
            linkedTaskIds: [group.key].filter(Boolean),
            linkedBatchIds: [group.batchId].filter(Boolean),
            comment: taskBatchGroupTitle(group),
          }),
        });
        if (payload.period) {
          replaceSellerWorkPeriod(payload.period);
        }
      }
      for (const target of targetsToAdd) {
        const payload = await apiRequest("/api/portal-work-periods", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal.id,
            periodId: target.periodId,
            action: "link_task",
            taskKey: target.taskKey,
            linkedTaskIds: [group.key].filter(Boolean),
            linkedBatchIds: [group.batchId].filter(Boolean),
            allowMultiple: true,
            comment: taskBatchGroupTitle(group),
          }),
        });
        if (payload.period) {
          replaceSellerWorkPeriod(payload.period);
        }
      }
      onNotice?.(nextTargets.length ? "Привязка к плану обновлена." : "Задача отвязана от плана.");
    } catch {
      onNotice?.("Не удалось обновить привязку к отчетному периоду.");
    } finally {
      setTaskActionStatus("");
    }
  }

  async function unlinkApprovalTaskGroupFromWorkPeriod(group, workType, linkedPlans) {
    const links = (Array.isArray(linkedPlans) ? linkedPlans : [linkedPlans]).filter((item) => item?.period?.id && item?.task?.key);
    if (!portal?.id || portal.isDemo || taskActionStatus || !links.length) return;
    const actionKey = `unlink:${group.key || `${workType}:${group.batchId || ""}`}`;
    setTaskActionStatus(actionKey);
    try {
      for (const linkedPlan of links) {
        const payload = await apiRequest("/api/portal-work-periods", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal.id,
            periodId: linkedPlan.period.id,
            action: "unlink_task",
            taskKey: linkedPlan.task.key,
            linkedTaskIds: [group.key].filter(Boolean),
            linkedBatchIds: [group.batchId].filter(Boolean),
            comment: taskBatchGroupTitle(group),
          }),
        });
        if (payload.period) {
          replaceSellerWorkPeriod(payload.period);
        }
      }
      onNotice?.(links.length > 1 ? "Задача отвязана от пунктов отчетного периода." : "Задача отвязана от пункта отчетного периода.");
    } catch {
      onNotice?.("Не удалось отвязать задачу от отчетного периода.");
    } finally {
      setTaskActionStatus("");
    }
  }

  async function deleteApprovalTaskGroup(group, workType) {
    if (!portal?.id || portal.isDemo || taskActionStatus) return;
    const cardsCount = group?.tasks?.length || 0;
    const title = taskBatchGroupTitle(group);
    const confirmed = window.confirm(`Удалить задачу "${title}" (${formatNumber(cardsCount)} ${pluralRu(cardsCount, "карточка", "карточки", "карточек")})? Сохраненные результаты карточек останутся.`);
    if (!confirmed) return;
    const actionKey = group.key || `${workType}:${group.batchId || ""}`;
    setTaskActionStatus(actionKey);
    try {
      const payload = await apiRequest("/api/card-workset/delete-tasks", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          batchId: group.batchId,
          workType,
          cardKeys: (group.tasks || []).map((task) => task.cardKey).filter(Boolean),
        }),
      });
      if (payload.workflow) {
        replaceApprovalWorkflow(payload.workflow);
      }
      if (Array.isArray(payload.workPeriods)) {
        payload.workPeriods.forEach(replaceSellerWorkPeriod);
      }
      onNotice?.("Задача удалена из кабинета.");
    } catch {
      onNotice?.("Не удалось удалить задачу.");
    } finally {
      setTaskActionStatus("");
    }
  }

  async function reorderApprovalTaskGroup(group, workType, orderedTasks) {
    if (!portal?.id || portal.isDemo || taskActionStatus || !group?.batchId) return false;
    const cardKeys = (orderedTasks || []).map((task) => task.cardKey).filter(Boolean);
    if (cardKeys.length < 2) return false;
    const actionKey = `reorder:${group.key || `${workType}:${group.batchId || ""}`}`;
    setTaskActionStatus(actionKey);
    try {
      const payload = await apiRequest("/api/card-workset/reorder-tasks", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          batchId: group.batchId,
          workType,
          cardKeys,
        }),
      });
      if (payload.workflow) {
        replaceApprovalWorkflow(payload.workflow);
      }
      return true;
    } catch {
      onNotice?.("Не удалось сохранить порядок задач.");
      return false;
    } finally {
      setTaskActionStatus("");
    }
  }

  async function deleteCompletedApprovalTask(task) {
    if (!portal?.id || portal.isDemo || taskActionStatus) return;
    const confirmed = window.confirm(`Убрать завершенную СЯ "${task.title || task.cardKey}" из задач кабинета? Итоговая СЯ по этой карточке будет удалена, но черновик и подборки останутся.`);
    if (!confirmed) return;
    const actionKey = `completed:${task.cardKey}:${task.workType}`;
    setTaskActionStatus(actionKey);
    try {
      const payload = await apiRequest("/api/card-workset/delete-completed-task", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          cardKey: task.cardKey,
          workType: task.workType,
          reason: "wrong_card_opened_from_task_batch",
        }),
      });
      if (payload.workflow) {
        replaceApprovalWorkflow(payload.workflow);
      }
      onNotice?.("Завершенная задача убрана из кабинета.");
    } catch {
      onNotice?.("Не удалось убрать завершенную задачу.");
    } finally {
      setTaskActionStatus("");
    }
  }

  async function startFullImport() {
    if (!isManual || !canRefreshSource || importJob?.status === "queued" || importJob?.status === "running") {
      return;
    }
    setImportJob({
      status: "queued",
      message: "Запускаем расширенную загрузку",
      loadedCount: Number(portal.cardCount || cards.length || 0),
      totalEstimate: 0,
      limit: 1000,
    });
    try {
      const payload = await apiRequest(`/api/portals/${encodeURIComponent(portal.id)}/mpstats-import-all`, {
        method: "POST",
        body: JSON.stringify({ limit: 1000 }),
      });
      setImportJob(payload.job || null);
      onNotice?.("Расширенная загрузка карточек запущена.");
    } catch (error) {
      const message = error.message === "mpstats_key_missing"
        ? "MPStats не подключен: загрузить все карточки нельзя."
        : error.message === "manual_source_missing"
          ? "Добавьте ссылку на магазин или исходные данные для MPStats."
          : "Не удалось запустить расширенную загрузку карточек.";
      setImportJob({ status: "error", message, loadedCount: Number(portal.cardCount || cards.length || 0), totalEstimate: 0, limit: 1000 });
      onNotice?.(message);
    }
  }

  function replaceApprovalWorkflow(workflow) {
    setApprovalWorkflow(normalizeApprovalWorkflow(workflow));
    setApprovalWorkflowStatus("loaded");
  }

  async function loadPortalDraftsForExport() {
    if (!portal?.id || portal.isDemo) {
      return [];
    }
    const payload = await apiRequest(`/api/portal-card-drafts?portal_id=${encodeURIComponent(portal.id)}`);
    return Array.isArray(payload.drafts) ? payload.drafts : [];
  }

  async function downloadPortalSemanticCore() {
    setCabinetExportStatus("semantic-loading");
    try {
      const drafts = await loadPortalDraftsForExport();
      const sheets = buildPortalSemanticCoreSheets(cards, drafts);
      if (!sheets.length) {
        setCabinetExportStatus("semantic-empty");
        onNotice?.("В кабинете пока нет карточек, добавленных в итоговое СЯ.");
        return;
      }
      downloadXlsx(`семантическое ядро - ${safeFilePart(displayName)} - ${exportDatePart()}.xlsx`, sheets);
      setCabinetExportStatus("semantic-done");
    } catch {
      setCabinetExportStatus("semantic-error");
      onNotice?.("Не удалось скачать итоговое СЯ по кабинету.");
    }
  }

  async function previewPortalSemanticImport(file) {
    if (!file || portal.isDemo) return;
    setSemanticImportStatus("reading");
    setSemanticImportError("");
    setSemanticImportPreview(null);
    try {
      const fileData = await readFileAsBase64(file);
      const filePayload = { fileName: file.name, fileData };
      setSemanticImportFile(filePayload);
      setSemanticImportStatus("previewing");
      const preview = await apiRequest("/api/semantic-core-import", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          scope: "portal",
          mode: "preview",
          ...filePayload,
        }),
      });
      setSemanticImportPreview(preview);
      setSemanticImportStatus("preview");
      onNotice?.(`СЯ прочитано: ${semanticImportSummaryText(preview)}.`);
    } catch (error) {
      setSemanticImportStatus("error");
      setSemanticImportError(semanticImportErrorText(error));
      onNotice?.(semanticImportErrorText(error));
    }
  }

  async function applyPortalSemanticImport() {
    if (!semanticImportFile || portal.isDemo) return;
    setSemanticImportStatus("applying");
    setSemanticImportError("");
    try {
      const result = await apiRequest("/api/semantic-core-import", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          scope: "portal",
          mode: "apply",
          ...semanticImportFile,
        }),
      });
      setSemanticImportPreview(result);
      setSemanticImportStatus("applied");
      if (result.applied?.workflow) {
        replaceApprovalWorkflow(result.applied.workflow);
      }
      onNotice?.(`СЯ применено: обновлено ${formatNumber(result.applied?.updatedCards || 0)} ${pluralRu(result.applied?.updatedCards || 0, "карточка", "карточки", "карточек")}.`);
    } catch (error) {
      setSemanticImportStatus("error");
      setSemanticImportError(semanticImportErrorText(error));
      onNotice?.(semanticImportErrorText(error));
    }
  }

  async function downloadPortalFinalContent() {
    setCabinetExportStatus("content-loading");
    try {
      const drafts = await loadPortalDraftsForExport();
      const sheets = buildPortalContentSheets(cards, drafts);
      if (!sheets.length) {
        setCabinetExportStatus("content-empty");
        onNotice?.("В кабинете пока нет карточек, отправленных на согласование по контенту.");
        return;
      }
      downloadXlsx(`итоговый контент - ${safeFilePart(displayName)} - ${exportDatePart()}.xlsx`, sheets);
      setCabinetExportStatus("content-done");
    } catch {
      setCabinetExportStatus("content-error");
      onNotice?.("Не удалось скачать итоговый контент по кабинету.");
    }
  }

  const importRunning = ["queued", "running"].includes(importJob?.status);
  const importLoaded = Number(importJob?.loadedCount || 0);
  const importTotal = Number(importJob?.totalEstimate || 0);
  const importLimit = Number(importJob?.limit || 0);
  const importPercent = importTotal > 0 ? Math.max(4, Math.min(100, Math.round((importLoaded / importTotal) * 100))) : 0;
  const importProgressText = importTotal > 0
    ? `${formatNumber(importLoaded)} из ${formatNumber(importTotal)}`
    : `найдено ${formatNumber(importLoaded)}${importLimit ? ` · лимит до ${formatNumber(importLimit)}` : ""}`;
  const importMessage = ["error", "paused"].includes(importJob?.status) && importJob?.error
    ? `${importJob.message || "Загрузка карточек прервалась"}: ${importJob.error}`
    : importJob?.message || (importRunning ? "MPStats добирает карточки пачками." : "");
  const sourceDetailsOpen = sourceExpanded || cardsLoading || importRunning;

  return (
    <section className="screen active marketplace-theme-wildberries">
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
                <button className={loadingButtonClass("btn primary", nameSaving)} type="button" onClick={saveNameDraft} disabled={nameSaving} aria-busy={nameSaving || undefined}>
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
          <button className="btn primary" type="button" onClick={() => setSellerTab("tasks")}><ClipboardList size={17} />Задачи</button>
        </div>
      </header>

      <div className="content">
        <div className="seller-layout">
          <div className="seller-main">
            <div className="seller-tabs">
              <button className={activeSellerTab === "cabinet" ? "active" : ""} type="button" onClick={() => setSellerTab("cabinet")}>Кабинет</button>
              <button className={activeSellerTab === "tasks" ? "active" : ""} type="button" onClick={() => setSellerTab("tasks")}>Задачи</button>
              <button className={activeSellerTab === "reports" ? "active" : ""} type="button" onClick={() => setSellerTab("reports")}>Отчеты</button>
              <button className={activeSellerTab === "work-periods" ? "active" : ""} type="button" onClick={() => setSellerTab("work-periods")}>Отчетный период</button>
            </div>
            <HelpHint enabled={helpEnabled} title="Где что находится">
              Кабинет хранит общую информацию и список карточек. Задачи показывают пачки работ по СЯ, контенту, ценам и остаткам. Отчеты скачивают XLSX-выгрузки, а Отчетный период фиксирует план отдела по клиенту.
            </HelpHint>

            {activeSellerTab === "cabinet" ? (
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
                          <select className="select" value={teamDraft[roleKey] || ""} onChange={(event) => updateTeamDraft(roleKey, event.target.value)} disabled={teamSaving}>
                            <option value="">Не назначен</option>
                            {users.map((user) => <option value={user.login} key={user.login}>{user.full_name}</option>)}
                          </select>
                        </label>
                      );
                    })}
                    <div className="team-editor-actions">
                      <button className={loadingButtonClass("btn primary", teamSaving)} type="button" onClick={saveTeamDraft} disabled={teamSaving} aria-busy={teamSaving || undefined}>{teamSaving ? "Сохраняем" : "Сохранить состав"}</button>
                      <button className="btn ghost" type="button" onClick={() => { setTeamDraft(team); setTeamEditing(false); }} disabled={teamSaving}>Отмена</button>
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

            <section className={`workspace-strip source-strip ${sourceDetailsOpen ? "expanded" : "collapsed"}`}>
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
                <div className="strip-actions">
                  <Tag tone={portal.apiConnected || isMpstatsLoaded ? "blue" : "amber"}>{portal.apiConnected ? "API подключен" : (isMpstatsLoaded ? "MPStats витрина" : (isManual ? "Без API" : "ручной режим"))}</Tag>
                  <button className="btn" type="button" onClick={() => setSourceExpanded((value) => !value)}>
                    {sourceDetailsOpen ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                    {sourceDetailsOpen ? "Свернуть" : "Развернуть"}
                  </button>
                </div>
              </div>
              {sourceDetailsOpen ? (
                <div className="source-details">
                  <HelpHint enabled={helpEnabled} title="Когда нажимать обновление">
                    Нажимайте Загрузить свежие данные перед новой волной рыночного аудита или отчетом. Это обновит снимок карточек из WB, а старые рекомендации аудита пометит как устаревшие.
                  </HelpHint>
                  <div className="panel-actions">
                    <button className={loadingButtonClass("btn", cardsLoading)} type="button" onClick={onRefreshCards} disabled={!canRefreshSource || cardsLoading} aria-busy={cardsLoading || undefined}>
                      <RefreshCw size={16} />{cardsLoading ? "Загружаем данные" : (portal.apiConnected ? "Загрузить свежие данные" : "Обновить из MPStats")}
                    </button>
                    {isManual ? (
                      <button className={loadingButtonClass("btn primary", importRunning)} type="button" onClick={startFullImport} disabled={!canRefreshSource || cardsLoading || importRunning} aria-busy={importRunning || undefined}>
                        <Download size={16} />{importRunning ? "Загружаем карточки" : "Загрузить все карточки"}
                      </button>
                    ) : null}
                    <button className="btn ghost" type="button" onClick={onResetWork} disabled={cardsLoading} title="Очистить аудиты, черновики контента, итоговое СЯ и переоптимизацию. Пачки задач и история действий останутся.">
                      <Trash2 size={16} />Очистить черновики/СЯ
                    </button>
                    <button className="btn" type="button" onClick={() => onOpenModal("api")}>{apiConnectButtonText(portal)}</button>
                  </div>
                  {importJob ? (
                    <div className={`store-import-progress ${importJob.status || "idle"}`}>
                      <div className="store-import-progress-head">
                        <strong>{importJob.status === "done" ? "Загрузка завершена" : importJob.status === "paused" ? "Загрузка остановлена" : importJob.status === "error" ? "Загрузка прервалась" : "Загружаем карточки"}</strong>
                        <span>{importProgressText}</span>
                      </div>
                      <div className={`store-import-bar ${importTotal ? "" : "indeterminate"}`}>
                        <span style={{ width: importTotal ? `${importPercent}%` : undefined }} />
                      </div>
                      <p>{importMessage}</p>
                    </div>
                  ) : null}
                  <div className="source-flow">
                    {sourceRows.map(([label, value]) => (
                      <div className="list-row source-flow-row" key={label}><span>{label}</span><strong>{value}</strong></div>
                    ))}
                  </div>
                  {isManual ? <ManualPortalSource portal={portal} /> : null}
                </div>
              ) : (
                <div className="source-collapsed-summary">
                  <span>{portal.apiConnected ? "WB API" : (isMpstatsLoaded ? "MPStats витрина" : "Источник ожидает настройки")}</span>
                  <strong>{formatNumber(portal.cardCount)} {pluralRu(portal.cardCount, "карточка", "карточки", "карточек")}</strong>
                </div>
              )}
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
                Идите слева направо: загрузили данные, открыли карточки, запустили рыночный аудит, проверили товарный аудит и изменения, отправили готовые правки на согласование.
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

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Итоговые выгрузки</h2>
                  <p>Файлы по кабинету собираются только из сохраненных результатов карточек.</p>
                </div>
                <Tag tone={cabinetExportStatus.endsWith("loading") ? "blue" : "green"}>
                  {cabinetExportStatus.endsWith("loading") ? "готовим файл" : "XLSX"}
                </Tag>
              </div>
              <div className="panel-actions">
                <button className={loadingButtonClass("btn", cabinetExportStatus === "semantic-loading")} type="button" onClick={downloadPortalSemanticCore} disabled={portal.isDemo || cabinetExportStatus === "semantic-loading"} aria-busy={cabinetExportStatus === "semantic-loading" || undefined}>
                  <Download size={16} />{cabinetExportStatus === "semantic-loading" ? "Собираем СЯ" : "Скачать итоговое СЯ по кабинету"}
                </button>
                <button className={loadingButtonClass("btn", cabinetExportStatus === "content-loading")} type="button" onClick={downloadPortalFinalContent} disabled={portal.isDemo || cabinetExportStatus === "content-loading"} aria-busy={cabinetExportStatus === "content-loading" || undefined}>
                  <Download size={16} />{cabinetExportStatus === "content-loading" ? "Собираем контент" : "Скачать итоговый контент"}
                </button>
              </div>
              <SemanticCoreImportPanel
                status={semanticImportStatus}
                error={semanticImportError}
                preview={semanticImportPreview}
                onPickFile={previewPortalSemanticImport}
                onApply={applyPortalSemanticImport}
                disabled={portal.isDemo}
                title="Загрузить согласованное СЯ"
                applyTitle="Применить по кабинету"
              />
              {cabinetExportStatus === "semantic-empty" ? <p className="status-note">Сохраненного итогового СЯ по карточкам пока нет.</p> : null}
              {cabinetExportStatus === "content-empty" ? <p className="status-note">Принятого контента по карточкам пока нет.</p> : null}
            </section>

            <section className="workspace-strip">
              <div className="strip-head">
                <div>
                  <h2>Карточки</h2>
                  <p>Фильтрация реальных карточек, причины проверки и ограниченный рабочий набор специалиста.</p>
                </div>
                <Tag tone={portal.scope === "selected" ? "blue" : "amber"}>{portal.scope === "selected" ? "выборочно" : "полный магазин"}</Tag>
              </div>
	              <HelpHint enabled={helpEnabled} title="Как открыть аудит карточки">
	                Найдите карточку по артикулу или WB ID и нажмите Открыть. Внутри карточки перейдите на вкладку Рыночный аудит или Товарный аудит в зависимости от задачи.
	              </HelpHint>
	              <CardsTable
	                cards={cards}
	                portal={portal}
	                workflow={approvalWorkflow}
	                workPeriods={workPeriods}
	                workPeriodsStatus={workPeriodsStatus}
	                onOpenCard={(card) => onOpenCard(card, { sellerTab: "cabinet", backLabel: "Карточки" })}
	                onWorkflowChange={replaceApprovalWorkflow}
	                onWorkPeriodChange={replaceSellerWorkPeriod}
	              />
            </section>
              </>
            ) : null}
            {activeSellerTab === "tasks" ? (
              <ApprovalWorkflowPanel
                portalId={portal.id}
                workflow={approvalWorkflow}
                status={approvalWorkflowStatus}
	                cards={cards}
	                findUser={findUser}
	                onOpenTask={openApprovalTask}
	                onDeleteTaskGroup={deleteApprovalTaskGroup}
	                onReorderTaskGroup={reorderApprovalTaskGroup}
	                onLinkTaskGroup={linkApprovalTaskGroupToWorkPeriod}
	                onUnlinkTaskGroup={unlinkApprovalTaskGroupFromWorkPeriod}
	                onDeleteCompletedTask={deleteCompletedApprovalTask}
	                onWorkflowUpdated={setApprovalWorkflow}
	                taskActionStatus={taskActionStatus}
	                workPeriods={workPeriods}
	                workPeriodsStatus={workPeriodsStatus}
	                helpEnabled={helpEnabled}
	              />
            ) : null}
            {activeSellerTab === "reports" ? (
              <ReportsPanel portal={portal} cards={cards} onNotice={onNotice} helpEnabled={helpEnabled} />
            ) : null}
            {activeSellerTab === "work-periods" ? (
              <WorkPeriodsPanel portal={portal} findUser={findUser} canManage={canManage} onNotice={onNotice} helpEnabled={helpEnabled} />
            ) : null}
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
            <button className={loadingButtonClass("btn primary", isLoading)} type="button" onClick={() => generateReport()} disabled={!portal || isLoading} aria-busy={isLoading || undefined}>
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
                <button className={loadingButtonClass("btn mini", isLoading)} type="button" onClick={() => repeatReport(item)} disabled={isLoading} aria-busy={isLoading || undefined}>Скачать снова</button>
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

function WorkPeriodFinalReportPreview({ period, report, reportSummary, findUser }) {
  const groupSummaries = workPeriodReportGroupSummaries(period);
  const generatedBy = findUser(report.generatedBy);
  const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString("ru-RU") : "";
  const notCompletedTotal = Math.max(0, (reportSummary?.total || 0) - (reportSummary?.done || 0));
  return (
    <div className="work-period-report">
      <div className="work-period-report-head">
        <div>
          <strong>Итоговый отчет</strong>
          <span>
            {generatedAt || "без даты"}
            {report.generatedBy ? ` · ${generatedBy?.full_name || report.generatedBy}` : ""}
          </span>
        </div>
        <Tag tone={notCompletedTotal ? "amber" : "green"}>{workPeriodReportStatusText(period)}</Tag>
      </div>
      <div className="work-period-report-stats">
        <div><span>Выполнено</span><strong>{reportSummary.done}/{reportSummary.total}</strong></div>
        <div><span>В работе</span><strong>{formatNumber(reportSummary.inProgress || 0)}</strong></div>
        <div><span>На согласовании</span><strong>{formatNumber(reportSummary.review || 0)}</strong></div>
        <div><span>Не выполнено</span><strong>{formatNumber(notCompletedTotal)}</strong></div>
        <div><span>Возвраты</span><strong>{formatNumber(reportSummary.returned || 0)}</strong></div>
        <div><span>Исключено</span><strong>{formatNumber(reportSummary.excluded || 0)}</strong></div>
      </div>
      <div className="work-period-report-groups">
        {groupSummaries.map((group) => (
          <div className="work-period-report-group" key={group.key}>
            <div>
              <strong>{group.label}</strong>
              <span>{group.done} из {group.total} выполнено · {group.progress}%</span>
            </div>
            {group.notCompleted.length ? (
              <ul>
                {group.notCompleted.slice(0, 3).map((task) => (
                  <li key={task.key}>{task.label}: {workPeriodTaskExportReason(task)}</li>
                ))}
                {group.notCompleted.length > 3 ? <li>Еще {group.notCompleted.length - 3} {pluralRu(group.notCompleted.length - 3, "пункт", "пункта", "пунктов")} в XLSX.</li> : null}
              </ul>
            ) : (
              <p>Все активные пункты раздела выполнены.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkPeriodsPanel({ portal, findUser, canManage = false, onNotice, helpEnabled = false }) {
  const [periods, setPeriods] = useState([]);
  const [status, setStatus] = useState("idle");
  const [actionStatus, setActionStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);
  const [form, setForm] = useState(defaultWorkPeriodForm);
  const [taskDrafts, setTaskDrafts] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({});
  const canUseBackend = Boolean(portal?.id && !portal?.isDemo);
  const activeCount = periods.filter((period) => period.status !== "reported" && period.summary.done < period.summary.total).length;
  const reportedCount = periods.filter((period) => period.status === "reported").length;

  useEffect(() => {
	    setForm(defaultWorkPeriodForm());
	    setEditingPeriod(null);
	    setTaskDrafts({});
	    setExpandedTasks({});
	    loadPeriods();
	  }, [portal?.id]);

  async function loadPeriods() {
    if (!canUseBackend) {
      setPeriods([]);
      setStatus("unavailable");
      return;
    }
    setStatus("loading");
    try {
      const payload = await apiRequest(`/api/portal-work-periods?portal_id=${encodeURIComponent(portal.id)}`);
      setPeriods(normalizeWorkPeriods(payload.periods));
      setStatus("loaded");
    } catch {
      setPeriods([]);
      setStatus("error");
    }
  }

  function upsertPeriod(period) {
    const normalized = normalizeWorkPeriod(period);
    setPeriods((current) => [normalized, ...current.filter((item) => String(item.id) !== String(normalized.id))]
      .sort((left, right) => String(right.period.start || "").localeCompare(String(left.period.start || "")) || Number(right.id) - Number(left.id)));
  }

  function draftKey(period, task, type) {
    return `${period.id}:${task.key}:${type}`;
  }

  function taskDraftValue(period, task, type) {
    return taskDrafts[draftKey(period, task, type)] || "";
  }

  function taskDraftAttachments(period, task) {
    const key = draftKey(period, task, "attachments");
    if (Object.prototype.hasOwnProperty.call(taskDrafts, key)) {
      return normalizeWorkPeriodAttachments(taskDrafts[key]);
    }
    return normalizeWorkPeriodAttachments(task.attachments);
  }

  function taskDraftStatus(period, task) {
    const draftStatus = taskDraftValue(period, task, "status");
    return workPeriodActiveTaskStatuses.includes(draftStatus)
      ? draftStatus
      : workPeriodActiveTaskStatuses.includes(task.status)
        ? task.status
        : "planned";
  }

  function updateTaskDraft(period, task, type, value) {
    setTaskDrafts((current) => ({ ...current, [draftKey(period, task, type)]: value }));
  }

  function clearTaskDrafts(period, task) {
    setTaskDrafts((current) => {
      const next = { ...current };
      delete next[draftKey(period, task, "comment")];
      delete next[draftKey(period, task, "reason")];
      delete next[draftKey(period, task, "attachments")];
      delete next[draftKey(period, task, "status")];
      return next;
    });
  }

  function attachTaskFile(period, task, file) {
    if (!file) return;
    if (file.size > workPeriodAttachmentMaxBytes) {
      onNotice?.("Файл больше 2 МБ. Приложите более легкую версию.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const attachment = normalizeWorkPeriodAttachment({
        id: `attachment-${Date.now().toString(36)}`,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result || ""),
        uploadedAt: new Date().toISOString(),
      });
      if (!attachment) {
        onNotice?.("Не удалось прочитать файл.");
        return;
      }
      updateTaskDraft(period, task, "attachments", [attachment]);
      onNotice?.("Файл приложен. Нажмите Сохранить статус, чтобы сохранить его в периоде.");
    };
    reader.onerror = () => onNotice?.("Не удалось прочитать файл.");
    reader.readAsDataURL(file);
  }

  function removeTaskAttachment(period, task) {
    updateTaskDraft(period, task, "attachments", []);
  }

  function expandedTaskKey(period, task) {
    return `${period.id}:${task.key}`;
  }

  function isTaskExpanded(period, task) {
    return Boolean(expandedTasks[expandedTaskKey(period, task)]);
  }

  function toggleTaskExpanded(period, task) {
    const key = expandedTaskKey(period, task);
    setExpandedTasks((current) => ({ ...current, [key]: !current[key] }));
  }

  function collapseTask(period, task) {
    const key = expandedTaskKey(period, task);
    setExpandedTasks((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function createPeriod(nextForm) {
    if (!canUseBackend || actionStatus === "creating") return;
    if (!nextForm.start || !nextForm.end || nextForm.start > nextForm.end) {
      onNotice?.("Выберите корректный период работ.");
      return;
    }
    const taskKeys = normalizeWorkPeriodTaskKeys(nextForm.taskKeys, []);
    const manualTasks = normalizeWorkPeriodManualTasks(nextForm.manualTasks);
    if (!taskKeys.length && !manualTasks.length) {
      onNotice?.("Выберите хотя бы один вид работ.");
      return;
    }
    setActionStatus("creating");
    try {
      const payload = await apiRequest("/api/portal-work-periods", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          title: nextForm.title,
          period: { start: nextForm.start, end: nextForm.end },
          taskKeys,
          manualTasks,
        }),
      });
      if (payload.period) {
        upsertPeriod(payload.period);
      }
      setCreateOpen(false);
      setForm(defaultWorkPeriodForm());
      onNotice?.("Рабочий период создан.");
    } catch {
      onNotice?.("Не удалось создать рабочий период.");
    } finally {
      setActionStatus("");
    }
  }

  async function updatePeriodPlan(period, nextForm) {
    if (!canUseBackend || actionStatus) return;
    if (!nextForm.start || !nextForm.end || nextForm.start > nextForm.end) {
      onNotice?.("Выберите корректный период работ.");
      return;
    }
    const taskKeys = normalizeWorkPeriodTaskKeys(nextForm.taskKeys, []);
    const manualTasks = normalizeWorkPeriodManualTasks(nextForm.manualTasks);
    if (!taskKeys.length && !manualTasks.length) {
      onNotice?.("Оставьте хотя бы один активный пункт плана.");
      return;
    }
    setActionStatus(`update:${period.id}`);
    try {
      const payload = await apiRequest("/api/portal-work-periods", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          periodId: period.id,
          action: "update",
          title: nextForm.title,
          period: { start: nextForm.start, end: nextForm.end },
          taskKeys,
          manualTasks,
        }),
      });
      if (payload.period) {
        upsertPeriod(payload.period);
      }
      setEditingPeriod(null);
      setForm(defaultWorkPeriodForm());
      onNotice?.("План периода обновлен.");
    } catch {
      onNotice?.("Не удалось обновить план периода.");
    } finally {
      setActionStatus("");
    }
  }

  async function runPeriodAction(period, body, successText, errorText) {
    if (!canUseBackend || actionStatus) return null;
    const actionKey = `${period.id}:${body.action}:${body.taskKey || ""}`;
    setActionStatus(actionKey);
    try {
      const payload = await apiRequest("/api/portal-work-periods", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          periodId: period.id,
          ...body,
        }),
      });
      if (payload.period) {
        upsertPeriod(payload.period);
      }
      onNotice?.(successText);
      return payload.period ? normalizeWorkPeriod(payload.period) : null;
    } catch (error) {
      const message = error.message === "work_period_return_reason_required"
        ? "Укажите причину возврата."
        : error.message === "work_period_not_finished"
          ? "Итоговый отчет откроется после окончания отчетного периода."
          : errorText;
      onNotice?.(message);
      return null;
    } finally {
      setActionStatus("");
    }
  }

  async function updateTaskStatus(period, task, nextStatus = "") {
    const taskStatus = workPeriodActiveTaskStatuses.includes(nextStatus) ? nextStatus : taskDraftStatus(period, task);
    const comment = taskDraftValue(period, task, "comment") || task.comment || "";
    const attachments = taskDraftAttachments(period, task);
    const updated = await runPeriodAction(period, {
      action: "update_task_status",
      taskKey: task.key,
      taskStatus,
      comment,
      attachments,
    }, `Статус пункта изменен: ${workPeriodTaskStatusLabel(taskStatus)}.`, "Не удалось сохранить статус пункта.");
    if (updated) {
      clearTaskDrafts(period, task);
      if (taskStatus === "done") {
        collapseTask(period, task);
      }
    }
  }

  async function returnTask(period, task) {
    const reason = taskDraftValue(period, task, "reason") || task.returnReason || "";
    if (!reason.trim()) {
      onNotice?.("Укажите причину возврата.");
      return;
    }
    const updated = await runPeriodAction(period, {
      action: "return_task",
      taskKey: task.key,
      reason,
    }, "Пункт периода возвращен с причиной.", "Не удалось вернуть пункт периода.");
    if (updated) {
      clearTaskDrafts(period, task);
      collapseTask(period, task);
    }
  }

	  function openCreatePeriod() {
	    setEditingPeriod(null);
	    setForm(defaultWorkPeriodForm());
	    setCreateOpen(true);
	  }

	  function openEditPeriod(period) {
	    setCreateOpen(false);
	    setEditingPeriod(period);
	    setForm(workPeriodFormFromPeriod(period));
	  }

  function closePeriodModal() {
    setCreateOpen(false);
    setEditingPeriod(null);
    setForm(defaultWorkPeriodForm());
  }

  function downloadWorkPeriodPlan(period) {
    downloadXlsx(
      workPeriodExportFileName(portal, period, "plan"),
      buildWorkPeriodWorkbookSheets(portal, period, "plan"),
    );
  }

  async function downloadFinalWorkPeriodReport(period) {
    if (!workPeriodIsClosed(period)) {
      onNotice?.(`Итоговый отчет откроется после ${workPeriodEndDateLabel(period)}.`);
      return;
    }
    const reportedPeriod = await runPeriodAction(period, { action: "generate_report" }, "Итоговый отчет скачан.", "Не удалось подготовить итоговый отчет.");
    if (!reportedPeriod) return;
    downloadXlsx(
      workPeriodExportFileName(portal, reportedPeriod, "final"),
      buildWorkPeriodWorkbookSheets(portal, reportedPeriod, "final"),
    );
  }

  async function deletePeriod(period) {
    if (!canUseBackend || actionStatus) return;
    const confirmed = window.confirm(`Удалить рабочий период "${period.title || clientReportRangeLabel(period.period.start, period.period.end)}"?`);
    if (!confirmed) return;
    setActionStatus(`delete:${period.id}`);
    try {
      await apiRequest(`/api/portal-work-periods?portal_id=${encodeURIComponent(portal.id)}&period_id=${encodeURIComponent(period.id)}`, {
        method: "DELETE",
      });
      setPeriods((current) => current.filter((item) => String(item.id) !== String(period.id)));
      onNotice?.("Рабочий период удален.");
    } catch {
      onNotice?.("Не удалось удалить рабочий период.");
    } finally {
      setActionStatus("");
    }
  }

  return (
    <>
      <section className="workspace-strip work-periods-strip">
        <div className="strip-head">
          <div>
            <h2>Отчетные периоды отдела</h2>
            <p>План работ по кабинету: период, выбранные направления, факт выполнения, возвраты и итог периода.</p>
          </div>
          <div className="strip-actions">
            <Tag tone={status === "error" ? "amber" : activeCount ? "blue" : "green"}>
              {status === "loading" ? "загрузка" : `${activeCount} в работе`}
            </Tag>
            <button className="btn primary" type="button" onClick={openCreatePeriod} disabled={!canUseBackend || actionStatus === "creating"}>
              <Plus size={17} />Создать период
            </button>
          </div>
        </div>
        <HelpList
          enabled={helpEnabled}
          title="Как вести период"
          items={[
            "Создайте период с произвольными датами начала и окончания.",
            "Выберите конкретные работы из общего списка Wildberries: аналитика, карточки, реклама, витрина, поставки и отчеты.",
            "Внутри пункта меняйте статус: в плане, в работе, на согласовании или выполнено; возврат требует причину.",
            "В конце периода сформируйте итоговый отчет: он покажет выполненное и невыполненное с причинами.",
          ]}
        />
        <div className="summary-grid">
          <Metric label="Периодов" value={formatNumber(periods.length)} hint={reportedCount ? `${reportedCount} с отчетом` : "отчетов пока нет"} />
          <Metric label="Активных" value={formatNumber(activeCount)} hint="есть незакрытые пункты" />
          <Metric label="Плановых работ" value={formatNumber(periods.reduce((sum, period) => sum + period.summary.total, 0))} />
          <Metric label="Выполнено" value={formatNumber(periods.reduce((sum, period) => sum + period.summary.done, 0))} />
        </div>
        {!canUseBackend ? (
          <div className="empty-state"><span>Рабочие периоды доступны в backend-кабинете.</span></div>
        ) : null}
        {status === "error" ? (
          <div className="empty-state"><span>Не удалось загрузить рабочие периоды.</span></div>
        ) : null}
      </section>

      <div className="work-period-grid">
        {periods.map((period) => {
          const statusInfo = workPeriodStatus(period);
          const periodClosed = workPeriodIsClosed(period);
          const report = period.report || {};
          const reportSummary = report.summary || period.summary;
          const taskGroups = workPeriodGroupedTasks(period.tasks);
          return (
            <article className="workspace-card work-period-card" key={period.id}>
              <div className="card-head">
                <div>
                  <h2>{period.title || "Рабочий период"}</h2>
                  <p>{clientReportRangeLabel(period.period.start, period.period.end)}</p>
                </div>
                <Tag tone={statusInfo.tone}>{statusInfo.label}</Tag>
              </div>
              <div className="work-period-progress">
                <strong>{period.summary.progress}%</strong>
                <span>{period.summary.done} из {period.summary.total} выполнено</span>
              </div>
              <div className="work-period-task-board">
                {taskGroups.map((group) => {
                  const activeTasks = group.tasks.filter((task) => task.status !== "excluded");
                  const groupDone = activeTasks.filter((task) => task.status === "done").length;
                  const groupInProgress = activeTasks.filter((task) => task.status === "in_progress").length;
                  const groupReview = activeTasks.filter((task) => task.status === "review").length;
                  const groupReturned = activeTasks.filter((task) => task.status === "returned").length;
                  const groupExcluded = group.tasks.length - activeTasks.length;
                  const groupTotal = activeTasks.length;
                  const groupProgress = groupTotal ? Math.round((groupDone / groupTotal) * 100) : 0;
                  const groupTone = groupReturned ? "red" : groupReview ? "violet" : groupInProgress ? "amber" : groupTotal && groupDone >= groupTotal ? "green" : "blue";
                  return (
                    <section className="work-period-task-section" key={group.key}>
                      <div className="work-period-section-head">
                        <div>
                          <strong>{group.label}</strong>
                          <span>
                            {groupDone} из {groupTotal} выполнено
                            {groupInProgress ? ` · ${groupInProgress} в работе` : ""}
                            {groupReview ? ` · ${groupReview} на согл.` : ""}
                            {groupReturned ? ` · ${groupReturned} возврат` : ""}
                            {groupExcluded ? ` · ${groupExcluded} исключено` : ""}
                          </span>
                        </div>
                        <Tag tone={groupTone}>{groupProgress}%</Tag>
                      </div>
                      <div className="work-period-task-list">
                        {group.tasks.map((task) => {
                          const statusBusy = actionStatus === `${period.id}:update_task_status:${task.key}`;
                          const returnBusy = actionStatus === `${period.id}:return_task:${task.key}`;
                          const taskExpanded = isTaskExpanded(period, task);
                          const actorLogin = task.status === "done"
                            ? task.completedBy
                            : task.status === "excluded"
                              ? task.excludedBy
                              : task.status === "returned"
                                ? task.returnedBy
                                : task.statusUpdatedBy;
                          const actor = findUser(actorLogin);
                          const taskDate = workPeriodTaskDate(task);
                          const actorLabel = actor?.full_name || actorLogin || "пользователь";
                          const linkedLabel = workPeriodLinkedLabel(task);
                          const attachments = taskDraftAttachments(period, task);
                          const selectedTaskStatus = taskDraftStatus(period, task);
                          return (
                            <div className={`work-period-task ${task.status} ${taskExpanded ? "expanded" : ""}`} key={task.key}>
                              <div className="work-period-task-main">
                                <button className="work-period-task-title" type="button" onClick={() => toggleTaskExpanded(period, task)}>
                                  <strong>{task.label}</strong>
                                  <span>{taskDate ? `${taskDate} · ${actorLabel}` : workPeriodTaskStatusLabel(task.status)}</span>
                                </button>
                                <div className="work-period-task-side">
                                  {isManualWorkPeriodTask(task) ? <Tag tone="amber">вне плана</Tag> : null}
                                  <Tag tone={workPeriodTaskStatusTone(task.status)}>{workPeriodTaskStatusLabel(task.status)}</Tag>
                                  {task.status !== "excluded" ? (
                                    <button className="btn mini" type="button" onClick={() => toggleTaskExpanded(period, task)}>
                                      {taskExpanded ? "Скрыть" : "Работать"}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {task.description ? <p className="work-period-note">{task.description}</p> : null}
                              {task.comment ? <p className="work-period-note">{task.comment}</p> : null}
                              {task.returnReason ? <p className="work-period-note return">Причина возврата: {task.returnReason}</p> : null}
                              {task.exclusionReason ? <p className="work-period-note return">Исключено из плана: {task.exclusionReason}</p> : null}
                              {attachments.length ? (
                                <div className="work-period-attachments">
                                  {attachments.map((attachment) => (
                                    <div className="work-period-attachment" key={attachment.id || attachment.name}>
                                      <FileText size={15} />
                                      <span>{attachment.name} · {attachmentSizeLabel(attachment.size)}</span>
                                      <button className="btn mini" type="button" onClick={() => downloadDataUrl(attachment.name, attachment.dataUrl)}>
                                        <Download size={14} />Скачать
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {taskExpanded || linkedLabel !== "не привязано" ? <p className="work-period-note">Задачи кабинета: {linkedLabel}</p> : null}
                              {taskExpanded && task.status !== "excluded" ? (
                                <div className="work-period-task-editor">
                                  <label className="field-label compact">
                                    Комментарий к выполнению
                                    <textarea
                                      value={taskDraftValue(period, task, "comment")}
                                      onChange={(event) => updateTaskDraft(period, task, "comment", event.target.value)}
                                      placeholder={task.comment || "Что сделали по этому пункту"}
                                      rows={2}
                                    />
                                  </label>
                                  <div className="work-period-attachment-editor">
                                    <div className="work-period-attachment-actions">
                                      <label className="btn mini">
                                        <Upload size={14} />Приложить файл
                                        <input
                                          type="file"
                                          onChange={(event) => {
                                            attachTaskFile(period, task, event.target.files?.[0]);
                                            event.target.value = "";
                                          }}
                                        />
                                      </label>
                                      {attachments.length ? (
                                        <button className="btn mini ghost" type="button" onClick={() => removeTaskAttachment(period, task)}>
                                          <Trash2 size={14} />Убрать файл
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="work-period-task-actions">
                                    <label className="field-label compact">
                                      Статус работы
                                      <select
                                        className="select"
                                        value={selectedTaskStatus}
                                        onChange={(event) => updateTaskDraft(period, task, "status", event.target.value)}
                                      >
                                        {workPeriodActiveTaskStatuses.map((statusKey) => (
                                          <option value={statusKey} key={statusKey}>{workPeriodTaskStatusLabel(statusKey)}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <button className={loadingButtonClass("btn mini primary", statusBusy)} type="button" onClick={() => updateTaskStatus(period, task)} disabled={Boolean(actionStatus)} aria-busy={statusBusy || undefined}>
                                      <Save size={14} />Сохранить статус
                                    </button>
                                    <label className="field-label compact">
                                      Причина возврата
                                      <input
                                        value={taskDraftValue(period, task, "reason")}
                                        onChange={(event) => updateTaskDraft(period, task, "reason", event.target.value)}
                                        placeholder="Что нужно исправить"
                                      />
                                    </label>
                                    <button className={loadingButtonClass("btn mini danger", returnBusy)} type="button" onClick={() => returnTask(period, task)} disabled={Boolean(actionStatus)} aria-busy={returnBusy || undefined}>
                                      <RotateCcw size={14} />Вернуть
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
              {report.generatedAt ? (
                <WorkPeriodFinalReportPreview
                  period={period}
                  report={report}
                  reportSummary={reportSummary}
                  findUser={findUser}
                />
              ) : null}
              <div className="card-actions">
                <button className="btn" type="button" onClick={() => openEditPeriod(period)} disabled={Boolean(actionStatus)}>
                  <Pencil size={16} />Редактировать план
                </button>
                <button className="btn" type="button" onClick={() => downloadWorkPeriodPlan(period)} disabled={Boolean(actionStatus)}>
                  <Download size={16} />Скачать план работ
                </button>
                <button
                  className={loadingButtonClass("btn primary", actionStatus === `${period.id}:generate_report:`)}
                  type="button"
                  onClick={() => downloadFinalWorkPeriodReport(period)}
                  disabled={Boolean(actionStatus) || !periodClosed}
                  title={periodClosed ? "Скачать итоговый отчет за период" : `Откроется после ${workPeriodEndDateLabel(period)}`}
                >
                  <FileText size={16} />Скачать итоговый отчет
                </button>
                {!periodClosed ? <span className="status-note">Итоговый отчет откроется после окончания периода.</span> : null}
                {canManage ? (
                  <button className="btn danger" type="button" onClick={() => deletePeriod(period)} disabled={Boolean(actionStatus)}>
                    <Trash2 size={16} />Удалить
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
        {canUseBackend ? (
          <article className="workspace-card add-card work-period-add-card">
            <div className="seller-logo">+</div>
            <h2>Создать период</h2>
            <p>Задайте даты и выберите план работ отдела по этому кабинету.</p>
            <button className="btn primary" type="button" onClick={openCreatePeriod} disabled={actionStatus === "creating"}>
              <Plus size={17} />Создать
            </button>
          </article>
        ) : null}
      </div>

      {createOpen || editingPeriod ? (
        <WorkPeriodModal
          value={form}
          mode={editingPeriod ? "edit" : "create"}
          loading={actionStatus === "creating" || actionStatus === `update:${editingPeriod?.id}`}
          onChange={setForm}
          onClose={closePeriodModal}
          onSubmit={(nextForm) => (editingPeriod ? updatePeriodPlan(editingPeriod, nextForm) : createPeriod(nextForm))}
        />
      ) : null}
    </>
  );
}

function WorkPeriodModal({ value, mode = "create", loading, onChange, onClose, onSubmit }) {
  const taskKeys = normalizeWorkPeriodTaskKeys(value.taskKeys, []);
  const manualTasks = normalizeWorkPeriodManualTasks(value.manualTasks);
  const isEdit = mode === "edit";
  const hasLegacyTasks = legacyWorkPeriodTaskOptions.some((option) => taskKeys.includes(option.key));
  const visibleGroups = hasLegacyTasks
    ? [...workPeriodTaskGroups, { key: "legacy", label: "Старые укрупненные пункты" }]
    : workPeriodTaskGroups;
  const selectedCount = taskKeys.filter((key) => defaultWorkPeriodTaskKeys.includes(key)).length;
  const activeCount = taskKeys.length + manualTasks.length;
  const [manualDraft, setManualDraft] = useState({ label: "", description: "" });

  function groupOptions(groupKey) {
    const source = groupKey === "legacy"
      ? legacyWorkPeriodTaskOptions
      : workPeriodTaskOptions.filter((option) => option.group === groupKey);
    return groupKey === "legacy" ? source.filter((option) => taskKeys.includes(option.key)) : source;
  }

  function toggleTask(key) {
    const nextKeys = taskKeys.includes(key)
      ? taskKeys.filter((item) => item !== key)
      : [...taskKeys, key];
    onChange({ ...value, taskKeys: nextKeys });
  }
  function selectAllTasks() {
    onChange({ ...value, taskKeys: defaultWorkPeriodTaskKeys });
  }
  function clearAllTasks() {
    onChange({ ...value, taskKeys: [] });
  }
  function selectGroup(groupKey) {
    const groupKeys = groupOptions(groupKey).map((option) => option.key);
    onChange({ ...value, taskKeys: [...new Set([...taskKeys, ...groupKeys])] });
  }
  function clearGroup(groupKey) {
    const groupKeys = new Set(groupOptions(groupKey).map((option) => option.key));
    onChange({ ...value, taskKeys: taskKeys.filter((key) => !groupKeys.has(key)) });
  }
  function addManualTask() {
    const label = manualDraft.label.trim();
    if (!label) return;
    onChange({
      ...value,
      manualTasks: [
        ...manualTasks,
        {
          key: manualWorkPeriodTaskKey(),
          label,
          manual: true,
          description: manualDraft.description.trim(),
        },
      ],
    });
    setManualDraft({ label: "", description: "" });
  }
  function updateManualTask(key, patch) {
    onChange({
      ...value,
      manualTasks: manualTasks.map((task) => (task.key === key ? { ...task, ...patch } : task)),
    });
  }
  function removeManualTask(key) {
    onChange({ ...value, manualTasks: manualTasks.filter((task) => task.key !== key) });
  }
  function submit(event) {
    event.preventDefault();
    onSubmit({ ...value, taskKeys, manualTasks });
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal work-period-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>{isEdit ? "Редактировать план периода" : "Создать отчетный период"}</h2>
            <p>{isEdit ? "Можно менять даты и набор активных пунктов плана, пока период идет." : "Период может начинаться с любой даты, не обязательно с первого числа месяца."}</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          <label className="field-label">
            Название
            <input value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="Например: Июль, первая волна работ" maxLength={180} />
          </label>
          <div className="form-two">
            <label className="field-label">
              Дата начала
              <input type="date" value={value.start} onChange={(event) => onChange({ ...value, start: event.target.value })} required />
            </label>
            <label className="field-label">
              Дата окончания
              <input type="date" value={value.end} onChange={(event) => onChange({ ...value, end: event.target.value })} required />
            </label>
          </div>
          <div className="work-period-task-picker-head">
            <div>
              <strong>Работы на период</strong>
              <span>{selectedCount} из {workPeriodTaskOptions.length} выбрано</span>
            </div>
            <div>
              <button className="btn mini" type="button" onClick={selectAllTasks}>Выбрать все</button>
              <button className="btn mini" type="button" onClick={clearAllTasks}>Снять все</button>
            </div>
          </div>
          <div className="work-period-task-picker">
            {visibleGroups.map((group) => {
              const options = groupOptions(group.key);
              const groupSelected = options.filter((option) => taskKeys.includes(option.key)).length;
              if (!options.length) return null;
              return (
                <section className="work-period-task-group" key={group.key}>
                  <div className="work-period-task-group-head">
                    <div>
                      <strong>{group.label}</strong>
                      <span>{groupSelected} из {options.length}</span>
                    </div>
                    {group.key !== "legacy" ? (
                      <div>
                        <button className="btn mini" type="button" onClick={() => selectGroup(group.key)}>Все</button>
                        <button className="btn mini" type="button" onClick={() => clearGroup(group.key)}>Ничего</button>
                      </div>
                    ) : null}
                  </div>
                  <div className="work-period-task-options">
                    {options.map((option) => (
                      <label className={`work-period-task-option ${taskKeys.includes(option.key) ? "active" : ""}`} key={option.key}>
                        <input type="checkbox" checked={taskKeys.includes(option.key)} onChange={() => toggleTask(option.key)} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <section className="work-period-manual-section">
            <div className="work-period-task-group-head">
              <div>
                <strong>Внеплановые работы</strong>
                <span>{manualTasks.length} {pluralRu(manualTasks.length, "задача", "задачи", "задач")}</span>
              </div>
            </div>
            <div className="work-period-manual-form">
              <label className="field-label compact">
                Название
                <input value={manualDraft.label} onChange={(event) => setManualDraft({ ...manualDraft, label: event.target.value })} placeholder="Например: Срочно поправить карточку клиента" maxLength={180} />
              </label>
              <label className="field-label compact">
                Описание
                <textarea value={manualDraft.description} onChange={(event) => setManualDraft({ ...manualDraft, description: event.target.value })} placeholder="Что именно нужно сделать" rows={2} maxLength={1600} />
              </label>
              <button className="btn mini" type="button" onClick={addManualTask} disabled={!manualDraft.label.trim()}>
                <Plus size={14} />Добавить
              </button>
            </div>
            {manualTasks.length ? (
              <div className="work-period-manual-list">
                {manualTasks.map((task) => (
                  <div className="work-period-manual-row" key={task.key}>
                    <label className="field-label compact">
                      Название
                      <input value={task.label} onChange={(event) => updateManualTask(task.key, { label: event.target.value })} maxLength={180} />
                    </label>
                    <label className="field-label compact">
                      Описание
                      <textarea value={task.description} onChange={(event) => updateManualTask(task.key, { description: event.target.value })} rows={2} maxLength={1600} />
                    </label>
                    <button className="btn mini danger" type="button" onClick={() => removeManualTask(task.key)}>
                      <Trash2 size={14} />Убрать
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          {!activeCount ? <p className="form-error">Выберите хотя бы одну работу для периода.</p> : null}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading || !activeCount} aria-busy={loading || undefined}>
            {loading ? (isEdit ? "Сохраняем" : "Создаем") : (isEdit ? "Сохранить план" : "Создать период")}
          </button>
        </div>
      </form>
    </div>
  );
}

function defaultWorkPackageForm() {
  return { workTypes: ["content"], title: "", comment: "", workPeriodLink: "", workPeriodLinks: [] };
}

function CardsTable({ cards, portal, workflow = defaultApprovalWorkflow(), workPeriods = [], workPeriodsStatus = "idle", onOpenCard, onWorkflowChange, onWorkPeriodChange }) {
  const storageKey = `opticards-workset:${portal?.id || "portal"}`;
  const [query, setQuery] = useState("");
  const [bulkFilterText, setBulkFilterText] = useState("");
  const [issueFilter, setIssueFilter] = useState("all");
  const [workFilter, setWorkFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState(() => readCardWorkset(storageKey));
  const [workPackageOpen, setWorkPackageOpen] = useState(false);
  const [workPackageForm, setWorkPackageForm] = useState(defaultWorkPackageForm);
  const [worksetLoaded, setWorksetLoaded] = useState(Boolean(portal?.isDemo));
  const [worksetStatus, setWorksetStatus] = useState("idle");
  const [batchStatus, setBatchStatus] = useState("idle");
  const cardKeySignature = cards.map(cardStableKey).join("|");

  useEffect(() => {
    setSelectedKeys(readCardWorkset(storageKey));
    setWorkPackageOpen(false);
    setWorkPackageForm(defaultWorkPackageForm());
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
  const bulkTokens = bulkCardTokensFromText(bulkFilterText);
  const bulkFilterActive = bulkTokens.length > 0;
  const cardIdentifierSets = new Map(cards.map((card) => [cardStableKey(card), cardBulkIdentifiers(card)]));
  const categories = [...new Set(cards.map((card) => String(card.subjectName || "категория не указана").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"));
  const selectedSet = new Set(selectedKeys);
  const approvalTaskLookup = buildApprovalTaskLookup(workflow.tasks || []);
  const problemCards = cards.filter((card) => cardProblemReasons(card).length);
  const signalCards = cards.filter((card) => cardDataSignals(card).length);
  const signalOnlyCards = signalCards.filter((card) => !cardProblemReasons(card).length);
  const cleanCards = cards.filter((card) => !cardProblemReasons(card).length && !cardDataSignals(card).length).length;
  const readyCards = cards.filter((card) => !cardProblemReasons(card).length);
  const selectedCards = cards.filter((card) => selectedSet.has(cardStableKey(card)));
  const taskCards = cards.filter((card) => approvalTaskForCard(card, approvalTaskLookup));
  const workflowTasks = [...(workflow.tasks || []), ...(workflow.completedTasks || [])];
  const tasksForCard = (card) => workflowTasks.filter((task) => cardMatchesApprovalTask(card, task));
  const cardHasSemanticFinal = (card) => tasksForCard(card).some((task) => task.workType === "semantic" && (taskHasSemanticFinal(task) || ["done", "approved", "exported"].includes(task.status)));
  const cardHasFinalContent = (card) => tasksForCard(card).some((task) => task.workType === "content" && contentApprovalStatusExportable(task.status));
  const semanticFinalCards = cards.filter(cardHasSemanticFinal);
  const contentFinalCards = cards.filter(cardHasFinalContent);
  const bulkMatchedCards = bulkFilterActive
    ? cards.filter((card) => {
      const identifiers = cardIdentifierSets.get(cardStableKey(card)) || new Set();
      return bulkTokens.some((token) => identifiers.has(token));
    })
    : [];
  const bulkMatchedTokenSet = new Set();
  if (bulkFilterActive) {
    bulkMatchedCards.forEach((card) => {
      const identifiers = cardIdentifierSets.get(cardStableKey(card)) || new Set();
      bulkTokens.forEach((token) => {
        if (identifiers.has(token)) bulkMatchedTokenSet.add(token);
      });
    });
  }
  const bulkUnmatchedTokens = bulkFilterActive ? bulkTokens.filter((token) => !bulkMatchedTokenSet.has(token)) : [];
  const visibleCards = cards.filter((card) => {
    const key = cardStableKey(card);
    const identifiers = cardIdentifierSets.get(key) || new Set();
    const hasProblems = cardProblemReasons(card).length > 0;
    const hasSignals = cardDataSignals(card).length > 0;
    const hasTask = Boolean(approvalTaskForCard(card, approvalTaskLookup));
    if (bulkFilterActive && !bulkTokens.some((token) => identifiers.has(token))) {
      return false;
    }
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
    if (workFilter === "ready" && hasProblems) {
      return false;
    }
    if (workFilter === "without-semantic" && cardHasSemanticFinal(card)) {
      return false;
    }
    if (workFilter === "semantic-final" && !cardHasSemanticFinal(card)) {
      return false;
    }
    if (workFilter === "content-final" && !cardHasFinalContent(card)) {
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
      } else if (bulkFilterActive) {
        return visibleKeys;
      } else {
        visibleKeys.forEach((key) => currentSet.add(key));
      }
      return [...currentSet];
    });
  }

  function resetFilters() {
    setQuery("");
    setBulkFilterText("");
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
    const linkTargets = parseWorkPeriodTaskLinkValues(options.workPeriodLinks?.length ? options.workPeriodLinks : options.workPeriodLink);
    setBatchStatus("saving");
	    try {
	      const payload = await apiRequest("/api/card-workset/create-tasks", {
	        method: "POST",
	        body: JSON.stringify({
	          portalId: portal.id,
	          cards: selectedCards.map(cardWorksetPayload),
	          workTypes,
	          title: String(options.title || "").trim(),
	          comment: String(options.comment || "").trim(),
	          workPeriodLinks: linkTargets,
	        }),
	      });
	      if (payload.workflow && onWorkflowChange) {
	        onWorkflowChange(payload.workflow);
	      }
	      if (Array.isArray(payload.workPeriods)) {
	        payload.workPeriods.forEach((period) => onWorkPeriodChange?.(period));
	      } else if (payload.workPeriod) {
	        onWorkPeriodChange?.(payload.workPeriod);
	      }
	      const keys = (payload.workset?.cards || []).map((card) => String(card.cardKey || "")).filter(Boolean);
	      if (keys.length) {
	        setSelectedKeys(keys);
	      }
	      setWorkPackageOpen(false);
	      setWorkPackageForm(defaultWorkPackageForm());
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
            <span>Без замечаний</span>
            <strong>{formatNumber(cleanCards)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ work: "ready" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ work: "ready" })}
            title={isSummaryFilterActive({ work: "ready" }) ? "Показать все карточки" : "Показать карточки без критичных проблем"}
          >
            <span>Готовы к работе</span>
            <strong>{formatNumber(readyCards.length)}</strong>
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
            className={`work-summary-item ${isSummaryFilterActive({ work: "semantic-final" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ work: "semantic-final" })}
            title={isSummaryFilterActive({ work: "semantic-final" }) ? "Показать все карточки" : "Показать карточки с итоговым СЯ"}
          >
            <span>Итоговое СЯ</span>
            <strong>{formatNumber(semanticFinalCards.length)}</strong>
          </button>
          <button
            className={`work-summary-item ${isSummaryFilterActive({ work: "content-final" }) ? "active" : ""}`}
            type="button"
            onClick={() => applySummaryFilter({ work: "content-final" })}
            title={isSummaryFilterActive({ work: "content-final" }) ? "Показать все карточки" : "Показать карточки с итоговым контентом"}
          >
            <span>Итоговый контент</span>
            <strong>{formatNumber(contentFinalCards.length)}</strong>
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
            <option value="all">Любой статус</option>
            <option value="ready">Готовы к работе</option>
            <option value="tasks">Есть задача</option>
            <option value="without-semantic">Без итогового СЯ</option>
            <option value="semantic-final">Есть итоговое СЯ</option>
            <option value="content-final">Есть итоговый контент</option>
            <option value="selected">В рабочем наборе</option>
            <option value="none">Нет задачи</option>
          </select>
          <select className="select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">Все категории</option>
            {categories.map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
          <label className="bulk-card-filter">
            <span>Список артикулов / nmID</span>
            <textarea
              value={bulkFilterText}
              onChange={(event) => setBulkFilterText(event.target.value)}
              placeholder="Вставьте столбец из таблицы"
              rows={3}
            />
          </label>
        </div>

        <div className="cards-toolbar">
          <span>
            Показано {formatNumber(visibleCards.length)} из {formatNumber(cards.length)}
            {bulkFilterActive ? ` · список ${formatNumber(bulkTokens.length)}, найдено ${formatNumber(bulkMatchedCards.length)}${bulkUnmatchedTokens.length ? `, не найдено ${formatNumber(bulkUnmatchedTokens.length)}` : ""}` : ""}
            {worksetStatus === "saving" ? " · сохраняем набор" : ""}
            {worksetStatus === "local-fallback" ? " · набор только в браузере" : ""}
            {batchStatus === "created" ? " · взято в работу" : ""}
            {batchStatus === "error" ? " · не удалось взять в работу" : ""}
          </span>
          <div className="toolbar">
            <button className={loadingButtonClass("btn primary", batchStatus === "saving")} type="button" onClick={() => setWorkPackageOpen(true)} disabled={portal?.isDemo || !selectedCards.length || batchStatus === "saving"} aria-busy={batchStatus === "saving" || undefined}>
              <Plus size={16} />{batchStatus === "saving" ? "Берем в работу" : "Взять в работу"}
            </button>
            <button className="btn" type="button" onClick={toggleVisible} disabled={!visibleCards.length}>
              <CheckSquare size={16} />{allVisibleSelected ? (bulkFilterActive ? "Убрать найденные" : "Убрать видимые") : (bulkFilterActive ? "Выбрать найденные" : "Выбрать видимые")}
            </button>
            <button className="btn" type="button" onClick={() => setSelectedKeys([])} disabled={!selectedKeys.length}>Очистить набор</button>
            <button className="btn ghost" type="button" onClick={resetFilters}>Сбросить фильтры</button>
          </div>
        </div>
        {bulkFilterActive && bulkUnmatchedTokens.length ? (
          <div className="bulk-card-warning">
            <strong>Не найдены</strong>
            <span>{bulkUnmatchedTokens.slice(0, 12).join(", ")}{bulkUnmatchedTokens.length > 12 ? ` и еще ${formatNumber(bulkUnmatchedTokens.length - 12)}` : ""}</span>
          </div>
        ) : null}
      </div>

      {workPackageOpen ? (
        <WorkPackageModal
          selectedCount={selectedCards.length}
          value={workPackageForm}
          workPeriods={workPeriods}
          workPeriodsStatus={workPeriodsStatus}
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

function WorkPeriodTaskLinkPicker({ options = [], value = "", values = [], multiple = false, disabled = false, allowEmpty = false, emptyLabel = "Не привязывать к плану", emptyDescription = "Можно связать задачу с пунктом позднее.", onChange }) {
  const selectedValues = new Set(multiple ? (Array.isArray(values) ? values.map(String) : []) : [String(value || "")].filter(Boolean));
  const allOptions = allowEmpty
    ? [{ value: "", label: emptyLabel, empty: true, description: emptyDescription }, ...options]
    : options;
  const updateSelection = (option) => {
    if (option.empty) {
      onChange?.(multiple ? [] : "");
      return;
    }
    if (!multiple) {
      onChange?.(option.value || "");
      return;
    }
    const optionValue = String(option.value || "");
    const nextValues = Array.isArray(values) ? values.map(String) : [];
    const next = selectedValues.has(optionValue)
      ? nextValues.filter((item) => item !== optionValue)
      : [...nextValues, optionValue];
    onChange?.(next);
  };
  return (
    <div className="work-period-link-picker" role={multiple ? "group" : "radiogroup"} aria-label="Пункт отчетного периода">
      {allOptions.map((option) => {
        const optionValue = String(option.value || "");
        const selected = option.empty ? (multiple ? !selectedValues.size : !String(value || "")) : selectedValues.has(optionValue);
        const rangeLabel = option.empty ? "" : workPeriodRangeLabel(option.period);
        return (
          <button
            className={`work-period-link-option ${selected ? "active" : ""} ${option.empty ? "empty" : ""}`}
            type="button"
            key={option.value || "empty"}
            onClick={() => updateSelection(option)}
            disabled={disabled}
            aria-pressed={selected}
          >
            <span className="work-period-link-check">{selected ? <CheckSquare size={16} /> : null}</span>
            <span className="work-period-link-copy">
              <strong>{option.empty ? option.label : option.task?.label || option.label}</strong>
              <span>{option.empty ? option.description : `${option.period?.title || "Отчетный период"}${rangeLabel ? ` · ${rangeLabel}` : ""}`}</span>
            </span>
            {!option.empty ? <Tag tone={workPeriodTaskStatusTone(option.task?.status)}>{workPeriodTaskStatusLabel(option.task?.status)}</Tag> : null}
          </button>
        );
      })}
    </div>
  );
}

function WorkPackageModal({ selectedCount, value, workPeriods = [], workPeriodsStatus = "idle", loading, onChange, onClose, onSubmit }) {
  const workTypes = normalizeWorkTypes(value.workTypes);
  const title = value.title || "";
  const comment = value.comment || "";
  const workPeriodLinks = Array.isArray(value.workPeriodLinks) ? value.workPeriodLinks : [value.workPeriodLink].filter(Boolean);
  const periodTaskOptions = workPeriodTaskLinkOptions(workPeriods);
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
  const updateTitle = (event) => {
    onChange({ ...value, title: event.target.value });
  };
  const updateWorkPeriodLinks = (nextValues) => {
    const cleanValues = Array.isArray(nextValues) ? nextValues : [nextValues].filter(Boolean);
    onChange({ ...value, workPeriodLinks: cleanValues, workPeriodLink: cleanValues[0] || "" });
  };
  const submit = (event) => {
    event.preventDefault();
    onSubmit({ workTypes, title, comment, workPeriodLinks, workPeriodLink: workPeriodLinks[0] || "" });
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
            Название задачи
            <input value={title} onChange={updateTitle} placeholder="Например: СЯ Оптимист, 40 артикулов" maxLength={180} />
          </label>
          <div className="field-label">
            <span>Пункт отчетного периода</span>
            <WorkPeriodTaskLinkPicker
              options={periodTaskOptions}
              values={workPeriodLinks}
              multiple
              onChange={updateWorkPeriodLinks}
              disabled={workPeriodsStatus === "loading"}
              allowEmpty
              emptyLabel="Не привязывать к плану"
            />
          </div>
          {!periodTaskOptions.length ? (
            <p className="status-note">{workPeriodsStatus === "loading" ? "Загружаем отчетные периоды..." : "Активного отчетного периода с пунктами плана пока нет."}</p>
          ) : null}
          <label className="field-label">
            Комментарий
            <textarea value={comment} onChange={updateComment} placeholder="Например: собрать СЯ по списку артикулов или проверить заголовки перед согласованием." />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading || !workTypes.length} aria-busy={loading || undefined}>
            {loading ? "Создаем задачу" : "Создать задачу"}
          </button>
        </div>
      </form>
    </div>
  );
}

function WorkPeriodTaskLinkModal({ group, workType, workPeriods = [], workPeriodsStatus = "idle", loading, onClose, onSubmit }) {
  const periodTaskOptions = workPeriodTaskLinkOptions(workPeriods);
  const groupTaskIds = [group?.key].filter(Boolean);
  const groupBatchIds = groupTaskIds.length ? [] : [group?.batchId].filter(Boolean);
  const currentValues = periodTaskOptions
    .filter((option) => workPeriodTaskHasTaskLink(option.task, groupTaskIds, groupBatchIds))
    .map((option) => option.value);
  const [selectedValues, setSelectedValues] = useState(currentValues);
  const optionSignature = periodTaskOptions.map((option) => option.value).join("|");
  useEffect(() => {
    const availableValues = new Set(periodTaskOptions.map((option) => option.value));
    setSelectedValues((current) => current.filter((item) => availableValues.has(item)));
  }, [optionSignature]);
  const submit = (event) => {
    event.preventDefault();
    onSubmit(parseWorkPeriodTaskLinkValues(selectedValues));
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal work-package-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Привязать к плану</h2>
            <p>{taskBatchGroupTitle(group)} · {taskSectionLabel(workType)}</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          <div className="field-label">
            <span>Пункт отчетного периода</span>
            <WorkPeriodTaskLinkPicker
              options={periodTaskOptions}
              values={selectedValues}
              multiple
              allowEmpty
              emptyLabel="Снять привязку"
              emptyDescription="Задача останется в кабинете, но исчезнет из пунктов плана."
              onChange={setSelectedValues}
              disabled={loading || workPeriodsStatus === "loading" || !periodTaskOptions.length}
            />
          </div>
          {!periodTaskOptions.length ? (
            <p className="status-note">{workPeriodsStatus === "loading" ? "Загружаем отчетные периоды..." : "Нет активного отчетного периода с пунктами плана."}</p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading || !periodTaskOptions.length} aria-busy={loading || undefined}>
            {loading ? "Сохраняем" : (selectedValues.length ? "Сохранить" : "Снять привязку")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ApprovalWorkflowPanel({ portalId, workflow, status, cards, findUser, onOpenTask, onDeleteTaskGroup, onReorderTaskGroup, onLinkTaskGroup, onUnlinkTaskGroup, onDeleteCompletedTask, onWorkflowUpdated, taskActionStatus = "", workPeriods = [], workPeriodsStatus = "idle", helpEnabled = false }) {
  const tasks = workflow.tasks || [];
  const completedTasks = workflow.completedTasks || [];
  const [completedSearch, setCompletedSearch] = useState("");
  const [groupFilters, setGroupFilters] = useState({});
  const [linkingGroup, setLinkingGroup] = useState(null);
  const [orderingGroupKey, setOrderingGroupKey] = useState("");
  const [localTaskOrders, setLocalTaskOrders] = useState({});
  const [dirtyOrderKeys, setDirtyOrderKeys] = useState({});
  const [draggingTaskKey, setDraggingTaskKey] = useState("");
  const [batchAuditState, setBatchAuditState] = useState({});
  const [batchContentState, setBatchContentState] = useState({});
  const dragAutoScrollRef = useRef({ frame: 0, pointerY: 0, scrollTarget: null, active: false });
  const activeTasks = tasks.filter((task) => ["draft", "changes_requested"].includes(task.status));
  const analytics = workflow.analytics || {};
  const recentEvents = workflow.recentEvents || [];
  const taskHasCard = (task) => Boolean(findCardForApprovalTask(cards, task));
  const groupsByType = buildTaskGroupsByType(activeTasks);
  const totalGroups = Object.values(groupsByType).reduce((sum, groups) => sum + groups.length, 0);
  const completedSearchText = completedSearch.trim().toLowerCase();
  const filteredCompletedTasks = completedTasks.filter((task) => {
    if (!completedSearchText) return true;
    const completedBy = findUser(task.completedBy);
    return [
      task.title,
      task.nmID,
      task.vendorCode,
      task.subjectName,
      taskSectionLabel(task.workType),
      task.completionLabel,
      approvalStatusLabel(task.status),
      task.completedBy,
      completedBy?.full_name,
    ].map((value) => String(value || "").toLowerCase()).join(" ").includes(completedSearchText);
  });
  const eventsForTaskGroup = (group) => {
    const keys = new Set((Array.isArray(group?.tasks) ? group.tasks : []).map((task) => task.cardKey).filter(Boolean));
    if (!keys.size) return [];
    return recentEvents.filter((event) => keys.has(event.cardKey)).slice(0, 8);
  };
  const completedTotal = Number(analytics.completedCount || completedTasks.length || 0);
  const submitTaskLink = async (target) => {
    if (!linkingGroup) return;
    await onLinkTaskGroup?.(linkingGroup.group, linkingGroup.workType, target);
    setLinkingGroup(null);
  };
  const currentGroupTasks = (group) => localTaskOrders[group.key] || group.tasks || [];
  const groupFilterKey = (group) => groupFilters[group.key] || "all";
  const setGroupFilterKey = (group, key) => {
    setGroupFilters((current) => ({ ...current, [group.key]: key }));
  };
  const visibleGroupTasks = (group, workType, isOrdering = false) => {
    const source = currentGroupTasks(group);
    if (isOrdering) return source;
    const filterKey = groupFilterKey(group);
    return source.filter((task) => taskMatchesBatchFilter(task, filterKey, workType));
  };
  const taskOrderKey = (task) => taskRunItemKey(task) || String(task?.cardKey || "");
  const isGroupOrderDirty = (group) => Boolean(dirtyOrderKeys[group.key]);
  const setGroupDraftOrder = (group, nextTasks, dirty = true) => {
    setLocalTaskOrders((current) => ({ ...current, [group.key]: nextTasks }));
    if (dirty) {
      setDirtyOrderKeys((current) => ({ ...current, [group.key]: true }));
    }
  };
  const clearGroupDraftOrder = (group) => {
    setLocalTaskOrders((current) => {
      const next = { ...current };
      delete next[group.key];
      return next;
    });
    setDirtyOrderKeys((current) => {
      const next = { ...current };
      delete next[group.key];
      return next;
    });
  };
  const startGroupOrdering = (group) => {
    setOrderingGroupKey(group.key);
    setGroupDraftOrder(group, currentGroupTasks(group), false);
  };
  const cancelGroupOrdering = (group) => {
    setOrderingGroupKey("");
    setDraggingTaskKey("");
    clearGroupDraftOrder(group);
  };
  const saveGroupOrder = async (group, workType, orderedTasks = currentGroupTasks(group), options = {}) => {
    if (taskActionStatus || !group?.batchId) return false;
    const tasksToSave = Array.isArray(orderedTasks) ? orderedTasks : currentGroupTasks(group);
    if (tasksToSave.length < 2) {
      cancelGroupOrdering(group);
      return false;
    }
    const saved = await onReorderTaskGroup?.({ ...group, tasks: tasksToSave }, workType, tasksToSave);
    if (saved === false) return false;
    clearGroupDraftOrder(group);
    setDraggingTaskKey("");
    if (options.close !== false) {
      setOrderingGroupKey("");
    }
    return true;
  };
  const confirmBatchAction = (group, tasks, title, details) => {
    const count = Array.isArray(tasks) ? tasks.length : 0;
    return window.confirm([
      `${title}?`,
      "",
      taskBatchGroupTitle(group),
      `Будет обработано ${formatNumber(count)} ${pluralRu(count, "карточка", "карточки", "карточек")}.`,
      details,
      "Запустить действие?",
    ].filter(Boolean).join("\n"));
  };
  const runGroupAudit = async (group, workType, tasksToAudit, options = {}) => {
    if (!portalId || taskActionStatus) return;
    const runnableTasks = (Array.isArray(tasksToAudit) ? tasksToAudit : [])
      .filter((task) => task?.cardKey && taskHasCard(task));
    if (!runnableTasks.length) return;
    const confirmTitle = options.retryMode === "failed"
      ? "Повторить подготовку черновиков"
      : options.retryMode === "missing"
        ? "Доделать черновики"
        : "Подготовить черновики";
    if (options.confirm !== false && !confirmBatchAction(
      group,
      runnableTasks,
      confirmTitle,
      "Сервис запустит аудит карточек по очереди и сохранит первичные черновики правок.",
    )) {
      return;
    }
    const actionKey = group.key;
    setBatchAuditState((current) => ({
      ...current,
      [actionKey]: {
        status: "running",
        done: 0,
        failed: 0,
        total: runnableTasks.length,
        retryMode: options.retryMode || "",
        failedTasks: [],
        errors: [],
      },
    }));
    let done = 0;
    let failed = 0;
    const failedTasks = [];
    for (const task of runnableTasks) {
      try {
        const payload = await apiRequest("/api/card-workset/audit-task", {
          method: "POST",
          body: JSON.stringify({
            portalId,
            cardKey: task.cardKey,
            nmID: task.nmID || "",
            vendorCode: task.vendorCode || "",
            batchId: group.batchId || task.batchId || "",
            workType,
          }),
        });
        if (payload?.workflow && onWorkflowUpdated) {
          onWorkflowUpdated(normalizeApprovalWorkflow(payload.workflow));
        }
        done += 1;
      } catch (error) {
        failed += 1;
        failedTasks.push({
          cardKey: task.cardKey || "",
          nmID: task.nmID || "",
          vendorCode: task.vendorCode || "",
          title: task.title || "",
          error: batchAuditErrorText(error),
        });
      }
      const errorCounts = failedTasks.reduce((items, item) => {
        const key = item.error || "Ошибка подготовки";
        items[key] = (items[key] || 0) + 1;
        return items;
      }, {});
      setBatchAuditState((current) => ({
        ...current,
        [actionKey]: {
          status: done + failed >= runnableTasks.length ? (failed ? "partial" : "done") : "running",
          done,
          failed,
          total: runnableTasks.length,
          retryMode: options.retryMode || "",
          failedTasks: [...failedTasks],
          errors: Object.entries(errorCounts).map(([label, count]) => ({ label, count })),
        },
      }));
    }
  };
  const runGroupContentReoptimization = async (group, workType, tasksToOptimize, options = {}) => {
    if (!portalId || taskActionStatus) return;
    const runnableTasks = (Array.isArray(tasksToOptimize) ? tasksToOptimize : [])
      .filter((task) => task?.cardKey && taskHasCard(task) && taskHasSemanticFinal(task));
    if (!runnableTasks.length) return;
    const confirmTitle = options.retryMode === "failed"
      ? "Повторить подготовку контента"
      : options.retryMode === "missing"
        ? "Доделать контент по СЯ"
        : "Подготовить контент по СЯ";
    if (options.confirm !== false && !confirmBatchAction(
      group,
      runnableTasks,
      confirmTitle,
      "Сервис возьмет сохраненное итоговое СЯ и обновит черновики заголовка, описания и характеристик.",
    )) {
      return;
    }
    const actionKey = group.key;
    setBatchContentState((current) => ({
      ...current,
      [actionKey]: {
        status: "running",
        done: 0,
        failed: 0,
        total: runnableTasks.length,
        retryMode: options.retryMode || "",
        failedTasks: [],
        errors: [],
      },
    }));
    let done = 0;
    let failed = 0;
    const failedTasks = [];
    for (const task of runnableTasks) {
      try {
        const payload = await apiRequest("/api/card-workset/reoptimize-content-task", {
          method: "POST",
          body: JSON.stringify({
            portalId,
            cardKey: task.cardKey,
            nmID: task.nmID || "",
            vendorCode: task.vendorCode || "",
            batchId: group.batchId || task.batchId || "",
            workType,
          }),
        });
        if (payload?.workflow && onWorkflowUpdated) {
          onWorkflowUpdated(normalizeApprovalWorkflow(payload.workflow));
        }
        done += 1;
      } catch (error) {
        failed += 1;
        failedTasks.push({
          cardKey: task.cardKey || "",
          nmID: task.nmID || "",
          vendorCode: task.vendorCode || "",
          title: task.title || "",
          error: batchContentErrorText(error),
        });
      }
      const errorCounts = failedTasks.reduce((items, item) => {
        const key = item.error || "Ошибка переоптимизации";
        items[key] = (items[key] || 0) + 1;
        return items;
      }, {});
      setBatchContentState((current) => ({
        ...current,
        [actionKey]: {
          status: done + failed >= runnableTasks.length ? (failed ? "partial" : "done") : "running",
          done,
          failed,
          total: runnableTasks.length,
          retryMode: options.retryMode || "",
          failedTasks: [...failedTasks],
          errors: Object.entries(errorCounts).map(([label, count]) => ({ label, count })),
        },
      }));
    }
  };
  const moveGroupTask = (group, index, delta) => {
    if (taskActionStatus) return;
    const source = currentGroupTasks(group);
    const nextTasks = moveArrayItem(source, index, delta);
    if (nextTasks === source) return;
    setGroupDraftOrder(group, nextTasks);
  };
  const moveDraggedGroupTask = (group, sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey || taskActionStatus) return null;
    const source = currentGroupTasks(group);
    const fromIndex = source.findIndex((task) => taskOrderKey(task) === sourceKey);
    const targetIndex = source.findIndex((task) => taskOrderKey(task) === targetKey);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return null;
    const nextTasks = moveArrayItem(source, fromIndex, targetIndex - fromIndex);
    if (nextTasks === source) return null;
    setGroupDraftOrder(group, nextTasks);
    return nextTasks;
  };
  function stopTaskDragAutoScroll() {
    const state = dragAutoScrollRef.current;
    state.active = false;
    state.scrollTarget = null;
    if (state.frame) {
      window.cancelAnimationFrame(state.frame);
      state.frame = 0;
    }
  }
  function findTaskDragScrollTarget(target) {
    let element = target instanceof Element ? target : null;
    while (element && element !== document.body) {
      if (element instanceof HTMLElement) {
        const style = window.getComputedStyle(element);
        const canScroll = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
        if (canScroll) return element;
      }
      element = element.parentElement;
    }
    return null;
  }
  function scrollTaskDragTarget(delta) {
    const target = dragAutoScrollRef.current.scrollTarget;
    if (target) {
      const before = target.scrollTop;
      target.scrollTop += delta;
      if (target.scrollTop !== before) return;
    }
    window.scrollBy({ top: delta, left: 0, behavior: "auto" });
  }
  function runTaskDragAutoScroll() {
    const state = dragAutoScrollRef.current;
    if (!state.active) {
      state.frame = 0;
      return;
    }
    const edgeSize = 120;
    const maxSpeed = 28;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const pointerY = Number(state.pointerY || 0);
    let delta = 0;
    if (pointerY < edgeSize) {
      const strength = (edgeSize - Math.max(pointerY, 0)) / edgeSize;
      delta = -Math.max(3, Math.ceil(maxSpeed * strength * strength));
    } else if (pointerY > viewportHeight - edgeSize) {
      const strength = (Math.min(pointerY, viewportHeight) - (viewportHeight - edgeSize)) / edgeSize;
      delta = Math.max(3, Math.ceil(maxSpeed * strength * strength));
    }
    if (delta) {
      scrollTaskDragTarget(delta);
    }
    state.frame = window.requestAnimationFrame(runTaskDragAutoScroll);
  }
  function updateTaskDragAutoScroll(event) {
    const state = dragAutoScrollRef.current;
    state.pointerY = event.clientY;
    state.scrollTarget = findTaskDragScrollTarget(event.target);
    if (!state.active) {
      state.active = true;
      state.frame = window.requestAnimationFrame(runTaskDragAutoScroll);
    }
  }
  function endTaskDrag() {
    setDraggingTaskKey("");
    stopTaskDragAutoScroll();
  }
  useEffect(() => {
    if (!draggingTaskKey) {
      stopTaskDragAutoScroll();
      return undefined;
    }
    const handleWindowDragOver = (event) => {
      event.preventDefault();
      updateTaskDragAutoScroll(event);
    };
    const handleWindowDragEnd = () => endTaskDrag();
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDragEnd);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDragEnd);
      stopTaskDragAutoScroll();
    };
  }, [draggingTaskKey]);
  const startTaskDrag = (event, group, task) => {
    if (!orderingGroupKey || orderingGroupKey !== group.key || taskActionStatus) return;
    const key = taskOrderKey(task);
    setDraggingTaskKey(key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    updateTaskDragAutoScroll(event);
  };
  const hoverTaskDrag = (event, group, task) => {
    if (!draggingTaskKey || orderingGroupKey !== group.key || taskActionStatus) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateTaskDragAutoScroll(event);
    moveDraggedGroupTask(group, draggingTaskKey, taskOrderKey(task));
  };
  const dropTaskDrag = (event, group) => {
    if (orderingGroupKey !== group.key) return;
    event.preventDefault();
    endTaskDrag();
  };
  const renderCompletedTaskRows = (sectionTasks, limit = 30) => {
    const visibleTasks = sectionTasks.slice(0, limit);
    return (
      <>
        <div className="task-completed-list compact">
          {visibleTasks.map((task) => {
            const rowCanOpen = taskHasCard(task);
            const completedBy = findUser(task.completedBy);
            const canDeleteCompleted = !task.batchId && task.workType === "semantic";
            const deleteActionKey = `completed:${task.cardKey}:${task.workType}`;
            const deleteBusy = taskActionStatus === deleteActionKey;
            const completedTime = Date.parse(task.completedAt || "");
            const completedAtLabel = Number.isFinite(completedTime)
              ? new Date(task.completedAt).toLocaleString("ru-RU")
              : task.completedAt || "без даты";
            return (
              <div className="task-completed-row" key={`${task.cardKey}-${task.workType}-${task.completedAt || task.updatedAt}`}>
                <div className="task-completed-main">
                  <div className="task-completed-title">
                    <strong>{task.title}</strong>
                    <Tag tone={approvalStatusTone(task.status)}>{task.completionLabel || approvalStatusLabel(task.status)}</Tag>
                  </div>
                  <div className="task-completed-meta">
                    <span>WB {textOrDash(task.nmID)}</span>
                    <span>артикул {textOrDash(task.vendorCode)}</span>
                    <span>{textOrDash(task.subjectName)}</span>
                    <time>{completedAtLabel}</time>
                    <span>завершил: {completedBy?.full_name || task.completedBy || "не указан"}</span>
                  </div>
                </div>
                <div className="task-completed-actions">
                  <button className="btn mini" type="button" onClick={() => onOpenTask(task)} disabled={!rowCanOpen || deleteBusy}>
                    <Eye size={14} />Открыть
                  </button>
                  {canDeleteCompleted ? (
                    <button className={loadingButtonClass("btn danger mini", deleteBusy)} type="button" onClick={() => onDeleteCompletedTask?.(task)} disabled={Boolean(taskActionStatus)} aria-busy={deleteBusy || undefined}>
                      <Trash2 size={14} />Убрать
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {sectionTasks.length > visibleTasks.length ? (
          <div className="task-completed-more">
            Показано {formatNumber(visibleTasks.length)} из {formatNumber(sectionTasks.length)}. Уточните поиск, чтобы найти нужную карточку.
          </div>
        ) : null}
      </>
    );
  };
  return (
    <section className="workspace-strip approval-workflow-strip">
      <div className="strip-head">
        <div>
          <h2>Задачи</h2>
          <p>Задачи сгруппированы по пачкам карточек. СЯ закрывается добавлением в итоговое СЯ, контент, цены и остатки идут через согласование.</p>
        </div>
        <Tag tone={activeTasks.length ? "amber" : "green"}>
          {status === "loading" ? "загрузка" : `${totalGroups} ${pluralRu(totalGroups, "задача", "задачи", "задач")}`}
        </Tag>
      </div>
	      <HelpList
	        enabled={helpEnabled}
		        title="Как работать с задачами"
		        items={[
		          "Откройте пачку кнопкой Начать работу или конкретную строку: карточка откроется с прогрессом пачки и кнопками Предыдущая/Следующая.",
		          "Кнопки Привязать к плану и Отвязать от плана управляют связью пачки с пунктом текущего отчетного периода.",
	          "Удалить задачу нужно только для ошибочных или неактуальных пачек. Сохраненные результаты карточек останутся в черновиках.",
	          "Если задача по СЯ закрыта, добавьте выбранные ключи в итоговое СЯ карточки: после этого кабинетная выгрузка соберет их в общий файл.",
	        ]}
	      />

      {status === "error" ? (
        <div className="empty-state"><span>Не удалось загрузить задачи согласования</span></div>
      ) : null}

      <div className="approval-analytics-grid">
        {taskSectionOptions.map((section) => {
          const groups = groupsByType[section.key] || [];
          const cardsCount = groups.reduce((sum, group) => sum + group.tasks.length, 0);
          return (
            <Metric
              label={section.label}
              value={`${formatNumber(cardsCount)} ${pluralRu(cardsCount, "карточка", "карточки", "карточек")}`}
              hint={groups.length ? `${formatNumber(groups.length)} ${pluralRu(groups.length, "пачка", "пачки", "пачек")} активно` : "активных пачек нет"}
              key={section.key}
            />
          );
        })}
      </div>

      {completedTotal ? (
        <div className="task-completed-filter">
          <div>
            <strong>Завершенные работы</strong>
            <span>{formatNumber(completedTotal)} {pluralRu(completedTotal, "работа", "работы", "работ")} разложены по разделам ниже</span>
          </div>
          <label className="search-field task-completed-search">
            <Search size={16} />
            <input
              type="search"
              value={completedSearch}
              onChange={(event) => setCompletedSearch(event.target.value)}
              placeholder="Найти завершенную карточку"
            />
          </label>
        </div>
      ) : null}

      {status === "loading" && !activeTasks.length && !completedTasks.length ? (
        <div className="empty-state"><span>Загружаем задачи...</span></div>
      ) : (
        <div className="task-section-list">
          {taskSectionOptions.map((section) => {
            const groups = groupsByType[section.key] || [];
            const sectionCompletedAll = completedTasks.filter((task) => task.workType === section.key);
            const sectionCompleted = filteredCompletedTasks.filter((task) => task.workType === section.key);
            return (
              <section className="task-type-section" key={section.key}>
                <div className="task-type-head">
                  <div>
                    <h3>{section.label}</h3>
                    <span>
                      {groups.length ? `${groups.length} ${pluralRu(groups.length, "пачка", "пачки", "пачек")} в работе` : "нет активных задач"}
                      {sectionCompletedAll.length ? ` · ${formatNumber(sectionCompletedAll.length)} завершено` : ""}
                    </span>
                  </div>
                  <Tag tone={groups.length ? "blue" : "green"}>{formatNumber(groups.reduce((sum, group) => sum + group.tasks.length, 0))} карточек</Tag>
                </div>
                {groups.length ? (
                  <div className="task-batch-list">
                    {groups.map((group) => {
                      const firstTask = group.tasks[0] || {};
                      const isOrdering = orderingGroupKey === group.key;
                      const allGroupTasks = currentGroupTasks(group);
                      const groupTasks = visibleGroupTasks(group, section.key, isOrdering);
                      const selectedFilterKey = groupFilterKey(group);
                      const availableFilters = taskBatchFilterOptions.filter((option) => !option.semanticOnly || section.key === "semantic");
                      const statusValue = taskGroupStatus(group.tasks);
                      const originalCount = Number(firstTask.batchCardsCount || group.tasks.length || 0);
                      const remainingCount = allGroupTasks.length;
                      const visibleCount = groupTasks.length;
                      const completedGroupTasks = group.batchId
                        ? completedTasks.filter((task) => String(task.batchId || "") === String(group.batchId || "") && taskWorkTypes(task).includes(section.key))
                        : [];
                      const submittedGroupCount = completedGroupTasks.filter((task) => task.status === "submitted").length;
                      const acceptedGroupCount = completedGroupTasks.filter((task) => ["approved", "exported", "done"].includes(task.status)).length;
                      const inactiveGroupCount = Math.max(0, originalCount - remainingCount);
                      const inactiveGroupLabel = submittedGroupCount
                        ? `${formatNumber(submittedGroupCount)} на согласовании`
                        : acceptedGroupCount
                          ? `${formatNumber(acceptedGroupCount)} принято`
                          : inactiveGroupCount
                            ? `${formatNumber(inactiveGroupCount)} не в активной работе`
                            : "";
                      const assignee = findUser(group.assigneeLogin);
                      const author = findUser(group.createdBy);
                      const openableTask = groupTasks.find(taskHasCard) || null;
                      const canOpen = Boolean(openableTask && taskHasCard(openableTask));
                      const cardsLabel = selectedFilterKey !== "all"
                        ? `Показано ${formatNumber(visibleCount)} из ${formatNumber(remainingCount)} в работе${originalCount && originalCount !== remainingCount ? ` · всего ${formatNumber(originalCount)}` : ""}`
                        : originalCount
                          ? `Пачка: ${formatNumber(originalCount)} ${pluralRu(originalCount, "карточка", "карточки", "карточек")}`
                          : `В работе ${formatNumber(remainingCount)}`;
		                      const actionBusy = taskActionStatus === group.key;
		                      const reorderBusy = taskActionStatus === `reorder:${group.key || `${section.key}:${group.batchId || ""}`}`;
		                      const linkBusy = taskActionStatus === `link:${group.key || `${section.key}:${group.batchId || ""}`}`;
		                      const unlinkBusy = taskActionStatus === `unlink:${group.key || `${section.key}:${group.batchId || ""}`}`;
		                      const linkedPlans = workPeriodLinksForGroup(workPeriods, group);
		                      const linkedPlanLabel = workPeriodLinkLabelForGroup(workPeriods, group);
		                      const orderDirty = isGroupOrderDirty(group);
                      const runGroup = { ...group, tasks: groupTasks };
                      const batchEvents = eventsForTaskGroup(group);
                      const returnedCount = allGroupTasks.filter((task) => task.status === "changes_requested").length;
                      const draftCount = allGroupTasks.filter((task) => task.status === "draft").length;
                      const auditState = batchAuditState[group.key] || {};
                      const auditBusy = auditState.status === "running";
                      const auditDone = Number(auditState.done || 0);
                      const auditFailed = Number(auditState.failed || 0);
                      const auditTotal = Number(auditState.total || 0);
                      const auditFailedKeys = new Set((Array.isArray(auditState.failedTasks) ? auditState.failedTasks : []).map(batchAuditTaskKey).filter(Boolean));
                      const retryFailedTasks = auditFailedKeys.size
                        ? allGroupTasks.filter((task) => auditFailedKeys.has(batchAuditTaskKey(task)) && taskHasCard(task))
                        : [];
                      const hasSavedAuditDrafts = allGroupTasks.some((task) => task.hasAuditDraft);
                      const missingAuditTasks = hasSavedAuditDrafts
                        ? allGroupTasks.filter((task) => !task.hasAuditDraft && taskHasCard(task))
                        : [];
                      const auditRetryTasks = retryFailedTasks.length ? retryFailedTasks : missingAuditTasks;
                      const auditRetryMode = retryFailedTasks.length ? "failed" : (missingAuditTasks.length ? "missing" : "");
                      const auditButtonTasks = auditRetryTasks.length ? auditRetryTasks : groupTasks;
                      const auditButtonLabel = auditBusy
                        ? "Готовим черновики"
                        : retryFailedTasks.length
                          ? `Повторить ошибки (${formatNumber(retryFailedTasks.length)})`
                          : missingAuditTasks.length
                            ? `Доделать черновики (${formatNumber(missingAuditTasks.length)})`
                            : "Подготовить черновики";
                      const auditButtonHelp = "Подготовить черновики: запускает аудит карточек и готовит первичные правки по текущей карточке, MPStats, конкурентам и характеристикам. Это не переписывание строго по итоговому СЯ.";
                      const auditErrors = Array.isArray(auditState.errors) ? auditState.errors : [];
                      const contentState = batchContentState[group.key] || {};
                      const contentBusy = contentState.status === "running";
                      const contentDone = Number(contentState.done || 0);
                      const contentFailed = Number(contentState.failed || 0);
                      const contentTotal = Number(contentState.total || 0);
                      const contentFailedKeys = new Set((Array.isArray(contentState.failedTasks) ? contentState.failedTasks : []).map(batchAuditTaskKey).filter(Boolean));
                      const contentSemanticReadyTasks = allGroupTasks.filter((task) => taskHasCard(task) && taskHasSemanticFinal(task));
                      const contentOptimizedTasks = allGroupTasks.filter((task) => taskHasCard(task) && task.hasContentOptimization);
                      const contentVisibleEligibleTasks = groupTasks.filter((task) => taskHasCard(task) && taskHasSemanticFinal(task));
                      const retryContentTasks = contentFailedKeys.size
                        ? allGroupTasks.filter((task) => contentFailedKeys.has(batchAuditTaskKey(task)) && taskHasCard(task) && taskHasSemanticFinal(task))
                        : [];
                      const hasSavedContentOptimization = allGroupTasks.some((task) => task.hasContentOptimization);
                      const missingContentTasks = hasSavedContentOptimization
                        ? allGroupTasks.filter((task) => !task.hasContentOptimization && taskHasCard(task) && taskHasSemanticFinal(task))
                        : [];
                      const contentRetryTasks = retryContentTasks.length ? retryContentTasks : missingContentTasks;
                      const contentRetryMode = retryContentTasks.length ? "failed" : (missingContentTasks.length ? "missing" : "");
                      const contentButtonTasks = contentRetryTasks.length ? contentRetryTasks : contentVisibleEligibleTasks;
                      const showContentReoptimize = ["semantic", "content"].includes(section.key);
                      const isContentSection = section.key === "content";
                      const contentButtonLabel = contentBusy
                        ? "Готовим контент"
                        : retryContentTasks.length
                          ? "Повторить контент"
                          : missingContentTasks.length
                            ? "Доделать контент по СЯ"
                            : "Подготовить контент по СЯ";
                      const contentButtonHelp = "Подготовить контент по СЯ: берет сохраненное итоговое СЯ карточки и обновляет заголовок, описание и характеристики под согласованные ключи.";
                      const contentErrors = Array.isArray(contentState.errors) ? contentState.errors : [];
                      const smartContentUsesSemantic = isContentSection && Boolean(contentButtonTasks.length);
                      const smartContentBusy = smartContentUsesSemantic ? contentBusy : auditBusy;
                      const smartContentTasks = smartContentUsesSemantic ? contentButtonTasks : auditButtonTasks;
                      const smartContentLabel = smartContentUsesSemantic
                        ? contentButtonLabel
                        : auditButtonLabel.replace("черновики", "контент").replace("Черновики", "Контент");
                      const smartContentHelp = smartContentUsesSemantic
                        ? contentButtonHelp
                        : "Подготовить черновики контента: запускает первичную подготовку заголовка, описания и характеристик по текущей карточке, MPStats, конкурентам и характеристикам.";
                      const smartContentTitle = smartContentUsesSemantic
                        ? "Обновить заголовок, описание и характеристики по сохраненному итоговому СЯ."
                        : "Подготовить первичные черновики заголовка, описания и характеристик.";
                      const smartContentCanRun = smartContentTasks.some(taskHasCard);
	                      return (
                        <article className="task-batch-card" key={group.key}>
                          <div className="task-batch-main">
                            <div>
                              <strong>{taskBatchGroupTitle(group)}</strong>
                              <span>{cardsLabel} · {taskSectionLabel(section.key)}</span>
                            </div>
                            <Tag tone={approvalStatusTone(statusValue)}>{approvalStatusLabel(statusValue)}</Tag>
                          </div>
	                          <div className="approval-task-meta">
	                            <span>Поставил: {author?.full_name || group.createdBy || "не указан"}</span>
	                            <span>Исполнитель: {assignee?.full_name || group.assigneeLogin || "техспециалист не задан"}</span>
	                            <span>{group.createdAt ? new Date(group.createdAt).toLocaleString("ru-RU") : "без даты"}</span>
	                            <span>План: {linkedPlanLabel || "не привязано"}</span>
	                          </div>
	                          {group.comment ? <p className="approval-task-reason">{group.comment}</p> : null}
                            <div className="task-batch-status-line">
                              <Tag tone={draftCount ? "blue" : "green"}>{formatNumber(draftCount)} в работе</Tag>
                              <Tag tone={returnedCount ? "red" : "green"}>{formatNumber(returnedCount)} возвратов</Tag>
                              {inactiveGroupLabel ? <Tag tone="amber">{inactiveGroupLabel}</Tag> : null}
                              {isContentSection && contentSemanticReadyTasks.length ? <Tag tone="green">{formatNumber(contentSemanticReadyTasks.length)} с итоговым СЯ</Tag> : null}
                              {isContentSection && contentOptimizedTasks.length ? <Tag tone="blue">{formatNumber(contentOptimizedTasks.length)} уже подготовлено</Tag> : null}
                              {isContentSection && smartContentUsesSemantic ? <Tag tone="blue">{formatNumber(contentButtonTasks.length)} к запуску по СЯ</Tag> : null}
                              <Tag tone={batchEvents.length ? "blue" : "amber"}>{formatNumber(batchEvents.length)} событий</Tag>
                            </div>
	                          <div className="task-batch-actions">
	                            <button className="btn primary" type="button" onClick={() => onOpenTask(openableTask, runGroup, section.key)} disabled={!canOpen}>
	                              <Eye size={17} />Начать работу
	                            </button>
                              {!isContentSection ? (
                                <>
                                  <button className={loadingButtonClass("btn", auditBusy)} type="button" onClick={() => runGroupAudit(group, section.key, auditButtonTasks, { retryMode: auditRetryMode })} disabled={Boolean(taskActionStatus) || auditBusy || !auditButtonTasks.some(taskHasCard)} aria-busy={auditBusy || undefined}>
                                    <WandSparkles size={16} />{auditButtonLabel}
                                  </button>
                                  <ActionHelp label={auditButtonHelp} />
                                </>
                              ) : null}
                              {showContentReoptimize ? (
                                <>
                                  <button className={loadingButtonClass("btn", isContentSection ? smartContentBusy : contentBusy)} type="button" onClick={() => (isContentSection && !smartContentUsesSemantic ? runGroupAudit(group, section.key, smartContentTasks, { retryMode: auditRetryMode }) : runGroupContentReoptimization(group, section.key, contentButtonTasks, { retryMode: contentRetryMode }))} disabled={Boolean(taskActionStatus) || (isContentSection ? smartContentBusy || !smartContentCanRun : contentBusy || !contentButtonTasks.length)} aria-busy={(isContentSection ? smartContentBusy : contentBusy) || undefined} title={isContentSection ? smartContentTitle : (contentButtonTasks.length ? "Обновить заголовок, описание и характеристики по сохраненному итоговому СЯ." : "Сначала добавьте итоговое СЯ в карточках пачки.")}>
                                    <FileText size={16} />{isContentSection ? smartContentLabel : contentButtonLabel}
                                  </button>
                                  <ActionHelp label={isContentSection ? smartContentHelp : contentButtonHelp} />
                                </>
                              ) : null}
	                            {isOrdering ? (
	                              <>
	                                <button className={loadingButtonClass("btn primary", reorderBusy)} type="button" onClick={() => (orderDirty ? saveGroupOrder(group, section.key) : cancelGroupOrdering(group))} disabled={Boolean(taskActionStatus && !reorderBusy)} aria-busy={reorderBusy || undefined}>
	                                  <Save size={16} />{orderDirty ? "Сохранить порядок" : "Готово"}
	                                </button>
	                                <button className="btn ghost" type="button" onClick={() => cancelGroupOrdering(group)} disabled={Boolean(taskActionStatus)}>
	                                  Отмена
	                                </button>
	                              </>
	                            ) : (
	                              <button className="btn" type="button" onClick={() => startGroupOrdering(group)} disabled={Boolean(taskActionStatus) || groupTasks.length < 2 || !group.batchId}>
	                                <GripVertical size={16} />Поменять порядок
	                              </button>
	                            )}
	                            <button className={loadingButtonClass("btn", linkBusy)} type="button" onClick={() => setLinkingGroup({ group, workType: section.key })} disabled={Boolean(taskActionStatus)} aria-busy={linkBusy || undefined}>
	                              <ClipboardList size={16} />{linkedPlans.length ? "Изменить пункты плана" : "Привязать к плану"}
	                            </button>
	                            {linkedPlans.length ? (
	                              <button className={loadingButtonClass("btn", unlinkBusy)} type="button" onClick={() => onUnlinkTaskGroup?.(group, section.key, linkedPlans)} disabled={Boolean(taskActionStatus)} aria-busy={unlinkBusy || undefined}>
	                                <Unlink size={16} />{linkedPlans.length > 1 ? "Отвязать от всех" : "Отвязать от плана"}
	                              </button>
	                            ) : null}
	                            <button className={loadingButtonClass("btn danger", actionBusy)} type="button" onClick={() => onDeleteTaskGroup?.(group, section.key)} disabled={Boolean(taskActionStatus)} aria-busy={actionBusy || undefined}>
	                              <Trash2 size={16} />Удалить задачу
	                            </button>
	                          </div>
                            {auditTotal ? (
                              <div className={`task-batch-audit-progress ${auditState.status || ""}`}>
                                <div>
                                  <strong>{auditBusy ? "Подготовка черновиков" : auditFailed ? "Черновики подготовлены с ошибками" : "Черновики подготовлены"}</strong>
                                  <span>{formatNumber(auditDone)} из {formatNumber(auditTotal)}{auditFailed ? ` · ошибок ${formatNumber(auditFailed)}` : ""}</span>
                                </div>
                                <div className="task-batch-audit-bar">
                                  <span style={{ width: `${Math.round(((auditDone + auditFailed) / Math.max(auditTotal, 1)) * 100)}%` }} />
                                </div>
                                {auditFailed ? (
                                  <div className="task-batch-audit-errors">
                                    {auditErrors.slice(0, 3).map((item) => (
                                      <span key={item.label}>{item.label} · {formatNumber(item.count)}</span>
                                    ))}
                                    {(auditState.failedTasks || []).slice(0, 3).map((item) => (
                                      <em key={batchAuditTaskKey(item)}>{batchAuditFailureLabel(item)}</em>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {contentTotal ? (
                              <div className={`task-batch-audit-progress ${contentState.status || ""}`}>
                                <div>
                                  <strong>{contentBusy ? "Контент по СЯ готовится" : contentFailed ? "Контент подготовлен с ошибками" : "Контент подготовлен"}</strong>
                                  <span>{formatNumber(contentDone)} из {formatNumber(contentTotal)}{contentFailed ? ` · ошибок ${formatNumber(contentFailed)}` : ""}</span>
                                </div>
                                <div className="task-batch-audit-bar">
                                  <span style={{ width: `${Math.round(((contentDone + contentFailed) / Math.max(contentTotal, 1)) * 100)}%` }} />
                                </div>
                                {contentFailed ? (
                                  <div className="task-batch-audit-errors">
                                    {contentErrors.slice(0, 3).map((item) => (
                                      <span key={item.label}>{item.label} · {formatNumber(item.count)}</span>
                                    ))}
                                    {(contentState.failedTasks || []).slice(0, 3).map((item) => (
                                      <em key={batchAuditTaskKey(item)}>{batchAuditFailureLabel(item)}</em>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          <details className="task-card-details" open={isOrdering || undefined}>
                            <summary>Карточки в задаче</summary>
                            {isOrdering ? <p className="task-order-hint">Перетащите карточку мышкой или используйте кнопки выше/ниже. У края экрана список прокрутится сам. Когда порядок готов, нажмите Сохранить порядок.</p> : null}
                            {!isOrdering ? (
                              <div className="task-batch-filter" role="group" aria-label="Фильтр карточек пачки">
                                {availableFilters.map((option) => (
                                  <button
                                    className={selectedFilterKey === option.key ? "active" : ""}
                                    type="button"
                                    onClick={() => setGroupFilterKey(group, option.key)}
                                    key={option.key}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <div className="task-card-list">
                              {groupTasks.length ? groupTasks.map((task, taskIndex) => {
                                const rowCanOpen = taskHasCard(task);
                                const rowKey = taskOrderKey(task);
                                const dragging = isOrdering && draggingTaskKey === rowKey;
                                const rowStatus = taskCardWorkStatus(task, section.key);
                                return (
                                  <div
                                    className={`task-card-row ${isOrdering ? "ordering" : ""} ${dragging ? "dragging" : ""}`}
                                    key={`${group.key}-${task.cardKey}`}
                                    draggable={isOrdering}
                                    onDragStart={(event) => startTaskDrag(event, group, task)}
                                    onDragEnter={(event) => hoverTaskDrag(event, group, task)}
                                    onDragOver={(event) => hoverTaskDrag(event, group, task)}
                                    onDrop={(event) => dropTaskDrag(event, group)}
                                    onDragEnd={endTaskDrag}
                                  >
                                    <div className="task-card-row-main">
                                      {isOrdering ? <span className="task-drag-handle" title="Перетащить"><GripVertical size={16} /></span> : null}
                                      <div>
                                        <strong>{task.title}</strong>
                                        <span>WB {textOrDash(task.nmID)} · артикул {textOrDash(task.vendorCode)} · {textOrDash(task.subjectName)}</span>
                                      </div>
                                    </div>
                                    <div className="task-card-row-actions">
                                      <Tag tone={rowStatus.tone}>{rowStatus.label}</Tag>
                                      {isOrdering ? (
                                        <>
                                          <button className="btn mini" type="button" onClick={() => moveGroupTask(group, taskIndex, -1)} disabled={Boolean(taskActionStatus) || taskIndex === 0} title="Поднять выше">
                                            <ArrowUp size={14} />Выше
                                          </button>
                                          <button className="btn mini" type="button" onClick={() => moveGroupTask(group, taskIndex, 1)} disabled={Boolean(taskActionStatus) || taskIndex === groupTasks.length - 1} title="Опустить ниже">
                                            <ArrowDown size={14} />Ниже
                                          </button>
                                        </>
                                      ) : null}
                                      <button className="btn mini" type="button" onClick={() => onOpenTask(task, runGroup, section.key)} disabled={!rowCanOpen}>
                                        Открыть
                                      </button>
                                    </div>
                                  </div>
                                );
                              }) : (
                                <div className="empty-state compact"><span>По выбранному фильтру карточек нет.</span></div>
                              )}
                            </div>
                          </details>
                          <details className="task-batch-log">
                            <summary>Журнал действий</summary>
                            {batchEvents.length ? (
                              <div className="task-batch-event-list">
                                {batchEvents.map((event) => {
                                  const actor = findUser(event.actorLogin);
                                  const eventTime = event.eventAt ? new Date(event.eventAt).toLocaleString("ru-RU") : "без даты";
                                  return (
                                    <div className="task-batch-event" key={event.id || `${event.cardKey}-${event.action}-${event.eventAt}`}>
                                      <div>
                                        <strong>{approvalEventLabel(event.action || event.status)}</strong>
                                        <span>{event.title || `WB ${textOrDash(event.nmID)}`}</span>
                                      </div>
                                      <p>{actor?.full_name || event.actorLogin || "система"} · {eventTime}</p>
                                      {event.reason ? <em>{event.reason}</em> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="empty-state compact"><span>По этой пачке пока нет событий.</span></div>
                            )}
                          </details>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state compact"><span>Активных задач в разделе нет.</span></div>
                )}
                <div className="task-section-completed">
                  <div className="task-section-completed-head">
                    <strong>Завершенные {section.label.toLowerCase()}</strong>
                    <span>{sectionCompletedAll.length ? `${formatNumber(sectionCompletedAll.length)} ${pluralRu(sectionCompletedAll.length, "работа", "работы", "работ")}` : "пока пусто"}</span>
                  </div>
                  {sectionCompleted.length ? renderCompletedTaskRows(sectionCompleted) : (
                    <div className="empty-state compact">
                      <span>{sectionCompletedAll.length && completedSearchText ? "По этому поиску завершенных карточек нет." : "Завершенных задач в этом разделе пока нет."}</span>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
	      )}

	      {linkingGroup ? (
	        <WorkPeriodTaskLinkModal
	          group={linkingGroup.group}
	          workType={linkingGroup.workType}
	          workPeriods={workPeriods}
	          workPeriodsStatus={workPeriodsStatus}
	          loading={Boolean(taskActionStatus)}
	          onClose={() => setLinkingGroup(null)}
	          onSubmit={submitTaskLink}
	        />
	      ) : null}

      <div className="approval-events">
        <div className="approval-events-head">
          <strong>История решений</strong>
          <span>{recentEvents.length ? `${recentEvents.length} последних событий · среднее согласование ${durationShort(analytics.avgApprovalMinutes)}` : "пока пусто"}</span>
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

function CardDetailScreen({ card, portal, currentUser, onBack, backLabel = "Карточки", taskRun = null, onTaskRunNavigate, onDraftSaved, onDraftActivity, onDraftReset, helpEnabled = false }) {
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
  const [semanticContentAction, setSemanticContentAction] = useState("");
  const [semanticContentError, setSemanticContentError] = useState("");
  const [semanticDraftDirty, setSemanticDraftDirty] = useState(false);
  const [semanticDraftSaved, setSemanticDraftSaved] = useState(false);
  const [semanticCoreSelected, setSemanticCoreSelected] = useState([]);
  const [semanticCoreRemoval, setSemanticCoreRemoval] = useState([]);
  const [semanticCoreReports, setSemanticCoreReports] = useState([]);
  const [semanticCoreFinal, setSemanticCoreFinal] = useState(null);
  const [semanticCleared, setSemanticCleared] = useState(false);
  const [semanticFinalStatus, setSemanticFinalStatus] = useState("");
  const [semanticImportStatus, setSemanticImportStatus] = useState("");
  const [semanticImportError, setSemanticImportError] = useState("");
  const [semanticImportPreview, setSemanticImportPreview] = useState(null);
  const [semanticImportFile, setSemanticImportFile] = useState(null);
  const [semanticActiveReportId, setSemanticActiveReportId] = useState("");
  const [semanticSeedQuery, setSemanticSeedQuery] = useState(() => defaultSemanticSeedQuery(card));
  const [semanticSubjectFilter, setSemanticSubjectFilter] = useState("");
  const [semanticSearch, setSemanticSearch] = useState("");
  const [semanticExcludeWords, setSemanticExcludeWords] = useState("");
  const [semanticCollections, setSemanticCollections] = useState([]);
  const [semanticCollectionsStatus, setSemanticCollectionsStatus] = useState("idle");
  const [semanticCollectionActionStatus, setSemanticCollectionActionStatus] = useState("");
  const [semanticCollectionError, setSemanticCollectionError] = useState("");
  const [semanticCollectionSaveOpen, setSemanticCollectionSaveOpen] = useState(false);
  const [semanticCollectionName, setSemanticCollectionName] = useState("");
  const [semanticCollectionArchiveOpen, setSemanticCollectionArchiveOpen] = useState(false);
  const [semanticCollectionSearch, setSemanticCollectionSearch] = useState("");
  const [semanticAppliedCollectionId, setSemanticAppliedCollectionId] = useState("");
  const [semanticEditingCollectionId, setSemanticEditingCollectionId] = useState("");
  const [semanticEditingCollectionName, setSemanticEditingCollectionName] = useState("");
  const [semanticEditingKeywords, setSemanticEditingKeywords] = useState([]);
  const [characteristicSearch, setCharacteristicSearch] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const [draftSaveError, setDraftSaveError] = useState("");
  const [storedDraftLoadedKey, setStoredDraftLoadedKey] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [competitorInput, setCompetitorInput] = useState("");
  const [competitorStatus, setCompetitorStatus] = useState("idle");
  const [auditCompetitorInput, setAuditCompetitorInput] = useState("");
  const [cardDescriptionOpen, setCardDescriptionOpen] = useState(false);
  const [cardCharacteristicsOpen, setCardCharacteristicsOpen] = useState(false);
  const [taskRunActionStatus, setTaskRunActionStatus] = useState("");
  const photoUrl = bestPhotoUrl(card);
  const currentTitle = textOrDash(card?.title);
  const portalName = portalDisplayName(portal);
  const taskRunItems = Array.isArray(taskRun?.items) ? taskRun.items : [];
  const taskRunTotal = taskRunItems.length;
  const taskRunIndex = taskRunTotal ? Math.max(0, Math.min(Number(taskRun.currentIndex || 0), taskRunTotal - 1)) : 0;
  const taskRunCurrent = taskRunItems[taskRunIndex] || null;
  const taskRunPrevious = taskRunIndex > 0 ? taskRunItems[taskRunIndex - 1] : null;
  const taskRunNext = taskRunIndex < taskRunTotal - 1 ? taskRunItems[taskRunIndex + 1] : null;
  const taskRunWorkType = taskRun?.workType || "";
  const taskRunCurrentStatus = taskCardWorkStatus(taskRunCurrent, taskRunWorkType);
  const titleLength = currentTitle.length;
  const cardIssueReasons = cardProblemReasons(card);
  const issueCount = cardIssueReasons.length || Number(card?.issueCount ?? (card?.issue && card.issue !== "Нет критичных" ? 1 : 0));
  const primaryIssue = card?.issue && card.issue !== "Нет критичных" ? card.issue : cardIssueReasons[0];
  const rawFields = rawFieldsForCard(card);
  const cardSourceLabel = cardSourceLabelFromRaw(rawFields, portal);
  const description = card?.description || rawFields.description || "";
  const characteristics = card?.characteristics || rawFields.characteristics || [];
  const characteristicItems = characteristicRows(characteristics);
  const currentCardCharacteristics = currentCardCharacteristicItems(card);
  const currentCardCharacteristicRows = characteristicRows(currentCardCharacteristics);
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
  const auditButtonBusy = auditRunning || mpstatsCharacteristicsStatus === "loading";
  const auditStale = auditStatus === "stale";
  const draftTitleLength = draftTitle.length;
  const draftCardKeys = cardDraftKeyCandidates(card);
  const draftCardKey = draftCardKeys[0] || cardDraftKey(card);
  const draftCardKeySignature = draftCardKeys.join("|");
  const draftStorageKey = `opticards-draft:${portal?.id || "portal"}:${draftCardKey}`;
  const draftStorageKeys = uniqueDraftKeyValues([draftCardKey, ...draftCardKeys])
    .map((key) => `opticards-draft:${portal?.id || "portal"}:${key}`);
  const storedDraftLoadKey = `${portal?.id || "portal"}:${draftCardKeySignature || draftCardKey || card?.nmID || card?.vendorCode || ""}`;
  const storedDraftLoaded = Boolean(storedDraftLoadedKey && storedDraftLoadedKey === storedDraftLoadKey);
  const backendDraftEnabled = Boolean(portal?.id && !portal?.isDemo && portal.id !== "demo-wb");
  const semanticPersistSucceeded = (status) => (
    backendDraftEnabled ? status === "backend" : ["backend", "local"].includes(status)
  );
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
  const canDownloadFinalContent = contentApprovalStatusExportable(normalizeApprovalState(approvalSections.content).status);
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
  const semanticStoredFinal = normalizeSemanticFinalExport(semanticCoreFinal);
  const activeSemanticCore = semanticCoreWithSelection(semanticCore || semanticStoredFinal?.semanticCore, semanticCoreSelected);
  const activeSemanticContentRows = semanticCurrentContentRows(activeSemanticCore);
  const activeSemanticPositionRows = semanticCurrentPositionRows(activeSemanticCore);
  const activeSemanticNewRows = semanticSelectedExportRows(semanticCoreSelected, activeSemanticCore);
  const activeSemanticRemovalRows = semanticRemovalExportRows(semanticCoreRemoval, activeSemanticCore);
  const activeSemanticRemovalKeys = new Set(activeSemanticRemovalRows.map(semanticQueryKey).filter(Boolean));
  const activeSemanticPositionRowsForOptimization = activeSemanticPositionRows.filter((item) => !activeSemanticRemovalKeys.has(semanticQueryKey(item)));
  const activeSemanticContentRowsForCoverage = activeSemanticContentRows.filter((item) => !activeSemanticRemovalKeys.has(semanticQueryKey(item)));
  const activeSemanticRowsForOptimization = semanticRowsByKey([
    ...activeSemanticContentRowsForCoverage,
    ...activeSemanticPositionRowsForOptimization,
  ]);
  const descriptionKeywordRows = descriptionKeywordCandidates([
    { items: activeSemanticNewRows, origin: "selected", label: "к добавлению" },
    { items: activeSemanticContentRowsForCoverage, origin: "content", label: "в карточке" },
    { items: activeSemanticPositionRowsForOptimization, origin: "ranking", label: "ранжируется" },
  ]);
  const activeSemanticReport = semanticCoreReports.find((report) => report.id === semanticActiveReportId) || null;
  const activeSemanticSeedQuery = String(activeSemanticReport?.seedQuery || activeSemanticCore?.seedQuery || "").trim();
  const semanticInputSeedQuery = semanticSeedQuery.trim();
  const semanticSeedQueryChanged = Boolean(
    semanticInputSeedQuery
    && activeSemanticSeedQuery
    && semanticQueryKey(semanticInputSeedQuery) !== semanticQueryKey(activeSemanticSeedQuery),
  );
  const semanticSeedForActiveCore = semanticSeedQueryChanged
    ? activeSemanticSeedQuery
    : semanticInputSeedQuery || activeSemanticSeedQuery;
  const hasSemanticExpansion = Boolean(activeSemanticCore?.source === "mpstats-expanding" || activeSemanticCore?.seedQuery);
  const shouldRefreshSemanticExpansion = Boolean(hasSemanticExpansion && !semanticSeedQueryChanged);
  const shouldConfirmSemanticCollectMore = Boolean(hasSemanticExpansion && !semanticSeedQueryChanged);
  const semanticRunButtonLabel = semanticCoreStatus === "loading"
    ? "Подбираем запросы"
    : semanticCoreStatus === "pending"
      ? "Повторить подбор"
      : semanticSeedQueryChanged
        ? "Подобрать по новому запросу"
        : hasSemanticExpansion
          ? "Собрать еще"
          : "Подобрать запросы";
  const semanticAppliedCollection = semanticCollections.find((collection) => String(collection.id) === String(semanticAppliedCollectionId)) || null;
  const semanticCollectionBusy = ["saving", "updating", "deleting", "loading"].includes(semanticCollectionActionStatus);
  const canSaveSemanticCollection = Boolean(backendDraftEnabled && activeSemanticNewRows.length && !semanticCollectionBusy);
  const canAppendSemanticCollection = Boolean(backendDraftEnabled && semanticAppliedCollection && activeSemanticNewRows.length && !semanticCollectionBusy);
  const semanticExcludeWordCount = semanticFilterWords(semanticExcludeWords).length;
  const semanticCollectionSearchText = semanticCollectionSearch.trim().toLowerCase();
  const filteredSemanticCollections = semanticCollections.filter((collection) => {
    if (!semanticCollectionSearchText) return true;
    const keywordText = (Array.isArray(collection.keywords) ? collection.keywords : [])
      .map((item) => item?.query || "")
      .join(" ");
    return `${collection.name || ""} ${keywordText}`.toLowerCase().includes(semanticCollectionSearchText);
  });
  const autoSemanticCandidateRows = semanticAutoSelectCandidateRows();
  const canAutoSelectSemantic = Boolean(autoSemanticCandidateRows.length && semanticSaveStatus !== "saving" && !approvalReadOnly);
  const autoSemanticTitle = activeSemanticCore
    ? autoSemanticCandidateRows.length
      ? `Автоматически добавить ${formatNumber(autoSemanticCandidateRows.length)} ${pluralRu(autoSemanticCandidateRows.length, "подходящий запрос", "подходящих запроса", "подходящих запросов")} в работу.`
      : "Сначала подберите запросы через MPStats: кнопка станет активной, когда появятся новые запросы с частотностью без дублей."
    : "Сначала нажмите Подобрать запросы: система соберет новые запросы MPStats.";
  const currentSemanticFinalExport = semanticFinalExportFromCore(activeSemanticCore, semanticCoreSelected, {
    reportId: semanticActiveReportId,
    seedQuery: semanticSeedForActiveCore,
    subjectFilter: semanticSubjectFilter,
    removalRows: semanticCoreRemoval,
    createdBy: currentUser?.login || "",
    updatedBy: currentUser?.login || "",
  });
  const semanticCurrentFinalSignature = semanticFinalExportSignature(currentSemanticFinalExport);
  const semanticStoredFinalSignature = semanticFinalExportSignature(semanticStoredFinal);
  const semanticFinalHasRows = Boolean(activeSemanticContentRows.length || activeSemanticPositionRows.length || activeSemanticNewRows.length || activeSemanticRemovalRows.length);
  const semanticFinalMatchesCurrent = Boolean(semanticStoredFinalSignature && semanticCurrentFinalSignature && semanticStoredFinalSignature === semanticCurrentFinalSignature);
  const semanticFinalConflict = Boolean(semanticStoredFinalSignature && semanticCurrentFinalSignature && !semanticFinalMatchesCurrent);
  const semanticCurrentChoiceSaved = Boolean(semanticDraftSaved && !semanticDraftDirty && semanticSaveStatus !== "error");
  const semanticSaveCurrentDisabled = approvalReadOnly || !semanticDraftDirty || semanticSaveStatus === "saving";
  const semanticSaveCurrentTitle = approvalReadOnly
    ? "Раздел находится на согласовании: менять текущий выбор нельзя."
    : semanticDraftDirty
      ? "Сохранить текущий подбор, выбранные ключи и источники MPStats в карточке без добавления в итоговую выгрузку."
      : semanticCurrentChoiceSaved
        ? "Текущий выбор уже сохранен в карточке."
        : "Сначала подберите запросы или измените выбор ключей.";
  const semanticStoredFinalLabel = semanticStoredFinal
    ? [
      semanticStoredFinal.seedQuery || "без стартового запроса",
      semanticStoredFinal.createdAt ? new Date(semanticStoredFinal.createdAt).toLocaleString("ru-RU") : "",
    ].filter(Boolean).join(" · ")
    : "";
  const semanticFinalBanner = (() => {
    if (semanticFinalStatus === "saving") {
      return {
        tone: "saving",
        title: "Добавляем в итоговое СЯ",
        copy: "Сохраняем выбранную версию карточки для кабинетной выгрузки.",
      };
    }
    if (semanticFinalStatus === "error") {
      return {
        tone: "error",
        title: "Итоговое СЯ не сохранилось",
        copy: "Повторите добавление или замену еще раз.",
      };
    }
    if (semanticFinalStatus === "missing") {
      return {
        tone: "error",
        title: "Нечего добавить в итоговое СЯ",
        copy: "Сначала загрузите позиции или подберите запросы MPStats для этой карточки.",
      };
    }
    if (semanticFinalStatus === "conflict" || semanticFinalConflict) {
      return {
        tone: "saving",
        title: "По карточке уже есть итоговое СЯ",
        copy: `В кабинетной выгрузке может быть только одна версия по карточке. Сейчас выбрана старая версия: ${semanticStoredFinalLabel || "без даты"}. Чтобы добавить текущую, замените старую выгрузку новой.`,
        action: "replace",
      };
    }
    if (semanticFinalMatchesCurrent) {
      return {
        tone: "",
        title: semanticFinalStatus === "replaced" ? "Итоговое СЯ заменено" : semanticFinalStatus === "saved" ? "Итоговое СЯ добавлено" : "Эта версия уже в итоговом СЯ",
        copy: "Именно она попадет в кнопку Скачать итоговое СЯ по кабинету.",
      };
    }
    if (semanticStoredFinal) {
      return {
        tone: "",
        title: "В итоговом СЯ сохранена версия карточки",
        copy: `В кабинетную выгрузку попадет версия: ${semanticStoredFinalLabel || "без даты"}. Откройте ее в источниках MPStats или замените текущей подборкой.`,
      };
    }
    return null;
  })();
  const semanticFinalAddDisabled = !semanticCurrentChoiceSaved || !currentSemanticFinalExport || !semanticFinalHasRows || semanticFinalStatus === "saving" || semanticFinalMatchesCurrent || semanticFinalConflict;
  const semanticFinalAddTitle = !semanticCurrentChoiceSaved
    ? "Сначала нажмите Сохранить текущий выбор."
    : semanticFinalMatchesCurrent
    ? "Текущая версия уже добавлена в итоговое СЯ кабинета."
    : semanticFinalConflict
      ? "По карточке уже есть другая итоговая версия. Используйте замену в предупреждении ниже."
      : "Добавить текущую версию СЯ этой карточки в кабинетную выгрузку.";
  const activeSemanticRankingPeriodLabel = semanticPeriodLabel(activeSemanticCore?.rankingPeriod || activeSemanticCore?.period);
  const activeSemanticExpansionPeriodLabel = semanticPeriodLabel(activeSemanticCore?.period);
  const semanticContentRunning = semanticContentStatus === "loading";
  const semanticContentBusyAction = semanticContentRunning ? semanticContentAction : "";
  const semanticContentActionText = {
    title: "заголовок",
    description: "описание",
    characteristics: "характеристики",
    all: "заголовок, описание и характеристики",
  }[semanticContentAction || "all"];
  const semanticHasOptimizationKeywords = Boolean(activeSemanticNewRows.length || activeSemanticRowsForOptimization.length || activeSemanticRemovalRows.length);
  const canReoptimizeContent = Boolean(semanticHasOptimizationKeywords && semanticCurrentChoiceSaved && !approvalReadOnly && !semanticContentRunning);
  const semanticReoptimizeUnavailableTitle = approvalReadOnly
    ? "Раздел находится на согласовании: подготовка новых вариантов недоступна."
    : !semanticHasOptimizationKeywords
      ? "Сначала соберите или загрузите СЯ для карточки."
      : !semanticCurrentChoiceSaved
        ? "Сначала нажмите Сохранить текущий выбор."
        : "";
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
  const taskRunActionBusy = taskRunActionStatus === "saving";
  const taskRunCompleteLabel = taskRunActionBusy ? "Сохраняем" : taskRunNext ? "Готово, следующая" : "Готово";
  const taskRunActionMessage = {
    done: "Карточка закрыта, открываем следующую.",
    "done-last": "Карточка закрыта. Это последняя карточка в текущем проходе.",
    skipped: "Карточка пропущена в текущем проходе.",
    deferred: "Карточка перенесена в конец текущего прохода.",
    "semantic-missing": "Сначала сохраните текущий выбор и добавьте его в итоговое СЯ.",
    "semantic-conflict": "По карточке уже есть другая итоговая версия СЯ. Замените ее вручную, если это нужная версия.",
    "missing-changes": "В этом блоке нет правок для отправки на согласование.",
    "approval-blocked": "Этот блок сейчас нельзя отправить: проверьте роль или текущий статус согласования.",
    error: "Действие не сохранилось. Проверьте сообщение ниже и попробуйте еще раз.",
  }[taskRunActionStatus] || "";
  const auditStatusText = auditRunning ? "Идет аудит" : auditDone ? "Рыночный аудит готов" : auditStale ? "Рыночный аудит устарел" : "Рыночный аудит не запускался";
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
        title: "Запустите рыночный аудит заново",
        copy: "Данные WB обновились, поэтому прежняя аналитика устарела. Черновик сохранен, но рекомендации лучше пересчитать.",
        action: "Запустить заново",
      }
      : {
          title: "Запустите рыночный аудит",
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
    setSemanticDraftDirty(false);
    setSemanticDraftSaved(false);
    setSemanticRankStatus("idle");
    setSemanticCollectionActionStatus("");
    setSemanticCollectionError("");
    setSemanticCollectionSaveOpen(false);
    setSemanticCollectionName("");
    setSemanticCollectionArchiveOpen(false);
    setSemanticAppliedCollectionId("");
    setSemanticEditingCollectionId("");
    setSemanticEditingCollectionName("");
    setSemanticEditingKeywords([]);
    setSemanticImportStatus("");
    setSemanticImportError("");
    setSemanticImportPreview(null);
    setSemanticImportFile(null);
    setCardDescriptionOpen(false);
    setCardCharacteristicsOpen(false);
    setTaskRunActionStatus("");
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
    setSemanticDraftDirty(false);
    setSemanticDraftSaved(false);
    setSemanticCoreSelected([]);
    setSemanticCoreRemoval([]);
    setSemanticCoreReports([]);
    setSemanticCoreFinal(null);
    setSemanticCleared(false);
    setSemanticFinalStatus("");
    setSemanticActiveReportId("");
    setSemanticCollections([]);
    setSemanticCollectionsStatus("idle");
    setSemanticCollectionActionStatus("");
    setSemanticCollectionError("");
    setSemanticCollectionSaveOpen(false);
    setSemanticCollectionName("");
    setSemanticCollectionArchiveOpen(false);
    setSemanticCollectionSearch("");
    setSemanticAppliedCollectionId("");
    setSemanticEditingCollectionId("");
    setSemanticEditingCollectionName("");
    setSemanticEditingKeywords([]);
    setCharacteristicSearch("");
    setDraftSavedAt("");
    setDraftSaveStatus("");
    setStoredDraftLoadedKey("");
    setAuditCompetitorInput("");
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
      setSemanticCoreRemoval(normalized.semanticCoreRemoval);
      setSemanticCoreReports(normalized.semanticCoreReports);
      setSemanticCoreFinal(normalized.semanticCoreFinal);
      setSemanticCleared(false);
      setSemanticDraftDirty(false);
      setSemanticDraftSaved(Boolean(normalized.semanticCoreReports.length || normalized.semanticCoreSelected.length || normalized.semanticCoreRemoval.length || normalized.semanticCoreFinal));
      setSemanticFinalStatus("");
      if (normalized.semanticCoreReports.length) {
        const latestReport = semanticPreferredReport(normalized.semanticCoreReports);
        setSemanticActiveReportId(latestReport.id);
        setSemanticCore(latestReport.semanticCore);
        setSemanticSeedQuery(latestReport.seedQuery || defaultSemanticSeedQuery(card));
        setSemanticSubjectFilter("");
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
    const markStoredDraftLoaded = () => {
      if (active) {
        setStoredDraftLoadedKey(storedDraftLoadKey);
      }
    };
    let localDraftApplied = false;
    for (const storageKey of draftStorageKeys) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (!saved) {
          continue;
        }
        applyDraft(saved);
        localDraftApplied = true;
        if (storageKey !== draftStorageKey) {
          try {
            localStorage.setItem(draftStorageKey, JSON.stringify(saved));
          } catch {
            // The original local copy is still usable.
          }
        }
        break;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    if (!localDraftApplied) {
      setDraftCharacteristics(characteristicDraftsFromRows(characteristicItems, "manual"));
    }
    if (backendDraftEnabled && draftCardKey) {
      (async () => {
        for (const candidateKey of uniqueDraftKeyValues([draftCardKey, ...draftCardKeys])) {
          const payload = await apiRequest(`/api/card-drafts?portal_id=${encodeURIComponent(portal.id)}&card_key=${encodeURIComponent(candidateKey)}`);
          if (!active) return;
          if (!payload.draft) {
            continue;
          }
          applyDraft(payload.draft);
          try {
            localStorage.setItem(draftStorageKey, JSON.stringify(payload.draft));
          } catch {
            // Backend remains the source of truth; local cache sync is best effort.
          }
          setDraftSaveStatus("backend");
          markStoredDraftLoaded();
          return;
        }
        markStoredDraftLoaded();
      })().catch(() => {
        if (active) {
          setDraftSaveStatus("local-fallback");
          markStoredDraftLoaded();
        }
      });
    } else {
      markStoredDraftLoaded();
    }
    return () => {
      active = false;
    };
  }, [draftStorageKey, draftCardKey, draftCardKeySignature, storedDraftLoadKey, backendDraftEnabled, portal?.id, card?.nmID, card?.vendorCode]);

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
          seedQuery: semanticSeedForActiveCore || report.seedQuery,
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

  async function loadSemanticCurrentPositions({ forceRefresh = false } = {}) {
    if (!portal?.id || !card?.nmID) {
      setSemanticRankStatus("idle");
      return null;
    }
    setSemanticRankStatus("loading");
    setSemanticCoreError("");
    try {
      const payload = await apiRequest("/api/mpstats/keywords", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          card,
          refresh: forceRefresh,
        }),
      });
      const rankingCore = semanticCoreFromRankingPayload(payload);
      const nextCore = semanticCore
        ? semanticMergeKeywordRankings(semanticCore, payload)
        : rankingCore;
      setSemanticCore(nextCore);
      setSemanticRankStatus(semanticCurrentPositionRows(nextCore).length ? "loaded" : "empty");
      setSemanticCoreStatus((status) => (status === "idle" ? (payload.cached ? "cached" : "loaded") : status));
      return nextCore;
    } catch {
      setSemanticRankStatus("error");
      setSemanticCoreStatus((status) => (status === "idle" ? "unavailable" : status));
      return null;
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

  useEffect(() => {
    if (activeTab !== "semantic" || !storedDraftLoaded || semanticCore || semanticStoredFinal || semanticRankStatus !== "idle" || !portal?.id || !card?.nmID) {
      return;
    }
    loadSemanticCurrentPositions({ forceRefresh: false });
  }, [activeTab, storedDraftLoaded, semanticCore, semanticStoredFinal, semanticRankStatus, portal?.id, card?.nmID]);

  useEffect(() => {
    if (!semanticDraftDirty) {
      return undefined;
    }
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [semanticDraftDirty]);

  function confirmLeaveUnsavedSemantic() {
    if (!semanticDraftDirty) {
      return true;
    }
    return window.confirm("Текущий выбор СЯ не сохранен в карточке. Уйти без сохранения?");
  }

  function switchDetailTab(nextTab) {
    if (nextTab === activeTab) {
      return;
    }
    if (activeTab === "semantic" && nextTab !== "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    setActiveTab(nextTab);
  }

  function handleBackToCards() {
    if (activeTab === "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    onBack();
  }

  function navigateTaskRunCard(delta) {
    if (activeTab === "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    onTaskRunNavigate?.(delta);
  }

  function logTaskRunEvent(action, reason = "") {
    if (!backendDraftEnabled || !taskRunTotal) return;
    apiRequest("/api/card-workset/log-event", {
      method: "POST",
      body: JSON.stringify({
        portalId: portal.id,
        cardKey: taskRunCurrent?.cardKey || draftCardKey,
        nmID: taskRunCurrent?.nmID || cardNmIdValue(card),
        vendorCode: taskRunCurrent?.vendorCode || cardVendorCodeValue(card),
        batchId: taskRun?.batchId || "",
        workType: taskRunWorkType,
        action,
        reason,
      }),
    }).catch(() => {});
  }

  async function completeTaskRunWork(reason = "") {
    if (!backendDraftEnabled || !taskRunTotal || !taskRunWorkType) {
      logTaskRunEvent("quick_completed", reason);
      return true;
    }
    const payload = await apiRequest("/api/card-workset/complete-task", {
      method: "POST",
      body: JSON.stringify({
        portalId: portal.id,
        cardKey: taskRunCurrent?.cardKey || draftCardKey,
        nmID: taskRunCurrent?.nmID || cardNmIdValue(card),
        vendorCode: taskRunCurrent?.vendorCode || cardVendorCodeValue(card),
        batchId: taskRun?.batchId || "",
        workType: taskRunWorkType,
        reason,
      }),
    });
    if (payload?.workflow || Array.isArray(payload?.workPeriods)) {
      await onDraftSaved?.();
    }
    return true;
  }

  function moveTaskRunForward(status = "") {
    if (taskRunNext) {
      if (status) {
        setTaskRunActionStatus(status);
      }
      onTaskRunNavigate?.(1);
      return true;
    }
    if (status) {
      setTaskRunActionStatus("done-last");
    }
    return false;
  }

  async function completeTaskRunCardAndNext() {
    if (!taskRunTotal || taskRunActionStatus === "saving") {
      return;
    }
    if (activeTab === "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    setTaskRunActionStatus("saving");
    try {
      if (taskRunWorkType === "semantic") {
        setActiveTab("semantic");
        if (semanticFinalMatchesCurrent || semanticStoredFinal) {
          await completeTaskRunWork();
          moveTaskRunForward("done");
          return;
        }
        if (semanticFinalConflict) {
          setTaskRunActionStatus("semantic-conflict");
          return;
        }
        if (!semanticCurrentChoiceSaved || !currentSemanticFinalExport || !semanticFinalHasRows) {
          setTaskRunActionStatus("semantic-missing");
          return;
        }
        const saved = await addSemanticCoreToFinal();
        if (!saved) {
          setTaskRunActionStatus("semantic-missing");
          return;
        }
        await completeTaskRunWork();
        moveTaskRunForward("done");
        return;
      }
      if (APPROVAL_SECTION_KEYS.includes(taskRunWorkType)) {
        const section = changesReadinessSections.find((item) => item.key === taskRunWorkType);
        setActiveTab("changes");
        setChangesTab(taskRunWorkType);
        if (!section) {
          setTaskRunActionStatus("error");
          return;
        }
        if (["submitted", "approved", "exported"].includes(section.approval.status)) {
          await completeTaskRunWork();
          moveTaskRunForward("done");
          return;
        }
        if (!section.changesCount) {
          await completeTaskRunWork("без правок для согласования");
          moveTaskRunForward("done");
          return;
        }
        if (!canSubmitApprovalSection(taskRunWorkType)) {
          setTaskRunActionStatus("approval-blocked");
          return;
        }
        const saved = await submitForApproval(taskRunWorkType);
        if (!saved) {
          setTaskRunActionStatus("error");
          return;
        }
        await completeTaskRunWork();
        moveTaskRunForward("done");
        return;
      }
      await saveDraft();
      await completeTaskRunWork();
      moveTaskRunForward("done");
    } catch {
      setTaskRunActionStatus("error");
    }
  }

  function skipTaskRunCard() {
    if (!taskRunNext || taskRunActionStatus === "saving") {
      return;
    }
    if (activeTab === "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    setTaskRunActionStatus("skipped");
    logTaskRunEvent("skipped");
    onTaskRunNavigate?.(1);
  }

  function deferTaskRunCard() {
    if (taskRunTotal < 2 || taskRunActionStatus === "saving") {
      return;
    }
    if (activeTab === "semantic" && !confirmLeaveUnsavedSemantic()) {
      return;
    }
    setTaskRunActionStatus("deferred");
    logTaskRunEvent("deferred");
    onTaskRunNavigate?.({ type: "defer-current" });
  }

  function handleSemanticSeedKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (semanticCoreStatus === "loading" || !semanticSeedQuery.trim()) {
      return;
    }
    handleRunSemanticCore();
  }

  async function loadSemanticCore({ forceRefresh = false, query = semanticSeedQuery } = {}) {
    const requestedSeedQuery = String(query || "").trim();
    if (!portal?.id || !card?.nmID || !requestedSeedQuery) {
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
          query: requestedSeedQuery,
          refresh: forceRefresh,
        }),
      });
      const nextSemanticCore = await enrichSemanticCoreWithRanks(payload.semanticCore || null, { forceRefresh });
      setSemanticCore(nextSemanticCore);
      setSemanticCleared(false);
      const nextSubjectFilter = "";
      setSemanticSubjectFilter(nextSubjectFilter);
      const requestedSeedKey = semanticQueryKey(requestedSeedQuery);
      const existingReportForSeed = semanticCoreReports.find((report) => (
        requestedSeedKey && semanticQueryKey(report.seedQuery) === requestedSeedKey
      ));
      const nextReport = semanticReportFromCore(nextSemanticCore, semanticCoreSelected, {
        id: existingReportForSeed?.id,
        seedQuery: requestedSeedQuery,
        subjectFilter: nextSubjectFilter,
      });
      if (nextReport) {
        const nextReports = normalizeSemanticReports([nextReport, ...semanticCoreReports.filter((report) => report.id !== nextReport.id)]);
        setSemanticCoreReports(nextReports);
        setSemanticActiveReportId(nextReport.id);
        setSemanticDraftDirty(true);
        setSemanticDraftSaved(false);
        setSemanticSaveStatus("unsaved");
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

  function handleRunSemanticCore() {
    if (shouldConfirmSemanticCollectMore) {
      const seed = semanticSeedQuery.trim() || activeSemanticSeedQuery || "текущему запросу";
      const confirmed = window.confirm(
        `Собрать еще запросы по запросу "${seed}"? Система запросит MPStats заново и обновит текущую подборку. Выбранные вручную ключи останутся в работе, но список рекомендаций может измениться.`,
      );
      if (!confirmed) {
        return;
      }
    }
    loadSemanticCore({ forceRefresh: shouldRefreshSemanticExpansion });
  }

  function stageSemanticSelection(nextSelection) {
    const normalizedSelection = normalizeSemanticSelection(nextSelection);
    let reportSource = semanticCoreReports;
    let fallbackReport = null;
    const shouldCreateFallbackReport = activeSemanticCore
      && !semanticCleared
      && (!reportSource.length || !reportSource.some((report) => semanticReportCandidateCount(report)));
    if (shouldCreateFallbackReport) {
      fallbackReport = semanticReportFromCore(activeSemanticCore, normalizedSelection, {
        seedQuery: semanticSeedForActiveCore,
        subjectFilter: semanticSubjectFilter,
      });
      reportSource = fallbackReport ? [fallbackReport, ...reportSource] : reportSource;
    }
    const nextReports = semanticReportsWithSelection(reportSource, normalizedSelection);
    setSemanticCoreSelected(normalizedSelection);
    setSemanticCoreReports(nextReports);
    setSemanticCleared(false);
    if (!semanticActiveReportId && fallbackReport?.id) {
      setSemanticActiveReportId(fallbackReport.id);
    }
    setSemanticDraftDirty(true);
    setSemanticDraftSaved(false);
    setSemanticSaveStatus("unsaved");
  }

  function stageSemanticRemoval(nextRemoval) {
    const normalizedRemoval = normalizeSemanticRemoval(nextRemoval);
    setSemanticCoreRemoval(normalizedRemoval);
    setSemanticCleared(false);
    setSemanticDraftDirty(true);
    setSemanticDraftSaved(false);
    setSemanticSaveStatus("unsaved");
    setSemanticFinalStatus("");
  }

  async function saveSemanticCurrentSelection() {
    const normalizedSelection = normalizeSemanticSelection(semanticCoreSelected);
    const normalizedRemoval = normalizeSemanticRemoval(semanticCoreRemoval);
    let reportSource = semanticCoreReports;
    let fallbackReport = null;
    const shouldCreateFallbackReport = activeSemanticCore
      && !semanticCleared
      && (!reportSource.length || !reportSource.some((report) => semanticReportCandidateCount(report)));
    if (shouldCreateFallbackReport) {
      fallbackReport = semanticReportFromCore(activeSemanticCore, normalizedSelection, {
        seedQuery: semanticSeedForActiveCore,
        subjectFilter: semanticSubjectFilter,
      });
      reportSource = fallbackReport ? [fallbackReport, ...reportSource] : reportSource;
    }
    const nextReports = semanticReportsWithSelection(reportSource, normalizedSelection);
    const nextFinal = !nextReports.length && !normalizedSelection.length && !normalizedRemoval.length ? null : semanticCoreFinal;
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
      semanticCoreRemoval: normalizedRemoval,
      semanticCoreReports: nextReports,
      semanticCoreFinal: nextFinal,
      card,
    });
    setSemanticCoreSelected(normalizedSelection);
    setSemanticCoreRemoval(normalizedRemoval);
    setSemanticCoreReports(nextReports);
    setSemanticCoreFinal(nextFinal);
    if (!semanticActiveReportId && fallbackReport?.id) {
      setSemanticActiveReportId(fallbackReport.id);
    }
    setSemanticSaveStatus("saving");
    try {
      const persistStatus = await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
      if (!semanticPersistSucceeded(persistStatus)) {
        throw new Error("semantic_save_failed");
      }
      setSemanticDraftDirty(false);
      setSemanticDraftSaved(Boolean(nextReports.length || normalizedSelection.length || normalizedRemoval.length || nextFinal));
      setSemanticCleared(!nextReports.length && !normalizedSelection.length && !normalizedRemoval.length && !nextFinal);
      setSemanticSaveStatus("saved");
    } catch {
      setSemanticDraftDirty(true);
      setSemanticSaveStatus("error");
    }
  }

  function upsertSemanticCollection(collection) {
    if (!collection?.id) return;
    setSemanticCollections((current) => {
      const next = [collection, ...current.filter((item) => String(item.id) !== String(collection.id))];
      return next.sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    });
  }

  async function loadSemanticCollections() {
    if (!backendDraftEnabled || !portal?.id) {
      setSemanticCollectionsStatus("unavailable");
      return [];
    }
    setSemanticCollectionsStatus("loading");
    setSemanticCollectionError("");
    try {
      const payload = await apiRequest(`/api/semantic-core-collections?portal_id=${encodeURIComponent(portal.id)}`);
      const collections = Array.isArray(payload.collections) ? payload.collections : [];
      setSemanticCollections(collections);
      setSemanticCollectionsStatus(collections.length ? "loaded" : "empty");
      return collections;
    } catch {
      setSemanticCollectionsStatus("error");
      setSemanticCollectionError("Архив подборок не загрузился.");
      return [];
    }
  }

  function toggleSemanticCollectionArchive() {
    const nextOpen = !semanticCollectionArchiveOpen;
    setSemanticCollectionArchiveOpen(nextOpen);
    setSemanticCollectionError("");
    if (nextOpen && ["idle", "error"].includes(semanticCollectionsStatus)) {
      loadSemanticCollections();
    }
  }

  async function saveSemanticCollection() {
    const name = semanticCollectionName.trim();
    if (!name) {
      setSemanticCollectionError("Введите название подборки.");
      return;
    }
    if (!activeSemanticNewRows.length) {
      setSemanticCollectionError("В текущем СЯ нет выбранных ключей к добавлению.");
      return;
    }
    setSemanticCollectionActionStatus("saving");
    setSemanticCollectionError("");
    try {
      const payload = await apiRequest("/api/semantic-core-collections", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          name,
          keywords: activeSemanticNewRows,
          meta: {
            seedQuery: semanticSeedForActiveCore,
            sourceCard: {
              cardKey: draftCardKey,
              nmID: cardNmIdValue(card),
              vendorCode: cardVendorCodeValue(card),
              title: card?.title || "",
              subjectName: card?.subjectName || "",
            },
          },
        }),
      });
      if (payload.collection) {
        upsertSemanticCollection(payload.collection);
        setSemanticAppliedCollectionId(payload.collection.id);
      }
      setSemanticCollectionSaveOpen(false);
      setSemanticCollectionName("");
      setSemanticCollectionActionStatus("saved");
    } catch (error) {
      setSemanticCollectionActionStatus("error");
      setSemanticCollectionError(error.message === "semantic_collection_name_exists"
        ? "Подборка с таким названием уже есть."
        : "Подборка не сохранилась.");
    }
  }

  function applySemanticCollection(collection) {
    const collectionKeywords = normalizeSemanticSelection(collection?.keywords);
    if (!collectionKeywords.length) {
      setSemanticCollectionError("В этой подборке нет ключей.");
      return;
    }
    const existingKeys = semanticExistingQueryKeys(activeSemanticCore);
    const selectedKeys = new Set(semanticCoreSelected.map(semanticQueryKey));
    const additions = collectionKeywords.filter((item) => {
      const key = semanticQueryKey(item);
      return key && !existingKeys.has(key) && !selectedKeys.has(key) && semanticFrequencyValue(item);
    });
    if (!additions.length) {
      setSemanticCollectionError("Все ключи этой подборки уже есть в карточке, ранжировании или выбранных.");
      setSemanticAppliedCollectionId(collection.id);
      return;
    }
    stageSemanticSelection([...semanticCoreSelected, ...additions]);
    setSemanticAppliedCollectionId(collection.id);
    setSemanticCollectionActionStatus("applied");
    setSemanticCollectionError("");
  }

  async function appendCurrentSelectionToSemanticCollection() {
    if (!semanticAppliedCollection) {
      setSemanticCollectionError("Сначала примените или сохраните подборку.");
      return;
    }
    if (!activeSemanticNewRows.length) {
      setSemanticCollectionError("В текущей карточке нет ключей к добавлению.");
      return;
    }
    setSemanticCollectionActionStatus("updating");
    setSemanticCollectionError("");
    try {
      const payload = await apiRequest("/api/semantic-core-collections", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          collectionId: semanticAppliedCollection.id,
          name: semanticAppliedCollection.name,
          keywords: activeSemanticNewRows,
          mode: "append",
          meta: {
            lastAppendCard: {
              cardKey: draftCardKey,
              nmID: cardNmIdValue(card),
              vendorCode: cardVendorCodeValue(card),
              title: card?.title || "",
            },
          },
        }),
      });
      if (payload.collection) {
        upsertSemanticCollection(payload.collection);
      }
      setSemanticCollectionActionStatus("updated");
    } catch {
      setSemanticCollectionActionStatus("error");
      setSemanticCollectionError("Подборка не пополнилась.");
    }
  }

  function openSemanticCollectionEditor(collection) {
    setSemanticEditingCollectionId(collection.id);
    setSemanticEditingCollectionName(collection.name || "");
    setSemanticEditingKeywords(normalizeSemanticSelection(collection.keywords));
    setSemanticCollectionError("");
  }

  function removeSemanticEditingKeyword(item) {
    const key = semanticQueryKey(item);
    if (!key) return;
    setSemanticEditingKeywords((current) => current.filter((keyword) => semanticQueryKey(keyword) !== key));
  }

  async function saveSemanticCollectionEdits() {
    const collection = semanticCollections.find((item) => String(item.id) === String(semanticEditingCollectionId));
    const name = semanticEditingCollectionName.trim();
    if (!collection || !name) {
      setSemanticCollectionError("Введите название подборки.");
      return;
    }
    setSemanticCollectionActionStatus("updating");
    setSemanticCollectionError("");
    try {
      const payload = await apiRequest("/api/semantic-core-collections", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          collectionId: collection.id,
          name,
          keywords: semanticEditingKeywords,
          mode: "replace",
        }),
      });
      if (payload.collection) {
        upsertSemanticCollection(payload.collection);
      }
      setSemanticEditingCollectionId("");
      setSemanticEditingCollectionName("");
      setSemanticEditingKeywords([]);
      setSemanticCollectionActionStatus("updated");
    } catch (error) {
      setSemanticCollectionActionStatus("error");
      setSemanticCollectionError(error.message === "semantic_collection_name_exists"
        ? "Подборка с таким названием уже есть."
        : "Изменения подборки не сохранились.");
    }
  }

  async function deleteSemanticCollection(collection) {
    if (!collection?.id) return;
    const confirmed = window.confirm(`Удалить подборку "${collection.name}" из архива?`);
    if (!confirmed) return;
    setSemanticCollectionActionStatus("deleting");
    setSemanticCollectionError("");
    try {
      await apiRequest(`/api/semantic-core-collections?portal_id=${encodeURIComponent(portal.id)}&collection_id=${encodeURIComponent(collection.id)}`, {
        method: "DELETE",
      });
      setSemanticCollections((current) => current.filter((item) => String(item.id) !== String(collection.id)));
      if (String(semanticAppliedCollectionId) === String(collection.id)) {
        setSemanticAppliedCollectionId("");
      }
      if (String(semanticEditingCollectionId) === String(collection.id)) {
        setSemanticEditingCollectionId("");
        setSemanticEditingCollectionName("");
        setSemanticEditingKeywords([]);
      }
      setSemanticCollectionActionStatus("deleted");
    } catch {
      setSemanticCollectionActionStatus("error");
      setSemanticCollectionError("Подборка не удалилась.");
    }
  }

  function takeSemanticKeyword(item) {
    if (approvalReadOnly) return;
    const key = semanticQueryKey(item);
    if (!key || semanticCoreSelected.some((selected) => semanticQueryKey(selected) === key)) {
      return;
    }
    if (semanticExistingQueryKeys(activeSemanticCore).has(key)) {
      setSemanticCoreError("Этот запрос уже есть в контенте или среди ранжирующихся запросов карточки и не попадет в добавление.");
      return;
    }
    if (!semanticFrequencyValue(item)) {
      setSemanticCoreError("У запроса нет частотности WB в MPStats, поэтому он не попадет в итоговую выгрузку.");
      return;
    }
    setSemanticCoreError("");
    stageSemanticSelection([...semanticCoreSelected, item]);
  }

  function semanticAutoSelectCandidateRows() {
    if (!activeSemanticCore) {
      return [];
    }
    const existingKeys = semanticExistingQueryKeys(activeSemanticCore);
    const selectedKeys = new Set(semanticCoreSelected.map(semanticQueryKey));
    const searchText = semanticSearch.trim().toLowerCase();
    const excludedWords = semanticFilterWords(semanticExcludeWords);
    return semanticCandidateSourceRows(activeSemanticCore)
      .filter((item) => !semanticSubjectFilter || item.prioritySubject === semanticSubjectFilter)
      .filter((item) => !semanticMatchesExclusion(item.query, excludedWords))
      .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText))
      .filter((item) => {
        const key = semanticQueryKey(item);
        return key && !existingKeys.has(key) && !selectedKeys.has(key) && semanticFrequencyValue(item);
      })
      .sort((left, right) => Number(semanticFrequencyValue(right) || 0) - Number(semanticFrequencyValue(left) || 0));
  }

  function autoSelectSemanticKeywords() {
    if (!activeSemanticCore) {
      setSemanticCoreError("Сначала соберите подборку MPStats по стартовому запросу.");
      return;
    }
    const candidates = semanticAutoSelectCandidateRows();
    const chosen = [];
    const chosenKeys = new Set();
    const addGroup = (items, limit) => {
      items.forEach((item) => {
        const key = semanticQueryKey(item);
        if (!key || chosenKeys.has(key) || chosen.length >= semanticAutoAddTotalLimit) return;
        if (chosen.filter((row) => items.includes(row)).length >= limit) return;
        chosenKeys.add(key);
        chosen.push(item);
      });
    };
    const high = candidates.filter((item) => semanticFrequencyBucket(item) === "high");
    const medium = candidates.filter((item) => semanticFrequencyBucket(item) === "medium");
    const narrow = candidates.filter((item) => semanticFrequencyBucket(item) === "low");
    addGroup(high, semanticAutoAddBucketLimit);
    addGroup(medium, semanticAutoAddBucketLimit);
    addGroup(narrow, semanticAutoAddBucketLimit);
    candidates.forEach((item) => {
      const key = semanticQueryKey(item);
      if (chosen.length >= semanticAutoAddTotalLimit || !key || chosenKeys.has(key)) return;
      chosenKeys.add(key);
      chosen.push(item);
    });
    if (!chosen.length) {
      setSemanticCoreError("В текущей подборке нет новых запросов с частотностью для автодобавления.");
      return;
    }
    setSemanticCoreError(`Автоматически добавлено ${chosen.length} запросов: высоко-, средне- и низкочастотные без дублей.`);
    stageSemanticSelection([...semanticCoreSelected, ...chosen]);
  }

  function handleAutoSelectSemanticKeywords() {
    const count = autoSemanticCandidateRows.length;
    const confirmed = window.confirm(
      `Автодобавить ${formatNumber(count)} ${pluralRu(count, "запрос", "запроса", "запросов")} в работу? После автодобавления проверьте список и нажмите "Сохранить текущий выбор".`,
    );
    if (!confirmed) {
      return;
    }
    autoSelectSemanticKeywords();
  }

  function handleRefreshSemanticPositions() {
    const confirmed = window.confirm(
      "Обновить позиции карточки из MPStats? Ранжирующиеся запросы и позиции на экране будут обновлены свежим отчетом.",
    );
    if (!confirmed) {
      return;
    }
    loadSemanticCurrentPositions({ forceRefresh: true });
  }

  function removeSemanticKeyword(item) {
    if (approvalReadOnly) return;
    const key = semanticQueryKey(item);
    if (!key) return;
    stageSemanticSelection(semanticCoreSelected.filter((selected) => semanticQueryKey(selected) !== key));
  }

  function toggleSemanticRemovalKeyword(item) {
    if (approvalReadOnly) return;
    const key = semanticQueryKey(item);
    if (!key) return;
    const currentRemoval = normalizeSemanticRemoval(semanticCoreRemoval);
    if (currentRemoval.some((removed) => semanticQueryKey(removed) === key)) {
      stageSemanticRemoval(currentRemoval.filter((removed) => semanticQueryKey(removed) !== key));
      return;
    }
    const contentSource = activeSemanticContentRows.find((row) => semanticQueryKey(row) === key);
    const rankingSource = activeSemanticPositionRows.find((row) => semanticQueryKey(row) === key);
    const source = contentSource || rankingSource || item;
    stageSemanticRemoval([
      ...currentRemoval,
      {
        ...source,
        status: "remove",
        field: source.field || (contentSource ? "content" : "ranking"),
        removalReason: "ключ нерелевантен или не нужен в будущей переоптимизации",
      },
    ]);
  }

  function stageSemanticReports(nextReports) {
    const normalizedReports = normalizeSemanticReports(nextReports);
    setSemanticCoreReports(normalizedReports);
    setSemanticCleared(!normalizedReports.length);
    setSemanticDraftDirty(true);
    setSemanticDraftSaved(false);
    setSemanticSaveStatus("unsaved");
  }

  function removeSemanticReport(report) {
    const reportId = report?.id;
    if (!reportId) return;
    const nextReports = semanticCoreReports.filter((item) => item.id !== reportId);
    const nextSelection = normalizeSemanticSelection(nextReports.flatMap((item) => item.selected || []));
    const finalBelongsToRemovedReport = Boolean(
      semanticCoreFinal
      && (
        String(semanticCoreFinal.reportId || "") === String(reportId)
        || String(semanticCoreFinal.id || "") === String(reportId)
        || String(semanticCoreFinal.id || "") === `semantic-final-${reportId}`
      )
    );
    if (semanticActiveReportId === reportId) {
      const nextActiveReport = nextReports[0] || null;
      if (nextActiveReport) {
        openSemanticReport(nextActiveReport);
      } else {
        setSemanticCore(null);
        setSemanticActiveReportId("");
        setSemanticSeedQuery(defaultSemanticSeedQuery(card));
        setSemanticSubjectFilter("");
        setSemanticSearch("");
        setSemanticExcludeWords("");
        setSemanticCoreStatus("idle");
        setSemanticCoreError("");
        setSemanticRankStatus("idle");
      }
    }
    setSemanticCoreSelected(nextSelection);
    if (!nextReports.length || finalBelongsToRemovedReport) {
      setSemanticCoreFinal(null);
      setSemanticFinalStatus("");
    }
    stageSemanticReports(nextReports);
  }

  async function reoptimizeContentFromSemanticCore(options = {}) {
    if (!semanticHasOptimizationKeywords || approvalReadOnly) {
      return;
    }
    const requestedSections = (Array.isArray(options.sections) ? options.sections : [])
      .map((section) => String(section || "").trim())
      .filter((section) => ["title", "description", "characteristics"].includes(section));
    const sections = requestedSections.length ? requestedSections : ["title", "description", "characteristics"];
    const action = sections.length === 1 ? sections[0] : "all";
    const desiredKeywords = semanticRowsByKey(Array.isArray(options.desiredKeywords) ? options.desiredKeywords : []);
    setSemanticContentStatus("loading");
    setSemanticContentAction(action);
    setSemanticContentError("");
    try {
      const payload = await apiRequest("/api/card-content-reoptimize", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal?.id,
          cardKey: draftCardKey,
          card,
          selectedKeywords: activeSemanticNewRows,
          currentKeywords: activeSemanticRowsForOptimization,
          removeKeywords: activeSemanticRemovalRows,
          desiredKeywords,
          sections,
          draft: {
            title: draftTitle,
            description: draftDescription,
          },
          characteristicsContext: {
            currentCharacteristics: characteristicItems,
            availableCharacteristics: subjectCharacteristics,
            mpstatsCharacteristics,
          },
        }),
      });
      const titleDraft = payload.draftContent?.title || {};
      const descriptionDraft = payload.draftContent?.description || {};
      const savedDraftContent = payload.draft?.draft?.content || payload.draft?.content || {};
      const shouldApplyTitle = sections.includes("title");
      const shouldApplyDescription = sections.includes("description");
      const shouldApplyCharacteristics = sections.includes("characteristics");
      const semanticCharacteristicDrafts = shouldApplyCharacteristics
        ? normalizeDraftCharacteristics(payload.draftContent?.characteristics || savedDraftContent.characteristics || {})
        : {};
      const nextDraftCharacteristics = { ...normalizeDraftCharacteristics(draftCharacteristics) };
      if (shouldApplyCharacteristics) {
        Object.entries(semanticCharacteristicDrafts).forEach(([key, draft]) => {
          nextDraftCharacteristics[key] = nextDraftCharacteristics[key]
            ? mergeDraftCharacteristic(nextDraftCharacteristics[key], draft)
            : draft;
        });
      }
      const nextTitle = shouldApplyTitle ? (titleDraft.value || draftTitle || currentTitle) : draftTitle;
      const nextDescription = shouldApplyDescription ? (descriptionDraft.value || draftDescription || description) : draftDescription;
      const nextTitleSource = shouldApplyTitle ? "semantic" : draftTitleSource;
      const nextDescriptionSource = shouldApplyDescription ? "semantic" : draftDescriptionSource;
      const nextTitleReason = shouldApplyTitle ? (titleDraft.reason || "Заголовок переписан с учетом выбранного СЯ.") : draftTitleReason;
      const nextDescriptionReason = shouldApplyDescription
        ? (
          descriptionDraft.reason
          || (desiredKeywords.length
            ? `Описание переписано по СЯ и с попыткой естественно учесть ${desiredKeywords.length} выбранных непокрытых ${pluralRu(desiredKeywords.length, "ключ", "ключа", "ключей")}.`
            : "Описание переписано с учетом выбранного СЯ.")
        )
        : draftDescriptionReason;
      const structuredDraft = buildStructuredCardDraft({
        auditStatus,
        auditHistory,
        approval,
        approvalSections,
        title: nextTitle,
        description: nextDescription,
        titleSource: nextTitleSource,
        descriptionSource: nextDescriptionSource,
        titleReason: nextTitleReason,
        descriptionReason: nextDescriptionReason,
        characteristics: nextDraftCharacteristics,
        prices: draftPrices,
        stocks: draftStocks,
        semanticCoreSelected,
        semanticCoreRemoval,
        semanticCoreReports,
        semanticCoreFinal,
        card,
        contentOptimization: payload.contentOptimization,
      });
      setDraftTitle(nextTitle);
      setDraftDescription(nextDescription);
      setDraftTitleSource(nextTitleSource);
      setDraftDescriptionSource(nextDescriptionSource);
      setDraftTitleReason(nextTitleReason);
      setDraftDescriptionReason(nextDescriptionReason);
      setDraftCharacteristics(nextDraftCharacteristics);
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
        : error.message === "unsupported_marketplace"
          ? "Для этого маркетплейса нужна отдельная методология переоптимизации."
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
        semanticCoreRemoval,
        semanticCoreReports,
        semanticCoreFinal,
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
        semanticCoreRemoval,
      semanticCoreReports,
      semanticCoreFinal,
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
        semanticCoreRemoval,
        semanticCoreReports,
        semanticCoreFinal,
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
    setDraftSaveError("");
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ ...structuredDraft, savedAt }));
      savedLocally = true;
      setDraftSavedAt(savedAt);
      setDraftSaveStatus(backendDraftEnabled ? "saving" : "local");
    } catch {
      setDraftSaveStatus("local-error");
      setDraftSaveError("Браузер не сохранил локальную копию черновика.");
    }
    if (backendDraftEnabled) {
      try {
        const response = await apiRequest("/api/card-drafts", {
          method: "POST",
          body: JSON.stringify({
            portalId: portal.id,
            cardKey: draftCardKey,
            nmID: cardNmIdValue(card),
            vendorCode: cardVendorCodeValue(card),
            draft: structuredDraft,
          }),
        });
        setDraftSavedAt(response.draft?.updatedAt || savedAt);
        setDraftSaveStatus("backend");
        setDraftSaveError("");
        try {
          localStorage.setItem(draftStorageKey, JSON.stringify(response.draft || { ...structuredDraft, savedAt }));
        } catch {
          // Backend save succeeded; local cache sync is best effort.
        }
        try {
          if (onDraftActivity) {
            onDraftActivity({ audit: auditDone, draft: true });
          }
          if (onDraftSaved) {
            await onDraftSaved(response.draft);
          }
        } catch {
          // The draft is already saved; parent refresh is a secondary UI sync.
        }
        return "backend";
      } catch (error) {
        setDraftSaveError(draftSaveErrorText(error));
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
        semanticCoreRemoval,
      semanticCoreReports,
      semanticCoreFinal,
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
        semanticCoreRemoval,
      semanticCoreReports,
      semanticCoreFinal,
      card,
    });
  }

  async function applyApprovalChange(nextApproval, statusMessage, sectionKey = activeApprovalSection) {
    const targetSection = normalizeApprovalSectionKey(sectionKey, activeApprovalSection);
    const previousApproval = approval;
    const previousSections = approvalSections;
    const normalized = normalizeApprovalState(nextApproval);
    const nextSections = normalizeApprovalSections({
      ...approvalSections,
      [targetSection]: normalized,
    });
    const nextOverallApproval = deriveOverallApproval(nextSections);
    setApprovalSections(nextSections);
    setApproval(nextOverallApproval);
    const persistStatus = await persistStructuredDraft(buildCurrentStructuredDraft(nextSections), { auditDone: auditStatus === "done" });
    if (backendDraftEnabled && persistStatus !== "backend") {
      setApprovalSections(previousSections);
      setApproval(previousApproval);
      setDraftSaveStatus("approval-save-error");
      setDraftSaveError((current) => current || "Backend не принял изменение статуса.");
      return false;
    }
    setDraftSaveStatus(statusMessage);
    setDraftSaveError("");
    return true;
  }

  function approvalHistoryItem(action, reason = "", sectionKey = activeApprovalSection) {
    const targetSection = normalizeApprovalSectionKey(sectionKey, activeApprovalSection);
    return {
      id: `approval-${Date.now()}`,
      action,
      section: targetSection,
      sectionLabel: approvalSectionLabel(targetSection),
      reason,
      userLogin: currentUser?.login || "",
      userName: currentUser?.full_name || currentUser?.login || "",
      createdAt: new Date().toISOString(),
    };
  }

  function canSubmitApprovalSection(sectionKey) {
    const targetSection = normalizeApprovalSectionKey(sectionKey, activeApprovalSection);
    const sectionApproval = normalizeApprovalState(approvalSections[targetSection]);
    const sectionReadOnly = isProjectLead || (sectionApproval.status === "submitted" && isApprovalReviewer);
    return !sectionReadOnly && ["draft", "changes_requested"].includes(sectionApproval.status);
  }

  async function submitForApproval(sectionKey = activeApprovalSection) {
    const targetSection = normalizeApprovalSectionKey(sectionKey, activeApprovalSection);
    const now = new Date().toISOString();
    const sectionApproval = normalizeApprovalState(approvalSections[targetSection]);
    const nextApproval = normalizeApprovalState({
      ...sectionApproval,
      status: "submitted",
      assigneeLogin: portalTeam.manager || "",
      submittedBy: currentUser?.login || "",
      submittedAt: now,
      reviewedBy: "",
      reviewedAt: "",
      returnReason: "",
      history: [approvalHistoryItem("submitted", "", targetSection), ...(sectionApproval.history || [])],
    });
    return applyApprovalChange(nextApproval, "approval-submitted", targetSection);
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
      draftStorageKeys.forEach((storageKey) => localStorage.removeItem(storageKey));
      if (backendDraftEnabled) {
        for (const candidateKey of uniqueDraftKeyValues([draftCardKey, ...draftCardKeys])) {
          await apiRequest(`/api/card-drafts?portal_id=${encodeURIComponent(portal.id)}&card_key=${encodeURIComponent(candidateKey)}`, {
            method: "DELETE",
          });
        }
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
      setSemanticCoreFinal(null);
      setSemanticCleared(false);
      setSemanticDraftDirty(false);
      setSemanticDraftSaved(false);
      setSemanticFinalStatus("");
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
      downloadXlsx(`итоговый контент - ${safeFilePart(cardExportArticle(card))} - ${exportDatePart()}.xlsx`, buildFinalContentCardSheets(card, draftTitle, draftDescription, draftCharacteristics));
      return;
    }
    if (type === "prices") {
      downloadXlsx(`${exportFileBase}-prices-wb.xlsx`, buildPricesExportSheets(card, draftPrices));
      return;
    }
    downloadXlsx(`${exportFileBase}-stocks-wb.xlsx`, buildStocksExportSheets(card, draftStocks));
  }

  function downloadSemanticCoreSelection({ selectedRows = semanticCoreSelected, removalRows = semanticCoreRemoval, core = activeSemanticCore } = {}) {
    const sheet = buildSemanticCoreExportSheet("СЯ в работу", core, selectedRows, removalRows);
    if (!sheet) return;
    downloadXlsx(`семантическое ядро - ${safeFilePart(cardExportArticle(card))} - ${exportDatePart()}.xlsx`, [buildSemanticCoreInstructionSheet(card), sheet]);
  }

  async function previewCardSemanticImport(file) {
    if (!file || !backendDraftEnabled) return;
    setSemanticImportStatus("reading");
    setSemanticImportError("");
    setSemanticImportPreview(null);
    try {
      const fileData = await readFileAsBase64(file);
      const filePayload = { fileName: file.name, fileData };
      setSemanticImportFile(filePayload);
      setSemanticImportStatus("previewing");
      const preview = await apiRequest("/api/semantic-core-import", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          cardKey: draftCardKey,
          scope: "card",
          mode: "preview",
          ...filePayload,
        }),
      });
      setSemanticImportPreview(preview);
      setSemanticImportStatus("preview");
      onDraftActivity?.({ draft: true });
    } catch (error) {
      const message = semanticImportErrorText(error);
      setSemanticImportStatus("error");
      setSemanticImportError(message);
    }
  }

  async function applyCardSemanticImport() {
    if (!semanticImportFile || !backendDraftEnabled) return;
    setSemanticImportStatus("applying");
    setSemanticImportError("");
    try {
      const result = await apiRequest("/api/semantic-core-import", {
        method: "POST",
        body: JSON.stringify({
          portalId: portal.id,
          cardKey: draftCardKey,
          scope: "card",
          mode: "apply",
          ...semanticImportFile,
        }),
      });
      setSemanticImportPreview(result);
      setSemanticImportStatus("applied");
      const updatedDraft = (result.applied?.cards || []).find((item) => String(item.cardKey) === String(draftCardKey))?.draft
        || result.applied?.cards?.[0]?.draft
        || null;
      if (updatedDraft) {
        const normalized = contentFromStoredDraft(updatedDraft, card);
        setSemanticCoreSelected(normalized.semanticCoreSelected);
        setSemanticCoreRemoval(normalized.semanticCoreRemoval);
        setSemanticCoreFinal(normalized.semanticCoreFinal);
        setSemanticDraftDirty(false);
        setSemanticDraftSaved(true);
        setSemanticSaveStatus("saved");
        setSemanticFinalStatus("saved");
        setDraftSavedAt(updatedDraft.updatedAt || new Date().toISOString());
        try {
          localStorage.setItem(draftStorageKey, JSON.stringify(updatedDraft));
        } catch {
          // Backend save succeeded; local cache sync is best effort.
        }
        onDraftActivity?.({ draft: true });
        await onDraftSaved?.(updatedDraft);
      }
    } catch (error) {
      const message = semanticImportErrorText(error);
      setSemanticImportStatus("error");
      setSemanticImportError(message);
    }
  }

  async function persistSemanticFinal(nextFinal, { replacing = false } = {}) {
    const previousFinal = semanticCoreFinal;
    setSemanticCoreFinal(nextFinal);
    setSemanticFinalStatus("saving");
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
      semanticCoreRemoval,
      semanticCoreReports,
      semanticCoreFinal: nextFinal,
      card,
    });
    try {
      const persistStatus = await persistStructuredDraft(structuredDraft, { auditDone: auditStatus === "done" });
      if (!semanticPersistSucceeded(persistStatus)) {
        throw new Error("semantic_final_save_failed");
      }
      setSemanticDraftDirty(false);
      setSemanticDraftSaved(true);
      setSemanticFinalStatus(replacing ? "replaced" : "saved");
      return true;
    } catch {
      setSemanticCoreFinal(previousFinal);
      setSemanticFinalStatus("error");
      return false;
    }
  }

  async function addSemanticCoreToFinal() {
    const nextFinal = currentSemanticFinalExport;
    if (!nextFinal || !semanticFinalHasRows) {
      setSemanticFinalStatus("missing");
      return false;
    }
    if (semanticStoredFinal && !semanticFinalMatchesCurrent) {
      setSemanticFinalStatus("conflict");
      return false;
    }
    return persistSemanticFinal(nextFinal);
  }

  async function replaceSemanticCoreFinal() {
    const nextFinal = currentSemanticFinalExport;
    if (!nextFinal || !semanticFinalHasRows) {
      setSemanticFinalStatus("missing");
      return false;
    }
    return persistSemanticFinal(nextFinal, { replacing: true });
  }

  function openSemanticReport(report) {
    if (!report?.semanticCore) return;
    setSemanticCore(report.semanticCore);
    setSemanticCleared(false);
    setSemanticActiveReportId(report.id);
    setSemanticSeedQuery(report.seedQuery || report.semanticCore.seedQuery || defaultSemanticSeedQuery(card));
    setSemanticSubjectFilter("");
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
          <button className="btn ghost" type="button" onClick={handleBackToCards}><ArrowLeft size={17} />{backLabel}</button>
          <a className="btn" href={wbCardUrl(card)} target="_blank" rel="noreferrer"><ExternalLink size={17} />Открыть WB</a>
          <Tag tone={approvalStatusTone(approval.status)}>{approvalStatusLabel(approval.status)}</Tag>
        </div>
      </header>

      {taskRunTotal ? (
        <section className="task-run-strip">
          <div className="task-run-copy">
            <span>{taskRun.workTypeLabel || "Задача"} · {formatNumber(taskRunIndex + 1)} из {formatNumber(taskRunTotal)}</span>
            <strong>{taskRun.title || "Пачка задач"}</strong>
            <p>{taskRunCurrent?.title || currentTitle} · WB {textOrDash(taskRunCurrent?.nmID || card?.nmID)} · артикул {textOrDash(taskRunCurrent?.vendorCode || card?.vendorCode)}</p>
            <Tag tone={taskRunCurrentStatus.tone}>{taskRunCurrentStatus.label}</Tag>
          </div>
          <div className="task-run-progress" aria-label={`Карточка ${taskRunIndex + 1} из ${taskRunTotal}`}>
            <span style={{ width: `${Math.round(((taskRunIndex + 1) / taskRunTotal) * 100)}%` }} />
          </div>
          <div className="task-run-actions">
            <button
              className={loadingButtonClass("btn primary", taskRunActionBusy)}
              type="button"
              onClick={completeTaskRunCardAndNext}
              disabled={taskRunActionBusy}
              aria-busy={taskRunActionBusy || undefined}
            >
              <CheckSquare size={17} />{taskRunCompleteLabel}
            </button>
            <button className="btn" type="button" onClick={skipTaskRunCard} disabled={!taskRunNext || taskRunActionBusy}>
              Пропустить
            </button>
            <button className="btn" type="button" onClick={deferTaskRunCard} disabled={taskRunTotal < 2 || taskRunActionBusy}>
              <RotateCcw size={17} />Вернуться позже
            </button>
            <button className="btn" type="button" onClick={() => navigateTaskRunCard(-1)} disabled={!taskRunPrevious} title={taskRunPrevious ? taskRunPrevious.title : "Это первая карточка"}>
              <ChevronLeft size={17} />Предыдущая
            </button>
            <button className="btn" type="button" onClick={() => navigateTaskRunCard(1)} disabled={!taskRunNext} title={taskRunNext ? taskRunNext.title : "Это последняя карточка"}>
              Следующая<ChevronRight size={17} />
            </button>
          </div>
          {taskRunActionMessage ? <p className="task-run-status">{taskRunActionMessage}</p> : null}
        </section>
      ) : null}

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
                <div className="list-row expandable-row">
                  <span>Описание</span>
                  <div className="row-action">
                    <strong>{isEmptyValue(description) ? "Пусто" : "есть"}</strong>
                    <button className="icon-mini" type="button" onClick={() => setCardDescriptionOpen((value) => !value)} disabled={isEmptyValue(description)} title={cardDescriptionOpen ? "Свернуть текущее описание" : "Раскрыть текущее описание"} aria-label={cardDescriptionOpen ? "Свернуть текущее описание" : "Раскрыть текущее описание"}>
                      {cardDescriptionOpen ? <X size={14} /> : <Plus size={14} />}
                    </button>
                  </div>
                </div>
                {cardDescriptionOpen && !isEmptyValue(description) ? (
                  <div className="description-inline-box">
                    <p>{description}</p>
                  </div>
                ) : null}
                <div className="list-row expandable-row">
                  <span>Характеристики</span>
                  <div className="row-action">
                    <strong>{valueSummary(currentCardCharacteristics)}</strong>
                    <button className="icon-mini" type="button" onClick={() => setCardCharacteristicsOpen((value) => !value)} disabled={!currentCardCharacteristicRows.length} title={cardCharacteristicsOpen ? "Свернуть текущие характеристики" : "Раскрыть текущие характеристики"} aria-label={cardCharacteristicsOpen ? "Свернуть текущие характеристики" : "Раскрыть текущие характеристики"}>
                      {cardCharacteristicsOpen ? <X size={14} /> : <Plus size={14} />}
                    </button>
                  </div>
                </div>
                {cardCharacteristicsOpen && currentCardCharacteristicRows.length ? (
                  <div className="characteristics-inline-list">
                    {currentCardCharacteristicRows.map((item) => (
                      <div className="characteristics-inline-row" key={item.key}>
                        <span>{item.label}</span>
                        <strong>{characteristicDisplayValue(item.value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
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
              <button className={activeTab === "semantic" ? "active" : ""} type="button" onClick={() => switchDetailTab("semantic")}>Семантическое ядро</button>
              <button className={activeTab === "card" ? "active" : ""} type="button" onClick={() => switchDetailTab("card")}>Карточка</button>
              <button className={activeTab === "audit" ? "active" : ""} type="button" onClick={() => switchDetailTab("audit")}>Рыночный аудит</button>
              <button className={activeTab === "competitors" ? "active" : ""} type="button" onClick={() => switchDetailTab("competitors")}>Товарный аудит</button>
              <button className={activeTab === "changes" ? "active" : ""} type="button" onClick={() => switchDetailTab("changes")}>Изменения</button>
            </nav>
            <HelpHint enabled={helpEnabled} title="Как работать с карточкой">
              Идите по порядку: соберите Семантическое ядро, запустите Рыночный аудит, при необходимости проверьте Товарный аудит по конкурентам, затем откройте Изменения и сохраните готовый черновик.
            </HelpHint>

            {activeTab === "semantic" ? (
              <section className="workspace-strip semantic-core-workspace">
                  <div className="strip-head">
                    <div>
                      <h2>Семантическое ядро</h2>
                      <p>Действующие позиции карточки и новые запросы из MPStats для итогового SEO-файла.</p>
                    </div>
                    <Tag tone={activeSemanticCore ? "blue" : (semanticCoreStatus === "loading" ? "blue" : "amber")}>
                      {semanticCoreStatus === "loading" ? "собираем" : semanticCoreStatus === "pending" ? "готовится" : activeSemanticNewRows.length ? `${activeSemanticNewRows.length} к добавлению` : activeSemanticPositionRows.length ? `${activeSemanticPositionRows.length} ранж.` : activeSemanticContentRows.length ? `${activeSemanticContentRows.length} ключей` : "нет данных"}
                    </Tag>
                  </div>
                <div className="semantic-query-bar">
                  <label className="field-label">
                    <span>Стартовый запрос</span>
                    <input value={semanticSeedQuery} onChange={(event) => setSemanticSeedQuery(event.target.value)} onKeyDown={handleSemanticSeedKeyDown} placeholder="пижама женская" />
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
                    <span>Слова исключения · {formatNumber(semanticExcludeWordCount)}/{formatNumber(semanticExcludeWordsLimit)}</span>
                    <input value={semanticExcludeWords} onChange={(event) => setSemanticExcludeWords(event.target.value)} placeholder="шорты, костюм" disabled={!activeSemanticCore} title={`Можно указать до ${formatNumber(semanticExcludeWordsLimit)} слов через пробел, запятую или точку с запятой.`} />
                  </label>
                </div>
                <HelpList
                  enabled={helpEnabled}
                  title="Порядок работы с СЯ"
                  items={[
                    "Введите стартовый запрос и нажмите Enter или Подобрать запросы: MPStats соберет новую выдачу именно по этому запросу.",
                    "Добавьте подходящие ключи в работу вручную или кнопкой Автодобавить запросы, затем нажмите Сохранить текущий выбор.",
                    "Когда выбор сохранен, можно переоптимизировать описание, сохранить подборку в архив или добавить версию в итоговое СЯ кабинета.",
                  ]}
                />
                <div className="semantic-collection-actions">
                  <button className={loadingButtonClass("btn", semanticCollectionActionStatus === "saving")} type="button" onClick={() => { setSemanticCollectionSaveOpen(true); setSemanticCollectionError(""); }} disabled={!canSaveSemanticCollection} aria-busy={semanticCollectionActionStatus === "saving" || undefined} title={activeSemanticNewRows.length ? "Сохранить выбранные ключи как архивную подборку для аналогичных карточек." : "Сначала добавьте ключи к добавлению."}>
                    <Archive size={17} />{semanticCollectionActionStatus === "saving" ? "Сохраняем подборку" : "Сохранить подборку"}
                  </button>
                  <button className={loadingButtonClass("btn", semanticCollectionsStatus === "loading")} type="button" onClick={toggleSemanticCollectionArchive} disabled={!backendDraftEnabled || semanticCollectionsStatus === "loading"} aria-busy={semanticCollectionsStatus === "loading" || undefined}>
                    <Archive size={17} />{semanticCollectionArchiveOpen ? "Скрыть архив" : "Архив подборок"}
                  </button>
                  <button className={loadingButtonClass("btn", semanticCollectionActionStatus === "updating")} type="button" onClick={appendCurrentSelectionToSemanticCollection} disabled={!canAppendSemanticCollection} aria-busy={semanticCollectionActionStatus === "updating" || undefined} title={semanticAppliedCollection ? `Добавить новые ключи текущей карточки в подборку "${semanticAppliedCollection.name}". Старые ключи не удаляются.` : "Сначала примените или сохраните подборку."}>
                    <Plus size={17} />{semanticCollectionActionStatus === "updating" ? "Пополняем" : "Пополнить подборку"}
                  </button>
                </div>
                {semanticSaveStatus === "unsaved" || semanticSaveStatus === "saving" || semanticSaveStatus === "saved" || semanticSaveStatus === "error" ? (
                  <div className={`semantic-save-banner ${semanticSaveStatus}`}>
                    <strong>{semanticSaveStatus === "saved" ? "СЯ сохранено" : semanticSaveStatus === "saving" ? "Сохраняем СЯ" : semanticSaveStatus === "unsaved" ? "СЯ не сохранено" : "СЯ не сохранилось"}</strong>
                    <span>{semanticSaveStatus === "saved"
                      ? "Текущий выбор и источники MPStats сохранены в карточке."
                      : semanticSaveStatus === "saving"
                        ? "Не обновляйте страницу, пока сохранение не завершится."
                        : semanticSaveStatus === "unsaved"
                          ? "Нажмите Сохранить текущий выбор, чтобы закрепить подборку в карточке без добавления в итоговое СЯ."
                          : "Повторите сохранение текущего выбора еще раз."}</span>
                  </div>
                ) : null}
                {semanticCollectionSaveOpen ? (
                  <div className="semantic-collection-form">
                    <label className="field-label">
                      <span>Название подборки</span>
                      <input value={semanticCollectionName} onChange={(event) => setSemanticCollectionName(event.target.value)} placeholder="Введите название" />
                    </label>
                    <button className={loadingButtonClass("btn primary", semanticCollectionActionStatus === "saving")} type="button" onClick={saveSemanticCollection} disabled={semanticCollectionActionStatus === "saving" || !semanticCollectionName.trim()} aria-busy={semanticCollectionActionStatus === "saving" || undefined}>
                      <Save size={16} />{semanticCollectionActionStatus === "saving" ? "Сохраняем" : "Сохранить подборку"}
                    </button>
                    <button className="btn ghost" type="button" onClick={() => { setSemanticCollectionSaveOpen(false); setSemanticCollectionError(""); }} disabled={semanticCollectionActionStatus === "saving"}>
                      <X size={16} />Отмена
                    </button>
                  </div>
                ) : null}
                {semanticCoreReports.length ? (
                  <div className="semantic-history">
                    <span>Источники MPStats</span>
                    {semanticCoreReports.map((report) => (
                      <div className={`semantic-history-row ${report.id === semanticActiveReportId ? "active" : ""}`} key={report.id}>
                        <div>
                          <strong>{report.seedQuery || "Без запроса"}</strong>
                          <em>{report.createdAt ? new Date(report.createdAt).toLocaleString("ru-RU") : "без даты"} · {formatNumber(report.semanticCore?.totalKeywords || 0)} запросов</em>
                        </div>
                        {report.id === semanticActiveReportId ? <Tag tone="green">открыт</Tag> : null}
                        <button className="btn mini" type="button" onClick={() => openSemanticReport(report)}>Открыть</button>
                        <button className="btn mini danger" type="button" onClick={() => removeSemanticReport(report)}>
                          <Trash2 size={14} />Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {semanticCollectionArchiveOpen ? (
                  <div className="semantic-archive">
                    <div className="semantic-archive-head">
                      <span>Архив подборок</span>
                      <div>
                        <input value={semanticCollectionSearch} onChange={(event) => setSemanticCollectionSearch(event.target.value)} placeholder="найти подборку" />
                        <button className={loadingButtonClass("btn mini", semanticCollectionsStatus === "loading")} type="button" onClick={loadSemanticCollections} disabled={semanticCollectionsStatus === "loading"} aria-busy={semanticCollectionsStatus === "loading" || undefined}>
                          <RefreshCw size={14} />Обновить
                        </button>
                      </div>
                    </div>
                    {semanticCollectionsStatus === "loading" ? <span className="status-note">Загружаем архив подборок...</span> : null}
                    {semanticCollectionsStatus === "empty" ? <span className="status-note">Архив подборок пока пуст.</span> : null}
                    {semanticCollectionsStatus === "error" ? <span className="status-note">Архив подборок сейчас не загрузился.</span> : null}
                    {filteredSemanticCollections.map((collection) => (
                      <div className={`semantic-collection-row ${String(collection.id) === String(semanticAppliedCollectionId) ? "active" : ""}`} key={collection.id}>
                        <div className="semantic-collection-summary">
                          <div>
                            <strong>{collection.name}</strong>
                            <em>{formatNumber(collection.keywordCount || 0)} {pluralRu(collection.keywordCount || 0, "ключ", "ключа", "ключей")} · {collection.updatedAt ? new Date(collection.updatedAt).toLocaleString("ru-RU") : "без даты"}</em>
                          </div>
                          {String(collection.id) === String(semanticAppliedCollectionId) ? <Tag tone="green">применена</Tag> : null}
                          <button className="btn mini" type="button" onClick={() => applySemanticCollection(collection)}>
                            <Plus size={14} />Применить
                          </button>
                          <button className="btn mini" type="button" onClick={() => openSemanticCollectionEditor(collection)}>
                            <Pencil size={14} />Редактировать
                          </button>
                          <button className="btn mini danger" type="button" onClick={() => deleteSemanticCollection(collection)} disabled={semanticCollectionActionStatus === "deleting"}>
                            <Trash2 size={14} />Удалить
                          </button>
                        </div>
                        {String(semanticEditingCollectionId) === String(collection.id) ? (
                          <div className="semantic-collection-editor">
                            <label className="field-label">
                              <span>Название</span>
                              <input value={semanticEditingCollectionName} onChange={(event) => setSemanticEditingCollectionName(event.target.value)} />
                            </label>
                            <div className="semantic-collection-keywords">
                              {semanticEditingKeywords.map((item) => (
                                <div className="semantic-collection-keyword" key={semanticQueryKey(item)}>
                                  <span>{item.query}</span>
                                  <em>{semanticKeywordMeta(item) || "ключ подборки"}</em>
                                  <button className="btn mini" type="button" onClick={() => removeSemanticEditingKeyword(item)}>
                                    <X size={14} />Убрать
                                  </button>
                                </div>
                              ))}
                              {!semanticEditingKeywords.length ? <p>Ключей в подборке нет.</p> : null}
                            </div>
                            <div className="semantic-collection-editor-actions">
                              <button className={loadingButtonClass("btn primary", semanticCollectionActionStatus === "updating")} type="button" onClick={saveSemanticCollectionEdits} disabled={semanticCollectionActionStatus === "updating" || !semanticEditingCollectionName.trim()} aria-busy={semanticCollectionActionStatus === "updating" || undefined}>
                                <Save size={16} />{semanticCollectionActionStatus === "updating" ? "Сохраняем" : "Сохранить изменения"}
                              </button>
                              <button className="btn ghost" type="button" onClick={() => { setSemanticEditingCollectionId(""); setSemanticEditingCollectionName(""); setSemanticEditingKeywords([]); }} disabled={semanticCollectionActionStatus === "updating"}>
                                <X size={16} />Закрыть
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {semanticCollectionsStatus === "loaded" && !filteredSemanticCollections.length ? <span className="status-note">Поиск не нашел подборки.</span> : null}
                  </div>
                ) : null}
                {activeSemanticCore ? (
	                  <SemanticCorePanel
	                    semanticCore={activeSemanticCore}
	                    standalone
	                    subjectFilter={semanticSubjectFilter}
	                    search={semanticSearch}
	                    excludeWords={semanticExcludeWords}
	                    removalRows={semanticCoreRemoval}
	                    onTakeKeyword={takeSemanticKeyword}
	                    onRemoveKeyword={removeSemanticKeyword}
	                    onToggleRemoveKeyword={toggleSemanticRemovalKeyword}
	                    readOnly={approvalReadOnly}
	                  />
                ) : (
                  <div className="empty-state">
                    <strong>Позиции карточки еще не загружены</strong>
                    <span>MPStats вернет действующие запросы с позициями, затем можно собрать новые запросы по стартовой фразе.</span>
                  </div>
                )}
                <div className="tab-actions">
                    {semanticCoreError ? <span className="status-note">{semanticCoreError}</span> : null}
                    {semanticCollectionError ? <span className="status-note">{semanticCollectionError}</span> : null}
                    {semanticCollectionActionStatus === "saved" ? <span className="status-note">Подборка сохранена в архив.</span> : null}
                    {semanticCollectionActionStatus === "applied" ? <span className="status-note">Подборка применена к текущей карточке.</span> : null}
                    {semanticCollectionActionStatus === "updated" ? <span className="status-note">Подборка обновлена.</span> : null}
                    {semanticCollectionActionStatus === "deleted" ? <span className="status-note">Подборка удалена из архива.</span> : null}
                    {semanticRankStatus === "loading" ? <span className="status-note">Подтягиваем ранжирующиеся запросы и позиции карточки...</span> : null}
                    {semanticRankStatus === "empty" ? <span className="status-note">MPStats не вернул ранжирующиеся запросы карточки.</span> : null}
                  {semanticRankStatus === "error" ? <span className="status-note">Подборка доступна, но позиции карточки сейчас не загрузились.</span> : null}
                  {semanticSaveStatus === "unsaved" ? <span className="status-note">Текущий выбор СЯ пока не сохранен в карточке.</span> : null}
                  {semanticSaveStatus === "saving" ? <span className="status-note">Сохраняем текущий выбор СЯ...</span> : null}
                  {semanticSaveStatus === "saved" ? <span className="status-note">Текущий выбор СЯ сохранен в карточке.</span> : null}
                  {semanticSaveStatus === "error" ? <span className="status-note">Выбрано на экране, но не сохранилось в черновик. Повторите действие позже.</span> : null}
                  {semanticContentStatus === "loading" ? <span className="status-note">GigaChat готовит {semanticContentActionText}...</span> : null}
                  {semanticContentStatus === "done" ? <span className="status-note">Новый вариант блока “{semanticContentActionText}” сохранен в черновик.</span> : null}
                  {semanticContentError ? <span className="status-note">{semanticContentError}</span> : null}
                  {semanticCoreStatus === "missing-card" ? <span className="status-note">Укажите стартовый запрос для СЯ.</span> : null}
                  <button
                    className="btn"
                    type="button"
                    onClick={handleAutoSelectSemanticKeywords}
                    disabled={!canAutoSelectSemantic}
                    title={autoSemanticTitle}
                  >
                    <WandSparkles size={17} />Автодобавить запросы
                  </button>
                  <span
                    className="semantic-help-icon"
                    title="Сначала нажмите Подобрать запросы: система соберет новые запросы MPStats. Затем Автодобавить запросы перенесет подходящие ключи в Добавленные в работу; после проверки нажмите Сохранить текущий выбор."
                    aria-label="Как работает автодобавление запросов"
                  >
                    <HelpCircle size={15} />
                  </span>
                  <button
                    className={loadingButtonClass("btn", semanticContentRunning)}
                    type="button"
                    onClick={() => reoptimizeContentFromSemanticCore()}
                    disabled={!canReoptimizeContent}
                    aria-busy={semanticContentRunning || undefined}
                    title={semanticHasOptimizationKeywords ? (semanticCurrentChoiceSaved ? "Переписать заголовок, описание и характеристики по всем ключам СЯ без ключей к удалению." : "Сначала нажмите Сохранить текущий выбор.") : "Сначала соберите или загрузите СЯ для карточки."}
                  >
                    <WandSparkles size={17} />{semanticContentRunning && semanticContentAction === "all" ? "Переоптимизируем" : "Переоптимизировать"}
                  </button>
                  <button className={loadingButtonClass("btn", semanticRankStatus === "loading")} type="button" onClick={handleRefreshSemanticPositions} disabled={semanticRankStatus === "loading" || !card?.nmID} aria-busy={semanticRankStatus === "loading" || undefined}>
                    <RefreshCw size={17} />{semanticRankStatus === "loading" ? "Обновляем позиции" : "Обновить позиции"}
                  </button>
                  <button className={loadingButtonClass("btn", semanticSaveStatus === "saving")} type="button" onClick={saveSemanticCurrentSelection} disabled={semanticSaveCurrentDisabled} aria-busy={semanticSaveStatus === "saving" || undefined} title={semanticSaveCurrentTitle}>
                    <Save size={17} />{semanticSaveStatus === "saving" ? "Сохраняем выбор" : "Сохранить текущий выбор"}
                  </button>
                  <button className={loadingButtonClass("btn primary", semanticCoreStatus === "loading")} type="button" onClick={handleRunSemanticCore} disabled={semanticCoreStatus === "loading" || !semanticSeedQuery.trim()} aria-busy={semanticCoreStatus === "loading" || undefined}>
                    <Search size={17} />{semanticRunButtonLabel}
                  </button>
                </div>
                <div className="semantic-final-bar">
                  <div>
                    <span>Ключи в карточке</span>
                    <strong>{formatNumber(activeSemanticContentRows.length)} {pluralRu(activeSemanticContentRows.length, "ключ", "ключа", "ключей")}</strong>
                    <em>заложены в текущий контент</em>
                  </div>
                  <div>
                    <span>Ранжирующиеся запросы</span>
                    <strong>{formatNumber(activeSemanticPositionRows.length)} {pluralRu(activeSemanticPositionRows.length, "запрос", "запроса", "запросов")}</strong>
                    <em>{activeSemanticRankingPeriodLabel ? `MPStats за ${activeSemanticRankingPeriodLabel}` : "из отчета видимости MPStats"}</em>
                  </div>
	                  <div>
	                    <span>К добавлению с частотой</span>
	                    <strong>{formatNumber(activeSemanticNewRows.length)} {pluralRu(activeSemanticNewRows.length, "запрос", "запроса", "запросов")}</strong>
	                    <em>{activeSemanticExpansionPeriodLabel ? `подбор за ${activeSemanticExpansionPeriodLabel}` : semanticCoreReports.length ? `${formatNumber(semanticCoreReports.length)} ${pluralRu(semanticCoreReports.length, "подборка", "подборки", "подборок")}` : "подборок пока нет"}</em>
	                  </div>
	                  <div>
	                    <span>К удалению</span>
	                    <strong>{formatNumber(activeSemanticRemovalRows.length)} {pluralRu(activeSemanticRemovalRows.length, "ключ", "ключа", "ключей")}</strong>
	                    <em>попадут в отчет на согласование</em>
	                  </div>
	                  <div className="semantic-final-actions">
	                    <button className="btn" type="button" onClick={() => downloadSemanticCoreSelection()} disabled={!semanticCurrentChoiceSaved || (!activeSemanticPositionRows.length && !activeSemanticNewRows.length && !activeSemanticRemovalRows.length)} title={semanticCurrentChoiceSaved ? "Скачать сохраненный текущий выбор СЯ по карточке." : "Сначала нажмите Сохранить текущий выбор."}>
	                      <Download size={17} />Скачать файл карточки
	                    </button>
                    <button className={loadingButtonClass("btn primary", semanticFinalStatus === "saving")} type="button" onClick={addSemanticCoreToFinal} disabled={semanticFinalAddDisabled} aria-busy={semanticFinalStatus === "saving" || undefined} title={semanticFinalAddTitle}>
                      <CheckSquare size={17} />{semanticFinalMatchesCurrent ? "В итоговом СЯ" : "Добавить в итоговое СЯ"}
                    </button>
                  </div>
                </div>
                <SemanticCoreImportPanel
                  status={semanticImportStatus}
                  error={semanticImportError}
                  preview={semanticImportPreview}
                  onPickFile={previewCardSemanticImport}
                  onApply={applyCardSemanticImport}
                  disabled={!backendDraftEnabled}
                  title="Загрузить согласованное СЯ"
                  applyTitle="Применить к карточке"
                />
                {semanticFinalBanner ? (
                  <div className={`semantic-save-banner ${semanticFinalBanner.tone}`}>
                    <strong>{semanticFinalBanner.title}</strong>
                    <span>{semanticFinalBanner.copy}</span>
                    {semanticFinalBanner.action === "replace" ? (
                      <button className={loadingButtonClass("btn mini", semanticFinalStatus === "saving")} type="button" onClick={replaceSemanticCoreFinal} disabled={semanticFinalStatus === "saving" || !semanticCurrentChoiceSaved} aria-busy={semanticFinalStatus === "saving" || undefined} title={semanticCurrentChoiceSaved ? "Заменить сохраненную итоговую версию текущей." : "Сначала нажмите Сохранить текущий выбор."}>
                        <CheckSquare size={14} />Заменить старую новой
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeTab === "audit" ? (
              <section className="workspace-strip audit-workspace">
                <div className="strip-head">
                    <div>
                      <h2>Рыночный аудит карточки</h2>
                      <p>{auditNextStep.copy}</p>
                    </div>
                  <Tag tone={auditStatusTone}>{auditStatusText}</Tag>
                </div>
                <HelpList
                  enabled={helpEnabled}
                  title="Как сделать рыночный аудит"
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
                      <button className={loadingButtonClass("btn primary", auditButtonBusy)} type="button" onClick={() => runAudit("audit")} disabled={auditButtonBusy} aria-busy={auditButtonBusy || undefined}>
                        <ClipboardList size={17} />{auditRunning ? "Аудит идет" : mpstatsCharacteristicsStatus === "loading" ? "Ждем MPStats" : auditNextStep.action}
                      </button>
                    )}
                    {auditDone ? (
                      <button className={loadingButtonClass("btn", auditButtonBusy)} type="button" onClick={() => runAudit("audit")} disabled={auditButtonBusy} aria-busy={auditButtonBusy || undefined}>
                        <RefreshCw size={16} />{auditRunning ? "Запускаем" : mpstatsCharacteristicsStatus === "loading" ? "Ждем MPStats" : "Запустить заново"}
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
                      <strong>{issueCount ? primaryIssue : "Критичных проблем нет"}</strong>
                      <Tag tone={issueCount ? "amber" : "green"}>{issueCount ? "проверка" : "ок"}</Tag>
                    </div>
                    <p>{issueCount ? issueCopy(primaryIssue, cardSourceLabel) : `Карточка выглядит рабочей по текущему снимку ${cardSourceLabel}. Перед публикацией все равно нужна ручная проверка.`}</p>
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
                helpEnabled={helpEnabled}
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
                      ? "Черновик подготовлен, но любые поля можно править вручную перед согласованием."
                      : auditStale
                        ? "Черновик и задача сохранены после обновления WB. Рыночная аналитика сброшена, поэтому для новых рекомендаций подготовьте черновик заново."
                        : "Здесь собирается единый черновик карточки: после аудита, переоптимизации по СЯ, изменений конкурента или ручной правки."}</p>
                  </div>
                  <div className="strip-actions">
                    <button
                      className={loadingButtonClass("btn", mpstatsCharacteristicsStatus === "loading")}
                      type="button"
                      onClick={() => loadMpstatsCharacteristicHints({ forceRefresh: true })}
                      disabled={mpstatsCharacteristicsStatus === "loading"}
                      aria-busy={mpstatsCharacteristicsStatus === "loading" || undefined}
                      title="Принудительно обновить аналитику MPStats. Расходует запрос MPStats."
                    >
                      <RefreshCw size={16} />{mpstatsCharacteristicsStatus === "loading" ? "Обновляем аналитику" : "Обновить аналитику"}
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
                    <div className="field-box-head">
                      <strong>Черновик заголовка</strong>
                      <button
                        className={loadingButtonClass("btn mini", semanticContentBusyAction === "title")}
                        type="button"
                        onClick={() => reoptimizeContentFromSemanticCore({ sections: ["title"] })}
                        disabled={!canReoptimizeContent}
                        aria-busy={semanticContentBusyAction === "title" || undefined}
                        title={semanticReoptimizeUnavailableTitle || "Подготовить только новый вариант заголовка по сохраненному СЯ, не меняя описание и характеристики."}
                      >
                        <WandSparkles size={14} />{semanticContentBusyAction === "title" ? "Готовим" : "Еще вариант заголовка"}
                      </button>
                    </div>
                    <textarea
                      className={["audit", "semantic"].includes(draftTitleSource) ? "short audit-suggestion-field" : "short"}
                      value={draftTitle}
                      disabled={approvalReadOnly}
                      onChange={(event) => {
                        setDraftTitle(event.target.value);
                        setDraftTitleSource(event.target.value.trim() ? "manual" : "");
                        setDraftTitleReason("");
                      }}
                      placeholder="Введите новый заголовок или подготовьте черновик автоматически."
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
                    <div className="field-box-head">
                      <strong>Черновик описания</strong>
                      <button
                        className={loadingButtonClass("btn mini", semanticContentBusyAction === "description")}
                        type="button"
                        onClick={() => reoptimizeContentFromSemanticCore({ sections: ["description"] })}
                        disabled={!canReoptimizeContent}
                        aria-busy={semanticContentBusyAction === "description" || undefined}
                        title={semanticReoptimizeUnavailableTitle || "Подготовить только новый вариант описания по сохраненному СЯ, не меняя заголовок и характеристики."}
                      >
                        <WandSparkles size={14} />{semanticContentBusyAction === "description" ? "Готовим" : "Еще вариант описания"}
                      </button>
                    </div>
                    <textarea
                      className={`description-editor ${["audit", "semantic"].includes(draftDescriptionSource) ? "audit-suggestion-field" : ""}`}
                      value={draftDescription}
                      disabled={approvalReadOnly}
                      onChange={(event) => {
                        setDraftDescription(event.target.value);
                        setDraftDescriptionSource(event.target.value.trim() ? "manual" : "");
                        setDraftDescriptionReason("");
                      }}
                      placeholder="Введите новое описание или подготовьте черновик автоматически."
                    />
                    <DraftSourceMark source={draftDescriptionSource} />
                    <DraftReason reason={draftDescriptionReason} />
                    <DescriptionKeywordCoverage
                      description={draftDescription}
                      keywords={descriptionKeywordRows}
                      helpEnabled={helpEnabled}
                      onReoptimizeMissing={(rows) => reoptimizeContentFromSemanticCore({ sections: ["description"], desiredKeywords: rows })}
                      reoptimizeDisabled={!canReoptimizeContent}
                      reoptimizeBusy={semanticContentBusyAction === "description"}
                      reoptimizeTitle={semanticReoptimizeUnavailableTitle || "Попросить следующий вариант описания по возможности учесть выбранные непокрытые ключи."}
                    />
                  </div>
                  <div className="field-box characteristics-diff-box">
                    <div className="field-box-head">
                      <strong>Характеристики</strong>
                      <button
                        className={loadingButtonClass("btn mini", semanticContentBusyAction === "characteristics")}
                        type="button"
                        onClick={() => reoptimizeContentFromSemanticCore({ sections: ["characteristics"] })}
                        disabled={!canReoptimizeContent}
                        aria-busy={semanticContentBusyAction === "characteristics" || undefined}
                        title={semanticReoptimizeUnavailableTitle || "Подготовить только новый вариант характеристик по сохраненному СЯ, не меняя заголовок и описание."}
                      >
                        <WandSparkles size={14} />{semanticContentBusyAction === "characteristics" ? "Готовим" : "Еще вариант характеристик"}
                      </button>
                    </div>
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
                  <button className="btn" type="button" onClick={() => downloadDraftTable("content")} disabled={!canDownloadFinalContent} title={canDownloadFinalContent ? "Скачать контент карточки для согласования" : "Сначала отправьте секцию Контент на согласование"}>
                    <Download size={17} />Скачать итоговый контент
                  </button>
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
                  saveError={draftSaveError}
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
                      {draftSaveStatus === "approval-save-error" ? <p>{draftSaveError || "Решение не сохранилось на backend. Статус вернули назад, попробуйте еще раз."}</p> : null}
                      {draftSaveStatus === "error" || draftSaveStatus === "local-error" ? <p>{draftSaveError || "Черновик не удалось сохранить. Не обновляйте страницу и попробуйте еще раз."}</p> : null}
                  </div>
                  <div className="draft-buttons">
                    <button className={loadingButtonClass("btn primary", draftSaveStatus === "saving")} type="button" onClick={saveDraft} disabled={approvalReadOnly || draftSaveStatus === "saving"} aria-busy={draftSaveStatus === "saving" || undefined}><Save size={17} />{draftSaveStatus === "saving" ? "Сохраняем" : "Сохранить"}</button>
                    <button className={loadingButtonClass("btn", draftSaveStatus === "resetting")} type="button" onClick={resetDraft} disabled={approvalReadOnly || draftSaveStatus === "resetting"} aria-busy={draftSaveStatus === "resetting" || undefined}><RotateCcw size={17} />{draftSaveStatus === "resetting" ? "Сбрасываем" : "Сбросить"}</button>
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
  helpEnabled = false,
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
          <h2>Товарный аудит</h2>
          <p>Конкуренты, добавленные специалистом вручную: до {topCompetitorLimit} карточек для сравнения цены, текста, характеристик и изменений по версиям MPStats.</p>
        </div>
        <Tag tone={criticalCount ? "amber" : competitors.length ? "blue" : "green"}>
          {criticalCount ? `${criticalCount} сигнал` : `${competitors.length}/${topCompetitorLimit}`}
        </Tag>
      </div>
      <HelpList
        enabled={helpEnabled}
        title="Как сделать товарный аудит"
        items={[
          `Добавьте вручную до ${topCompetitorLimit} WB-конкурентов, которые действительно похожи на нашу карточку по товару и цене.`,
          "Нажмите Проверить карточки или Обновить снимки: MPStats сохранит цену, текст, характеристики и изменения конкурента.",
          "Если у конкурента появилось важное изменение, используйте Переоптимизировать, чтобы подготовить новый черновик описания.",
        ]}
      />
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
        <button className={loadingButtonClass("btn primary", status === "suggesting")} type="button" onClick={onSuggest} disabled={!enabled || busy || !competitors.length} aria-busy={status === "suggesting" || undefined}>
          <Search size={17} />{status === "suggesting" ? "Проверяем" : "Проверить карточки"}
        </button>
        <button className={loadingButtonClass("btn", status === "saving")} type="button" onClick={onAdd} disabled={!enabled || busy || competitors.length >= topCompetitorLimit} aria-busy={status === "saving" || undefined}>
          <Plus size={17} />{status === "saving" ? "Добавляем" : "Добавить"}
        </button>
        <button className={loadingButtonClass("btn", status === "refreshing" || status === "loading")} type="button" onClick={onRefresh} disabled={!enabled || busy || !competitors.length} aria-busy={status === "refreshing" || status === "loading" || undefined}>
          <RefreshCw size={17} />{status === "refreshing" || status === "loading" ? "Обновляем снимки" : "Обновить снимки"}
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
              status={status}
              onRemove={onRemove}
              onReoptimizeChange={onReoptimizeChange}
              onSkipChange={onSkipChange}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>Товарный аудит еще не начат</strong>
          <span>Добавьте до {topCompetitorLimit} WB-конкурентов вручную, затем зафиксируйте цену, текст и характеристики через MPStats.</span>
        </div>
      )}
    </section>
  );
}

function CompetitorCard({ competitor, busy, status, onRemove, onReoptimizeChange, onSkipChange }) {
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
              <button className={loadingButtonClass("btn primary", status === "change-reoptimizing")} type="button" onClick={() => onReoptimizeChange(competitor)} disabled={busy} aria-busy={status === "change-reoptimizing" || undefined}>
                <WandSparkles size={17} />{status === "change-reoptimizing" ? "Переоптимизируем" : "Переоптимизировать"}
              </button>
              <button className={loadingButtonClass("btn", status === "change-skipping")} type="button" onClick={() => onSkipChange(competitor)} disabled={busy} aria-busy={status === "change-skipping" || undefined}>
                <X size={17} />{status === "change-skipping" ? "Пропускаем" : "Пропустить изменение"}
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
  saveError = "",
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
            <button className={loadingButtonClass("btn", busy)} type="button" onClick={() => onReturn?.()} disabled={busy || !comment.trim()} aria-busy={busy || undefined}><RotateCcw size={17} />На доработку</button>
            <button className={loadingButtonClass("btn primary", busy)} type="button" onClick={() => onApprove?.()} disabled={busy} aria-busy={busy || undefined}><CheckSquare size={17} />Принято</button>
          </div>
        </div>
      ) : null}
      {canSubmit ? (
        <div className="approval-buttons">
            <button className={loadingButtonClass("btn primary", busy)} type="button" onClick={() => onSubmit?.()} disabled={busy} aria-busy={busy || undefined}>
              <Upload size={17} />Отправить на согласование
            </button>
        </div>
      ) : null}
      {status === "approval-submitted" ? (
        <div className="approval-note">
          <span>Статус сохранен</span>
          <p>Блок отправлен аккаунт-менеджеру на согласование.</p>
        </div>
      ) : null}
      {status === "approval-save-error" ? (
        <div className="approval-note">
          <span>Не сохранилось</span>
          <p>{saveError || "Backend не принял изменение статуса. Проверьте доступ и попробуйте отправить еще раз."}</p>
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
    opened: "открыта в конвейере",
    skipped: "пропущена",
    deferred: "перенесена на позже",
    quick_completed: "закрыта быстрым действием",
    audit_completed: "черновик аудита готов",
    audit_failed: "черновик аудита не подготовлен",
    content_reoptimized: "контент переоптимизирован по СЯ",
    content_reoptimize_failed: "переоптимизация по СЯ не выполнена",
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
    return { tone: "green", label: emptyText || "без черновика", reason: "Подготовьте черновик любым доступным способом или внесите ручную правку." };
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

function contentDraftMethodState({ titleSource, descriptionSource, auditCharacteristicsCount }) {
  const sources = [titleSource, descriptionSource].filter(Boolean);
  if (sources.includes("competitor")) {
    return {
      tone: "blue",
      label: "по конкуренту",
      title: "Источник черновика",
      copy: "Заголовок и описание обновлены по изменению конкурента. Характеристики остаются зоной ручной проверки специалиста.",
    };
  }
  if (sources.includes("semantic")) {
    return {
      tone: "blue",
      label: "итоговое СЯ",
      title: "Источник черновика",
      copy: "Контент переоптимизирован по согласованному СЯ. Для WB заголовок и описание собираются по WB-методологии, характеристики проверяются только по фактическим полям и справочнику.",
    };
  }
  if (sources.includes("audit") || auditCharacteristicsCount) {
    return {
      tone: "blue",
      label: "аудит карточки",
      title: "Источник черновика",
      copy: "Черновик подготовлен аудитом по данным WB, MPStats и конкурентному контексту. Поля можно поправить вручную перед согласованием.",
    };
  }
  if (sources.includes("manual")) {
    return {
      tone: "blue",
      label: "ручная правка",
      title: "Источник черновика",
      copy: "Черновик изменен специалистом вручную. После проверки его можно отправить на согласование.",
    };
  }
  return {
    tone: "green",
    label: "пусто",
    title: "Источник черновика",
    copy: "Черновик еще не подготовлен. Аудит, переоптимизация по СЯ и ручные правки сохраняют результат в этот блок.",
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
  const methodState = contentDraftMethodState({ titleSource, descriptionSource, auditCharacteristicsCount });
  const hasSemanticSource = [titleSource, descriptionSource].includes("semantic");
  const characteristicsCopy = auditCharacteristicsCount
    ? `Аудит подготовил ${auditCharacteristicsCount} ${pluralRu(auditCharacteristicsCount, "поле", "поля", "полей")}. ${mpstatsStatus}.`
    : hasSemanticSource
      ? "После переоптимизации по СЯ проверьте характеристики отдельно: ключи можно вносить только в релевантные фактические поля WB без переспама."
      : "Можно править вручную или добавить поля из справочника WB.";
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
        <p>{characteristicsCopy}</p>
      </div>
      <div className="content-audit-card">
        <div>
          <strong>{methodState.title}</strong>
          <Tag tone={methodState.tone}>{methodState.label}</Tag>
        </div>
        <p>{methodState.copy}</p>
      </div>
    </div>
  );
}

function DescriptionKeywordCoverage({
  description,
  keywords,
  helpEnabled = false,
  onReoptimizeMissing = null,
  reoptimizeDisabled = false,
  reoptimizeBusy = false,
  reoptimizeTitle = "",
}) {
  const text = String(description || "").trim();
  const [activeKey, setActiveKey] = useState("");
  const [missingOpen, setMissingOpen] = useState(false);
  const [selectedMissingKeys, setSelectedMissingKeys] = useState([]);
  const visibleKeywords = Array.isArray(keywords) ? keywords : [];
  const highlight = buildDescriptionKeywordHighlights(text, visibleKeywords);
  const matchedCount = highlight.counts.size;
  const matchedKeywords = visibleKeywords.filter((keyword) => (highlight.counts.get(keyword.key) || 0) > 0);
  const missingKeywords = visibleKeywords.filter((keyword) => !(highlight.counts.get(keyword.key) || 0));
  const missingSignature = missingKeywords.map((keyword) => keyword.key).join("|");
  useEffect(() => {
    const allowedKeys = new Set(missingKeywords.map((keyword) => keyword.key));
    setSelectedMissingKeys((current) => current.filter((key) => allowedKeys.has(key)));
  }, [missingSignature]);
  if (!text && !helpEnabled) {
    return null;
  }
  const activeTitle = activeKey
    ? visibleKeywords.find((item) => item.key === activeKey)?.query || ""
    : "";
  const selectedMissing = missingKeywords.filter((keyword) => selectedMissingKeys.includes(keyword.key));
  const selectedMissingCount = selectedMissing.length;
  const toggleMissingKeyword = (key) => {
    setSelectedMissingKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  };
  return (
    <div className="description-keyword-coverage">
      <div className="description-keyword-head">
        <div>
          <strong>Покрытие ключей в описании</strong>
          <span>{visibleKeywords.length ? `${matchedCount} из ${visibleKeywords.length} ${pluralRu(visibleKeywords.length, "ключ", "ключа", "ключей")} найдено в тексте` : "нет выбранных ключей для подсветки"}</span>
        </div>
        <Tag tone={matchedCount ? "blue" : "amber"}>{visibleKeywords.length ? `${matchedCount}/${visibleKeywords.length}` : "нет ключей"}</Tag>
      </div>
      <HelpHint enabled={helpEnabled} title="Как читать подсветку">
        Цветной фрагмент показывает, какой кусок черновика закрывает конкретный ключ. Наведите на ключ в легенде или на фрагмент текста, чтобы увидеть связь; если ключ серый, его пока нет в описании. Общие однословные ключи вроде "очки" не входят в основной счетчик.
      </HelpHint>
      {matchedKeywords.length ? (
        <div className="description-keyword-legend">
          {matchedKeywords.map((keyword) => {
            const count = highlight.counts.get(keyword.key) || 0;
            const active = activeKey === keyword.key;
            return (
              <button
                className={`description-keyword-chip tone-${keyword.tone} ${count ? "matched" : "missing"} ${active ? "active" : ""}`}
                type="button"
                key={keyword.key}
                onMouseEnter={() => setActiveKey(keyword.key)}
                onFocus={() => setActiveKey(keyword.key)}
                onMouseLeave={() => setActiveKey("")}
                onBlur={() => setActiveKey("")}
                onClick={() => setActiveKey((current) => (current === keyword.key ? "" : keyword.key))}
                title={count ? `Найдено в описании: ${count}` : "Ключ пока не найден в описании"}
              >
                <span>{keyword.query}</span>
                <em>{count ? `${count}x` : "нет"}</em>
              </button>
            );
          })}
        </div>
      ) : null}
      {visibleKeywords.length && !matchedKeywords.length ? (
        <div className="description-keyword-empty">
          <span>Покрытых ключей пока нет</span>
        </div>
      ) : null}
      {missingKeywords.length ? (
        <div className="description-keyword-missing">
          <div className="description-keyword-missing-head">
            <button
              className="btn ghost mini"
              type="button"
              onClick={() => setMissingOpen((value) => !value)}
            >
              {missingOpen ? <X size={14} /> : <Plus size={14} />}
              {missingOpen ? "Скрыть непокрытые" : `Показать непокрытые (${missingKeywords.length})`}
            </button>
            {selectedMissingCount ? (
              <button
                className={loadingButtonClass("btn primary mini", reoptimizeBusy)}
                type="button"
                onClick={() => onReoptimizeMissing?.(selectedMissing)}
                disabled={reoptimizeDisabled || reoptimizeBusy}
                aria-busy={reoptimizeBusy || undefined}
                title={reoptimizeTitle || "Попросить следующий вариант описания по возможности учесть выбранные непокрытые ключи."}
              >
                <WandSparkles size={14} />{reoptimizeBusy ? "Готовим" : `Попробовать учесть (${selectedMissingCount})`}
              </button>
            ) : null}
          </div>
          {missingOpen ? (
            <div className="description-keyword-missing-panel">
              <div className="description-keyword-missing-tools">
                <span>{selectedMissingCount ? `${selectedMissingCount} выбрано` : "Выберите желательные ключи для следующего варианта описания"}</span>
                {selectedMissingCount ? (
                  <button className="btn ghost mini" type="button" onClick={() => setSelectedMissingKeys([])}>
                    <X size={14} />Снять выбор
                  </button>
                ) : null}
              </div>
              <div className="description-keyword-legend missing-list">
                {missingKeywords.map((keyword) => {
                  const active = activeKey === keyword.key;
                  const selected = selectedMissingKeys.includes(keyword.key);
                  return (
                    <button
                      className={`description-keyword-chip selectable missing ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                      type="button"
                      key={keyword.key}
                      onMouseEnter={() => setActiveKey(keyword.key)}
                      onFocus={() => setActiveKey(keyword.key)}
                      onMouseLeave={() => setActiveKey("")}
                      onBlur={() => setActiveKey("")}
                      onClick={() => toggleMissingKeyword(keyword.key)}
                      title={selected ? "Убрать из следующей переоптимизации" : "Добавить в следующую переоптимизацию описания"}
                    >
                      <span>{keyword.query}</span>
                      <em>{selected ? "выбран" : "нет"}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`description-highlighted-text ${activeKey ? "has-active" : ""}`}>
        {text ? highlight.segments.map((segment) => (
          segment.type === "match" ? (
            <mark
              className={`keyword-highlight tone-${segment.match.keyword.tone} ${activeKey === segment.match.keyword.key ? "active" : ""} ${activeKey && activeKey !== segment.match.keyword.key ? "muted" : ""}`}
              key={segment.key}
              title={`Ключ: ${segment.match.keyword.query}`}
              onMouseEnter={() => setActiveKey(segment.match.keyword.key)}
              onMouseLeave={() => setActiveKey("")}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={segment.key}>{segment.text}</span>
          )
        )) : (
          <span>Сначала появится черновик описания после аудита, переоптимизации или ручного ввода.</span>
        )}
      </div>
      {activeTitle ? <p className="description-keyword-active">Сейчас выделен ключ: {activeTitle}</p> : null}
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
  } else if (item?.field === "characteristics") {
    parts.push("найдено в характеристиках");
  } else if (item?.field === "title_characteristics") {
    parts.push("заголовок и характеристики");
  } else if (item?.field === "description_characteristics") {
    parts.push("описание и характеристики");
  } else if (item?.field === "title_description_characteristics") {
    parts.push("заголовок, описание и характеристики");
  }
  return parts.join(" · ");
}

function semanticFilterWords(value) {
  const words = [];
  const seen = new Set();
  String(value || "")
    .split(/[\s,;\n]+/)
    .map((item) => normalizedCharacteristicOption(item))
    .filter(Boolean)
    .forEach((word) => {
      if (seen.has(word) || words.length >= semanticExcludeWordsLimit) return;
      seen.add(word);
      words.push(word);
    });
  return words;
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

function keywordHighlightTokens(value) {
  const tokens = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  const text = String(value || "");
  let match = pattern.exec(text);
  while (match) {
    const token = normalizedCharacteristicOption(match[0]);
    const hasNumber = /\p{N}/u.test(token);
    if (token && (token.length >= 3 || hasNumber || text.split(/\s+/).length > 1)) {
      tokens.push({
        value: token,
        stem: semanticExclusionStem(token),
      });
    }
    match = pattern.exec(text);
  }
  return tokens.filter((token) => token.stem || /\p{N}/u.test(token.value));
}

function descriptionKeywordDisplayQuery(value) {
  return String(value || "")
    .trim()
    .replace(/[.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSingleDescriptionKeyword(tokens) {
  if (!Array.isArray(tokens) || tokens.length !== 1) {
    return false;
  }
  const token = tokens[0];
  return descriptionGenericSingleKeywords.has(token.value) || descriptionGenericSingleKeywords.has(token.stem);
}

function descriptionTextTokens(value) {
  const tokens = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  const text = String(value || "");
  let match = pattern.exec(text);
  while (match) {
    const raw = match[0];
    const normalized = normalizedCharacteristicOption(raw);
    tokens.push({
      raw,
      normalized,
      stem: semanticExclusionStem(normalized),
      start: match.index,
      end: match.index + raw.length,
    });
    match = pattern.exec(text);
  }
  return tokens;
}

function keywordTokenMatches(textToken, keywordToken) {
  if (!textToken?.normalized || !keywordToken?.value) return false;
  if (textToken.normalized === keywordToken.value) return true;
  if (keywordToken.stem.length < 4 || textToken.stem.length < 4) return false;
  return textToken.stem.startsWith(keywordToken.stem) || keywordToken.stem.startsWith(textToken.stem);
}

function descriptionKeywordCandidates(groups, limit = 140) {
  const rows = [];
  const seen = new Set();
  groups.forEach((group, groupIndex) => {
    (Array.isArray(group.items) ? group.items : []).forEach((item) => {
      const query = descriptionKeywordDisplayQuery(item?.query || item?.keyword || item?.text || "");
      const key = semanticQueryKey({ query });
      if (!query || !key || seen.has(key)) return;
      const tokens = keywordHighlightTokens(query);
      if (!tokens.length) return;
      if (isGenericSingleDescriptionKeyword(tokens)) return;
      seen.add(key);
      rows.push({
        ...item,
        key,
        query,
        tokens,
        origin: group.origin || "",
        originLabel: group.label || "",
        priority: groupIndex,
        tone: descriptionKeywordTones[rows.length % descriptionKeywordTones.length],
      });
    });
  });
  return rows.slice(0, limit);
}

function buildDescriptionKeywordHighlights(textValue, keywords) {
  const text = String(textValue || "");
  const textTokens = descriptionTextTokens(text);
  const potentials = [];
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : []).filter((item) => item?.tokens?.length);
  normalizedKeywords.forEach((keyword, keywordIndex) => {
    const tokens = keyword.tokens || [];
    if (!tokens.length || tokens.length > textTokens.length) return;
    for (let index = 0; index <= textTokens.length - tokens.length; index += 1) {
      const windowTokens = textTokens.slice(index, index + tokens.length);
      const matched = tokens.every((token, tokenIndex) => keywordTokenMatches(windowTokens[tokenIndex], token));
      if (!matched) continue;
      const start = windowTokens[0].start;
      const end = windowTokens[windowTokens.length - 1].end;
      potentials.push({
        keyword,
        keywordIndex,
        start,
        end,
        text: text.slice(start, end),
        score: tokens.length * 1000 + (end - start),
      });
    }
  });
  const accepted = [];
  potentials
    .sort((left, right) => right.score - left.score || left.keywordIndex - right.keywordIndex || left.start - right.start)
    .forEach((match) => {
      const overlaps = accepted.some((item) => match.start < item.end && match.end > item.start);
      if (!overlaps) accepted.push(match);
    });
  accepted.sort((left, right) => left.start - right.start);
  const counts = new Map();
  potentials.forEach((match) => {
    counts.set(match.keyword.key, (counts.get(match.keyword.key) || 0) + 1);
  });
  const segments = [];
  let cursor = 0;
  accepted.forEach((match, index) => {
    if (match.start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, match.start), key: `text-${index}-${cursor}` });
    }
    segments.push({ type: "match", text: text.slice(match.start, match.end), match, key: `match-${index}-${match.start}` });
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor), key: `text-tail-${cursor}` });
  }
  return { segments, matches: accepted, counts };
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

function SemanticCorePanel({ semanticCore, compact = false, standalone = false, subjectFilter = "", search = "", excludeWords = "", removalRows = [], onTakeKeyword = null, onRemoveKeyword = null, onToggleRemoveKeyword = null, readOnly = false }) {
  const current = Array.isArray(semanticCore?.current) ? semanticCore.current : [];
  const selectedItems = semanticSelectedExportRows(current.filter((item) => item.status === "selected"), semanticCore);
  const contentItems = semanticCurrentContentRows(semanticCore);
  const positionItems = semanticCurrentPositionRows(semanticCore);
  const removalItems = semanticRemovalExportRows(removalRows, semanticCore);
  const existingKeys = semanticExistingQueryKeys(semanticCore);
  const selectedKeys = new Set(selectedItems.map(semanticQueryKey));
  const removalKeys = new Set(removalItems.map(semanticQueryKey).filter(Boolean));
  const contentKeys = new Set(contentItems.map(semanticQueryKey).filter(Boolean));
  const positionKeys = new Set(positionItems.map(semanticQueryKey).filter(Boolean));
  const sourceItems = semanticCandidateSourceRows(semanticCore);
  const coverage = semanticCore?.coveragePercent;
  const selectedLimit = compact ? 4 : standalone ? 100 : 8;
  const currentLimit = compact ? 4 : standalone ? 100 : 8;
  const workLimit = compact ? 4 : standalone ? 100 : 8;
  const selectedPageSize = standalone ? 100 : selectedLimit;
  const currentPageSize = standalone ? 100 : currentLimit;
  const workPageSize = standalone ? 100 : workLimit;
  const [visibleSelectedLimit, setVisibleSelectedLimit] = useState(selectedLimit);
  const [visibleCurrentLimit, setVisibleCurrentLimit] = useState(currentLimit);
  const [visibleWorkLimit, setVisibleWorkLimit] = useState(workLimit);
  const [metricFilter, setMetricFilter] = useState("all");
  const searchText = String(search || "").trim().toLowerCase();
  const excludedWords = semanticFilterWords(excludeWords);
  const reportTotal = semanticCore?.totalKeywords || sourceItems.length || positionItems.length + selectedItems.length;
  const expansionPeriod = semanticPeriodLabel(semanticCore?.period);
  const rankingPeriod = semanticPeriodLabel(semanticCore?.rankingPeriod || semanticCore?.period);
  const filteredPositionItems = positionItems
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredContentItems = contentItems
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredRemovalItems = removalItems
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredPositionKeys = new Set(filteredPositionItems.map(semanticQueryKey).filter(Boolean));
  const filteredContentOnlyItems = filteredContentItems
    .filter((item) => !filteredPositionKeys.has(semanticQueryKey(item)));
  const filteredSourceItems = sourceItems
    .filter((item) => !subjectFilter || item.prioritySubject === subjectFilter)
    .filter((item) => !semanticMatchesExclusion(item.query, excludedWords))
    .filter((item) => !searchText || `${item.query || ""} ${item.cluster || ""} ${item.prioritySubject || ""}`.toLowerCase().includes(searchText));
  const filteredWorkItems = filteredSourceItems
    .filter((item) => {
      const key = semanticQueryKey(item);
      return key && !existingKeys.has(key) && !selectedKeys.has(key) && semanticFrequencyValue(item);
    });
  useEffect(() => {
    setVisibleSelectedLimit(selectedLimit);
    setVisibleCurrentLimit(currentLimit);
    setVisibleWorkLimit(workLimit);
  }, [selectedLimit, currentLimit, workLimit, subjectFilter, searchText, excludeWords, metricFilter, semanticCore?.seedQuery, reportTotal]);
  useEffect(() => {
    setMetricFilter("all");
  }, [semanticCore?.seedQuery, reportTotal]);
  const toggleMetricFilter = (filter) => {
    setMetricFilter((currentFilter) => (currentFilter === filter ? "all" : filter));
  };
  const displayedSelectedItems = metricFilter === "selected" || metricFilter === "all" ? selectedItems : [];
  const displayedCurrentItems = metricFilter === "remove"
    ? filteredRemovalItems
    : metricFilter === "positions"
      ? filteredPositionItems
      : metricFilter === "content"
        ? filteredContentItems
        : metricFilter === "all"
          ? [...filteredPositionItems, ...filteredContentOnlyItems]
          : [];
  const visibleWorkCount = Math.min(visibleWorkLimit, filteredWorkItems.length);
  const visibleSelectedCount = Math.min(visibleSelectedLimit, displayedSelectedItems.length);
  const visibleCurrentCount = Math.min(visibleCurrentLimit, displayedCurrentItems.length);
  const leftListTitle = metricFilter === "positions"
    ? "Ранжирующиеся запросы"
    : metricFilter === "content"
      ? "Ключи в карточке (действующие)"
      : metricFilter === "selected"
        ? "Добавленные в работу"
        : metricFilter === "remove"
          ? "К удалению из карточки"
          : "Ключи в карточке и ранжирующиеся запросы";
  const showWorkColumn = metricFilter === "all";
  return (
    <div className={`issue semantic-core-panel ${compact ? "compact" : ""} ${standalone ? "standalone" : ""}`}>
      <div className="issue-head">
        <strong>Семантическое ядро</strong>
        <Tag tone={removalItems.length ? "red" : filteredWorkItems.length ? "amber" : "green"}>{removalItems.length ? `${formatNumber(removalItems.length)} к удал.` : positionItems.length ? `${formatNumber(positionItems.length)} ранж.` : coverage === null || coverage === undefined ? "MPStats" : `${coverage}% покрытие`}</Tag>
      </div>
      <p>{semanticCore?.reason || "MPStats собирает действующие позиции карточки и расширение по стартовой фразе."}</p>
      {standalone ? (
        <div className="semantic-core-metrics">
          <SemanticMetric
            active={metricFilter === "positions"}
            label="Ранжирующиеся"
            value={formatNumber(positionItems.length)}
            hint={`Запросы из отчета позиций карточки MPStats${rankingPeriod ? ` за ${rankingPeriod}` : ""}. По ним карточка уже ранжируется.`}
            onClick={() => toggleMetricFilter("positions")}
          />
          <SemanticMetric
            active={metricFilter === "content"}
            label="Ключи в карточке"
            value={formatNumber(contentItems.length)}
            hint="Действующие ключи, которые уже заложены в заголовок или описание карточки. По ним может не быть позиции."
            onClick={() => toggleMetricFilter("content")}
          />
          <SemanticMetric
            active={metricFilter === "remove"}
            label="К удалению"
            value={formatNumber(removalItems.length)}
            hint="Ключи карточки и ранжирующиеся запросы, которые попадут в отчет как предложение исключить перед переоптимизацией."
            onClick={() => toggleMetricFilter("remove")}
          />
          <SemanticMetric
            active={metricFilter === "selected"}
            label="К добавлению"
            value={formatNumber(selectedItems.length)}
            hint="Новые запросы, которых нет среди ключей карточки и ранжирующихся запросов. В Excel попадут только запросы с частотностью WB."
            onClick={() => toggleMetricFilter("selected")}
          />
          <SemanticMetric
            label="Кандидаты"
            value={formatNumber(filteredWorkItems.length)}
            hint="Новые запросы из текущей подборки MPStats после фильтров, слов-исключений, дублей, ключей карточки и ранжирующихся запросов."
            onClick={() => setMetricFilter("all")}
          />
          <SemanticMetric
            label="Расширение MPStats"
            value={formatNumber(reportTotal)}
            hint={`Общий размер SEO-расширения MPStats по стартовой фразе${expansionPeriod ? ` за ${expansionPeriod}` : ""}. Это не то же самое, что позиции карточки.`}
            onClick={() => setMetricFilter("all")}
          />
        </div>
      ) : null}
      <div className={`semantic-core-grid ${showWorkColumn ? "" : "single"}`}>
        <div>
          <span>{leftListTitle}</span>
          <div className="semantic-keyword-list">
            {displayedSelectedItems.length ? displayedSelectedItems.slice(0, visibleSelectedLimit).map((item) => (
              <div className="semantic-keyword selected" key={`selected-${item.query}`}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{semanticKeywordMeta(item) || "взято в работу"}</em>
                  {semanticHasKeywordRank(item) ? <span className="semantic-keyword-rank">{semanticKeywordRankLabel(item)}</span> : null}
                </div>
                {standalone && onRemoveKeyword ? (
                  <button className="btn mini" type="button" onClick={() => onRemoveKeyword(item)} disabled={readOnly}>
                    <X size={14} />Убрать
                  </button>
                ) : null}
              </div>
            )) : null}
            {displayedSelectedItems.length > visibleSelectedLimit ? (
              <div className="semantic-list-footer">
                <p>Показано {formatNumber(visibleSelectedCount)} из {formatNumber(displayedSelectedItems.length)} добавленных.</p>
                {standalone ? (
                  <div>
                    <button className="btn mini" type="button" onClick={() => setVisibleSelectedLimit((value) => Math.min(value + selectedPageSize, displayedSelectedItems.length))}>
                      Открыть следующие {formatNumber(Math.min(selectedPageSize, displayedSelectedItems.length - visibleSelectedCount))}
                    </button>
                    <button className="btn mini" type="button" onClick={() => setVisibleSelectedLimit(displayedSelectedItems.length)}>
                      Показать все
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {displayedCurrentItems.length ? displayedCurrentItems.slice(0, visibleCurrentLimit).map((item) => {
              const key = semanticQueryKey(item);
              const markedForRemoval = removalKeys.has(key) || metricFilter === "remove";
              const canToggleRemoval = standalone && onToggleRemoveKeyword && (contentKeys.has(key) || positionKeys.has(key) || markedForRemoval);
              return (
                <div className={`semantic-keyword${markedForRemoval ? " remove" : ""}`} key={`current-${metricFilter}-${key || item.query}`}>
                  <div className="semantic-keyword-main">
                    <strong>{item.query}</strong>
                    <em>{markedForRemoval ? semanticRemovalReason(item) : semanticKeywordMeta(item) || (semanticHasKeywordRank(item) ? "ранжирующийся запрос карточки" : "действующий ключ в карточке")}</em>
                    {standalone ? (
                      <span className={`semantic-keyword-rank ${semanticHasKeywordRank(item) ? "" : "muted"}`}>
                        {semanticKeywordRankLabel(item)}
                      </span>
                    ) : null}
                  </div>
                  {standalone && (markedForRemoval || canToggleRemoval) ? (
                    <div className="semantic-keyword-actions">
                      {markedForRemoval ? <Tag tone="red">к удалению</Tag> : null}
                      {canToggleRemoval ? (
                        <button className={`btn mini${markedForRemoval ? "" : " danger"}`} type="button" onClick={() => onToggleRemoveKeyword(item)} disabled={readOnly}>
                          {markedForRemoval ? <RotateCcw size={14} /> : <Trash2 size={14} />}{markedForRemoval ? "Оставить" : "К удалению"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            }) : null}
            {displayedCurrentItems.length > visibleCurrentLimit ? (
              <div className="semantic-list-footer">
                <p>Показано {formatNumber(visibleCurrentCount)} из {formatNumber(displayedCurrentItems.length)} ключей.</p>
                {standalone ? (
                  <div>
                    <button className="btn mini" type="button" onClick={() => setVisibleCurrentLimit((value) => Math.min(value + currentPageSize, displayedCurrentItems.length))}>
                      Открыть следующие {formatNumber(Math.min(currentPageSize, displayedCurrentItems.length - visibleCurrentCount))}
                    </button>
                    <button className="btn mini" type="button" onClick={() => setVisibleCurrentLimit(displayedCurrentItems.length)}>
                      Показать все
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!displayedSelectedItems.length && !displayedCurrentItems.length ? <p>{metricFilter === "positions" ? "Ранжирующихся запросов пока нет." : metricFilter === "content" ? "Действующих ключей в карточке пока нет." : metricFilter === "selected" ? "Новых запросов к добавлению пока нет." : metricFilter === "remove" ? "Ключей к удалению пока нет." : "Пока нет данных для итогового файла."}</p> : null}
          </div>
        </div>
        {showWorkColumn ? (
        <div>
          <span>Новые запросы MPStats · к добавлению {formatNumber(filteredWorkItems.length)}</span>
          <div className="semantic-keyword-list">
            {filteredWorkItems.slice(0, visibleWorkLimit).map((item) => (
              <div className="semantic-keyword recommended" key={`recommended-${item.query}`}>
                <div className="semantic-keyword-main">
                  <strong>{item.query}</strong>
                  <em>{semanticKeywordMeta(item) || item.reason || "нет в текущем контенте"}</em>
                </div>
                <div className="semantic-keyword-actions">
                  {semanticFrequencyValue(item) ? (
                    <Tag tone={semanticFrequencyBucket(item) === "high" ? "amber" : "blue"}>
                      {semanticFrequencyBucketLabel(semanticFrequencyBucket(item))}
                    </Tag>
                  ) : null}
                  {standalone && onTakeKeyword ? (
                    <button className="btn mini" type="button" onClick={() => onTakeKeyword(item)} disabled={readOnly}>
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
            {!filteredWorkItems.length ? <p>Новых запросов с частотностью по текущим фильтрам нет.</p> : null}
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
  const characteristicMetaByKey = characteristicMetaLookup(availableCharacteristics);
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
      const nameKey = characteristicKeyFromName(item.name || item.label || "");
      if (selectedKeys.has(key) || selectedKeys.has(nameKey) || baseKeys.has(key) || baseKeys.has(nameKey)) {
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
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading} aria-busy={loading || undefined}>{loading ? (mode === "manual" && !isReplacement ? "Создаем..." : "Проверяем...") : (isReplacement ? "Заменить ключ" : (mode === "manual" ? "Создать без API" : "Добавить кабинет"))}</button>
        </div>
      </form>
    </div>
  );
}

function OzonPortalModal({ client, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: `${client.name} Ozon`,
    scope: "selected",
    storeUrl: "",
    testSkus: "",
    manualSource: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function errorText(errorObject) {
    if (errorObject.message === "store_url_too_long") return "Ссылка или Seller ID слишком длинные.";
    if (errorObject.message === "manual_source_too_long") return "Комментарий по источнику слишком длинный.";
    if (errorObject.message === "client_name_too_long") return "Название клиента слишком длинное.";
    if (errorObject.status === 401) return "Сессия истекла. Войдите заново.";
    return "Не удалось создать Ozon-кабинет. Проверьте источник и попробуйте еще раз.";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const storeUrl = form.storeUrl.trim();
    const testSkus = form.testSkus.trim();
    const manualSource = form.manualSource.trim();
    const scope = form.scope === "full" ? "full" : "selected";
    if (scope === "full" && !storeUrl && !manualSource) {
      setError("Для всего кабинета укажите ссылку на Ozon-кабинет или Seller ID.");
      return;
    }
    if (scope === "selected" && !testSkus) {
      setError("Для выбранных карточек вставьте артикулы или SKU.");
      return;
    }
    const sourceDetails = [
      scope === "selected" && testSkus ? `Ozon артикулы/SKU: ${testSkus}` : "",
      manualSource,
    ].filter(Boolean).join("\n");
    setLoading(true);
    try {
      const saved = await onSubmit({
        name: form.name.trim(),
        scope,
        storeUrl,
        manualSource: sourceDetails,
      });
      if (saved === false) {
        setError("Не удалось создать Ozon-кабинет. Проверьте источник и попробуйте еще раз.");
      }
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal ozon-connect-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Подключить Ozon beta</h2>
            <p>{client.name}: создаем Ozon-кабинет с источником для проверки через MPStats. WB-поток не меняется.</p>
          </div>
          <IconButton icon={X} label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">
          <div className="ozon-connect-mode">
            <div className="active">
              <strong>MPStats по ссылке</strong>
              <span>Сейчас: ссылка на кабинет, Seller ID или список SKU.</span>
            </div>
            <div className="disabled">
              <strong>Ozon Seller API</strong>
              <span>Позже: точные заказы, остатки, экономика и отчеты.</span>
            </div>
          </div>
          <div className="ozon-scope-toggle" role="group" aria-label="Охват Ozon-кабинета">
            <button className={form.scope === "selected" ? "active" : ""} type="button" onClick={() => update("scope", "selected")}>
              <strong>Выбранные карточки</strong>
              <span>Сохраняем только указанные артикулы или SKU.</span>
            </button>
            <button className={form.scope === "full" ? "active" : ""} type="button" onClick={() => update("scope", "full")}>
              <strong>Весь кабинет</strong>
              <span>Стартуем от ссылки на продавца или Seller ID.</span>
            </button>
          </div>
          <label className="field-label">
            Название Ozon-кабинета
            <input value={form.name} onChange={(event) => update("name", event.target.value)} maxLength={120} />
          </label>
          <label className="field-label">
            Ссылка на Ozon-кабинет, Seller ID или карточку
            <input value={form.storeUrl} onChange={(event) => update("storeUrl", event.target.value)} placeholder="https://www.ozon.ru/seller/... или Seller ID" autoFocus />
          </label>
          {form.scope === "selected" ? (
            <label className="field-label">
              Артикулы или SKU
              <textarea value={form.testSkus} onChange={(event) => update("testSkus", event.target.value)} placeholder="Например: 123456789, OZON-ART-01, 987654321. Эти позиции попадут в первую проверку MPStats." />
            </label>
          ) : null}
          <label className="field-label">
            Что есть на старте
            <textarea value={form.manualSource} onChange={(event) => update("manualSource", event.target.value)} placeholder={form.scope === "selected" ? "Например: комментарий по списку карточек, файл клиента или что проверить в первую очередь." : "Например: Seller ID, ссылка на продавца, файл клиента или комментарий по кабинету."} />
          </label>
          <div className="source-flow">
            <div className="list-row source-flow-row"><span>Создание</span><strong>Ozon beta</strong></div>
            <div className="list-row source-flow-row"><span>Охват</span><strong>{form.scope === "selected" ? "выбранные карточки" : "весь кабинет"}</strong></div>
            <div className="list-row source-flow-row"><span>Сохранение карточек</span><strong>после проверки MPStats</strong></div>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>Отмена</button>
          <button className={loadingButtonClass("btn primary", loading)} type="submit" disabled={loading || (form.scope === "selected" ? !form.testSkus.trim() : (!form.storeUrl.trim() && !form.manualSource.trim()))} aria-busy={loading || undefined}>
            <Plus size={16} />{loading ? "Создаем Ozon" : "Создать и открыть"}
          </button>
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
      title: "Рыночный аудит",
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
      title: "Товарный аудит",
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
        ? "Данные WB загружены. Рыночный аудит, черновики и товарный аудит появятся здесь после начала работы."
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
  portal_client_contact_updated: "Изменены контакты клиента",
  portal_created: "Кабинет создан",
  portal_name_updated: "Переименован кабинет",
  portal_archived: "Кабинет отправлен в архив",
  portal_restored: "Кабинет восстановлен",
  portal_deleted: "Кабинет удален",
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
  if (event?.action === "portal_client_contact_updated") {
    return [details.portalName || event.targetId || "Кабинет", (details.nextFields || []).join(", ")].filter(Boolean).join(" · ");
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
            className={loadingButtonClass("btn mini primary", saving)}
            type="button"
            disabled={disabled || !isDirty}
            onClick={() => onSave(user, userDraftPayload(draft))}
            aria-busy={saving || undefined}
          >
            {saving ? "Сохраняем" : "Сохранить"}
          </button>
          <button
            className={loadingButtonClass("btn mini", resetting)}
            type="button"
            onClick={() => onResetPassword(user.login)}
            disabled={!canManageUsers || resetting || !draft.isActive}
            aria-busy={resetting || undefined}
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
  const [adminStatusLoading, setAdminStatusLoading] = useState(false);
  const [mpstatsKey, setMpstatsKey] = useState("");
  const [mpstatsStatus, setMpstatsStatus] = useState("idle");
  const [mpstatsUsageStatus, setMpstatsUsageStatus] = useState("idle");
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
    setAdminStatusLoading(true);
    try {
      const payload = await apiRequest("/api/admin-status");
      setAdminStatus(payload);
    } catch {
      setAdminStatus(null);
    } finally {
      setAdminStatusLoading(false);
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

  async function downloadMpstatsUsageReport() {
    if (!canManage) {
      return;
    }
    setMpstatsUsageStatus("loading");
    try {
      const payload = await apiRequest("/api/admin/mpstats-usage?limit=5000");
      const summary = payload.summary || {};
      const events = Array.isArray(payload.events) ? payload.events : [];
      const detailsText = (details) => {
        if (!details || typeof details !== "object" || Array.isArray(details)) return "";
        return Object.entries(details)
          .filter(([, value]) => value !== "" && value !== null && value !== undefined)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
          .join("; ");
      };
      const generatedAt = new Date();
      downloadXlsx(`mpstats-api-usage-${generatedAt.toISOString().slice(0, 10)}.xlsx`, [
        {
          name: "Сводка",
          freezeRows: 1,
          widths: [34, 40],
          rows: [
            ["Показатель", "Значение"],
            ["Сформировано", generatedAt.toLocaleString("ru-RU")],
            ["Событий в файле", summary.eventCount || events.length],
            ["Внешних API-запросов", summary.apiRequests || 0],
            ["Кэш-хитов", summary.cacheHits || 0],
            ["Расход лимита MPStats", summary.creditsEstimate || 0],
            ["Остаток лимита MPStats", summary.balanceRemaining || "не передается API"],
            ["Комментарий по остатку", summary.balanceNote || ""],
            ["Первая запись", summary.firstAt || ""],
            ["Последняя запись", summary.lastAt || ""],
            ["Хранение журнала, дней", summary.retentionDays || ""],
          ],
        },
        {
          name: "Обращения",
          freezeRows: 1,
          widths: [22, 18, 24, 28, 14, 24, 16, 10, 58, 12, 12, 18, 14, 16, 46],
          rows: [
            [
              "Дата",
              "Пользователь",
              "ФИО",
              "Где нажимали",
              "Кабинет",
              "Карточка",
              "nmID",
              "Метод",
              "Запрос MPStats",
              "Источник",
              "HTTP",
              "Статус",
              "Расход",
              "Остаток",
              "Детали",
            ],
            ...events.map((event) => [
              event.createdAt ? new Date(event.createdAt).toLocaleString("ru-RU") : "",
              event.actorLogin || "",
              event.actorName || "",
              event.sourceArea || "",
              event.portalId || "",
              event.cardKey || "",
              event.nmID || "",
              event.method || "",
              event.path || "",
              event.source || "",
              event.httpStatus || "",
              event.status || "",
              event.creditsEstimate || 0,
              event.balanceRemaining || "",
              detailsText(event.details),
            ]),
          ],
        },
      ]);
      setMpstatsUsageStatus("done");
    } catch {
      setMpstatsUsageStatus("error");
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
                <button className={loadingButtonClass("btn primary", newUserStatus === "saving")} type="submit" disabled={!canManageUsers || newUserStatus === "saving"} aria-busy={newUserStatus === "saving" || undefined}><Save size={16} />{newUserStatus === "saving" ? "Создаем сотрудника" : "Создать сотрудника"}</button>
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
              <button className={loadingButtonClass("btn", adminEventsStatus === "loading")} type="button" onClick={loadAdminEvents} disabled={adminEventsStatus === "loading"} aria-busy={adminEventsStatus === "loading" || undefined}>
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
                <button className={loadingButtonClass("btn", adminStatusLoading)} type="button" onClick={loadAdminStatus} disabled={adminStatusLoading} aria-busy={adminStatusLoading || undefined}><RefreshCw size={16} />{adminStatusLoading ? "Обновляем статус" : "Обновить статус"}</button>
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
                  <button className={loadingButtonClass("btn primary", mpstatsStatus === "saving")} type="submit" disabled={!canManage || !mpstatsKey.trim() || mpstatsStatus === "saving"} aria-busy={mpstatsStatus === "saving" || undefined}><Save size={16} />{mpstatsStatus === "saving" ? "Сохраняем ключ" : "Сохранить ключ"}</button>
                  <button className={loadingButtonClass("btn", mpstatsStatus === "checking")} type="button" disabled={!canManage || !mpstatsConnected || mpstatsStatus === "checking"} onClick={checkMpstatsConnection} aria-busy={mpstatsStatus === "checking" || undefined}><RefreshCw size={16} />{mpstatsStatus === "checking" ? "Проверяем" : "Проверить"}</button>
                  <button className={loadingButtonClass("btn", mpstatsUsageStatus === "loading")} type="button" disabled={!canManage || mpstatsUsageStatus === "loading"} onClick={downloadMpstatsUsageReport} aria-busy={mpstatsUsageStatus === "loading" || undefined}>
                    <Download size={16} />{mpstatsUsageStatus === "loading" ? "Готовим журнал" : "Скачать журнал API"}
                  </button>
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
                  {mpstatsUsageStatus === "done" ? "Журнал MPStats API сформирован." : null}
                  {mpstatsUsageStatus === "error" ? "Не удалось сформировать журнал MPStats API." : null}
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
