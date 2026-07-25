import { Database, MessagesSquare, Plug, Settings, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: string;
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
      { key: "nav.feed", href: "/feed", icon: Sparkles },
      { key: "nav.chat", href: "/chat", icon: MessagesSquare },
      { key: "nav.memory", href: "/memory", icon: Database },
    ],
  },
  {
    items: [
      { key: "nav.integrations", href: "/integrations", icon: Plug },
      { key: "nav.settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems = navSections.flatMap((s) => s.items);
