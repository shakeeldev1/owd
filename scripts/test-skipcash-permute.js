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

function makeHmac(combinedData, secret) {
  return crypto.createHmac('sha256', secret).update(combinedData).digest('base64');
}

async function doRequest(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data });
        });
      });

      req.on('error', (e) => reject(e));
      req.write(JSON.stringify(body));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

(async () => {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const env = loadEnv(path.join(repoRoot, '.env'));

    const keyId = (env.SKIPCASH_KEY_ID || env.SKIPCASH_CLIENT_ID || '').trim();
    const secret = (env.SKIPCASH_SECRET || '').trim();
    const apiCandidates = [
      (env.SKIPCASH_API_URL || '').trim(),
      'https://api.skipcash.app/api/v1/payments',
      'https://api.skipcash.app/v1/payments',
    ].filter(Boolean);

    if (!keyId || !secret) {
      console.error('Missing SKIPCASH_KEY_ID or SKIPCASH_SECRET in .env');
      process.exit(2);
    }

    const uid = crypto.randomUUID();
    const amount = '1.00';
    const firstName = 'Test';
    const lastName = 'User';
    const phone = '+97400000000';
    const email = 'test@example.com';
    const txn = `TEST-${Date.now()}`;

    const bodyVariants = [];

    // PascalCase (docs)
    bodyVariants.push({
      label: 'PascalCase',
      body: {
        Uid: uid,
        KeyId: keyId,
        Amount: amount,
        FirstName: firstName,
        LastName: lastName,
        Phone: phone,
        Email: email,
        TransactionId: txn,
        Custom1: 'c1',
      },
      combinedOrder: ['Uid','KeyId','Amount','FirstName','LastName','Phone','Email','Street','City','State','Country','PostalCode','TransactionId','Custom1']
    });

    // camelCase
    bodyVariants.push({
      label: 'camelCase',
      body: {
        uid: uid,
        keyId: keyId,
        amount: amount,
        firstName: firstName,
        lastName: lastName,
        phone: phone,
        email: email,
        transactionId: txn,
        custom1: 'c1',
      },
      combinedOrder: ['uid','keyId','amount','firstName','lastName','phone','email','street','city','state','country','postalCode','transactionId','custom1']
    });

    // lowercase
    bodyVariants.push({
      label: 'lowercase',
      body: {
        uid: uid,
        keyid: keyId,
        amount: amount,
        firstname: firstName,
        lastname: lastName,
        phone: phone,
        email: email,
        transactionid: txn,
        custom1: 'c1',
      },
      combinedOrder: ['uid','keyid','amount','firstname','lastname','phone','email','street','city','state','country','postalcode','transactionid','custom1']
    });

    const headerCombos = [
      { label: 'AuthHmac', set: (h, cd) => (h['Authorization'] = cd) },
      { label: 'AuthBearer', set: (h, cd) => (h['Authorization'] = `Bearer ${secret}`) },
      { label: 'XKeyXClient', set: (h, cd) => { h['x-key-id'] = keyId; h['x-api-key'] = secret } },
      { label: 'XClientIdAuthHmac', set: (h, cd) => { h['x-client-id'] = keyId; h['Authorization'] = cd } },
    ];

    const endpoints = Array.from(new Set(apiCandidates));

    const results = [];

    for (const endpoint of endpoints) {
      for (const variant of bodyVariants) {
        // build combinedData string exactly in the order specified
        const order = variant.combinedOrder;
        const values = order.map((k) => {
          const v = variant.body[k] ?? variant.body[k.charAt(0).toUpperCase()+k.slice(1)] ?? '';
          return `${k}=${v}`;
        });
        const combinedDataPascal = order.map((k) => {
          // produce PascalCase keys for combined data as docs use specific casing sometimes
          const key = k.replace(/^[a-z]/, (m) => m.toUpperCase());
          const v = variant.body[key] ?? variant.body[k] ?? '';
          return `${key}=${v}`;
        }).join(',');

        const combinedDataLower = order.join(',').replace(/,/g, ',');

        // prefer PascalCase combinedData (per docs)
        const combinedData = combinedDataPascal;
        const hmac = makeHmac(combinedData, secret);

        for (const headerCombo of headerCombos) {
          const headers = {
            'Content-Type': 'application/json',
          };

          // set header combination (use hmac only where needed)
          headerCombo.set(headers, hmac);

          // ensure Content-Length set automatically by request

          const bodyToSend = variant.body;

          try {
            const r = await doRequest(endpoint, headers, bodyToSend);
            const bodyText = r.body ? (r.body.length > 1000 ? (r.body.slice(0,1000)+'...') : r.body) : '';
            const parsed = (() => { try { return JSON.parse(bodyText); } catch { return bodyText; } })();
            const ok = r.status === 200 || r.status === 201 || (parsed && parsed.returnCode===200);

            results.push({ endpoint, variant: variant.label, headerCombo: headerCombo.label, status: r.status, body: parsed, ok });
            console.log('TRY', endpoint, variant.label, headerCombo.label, '=>', r.status);

            if (ok) {
              console.log('SUCCESS combination found:', { endpoint, variant: variant.label, headerCombo: headerCombo.label });
              console.log('Response sample:', parsed);
              process.exit(0);
            }
          } catch (err) {
            console.error('REQUEST ERROR', endpoint, variant.label, headerCombo.label, err.message);
            results.push({ endpoint, variant: variant.label, headerCombo: headerCombo.label, error: err.message });
          }
        }
      }
    }

    console.log('\nNo successful combination found. Summary:');
    for (const r of results) {
      console.log(r.endpoint, r.variant, r.headerCombo, r.status || r.error);
    }

    process.exit(0);
  } catch (err) {
    console.error('Fatal error', err);
    process.exit(1);
  }
})();
