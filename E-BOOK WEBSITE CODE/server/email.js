const fs = require('node:fs/promises');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim());
}

let resendInstance = null;
function getResendClient() {
  if (resendInstance) return resendInstance;
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  resendInstance = new Resend(apiKey);
  return resendInstance;
}

function setResendClient(client) {
  resendInstance = client;
}

let smtpTransporter = null;
function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      family: 4,
      localAddress: '0.0.0.0',
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 45000,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }
  return smtpTransporter;
}

function getSenderAddress() {
  if (process.env.EMAIL_FROM && String(process.env.EMAIL_FROM).trim()) {
    return String(process.env.EMAIL_FROM).trim();
  }
  const storeName = process.env.SMTP_FROM_NAME || 'Inkframe Press';
  if (isResendConfigured()) {
    return `"${storeName}" <orders@inkframepress.com>`;
  }
  return `"${storeName}" <${process.env.SMTP_USER || 'orders@inkframepress.com'}>`;
}

async function verifyEmailTransport() {
  if (isResendConfigured()) {
    const client = getResendClient();
    try {
      const { error } = await client.apiKeys.list();
      if (error) {
        if (error.statusCode === 403) {
          return { provider: 'resend', verified: true, restricted: true };
        }
        const err = new Error(`Resend verification failed: ${error.message || 'Authentication error'}`);
        err.code = error.name || 'RESEND_AUTH_ERROR';
        err.statusCode = error.statusCode;
        throw err;
      }
      return { provider: 'resend', verified: true };
    } catch (networkError) {
      if (networkError.code && String(networkError.code).startsWith('RESEND_')) throw networkError;
      const err = new Error(`Resend connection failed: ${networkError.message || 'Network error'}`);
      err.code = networkError.code || 'RESEND_CONNECTION_FAILED';
      throw err;
    }
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('Neither RESEND_API_KEY nor SMTP credentials (SMTP_USER, SMTP_PASSWORD) are configured.');
  }
  return getSmtpTransporter().verify();
}

async function sendOtpEmail(email, otp, purpose = 'SIGN_IN') {
  const storeName = process.env.SMTP_FROM_NAME || 'Inkframe Press';
  const purposeText = purpose === 'PASSWORD_RESET' ? 'password reset' : purpose === 'EMAIL_CHANGE' ? 'email change' : 'sign-in';
  const subject = `${otp} is your ${storeName} verification code`;
  const text = `Your ${storeName} ${purposeText} code is ${otp}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.`;

  if (isResendConfigured()) {
    const { data, error } = await getResendClient().emails.send({
      from: getSenderAddress(),
      to: email,
      subject,
      text
    });
    if (error) {
      const err = new Error(`OTP email delivery failed: ${error.message || 'Resend error'}`);
      err.code = error.name || 'RESEND_ERROR';
      throw err;
    }
    return data;
  }

  return getSmtpTransporter().sendMail({
    from: getSenderAddress(),
    to: email,
    subject,
    text
  });
}

async function sendBookEmail(email, orderId, amount, pdf, title = 'Fitness for Busy Professionals', test = true) {
  const subject = `Your ebook: ${title}`;
  const text = `Thank you! Your ${title} PDF is attached.\n\n${test ? 'Test order' : 'Order'} #${orderId} | INR ${(amount / 100).toFixed(2)}\n${test ? 'No money was charged.\n' : ''}You can also sign in to My Library to download your book.`;
  const cleanFilename = title.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 100) + '.pdf';

  let fileBuffer;
  if (Buffer.isBuffer(pdf)) {
    fileBuffer = pdf;
  } else if (typeof pdf === 'string' && require('./storage/s3').isS3Path(pdf)) {
    fileBuffer = await require('./storage/s3').getEbookBuffer(require('./storage/s3').extractS3Key(pdf));
  } else {
    fileBuffer = await fs.readFile(pdf);
  }

  if (isResendConfigured()) {
    const { data, error } = await getResendClient().emails.send({
      from: getSenderAddress(),
      to: email,
      subject,
      text,
      attachments: [{
        filename: cleanFilename,
        content: fileBuffer,
        contentType: 'application/pdf'
      }]
    });
    if (error) {
      const err = new Error(`Book email delivery failed: ${error.message || 'Resend error'}`);
      err.code = error.name || 'RESEND_ERROR';
      throw err;
    }
    return data;
  }

  const result = await getSmtpTransporter().sendMail({
    from: getSenderAddress(),
    to: email,
    subject,
    text,
    attachments: [{ filename: cleanFilename, content: fileBuffer, contentType: 'application/pdf' }]
  });
  if (!result.accepted || !result.accepted.length) throw new Error('Email recipient was not accepted.');
  return result;
}

async function sendAdminInvite(email) {
  const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : 'http://localhost:8000';
  const subject = 'Your store administrator access';
  const text = `You have been granted administrator access. Open ${origin}/admin/ and sign in with this email using Google or email OTP. Never share your verification code.`;

  if (isResendConfigured()) {
    const { data, error } = await getResendClient().emails.send({
      from: getSenderAddress(),
      to: email,
      subject,
      text
    });
    if (error) {
      const err = new Error(`Admin invite email delivery failed: ${error.message || 'Resend error'}`);
      err.code = error.name || 'RESEND_ERROR';
      throw err;
    }
    return data;
  }

  const result = await getSmtpTransporter().sendMail({
    from: getSenderAddress(),
    to: email,
    subject,
    text
  });
  if (!result.accepted || !result.accepted.length) throw new Error('Email recipient was not accepted.');
  return result;
}

module.exports = { sendOtpEmail, verifyEmailTransport, sendBookEmail, sendAdminInvite, setResendClient };
