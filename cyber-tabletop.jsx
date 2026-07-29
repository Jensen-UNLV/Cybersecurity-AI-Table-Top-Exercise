import { useState, useRef, useEffect, useCallback, useMemo, memo, forwardRef } from "react";

// ── Data ──────────────────────────────────────────────────────
const SCENARIOS = [
  { id: "ransomware", name: "Ransomware Attack", icon: "🔒", severity: "Critical", description: "Malicious encryption spreads across the network. Production systems are down. Attackers demand payment.", tags: ["CISA", "NIST IR"] },
  { id: "data-exfil", name: "Data Exfiltration", icon: "📤", severity: "High", description: "Unusual outbound traffic detected. Sensitive customer records may have been copied to an external server.", tags: ["NIST IR", "PCI-DSS"] },
  { id: "ddos", name: "DDoS Attack", icon: "🌊", severity: "High", description: "Web-facing services overwhelmed by volumetric traffic. Customer access is degraded or unavailable.", tags: ["CISA", "NIST IR"] },
  { id: "insider", name: "Insider Threat", icon: "🕵️", severity: "High", description: "A privileged user account shows anomalous behavior — bulk downloads, after-hours access, unusual destinations.", tags: ["NIST IR"] },
  { id: "phishing", name: "Spear-Phishing / BEC", icon: "🎣", severity: "Medium", description: "A targeted phishing email spoofing the CFO has led to a fraudulent wire transfer request reaching finance.", tags: ["CISA", "NIST IR"] },
  { id: "supply-chain", name: "Supply Chain Compromise", icon: "⛓️", severity: "Critical", description: "A third-party software update delivered malicious code. Unknown blast radius across all installations.", tags: ["CISA"] },
];

const INDUSTRY_PLAYBOOKS = [
  {
    id: "cisa", name: "CISA Incident Response", type: "industry",
    description: "A six-phase incident response lifecycle from the Cybersecurity and Infrastructure Security Agency for detecting, containing, and recovering from a security incident.",
    phases: ["Preparation", "Detection & Analysis", "Containment", "Eradication", "Recovery", "Post-Incident"],
  },
  {
    id: "nist", name: "NIST SP 800-61", type: "industry",
    description: "The NIST computer security incident handling guide, covering live incident response: detection, response, and recovery.",
    // Live exercise phases: Detect → Respond → Recover. Post-exercise lessons learned and
    // recommendations are covered by the After-Action Report, not a separate live phase.
    // Uses the same flat phase-tag display as CISA (no `phaseGroups`).
    phases: ["Detect", "Respond", "Recover"],
  },
];

const ROLES = ["Facilitator", "Incident Commander", "Security Analyst", "Network Engineer", "Legal / Compliance", "Communications Lead", "Executive Sponsor", "Observer"];

// AAR Score Card: fixed weights the app applies to Claude's 5 per-metric scores to compute
// a DETERMINISTIC overallScore, rather than trusting Claude to compute (and be internally
// consistent about) that number itself. Playbook Adherence and Decision Quality Under
// Pressure are weighted highest since those most directly reflect the substance of the
// team's own decisions — see AARView's `generate()` and `computeOverallScore()` below.
const SCORE_METRIC_WEIGHTS = {
  "Detection & Triage": 0.15,
  "Containment & Eradication": 0.15,
  "Communication & Escalation": 0.10,
  "Playbook Adherence": 0.30,
  "Decision Quality Under Pressure": 0.30,
};

// Computes overallScore from Claude's per-metric scores using SCORE_METRIC_WEIGHTS.
// Unrecognized/missing metric names are ignored and the remaining weights are renormalized
// (so a response missing one metric, or using slightly different naming, still produces a
// sane 0-100 score rather than silently under-weighting toward 0). Rounds to the nearest
// integer and clamps to [0, 100].
function computeOverallScore(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const m of metrics) {
    const weight = SCORE_METRIC_WEIGHTS[m?.name];
    if (weight == null || typeof m.score !== "number") continue;
    weightedSum += m.score * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return null;
  return Math.max(0, Math.min(100, Math.round(weightedSum / weightTotal)));
}

// Facilitator-facing "Phase Focus" hint text, keyed by phase NAME rather than index, so it
// stays correct regardless of which playbook (and therefore which phase list/order) is
// active — e.g. NIST's live exercise phases (Detect/Respond/Recover) don't line up
// positionally with CISA's six-phase list. See ExerciseView's `phaseGuidance`.
const PHASE_GUIDANCE = {
  "Preparation": "Confirm roles, channels, and tools. Ensure the playbook is accessible.",
  "Detection & Analysis": "Identify indicators of compromise. Classify severity. Notify stakeholders. Preserve evidence.",
  "Containment": "Isolate affected systems. Block attacker paths. Prevent further damage.",
  "Eradication": "Remove malicious artifacts. Patch vulnerabilities. Validate systems are clean.",
  "Recovery": "Restore from known-good state. Validate functionality. Monitor closely.",
  "Post-Incident": "Document findings. Brief leadership. Update playbook. Plan next exercises.",
  "Containment, Eradication & Recovery": "Isolate affected systems, remove malicious artifacts, and restore from a known-good state.",
  "Post-Incident Activity": "Document findings. Brief leadership. Update playbook. Plan next exercises.",
  "Detect": "Identify indicators of compromise. Classify severity. Notify stakeholders. Preserve evidence.",
  "Respond": "Contain the incident, remove malicious artifacts, and block attacker paths to prevent further damage.",
  "Recover": "Restore from a known-good state, validate functionality, and monitor closely.",
};

// Industry options for the Company Profile step. `regulator` is a short label surfaced
// in the AI system prompt and used as the {{regulator}} placeholder in inject text.
const INDUSTRIES = [
  { id: "healthcare", name: "Healthcare", regulator: "HIPAA" },
  { id: "financial", name: "Financial Services", regulator: "GLBA / PCI-DSS" },
  { id: "retail", name: "Retail / E-commerce", regulator: "PCI-DSS" },
  { id: "manufacturing", name: "Manufacturing", regulator: "CISA sector guidance" },
  { id: "education", name: "Higher Education", regulator: "FERPA" },
  { id: "government", name: "Government / Public Sector", regulator: "FISMA" },
  { id: "technology", name: "Technology / SaaS", regulator: "SOC 2 / GDPR" },
  { id: "energy", name: "Energy / Utilities", regulator: "NERC CIP" },
  { id: "other", name: "Other / Not Listed", regulator: "applicable regulatory guidance" },
];

// Company size tiers. `scale` drives placeholder interpolation in INJECT_LIBRARY
// (see interpolateInject) — e.g. record counts and dollar figures grow with company size.
const COMPANY_SIZES = [
  { id: "small", name: "Small (< 100 employees)", scale: { records: "8,000", ransom: "$120,000", wire: "$45,000", bandwidth: "40 Gbps" } },
  { id: "mid", name: "Mid-size (100–1,000 employees)", scale: { records: "60,000", ransom: "$850,000", wire: "$180,000", bandwidth: "180 Gbps" } },
  { id: "large", name: "Large (1,000–10,000 employees)", scale: { records: "340,000", ransom: "$4,200,000", wire: "$620,000", bandwidth: "680 Gbps" } },
  { id: "enterprise", name: "Enterprise (10,000+ employees)", scale: { records: "2,300,000", ransom: "$18,000,000", wire: "$2,100,000", bandwidth: "1.2 Tbps" } },
];

const DEFAULT_COMPANY_PROFILE = { industry: "", companySize: "", additionalContext: "" };

// Blended Incidents mode: when a session blends two scenarios together into one narrative,
// the relationship between them is decided ONCE per session (like mysteryOpenerIndex) and
// hidden from participants — the point of the mode is that the team has to figure out,
// through their own investigation, whether the two threads are actually one coordinated
// attack or just two unrelated incidents that happen to be colliding in time. Never surfaced
// directly; only used to steer the facilitator's system prompt (see buildSystemPrompt).
function pickBlendRelation() {
  return Math.random() < 0.5 ? "coordinated" : "coincidental";
}

// Normalizes a possibly-stale saved companyProfile (e.g. sessions saved before this
// feature existed) into the current shape, same pattern as normalizeFacilitatorConfig.
function normalizeCompanyProfile(raw) {
  return { ...DEFAULT_COMPANY_PROFILE, ...raw };
}

// Fully generic, category-agnostic opening symptoms for Mystery Scenario mode. These are
// deliberately shared across ALL scenario types (not scenario-specific) so that wording style
// itself can never hint at the underlying incident category. One is chosen at random per
// session (session.mysteryOpenerIndex, seeded once at launch so it survives resume) and fed
// to the AI verbatim as the literal opening scene — see initSession's openingInstruction.
const MYSTERY_OPENERS = [
  "Helpdesk has logged a higher-than-normal volume of tickets over the past hour. Employees and customers report that certain systems are slow, unresponsive, or behaving unpredictably.",
  "A department manager reports that a colleague mentioned files that look different than expected, a login prompt that seemed unusual, and a process that isn't running the way it normally does.",
  "Monitoring dashboards show several metrics operating outside their normal range. The on-call analyst has flagged the pattern for review.",
  "A business partner has reached out with a question about account access, a recent transaction, or a change that doesn't match your team's records.",
  "Several employees report communications or account behavior that is inconsistent with normal operations.",
  "IT operations reports that some routine processes are taking longer than usual or producing unexpected results.",
];

// Each inject now carries a `tier`: "investigative" (ambiguous/symptom-level lead — safe to
// use before the team has confirmed a root cause) or "confirmation" (root-cause/source
// specifics — meant to be held until the team's investigation has earned the reveal). See
// InjectPanel, which groups and labels cards by tier rather than rendering one flat list.
const INJECT_LIBRARY = {
  ransomware: [
    { title: "Sluggish File Shares Reported", text: "Multiple departments report that shared drives are slow to open, and a few files won't open at all. IT hasn't yet determined why.", color: "#ca8a04", tier: "investigative" },
    { title: "Unusual File Extensions Spotted", text: "A user mentions some of their documents now have strange file extensions they don't recognize. They assumed it was a glitch.", color: "#ea580c", tier: "investigative" },
    { title: "Backup System Alert", text: "IT reports that network-attached backup drives appear to be encrypting. The offline tape backup from last week may be the only clean copy.", color: "#dc2626", tier: "confirmation" },
    { title: "Ransom Note Received", text: "Attackers send a message: {{ransom}} in BTC within 48 hours, or keys are destroyed and data published.", color: "#dc2626", tier: "confirmation" },
    { title: "Third-Party Vendor Notified", text: "A major SaaS vendor calls — they've detected the encryption spreading via your shared API credentials.", color: "#ea580c", tier: "confirmation" },
    { title: "Cyber Insurance Contacted", text: "Legal reaches out to the insurer. The policy has a 72-hour notification requirement.", color: "#ca8a04", tier: "confirmation" },
    { title: "Media Inquiry", text: "A reporter from a trade publication contacts PR — they've heard about the 'outage.'", color: "#ca8a04", tier: "confirmation" },
  ],
  "data-exfil": [
    { title: "Unusual Outbound Traffic Flagged", text: "Network monitoring flags a pattern of outbound traffic at odd hours that doesn't match normal business usage. Nothing has been confirmed as malicious yet.", color: "#ca8a04", tier: "investigative" },
    { title: "Customer Complaints Trickle In", text: "A few customers report suspicious activity on their accounts elsewhere, wondering if it's related to something on your end.", color: "#ca8a04", tier: "investigative" },
    { title: "Exfiltration Confirmed", text: "DLP logs confirm 2.3 TB left via SFTP to an IP in Eastern Europe over 6 days.", color: "#dc2626", tier: "confirmation" },
    { title: "Regulatory Clock Starts", text: "Legal: under {{regulator}} you have a strict notification window from discovery. Clock started 4 hours ago.", color: "#ea580c", tier: "confirmation" },
    { title: "Customer Data Identified", text: "Initial triage shows the exfiltrated data contains PII for ~{{records}} customers.", color: "#dc2626", tier: "confirmation" },
  ],
  ddos: [
    { title: "Helpdesk Ticket Spike", text: "Helpdesk reports a surge in calls about certain company websites loading slowly or not at all. No cause has been identified yet.", color: "#ca8a04", tier: "investigative" },
    { title: "Monitoring Shows Elevated Load", text: "Infrastructure dashboards show web server load climbing steadily with no obvious internal cause.", color: "#ca8a04", tier: "investigative" },
    { title: "Amplification Vector Found", text: "Network team identifies a DNS amplification attack using your open resolver.", color: "#ea580c", tier: "confirmation" },
    { title: "CDN Failover Triggered", text: "The CDN automatically failed over, but origin servers are still being hammered.", color: "#ca8a04", tier: "confirmation" },
    { title: "Attack Escalates", text: "Traffic peaks at {{bandwidth}}. The upstream ISP is threatening to null-route your ASN.", color: "#dc2626", tier: "confirmation" },
  ],
  insider: [
    { title: "Odd Access Pattern Noticed", text: "A manager mentions that one team member has been logging in at unusual hours lately. It's probably nothing, but it stood out.", color: "#ca8a04", tier: "investigative" },
    { title: "Data Usage Anomaly", text: "A routine report shows one account downloading noticeably more data than its typical baseline over the past week.", color: "#ca8a04", tier: "investigative" },
    { title: "HR Records Pulled", text: "The employee filed a grievance three months ago. Termination proceedings were underway.", color: "#ea580c", tier: "confirmation" },
    { title: "USB Evidence Found", text: "Physical security log shows the employee badged into the server room and plugged in a USB device last Tuesday.", color: "#dc2626", tier: "confirmation" },
    { title: "Legal Hold Required", text: "Legal instructs IT: preserve all logs and accounts. Do not disable — monitor only.", color: "#ca8a04", tier: "confirmation" },
  ],
  phishing: [
    { title: "Suspicious Email Reported", text: "An employee forwards an email to IT that seemed slightly off — they didn't act on it, just flagged it as odd.", color: "#ca8a04", tier: "investigative" },
    { title: "Finance Flags a Request", text: "Someone in finance mentions an unusual request came through that didn't quite match how things are normally done, but it's not yet clear if anything happened.", color: "#ca8a04", tier: "investigative" },
    { title: "Wire Transfer Initiated", text: "Finance confirms a {{wire}} wire was sent before the email was flagged.", color: "#dc2626", tier: "confirmation" },
    { title: "Additional Targets Identified", text: "Similar emails were sent to 12 other executives. Two others clicked the link.", color: "#ea580c", tier: "confirmation" },
    { title: "Credential Harvest Suspected", text: "The phishing link led to a spoofed login page. Assume all credentials entered are compromised.", color: "#dc2626", tier: "confirmation" },
  ],
  "supply-chain": [
    { title: "Unexpected Update Behavior", text: "Several endpoints behave oddly after a routine software update — nothing catastrophic, just enough inconsistency that IT is asking questions.", color: "#ca8a04", tier: "investigative" },
    { title: "Vendor Behaving Unusually", text: "A vendor's support portal or communications seem slightly different than normal, prompting a few raised eyebrows internally.", color: "#ca8a04", tier: "investigative" },
    { title: "CISA Alert Issued", text: "CISA releases a public advisory: 3,000+ organizations may be affected by the same update.", color: "#dc2626", tier: "confirmation" },
    { title: "Vendor Patch Released", text: "The affected vendor issued an emergency patch, but applying it requires a full reinstall.", color: "#ea580c", tier: "confirmation" },
    { title: "C2 Traffic Detected", text: "EDR identifies beaconing to a known C2 server from 17 endpoints post-update.", color: "#dc2626", tier: "confirmation" },
  ],
};

// Swaps {{token}} placeholders in an inject's text with values scaled to the selected
// company size, and appends an industry regulator reference where relevant. Falls back
// to a generic phrase if no profile is set (e.g. previewing before the Company Profile
// step is completed), so injects never render broken/literal tokens.
function interpolateInject(inject, companyProfile) {
  const sizeTier = COMPANY_SIZES.find(sz => sz.id === companyProfile?.companySize);
  const industry = INDUSTRIES.find(ind => ind.id === companyProfile?.industry);
  const scale = sizeTier?.scale || {};
  const text = inject.text
    .replace(/\{\{records\}\}/g, scale.records || "an undetermined number of")
    .replace(/\{\{ransom\}\}/g, scale.ransom || "a significant sum")
    .replace(/\{\{wire\}\}/g, scale.wire || "a substantial amount")
    .replace(/\{\{bandwidth\}\}/g, scale.bandwidth || "a very high volume of")
    .replace(/\{\{regulator\}\}/g, industry?.regulator || "applicable regulations");
  return { ...inject, text };
}

// Default facilitator config
const DEFAULT_FACILITATOR = {
  tone: "professional",        // professional | conversational | intense
  difficulty: "moderate",      // light | moderate | rigorous
  complexity: "standard",      // narrow | standard | branching — controls how much Claude volunteers beyond the direct consequence of a team action
  focusAreas: [],              // legal | technical | communications | executive
  customInstructions: "",
  // Phase advancement is AI-driven (the facilitator classifies the phase each turn via a
  // hidden [PHASE:] tag) — there is no turn limit and no per-phase time limit. The only
  // time control is an optional whole-scenario budget that warns the facilitator but never
  // advances a phase or ends the exercise.
  timeLimitEnabled: false,     // whole-scenario time budget is opt-in (facilitator warning only)
  maxScenarioMinutes: 60,      // whole-scenario time budget in minutes (used only when timeLimitEnabled)
  showIncidentTags: false,    // Blended Incidents mode only — facilitator-controlled, togglable live mid-exercise;
                               // when on, each message/inject is labeled with which underlying scenario thread it
                               // belongs to. Off by default so the "figure it out yourselves" challenge is intact
                               // unless the facilitator deliberately chooses to make threads visible.
};

// Maps a legacy "probing" field's values (gentle/balanced/aggressive) to the current
// "complexity" field's values (narrow/standard/branching), for sessions saved to
// localStorage under the previous field name.
const LEGACY_COMPLEXITY_MAP = { gentle: "narrow", balanced: "standard", aggressive: "branching" };

// Normalizes a possibly-stale saved facilitatorConfig into the current shape: fills in
// any fields the saved session predates (timeLimitEnabled, maxScenarioMinutes, etc. all
// default correctly instead of coming back undefined), and migrates the renamed
// "probing" field to "complexity" if present. Note: legacy configs may still carry removed
// fields (turnLimitEnabled, maxTurns, per-phase time settings) — these are simply ignored.
function normalizeFacilitatorConfig(raw) {
  const config = { ...DEFAULT_FACILITATOR, ...raw };
  if (raw?.probing && !raw?.complexity) {
    config.complexity = LEGACY_COMPLEXITY_MAP[raw.probing] || DEFAULT_FACILITATOR.complexity;
  }
  delete config.probing;
  return config;
}

// ── Web Speech API helper ─────────────────────────────────────
const speech = (() => {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  let cachedVoice = null;

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Prefer high-quality online English voices (Google, Microsoft), then any en-US, then any English
    return (
      voices.find(v => v.lang === "en-US" && /google/i.test(v.name))  ||
      voices.find(v => v.lang === "en-US" && /microsoft/i.test(v.name)) ||
      voices.find(v => v.lang === "en-US" && !v.localService) ||
      voices.find(v => v.lang === "en-US") ||
      voices.find(v => v.lang.startsWith("en")) ||
      voices[0]
    );
  };

  // Pre-load voice as soon as the browser has them ready
  if (supported) {
    // Some browsers populate immediately (Firefox), others fire voiceschanged (Chrome)
    cachedVoice = pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      cachedVoice = pickVoice();
    });
  }

  return {
    supported,
    speak(text, { rate = 0.95, pitch = 1, volume = 1 } = {}) {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/⚠️ INJECT:/g, "Inject:")
        .replace(/[#_`]/g, "")
        .replace(/<br\/>/g, " ");
      const utt = new SpeechSynthesisUtterance(clean);
      utt.rate = rate; utt.pitch = pitch; utt.volume = volume;
      // Use cached voice; if somehow still null, try one more time
      utt.voice = cachedVoice || pickVoice();
      window.speechSynthesis.speak(utt);
    },
    stop() {
      if (!supported) return;
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      // Some browser implementations (notably Chrome, and more so inside sandboxed/iframe
      // contexts like this app's preview environment) can leave an utterance queued or
      // still audibly speaking if cancel() lands mid-transition — e.g. right as a new
      // utterance starts, or if the engine is in a paused/resuming state. A second cancel
      // shortly after reliably clears it; this is a no-op if the first call already fully
      // stopped everything.
      setTimeout(() => { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }, 50);
    },
  };
})();

