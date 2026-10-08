# Getting started — run the lab from GitHub on a fresh machine

Step-by-step for cloning <https://github.com/iduy01/naulidata-cyberrange> onto a
computer that does **not** have Docker yet, and getting the application running.

> ⚠️ The application is **intentionally vulnerable**. Run it on a machine or
> network you don't mind exposing to attack traffic. Never put ports `3075` /
> `2275` on the public internet.

## What you need first

| Requirement | Notes |
|-------------|-------|
| Linux (Debian 12 / Ubuntu 22.04–24.04) | `scripts/provision.sh` installs Docker for you |
| `git` + `curl` | the only two things you install by hand |
| root / sudo | provisioning installs packages and creates `/opt/admin/logs` |
| ~4 GB free disk | the bot image (Node + Chromium) is ~1 GB, the app ~182 MB |
| Free ports `3075` (HTTP) and `2275` (SSH) | change the mapping if they're taken |
| Internet access | to pull `node:20-alpine`, `node:20-slim` and the OS packages |

---

## A. Linux — the easy path (`provision.sh` does everything)

`scripts/provision.sh` installs Docker Engine + the Compose plugin if they are
missing, creates `/opt/admin/logs`, adds the internal DNS entry, builds and starts
the three services, then seeds the mock telemetry.

```bash
# 1. git + curl (Docker is installed for you in step 3)
sudo apt-get update
sudo apt-get install -y git curl

# 2. clone the repository
git clone https://github.com/iduy01/naulidata-cyberrange.git
cd naulidata-cyberrange

# 3. deploy everything (needs root — this installs Docker)
sudo bash scripts/provision.sh

# 4. check it
bash scripts/verify.sh          # -> 20 passed, 0 failed
```

That's it. `verify.sh` needs no privileges (it only uses `curl`).

### Optional: run docker without sudo

```bash
sudo usermod -aG docker "$USER"     # then log out / back in (or: newgrp docker)
```

### Where to open it

| What | Where |
|------|-------|
| Vulnerable web app | `http://<IP-of-that-machine>:3075` |
| Blue Team SSH | `ssh analyst@<IP> -p 2275` — password `blue_team_rocks` |
| Logs (Blue Team) | `/opt/admin/logs/access.log`, `/opt/admin/logs/error.log` |
| Admin credentials (for the demo) | `admin` / `Adm1n@Feedback2026`, MFA `123456` |

If the machine is a remote/VPS host, open those two ports in its firewall and use
the public IP.

---

## B. Any Linux distro (manual — no `provision.sh`)

Use this on Fedora/Arch/other, or when you prefer to install Docker yourself.
`provision.sh` is only a convenience wrapper; these are the steps it performs.

```bash
# 1. install Docker Engine + the compose plugin
#    (official instructions: https://docs.docker.com/engine/install/)
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://get.docker.com | sudo sh        # quick path; then:
sudo systemctl enable --now docker

# 2. get the code
git clone https://github.com/iduy01/naulidata-cyberrange.git
cd naulidata-cyberrange

# 3. prepare the shared log directory + internal DNS name
sudo mkdir -p /opt/admin/logs
grep -q feedback.admin.local /etc/hosts || echo "127.0.0.1 feedback.admin.local" | sudo tee -a /etc/hosts

# 4. build and start (compose file lives in docker/)
sudo docker compose -f docker/docker-compose.yml up -d --build

# 5. seed the simulated telemetry the Blue Team is supposed to find
sudo docker compose -f docker/docker-compose.yml exec -T app \
  python3 /usr/src/app/scripts/inject_logs.py --dir /opt/admin/logs --clear

# 6. check
bash scripts/verify.sh
```

---

## C. Windows 10/11 or macOS (Docker Desktop)

`provision.sh` is Linux-only (it uses `apt`), so on these systems you use the
manual path with Docker Desktop.

