// Ambient page backdrop — soft violet/cyan glows over a faint dot grid, the
// same atmosphere as the landing page, tuned to read on the light app surface.
// Purely decorative; sits behind all app content.
export function AppAmbient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(760px 460px at 6% -6%, hsl(247 90% 62% / 0.12), transparent 60%), radial-gradient(720px 460px at 104% 4%, hsl(196 90% 55% / 0.09), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: "radial-gradient(hsl(233 45% 45% / 0.06) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
          maskImage: "radial-gradient(130% 80% at 50% 0%, black 25%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(130% 80% at 50% 0%, black 25%, transparent 72%)",
        }}
      />
    </div>
  );
}
