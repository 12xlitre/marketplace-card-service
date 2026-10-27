import { useEffect, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";

export default function CabinetFilesDialog({ portalId, loadAvailability, revision, busy = false, disabled = false, exportStatus = "", onDownloadSemantic, onDownloadContent, onClose, children }) {
  const [availability, setAvailability] = useState({ status: "loading", semantic: false, content: false });
  const [retry, setRetry] = useState(0);
  const panelRef = useRef(null);
  const loaderRef = useRef(loadAvailability);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  loaderRef.current = loadAvailability;
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    let active = true;
    setAvailability({ status: "loading", semantic: false, content: false });
    Promise.resolve().then(() => loaderRef.current())
      .then((result) => { if (active) setAvailability({ ...result, status: "loaded" }); })
      .catch(() => { if (active) setAvailability({ status: "error", semantic: false, content: false }); });
    return () => { active = false; };
  }, [portalId, revision, retry]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("button")?.focus();
    function handleKey(event) {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const controls = [...panelRef.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href]")]
        .filter((element) => element.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Выгрузки кабинета" onClick={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="modal cabinet-files-dialog" ref={panelRef}>
        <div className="modal-head">
          <div><h2>Выгрузки кабинета</h2><p>Готовые файлы и загрузка согласованного СЯ.</p></div>
          <button className="icon-btn" type="button" aria-label="Закрыть выгрузки" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        <div className="modal-body">
          {availability.status === "loading" ? <p className="status-note" role="status">Проверяем сохранённые результаты…</p> : null}
          {availability.status === "error" ? <div className="form-error" role="alert">
            Не удалось проверить сохранённые результаты. <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>Повторить проверку</button>
          </div> : null}
          <CabinetExportRow title="Семантическое ядро" emptyText="СЯ ещё не подготовлено" available={availability.semantic} status={availability.status}>
            <button className="btn" type="button" onClick={onDownloadSemantic} disabled={disabled || busy} aria-busy={exportStatus === "semantic-loading" || undefined}>
              <Download size={16} />{exportStatus === "semantic-loading" ? "Собираем СЯ" : "Скачать итоговое СЯ по кабинету"}
            </button>
          </CabinetExportRow>
          <CabinetExportRow title="Итоговый контент" emptyText="Контент ещё не подготовлен" available={availability.content} status={availability.status}>
            <button className="btn" type="button" onClick={onDownloadContent} disabled={disabled || busy} aria-busy={exportStatus === "content-loading" || undefined}>
              <Download size={16} />{exportStatus === "content-loading" ? "Собираем контент" : "Скачать итоговый контент"}
            </button>
          </CabinetExportRow>
          {exportStatus.endsWith("error") ? <p className="form-error" role="alert">Не удалось подготовить файл. Повторите скачивание.</p> : null}
          {children(availability)}
        </div>
      </div>
    </div>
  );
}

function CabinetExportRow({ title, emptyText, available, status, children }) {
  return (
    <div className={`cabinet-export-row ${status === "loaded" && available ? "ready" : ""}`}>
      <FileText size={20} />
      <div><strong>{title}</strong><span>{status === "loaded" ? (available ? "Готово к скачиванию" : emptyText) : "Статус пока не подтверждён"}</span></div>
      {status === "loaded" && available ? children : null}
    </div>
  );
}
