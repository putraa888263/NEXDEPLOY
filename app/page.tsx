"use client";

import {
  KeyRound, Activity,
  Archive,
  Bell,
  Box,
  Check,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  id: string;
  name: string;
  slug: string;
  domain: string;
  framework: string;
  version: string;
  status: ProjectStatus;
  updatedAt: string;
  cpu: number;
  memory: number;
  color: string;
  database?: DatabaseType;
  archiveName?: string | null;
  archiveSize?: number | null;
  archiveValidation?: string | null;
    hasSuccessfulDeployment?: boolean | number;
};

type ProjectDraft = { name: string; framework: string; database: DatabaseType; fileName: string; file?: File };
type PanelUser = { id: string; name: string; email: string; role: Role; status: "Active" | "Disabled"; lastLoginAt: string | null; createdAt: string };
type SignedInUser = { id: string; name: string; email: string; role: Role };
type Deployment = { id: string; status: "Queued" | "Running" | "WaitingExecutor" | "Failed" | "Succeeded"; archiveName: string; executor: string; action?: "Deploy" | "Rollback"; sourceDeploymentId?: string | null; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null };
type DeploymentLog = { id: string; level: "info" | "success" | "warning" | "error"; message: string; createdAt: string };
type EnvironmentVariable = { key: string; value: string; isSecret: boolean; saved?: boolean };
type ProjectResources = { phpVersion: string; cpuLimit: number; memoryLimit: number; diskQuota: number; internalPort: number; updatedAt?: string };
type Backup = { id: string; name: string; type: string; status: string; size: number | null; fileName?: string | null; databaseType?: string | null; retentionDays: number; createdAt: string; completedAt: string | null };
type ActivityRecord = { id: string; type: "deployment" | "system" | "backup" | "account" | "environment" | "resource"; title: string; detail: string; createdAt: string; projectName: string | null };
type ArchiveValidation = { detectedFramework: string; files: number; readiness: "Ready" | "Warning"; warnings: string[]; requirements: { composer: boolean; phpVersion: string | null; laravelVersion: string | null; envExample: boolean; migrations: boolean; packageJson: boolean; buildScript: boolean } };

