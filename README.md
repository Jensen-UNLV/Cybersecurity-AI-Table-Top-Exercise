# Tactician (working title) — AI-Facilitated Cybersecurity Tabletop Exercise

Tactician (working title) is an interactive cybersecurity incident response tabletop exercise, facilitated live by Claude. A team picks an incident scenario (ransomware, data exfiltration, DDoS, insider threat, phishing/BEC, or supply chain compromise) and an industry playbook (CISA or NIST SP 800-61), then works through the incident phase by phase in a live chat with an AI facilitator that injects new developments, offers hints, and adapts to the team's decisions.

**Key features:**
- 6 incident scenarios across Critical/High/Medium severity, each with its own set of investigative and confirmation-tier injects
- CISA and NIST SP 800-61 playbooks with phase-by-phase progression
- Optional company profile (industry + size) that scales scenario details (ransom amounts, record counts, regulatory deadlines, etc.)
- Configurable AI facilitator: tone, difficulty, complexity, turn limits, and time limits (per-phase or whole-scenario)
- "Mystery Scenario" mode that hides the incident type until the team investigates and confirms it
- Live scenario injects, adaptive hint system, and read-aloud narration
- Auto-generated After-Action Report (What Went Well, Areas for Improvement, Playbook Gaps, Action Items, Next Steps) with print/PDF export
- Session auto-save with resume support if you navigate away mid-exercise

---

## Installation (Claude Artifact)

Tactician is designed to run as a self-contained **Claude Artifact** — no separate hosting, build step, or server required.

1. Open [claude.ai](https://claude.ai) (or the Claude app) and start a new conversation.
2. Upload or paste the contents of `cyber-tabletop.jsx`.
3. Ask Claude to run it as an artifact — for example:
   > "Run this as a React artifact."
4. Claude will render Tactician directly in the artifact panel. Click **Begin Exercise** to start.

That's it — the app runs entirely inside the artifact, including the AI facilitator (which calls the Anthropic API directly from the artifact) and session persistence (via the artifact's built-in `window.storage`, scoped privately to your account).

### Notes
- **No API key setup needed** — the artifact environment supplies API access automatically.
- **Storage is per-user** — saved/resumable sessions are private to your Claude account and don't sync across devices.

### Requirements
- A Claude.ai account (or Claude app) with Artifacts enabled.
- A modern browser. Voice/"Read Aloud" uses the browser's built-in Web Speech API, so voice quality varies by browser/OS — this is optional and not required to use the exercise.

---

## Project Files

| File | Purpose |
|---|---|
| `cyber-tabletop.jsx` | The main application — run this as the artifact to play the exercise |

## Current known issues
- Uploaded/custom playbooks are untested at this time
- Participant "Roles" don't play a large part in affecting the scenario at this time
- Limited to no testing on the Scenario configurations (Tone, Difficulty, Complexity) out of defaults
- Current iteration does not separate the "Facilitator" and "Participant" views so facilitator settings can be accessed
