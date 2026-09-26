import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MasterDataManager from "@/components/MasterDataManager";
import { useAppDialogs } from "@/components/AppDialogs";
import CurrencyPicker from "@/components/CurrencyPicker";
import { cn } from "@/lib/utils";
import { downloadBackupFile } from "@/lib/backup-download";
import {
  ACTION_DESCRIPTIONS,
  ACTIONS,
  type ActionKey,
  itemsForSection,
  ITEMS,
  SECTIONS,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/permissions";
import {
  Building2,
  Calculator,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  GitBranch,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  NotebookPen,
  Pencil,
  Power,
  RefreshCw,
  Upload,
  Download,
  DatabaseBackup,
  Settings as SettingsIcon,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Tags,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Role = "super" | "admin" | "user" | "member";
type AssignableRole = Exclude<Role, "super">;

type GranularPerms = {
  tasks?: Partial<Record<ActionKey, boolean>>;
  notes?: Partial<Record<ActionKey, boolean>>;
  costing?: Partial<Record<ActionKey, boolean>>;
  items?: Record<string, Partial<Record<ActionKey, boolean>>>;
};

type Member = {
  userId: Id<"users">;
  role: Role;
  customRoleId?: Id<"customRoles">;
  managerId?: Id<"users">;
  permissions?: GranularPerms;
  joinedAt: number;
  name?: string;
  email?: string;
  isSuper: boolean;
  teamSize: number;
};

type CustomRole = {
  _id: Id<"customRoles">;
  name: string;
  description?: string;
  permissions?: GranularPerms;
  createdAt: number;
};

type PendingInvite = {
  _id: Id<"pendingInvites">;
  email: string;
  role: AssignableRole;
  customRoleId?: Id<"customRoles">;
  createdAt: number;
};

/** A sign-in provisioned by the super admin (Settings → Sign-ins). */
type ProvisionedLogin = {
  _id: Id<"credentials">;
  userId: Id<"users">;
  username: string;
  displayName: string | null;
  managerId: Id<"users"> | null;
  createdAt: number;
  lastLoginAt: number | null;
  disabled: boolean;
  role: Role;
  customRoleId: Id<"customRoles"> | null;
};

/** My position in the management chain (api.settings.getMyTeam). */
type MyTeam = {
  manager: { userId: Id<"users">; role: Role; name?: string } | null;
  isSuper: boolean;
  directReports: Array<{
    userId: Id<"users">;
    role: Role;
    customRoleId?: Id<"customRoles">;
    name?: string;
    email?: string;
  }>;
} | null;

/**
 * The settings tabs, in the same order as the <section> elements below and in
 * index.css. CSS shows only the active one, so a new section must be added to
 * all three in step.
 */
const SETTINGS_TABS = [
  ["organisation", "Organisation", Building2],
  ["people", "Users & roles", Users],
  ["team", "Team hierarchy", GitBranch],
  ["credentials", "Credentials", KeyRound],
  ["roles", "Custom roles", Tags],
  ["catalog", "Units & categories", Shapes],
  ["data", "Backup & restore", DatabaseBackup],
] as const;

/** Readable, easy-to-dictate password for a freshly created login. */
function makePassword(): string {  const words = [
    "slate",
    "ember",
    "cedar",
    "river",
    "north",
    "maple",
    "delta",
    "quartz",
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function formatWhen(ts: number | null): string {
  if (ts === null) return "Never signed in";
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Rank used to sort the hierarchy tree (higher roles first). */
const ROLE_RANK_OF: Record<Role, number> = {
  super: 3,
  admin: 2,
  user: 1,
  member: 0,
};

const ROLE_META: Record<Role, { label: string; chip: string; blurb: string }> = {
  super: {
    label: "Super user",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
    blurb: "Full control — owner of the workspace.",
  },
  admin: {
    label: "Admin",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    blurb: "Adds users, changes roles & restrictions.",
  },
  user: {
    label: "User",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    blurb: "Normal access to allowed sections.",
  },
  member: {
    label: "Member",
    chip: "bg-muted text-muted-foreground",
    blurb: "Limited, read-mostly access.",
  },
};

const SECTION_ICONS: Record<SectionKey, typeof CheckSquare> = {
  tasks: CheckSquare,
  notes: NotebookPen,
  costing: Calculator,
};

const ASSIGNABLE: AssignableRole[] = ["admin", "user", "member"];

type PermDraft = {
  sections: Record<SectionKey, Record<ActionKey, boolean>>;
  items: Record<string, Partial<Record<ActionKey, boolean>>>;
};

const allAllowed = (): PermDraft => ({
  sections: {
    tasks: { view: true, create: true, edit: true, delete: true },
    notes: { view: true, create: true, edit: true, delete: true },
    costing: { view: true, create: true, edit: true, delete: true },
  },
  items: Object.fromEntries(
    ITEMS.map((item) => [
      item.key,
      Object.fromEntries(item.actions.map((a) => [a, true])),
    ]),
  ),
});

const fromPerms = (perms: GranularPerms | undefined): PermDraft => ({
  sections: {
    tasks: {
      view: perms?.tasks?.view ?? true,
      create: perms?.tasks?.create ?? true,
      edit: perms?.tasks?.edit ?? true,
      delete: perms?.tasks?.delete ?? true,
    },
    notes: {
      view: perms?.notes?.view ?? true,
      create: perms?.notes?.create ?? true,
      edit: perms?.notes?.edit ?? true,
      delete: perms?.notes?.delete ?? true,
    },
    costing: {
      view: perms?.costing?.view ?? true,
      create: perms?.costing?.create ?? true,
      edit: perms?.costing?.edit ?? true,
      delete: perms?.costing?.delete ?? true,
    },
  },
  items: Object.fromEntries(
    ITEMS.map((item) => [
      item.key,
      Object.fromEntries(
        item.actions.map((a) => [a, perms?.items?.[item.key]?.[a] ?? true]),
      ),
    ]),
  ),
});

/** Compact summary of a permission set, e.g. "Tasks: full · Notes: view+edit". */
function permsSummary(perms: GranularPerms | undefined): string {
  const parts = SECTIONS.map((s) => {
    const denied = ACTIONS.filter((a) => perms?.[s]?.[a] === false);
    const items = itemsForSection(s).filter((item) =>
      item.actions.some((a) => perms?.items?.[item.key]?.[a] === false),
    );
    let base: string;
    if (denied.length === 0) base = "full";
    else if (denied.length === ACTIONS.length) base = "none";
    else base = ACTIONS.filter((a) => !denied.includes(a)).join("+");
    const suffix =
      items.length > 0
        ? ` (${items.length} item${items.length === 1 ? "" : "s"} restricted)`
        : "";
    return `${SECTION_LABELS[s]}: ${base}${suffix}`;
  });
  return parts.join(" · ");
}

/** One section block of the permission matrix (View / Create / Edit / Delete). */
function SectionMatrix({
  perms,
  onChange,
  disabled,
}: {
  perms: Partial<Record<ActionKey, boolean>>;
  onChange: (action: ActionKey, allowed: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {ACTIONS.map((action) => {
        const allowed = perms[action] ?? true;
        return (
          <button
            key={action}
            type="button"
            disabled={disabled}
            title={ACTION_DESCRIPTIONS[action]}
            aria-pressed={allowed}
            onClick={() => onChange(action, !allowed)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition-colors",
              allowed
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : "border-destructive/30 bg-destructive/5 text-destructive",
              !disabled && "hover:brightness-95",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            {allowed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {action.charAt(0).toUpperCase() + action.slice(1)}
          </button>
        );
      })}
    </div>
  );
}

/** Full permission matrix: every section, plus its items, action by action. */
function PermissionMatrix({
  value,
  onSectionChange,
  onItemChange,
  disabled,
}: {
  value: PermDraft;
  onSectionChange: (section: SectionKey, action: ActionKey, allowed: boolean) => void;
  onItemChange: (item: string, action: ActionKey, allowed: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {SECTIONS.map((s) => {
        const Icon = SECTION_ICONS[s];
        const sectionItems = itemsForSection(s);
        return (
          <div key={s} className="rounded-xl border px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{SECTION_LABELS[s]}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                Whole section
              </span>
            </div>
            <SectionMatrix
              perms={value.sections[s]}
              disabled={disabled}
              onChange={(a, allowed) => onSectionChange(s, a, allowed)}
            />

            {sectionItems.length > 0 && (
              <div className="mt-2.5 space-y-1 border-t pt-2.5">
                <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Detailed · inside {SECTION_LABELS[s].toLowerCase()}
                </p>
                {sectionItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
                      {item.label}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {item.actions.map((action) => {
                        const allowed =
                          value.items[item.key]?.[action as ActionKey] ?? true;
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={disabled}
                            title={`${item.label} — ${ACTION_DESCRIPTIONS[action as ActionKey]}`}
                            aria-pressed={allowed}
                            onClick={() =>
                              onItemChange(item.key, action as ActionKey, !allowed)
                            }
                            className={cn(
                              "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition-colors",
                              allowed
                                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                                : "border-destructive/30 bg-destructive/5 text-destructive",
                              !disabled && "hover:brightness-95",
                            )}
                          >
                            {allowed ? (
                              <Eye className="size-3" />
                            ) : (
                              <EyeOff className="size-3" />
                            )}
                            {action.charAt(0).toUpperCase() + action.slice(1)}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SettingsPanel() {
  const { confirm } = useAppDialogs();
  const myAccess = useQuery(api.settings.getMyAccess);
  // shared master data (units & categories) used by products and materials
  const units = useQuery(api.costing.listUnits);
  const allCategories = useQuery(api.costing.listCategories);

  const members = useQuery(api.settings.listMembers);
  const customRoles = useQuery(api.settings.listCustomRoles);
  const pendingInvites = useQuery(api.settings.listPendingInvites);
  const currentUser = useQuery(api.users.currentUser);

  // organisation + provisioned sign-ins
  const organisation = useQuery(api.accounts.getOrganisation);
  const logins = useQuery(api.accounts.listLogins);
  const myTeam = useQuery(api.settings.getMyTeam) as MyTeam;
  const setMemberManager = useMutation(api.settings.setMemberManager);
  const createOrganisation = useMutation(api.accounts.createOrganisation);
  const createUserLogin = useAction(api.accounts.createUserLogin);
  const setLoginPassword = useAction(api.accounts.setLoginPassword);
  const setLoginDisabledM = useAction(api.accounts.setLoginDisabled);
  const deleteLoginM = useAction(api.accounts.deleteLogin);

  const inviteMember = useMutation(api.settings.inviteMember);
  const setMemberRole = useMutation(api.settings.setMemberRole);
  const setMemberCustomRole = useMutation(api.settings.setMemberCustomRole);
  const setMemberSectionPermissions = useMutation(
    api.settings.setMemberSectionPermissions,
  );
  const setMemberItemPermissions = useMutation(
    api.settings.setMemberItemPermissions,
  );
  const removeMember = useMutation(api.settings.removeMember);
  const setWorkspaceName = useMutation(api.settings.setWorkspaceName);
  const cancelPendingInvite = useMutation(api.settings.cancelPendingInvite);
  const createCustomRole = useMutation(api.settings.createCustomRole);
  const updateCustomRole = useMutation(api.settings.updateCustomRole);
  const deleteCustomRole = useMutation(api.settings.deleteCustomRole);

  const [busy, setBusy] = useState(false);

  // ── backup & restore ─────────────────────────────────────────────────
  const backupData = useQuery(api.backup.exportBackup);
  const restoreBackupM = useMutation(api.backup.restoreBackup);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<AssignableRole>("user");
  const [addCustomRoleId, setAddCustomRoleId] = useState<Id<"customRoles"> | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // organisation dialog
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  // "create user" (username + password) dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState(makePassword());
  const [revealPassword, setRevealPassword] = useState(true);
  const [inviteMode, setInviteMode] = useState(false);
  /** Manager chosen in the create-user dialog (userId, or null = the org owner). */
  const [newManagerId, setNewManagerId] = useState<Id<"users"> | null>(null);
  const [handedOver, setHandedOver] = useState<{
    username: string;
    password: string;
  } | null>(null);

  // reset-password dialog
  const [pwLogin, setPwLogin] = useState<ProvisionedLogin | null>(null);
  const [pwDraft, setPwDraft] = useState("");
  const [pwResult, setPwResult] = useState<string | null>(null);
  // passwords are hidden until someone asks to see them
  const [pwRevealDraft, setPwRevealDraft] = useState(false);
  const [pwRevealResult, setPwRevealResult] = useState(false);

  // credentials list: per-login username + a hidden password box
  const [credDrafts, setCredDrafts] = useState<Record<string, string>>({});
  const [credRevealed, setCredRevealed] = useState<Record<string, boolean>>({});
  const [credBusy, setCredBusy] = useState<string | null>(null);
  const [credSaved, setCredSaved] = useState<string | null>(null);

  // Each settings area is its own tab, so only one section is on screen.
  // The order here must match SETTINGS_SECTIONS in index.css, which hides the
  // other sections by their position among the sibling <section> elements.
  const [settingsTab, setSettingsTab] = useState<
    | "organisation"
    | "people"
    | "team"
    | "credentials"
    | "roles"
    | "catalog"
    | "data"
  >("people");

  const saveCredential = async (login: ProvisionedLogin) => {
    const password = (credDrafts[login._id] ?? "").trim();
    if (password.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    setCredBusy(login._id);
    try {
      await setLoginPassword({ credentialsId: login._id, password });
      setCredDrafts((current) => ({ ...current, [login._id]: "" }));
      setCredRevealed((current) => ({ ...current, [login._id]: false }));
      setCredSaved(login._id);
      toast.success(`Password updated for @${login.username}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the password.",
      );
    } finally {
      setCredBusy(null);
    }
  };

  // collapsed nodes in the team hierarchy tree
  const [collapsedNodes, setCollapsedNodes] = useState<Set<Id<"users">>>(new Set());

  useEffect(() => {
    if (organisation?.name) setOrgName(organisation.name);
  }, [organisation?.name]);

  // role editor dialog state (create + edit share one dialog)
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<Id<"customRoles"> | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePerms, setRolePerms] = useState(allAllowed());

  // per-user detailed permissions dialog
  const [permMember, setPermMember] = useState<Member | null>(null);
  const [permDraft, setPermDraft] = useState(allAllowed());

  if (myAccess === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card px-5 py-14 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading settings…
      </div>
    );
  }

  const isSuper = myAccess?.isSuper ?? false;
  const role = (myAccess?.role ?? "member") as Role;
  const canManage = isSuper || role === "admin";

  if (!canManage) {
    return (
      <div className="rounded-2xl border bg-card px-6 py-14 text-center shadow-sm">
        <ShieldCheck className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-3 font-medium">Restricted</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Only the super user and admins can open Settings.
        </p>
      </div>
    );
  }

  const resetAddDialog = () => {
    setAddEmail("");
    setAddRole("user");
    setAddCustomRoleId(null);
  };

  // ── backup & restore handlers ────────────────────────────────────────

  const handleExportBackup = () => {
    if (!backupData) return;
    downloadBackupFile(backupData);
    toast.success(
      `Backup downloaded — ${backupData.totalRows} item${backupData.totalRows === 1 ? "" : "s"} exported.`,
    );
  };

  const handleRestoreFile = async (file: File) => {
    setRestoring(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON — is it the right file?");
      }
      const doc = parsed as { version?: number; totalRows?: number };
      if (doc?.version !== 1) {
        throw new Error(
          "That file isn't a Slate backup (or was made with a different version).",
        );
      }
      const confirmed = await confirm({
        title: "Restore this backup?",
        message: `This will REPLACE everything currently in your workspace with the backup's ${doc.totalRows ?? "?"} items. Your current tasks, notes, products and projects will be permanently deleted.`,
        confirmLabel: "Replace my data",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!confirmed) return;
      await restoreBackupM({ backup: parsed });
      toast.success("Backup restored — your workspace has been replaced.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── organisation + sign-ins ────────────────────────────────────────────

  const loginFor = (userId: Id<"users">) =>
    (logins ?? []).find((l) => l.userId === userId);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error("Couldn't copy — please select and copy it manually.");
    }
  };

  const resetCreateDialog = () => {
    setNewPersonName("");
    setNewUsername("");
    setNewPassword(makePassword());
    setRevealPassword(true);
    setAddRole("user");
    setAddCustomRoleId(null);
    setNewManagerId(null);
    setInviteMode(false);
    resetAddDialog();
  };

  /** Display name for a member id, falling back to their email / "User". */
  const memberName = (id: Id<"users">) => {
    const m = (members ?? []).find((mm) => mm.userId === id);
    return m?.name ?? m?.email ?? "User";
  };

  const handleAssignManager = async (member: Member, managerId: Id<"users"> | null) => {
    try {
      await setMemberManager({
        userId: member.userId,
        managerId: managerId ?? undefined,
      });
      toast.success(
        managerId === null
          ? `${memberName(member.userId)} moved to the top of the chain.`
          : `${memberName(member.userId)} now reports to ${memberName(managerId)}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't set the manager.",
      );
    }
  };

  const handleCreateOrganisation = async () => {
    setBusy(true);
    try {
      await createOrganisation({ name: orgName });
      toast.success("Organisation saved — now create logins for your team.");
      setOrgOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the organisation.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLogin = async () => {
    setBusy(true);
    try {
      const result = await createUserLogin({
        username: newUsername,
        password: newPassword,
        name: newPersonName.trim() || undefined,
        role: addRole,
        customRoleId: addCustomRoleId ?? undefined,
        managerId: newManagerId ?? undefined,
      });
      setCreateOpen(false);
      setHandedOver({ username: result.username, password: newPassword });
      toast.success(`Login \u201c${result.username}\u201d created.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the login.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSetPassword = async () => {
    if (pwLogin === null) return;
    setBusy(true);
    try {
      await setLoginPassword({ credentialsId: pwLogin._id, password: pwDraft });
      setPwResult(pwDraft);
      toast.success(`New password set for \u201c${pwLogin.username}\u201d.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the password.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDisabled = async (login: ProvisionedLogin) => {
    try {
      await setLoginDisabledM({
        credentialsId: login._id,
        disabled: !login.disabled,
      });
      toast.success(
        login.disabled
          ? `\u201c${login.username}\u201d can sign in again.`
          : `\u201c${login.username}\u201d can no longer sign in.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the login.",
      );
    }
  };

  const handleDeleteLogin = async (login: ProvisionedLogin) => {
    const ok = await confirm({
      title: `Delete the login \u201c${login.username}\u201d?`,
      message:
        "They lose access immediately and the username is freed up. Everything they worked on stays with the organisation.",
      confirmLabel: "Delete login",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLoginM({ credentialsId: login._id });
      toast.success("Login deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the login.",
      );
    }
  };

  const submitInvite = async () => {
    const email = addEmail.trim();
    if (!email || !email.includes("@")) {
      toast.error("Enter the person's email address.");
      return;
    }
    setBusy(true);
    try {
      const result = await inviteMember({
        email,
        role: addRole,
        customRoleId: addCustomRoleId ?? undefined,
        managerId: newManagerId ?? undefined,
      });
      if (result?.pending) {
        toast.success(
          `Invite saved for ${email} — they'll join automatically the first time they sign in.`,
        );
      } else {
        toast.success(`${email} added as ${ROLE_META[addRole].label}.`);
      }
      setCreateOpen(false);
      resetAddDialog();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add that user.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openRoleEditor = (r?: CustomRole) => {
    if (r) {
      setEditingRoleId(r._id);
      setRoleName(r.name);
      setRoleDescription(r.description ?? "");
      setRolePerms(fromPerms(r.permissions));
    } else {
      setEditingRoleId(null);
      setRoleName("");
      setRoleDescription("");
      setRolePerms(allAllowed());
    }
    setRoleEditorOpen(true);
  };

  const submitRole = async () => {
    setBusy(true);
    const permissions = { ...rolePerms.sections, items: rolePerms.items };
    try {
      if (editingRoleId !== null) {
        await updateCustomRole({
          id: editingRoleId,
          name: roleName,
          description: roleDescription,
          permissions,
        });
        toast.success(`Role “${roleName}” updated.`);
      } else {
        await createCustomRole({
          name: roleName,
          description: roleDescription,
          permissions,
        });
        toast.success(`Role “${roleName}” created.`);
      }
      setRoleEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the role.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRole = async (r: CustomRole) => {
    const ok = await confirm({
      title: `Delete role “${r.name}”?`,
      message:
        "Members using this role fall back to their base role until you assign another one.",
      confirmLabel: "Delete",
      danger: true,
      icon: "danger",
    });
    if (!ok) return;
    try {
      await deleteCustomRole({ id: r._id });
      toast.success(`Role “${r.name}” deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the role.");
    }
  };

  const handleAssignCustomRole = async (member: Member, roleId: Id<"customRoles"> | null) => {
    try {
      await setMemberCustomRole({ userId: member.userId, customRoleId: roleId ?? undefined });
      toast.success(
        roleId === null
          ? "Custom role cleared."
          : `Custom role “${(customRoles ?? []).find((r) => r._id === roleId)?.name ?? ""}” assigned.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't assign the role.");
    }
  };

  const handleRoleChange = async (member: Member, next: AssignableRole) => {
    if (next === member.role) return;
    try {
      await setMemberRole({ userId: member.userId, role: next });
      toast.success(
        `${member.name ?? member.email ?? "User"} is now ${ROLE_META[next].label}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the role.",
      );
    }
  };

  const openPermDialog = (m: Member) => {
    setPermMember(m);
    setPermDraft(fromPerms(m.permissions));
  };

  const submitMemberPerms = async () => {
    if (permMember === null) return;
    setBusy(true);
    try {
      for (const s of SECTIONS) {
        await setMemberSectionPermissions({
          userId: permMember.userId,
          section: s,
          permissions: { [s]: permDraft.sections[s] } as GranularPerms,
        });
      }
      for (const item of ITEMS) {
        await setMemberItemPermissions({
          userId: permMember.userId,
          item: item.key,
          permissions: {
            items: { [item.key]: permDraft.items[item.key] ?? {} },
          } as GranularPerms,
        });
      }
      toast.success(
        `Permissions saved for ${permMember.name ?? permMember.email ?? "user"}.`,
      );
      setPermMember(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the permissions.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (member: Member) => {
    const ok = await confirm({
      title: `Remove ${member.name ?? member.email ?? "user"}?`,
      message: "They lose access to the workspace until added again.",
      confirmLabel: "Remove",
      danger: true,
      icon: "danger",
    });
    if (!ok) return;
    try {
      await removeMember({ userId: member.userId });
      toast.success("User removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove that user.",
      );
    }
  };

  const submitWorkspaceName = async () => {
    try {
      await setWorkspaceName({ name: nameDraft });
      toast.success("Workspace name saved.");
      setNameOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the name.",
      );
    }
  };

  return (
    <div className="space-y-6" data-settings-tab={settingsTab}>
      {/* header */}
      <div>
        <h1 className="font-display flex items-center gap-2 text-3xl font-bold tracking-tight">
          <SettingsIcon className="size-6 text-primary" />
          Settings
        </h1>
        <p className="mt-1 text-muted-foreground">
          Create users, assign roles, and control exactly what each person can
          view, create, edit, and delete.
        </p>
      </div>

      {/* my role summary */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            You are signed in as{" "}
            {currentUser?.name ?? currentUser?.email ?? "a user"}
          </p>
          <p className="text-xs text-muted-foreground">
            Role:{" "}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                ROLE_META[role].chip,
              )}
            >
              {ROLE_META[role].label}
            </span>
          </p>
        </div>
      </div>

      {/* ── Tabs: one page per settings area ─────────────────────────── */}
      <nav
        className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1 shadow-sm"
        aria-label="Settings sections"
      >
        {SETTINGS_TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-current={settingsTab === id ? "page" : undefined}
            aria-pressed={settingsTab === id}
            onClick={() => setSettingsTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              settingsTab === id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {/* organisation */}
      <section
        id="settings-organisation"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <Building2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Organisation</h2>
          {organisation?.code && (
            <Badge variant="secondary" className="rounded-full font-mono">
              {organisation.code}
            </Badge>
          )}
          <Button
            className="ml-auto"
            variant="outline"
            size="sm"
            onClick={() => {
              setOrgName(organisation?.name ?? "");
              setOrgOpen(true);
            }}
          >
            <Building2 className="size-4" />
            {organisation?.createdAt ? "Organisation" : "Create organisation"}
          </Button>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Organisation name
            </p>
            <p className="mt-1 truncate text-sm font-medium">
              {organisation?.name ?? "Not created yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {organisation?.createdAt
                ? `Created ${new Date(organisation.createdAt).toLocaleDateString()}`
                : "Name your organisation, then create a login for every person who needs access."}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Your own login
            </p>
            {organisation?.myUsername ? (
              <>
                <p className="mt-1 truncate font-mono text-sm">
                  {organisation.myUsername}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatWhen(organisation.myLastLoginAt ?? null)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                You signed in with an email code, so you don't have a username
                yet. Create one for yourself from the "Users &amp; roles" tab if
                you'd rather sign in with a password.
              </p>
            )}
          </div>
          <CurrencyPicker canEdit={canManage} />
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5 sm:col-span-2">
            <p className="text-xs text-muted-foreground">
              Give your team the app address, then the username and password you
              created for them.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() =>
                void copyText(`${window.location.origin}/auth`, "Sign-in link")
              }
            >
              <Copy className="size-3.5" />
              Copy sign-in link
            </Button>
          </div>
        </div>
      </section>

      {/* member list */}
      <section
        id="settings-people"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Users &amp; roles</h2>
          {members && (
            <Badge variant="secondary" className="rounded-full">
              {members.length}
            </Badge>
          )}
          <Button
            className="ml-auto"
            size="sm"
            onClick={() => {
              resetCreateDialog();
              setCreateOpen(true);
            }}
          >
            <UserPlus className="size-4" />
            Create user
          </Button>
        </header>

        {members === undefined ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <ul className="divide-y">
            {(members ?? []).map((m) => (
              <li
                key={m.userId}
                className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name ?? m.email ?? "User"}
                  </p>
                  {m.email && !loginFor(m.userId) && (
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  )}
                  {loginFor(m.userId) && (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground/80">
                      <KeyRound className="size-3 shrink-0" />
                      <span className="truncate font-mono">
                        {loginFor(m.userId)?.username}
                      </span>
                      {loginFor(m.userId)?.disabled && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                          switched off
                        </span>
                      )}
                    </p>
                  )}
                  {!m.isSuper && m.managerId !== undefined && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                      Reports to {memberName(m.managerId as Id<"users">)}
                    </p>
                  )}
                  {!m.isSuper && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                      {m.customRoleId
                        ? `Custom role · ${permsSummary(m.permissions)}`
                        : permsSummary(m.permissions)}
                    </p>
                  )}
                </div>

                {/* role selector */}
                {m.isSuper ? (
                  <span
                    className={cn(
                      "w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      ROLE_META.super.chip,
                    )}
                    title={ROLE_META.super.blurb}
                  >
                    Super user — full access
                  </span>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors hover:opacity-80",
                          m.customRoleId
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : ROLE_META[m.role].chip,
                        )}
                        title={ROLE_META[m.role].blurb}
                      >
                        {m.customRoleId
                          ? (customRoles ?? []).find((r) => r._id === m.customRoleId)
                              ?.name ?? "Custom"
                          : ROLE_META[m.role].label}
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuLabel>Assign role</DropdownMenuLabel>
                      {ASSIGNABLE.map((r) => (
                        <DropdownMenuItem
                          key={r}
                          onClick={() => {
                            void handleRoleChange(m, r);
                            void handleAssignCustomRole(m, null);
                          }}
                        >
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              ROLE_META[r].chip,
                            )}
                          >
                            {ROLE_META[r].label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ROLE_META[r].blurb}
                          </span>
                        </DropdownMenuItem>
                      ))}
                      {(customRoles ?? []).length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Custom roles</DropdownMenuLabel>
                          {(customRoles ?? []).map((r) => (
                            <DropdownMenuItem
                              key={r._id}
                              onClick={() => void handleAssignCustomRole(m, r._id)}
                            >
                              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                {r.name}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {r.description || "Custom role"}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* actions */}
                <div className="flex items-center gap-1">
                  {loginFor(m.userId) && !m.isSuper && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <KeyRound className="size-3.5" />
                          Login
                          <ChevronDown className="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="font-mono text-xs">
                          @{loginFor(m.userId)?.username}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const login = loginFor(m.userId);
                            if (!login) return;
                            setPwLogin(login);
                            setPwDraft(makePassword());
                            setPwResult(null);
                          }}
                        >
                          <RefreshCw className="size-3.5" />
                          Reset password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const login = loginFor(m.userId);
                            if (login) void handleToggleDisabled(login);
                          }}
                        >
                          <Power className="size-3.5" />
                          {loginFor(m.userId)?.disabled
                            ? "Allow sign-in again"
                            : "Switch off sign-in"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Reports to</DropdownMenuLabel>
                        {(members ?? [])
                          .filter(
                            (c) =>
                              !c.isSuper &&
                              c.userId !== m.userId &&
                              c.managerId !== m.userId,
                          )
                          .map((c) => (
                            <DropdownMenuItem
                              key={c.userId}
                              onClick={() => void handleAssignManager(m, c.userId)}
                            >
                              <GitBranch className="size-3.5" />
                              {memberName(c.userId)}
                            </DropdownMenuItem>
                          ))}
                        {isSuper && (
                          <DropdownMenuItem
                            onClick={() => void handleAssignManager(m, null)}
                          >
                            <GitBranch className="size-3.5" />
                            Organisation owner (top)
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            const login = loginFor(m.userId);
                            if (login) void handleDeleteLogin(login);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          Delete login
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {!m.isSuper && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPermDialog(m)}
                    >
                      <SlidersHorizontal className="size-3.5" />
                      Permissions
                    </Button>
                  )}
                  {!m.isSuper && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleRemove(m)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* team hierarchy */}
      <section
        id="settings-team"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <GitBranch className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Team hierarchy</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            Managers control, members work
          </span>
        </header>
        {(() => {
          const all = members ?? [];
          const childrenOf = (id: Id<"users">) =>
            all
              .filter((m) => m.managerId === id)
              .sort(
                (a, b) =>
                  ROLE_RANK_OF[b.role] - ROLE_RANK_OF[a.role] ||
                  (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
              );
          const top = all
            .filter(
              (m) =>
                m.isSuper ||
                m.managerId === undefined ||
                !all.some((c) => c.userId === m.managerId),
            )
            .sort(
              (a, b) =>
                ROLE_RANK_OF[b.role] - ROLE_RANK_OF[a.role] ||
                (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
            );

          const renderNode = (m: (typeof all)[number], depth: number): React.ReactNode => {
            const kids = childrenOf(m.userId);
            const isCollapsed = collapsedNodes.has(m.userId);
            const login = loginFor(m.userId);
            return (
              <div key={m.userId} className="relative">
                {/* connector line for children */}
                {kids.length > 0 && !isCollapsed && (
                  <span
                    aria-hidden
                    className="absolute top-9 bottom-3 left-[27px] w-px bg-border"
                  />
                )}
                <div
                  className={cn(
                    "group/node relative flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
                    depth > 0 && "ml-6",
                    depth > 0 &&
                      "before:absolute before:top-1/2 before:-left-4 before:h-px before:w-4 before:bg-border",
                    "hover:bg-accent/60",
                  )}
                >
                  {/* expand / collapse */}
                  {kids.length > 0 ? (
                    <button
                      type="button"
                      aria-label={isCollapsed ? "Expand" : "Collapse"}
                      className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      onClick={() =>
                        setCollapsedNodes((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.userId)) next.delete(m.userId);
                          else next.add(m.userId);
                          return next;
                        })
                      }
                    >
                      <ChevronDown
                        className={cn(
                          "size-3.5 transition-transform",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                    </button>
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}

                  {/* avatar */}
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold",
                      m.isSuper
                        ? "bg-primary text-primary-foreground"
                        : ROLE_RANK_OF[m.role] >= ROLE_RANK_OF.admin
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-primary/10 text-primary",
                    )}
                  >
                    {(m.name ?? m.email ?? "U").charAt(0).toUpperCase()}
                  </span>

                  {/* name + meta */}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {m.isSuper
                          ? m.name ?? "Organisation owner"
                          : m.name ?? m.email ?? "User"}
                      </span>
                      {login && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                          @{login.username}
                        </span>
                      )}
                      {login?.disabled && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
                          off
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {m.isSuper
                        ? "Owns the organisation"
                        : m.managerId !== undefined &&
                            all.some((c) => c.userId === m.managerId)
                          ? `Reports to ${memberName(m.managerId as Id<"users">)}`
                          : "Top of the chain"}
                      {m.teamSize > 0 && ` · manages ${m.teamSize} person${m.teamSize === 1 ? "" : "s"}`}
                    </span>
                  </span>

                  {/* role chip */}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      ROLE_META[m.role].chip,
                    )}
                  >
                    {m.customRoleId
                      ? (customRoles ?? []).find((r) => r._id === m.customRoleId)?.name ?? "Custom"
                      : ROLE_META[m.role].label}
                  </span>

                  {/* actions */}
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/node:opacity-100 group-hover/node:opacity-100">
                    {/* move under someone */}
                    {!m.isSuper && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title="Change who they report to"
                            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            <GitBranch className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>
                            {m.name ?? m.email ?? "User"} reports to
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {(members ?? [])
                            .filter(
                              (c) =>
                                c.userId !== m.userId &&
                                c.managerId !== m.userId,
                            )
                            .map((c) => (
                              <DropdownMenuItem
                                key={c.userId}
                                onClick={() => void handleAssignManager(m, c.userId)}
                              >
                                {c.isSuper ? "Organisation owner" : memberName(c.userId)}
                              </DropdownMenuItem>
                            ))}
                          {isSuper && (
                            <DropdownMenuItem
                              onClick={() => void handleAssignManager(m, null)}
                            >
                              Nobody — top of the chain
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {/* add someone under this person */}
                    {ROLE_RANK_OF[m.role] >= ROLE_RANK_OF.user && (
                      <button
                        type="button"
                        title={`Add a junior under ${m.name ?? "this person"}`}
                        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                        onClick={() => {
                          resetCreateDialog();
                          setNewManagerId(m.userId);
                          setCreateOpen(true);
                        }}
                      >
                        <UserPlus className="size-3.5" />
                      </button>
                    )}
                    {login && !m.isSuper && (
                      <button
                        type="button"
                        title="Reset password"
                        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                        onClick={() => {
                          setPwLogin(login);
                          setPwDraft(makePassword());
                          setPwResult(null);
                        }}
                      >
                        <RefreshCw className="size-3.5" />
                      </button>
                    )}
                  </span>
                </div>

                {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
              </div>
            );
          };

          return (
            <div className="px-3 py-3">
              {top.length === 0 ? (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  No members yet — create users to build your team.
                </p>
              ) : (
                <div>{top.map((m) => renderNode(m, 0))}</div>
              )}
            </div>
          );
        })()}
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <GitBranch className="size-3" />
            Move who they report to
          </span>
          <span className="inline-flex items-center gap-1">
            <UserPlus className="size-3" />
            Add a junior under them
          </span>
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="size-3" />
            Reset their password
          </span>
        </footer>
      </section>

      {/* ── Credentials: usernames and passwords ───────────────────── */}
      <section
        id="settings-credentials"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <KeyRound className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Credentials</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {(logins ?? []).length} login{(logins ?? []).length === 1 ? "" : "s"}
          </span>
        </header>

        {logins === undefined || logins === null ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Loading logins…
          </p>
        ) : logins.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No logins yet — create a user to give them a username and password.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {logins.map((login) => {
              const value = credDrafts[login._id] ?? "";
              const revealed = credRevealed[login._id] === true;
              const member = members?.find((m) => m.userId === login.userId);
              return (
                <li key={login._id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <KeyRound className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span className="truncate text-sm font-medium">
                        {member?.name ?? member?.email ?? login.username}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        @{login.username}
                      </span>
                    </span>
                    {login.disabled && (
                      <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
                        off
                      </span>
                    )}
                    {credSaved === login._id && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3" /> Password updated
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <div className="relative min-w-0 flex-1 sm:max-w-sm">
                      <Input
                        type={revealed ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="New password"
                        aria-label={`New password for @${login.username}`}
                        className="pr-9 font-mono text-sm"
                        value={value}
                        onChange={(e) =>
                          setCredDrafts((current) => ({
                            ...current,
                            [login._id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        aria-label={revealed ? "Hide password" : "Show password"}
                        title={revealed ? "Hide password" : "Show password"}
                        aria-pressed={revealed}
                        onClick={() =>
                          setCredRevealed((current) => ({
                            ...current,
                            [login._id]: !revealed,
                          }))
                        }
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        {revealed ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCredDrafts((current) => ({
                          ...current,
                          [login._id]: makePassword(),
                        }))
                      }
                    >
                      Generate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={credBusy === login._id || value.trim().length < 8}
                      onClick={() => void saveCredential(login)}
                    >
                      {credBusy === login._id && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPwLogin(login);
                        setPwDraft(makePassword());
                        setPwResult(null);
                        setPwRevealDraft(false);
                        setPwRevealResult(false);
                      }}
                    >
                      <RefreshCw className="size-3.5" /> Reset
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="border-t border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
          Passwords are stored hashed, so an existing one can never be displayed —
          set a new one here and read it out to the person. It is hidden by
          default and cleared as soon as it is saved.
        </footer>
      </section>

      {/* custom roles manager */}
      <section
        id="settings-roles"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex items-center gap-2 border-b px-5 py-3.5">
          <Tags className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Roles</h2>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => openRoleEditor()}
          >
            <UserPlus className="size-3.5" />
            Create role
          </Button>
        </header>
        {customRoles === undefined ? (
          <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (customRoles ?? []).length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No custom roles yet. Create one to bundle detailed permissions (e.g.
            “Storekeeper” who can view and create materials but not delete them)
            and assign it to any user.
          </p>
        ) : (
          <ul className="divide-y">
            {(customRoles ?? []).map((r) => (
              <li key={r._id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.description || "Custom role"} · {permsSummary(r.permissions)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openRoleEditor(r)}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleDeleteRole(r)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* pending invites */}
      {pendingInvites !== undefined && (pendingInvites ?? []).length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b px-5 py-3.5">
            <Mail className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Pending invites</h2>
            <Badge variant="secondary" className="ml-auto rounded-full">
              {(pendingInvites ?? []).length}
            </Badge>
          </header>
          <ul className="divide-y">
            {(pendingInvites ?? []).map((i) => (
              <li key={i._id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.customRoleId
                      ? (customRoles ?? []).find((r) => r._id === i.customRoleId)?.name ?? "Custom role"
                      : ROLE_META[i.role].label}{' '}
                    · joins automatically on first sign-in
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    void cancelPendingInvite({ id: i._id })
                      .then(() => toast.success("Invite cancelled."))
                      .catch((e: unknown) =>
                        toast.error(
                          e instanceof Error ? e.message : "Couldn't cancel.",
                        ),
                      )
                  }
                >
                  <X className="size-3.5" />
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* shared master data — the single home for units & categories */}
      <section
        id="settings-catalog"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <Tag className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Units &amp; categories</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            Shared by finished-goods products and raw materials
          </span>
        </header>
        <div className="px-5 py-4">
          <MasterDataManager
            units={units ?? []}
            categories={allCategories ?? []}
            embedded
          />
        </div>
      </section>

      {/* backup & restore — export/import all user content */}
      <section
        id="settings-data"
        className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
          <DatabaseBackup className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Backup &amp; restore</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            Your tasks, notes, products and projects — nothing else
          </span>
        </header>
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Export a backup</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Downloads one JSON file with every task, list, folder, step,
                notebook, page, project, job, product and costing line.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={backupData === undefined || backupData === null}
              onClick={handleExportBackup}
            >
              {backupData === undefined ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Download backup
            </Button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Restore from a backup</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Replaces <strong>everything</strong> currently in your workspace
                with the contents of a backup file. This cannot be undone.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleRestoreFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={restoring}
              onClick={() => fileInputRef.current?.click()}
            >
              {restoring ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {restoring ? "Restoring…" : "Choose backup file"}
            </Button>
          </div>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        <strong>Super user</strong> — full control (created automatically, one per
        workspace). <strong>Admin</strong> — can add users and change roles. Use{" "}
        <strong>Roles</strong> to build reusable permission sets, and{" "}
        <strong>Permissions</strong> on a user for individual overrides (they
        layer on top of the assigned role).
      </p>

      {/* create-user dialog: username + password, or an email invite */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              {inviteMode ? "Invite by email" : "Create a user"}
            </DialogTitle>
            <DialogDescription>
              {inviteMode
                ? "They join automatically the first time they sign in with this email address."
                : "Set the username and password yourself, then hand them over. You'll get the details to share as soon as you save."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {inviteMode ? (
              <div className="space-y-1.5">
                <Label htmlFor="add-user-email">Email</Label>
                <Input
                  id="add-user-email"
                  type="email"
                  placeholder="name@company.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submitInvite()}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="new-person-name">Full name</Label>
                  <Input
                    id="new-person-name"
                    placeholder="e.g. Ravi Kumar"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-username">Username</Label>
                  <Input
                    id="new-username"
                    placeholder="e.g. ravi"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="font-mono"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Letters, numbers and . _ - @ — at least 3 characters.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">Password</Label>
                  <div className="flex gap-1.5">
                    <Input
                      id="new-password"
                      type={revealPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="font-mono"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title={revealPassword ? "Hide" : "Show"}
                      onClick={() => setRevealPassword((v) => !v)}
                    >
                      {revealPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Generate a new password"
                      onClick={() => {
                        setNewPassword(makePassword());
                        setRevealPassword(true);
                      }}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    At least 8 characters. Read it out to them, or copy it from
                    the next screen.
                  </p>
                </div>
              </>
            )}

            {/* manager — who this person reports to */}
            <div className="space-y-1.5">
              <Label>Reports to</Label>
              <select
                aria-label="Manager"
                className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                value={newManagerId ?? ""}
                onChange={(e) =>
                  setNewManagerId(
                    e.target.value === ""
                      ? null
                      : (e.target.value as Id<"users">),
                  )
                }
              >
                <option value="">
                  Organisation owner (top of the chain)
                </option>
                {(members ?? [])
                  .filter((m) => !m.isSuper)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {memberName(m.userId)}
                      {m.teamSize > 0 ? ` — manages ${m.teamSize}` : ""}
                    </option>
                  ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                The chain of command: managers see their team's work; juniors
                report up. You can change this any time from the member list.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="grid gap-1.5">
                {ASSIGNABLE.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setAddRole(r);
                      setAddCustomRoleId(null);
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      addRole === r && addCustomRoleId === null
                        ? "border-primary/50 bg-primary/5"
                        : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        ROLE_META[r].chip,
                      )}
                    >
                      {ROLE_META[r].label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_META[r].blurb}
                    </span>
                  </button>
                ))}
                {(customRoles ?? []).map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => setAddCustomRoleId(r._id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      addCustomRoleId === r._id
                        ? "border-primary/50 bg-primary/5"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {r.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {r.description || "Custom role"}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mt-1 text-xs font-medium text-primary hover:underline"
                onClick={() => openRoleEditor()}
              >
                + Create a custom role
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-dashed bg-muted/30 px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {inviteMode
                ? "Prefer to set their username and password yourself?"
                : "Would they rather sign in with an emailed code?"}
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                setInviteMode((v) => !v);
                resetAddDialog();
              }}
            >
              {inviteMode
                ? "Set a username and password instead"
                : "Invite by email instead"}
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void (inviteMode ? submitInvite() : handleCreateLogin())}
              disabled={
                busy ||
                (inviteMode
                  ? addEmail.trim().length === 0
                  : newUsername.trim().length === 0 ||
                    newPassword.length < 8)
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {inviteMode ? "Send invite" : "Create login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* credentials hand-over dialog */}
      <Dialog
        open={handedOver !== null}
        onOpenChange={(open) => !open && setHandedOver(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Check className="size-4" />
              </span>
              Login created
            </DialogTitle>
            <DialogDescription>
              Give these to the person. The password is shown here only — reset
              it from the Login menu if you lose it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Username
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {handedOver?.username}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Password
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {handedOver?.password}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Sign in at
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {window.location.origin}/auth
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                void copyText(
                  `Username: ${handedOver?.username}\nPassword: ${handedOver?.password}\nSign in at ${window.location.origin}/auth`,
                  "Sign-in details",
                )
              }
            >
              <Copy className="size-4" />
              Copy details
            </Button>
            <Button onClick={() => setHandedOver(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* reset-password dialog */}
      <Dialog
        open={pwLogin !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPwLogin(null);
            setPwResult(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" />
              Reset password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <span className="font-mono">@{pwLogin?.username}</span>.
              Their current password stops working straight away.
            </DialogDescription>
          </DialogHeader>

          {pwResult !== null ? (
            <div className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                New password
              </p>
              <p className="font-mono text-sm">{pwResult}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New password</Label>
              <div className="flex gap-1.5">
                <Input
                  id="reset-password"
                  className="font-mono"
                  value={pwDraft}
                  onChange={(e) => setPwDraft(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Generate a new password"
                  onClick={() => setPwDraft(makePassword())}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
          )}

          <DialogFooter>
            {pwResult !== null ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    void copyText(
                      `Username: ${pwLogin?.username}\nPassword: ${pwResult}`,
                      "Sign-in details",
                    )
                  }
                >
                  <Copy className="size-4" />
                  Copy details
                </Button>
                <Button
                  onClick={() => {
                    setPwLogin(null);
                    setPwResult(null);
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPwLogin(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleSetPassword()}
                  disabled={busy || pwDraft.length < 8}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Set password
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* organisation dialog */}
      <Dialog open={orgOpen} onOpenChange={setOrgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              {organisation?.createdAt
                ? "Organisation details"
                : "Create your organisation"}
            </DialogTitle>
            <DialogDescription>
              This is the name your team sees. Everything they create — tasks,
              notes, materials, products — belongs to the organisation and is
              shared with the people you give access to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Organisation name</Label>
              <Input
                id="org-name"
                placeholder="e.g. Northwind Joinery"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && void handleCreateOrganisation()
                }
                autoFocus
              />
            </div>
            {organisation?.code && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Organisation code
                  </p>
                  <p className="font-mono text-sm">{organisation.code}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyText(organisation.code ?? "", "Organisation code")
                  }
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOrgOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateOrganisation()}
              disabled={busy || orgName.trim().length === 0}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {organisation?.createdAt ? "Save" : "Create organisation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* workspace-name dialog */}
      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Workspace name</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="My workspace"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitWorkspaceName()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitWorkspaceName()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* role editor dialog (create + edit) */}
      <Dialog open={roleEditorOpen} onOpenChange={setRoleEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tags className="size-4 text-primary" />
              {editingRoleId !== null ? "Edit role" : "Create role"}
            </DialogTitle>
            <DialogDescription>
              Name the role and set exactly what people with it can view,
              create, edit, and delete in each section.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                placeholder="e.g. Storekeeper"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description (optional)</Label>
              <Input
                id="role-description"
                placeholder="What is this role for?"
                value={roleDescription}
                onChange={(e) => setRoleDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Detailed permissions</Label>
              <PermissionMatrix
                value={rolePerms}
                onSectionChange={(s, a, allowed) =>
                  setRolePerms((p) => ({
                    ...p,
                    sections: { ...p.sections, [s]: { ...p.sections[s], [a]: allowed } },
                  }))
                }
                onItemChange={(item, a, allowed) =>
                  setRolePerms((p) => ({
                    ...p,
                    items: {
                      ...p.items,
                      [item]: { ...(p.items[item] ?? {}), [a]: allowed },
                    },
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRole()} disabled={busy || roleName.trim() === ""}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {editingRoleId !== null ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* per-user detailed permissions dialog */}
      <Dialog
        open={permMember !== null}
        onOpenChange={(open) => !open && setPermMember(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              Permissions — {permMember?.name ?? permMember?.email ?? "user"}
            </DialogTitle>
            <DialogDescription>
              {permMember?.customRoleId
                ? "These overrides layer on top of the assigned custom role."
                : "Set exactly what this user can view, create, edit, and delete."}
            </DialogDescription>
          </DialogHeader>

          <PermissionMatrix
            value={permDraft}
            onSectionChange={(s, a, allowed) =>
              setPermDraft((p) => ({
                ...p,
                sections: { ...p.sections, [s]: { ...p.sections[s], [a]: allowed } },
              }))
            }
            onItemChange={(item, a, allowed) =>
              setPermDraft((p) => ({
                ...p,
                items: {
                  ...p.items,
                  [item]: { ...(p.items[item] ?? {}), [a]: allowed },
                },
              }))
            }
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermMember(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitMemberPerms()} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
