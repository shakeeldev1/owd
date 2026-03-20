const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

function loadEnv(envPath) {
  const text = fs.readFileSync(envPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const obj = {};
  for (const l of lines) {
    const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2] || '';
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    obj[k] = v;
  }
  return obj;
}

(async function run() {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const envPath = path.join(repoRoot, '.env');
    const env = loadEnv(envPath);

    const keyId = (env.SKIPCASH_KEY_ID||env.SKIPCASH_CLIENT_ID||'').trim();
    const secret = (env.SKIPCASH_SECRET||'').trim();
    const apiUrl = (process.argv[2] || env.SKIPCASH_API_URL || 'https://api.skipcash.app/v1/payments').trim();

    if (!keyId || !secret) {
      console.error('Missing SKIPCASH_KEY_ID or SKIPCASH_SECRET in server/.env');
      process.exit(2);
    }

    const uid = crypto.randomUUID();
    const amount = '1.00';
    const firstName = 'Test';
    const lastName = 'User';
    const phone = '';
    const email = 'test@example.com';
    const transactionId = `TEST-${Date.now()}`;
    const custom1 = '';

    const combinedData = `Uid=${uid},KeyId=${keyId},Amount=${amount},FirstName=${firstName},LastName=${lastName},Phone=${phone},Email=${email},Street=,City=,State=,Country=,PostalCode=,TransactionId=${transactionId},Custom1=${custom1}`;

    const hmac = crypto.createHmac('sha256', secret).update(combinedData).digest('base64');

    const payload = {
      Uid: uid,
      KeyId: keyId,
      Amount: amount,
      FirstName: firstName,
      LastName: lastName,
      Phone: phone,
      Email: email,
      TransactionId: transactionId,
      Custom1: custom1,
    };

    const url = new URL(apiUrl);
    const body = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': hmac,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log('STATUS:', res.statusCode);
        try {
          console.log('BODY:', JSON.parse(data));
        } catch (e) {
          console.log('BODY (raw):', data);
        }
      });
    });

    req.on('error', (e) => {
      console.error('REQUEST ERROR', e.message);
      process.exit(2);
    });

    req.write(body);
    req.end();
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
