import {
  Database,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

// The MVP surfaces (per the system design doc): Feed, Memory, Settings — plus
// Integrations (where you connect the tools Orbit reads). The legacy Dashboard,
// Customers and Calendar pages are intentionally out of the nav; they belong to
// the retired pipeline and only add confusion next to the loop.
export const navSections: NavSection[] = [
  {
    items: [
      { label: "Feed", href: "/feed", icon: Sparkles },
      { label: "Memory", href: "/memory", icon: Database },
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
