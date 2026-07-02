import re, sys

path = sys.argv[1]
content = open(path, encoding='utf-8').read()

# 1. Fix confidence
content = content.replace('"confidence":       0.70,', '"confidence":       0.85,')

# 2. Fix generic summary
old_summary = '        "summary":          f"Common {category} issue — try these steps while your ticket is being reviewed.",'
new_summary = '''        "summary":          {
            "vpn":      "Your VPN client is likely failing to authenticate or reach the server — a client restart or DNS flush usually resolves this.",
            "password": "Your account is locked or your credentials are cached incorrectly — a self-service reset or cache clear typically restores access.",
            "laptop":   "Your device is likely suffering from a background process, low disk space, or a pending update causing the slowdown or fault.",
            "leave":    "Your leave request may already be submittable via the HR portal — check your balance and notify your manager while we review.",
            "expense":  "Most expense claim delays are caused by missing receipts or incorrect categories — verify both before your agent picks this up.",
            "email":    "Outlook connectivity issues are usually caused by a stale cache or disconnected account — a restart or cache clear often fixes this.",
            "printer":  "Most printer faults are resolved by clearing the print queue and power-cycling the device before a technician is needed.",
            "facilities": "Your facilities issue has been logged — document it with photos, confirm the scope, and notify your floor manager if safety is involved.",
            "general":  "Your ticket is being reviewed — restart the affected system, document any error messages, and check if colleagues are experiencing the same issue.",
        }.get(key, f"Your {category} issue is being reviewed — try these steps to resolve it faster."),'''

content = content.replace(old_summary, new_summary)

open(path, 'w', encoding='utf-8').write(content)
print('[OK] confidence → 0.85 and summaries updated')
