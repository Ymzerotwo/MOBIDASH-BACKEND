/**
 * ==========================================
 *        OuraDash Email Services
 * ==========================================
 * 
 * Business logic layer for managing Email operations.
 */

import { logger } from '../utils/logger';
import Cloudflare from 'cloudflare';

let cachedBusinessSettings: { businessName: string; logoUrl: string | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes memory cache

export const buildMimeMessage = ({ from, to, subject, html, text }: { from: string; to: string; subject: string; html: string; text: string }): string => {
  const boundary = `Part_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const cleanFrom = from.trim();
  const cleanTo = to.trim();
  const safeSubject = subject.replace(/[\r\n]/g, ' ');

  return [
    `From: ${cleanFrom}`,
    `To: ${cleanTo}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text.trim(),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html.trim(),
    `--${boundary}--`,
    ''
  ].join('\r\n');
};

export const EmailService = {
  /**
   * Sends an automated reply using native Cloudflare Workers EMAILER binding or Cloudflare Email Routing API.
   * 
   * @param apiToken - Optional API Token for REST fallback.
   * @param userEmail - Recipient email.
   * @param userName - Recipient name.
   * @param env - Workers Environment bindings (contains env.EMAILER, etc).
   * @param db - D1 Database instance.
   */
  sendAutoReply: async (apiToken: string | undefined, userEmail: string, userName: string, env?: any, db?: any) => {
    const fromAddress = (env?.EMAIL_FROM_ADDRESS || 'noreply@yourdomain.com').trim();
    const recipientEmail = (userEmail || '').trim().toLowerCase();
    const ticketRef = 'REF-' + Math.floor(100000 + Math.random() * 900000);
    const frontendUrl = env?.APP_FRONTEND_URL || '';
    const displayUrl = frontendUrl.replace(/^https?:\/\//, '');

    let businessName = 'Customer Support';
    let logoUrl: string | null = null;

    if (db) {
      const now = Date.now();
      if (cachedBusinessSettings && (now - cachedBusinessSettings.fetchedAt < CACHE_TTL_MS)) {
        businessName = cachedBusinessSettings.businessName;
        logoUrl = cachedBusinessSettings.logoUrl;
      } else {
        try {
          const settings = await db.prepare('SELECT business_name, logo_url FROM Websites WHERE is_deleted = 0 ORDER BY created_at ASC LIMIT 1').first() as any;
          if (settings) {
            if (settings.business_name && settings.business_name.trim()) businessName = settings.business_name.trim();
            if (settings.logo_url && settings.logo_url.trim()) logoUrl = settings.logo_url.trim();
          }
          cachedBusinessSettings = { businessName, logoUrl, fetchedAt: now };
        } catch (e) {
          logger.warn('system', '[EMAIL SERVICE] Could not fetch Websites for email template, using defaults.');
        }
      }
    }

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>We Received Your Message</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #121215; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #06b6d4 100%);"></td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center;">
              ${logoUrl ? `
                <img src="${logoUrl}" alt="${businessName}" style="max-height: 48px; max-width: 220px; display: inline-block; object-fit: contain;">
              ` : `
                <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${businessName}</span>
              `}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-block; width: 44px; height: 44px; background-color: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 50%; line-height: 44px; color: #10b981; font-size: 20px; font-weight: 800; margin-bottom: 12px;">✓</div>
                <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #f4f4f5;">We Received Your Request</h2>
                <div style="font-size: 12px; color: #818cf8; font-family: monospace; font-weight: 600;">Ref: ${ticketRef}</div>
              </div>
              
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                Hello <strong style="color: #f4f4f5;">${userName || 'there'}</strong>,<br><br>
                Thank you for reaching out to <strong style="color: #f4f4f5;">${businessName}</strong>. This is an automated message to confirm that we have successfully received your inquiry.
              </p>

              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 18px 20px;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 13px; color: #71717a; padding-bottom: 8px;">Ticket Status:</td>
                        <td style="font-size: 13px; color: #10b981; font-weight: 600; text-align: right; padding-bottom: 8px;">Received / In Queue</td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; color: #71717a;">Expected Response:</td>
                        <td style="font-size: 13px; color: #f4f4f5; font-weight: 500; text-align: right;">Within 24 Hours</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px 0; font-size: 13px; line-height: 1.5; color: #71717a;">
                Our team will review your request and get back to you as soon as possible.
              </p>

              <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">

              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #71717a; text-align: center;">
                &copy; ${new Date().getFullYear()} ${businessName}. All rights reserved.${displayUrl ? `<br><a href="${frontendUrl}" style="color: #6366f1; text-decoration: none; font-weight: 500;">${displayUrl}</a>` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Hello ${userName || 'there'},\n\nThank you for reaching out to ${businessName}. This is an automated message to confirm that we have successfully received your inquiry.\n\nOur team will review your request and get back to you as soon as possible.\n\nReference: ${ticketRef}`;

    const subjectStr = `${businessName} - We have received your request [${ticketRef}]`;

    // 1. Primary: Native Cloudflare Workers Send Email Binding (EMAILER in wrangler.jsonc)
    // Zero API tokens or account IDs required! Works natively out of the box.
    if (env?.EMAILER && typeof env.EMAILER.send === 'function' && recipientEmail.includes('@')) {
      try {
        // Official Cloudflare Workers structured email send (exact string format from dashboard)
        await env.EMAILER.send({
          to: recipientEmail,
          from: fromAddress,
          subject: subjectStr,
          text: textContent,
          html: emailHtml
        });
        logger.info('system', `[EMAIL SERVICE] Email dispatched natively via Workers EMAILER binding to ${recipientEmail}`);
        return true;
      } catch (structuredErr: any) {
        // Fallback to EmailMessage if raw MIME is required by runtime
        try {
          const rawMime = buildMimeMessage({
            from: fromAddress,
            to: recipientEmail,
            subject: subjectStr,
            html: emailHtml,
            text: textContent
          });
          const EmailMsg = (globalThis as any).EmailMessage;
          if (EmailMsg) {
            await env.EMAILER.send(new EmailMsg(fromAddress, recipientEmail, rawMime));
            logger.info('system', `[EMAIL SERVICE] Email dispatched natively via EmailMessage to ${recipientEmail}`);
            return true;
          }
        } catch (mimeErr) {
          logger.warn('system', `[EMAIL SERVICE] Native EMAILER dispatch failed: ${structuredErr?.message || structuredErr}`);
        }
      }
    }

    // 2. Secondary Fallback: Cloudflare REST API Client (if tokens are configured)
    const accountId = env?.CF_ACCOUNT_ID || 'default_account';
    if (!apiToken || !recipientEmail.includes('@')) {
      logger.warn('system', '[EMAIL SERVICE] Neither native EMAILER binding nor REST API tokens are available. Skipping email dispatch.');
      return false;
    }

    try {
      const client = new Cloudflare({ apiToken });
      const response = await client.emailSending.send({
        account_id: accountId,
        from: fromAddress,
        to: recipientEmail,
        subject: subjectStr,
        html: emailHtml,
        text: textContent
      });
      
      logger.info('system', `[EMAIL SERVICE] Email delivered via REST API status: ${response.delivered}`);
      return true;
    } catch (e) {
      logger.error('system', '[EMAIL SERVICE] Failed to send email via Cloudflare REST API:', e);
      return false;
    }
  },

  /**
   * Sends an automated booking confirmation email to the customer with their booking reference number and appointment details.
   */
  sendBookingConfirmation: async (
    params: {
      apiToken?: string;
      recipientEmail: string;
      customerName: string;
      bookingNumber: string;
      serviceName: string;
      scheduledFrom: string;
      scheduledTo?: string | null;
      websiteId?: string | null;
      dashboardId?: string | null;
      notes?: string | null;
    },
    env?: any,
    db?: any
  ): Promise<boolean> => {
    const fromAddress = (env?.EMAIL_FROM_ADDRESS || 'noreply@yourdomain.com').trim();
    const recipientEmail = (params.recipientEmail || '').trim().toLowerCase();
    const frontendUrl = env?.APP_FRONTEND_URL || '';

    if (!recipientEmail || !recipientEmail.includes('@')) {
      logger.warn('system', '[EMAIL SERVICE] Invalid recipient email for booking confirmation.');
      return false;
    }

    let businessName = 'Customer Support';
    let logoUrl: string | null = null;
    let siteUrl = frontendUrl;

    if (db) {
      try {
        let websiteQuery = 'SELECT business_name, logo_url, custom_domain FROM Websites WHERE is_deleted = 0';
        const queryParams: any[] = [];
        if (params.websiteId) {
          websiteQuery += ' AND id = ? LIMIT 1';
          queryParams.push(params.websiteId);
        } else {
          websiteQuery += ' ORDER BY created_at ASC LIMIT 1';
        }
        const site = await db.prepare(websiteQuery).bind(...queryParams).first() as any;
        if (site) {
          if (site.business_name && site.business_name.trim()) businessName = site.business_name.trim();
          if (site.logo_url && site.logo_url.trim()) logoUrl = site.logo_url.trim();
          if (site.custom_domain && site.custom_domain.trim()) siteUrl = `https://${site.custom_domain.trim()}`;
        }
      } catch (e) {
        logger.warn('system', '[EMAIL SERVICE] Could not fetch Website details for booking confirmation, using defaults.');
      }
    }

    const formatDateTime = (iso: string) => {
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return iso;
      }
    };

    const fromFormatted = formatDateTime(params.scheduledFrom);
    const toFormatted = params.scheduledTo ? formatDateTime(params.scheduledTo) : null;
    const timeDisplay = toFormatted ? `${fromFormatted} → ${toFormatted}` : fromFormatted;

    const subjectStr = `${businessName} - Booking Request Received [${params.bookingNumber}]`;

    const emailHtml = `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Request Received</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; direction: ltr; text-align: left;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 35px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #121215; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <!-- Top Accent Gradient -->
          <tr>
            <td style="height: 5px; background: linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #06b6d4 100%);"></td>
          </tr>
          
          <!-- Logo / Brand Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center;">
              ${logoUrl ? `
                <img src="${logoUrl}" alt="${businessName}" style="max-height: 48px; max-width: 220px; display: inline-block; object-fit: contain;">
              ` : `
                <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${businessName}</span>
              `}
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 0 32px 36px 32px;">
              <!-- Checkmark & Heading -->
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; background-color: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 50%; line-height: 48px; color: #10b981; font-size: 22px; font-weight: 800; margin-bottom: 14px;">✓</div>
                <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 800; color: #f4f4f5;">Booking Request Received</h1>
                <p style="margin: 0; font-size: 14px; color: #a1a1aa; line-height: 1.6;">Hello <strong style="color: #f4f4f5;">${params.customerName}</strong>, thank you for choosing <strong style="color: #f4f4f5;">${businessName}</strong>. We have received your booking request and our team will review and confirm your scheduled slot shortly.</p>
              </div>

              <!-- Booking Reference Code Banner -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.08) 100%); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 18px 20px; text-align: center;">
                    <div style="font-size: 12px; font-weight: 600; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Booking Reference Number</div>
                    <div style="font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: 3px; font-family: 'Courier New', Courier, monospace;">${params.bookingNumber}</div>
                  </td>
                </tr>
              </table>

              <!-- Appointment Details Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; background-color: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #27272a;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 13px; color: #71717a; text-align: left; width: 35%;">Service:</td>
                        <td style="font-size: 14px; color: #818cf8; font-weight: 700; text-align: right;">${params.serviceName}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #27272a;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 13px; color: #71717a; text-align: left; width: 35%;">Scheduled Time:</td>
                        <td style="font-size: 13px; color: #f4f4f5; font-weight: 600; text-align: right;">${timeDisplay}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size: 13px; color: #71717a; text-align: left; width: 35%;">Status:</td>
                        <td style="font-size: 13px; color: #eab308; font-weight: 700; text-align: right;">Pending Confirmation</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px 0; font-size: 13px; line-height: 1.6; color: #71717a; text-align: center;">
                Please keep your booking reference (<strong style="color: #f4f4f5;">${params.bookingNumber}</strong>) handy for any inquiries or follow-ups with our team.
              </p>

              <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">

              <!-- Footer -->
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #71717a; text-align: center;">
                &copy; ${new Date().getFullYear()} ${businessName}. All rights reserved.${siteUrl ? `<br><a href="${siteUrl}" style="color: #6366f1; text-decoration: none; font-weight: 500; display: inline-block; margin-top: 6px;">${siteUrl.replace(/^https?:\/\//, '')}</a>` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `Hello ${params.customerName},\n\nThank you for choosing ${businessName}. We have received your booking request, and our team will review and confirm your scheduled slot shortly.\n\nBooking Reference: ${params.bookingNumber}\nService: ${params.serviceName}\nRequested Time: ${timeDisplay}\nStatus: Pending Confirmation\n\nPlease keep your booking reference for any follow-ups.\n\nBest regards,\n${businessName} Team`;

    // 1. Dispatch via native Workers EMAILER binding
    if (env?.EMAILER && typeof env.EMAILER.send === 'function' && recipientEmail.includes('@')) {
      try {
        await env.EMAILER.send({
          to: recipientEmail,
          from: fromAddress,
          subject: subjectStr,
          text: textContent,
          html: emailHtml
        });
        logger.info('system', `[EMAIL SERVICE] Booking confirmation dispatched natively via EMAILER to ${recipientEmail} [${params.bookingNumber}]`);
        return true;
      } catch (structuredErr: any) {
        try {
          const rawMime = buildMimeMessage({
            from: fromAddress,
            to: recipientEmail,
            subject: subjectStr,
            html: emailHtml,
            text: textContent
          });
          const EmailMsg = (globalThis as any).EmailMessage;
          if (EmailMsg) {
            await env.EMAILER.send(new EmailMsg(fromAddress, recipientEmail, rawMime));
            logger.info('system', `[EMAIL SERVICE] Booking confirmation dispatched natively via EmailMessage to ${recipientEmail}`);
            return true;
          }
        } catch (mimeErr) {
          logger.warn('system', `[EMAIL SERVICE] Native EMAILER dispatch failed for booking: ${structuredErr?.message || structuredErr}`);
        }
      }
    }

    // 2. Dispatch via Cloudflare REST API fallback
    const accountId = env?.CF_ACCOUNT_ID || 'default_account';
    if (!params.apiToken || !recipientEmail.includes('@')) {
      logger.warn('system', '[EMAIL SERVICE] Neither native EMAILER nor REST API token available for booking confirmation.');
      return false;
    }

    try {
      const client = new Cloudflare({ apiToken: params.apiToken });
      const response = await client.emailSending.send({
        account_id: accountId,
        from: fromAddress,
        to: recipientEmail,
        subject: subjectStr,
        html: emailHtml,
        text: textContent
      });
      logger.info('system', `[EMAIL SERVICE] Booking confirmation delivered via REST API to ${recipientEmail} [status: ${response.delivered}]`);
      return true;
    } catch (e) {
      logger.error('system', '[EMAIL SERVICE] Failed to send booking confirmation via REST API:', e);
      return false;
    }
  }
};
