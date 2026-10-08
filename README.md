# Cyber Range — "Cookies Reuse & MFA Bypass"

Practical assessment submission for **PT Nauli Mula Data — Cybersecurity Engineer (Lab & Range Developer)**.

A self-contained **Red vs. Blue** Capture-The-Flag lab built around a flawed
session-token issuance design in a corporate *Admin Feedback System*. The lab is
containerised with Docker Compose and is intended to be deployed inside a single
Linux VM on a Proxmox hypervisor.

- **Red Team path** — XSS → session replay → MFA bypass
- **Blue Team path** — log forensics, threat hunting, incident response

> ⚠️ **This application is intentionally vulnerable. Run it only inside an
> isolated lab network. Never expose port 3075 / 2275 to the internet.**

---

## 1. Architecture

```
                     ┌──────────────────────── VM / Proxmox guest ────────────────────────┐
                     │                                                                    │
  Red Team  ───HTTP──┼──▶  :3075  ┌───────────────────────┐                                │
  (attacker)         │           │  app  (Node.js/Express)│  logs ─┐                       │
                     │           │  Admin Feedback System │        │                       │
                     │           └───────────────────────┘        ▼                       │
                     │           ┌───────────────────────┐  /opt/admin/logs               │
  bot (admin) ───────┼──▶  app   │  bot  (headless Chrome)│  access.log  error.log        │
  reviews dashboard  │           │  signs in + opens /dash │        ▲                       │
                     │           └───────────────────────┘        │                       │
  Blue Team  ──SSH───┼──▶  :2275  ┌───────────────────────┐        │                       │
  (analyst)          │           │  sshd (linuxserver)    │────────┘  reads the shared logs│
                     │           └───────────────────────┘                                │
                     └────────────────────────────────────────────────────────────────────┘
```

| Component | Image / build | Host port | Purpose |
|-----------|---------------|-----------|---------|
| `app`  | `application/app` (node:20-alpine) | `3075` → 3075 | Vulnerable web application (HTTP) |
| `bot`  | `application/bot` (node:20-slim + Chromium) | – | Simulated admin that logs in (incl. MFA) and reviews `/dashboard` |
| `sshd` | `lscr.io/linuxserver/openssh-server` | `2275` → 2222 | Blue Team SSH access, shares `/opt/admin/logs` |

Internal DNS: the VM maps `feedback.admin.local → 127.0.0.1` (see `provision.sh`).

---

## 2. Deployment (Proxmox environment)

Copy this repository into the target Linux VM, then:

```bash
# 1. (as root) build + start everything + seed telemetry
sudo bash scripts/provision.sh

# --- or, manually ---
mkdir -p /opt/admin/logs
docker compose -f docker/docker-compose.yml up -d --build
python3 scripts/inject_logs.py --dir /opt/admin/logs --clear
```

Verify:

```bash
curl -i http://127.0.0.1:3075/                 # X-Powered-By: Node.js (Express)
curl -s http://127.0.0.1:3075/robots.txt
ssh analyst@127.0.0.1 -p 2275                  # pw: blue_team_rocks
#   analyst@...:~$ ls -la /opt/admin/logs
```

Recommended Proxmox VM: 2 vCPU, 4 GB RAM, 20 GB disk, Debian 12 or Ubuntu 22.04/24.04,
~8 GB free for the Docker images (the bot image pulls Chromium).

Teardown:

```bash
docker compose -f docker/docker-compose.yml down -v
```

### Self-test

```bash
bash scripts/verify.sh          # 20 checks across infra + Red + Blue paths
```

---

## 3. Lab credentials & parameters

| Item | Value |
|------|-------|
| Admin username | `admin` |
| Admin password | `Adm1n@Feedback2026` |
| MFA code | `123456` |
| Blue Team SSH | `analyst` / `blue_team_rocks` on port `2275` |
| Log directory | `/opt/admin/logs` (`access.log`, `error.log`) |
| Pre-auth cookie | `pre_mfa_session=pending_mfa_verification` (HttpOnly=False) |
| Admin session cookie | `adm_sess_<32 hex>` (HttpOnly=False, never expires) |

These are **lab** credentials, intentionally published so both teams can operate.

---

## 4. Attack path at a glance

**Red Team (3 phases)**

1. *Reconnaissance* — `X-Powered-By` header, `robots.txt` (`Disallow: /api/verify-mfa`),
   ASCII-art comment in the page source, hidden `/dashboard`, pre-auth cookie.
