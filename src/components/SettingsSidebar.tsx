import { Building2, DatabaseBackup, GitBranch, Layers, Tags, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SettingsSectionKey =
  | "organisation"
  | "people"
  | "groups"
  | "team"
  | "roles"
  | "catalog"
  | "data";

const ITEMS: {
  key: SettingsSectionKey;
  label: string;
  hint: string;
  icon: typeof Users;
}[] = [
  {
    key: "organisation",
    label: "Organisation",
    hint: "Name, code, your login",
    icon: Building2,
  },
  {
    key: "people",
    label: "Users & roles",
    hint: "People and permissions",
    icon: Users,
  },
  {
    key: "groups",
    label: "User groups",
    hint: "Groups you assign work to",
    icon: UserRound,
  },
  {
    key: "team",
    label: "Team hierarchy",
    hint: "Who reports to whom",
    icon: GitBranch,
  },
  { key: "roles", label: "Roles", hint: "Reusable permission sets", icon: Tags },
  {
    key: "catalog",
    label: "Units & categories",
    hint: "Shared mastering data",
    icon: Layers,
  },
  {
    key: "data",
    label: "Backup & restore",
    hint: "Export or import your data",
    icon: DatabaseBackup,
  },
];

/**
 * Sidebar for the Settings section: one button per settings page area, and
 * clicking scrolls the panel to it. The active button follows the scroll.
 */
export default function SettingsSidebar() {
  const [active, setActive] = useState<SettingsSectionKey>("organisation");

  useEffect(() => {
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(
            entry.target.id,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) {
          setActive(bestId.replace("settings-", "") as SettingsSectionKey);
        }
      },
      { threshold: [0, 0.2, 0.5, 0.8] },
    );
    for (const item of ITEMS) {
      const el = document.getElementById(`settings-${item.key}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const go = (key: SettingsSectionKey) => {
    setActive(key);
    document
      .getElementById(`settings-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Settings
        </span>
      </div>

      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.key)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
              isActive ? "bg-primary/10" : "hover:bg-accent",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                isActive ? "text-primary" : "text-muted-foreground/70",
              )}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-sm",
                  isActive ? "font-medium text-primary" : "text-foreground/85",
                )}
              >
                {item.label}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {item.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
