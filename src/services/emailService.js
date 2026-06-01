import net from 'node:net';
import tls from 'node:tls';

const RESET_TOKEN_TTL_MINUTES = 5;

export function isEmailServiceConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function boolEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function escapeAddress(value) {
  return String(value || '').replace(/[<>\r\n]/g, '').trim();
}

function escapeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeData(value) {
  return String(value || '').replace(/^\./gm, '..');
}

function createMessage({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const headers = [
    `From: ${escapeHeader(from)}`,
    `To: ${escapeHeader(to)}`,
    `Subject: ${escapeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="prepup-reset-boundary"',
  ];

  return `${headers.join('\r\n')}\r\n\r\n--prepup-reset-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n\r\n--prepup-reset-boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n\r\n--prepup-reset-boundary--`;
}

function createPasswordResetTemplate({ name, resetLink }) {
  const safeName = escapeHtml(name || 'PrepUp user');
  const safeResetLink = escapeHtml(resetLink);
  const ttl = RESET_TOKEN_TTL_MINUTES;

  const text = [
    `Hi ${name || 'PrepUp user'},`,
    '',
    'We received a request to reset the password for your PrepUp account.',
    '',
    `Reset your password using this secure link. It expires in ${ttl} minutes:`,
    resetLink,
    '',
    'If you did not request a password reset, you can safely ignore this email. Your current password will remain unchanged.',
    '',
    'For your security, do not forward this email or share the reset link with anyone.',
    '',
    'Regards,',
    'The PrepUp Team',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reset your PrepUp password</title>
  </head>
  <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#0f172a;padding:28px 32px;color:#ffffff;">
                <div style="font-size:22px;font-weight:800;letter-spacing:.2px;">PrepUp</div>
                <div style="margin-top:6px;font-size:13px;color:#cbd5e1;">Placement readiness workspace</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${safeName},</p>
                <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#0f172a;">Reset your password</h1>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#475569;">
                  We received a request to reset the password for your PrepUp account. Use the secure button below to create a new password.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;">
                  <tr>
                    <td style="border-radius:10px;background:#2563eb;">
                      <a href="${safeResetLink}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <div style="margin:0 0 22px;padding:14px 16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:14px;line-height:1.6;">
                  This link expires in <strong>${ttl} minutes</strong> and can be used only once.
                </div>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#64748b;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 24px;word-break:break-all;font-size:12px;line-height:1.6;color:#2563eb;">
                  <a href="${safeResetLink}" style="color:#2563eb;">${safeResetLink}</a>
                </p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#64748b;">
                  If you did not request a password reset, you can safely ignore this email. Your current password will remain unchanged.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                  For your security, do not forward this email or share the reset link with anyone.
                </p>
                <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">Regards,<br>The PrepUp Team</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html };
}

function createSmtpClient({ host, port, secure }) {
  let socket;
  let buffer = '';
  let waiter = null;
  let pendingError = null;

  function attach(nextSocket) {
    socket = nextSocket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const match = line.match(/^(\d{3})([ -])/);
        if (match && match[2] === ' ' && waiter) {
          const current = waiter;
          waiter = null;
          current.resolve({ code: Number(match[1]), line });
        }
      }
    });
    socket.on('error', (error) => {
      if (waiter) {
        const current = waiter;
        waiter = null;
        current.reject(error);
        return;
      }
      pendingError = error;
    });
    socket.on('timeout', () => {
      const error = new Error('SMTP connection timed out');
      socket.destroy(error);
      if (waiter) {
        const current = waiter;
        waiter = null;
        current.reject(error);
      }
    });
  }

  attach(
    secure
      ? tls.connect({ host, port, servername: host, timeout: 15000 })
      : net.connect({ host, port, timeout: 15000 }),
  );

  function waitFor(expectedCodes) {
    const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    return new Promise((resolve, reject) => {
      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        reject(error);
        return;
      }

      waiter = {
        resolve: (response) => {
          if (!codes.includes(response.code)) {
            reject(new Error(response.line || `SMTP command failed with ${response.code}`));
            return;
          }
          resolve(response);
        },
        reject,
      };
    });
  }

  async function command(value, expectedCodes) {
    const response = waitFor(expectedCodes);
    socket.write(`${value}\r\n`);
    return response;
  }

  async function startTls() {
    socket = tls.connect({ socket, servername: host, timeout: 15000 });
    buffer = '';
    attach(socket);
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
  }

  function close() {
    socket.end();
  }

  return { command, close, startTls, waitFor };
}

export function getPasswordResetBaseUrl(req) {
  const configured =
    process.env.PASSWORD_RESET_BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.APP_URL;

  if (configured) return configured;

  const origin = req.get('origin');
  if (origin) return origin;

  return 'http://localhost:5173';
}

export async function sendPasswordResetEmail({ to, name, resetLink }) {
  if (!isEmailServiceConfigured()) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.');
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = boolEnv('SMTP_SECURE', port === 465);
  const startTls = boolEnv('SMTP_STARTTLS', !secure);
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const safeName = name || 'PrepUp user';
  const subject = 'Reset your PrepUp password';
  const { text, html } = createPasswordResetTemplate({ name: safeName, resetLink });

  const client = createSmtpClient({ host, port, secure });
  try {
    await client.waitFor(220);
    await client.command(`EHLO ${process.env.SMTP_HELO_DOMAIN || 'localhost'}`, 250);
    if (startTls) {
      await client.command('STARTTLS', 220);
      await client.startTls();
      await client.command(`EHLO ${process.env.SMTP_HELO_DOMAIN || 'localhost'}`, 250);
    }
    await client.command('AUTH LOGIN', 334);
    await client.command(Buffer.from(process.env.SMTP_USER).toString('base64'), 334);
    await client.command(Buffer.from(process.env.SMTP_PASS).toString('base64'), 235);
    await client.command(`MAIL FROM:<${escapeAddress(from)}>`, 250);
    await client.command(`RCPT TO:<${escapeAddress(to)}>`, [250, 251]);
    await client.command('DATA', 354);
    await client.command(`${escapeData(createMessage({ to, subject, text, html }))}\r\n.`, 250);
    await client.command('QUIT', 221).catch(() => null);
  } catch (error) {
    const details = [
      error?.message,
      error?.code ? `code=${error.code}` : '',
      error?.errno ? `errno=${error.errno}` : '',
      error?.syscall ? `syscall=${error.syscall}` : '',
      error?.hostname ? `host=${error.hostname}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    throw new Error(details || 'Email delivery failed');
  } finally {
    client.close();
  }
}

export { RESET_TOKEN_TTL_MINUTES };