2. *Defense Evasion* — the naive WAF blocks `<script>` (403) and the raw keywords
   `document` / `cookie`, so the payload must use an `<svg onload="...">` element,
   bracket-notation cookie access `window['docu'+'ment']['coo'+'kie']`, and the
   `fetch` API for exfiltration.
3. *Initial Access* — the stored payload runs in the admin's browser, the stolen
   `adm_sess` cookie is replayed, and `/api/verify-mfa` is skipped entirely →
   dashboard access → final flag `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`.

**Blue Team (3 phases)**

1. *Log forensics* — `access.log` / `error.log` in `/opt/admin/logs`, attacker IP
   `10.10.14.50`, UA `Mozilla/5.0`, a `200` for `/dashboard` at `18:51:55`, and a
   Base64 string in `X-Forwarded-For`.
2. *Threat hunting* — baseline `192.168.1.100` traffic, attacker subnet
   `10.10.14.0/24`, the first WAF block of `<script>` at `18:50:15` in `error.log`,
   and proof the attacker **never** reached `/api/verify-mfa`.
3. *Incident response* — recognise Base64, flag cookie-reuse events as `CRITICAL`,
   find the `18:53:10` "Authentication bypass anomaly" entry, decode the header to
   the final flag `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`.

The complete flag list is in [`ANSWER-KEY.md`](ANSWER-KEY.md).
The step-by-step Red/Blue walkthroughs, the runbook, the written explanation,
the verification evidence and the presentation deck/ebook are delivered as
**separate attachments**, not in this repository.

---

## 5. Repository layout

```
naulidata-cyberrange/
├── application/                 # 1. APPLICATION SOURCE CODE (Node.js)
│   ├── app/
│   │   ├── server.js            # all logic: WAF, sessions, dashboard, logging
│   │   └── package.json
│   └── bot/                     # headless-Chromium admin simulator (drives the XSS)
│       ├── bot.js
│       └── package.json
├── docker/                      # 2. DOCKER / DOCKER COMPOSE
│   ├── docker-compose.yml       # 3 services: app, bot, sshd
│   ├── app.Dockerfile
│   └── bot.Dockerfile
├── scripts/                     # 3. SETUP / PROVISIONING SCRIPTS
│   ├── provision.sh             # Proxmox VM: Docker + /opt/admin/logs + DNS + compose up + seed
│   ├── inject_logs.py           # generate/inject the mock telemetry
│   └── verify.sh                # automated self-test of the whole lab (Red + Blue)
├── exploit/
│   ├── exfil_server.py      # captures exfiltrated cookies
│   ├── red_team_exploit.py  # end-to-end Red Team automation
│   └── replay_cookie.sh     # one-liner cookie replay
├── logs-sample/                 # sample telemetry (the live logs/ dir is git-ignored)
├── logs/                        # created at deploy time, bind-mounted to /opt/admin/logs
├── ANSWER-KEY.md
└── README.md
```

---

## 6. Notes & known quirks (assessment transparency)

- **Never name the service `app` for the headless browser.** The `.app` TLD is on
  the Chromium **HSTS preload list**, so a headless browser navigating to
  `http://app:3075` is silently force-upgraded to HTTPS and fails with
  `net::ERR_SSL_PROTOCOL_ERROR`. The lab therefore exposes network aliases
  `feedback` / `feedback.admin.local` and points the bot at `http://feedback:3075`.
- **Base64 length mismatch.** The assessment text states the `X-Forwarded-For`
  Base64 string is *44 characters* and decodes to `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`.
  The literal string supplied in the brief is in fact **47 characters** and decodes
  to `PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}`. The lab reproduces the **literal string
  exactly as given** (so the Blue Team's binary-search/threat-hunt answer matches the
  brief) and documents the discrepancy here. A corrected, padding-valid alternative is
  `U0NFTkFSSU83NXtCTFVFX0wwR19IVW50M3JfTTRzdDNyfQ==`.
- **Forged cookies are rejected.** `adm_sess` is validated against a server-side set,
  so *replay* of a genuinely issued token works, but brute-forcing a random token does
  not — this keeps the scenario realistic (the flaw is reuse, not predictability).
- **In-memory state.** `adm_sess` tokens and the feedback queue live in memory and are
  cleared on container restart; the simulated telemetry in `/opt/admin/logs` persists.
- **The bot requires egress.** For the XSS `fetch()` to reach the Red Team, the bot
  container must be able to route to the attacker's listener. In a Proxmox lab this is
  the same L2/L3 zone; if you run it locally, use the host network so the bot can reach
  an exfil server bound on the host.