const defaultSettings: AppSettings = { serverName: "VPS Utama", serverIp: "103.127.96.42", location: "Jakarta", projectDirectory: "/opt/nexdeploy/projects", baseDomain: "apps.adecloud.id", npmUrl: "http://103.127.96.42:81", sslEmail: "admin@adecloud.id", defaultDatabase: "MariaDB", databaseVersion: "11.4", backupRetention: 7 };


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

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [role, setRole] = useState<Role | null>(null);
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Semua");
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  async function loadPanel() {
    const [projectResponse, settingsResponse] = await Promise.all([fetch("/api/projects"), fetch("/api/settings")]);
    if (!projectResponse.ok || !settingsResponse.ok) throw new Error("Gagal memuat data panel.");
    const [projectData, settingsData] = await Promise.all([projectResponse.json(), settingsResponse.json()]);
    setProjects(projectData.projects);
    setSettings({ ...defaultSettings, ...settingsData.settings });
  }

  useEffect(() => {
    Promise.all([fetch("/api/setup").then((response) => response.json()), fetch("/api/auth/session")]).then(async ([setup, response]) => {
      setNeedsSetup(Boolean(setup.needsSetup));
      if (!response.ok) return;
      const { user } = await response.json();
      setRole(user.role as Role);
      setSignedInUser(user as SignedInUser);
      await loadPanel();
    }).catch(() => undefined).finally(() => setReady(true));
  }, []);

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

  async function toggleProject(project: Project) {
    if (project.status === "Deploying") {
      return notify(
        "Project sedang deployment. Tunggu proses selesai.",
      );
    }

    const nextStatus: ProjectStatus =
      project.status === "Stopped"
        ? "Healthy"
        : "Stopped";

    let response: Response;
    let result: {
      error?: string;
      status?: ProjectStatus;
      cpu?: number;
      memory?: number;
      updatedAt?: string;
    };

    try {
      response = await fetch(
        `/api/projects/${project.id}/status`,
        {
          method: "PATCH",
          headers: {
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              status:
                nextStatus,
            }),
        },
      );

      result =
        await response
          .json()
          .catch(() => ({}));
    } catch {
      return notify(
        "Executor tidak dapat dijangkau.",
      );
    }

    if (!response.ok) {
      return notify(
        result.error ||
        "Status project gagal diubah.",
      );
    }

    setProjects((items) =>
      items.map((item) =>
        item.id === project.id
          ? {
              ...item,
              ...result,
            }
          : item,
      ),
    );

    setSelected((current) =>
      current?.id === project.id
        ? {
            ...current,
            ...result,
          }
        : current,
    );

    notify(
      nextStatus === "Healthy"
        ? "Project berhasil dijalankan"
        : "Project berhasil dihentikan",
    );
  }

  async function createProject(draft: ProjectDraft) {
    let response: Response;
    let result: {
      error?: string;
      project?: Project;
    };

    try {
      response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: draft.name,
          framework: draft.framework,
          database: draft.database,
        }),
      });

      result = await response.json().catch(() => ({}));
    } catch {
      return notify("Project gagal dibuat karena koneksi ke panel terputus.");
    }

    if (!response.ok) {
      return notify(result.error || "Project gagal dibuat.");
    }

    if (!result.project) {
      return notify("Project dibuat tetapi respons server tidak lengkap.");
    }

    const project = result.project;

    // Project langsung masuk ke state agar tidak perlu refresh.
    setProjects((items) => [
      project,
      ...items.filter((item) => item.id !== project.id),
    ]);

    const selectedFile = draft.file;

    if (!selectedFile) {
      setModalOpen(false);
      setView("projects");
      setSelected(project);
      setDetailTab("overview");
      return notify("Project berhasil dibuat. Silakan unggah ZIP dari detail project.");
    }

    const upload = new FormData();
    upload.set("archive", selectedFile);

    let uploadResponse: Response;
    let uploadResult: {
      error?: string;
      archive?: {
        name: string;
        size: number;
        detectedFramework: string;
        [key: string]: unknown;
      };
    };

    try {
      uploadResponse = await fetch(
        `/api/projects/${project.id}/upload`,
        {
          method: "POST",
          body: upload,
        },
      );

      uploadResult = await uploadResponse
        .json()
        .catch(() => ({}));
    } catch {
      setModalOpen(false);
      setView("projects");
      setSelected(project);
      setDetailTab("overview");

      return notify(
        "Project berhasil dibuat, tetapi upload ZIP terputus. Unggah ulang dari detail project.",
      );
    }

    if (!uploadResponse.ok) {
      setModalOpen(false);
      setView("projects");
      setSelected(project);
      setDetailTab("overview");

      return notify(
        `Project berhasil dibuat, tetapi ZIP ditolak: ${
          uploadResult.error ||
          "Terjadi kesalahan pada server lokal."
        }`,
      );
    }

    if (!uploadResult.archive) {
      setModalOpen(false);
      setView("projects");
      setSelected(project);
      setDetailTab("overview");

      return notify(
        "Project berhasil dibuat, tetapi respons upload ZIP tidak lengkap. Unggah ulang dari detail project.",
      );
    }

    const createdProject: Project = {
      ...project,
      archiveName: uploadResult.archive.name,
      archiveSize: uploadResult.archive.size,
      archiveValidation: JSON.stringify(
        uploadResult.archive,
      ),
      updatedAt: new Date().toISOString(),
    };

    setProjects((items) => [
      createdProject,
      ...items.filter(
        (item) => item.id !== createdProject.id,
      ),
    ]);

    // Langsung buka project baru setelah create + upload selesai.
    setSelected(createdProject);
    setDetailTab("overview");
    setModalOpen(false);
    setView("projects");

    notify(
      `${createdProject.name} siap diproses. ZIP ${uploadResult.archive.detectedFramework} sudah tervalidasi.`,
    );
  }

  async function uploadProjectArchive(project: Project, file: File) {
    const upload = new FormData();
    upload.set("archive", file);
    let response: Response;
    let result: { error?: string; archive?: { name: string; size: number; detectedFramework: string } };
    try { response = await fetch(`/api/projects/${project.id}/upload`, { method: "POST", body: upload }); result = await response.json().catch(() => ({})); }
    catch { return notify("Upload terputus. Coba ulangi ZIP maksimal 100 MB."); }
    if (!response.ok) return notify(result.error || "ZIP gagal diunggah.");
    if (!result.archive) return notify("Respons upload tidak lengkap. Coba ulangi.");
    const update = { archiveName: result.archive.name, archiveSize: result.archive.size, archiveValidation: JSON.stringify(result.archive), updatedAt: new Date().toISOString() };
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, ...update } : item));
    setSelected((current) => current?.id === project.id ? { ...current, ...update } : current);
    notify(`ZIP ${result.archive.detectedFramework} berhasil tervalidasi.`);
  }
  async function deployProject(
    project: Project,
  ) {
    let response: Response;
    let result: {
      error?: string;
      deployment?: Deployment;
    };

    try {
      response = await fetch(
        `/api/projects/${project.id}/deployments`,
        {
          method: "POST",
        },
      );

      result = await response
        .json()
        .catch(() => ({}));
    } catch {
      return notify(
        "Koneksi ke panel terputus saat memulai deployment.",
      );
    }

    if (!response.ok) {
      return notify(
        result.error ||
        "Deployment gagal diantrikan.",
      );
    }

    setProjects((items) =>
      items.map((item) =>
        item.id === project.id
          ? {
              ...item,
              status: "Deploying",
            }
          : item,
      ),
    );

    setSelected((current) =>
      current?.id === project.id
        ? {
            ...current,
            status: "Deploying",
          }
        : current,
    );

    notify(
      project.hasSuccessfulDeployment
        ? "Deploy ulang diproses."
        : "Deployment pertama diproses.",
    );
  }

  async function deleteProjectPermanently(
    project: Project,
  ): Promise<string | null> {
    let response: Response;
    let result: {
      error?: string;
      ok?: boolean;
    };

    try {
      response = await fetch(
        `/api/projects/${project.id}`,
        {
          method: "DELETE",
        },
      );

      result = await response
        .json()
        .catch(() => ({}));
    } catch {
      return "Koneksi ke panel terputus saat menghapus project.";
    }

    if (!response.ok) {
      return (
        result.error ||
        "Project gagal dihapus permanen."
      );
    }

    setProjects((items) =>
      items.filter(
        (item) =>
          item.id !== project.id,
      ),
    );

    setSelected(null);
    setDetailTab("overview");
    setView("projects");

    notify(
      `${project.name} berhasil dihapus permanen beserta resource server dan domainnya.`,
    );

    return null;
  }

  async function login(email: string, password: string) {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return result.error || "Login gagal.";
    setRole(result.user.role as Role);
    setSignedInUser(result.user as SignedInUser);
    await loadPanel();
    return null;
  }
  async function saveSettings(nextSettings: AppSettings) {
    const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(nextSettings) });
    if (!response.ok) return notify("Pengaturan gagal disimpan");
    setSettings(nextSettings);
    notify("Pengaturan berhasil disimpan");
  }
  async function changePassword(currentPassword: string, newPassword: string) {
    const response = await fetch("/api/account/password", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return result.error || "Password gagal diubah.";
    setRole(null);
    setSignedInUser(null);
    setProjects([]);
    setSelected(null);
    setView("dashboard");
    return null;
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setRole(null); setSignedInUser(null); setProjects([]); setSelected(null); setView("dashboard"); }

  if (!ready) return <div className="auth-loading">Menyiapkan NEXDEPLOY...</div>;
  if (!role) return needsSetup ? <InitialSetup onComplete={() => setNeedsSetup(false)} /> : <LoginScreen onLogin={login} />;

  const canOperate = role !== "Viewer";
  const isAdmin = role === "Administrator";

  const pageTitle = view === "dashboard" ? `Selamat siang, ${signedInUser?.name ?? "Pengguna"}` : view === "projects" ? "Semua project" : view === "activity" ? "Aktivitas deployment" : view === "backups" ? "Backup & pemulihan" : "Pengaturan";
  const avatarInitials = signedInUser?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "US";

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
          <button className={view === "settings" ? "active" : ""} onClick={() => goTo("settings")}><Settings size={19} /><span>Pengaturan</span></button>
        </nav>
        <div className="server-brief">
          <div className="server-heading"><span><i />VPS Utama</span><MoreHorizontal size={18} /></div>
          <p>Online · Jakarta</p>
          <div className="mini-meter"><span style={{ width: "42%" }} /></div>
          <div className="server-meta"><span>42% terpakai</span><span>64 GB</span></div>
        </div>
        <button className="profile profile-button" onClick={logout} title="Keluar"><span className="avatar">{avatarInitials}</span><div><strong>{signedInUser?.name}</strong><small>{role}</small></div><LogOut size={16} /></button>
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
            <ProjectDetail
              project={selected}
              tab={detailTab}
              setTab={setDetailTab}
              onBack={() => setSelected(null)}
              onToggle={() => toggleProject(selected)}
              onDeploy={() => deployProject(selected)}
              onUpload={(file) => uploadProjectArchive(selected, file)}
              onDelete={() => deleteProjectPermanently(selected)}
              notify={notify}
              canOperate={canOperate}
              isAdmin={isAdmin}
              refreshProjects={loadPanel}
            />
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
              {view === "settings" && <><SettingsView notify={notify} settings={settings} onSave={saveSettings} onChangePassword={changePassword} isAdmin={isAdmin} />{isAdmin && <ExecutorSettings notify={notify} />}</>}
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
  type SystemMetrics = {
    timestamp: string;
    cpu: {
      usage: number;
      cores: number;
    };
    memory: {
      total: number;
      used: number;
      available: number;
      usage: number;
    };
    disk: {
      total: number;
      used: number;
      available: number;
      usage: number;
    };
    load: {
      one: number;
      five: number;
      fifteen: number;
    };
    uptime: number;
    docker: {
      status: string;
      total: number;
      running: number;
      stopped: number;
    };
  };

  const active = projects.filter((p) => p.status === "Healthy").length;

  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 GB";
    }

    const gb = bytes / 1024 / 1024 / 1024;

    if (gb >= 100) {
      return `${gb.toFixed(0)} GB`;
    }

    return `${gb.toFixed(1)} GB`;
  };

  const formatUptime = (seconds: number) => {
    const totalMinutes = Math.floor(seconds / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days} hari ${hours} jam`;
    }

    if (hours > 0) {
      return `${hours} jam ${minutes} menit`;
    }

    return `${minutes} menit`;
  };

  const loadMetrics = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/system/metrics",
        {
          cache: "no-store",
        },
      );

      const result = await response
        .json()
        .catch(() => ({})) as {
          metrics?: SystemMetrics;
          error?: string;
        };

      if (!response.ok || !result.metrics) {
        throw new Error(
          result.error ||
          "Metrics VPS tidak tersedia.",
        );
      }

      setMetrics(result.metrics);
      setMetricsError("");
    } catch (error) {
      setMetricsError(
        error instanceof Error
          ? error.message
          : "Metrics VPS tidak tersedia.",
      );
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(
      () => {
        void loadMetrics();
      },
      0,
    );

    const interval = window.setInterval(
      () => {
        void loadMetrics();
      },
      5000,
    );

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadMetrics]);

  const cpuUsage = metrics?.cpu.usage ?? 0;
  const memoryUsage = metrics?.memory.usage ?? 0;
  const diskUsage = metrics?.disk.usage ?? 0;

  return <>
    <section className="stat-grid">
      <article className="stat-item">
        <div className="stat-icon blue"><Box size={20} /></div>
        <div>
          <span>Project aktif</span>
          <strong>{active}<small> / {projects.length}</small></strong>
          <p>{projects.length ? "Project terdaftar di panel" : "Belum ada project"}</p>
        </div>
      </article>

      <article className="stat-item">
        <div className="stat-icon green"><Gauge size={20} /></div>
        <div>
          <span>CPU server</span>
          <strong>
            {loadingMetrics && !metrics ? "..." : cpuUsage.toFixed(1)}
            <small>%</small>
          </strong>
          <p>
            {metrics
              ? `${metrics.cpu.cores} vCPU · ${cpuUsage < 80 ? "Normal" : "Tinggi"}`
              : "Tidak tersedia"}
          </p>
        </div>
        <div className="ring" style={{"--value": `${Math.min(100, cpuUsage)}%`} as React.CSSProperties}>
          <span>{Math.round(cpuUsage)}%</span>
        </div>
      </article>

      <article className="stat-item">
        <div className="stat-icon violet"><Database size={20} /></div>
        <div>
          <span>Memory</span>
          <strong>
            {metrics ? formatBytes(metrics.memory.used).replace(" GB", "") : "..."}
            <small> GB</small>
          </strong>
          <p>
            {metrics
              ? `dari ${formatBytes(metrics.memory.total)}`
              : "Tidak tersedia"}
          </p>
        </div>
        <div className="ring" style={{"--value": `${Math.min(100, memoryUsage)}%`} as React.CSSProperties}>
          <span>{Math.round(memoryUsage)}%</span>
        </div>
      </article>

      <article className="stat-item">
        <div className="stat-icon orange"><HardDrive size={20} /></div>
        <div>
          <span>Penyimpanan</span>
          <strong>
            {metrics ? formatBytes(metrics.disk.used).replace(" GB", "") : "..."}
            <small> GB</small>
          </strong>
          <p>
            {metrics
              ? `dari ${formatBytes(metrics.disk.total)}`
              : "Tidak tersedia"}
          </p>
        </div>
        <div className="ring" style={{"--value": `${Math.min(100, diskUsage)}%`} as React.CSSProperties}>
          <span>{Math.round(diskUsage)}%</span>
        </div>
      </article>
    </section>

    <section className="dashboard-grid">
      <div className="panel projects-panel">
        <div className="panel-head">
          <div>
            <h2>Kondisi VPS</h2>
            <p>Monitoring host diperbarui otomatis setiap 5 detik</p>
          </div>

          <button
            className="icon-btn subtle"
            title="Muat ulang metrics"
            onClick={() => void loadMetrics()}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="project-list">
          <div className="project-row">
            <div className="stat-icon blue"><Activity size={18} /></div>
            <div className="project-main">
              <strong>Load average</strong>
              <span>1 menit / 5 menit / 15 menit</span>
            </div>
            <div className="project-tech">
              <b>
                {metrics
                  ? `${metrics.load.one.toFixed(2)} / ${metrics.load.five.toFixed(2)} / ${metrics.load.fifteen.toFixed(2)}`
                  : "—"}
              </b>
            </div>
          </div>

          <div className="project-row">
            <div className="stat-icon green"><Clock3 size={18} /></div>
            <div className="project-main">
              <strong>Uptime VPS</strong>
              <span>Waktu server aktif</span>
            </div>
            <div className="project-tech">
              <b>{metrics ? formatUptime(metrics.uptime) : "—"}</b>
            </div>
          </div>

          <div className="project-row">
            <div className="stat-icon violet"><Server size={18} /></div>
            <div className="project-main">
              <strong>Docker</strong>
              <span>
                {metrics
                  ? `${metrics.docker.running} running · ${metrics.docker.stopped} stopped`
                  : "Status container tidak tersedia"}
              </span>
            </div>
            <div className="project-tech">
              <b>
                {metrics
                  ? `${metrics.docker.running} / ${metrics.docker.total}`
                  : "—"}
              </b>
              <span>
                {metrics?.docker.status === "healthy"
                  ? "Healthy"
                  : "Error"}
              </span>
            </div>
          </div>

          <div className="project-row">
            <div className="stat-icon orange"><RefreshCw size={18} /></div>
            <div className="project-main">
              <strong>Status monitoring</strong>
              <span>
                {metricsError
                  ? metricsError
                  : "Executor terhubung dan metrics tersedia"}
              </span>
            </div>
            <div className="project-tech">
              <b>{metricsError ? "Gangguan" : "Online"}</b>
              <span>
                {metrics
                  ? `Update ${new Date(metrics.timestamp).toLocaleTimeString("id-ID")}`
                  : "Menunggu data"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel activity-panel">
        <div className="panel-head">
          <div>
            <h2>Project kamu</h2>
            <p>Status aplikasi terbaru</p>
          </div>
          <button className="text-btn" onClick={goProjects}>
            Lihat semua <ChevronLeft size={15} className="rotate" />
          </button>
        </div>

        <div className="timeline">
          {projects.slice(0, 4).map((project) => (
            <div key={project.id}>
              <span className={`timeline-icon ${project.status === "Healthy" ? "success" : project.status === "Deploying" ? "info" : "warning"}`}>
                {project.status === "Healthy"
                  ? <Check size={14} />
                  : project.status === "Deploying"
                    ? <CloudUpload size={14} />
                    : <CircleAlert size={14} />}
              </span>

              <p>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => openProject(project)}
                >
                  <strong>{project.name}</strong>
                </button>
                <small>
                  {project.domain} · {relativeTime(project.updatedAt)}
                </small>
              </p>
            </div>
          ))}

          {!projects.length && (
            <div>
              <span className="timeline-icon info"><Box size={14} /></span>
              <p>
                <strong>Belum ada project</strong>
                <small>Project baru akan muncul di sini.</small>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>

    <section className="quick-actions">
      <div>
        <h2>Status server</h2>
        <p>
          {metricsError
            ? "Monitoring sedang mengalami gangguan."
            : metrics
              ? `CPU ${cpuUsage.toFixed(1)}% · RAM ${memoryUsage.toFixed(1)}% · Disk ${diskUsage.toFixed(1)}%`
              : "Mengambil kondisi VPS..."}
        </p>
      </div>

      <div className="quick-list">
        <button onClick={() => void loadMetrics()}>
          <span className="quick-icon"><RefreshCw size={20} /></span>
          <span>
            <strong>Refresh metrics</strong>
            <small>Ambil kondisi VPS terbaru</small>
          </span>
        </button>

        <button onClick={goProjects}>
          <span className="quick-icon"><Box size={20} /></span>
          <span>
            <strong>Semua project</strong>
            <small>Lihat aplikasi yang dikelola</small>
          </span>
        </button>
      </div>
    </section>
  </>;
}

function ProjectsView({ projects, query, setQuery, filter, setFilter, openProject, openModal, canOperate }: { projects: Project[]; query: string; setQuery: (v: string) => void; filter: string; setFilter: (v: string) => void; openProject: (p: Project) => void; openModal: () => void; canOperate: boolean }) {
  return <div className="panel projects-page">
    <div className="project-toolbar"><label className="search-box"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama atau domain..." /></label><div className="filters">{["Semua", "Berjalan", "Deploying", "Berhenti"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    {projects.length ? <div className="project-cards">{projects.map((project) => <button
  type="button"
  key={project.id}
  className="project-card"
  onClick={() => openProject(project)}
><div className="card-top"><ProjectMark project={project} /><StatusPill status={project.status} /></div><h3>{project.name}</h3><p>{project.domain}</p><div className="card-details"><span><Box size={16} />{project.framework}</span><span><Database size={16} />{project.database || "MariaDB"}</span></div><div className="resource-line"><span>CPU <b>{project.cpu}%</b></span><span>Memory <b>{project.memory}%</b></span></div><div className="dual-meter"><i style={{width: `${project.cpu}%`}} /><i style={{width: `${project.memory}%`}} /></div><footer><span><Clock3 size={14} />{relativeTime(project.updatedAt)}</span><span className="project-card-open-icon" aria-hidden="true"><ExternalLink size={16} /></span></footer></button>)}</div> : <div className="empty-state"><Search size={26} /><h3>Project tidak ditemukan</h3><p>Coba kata pencarian atau status yang berbeda.</p>{canOperate && <button className="secondary-btn" onClick={openModal}>Buat project baru</button>}</div>}
  </div>;
}

function ProjectDetail({
  project,
  tab,
  setTab,
  onBack,
  onToggle,
  onDeploy,
  onUpload,
  onDelete,
  notify,
  canOperate,
  isAdmin,
  refreshProjects,
}: {
  project: Project;
  tab: string;
  setTab: (tab: string) => void;
  onBack: () => void;
  onToggle: () => void;
  onDeploy: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<string | null>;
  notify: (message: string) => void;
  canOperate: boolean;
  isAdmin: boolean;
  refreshProjects: () => void;
}) {
  const tabs = [
    ["overview", "Ringkasan"],
    ["deployments", "Deployment"],
    ["environment", "Environment"],
    ["resources", "Resource"],
    ["database", "Database"],
    ["backups", "Backup"],
    ["logs", "Log"],
  ];

  const [deleteOpen, setDeleteOpen] =
    useState(false);

  const [deleteConfirmation, setDeleteConfirmation] =
    useState("");

  const [deleting, setDeleting] =
    useState(false);

  const [deleteError, setDeleteError] =
    useState("");

  const confirmationMatches =
    deleteConfirmation ===
    project.name;

  function closeDeleteModal() {
    if (deleting) {
      return;
    }

    setDeleteOpen(false);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  async function confirmPermanentDelete() {
    if (
      !confirmationMatches ||
      deleting
    ) {
      return;
    }

    setDeleting(true);
    setDeleteError("");

    const error =
      await onDelete();

    if (error) {
      setDeleteError(error);
      setDeleting(false);
      return;
    }

    setDeleteOpen(false);
  }

  return (
    <>
      <button
        className="back-btn"
        onClick={onBack}
      >
        <ChevronLeft size={18} />
        Kembali ke project
      </button>

      <section className="project-hero">
        <div className="project-identity">
          <ProjectMark project={project} />

          <div>
            <div className="title-line">
              <h1>{project.name}</h1>
              <StatusPill status={project.status} />
            </div>

            <a
              href={`https://${project.domain}`}
              target="_blank"
              rel="noreferrer"
            >
              <Globe2 size={15} />
              {project.domain}
              <ExternalLink size={13} />
            </a>
          </div>
        </div>

        <div className="project-actions">
          {canOperate && (
            <>
              <label className="secondary-btn upload-replace">
                <CloudUpload size={17} />
                Unggah ZIP

                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => {
                    const file =
                      event.target.files?.[0];

                    if (file) {
                      void onUpload(file);
                    }

                    event.currentTarget.value =
                      "";
                  }}
                />
              </label>

              <button
                className={
                  project.hasSuccessfulDeployment
                    ? "secondary-btn"
                    : "primary-btn"
                }
                disabled={
                  !project.archiveName ||
                  project.status === "Deploying"
                }
                onClick={() =>
                  void onDeploy()
                }
              >
                {project.hasSuccessfulDeployment ? (
                  <RefreshCw size={17} />
                ) : (
                  <Play size={17} />
                )}

                {project.status === "Deploying"
                  ? "Sedang deploy..."
                  : project.hasSuccessfulDeployment
                    ? "Deploy ulang"
                    : "Deploy sekarang"}
              </button>

              <button
                className={
                  project.status ===
                  "Stopped"
                    ? "primary-btn"
                    : "danger-btn"
                }
                onClick={onToggle}
              >
                {project.status ===
                "Stopped" ? (
                  <Play size={17} />
                ) : (
                  <Square
                    size={16}
                    fill="currentColor"
                  />
                )}

                {project.status ===
                "Stopped"
                  ? "Jalankan"
                  : "Hentikan"}
              </button>
            </>
          )}

          {isAdmin && (
            <button
              type="button"
              className="danger-outline-btn"
              onClick={() => {
                setDeleteConfirmation("");
                setDeleteError("");
                setDeleteOpen(true);
              }}
            >
              Hapus permanen
            </button>
          )}
        </div>
      </section>

      <div className="detail-tabs">
        {tabs.map(
          ([id, label]) => (
            <button
              key={id}
              className={
                tab === id
                  ? "active"
                  : ""
              }
              onClick={() =>
                setTab(id)
              }
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === "overview" && (
        <OverviewTab
          project={project}
          notify={notify}
        />
      )}

      {tab === "deployments" && (
        <DeploymentsTab
          projectId={project.id}
          refreshProjects={
            refreshProjects
          }
        />
      )}

      {tab === "environment" && (
        <EnvironmentTab
          project={project}
          notify={notify}
          canOperate={canOperate}
        />
      )}

      {tab === "resources" && (
        <ResourcesTab
          project={project}
          notify={notify}
          canOperate={canOperate}
        />
      )}

      {tab === "database" && (
        <DatabaseTab
          project={project}
          notify={notify}
          canOperate={canOperate}
        />
      )}

      {tab === "backups" && (
        <BackupsView
          compact
          project={project}
          notify={notify}
          canOperate={canOperate}
        />
      )}

      {tab === "logs" && (
        <LogPanel
          projectId={project.id}
        />
      )}

      {deleteOpen && (
        <div
          className="permanent-delete-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeDeleteModal();
            }
          }}
        >
          <section
            className="permanent-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
          >
            <div className="permanent-delete-icon">
              <CircleAlert size={27} />
            </div>

            <div className="permanent-delete-heading">
              <div>
                <p>Zona berbahaya</p>

                <h2 id="permanent-delete-title">
                  Hapus project permanen?
                </h2>
              </div>

              <button
                type="button"
                className="permanent-delete-close"
                onClick={
                  closeDeleteModal
                }
                disabled={deleting}
                aria-label="Tutup"
              >
                ×
              </button>
            </div>

            <p className="permanent-delete-description">
              Tindakan ini tidak dapat
              dibatalkan. NEXDEPLOY akan
              membersihkan seluruh resource
              yang dimiliki project
              <strong>
                {" "}
                {project.name}
              </strong>
              .
            </p>

            <div className="permanent-delete-resources">
              <div>
                <span>Container & worker</span>
                <b>Dihapus</b>
              </div>

              <div>
                <span>Docker image & network</span>
                <b>Dihapus</b>
              </div>

              <div>
                <span>Database & user database</span>
                <b>Dihapus</b>
              </div>

              <div>
                <span>ZIP & artifact aplikasi</span>
                <b>Dihapus</b>
              </div>

              <div>
                <span>Backup & deployment history</span>
                <b>Dihapus</b>
              </div>

              <div>
                <span>NPM Proxy Host</span>
                <b>{project.domain}</b>
              </div>
            </div>

            <label className="permanent-delete-confirmation">
              <span>
                Ketik{" "}
                <strong>
                  {project.name}
                </strong>{" "}
                untuk mengonfirmasi
              </span>

              <input
                value={
                  deleteConfirmation
                }
                disabled={deleting}
                onChange={(event) => {
                  setDeleteConfirmation(
                    event.target.value,
                  );
                  setDeleteError("");
                }}
                placeholder={
                  project.name
                }
                autoComplete="off"
              />
            </label>

            {deleteError && (
              <div className="permanent-delete-error">
                <CircleAlert size={16} />
                <span>
                  {deleteError}
                </span>
              </div>
            )}

            <div className="permanent-delete-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={deleting}
                onClick={
                  closeDeleteModal
                }
              >
                Batal
              </button>

              <button
                type="button"
                className="permanent-delete-submit"
                disabled={
                  !confirmationMatches ||
                  deleting
                }
                onClick={() =>
                  void confirmPermanentDelete()
                }
              >
                {deleting
                  ? "Menghapus seluruh resource..."
                  : "Hapus project permanen"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}


function OverviewTab({ project, notify }: { project: Project; notify: (message: string) => void }) {
  let validation: ArchiveValidation | null = null;
  try { validation = project.archiveValidation ? JSON.parse(project.archiveValidation) as ArchiveValidation : null; } catch { validation = null; }
  return <div className="detail-grid"><div className="detail-main">
    <section className="panel deployment-summary"><div className="panel-head"><div><h2>Arsip aplikasi</h2><p>File yang akan diproses oleh worker deployment.</p></div><span className={project.archiveName && validation?.readiness !== "Warning" ? "success-label" : "status status-deploying"}>{project.archiveName ? validation?.readiness === "Warning" ? "Perlu perhatian" : <><Check size={15} />Tervalidasi</> : "Belum ada ZIP"}</span></div><div className="release-row"><div className="release-icon"><FileArchive size={21} /></div><div><strong>{project.archiveName ?? "Belum ada file aplikasi"}</strong><span>{project.archiveSize ? `${(project.archiveSize / 1024 / 1024).toFixed(2)} MB` : "Unggah ZIP Laravel atau PHP untuk melanjutkan."}</span></div><div><small>Framework</small><b>{validation?.detectedFramework ?? project.framework}</b></div><div><small>PHP</small><b>{validation?.requirements.phpVersion ?? "Tidak terdeteksi"}</b></div><button className="icon-btn subtle"><MoreHorizontal size={18} /></button></div>{validation && <div className="archive-readiness"><div><span>Composer</span><b>{validation.requirements.composer ? "Terdeteksi" : "Tidak ada"}</b></div><div><span>Migration</span><b>{validation.requirements.migrations ? "Terdeteksi" : "Tidak ada"}</b></div><div><span>Build frontend</span><b>{validation.requirements.buildScript ? "Tersedia" : "Tidak perlu / tidak ada"}</b></div>{validation.warnings.length > 0 && <ul>{validation.warnings.map((warning) => <li key={warning}><CircleAlert size={14} />{warning}</li>)}</ul>}</div>}</section>
    <LogPanel compact projectId={project.id} />
  </div><aside className="detail-side">
    <section className="panel info-panel"><div className="panel-head"><div><h2>Informasi aplikasi</h2></div></div><dl><div><dt>Framework</dt><dd>{project.framework} 11</dd></div><div><dt>PHP</dt><dd>8.3</dd></div><div><dt>Container</dt><dd><i className="online-dot" />nexdeploy-{project.slug}-app</dd></div><div><dt>Database</dt><dd>MariaDB 11.4</dd></div><div><dt>Auto SSL</dt><dd><ShieldCheck size={15} />Aktif</dd></div></dl></section>
    <section className="panel resource-panel"><div className="panel-head"><div><h2>Penggunaan resource</h2><p>Rata-rata 15 menit</p></div></div><div className="resource-item"><span><Gauge size={17} />CPU <b>{project.cpu}%</b></span><div><i style={{width: `${project.cpu}%`}} /></div></div><div className="resource-item"><span><Database size={17} />Memory <b>{project.memory}%</b></span><div><i style={{width: `${project.memory}%`}} /></div></div><div className="resource-item"><span><HardDrive size={17} />Disk <b>31%</b></span><div><i style={{width: "31%"}} /></div></div></section>
    <button className="visit-btn" onClick={() => notify("Alamat aplikasi disalin")}><Globe2 size={18} />Salin alamat aplikasi<Copy size={15} /></button>
  </aside></div>;
}

function deploymentHasFinalLog(
  status: Deployment["status"] | undefined,
  logs: DeploymentLog[],
) {
  if (status === "Succeeded") {
    return logs.some((log) =>
      /\[(NPM|NPM_SSL|NPM_SKIP|NPM_ERROR)\]/.test(
        log.message,
      ),
    );
  }

  if (status === "Failed") {
    return logs.some((log) =>
      /\[FAILURE\]|Deployment gagal pada tahap/.test(
        log.message,
      ),
    );
  }

  return false;
}

function LogPanel({
  compact = false,
  projectId,
  deploymentId,
}: {
  compact?: boolean;
  projectId: string;
  deploymentId?: string | null;
}) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<DeploymentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const historyResponse = await fetch(
      `/api/projects/${projectId}/deployments`,
    );

    if (!historyResponse.ok) {
      setLoading(false);
      return {
        deployment: null,
        logs: [],
      };
    }

    const history = await historyResponse.json();
    const deployments =
      (history.deployments ?? []) as Deployment[];

    const target = deploymentId
      ? deployments.find(
          (item) => item.id === deploymentId,
        )
      : deployments[0];

    if (!target) {
      setDeployment(null);
      setLogs([]);
      setLoading(false);
      return {
        deployment: null,
        logs: [],
      };
    }

    setDeployment(target);

    const logResponse = await fetch(
      `/api/deployments/${target.id}/logs`,
    );

    if (logResponse.ok) {
      const output = await logResponse.json();
      const nextLogs =
        (output.logs ?? []) as DeploymentLog[];

      setLogs(nextLogs);

      if (output.deployment) {
        const syncedDeployment = {
          ...target,
          ...output.deployment,
        };

        setDeployment(syncedDeployment);
        setLoading(false);
        return {
          deployment: syncedDeployment,
          logs: nextLogs,
        };
      }
    }

    setLoading(false);
    return {
      deployment: target,
      logs: [],
    };
  }, [deploymentId, projectId]);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }

      const current = await load();
      const currentDeployment =
        current.deployment;

      const hasFinalLog =
        deploymentHasFinalLog(
          currentDeployment?.status,
          current.logs,
        );

      if (
        currentDeployment &&
        (
          currentDeployment.status === "Succeeded" ||
          currentDeployment.status === "Failed"
        ) &&
        hasFinalLog
      ) {
        return;
      }

      if (!cancelled) {
        timeout = setTimeout(() => {
          void poll();
        }, 1500);
      }
    };

    void poll();

    return () => {
      cancelled = true;

      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [load]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.scrollTop = terminal.scrollHeight;
  }, [logs]);

  const isRunning =
    deployment?.status === "Queued" ||
    deployment?.status === "Running" ||
    deployment?.status === "WaitingExecutor";

  const hasFinalLog =
    deploymentHasFinalLog(
      deployment?.status,
      logs,
    );

  return (
    <section
      className={`panel log-panel ${
        compact ? "compact" : ""
      }`}
    >
      <div className="panel-head dark">
        <div>
          <h2>Log deployment</h2>
          <p>
            {deployment
              ? `${deployment.action ?? "Deploy"} · ${deployment.archiveName}`
              : "Belum ada deployment"}
          </p>
        </div>

        <span
          className={
            deployment?.status === "Failed"
              ? "error"
              : ""
          }
        >
          <i />
          {deployment?.status ?? "Menunggu"}
          {isRunning ? " • LIVE" : ""}
        </span>
      </div>

      <div
        className="terminal"
        ref={terminalRef}
      >
        {loading ? (
          <p>
            <code>Memuat log deployment...</code>
          </p>
        ) : logs.length ? (
          logs.map((log) => (
            <p key={log.id}>
              <time>
                {new Date(
                  log.createdAt,
                ).toLocaleTimeString(
                  "id-ID",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                )}
              </time>

              <span
                className={
                  log.level === "success"
                    ? "success"
                    : log.level === "error"
                      ? "error"
                      : "done"
                }
              >
                {log.level.toUpperCase()}
              </span>

              <code>{log.message}</code>
            </p>
          ))
        ) : (
          <p>
            <code>
              Belum ada log deployment untuk release ini.
            </code>
          </p>
        )}

        {deployment?.status === "Failed" &&
        deployment.error ? (
          <p>
            <time>ERROR</time>
            <span className="error">
              FAILED
            </span>
            <code>{deployment.error}</code>
          </p>
        ) : null}

        {deployment?.status === "Succeeded" &&
        hasFinalLog ? (
          <p>
            <time>DONE</time>
            <span className="success">
              SUCCESS
            </span>
            <code>
              Deployment selesai dengan sukses.
            </code>
          </p>
        ) : null}
      </div>

      {compact && (
        <button className="terminal-footer">
          Lihat log lengkap
          <ExternalLink size={14} />
        </button>
      )}
    </section>
  );
}

