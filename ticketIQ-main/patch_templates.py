import sys
path = sys.argv[1]
content = open(path, encoding='utf-8').read()

old = 'FALLBACK_TEMPLATES = {'
if old not in content:
    print('[ERROR] Could not find FALLBACK_TEMPLATES in file')
    sys.exit(1)

start = content.index('FALLBACK_TEMPLATES = {')
end = content.index('\n# ─── System Prompt')
old_block = content[start:end]

new_block = '''FALLBACK_TEMPLATES = {
    "Leave Request": {
        "formal":   "Thank you for submitting your leave request. It has been received by the HR team and is currently under review for scheduling conflicts and policy compliance. You will receive a formal response within one business day. Please inform your line manager of your intended absence and ensure any critical handovers are planned accordingly.",
        "friendly": "Your leave request has come through — thanks for submitting it in advance! We will check the team calendar and confirm availability within a day. It is a good idea to give your manager a heads-up so they can plan around your absence.",
        "urgent":   "Your leave request has been received and flagged as urgent. The HR team is reviewing it now and will respond within 4 hours. Please ensure your manager is aware and that any pending work is covered in the interim.",
    },
    "Payslip": {
        "formal":   "We acknowledge receipt of your payslip enquiry. The HR team has been notified and is investigating the reported discrepancy as a priority matter. A full response, including corrected documentation where applicable, will be provided within two business days. We apologise for any inconvenience this may have caused.",
        "friendly": "Thanks for flagging this — payslip issues are always a priority for us. The HR team is on it and will have an update within two business days. If you need this urgently for a financial or administrative reason, please let us know and we will do our best to fast-track it.",
        "urgent":   "Your payslip query has been escalated to the HR team for immediate attention. We are prioritising this above standard queue and will provide an update within two hours. If this relates to a payment or banking deadline, please include those details so we can act accordingly.",
    },
    "HR Policy": {
        "formal":   "Thank you for your policy enquiry. The HR team will retrieve the relevant documentation and provide you with a clear, written response within one business day. If your query relates to an active situation requiring immediate guidance, please indicate this so we can prioritise accordingly.",
        "friendly": "Good question — policy queries are important and we want to make sure you have the right information. The HR team will pull the relevant documentation and send you a clear response within a day. If this is time-sensitive, just let us know.",
        "urgent":   "Your policy enquiry has been flagged for urgent attention. The HR team is sourcing the relevant documentation and will respond within four hours. Please refrain from acting on assumptions in the interim — we will confirm the correct position as soon as possible.",
    },
    "Password Reset": {
        "formal":   "Your password reset request has been received and is being processed. A temporary access credential will be issued to your registered email address within 15 minutes. Upon receipt, please log in immediately and update your password in line with the company password policy. If you do not receive the email within 15 minutes, check your spam folder or reply to this ticket.",
        "friendly": "Password reset is on its way! You should receive a temporary password in your inbox within 15 minutes. Once you are in, make sure to update it straight away. If nothing arrives, check your spam or reply here and we will sort it out.",
        "urgent":   "Password reset has been initiated immediately. A temporary credential will be sent to your registered email within five minutes. If access is not restored within 10 minutes, reply to this ticket with your employee ID and we will escalate to direct IT intervention.",
    },
    "VPN Access": {
        "formal":   "Your VPN connectivity issue has been logged and assigned to the IT Support team. A technician will contact you within two hours to diagnose and resolve the issue. In the meantime, please ensure your VPN client is on the latest version and that your internet connection is stable. Avoid restarting your machine until the technician has assessed the issue.",
        "friendly": "We have picked up your VPN issue and it has been assigned to IT. Someone will reach out within two hours to help get you connected. While you wait, it is worth checking that your VPN client is up to date — that resolves a lot of connection errors on its own.",
        "urgent":   "Your VPN issue has been escalated as critical. An IT technician has been assigned and will contact you within 30 minutes. Do not restart your machine or uninstall the VPN client — doing so may complicate the diagnosis. If you have an active deadline requiring remote access, please state this in your reply.",
    },
    "Hardware": {
        "formal":   "Your hardware fault has been logged and assigned to the IT Support team. A technician will assess and resolve the issue within one business day. If the fault is preventing you from completing your work, please reply to this ticket indicating the business impact and we will escalate the priority accordingly.",
        "friendly": "Hardware issue noted and logged with IT. A technician will be in touch within a day to get it sorted. If it is completely blocking your work right now, just reply and let us know — we will bump it up the queue.",
        "urgent":   "Your hardware fault has been escalated as a critical priority. A technician has been dispatched and will attend to the issue within one hour. Please remain at your workstation if possible. If you require a temporary device to continue working, indicate this in your reply.",
    },
    "Expense Claim": {
        "formal":   "Your expense claim has been received by the Finance team and is currently under review. Standard processing time is three to five business days, provided all required receipts and supporting documentation are attached. If your claim is missing any documentation, you will be contacted directly. Please do not resubmit the claim unless advised to do so.",
        "friendly": "Expense claim received — Finance has it and will process it within three to five business days. Just make sure all your receipts are attached and the categories are correct. If anything is missing, someone will reach out to you directly.",
        "urgent":   "Your expense claim has been flagged as urgent and escalated to the Finance team for priority review. A response will be provided within four hours. If this claim is tied to a supplier payment deadline, please include those details so Finance can act accordingly.",
    },
    "Payroll": {
        "formal":   "Your payroll query has been escalated to the Finance team for immediate investigation. This has been treated as a priority matter. A full response with a resolution or interim update will be provided within one business day. We apologise for any financial inconvenience caused.",
        "friendly": "Payroll concern received — we know this is important, so it has been flagged straight to Finance as a priority. They will be in touch within one business day with a resolution or an update on where things stand.",
        "urgent":   "Your payroll discrepancy has been escalated immediately to the Finance team and is being treated as urgent. A resolution or formal update will be provided before end of business today. If this impacts a payment with an imminent deadline, please reply with the relevant details.",
    },
    "Facilities": {
        "formal":   "Your facilities request has been received and assigned to the Operations team for assessment and resolution. The matter will be attended to within two business days. If the issue presents an immediate safety risk or is causing significant operational disruption, please contact reception directly or reply to this ticket to have the priority escalated.",
        "friendly": "Facilities request logged and with the Operations team. They will get on it within two business days. If it is a safety concern or is really affecting your ability to work, flag it here or contact reception and we will escalate straight away.",
        "urgent":   "Your facilities issue has been escalated as urgent. The Operations team has been notified and will attend within two hours. If the issue poses an immediate health or safety risk, please evacuate the affected area and contact building security or reception directly without delay.",
    },
    "Office Supplies": {
        "formal":   "Your office supplies request has been received and is being processed by the Operations team. Items will be sourced and delivered to your designated workspace within two business days, subject to stock availability. If any items are unavailable, you will be notified with an estimated delivery timeline.",
        "friendly": "Supplies request received! The Operations team will get those items to your desk within two business days. If anything is out of stock, we will let you know and give you an updated timeline.",
        "urgent":   "Your urgent supplies request has been received and flagged for same-day processing. The Operations team is checking current stock levels and will confirm availability and delivery timing within two hours.",
    },
    "General Support": {
        "formal":   "Thank you for contacting the support team. Your request has been received, logged, and assigned to the appropriate department for resolution. You can expect an initial response within one business day. Please do not submit duplicate tickets as this may delay resolution of your original request.",
        "friendly": "Thanks for reaching out — your request has been logged and is with the right team. We will be in touch within one business day. If anything changes or you have additional information to add, just reply to this ticket.",
        "urgent":   "Your request has been received and escalated for urgent attention. The relevant team is reviewing it now and will respond as soon as possible. If this involves a system outage, data loss, or a business-critical deadline, please include those details in your reply so we can prioritise appropriately.",
    },
}

'''

content = content[:start] + new_block + content[end:]
open(path, 'w', encoding='utf-8').write(content)
print('[OK] All response templates updated to professional standard')
