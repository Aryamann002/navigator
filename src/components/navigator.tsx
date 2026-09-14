"use client";

import Link from "next/link";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  Files,
  HelpCircle,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  DISCLAIMER,
  type Finding,
  type LegalDocument,
  type ServiceStatus,
} from "@/lib/contracts";
import { SAMPLE_DOCUMENT, answerSample } from "@/lib/sample";

type Tab = "overview" | "plain" | "chat" | "prep";
type Filter = "all" | "risk" | "obligation" | "date";
const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "overview", label: "Overview", icon: Files },
  { id: "plain", label: "Plain English", icon: BookOpen },
  { id: "chat", label: "Ask your document", icon: MessageCircle },
  { id: "prep", label: "Lawyer prep", icon: FileCheck2 },
];

export default function Navigator() {
  const [documents, setDocuments] = useState<LegalDocument[]>([
    SAMPLE_DOCUMENT,
  ]);
  const [selectedId, setSelectedId] = useState(SAMPLE_DOCUMENT.id);
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<"review" | "library">("review");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileLabel, setFileLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeClause, setActiveClause] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const sessionOnly = status?.storage === "browser-session";
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const doc = documents.find((d) => d.id === selectedId) || documents[0];
  const findings = doc.analysis.findings;
  const riskCount = findings.filter((f) => f.category === "risk").length;
  const obligationCount = findings.filter(
    (f) => f.category === "obligation",
  ).length;
  const dateCount = findings.filter((f) => f.category === "date").length;
  const checkedCount = findings.filter((f) =>
    doc.checked.includes(f.id),
  ).length;

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() =>
        setStatus({
          ready: false,
          missing: ["Service connection"],
          storage: "unavailable",
          model: "",
        }),
      );
    const controller = new AbortController();
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem("navigator-document-ids") || "[]");
      if (Array.isArray(saved)) {
        const ids = saved.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(0, 20);
        void Promise.all(ids.map(async id => {
          const response = await fetch(`/api/documents/${id}`, { signal: controller.signal });
          return response.ok ? (await response.json()).document as LegalDocument : null;
        })).then(restored => {
          if (!controller.signal.aborted) setDocuments(current => [...current, ...restored.filter((item): item is LegalDocument => Boolean(item) && !current.some(d => d.id === item!.id))]);
        }).catch(() => {});
      }
    } catch { /* Browser storage can be disabled in private sessions. */ }
    return () => controller.abort();
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [doc.messages, asking]);
  useEffect(() => {
    if (uploadOpen || infoOpen || previewOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [uploadOpen, infoOpen, previewOpen]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function updateDoc(id: string, update: (d: LegalDocument) => LegalDocument) {
    setDocuments((ds) => ds.map((d) => (d.id === id ? update(d) : d)));
  }
  function rememberDocumentIds(ids: string[]) {
    try {
      if (sessionOnly) sessionStorage.removeItem("navigator-document-ids");
      else sessionStorage.setItem("navigator-document-ids", JSON.stringify(ids.slice(-20)));
    }
    catch { /* The current in-memory session remains usable. */ }
  }
  async function removeDocument(document: LegalDocument) {
    if (document.sample || !window.confirm(`Delete ${document.filename} and its conversation from your private session?`)) return;
    setDeleting(document.id);
    try {
      if (!sessionOnly) {
        const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
        if (!response.ok) throw new Error((await response.json()).error || "The document could not be deleted.");
      }
      setDocuments(current => current.filter(d => d.id !== document.id));
      rememberDocumentIds(documents.filter(d => !d.sample && d.id !== document.id).map(d => d.id));
      if (selectedId === document.id) setSelectedId(SAMPLE_DOCUMENT.id);
      setNotice("Document and conversation deleted.");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to delete this document."); }
    finally { setDeleting(null); }
  }
  function selectDocument(id: string) {
    setSelectedId(id);
    setView("review");
    setTab("overview");
    setFilter("all");
    setMobileOpen(false);
    setActiveClause(null);
    setError("");
  }
  function showClause(id: string) {
    setActiveClause(id);
    setTab("plain");
    setView("review");
    setTimeout(
      () => {
        const clause = window.document.getElementById(`clause-${id}`);
        clause?.focus({ preventScroll: true });
        clause?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      100,
    );
  }
  function toggleFinding(id: string) {
    updateDoc(doc.id, (d) => ({
      ...d,
      checked: d.checked.includes(id)
        ? d.checked.filter((x) => x !== id)
        : [...d.checked, id],
    }));
  }
  function closeModal() {
    if (uploading) return;
    setUploadOpen(false);
    setInfoOpen(false);
    setPreviewOpen(false);
    setError("");
  }

  async function ingest(file?: File) {
    if (!file || uploading) return;
    setError("");
    if (!/\.(pdf|txt)$/i.test(file.name)) {
      setError("Choose a PDF or a plain text (.txt) document.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("This document is too large. Choose a file under 4 MB.");
      return;
    }
    if (!file.size) {
      setError("This file is empty. Choose a document with readable text.");
      return;
    }
    setUploading(true);
    setFileLabel(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "The document could not be analyzed. Please try again.",
        );
      setDocuments((ds) => [...ds, data.document]);
      rememberDocumentIds([...documents.filter(d => !d.sample).map(d => d.id), data.document.id]);
      setSelectedId(data.document.id);
      setTab("plain");
      setView("review");
      setFilter("all");
      setUploadOpen(false);
      setNotice("Your document is ready to review.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function dropFile(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void ingest(e.dataTransfer.files[0]);
  }

  async function ask(text = question) {
    if (!text.trim() || asking) return;
    const documentId = doc.id;
    const message = text.trim();
    setQuestion("");
    setAsking(true);
    setError("");
    updateDoc(documentId, (d) => ({
      ...d,
      messages: [...d.messages, { role: "user", content: message }],
    }));
    try {
      let answer: { content: string; citations: string[] };
      if (doc.sample) answer = answerSample(message);
      else {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document: sessionOnly ? doc : { id: documentId }, message }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error || "Your question could not be answered. Try again.",
          );
        answer = data;
      }
      updateDoc(documentId, (d) => ({
        ...d,
        messages: [...d.messages, { role: "assistant", ...answer }],
      }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to send your question.",
      );
      setQuestion(message);
    } finally {
      setAsking(false);
    }
  }

  async function exportBrief() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: sessionOnly && !doc.sample ? doc : {
            id: doc.id,
            messages: doc.sample ? doc.messages.slice(-40) : undefined,
            checked: doc.checked,
          },
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "The prep sheet could not be generated.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${doc.filename.replace(/\.[^.]+$/, "")}_Lawyer_Prep.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNotice("Your lawyer prep sheet has been downloaded.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to download your prep sheet.",
      );
    } finally {
      setExporting(false);
    }
  }

  function findingRow(f: Finding) {
    const checked = doc.checked.includes(f.id);
    return (
      <div className={`finding-row ${checked ? "reviewed" : ""}`} key={f.id}>
        <label
          className="check-control"
          title={checked ? "Mark as unreviewed" : "Mark as reviewed"}
        >
          <input
            aria-label={`Mark ${f.title} as reviewed`}
            type="checkbox"
            checked={checked}
            onChange={() => toggleFinding(f.id)}
          />
          <span>
            <Check size={13} strokeWidth={2.8} />
          </span>
        </label>
        <div className="finding-copy">
          <div className="finding-title-line">
            <h3>{f.title}</h3>
            <span
              className={`tag ${f.severity === "high" ? "tag-strong" : ""}`}
            >
              {f.category === "risk"
                ? f.severity === "high"
                  ? "High attention"
                  : "Worth a look"
                : f.category === "date"
                  ? "Key date"
                  : "To do"}
            </span>
          </div>
          <p>{f.description}</p>
          <button
            className="source-link"
            onClick={() => showClause(f.clauseId)}
          >
            Clause {f.clauseId}
            <ArrowUpRight size={12} />
          </button>
          {f.date && (
            <span className="finding-date">
              <Clock3 size={12} />
              {new Date(`${f.date}T12:00:00`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        <button
          className="icon-button row-arrow"
          onClick={() => showClause(f.clauseId)}
          aria-label={`View source for ${f.title}`}
          title="View original clause"
        >
          <ArrowUpRight size={17} />
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <Link className="brand" href="/" aria-label="Navigator home">
          <span className="brand-symbol">
            <BookOpen size={20} strokeWidth={1.7} />
          </span>
          navigator<span className="brand-period">.</span>
        </Link>
        <button
          className="button button-dark new-document"
          onClick={() => {
            setUploadOpen(true);
            setMobileOpen(false);
          }}
        >
          <Plus size={17} />
          New document
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button
            className={view === "review" && tab !== "prep" ? "active" : ""}
            aria-current={view === "review" && tab !== "prep" ? "page" : undefined}
            onClick={() => {
              setView("review");
              setTab("overview");
              setMobileOpen(false);
            }}
          >
            <Files size={17} />
            Document review
            <ChevronRight size={14} />
          </button>
          <button
            className={view === "library" ? "active" : ""}
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => {
              setView("library");
              setMobileOpen(false);
            }}
          >
            <FileText size={17} />
            All documents<span className="nav-count">{documents.length}</span>
          </button>
          <button
            className={tab === "prep" && view === "review" ? "active" : ""}
            aria-current={tab === "prep" && view === "review" ? "page" : undefined}
            onClick={() => {
              setView("review");
              setTab("prep");
              setMobileOpen(false);
            }}
          >
            <FileCheck2 size={17} />
            Lawyer prep
          </button>
        </nav>
        <div className="nav-label recent-label">RECENT DOCUMENTS</div>
        <div className="recent-documents">
          {documents.map((d) => (
            <button
              key={d.id}
              className={`recent-document ${d.id === doc.id && view === "review" ? "selected" : ""}`}
              aria-current={d.id === doc.id && view === "review" ? "page" : undefined}
              onClick={() => selectDocument(d.id)}
            >
              <FileText size={17} />
              <span>
                {d.analysis.title}
                <small>
                  {d.sample
                    ? "Sample document"
                    : new Date(d.uploadedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                </small>
              </span>
              <span className="tiny-dot" />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="private-note">
            <LockKeyhole size={18} />
            <strong>A private place for clarity.</strong>
            <p>
              {doc.sample
                ? "Explore with a sample. Your own documents stay in your session."
                : "Your document belongs to your private session."}
            </p>
          </div>
          <button className="side-help" onClick={() => setInfoOpen(true)}>
            <HelpCircle size={17} />
            About Navigator
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar">Y</span>
            <span>
              Your workspace<small>Personal session</small>
            </span>
            <LockKeyhole size={13} />
          </div>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <button onClick={() => setView("library")}>Your workspace</button>
            <ChevronRight size={13} />
            <span>
              {view === "library" ? "All documents" : "Document review"}
            </span>
          </div>
          <button className="top-help" aria-label="About Navigator" onClick={() => setInfoOpen(true)}>
            <HelpCircle size={15} />
            <span>A little guidance</span>
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">LEGAL DOCUMENT NAVIGATOR</div>
              <h1>
                {view === "library" ? "Your documents" : doc.analysis.title}
                <span className="title-dot">.</span>
              </h1>
              <div className="document-meta">
                {view === "library" ? (
                  <span>
                    {documents.length} document
                    {documents.length !== 1 ? "s" : ""} in your workspace
                  </span>
                ) : (
                  <>
                    <FileText size={13} />
                    <span>{doc.filename}</span>
                    <span className="separator">/</span>
                    <span>{doc.pageCount} pages</span>
                    {doc.sample && <span className="sample-tag">Sample</span>}
                  </>
                )}
              </div>
            </div>
            <div className="heading-actions">
              <button
                className="button button-outline upload-heading"
                onClick={() => setUploadOpen(true)}
              >
                <Upload size={15} />
                Upload document
              </button>
              {view !== "library" && (
                <button
                  className="button button-dark"
                  onClick={() => {
                    setTab("prep");
                    setView("review");
                  }}
                >
                  Prepare for a lawyer
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="legal-banner" role="note">
            <ShieldCheck size={19} />
            <p>
              <strong>Clarity, not legal advice.</strong> {DISCLAIMER}
            </p>
            <button
              className="icon-button"
              onClick={() => setInfoOpen(true)}
              title="About this legal boundary"
              aria-label="About this legal boundary"
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          {error && !uploadOpen && (
            <div className="error-banner" role="alert">
              <CircleAlert size={17} />
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {view === "library" ? (
            <section className="library">
              <div className="section-title">
                <h2>
                  All documents{" "}
                  <span className="count">{documents.length}</span>
                </h2>
                <div className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Search documents"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search documents"
                  />
                </div>
              </div>
              <div className="document-table">
                {documents
                  .filter((d) =>
                    `${d.analysis.title} ${d.filename}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((d) => (
                    <div className="document-list-item" key={d.id}>
                    <button
                      className="document-table-row"
                      onClick={() => selectDocument(d.id)}
                    >
                      <span className="file-icon">
                        <FileText size={21} />
                      </span>
                      <span>
                        <strong>{d.analysis.title}</strong>
                        <small>{d.filename}</small>
                      </span>
                      <span className="table-type">
                        {d.sample ? "Sample document" : "Analyzed"}
                      </span>
                      <span className="table-pages">{d.pageCount} pages</span>
                      <ArrowUpRight size={18} />
                    </button>
                    {!d.sample && <button className="icon-button delete-document" title="Delete document" aria-label={`Delete ${d.analysis.title}`} disabled={deleting === d.id} onClick={() => void removeDocument(d)}>{deleting === d.id ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}</button>}
                    </div>
                  ))}
                {!documents.some((d) =>
                  `${d.analysis.title} ${d.filename}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && (
                  <p className="empty-results">
                    No documents match your search.
                  </p>
                )}
              </div>
              <button
                className="library-upload"
                onClick={() => setUploadOpen(true)}
              >
                <Plus size={20} />
                <span>Add a document</span>
                <span>PDF or TXT, up to 4 MB</span>
              </button>
            </section>
          ) : (
            <>
              <nav className="document-tabs" aria-label="Document views">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    className={tab === t.id ? "tab active" : "tab"}
                    onClick={() => {
                      setTab(t.id);
                      setError("");
                    }}
                    aria-current={tab === t.id ? "page" : undefined}
                  >
                    <t.icon size={16} />
                    {t.label}
                    {t.id === "chat" && doc.messages.length > 0 && (
                      <span className="tab-count">
                        {doc.messages.filter((m) => m.role === "user").length}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              {tab === "overview" && (
                <div className="overview-layout">
                  <div className="overview-primary">
                    <section className="summary-section">
                      <div className="section-eyebrow">
                        <Sparkles size={14} />
                        THE BIG PICTURE
                      </div>
                      <h2>Let&apos;s make sense of it.</h2>
                      <p className="summary-text">{doc.analysis.summary}</p>
                      <button
                        className="text-button"
                        onClick={() => setTab("plain")}
                      >
                        Read the plain English version
                        <ArrowRight size={16} />
                      </button>
                    </section>
                    <div className="stat-strip">
                      <button
                        onClick={() =>
                          setFilter(filter === "risk" ? "all" : "risk")
                        }
                        className={filter === "risk" ? "stat active" : "stat"}
                        aria-pressed={filter === "risk"}
                      >
                        <span className="stat-label">
                          <CircleAlert size={15} />
                          Potential risks
                        </span>
                        <span className="stat-number">
                          {String(riskCount).padStart(2, "0")}
                          <ArrowUpRight size={17} />
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          setFilter(
                            filter === "obligation" ? "all" : "obligation",
                          )
                        }
                        className={
                          filter === "obligation" ? "stat active" : "stat"
                        }
                        aria-pressed={filter === "obligation"}
                      >
                        <span className="stat-label">
                          <ListChecks size={15} />
                          Your obligations
                        </span>
                        <span className="stat-number">
                          {String(obligationCount).padStart(2, "0")}
                          <ArrowUpRight size={17} />
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          setFilter(filter === "date" ? "all" : "date")
                        }
                        className={filter === "date" ? "stat active" : "stat"}
                        aria-pressed={filter === "date"}
                      >
                        <span className="stat-label">
                          <Clock3 size={15} />
                          Important dates
                        </span>
                        <span className="stat-number">
                          {String(dateCount).padStart(2, "0")}
                          <ArrowUpRight size={17} />
                        </span>
                      </button>
                    </div>
                    <section className="findings-section">
                      <div className="section-title">
                        <h2>
                          What needs your attention
                          <span className="count">{findings.length}</span>
                        </h2>
                        <span className="review-count">
                          {checkedCount} of {findings.length} reviewed
                        </span>
                      </div>
                      <div className="filter-row" aria-label="Filter findings">
                        {(
                          [
                            ["all", "All items"],
                            ["risk", "Risks"],
                            ["obligation", "Obligations"],
                            ["date", "Dates"],
                          ] as [Filter, string][]
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            className={
                              filter === value
                                ? "filter-button active"
                                : "filter-button"
                            }
                            onClick={() => setFilter(value)}
                            aria-pressed={filter === value}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="findings-list">
                        {findings
                          .filter(
                            (f) => filter === "all" || f.category === filter,
                          )
                          .map(findingRow)}
                        {!findings.filter(
                          (f) => filter === "all" || f.category === filter,
                        ).length && (
                          <div className="empty-results">
                            <CheckCheck size={21} />
                            <p>
                              No items identified in this category. This does
                              not guarantee the document is risk-free.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                  <aside className="document-aside">
                    <section className="source-section">
                      <div className="section-title">
                        <h2>Your document</h2>
                        <span className="tag">
                          {doc.sample
                            ? "PDF"
                            : doc.filename.split(".").pop()?.toUpperCase()}
                        </span>
                      </div>
                      <button
                        className="document-preview"
                        onClick={() =>
                          doc.sample
                            ? setPreviewOpen(true)
                            : showClause(doc.analysis.clauses[0].id)
                        }
                        aria-label={doc.sample ? "Open original sample document" : "View extracted document text"}
                      >
                        {doc.sample ? (
                          <Image
                            width={893}
                            height={1263}
                            priority
                            src="/sample-contract.png"
                            alt="First page of the Northstar Studio sample services agreement"
                          />
                        ) : (
                          <div className="text-preview">
                            <small>ORIGINAL DOCUMENT</small>
                            <h3>{doc.analysis.title}</h3>
                            {doc.analysis.clauses.slice(0, 2).map((c) => (
                              <p key={c.id}>{c.original}</p>
                            ))}
                          </div>
                        )}
                        <span className="preview-open">
                          <ArrowUpRight size={15} />
                        </span>
                      </button>
                      <div className="source-footer">
                        <span>
                          <FileText size={14} />
                          {doc.pageCount} pages
                        </span>
                        <button
                          className="source-link"
                          onClick={() => setTab("plain")}
                        >
                          View document
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </section>
                    <section className="quick-question">
                      <span className="mini-icon">
                        <MessageCircle size={19} />
                      </span>
                      <h3>A clause on your mind?</h3>
                      <p>Find answers in the words of your document.</p>
                      <button
                        className="button button-outline"
                        onClick={() => setTab("chat")}
                      >
                        Ask a question
                        <ArrowUpRight size={15} />
                      </button>
                    </section>
                    <div className="analysis-note">
                      <Sparkles size={14} />
                      <p>
                        {doc.sample
                          ? "Sample analysis for exploration. No document has been uploaded."
                          : "AI-generated analysis can miss details. Check the original wording with a legal professional."}
                      </p>
                    </div>
                  </aside>
                </div>
              )}
              {tab === "plain" && (
                <section className="plain-view">
                  <div className="section-title plain-heading">
                    <div>
                      <h2>The same document. A little clearer.</h2>
                      <p className="muted">
                        {doc.analysis.clauses.length} clauses{" "}
                        <span className="separator">/</span>{" "}
                        {doc.sample
                          ? "Illustrative sample translation"
                          : "Source-linked translation"}
                      </p>
                    </div>
                    <button
                      className="button button-outline"
                      onClick={() => setTab("chat")}
                    >
                      <MessageCircle size={15} />
                      Ask a question
                    </button>
                  </div>
                  <div className="comparison-heading">
                    <span>
                      <FileText size={15} />
                      Original wording
                    </span>
                    <span>
                      <Sparkles size={15} />
                      Plain English
                    </span>
                  </div>
                  {doc.analysis.clauses.map((c) => (
                    <article
                      id={`clause-${c.id}`}
                      key={c.id}
                      tabIndex={-1}
                      className={`clause-row ${activeClause === c.id ? "highlighted" : ""}`}
                    >
                      <div className="original-clause">
                        <div className="clause-heading">
                          <span className="clause-number">
                            {c.id.padStart(2, "0")}
                          </span>
                          <h3>{c.heading}</h3>
                          <small>p. {c.page}</small>
                        </div>
                        <p>{c.original}</p>
                      </div>
                      <div className="translated-clause">
                        <span className="mobile-column-label">
                          PLAIN ENGLISH
                        </span>
                        <p>{c.plain}</p>
                        {findings
                          .filter((f) => f.clauseId === c.id)
                          .map((f) => (
                            <button
                              key={f.id}
                              className="clause-finding"
                              onClick={() => {
                                setTab("overview");
                                setFilter(f.category);
                              }}
                            >
                              <CircleAlert size={13} />
                              {f.title}
                              <ArrowUpRight size={13} />
                            </button>
                          ))}
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {tab === "chat" && (
                <section className="chat-view">
                  <div className="chat-main">
                    <div className="chat-heading">
                      <div>
                        <h2>A conversation with your document.</h2>
                        <p>
                          {doc.sample
                            ? "Sample preview · prepared, source-linked answers"
                            : "Answers grounded in this document"}
                        </p>
                      </div>
                      <span className="tag">
                        <FileText size={12} />
                        {doc.pageCount} pages
                      </span>
                    </div>
                    <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={asking}>
                      {!doc.messages.length && (
                        <div className="chat-empty">
                          <span className="chat-emblem">
                            <MessageCircle size={25} strokeWidth={1.5} />
                          </span>
                          <h3>Start with what matters to you.</h3>
                          <p>
                            What would you like to understand about this
                            agreement?
                          </p>
                          <div className="suggested-questions">
                            {[
                              "What are the main risks?",
                              "When will I get paid?",
                              "How can this agreement end?",
                            ].map((q) => (
                              <button key={q} onClick={() => void ask(q)}>
                                {q}
                                <ArrowUpRight size={14} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {doc.messages.map((m, i) => (
                        <div className={`chat-message ${m.role}`} key={i}>
                          <div className="message-label">
                            {m.role === "assistant" ? (
                              <>
                                <span className="assistant-avatar">
                                  <BookOpen size={12} />
                                </span>
                                Navigator
                                {doc.sample && <small>Sample preview</small>}
                              </>
                            ) : (
                              "You"
                            )}
                          </div>
                          <p>{m.content}</p>
                          {m.citations && m.citations.length > 0 && (
                            <div className="citations">
                              {m.citations.map((c) => (
                                <button
                                  key={c}
                                  className="source-link"
                                  onClick={() => showClause(c)}
                                >
                                  <FileText size={12} />
                                  Clause {c}
                                  <ArrowUpRight size={12} />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {asking && (
                        <div className="thinking" role="status">
                          <LoaderCircle size={15} className="spin" />
                          Reading your document...
                        </div>
                      )}
                      <div ref={chatEnd} />
                    </div>
                    <form
                      className="chat-composer"
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        void ask();
                      }}
                    >
                      <label className="sr-only" htmlFor="question">
                        Ask about your document
                      </label>
                      <textarea
                        id="question"
                        placeholder="Ask about your document..."
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={2000}
                        rows={2}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void ask();
                          }
                        }}
                      />
                      <div className="composer-bottom">
                        <span>
                          <FileText size={13} />
                          {doc.analysis.title}
                        </span>
                        <button
                          className="send-button"
                          disabled={!question.trim() || asking}
                          title="Send question"
                          aria-label="Send question"
                        >
                          {asking ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : (
                            <ArrowUp size={19} />
                          )}
                        </button>
                      </div>
                    </form>
                    <p className="chat-footnote">
                      Legal information only. Verify important details with a
                      qualified legal professional.
                    </p>
                  </div>
                  <aside className="chat-aside">
                    <span className="section-eyebrow">IN THIS DOCUMENT</span>
                    <h3>A good place to start</h3>
                    {doc.analysis.clauses.map((c) => (
                      <button key={c.id} onClick={() => showClause(c.id)}>
                        <span>{c.id.padStart(2, "0")}</span>
                        {c.heading}
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                    <div className="chat-prep-note">
                      <FileCheck2 size={21} />
                      <h3>Keep the conversation going.</h3>
                      <p>
                        Your questions can become the starting point for a
                        conversation with a lawyer.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setTab("prep")}
                      >
                        Your lawyer prep
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </aside>
                </section>
              )}
              {tab === "prep" && (
                <section className="prep-view">
                  <div className="prep-intro">
                    <div className="section-eyebrow">
                      <FileCheck2 size={14} />A MORE PREPARED CONVERSATION
                    </div>
                    <h2>Your lawyer prep sheet.</h2>
                    <p>
                      The key details, the terms to discuss, and the questions
                      on your mind. All in one brief.
                    </p>
                    <button
                      className="button button-dark"
                      onClick={() => void exportBrief()}
                      disabled={exporting}
                    >
                      {exporting ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <ArrowDownToLine size={16} />
                      )}
                      {exporting
                        ? "Preparing your PDF..."
                        : "Download prep sheet"}
                    </button>
                    <span className="prep-export-label">
                      PDF document{doc.sample ? " · Sample" : ""}
                    </span>
                  </div>
                  <div className="prep-paper">
                    <div className="paper-heading">
                      <span className="section-eyebrow">
                        PRIVATE CONSULTATION BRIEF
                      </span>
                      <span className="tag">
                        {doc.sample ? "Sample" : "Draft"}
                      </span>
                      <h2>{doc.analysis.title}</h2>
                      <p>
                        Prepared for a conversation with a legal professional
                      </p>
                    </div>
                    <div className="prep-block">
                      <span className="prep-number">01</span>
                      <div>
                        <h3>Document at a glance</h3>
                        <p>{doc.analysis.summary}</p>
                        <div className="prep-facts">
                          <span>{doc.pageCount} pages</span>
                          <span>{riskCount} potential risks</span>
                          <span>{doc.analysis.documentType}</span>
                        </div>
                      </div>
                    </div>
                    <div className="prep-block">
                      <span className="prep-number">02</span>
                      <div>
                        <h3>Terms to discuss</h3>
                        {findings
                          .filter(
                            (f) =>
                              f.category === "risk" ||
                              doc.checked.includes(f.id),
                          )
                          .map((f) => (
                            <div key={f.id} className="prep-issue">
                              <strong>{f.title}</strong>
                              <p>{f.description}</p>
                              <button
                                className="source-link"
                                onClick={() => showClause(f.clauseId)}
                              >
                                Clause {f.clauseId}
                                <ArrowUpRight size={12} />
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                    <div className="prep-block">
                      <span className="prep-number">03</span>
                      <div>
                        <h3>Questions for your lawyer</h3>
                        <ol>
                          {doc.analysis.questions.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                    <div className="prep-block">
                      <span className="prep-number">04</span>
                      <div>
                        <h3>Your conversation notes</h3>
                        {doc.messages.some((m) => m.role === "user") ? (
                          <ul>
                            {doc.messages
                              .filter((m) => m.role === "user")
                              .map((m, i) => (
                                <li key={i}>{m.content}</li>
                              ))}
                          </ul>
                        ) : (
                          <p className="muted">No questions added yet.</p>
                        )}
                        <button
                          className="text-button"
                          onClick={() => setTab("chat")}
                        >
                          Ask about your document
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="paper-disclaimer">
                      <ShieldCheck size={16} />
                      <p>{DISCLAIMER}</p>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>More understanding. Better conversations.</span>
            <span>
              <LockKeyhole size={12} />
              {doc.sample ? "Sample workspace" : "Private session"}
            </span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialogRef}
        aria-label={uploadOpen ? "Upload document" : previewOpen ? "Original sample document" : "About Navigator"}
        className={`modal ${previewOpen ? "preview-modal" : ""}`}
        onCancel={(e) => {
          e.preventDefault();
          closeModal();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="modal-body">
          <button
            className="icon-button modal-close"
            onClick={closeModal}
            aria-label="Close dialog"
            disabled={uploading}
          >
            <X size={21} />
          </button>
          {uploadOpen && (
            <>
              <span className="modal-symbol">
                <Upload size={24} />
              </span>
              <h2>A little clarity starts here.</h2>
              <p className="modal-description">Add your contract</p>
              <div
                className={`dropzone ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={dropFile}
              >
                {uploading ? (
                  <>
                    <LoaderCircle size={30} className="spin" />
                    <strong>Reading your document...</strong>
                    <p>{fileLabel}</p>
                    <small>
                      Extracting clauses, obligations, and key dates
                    </small>
                  </>
                ) : (
                  <>
                    <Files size={34} strokeWidth={1.25} />
                    <strong>Drop your document here</strong>
                    <p>PDF or TXT · Up to 4 MB · Text-based documents</p>
                    <button
                      className="button button-dark"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Plus size={16} />
                      Choose a file
                    </button>
                  </>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                hidden
                onChange={(e) => void ingest(e.target.files?.[0])}
              />
              {error && (
                <p className="upload-error" role="alert">
                  <CircleAlert size={16} />
                  {error}
                </p>
              )}
        {status && !status.ready && (
                <div className="connection-note">
                  <CircleAlert size={17} />
                  <div>
                    <strong>Live analysis is not connected yet.</strong>
                    <p>
                      Your sample workspace is available. Upload analysis needs
                      the AI and private storage connections.
                    </p>
                  </div>
                </div>
        )}
        {status?.ready && status.storage === "local-memory" && (
          <div className="connection-note local-mode-note">
            <CircleAlert size={17} /><div><strong>Free local mode is active.</strong><p>Uploads use Groq and reset when this dev server restarts. Do not upload sensitive legal documents in this mode.</p></div>
          </div>
        )}
        {status?.ready && status.storage === "browser-session" && (
          <div className="connection-note browser-session-note">
            <CircleAlert size={17} /><div><strong>Private browser-session mode is active.</strong><p>Uploads use Groq and remain only in this tab. Refreshing the page clears the document.</p></div>
          </div>
        )}
              <p className="upload-privacy">
                <LockKeyhole size={14} />
                Uploads are processed by the configured AI services and stored
                in your private session.
              </p>
              <p className="modal-legal">{DISCLAIMER}</p>
            </>
          )}
          {infoOpen && (
            <>
              <span className="modal-symbol">
                <ShieldCheck size={26} />
              </span>
              <h2>Clarity has a boundary.</h2>
              <p className="info-lead">{DISCLAIMER}</p>
              <div className="info-content">
                <h3>AI for Legal Assistance &amp; Access</h3>
                <p>
                  Navigator makes contract language easier to understand and
                  helps you prepare information and questions for a legal
                  professional. It does not decide whether you should sign,
                  interpret your legal rights, or replace legal representation.
                </p>
                <h3>Grounded in your document</h3>
                <p>
                  Translations and responses can miss context or contain errors.
                  Source references let you compare them with the original
                  wording. A finding list is not an exhaustive legal review.
                </p>
                <h3>Your private session</h3>
                <p>
                  {doc.sample
                    ? "This workspace currently contains an illustrative sample. Sample answers are prepared examples, not live AI output."
                    : sessionOnly
                      ? "Your document is sent to Groq for analysis and remains only in this browser tab. Refreshing or closing the tab clears it."
                      : "Document access is tied to this browser's private session cookie. Your files are sent to the configured AI processors and encrypted in cloud storage."}
                </p>
              </div>
              <button className="button button-dark" onClick={closeModal}>
                Back to my document
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {previewOpen && (
            <>
              <h2>Original sample document</h2>
              <p className="modal-description">
                Northstar Studio · Services agreement
              </p>
              <iframe
                src="/sample-contract.pdf"
                title="Original sample services agreement PDF"
              />
              <a
                href="/sample-contract.pdf"
                download
                className="button button-dark"
              >
                <ArrowDownToLine size={16} />
                Download original
              </a>
            </>
          )}
        </div>
      </dialog>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