function DeploymentsTab({
  projectId,
  refreshProjects,
}: {
  projectId: string;
  refreshProjects: () => void;
}) {
  const [deployments, setDeployments] =
    useState<Deployment[]>([]);

  const [
    selectedDeploymentId,
    setSelectedDeploymentId,
  ] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/deployments`,
    );

    const data = await response.json();
    const nextDeployments =
      (data.deployments ?? []) as Deployment[];

    setDeployments(nextDeployments);

    setSelectedDeploymentId((current) => {
      if (
        current &&
        nextDeployments.some(
          (deployment) =>
            deployment.id === current,
        )
      ) {
        return current;
      }

      return nextDeployments[0]?.id ?? null;
    });

    return nextDeployments;
  }, [projectId]);

  useEffect(() => {
    const poll = async () => {
      const deps = await refresh();
      const latest = deps[0];

      if (
        latest &&
        (
          latest.status === "Succeeded" ||
          latest.status === "Failed"
        )
      ) {
        refreshProjects();
        return true;
      }

      return false;
    };

    let cancelled = false;

    const interval = setInterval(() => {
      if (cancelled) {
        return;
      }

      void poll().then((finished) => {
        if (finished) {
          clearInterval(interval);
        }
      });
    }, 2000);

    void poll().then((finished) => {
      if (finished) {
        clearInterval(interval);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh, refreshProjects]);

  const retry = async (
    deployment: Deployment,
  ) => {
    const response = await fetch(
      `/api/deployments/${deployment.id}/retry`,
      {
        method: "POST",
      },
    );

    await response.json();

    if (!response.ok) {
      return;
    }

    await refresh();
  };

  const rollback = async () => {
    const response = await fetch(
      `/api/projects/${projectId}/rollback`,
      {
        method: "POST",
      },
    );

    if (response.ok) {
      await refresh();
    }
  };

  const duration = (
    deployment: Deployment,
  ) =>
    deployment.startedAt &&
    deployment.finishedAt
      ? `${Math.max(
          0,
          Math.round(
            (
              new Date(
                deployment.finishedAt,
              ).getTime() -
              new Date(
                deployment.startedAt,
              ).getTime()
            ) / 1000,
          ),
        )} detik`
      : "-";

  return (
    <>
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Riwayat deployment</h2>
            <p>
              Pilih deployment untuk melihat log
              lengkap tanpa akses VPS.
            </p>
          </div>

          <button
            className="secondary-btn"
            onClick={() => void rollback()}
          >
            <RotateCcw size={16} />
            Rollback
          </button>
        </div>

        <div className="data-table">
          <div className="table-row head">
            <span>Arsip</span>
            <span>Status</span>
            <span>Durasi</span>
            <span>Waktu</span>
            <span />
          </div>

          {deployments.length ? (
            deployments.map((deployment) => (
              <div
                className="table-row"
                key={deployment.id}
              >
                <span>
                  <strong>
                    {deployment.archiveName}
                  </strong>

                  <small className="deployment-action">
                    {deployment.action ?? "Deploy"}
                    {" · "}
                    {deployment.executor}
                  </small>

                  {deployment.error && (
                    <small className="deployment-error">
                      {deployment.error}
                    </small>
                  )}
                </span>

                <span
                  className={
                    deployment.status ===
                    "WaitingExecutor"
                      ? "status status-deploying"
                      : deployment.status ===
                          "Failed"
                        ? "status status-stopped"
                        : "success-label"
                  }
                >
                  {deployment.status ===
                  "WaitingExecutor"
                    ? "Menunggu executor"
                    : deployment.status}
                </span>

                <span>
                  {duration(deployment)}
                </span>

                <span>
                  {relativeTime(
                    deployment.createdAt,
                  )}
                </span>

                <span>
                  <button
                    className="restore-btn"
                    onClick={() =>
                      setSelectedDeploymentId(
                        deployment.id,
                      )
                    }
                  >
                    <TerminalSquare size={15} />
                    Lihat log
                  </button>

                  {[
                    "WaitingExecutor",
                    "Failed",
                  ].includes(
                    deployment.status,
                  ) && (
                    <button
                      className="restore-btn"
                      onClick={() =>
                        void retry(deployment)
                      }
                    >
                      <RefreshCw size={15} />
                      Coba ulang
                    </button>
                  )}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <FileArchive size={26} />
              <h3>
                Belum ada deployment
              </h3>
              <p>
                Unggah ZIP lalu pilih Deploy ulang.
              </p>
            </div>
          )}
        </div>
      </section>

      {selectedDeploymentId && (
        <LogPanel
          projectId={projectId}
          deploymentId={selectedDeploymentId}
        />
      )}
    </>
  );
}

function EnvironmentTab({ project, notify, canOperate }: { project: Project; notify: (m: string) => void; canOperate: boolean }) {
  const [entries, setEntries] = useState<EnvironmentVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
useEffect(() => { void fetch(`/api/projects/${project.id}/environment`).then((response) => response.json()).then((data) => { if (data.environment) setEntries(data.environment); else setError(data.error || "Environment gagal dimuat."); }).catch(() => setError("Environment gagal dimuat.")).finally(() => setLoading(false)); }, [project.id]);
  const update = (index: number, changes: Partial<EnvironmentVariable>) => setEntries((items) => items.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...changes } : entry));
  const save = async () => {
    setSaving(true); setError("");
    const response = await fetch(`/api/projects/${project.id}/environment`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ environment: entries }) });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setError(result.error || "Environment gagal disimpan.");
    setEntries((items) => items.map((entry) => ({ ...entry, value: entry.isSecret ? "" : entry.value, saved: true })));
    notify("Environment berhasil disimpan.");
  };
  return <section className="panel form-panel"><div className="panel-head"><div><h2>Environment variables</h2><p>Environment aplikasi dikelola dari sini. APP_KEY dan kredensial database dikelola otomatis oleh NEXDEPLOY.</p></div>{canOperate && <div className="environment-actions"><button className="primary-btn" disabled={saving || loading} onClick={() => void save()}><Check size={17} />{saving ? "Menyimpan..." : "Simpan"}</button></div>}</div>{error && <p className="login-error environment-error">{error}</p>}<div className="env-list">{loading ? <p className="user-empty">Memuat environment...</p> : entries.map((entry, index) => <div key={`${entry.key}-${index}`}><input value={entry.key} disabled={!canOperate} onChange={(event) => update(index, { key: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} aria-label="Nama variable" /><input type={entry.isSecret ? "password" : "text"} value={entry.value} disabled={!canOperate} placeholder={entry.isSecret && entry.saved ? "Tersimpan - isi untuk mengganti" : "Nilai"} onChange={(event) => update(index, { value: event.target.value })} aria-label={`Nilai ${entry.key}`} /><button className={`secret-toggle ${entry.isSecret ? "active" : ""}`} disabled={!canOperate} title="Tandai sebagai nilai rahasia" onClick={() => update(index, { isSecret: !entry.isSecret })}><ShieldCheck size={15} /></button><button className="icon-btn subtle" disabled={!canOperate} title="Hapus" onClick={() => setEntries((items) => items.filter((_, entryIndex) => entryIndex !== index))}><X size={16} /></button></div>)}</div>{canOperate && <button className="add-variable" onClick={() => setEntries((items) => [...items, { key: "", value: "", isSecret: false }])}><Plus size={16} />Tambah variable</button>}</section>;
}

function ResourcesTab({ project, notify, canOperate }: { project: Project; notify: (message: string) => void; canOperate: boolean }) {
  const [resources, setResources] = useState<ProjectResources>({ phpVersion: "8.3", cpuLimit: 1, memoryLimit: 512, diskQuota: 5, internalPort: 8080 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
useEffect(() => { void fetch(`/api/projects/${project.id}/resources`).then((response) => response.json()).then((data) => { if (data.resources) setResources(data.resources); else setError(data.error || "Resource gagal dimuat."); }).catch(() => setError("Resource gagal dimuat.")).finally(() => setLoading(false)); }, [project.id]);
  const update = (key: keyof ProjectResources, value: string | number) => setResources((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError("");

    const response = await fetch(
      `/api/projects/${project.id}/resources`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(resources),
      },
    );

    const result = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      return setError(
        result.error || "Resource gagal disimpan.",
      );
    }

    setResources(result.resources);
    notify("Konfigurasi resource berhasil disimpan.");
  };
  return <section className="panel form-panel"><div className="panel-head"><div><h2>Resource container</h2><p>Batas ini akan diterapkan executor Docker saat project dideploy ke VPS.</p></div>{canOperate && <button className="primary-btn" disabled={saving || loading} onClick={() => void save()}><Check size={17} />{saving ? "Menyimpan..." : "Simpan"}</button>}</div>{error && <p className="login-error environment-error">{error}</p>}{loading ? <p className="user-empty">Memuat konfigurasi resource...</p> : <div className="resource-form"><label><span>Versi PHP</span><select disabled={!canOperate} value={resources.phpVersion} onChange={(event) => update("phpVersion", event.target.value)}>{["8.1", "8.2", "8.3", "8.4"].map((version) => <option key={version}>{version}</option>)}</select></label><label><span>CPU limit (vCPU)</span><input disabled={!canOperate} type="number" min="1" max="16" value={resources.cpuLimit} onChange={(event) => update("cpuLimit", Number(event.target.value))} /></label><label><span>Memory limit (MB)</span><input disabled={!canOperate} type="number" min="128" max="32768" step="128" value={resources.memoryLimit} onChange={(event) => update("memoryLimit", Number(event.target.value))} /></label><label><span>Disk quota (GB)</span><input disabled={!canOperate} type="number" min="1" max="1000" value={resources.diskQuota} onChange={(event) => update("diskQuota", Number(event.target.value))} /></label><label><span>Port internal</span><input disabled={!canOperate} type="number" min="1024" max="65535" value={resources.internalPort} onChange={(event) => update("internalPort", Number(event.target.value))} /></label><div className="resource-executor"><Server size={19} /><div><strong>Rencana executor</strong><span>PHP {resources.phpVersion} · {resources.cpuLimit} vCPU · {resources.memoryLimit} MB · {resources.diskQuota} GB · port {resources.internalPort}</span></div></div></div>}</section>;
}

function DatabaseTab({ project, notify, canOperate }: { project: Project; notify: (m: string) => void; canOperate: boolean }) {
  const database = project.database || "MariaDB";
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<{
    databaseType?: string;
    database?: string;
    host?: string;
    port?: number;
    latencyMs?: number;
  } | null>(null);
  const [connectionError, setConnectionError] = useState("");

  if (database === "Tanpa database") {
    return (
      <section className="panel empty-state">
        <Database size={28} />
        <h3>Project ini tanpa database</h3>
        <p>Pilihan tersebut ditentukan saat project dibuat.</p>
      </section>
    );
  }

  const isPostgres =
    database === "PostgreSQL";

  const testConnection =
    async () => {
      if (!canOperate || testing) {
        return;
      }

      setTesting(true);
      setConnectionError("");

      try {
        const response =
          await fetch(
            `/api/projects/${project.id}/database/test`,
            {
              method: "POST",
            },
          );

        const result =
          await response
            .json()
            .catch(() => ({}));

        if (
          !response.ok ||
          !result.ok ||
          !result.connection
        ) {
          throw new Error(
            result.error ||
              "Test koneksi database gagal.",
          );
        }

        setConnection(
          result.connection,
        );

        notify(
          `Koneksi ${database} berhasil · ${result.connection.latencyMs ?? 0} ms`,
        );
      } catch (error) {
        setConnection(null);

        const message =
          error instanceof Error
            ? error.message
            : "Test koneksi database gagal.";

        setConnectionError(
          message,
        );

        notify(
          message,
        );
      } finally {
        setTesting(false);
      }
    };

  const displayedHost =
    connection?.host ||
    "Belum diuji";

  const displayedDatabase =
    connection?.database ||
    "Belum diuji";

  const displayedPort =
    connection?.port ||
    (isPostgres
      ? 5432
      : 3306);

  return (
    <div className="database-grid">
      <section className="panel database-card">
        <div className="database-logo">
          <Database size={26} />
        </div>

        <div>
          {connection ? (
            <span className="success-label">
              <i />
              Terhubung · {connection.latencyMs ?? 0} ms
            </span>
          ) : (
            <span>
              {connectionError
                ? "Koneksi gagal"
                : "Belum diuji"}
            </span>
          )}

          <h2>
            {database} {isPostgres ? "17" : "11.4"}
          </h2>

          <p>
            Database terisolasi khusus untuk project ini.
          </p>

          {connectionError && (
            <p className="login-error environment-error">
              {connectionError}
            </p>
          )}
        </div>

        <dl>
          <div>
            <dt>Host</dt>
            <dd>{displayedHost}</dd>
          </div>

          <div>
            <dt>Database</dt>
            <dd>{displayedDatabase}</dd>
          </div>

          <div>
            <dt>Port</dt>
            <dd>{displayedPort}</dd>
          </div>
        </dl>

        <button
          className="secondary-btn"
          disabled={!connection}
          onClick={() => {
            if (!connection) {
              return;
            }

            navigator.clipboard?.writeText(
              `DB_HOST=${connection.host ?? ""}\nDB_PORT=${connection.port ?? ""}\nDB_DATABASE=${connection.database ?? ""}`,
            );

            notify(
              "Informasi koneksi database disalin",
            );
          }}
        >
          <Copy size={16} />
          Salin informasi koneksi
        </button>
      </section>

      <section className="panel database-actions">
        <h2>Pemeliharaan</h2>

        <button
          disabled={!canOperate}
          onClick={() =>
            notify(
              "Gunakan menu Backup untuk membuat backup database.",
            )
          }
        >
          <Archive size={19} />
          <span>
            <strong>Backup sekarang</strong>
            <small>
              Buat salinan database terbaru
            </small>
          </span>
          <ChevronLeft
            className="rotate"
            size={17}
          />
        </button>

        <button
          disabled={!canOperate || testing}
          onClick={() =>
            void testConnection()
          }
        >
          <Activity size={19} />
          <span>
            <strong>
              {testing
                ? "Menguji koneksi..."
                : "Uji koneksi"}
            </strong>
            <small>
              {connection
                ? `Terhubung · ${connection.latencyMs ?? 0} ms`
                : "Pastikan database dapat diakses"}
            </small>
          </span>

          <ChevronLeft
            className="rotate"
            size={17}
          />
        </button>
      </section>
    </div>
  );
}

function ActivityView() {
  const [filter, setFilter] = useState("all");
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
      let cancelled = false;

      void fetch(`/api/activity?type=${filter}`)
        .then((response) => response.json())
        .then((data) => {
          if (!cancelled) {
            setRecords(data.activity ?? []);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [filter]);

    const filters = [["all", "Semua"], ["deployment", "Deployment"], ["backup", "Backup"], ["account", "Akun"], ["environment", "Environment"], ["resource", "Resource"], ["system", "Sistem"]];
  const icon = (type: ActivityRecord["type"]) => type === "deployment" ? <CloudUpload size={15} /> : type === "backup" ? <Archive size={15} /> : type === "account" ? <ShieldCheck size={15} /> : type === "environment" ? <Settings size={15} /> : type === "resource" ? <Gauge size={15} /> : <Square size={13} />;
  const tone = (type: ActivityRecord["type"]) => type === "backup" ? "violet" : type === "system" ? "warning" : type === "account" ? "success" : "info";
  return <section className="panel activity-page"><div className="activity-filters">{filters.map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => {
      setLoading(true);
      setFilter(id);
    }}>{label}</button>)}</div><div className="activity-feed">{loading ? <p className="user-empty">Memuat aktivitas...</p> : records.length ? records.map((record) => <div key={record.id}><span className={`timeline-icon ${tone(record.type)}`}>{icon(record.type)}</span><div><strong>{record.title}</strong><p>{record.detail}</p><small>{record.projectName ? `${record.projectName} · ` : ""}{relativeTime(record.createdAt)}</small></div></div>) : <div className="empty-state"><Activity size={28} /><h3>Belum ada aktivitas</h3><p>Tindakan pada project dan akun akan tercatat di sini.</p></div>}</div></section>;
}

function BackupsView({ compact = false, project, notify, canOperate = false }: { compact?: boolean; project?: Project; notify: (m: string) => void; canOperate?: boolean }) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(Boolean(project));

  useEffect(() => {
    if (!project) {
      return;
    }

    let cancelled = false;

    void fetch(`/api/projects/${project.id}/backups`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));

        if (!cancelled && response.ok) {
          setBackups(result.backups ?? []);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project]);
  const createBackup = async () => {
    if (!project) {
      return notify("Pilih project untuk membuat backup.");
    }

    const response = await fetch(
      `/api/projects/${project.id}/backups`,
      { method: "POST" },
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return notify(
        result.error || "Backup gagal diantrikan.",
      );
    }

    if (result.backup) {
      setBackups((items) => [
        result.backup,
        ...items,
      ]);
    }

    notify(
      result.backup?.status === "Completed"
        ? "Backup database berhasil dibuat."
        : "Permintaan backup diterima.",
    );
  };
  const deleteBackup = async (
    backup: Backup,
  ) => {
    if (
      !confirm(
        `Hapus backup ${backup.name}? Tindakan ini tidak dapat dibatalkan.`,
      )
    ) {
      return;
    }

    const response =
      await fetch(
        `/api/backups/${backup.id}`,
        {
          method: "DELETE",
        },
      );

    const result =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      return notify(
        result.error ||
        "Backup gagal dihapus.",
      );
    }

    setBackups((items) =>
      items.filter(
        (item) =>
          item.id !== backup.id,
      ),
    );

    notify(
      "Backup berhasil dihapus.",
    );
  };

  const restoreBackup = async (backup: Backup) => {
    if (
      !confirm(
        `Pulihkan database dari ${backup.name}? Database saat ini akan dibackup otomatis sebelum proses restore.`,
      )
    ) {
      return;
    }

    const response = await fetch(
      `/api/backups/${backup.id}/restore`,
      { method: "POST" },
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return notify(
        result.error || "Restore database gagal.",
      );
    }

    notify(
      "Database berhasil dipulihkan. Safety backup kondisi sebelumnya dibuat otomatis.",
    );
  };
  if (!project) return <section className="panel backup-page"><div className="panel-head"><div><h2>Backup terbaru</h2><p>Pilih project untuk melihat atau membuat backup.</p></div></div><div className="empty-state"><Archive size={28} /><h3>Backup per project</h3><p>Buka detail project, lalu pilih tab Backup.</p></div></section>;
  return <section className={`panel backup-page ${compact ? "compact-page" : ""}`}><div className="panel-head"><div><h2>Backup {project.name}</h2><p>Backup database dapat digunakan untuk pemulihan dengan safety backup otomatis sebelum restore.</p></div>{canOperate && <button className="primary-btn" onClick={() => void createBackup()}><Plus size={17} />Buat backup</button>}</div><div className="data-table backups"><div className="table-row head"><span>Nama backup</span><span>Jenis</span><span>Status</span><span>Dibuat</span><span /></div>{loading ? <div className="empty-state"><p>Memuat backup...</p></div> : backups.length ? backups.map((backup) => <div className="table-row" key={backup.id}><span className="backup-name"><Archive size={17} /><strong>{backup.name}</strong></span><span>{backup.type}</span><span
  className={`status ${
    backup.status === "Completed"
      ? "status-healthy"
      : backup.status === "Failed"
        ? "status-stopped"
        : "status-deploying"
  }`}
>
  {backup.status === "Completed"
    ? "Selesai"
    : backup.status === "Failed"
      ? "Gagal"
      : backup.status === "Running"
        ? "Sedang backup"
        : "Menunggu executor"}
</span>
<span>{relativeTime(backup.createdAt)}</span>
{canOperate ? (
  <span className="backup-actions">
    {backup.status === "Completed" && (
      <button
        className="restore-btn"
        onClick={() => void restoreBackup(backup)}
      >
        <RotateCcw size={15} />
        Pulihkan
      </button>
    )}

    {backup.status !== "Running" && (
      <button
        className="restore-btn"
        onClick={() => void deleteBackup(backup)}
      >
        Hapus
      </button>
    )}
  </span>
) : (
  <span />
)}</div>) : <div className="empty-state"><Archive size={26} /><h3>Belum ada backup</h3><p>Buat backup database untuk menyiapkan titik pemulihan project.</p></div>}</div></section>;
}

function SettingsView({ notify, settings, onSave, onChangePassword, isAdmin }: { notify: (m: string) => void; settings: AppSettings; onSave: (s: AppSettings) => Promise<void>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>; isAdmin: boolean }) {
  const [section, setSection] = useState<"server" | "executor" | "domain" | "database" | "users" | "account">(isAdmin ? "server" : "account");
  const [draft, setDraft] = useState(settings);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const update = (key: keyof AppSettings, value: string | number) => setDraft((current) => ({ ...current, [key]: value }));
  const save = () => { void onSave(draft); };
  const submitPassword = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (newPassword !== confirmation) return setPasswordError("Konfirmasi password belum sama."); setChangingPassword(true); setPasswordError(""); const message = await onChangePassword(currentPassword, newPassword); if (message) setPasswordError(message); else notify("Password berhasil diubah. Silakan masuk kembali."); setChangingPassword(false); };
  return <div className="settings-grid"><aside className="settings-menu">{isAdmin && <><button className={section === "server" ? "active" : ""} onClick={() => setSection("server")}><Server size={17} />Server</button><button className={section === "domain" ? "active" : ""} onClick={() => setSection("domain")}><Globe2 size={17} />Domain & SSL</button><button className={section === "database" ? "active" : ""} onClick={() => setSection("database")}><Database size={17} />Database</button><button className={section === "users" ? "active" : ""} onClick={() => setSection("users")}><ShieldCheck size={17} />Pengguna</button></>}<button className={section === "account" ? "active" : ""} onClick={() => setSection("account")}><KeyRound size={17} />Akun</button></aside><section className="panel settings-panel">
    <div className="panel-head"><div><h2>{section === "server" ? "Konfigurasi server" : section === "domain" ? "Domain & SSL" : section === "database" ? "Default database" : section === "users" ? "Pengguna & akses" : "Keamanan akun"}</h2><p>{section === "server" ? "Informasi VPS yang digunakan oleh NEXDEPLOY." : section === "domain" ? "Domain ini dipakai otomatis oleh setiap project baru." : section === "database" ? "Tentukan database awal dan kebijakan backup." : section === "users" ? "Buat akun dan atur akses anggota tim." : "Perbarui password untuk menjaga akses panel tetap aman."}</p></div></div>
    {section === "server" && <div className="settings-form"><label><span>Nama server</span><input value={draft.serverName} onChange={(e) => update("serverName", e.target.value)} /></label><label><span>Alamat IP</span><input value={draft.serverIp} onChange={(e) => update("serverIp", e.target.value)} /></label><label><span>Lokasi</span><select value={draft.location} onChange={(e) => update("location", e.target.value)}><option>Jakarta</option><option>Singapore</option></select></label><label><span>Direktori project</span><input value={draft.projectDirectory} onChange={(e) => update("projectDirectory", e.target.value)} /></label></div>}
    {section === "domain" && <div className="settings-form"><label><span>Base domain</span><input value={draft.baseDomain} onChange={(e) => update("baseDomain", e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""))} placeholder="apps.domain.com" /></label><label><span>URL Nginx Proxy Manager</span><input value={draft.npmUrl} onChange={(e) => update("npmUrl", e.target.value)} /></label><label><span>Email SSL</span><input type="email" value={draft.sslEmail} onChange={(e) => update("sslEmail", e.target.value)} /></label><div className="domain-preview"><Globe2 size={18} /><div><span>Contoh alamat project</span><strong>nama-project.{draft.baseDomain}</strong></div></div></div>}
    {section === "database" && <div className="settings-form"><label><span>Database default</span><select value={draft.defaultDatabase} onChange={(e) => update("defaultDatabase", e.target.value)}><option>MariaDB</option><option>PostgreSQL</option><option>Tanpa database</option></select></label><label><span>Versi default</span><input value={draft.databaseVersion} onChange={(e) => update("databaseVersion", e.target.value)} /></label><label><span>Retensi backup (hari)</span><input type="number" min="1" max="90" value={draft.backupRetention} onChange={(e) => update("backupRetention", Number(e.target.value))} /></label></div>}
    {section === "users" ? <UserManagement notify={notify} /> : section === "account" ? <form className="settings-form password-form" onSubmit={submitPassword}><label><span>Password saat ini</span><input required type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></label><label><span>Password baru</span><input required type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label><label><span>Konfirmasi password baru</span><input required type="password" minLength={8} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" /></label><p className="password-help">Gunakan minimal 8 karakter. Setelah disimpan, semua sesi akun ini akan keluar.</p>{passwordError && <p className="login-error">{passwordError}</p>}<footer className="settings-footer"><button className="primary-btn" disabled={changingPassword}>{<KeyRound size={17} />}{changingPassword ? "Menyimpan..." : "Ubah password"}</button></footer></form> : <><div className="connection-card"><span className="timeline-icon success"><Check size={15} /></span><div><strong>{section === "domain" ? "Format domain valid" : section === "database" ? "Konfigurasi database siap" : "Koneksi server aktif"}</strong><p>{section === "domain" ? `Project baru akan memakai *.${draft.baseDomain}` : section === "database" ? `${draft.defaultDatabase} dipilih sebagai default` : "Docker belum terhubung di komputer lokal"}</p></div><button className="secondary-btn" onClick={() => notify(section === "domain" ? "Koneksi NPM berhasil diuji" : "Konfigurasi berhasil diuji")}>Uji konfigurasi</button></div><footer className="settings-footer"><button className="primary-btn" onClick={save}><Check size={17} />Simpan perubahan</button></footer></>}
  </section></div>;
}

function ExecutorSettings({ notify }: { notify: (message: string) => void }) {
  const [url, setUrl] = useState("http://127.0.0.1:8787");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/executor").then((response) => response.json()).then((data) => { if (data.executor) { setUrl(data.executor.url); setConfigured(data.executor.configured); } }); }, []);
  const save = async () => { const response = await fetch("/api/executor", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, token }) }); const data = await response.json(); if (!response.ok) return setMessage(data.error || "Konfigurasi executor gagal disimpan."); setConfigured(true); setToken(""); setMessage("Konfigurasi executor tersimpan."); notify("Konfigurasi executor tersimpan"); };
  const test = async () => { setMessage("Menguji koneksi executor..."); const response = await fetch("/api/executor", { method: "POST" }); const data = await response.json(); setMessage(response.ok ? `Executor siap (${data.health.mode}).` : (data.error || "Executor tidak dapat dijangkau.")); };
  return <section className="executor-settings"><header className="executor-heading"><div className="executor-title"><span className={configured ? "executor-icon ready" : "executor-icon"}><Zap size={18} /></span><div><h2>Executor deployment</h2><p>Worker privat untuk menerima job dari panel.</p></div></div><div className={configured ? "executor-state ready" : "executor-state"}><i />{configured ? "Siap dikonfigurasi" : "Belum dihubungkan"}</div></header><div className="executor-fields"><label><span>Alamat executor</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:8787" /></label><label><span>Token akses <small>{configured ? "Kosongkan untuk mempertahankan token" : "Wajib untuk koneksi pertama"}</small></span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={configured ? "Token tersimpan dengan aman" : "Tempel EXECUTOR_TOKEN"} autoComplete="off" /></label></div>{message && <p className="executor-message">{message}</p>}<footer className="executor-actions"><button className="secondary-btn" onClick={() => void test()} disabled={!configured}>Uji koneksi</button><button className="primary-btn" onClick={() => void save()}><Check size={16} />Simpan konfigurasi</button></footer></section>;
}

function UserManagement({ notify }: { notify: (message: string) => void }) {
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
const [draft, setDraft] = useState({ name: "", email: "", password: "", role: "Operator" as Role });
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/users")
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setError(
            result.error || "Daftar pengguna gagal dimuat.",
          );
          return;
        }

        setUsers(result.users ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Daftar pengguna gagal dimuat.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error || "Akun gagal dibuat.");
    setUsers((items) => [...items, result.user]);
    setDraft({ name: "", email: "", password: "", role: "Operator" });
    setError("");
    notify(`Akun ${result.user.email} berhasil dibuat`);
  };

  const updateUser = async (user: PanelUser, changes: Partial<Pick<PanelUser, "role" | "status">>) => {
    const response = await fetch(`/api/users/${user.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error || "Akun gagal diperbarui.");
    setUsers((items) => items.map((item) => item.id === user.id ? { ...item, ...result.user } : item));
    setError("");
    notify(`Akses ${user.email} diperbarui`);
  };

  const resetPassword = async (user: PanelUser) => {
    const response = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: temporaryPassword }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error || "Password gagal direset.");
    setTemporaryPassword("");
    setResetUserId(null);
    setError("");
    notify(`Password sementara ${user.email} sudah dibuat`);
  };

  return <div className="user-management"><form className="settings-form user-create-form" onSubmit={createUser}><label><span>Nama</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nama pengguna" /></label><label><span>Email</span><input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="nama@nexdeploy.local" /></label><label><span>Role</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}><option>Administrator</option><option>Operator</option><option>Viewer</option></select></label><label><span>Password awal</span><input required type="password" minLength={8} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} autoComplete="new-password" /></label><div className="user-form-action"><button className="primary-btn"><Plus size={17} />Tambah pengguna</button></div></form>{error && <p className="login-error user-error">{error}</p>}<div className="user-list">{loading ? <p className="user-empty">Memuat pengguna...</p> : users.map((user) => <article className="user-row" key={user.id}><div className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</div><div className="user-identity"><strong>{user.name}</strong><span>{user.email}</span><small>{user.lastLoginAt ? `Terakhir masuk ${relativeTime(user.lastLoginAt)}` : "Belum pernah masuk"}</small></div><select aria-label={`Role ${user.name}`} value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value as Role })}><option>Administrator</option><option>Operator</option><option>Viewer</option></select><button className={`user-status ${user.status === "Active" ? "active" : "disabled"}`} onClick={() => void updateUser(user, { status: user.status === "Active" ? "Disabled" : "Active" })}>{user.status === "Active" ? "Aktif" : "Nonaktif"}</button><button className="secondary-btn" onClick={() => { setResetUserId(resetUserId === user.id ? null : user.id); setTemporaryPassword(""); }}>Reset password</button>{resetUserId === user.id && <div className="reset-password"><input type="password" minLength={8} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="Password sementara (min. 8)" /><button className="primary-btn" disabled={temporaryPassword.length < 8} onClick={() => void resetPassword(user)}>Simpan</button></div>}</article>)}</div></div>;
}

