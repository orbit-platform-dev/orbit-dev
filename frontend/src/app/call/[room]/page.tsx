"use client";

// Orbit Calls — Orbit hosts the call itself (the Lyra model).
//
// Media is WebRTC peer-to-peer (mesh + Google STUN); the backend WebSocket is
// only signaling + the live transcript sink. Each participant's own browser
// transcribes their own microphone (Web Speech API) and streams named,
// timestamped segments — that's what makes the post-call transcript
// per-speaker accurate, and it's the seam where live listening plugs in later.

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Captions, CaptionsOff, Check, Copy, Loader2, Mic, MicOff, Orbit as OrbitIcon,
  PanelRightClose, PanelRightOpen, PhoneOff, Sparkles, Users, Video, VideoOff,
} from "lucide-react";
import * as api from "@/lib/api";
import type { CallRoomInfo } from "@/lib/types";
import { cn, colorFromString, formatDuration, initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

// --- Minimal Web Speech API surface (not in TS's DOM lib) --------------------
interface SpeechAlt { transcript: string }
interface SpeechResult { isFinal: boolean; 0: SpeechAlt }
interface SpeechResultsEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface SpeechRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultsEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
function makeRecognizer(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

type Phase = "loading" | "lobby" | "live" | "ended" | "left" | "notfound";

interface Peer {
  peerId: string;
  name: string;
  stream: MediaStream | null;
}

interface Segment { id: string; speaker: string; start: number; end: number; text: string }

type WsMessage =
  | { type: "welcome"; peerId: string; roster: { peerId: string; name: string }[]; startedAt: string }
  | { type: "peer-joined"; peerId: string; name: string }
  | { type: "peer-left"; peerId: string; name: string }
  | { type: "signal"; from: string; name: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }
  | { type: "transcript"; id: string; speaker: string; start: number; end: number; text: string }
  | { type: "ended"; meetingId: string }
  | { type: "error"; message: string };

export default function CallPage() {
  const { room } = useParams<{ room: string }>();
  const router = useRouter();

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [info, setInfo] = React.useState<CallRoomInfo | null>(null);
  const [name, setName] = React.useState("");
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [captionsOn, setCaptionsOn] = React.useState(true);
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [peers, setPeers] = React.useState<Map<string, Peer>>(new Map());
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [meetingId, setMeetingId] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [ending, setEnding] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [speechSupported, setSpeechSupported] = React.useState(true);

  const wsRef = React.useRef<WebSocket | null>(null);
  const pcsRef = React.useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const localVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const lobbyVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const recRef = React.useRef<SpeechRec | null>(null);
  const utteranceStartRef = React.useRef<number | null>(null);
  const liveRef = React.useRef(false);
  const micOnRef = React.useRef(true);

  // --- Setup: room info + saved name + lobby preview -------------------------
  React.useEffect(() => {
    let cancelled = false;
    setName(localStorage.getItem("orbit.name") ?? "");
    api.getCallRoom(room)
      .then((r) => {
        if (cancelled) return;
        setInfo(r);
        if (r.status === "ended") {
          setMeetingId(r.meetingId ?? null);
          setPhase("ended");
        } else {
          setPhase("lobby");
        }
      })
      .catch(() => !cancelled && setPhase("notfound"));
    return () => { cancelled = true; };
  }, [room]);

  // Lobby camera preview (released on join — the live stream is re-acquired).
  React.useEffect(() => {
    if (phase !== "lobby") return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
      .then((s) => { stream = s; if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = s; })
      .catch(() => {});
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [phase]);

  React.useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  React.useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function cleanup() {
    liveRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }

  // --- WebRTC mesh ------------------------------------------------------------
  function sendWs(msg: Record<string, unknown>) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }

  function newPeerConnection(peerId: string, peerName: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) sendWs({ type: "signal", to: peerId, data: { candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      setPeers((prev) => {
        const next = new Map(prev);
        next.set(peerId, { peerId, name: peerName, stream });
        return next;
      });
    };
    pcsRef.current.set(peerId, pc);
    return pc;
  }

  async function offerTo(peerId: string, peerName: string) {
    const pc = newPeerConnection(peerId, peerName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendWs({ type: "signal", to: peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal(from: string, fromName: string, data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    let pc = pcsRef.current.get(from);
    if (data.sdp) {
      if (data.sdp.type === "offer") {
        pc = pc ?? newPeerConnection(from, fromName);
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWs({ type: "signal", to: from, data: { sdp: pc.localDescription } });
      } else if (pc) {
        await pc.setRemoteDescription(data.sdp);
      }
    } else if (data.candidate && pc) {
      try { await pc.addIceCandidate(data.candidate); } catch { /* stale candidate */ }
    }
  }

  // --- Per-mic transcription (the Lyra trick) ---------------------------------
  function startRecognition() {
    const rec = makeRecognizer();
    if (!rec) { setSpeechSupported(false); return; }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      if (utteranceStartRef.current === null) utteranceStartRef.current = Date.now();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          const dur = (Date.now() - (utteranceStartRef.current ?? Date.now())) / 1000;
          utteranceStartRef.current = null;
          if (text) sendWs({ type: "transcript", text, dur });
        }
      }
    };
    // Chrome stops after silence; keep it running for the whole call.
    rec.onend = () => {
      if (liveRef.current && micOnRef.current) {
        try { rec.start(); } catch { /* already starting */ }
      }
    };
    rec.onerror = () => {};
    recRef.current = rec;
    try { rec.start(); } catch { /* ignore */ }
  }

  // --- Join / leave / end ------------------------------------------------------
  async function join() {
    const displayName = name.trim() || "Guest";
    localStorage.setItem("orbit.name", displayName);

    // Camera+mic, degrading to mic-only, then to receive-only.
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); setCamOn(false); }
      catch { setCamOn(false); setMicOn(false); }
    }
    localStreamRef.current = stream;
    stream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
    stream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
    micOnRef.current = micOn && !!stream?.getAudioTracks().length;

    const ws = new WebSocket(api.callSocketUrl(room));
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", name: displayName }));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data) as WsMessage;
      if (msg.type === "welcome") {
        liveRef.current = true;
        setPhase("live");
        setElapsed(Math.max(0, Math.floor((Date.now() - new Date(msg.startedAt).getTime()) / 1000)));
        setPeers(new Map(msg.roster.map((p) => [p.peerId, { ...p, stream: null }])));
        // Newcomer offers to every existing peer (no glare).
        for (const p of msg.roster) await offerTo(p.peerId, p.name);
        if (micOnRef.current) startRecognition();
        setTimeout(() => {
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }, 0);
      } else if (msg.type === "peer-joined") {
        setPeers((prev) => {
          const next = new Map(prev);
          next.set(msg.peerId, { peerId: msg.peerId, name: msg.name, stream: null });
          return next;
        });
      } else if (msg.type === "peer-left") {
        pcsRef.current.get(msg.peerId)?.close();
        pcsRef.current.delete(msg.peerId);
        setPeers((prev) => {
          const next = new Map(prev);
          next.delete(msg.peerId);
          return next;
        });
      } else if (msg.type === "signal") {
        await onSignal(msg.from, msg.name, msg.data);
      } else if (msg.type === "transcript") {
        setSegments((prev) => [...prev, msg]);
      } else if (msg.type === "ended") {
        setMeetingId(msg.meetingId);
        cleanup();
        setPhase("ended");
      } else if (msg.type === "error") {
        cleanup();
        setPhase("notfound");
      }
    };
    ws.onclose = () => {
      liveRef.current = false;
    };
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    micOnRef.current = next;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    if (phase === "live") {
      if (next && !recRef.current) startRecognition();
      else if (next) { try { recRef.current?.start(); } catch { /* running */ } }
      else recRef.current?.stop();
    }
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  function leave() {
    sendWs({ type: "leave" });
    cleanup();
    setPhase("left");
  }

  async function endForAll() {
    if (!window.confirm("End the call for everyone? Orbit will build the meeting + analysis from the transcript.")) return;
    setEnding(true);
    try {
      const res = await api.endCall(room);
      setMeetingId(res.meetingId);
      cleanup();
      setPhase("ended");
    } catch {
      setEnding(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // --- Render -------------------------------------------------------------------
  if (phase === "loading") {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (phase === "notfound") {
    return (
      <Shell>
        <CenterCard>
          <h1 className="text-lg font-semibold">This call doesn&apos;t exist or has ended</h1>
          <p className="mt-1 text-sm text-muted-foreground">Check the link, or start a new call from Meetings.</p>
          <Button className="mt-4" asChild><Link href="/meetings">Go to Meetings</Link></Button>
        </CenterCard>
      </Shell>
    );
  }

  if (phase === "ended") {
    return (
      <Shell>
        <CenterCard>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-lg font-semibold">Call ended</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {meetingId
              ? "Orbit captured the conversation and is analyzing it into an execution plan."
              : "This call is over."}
          </p>
          {meetingId ? (
            <Button className="mt-4 gap-2" onClick={() => router.push(`/meetings/${meetingId}`)}>
              <OrbitIcon className="h-4 w-4" /> View meeting & analysis
            </Button>
          ) : (
            <Button className="mt-4" asChild><Link href="/meetings">Go to Meetings</Link></Button>
          )}
        </CenterCard>
      </Shell>
    );
  }

  if (phase === "left") {
    return (
      <Shell>
        <CenterCard>
          <h1 className="text-lg font-semibold">You left the call</h1>
          <p className="mt-1 text-sm text-muted-foreground">The call continues without you.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>Rejoin</Button>
            <Button asChild><Link href="/meetings">Go to Meetings</Link></Button>
          </div>
        </CenterCard>
      </Shell>
    );
  }

  if (phase === "lobby") {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl">
            <div className="mb-6 flex items-center gap-2 text-primary">
              <OrbitIcon className="h-5 w-5" />
              <span className="text-sm font-semibold tracking-tight">Orbit Calls</span>
            </div>
            <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black/60">
                <video ref={lobbyVideoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
                <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white/90">Camera preview</div>
              </div>
              <div className="flex flex-col justify-center gap-4">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">{info?.title ?? "Orbit call"}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {info && info.liveParticipants > 0
                      ? `${info.liveParticipants} already in the call`
                      : "You'll be the first one here"}
                  </p>
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (shown on the transcript)"
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button variant={micOn ? "outline" : "destructive"} size="icon" onClick={() => setMicOn((v) => !v)} aria-label="Toggle microphone">
                    {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </Button>
                  <Button variant={camOn ? "outline" : "destructive"} size="icon" onClick={() => setCamOn((v) => !v)} aria-label="Toggle camera">
                    {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                  <Button className="flex-1 gap-2" onClick={join} disabled={!name.trim()}>
                    Join call
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your mic is transcribed in your browser during the call, so the meeting notes know exactly who said what.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // --- live ---
  const peerList = Array.from(peers.values());
  const tiles = peerList.length + 1;
  const cols = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3;
  const captions = segments.slice(-3);

  return (
    <Shell>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
        <OrbitIcon className="h-5 w-5 text-primary" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{info?.title ?? "Orbit call"}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-red-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> LIVE
            </span>
            <span className="tabular-nums">{formatDuration(elapsed)}</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{tiles}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {!speechSupported && (
            <span className="hidden rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning sm:block">
              Live transcription needs Chrome or Edge
            </span>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={copyLink}>
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setPanelOpen((v) => !v)} aria-label="Toggle transcript panel">
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Stage */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div
            className="grid flex-1 content-center gap-3 overflow-y-auto p-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            <Tile name={`${name.trim() || "You"} (you)`} muted mirrored videoRef={localVideoRef} camOff={!camOn} micOff={!micOn} />
            {peerList.map((p) => (
              <PeerTile key={p.peerId} peer={p} />
            ))}
          </div>

          {/* Live captions */}
          {captionsOn && captions.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-6">
              <div className="max-w-2xl space-y-1 rounded-xl bg-black/70 px-4 py-3 backdrop-blur">
                {captions.map((s) => (
                  <p key={s.id} className="text-sm leading-snug text-white/95">
                    <span className="font-semibold" style={{ color: colorFromString(s.speaker) }}>{s.speaker}: </span>
                    {s.text}
                  </p>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Live transcript panel — the "live hearing" surface */}
        {panelOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-border/60">
            <div className="border-b border-border/60 px-4 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live transcript</div>
              <div className="text-[11px] text-muted-foreground/70">{segments.length} segments · per-speaker mics</div>
            </div>
            <TranscriptStream segments={segments} />
          </aside>
        )}
      </div>

      {/* Controls */}
      <footer className="flex items-center justify-center gap-2 border-t border-border/60 px-4 py-3">
        <Button variant={micOn ? "secondary" : "destructive"} size="icon" onClick={toggleMic} aria-label="Toggle microphone">
          {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </Button>
        <Button variant={camOn ? "secondary" : "destructive"} size="icon" onClick={toggleCam} aria-label="Toggle camera">
          {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </Button>
        <Button variant="secondary" size="icon" onClick={() => setCaptionsOn((v) => !v)} aria-label="Toggle captions">
          {captionsOn ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
        </Button>
        <div className="mx-2 h-6 w-px bg-border" />
        <Button variant="outline" className="gap-2" onClick={leave}>
          Leave
        </Button>
        <Button variant="destructive" className="gap-2" onClick={endForAll} disabled={ending}>
          {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
          End & analyze
        </Button>
      </footer>
    </Shell>
  );
}

// --- Presentational pieces ------------------------------------------------------
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh flex-col bg-background text-foreground">{children}</div>;
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-card">{children}</div>
    </div>
  );
}

function Tile({
  name, videoRef, stream, muted = false, mirrored = false, camOff = false, micOff = false,
}: {
  name: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  stream?: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  camOff?: boolean;
  micOff?: boolean;
}) {
  const innerRef = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    if (stream && innerRef.current && innerRef.current.srcObject !== stream) {
      innerRef.current.srcObject = stream;
    }
  }, [stream]);
  const color = colorFromString(name);
  const showVideo = !camOff && (videoRef || stream);
  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-black/70">
      {showVideo ? (
        <video
          ref={videoRef ?? innerRef}
          autoPlay
          playsInline
          muted={muted}
          className={cn("h-full w-full object-cover", mirrored && "-scale-x-100")}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold"
            style={{ background: `${color}26`, color }}
          >
            {initials(name.replace(" (you)", ""))}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white/95">
        {micOff && <MicOff className="h-3 w-3 text-red-400" />}
        {name}
      </div>
    </div>
  );
}

function PeerTile({ peer }: { peer: Peer }) {
  const hasVideo = !!peer.stream?.getVideoTracks().some((t) => t.enabled);
  return <Tile name={peer.name} stream={peer.stream} camOff={!hasVideo} />;
}

function TranscriptStream({ segments }: { segments: Segment[] }) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [segments.length]);
  return (
    <div ref={boxRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {segments.length === 0 && (
        <p className="pt-8 text-center text-xs text-muted-foreground">
          Say something — every speaker&apos;s mic is transcribed live.
        </p>
      )}
      {segments.map((s) => {
        const color = colorFromString(s.speaker);
        return (
          <div key={s.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold" style={{ color }}>{s.speaker}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatDuration(s.start)}</span>
            </div>
            <p className="mt-0.5 leading-snug text-foreground/85">{s.text}</p>
          </div>
        );
      })}
    </div>
  );
}
