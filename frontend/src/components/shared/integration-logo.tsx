import {
  siAsana,
  siConfluence,
  siGithub,
  siGitlab,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglemeet,
  siHubspot,
  siIntercom,
  siJira,
  siLinear,
  siNotion,
  siZendesk,
  siZoom,
} from "simple-icons";
import type { IntegrationKey } from "@/lib/types";
import { cn } from "@/lib/utils";

type Brand = { path: string; hex: string };

const ICONS: Partial<Record<IntegrationKey, Brand>> = {
  jira: siJira,
  linear: siLinear,
  github: siGithub,
  gitlab: siGitlab,
  notion: siNotion,
  hubspot: siHubspot,
  zendesk: siZendesk,
  calendar: siGooglecalendar,
  "google-meet": siGooglemeet,
  zoom: siZoom,
  intercom: siIntercom,
  asana: siAsana,
  confluence: siConfluence,
  "google-docs": siGoogledocs,
  "google-drive": siGoogledrive,
};

const LOCAL_LOGOS: Partial<Record<IntegrationKey, string>> = {
  fireflies: "/connectors/fireflies.png",
  circleback: "/connectors/circleback.png",
};

// Monogram fallback (short label + brand color) for marks not in simple-icons.
export const integrationBrand: Record<IntegrationKey, { short: string; color: string }> = {
  "google-meet": { short: "GM", color: "#00897b" },
  zoom: { short: "Zm", color: "#2d8cff" },
  slack: { short: "Sl", color: "#611f69" },
  github: { short: "Gh", color: "#8b95a5" },
  jira: { short: "Ji", color: "#2684ff" },
  linear: { short: "Li", color: "#5e6ad2" },
  notion: { short: "No", color: "#c9c9c9" },
  hubspot: { short: "Hs", color: "#ff7a59" },
  salesforce: { short: "Sf", color: "#00a1e0" },
  calendar: { short: "Ca", color: "#4285f4" },
  gong: { short: "Go", color: "#a855f7" },
  intercom: { short: "Ic", color: "#1f8ded" },
  asana: { short: "As", color: "#f06a6a" },
  confluence: { short: "Cf", color: "#2684ff" },
  "google-docs": { short: "GD", color: "#4285f4" },
  "google-drive": { short: "Dr", color: "#4285f4" },
  fireflies: { short: "Ff", color: "#8b5cf6" },
  circleback: { short: "Cb", color: "#f97316" },
};