function CreateProjectModal({ onClose, onSubmit, baseDomain, defaultDatabase }: { onClose: () => void; onSubmit: (draft: ProjectDraft) => void; baseDomain: string; defaultDatabase: DatabaseType }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ProjectDraft>({ name: "", framework: "Laravel", database: defaultDatabase, fileName: "" });
  const slug = draft.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "nama-project";
  const next = () => { if (draft.name.trim()) setStep(2); };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!draft.fileName) return; onSubmit(draft); };
  return <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-backdrop" onClick={onClose} aria-label="Tutup dialog" /><div className="modal"><div className="modal-head"><div><span>LANGKAH {step} DARI 2</span><h2 id="modal-title">{step === 1 ? "Buat project baru" : "Unggah aplikasi"}</h2><p>{step === 1 ? "Kami siapkan domain dan database secara otomatis." : `Project ${draft.name} siap menerima file aplikasi.`}</p></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div><div className="step-line"><i className="done" /><i className={step === 2 ? "done" : ""} /></div><form onSubmit={submit}>
    {step === 1 ? <div className="modal-fields"><label><span>Nama project</span><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Contoh: makanan-mama" /></label><label><span>Framework</span><select value={draft.framework} onChange={(e) => setDraft({ ...draft, framework: e.target.value })}><option>Laravel</option><option>PHP Native</option></select></label><label><span>Database</span><select value={draft.database} onChange={(e) => setDraft({ ...draft, database: e.target.value as DatabaseType })}><option>MariaDB</option><option>PostgreSQL</option><option>Tanpa database</option></select></label><div className="domain-preview"><Globe2 size={18} /><div><span>Domain otomatis</span><strong>{slug}.{baseDomain}</strong></div></div></div> : <label className={`upload-zone ${draft.fileName ? "has-file" : ""}`}><CloudUpload size={28} /><h3>{draft.fileName || "Pilih file ZIP aplikasi"}</h3><p>{draft.fileName ? "File siap digunakan dan akan diperiksa sebelum diproses." : "Klik area ini untuk memilih file dari perangkat"}</p><span className="secondary-btn">{draft.fileName ? "Ganti file" : "Pilih file ZIP"}</span><input id="project-archive" type="file" accept=".zip,application/zip" onChange={(e) => { const file = e.target.files?.[0]; setDraft({ ...draft, fileName: file?.name || "", file }); }} /><small>Maksimal 100 MB di panel lokal · format .zip</small></label>}
    <footer className="modal-footer">{step === 2 && <button type="button" className="text-btn" onClick={() => setStep(1)}><ChevronLeft size={16} />Kembali</button>}<span /><button type={step === 1 ? "button" : "submit"} disabled={step === 1 ? !draft.name.trim() : !draft.fileName} className="primary-btn" onClick={step === 1 ? next : undefined}>{step === 1 ? "Lanjutkan" : "Mulai deploy"}{step === 1 && <ChevronLeft size={16} className="rotate" />}</button></footer>
  </form></div></div>;
}

