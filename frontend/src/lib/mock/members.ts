import type { Member, Stakeholder } from "@/lib/types";

export const members: Member[] = [
  { id: "u_1", name: "Yash Pandey", email: "yash@batton.co.jp", role: "Owner", title: "Founder & CEO", status: "active" },
  { id: "u_2", name: "Mara Vossen", email: "mara@orbit.app", role: "Admin", title: "Head of Product", status: "active" },
  { id: "u_3", name: "Devin Okafor", email: "devin@orbit.app", role: "Admin", title: "Eng Lead", status: "active" },
  { id: "u_4", name: "Priya Nair", email: "priya@orbit.app", role: "Member", title: "Staff Designer", status: "active" },
  { id: "u_5", name: "Tomás Reyes", email: "tomas@orbit.app", role: "Member", title: "QA Lead", status: "offline" },
  { id: "u_6", name: "Hana Kim", email: "hana@orbit.app", role: "Member", title: "Account Executive", status: "active" },
  { id: "u_7", name: "Leo Bianchi", email: "leo@orbit.app", role: "Member", title: "Customer Success", status: "offline" },
  { id: "u_8", name: "Sofia Marchetti", email: "sofia@orbit.app", role: "Viewer", title: "Investor", status: "invited" },
];

export const memberById = (id: string) => members.find((m) => m.id === id) ?? members[0];

export const stakeholders: Stakeholder[] = [
  { id: "s_1", name: "Rachel Lindqvist", role: "VP Engineering", company: "Northwind Labs", type: "customer", sentiment: "mixed" },
  { id: "s_2", name: "Marcus Webb", role: "CTO", company: "Northwind Labs", type: "customer", sentiment: "negative" },
  { id: "s_3", name: "Aisha Bello", role: "Director of Ops", company: "Vertex Health", type: "customer", sentiment: "positive" },
  { id: "s_4", name: "Jonathan Pierce", role: "Procurement", company: "Vertex Health", type: "customer", sentiment: "neutral" },
  { id: "s_5", name: "Elena Sokolova", role: "Head of Data", company: "Quanta Finance", type: "customer", sentiment: "positive" },
  { id: "s_6", name: "Mara Vossen", role: "Head of Product", company: "Orbit", type: "internal", sentiment: "positive" },
  { id: "s_7", name: "Hana Kim", role: "Account Executive", company: "Orbit", type: "internal", sentiment: "positive" },
  { id: "s_8", name: "Daniel Foster", role: "VP Sales", company: "Meridian Retail", type: "customer", sentiment: "mixed" },
];

export const stakeholderById = (id: string) => stakeholders.find((s) => s.id === id) ?? stakeholders[0];
