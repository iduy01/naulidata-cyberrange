# Walkthrough — Red & Blue Team Paths

Proof that the lab functions exactly as requested. Every command and its output
below comes from a live deployment; the automated self-test is
`bash scripts/verify.sh` → **20 passed, 0 failed**.

| File | Contents |
|------|----------|
| [`GET-THE-FLAGS.md`](GET-THE-FLAGS.md) | **Start here.** Step-by-step to collect all 34 flags: 8 steps, exact commands with their output, and a tick-off checklist. |
| [`WALKTHROUGH-RED.md`](WALKTHROUGH-RED.md) | Red Team, 3 phases: reconnaissance → WAF bypass → session replay & MFA bypass. Ends on `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`. |
| [`WALKTHROUGH-BLUE.md`](WALKTHROUGH-BLUE.md) | Blue Team, 3 phases: log forensics → threat hunting → incident response, plus an incident-response summary table. Ends on `SCENARIO75{BLUE_L0g_Hunt3r_M4st3r}`. |
| [`Walkthrough-Red-Blue-Lab.md`](Walkthrough-Red-Blue-Lab.md) | Both paths in one document, closed by a *requirement → proof* table. |
| [`Walkthrough-Red-Blue-Lab.pdf`](Walkthrough-Red-Blue-Lab.pdf) | The same document, A4 PDF (5 pages) — ready to attach to the submission. |

A condensed version of this walkthrough is also in the repository
[`README.md`](../README.md#4-walkthrough--proof-the-lab-works) (§4).

## Quick reference

```bash
# Red Team
curl -i http://<VM-IP>:3075/                       # X-Powered-By: Node.js (Express)
curl -s http://<VM-IP>:3075/robots.txt             # Disallow: /api/verify-mfa
curl -X POST http://<VM-IP>:3075/api/feedback \
     --data-urlencode 'message=<script>alert(1)</script>'      # -> 403 (WAF)
# <svg onload> + bracket notation -> 200 (stored) -> bot fires it -> cookie stolen
curl -b 'adm_sess=<stolen>' http://<VM-IP>:3075/dashboard      # -> 200, MFA skipped

# Blue Team
ssh analyst@<VM-IP> -p 2275                        # pw: blue_team_rocks
cd /opt/admin/logs && grep '10.10.14.50' access.log
grep 'Authentication bypass anomaly' error.log     # 18:53:10 CRITICAL
echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
```