function InitialSetup({ onComplete }: { onComplete: () => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password !== confirmation) {
      return setError("Konfirmasi password belum sama.");
    }

    setSaving(true);
    setError("");

    const response = await fetch(
      "/api/setup",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          password,
        }),
      },
    );

    const result = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      return setError(
        result.error || "Instalasi awal gagal.",
      );
    }

    onComplete();
  };
  return <main className="login-page"><section className="login-brand"><div className="brand login-logo"><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>NEXDEPLOY</span></div><div><span className="login-kicker">INSTALASI AWAL</span><h1>Siapkan akses panel pertama.</h1><p>Buat akun Administrator untuk mengamankan workspace deployment Anda.</p></div><div className="login-health"><ShieldCheck size={19} /><span><strong>Pendaftaran sekali saja</strong><small>Setelah selesai, pengguna baru dikelola dari panel</small></span></div></section><section className="login-form-wrap"><form className="login-form" onSubmit={submit}><div><span className="login-kicker">ADMINISTRATOR</span><h2>Buat akun utama</h2><p>Gunakan email aktif dan password kuat untuk akses pertama.</p></div><label><span>Nama</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label><span>Password</span><input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><label><span>Konfirmasi password</span><input required type="password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>{error && <p className="login-error">{error}</p>}<button className="primary-btn login-submit" disabled={saving}>{<ShieldCheck size={18} />}{saving ? "Menyiapkan akun..." : "Selesaikan instalasi"}</button></form></section></main>;
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<string | null> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!email.trim() || password.length < 6) { setError("Masukkan email dan password minimal 6 karakter."); return; } setSubmitting(true); setError(""); const message = await onLogin(email, password); if (message) setError(message); setSubmitting(false); };
  return <main className="login-page"><section className="login-brand"><div className="brand login-logo"><span className="brand-mark"><Zap size={18} fill="currentColor" /></span><span>NEXDEPLOY</span></div><div><span className="login-kicker">CONTROL PANEL</span><h1>Deployment VPS yang terasa sederhana.</h1><p>Kelola aplikasi, database, domain, log, dan backup dari satu workspace yang tertata.</p></div><div className="login-health"><ShieldCheck size={19} /><span><strong>Panel terlindungi</strong><small>Akses disesuaikan dengan peran pengguna</small></span></div></section><section className="login-form-wrap"><form className="login-form" onSubmit={submit}><div><span className="login-kicker">SELAMAT DATANG</span><h2>Masuk ke NEXDEPLOY</h2><p>Gunakan akun panel untuk mengakses fitur sesuai peran yang sudah ditetapkan.</p></div><label><span>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><label><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <p className="login-error">{error}</p>}<button className="primary-btn login-submit" disabled={submitting}>{<LogIn size={18} />}{submitting ? "Memeriksa akun..." : "Masuk ke panel"}</button></form></section></main>;
}
