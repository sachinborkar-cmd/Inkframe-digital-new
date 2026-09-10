const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 45000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

async function verifyEmailTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured.');
  }
  return transporter.verify();
}

async function sendOtpEmail(email, otp, purpose = 'SIGN_IN') {
  const storeName = process.env.SMTP_FROM_NAME || 'Inkframe Press';
  await transporter.sendMail({
    from: `"${storeName}" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `${otp} is your ${storeName} verification code`,
    text: `Your ${storeName} ${purpose === 'PASSWORD_RESET' ? 'password reset' : purpose === 'EMAIL_CHANGE' ? 'email change' : 'sign-in'} code is ${otp}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.`
  });
}

async function sendBookEmail(email, orderId, amount, pdf, title = 'Fitness for Busy Professionals', test = true) {
  const result = await transporter.sendMail({
    from: `"Inkframe Press" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your ebook: ${title}`,
    text: `Thank you! Your ${title} PDF is attached.\n\n${test ? 'Test order' : 'Order'} #${orderId} | INR ${(amount / 100).toFixed(2)}\n${test ? 'No money was charged.\n' : ''}You can also sign in to My Library to download your book.`,
    attachments: [{ filename: title.replace(/[^a-zA-Z0-9 -]/g, '').slice(0,100) + '.pdf', path: pdf, contentType: 'application/pdf' }]
  });
  if (!result.accepted || !result.accepted.length) throw new Error('Email recipient was not accepted.');
}

async function sendAdminInvite(email) {
  const origin = new URL(process.env.APP_ORIGIN).origin;
  const result = await transporter.sendMail({from: `"Inkframe Press" <${process.env.SMTP_USER}>`, to:email, subject:'Your store administrator access', text:`You have been granted administrator access. Open ${origin}/admin/ and sign in with this email using Google or email OTP. Never share your verification code.`});
  if (!result.accepted || !result.accepted.length) throw new Error('Email recipient was not accepted.');
}
module.exports = { sendOtpEmail, verifyEmailTransport, sendBookEmail, sendAdminInvite };