1. Install **Docker Desktop** (Windows: it enables WSL 2 for you; macOS: Apple
   Silicon and Intel builds are both fine). Start it and wait until it says
   "Engine running".
2. Get the code — either install Git and clone, or on the repo page click
   **Code → Download ZIP** and extract it:
   ```
   git clone https://github.com/iduy01/naulidata-cyberrange.git
   cd naulidata-cyberrange
   ```
3. Build and start (PowerShell / Terminal, in the repository folder):
   ```
   docker compose -f docker/docker-compose.yml up -d --build
   ```
   The first build downloads Chromium, so expect a few minutes.
4. Seed the simulated logs:
   ```
   docker compose -f docker/docker-compose.yml exec -T app python3 /usr/src/app/scripts/inject_logs.py --dir /opt/admin/logs --clear
   ```
5. Open <http://localhost:3075> — you should see the "Admin Feedback System" page
   with `X-Powered-By: Node.js (Express)`.

Notes for Docker Desktop:

* Skip the `/opt/admin/logs` and `/etc/hosts` steps — on Docker Desktop the
  `../logs` folder of the repository *is* the shared log directory (it is mounted
  into the containers at `/opt/admin/logs`), and the internal alias
  `feedback.admin.local` is only used inside the compose network.
* Blue Team SSH still works: `ssh analyst@localhost -p 2275` (password
  `blue_team_rocks`).
* `scripts/verify.sh` is a bash script — run it from WSL/Git Bash, or just check
  `curl http://localhost:3075/` manually.
* On Apple Silicon, if the bot image fails to build, add
  `--platform linux/amd64` to the build (the bot is only needed for the stored-XSS
  demo; the vulnerable app itself is multi-arch).

---

## D. Using the lab once it's up

Red Team (three commands to prove the flaw):

```bash
curl -i http://<IP>:3075/                      # X-Powered-By: Node.js (Express)
curl -s http://<IP>:3075/robots.txt            # Disallow: /api/verify-mfa
curl -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
     --data-urlencode 'message=<script>alert(1)</script>'          # -> 403 (WAF)
```

Blue Team:

```bash
ssh analyst@<IP> -p 2275
cd /opt/admin/logs && grep '10.10.14.50' access.log
```

The full Red and Blue paths — with the WAF bypass payload, the cookie exfiltration
and the log analysis — are in [`walkthrough/`](walkthrough/) and in the README
(§4).

---

## E. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Cannot connect to the Docker daemon` | Docker isn't running (`sudo systemctl start docker`) or your user isn't in the `docker` group — prefix commands with `sudo` |
| `bash: docker: command not found` after step 3 | re-run `sudo bash scripts/provision.sh`; it installs Docker when missing |
| `port is already allocated` on 3075 / 2275 | edit `docker/docker-compose.yml` and change the host side, e.g. `"8075:3075"` and `"2276:2222"` |
| Bot container restarting, log says `ERR_SSL_PROTOCOL_ERROR` | something is using the hostname `app` — Chromium force-upgrades the `.app` TLD to HTTPS. The repo already points the bot at `http://feedback:3075`; keep it that way |
| `verify.sh` fails only on the "Blue Team telemetry" checks | the logs were never seeded — run the `inject_logs.py --clear` command from step 5 |
| `curl` returns `000` / hangs | a proxy is configured for your shell. Try `curl --noproxy '*' http://127.0.0.1:3075/` |
| Build fails pulling `node:20-slim` | no internet / corporate proxy; configure Docker's proxy or pre-pull the image |
| Running out of disk | `docker system prune -a` (removes unused images) |

## F. Stop / restart / remove

```bash
cd naulidata-cyberrange

sudo docker compose -f docker/docker-compose.yml down            # stop (logs kept)
sudo docker compose -f docker/docker-compose.yml down -v         # stop + drop volumes
sudo docker compose -f docker/docker-compose.yml up -d           # start again
sudo docker compose -f docker/docker-compose.yml up -d --build   # rebuild after code changes
```
