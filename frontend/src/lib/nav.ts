import {
  Building2,
  CalendarDays,
  LayoutDashboard,
  Video,
  Workflow,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: "meetings";
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Customers", href: "/customers", icon: Building2 },
      { label: "Calendar", href: "/calendar", icon: CalendarDays },
      { label: "Meetings", href: "/meetings", icon: Video, badgeKey: "meetings" },
      { label: "Execution Graph", href: "/graph", icon: Workflow },
    ],
  },
  {
    items: [
      { label: "Integrations", href: "/integrations", icon: Plug },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems = navSections.flatMap((s) => s.items);