// ── Styles ────────────────────────────────────────────────────
const FontStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Inter:wght@300;400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; height: 100%; }
    body {
      background: #080c10; color: #c9d1da;
      font-family: 'Inter', sans-serif; font-size: 14px; line-height: 1.6;
      overflow-y: scroll; min-height: 100%; display: flex; flex-direction: column;
    }
    #root { display: flex; flex-direction: column; min-height: 100vh; }
    .app-content { flex: 1; display: flex; flex-direction: column; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0f1620; }
    ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 3px; }
    .mono { font-family: 'Share Tech Mono', monospace; }

    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 56px;
      background: #0a0f18; border-bottom: 1px solid #1a2a3a;
      position: sticky; top: 0; z-index: 200;
    }
    .topbar-brand { display: flex; align-items: center; gap: 10px; }
    .topbar-logo {
      width: 30px; height: 30px;
      background: linear-gradient(135deg, #0d6efd, #00d4ff);
      border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px;
    }
    .topbar-title { font-family: 'Share Tech Mono', monospace; font-size: 15px; color: #e0eaff; letter-spacing: 0.05em; }
    .topbar-subtitle { font-size: 11px; color: #4a6fa5; margin-top: 1px; }
    .topbar-right { display: flex; align-items: center; gap: 12px; }

    .exercise-subheader { position: sticky; top: 56px; z-index: 150; background: #0a0f18; border-bottom: 1px solid #1a2a3a; }

    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 4px;
      font-size: 11px; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em;
    }
    .badge-live { background: rgba(0,212,100,0.15); color: #00d464; border: 1px solid rgba(0,212,100,0.3); }
    .badge-severity-Critical { background: rgba(220,38,38,0.15); color: #f87171; border: 1px solid rgba(220,38,38,0.3); }
    .badge-severity-High { background: rgba(234,88,12,0.15); color: #fb923c; border: 1px solid rgba(234,88,12,0.3); }
    .badge-severity-Medium { background: rgba(202,138,4,0.15); color: #fbbf24; border: 1px solid rgba(202,138,4,0.3); }

    .nav-tabs { display: flex; gap: 2px; padding: 0 24px; }
    .nav-tab {
      padding: 10px 18px; border: none; background: none;
      color: #4a6fa5; cursor: pointer; font-size: 13px;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
      display: flex; align-items: center; gap: 6px;
    }
    .nav-tab:hover { color: #7cb3f5; }
    .nav-tab.active { color: #60a5fa; border-bottom-color: #60a5fa; }

    .main { padding: 24px; max-width: 1400px; margin: 0 auto; width: 100%; }

    .card { background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px; padding: 20px; }
    .card-title {
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      color: #4a6fa5; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 14px;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .gap-3 { gap: 12px; }
    .gap-4 { gap: 16px; }

    .scenario-card {
      background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px;
      padding: 18px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      display: flex; flex-direction: column; gap: 10px;
    }
    .scenario-card:hover { border-color: #2a4a7a; background: #0f1c2e; }
    .scenario-card.selected { border-color: #60a5fa; background: rgba(96,165,250,0.06); }
    .scenario-icon { font-size: 28px; }
    .scenario-name { font-size: 15px; font-weight: 600; color: #e0eaff; }
    .scenario-desc { font-size: 13px; color: #6b82a0; line-height: 1.5; }
    .scenario-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .tag {
      font-size: 10px; font-family: 'Share Tech Mono', monospace;
      padding: 2px 7px; border-radius: 3px;
      background: rgba(96,165,250,0.1); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2);
    }

    .btn {
      padding: 9px 18px; border-radius: 6px; border: none;
      font-size: 13px; font-weight: 500; cursor: pointer;
      display: inline-flex; align-items: center; gap: 7px;
      transition: background 0.15s; white-space: nowrap;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transition: none; }
    .btn-primary { background: #1d4ed8; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #2563eb; }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #93afd4; border: 1px solid #1a2a3a; }
    .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .btn-success { background: rgba(22,163,74,0.2); color: #4ade80; border: 1px solid rgba(22,163,74,0.3); }
    .btn-active { background: rgba(29,78,216,0.25); color: #93c5fd; border: 1px solid #1d4ed8; }
    .btn-sm { padding: 5px 12px; font-size: 12px; }
    .btn-icon { padding: 5px 8px; font-size: 14px; background: none; border: none; cursor: pointer; color: #4a6a8a; border-radius: 4px; }
    .btn-icon:hover { background: rgba(255,255,255,0.06); color: #93afd4; }

    input[type=text], input[type=number], input[type=file], textarea, select {
      background: #0a1520; border: 1px solid #1a2a3a; border-radius: 6px;
      color: #c9d1da; padding: 9px 12px; font-size: 13px;
      font-family: 'Inter', sans-serif; width: 100%; outline: none;
      transition: border-color 0.15s;
    }
    input[type=text]:focus, input[type=number]:focus, textarea:focus, select:focus { border-color: #1d4ed8; }
    input[type=number] { width: auto; }
    input[type=file] { padding: 7px 10px; cursor: pointer; }
    textarea { resize: vertical; min-height: 80px; }
    label { font-size: 12px; color: #4a6fa5; display: block; margin-bottom: 5px; }

    /* Pill toggle group */
    .pill-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill {
      padding: 5px 13px; border-radius: 20px; font-size: 12px; cursor: pointer;
      border: 1px solid #1a2a3a; background: #0a1520; color: #4a6a8a;
      transition: all 0.15s; user-select: none;
    }
    .pill:hover { border-color: #2a4a7a; color: #7cb3f5; }
    .pill.active { background: rgba(29,78,216,0.2); border-color: #1d4ed8; color: #93c5fd; }
    .pill.active-multi { background: rgba(22,163,74,0.12); border-color: rgba(22,163,74,0.4); color: #4ade80; }

    /* Role seat rows */
    .role-seat {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: 6px;
      background: #0a1520; border: 1px solid #1a2a3a;
      transition: border-color 0.15s;
    }
    .role-seat:hover { border-color: #1a3050; }
    .role-seat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .role-seat-name { flex: 1; font-size: 13px; }
    .role-seat-role { font-size: 11px; color: #3a5a7a; font-family: 'Share Tech Mono', monospace; flex-shrink: 0; }
    .role-seat-input {
      background: transparent; border: none; border-bottom: 1px solid #1a3a5a;
      color: #c9d1da; font-size: 13px; font-family: 'Inter', sans-serif;
      outline: none; width: 160px; padding: 2px 4px;
    }
    .role-seat-input::placeholder { color: #3a5a7a; }

    /* Phases */
    .phases { display: flex; overflow-x: auto; }
    .phase-item {
      flex: 1; min-width: 90px; position: relative;
      padding: 10px 16px 10px 28px;
      background: #0d1621; border: 1px solid #1a2a3a;
      font-size: 11px; color: #4a6fa5;
      white-space: normal; overflow-wrap: break-word; word-break: break-word;
    }
    .phase-item:first-child { border-radius: 6px 0 0 6px; padding-left: 16px; }
    .phase-item:last-child { border-radius: 0 6px 6px 0; }
    .phase-item:not(:first-child) { border-left: none; }
    .phase-item.active { background: rgba(29,78,216,0.2); border-color: #1d4ed8; color: #93c5fd; }
    .phase-item.done { background: rgba(22,163,74,0.1); border-color: rgba(22,163,74,0.3); color: #4ade80; }
    .phase-dot {
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      width: 8px; height: 8px; border-radius: 50%; background: #1a2a3a;
    }
    .phase-item.active .phase-dot { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }
    .phase-item.done .phase-dot { background: #22c55e; }
    .phase-item:first-child .phase-dot { display: none; }

    /* Chat */
    .chat-area {
      display: flex; flex-direction: column;
      height: 460px; overflow-y: auto;
      gap: 12px; padding: 4px 4px 4px 0;
    }
    .chat-msg { display: flex; gap: 10px; }
    .chat-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: linear-gradient(135deg, #1d4ed8, #0891b2);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      font-size: 12px; color: #fff; font-weight: 600;
    }
    .chat-avatar.ai { background: linear-gradient(135deg, #7c3aed, #0891b2); }
    .chat-body { flex: 1; min-width: 0; }
    .chat-meta { font-size: 11px; color: #3a5a80; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
    .chat-text {
      background: #0d1e30; border: 1px solid #1a3050;
      border-radius: 6px; padding: 10px 13px;
      font-size: 13px; color: #b0c4da; line-height: 1.6; word-break: break-word;
    }
    .chat-text.ai-msg { border-color: rgba(124,58,237,0.3); background: rgba(124,58,237,0.06); }

    /* Voice button */
    .voice-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 7px; border-radius: 3px; border: none; cursor: pointer;
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      background: rgba(255,255,255,0.04); color: #3a5a7a;
      transition: all 0.15s;
    }
    .voice-btn:hover { background: rgba(96,165,250,0.1); color: #60a5fa; }
    .voice-btn.speaking { background: rgba(124,58,237,0.15); color: #a78bfa; }

    /* Inject */
    .inject-item {
      border: 1px solid #1a2a3a; border-radius: 6px; padding: 14px;
      background: #0a1520; cursor: pointer; transition: border-color 0.15s;
    }
    .inject-item:hover { border-color: #2a4a7a; }
    .inject-title { font-size: 13px; font-weight: 600; color: #c9d4e0; margin-bottom: 4px; }
    .inject-text { font-size: 12px; color: #5a7a9a; line-height: 1.5; }
    .inject-badge { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }

    .participant-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 6px;
      background: #0a1520; border: 1px solid #1a2a3a;
    }
    .participant-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
    .participant-name { flex: 1; font-size: 13px; color: #c9d1da; }
    .participant-role { font-size: 11px; color: #3a5a7a; font-family: 'Share Tech Mono', monospace; }

    .timeline { display: flex; flex-direction: column; }
    .tl-entry { display: flex; gap: 16px; }
    .tl-line { display: flex; flex-direction: column; align-items: center; }
    .tl-dot { width: 10px; height: 10px; border-radius: 50%; background: #1d4ed8; flex-shrink: 0; margin-top: 4px; }
    .tl-rule { flex: 1; width: 1px; background: #1a2a3a; margin: 4px 0; min-height: 16px; }
    .tl-body { padding-bottom: 18px; }
    .tl-time { font-size: 10px; font-family: 'Share Tech Mono', monospace; color: #3a5a7a; margin-bottom: 2px; }
    .tl-label { font-size: 13px; color: #c9d4e0; }
    .tl-detail { font-size: 12px; color: #4a6a8a; margin-top: 2px; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(96,165,250,0.3); border-top-color: #60a5fa;
      animation: spin 0.7s linear infinite; display: inline-block;
    }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .pulse { animation: pulse 1.8s ease-in-out infinite; }
    @keyframes wave { 0%,100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.0); } }

    .section-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; gap: 12px; }
    .section-title { font-size: 18px; font-weight: 600; color: #e0eaff; }
    .section-sub { font-size: 13px; color: #4a6a8a; margin-top: 2px; }
    .divider { border: none; border-top: 1px solid #1a2a3a; margin: 14px 0; }
    .progress-bar { height: 4px; background: #1a2a3a; border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #1d4ed8, #0891b2); border-radius: 2px; transition: width 0.4s; }
    .metric-box { background: #0d1621; border: 1px solid #1a2a3a; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 28px; font-family: 'Share Tech Mono', monospace; color: #60a5fa; }
    .metric-label { font-size: 11px; color: #3a5a7a; margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
    .hotkey {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      background: #1a2a3a; color: #4a6a8a; font-size: 10px;
      font-family: 'Share Tech Mono', monospace; border: 1px solid #2a3a4a;
    }
    .drop-zone {
      border: 2px dashed #1a3050; border-radius: 8px;
      padding: 28px; text-align: center; cursor: pointer;
      transition: border-color 0.15s, background 0.15s; background: #070d18;
    }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #1d4ed8; background: rgba(29,78,216,0.06); }
    .drop-zone-label { font-size: 13px; color: #4a6a8a; line-height: 1.6; }

    /* Facilitator settings */
    .settings-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
    .settings-label { font-size: 12px; color: #4a6fa5; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.06em; }
    .settings-section-header {
      font-size: 13px; font-weight: 700; color: #7a9ab5; font-family: 'Share Tech Mono', monospace;
      letter-spacing: 0.1em; text-transform: uppercase; margin: 28px 0 16px; padding-bottom: 10px;
      border-bottom: 1px solid #1a3050;
    }
    .settings-section-sub { font-size: 11px; font-weight: 400; text-transform: none; letter-spacing: 0.02em; color: #2a4a6a; display: block; margin-top: 3px; }
    .toggle-switch {
      display: inline-flex; align-items: center; gap: 8px; background: none; border: none;
      padding: 0; cursor: pointer; font-family: 'Share Tech Mono', monospace;
    }
    .toggle-track {
      position: relative; width: 34px; height: 18px; border-radius: 10px;
      background: #1a2a3a; border: 1px solid #2a3a4a; flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s;
    }
    .toggle-thumb {
      position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%;
      background: #4a6a8a; transition: transform 0.15s, background 0.15s;
    }
    .toggle-switch.on .toggle-track { background: #0d3a1c; border-color: #16a34a; }
    .toggle-switch.on .toggle-thumb { transform: translateX(16px); background: #4ade80; }
    .toggle-switch-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #7a9ab5; }
    .toggle-switch.on .toggle-switch-label { color: #86efac; }

    /* Confirmation modal */
    .modal-backdrop {
      position: fixed; inset: 0; z-index: 500;
      background: rgba(0,0,0,0.65); backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .modal {
      background: #0d1621; border: 1px solid #1a2a3a; border-radius: 10px;
      padding: 28px 28px 24px; max-width: 420px; width: 100%;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .modal-icon { font-size: 32px; margin-bottom: 12px; }
    .modal-title { font-size: 16px; font-weight: 600; color: #e0eaff; margin-bottom: 8px; }
    .modal-body { font-size: 13px; color: #6b82a0; line-height: 1.6; margin-bottom: 24px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    /* Tooltips */
    .tooltip-wrap { position: relative; display: inline-flex; align-items: center; }
    .tooltip-icon {
      width: 16px; height: 16px; border-radius: 50%;
      background: #1a2a3a; border: 1px solid #2a3a4a;
      color: #4a6a8a; font-size: 10px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: default; margin-left: 6px; flex-shrink: 0; font-family: 'Inter', sans-serif;
      transition: background 0.15s, color 0.15s;
    }
    .tooltip-icon:hover { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    .tooltip-bubble {
      position: absolute; left: 24px; top: 50%; transform: translateY(-50%);
      background: #0a1520; border: 1px solid #1d4ed8;
      border-radius: 6px; padding: 10px 13px;
      width: 260px; font-size: 12px; color: #93afd4; line-height: 1.6;
      z-index: 400; pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    .tooltip-bubble strong { color: #e0eaff; display: block; margin-bottom: 4px; font-size: 12px; }
    /* Chat action buttons below AI messages */
    .msg-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .msg-action-btn {
      padding: 3px 10px; border-radius: 4px; border: 1px solid #1a2a3a;
      background: rgba(255,255,255,0.03); color: #4a6a8a;
      font-size: 11px; font-family: 'Share Tech Mono', monospace;
      cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; gap: 4px;
    }
    .msg-action-btn:hover { border-color: #ca8a04; color: #fbbf24; background: rgba(202,138,4,0.08); }
    .msg-action-btn.options-btn:hover { border-color: #60a5fa; color: #93c5fd; background: rgba(29,78,216,0.1); }
    /* Multiple choice option buttons */
    .mc-options { display: flex; flex-direction: column; gap: 8px; }
    .mc-option {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 11px 14px; border-radius: 6px; cursor: pointer;
      background: #0a1520; border: 1px solid #1a2a3a;
      font-size: 13px; color: #c9d1da; text-align: left;
      transition: border-color 0.15s, background 0.15s;
      width: 100%;
    }
    .mc-option:hover:not(:disabled) { border-color: #1d4ed8; background: rgba(29,78,216,0.1); color: #e0eaff; }
    .mc-option:disabled { opacity: 0.4; cursor: not-allowed; }
    .mc-option-label {
      flex-shrink: 0; width: 22px; height: 22px; border-radius: 4px;
      background: rgba(29,78,216,0.2); border: 1px solid #1d4ed8;
      color: #60a5fa; font-size: 11px; font-weight: 700;
      font-family: 'Share Tech Mono', monospace;
      display: flex; align-items: center; justify-content: center;
    }

    /* AAR skeleton shimmer */
    @keyframes shimmer {
      0% { background-position: -600px 0; }
      100% { background-position: 600px 0; }
    }
    .skeleton {
      background: linear-gradient(90deg, #0d1621 25%, #162030 50%, #0d1621 75%);
      background-size: 600px 100%;
      animation: shimmer 1.6s infinite linear;
      border-radius: 4px;
    }
    .skeleton-line { height: 13px; margin-bottom: 8px; }
    .skeleton-line-short { width: 40%; }
    .skeleton-line-med { width: 65%; }
    .skeleton-line-full { width: 100%; }
    .skeleton-block { height: 48px; border-radius: 6px; margin-bottom: 8px; }
    .skeleton-title { height: 10px; width: 120px; margin-bottom: 14px; }

    /* Landing page */
    .landing {
      min-height: calc(100vh - 56px);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      padding: 48px 24px; text-align: center;
      background: radial-gradient(ellipse at 50% 0%, rgba(29,78,216,0.12) 0%, transparent 65%);
    }
    .landing-logo {
      width: 72px; height: 72px;
      background: linear-gradient(135deg, #0d6efd, #00d4ff);
      border-radius: 16px; display: flex; align-items: center;
      justify-content: center; font-size: 36px;
      margin: 0 auto 28px; box-shadow: 0 0 40px rgba(13,110,253,0.35);
    }
    .landing-wordmark {
      font-family: 'Share Tech Mono', monospace; font-size: 36px;
      letter-spacing: 0.12em; color: #e0eaff; margin-bottom: 6px;
    }
    .landing-tagline {
      font-size: 16px; color: #4a6fa5; margin-bottom: 12px;
      font-weight: 400; max-width: 480px; line-height: 1.5;
    }
    .landing-description {
      font-size: 14px; color: #3a5570; max-width: 520px;
      line-height: 1.75; margin-bottom: 40px;
    }
    .landing-features {
      display: flex; gap: 12px; justify-content: center;
      flex-wrap: wrap; margin-bottom: 48px; max-width: 640px;
    }
    .landing-feature {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 20px;
      background: rgba(255,255,255,0.03); border: 1px solid #1a2a3a;
      font-size: 12px; color: #4a6a8a; white-space: nowrap;
    }
    .landing-feature-icon { font-size: 14px; }
    .landing-divider {
      width: 1px; height: 48px; background: linear-gradient(to bottom, transparent, #1a2a3a, transparent);
      margin: 0 auto 48px;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-up { animation: fadeUp 0.5s ease forwards; }
    .fade-up-delay-1 { animation-delay: 0.1s; opacity: 0; }
    .fade-up-delay-2 { animation-delay: 0.2s; opacity: 0; }
    .fade-up-delay-3 { animation-delay: 0.35s; opacity: 0; }
    .fade-up-delay-4 { animation-delay: 0.5s; opacity: 0; }

    /* Footer */
    .footer {
      border-top: 1px solid #1a2a3a;
      background: #0a0f18;
      padding: 14px 24px;
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 10px;
    }
    .footer-left { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .footer-attr {
      font-size: 11px; color: #2a4060;
      font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em;
    }
    .footer-attr a { color: #3a5a80; text-decoration: none; }
    .footer-attr a:hover { color: #60a5fa; }
    .footer-feedback {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 5px;
      border: 1px solid #1a2a3a; background: rgba(255,255,255,0.02);
      color: #4a6a8a; font-size: 11px; font-family: 'Share Tech Mono', monospace;
      text-decoration: none; letter-spacing: 0.04em;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .footer-feedback:hover {
      border-color: #dc2626; color: #f87171;
      background: rgba(220,38,38,0.08);
    }

    /* Voice waveform animation */
    .wave-bar {
      width: 3px; background: #a78bfa; border-radius: 2px;
      animation: wave 0.8s ease-in-out infinite;
    }
    .wave-bar:nth-child(2) { animation-delay: 0.15s; }
    .wave-bar:nth-child(3) { animation-delay: 0.3s; }
    .wave-bar:nth-child(4) { animation-delay: 0.15s; }
  `}</style>
);

// ── Topbar ────────────────────────────────────────────────────
function Topbar({ sessionName, stopped, finalDuration, elapsed }) {
  // `elapsed` is passed in live from App, which mirrors ExerciseView's scenarioElapsedSec
  // (see App's `elapsedSec` state and ExerciseView's `onElapsedChange`) — Topbar has no
  // timer of its own, so it stays in sync across mounts, resumes, and sessionName changes.
  const displayTime = stopped ? finalDuration : elapsed;
  // Floor first, then split into h/m/s — `elapsed` is a float (fractional-second deltas
  // accumulate in ExerciseView's ticking effect), so flooring only after the `% 60` would
  // leave a fractional remainder in the seconds position (e.g. "12:47.982").
  const fmt = s => {
    const whole = Math.floor(s);
    return `${String(Math.floor(whole / 3600)).padStart(2, "0")}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  };
  return (
    <div className="topbar no-print">
      <div className="topbar-brand">
        <div className="topbar-logo">🛡</div>
        <div>
          <div className="topbar-title">TACTICIAN</div>
          <div className="topbar-subtitle">Cybersecurity Tabletop Platform</div>
        </div>
      </div>
      <div className="topbar-right">
        {sessionName && <>
          <span className="mono" style={{ fontSize: 12, color: "#4a6a8a" }}>SESSION</span>
          <span className="mono" style={{ fontSize: 13, color: "#7cb3f5" }}>{sessionName}</span>
          <span style={{ color: "#1a2a3a" }}>|</span>
          <span className="mono" style={{ fontSize: 13, color: stopped ? "#4a6a8a" : "#4ade80" }}>{fmt(displayTime)}</span>
          {stopped
            ? <span className="badge" style={{ background: "rgba(74,106,138,0.15)", color: "#4a6a8a", border: "1px solid rgba(74,106,138,0.3)" }}>COMPLETE</span>
            : <span className="badge badge-live"><span className="pulse">●</span> LIVE</span>}
        </>}
      </div>
    </div>
  );
}

// ── Playbook Upload ───────────────────────────────────────────
function PlaybookUpload({ onParsed }) {
  const [status, setStatus] = useState("idle");
  const [parsedPlaybook, setParsedPlaybook] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [mode, setMode] = useState("file");
  const fileRef = useRef();

  const parseWithClaude = async (contentBlocks) => {
    setStatus("parsing");
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: `You are a cybersecurity expert parsing an incident response playbook. Respond ONLY with valid JSON — no markdown, no preamble.
JSON shape: { "name": string, "phases": string[], "summary": string }
Extract actual phase/step names from the document. If unclear, infer sensible IR phases.`,
          messages: [{ role: "user", content: [...contentBlocks, { type: "text", text: "Parse this playbook and return the JSON." }] }]
        })
      });
      const data = await resp.json();
      const raw = data.content?.find(b => b.type === "text")?.text || "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setParsedPlaybook(parsed);
      setStatus("done");
      onParsed({ ...parsed, type: "custom", id: "custom" });
    } catch {
      setStatus("error");
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
      });
      await parseWithClaude([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }]);
    } else {
      const text = await file.text();
      await parseWithClaude([{ type: "text", text: text.slice(0, 8000) }]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className={`btn btn-sm ${mode === "file" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("file")}>📎 Upload File</button>
        <button className={`btn btn-sm ${mode === "paste" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("paste")}>📋 Paste Text</button>
      </div>
      {mode === "file" && (
        <div className={`drop-zone${dragOver ? " drag-over" : ""}`}
          onClick={() => fileRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>{status === "done" ? "✅" : status === "parsing" ? "⏳" : "📄"}</div>
          <div className="drop-zone-label">
            {status === "idle" && <><strong style={{ color: "#c9d4e0" }}>Drop your playbook here</strong><br />PDF or TXT · Claude extracts phases automatically</>}
            {status === "parsing" && <><span className="spinner" style={{ verticalAlign: "middle" }} /> <strong style={{ color: "#93c5fd" }}>Claude is reading your playbook…</strong></>}
            {status === "done" && <strong style={{ color: "#4ade80" }}>Playbook parsed — phases extracted</strong>}
            {status === "error" && <strong style={{ color: "#f87171" }}>Parse failed — try again or paste text</strong>}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}
      {mode === "paste" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea placeholder="Paste your playbook text here…" value={pasteText} onChange={e => setPasteText(e.target.value)} style={{ minHeight: 120 }} />
          <button className="btn btn-primary btn-sm" disabled={!pasteText.trim() || status === "parsing"}
            onClick={() => parseWithClaude([{ type: "text", text: pasteText.slice(0, 8000) }])}>
            {status === "parsing" ? <><span className="spinner" /> Parsing…</> : "✦ Parse with Claude"}
          </button>
        </div>
      )}
      {parsedPlaybook && (
        <div style={{ background: "#070d18", border: "1px solid #1a3050", borderRadius: 6, padding: 12 }}>
          <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>{parsedPlaybook.name}</div>
          <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 8 }}>{parsedPlaybook.summary}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {parsedPlaybook.phases?.map((p, i) => <span key={i} className="tag">Phase {i + 1}: {p}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────
function Tooltip({ children }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <div className="tooltip-icon" tabIndex={0} aria-label="More info">?</div>
      {visible && <div className="tooltip-bubble">{children}</div>}
    </div>
  );
}

// A binary on/off switch — visually distinct from `.pill-group` (used for choosing one of
// several mutually-exclusive options) so a true enable/disable control doesn't get lost
// among the tier pills sitting right below it.
function Toggle({ checked, onChange, labelOn = "Enabled", labelOff = "Disabled" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="toggle-switch-label">{checked ? labelOn : labelOff}</span>
    </button>
  );
}

// ── Facilitator Settings ──────────────────────────────────────
function FacilitatorSettings({ config, onChange, scenario, secondaryScenario, blendRelation, mysterySlot, playbook, participants, mystery, companyProfile }) {
  const FOCUS_AREAS = ["Technical", "Legal / Compliance", "Communications", "Executive Decision-Making", "Vendor Management"];
  const toggle = (arr, val) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
  const [showPrompt, setShowPrompt] = useState(false);

  const previewPrompt = buildSystemPrompt(
    config,
    scenario || { name: "[Scenario]", description: "[Scenario description]" },
    playbook || { name: "[Playbook]" },
    "[Current Phase]",
    participants || [{ name: "", role: "[Role]" }],
    0,
    config.maxTurns,
    null,
    false,
    mystery,
    companyProfile,
    secondaryScenario,
    blendRelation,
    mysterySlot
  );

  const TONE_INFO = {
    conversational: { label: "💬 Conversational", tip: <><strong>Conversational</strong>Warmer, more approachable language. Good for teams new to tabletops or when psychological safety is a priority.</> },
    professional: { label: "🎩 Professional", tip: <><strong>Professional</strong>Claude communicates with formal, structured language — appropriate for exec-level exercises or compliance-driven drills where tone matters.</> },
    intense: { label: "⚡ High-Pressure", tip: <><strong>High-Pressure</strong>Urgent, real-time language — as though the incident is actively unfolding. Best for experienced teams who want an immersive, stressful simulation.</> },
  };
  const DIFF_INFO = {
    light: { label: "🟢 Introductory", tip: <><strong>Introductory</strong>Wrong decisions surface gently. Hints are generous. Good for teams running their first tabletop or learning a new playbook.</> },
    moderate: { label: "🟡 Moderate", tip: <><strong>Moderate</strong>Wrong calls play out realistically before consequences are surfaced. Hints are available but not overly detailed. Assumes working IR knowledge.</> },
    rigorous: { label: "🔴 Rigorous", tip: <><strong>Rigorous</strong>Mistakes compound quickly with no softening. Hints are minimal and Socratic. Designed for experienced IR teams stress-testing their playbook.</> },
  };
  const COMPLEXITY_INFO = {
    narrow: { label: "🎯 Narrow", tip: <><strong>Narrow</strong>Claude responds only to exactly what the team did or asked — no volunteered extra complications.</> },
    standard: { label: "⚖️ Standard", tip: <><strong>Standard</strong>Claude adds the one natural next development each response warrants, without stacking on unrelated complications. Default for most exercises.</> },
    branching: { label: "🌿 Branching", tip: <><strong>Branching</strong>Claude can layer an extra unprompted complication or time-pressure beat into its response, on top of the direct consequence of the team's action.</> },
  };
  const FOCUS_TIPS = {
    "Technical": "Evaluates decisions around containment tooling, log analysis, forensic preservation, and technical IR procedures.",
    "Legal / Compliance": "Watches for regulatory notification timelines (GDPR, HIPAA, SEC), chain-of-custody requirements, and legal hold obligations.",
    "Communications": "Tracks internal escalation paths, external disclosure decisions, media handling, and stakeholder messaging.",
    "Executive Decision-Making": "Focuses on how leadership is briefed, what decisions require executive sign-off, and business impact framing.",
    "Vendor Management": "Monitors third-party notification obligations, vendor IR coordination, and supply chain considerations.",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      <div className="settings-section-header" style={{ marginTop: 0 }}>
        Facilitator Configuration
        <span className="settings-section-sub">Tone, difficulty, and how much Claude volunteers beyond the direct consequence of an action</span>
      </div>

      {/* TONE */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>TONE</div>
          <Tooltip><strong>Tone</strong>Controls the language register Claude uses throughout the exercise — how it presents scenarios, delivers consequences, and frames the situation.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(TONE_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.tone === v ? " active" : ""}`} onClick={() => onChange({ ...config, tone: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* DIFFICULTY */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>DIFFICULTY</div>
          <Tooltip><strong>Difficulty</strong>Controls how wrong decisions play out — how hard consequences hit, how generous hints are, and how much tolerance Claude has for vague or incomplete responses.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(DIFF_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.difficulty === v ? " active" : ""}`} onClick={() => onChange({ ...config, difficulty: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* COMPLEXITY */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>COMPLEXITY</div>
          <Tooltip><strong>Complexity</strong>Controls how much Claude volunteers on top of what a team action directly warrants — independent of Difficulty, which controls how harsh those developments are once they happen. Narrow sticks to exactly what was asked; Branching can layer in an extra unprompted complication.</Tooltip>
        </div>
        <div className="pill-group">
          {Object.entries(COMPLEXITY_INFO).map(([v, { label, tip }]) => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.complexity === v ? " active" : ""}`} onClick={() => onChange({ ...config, complexity: v })}>{label}</div>
              <Tooltip>{tip}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {secondaryScenario && (
        <>
          <div className="settings-section-header">
            Blended Incidents
            <span className="settings-section-sub">This session blends {scenario?.name} + {secondaryScenario.name} into one feed</span>
          </div>
          <div className="settings-row">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div className="settings-label" style={{ marginBottom: 0 }}>SHOW INCIDENT TAGS</div>
                <Tooltip><strong>Show Incident Tags</strong>Labels each facilitator message and inject with which underlying incident it belongs to. Off by default so the team has to work out the connection themselves — flip this on if you'd rather they focus purely on prioritization instead of also untangling which thread is which. Safe to toggle at any point, including mid-exercise.</Tooltip>
              </div>
              <Toggle checked={!!config.showIncidentTags} onChange={v => onChange({ ...config, showIncidentTags: v })} labelOn="Visible" labelOff="Hidden" />
            </div>
          </div>
        </>
      )}

      <div className="settings-section-header">
        Scenario Configuration
        <span className="settings-section-sub">Optional whole-exercise time budget (facilitator warning only)</span>
      </div>

      {/* TIME LIMIT — whole-scenario budget only (warning-only; never advances phases or ends
          the exercise). Phase advancement is AI-driven, so there is no turn limit and no
          per-phase time limit here anymore. */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div className="settings-label" style={{ marginBottom: 0 }}>SCENARIO TIME BUDGET</div>
            <Tooltip><strong>Scenario Time Budget</strong>An optional cap on total real-world time for the whole exercise. It only warns the facilitator when exceeded — it never advances a phase or ends the exercise. Phases advance automatically based on the AI facilitator's read of what the team is doing.</Tooltip>
          </div>
          <Toggle checked={config.timeLimitEnabled} onChange={v => onChange({ ...config, timeLimitEnabled: v })} />
        </div>
        {config.timeLimitEnabled && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ margin: 0, fontSize: 12, color: "#7a9ab5" }}>Total scenario time budget (minutes):</label>
              <input type="number" min={5} max={480} value={config.maxScenarioMinutes}
                onChange={e => onChange({ ...config, maxScenarioMinutes: Math.min(480, Math.max(5, parseInt(e.target.value, 10) || 5)) })}
                style={{ width: 72, textAlign: "center" }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
              This budget is a facilitator-facing warning only — the exercise will flag when it's exceeded but will not end automatically or advance phases on its own.
            </div>
          </>
        )}
      </div>

      <div className="settings-section-header">
        Advanced Settings
        <span className="settings-section-sub">Optional focus, prompt inspection, and free-text instructions</span>
      </div>

      {/* FOCUS AREAS */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>FOCUS AREAS <span style={{ color: "#2a4a6a", fontWeight: 400 }}>(optional)</span></div>
          <Tooltip><strong>Focus Areas</strong>Tells Claude which dimensions to track closely when evaluating team decisions. Multiple can be selected. Leave blank for a balanced exercise.</Tooltip>
        </div>
        <div className="pill-group">
          {FOCUS_AREAS.map(v => (
            <div key={v} style={{ display: "inline-flex", alignItems: "center" }}>
              <div className={`pill${config.focusAreas.includes(v) ? " active-multi" : ""}`}
                onClick={() => onChange({ ...config, focusAreas: toggle(config.focusAreas, v) })}>{v}</div>
              <Tooltip><strong>{v}</strong>{FOCUS_TIPS[v]}</Tooltip>
            </div>
          ))}
        </div>
      </div>

      {/* Prompt preview */}
      <div className="settings-row">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>SYSTEM PROMPT SENT TO CLAUDE</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPrompt(v => !v)} style={{ fontSize: 11 }}>
            {showPrompt ? "Hide ▲" : "Preview ▼"}
          </button>
        </div>
        {showPrompt && (
          <div style={{
            background: "#040a12", border: "1px solid #1a3050", borderRadius: 6,
            padding: "12px 14px", fontFamily: "'Share Tech Mono', monospace",
            fontSize: 11, color: "#5a8ab0", lineHeight: 1.8,
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflowY: "auto"
          }}>
            {previewPrompt}
          </div>
        )}
      </div>

      {/* Custom instructions */}
      <div className="settings-row" style={{ marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div className="settings-label" style={{ marginBottom: 0 }}>ADDITIONAL INSTRUCTIONS</div>
          <Tooltip><strong>Additional Instructions</strong>Free-text appended verbatim to the system prompt. Use for org-specific tools (e.g. Sentinel, CrowdStrike), policies, regulatory context, or any constraint the AI facilitator should know about.</Tooltip>
        </div>
        <div style={{ position: "relative" }}>
          <textarea
            value={config.customInstructions}
            onChange={e => onChange({ ...config, customInstructions: e.target.value })}
            style={{ minHeight: 108, fontSize: 13, paddingBottom: config.customInstructions ? 8 : 90 }}
          />
          {!config.customInstructions && (
            <div style={{ position: "absolute", top: 10, left: 12, right: 12, pointerEvents: "none", userSelect: "none" }}>
              <div style={{ fontSize: 11, color: "#2a4060", fontStyle: "italic", marginBottom: 6, letterSpacing: "0.03em" }}>
                — Examples (click to type your own) —
              </div>
              {[
                "Always ask about regulatory notification timelines.",
                "Assume participants are new to IR — explain concepts before questioning.",
                "Our org uses Microsoft Sentinel and CrowdStrike — reference these tools.",
              ].map((ex, i) => (
                <div key={i} style={{ fontSize: 11, color: "#1e3a5a", fontStyle: "italic", padding: "2px 0", display: "flex", alignItems: "flex-start", gap: 5 }}>
                  <span style={{ color: "#1a3050", flexShrink: 0 }}>•</span>
                  <span>{ex}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
          Appended verbatim to the system prompt. Use for org-specific tools, policies, or constraints.
        </div>
      </div>
    </div>
  );
}

// Build system prompt from facilitator config
function buildSystemPrompt(config, scenario, playbook, phase, participants, turnNumber = 0, maxTurns = config.maxTurns, nextPhase = null, isLastPhase = false, mystery = false, companyProfile = DEFAULT_COMPANY_PROFILE, secondaryScenario = null, blendRelation = null, mysterySlot = null) {
  const toneMap = {
    professional: "formal and authoritative",
    conversational: "warm and approachable",
    intense: "urgent and high-pressure, as if this is a real incident unfolding in real time",
  };
  const diffMap = {
    light: "beginner-friendly — when participants make a wrong call, surface consequences gently; when they ask for a hint, be generous with direction",
    moderate: "assume working IR knowledge — let wrong decisions play out before surfacing consequences; hints should nudge without over-explaining",
    rigorous: "expert-level — wrong decisions carry full realistic consequences with no softening; hints are minimal and Socratic",
  };
  const complexityMap = {
    narrow: "respond only to what the team explicitly did or asked — do not volunteer additional complications or developments beyond what their action directly warrants",
    standard: "respond to their action with the single natural next development it warrants — avoid piling on multiple unrelated complications in the same response",
    branching: "feel free to layer in an additional, unprompted complication or time-pressure beat on top of the direct consequence of their action — real incidents rarely present one clean issue at a time",
  };
  const focus = config.focusAreas.length
    ? `\nPay particular attention to these dimensions when evaluating team decisions: ${config.focusAreas.join(", ")}.`
    : "";
  const custom = config.customInstructions.trim()
    ? `\n\nAdditional facilitator instructions:\n${config.customInstructions}`
    : "";

  // Phase advancement is fully AI-driven: there is no turn or time limit, and no manual/auto
  // phase advance. The facilitator classifies the current phase each turn from the team's
  // actions, emitting a hidden [PHASE:<name>] tag the app reads (see parsePhaseTag/
  // applyPhaseFromText). The turnNumber/maxTurns/nextPhase/isLastPhase params are accepted
  // for signature compatibility with callers but do not affect the generated prompt.
  const phaseList = (playbook.phases || []).length ? playbook.phases : [phase];
  const phaseTracking = `\n\nPHASE TRACKING (required, technical/invisible to the team): This exercise follows the ${playbook.name} phases, in order: ${phaseList.join(" → ")}. There is NO turn or time limit — the phase is determined ENTIRELY by what the team is actually doing. Begin EVERY response (including the opening scene) with a single hidden tag on its own line, before any narrative text, in exactly this format: [PHASE:<exact phase name>], choosing the ONE phase from the list above that best matches the team's current actions and the state of the incident (e.g. isolating hosts / blocking attacker paths → the containment/respond phase; restoring from backups and validating service → the recovery phase; capturing what worked and turning findings into improvements → the lessons-learned phase). Use the phase name EXACTLY as written in the list. You MAY move the phase BACKWARD as well as forward if the situation warrants it (e.g. a newly discovered compromised host during recovery pulls the team back to responding). This tag is stripped by the app and never shown to the team — never mention phases, phase names, or this tagging to them, and do not narrate "we are now in the X phase."`;

  // mysteryBlock only ever applies to a genuinely solo Mystery Scenario session (no
  // secondaryScenario). When blended, ALL masking — whether one slot is a Mystery pick, or
  // both slots are simply known-but-root-cause-gated — is handled inside blendBlock instead,
  // since that's the one place that can correctly reference "the other slot" without the
  // awkward wording collision of two separate blocks each assuming they own the whole prompt.
  const mysteryBlock = mystery && !secondaryScenario
    ? `\n\nMYSTERY SCENARIO: The team has NOT been told what type of incident this is — that's the point of the exercise. Never state, name, or directly hint at the scenario's category or title (e.g. do not say or imply "ransomware," "DDoS," "insider threat," "phishing," "business email compromise," "data exfiltration," "supply chain compromise," or the scenario's title "${scenario.name}") anywhere in your response, including the opening scene-setting message. The opening scene-setting message will be provided to you verbatim as a generic, category-agnostic business/user-facing symptom — reproduce it faithfully (light rewording for flow is fine) and do NOT layer in any technical indicator, mechanism, or category hint of your own on top of it. From the team's first action onward, describe only the technical symptoms, indicators, and consequences the team would actually observe, and let them diagnose the incident type themselves through their own investigation and playbook knowledge. If and only if the team correctly identifies the incident type through their own actions or reasoning, you may confirm it naturally as the scenario progresses — never volunteer it first.`
    : "";

  // Complements mysteryBlock: for explicitly-selected (non-mystery, non-blended) scenarios,
  // the team already knows the incident CATEGORY (they picked it at setup), so hiding that
  // would be pointless. Instead, gate the ROOT CAUSE / SOURCE — the specific technical
  // mechanism, attacker infrastructure, exploited vulnerability, or insider identity — behind
  // investigative actions, so the exercise still requires digging (log review, auth audits,
  // EDR/network tooling, vendor calls) rather than handing over the answer in the opening.
  // Blended sessions get the equivalent gating folded into blendBlock instead (see below),
  // since it needs to speak about two scenarios rather than assume it owns the whole prompt.
  const rootCauseBlock = !mystery && !secondaryScenario
    ? `\n\nROOT-CAUSE INVESTIGATION: The team knows this is being run as a "${scenario.name}" exercise, but they have NOT yet been given the specific technical root cause, attack source, or mechanism behind it. Do not volunteer specific technical indicators — attacker infrastructure, exploited vulnerability/CVE, compromised credentials, exact log entries, protocol/port details, data volumes, or an insider's identity — until the team takes a plausible investigative action that would surface that information (e.g. reviewing logs, auditing authentication history, engaging EDR/network tooling, contacting a vendor, pulling access records). Until they investigate, describe only observable symptoms and business impact — what non-technical staff or monitoring dashboards would notice. Once an action would plausibly reveal a specific technical detail, disclose it as a natural consequence of that action, not as a gift.`
    : "";

  const industry = INDUSTRIES.find(i => i.id === companyProfile?.industry);
  const sizeTier = COMPANY_SIZES.find(s => s.id === companyProfile?.companySize);
  const companyContext = companyProfile?.additionalContext?.trim();
  const companyBlock = (industry || sizeTier || companyContext)
    ? `\n\nCOMPANY PROFILE: Tailor scenario details — system names, dollar figures, headcounts, regulatory references, and organizational tone — to fit this organization rather than defaulting to generic examples.${industry ? ` Industry: ${industry.name} (relevant regulatory framework: ${industry.regulator}).` : ""}${sizeTier ? ` Size: ${sizeTier.name}.` : ""}${companyContext ? ` Additional context provided by the participants: ${companyContext}` : ""}`
    : "";

  // BLENDED INCIDENTS: two scenarios are woven into a single feed rather than run as
  // separate tracks. `blendRelation` is decided once at launch and never told to the team —
  // it only steers how you (the facilitator) are allowed to eventually treat a link between
  // the two threads, IF the team's own investigation earns that reveal. `mysterySlot`
  // ("A" | "B" | null) marks whichever thread, if any, is ALSO a Mystery pick — its category
  // must stay fully hidden (not just its root cause) for the entire exercise, same standard
  // as solo Mystery Scenario mode, layered on top of the ordinary blend-triage challenge.
  const slotLine = (label, sc, slot) => mysterySlot === slot
    ? `  • Incident ${label} — MYSTERY THREAD (hidden from the team, never reveal even the category): internally this is "${sc.name}" (${sc.description}), but the team must NEVER be told its category, title, or specific mechanism — do not say or imply "ransomware," "DDoS," "insider threat," "phishing," "business email compromise," "data exfiltration," "supply chain compromise," or its title. Describe only generic, category-agnostic business/user-facing symptoms for this thread (odd account behavior, scattered helpdesk tickets, unusual traffic — the same kind of vague reports regardless of which of the standard incident types it actually is). Let the team diagnose it, if at all, purely through their own investigation and reasoning; if they correctly guess it, you may confirm naturally, but never volunteer it first.`
    : `  • Incident ${label} — "${sc.name}": ${sc.description}. The team selected this scenario themselves at setup, so its CATEGORY is fully known to them — reference it by name freely. Its specific technical root cause/mechanism (attacker infrastructure, exploited vulnerability, compromised credentials, exact log entries, an insider's identity, etc.) is still NOT yet known to them, though — withhold those details until a plausible investigative action would surface them (log review, auth audit, EDR/network tooling, vendor call, access records), same standard as a single-scenario ROOT-CAUSE INVESTIGATION exercise.`;
  const blendBlock = secondaryScenario
    ? `\n\nBLENDED INCIDENTS: This is a Blended Incidents exercise — TWO scenarios are unfolding at the same time and must be woven into ONE continuous narrative feed, not narrated as separate parallel tracks. The two threads are:
${slotLine("A", scenario, "A")}
${slotLine("B", secondaryScenario, "B")}
- Interleave symptoms, injects, and developments from BOTH incidents into the same scene-setting narrative and the same responses over time — do not resolve one before introducing the other, and do not silo them into clearly separate paragraphs every time.
- The team must do the work of triaging: deciding what to investigate first, what to deprioritize, and whether the two threads are actually connected. Never tell them outright which incident a given detail belongs to (that judgment call is the exercise) unless HINT MODE applies.
- ${blendRelation === "coordinated"
        ? `Ground truth (never reveal directly): the two incidents ARE part of one coordinated attack. If — and only if — the team's own investigative actions would plausibly surface a genuine technical link (shared infrastructure, a common compromised credential, overlapping timing that a log correlation would reveal, etc.), you may let that connection emerge as a natural consequence of their action. Never volunteer it first, and never make the connection more obvious than the specific evidence they've actually uncovered would justify.`
        : `Ground truth (never reveal directly): the two incidents are NOT actually connected — any apparent overlap is coincidental. If the team pursues a theory that they're linked, do not confirm it; let their own investigation turn up evidence that gently undercuts the theory (e.g. a timeline that doesn't line up, unrelated infrastructure) rather than lecturing them that they're wrong. Do not manufacture a link just because they're looking for one.`}${mysterySlot ? ` This compounds with Incident ${mysterySlot}'s Mystery-thread masking above — the team won't even know both incidents' categories, let alone whether they're linked, so resist any urge to make the connection easier to spot just because one side is already a known scenario.` : ""}
- THREAD TAGGING (required, technical/invisible to the team): begin every response — including the opening scene-setting message — with a single hidden tag on its own line, before any narrative text, in exactly this format: [THREAD:A] if the response's content belongs to Incident A only, [THREAD:B] if it belongs to Incident B only, or [THREAD:BOTH] if it touches both in the same response. This tag is stripped and used by the app to optionally label incidents for the facilitator — it must never be visible narrative text and must never be explained to the team.`
    : "";

  return `You are an expert cybersecurity tabletop exercise facilitator. Your role is to simulate a realistic incident and respond to the team's decisions — not to lead or prompt them.

SCENARIO: ${scenario.name}. ${scenario.description}
PLAYBOOK: ${playbook.name}. Current phase: ${phase}.
PARTICIPANTS: ${participants.map(p => `${p.name || p.role} (${p.role})`).join(", ")}.

CORE BEHAVIOR:
- Let the team drive. Do not ask leading questions or suggest what they should do next. Respond to what they say, not what you wish they'd said.
- Evaluate every decision against the ${playbook.name} framework silently. If the team takes a correct action, acknowledge it briefly and advance the simulation's state with a new development.
- If the team makes an incorrect or incomplete decision, do not correct them directly. Let the simulation consequences play out — introduce a realistic complication that results from their choice (e.g. delayed containment leads to lateral spread, missed notification triggers a regulatory issue).
- If the team misses a critical step and moves on, surface the gap as a scenario event: "Meanwhile, [consequence of the missed step] has now occurred."
- Never volunteer the right answer. Never ask "have you considered X?" unless they have explicitly asked for a hint.
- Do not explain what the current phase, framework, or playbook requires, or what steps the team is "supposed" to take at this stage — assume the team already knows their own playbook. The exercise exists to test that knowledge, not teach it. Reserve any framework or phase guidance for HINT MODE below, and only when a participant explicitly asks for one.
- Report observable facts and outcomes only — do not evaluate, judge, or benchmark them against a standard, best practice, or "what guidance recommends" (e.g. do not say something like "the retention window is narrower than standard guidance recommends for an incident of this nature"). State what IS — configurations, findings, results — and let the team determine on their own whether it's adequate; don't hand them the assessment. That kind of evaluation belongs in the After-Action Report afterward, not mid-exercise.
- State scenario developments factually. Do not editorialize or build suspense about whether a situation is serious (avoid hedging or dramatic framing like "could be nothing," "nothing dramatic — yet," "raises an eyebrow," or similar) — report only what was observed. This applies to the narrative body only; it does not override the mandatory closing line below, which every response still needs.
- Keep responses under 150 words unless delivering a major scenario development.
- MANDATORY: end EVERY response with a single short line on its own that invites action, e.g. "What is your team's next action?" or "How does your team respond?" or "The clock is ticking — what do you do?" Vary the phrasing; never repeat the same closing line twice in a row. This is the one place where inviting the team to act is not "leading" them — it is required scaffolding, not a suggestion of what to do. The sole exception is the very first opening scene-setting message, whose own instructions explicitly say not to ask a question — follow that instruction as written for that one message only; every response after it still needs this closing line.

HINT MODE:
- If a participant explicitly asks for a hint, help, direction, or says they are stuck, briefly shift into hint mode: acknowledge the request, then offer one directional nudge grounded in ${playbook.name} — not the answer, just a pointer toward the right area of thinking. Return to observer mode immediately after.
- Example hint format: "Your ${playbook.name} playbook's ${phase} guidance focuses on [area] — has the team addressed that yet?"
- If a participant asks for multiple choice options, respond with a single short sentence acknowledging the request (e.g. "Here are your options — choose your team's next action." or "Select the action your team will take."), then immediately follow with the option lines and nothing else. Include 4 options total: 2-3 that are appropriate for the current phase, and 1-2 that are plausible-sounding but either belong to a different phase, are premature, or are common actions in other incident types. Do not indicate which options are correct. Do NOT write the options as plain text, numbered lists, or lettered lists anywhere in your response — ONLY use the [OPTION_X] format below, as the app renders these as buttons and any plain-text repetition will be shown to the user as duplicate content. Format each option on its own line exactly like this:
  [OPTION_A] Brief action description
  [OPTION_B] Brief action description
  [OPTION_C] Brief action description
  [OPTION_D] Brief action description
  After the team picks one, evaluate their choice and continue the simulation from that decision.

MULTI-ROLE RESPONSES:
- A single message may contain responses from multiple roles at once, each line labeled "RoleName (Role Title): response". When this happens, address each role individually and clearly — using the format "To [Role]: ..." for each one — before offering a single shared closing question at the end.

Tone: ${toneMap[config.tone]}.
Difficulty: ${diffMap[config.difficulty]}.
Complexity: ${complexityMap[config.complexity]}.${focus}${custom}${phaseTracking}${mysteryBlock}${rootCauseBlock}${companyBlock}${blendBlock}`;
}

// Format a set of simultaneous per-role responses into a single labeled block
function formatMultiRoleMessage(responses) {
  return responses
    .filter(r => r.text.trim())
    .map(r => `${r.name || r.role} (${r.role}): ${r.text.trim()}`)
    .join("\n\n");
}

// ── Footer ────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-left">
        <span className="footer-attr">
          Created with <a href="https://claude.ai" target="_blank" rel="noreferrer">Claude AI</a> · Anthropic
        </span>
        <span className="footer-attr" style={{ color: "#1a2a3a" }}>|</span>
        <span className="footer-attr">
          Tactician v1.0 · UNLV Cybersecurity
        </span>
      </div>
      <a
        className="footer-feedback"
        href="https://github.com/Jensen-UNLV/Cybersecurity-AI-Table-Top-Exercise/issues"
        target="_blank"
        rel="noreferrer"
        title="Report a bug or suggest a feature on GitHub"
      >
        🐛 Report a Bug / Give Feedback
      </a>
    </footer>
  );
}

// ── Landing Page ──────────────────────────────────────────────
function LandingPage({ onBegin }) {
  return (
    <div className="landing">
      {/* Logo */}
      <div className="landing-logo fade-up">🛡</div>

      {/* Wordmark + tagline */}
      <div className="landing-wordmark fade-up fade-up-delay-1">TACTICIAN</div>
      <div className="landing-tagline fade-up fade-up-delay-1">
        AI-Powered Cybersecurity Tabletop Exercise Platform
      </div>

      {/* Description */}
      <div className="landing-description fade-up fade-up-delay-2">
        Run realistic incident response drills against industry-standard playbooks
        or your own. An AI facilitator sets the scene, adapts to your team's
        decisions, and generates a structured after-action report when you're done.
      </div>

      {/* Feature pills */}
      <div className="landing-features fade-up fade-up-delay-3">
        {[
          ["🔒", "6 Scenario Types"],
          ["📋", "CISA & NIST Playbooks"],
          ["🤖", "AI Facilitation"],
          ["⚡", "Live Injects"],
          ["💡", "Adaptive Hints"],
          ["📊", "After-Action Reports"],
        ].map(([icon, label]) => (
          <div key={label} className="landing-feature">
            <span className="landing-feature-icon">{icon}</span>
            {label}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="fade-up fade-up-delay-4">
        <button
          className="btn btn-primary"
          onClick={onBegin}
          style={{
            fontSize: 15, padding: "13px 36px", borderRadius: 8,
            boxShadow: "0 0 24px rgba(29,78,216,0.4)",
            letterSpacing: "0.03em",
          }}
        >
          Begin Exercise →
        </button>
      </div>
    </div>
  );
}

// ── Reroll Modal ──────────────────────────────────────────────
function RerollModal({ onKeepCurrent, onReroll, onRemove }) {
  const [rerolling, setRerolling] = useState(false);
  const [btnIcon, setBtnIcon] = useState("🎲");

  const handleBackdrop = (e) => { if (e.target === e.currentTarget && !rerolling) onKeepCurrent(); };

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape" && !rerolling) onKeepCurrent(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rerolling]);

  const handleReroll = () => {
    if (rerolling) return;
    setRerolling(true);
    // Animate the button icon cycling through scenario icons
    const icons = ["🎲", ...SCENARIOS.map(s => s.icon)];
    let tick = 0;
    const iv = setInterval(() => { setBtnIcon(icons[tick % icons.length]); tick++; }, 100);
    setTimeout(() => {
      clearInterval(iv);
      setBtnIcon("✓");
      onReroll();
    }, 1000);
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        <div className="modal-icon">🎲</div>
        <div className="modal-title">Pick a new random scenario?</div>
        <div className="modal-body">
          A scenario has already been secretly selected for your team. Choose an option below.
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" disabled={rerolling} onClick={onKeepCurrent}>
            {onRemove ? "Keep Current" : "Keep Current & Continue →"}
          </button>
          <button
            className="btn"
            disabled={rerolling}
            onClick={handleReroll}
            style={{
              background: "rgba(202,138,4,0.2)", color: "#fbbf24",
              border: "1px solid rgba(202,138,4,0.4)", minWidth: 160,
              display: "inline-flex", alignItems: "center",
              justifyContent: "center", gap: 6,
            }}
          >
            {rerolling
              ? <><span style={{ fontSize: 16, lineHeight: 1 }}>{btnIcon}</span> Re-randomizing…</>
              : <><span style={{ fontSize: 16, lineHeight: 1 }}>🎲</span> Yes, Re-randomize</>}
          </button>
        </div>
        {onRemove && (
          <button
            type="button"
            disabled={rerolling}
            onClick={onRemove}
            style={{
              marginTop: 10, background: "transparent", border: "none",
              color: "#7a8ab5", fontSize: 12, textDecoration: "underline",
              cursor: rerolling ? "default" : "pointer", opacity: rerolling ? 0.5 : 1,
            }}
          >
            ✕ Remove from blend
          </button>
        )}
      </div>
    </div>
  );
}

// ── Randomizer Card ───────────────────────────────────────────
function RandomizerCard({ onSelect, isSelected, onContinue, blendMode, disabled, onRemove, excludeId }) {
  const [spinning, setSpinning] = useState(false);
  const [displayIcon, setDisplayIcon] = useState("🎲");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const intervalRef = useRef(null);
  const isSelectedRef = useRef(isSelected);

  // Keep ref in sync without triggering spin-stop side effect
  useEffect(() => { isSelectedRef.current = isSelected; }, [isSelected]);

  const prevIsSelected = useRef(isSelected);

  // When parent clears isSelected (true→false), stop spin and reset
  // When parent sets isSelected (false→true from back-nav), just reset icon
  useEffect(() => {
    const prev = prevIsSelected.current;
    prevIsSelected.current = isSelected;
    if (prev && !isSelected && spinning) {
      // User picked a different scenario — stop the spin
      setSpinning(false);
      setDisplayIcon("🎲");
      clearInterval(intervalRef.current);
    } else if (isSelected && !spinning) {
      // Restored via back navigation
      setDisplayIcon("🎲");
    }
  }, [isSelected]);

  // Clean up interval on unmount
  useEffect(() => () => clearInterval(intervalRef.current), []);

  // Excludes whatever the OTHER blend pick already is (via `excludeId`, only relevant in
  // blend mode) so Surprise Me can never silently roll the same scenario the team already
  // picked explicitly for the other slot.
  const rollPick = () => {
    const pool = excludeId ? SCENARIOS.filter(s => s.id !== excludeId) : SCENARIOS;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const startSpin = (pick) => {
    setSpinning(true);
    let tick = 0;
    const icons = SCENARIOS.map(s => s.icon);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setDisplayIcon(icons[tick % icons.length]);
      tick++;
    }, 80);
    onSelect(pick);
  };

  const handleClick = () => {
    if (spinning || disabled) return;
    // If already selected, ask for confirmation before re-rolling
    if (isSelected) {
      setConfirmReroll(true);
      return;
    }
    startSpin(rollPick());
  };


  return (
    <>
      <div
        className={`scenario-card${isSelected && !spinning ? " selected" : ""}`}
        onClick={handleClick}
        style={{
          borderStyle: isSelected && !spinning ? "solid" : "dashed",
          borderColor: spinning ? "#ca8a04" : isSelected ? "#60a5fa" : "#1a3a5a",
          background: spinning
            ? "rgba(202,138,4,0.05)"
            : isSelected
            ? "rgba(96,165,250,0.06)"
            : "rgba(29,78,216,0.03)",
          cursor: disabled ? "not-allowed" : spinning ? "default" : "pointer",
          opacity: disabled ? 0.45 : 1,
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          transition: "border-color 0.3s, background 0.3s",
        }}
      >
        <div style={{
          fontSize: spinning ? 36 : 28,
          marginBottom: 8,
          transition: "font-size 0.1s",
          filter: spinning ? "blur(1.5px)" : "none",
        }}>
          {displayIcon}
        </div>
        <div className="scenario-name" style={{
          color: spinning ? "#ca8a04" : isSelected ? "#e0eaff" : "#7cb3f5",
        }}>
          {spinning ? "Randomizing…" : isSelected ? "Surprise Me ✓" : "Surprise Me"}
        </div>
        <div className="scenario-desc" style={{ marginTop: 6 }}>
          {spinning
            ? "Your scenario is being selected…"
            : isSelected
            ? blendMode
              ? "A scenario has been secretly selected for this blend slot. Click here to re-roll it, or use the button below to remove it."
              : "A scenario has been secretly selected. Click Continue to proceed, or click here to pick a new random scenario."
            : blendMode
            ? "Blend a hidden, category-unknown incident in with your other pick."
            : "Feeling bold? Let the platform secretly choose your scenario. The team won't know what they're facing until the exercise starts."}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
          <span className="tag" style={{
            background: isSelected && !spinning ? "rgba(96,165,250,0.15)" : "rgba(29,78,216,0.12)",
            color: isSelected && !spinning ? "#93c5fd" : "#60a5fa",
            border: isSelected && !spinning ? "1px solid rgba(96,165,250,0.3)" : "1px solid rgba(29,78,216,0.3)",
          }}>
            🎲 {isSelected && !spinning ? "Randomized" : "Random"}
          </span>
          {isSelected && !spinning && blendMode && (
            <span style={{
              fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
              padding: "2px 7px", borderRadius: 3,
              background: "rgba(167,139,250,0.15)", color: "#a78bfa",
              border: "1px solid rgba(167,139,250,0.3)",
            }}>🧬 In blend</span>
          )}
        </div>
        {/* Continue button — shown once a scenario is locked in (spinning or settled); absent
            entirely in blend mode, since the shared 2-pick Continue bar handles that instead */}
        {(isSelected || spinning) && onContinue && (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: "100%" }}
            onClick={e => { e.stopPropagation(); onContinue(); }}
          >
            {spinning ? "Continue →" : "Continue →"}
          </button>
        )}
      </div>

      {/* Re-roll confirmation — bespoke modal with animated re-randomize button; in blend
          mode also offers a "Remove from blend" link so the pick can be cleared without
          forcing a re-roll */}
      {confirmReroll && (
        <RerollModal
          onKeepCurrent={() => { setConfirmReroll(false); if (onContinue) onContinue(); }}
          onReroll={() => {
            setConfirmReroll(false);
            // Pick a new scenario silently — no card animation, navigate directly
            onSelect(rollPick()); // update parent state with new pick
            if (onContinue) onContinue();
          }}
          onRemove={blendMode && onRemove ? () => { setConfirmReroll(false); onRemove(); } : undefined}
        />
      )}
    </>
  );
}

// ── Setup Flow ────────────────────────────────────────────────
function ParticipantSetup({ onStart, lastPlayed }) {
  const [step, setStep] = useState(0);
  const [usedRandomizer, setUsedRandomizer] = useState(false);
  // Blended Incidents mode — an alternative to picking a single scenario. When active, the
  // scenario grid becomes a multi-select (cap of 2): both picks get woven into one narrative
  // rather than run as separate tracks. Surprise Me now lives INSIDE this same grid (see Step 0
  // render) as its first tile, so it can be one of the two blend picks too — blending a known
  // scenario with a Mystery (category-hidden) one. blendPicks is uniformly shaped as
  // { id, isMystery, real: <SCENARIOS entry> } so regular and mystery picks can share the same
  // toggle/finalize logic; `real` is always a concrete scenario (needed for prompt-building),
  // `isMystery` just marks which slot must stay category-hidden from the team.
  const [blendMode, setBlendMode] = useState(false);
  const [blendPicks, setBlendPicks] = useState([]);
  const [selected, setSelected] = useState({
    scenario: null, playbook: null,
    secondaryScenario: null, // set only when blendMode is used to launch
    blendRelation: null,     // "coordinated" | "coincidental" — decided at launch, hidden from participants
    mysterySlot: null,       // "A" | "B" | null — which blend slot (if any) is a Mystery pick
    participants: ROLES.map(role => ({ role, name: "", id: role, active: role === "Facilitator" })),
    sessionName: "",
    facilitatorConfig: { ...DEFAULT_FACILITATOR },
    companyProfile: { ...DEFAULT_COMPANY_PROFILE },
  });

  // Auto-fill session name when scenario chosen
  const selectScenario = (sc) => {
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setUsedRandomizer(false); // manual pick clears randomizer flag
    setSelected(s => ({
      ...s, scenario: sc, secondaryScenario: null, blendRelation: null, mysterySlot: null,
      sessionName: s.sessionName || `${sc.name} TTX — ${date}`,
    }));
  };

  // Commits blendPicks into `selected` once exactly 2 are chosen (or clears when < 2). Shared
  // by the regular-card toggle and all three Surprise Me blend actions (add/reroll/remove)
  // below, so the relation-roll and mysterySlot derivation only ever happen in one place.
  const finalizeBlend = (picks) => {
    if (picks.length === 2) {
      const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const label = (p) => p.isMystery ? "Mystery Scenario" : p.real.name;
      const mysterySlot = picks[0].isMystery ? "A" : picks[1].isMystery ? "B" : null;
      setSelected(s => ({
        ...s, scenario: picks[0].real, secondaryScenario: picks[1].real,
        blendRelation: pickBlendRelation(), mysterySlot,
        sessionName: s.sessionName || `${label(picks[0])} + ${label(picks[1])} TTX — ${date}`,
      }));
    } else {
      setSelected(s => ({ ...s, scenario: null, secondaryScenario: null, blendRelation: null, mysterySlot: null }));
    }
  };

  // Toggles a REGULAR scenario in/out of the blend-mode pick set (max 2). Once 2 are picked,
  // the relationship between them (coordinated attack vs coincidental overlap) is rolled once
  // via finalizeBlend — not re-rolled on every toggle — so flipping a pick back off and
  // re-adding a third card doesn't quietly re-randomize the answer the team will be judged on.
  const toggleBlendPick = (sc) => {
    setBlendPicks(picks => {
      const already = picks.find(p => p.id === sc.id);
      const next = already ? picks.filter(p => p.id !== sc.id) : [...picks, { id: sc.id, isMystery: false, real: sc }].slice(0, 2);
      finalizeBlend(next);
      return next;
    });
  };

  // Surprise Me's blend-mode actions. Kept separate from toggleBlendPick because the mystery
  // slot needs its own random-scenario roll (excluding whatever the OTHER blend pick already
  // is, so the two slots can never collide) and a reroll path, mirroring RandomizerCard's
  // existing solo reroll flow one level up.
  const addMysteryToBlend = () => {
    setBlendPicks(picks => {
      if (picks.length >= 2 || picks.some(p => p.isMystery)) return picks;
      const excludeId = picks[0]?.id;
      const pool = excludeId ? SCENARIOS.filter(s => s.id !== excludeId) : SCENARIOS;
      const real = pool[Math.floor(Math.random() * pool.length)];
      const next = [...picks, { id: "surprise-me", isMystery: true, real }].slice(0, 2);
      finalizeBlend(next);
      return next;
    });
  };
  const rerollMysteryInBlend = () => {
    setBlendPicks(picks => {
      const other = picks.find(p => !p.isMystery);
      const pool = other ? SCENARIOS.filter(s => s.id !== other.id) : SCENARIOS;
      const real = pool[Math.floor(Math.random() * pool.length)];
      const next = picks.map(p => p.isMystery ? { ...p, real } : p);
      finalizeBlend(next);
      return next;
    });
  };
  const removeMysteryFromBlend = () => {
    setBlendPicks(picks => {
      const next = picks.filter(p => !p.isMystery);
      finalizeBlend(next);
      return next;
    });
  };
  // Solo (non-blend) Surprise Me pick/reroll — same callback handles both, since
  // RandomizerCard calls onSelect for the initial random pick AND for a confirmed reroll.
  const selectMysterySolo = (pick) => {
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setUsedRandomizer(true);
    setSelected(s => ({ ...s, scenario: pick, secondaryScenario: null, blendRelation: null, mysterySlot: null, sessionName: s.sessionName || `TTX — ${date}` }));
  };

  const updateParticipant = (id, field, value) =>
    setSelected(s => ({ ...s, participants: s.participants.map(p => p.id === id ? { ...p, [field]: value } : p) }));

  const toggleSeat = (id) =>
    setSelected(s => ({ ...s, participants: s.participants.map(p => p.id === id ? { ...p, active: !p.active } : p) }));

  const activeParticipants = selected.participants.filter(p => p.active);

  // Compute synchronously — no hooks, no deferred evaluation
  const canProceed = (() => {
    if (step === 0) return blendMode ? blendPicks.length === 2 : !!selected.scenario;
    if (step === 1) return !!selected.playbook;
    if (step === 2) return !!selected.companyProfile.industry && !!selected.companyProfile.companySize;
    if (step === 3) return activeParticipants.length > 0 && !!selected.sessionName.trim();
    return true;
  })();

  const STEPS = ["Select Scenario", "Choose Playbook", "Company Profile", "Participants", "AI Facilitator"];

  return (
    <div className="main">
      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: i < step ? "#22c55e" : i === step ? "#1d4ed8" : "#1a2a3a",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}>{i < step ? "✓" : i + 1}</div>
            <span style={{ fontSize: 13, color: i === step ? "#e0eaff" : "#3a5a7a" }}>{s}</span>
            {i < STEPS.length - 1 && <span style={{ color: "#1a2a3a", fontSize: 16, margin: "0 4px" }}>›</span>}
          </div>
        ))}
      </div>

      {/* ── Step 0: Scenario ── */}
      {step === 0 && (
        <>
          <div className="section-header" style={{ display: "block", textAlign: "center" }}>
            <div><div className="section-title">Choose a Scenario</div><div className="section-sub">Select the incident type your team will practice, or let the platform choose for you.</div></div>
          </div>

          {/* Blend Two Scenarios — increases difficulty by weaving two scenarios' symptoms and
              injects into a single narrative instead of running one clean incident. Toggling
              this switches the grid below from single-select to a 2-card multi-select. Sits
              above the grid now that Surprise Me lives inside it (see below) rather than as
              its own full-width zone with a divider separating it from "specific" scenarios. */}
          <div
            className={`scenario-card${blendMode ? " selected" : ""}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20, cursor: "pointer" }}
            onClick={() => {
              setBlendMode(b => !b);
              setBlendPicks([]);
              setUsedRandomizer(false);
              setSelected(s => ({ ...s, scenario: null, secondaryScenario: null, blendRelation: null, mysterySlot: null }));
            }}
          >
            <div style={{ fontSize: 24 }}>🧬</div>
            <div style={{ flex: 1 }}>
              <div className="scenario-name" style={{ marginBottom: 4 }}>Blend Two Scenarios</div>
              <div style={{ fontSize: 12, color: "#4a6a8a" }}>Increases difficulty — two incidents' symptoms and injects surface together in one feed. Your team has to triage and figure out whether they're actually connected. Blend Surprise Me in too for an incident your team can't even identify the category of.</div>
            </div>
            <span className="tag" style={{
              background: blendMode ? "rgba(167,139,250,0.15)" : "rgba(29,78,216,0.12)",
              color: blendMode ? "#a78bfa" : "#60a5fa",
              border: blendMode ? "1px solid rgba(167,139,250,0.3)" : "1px solid rgba(29,78,216,0.3)",
            }}>{blendMode ? "✓ ON" : "OFF"}</span>
          </div>

          {blendMode && (
            <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 12, fontFamily: "'Share Tech Mono', monospace" }}>
              SELECT {2 - blendPicks.length > 0 ? `${2 - blendPicks.length} MORE` : "COMPLETE"} SCENARIO{blendPicks.length === 1 ? "" : "S"} TO BLEND ({blendPicks.length}/2)
            </div>
          )}

          {/* Unified scenario grid — Surprise Me is now the first tile, sized identically to
              the six named scenarios (RandomizerCard already renders with the same
              `.scenario-card` class/sizing; it just used to sit in its own full-width wrapper
              above a divider). Single-select normally, up-to-2 multi-select in Blend mode. */}
          <div className="grid-3 gap-4" style={{ marginBottom: 24 }}>
            <RandomizerCard
              blendMode={blendMode}
              isSelected={blendMode ? blendPicks.some(p => p.isMystery) : usedRandomizer}
              disabled={blendMode && blendPicks.length >= 2 && !blendPicks.some(p => p.isMystery)}
              onSelect={blendMode
                ? (pick) => {
                    setBlendPicks(picks => {
                      const already = picks.some(p => p.isMystery);
                      const next = already
                        ? picks.map(p => p.isMystery ? { ...p, real: pick } : p)
                        : [...picks, { id: "surprise-me", isMystery: true, real: pick }].slice(0, 2);
                      finalizeBlend(next);
                      return next;
                    });
                  }
                : selectMysterySolo}
              onRemove={blendMode ? removeMysteryFromBlend : undefined}
              excludeId={blendMode ? blendPicks.find(p => !p.isMystery)?.id : undefined}
              onContinue={blendMode ? undefined : () => { setStep(1); window.scrollTo({ top: 0, behavior: "instant" }); }}
            />
            {SCENARIOS.map(sc => {
              const isActive = blendMode
                ? blendPicks.some(p => p.id === sc.id)
                : selected.scenario?.id === sc.id && !usedRandomizer;
              const blendFull = blendMode && blendPicks.length >= 2 && !isActive;
              return (
                <div key={sc.id}
                  className={`scenario-card${isActive ? " selected" : ""}`}
                  onClick={() => {
                    if (blendMode) { if (!blendFull) toggleBlendPick(sc); return; }
                    if (!isActive) selectScenario(sc);
                  }}
                  style={{ cursor: blendFull ? "not-allowed" : (isActive && !blendMode) ? "default" : "pointer", opacity: blendFull ? 0.45 : 1 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <span className="scenario-icon">{sc.icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                      <span className={`badge badge-severity-${sc.severity}`}>{sc.severity}</span>
                      {isActive && blendMode && (
                        <span style={{
                          fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                          padding: "2px 7px", borderRadius: 3,
                          background: "rgba(167,139,250,0.15)", color: "#a78bfa",
                          border: "1px solid rgba(167,139,250,0.3)",
                          whiteSpace: "nowrap",
                        }}>🧬 In blend</span>
                      )}
                      {lastPlayed?.scenarioId === sc.id && (
                        <span style={{
                          fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                          padding: "2px 7px", borderRadius: 3,
                          background: "rgba(124,58,237,0.15)", color: "#a78bfa",
                          border: "1px solid rgba(124,58,237,0.3)",
                          whiteSpace: "nowrap",
                        }}>↺ Last played</span>
                      )}
                    </div>
                  </div>
                  <div className="scenario-name">{sc.name}</div>
                  <div className="scenario-desc">{sc.description}</div>
                  {lastPlayed?.scenarioId === sc.id && (
                    <div style={{ fontSize: 11, color: "#5a4a7a", fontFamily: "'Share Tech Mono', monospace" }}>
                      {new Date(lastPlayed.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {lastPlayed.playbookName ? ` · ${lastPlayed.playbookName}` : ""}
                    </div>
                  )}
                  <div className="scenario-tags">{sc.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
                  {/* Continue button appears on selected card in single-select mode only —
                      blend mode uses the shared bar below since it needs 2 cards confirmed */}
                  {isActive && !blendMode && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 12, width: "100%" }}
                      onClick={e => { e.stopPropagation(); setStep(1); window.scrollTo({ top: 0, behavior: "instant" }); }}
                    >
                      Continue →
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Shared Continue bar for Blend mode, once both picks are made. Masks the mystery
              pick's icon/name if one of the two slots is Surprise Me — this bar is still part
              of setup, so it must not leak the identity any earlier than the exercise itself
              would (which stays hidden all the way through, per the Blended Incidents mystery
              masking in buildSystemPrompt/Scenario Brief/chat header). */}
          {blendMode && blendPicks.length === 2 && (
            <button
              className="btn btn-primary"
              style={{ width: "100%", marginBottom: 24 }}
              onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: "instant" }); }}
            >
              Continue with {blendPicks[0].isMystery ? "🎲 Mystery Scenario" : `${blendPicks[0].real.icon} ${blendPicks[0].real.name}`} + {blendPicks[1].isMystery ? "🎲 Mystery Scenario" : `${blendPicks[1].real.icon} ${blendPicks[1].real.name}`} →
            </button>
          )}
        </>
      )}

      {/* ── Step 1: Playbook ── */}
      {step === 1 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 760, margin: "0 auto 16px", textAlign: "center" }}>
            <div><div className="section-title">Select a Playbook</div><div className="section-sub">Industry standard or your own — Claude reads it automatically.</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto 24px" }}>
            {INDUSTRY_PLAYBOOKS.map(pb => (
              <div key={pb.id}
                className={`scenario-card${selected.playbook?.id === pb.id ? " selected" : ""}`}
                onClick={() => setSelected(s => ({ ...s, playbook: pb }))}
                style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 24 }}>{pb.id === "cisa" ? "🏛" : "📋"}</div>
                <div style={{ flex: 1 }}>
                  <div className="scenario-name" style={{ marginBottom: 6 }}>{pb.name}</div>
                  {pb.description && (
                    <div style={{ fontSize: 12, color: "#5a7a9a", lineHeight: 1.5, marginBottom: 8 }}>{pb.description}</div>
                  )}
                  {pb.phaseGroups ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {pb.phaseGroups.map((g, gi) => (
                        <div key={gi} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", textTransform: "uppercase", letterSpacing: ".04em", minWidth: 100 }}>{g.label}</span>
                          {g.phases.map((p, i) => <span key={i} className="tag">{p}</span>)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{pb.phases.map((p, i) => <span key={i} className="tag">{p}</span>)}</div>
                  )}
                </div>
              </div>
            ))}
            <div className={`card`}
              style={{ border: selected.playbook?.type === "custom" ? "1px solid #60a5fa" : "1px solid #1a2a3a" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 24 }}>📁</span>
                <div>
                  <div className="scenario-name">Your Internal Playbook</div>
                  <div style={{ fontSize: 12, color: "#4a6a8a" }}>Upload a PDF or paste text — Claude extracts phases automatically</div>
                </div>
              </div>
              <PlaybookUpload onParsed={pb => setSelected(s => ({ ...s, playbook: pb }))} />
            </div>
          </div>
        </>
      )}

      {/* ── Step 2: Company Profile ── */}
      {step === 2 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 680, margin: "0 auto 16px", textAlign: "center" }}>
            <div>
              <div className="section-title">Company Profile</div>
              <div className="section-sub">Tell the AI facilitator about your organization so scenario details and injects feel like your company, not a generic example.</div>
            </div>
          </div>
          <div style={{ maxWidth: 680, margin: "0 auto 24px" }}>
            <div className="card">
              <div className="card-title">Organization Details</div>
              <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label>Industry</label>
                  <select
                    value={selected.companyProfile.industry}
                    onChange={e => setSelected(s => ({ ...s, companyProfile: { ...s.companyProfile, industry: e.target.value } }))}
                  >
                    <option value="">Select industry…</option>
                    {INDUSTRIES.map(ind => <option key={ind.id} value={ind.id}>{ind.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label>Company Size</label>
                  <select
                    value={selected.companyProfile.companySize}
                    onChange={e => setSelected(s => ({ ...s, companyProfile: { ...s.companyProfile, companySize: e.target.value } }))}
                  >
                    <option value="">Select size…</option>
                    {COMPANY_SIZES.map(sz => <option key={sz.id} value={sz.id}>{sz.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label>Additional Context (optional)</label>
                <textarea
                  placeholder="e.g. cloud-first infrastructure, recent M&A activity, remote workforce, public company, primary tech stack…"
                  value={selected.companyProfile.additionalContext}
                  onChange={e => setSelected(s => ({ ...s, companyProfile: { ...s.companyProfile, additionalContext: e.target.value } }))}
                  style={{ minHeight: 90 }}
                />
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "#2a4a6a" }}>
                Industry and size are used to scale dollar figures, record counts, and regulatory references throughout the exercise. This profile is locked in for the session once launched.
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 3: Participants ── */}
      {step === 3 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 680, margin: "0 auto 16px", textAlign: "center" }}>
            <div><div className="section-title">Participants & Session</div><div className="section-sub">Enable the roles joining this exercise. Names are optional — leave blank to use the role title.</div></div>
          </div>
          <div style={{ maxWidth: 680, margin: "0 auto 24px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Session details stacked on top */}
            <div className="card">
              <div className="card-title">Session Details</div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label>Session Name</label>
                  <input type="text" value={selected.sessionName} onChange={e => setSelected(s => ({ ...s, sessionName: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Scenario</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#070d18", borderRadius: 6, border: "1px solid #1a2a3a", height: 38 }}>
                    {selected.mysterySlot && selected.secondaryScenario ? (
                      <>
                        <span style={{ fontSize: 16 }}>{selected.mysterySlot === "A" ? "🎲" : selected.scenario?.icon}{selected.mysterySlot === "B" ? "🎲" : selected.secondaryScenario?.icon}</span>
                        <span style={{ fontSize: 13, color: "#c9d4e0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.mysterySlot === "A" ? "Mystery Scenario" : selected.scenario?.name} + {selected.mysterySlot === "B" ? "Mystery Scenario" : selected.secondaryScenario?.name}</span>
                        <span className="tag" style={{ flexShrink: 0, background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>🧬 Blended · 🎲 Mystery</span>
                      </>
                    ) : usedRandomizer ? (
                      <>
                        <span style={{ fontSize: 16 }}>🎲</span>
                        <span style={{ fontSize: 13, color: "#c9d4e0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Mystery Scenario</span>
                        <span className="tag" style={{ flexShrink: 0, background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.3)" }}>Randomized</span>
                      </>
                    ) : selected.secondaryScenario ? (
                      <>
                        <span style={{ fontSize: 16 }}>{selected.scenario?.icon}{selected.secondaryScenario?.icon}</span>
                        <span style={{ fontSize: 13, color: "#c9d4e0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.scenario?.name} + {selected.secondaryScenario?.name}</span>
                        <span className="tag" style={{ flexShrink: 0, background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>🧬 Blended</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 16 }}>{selected.scenario?.icon}</span>
                        <span style={{ fontSize: 13, color: "#c9d4e0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.scenario?.name}</span>
                        <span className={`badge badge-severity-${selected.scenario?.severity}`} style={{ flexShrink: 0 }}>{selected.scenario?.severity}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Role seats stacked below, full width */}
            <div className="card">
              <div className="card-title">Role Seats — {activeParticipants.length} of {selected.participants.length} active</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selected.participants.map(p => (
                  <div key={p.id} style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 1fr 28px",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#0a1520",
                    border: `1px solid ${p.active ? "#1a2a3a" : "#111820"}`,
                    opacity: p.active ? 1 : 0.45,
                    transition: "opacity 0.15s",
                  }}>
                    {/* Toggle dot */}
                    <div
                      style={{ width: 10, height: 10, borderRadius: "50%", background: p.active ? "#22c55e" : "#2a3a4a", cursor: "pointer", flexShrink: 0 }}
                      title={p.active ? "Click to deactivate" : "Click to activate"}
                      onClick={() => toggleSeat(p.id)}
                    />
                    {/* Role dropdown — always the authoritative label */}
                    <select
                      value={p.role}
                      disabled={!p.active}
                      onChange={e => updateParticipant(p.id, "role", e.target.value)}
                      style={{ fontSize: 12, padding: "5px 8px", background: "#060e18", border: "1px solid #1a2a3a", borderRadius: 4, color: p.active ? "#93afd4" : "#2a4a5a", width: "100%", cursor: p.active ? "pointer" : "default" }}
                    >
                      {ROLES.map(r => <option key={r}>{r}</option>)}
                    </select>
                    {/* Optional name field */}
                    <input
                      type="text"
                      placeholder={`Name (optional)`}
                      value={p.name}
                      disabled={!p.active}
                      onChange={e => updateParticipant(p.id, "name", e.target.value)}
                      style={{ fontSize: 12, padding: "5px 8px", background: "#060e18", border: "1px solid #1a2a3a", borderRadius: 4, color: "#c9d1da", width: "100%" }}
                    />
                    {/* Remove / restore icon */}
                    <button
                      onClick={() => toggleSeat(p.id)}
                      title={p.active ? "Deactivate seat" : "Add this role"}
                      style={{
                        width: 24, height: 24,
                        borderRadius: "50%",
                        border: p.active ? "1px solid #1a3050" : "1px solid #16a34a",
                        background: p.active ? "transparent" : "rgba(22,163,74,0.2)",
                        color: p.active ? "#3a5a7a" : "#4ade80",
                        fontSize: p.active ? 13 : 17,
                        fontWeight: p.active ? 400 : 700,
                        cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.15s",
                        lineHeight: 1,
                        boxShadow: p.active ? "none" : "0 0 6px rgba(74,222,128,0.3)",
                      }}
                    >{p.active ? "✕" : "+"}</button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "#2a4a6a" }}>
                Use ✕ / + to enable or disable a seat · Change role via dropdown · Name is optional
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Step 4: Facilitator Settings ── */}
      {step === 4 && (
        <>
          <div className="section-header" style={{ display: "block", maxWidth: 760, margin: "0 auto 16px", textAlign: "center" }}>
            <div>
              <div className="section-title">AI Facilitator Settings</div>
              <div className="section-sub">Shape how the AI facilitates — tone, difficulty, focus areas, and custom instructions.</div>
            </div>
          </div>
          <div style={{ maxWidth: 760, margin: "0 auto 24px" }}>
            <div className="card">
              <FacilitatorSettings
                config={selected.facilitatorConfig}
                onChange={fc => setSelected(s => ({ ...s, facilitatorConfig: fc }))}
                scenario={selected.scenario}
                secondaryScenario={selected.secondaryScenario}
                blendRelation={selected.blendRelation}
                mysterySlot={selected.mysterySlot}
                playbook={selected.playbook}
                participants={selected.participants.filter(p => p.active)}
                mystery={usedRandomizer && !selected.secondaryScenario}
                companyProfile={selected.companyProfile}
              />
              <hr className="divider" />
              <div style={{ fontSize: 12, color: "#2a4a6a", lineHeight: 1.7 }}>
                <strong style={{ color: "#3a6a9a" }}>How this works:</strong> These settings shape the AI's system prompt directly — they tell it how to ask questions, what to emphasize, and how much to challenge your team. You can return to this panel mid-exercise from the Settings tab.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Nav — width matches each step's content column so buttons align left under the content, not the page */}
      <div style={{
        display: "flex", gap: 10, paddingBottom: 40,
        ...(step === 0 ? {} : { maxWidth: (step === 2 || step === 3) ? 680 : 760, margin: "0 auto" }),
      }}>
        {step > 0 && <button className="btn btn-ghost" onClick={() => {
          // Going back to step 0 after randomizer: keep the hidden scenario,
          // just return to the scenario page — Surprise Me will show as selected
          setStep(s => s - 1);
          window.scrollTo({ top: 0, behavior: "instant" });
        }}>← Back</button>}
        {step < STEPS.length - 1
          ? <button
              className="btn btn-primary"
              disabled={!canProceed}
              style={!canProceed ? { opacity: 0.4, pointerEvents: "none" } : {}}
              onClick={() => { setStep(s => s + 1); window.scrollTo({ top: 0, behavior: "instant" }); }}
            >Continue →</button>
          : <button
              className="btn btn-primary"
              disabled={!canProceed}
              style={!canProceed ? { opacity: 0.4, pointerEvents: "none" } : {}}
            onClick={() => {
              // `usedRandomizer` (local state) only tracks the SOLO Surprise Me path;
              // `selected.mysterySlot` tracks a Mystery pick used as one of two blend slots.
              // Either one means there's a hidden thread somewhere in this session, which is
              // what session.usedRandomizer / mysteryOpenerIndex actually need to reflect.
              const hasMysteryThread = usedRandomizer || !!selected.mysterySlot;
              onStart({
                ...selected,
                participants: activeParticipants,
                usedRandomizer: hasMysteryThread,
                // Seed once at launch so the same generic opener is used consistently across
                // resumes of this session, rather than re-randomizing on every reload.
                mysteryOpenerIndex: hasMysteryThread ? Math.floor(Math.random() * MYSTERY_OPENERS.length) : undefined,
              });
            }}>
            Launch Exercise →
          </button>}
      </div>
    </div>
  );
}

// ── Voice button ──────────────────────────────────────────────
function VoiceButton({ text }) {
  const [speaking, setSpeaking] = useState(false);
  if (!speech.supported) return null;

  const toggle = () => {
    if (speaking) { speech.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    speech.speak(text);
    const check = setInterval(() => {
      if (!window.speechSynthesis.speaking) { setSpeaking(false); clearInterval(check); }
    }, 300);
  };

  return (
    <button
      className={`voice-btn${speaking ? " speaking" : ""}`}
      onClick={toggle}
      title={speaking ? "Stop narration" : "Read this message aloud"}
      style={{
        padding: "3px 9px",
        borderRadius: 4,
        border: speaking ? "1px solid rgba(167,139,250,0.4)" : "1px solid #1a2a3a",
        background: speaking ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
        color: speaking ? "#a78bfa" : "#4a6a8a",
        fontSize: 11,
        fontFamily: "'Share Tech Mono', monospace",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        transition: "all 0.15s",
      }}
    >
      {speaking
        ? <><span style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 14, verticalAlign: "middle" }}>{[1,2,3,4].map(i => <span key={i} className="wave-bar" style={{ height: `${5 + i * 2}px` }} />)}</span> Stop</>
        : <>🔊 Read aloud</>}
    </button>
  );
}

// ── AI Chat ───────────────────────────────────────────────────

// Parse [OPTION_X] lines out of an AI message
function parseOptions(text) {
  const matches = [...text.matchAll(/\[OPTION_([A-D])\]\s*(.+)/g)];
  return matches.map(m => ({ label: m[1], text: m[2].trim() }));
}

// Strip [OPTION_X] lines from displayed text, and catch any plain-text
// lettered list items Claude may produce as a fallback (A: ..., B: ..., etc.)
function stripOptions(text) {
  return text
    .replace(/\[OPTION_[A-D]\].+/g, "")
    // Catches stray "A. ...", "A: ...", "A) ..." multiple-choice-style lines the model
    // sometimes writes without the [OPTION_X] bracket format. Requires real punctuation
    // (. ) or :) directly after the letter and at least one space before the option text,
    // so an ordinary sentence starting with the indefinite article "A " (e.g. "A wave of
    // complaints...", "A separate incident...") is not affected.
    .replace(/^[A-D][.):]\s+.{10,}/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Defensive strip in case a stray [ADVANCE_PHASE] marker leaks through in the model's
// response. Phases change based on the model's own [PHASE:] tag on each response (see
// parsePhaseTag / applyPhaseFromText); there is no turn/time auto-advance or manual
// "Next Phase" control.
function stripAdvancePhase(text) { return text.replace(/\[ADVANCE_PHASE\]/gi, "").replace(/\n{3,}/g, "\n\n").trim(); }

// Blended Incidents mode only: the facilitator prompt asks every response to open with a
// hidden [THREAD:A] / [THREAD:B] / [THREAD:BOTH] marker identifying which underlying
// scenario the content belongs to. parseThreadTag reads it for optional display (see
// ChatMessage's incident-tag chip); stripThreadTag removes it before the text is ever shown,
// same pattern as stripOptions/stripAdvancePhase above — it must never leak as visible text.
function parseThreadTag(text) {
  const m = /^\s*\[THREAD:(A|B|BOTH)\]/i.exec(text || "");
  return m ? m[1].toUpperCase() : null;
}
function stripThreadTag(text) { return (text || "").replace(/^\s*\[THREAD:(A|B|BOTH)\]/i, "").replace(/^\n+/, "").trim(); }

// AI-driven phase tracking: the facilitator prompt asks every response to open with a
// hidden [PHASE:<name>] marker naming the phase the team's current actions place them in.
// parsePhaseTag maps it to an index in the playbook's phase list (exact match first, then
// prefix, then substring, to tolerate light AI wording drift); stripPhaseTag removes it
// before the text is ever shown — same never-leak contract as the markers above.
function parsePhaseTag(text, phases) {
  const m = /^\s*\[PHASE:\s*([^\]]+)\]/i.exec(text || "");
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  let idx = phases.findIndex(p => p.toLowerCase() === name);
  if (idx === -1) idx = phases.findIndex(p => p.toLowerCase().startsWith(name) || name.startsWith(p.toLowerCase()));
  if (idx === -1) idx = phases.findIndex(p => p.toLowerCase().includes(name) || name.includes(p.toLowerCase()));
  return idx === -1 ? null : idx;
}
function stripPhaseTag(text) { return (text || "").replace(/^\s*\[PHASE:[^\]]*\]/i, "").replace(/^\n+/, "").trim(); }

// ── Multi-Role Response Round ─────────────────────────────────
function MultiRoleInputPanel({ participants, onSubmit, onCancel, loading }) {
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries((participants || []).map(p => [p.id, ""]))
  );

  const setDraft = (id, val) => setDrafts(d => ({ ...d, [id]: val }));
  const filledCount = Object.values(drafts).filter(v => v.trim()).length;

  const submit = () => {
    const responses = (participants || [])
      .map(p => ({ role: p.role, name: p.name, text: drafts[p.id] || "" }))
      .filter(r => r.text.trim());
    if (!responses.length) return;
    onSubmit(responses);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "#4a6fa5", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em" }}>
        MULTI-ROLE RESPONSE ROUND · leave blank to skip a role
      </div>
      {(participants || []).map(p => (
        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ marginBottom: 0 }}>{p.name || p.role} <span style={{ color: "#2a4a6a" }}>({p.role})</span></label>
          <textarea
            placeholder={`${p.role}'s response…`}
            value={drafts[p.id]}
            onChange={e => setDraft(p.id, e.target.value)}
            style={{ minHeight: 56 }}
          />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={!filledCount || loading} onClick={submit}>
          {loading ? <span className="spinner" /> : `⚡ Send ${filledCount} Response${filledCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

const MultiRoleMessageGroup = memo(function MultiRoleMessageGroup({ msg }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.05em" }}>
        MULTI-ROLE RESPONSE · {msg.time}
      </div>
      {msg.authors.map((a, i) => (
        <div key={i} className="chat-msg">
          <div className="chat-avatar">{(a.name || a.role)[0].toUpperCase()}</div>
          <div className="chat-body">
            <div className="chat-meta"><span>{a.name || a.role}</span><span style={{ opacity: 0.5 }}>·</span><span className="mono" style={{ fontSize: 10 }}>{a.role}</span></div>
            <div className="chat-text">{a.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
});

// A single chat bubble, extracted from AIChat's render loop and wrapped in React.memo so it
// only re-renders when ITS OWN message data actually changes — not whenever an ancestor
// re-renders for an unrelated reason (e.g. the per-second phase/scenario countdown ticking in
// ExerciseView). Takes only plain data as props (no callbacks to go stale), so memoizing it
// carries no risk of stale-closure bugs. Avoids tearing down and reconciling unchanged message
// elements on every tick, which prevents intermittent text-selection loss in React apps using
// dangerouslySetInnerHTML.
// `incidentTags` (Blended Incidents mode only) carries { showIncidentTags, primary, secondary }
// so this component can render a small "which incident" chip without needing the whole
// session object — undefined/null in every non-blended session.
const ChatMessage = memo(forwardRef(function ChatMessage({ msg, incidentTags }, ref) {
  const threadTag = msg.role === "ai" ? parseThreadTag(msg.text) : null;
  // Strip [OPTION_X], [ADVANCE_PHASE], [THREAD:X], and [PHASE:X] markers from every AI message
  const displayText = msg.role === "ai"
    ? stripPhaseTag(stripThreadTag(stripAdvancePhase(stripOptions(msg.text))))
    : msg.text;
  const tagInfo = (incidentTags?.showIncidentTags && threadTag)
    ? threadTag === "A" ? (incidentTags.mysterySlot === "A" ? { icon: "🎲", name: "Mystery" } : { icon: incidentTags.primary?.icon, name: incidentTags.primary?.name })
      : threadTag === "B" ? (incidentTags.mysterySlot === "B" ? { icon: "🎲", name: "Mystery" } : { icon: incidentTags.secondary?.icon, name: incidentTags.secondary?.name })
      : { icon: "🧬", name: "Both incidents" }
    : null;
  return (
    <div className="chat-msg" ref={ref}>
      <div className={`chat-avatar${msg.role === "ai" ? " ai" : ""}`}>
        {msg.role === "ai" ? "AI" : (msg.author?.[0] || "U").toUpperCase()}
      </div>
      <div className="chat-body">
        <div className="chat-meta">
          <span>{msg.role === "ai" ? "AI Facilitator" : msg.author}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{msg.time}</span>
          {tagInfo && (
            <span className="tag" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>
              {tagInfo.icon} {tagInfo.name}
            </span>
          )}
          {msg.role === "ai" && <VoiceButton text={displayText} />}
        </div>
        <div className={`chat-text${msg.role === "ai" ? " ai-msg" : ""}`}
          dangerouslySetInnerHTML={{ __html: displayText.replace(/\n/g, "<br/>") }} />
      </div>
    </div>
  );
}));

function AIChat({ scenario, secondaryScenario, mysterySlot, showIncidentTags, phase, messages, onMessage, loading, participants, multiMode, onToggleMultiMode, onMultiSend, hideScenarioName, exerciseConcluded, onCompleteExercise }) {
  // incidentTags must keep a stable object reference across renders whenever showIncidentTags/
  // scenario/secondaryScenario/mysterySlot haven't changed, since it's passed into the
  // memo()-wrapped ChatMessage/MultiRoleMessageGroup components — a fresh object reference on
  // every render (e.g. on ExerciseView's per-second tick) would defeat React.memo's shallow
  // comparison and force every chat bubble to reconcile from scratch each tick.
  const incidentTags = useMemo(
    () => secondaryScenario ? { showIncidentTags, primary: scenario, secondary: secondaryScenario, mysterySlot } : null,
    [secondaryScenario, showIncidentTags, scenario, mysterySlot]
  );
  // Header label: full mask for solo Mystery Scenario (hideScenarioName); for Blended
  // Incidents, mask only whichever slot is the Mystery pick (if any) and show the other
  // scenario's real name normally, rather than an all-or-nothing MYSTERY SCENARIO label.
  const headerLabel = hideScenarioName
    ? "MYSTERY SCENARIO"
    : secondaryScenario
    ? `${mysterySlot === "A" ? "MYSTERY" : scenario?.name?.toUpperCase()} + ${mysterySlot === "B" ? "MYSTERY" : secondaryScenario?.name?.toUpperCase()}`
    : scenario?.name?.toUpperCase();
  const [input, setInput] = useState("");
  const [optionsRequested, setOptionsRequested] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const chatAreaRef = useRef(null);
  const lastAiMsgRef = useRef(null);
  const optionsBottomRef = useRef(null);
  const completeBtnRef = useRef(null);

  // Derive these before effects so they're in scope
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isLastAI = lastMsg?.role === "ai";
  const currentOptions = (optionsRequested && isLastAI) ? parseOptions(lastMsg.text) : [];
  const showOptions = currentOptions.length > 0;

  // When a new AI message arrives, scroll its top into view inside the chat area
  useEffect(() => {
    if (!lastAiMsgRef.current || !chatAreaRef.current) return;
    const area = chatAreaRef.current;
    const msg = lastAiMsgRef.current;
    area.scrollTop = msg.offsetTop - area.offsetTop;
  }, [messages, loading]);

  // When options appear, scroll the page so the submit button is visible
  useEffect(() => {
    if (showOptions && optionsBottomRef.current) {
      setTimeout(() => {
        optionsBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }
  }, [showOptions]);

  // When the exercise concludes, the Complete Exercise button renders as the last item
  // in the chat log — scroll it into view immediately rather than leaving it just below
  // the fold, since this can fire from a time-limit countdown hitting zero with no new
  // message having been sent (so the "new AI message" scroll effect above won't have run).
  useEffect(() => {
    if (exerciseConcluded && !loading && completeBtnRef.current) {
      setTimeout(() => {
        completeBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }
  }, [exerciseConcluded, loading]);

  const send = (text, countsAsTurn = true) => {
    const msg = text ?? input;
    if (!msg.trim() || loading) return;
    onMessage(msg, countsAsTurn);
    setInput("");
  };

  const handleRealSend = () => {
    if (!input.trim() || loading) return;
    setOptionsRequested(false);
    setSelectedOption(null);
    send(input); // a real team action — counts toward the turn limit
  };

  const handleOptionSubmit = () => {
    if (!selectedOption || loading) return;
    setOptionsRequested(false);
    setSelectedOption(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    send(`${selectedOption.label}: ${selectedOption.text}`); // the team's chosen action — counts toward the turn limit
  };

  const handleHint = () => {
    setOptionsRequested(false);
    setSelectedOption(null);
    send("We're not sure what to do next — can we get a hint?", false); // meta request, not a response to the scenario — does not count
  };

  const handleOptions = () => {
    setOptionsRequested(true);
    setSelectedOption(null);
    send("We're still stuck — please show us multiple choice options.", false); // meta request, not a response to the scenario — does not count
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>AI FACILITATOR · {headerLabel}</div>
        {participants?.length > 1 && !showOptions && !exerciseConcluded && (
          <button
            className={`btn btn-sm ${multiMode ? "btn-active" : "btn-ghost"}`}
            onClick={onToggleMultiMode}
            title="Collect responses from multiple roles at once"
          >👥 Multi-Role Response</button>
        )}
      </div>
      <div className="chat-area" ref={chatAreaRef}>
        {messages.map((m, i) => {
          const isThisLastAI = m.role === "ai" && i === messages.length - 1;
          if (m.multi) {
            return <MultiRoleMessageGroup key={i} msg={m} />;
          }
          return <ChatMessage key={i} msg={m} incidentTags={incidentTags} ref={isThisLastAI ? lastAiMsgRef : null} />;
        })}
        {loading && (
          <div className="chat-msg" ref={lastAiMsgRef}>
            <div className="chat-avatar ai">AI</div>
            <div className="chat-body">
              <div className="chat-meta">AI Facilitator · now</div>
              <div className="chat-text ai-msg"><span className="spinner" /></div>
            </div>
          </div>
        )}
        {exerciseConcluded && !loading && (
          <div ref={completeBtnRef} style={{ display: "flex", justifyContent: "center", padding: "16px 0 4px" }}>
            <button className="btn btn-success btn-sm" onClick={onCompleteExercise}>Complete Exercise ✓</button>
          </div>
        )}
      </div>

      {/* Hint / options action buttons — both offered together, no sequencing required */}
      {isLastAI && !loading && !showOptions && !exerciseConcluded && (
        <div className="msg-actions" style={{ padding: "8px 0 0" }}>
          <button className="msg-action-btn" onClick={handleHint}
            title="Ask the facilitator for a directional nudge without giving away the answer">
            💡 Ask for a hint
          </button>
          <button className="msg-action-btn options-btn" onClick={handleOptions}
            title="Ask the facilitator to present multiple choice options">
            🔀 Ask for options
          </button>
        </div>
      )}

      <hr className="divider" />

      {/* Input area: multiple choice OR textarea */}
      {showOptions ? (
        <div>
          <div style={{ fontSize: 11, color: "#4a6fa5", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.08em", marginBottom: 10 }}>
            SELECT AN OPTION THEN CLICK SUBMIT
          </div>
          <div className="mc-options">
            {currentOptions.map(opt => {
              const isSelected = selectedOption?.label === opt.label;
              return (
                <button
                  key={opt.label}
                  className="mc-option"
                  disabled={loading}
                  onClick={() => setSelectedOption(isSelected ? null : opt)}
                  style={{
                    borderColor: isSelected ? "#60a5fa" : undefined,
                    background: isSelected ? "rgba(29,78,216,0.18)" : undefined,
                    color: isSelected ? "#e0eaff" : undefined,
                  }}
                >
                  <span className="mc-option-label" style={{
                    background: isSelected ? "#1d4ed8" : undefined,
                    color: isSelected ? "#fff" : undefined,
                  }}>{opt.label}</span>
                  <span>{opt.text}</span>
                </button>
              );
            })}
          </div>
          {/* Single unified submit row — textarea for free-text, Submit works for both */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <textarea style={{ flex: 1, minHeight: 40 }}
              placeholder="Or type your own response…"
              value={input} onChange={e => { setInput(e.target.value); setSelectedOption(null); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRealSend(); } }} />
            <button className="btn btn-primary" disabled={(!selectedOption && !input.trim()) || loading || exerciseConcluded}
              onClick={selectedOption ? handleOptionSubmit : handleRealSend}
              style={{ alignSelf: "flex-end" }}>
              {loading ? <span className="spinner" /> : "Submit"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
            {selectedOption
              ? <span style={{ color: "#60a5fa" }}>Option {selectedOption.label} selected — click Submit to confirm</span>
              : "Select an option above, or type your own response"}
          </div>
          {/* Invisible sentinel at the true bottom of the options section for scroll targeting */}
          <div ref={optionsBottomRef} style={{ height: 1 }} />
        </div>
      ) : multiMode ? (
        <MultiRoleInputPanel
          participants={participants}
          loading={loading}
          onCancel={onToggleMultiMode}
          onSubmit={onMultiSend}
        />
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea style={{ flex: 1, minHeight: 56 }}
              placeholder={`Describe your team's next action… (${phase})`}
              value={input} onChange={e => setInput(e.target.value)}
              disabled={exerciseConcluded}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRealSend(); } }} />
            <button className="btn btn-primary" disabled={!input.trim() || loading || exerciseConcluded}
              onClick={handleRealSend} style={{ alignSelf: "flex-end" }}>
              {loading ? <span className="spinner" /> : "Submit"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "#2a4a6a" }}>
            {exerciseConcluded
              ? "This exercise has reached its conclusion — click \"Complete Exercise ✓\" above to view the After-Action Report."
              : <><span className="hotkey">Enter</span> to submit · <span className="hotkey">Shift+Enter</span> new line</>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Injects ───────────────────────────────────────────────────
function InjectPanel({ scenario, secondaryScenario, mysterySlot, showIncidentTags, onInject, companyProfile }) {
  // In Blended Incidents mode, pool BOTH scenarios' injects into one panel — each card
  // carries its source scenario so a tag can be shown (or withheld) per the facilitator's
  // Show Incident Tags preference, same gate the chat's thread chips use. If one slot is a
  // Mystery pick, its tag is masked to "🎲 Mystery" (never the real scenario name) even when
  // Show Incident Tags is on — the inject's own title/text still shows normally, matching the
  // existing precedent that this tab is a facilitator tool, not participant-visible narration.
  const primaryInjects = (INJECT_LIBRARY[scenario?.id] || []).map(inj => ({ ...interpolateInject(inj, companyProfile), source: scenario, sourceSlot: "A" }));
  const secondaryInjects = secondaryScenario
    ? (INJECT_LIBRARY[secondaryScenario.id] || []).map(inj => ({ ...interpolateInject(inj, companyProfile), source: secondaryScenario, sourceSlot: "B" }))
    : [];
  const injects = [...primaryInjects, ...secondaryInjects];
  const investigative = injects.filter(inj => inj.tier !== "confirmation");
  const confirmation = injects.filter(inj => inj.tier === "confirmation");
  const renderGroup = (label, hint, list) => list.length === 0 ? null : (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#5a7a9a", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: "#3a5a7a", marginBottom: 10 }}>{hint}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {list.map((inj, i) => (
          <div key={i} className="inject-item" style={{ borderLeft: `3px solid ${inj.color}` }}>
            <div className="inject-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span><span className="inject-badge" style={{ background: inj.color }} />{inj.title}</span>
              {secondaryScenario && showIncidentTags && (
                <span className="tag" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>
                  {inj.sourceSlot === mysterySlot ? "🎲 Mystery" : `${inj.source.icon} ${inj.source.name}`}
                </span>
              )}
            </div>
            <div className="inject-text">{inj.text}</div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => onInject(inj)}>⚡ Inject into Exercise</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="card">
      <div className="card-title">SCENARIO INJECTS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {renderGroup("🔍 INVESTIGATIVE", "Ambiguous leads — safe to use before the team has confirmed a cause.", investigative)}
        {renderGroup("✅ CONFIRMATION", "Root-cause / source specifics — hold until the team's investigation warrants revealing them.", confirmation)}
      </div>
    </div>
  );
}

function CustomInject({ onInject }) {
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  return (
    <div className="card">
      <div className="card-title">CUSTOM INJECT</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label>Inject Title</label><input type="text" placeholder="e.g. CEO Demands Status Update" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div><label>Description</label><textarea placeholder="Describe the complication to introduce…" value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 90 }} /></div>
        <button className="btn btn-primary btn-sm" disabled={!title.trim() || !text.trim()}
          onClick={() => { onInject({ title, text, color: "#ca8a04" }); setTitle(""); setText(""); }}>
          ⚡ Inject into Exercise
        </button>
      </div>
    </div>
  );
}

// ── After-Action Report ───────────────────────────────────────
function AARView({ session, timeline, messages, duration, onNewScenario }) {
  const [aarData, setAarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef();

  const fmt = s => s > 0
    ? `${Math.floor(s / 3600) > 0 ? Math.floor(s / 3600) + "h " : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`
    : "—";

  const responseCount = messages.reduce(
    (acc, m) => (m.role === "ai" || m.countsAsTurn === false) ? acc : acc + (m.multi ? m.authors.length : 1), 0
  );

  const generate = async () => {
    setLoading(true);
    setAarData(null);
    try {
      const log = messages.filter(m => m.role !== "ai").map(m =>
        m.multi
          ? m.authors.map(a => `${a.name || a.role} (${a.role}): ${a.text}`).join("\n")
          : `${m.author || m.role}${m.countsAsTurn === false ? " (facilitation request, not a decision)" : ""}: ${m.text}`
      ).join("\n");
      const blendContext = session.secondaryScenario
        ? `\n\nBLENDED INCIDENTS: This session blended two scenarios into one feed — "${session.scenario.name}" and "${session.secondaryScenario.name}". The ACTUAL ground truth, which participants were never told directly during the exercise, is that the two incidents were ${session.blendRelation === "coordinated" ? "part of ONE coordinated attack" : "NOT actually connected — any apparent overlap was coincidental"}. Now that the exercise is over, reveal this plainly in a new "blendReveal" field, and assess how well the team recognized (or was misled by) the relationship between the two threads, and how well they prioritized/triaged across both.`
        : "";
      const postExerciseContext = session.playbook.aarPhases?.length
        ? `\n\nPOST-EXERCISE FEEDBACK: The "${session.playbook.name}" playbook also includes phases that are not run live during the drill — ${session.playbook.aarPhases.join(", ")} — but should be assessed now as forward-looking feedback. Populate "postExerciseFeedback" with a "lessonsLearned" array (retrospective items the team should formally document and review) and a "preparation" array (concrete governance, identification, and protection improvements to make before the next real incident).`
        : "";
      // Gamified scoring instructions: kept separate from postExerciseContext so both can
      // co-exist. Deliberately weights the model toward the CONTENT of participant answers
      // (playbook adherence, decision quality) rather than whether they used the hint/options
      // facilitation aids — see FEATURES.md §9 "Score Card" for the rationale.
      // NOTE: overallScore is NOT requested here — it's computed deterministically by
      // computeOverallScore() from the 5 metric scores below, using SCORE_METRIC_WEIGHTS.
      // Claude is still told the exact same formula so its free-text "rank" title (which IS
      // generated in this call, alongside the metrics) lands on a tier consistent with what
      // the app will separately calculate.
      const weightPct = (name) => Math.round(SCORE_METRIC_WEIGHTS[name] * 100);
      // Requires each metric to be scored low, with a summary explaining why, whenever the
      // discussion log has no actions or statements relevant to that category.
      const scoringContext = `\n\nSCORING SYSTEM: Populate a "scoreCard" that gamifies performance without losing rigor. Score five metrics 0-100 — "Detection & Triage", "Containment & Eradication", "Communication & Escalation", "Playbook Adherence" (vs ${session.playbook.name}), and "Decision Quality Under Pressure". Base every score on the SUBSTANCE and correctness of the team's own decisions and answers in the discussion log — never on whether they asked for a hint or requested multiple-choice options; those are normal facilitation aids and must not lower a score just for being used. If the discussion log contains no actions, decisions, or statements relevant to a given metric, you MUST score that metric low (0-20), and its "summary" must plainly state that no relevant actions were taken or discussed — never award partial, average, or implied credit for competence that was never actually demonstrated. Do NOT include an "overallScore" field — the app computes that deterministically from your 5 metric scores using fixed weights: Playbook Adherence ${weightPct("Playbook Adherence")}%, Decision Quality Under Pressure ${weightPct("Decision Quality Under Pressure")}%, Detection & Triage ${weightPct("Detection & Triage")}%, Containment & Eradication ${weightPct("Containment & Eradication")}%, Communication & Escalation ${weightPct("Communication & Escalation")}%. Mentally apply that same weighted formula to the 5 scores you just assigned, and award a short, earned "rank" title matching the resulting tier (roughly: 90+ confident/expert-sounding, 75-89 solid, 55-74 developing, below 55 foundational — invent a title that fits THIS team's actual run rather than reusing a stock phrase every time), so your rank stays consistent with the score the app will calculate. Add one "scoringNote" sentence stating plainly the score reflects decision quality, not hint/option usage. Then, for every "playbookGaps" item, attach a "linkedMetric" naming exactly one of the five scoreCard metric names above, so each gap ties back to the score it affected.`;
      // Instructs the model to describe only what appears in the discussion log and to reuse
      // the given Duration figure exactly as provided, in the same units.
      const groundingContext = `\n\nGROUNDING RULES (must follow strictly): This report must describe ONLY what is actually present in the discussion log above — never invent, imply, or assume actions, decisions, or discussion that were not explicitly stated. If the log is empty, or a phase/category has no corresponding entries, say so plainly (e.g. "No containment actions were discussed or taken during this session") instead of describing hypothetical, typical, or "realistic template" behavior. Use the Duration value given above EXACTLY as written — same figure, same units — anywhere duration is mentioned (e.g. the executive summary); do not round it, convert it, or restate it differently. Log entries marked "(facilitation request, not a decision)" are the team asking for a hint or for multiple-choice options — these are NOT team responses, actions, or decisions: never count them toward, or describe them as, the number of responses/actions the team took. When describing a decision made by selecting a lettered option, describe the substance of what was chosen, not its letter (e.g. describe the action itself rather than writing "selected option B"). If the exercise was ended early with minimal or no discussion, state that plainly and briefly (e.g. "The exercise was ended early after minimal discussion.") rather than elaborating at length on the sparse content available.`;
      // Targets a specific failure mode where "wentWell" filled empty slots with meta/
      // procedural facts about the exercise's own setup or wrap-up (e.g. "the exercise was
      // successfully launched," "a report was generated") rather than genuine team actions —
      // padding that reads as content but isn't feedback on anything the team actually did.
      const wentWellContext = `\n\nWENT-WELL RULES: The "wentWell" array may ONLY contain things the team themselves did or decided well during the exercise — real actions, decisions, or communications drawn from the discussion log. Never include administrative, procedural, or app-driven facts about the exercise itself (e.g. that a scenario/playbook was selected, that the session was launched, that a blended or mystery scenario was "prepared," or that the exercise was formally closed and a report generated) — none of that is something the team did. If the discussion log has too little team activity to support any genuine item, return an empty array rather than filling it with unrelated or procedural filler.`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 4000,
          // Instructs the model to stay strictly factual and grounded in the provided data.
          system: `You are a cybersecurity tabletop exercise facilitator writing a professional After-Action Report. Be strictly factual and grounded in the discussion log provided — never fabricate, embellish, or imply actions, decisions, or outcomes that did not actually occur, and never restate a given figure (such as Duration) in different units or rounded form. Respond ONLY with a single valid JSON object — no markdown code fences, no commentary before or after, no trailing text. The entire response must be parseable by JSON.parse().`,
          messages: [{ role: "user", content: `Generate an AAR for this tabletop exercise.

Scenario: ${scenarioLabel(session)}
Playbook: ${session.playbook.name}
Duration: ${fmt(duration)}
Participants: ${session.participants.map(p => `${p.name || p.role} (${p.role})`).join(", ")}
Facilitator tone: ${session.facilitatorConfig.tone}, difficulty: ${session.facilitatorConfig.difficulty}
Discussion log: ${log || "(No discussion was captured. No participant actions, decisions, or messages were recorded during this session — the report must state this plainly rather than inventing a plausible-sounding run.)"}${blendContext}${postExerciseContext}${groundingContext}${wentWellContext}${scoringContext}

Return this exact JSON shape with no other text:
{
  "executiveSummary": "3-4 sentence paragraph summarizing the exercise and key outcomes; if engagement was minimal or the exercise ended early, keep this to 1-2 plain sentences stating that instead of elaborating",
  "scoreCard": {
    "rank": "short earned title reflecting this run",
    "metrics": [
      {"name": "Detection & Triage", "score": 80, "summary": "1 sentence grounded in the team's actual answers"},
      {"name": "Containment & Eradication", "score": 80, "summary": "1 sentence"},
      {"name": "Communication & Escalation", "score": 80, "summary": "1 sentence"},
      {"name": "Playbook Adherence", "score": 80, "summary": "1 sentence"},
      {"name": "Decision Quality Under Pressure", "score": 80, "summary": "1 sentence"}
    ],
    "scoringNote": "1 sentence noting this reflects decision quality, not hint/option usage"
  },
  "wentWell": ["specific item — or an empty array if nothing genuine qualifies"],
  "improvements": ["specific item", "specific item", "specific item"],
  "playbookGaps": [
    {"gap": "specific gap vs ${session.playbook.name}", "linkedMetric": "one of the 5 scoreCard metric names above"},
    {"gap": "specific gap", "linkedMetric": "..."},
    {"gap": "specific gap", "linkedMetric": "..."}
  ],
  "actionItems": [
    {"id": 1, "action": "specific action", "owner": "Role Title", "priority": "High"},
    {"id": 2, "action": "specific action", "owner": "Role Title", "priority": "Medium"},
    {"id": 3, "action": "specific action", "owner": "Role Title", "priority": "Low"}
  ],
  "nextSteps": ["specific step", "specific step", "specific step"]${session.secondaryScenario ? `,
  "blendReveal": {"relation": "${session.blendRelation}", "explanation": "2-3 sentence plain-language reveal of how the two incidents were/weren't connected, and how well the team's own investigation tracked with reality"}` : ""}${session.playbook.aarPhases?.length ? `,
  "postExerciseFeedback": {"lessonsLearned": ["specific lesson", "specific lesson"], "preparation": ["specific preparation item", "specific preparation item", "specific preparation item"]}` : ""}
}` }]
        })
      });
      const data = await resp.json();

      // Check for API-level errors (auth, rate limit, etc.)
      if (data.error) {
        setAarData({ error: true, detail: data.error.message || "API error" });
        setLoading(false);
        return;
      }

      const raw = (data.content?.find(b => b.type === "text")?.text || "").trim();

      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        // Deterministic scoring: overallScore is never trusted from the model — it's always
        // (re)computed here from parsed.scoreCard.metrics via SCORE_METRIC_WEIGHTS, so the
        // same 5 metric scores always produce the exact same overall number, and any stray
        // "overallScore" the model included anyway is overwritten rather than used.
        if (parsed?.scoreCard?.metrics) {
          parsed.scoreCard.overallScore = computeOverallScore(parsed.scoreCard.metrics) ?? 0;
        }
        setAarData(parsed);
      } catch (parseErr) {
        // JSON parse failed — show the raw response so the user can see what came back
        setAarData({ error: true, detail: `JSON parse failed. Raw response: ${raw.slice(0, 300)}` });
      }
    } catch (networkErr) {
      setAarData({ error: true, detail: `Network error: ${networkErr.message}` });
    }
    setLoading(false);
  };

  // Auto-generate the report as soon as the AAR view loads — no user action required.
  useEffect(() => {
    generate();
  }, []);

  const handlePrint = () => {
    // Build a self-contained HTML page for the report and open it in a new tab.
    // window.print() is blocked inside the sandboxed artifact iframe, so we
    // export the content as a standalone document the browser can print freely.
    const participantRows = session.participants
      .map(p => `<span class="chip">${p.name || p.role}${p.name ? ` <span class="chip-role">${p.role}</span>` : ""}</span>`)
      .join("");

    const listItems = (arr, icon, color) =>
      (arr || []).map(item => `<div class="list-item" style="border-left-color:${color}"><span class="list-icon" style="color:${color}">${icon}</span>${item}</div>`).join("");

    // Playbook Gaps now arrive as { gap, linkedMetric } objects (tying each gap back to the
    // Score Card metric it dragged down) rather than plain strings — falls back to treating
    // the item as a string if an older-shaped aarData is ever encountered.
    const scoreColor = (n) => n >= 80 ? "#16a34a" : n >= 60 ? "#ca8a04" : "#dc2626";
    const gapItems = (arr) =>
      (arr || []).map(item => {
        const text = typeof item === "string" ? item : (item.gap || "");
        const metric = typeof item === "object" ? item.linkedMetric : null;
        return `<div class="list-item" style="border-left-color:#dc2626"><span class="list-icon" style="color:#dc2626">⚠</span><span>${text}${metric ? ` <span class="gap-tag">↳ ${metric}</span>` : ""}</span></div>`;
      }).join("");
    const scoreMetricRows = (aarData?.scoreCard?.metrics || []).map(m => `
      <div class="score-row">
        <div class="score-row-top"><span class="score-row-name">${m.name}</span><span class="score-row-num" style="color:${scoreColor(m.score)}">${m.score}</span></div>
        <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.max(0, Math.min(100, m.score))}%;background:${scoreColor(m.score)}"></div></div>
        <div class="score-row-summary">${m.summary || ""}</div>
      </div>`).join("");

    const actionRows = (aarData?.actionItems || []).map(item =>
      `<div class="action-row">
        <span class="action-id">${String(item.id || "").padStart(2,"0")}</span>
        <div class="action-body">
          <div class="action-text">${item.action}</div>
          <div class="action-owner">Owner: ${item.owner}</div>
        </div>
        <span class="priority priority-${(item.priority||"").toLowerCase()}">${item.priority}</span>
      </div>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AAR — ${scenarioLabel(session)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32pt 40pt; }
    h1 { font-size: 20pt; font-weight: 700; color: #0f172a; margin-bottom: 4pt; }
    .sub { font-size: 10pt; color: #475569; margin-bottom: 20pt; }
    .metrics { display: flex; gap: 12pt; margin-bottom: 20pt; }
    .metric { flex: 1; border: 1px solid #e2e8f0; border-radius: 6pt; padding: 12pt; text-align: center; }
    .metric-value { font-size: 22pt; font-weight: 700; color: #1e40af; }
    .metric-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-top: 3pt; }
    .section { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 16pt; margin-bottom: 14pt; page-break-inside: avoid; }
    .section-title { font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6pt; margin-bottom: 12pt; }
    .summary { font-size: 11pt; color: #1e293b; line-height: 1.7; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin-bottom: 14pt; }
    .list-item { display: flex; gap: 8pt; align-items: flex-start; padding: 7pt 10pt; border-radius: 4pt; border: 1px solid #e2e8f0; border-left-width: 3px; background: #f8fafc; margin-bottom: 6pt; font-size: 10pt; line-height: 1.5; color: #1e293b; }
    .list-icon { flex-shrink: 0; margin-top: 1pt; font-style: normal; }
    .action-row { display: flex; align-items: center; gap: 10pt; padding: 9pt 12pt; border: 1px solid #e2e8f0; border-radius: 4pt; background: #f8fafc; margin-bottom: 6pt; }
    .action-id { font-weight: 700; font-size: 9pt; color: #94a3b8; width: 24pt; flex-shrink: 0; }
    .action-body { flex: 1; }
    .action-text { font-size: 10pt; color: #1e293b; line-height: 1.4; }
    .action-owner { font-size: 8.5pt; color: #64748b; margin-top: 2pt; }
    .priority { font-size: 8pt; font-weight: 700; padding: 2pt 7pt; border-radius: 3pt; flex-shrink: 0; }
    .priority-high { background: #fee2e2; color: #dc2626; }
    .priority-medium { background: #fef9c3; color: #ca8a04; }
    .priority-low { background: #dcfce7; color: #16a34a; }
    .chip { display: inline-flex; align-items: center; gap: 5pt; padding: 3pt 10pt; border: 1px solid #e2e8f0; border-radius: 4pt; font-size: 9.5pt; background: #f8fafc; margin: 3pt; }
    .chip-role { color: #94a3b8; font-size: 8.5pt; }
    .chips { margin-top: 8pt; }
    .score-head { display: flex; align-items: center; gap: 16pt; margin-bottom: 14pt; }
    .score-ring { width: 52pt; height: 52pt; border-radius: 50%; border: 4pt solid #1e40af; display: flex; align-items: center; justify-content: center; font-size: 16pt; font-weight: 700; color: #1e40af; flex-shrink: 0; }
    .score-rank-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 3pt; }
    .score-rank { display: inline-block; padding: 3pt 10pt; border-radius: 10pt; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; font-size: 11pt; font-weight: 700; }
    .score-row { margin-bottom: 10pt; }
    .score-row-top { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 3pt; }
    .score-row-name { font-weight: 600; color: #1e293b; }
    .score-row-num { font-weight: 700; }
    .score-bar-track { height: 6pt; border-radius: 3pt; background: #e2e8f0; overflow: hidden; margin-bottom: 3pt; }
    .score-bar-fill { height: 100%; border-radius: 3pt; }
    .score-row-summary { font-size: 9pt; color: #475569; line-height: 1.4; }
    .score-note { margin-top: 10pt; padding-top: 8pt; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #64748b; font-style: italic; }
    .gap-tag { display: inline-block; font-size: 8pt; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3pt; padding: 1pt 6pt; margin-left: 4pt; }
    @media print {
      body { padding: 12pt 16pt; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#1e40af;color:#fff;padding:10pt 16pt;border-radius:6pt;margin-bottom:20pt;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:11pt;font-weight:600;">After-Action Report — ready to print</span>
    <button onclick="window.print()" style="background:#fff;color:#1e40af;border:none;padding:6pt 16pt;border-radius:4pt;font-size:10pt;font-weight:600;cursor:pointer;">🖨 Print / Save as PDF</button>
  </div>
  <h1>After-Action Report</h1>
  <div class="sub">${scenarioIcons(session)} ${scenarioLabel(session)} &nbsp;·&nbsp; ${session.playbook.name} &nbsp;·&nbsp; ${session.sessionName}</div>

  <div class="metrics">
    <div class="metric"><div class="metric-value">${session.participants.length}</div><div class="metric-label">Participants</div></div>
    <div class="metric"><div class="metric-value">${fmt(duration)}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value">${responseCount}</div><div class="metric-label">Responses</div></div>
  </div>

  <div class="section">
    <div class="section-title">Participants</div>
    <div class="chips">${participantRows}</div>
  </div>

  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="summary">${aarData?.executiveSummary || ""}</div>
  </div>

  ${aarData?.scoreCard ? `
  <div class="section">
    <div class="section-title">🎮 Score Card</div>
    <div class="score-head">
      <div class="score-ring">${aarData.scoreCard.overallScore}</div>
      <div>
        <div class="score-rank-label">Earned Rank</div>
        <div class="score-rank">🏅 ${aarData.scoreCard.rank || ""}</div>
      </div>
    </div>
    ${scoreMetricRows}
    ${aarData.scoreCard.scoringNote ? `<div class="score-note">ℹ ${aarData.scoreCard.scoringNote}</div>` : ""}
  </div>` : ""}

  ${aarData?.blendReveal ? `
  <div class="section" style="border-color:#c4b5fd;background:#faf5ff;">
    <div class="section-title" style="color:#7c3aed;">🧬 Blend Reveal — ${aarData.blendReveal.relation === "coordinated" ? "Coordinated Attack" : "Coincidental Overlap"}</div>
    <div class="summary">${aarData.blendReveal.explanation || ""}</div>
  </div>` : ""}

  <div class="two-col">
    <div class="section">
      <div class="section-title" style="color:#15803d;">✓ What Went Well</div>
      ${listItems(aarData?.wentWell, "✓", "#15803d")}
    </div>
    <div class="section">
      <div class="section-title" style="color:#c2410c;">△ Areas for Improvement</div>
      ${listItems(aarData?.improvements, "△", "#c2410c")}
    </div>
  </div>

  <div class="section">
    <div class="section-title" style="color:#b91c1c;">⚠ Playbook Gaps — ${session.playbook.name}</div>
    ${gapItems(aarData?.playbookGaps)}
  </div>

  ${aarData?.postExerciseFeedback ? `
  <div class="section" style="border-color:#c4b5fd;">
    <div class="section-title" style="color:#7c3aed;">◈ Lessons Learned &amp; Preparation — Not Run During the Exercise</div>
    <div class="two-col">
      <div>
        <div style="font-size:8pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c3aed;margin-bottom:6pt;">Lessons Learned</div>
        ${listItems(aarData.postExerciseFeedback.lessonsLearned, "◈", "#7c3aed")}
      </div>
      <div>
        <div style="font-size:8pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c3aed;margin-bottom:6pt;">Preparation</div>
        ${listItems(aarData.postExerciseFeedback.preparation, "◈", "#7c3aed")}
      </div>
    </div>
  </div>` : ""}

  <div class="section">
    <div class="section-title">Recommended Action Items</div>
    ${actionRows}
  </div>

  <div class="section">
    <div class="section-title" style="color:#1d4ed8;">Next Steps</div>
    ${(aarData?.nextSteps || []).map((s, i) => `<div class="list-item" style="border-left-color:#1d4ed8"><span class="action-id">${String(i+1).padStart(2,"0")}</span>${s}</div>`).join("")}
  </div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  const priorityColor = { High: "#f87171", Medium: "#fbbf24", Low: "#4ade80" };
  const scoreColor = (n) => n >= 80 ? "#4ade80" : n >= 60 ? "#fbbf24" : "#f87171";

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .topbar { display: none !important; }
          body { background: #fff !important; color: #111 !important; font-size: 12pt; }
          .aar-print-root { padding: 0 !important; max-width: 100% !important; }
          .aar-card { background: #fff !important; border: 1px solid #ccc !important; border-radius: 4px; page-break-inside: avoid; margin-bottom: 14pt; }
          .aar-card-title { color: #333 !important; border-bottom: 1px solid #ccc; padding-bottom: 6pt; margin-bottom: 10pt; }
          .aar-summary { color: #222 !important; }
          .aar-list-item { color: #222 !important; border-color: #ddd !important; background: #f9f9f9 !important; }
          .aar-action-row { border-color: #ddd !important; background: #f5f5f5 !important; }
          .aar-action-text { color: #111 !important; }
          .aar-action-owner { color: #444 !important; }
          .aar-priority { border: 1px solid #aaa !important; color: #333 !important; background: #eee !important; }
          .aar-metric-box { border: 1px solid #ccc !important; background: #f5f5f5 !important; }
          .aar-metric-value { color: #111 !important; }
          .aar-metric-label { color: #555 !important; }
          .aar-header-title { color: #111 !important; }
          .aar-header-sub { color: #555 !important; }
        }
      `}</style>

      <div className="main aar-print-root" style={{ paddingBottom: 60, maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
          <div>
            <div className="aar-header-title" style={{ fontSize: 22, fontWeight: 700, color: "#e0eaff", marginBottom: 4 }}>
              After-Action Report
            </div>
            <div className="aar-header-sub" style={{ fontSize: 13, color: "#4a6a8a" }}>
              {scenarioIcons(session)} {scenarioLabel(session)} &nbsp;·&nbsp; {session.playbook.name} &nbsp;·&nbsp; {session.sessionName}
            </div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={handlePrint} title="Print or save as PDF">🖨 Print / PDF</button>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid-3 gap-4" style={{ marginBottom: 24 }}>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{session.participants.length}</div>
            <div className="metric-label aar-metric-label">Participants</div>
          </div>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{fmt(duration)}</div>
            <div className="metric-label aar-metric-label">Duration</div>
          </div>
          <div className="metric-box aar-metric-box">
            <div className="metric-value aar-metric-value">{responseCount}</div>
            <div className="metric-label aar-metric-label">Responses</div>
          </div>
        </div>

        {/* Participant list for print */}
        <div className="aar-card card" style={{ marginBottom: 20 }}>
          <div className="aar-card-title card-title">PARTICIPANTS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {session.participants.map((p, i) => (
              <div key={i} style={{
                padding: "5px 12px", borderRadius: 4,
                background: "#0a1520", border: "1px solid #1a2a3a",
                fontSize: 12,
              }}>
                <span style={{ color: "#c9d4e0", fontWeight: 500 }}>{p.name || p.role}</span>
                {p.name && <span style={{ color: "#3a5a7a", marginLeft: 6, fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>{p.role}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Skeleton loading state */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Status message — placed at the top of the loading state so participants see it
                immediately without needing to scroll past the skeleton cards below. */}
            <div style={{ textAlign: "center", padding: "8px 0 16px", fontSize: 12, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace" }}>
              <span className="spinner" style={{ verticalAlign: "middle", marginRight: 8 }} />
              Claude is analysing your session and writing the report…
            </div>
            {/* Executive Summary skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-full" />
              <div className="skeleton skeleton-line skeleton-line-med" />
            </div>
            {/* Score Card skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              <div style={{ display: "flex", gap: 16, marginBottom: 14, alignItems: "center" }}>
                <div className="skeleton" style={{ width: 74, height: 74, borderRadius: "50%" }} />
                <div className="skeleton skeleton-block" style={{ width: 140, height: 26 }} />
              </div>
              {[100, 90, 95, 85, 80].map((w, i) => (
                <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%`, height: 10 }} />
              ))}
            </div>
            {/* Went Well / Improvements skeleton */}
            <div className="grid-2 gap-4">
              {[0, 1].map(col => (
                <div key={col} className="card">
                  <div className="skeleton skeleton-title" />
                  {[85, 100, 70].map((w, i) => (
                    <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ))}
            </div>
            {/* Playbook Gaps skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[100, 90, 80].map((w, i) => (
                <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%` }} />
              ))}
            </div>
            {/* Lessons Learned & Preparation skeleton — only for playbooks with AAR-only phases */}
            {session.playbook.aarPhases?.length > 0 && (
              <div className="grid-2 gap-4">
                {[0, 1].map(col => (
                  <div key={col} className="card">
                    <div className="skeleton skeleton-title" />
                    {[90, 75].map((w, i) => (
                      <div key={i} className="skeleton skeleton-block" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Action Items skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[0, 1, 2].map(i => (
                <div key={i} className="skeleton skeleton-block" style={{ marginBottom: 8 }} />
              ))}
            </div>
            {/* Next Steps skeleton */}
            <div className="card">
              <div className="skeleton skeleton-title" />
              {[100, 85, 75].map((w, i) => (
                <div key={i} className="skeleton skeleton-line" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {aarData?.error && (
          <div className="card" style={{ borderColor: "rgba(220,38,38,0.3)", padding: 24 }}>
            <div style={{ color: "#f87171", fontWeight: 600, marginBottom: 8 }}>Failed to generate report</div>
            {aarData.detail && (
              <div style={{ fontSize: 12, color: "#5a7a9a", fontFamily: "'Share Tech Mono', monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {aarData.detail}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={generate}>↺ Try Again</button>
          </div>
        )}

        {/* Rendered AAR sections */}
        {aarData && !aarData.error && (
          <div ref={printRef} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Executive Summary */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">EXECUTIVE SUMMARY</div>
              <div className="aar-summary" style={{ fontSize: 14, color: "#c0d4ea", lineHeight: 1.8 }}>
                {aarData.executiveSummary}
              </div>
            </div>

            {/* Score Card — gamified performance summary. Deliberately placed right after the
                Executive Summary (the headline result) and BEFORE Went Well/Improvements, since
                this plays a key role in the AAR per FEATURES.md §9. Each score is meant to be
                grounded in the substance of the team's own decisions, not hint/option usage —
                see scoringNote below and the linkedMetric tags on Playbook Gaps further down. */}
            {aarData.scoreCard && (
              <div className="aar-card card" style={{ border: "1px solid rgba(96,165,250,0.3)", background: "rgba(29,78,216,0.05)" }}>
                <div className="aar-card-title card-title" style={{ color: "#60a5fa" }}>🎮 SCORE CARD</div>
                <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 18, flexWrap: "wrap" }}>
                  <div style={{
                    width: 74, height: 74, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: `4px solid ${scoreColor(aarData.scoreCard.overallScore)}`,
                    fontFamily: "'Share Tech Mono', monospace", fontSize: 22, fontWeight: 700,
                    color: scoreColor(aarData.scoreCard.overallScore),
                  }}>{aarData.scoreCard.overallScore}</div>
                  <div>
                    <div style={{ fontSize: 10, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", letterSpacing: ".08em", marginBottom: 4 }}>EARNED RANK</div>
                    <div style={{
                      display: "inline-block", padding: "4px 14px", borderRadius: 20,
                      background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)",
                      color: "#93c5fd", fontSize: 15, fontWeight: 700,
                    }}>🏅 {aarData.scoreCard.rank}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(aarData.scoreCard.metrics || []).map((m, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: "#c9d4e0", fontWeight: 600 }}>{m.name}</span>
                        <span style={{ color: scoreColor(m.score), fontFamily: "'Share Tech Mono', monospace", fontWeight: 700 }}>{m.score}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 4, background: "#0a1520", overflow: "hidden", marginBottom: 4 }}>
                        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, m.score))}%`, background: scoreColor(m.score), borderRadius: 4, transition: "width 0.6s ease" }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#8aa5c0", lineHeight: 1.5 }}>{m.summary}</div>
                    </div>
                  ))}
                </div>
                {aarData.scoreCard.scoringNote && (
                  <div style={{ marginTop: 14, fontSize: 11, color: "#3a5a7a", fontStyle: "italic", borderTop: "1px solid #1a2a3a", paddingTop: 10 }}>
                    ℹ {aarData.scoreCard.scoringNote}
                  </div>
                )}
              </div>
            )}

            {/* Blend Reveal — Blended Incidents sessions only. This is the moment the
                coordinated-vs-coincidental ground truth (never told to the team mid-exercise)
                finally gets surfaced, alongside how well their own investigation tracked it. */}
            {aarData.blendReveal && (
              <div className="aar-card card" style={{ border: "1px solid rgba(167,139,250,0.35)", background: "rgba(124,58,237,0.06)" }}>
                <div className="aar-card-title card-title" style={{ color: "#a78bfa" }}>
                  🧬 BLEND REVEAL — {aarData.blendReveal.relation === "coordinated" ? "COORDINATED ATTACK" : "COINCIDENTAL OVERLAP"}
                </div>
                <div style={{ fontSize: 14, color: "#c0d4ea", lineHeight: 1.8 }}>
                  {aarData.blendReveal.explanation}
                </div>
              </div>
            )}

            {/* What Went Well + Areas for Improvement side by side */}
            <div className="grid-2 gap-4">
              <div className="aar-card card">
                <div className="aar-card-title card-title" style={{ color: "#22c55e" }}>✓ WHAT WENT WELL</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {aarData.wentWell?.length ? aarData.wentWell.map((item, i) => (
                    <div key={i} className="aar-list-item" style={{
                      padding: "8px 12px", borderRadius: 5,
                      background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.2)",
                      fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                      display: "flex", gap: 8, alignItems: "flex-start"
                    }}>
                      <span style={{ color: "#22c55e", flexShrink: 0, marginTop: 1 }}>✓</span>
                      <span>{item}</span>
                    </div>
                  )) : (
                    <div style={{ fontSize: 13, color: "#4a6a8a", fontStyle: "italic" }}>
                      No specific team actions to highlight for this session.
                    </div>
                  )}
                </div>
              </div>
              <div className="aar-card card">
                <div className="aar-card-title card-title" style={{ color: "#fb923c" }}>△ AREAS FOR IMPROVEMENT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(aarData.improvements || []).map((item, i) => (
                    <div key={i} className="aar-list-item" style={{
                      padding: "8px 12px", borderRadius: 5,
                      background: "rgba(234,88,12,0.06)", border: "1px solid rgba(234,88,12,0.2)",
                      fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                      display: "flex", gap: 8, alignItems: "flex-start"
                    }}>
                      <span style={{ color: "#fb923c", flexShrink: 0, marginTop: 1 }}>△</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Playbook Gaps */}
            <div className="aar-card card">
              <div className="aar-card-title card-title" style={{ color: "#f87171" }}>⚠ PLAYBOOK GAPS — {session.playbook.name.toUpperCase()}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(aarData.playbookGaps || []).map((item, i) => {
                  // playbookGaps items are now { gap, linkedMetric } objects tying each gap
                  // back to the Score Card metric it dragged down — fall back to treating the
                  // item as a plain string if an older-shaped aarData is ever encountered.
                  const gapText = typeof item === "string" ? item : item.gap;
                  const linkedMetric = typeof item === "object" ? item.linkedMetric : null;
                  return (
                    <div key={i} className="aar-list-item" style={{
                      padding: "8px 12px", borderRadius: 5,
                      background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.2)",
                      fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                      display: "flex", gap: 8, alignItems: "flex-start"
                    }}>
                      <span style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }}>⚠</span>
                      <span>
                        {gapText}
                        {linkedMetric && (
                          <span style={{
                            marginLeft: 8, fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                            color: "#60a5fa", background: "rgba(96,165,250,0.12)",
                            border: "1px solid rgba(96,165,250,0.3)", borderRadius: 4, padding: "1px 6px",
                            whiteSpace: "nowrap",
                          }}>↳ {linkedMetric}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Post-Exercise Feedback — Lessons Learned & Preparation (phases not run live during the exercise) */}
            {aarData.postExerciseFeedback && (
              <div className="aar-card card">
                <div className="aar-card-title card-title" style={{ color: "#a78bfa" }}>◈ LESSONS LEARNED & PREPARATION — NOT RUN DURING THE EXERCISE</div>
                <div className="grid-2 gap-4">
                  <div>
                    <div style={{ fontSize: 11, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>Lessons Learned</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(aarData.postExerciseFeedback.lessonsLearned || []).map((item, i) => (
                        <div key={i} style={{
                          padding: "8px 12px", borderRadius: 5,
                          background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)",
                          fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                        }}>{item}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#3a5a7a", fontFamily: "'Share Tech Mono', monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>Preparation</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(aarData.postExerciseFeedback.preparation || []).map((item, i) => (
                        <div key={i} style={{
                          padding: "8px 12px", borderRadius: 5,
                          background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)",
                          fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                        }}>{item}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Items */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">RECOMMENDED ACTION ITEMS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(aarData.actionItems || []).map((item, i) => (
                  <div key={i} className="aar-action-row" style={{
                    display: "grid", gridTemplateColumns: "28px 1fr auto auto",
                    alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 5,
                    background: "#0a1520", border: "1px solid #1a2a3a",
                  }}>
                    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: "#3a5a7a", fontWeight: 600 }}>
                      {String(item.id || i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <div className="aar-action-text" style={{ fontSize: 13, color: "#c9d4e0", lineHeight: 1.5 }}>{item.action}</div>
                      <div className="aar-action-owner" style={{ fontSize: 11, color: "#3a5a7a", marginTop: 2, fontFamily: "'Share Tech Mono', monospace" }}>Owner: {item.owner}</div>
                    </div>
                    <div className="aar-priority" style={{
                      fontSize: 10, fontFamily: "'Share Tech Mono', monospace",
                      padding: "2px 8px", borderRadius: 3,
                      color: priorityColor[item.priority] || "#c9d4e0",
                      border: `1px solid ${priorityColor[item.priority] || "#1a2a3a"}20`,
                      background: `${priorityColor[item.priority] || "#1a2a3a"}12`,
                      whiteSpace: "nowrap",
                    }}>{item.priority}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next Steps */}
            <div className="aar-card card">
              <div className="aar-card-title card-title">NEXT STEPS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(aarData.nextSteps || []).map((step, i) => (
                  <div key={i} className="aar-list-item" style={{
                    padding: "8px 12px", borderRadius: 5,
                    background: "rgba(29,78,216,0.06)", border: "1px solid rgba(29,78,216,0.2)",
                    fontSize: 13, color: "#b0c4da", lineHeight: 1.55,
                    display: "flex", gap: 8, alignItems: "flex-start"
                  }}>
                    <span style={{ color: "#60a5fa", flexShrink: 0, fontFamily: "'Share Tech Mono', monospace", fontSize: 11, marginTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* New scenario CTA */}
        <div className="no-print" style={{
          marginTop: 32, padding: "24px 28px",
          background: "rgba(29,78,216,0.06)", border: "1px solid rgba(29,78,216,0.2)",
          borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#c9d4e0", marginBottom: 3 }}>Ready for another round?</div>
            <div style={{ fontSize: 12, color: "#3a5a7a" }}>Start a new scenario with the same or a different team configuration.</div>
          </div>
          <button className="btn btn-primary" onClick={onNewScenario} style={{ flexShrink: 0 }}>
            ↺ New Scenario
          </button>
        </div>
      </div>
    </>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────
function ConfirmModal({ icon, title, body, confirmLabel, confirmStyle, cancelLabel = "Keep Going", onConfirm, onCancel }) {
  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onCancel(); };
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal">
        {icon && <div className="modal-icon">{icon}</div>}
        <div className="modal-title">{title}</div>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            className="btn"
            style={confirmStyle}
            onClick={onConfirm}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Varied closing lines for inject messages, keyed by urgency color
const INJECT_CLOSINGS = {
  critical: [
    "Clock is ticking — how does your team respond?",
    "This changes everything. What's your immediate action?",
    "The situation is escalating. What does your team do?",
    "Every second counts. How does your team react?",
  ],
  high: [
    "How does your team handle this development?",
    "This requires an immediate decision. What's your next move?",
    "Your team needs to act. What's the call?",
    "A decision is needed now. How do you proceed?",
  ],
  medium: [
    "How does this affect your team's current plan?",
    "What adjustments does your team need to make?",
    "How do you incorporate this into your response?",
    "How does your team account for this?",
  ],
};

const getInjectClosing = (color) => {
  const isRed    = color === "#dc2626";
  const isOrange = color === "#ea580c";
  const pool = isRed ? INJECT_CLOSINGS.critical
    : isOrange ? INJECT_CLOSINGS.high
    : INJECT_CLOSINGS.medium;
  return pool[Math.floor(Math.random() * pool.length)];
};
// Human-facing scenario label — combines primary + secondary scenario name/icon when a
// session is Blended, otherwise just returns the single scenario's own name/icon. Used
// anywhere the UI displays "the scenario" to a person (AAR header, exercise header, print
// view) so blended sessions don't silently show only half the incident.
const scenarioLabel = (session) => session.secondaryScenario
  ? `${session.scenario.name} + ${session.secondaryScenario.name}`
  : session.scenario.name;
const scenarioIcons = (session) => session.secondaryScenario
  ? `${session.scenario.icon}${session.secondaryScenario.icon}`
  : session.scenario.icon;

// Participant-facing scenario label for use DURING the live exercise (e.g. Timeline tab
// entries) — unlike scenarioLabel (used post-exercise in the AAR, where the identity is
// deliberately revealed), this respects the same Mystery masking already applied to the
// chat header and inject tags: a solo Mystery Scenario pick is fully masked, and in a
// Blended session, only whichever slot is the Mystery pick (mysterySlot) is masked while
// the other scenario's real name still shows normally.
const liveScenarioLabel = (session) => session.usedRandomizer && !session.secondaryScenario
  ? "Mystery Scenario"
  : session.secondaryScenario
  ? `${session.mysterySlot === "A" ? "Mystery Scenario" : session.scenario.name} + ${session.mysterySlot === "B" ? "Mystery Scenario" : session.secondaryScenario.name}`
  : session.scenario.name;

const storageKey = (session) =>
  `tactician:${session.sessionName}:${session.scenario.id}${session.secondaryScenario ? `+${session.secondaryScenario.id}` : ""}`.replace(/\s+/g, "_").slice(0, 120);

// Remove every other saved-in-progress session key, keeping only (optionally) the one
// belonging to a just-launched session. Called at the moment a new exercise actually
// launches — not when a resume prompt is merely declined — so a declined/abandoned
// session remains resumable until the person commits to a genuinely new exercise.
const clearOtherSessions = (keepKey = null) => {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith("tactician:") && k !== LAST_PLAYED_KEY && k !== keepKey)
      .forEach(k => localStorage.removeItem(k));
  } catch { /* silent */ }
};

const LAST_PLAYED_KEY = "tactician:lastPlayed";

const lastPlayedStorage = {
  save(scenario, playbook, sessionName) {
    try {
      localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioIcon: scenario.icon,
        scenarioSeverity: scenario.severity,
        playbookName: playbook.name,
        sessionName,
        completedAt: new Date().toISOString(),
      }));
    } catch { /* silent */ }
  },
  load() {
    try {
      const raw = localStorage.getItem(LAST_PLAYED_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
};

// ── localStorage chat persistence hook ───────────────────────
function useChatStorage(session) {
  const key = storageKey(session);

  const load = () => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw); // { messages, timeline, phaseIdx, scenarioElapsedSec, savedAt }
    } catch { return null; }
  };

  // `liveFacilitatorConfig` is passed in separately from `session` because the mid-exercise
  // Settings tab edits facilitatorConfig via its OWN React state in ExerciseView, not via
  // the `session` object (which is the immutable prop captured at setup/resume time and
  // never changes again). `companyProfile` is immutable for the life of a session (no
  // mid-exercise edit path exists for it), so it's read from `session` directly.
  //
  // `scenarioElapsedSec` is a plain duration — the exact elapsed seconds at save time — that
  // only accrues while the exercise view is mounted, so resuming freezes the clock while away
  // rather than continuing to drain it in the background. Turn counts and per-phase time
  // countdowns are not persisted; `phaseIdx` alone captures where the AI last placed the
  // exercise, since phase advancement is AI-driven.
  const save = (messages, timeline, phaseIdx, session, scenarioElapsedSec, liveFacilitatorConfig) => {
    try {
      localStorage.setItem(key, JSON.stringify({
        messages, timeline, phaseIdx, scenarioElapsedSec,
        // Persist enough session metadata to reconstruct on resume
        sessionName: session?.sessionName,
        playbook: session?.playbook,
        participants: session?.participants,
        facilitatorConfig: liveFacilitatorConfig || session?.facilitatorConfig,
        companyProfile: session?.companyProfile,
        usedRandomizer: session?.usedRandomizer,
        mysteryOpenerIndex: session?.mysteryOpenerIndex,
        secondaryScenario: session?.secondaryScenario,
        blendRelation: session?.blendRelation,
        mysterySlot: session?.mysterySlot,
        savedAt: new Date().toISOString(),
      }));
    } catch (e) {
      // Quota exceeded — prune oldest messages and retry once
      if (e.name === "QuotaExceededError") {
        try {
          const trimmed = messages.slice(-30);
          localStorage.setItem(key, JSON.stringify({
            messages: trimmed, timeline, phaseIdx, scenarioElapsedSec,
            sessionName: session?.sessionName,
            playbook: session?.playbook,
            participants: session?.participants,
            facilitatorConfig: liveFacilitatorConfig || session?.facilitatorConfig,
            companyProfile: session?.companyProfile,
            usedRandomizer: session?.usedRandomizer,
            mysteryOpenerIndex: session?.mysteryOpenerIndex,
            secondaryScenario: session?.secondaryScenario,
            blendRelation: session?.blendRelation,
            mysterySlot: session?.mysterySlot,
            savedAt: new Date().toISOString(),
          }));
        } catch { /* silent */ }
      }
    }
  };

  const clear = () => { try { localStorage.removeItem(key); } catch { /* silent */ } };

  return { load, save, clear };
}

// ── Context summarizer ────────────────────────────────────────
// When the message array sent to Claude grows past SUMMARIZE_AFTER exchanges,
// the oldest SUMMARIZE_COUNT messages are replaced with a single summary block.
const SUMMARIZE_AFTER  = 20; // total messages before summarizing
const SUMMARIZE_COUNT  = 14; // how many old messages to collapse (must be even — full exchanges)

async function summarizeHistory(oldMessages, session, playbook, phase) {
  const toSummarize = oldMessages.slice(0, SUMMARIZE_COUNT);
  const convo = toSummarize
    .map(m => `${m.role === "ai" ? "Facilitator" : m.author || "Participant"}: ${m.text}`)
    .join("\n\n");
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 400,
        system: "You are summarizing a cybersecurity tabletop exercise conversation for context compression. Be concise and factual.",
        messages: [{
          role: "user",
          content: `Summarize the following tabletop exercise conversation in 3-5 sentences. Capture: decisions made, actions taken, key scenario developments, and any gaps identified. Do not editorialize.

Scenario: ${session.scenario.name}. Playbook: ${playbook.name}. Phase at time of conversation: ${phase}.

Conversation:
${convo}`,
        }],
      }),
    });
    const data = await resp.json();
    const summary = data.content?.find(b => b.type === "text")?.text || "";
    return {
      role: "ai",
      isSummary: true,
      text: `📝 [Earlier conversation summarized]\n\n${summary}`,
      time: toSummarize[toSummarize.length - 1]?.time || "",
    };
  } catch {
    // If summarization fails, just drop the oldest messages silently
    return null;
  }
}

// ── Exercise View ─────────────────────────────────────────────
function ExerciseView({ session, onEnd, onElapsedChange }) {
  const playbook = session.playbook;
  const phases = playbook.phases?.length
    ? playbook.phases
    : ["Preparation", "Detection & Analysis", "Containment", "Eradication", "Recovery", "Post-Incident"];

  const [phaseIdx, setPhaseIdx] = useState(0);
  // scenarioElapsedSec is tracked as a plain elapsed DURATION in state, not derived from a
  // fixed start timestamp compared against wall-clock "now" — this ensures time only accrues
  // while THIS component is mounted (see the ticking effect below), freezing the instant the
  // exercise view unmounts, regardless of how long the browser stays closed or how long
  // someone spends on the Resume/"Start New Exercise" selector screen. It drives the Topbar's
  // live timer, the AAR duration, and the optional whole-scenario budget warning. Turn counts
  // and per-phase countdowns are not tracked, since phase advancement is AI-driven — see
  // applyPhaseFromText.
  const [scenarioElapsedSec, setScenarioElapsedSec] = useState(0);
  // Gates the onElapsedChange lift effect until the mount/resume-restore effect's OWN state
  // updates have committed and re-rendered, so it never reports a transient pre-restore value.
  const initializedRef = useRef(false);
  // Wall-clock timestamp of the last tick, used only to compute the real delta *between
  // ticks* (normally ~1000ms) — never compared against a fixed "start" — so drift/throttling
  // while the tab is backgrounded is handled gracefully without ever counting time that
  // elapsed while this component wasn't mounted at all.
  const lastTickRef = useRef(Date.now());
  const [messages, setMessages] = useState([]);
  const [timeline, setTimeline] = useState([{ label: "Exercise started", detail: `${liveScenarioLabel(session)} · ${playbook.name}`, time: new Date().toLocaleTimeString() }]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("discussion");
  const [facilitatorConfig, setFacilitatorConfig] = useState(session.facilitatorConfig);
  const [confirmModal, setConfirmModal] = useState(null);
  const [multiMode, setMultiMode] = useState(false);

  const storage = useChatStorage(session);

  // Stop any in-progress "Read Aloud" narration the moment this view unmounts — covers
  // End Early, Complete Exercise, and any future navigation-away path from the exercise.
  // window.speechSynthesis is a browser-global API, not tied to VoiceButton's own local
  // `speaking` state, so simply unmounting VoiceButton does NOT stop it on its own —
  // without this, narration that was playing when the exercise ended kept speaking right
  // through the After-Action Report screen.
  useEffect(() => {
    return () => speech.stop();
  }, []);

  const currentPhase = phases[phaseIdx];
  const isLastPhase = phaseIdx >= phases.length - 1;
  const nextPhase = isLastPhase ? null : phases[phaseIdx + 1];

  // Whole-scenario time budget — the only time control left (warning-only; never advances a
  // phase or ends the exercise). scenarioElapsedSec is plain duration state (see declaration
  // and the ticking effect below), not derived from timestamps.
  const scenarioLimitMinutes = facilitatorConfig.timeLimitEnabled
    ? facilitatorConfig.maxScenarioMinutes
    : null;
  const scenarioElapsedMinutes = scenarioElapsedSec / 60;
  const scenarioTimeExceeded = scenarioLimitMinutes != null && scenarioElapsedMinutes >= scenarioLimitMinutes;
  // Phase advancement is now AI-driven and there is no automatic conclusion signal — the
  // exercise ends only when the facilitator clicks "Complete Exercise ✓". So the in-chat
  // "concluded" UI (disabled input, in-log Complete button) never engages; ending is manual.
  const exerciseConcluded = false;
  const phaseGuidance = phases.map(p => PHASE_GUIDANCE[p] || "Work this phase according to your playbook's guidance.");

  const callClaude = async (msgs, system) => {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages: msgs })
    });
    const data = await resp.json();
    return data.content?.find(b => b.type === "text")?.text || "";
  };

  // Persist to localStorage after every message or phase change
  useEffect(() => {
    if (messages.length > 0) storage.save(messages, timeline, phaseIdx, session, scenarioElapsedSec, facilitatorConfig);
  }, [messages, timeline, phaseIdx, scenarioElapsedSec, facilitatorConfig]);

  // Live elapsed tick — accumulates scenarioElapsedSec once per second, but ONLY while this
  // component is mounted. Each tick
  // computes the real delta since the PREVIOUS tick (normally ~1000ms) rather than against
  // a fixed start time, so brief background-tab throttling is absorbed gracefully — and,
  // critically, no time at all accrues for any stretch where the component wasn't mounted
  // (closed tab, refresh, sitting on the Resume screen), since ticks simply don't fire then.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const deltaSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setScenarioElapsedSec(sec => sec + deltaSec);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // On mount: restore from resume data if passed, otherwise init fresh
  useEffect(() => {
    if (session._resumeData) {
      const r = session._resumeData;
      setMessages(r.messages || []);
      setTimeline(r.timeline || [{ label: "Session resumed", detail: liveScenarioLabel(session), time: new Date().toLocaleTimeString() }]);
      // Clamp to the current phase list: a saved session referencing a phase index outside
      // the current playbook's phase list would otherwise restore an out-of-range index.
      setPhaseIdx(Math.min(r.phaseIdx || 0, phases.length - 1));
      // scenarioElapsedSec restore: the current save format stores the exact elapsed duration
      // directly; older saved sessions only have a wall-clock start timestamp, which is
      // migrated here.
      if (typeof r.scenarioElapsedSec === "number") {
        setScenarioElapsedSec(r.scenarioElapsedSec);
      } else if (typeof r.scenarioStartedAt === "number") {
        setScenarioElapsedSec((Date.now() - r.scenarioStartedAt) / 1000);
      } else {
        setScenarioElapsedSec(0);
      }
    } else {
      initSession();
    }
    lastTickRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lifts scenarioElapsedSec up to the parent (App), which uses it to drive the Topbar's
  // live "total session time" display and the final duration recorded for the AAR. Gated by
  // initializedRef so it never reports the transient pre-restore value (0, or a stale value
  // from before a resume) up to the parent — only the settled value from the second commit on.
  useEffect(() => {
    if (!initializedRef.current) return;
    onElapsedChange?.(scenarioElapsedSec);
  }, [scenarioElapsedSec]);

  // Flips on AFTER the mount/resume-restore effect has run once on the initial commit, so the
  // onElapsedChange lift above only starts reporting from the settled value onward.
  useEffect(() => {
    initializedRef.current = true;
  }, []);

  const getSystemPrompt = () =>
    buildSystemPrompt(facilitatorConfig, session.scenario, playbook, currentPhase, session.participants, 0, 0, nextPhase, isLastPhase, session.usedRandomizer && !session.secondaryScenario, session.companyProfile, session.secondaryScenario, session.blendRelation, session.mysterySlot);

  // AI-determined phase: read the [PHASE:] tag off each AI response and move the stepper to
  // the phase the facilitator judged the team to be in. May move forward OR backward. Injects
  // (app-authored) carry no tag, so they never shift the phase.
  const applyPhaseFromText = (text) => {
    const idx = parsePhaseTag(text, phases);
    if (idx == null || idx === phaseIdx) return;
    setPhaseIdx(idx);
    setTimeline(prev => [...prev, { label: `Phase: ${phases[idx]}`, detail: "AI-assessed from scenario state", time: new Date().toLocaleTimeString() }]);
  };

  const initSession = async () => {
    setLoading(true);
    try {
      const mysteryOpener = MYSTERY_OPENERS[session.mysteryOpenerIndex ?? 0];
      // Added after tester feedback that opening scenes were padded with negative-space
      // detail — narrating what ISN'T a problem (dashboards green, no alerts fired) and IR
      // readiness/resources that haven't been activated (plan on file, retainer current,
      // analyst available) — which dilutes urgency and hands the team information they didn't
      // have to work for. This rule targets exactly that pattern; see TEST_CHECKLIST.md §9.
      const noPaddingRule = `Do NOT pad the scene with negative-space detail: no listing systems/tools that are NOT showing a problem (e.g. "the dashboard is green," "no alerts have fired"), no describing IR readiness or resources that haven't been activated (e.g. "the response plan is on file," "the retainer is current," "the analyst is available"), and no narrating routine internal process beyond the bare fact that something was reported (e.g. cut "logged the tickets but has not yet escalated or correlated them" down to just noting the reports came in). State only what has actually been observed, then stop.`;
      const openingInstruction = session.secondaryScenario
        ? (session.mysterySlot
            ? (() => {
                const knownScenario = session.mysterySlot === "A" ? session.secondaryScenario : session.scenario;
                const mysteryLabel = session.mysterySlot === "A" ? "Incident A" : "Incident B";
                return `Begin the tabletop exercise. Write 2 short paragraphs (roughly 100-130 words total) — do NOT use markdown headers, section titles, horizontal rules, or bullet lists; this is a single continuous scene-setting message, not a templated report. Per BLENDED INCIDENTS, weave together TWO threads into ONE opening scene — do not present them as two separate reports back to back: (1) the MYSTERY THREAD (${mysteryLabel}) — incorporate this scene-setting description almost verbatim as part of the scene (light rewording for flow is fine, but preserve its ambiguity and do not add any technical indicator, mechanism, or category hint of your own on top of it): "${mysteryOpener}"; (2) the KNOWN scenario "${knownScenario.name}" — describe only its initial business/user-facing symptoms, WITHOUT revealing its specific technical root cause, attack source, or mechanism (per ROOT-CAUSE INVESTIGATION). ${noPaddingRule} Per CORE BEHAVIOR, do not explain what the ${phases[0]} phase of ${playbook.name} requires or what steps the team should take. Remember the required [THREAD:A]/[THREAD:B]/[THREAD:BOTH] tag on its own line before the narrative. End by stating the situation as it currently stands — do not ask a question or suggest what the team should do. Wait for them to act.`;
              })()
            : `Begin the tabletop exercise. Write 2 short paragraphs (roughly 100-130 words total) — do NOT use markdown headers, section titles, horizontal rules, or bullet lists; this is a single continuous scene-setting message, not a templated report. Per BLENDED INCIDENTS, weave together the initial business/user-facing symptoms of BOTH "${session.scenario.name}" and "${session.secondaryScenario.name}" into ONE opening scene — do not present them as two separate reports back to back. WITHOUT revealing either specific technical root cause, attack source, or mechanism (per ROOT-CAUSE INVESTIGATION), describe only what staff, customers, or monitoring tools would notice from each thread. ${noPaddingRule} Per CORE BEHAVIOR, do not explain what the ${phases[0]} phase of ${playbook.name} requires or what steps the team should take. Remember the required [THREAD:A]/[THREAD:B]/[THREAD:BOTH] tag on its own line before the narrative. End by stating the situation as it currently stands — do not ask a question or suggest what the team should do. Wait for them to act.`)
        : session.usedRandomizer
        ? `Begin the tabletop exercise. Write 2 short paragraphs (roughly 100-130 words total) — do NOT use markdown headers, section titles, horizontal rules, or bullet lists; this is a single continuous scene-setting message, not a templated report. Weave in this scene-setting description almost verbatim as your opening (light rewording for flow is fine, but preserve its ambiguity and do not add any technical indicator, mechanism, or category hint of your own, and do not add extra sentences of your own about unrelated systems being fine or IR resources being available): "${mysteryOpener}" Per CORE BEHAVIOR, do not explain what the ${phases[0]} phase of ${playbook.name} requires or what the team should be doing about it — just present the situation. End by stating the situation as it currently stands — do not ask a question or suggest what the team should do. Wait for them to act.`
        : `Begin the tabletop exercise. Write 2 short paragraphs (roughly 100-130 words total) — do NOT use markdown headers, section titles, horizontal rules, or bullet lists; this is a single continuous scene-setting message, not a templated report. Describe the initial business/user-facing symptoms and impact of this ${session.scenario.name} incident — what staff, customers, or monitoring tools would notice — WITHOUT revealing the specific technical root cause, attack source, or mechanism (per the ROOT-CAUSE INVESTIGATION instruction). ${noPaddingRule} Per CORE BEHAVIOR, do not explain what the ${phases[0]} phase of ${playbook.name} requires or what steps the team should take — just present the situation and let the team's own playbook knowledge guide their next move. End by stating the situation as it currently stands — do not ask a question or suggest what the team should do. Wait for them to act.`;
      const text = await callClaude(
        [{ role: "user", content: openingInstruction }],
        getSystemPrompt()
      );
      setMessages([{ role: "ai", text, time: new Date().toLocaleTimeString() }]);
      applyPhaseFromText(text);
    } catch {
      const knownScenario = session.mysterySlot === "A" ? session.secondaryScenario : session.scenario;
      setMessages([{
        role: "ai",
        text: session.usedRandomizer
          ? (session.secondaryScenario
              ? `Exercise initiated. Your team is responding to a blended incident — one thread confirmed as a ${knownScenario.name} incident, the other still unidentified. ${MYSTERY_OPENERS[session.mysteryOpenerIndex ?? 0]}`
              : MYSTERY_OPENERS[session.mysteryOpenerIndex ?? 0])
          : `Exercise initiated. Your team is responding to a ${scenarioLabel(session)} incident. Begin investigating to determine the root cause and appropriate response.`,
        time: new Date().toLocaleTimeString(),
      }]);
    }
    setLoading(false);
  };

  // Build the API history, summarizing if it has grown too large
  const buildApiHistory = async (currentMessages) => {
    let msgs = [...currentMessages];
    if (msgs.length > SUMMARIZE_AFTER) {
      const summary = await summarizeHistory(msgs, session, playbook, currentPhase);
      if (summary) {
        msgs = [summary, ...msgs.slice(SUMMARIZE_COUNT)];
        // Update UI messages with summary replacing old entries
        setMessages(msgs);
      } else {
        // Fallback: just drop oldest messages
        msgs = msgs.slice(SUMMARIZE_COUNT);
      }
    }
    return msgs.map(m => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.role === "ai" ? m.text : `${m.author || "Participant"}: ${m.text}`,
    }));
  };

  const sendMessage = async (userText, countsAsTurn = true) => {
    const participant = session.participants[0];
    const author = participant?.name || participant?.role || "Participant";
    const userMsg = { role: "user", author, text: userText, time: new Date().toLocaleTimeString(), countsAsTurn };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setTimeline(prev => [...prev, { label: `${author} responded`, detail: userText.slice(0, 70) + (userText.length > 70 ? "…" : ""), time: new Date().toLocaleTimeString() }]);
    setLoading(true);
    try {
      const history = await buildApiHistory(updatedMessages);
      const text = await callClaude(history, getSystemPrompt());
      setMessages(prev => [...prev, { role: "ai", text, time: new Date().toLocaleTimeString() }]);
      applyPhaseFromText(text);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Error. Please try again.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
  };

  const sendMultiRoleMessage = async (responses) => {
    const filled = responses.filter(r => r.text.trim());
    if (!filled.length) return;
    const combinedText = formatMultiRoleMessage(filled);
    const userMsg = {
      role: "user",
      multi: true,
      authors: filled,
      text: combinedText,
      time: new Date().toLocaleTimeString(),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setTimeline(prev => [
      ...prev,
      ...filled.map(r => ({
        label: `${r.name || r.role} responded (multi-role round)`,
        detail: r.text.slice(0, 70) + (r.text.length > 70 ? "…" : ""),
        time: new Date().toLocaleTimeString(),
      })),
    ]);
    setLoading(true);
    try {
      const history = await buildApiHistory(updatedMessages);
      const text = await callClaude(history, getSystemPrompt());
      setMessages(prev => [...prev, { role: "ai", text, time: new Date().toLocaleTimeString() }]);
      applyPhaseFromText(text);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "Error. Please try again.", time: new Date().toLocaleTimeString() }]);
    }
    setLoading(false);
    setMultiMode(false);
  };

  const injectScenario = (inj) => {
    const closing = getInjectClosing(inj.color);
    const msg = { role: "ai", text: `⚠️ INJECT: ${inj.title}\n\n${inj.text}\n\n${closing}`, time: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, msg]);
    setTimeline(prev => [...prev, { label: `Inject: ${inj.title}`, detail: inj.text.slice(0, 60) + "…", time: new Date().toLocaleTimeString() }]);
    setTab("discussion");
  };

  return (
    <>
      <div className="exercise-subheader">
        <div className="nav-tabs" style={{ borderBottom: "1px solid #1a2a3a" }}>
          {[["discussion", "💬 Discussion"], ["injects", "⚡ Injects"], ["timeline", "📅 Timeline"], ["participants", "👥 Participants"], ["settings", "⚙️ Settings"]].map(([id, label]) => (
            <button key={id} className={`nav-tab${tab === id ? " active" : ""}`} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "instant" }); }}>{label}</button>
          ))}
          <div style={{ flex: 1 }} />
          {/* End Early — always visible */}
          <button
            className="btn btn-ghost btn-sm"
            style={{ margin: "8px 6px 8px 0", color: "#f87171", borderColor: "rgba(220,38,38,0.3)" }}
            onClick={() => setConfirmModal("end-early")}
          >✕ End Early</button>
          {/* Complete Exercise — always available; phases advance automatically as the AI
              reads the scenario state, so there is no manual "Next Phase" control. */}
          <button className="btn btn-success btn-sm" style={{ margin: "8px 0" }} onClick={() => setConfirmModal("complete")}>Complete Exercise ✓</button>
        </div>
        <div style={{ padding: "10px 24px 12px", background: "#0a0f18" }}>
          <div style={{ fontSize: 11, color: "#4a6a8a", fontFamily: "'Share Tech Mono', monospace", marginBottom: 8 }}>
            ⟳ Phase tracked automatically from your team's actions
          </div>
          {scenarioTimeExceeded && (
            <div style={{ fontSize: 11, color: "#f87171", fontFamily: "'Share Tech Mono', monospace", marginBottom: 8 }}>
              ⚠ Scenario time budget ({scenarioLimitMinutes} min) exceeded — wrap up when ready; the app will not end this automatically
            </div>
          )}
          <div className="phases">
            {phases.map((p, i) => (
              <div key={i} className={`phase-item${i === phaseIdx ? " active" : i < phaseIdx ? " done" : ""}`}>
                {i > 0 && <div className="phase-dot" />}
                <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", marginBottom: 2, opacity: 0.7 }}>{i < phaseIdx ? "✓ " : ""}{String(i + 1).padStart(2, "0")}</div>
                <div>{p}</div>
              </div>
            ))}
          </div>
          <div className="progress-bar" style={{ marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${(phaseIdx / Math.max(phases.length - 1, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="main" style={{ paddingBottom: 60 }}>
        {tab === "discussion" && (
          // 70/30 split (chat left, context sidebar right) via fr units, which respect the
          // 16px gap cleanly — overrides .grid-2's default 1fr 1fr for this tab only, so the
          // team's input area gets the majority of the width and the Injects tab (also .grid-2)
          // keeps its even split.
          <div className="grid-2 gap-4" style={{ gridTemplateColumns: "7fr 3fr" }}>
            <AIChat
              scenario={session.scenario}
              secondaryScenario={session.secondaryScenario}
              mysterySlot={session.mysterySlot}
              showIncidentTags={facilitatorConfig.showIncidentTags}
              phase={currentPhase}
              messages={messages}
              onMessage={sendMessage}
              loading={loading}
              participants={session.participants}
              multiMode={multiMode}
              onToggleMultiMode={() => setMultiMode(v => !v)}
              onMultiSend={sendMultiRoleMessage}
              hideScenarioName={session.usedRandomizer && !session.secondaryScenario}
              exerciseConcluded={exerciseConcluded}
              onCompleteExercise={() => setConfirmModal("complete")}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card">
                <div className="card-title">SCENARIO BRIEF</div>
                {session.usedRandomizer && !session.secondaryScenario ? (
                  <>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                      <span style={{ fontSize: 28 }}>🎲</span>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>Mystery Scenario</div>
                        <span className="tag" style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.3)" }}>🎲 Randomized</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.6 }}>
                      This scenario was randomly selected. Your team won't know what you're facing — read the facilitator's updates carefully and respond to what unfolds.
                    </div>
                  </>
                ) : session.secondaryScenario ? (
                  <>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <span className="tag" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>
                        🧬 Blended Incidents{session.mysterySlot ? " · 🎲 Mystery" : ""}
                      </span>
                    </div>
                    {[{ sc: session.scenario, slot: "A" }, { sc: session.secondaryScenario, slot: "B" }].map(({ sc, slot }, i) => {
                      const hidden = session.mysterySlot === slot;
                      return (
                        <div key={slot} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: i === 0 ? 10 : 0, paddingTop: i === 1 ? 10 : 0, borderTop: i === 1 ? "1px solid #1a2a3a" : "none" }}>
                          <span style={{ fontSize: 24 }}>{hidden ? "🎲" : sc.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                              <span style={{ fontWeight: 600, color: "#e0eaff" }}>{hidden ? "Mystery Scenario" : sc.name}</span>
                              {!hidden && <span className={`badge badge-severity-${sc.severity}`}>{sc.severity}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b82a0", lineHeight: 1.5 }}>
                              {hidden ? "This thread was randomly selected — your team won't know its category until they investigate." : sc.description}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                      <span style={{ fontSize: 28 }}>{session.scenario.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e0eaff", marginBottom: 4 }}>{session.scenario.name}</div>
                        <span className={`badge badge-severity-${session.scenario.severity}`}>{session.scenario.severity}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.6 }}>{session.scenario.description}</div>
                  </>
                )}
              </div>
              <div className="card">
                <div className="card-title">PHASE FOCUS · {currentPhase.toUpperCase()}</div>
                <div style={{ fontSize: 13, color: "#6b82a0", lineHeight: 1.7 }}>{phaseGuidance[Math.min(phaseIdx, phaseGuidance.length - 1)]}</div>
              </div>
              <div className="card">
                <div className="card-title">ACTIVE PARTICIPANTS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {session.participants.map((p, i) => (
                    <div key={i} className="participant-row" style={{ padding: "7px 12px" }}>
                      <div className="participant-dot" />
                      <div className="participant-name">{p.name || p.role}</div>
                      <div className="participant-role">{p.role}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "injects" && (
          <div className="grid-2 gap-4">
            <InjectPanel scenario={session.scenario} secondaryScenario={session.secondaryScenario} mysterySlot={session.mysterySlot} showIncidentTags={facilitatorConfig.showIncidentTags} onInject={injectScenario} companyProfile={session.companyProfile} />
            <CustomInject onInject={injectScenario} />
          </div>
        )}

        {tab === "timeline" && (
          <div style={{ maxWidth: 680 }}>
            <div className="card">
              <div className="card-title">EXERCISE TIMELINE</div>
              <div className="timeline">
                {timeline.map((e, i) => (
                  <div key={i} className="tl-entry">
                    <div className="tl-line">
                      <div className="tl-dot" style={{ background: i === 0 ? "#22c55e" : "#1d4ed8" }} />
                      {i < timeline.length - 1 && <div className="tl-rule" />}
                    </div>
                    <div className="tl-body">
                      <div className="tl-time">{e.time}</div>
                      <div className="tl-label">{e.label}</div>
                      {e.detail && <div className="tl-detail">{e.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "participants" && (
          <div style={{ maxWidth: 560 }}>
            <div className="card">
              <div className="card-title">ACTIVE PARTICIPANTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {session.participants.map((p, i) => (
                  <div key={i} className="participant-row">
                    <div className="participant-dot" />
                    <div className="participant-name">{p.name || p.role}</div>
                    <div className="participant-role">{p.role}</div>
                    <div style={{ marginLeft: "auto" }}><span className="badge badge-live">Active</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div style={{ maxWidth: 760 }}>
            <div className="card">
              <div className="card-title">AI FACILITATOR SETTINGS</div>
              <div style={{ fontSize: 12, color: "#2a4a6a", marginBottom: 16, padding: "8px 12px", background: "rgba(29,78,216,0.06)", borderRadius: 6, border: "1px solid rgba(29,78,216,0.15)" }}>
                Changes here take effect on the <strong style={{ color: "#60a5fa" }}>next message</strong> — the facilitator adapts mid-exercise.
              </div>
              <FacilitatorSettings
                config={facilitatorConfig}
                onChange={setFacilitatorConfig}
                scenario={session.scenario}
                secondaryScenario={session.secondaryScenario}
                blendRelation={session.blendRelation}
                mysterySlot={session.mysterySlot}
                playbook={session.playbook}
                participants={session.participants}
                mystery={session.usedRandomizer && !session.secondaryScenario}
                companyProfile={session.companyProfile}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation modals ── */}
      {confirmModal === "end-early" && (
        <ConfirmModal
          icon="⚠️"
          title="End this exercise early?"
          body={`You're currently in the ${currentPhase} phase with ${messages.reduce((acc, m) => (m.role === "ai" || m.countsAsTurn === false) ? acc : acc + (m.multi ? m.authors.length : 1), 0)} responses logged. Ending early will stop the exercise and take you to the After-Action Report. This cannot be undone.`}
          confirmLabel="End Exercise"
          confirmStyle={{ background: "rgba(220,38,38,0.2)", color: "#f87171", border: "1px solid rgba(220,38,38,0.4)" }}
          onConfirm={() => {
            setConfirmModal(null);
            speech.stop(); // stop narration immediately — don't wait for the ExerciseView unmount cleanup
            lastPlayedStorage.save(session.scenario, session.playbook, session.sessionName);
            storage.clear();
            onEnd(messages, timeline);
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {confirmModal === "complete" && (
        <ConfirmModal
          icon="✅"
          title="Complete the exercise?"
          body="This will end the session and generate your After-Action Report. Make sure your team has finished discussing the final phase before proceeding."
          confirmLabel="Complete Exercise ✓"
          confirmStyle={{ background: "rgba(22,163,74,0.2)", color: "#4ade80", border: "1px solid rgba(22,163,74,0.4)" }}
          onConfirm={() => {
            setConfirmModal(null);
            speech.stop(); // stop narration immediately — don't wait for the ExerciseView unmount cleanup
            lastPlayedStorage.save(session.scenario, session.playbook, session.sessionName);
            storage.clear();
            onEnd(messages, timeline);
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | resume | setup | exercise | aar
  const [session, setSession] = useState(null);
  const [exerciseData, setExerciseData] = useState({ messages: [], timeline: [], duration: 0 });
  const [savedSession, setSavedSession] = useState(null); // active unfinished session found in localStorage
  const [lastPlayed, setLastPlayed] = useState(null);     // most recently completed scenario
  // "Total session time" shown live in the Topbar and recorded as the AAR's final duration.
  // Receives live updates from ExerciseView's own scenarioElapsedSec (see its
  // onElapsedChange callback) — the same duration ExerciseView tracks for the
  // Entire-Scenario time-limit feature, which ticks only while the exercise is actually
  // mounted and resumes from exactly where it left off. There is no local ticking interval
  // here; this value simply mirrors whatever ExerciseView last reported.
  const [elapsedSec, setElapsedSec] = useState(0);

  // Load lastPlayed on mount — always show it on scenario selection
  useEffect(() => {
    setLastPlayed(lastPlayedStorage.load());
  }, []);

  const handleBegin = () => {
    // Check for an active unfinished session. Sort by savedAt (most recent first) in case
    // more than one stale session key exists — e.g. leftovers from before this cleanup
    // logic existed — so the most recently active one is what gets offered for resume.
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith("tactician:") && k !== LAST_PLAYED_KEY);
    const candidates = allKeys.map(k => {
      try { return { key: k, ...JSON.parse(localStorage.getItem(k)) }; } catch { return null; }
    }).filter(Boolean).filter(s => s.messages?.length > 0);
    candidates.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    const found = candidates[0];

    if (found) {
      setSavedSession(found);
      setScreen("resume");
    } else {
      setScreen("setup");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleResumeSession = () => {
    // Reconstruct a minimal session object from the saved data so ExerciseView can render
    // The full session config was saved inside the storage key name — we pass savedSession
    // directly through to ExerciseView via a special resume path
    setSavedSession(prev => prev); // keep it; ExerciseView will read from localStorage by key
    // We need to rebuild the session from the storage key and stored scenario info.
    // Since we only have metadata in the key, we match against SCENARIOS + INDUSTRY_PLAYBOOKS.
    // The scenario segment of the key may be "id" (single) or "id+id" (Blended Incidents —
    // see storageKey()), so split on "+" before matching against SCENARIOS.
    const keyParts = savedSession.key.replace("tactician:", "").split(":");
    const scenarioSegment = keyParts[keyParts.length - 1];
    const [scenarioId, secondaryScenarioId] = scenarioSegment.split("+");
    const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
    const secondaryScenario = secondaryScenarioId
      ? (SCENARIOS.find(s => s.id === secondaryScenarioId) || savedSession.secondaryScenario || null)
      : (savedSession.secondaryScenario || null);
    // Reconstruct playbook — prefer saved object, then match by name, then default to CISA
    const savedPlaybook = savedSession.playbook;
    const playbook = savedPlaybook?.phases?.length
      ? savedPlaybook
      : INDUSTRY_PLAYBOOKS.find(pb => pb.name === savedPlaybook?.name) || INDUSTRY_PLAYBOOKS[0];

    // Build a minimal session — participants and facilitatorConfig from saved data or defaults
    const restoredSession = {
      scenario,
      secondaryScenario,
      blendRelation: savedSession.blendRelation || null,
      mysterySlot: savedSession.mysterySlot || null,
      playbook,
      participants: savedSession.participants || [{ role: "Facilitator", name: "", id: "Facilitator", active: true }],
      sessionName: savedSession.sessionName || keyParts.slice(0, -1).join(" "),
      facilitatorConfig: normalizeFacilitatorConfig(savedSession.facilitatorConfig),
      companyProfile: normalizeCompanyProfile(savedSession.companyProfile),
      usedRandomizer: !!savedSession.usedRandomizer,
      mysteryOpenerIndex: savedSession.mysteryOpenerIndex ?? 0,
      _resumeData: savedSession,
    };
    // Seed the live "total session time" synchronously, mirroring the exact same
    // current-format/legacy-migration logic ExerciseView's own restore effect uses for
    // scenarioElapsedSec — so the Topbar shows the correct resumed duration immediately on
    // the very first render of the exercise screen, rather than flashing 00:00:00 for a
    // moment while waiting for ExerciseView's onElapsedChange callback to catch up.
    const initialElapsed = typeof savedSession.scenarioElapsedSec === "number"
      ? savedSession.scenarioElapsedSec
      : typeof savedSession.scenarioStartedAt === "number"
        ? (Date.now() - savedSession.scenarioStartedAt) / 1000
        : 0;
    setElapsedSec(initialElapsed);
    setSession(restoredSession);
    setScreen("exercise");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleStartNew = () => {
    setSavedSession(null);
    setScreen("setup");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleStart = (s) => {
    // A new exercise is genuinely launching now — this is the point of no return for any
    // previously declined/abandoned session, so clean up every other saved session key.
    // (Declining the resume prompt via "Start New Exercise" intentionally does NOT do this
    // — that session stays resumable until an exercise is actually launched.)
    clearOtherSessions(storageKey(s));
    setSession(s);
    setElapsedSec(0);
    setScreen("exercise");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleEnd = (messages, timeline) => {
    // elapsedSec is kept live by ExerciseView's onElapsedChange callback (ticking once per
    // second, same value the Entire-Scenario time-limit feature uses), so it already
    // reflects the exercise's real active duration — no separate timestamp math needed here.
    const duration = Math.floor(elapsedSec);
    setExerciseData({ messages, timeline, duration });
    setLastPlayed(lastPlayedStorage.load()); // refresh after exercise writes lastPlayed
    setScreen("aar");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleNewScenario = () => {
    setSession(null);
    setSavedSession(null);
    setExerciseData({ messages: [], timeline: [], duration: 0 });
    setElapsedSec(0);
    setLastPlayed(lastPlayedStorage.load());
    setScreen("setup");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#080c10" }}>
      <FontStyle />
      <Topbar
        sessionName={session?.sessionName}
        stopped={screen === "aar"}
        finalDuration={exerciseData.duration}
        elapsed={elapsedSec}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {screen === "landing" && <LandingPage onBegin={handleBegin} />}

        {/* Resume prompt — shown between landing and setup when an active session is found */}
        {screen === "resume" && savedSession && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
            <div className="card" style={{ textAlign: "center", padding: "36px 32px", maxWidth: 480, width: "100%" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>💾</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#e0eaff", marginBottom: 8 }}>
                Unfinished Session Found
              </div>
              <div style={{ fontSize: 13, color: "#4a6a8a", lineHeight: 1.7, marginBottom: 24 }}>
                You have an unfinished exercise saved.<br />
                <span style={{ color: "#7cb3f5", fontFamily: "'Share Tech Mono', monospace" }}>
                  {savedSession.sessionName || "Unnamed Session"}
                </span>
                <br />
                <span style={{ fontSize: 12, color: "#3a5a7a" }}>
                  {savedSession.messages?.length || 0} messages · Last saved {savedSession.savedAt ? new Date(savedSession.savedAt).toLocaleString() : "recently"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={handleResumeSession}>
                  ↩ Resume Session
                </button>
                <button className="btn btn-ghost" onClick={handleStartNew}>
                  + Start New Exercise
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "setup" && <ParticipantSetup onStart={handleStart} lastPlayed={lastPlayed} />}
        {screen === "exercise" && session && (
          <ExerciseView
            session={session}
            onEnd={handleEnd}
            onElapsedChange={setElapsedSec}
          />
        )}
        {screen === "aar" && session && (
          <AARView
            session={session}
            timeline={exerciseData.timeline}
            messages={exerciseData.messages}
            duration={exerciseData.duration}
            onNewScenario={handleNewScenario}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}
