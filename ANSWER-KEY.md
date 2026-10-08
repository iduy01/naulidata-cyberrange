# ANSWER KEY — "Cookies Reuse & MFA Bypass"

All flags follow the format `SCENARIO75{answer}`. 34 flags in total (2 are the
"final" victory flags, the rest answer each requirement in the brief).

## Red Team path

### Phase 1 — Reconnaissance
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 1 | Backend technology exposed via `X-Powered-By` | `SCENARIO75{Node.js}` |
| 2 | `robots.txt` disallowed path | `SCENARIO75{/api/verify-mfa}` |
| 3 | Restricted admin area | `SCENARIO75{/dashboard}` |
| 4 | ASCII-art comment hints at | `SCENARIO75{robots.txt}` |
| 5 | Pre-auth session cookie name | `SCENARIO75{pre_mfa_session}` |
| 6 | Pre-auth session cookie value | `SCENARIO75{pending_mfa_verification}` |

### Phase 2 — Defense Evasion
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 7 | Feedback submission HTTP method | `SCENARIO75{POST}` |
| 8 | WAF response code for `<script>` | `SCENARIO75{403}` |
| 9 | HTML5 element used to bypass the WAF | `SCENARIO75{<svg>}` |
| 10 | Cookie access via bracket-notation obfuscation | `SCENARIO75{window['docu'+'ment']['coo'+'kie']}` |
| 11 | `pre_mfa_session` HttpOnly setting | `SCENARIO75{False}` |
| 12 | API permitted for exfiltration | `SCENARIO75{fetch}` |

### Phase 3 — Initial Access
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 13 | MFA endpoint skipped on cookie replay | `SCENARIO75{/api/verify-mfa}` |
| 14 | Authenticated admin session prefix | `SCENARIO75{adm_sess}` |
| 15 | CSS class of the reflected-XSS container | `SCENARIO75{xss-payload}` |
| 16 | **Final Red Team flag** | `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}` |

## Blue Team path

### Phase 1 — Log Forensics
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 17 | Log directory | `SCENARIO75{/opt/admin/logs}` |
| 18 | Attacker source IP | `SCENARIO75{10.10.14.50}` |
| 19 | Attacker User-Agent | `SCENARIO75{Mozilla/5.0}` |
| 20 | Status code for the `/dashboard` access | `SCENARIO75{200}` |
| 21 | Timestamp of the `200` `/dashboard` hit | `SCENARIO75{18:51:55}` |
| 22 | Base64 string in `X-Forwarded-For` | `SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}` |

### Phase 2 — Threat Hunting
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 23 | Legitimate admin traffic IP (baseline) | `SCENARIO75{192.168.1.100}` |
| 24 | Attacker subnet | `SCENARIO75{10.10.14.0/24}` |
| 25 | File recording WAF alerts | `SCENARIO75{/opt/admin/logs/error.log}` |
| 26 | First blocked WAF tag | `SCENARIO75{<script>}` |
| 27 | Timestamp of the first WAF block | `SCENARIO75{18:50:15}` |
| 28 | Did the attacker reach the MFA endpoint? | `SCENARIO75{No}` |

### Phase 3 — Incident Response
| # | Requirement | Flag / answer |
|---|-------------|---------------|
| 29 | Encoding scheme in the header | `SCENARIO75{Base64}` |
| 30 | Length of the encoded string | `SCENARIO75{44}` |
| 31 | Severity level for cookie-reuse events | `SCENARIO75{CRITICAL}` |
| 32 | Timestamp of the anomaly entry | `SCENARIO75{18:53:10}` |
| 33 | Exact security-warning string | `SCENARIO75{Authentication bypass anomaly}` |
| 34 | **Final Blue Team flag** | `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}` |

---

## Decoding the exfiltration header

```bash
$ echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}
```

Note (see `documentation/WRITTEN-EXPLANATION.md` §6): the literal string in the
brief is 47 characters and decodes to a `PHANTOMGRID{...}` value, while the brief's
own answer states 44 characters and `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`. The lab
stores the string exactly as supplied.
