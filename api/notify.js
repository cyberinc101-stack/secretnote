// /api/notify.js  -  Vercel Serverless Function
// Sends a "note destroyed" alert via email (AWS SES) and/or SMS (Twilio).
// Receives NO note content or decryption key - only email/phone + timestamp.
//
// Required environment variables (Vercel > Project > Settings > Environment Variables):
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION  - from an IAM user with ses:SendEmail
//   SES_FROM_EMAIL       - a verified sender identity in SES (e.g. alerts@yourdomain.com)
//   TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER     - from twilio.com

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, phone, ref, destroyedAt } = req.body || {};
  if (!email && !phone) return res.status(400).json({ error: 'No target' });

  const label = ref ? ' (' + ref + ')' : '';
  const when = destroyedAt || new Date().toISOString();
  const jobs = [];

  if (email) {
    const cmd = new SendEmailCommand({
      Source: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'Your SecretNote' + label + ' was read and destroyed' },
        Body: {
          Text: {
            Data: 'Your note' + label + ' was opened and permanently destroyed at ' + when + '.\n\nNo copy of it exists anywhere.',
          },
        },
      },
    });
    jobs.push(ses.send(cmd));
  }

  if (phone) {
    const body = new URLSearchParams({
      To: phone,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: 'SecretNote' + label + ': your note was read and destroyed at ' + when + '.',
    });
    jobs.push(
      fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_SID + '/Messages.json', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(process.env.TWILIO_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
    );
  }

  try {
    await Promise.all(jobs);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('notify error:', e);
    res.status(500).json({ error: 'Send failed' });
  }
}