import { FileText, Upload, Video, type LucideIcon } from "lucide-react";
import type { MeetingSource } from "@/lib/types";

export const sourceMeta: Record<MeetingSource, { label: string; icon: LucideIcon; color: string }> = {
  "google-meet": { label: "Google Meet", icon: Video, color: "#00ac47" },
  zoom: { label: "Zoom", icon: Video, color: "#2d8cff" },
  upload: { label: "Upload", icon: Upload, color: "#8b95a5" },
  transcript: { label: "Transcript", icon: FileText, color: "#a78bfa" },
};
