"use client";

import {
  Activity,
  Archive,
  Bell,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Clock3,
  CloudUpload,
  Copy,
  Database,
  ExternalLink,
  FileArchive,
  FolderKanban,
  Gauge,
  Globe2,
  HardDrive,
  LogIn,
  LogOut,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Square,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "dashboard" | "projects" | "activity" | "backups" | "settings";
type ProjectStatus = "Healthy" | "Deploying" | "Stopped";
type Role = "Administrator" | "Operator" | "Viewer";
type DatabaseType = "MariaDB" | "PostgreSQL" | "Tanpa database";

type AppSettings = {
  serverName: string;
  serverIp: string;
  location: string;
  projectDirectory: string;
  baseDomain: string;
  npmUrl: string;
  sslEmail: string;
  defaultDatabase: DatabaseType;
  databaseVersion: string;
  backupRetention: number;
};

type Project = {
  name: string;
  slug: string;
  domain: string;
  framework: string;
  version: string;
  status: ProjectStatus;
  updated: string;
  cpu: number;
  memory: number;
  color: string;
  database?: DatabaseType;
};

type ProjectDraft = { name: string; framework: string; database: DatabaseType; fileName: string };

const defaultSettings: AppSettings = { serverName: "VPS Utama", serverIp: "103.127.96.42", location: "Jakarta", projectDirectory: "/opt/nexdeploy/projects", baseDomain: "apps.adecloud.id", npmUrl: "http://103.127.96.42:81", sslEmail: "admin@adecloud.id", defaultDatabase: "MariaDB", databaseVersion: "11.4", backupRetention: 7 };

const initialProjects: Project[] = [
  { name: "NexBill", slug: "nexbill", domain: "nexbill.apps.adecloud.id", framework: "Laravel", version: "v1.8.2", status: "Healthy", updated: "4 menit lalu", cpu: 12, memory: 38, color: "#2563eb" },
  { name: "Toko Merdeka", slug: "toko-merdeka", domain: "toko-merdeka.apps.adecloud.id", framework: "Laravel", version: "v2.4.0", status: "Healthy", updated: "2 jam lalu", cpu: 8, memory: 29, color: "#db2777" },
  { name: "Kasir API", slug: "kasir-api", domain: "kasir-api.apps.adecloud.id", framework: "PHP Native", version: "v0.9.7", status: "Deploying", updated: "sedang berjalan", cpu: 34, memory: 44, color: "#7c3aed" },
  { name: "Arsip Lama", slug: "arsip-lama", domain: "arsip-lama.apps.adecloud.id", framework: "Laravel", version: "v1.1.3", status: "Stopped", updated: "6 hari lalu", cpu: 0, memory: 0, color: "#64748b" },
];

const logLines = [
  ["14:32:08", "Mengunggah arsip aplikasi", "done"],
  ["14:32:12", "Laravel 11 terdeteksi", "done"],
  ["14:32:13", "Menyiapkan container aplikasi", "done"],
  ["14:32:41", "Menginstal dependency Composer", "done"],
  ["14:33:02", "Menjalankan migrasi database", "done"],
  ["14:33:07", "Menghubungkan domain dan SSL", "done"],
  ["14:33:11", "Pemeriksaan kesehatan berhasil", "success"],
];

const navItems = [
  { id: "dashboard" as View, label: "Ringkasan", icon: LayoutDashboard },
  { id: "projects" as View, label: "Project", icon: FolderKanban },
  { id: "activity" as View, label: "Aktivitas", icon: Activity },
  { id: "backups" as View, label: "Backup", icon: Archive },
];

function StatusPill({ status }: { status: ProjectStatus }) {
  const label = status === "Healthy" ? "Berjalan" : status === "Deploying" ? "Deploying" : "Berhenti";
  return <span className={`status status-${status.toLowerCase()}`}><i />{label}</span>;
}

function ProjectMark({ project, small = false }: { project: Project; small?: boolean }) {
  return <span className={`project-mark ${small ? "small" : ""}`} style={{ background: project.color }}>{project.name.slice(0, 2).toUpperCase()}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [projects, setProjects] = useState(initialProjects);
  const [settings, setSettings] = useState(defaultSettings);
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Semua");
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem("nexdeploy.projects");
      const savedSettings = localStorage.getItem("nexdeploy.settings");
      const savedRole = sessionStorage.getItem("nexdeploy.role") as Role | null;
      if (savedProjects) setProjects(JSON.parse(savedProjects));
      if (savedSettings) setSettings({ ...defaultSettings, ...JSON.parse(savedSettings) });
      if (savedRole) setRole(savedRole);
    } finally { setReady(true); }
  }, []);

  useEffect(() => { if (ready) localStorage.setItem("nexdeploy.projects", JSON.stringify(projects)); }, [projects, ready]);
  useEffect(() => { if (ready) localStorage.setItem("nexdeploy.settings", JSON.stringify(settings)); }, [settings, ready]);

  const filtered = useMemo(() => projects.filter((project) => {
    const matchesQuery = `${project.name} ${project.domain}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "Semua" || (filter === "Berjalan" && project.status === "Healthy") || (filter === "Deploying" && project.status === "Deploying") || (filter === "Berhenti" && project.status === "Stopped");
    return matchesQuery && matchesFilter;
  }), [projects, query, filter]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function goTo(next: View) {
    setView(next);
    setSelected(null);
    setMenuOpen(false);
  }

  function toggleProject(project: Project) {
    const nextStatus: ProjectStatus = project.status === "Stopped" ? "Healthy" : "Stopped";
    setProjects((items) => items.map((item) => item.slug === project.slug ? { ...item, status: nextStatus, cpu: nextStatus === "Stopped" ? 0 : 7, memory: nextStatus === "Stopped" ? 0 : 26 } : item));
    setSelected((current) => current ? { ...current, status: nextStatus, cpu: nextStatus === "Stopped" ? 0 : 7, memory: nextStatus === "Stopped" ? 0 : 26 } : current);
    notify(nextStatus === "Healthy" ? "Project berhasil dijalankan" : "Project berhasil dihentikan");
  }

  function createProject(draft: ProjectDraft) {
    const name = draft.name.trim();
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const uniqueSlug = projects.some((item) => item.slug === slug) ? `${slug}-${Date.now().toString().slice(-4)}` : slug;
    const project: Project = { name, slug: uniqueSlug, domain: `${uniqueSlug}.${settings.baseDomain}`, framework: draft.framework, database: draft.database, version: "v1.0.0", status: "Deploying", updated: "baru saja", cpu: 21, memory: 18, color: "#0891b2" };
    setProjects((items) => [project, ...items]);
    setModalOpen(false);
    setView("projects");
    notify(`${name} dibuat dari ${draft.fileName}`);
  }

  function login(nextRole: Role) { setRole(nextRole); sessionStorage.setItem("nexdeploy.role", nextRole); }
  function logout() { setRole(null); sessionStorage.removeItem("nexdeploy.role"); setSelected(null); setView("dashboard"); }

  if (!ready) return <div className="auth-loading">Menyiapkan NEXDEPLOY...</div>;
  if (!role) return <LoginScreen onLogin={login} />;

  const canOperate = role !== "Viewer";
  const isAdmin = role === "Administrator";

  const pageTitle = view === "dashboard" ? "Selamat siang, Ade" : view === "projects" ? "Semua project" : view === "activity" ? "Aktivitas deployment" : view === "backups" ? "Backup & pemulihan" : "Pengaturan";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>NEXDEPLOY</span></div>
        <nav className="main-nav" aria-label="Navigasi utama">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id && !selected ? "active" : ""} onClick={() => goTo(id)}><Icon size={19} /><span>{label}</span>{id === "projects" && <b>{projects.length}</b>}</button>
          ))}
          <p className="nav-label secondary">Sistem</p>
          {isAdmin && <button className={view === "settings" ? "active" : ""} onClick={() => goTo("settings")}><Settings size={19} /><span>Pengaturan</span></button>}
        </nav>
        <div className="server-brief">
          <div className="server-heading"><span><i />VPS Utama</span><MoreHorizontal size={18} /></div>
          <p>Online · Jakarta</p>
          <div className="mini-meter"><span style={{ width: "42%" }} /></div>
          <div className="server-meta"><span>42% terpakai</span><span>64 GB</span></div>
        </div>
        <button className="profile profile-button" onClick={logout} title="Keluar"><span className="avatar">AD</span><div><strong>Ade</strong><small>{role}</small></div><LogOut size={16} /></button>
      </aside>

      {menuOpen && <button className="scrim" aria-label="Tutup menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-btn mobile-menu" aria-label="Buka menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="mobile-brand">NEXDEPLOY</div>
          <div className="topbar-actions">
            <button className="icon-btn" aria-label="Notifikasi" title="Notifikasi"><Bell size={19} /><span className="notification-dot" /></button>
            {canOperate && <button className="primary-btn" onClick={() => setModalOpen(true)}><Plus size={18} /><span>Project baru</span></button>}
          </div>
        </header>

        <div className="content-wrap">
          {selected ? (
            <ProjectDetail project={selected} tab={detailTab} setTab={setDetailTab} onBack={() => setSelected(null)} onToggle={() => toggleProject(selected)} notify={notify} canOperate={canOperate} />
          ) : (
            <>
              <div className="page-heading">
                <div><p className="eyebrow">NEXDEPLOY / {view === "dashboard" ? "Ringkasan" : pageTitle}</p><h1>{pageTitle}</h1><p>{view === "dashboard" ? "Semua layanan berjalan dengan baik. Berikut kondisi VPS kamu hari ini." : descriptions[view]}</p></div>
                {view === "dashboard" && <div className="system-ok"><ShieldCheck size={18} /><span><strong>Sistem sehat</strong><small>Diperiksa 1 menit lalu</small></span></div>}
              </div>

              {view === "dashboard" && <Dashboard projects={projects} openProject={setSelected} goProjects={() => setView("projects")} />}
              {view === "projects" && <ProjectsView projects={filtered} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} openProject={setSelected} openModal={() => setModalOpen(true)} canOperate={canOperate} />}
              {view === "activity" && <ActivityView />}
              {view === "backups" && <BackupsView notify={notify} />}
              {view === "settings" && isAdmin && <SettingsView notify={notify} settings={settings} onSave={setSettings} />}
            </>
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Navigasi seluler">
        {navItems.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} className={view === id && !selected ? "active" : ""} onClick={() => goTo(id)}><Icon size={20} /><span>{label}</span></button>)}
      </nav>

      {modalOpen && <CreateProjectModal onClose={() => setModalOpen(false)} onSubmit={createProject} baseDomain={settings.baseDomain} defaultDatabase={settings.defaultDatabase} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

const descriptions: Record<View, string> = {
  dashboard: "",
  projects: "Kelola aplikasi, domain, dan status deployment dari satu tempat.",
  activity: "Pantau riwayat proses dan perubahan di seluruh project.",
  backups: "Jaga versi aplikasi dan database tetap aman serta mudah dipulihkan.",
  settings: "Atur server, domain utama, dan integrasi Nginx Proxy Manager.",
};

function Dashboard({ projects, openProject, goProjects }: { projects: Project[]; openProject: (project: Project) => void; goProjects: () => void }) {
  const active = projects.filter((p) => p.status === "Healthy").length;
  return <>
    <section className="stat-grid">
      <article className="stat-item"><div className="stat-icon blue"><Box size={20} /></div><div><span>Project aktif</span><strong>{active}<small> / {projects.length}</small></strong><p><b>+1</b> bulan ini</p></div></article>
      <article className="stat-item"><div className="stat-icon green"><Gauge size={20} /></div><div><span>CPU server</span><strong>18<small>%</small></strong><p>Normal · 8 vCPU</p></div><div className="spark"><i style={{height: "35%"}}/><i style={{height: "48%"}}/><i style={{height: "38%"}}/><i style={{height: "62%"}}/><i style={{height: "44%"}}/><i style={{height: "52%"}}/></div></article>
      <article className="stat-item"><div className="stat-icon violet"><Database size={20} /></div><div><span>Memory</span><strong>6.8<small> GB</small></strong><p>dari 16 GB</p></div><div className="ring" style={{"--value": "42%"} as React.CSSProperties}><span>42%</span></div></article>
      <article className="stat-item"><div className="stat-icon orange"><HardDrive size={20} /></div><div><span>Penyimpanan</span><strong>27.4<small> GB</small></strong><p>dari 64 GB</p></div><div className="storage-bar"><span /></div></article>
    </section>

    <section className="dashboard-grid">
      <div className="panel projects-panel">
        <div className="panel-head"><div><h2>Project kamu</h2><p>Status aplikasi terbaru</p></div><button className="text-btn" onClick={goProjects}>Lihat semua <ChevronLeft size={15} className="rotate" /></button></div>
        <div className="project-list">
          {projects.slice(0, 4).map((project) => <button className="project-row" key={project.slug} onClick={() => openProject(project)}>
            <ProjectMark project={project} /><div className="project-main"><strong>{project.name}</strong><span>{project.domain}</span></div><div className="project-tech"><b>{project.framework}</b><span>{project.version}</span></div><StatusPill status={project.status} /><div className="updated"><Clock3 size={14} />{project.updated}</div><ChevronLeft size={17} className="rotate" />
          </button>)}
        </div>
      </div>

      <div className="panel activity-panel">
        <div className="panel-head"><div><h2>Aktivitas terbaru</h2><p>24 jam terakhir</p></div><button className="icon-btn subtle" title="Muat ulang"><RefreshCw size={16} /></button></div>
        <div className="timeline">
          <div><span className="timeline-icon success"><Check size={14} /></span><p><strong>NexBill berhasil di-deploy</strong><small>Versi v1.8.2 · 4 menit lalu</small></p></div>
          <div><span className="timeline-icon info"><CloudUpload size={14} /></span><p><strong>Deployment Kasir API dimulai</strong><small>Oleh Ade · 12 menit lalu</small></p></div>
          <div><span className="timeline-icon violet"><Archive size={14} /></span><p><strong>Backup otomatis dibuat</strong><small>Toko Merdeka · 3 jam lalu</small></p></div>
          <div><span className="timeline-icon warning"><CircleAlert size={14} /></span><p><strong>Arsip Lama dihentikan</strong><small>Oleh Ade · 6 hari lalu</small></p></div>
        </div>
      </div>
    </section>

    <section className="quick-actions"><div><h2>Aksi cepat</h2><p>Pekerjaan rutin, satu klik lebih dekat.</p></div><div className="quick-list"><button><span className="quick-icon"><CloudUpload size={20} /></span><span><strong>Deploy ZIP</strong><small>Unggah aplikasi baru</small></span></button><button><span className="quick-icon"><Archive size={20} /></span><span><strong>Buat backup</strong><small>Simpan kondisi saat ini</small></span></button><button><span className="quick-icon"><TerminalSquare size={20} /></span><span><strong>Buka log</strong><small>Pantau proses server</small></span></button></div></section>
  </>;
}

function ProjectsView({ projects, query, setQuery, filter, setFilter, openProject, openModal, canOperate }: { projects: Project[]; query: string; setQuery: (v: string) => void; filter: string; setFilter: (v: string) => void; openProject: (p: Project) => void; openModal: () => void; canOperate: boolean }) {
  return <div className="panel projects-page">
    <div className="project-toolbar"><label className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau domain..." /></label><div className="filters">{["Semua", "Berjalan", "Deploying", "Berhenti"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    {projects.length ? <div className="project-cards">{projects.map((project) => <article key={project.slug} className="project-card" onClick={() => openProject(project)}><div className="card-top"><ProjectMark project={project} /><StatusPill status={project.status} /></div><h3>{project.name}</h3><p>{project.domain}</p><div className="card-details"><span><Box size={16} />{project.framework}</span><span><Database size={16} />{project.database || "MariaDB"}</span></div><div className="resource-line"><span>CPU <b>{project.cpu}%</b></span><span>Memory <b>{project.memory}%</b></span></div><div className="dual-meter"><i style={{width: `${project.cpu}%`}} /><i style={{width: `${project.memory}%`}} /></div><footer><span><Clock3 size={14} />{project.updated}</span><button aria-label={`Buka ${project.name}`}><ExternalLink size={16} /></button></footer></article>)}</div> : <div className="empty-state"><Search size={26} /><h3>Project tidak ditemukan</h3><p>Coba kata pencarian atau status yang berbeda.</p>{canOperate && <button className="secondary-btn" onClick={openModal}>Buat project baru</button>}</div>}
  </div>;
}

function ProjectDetail({ project, tab, setTab, onBack, onToggle, notify, canOperate }: { project: Project; tab: string; setTab: (tab: string) => void; onBack: () => void; onToggle: () => void; notify: (message: string) => void; canOperate: boolean }) {
  const tabs = [["overview", "Ringkasan"], ["deployments", "Deployment"], ["environment", "Environment"], ["database", "Database"], ["backups", "Backup"], ["logs", "Log"]];
  return <>
    <button className="back-btn" onClick={onBack}><ChevronLeft size={18} />Kembali ke project</button>
    <section className="project-hero">
      <div className="project-identity"><ProjectMark project={project} /><div><div className="title-line"><h1>{project.name}</h1><StatusPill status={project.status} /></div><a href={`https://${project.domain}`} target="_blank" rel="noreferrer"><Globe2 size={15} />{project.domain}<ExternalLink size={13} /></a></div></div>
      {canOperate && <div className="project-actions"><button className="secondary-btn" onClick={() => notify("Deployment ulang dimulai")}><RefreshCw size={17} />Deploy ulang</button><button className={project.status === "Stopped" ? "primary-btn" : "danger-btn"} onClick={onToggle}>{project.status === "Stopped" ? <Play size={17} /> : <Square size={16} fill="currentColor" />}{project.status === "Stopped" ? "Jalankan" : "Hentikan"}</button><button className="icon-btn bordered" title="Opsi lainnya"><MoreHorizontal size={19} /></button></div>}
    </section>
    <div className="detail-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <OverviewTab project={project} notify={notify} />}
    {tab === "deployments" && <DeploymentsTab />}
    {tab === "environment" && <EnvironmentTab notify={notify} />}
    {tab === "database" && <DatabaseTab project={project} notify={notify} canOperate={canOperate} />}
    {tab === "backups" && <BackupsView compact notify={notify} />}
    {tab === "logs" && <LogPanel />}
  </>;
}

function OverviewTab({ project, notify }: { project: Project; notify: (message: string) => void }) {
  return <div className="detail-grid"><div className="detail-main">
    <section className="panel deployment-summary"><div className="panel-head"><div><h2>Deployment terakhir</h2><p>Versi aktif saat ini</p></div><span className="success-label"><Check size={15} />Berhasil</span></div><div className="release-row"><div className="release-icon"><FileArchive size={21} /></div><div><strong>{project.version}</strong><span>nexbill-release.zip · 18.4 MB</span></div><div><small>Selesai dalam</small><b>1m 03d</b></div><div><small>Di-deploy</small><b>4 menit lalu</b></div><button className="icon-btn subtle"><MoreHorizontal size={18} /></button></div></section>
    <LogPanel compact />
  </div><aside className="detail-side">
    <section className="panel info-panel"><div className="panel-head"><div><h2>Informasi aplikasi</h2></div></div><dl><div><dt>Framework</dt><dd>{project.framework} 11</dd></div><div><dt>PHP</dt><dd>8.3</dd></div><div><dt>Container</dt><dd><i className="online-dot" />nexdeploy-{project.slug}-app</dd></div><div><dt>Database</dt><dd>MariaDB 11.4</dd></div><div><dt>Auto SSL</dt><dd><ShieldCheck size={15} />Aktif</dd></div></dl></section>
    <section className="panel resource-panel"><div className="panel-head"><div><h2>Penggunaan resource</h2><p>Rata-rata 15 menit</p></div></div><div className="resource-item"><span><Gauge size={17} />CPU <b>{project.cpu}%</b></span><div><i style={{width: `${project.cpu}%`}} /></div></div><div className="resource-item"><span><Database size={17} />Memory <b>{project.memory}%</b></span><div><i style={{width: `${project.memory}%`}} /></div></div><div className="resource-item"><span><HardDrive size={17} />Disk <b>31%</b></span><div><i style={{width: "31%"}} /></div></div></section>
    <button className="visit-btn" onClick={() => notify("Alamat aplikasi disalin")}><Globe2 size={18} />Salin alamat aplikasi<Copy size={15} /></button>
  </aside></div>;
}

function LogPanel({ compact = false }: { compact?: boolean }) {
  return <section className={`panel log-panel ${compact ? "compact" : ""}`}><div className="panel-head dark"><div><h2>Log deployment</h2><p>nexbill · {compact ? "Deployment terbaru" : "Live output"}</p></div><span><i />Live</span></div><div className="terminal">{logLines.map(([time, line, status]) => <p key={line}><time>{time}</time><span className={status}>{status === "success" ? "SUCCESS" : "DONE"}</span><code>{line}</code></p>)}</div>{compact && <button className="terminal-footer">Lihat log lengkap <ExternalLink size={14} /></button>}</section>;
}

function DeploymentsTab() {
  return <section className="panel table-panel"><div className="panel-head"><div><h2>Riwayat deployment</h2><p>Lima versi terbaru aplikasi</p></div></div><div className="data-table"><div className="table-row head"><span>Versi</span><span>Status</span><span>Durasi</span><span>Waktu</span><span /></div>{["v1.8.2", "v1.8.1", "v1.8.0", "v1.7.6"].map((v, i) => <div className="table-row" key={v}><strong>{v}</strong><span className="success-label"><Check size={14} />Berhasil</span><span>{i === 0 ? "1m 03d" : "58 detik"}</span><span>{i === 0 ? "4 menit lalu" : `${i + 1} hari lalu`}</span><button className="icon-btn subtle"><MoreHorizontal size={17} /></button></div>)}</div></section>;
}

function EnvironmentTab({ notify }: { notify: (m: string) => void }) {
  return <section className="panel form-panel"><div className="panel-head"><div><h2>Environment variables</h2><p>Nilai sensitif disembunyikan dan tersimpan terenkripsi.</p></div><button className="primary-btn" onClick={() => notify("Perubahan environment disimpan")}><Check size={17} />Simpan</button></div><div className="env-list">{[["APP_NAME", "NexBill"], ["APP_ENV", "production"], ["APP_DEBUG", "false"], ["DB_HOST", "nexdeploy-nexbill-db"], ["DB_PASSWORD", "••••••••••••"]].map(([key, value]) => <div key={key}><input value={key} readOnly aria-label="Nama variable" /><input defaultValue={value} aria-label={`Nilai ${key}`} /><button className="icon-btn subtle" title="Hapus"><X size={16} /></button></div>)}</div><button className="add-variable"><Plus size={16} />Tambah variable</button></section>;
}

function DatabaseTab({ project, notify, canOperate }: { project: Project; notify: (m: string) => void; canOperate: boolean }) {
  const database = project.database || "MariaDB";
  if (database === "Tanpa database") return <section className="panel empty-state"><Database size={28} /><h3>Project ini tanpa database</h3><p>Pilihan tersebut ditentukan saat project dibuat.</p></section>;
  const isPostgres = database === "PostgreSQL";
  return <div className="database-grid"><section className="panel database-card"><div className="database-logo"><Database size={26} /></div><div><span className="success-label"><i />Terhubung</span><h2>{database} {isPostgres ? "16" : "11.4"}</h2><p>Database terisolasi khusus untuk project ini.</p></div><dl><div><dt>Host</dt><dd>nexdeploy-{project.slug}-db</dd></div><div><dt>Database</dt><dd>{project.slug.replace(/-/g, "_")}_db</dd></div><div><dt>Port</dt><dd>{isPostgres ? "5432" : "3306"}</dd></div></dl><button className="secondary-btn" onClick={() => { navigator.clipboard?.writeText(`DB_HOST=nexdeploy-${project.slug}-db\nDB_DATABASE=${project.slug.replace(/-/g, "_")}_db`); notify("Kredensial database disalin"); }}><Copy size={16} />Salin kredensial</button></section><section className="panel database-actions"><h2>Pemeliharaan</h2><button disabled={!canOperate} onClick={() => notify("Backup database dimulai")}><Archive size={19} /><span><strong>Backup sekarang</strong><small>Buat salinan database terbaru</small></span><ChevronLeft className="rotate" size={17} /></button><button onClick={() => notify("Koneksi database berhasil")}><Activity size={19} /><span><strong>Uji koneksi</strong><small>Pastikan aplikasi tetap terhubung</small></span><ChevronLeft className="rotate" size={17} /></button></section></div>;
}

function ActivityView() {
  return <section className="panel activity-page"><div className="activity-filters"><button className="active">Semua</button><button>Deployment</button><button>Sistem</button><button>Backup</button></div><div className="activity-feed">{[
    ["Deployment berhasil", "NexBill versi v1.8.2 sudah aktif dan lolos health check.", "4 menit lalu", "success"],
    ["Deployment dimulai", "Kasir API sedang menyiapkan container aplikasi.", "12 menit lalu", "info"],
    ["Backup otomatis", "Database Toko Merdeka berhasil disimpan.", "3 jam lalu", "violet"],
    ["SSL diperbarui", "Sertifikat *.apps.adecloud.id diperbarui otomatis.", "Kemarin, 02:10", "success"],
    ["Project dihentikan", "Arsip Lama dihentikan secara manual oleh Ade.", "6 hari lalu", "warning"],
  ].map(([title, copy, time, kind]) => <div key={title + time}><span className={`timeline-icon ${kind}`}>{kind === "success" ? <Check size={15} /> : kind === "info" ? <CloudUpload size={15} /> : kind === "violet" ? <Archive size={15} /> : <Square size={13} />}</span><div><strong>{title}</strong><p>{copy}</p><small>{time}</small></div></div>)}</div></section>;
}

function BackupsView({ compact = false, notify }: { compact?: boolean; notify: (m: string) => void }) {
  return <section className={`panel backup-page ${compact ? "compact-page" : ""}`}><div className="panel-head"><div><h2>{compact ? "Backup project" : "Backup terbaru"}</h2><p>File aplikasi dan database tersimpan bersama.</p></div><button className="primary-btn" onClick={() => notify("Backup baru sedang dibuat")}><Plus size={17} />Buat backup</button></div><div className="data-table backups"><div className="table-row head"><span>Nama backup</span><span>Project</span><span>Ukuran</span><span>Dibuat</span><span /></div>{[["automatic-2026-08-12", "NexBill", "186 MB", "Hari ini, 02:00"], ["before-v1.8.2", "NexBill", "181 MB", "4 menit lalu"], ["automatic-2026-08-12", "Toko Merdeka", "244 MB", "Hari ini, 02:04"], ["weekly-2026-w32", "Kasir API", "92 MB", "3 hari lalu"]].map(([name, project, size, date]) => <div className="table-row" key={name + project}><span className="backup-name"><Archive size={17} /><strong>{name}</strong></span><span>{project}</span><span>{size}</span><span>{date}</span><button className="restore-btn" onClick={() => notify(`Pemulihan ${project} disiapkan`)}><RotateCcw size={15} />Pulihkan</button></div>)}</div></section>;
}

function SettingsView({ notify, settings, onSave }: { notify: (m: string) => void; settings: AppSettings; onSave: (s: AppSettings) => void }) {
  const [section, setSection] = useState<"server" | "domain" | "database">("server");
  const [draft, setDraft] = useState(settings);
  const update = (key: keyof AppSettings, value: string | number) => setDraft((current) => ({ ...current, [key]: value }));
  const save = () => { onSave(draft); notify("Pengaturan berhasil disimpan"); };
  return <div className="settings-grid"><aside className="settings-menu"><button className={section === "server" ? "active" : ""} onClick={() => setSection("server")}><Server size={17} />Server</button><button className={section === "domain" ? "active" : ""} onClick={() => setSection("domain")}><Globe2 size={17} />Domain & SSL</button><button className={section === "database" ? "active" : ""} onClick={() => setSection("database")}><Database size={17} />Database</button></aside><section className="panel settings-panel">
    <div className="panel-head"><div><h2>{section === "server" ? "Konfigurasi server" : section === "domain" ? "Domain & SSL" : "Default database"}</h2><p>{section === "server" ? "Informasi VPS yang digunakan oleh NEXDEPLOY." : section === "domain" ? "Domain ini dipakai otomatis oleh setiap project baru." : "Tentukan database awal dan kebijakan backup."}</p></div></div>
    {section === "server" && <div className="settings-form"><label><span>Nama server</span><input value={draft.serverName} onChange={(e) => update("serverName", e.target.value)} /></label><label><span>Alamat IP</span><input value={draft.serverIp} onChange={(e) => update("serverIp", e.target.value)} /></label><label><span>Lokasi</span><select value={draft.location} onChange={(e) => update("location", e.target.value)}><option>Jakarta</option><option>Singapore</option></select></label><label><span>Direktori project</span><input value={draft.projectDirectory} onChange={(e) => update("projectDirectory", e.target.value)} /></label></div>}
    {section === "domain" && <div className="settings-form"><label><span>Base domain</span><input value={draft.baseDomain} onChange={(e) => update("baseDomain", e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""))} placeholder="apps.domain.com" /></label><label><span>URL Nginx Proxy Manager</span><input value={draft.npmUrl} onChange={(e) => update("npmUrl", e.target.value)} /></label><label><span>Email SSL</span><input type="email" value={draft.sslEmail} onChange={(e) => update("sslEmail", e.target.value)} /></label><div className="domain-preview"><Globe2 size={18} /><div><span>Contoh alamat project</span><strong>nama-project.{draft.baseDomain}</strong></div></div></div>}
    {section === "database" && <div className="settings-form"><label><span>Database default</span><select value={draft.defaultDatabase} onChange={(e) => update("defaultDatabase", e.target.value)}><option>MariaDB</option><option>PostgreSQL</option><option>Tanpa database</option></select></label><label><span>Versi default</span><input value={draft.databaseVersion} onChange={(e) => update("databaseVersion", e.target.value)} /></label><label><span>Retensi backup (hari)</span><input type="number" min="1" max="90" value={draft.backupRetention} onChange={(e) => update("backupRetention", Number(e.target.value))} /></label></div>}
    <div className="connection-card"><span className="timeline-icon success"><Check size={15} /></span><div><strong>{section === "domain" ? "Format domain valid" : section === "database" ? "Konfigurasi database siap" : "Koneksi server aktif"}</strong><p>{section === "domain" ? `Project baru akan memakai *.${draft.baseDomain}` : section === "database" ? `${draft.defaultDatabase} dipilih sebagai default` : "Docker Engine 27.3 · Terakhir diperiksa 1 menit lalu"}</p></div><button className="secondary-btn" onClick={() => notify(section === "domain" ? "Koneksi NPM berhasil diuji" : "Konfigurasi berhasil diuji")}>Uji konfigurasi</button></div>
    <footer className="settings-footer"><button className="primary-btn" onClick={save}><Check size={17} />Simpan perubahan</button></footer>
  </section></div>;
}

function CreateProjectModal({ onClose, onSubmit, baseDomain, defaultDatabase }: { onClose: () => void; onSubmit: (draft: ProjectDraft) => void; baseDomain: string; defaultDatabase: DatabaseType }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProjectDraft>({ name: "", framework: "Laravel", database: defaultDatabase, fileName: "" });
  const slug = draft.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "nama-project";
  const next = () => { if (draft.name.trim()) setStep(2); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!draft.fileName) return; onSubmit(draft); };
  return <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-backdrop" onClick={onClose} aria-label="Tutup dialog" /><div className="modal"><div className="modal-head"><div><span>LANGKAH {step} DARI 2</span><h2 id="modal-title">{step === 1 ? "Buat project baru" : "Unggah aplikasi"}</h2><p>{step === 1 ? "Kami siapkan domain dan database secara otomatis." : `Project ${draft.name} siap menerima file aplikasi.`}</p></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div><div className="step-line"><i className="done" /><i className={step === 2 ? "done" : ""} /></div><form onSubmit={submit}>
    {step === 1 ? <div className="modal-fields"><label><span>Nama project</span><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Contoh: makanan-mama" autoFocus /></label><label><span>Framework</span><select value={draft.framework} onChange={(e) => setDraft({ ...draft, framework: e.target.value })}><option>Laravel</option><option>PHP Native</option></select></label><label><span>Database</span><select value={draft.database} onChange={(e) => setDraft({ ...draft, database: e.target.value as DatabaseType })}><option>MariaDB</option><option>PostgreSQL</option><option>Tanpa database</option></select></label><div className="domain-preview"><Globe2 size={18} /><div><span>Domain otomatis</span><strong>{slug}.{baseDomain}</strong></div></div></div> : <label className={`upload-zone ${draft.fileName ? "has-file" : ""}`}><CloudUpload size={28} /><h3>{draft.fileName || "Pilih file ZIP aplikasi"}</h3><p>{draft.fileName ? "File siap digunakan" : "Klik area ini untuk memilih file dari perangkat"}</p><span className="secondary-btn">{draft.fileName ? "Ganti file" : "Pilih file ZIP"}</span><input type="file" accept=".zip,application/zip" onChange={(e) => setDraft({ ...draft, fileName: e.target.files?.[0]?.name || "" })} /><small>Maksimal 500 MB · format .zip</small></label>}
    <footer className="modal-footer">{step === 2 && <button type="button" className="text-btn" onClick={() => setStep(1)}><ChevronLeft size={16} />Kembali</button>}<span /><button type={step === 1 ? "button" : "submit"} disabled={step === 1 ? !draft.name.trim() : !draft.fileName} className="primary-btn" onClick={step === 1 ? next : undefined}>{step === 1 ? "Lanjutkan" : "Mulai deploy"}{step === 1 && <ChevronLeft size={16} className="rotate" />}</button></footer>
  </form></div></div>;
}

function LoginScreen({ onLogin }: { onLogin: (role: Role) => void }) {
  const [selectedRole, setSelectedRole] = useState<Role>("Administrator");
  const [email, setEmail] = useState("ade@nexdeploy.local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!email.trim() || password.length < 6) { setError("Masukkan email dan password minimal 6 karakter."); return; } onLogin(selectedRole); };
  return <main className="login-page"><section className="login-brand"><div className="brand login-logo"><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>NEXDEPLOY</span></div><div><span className="login-kicker">CONTROL PANEL</span><h1>Deployment VPS yang terasa sederhana.</h1><p>Kelola aplikasi, database, domain, log, dan backup dari satu workspace yang tertata.</p></div><div className="login-health"><ShieldCheck size={19} /><span><strong>Panel lokal terlindungi</strong><small>Akses disesuaikan dengan peran pengguna</small></span></div></section><section className="login-form-wrap"><form className="login-form" onSubmit={submit}><div><span className="login-kicker">SELAMAT DATANG</span><h2>Masuk ke NEXDEPLOY</h2><p>Pilih role untuk menguji hak akses di lingkungan lokal.</p></div><label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><fieldset><legend>Masuk sebagai</legend><div className="role-options">{(["Administrator", "Operator", "Viewer"] as Role[]).map((item) => <button type="button" key={item} className={selectedRole === item ? "active" : ""} onClick={() => setSelectedRole(item)}><strong>{item}</strong><small>{item === "Administrator" ? "Akses penuh" : item === "Operator" ? "Kelola deployment" : "Pantau saja"}</small></button>)}</div></fieldset>{error && <p className="login-error">{error}</p>}<button className="primary-btn login-submit"><LogIn size={18} />Masuk ke panel</button><small className="login-note">Mode lokal: kredensial contoh dapat diubah bebas.</small></form></section></main>;
}
