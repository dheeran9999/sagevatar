import type { Mail } from './mailer.js';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function layout(title: string, intro: string, cta: string, url: string, note: string) {
  return `<!doctype html><html><body style="margin:0;background:#eef2fb;font-family:Segoe UI,Arial,sans-serif;color:#0e1430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:700">Sage<span style="color:#3b6cf6">Vatar</span></td></tr>
<tr><td style="font-size:12px;color:#737c9f;padding-bottom:20px">AI Avatar &amp; Event Photo Studio</td></tr>
<tr><td style="font-size:18px;font-weight:600;padding-bottom:8px">${title}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#4a5378;padding-bottom:24px">${intro}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${esc(url)}" style="display:inline-block;background:#3b6cf6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${cta}</a></td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#737c9f">${note}<br><br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${esc(url)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, name: string, url: string, hours: number): Mail {
  return {
    to,
    subject: 'Verify your SageVatar email address',
    text: `Hi ${name},\n\nConfirm your email address to finish creating your SageVatar account:\n\n${url}\n\nThis link expires in ${hours} hours. If you didn't sign up, you can ignore this email.\n`,
    html: layout(
      'Confirm your email address',
      `Hi ${esc(name)}, confirm this is your address to finish creating your SageVatar account.`,
      'Verify email',
      url,
      `This link expires in ${hours} hours. If you didn't sign up, you can ignore this email.`,
    ),
  };
}

export function resetEmail(to: string, name: string, url: string, minutes: number): Mail {
  return {
    to,
    subject: 'Reset your SageVatar password',
    text: `Hi ${name},\n\nSomeone (hopefully you) asked to reset your SageVatar password. Choose a new one here:\n\n${url}\n\nThis link expires in ${minutes} minutes and works once. If you didn't ask, ignore this email — your password stays the same.\n`,
    html: layout(
      'Reset your password',
      `Hi ${esc(name)}, someone (hopefully you) asked to reset your SageVatar password.`,
      'Choose a new password',
      url,
      `This link expires in ${minutes} minutes and works once. If you didn't ask, ignore this email — your password stays the same.`,
    ),
  };
}

export function emailChangeEmail(to: string, name: string, url: string, hours: number): Mail {
  return {
    to,
    subject: 'Confirm your new SageVatar email address',
    text: `Hi ${name},\n\nConfirm this address to make it your SageVatar sign-in email:\n\n${url}\n\nThis link expires in ${hours} hours. Until you confirm, your current email keeps working. If you didn't ask for this, ignore this email.\n`,
    html: layout(
      'Confirm your new email address',
      `Hi ${esc(name)}, confirm this address to make it your SageVatar sign-in email.`,
      'Confirm new email',
      url,
      `This link expires in ${hours} hours. Until you confirm, your current email keeps working.`,
    ),
  };
}
