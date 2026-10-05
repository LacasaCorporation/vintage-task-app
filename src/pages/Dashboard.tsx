import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import FirmSwitcher from "@/components/FirmSwitcher";
import { FirmMark } from "@/components/FirmLogoPicker";
import { Button } from "@/components/ui/button";
import TasksSidebar from "@/components/TasksSidebar";
import type { ActiveTaskView } from "@/components/TasksSidebar";
import TasksPanel from "@/components/TasksPanel";
import PrimaryNav, { type PrimarySection } from "@/components/PrimaryNav";
import type { CostingView } from "@/components/CostingSidebar";
import { format } from "date-fns";
import { LogOut, Menu, NotebookPen, Settings, X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import type { PromptField } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";
import { canItem, type ActionKey, type GranularPerms, type ItemKey, type SectionKey } from "@/lib/permissions";

/**
 * The heavy sections are fetched when you open them, not on sign-in.
 *
 * Costing alone pulls in sales, purchasing, projects, reports and accounting,
 * and settings is the largest screen in the app — all of it used to be in the
 * first download whether or not it was ever opened. Tasks is the section the
 * app starts on, so that one stays eager and paints immediately.
 */
const CostingPanel = lazy(() => import("@/components/CostingPanel"));
const SettingsPanel = lazy(() => import("@/components/SettingsPanel"));
const NotesPanel = lazy(() => import("@/components/NotesPanel"));
const NotesSidebar = lazy(() => import("@/components/NotesSidebar"));

/** A quiet placeholder while a section's own code arrives. */
function SectionLoading({ label }: { label: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      Opening {label}…
    </p>
  );
}

type Section = "tasks" | "notes" | "costing" | "settings";
type NotebookId = Id<"notebooks">;
type PageId = Id<"notePages">;
type ListId = Id<"taskLists">;
type FolderId = Id<"taskFolders">;

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { confirm, prompt, promptMulti } = useAppDialogs();
  // a page of its own links back to the section it was raised from, so the
  // section is read from the address bar rather than always starting on tasks
  const [section, setSection] = useState<Section>(() => {
    const asked = new URLSearchParams(window.location.search).get("section");
    return asked === "costing" || asked === "notes" || asked === "tasks"
      ? asked
      : "tasks";
  });

  // ── Access control (Settings tab roles & restrictions) ─────────────
  const myAccess = useQuery(api.settings.getMyAccess);
  // the active firm's own logo and name (Settings → Organisation) replace the
  // Slate mark and wordmark; "Slate" stays until a firm has named itself
  const myFirms = useQuery(api.firms.listMyFirms);
  const activeFirm =
    myFirms?.firms.find((f) => f.firmId === myFirms.activeFirmId) ?? null;
  const firmLogo = activeFirm?.logo ?? null;
  const brandName = activeFirm?.name ?? "Slate";
  const ensureWorkspace = useMutation(api.settings.ensureWorkspace);
  const claimPendingInvite = useMutation(api.settings.claimPendingInvite);
  const touchLogin = useMutation(api.accounts.touchLogin);
  useEffect(() => {
    // Bootstrap the organisation (super-admin row), claim any pending invite
    // for this account, and stamp this sign-in.
    ensureWorkspace()
      .then(() => claimPendingInvite())
      .then(() => touchLogin())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const myRole = myAccess?.role ?? "member";
  const canOpenSettings = myRole === "super" || myRole === "admin";
  const perms = myAccess?.permissions as
    | Record<SectionKey, Partial<Record<ActionKey, boolean>>>
    | undefined;
  /** Granular check: can the signed-in user do `action` in `section`? */
  const canDo = (section: SectionKey, action: ActionKey): boolean => {
    if (myRole === "super") return true;
    return perms?.[section]?.[action] ?? true;
  };
  /** Item-level check: can the user do `action` on a specific item? */
  const canDoItem = (item: ItemKey, action: ActionKey): boolean => {
    if (myRole === "super") return true;
    return canItem(myAccess?.permissions as GranularPerms | undefined, item, action);
  };
  const sectionAllowed = (s: Section): boolean => {
    if (s === "settings") return canOpenSettings;
    if (myRole === "super") return true;
    return canDo(s, "view");
  };
  // If restrictions deny the current section, fall back to the first allowed.
  const [lastAccess, setLastAccess] = useState<typeof myAccess>(undefined);
  if (myAccess !== lastAccess) {
    setLastAccess(myAccess);
    if (myAccess && !sectionAllowed(section)) {
      setSection(
        sectionAllowed("tasks")
          ? "tasks"
          : sectionAllowed("notes")
            ? "notes"
            : sectionAllowed("costing")
              ? "costing"
              : "tasks",
      );
    }
  }

  // ── Mine / ALL scope filter (tasks & notes default to the user's own) ─
  const [dataScope, setDataScope] = useState<"mine" | "all">("mine");

  // ── Notes tree state (rendered inside the side menu) ───────────────
  const notebooks = useQuery(api.notebooks.listNotebooks, { scope: dataScope });
  const addNotebook = useMutation(api.notebooks.addNotebook);
  const renameNotebook = useMutation(api.notebooks.renameNotebook);
  const removeNotebook = useMutation(api.notebooks.removeNotebook);
  const addPage = useMutation(api.notebooks.addPage);
  const ensureDefaultWorkbook = useMutation(api.notebooks.ensureDefaultWorkbook);
  const updatePageRemote = useMutation(api.notebooks.updatePage);
  const removePage = useMutation(api.notebooks.removePage);
  const addTask = useMutation(api.tasks.add);

  // ── Task lists (rendered inside the side menu on Tasks) ────────────
  const taskLists = useQuery(api.tasks.listLists);
  const taskFolders = useQuery(api.tasks.listFolders);
  const allTasks = useQuery(api.tasks.list, { scope: dataScope });
  const addList = useMutation(api.tasks.addList);
  const renameList = useMutation(api.tasks.renameList);
  const removeList = useMutation(api.tasks.removeList);
  const addFolderM = useMutation(api.tasks.addFolder);
  const removeFolderM = useMutation(api.tasks.removeFolder);
  const setListFolderM = useMutation(api.tasks.setListFolder);
  const [activeTaskView, setActiveTaskView] = useState<ActiveTaskView>(null);

  const nbList = notebooks ?? [];
  const [activeNotebookId, setActiveNotebookId] = useState<NotebookId | null>(null);
  const [activePageId, setActivePageId] = useState<PageId | null>(null);

  const activeNotebook =
    nbList.find((nb) => nb._id === activeNotebookId) ?? nbList[0] ?? null;
  const notebookId = activeNotebook?._id ?? null;

  const pages = useQuery(
    api.notebooks.listPages,
    notebookId ? { notebookId } : "skip",
  );
  const allPages = useQuery(api.notebooks.listAllPages, { scope: dataScope });

  // ── First-run seeding: "My Workbook" + an untitled page ────────────
  const seededOnce = useRef(false);
  useEffect(() => {
    if (notebooks === undefined) return; // still loading
    if (seededOnce.current) return; // only try once per session
    seededOnce.current = true;
    if (notebooks.length === 0) {
      ensureDefaultWorkbook().catch(() => {
        // If it failed (e.g. racing another tab), the query will refresh;
        // only retry if the list is still empty on next mount.
        seededOnce.current = false;
      });
    }
  }, [notebooks, ensureDefaultWorkbook]);

  const pageList = pages ?? [];
  const activePage =
    pageList.find((p) => p._id === activePageId) ?? pageList[0] ?? null;

  // ── Notes actions ───────────────────────────────────────────────────
  const handleNewNotebook = async () => {
    const title = await prompt({
      title: "New notebook",
      label: "Notebook name",
      placeholder: "My notebook",
      initial: "My notebook",
      required: true,
      confirmLabel: "Create",
    });
    if (title === null) return;
    const clean = title.trim();
    if (!clean) {
      toast.error("Give the notebook a name.");
      return;
    }
    try {
      const id = await addNotebook({ title: clean });
      setActiveNotebookId(id);
      setActivePageId(null);
      setSection("notes");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create notebook.",
      );
    }
  };

  const handleRenameNotebook = async (nb: { _id: NotebookId; title: string }) => {
    const title = await prompt({
      title: "Rename notebook",
      label: "Notebook name",
      initial: nb.title,
      required: true,
    });
    if (title === null) return;
    const clean = title.trim();
    if (!clean) return;
    try {
      await renameNotebook({ id: nb._id, title: clean });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't rename notebook.",
      );
    }
  };

  const handleDeleteNotebook = async (nb: { _id: NotebookId; title: string }) => {
    const ok = await confirm({
      title: `Delete “${nb.title}”?`,
      message: "The notebook and all of its pages will be permanently removed. This cannot be undone.",
      confirmLabel: "Delete notebook",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeNotebook({ id: nb._id });
      if (activeNotebookId === nb._id) setActiveNotebookId(null);
      setActivePageId(null);
      toast.success("Notebook deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the notebook.",
      );
    }
  };

  const handleNewPage = async (targetNotebookId?: NotebookId, parentId?: PageId) => {
    const nbId = targetNotebookId ?? notebookId;
    if (!nbId) {
      toast.error("Create a notebook first.");
      return;
    }
    try {
      const id = await addPage({
        notebookId: nbId,
        parentId: parentId ?? undefined,
      });
      setActiveNotebookId(nbId);
      setActivePageId(id);
      setSection("notes");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create page.",
      );
    }
  };

  const handleRenamePage = async (page: { _id: PageId; title: string }) => {
    const title = await prompt({
      title: "Rename page",
      label: "Page name",
      initial: page.title,
      required: true,
    });
    if (title === null) return;
    const clean = title.trim();
    if (!clean) return;
    try {
      await updatePageRemote({ id: page._id, title: clean });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't rename page.",
      );
    }
  };

  const handleDeletePage = async (page: { _id: PageId; title: string }) => {
    const ok = await confirm({
      title: `Delete “${page.title}”?`,
      message: "The page and its sub-pages will be permanently removed. This cannot be undone.",
      confirmLabel: "Delete page",
      danger: true,
    });
    if (!ok) return;
    try {
      await removePage({ id: page._id });
      if (activePageId === page._id) setActivePageId(null);
      toast.success("Page deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the page.",
      );
    }
  };

  const handleSelectNotebook = (id: NotebookId) => {
    setActiveNotebookId(id);
    setActivePageId(null);
    setSection("notes");
  };

  const handleSelectPage = (nbId: NotebookId, pageId: PageId) => {
    setActiveNotebookId(nbId);
    setActivePageId(pageId);
    setSection("notes");
  };

  /** Flagged letters → task in the default list, linked back to the page. */
  const handleFlagTask = async (text: string, pageId: PageId) => {
    await addTask({ text, sourcePageId: pageId });
  };

  // ── Task list actions ───────────────────────────────────────────────
  const handleNewList = async () => {
    const name = await prompt({
      title: "New list",
      label: "List name",
      placeholder: "My list",
      initial: "My list",
      required: true,
      confirmLabel: "Create",
    });
    if (name === null) return;
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the list a name.");
      return;
    }
    try {
      const id = await addList({ name: clean });
      setActiveTaskView(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create list.");
    }
  };

  const handleRenameList = async (list: { _id: ListId; name: string }) => {
    const name = await prompt({
      title: "Rename list",
      label: "List name",
      initial: list.name,
      required: true,
    });
    if (name === null) return;
    const clean = name.trim();
    if (!clean) return;
    try {
      await renameList({ id: list._id, name: clean });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rename list.");
    }
  };

  const handleDeleteList = async (list: { _id: ListId; name: string }) => {
    const ok = await confirm({
      title: `Delete “${list.name}”?`,
      message: "The list is removed; its tasks move to the default list.",
      confirmLabel: "Delete list",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeList({ id: list._id });
      if (activeTaskView === list._id) setActiveTaskView(null);
      toast.success("List deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete list.");
    }
  };

  const handleNewFolder = async () => {
    const name = await prompt({
      title: "New folder",
      label: "Folder name",
      placeholder: "School",
      initial: "School",
      required: true,
      confirmLabel: "Create",
    });
    if (name === null) return;
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the folder a name.");
      return;
    }
    try {
      await addFolderM({ name: clean });
      toast.success("Folder created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create folder.");
    }
  };

  const handleDeleteFolder = async (folder: { _id: FolderId; name: string }) => {
    const ok = await confirm({
      title: `Delete folder “${folder.name}”?`,
      message: "The folder is removed; its lists are kept and become standalone.",
      confirmLabel: "Delete folder",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFolderM({ id: folder._id });
      toast.success("Folder deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete folder.");
    }
  };

  const handleMoveListToFolder = async (list: {
    _id: ListId;
    name: string;
    folderId?: FolderId;
  }) => {
    const folders = taskFolders ?? [];
    if (folders.length === 0) {
      toast.error('Create a folder first — use “New folder” in the sidebar.');
      return;
    }
    // Simple folder picker using the styled dialog (type a number).
    const options = folders.map((f, i) => `${i + 1}. ${f.name}`);
    const pick = await prompt({
      title: `Move “${list.name}”`,
      message: `Folders:\n${options.join("\n")}\n\nEnter a folder number to move the list there.`,
      placeholder: `1–${folders.length}`,
      inputType: "number",
      confirmLabel: "Move",
      validate: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > folders.length)
          return `Enter a number between 1 and ${folders.length}.`;
        return null;
      },
    });
    if (pick === null) return;
    const n = Number(pick.trim());
    const folder = folders[n - 1];
    if (!folder) return;
    try {
      await setListFolderM({ id: list._id, folderId: folder._id });
      toast.success(`“${list.name}” moved to “${folder.name}”.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't move the list.");
    }
  };

  // ── Costing (raw materials + sheets) ─────────────────────────────
  const materials = useQuery(api.costing.listMaterials);
  const purchases = useQuery(api.purchases.list);
  const salesInvoices = useQuery(api.sales.listSales);
  const ledgerAccounts = useQuery(api.accounting.listAccounts);
  const quotations = useQuery(api.sales.listQuotations);
  const finishedGoods = useQuery(api.costing.listFinishedGoods);
  const projects = useQuery(api.costing.listProjects);
  const allJobs = useQuery(api.jobs.listJobs);
  const addProjectM = useMutation(api.costing.addProject);
  const updateProjectM = useMutation(api.costing.updateProject);
  const removeProjectM = useMutation(api.costing.removeProject);
  const [costingView, setCostingView] = useState<CostingView>(() => {
    // a page of its own links back to the list it was raised from
    const asked = new URLSearchParams(window.location.search).get("view");
    if (asked === "sales") return { kind: "sales", tab: "dashboard" };
    if (asked === "materials") return { kind: "materials" };
    if (asked === "products") return { kind: "products" };
    return { kind: "projects" };
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  type ProjectFields = {
    name: string;
    client: string;
    assignee: string;
    description: string;
    dueDate: string;
    status: string;
    priority: string;
    budget: string;
  };

  const projectFieldDefs = (
    initial?: Partial<ProjectFields>,
  ): PromptField[] => [
    { key: "name", label: "Project name", placeholder: "e.g. Office renovation", required: true, initial: initial?.name },
    { key: "client", label: "Client (optional)", placeholder: "e.g. Acme Ltd", initial: initial?.client },
    { key: "assignee", label: "Assigned to (optional)", placeholder: "e.g. Sarah", initial: initial?.assignee },
    { key: "dueDate", label: "Due date (optional)", type: "date", initial: initial?.dueDate },
    { key: "status", label: "Status", initial: initial?.status ?? "planning" },
    { key: "priority", label: "Priority (high / medium / low)", initial: initial?.priority ?? "medium" },
    { key: "budget", label: "Budget (optional)", type: "number", initial: initial?.budget },
    {
      key: "description",
      label: "Description (optional)",
      placeholder: "Scope, deliverables, notes…",
      initial: initial?.description,
      full: true,
    },
  ];

  const submitProjectFields = async (
    result: Record<string, string>,
    existingId?: Id<"projects">,
  ) => {
    const name = (result.name ?? "").trim();
    if (!name) {
      toast.error("Give the project a name.");
      return;
    }
    const statusOptions = ["planning", "in_progress", "on_hold", "completed", "cancelled"];
    const rawStatus = (result.status ?? "planning").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const status = statusOptions.includes(rawStatus) ? rawStatus : "planning";
    const rawPriority = (result.priority ?? "medium").trim().toLowerCase();
    const priority = ["high", "medium", "low"].includes(rawPriority)
      ? (rawPriority as "high" | "medium" | "low")
      : undefined;
    const dueAt = result.dueDate ? new Date(`${result.dueDate}T12:00:00`).getTime() : undefined;
    const budget = result.budget ? Number(result.budget) : undefined;
    if (budget !== undefined && !Number.isFinite(budget)) {
      toast.error("Enter a valid budget.");
      return;
    }
    try {
      if (existingId) {
        await updateProjectM({
          id: existingId,
          name,
          client: result.client,
          assignee: result.assignee,
          description: result.description,
          dueAt,
          status,
          priority,
          budget,
        });
        toast.success("Project updated.");
      } else {
        await addProjectM({
          name,
          client: result.client,
          assignee: result.assignee,
          description: result.description,
          dueAt,
          status,
          priority,
          budget,
        });
        toast.success(
          `Project “${name}” created — add products to it from the Products tab.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the project.",
      );
    }
  };

  const handleNewProject = async () => {
    const result = await promptMulti({
      title: "New project",
      message: "Codes are assigned automatically — PR for the project.",
      columns: 2,
      confirmLabel: "Create project",
      fields: projectFieldDefs(),
    });
    if (result === null) return;
    await submitProjectFields(result);
  };

  const handleEditProject = async (project: Doc<"projects">) => {
    const result = await promptMulti({
      title: `Edit “${project.name}”`,
      message: "Update the project information.",
      columns: 2,
      confirmLabel: "Save changes",
      fields: projectFieldDefs({
        name: project.name,
        client: project.client ?? "",
        assignee: project.assignee ?? "",
        description: project.description ?? "",
        dueDate:
          project.dueAt !== undefined
            ? new Date(project.dueAt).toISOString().slice(0, 10)
            : "",
        status: project.status ?? "planning",
        priority: project.priority ?? "medium",
        budget: project.budget !== undefined ? String(project.budget) : "",
      }),
    });
    if (result === null) return;
    await submitProjectFields(result, project._id);
  };

  const handleDeleteProject = async (project: Doc<"projects">) => {
    // projects are the last level: products, then jobs, then the project
    const jobCount = (allJobs ?? []).filter(
      (j) => j.projectId === project._id,
    ).length;
    if (jobCount > 0) {
      await confirm({
        title: `“${project.name}” still has ${jobCount} job${jobCount === 1 ? "" : "s"}`,
        message:
          "Delete the products first, then the jobs, and the project can be deleted after that.",
        confirmLabel: "Got it",
        icon: "danger",
      });
      return;
    }
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      message:
        "The project information is removed. Any products still under it are kept and become standalone.",
      confirmLabel: "Delete project",
      danger: true,
      icon: "danger",
    });
    if (!ok) return;
    try {
      await removeProjectM({ id: project._id });
      toast.success("Project deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the project.",
      );
    }
  };

  // ── Shell chrome ────────────────────────────────────────────────────
  const firstName = user?.name?.trim().split(" ")[0] ?? "";
  // Who am I: the provisioned username when there is one, otherwise the
  // sign-in email — an email-code sign-in has no username, and the code flow
  // sets no name either, so without the fallback this line stays blank.
  const organisation = useQuery(api.accounts.getOrganisation);
  const identity = organisation?.myUsername
    ? `@${organisation.myUsername}`
    : (user?.email ?? "");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  /** Sidebar navigation. Choosing a working area leaves Settings behind. */
  const handleSelectSection = (next: PrimarySection) => {
    if (!sectionAllowed(next)) return;
    setSection(next);
    setMobileNavOpen(false);
  };

  /** Picking a costing area implies you are working in Costing, not Tasks. */
  const handleSelectCostingView = (next: CostingView) => {
    if (!sectionAllowed("costing")) return;
    setSection("costing");
    setCostingView(next);
    setMobileNavOpen(false);
  };

  /**
   * The notebook tree. It used to sit under Notes inside the main side menu,
   * which pushed the working areas down and made the notes hierarchy feel
   * subordinate to the app's navigation. It is now its own column, shown only
   * while Notes is open (and inside the mobile drawer, where the wide side
   * menu is not available).
   */
  const notebookTree = (
    <NotesSidebar
      notebooks={nbList}
      allPages={allPages}
      loading={notebooks === undefined || allPages === undefined}
      taskScope={dataScope}
      onScopeChange={setDataScope}
      activeNotebookId={notebookId}
      activePageId={activePage?._id ?? null}
      onSelectNotebook={handleSelectNotebook}
      onSelectPage={handleSelectPage}
      onNewNotebook={canDoItem("notebooks", "create") ? handleNewNotebook : undefined}
      onNewPage={canDoItem("notePages", "create") ? (nbId) => void handleNewPage(nbId) : undefined}
      onNewSubPage={canDoItem("notePages", "create") ? (nbId, parentId) => void handleNewPage(nbId, parentId) : undefined}
      onRenameNotebook={canDoItem("notebooks", "edit") ? handleRenameNotebook : undefined}
      onRenamePage={canDoItem("notePages", "edit") ? handleRenamePage : undefined}
      onDeleteNotebook={canDoItem("notebooks", "delete") ? handleDeleteNotebook : undefined}
      onDeletePage={canDoItem("notePages", "delete") ? handleDeletePage : undefined}
    />
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Side menu ───────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-card/50 md:flex">
        {/* brand */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <FirmMark logo={firmLogo} className="size-8" markClassName="size-4" />
          <span
            className="min-w-0 truncate font-display text-lg font-semibold tracking-tight"
            title={brandName}
          >
            {brandName}
          </span>
        </div>

        {/* the one navigation list, then the drill-down for the open area */}
        <div className="mt-4 space-y-4 border-t border-border/60 px-3 pt-3 pb-4">
          <PrimaryNav
            section={section}
            view={costingView}
            finishedGoods={finishedGoods ?? []}
            materials={materials ?? []}
            purchaseCount={purchases?.length ?? 0}
            projectCount={projects?.length ?? 0}
            salesCount={(salesInvoices?.length ?? 0) + (quotations?.length ?? 0)}
            accountCount={ledgerAccounts?.length ?? 0}
            onSelectSection={handleSelectSection}
            onSelectView={handleSelectCostingView}
            canViewMaterials={canDoItem("materials", "view")}
            canViewPurchase={canDoItem("purchases", "view")}
            canViewSales={canDoItem("sales", "view")}
            canViewAccounting={canDoItem("accounting", "view")}
          />

          {section === "tasks" && (
            <TasksSidebar
              lists={taskLists ?? []}
              folders={taskFolders ?? []}
              loading={taskLists === undefined}
              activeView={activeTaskView}
              onSelectView={setActiveTaskView}
              onNewList={canDoItem("taskLists", "create") ? handleNewList : undefined}
              onRenameList={canDoItem("taskLists", "edit") ? handleRenameList : undefined}
              onDeleteList={canDoItem("taskLists", "delete") ? handleDeleteList : undefined}
              onMoveListToFolder={handleMoveListToFolder}
              onNewFolder={canDoItem("taskFolders", "create") ? handleNewFolder : undefined}
              onDeleteFolder={canDoItem("taskFolders", "delete") ? handleDeleteFolder : undefined}
            />
          )}
        </div>

        {/* user + sign out */}
        <div className="mt-auto border-t border-border/60 p-4">
          {(firstName || identity) && (
            <div className="mb-3 min-w-0 px-1">
              {firstName && (
                <p className="truncate text-sm font-medium">{firstName}</p>
              )}
              {identity && (
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {identity}
                </p>
              )}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start rounded-lg"
            onClick={handleSignOut}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
          {canOpenSettings && (
            <button
              type="button"
              onClick={() => setSection("settings")}
              aria-current={section === "settings" ? "page" : undefined}
              className={cn(
                "mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                section === "settings"
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Settings
                className={cn(
                  "size-4 shrink-0",
                  section === "settings"
                    ? "text-primary"
                    : "text-muted-foreground/70",
                )}
              />
              Settings
            </button>
          )}
        </div>
      </aside>

      {/* ── Notes: its own notebook column, only while Notes is open ── */}
      {section === "notes" && (
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-card/30 md:flex">
          <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
            <NotebookPen className="size-4 shrink-0 text-primary" />
            <span className="font-display text-base font-semibold tracking-tight">
              Notes
            </span>
          </div>
          <div className="px-3 py-3">
            <Suspense fallback={null}>{notebookTree}</Suspense>
          </div>
        </aside>
      )}

      {/* ── Mobile navigation: the same list, behind a scrim ────────── */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border/60 bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-2 px-4 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <FirmMark logo={firmLogo} className="size-8" markClassName="size-4" />
                <span className="min-w-0 truncate font-display text-lg font-semibold tracking-tight">
                  {brandName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="border-t border-border/60 px-3 py-3">
              <PrimaryNav
                section={section}
                view={costingView}
                finishedGoods={finishedGoods ?? []}
                materials={materials ?? []}
                purchaseCount={purchases?.length ?? 0}
                projectCount={projects?.length ?? 0}
                salesCount={(salesInvoices?.length ?? 0) + (quotations?.length ?? 0)}
                accountCount={ledgerAccounts?.length ?? 0}
                onSelectSection={handleSelectSection}
                onSelectView={handleSelectCostingView}
                canViewMaterials={canDoItem("materials", "view")}
                canViewPurchase={canDoItem("purchases", "view")}
                canViewSales={canDoItem("sales", "view")}
                canViewAccounting={canDoItem("accounting", "view")}
              />

              {/* the notebook tree lives in its own column on wide screens;
                  here it follows the navigation list instead */}
              {section === "notes" && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <Suspense fallback={null}>{notebookTree}</Suspense>
                </div>
              )}
            </div>

            <div className="mt-auto space-y-1 border-t border-border/60 p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start rounded-lg"
                onClick={() => {
                  setMobileNavOpen(false);
                  void handleSignOut();
                }}
              >
                <LogOut className="size-3.5" />
                Sign out
              </Button>
              {canOpenSettings && (
                <button
                  type="button"
                  onClick={() => handleSelectSection("settings")}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    section === "settings"
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Settings className="size-4 shrink-0" />
                  Settings
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-8">
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Menu className="size-5" />
              </button>
              <FirmMark logo={firmLogo} className="size-7" markClassName="size-3.5" />
              <span className="max-w-40 truncate font-display font-semibold" title={brandName}>
                {brandName}
              </span>
            </div>
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <span className="truncate font-display text-sm font-semibold tracking-tight">
                {brandName}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <FirmSwitcher />
              {(firstName || identity) && (
                <span className="hidden min-w-0 text-right sm:block">
                  {firstName && (
                    <span className="block truncate text-sm text-muted-foreground">
                      {firstName}
                    </span>
                  )}
                  {identity && (
                    <span className="block truncate font-mono text-xs text-muted-foreground/80">
                      {identity}
                    </span>
                  )}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg md:hidden"
                onClick={handleSignOut}
              >
                <LogOut className="size-3.5" />
              </Button>
            </div>
          </div>
        </header>

        {/* wide content area — uses the full window width */}
        <main className="w-full flex-1 px-4 pb-12 pt-6 sm:px-8">
          {section === "tasks" && (
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h1 className="font-display text-xl font-semibold tracking-tight">
                {greetingForHour(new Date().getHours())}
                {firstName ? `, ${firstName}` : ""}.
              </h1>
              <p className="text-xs text-muted-foreground">
                {format(new Date(), "EEEE, MMMM d")}
              </p>
            </div>
          )}

          {section === "settings" ? (
            <Suspense fallback={<SectionLoading label="settings" />}>
              <SettingsPanel />
            </Suspense>
          ) : section === "costing" ? (
            <Suspense fallback={<SectionLoading label="costing" />}>
            <CostingPanel
              materials={materials ?? []}
              finishedGoods={finishedGoods ?? []}
              loading={finishedGoods === undefined}
              view={costingView}
              onSelectView={setCostingView}
                            onNewProject={canDoItem("projects", "create") ? () => void handleNewProject() : undefined}
              onEditProject={(p) => void handleEditProject(p)}
              onDeleteProject={(p) => void handleDeleteProject(p)}
              canCreate={canDoItem("products", "create")}
              canEdit={canDoItem("products", "edit")}
              canDelete={canDoItem("products", "delete")}
              canViewMaterials={canDoItem("materials", "view")}
              canViewPurchase={canDoItem("purchases", "view")}
              canViewSales={canDoItem("sales", "view")}
              canViewAccounting={canDoItem("accounting", "view")}
              canCreatePurchase={canDoItem("purchases", "create")}
              canEditPurchase={canDoItem("purchases", "edit")}
              canDeletePurchase={canDoItem("purchases", "delete")}
              canCreateMaterial={canDoItem("materials", "create")}
              canEditMaterial={canDoItem("materials", "edit")}
              canDeleteMaterial={canDoItem("materials", "delete")}
              canPrint={canDoItem("printing", "view")}
              canImportExport={canDoItem("dataImport", "view")}
              canImport={canDoItem("dataImport", "create")}
              canEditProject={canDoItem("projects", "edit")}
              canDeleteProject={canDoItem("projects", "delete")}
            />
            </Suspense>
          ) : section === "tasks" ? (
            <TasksPanel
              activeView={activeTaskView}
              lists={taskLists ?? []}
              onSelectView={setActiveTaskView}
              canCreate={canDo("tasks", "create")}
              canEdit={canDo("tasks", "edit")}
              canDelete={canDo("tasks", "delete")}
              canCreateSteps={canDoItem("taskSteps", "create")}
              canEditSteps={canDoItem("taskSteps", "edit")}
              canDeleteSteps={canDoItem("taskSteps", "delete")}
            />
          ) : (
            <Suspense fallback={<SectionLoading label="notes" />}>
              <NotesPanel
                activePage={activePage}
                pagesLoading={pages === undefined}
                onNewPage={() => handleNewPage()}
                onFlagTask={handleFlagTask}
                tasks={allTasks ?? []}
                canCreate={canDoItem("notePages", "create")}
                canEdit={canDoItem("notePages", "edit")}
                canFlag={canDoItem("flagToTask", "create")}
              />
            </Suspense>
          )}
        </main>

        <p className="pb-8 text-center text-xs text-muted-foreground">
          Slate · Your tasks &amp; notes, synced in real time.
        </p>
      </div>
    </div>
  );
}