const SLACK_MARK: { d: string; fill: string }[] = [
  {
    fill: "#00BBD3",
    d: "M152.999466,228.340637 C124.667336,228.339905 96.834679,228.444809 69.003273,228.303665 C48.347614,228.198898 35.835205,217.145035 33.475445,197.358017 C31.147240,177.835602 44.526749,161.230988 64.110542,159.772781 C71.406799,159.229492 78.765121,159.448776 86.095238,159.443253 C121.260353,159.416763 156.425568,159.388931 191.590591,159.451538 C208.970490,159.482468 220.307327,166.607544 225.593338,180.534775 C233.421600,201.160141 222.257965,228.391724 193.997101,228.313416 C180.498016,228.276016 166.998703,228.328766 152.999466,228.340637 z",
  },
  {
    fill: "#FE9700",
    d: "M448.641357,354.870941 C405.351471,354.900238 362.524872,355.021698 319.699219,354.867462 C301.455170,354.801727 289.022339,343.280487 286.395142,324.761749 C284.039062,308.154114 293.756561,292.174011 309.191406,287.617615 C312.346069,286.686401 315.728607,286.091339 319.007812,286.083771 C362.000458,285.984497 404.993958,285.892487 447.986023,286.080017 C465.839783,286.157928 478.312195,298.258575 480.625092,316.886353 C482.680206,333.438446 472.546967,349.181152 456.959686,353.479431 C454.409302,354.182739 451.726562,354.406250 448.641357,354.870941 z",
  },
  {
    fill: "#4CAE50",
    d: "M309.169647,34.968224 C334.378021,28.237154 354.586029,43.184547 354.700684,68.677162 C354.887177,110.139809 354.926117,151.604980 354.681732,193.067032 C354.531036,218.630844 332.444855,234.113647 308.244202,226.101028 C295.012909,221.720261 286.128815,210.545532 286.057831,196.594528 C285.834137,152.635178 285.697205,108.671158 286.135864,64.715012 C286.284210,49.851738 294.700073,39.965115 309.169647,34.968224 z",
  },
  {
    fill: "#E81E62",
    d: "M181.506958,478.663635 C167.828857,473.384735 160.644699,463.667480 159.632004,449.475006 C159.324356,445.163422 159.373413,440.821655 159.371353,436.493683 C159.353470,399.016754 159.275131,361.539429 159.457214,324.063385 C159.483551,318.644714 159.990997,312.967773 161.665649,307.866608 C166.688263,292.567383 182.489929,284.327118 200.361191,286.988312 C216.063339,289.326477 227.873856,301.834625 227.978088,317.693207 C228.265915,361.496643 228.376358,405.305969 227.956863,449.107239 C227.748993,470.811066 207.045868,484.964630 184.761826,479.609619 C183.791519,479.376465 182.837097,479.077179 181.506958,478.663635 z",
  },
  {
    fill: "#00BBD3",
    d: "M222.848770,101.823135 C209.610306,101.179161 196.591110,101.920685 184.168228,99.544525 C166.304855,96.127739 157.594101,81.916916 159.647430,63.470673 C161.604691,45.887592 174.657944,33.697269 192.245758,33.027405 C210.573395,32.329357 224.932770,42.771973 227.437134,60.059189 C228.833435,69.697685 228.029205,79.657555 228.176071,89.473198 C228.235229,93.427345 228.185852,97.383118 228.185852,101.815834 C226.241379,101.815834 224.787903,101.815834 222.848770,101.823135 z",
  },
  {
    fill: "#E81E63",
    d: "M34.276031,327.398895 C34.201523,322.639679 33.688984,318.245422 34.296200,314.011749 C36.546291,298.323517 47.396626,287.449921 63.184116,286.354858 C75.910042,285.472137 88.746017,286.176056 101.383804,286.176056 C101.383804,300.431732 102.785431,314.664581 101.016701,328.491852 C98.966003,344.523438 84.049866,354.901917 67.045105,354.925903 C50.141628,354.949707 38.313198,345.149109 34.276031,327.398895 z",
  },
  {
    fill: "#4CAE50",
    d: "M417.897278,173.012939 C427.345306,159.966385 445.846161,155.709076 461.791290,162.638107 C475.777496,168.715866 483.014465,183.855652 479.905457,200.532990 C476.923920,216.526474 464.509094,227.640488 448.340942,228.142242 C436.411926,228.512466 424.462189,228.214951 412.864594,228.214951 C412.864594,214.061478 412.464691,200.452271 413.087311,186.890015 C413.297638,182.308548 416.098267,177.845978 417.897278,173.012939 z",
  },
  {
    fill: "#FE9700",
    d: "M350.835876,429.295135 C360.888916,451.669586 350.960571,474.162933 328.981903,479.505157 C305.960571,485.100800 286.149597,469.812439 285.911011,446.177185 C285.798645,435.046295 285.891754,423.913330 285.891754,412.226440 C300.899109,412.248138 315.674042,410.310272 330.208984,414.214905 C338.823944,416.529144 346.146820,420.861938 350.835876,429.295135 z",
  },
];

export function IntegrationLogo({
  k,
  className,
  bare = false,
}: {
  k: IntegrationKey;
  className?: string;
  bare?: boolean;
}) {
  const local = LOCAL_LOGOS[k];
  if (local) {
    return (
      <div
        role="img"
        aria-label={k}
        className={cn(
          "h-10 w-10 shrink-0 rounded-lg bg-cover bg-center",
          !bare && "border border-border",
          className,
        )}
        style={{ backgroundImage: `url(${local})` }}
      />
    );
  }
  if (k === "slack") {
    if (bare) {
      return (
        <svg
          role="img"
          aria-label="Slack"
          viewBox="0 0 512 512"
          className={cn("h-10 w-10 shrink-0", className)}
          xmlns="http://www.w3.org/2000/svg"
        >
          {SLACK_MARK.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill} />
          ))}
        </svg>
      );
    }
    return (
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white",
          className,
        )}
      >
        <svg
          role="img"
          aria-label="Slack"
          viewBox="0 0 512 512"
          className="h-1/2 w-1/2"
          xmlns="http://www.w3.org/2000/svg"
        >
          {SLACK_MARK.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill} />
          ))}
        </svg>
      </div>
    );
  }
  const icon = ICONS[k];
  if (icon) {
    if (bare) {
      return (
        <svg
          role="img"
          aria-label={k}
          viewBox="0 0 24 24"
          className={cn("h-10 w-10 shrink-0", className)}
          fill={`#${icon.hex}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={icon.path} />
        </svg>
      );
    }
    // Real logos sit on a white tile so dark marks (GitHub, Notion) stay crisp on the dark UI.
    return (
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white",
          className,
        )}
      >
        <svg
          role="img"
          viewBox="0 0 24 24"
          className="h-1/2 w-1/2"
          fill={`#${icon.hex}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={icon.path} />
        </svg>
      </div>
    );
  }
  // Any unknown connector still renders — a monogram tile — so new sources never crash.
  const b = integrationBrand[k] ?? {
    short: (k || "?").slice(0, 2).toUpperCase(),
    color: "#64748b",
  };
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold",
        className,
      )}
      style={{ background: `${b.color}1f`, borderColor: `${b.color}40`, color: b.color }}
    >
      {b.short}
    </div>
  );
}
