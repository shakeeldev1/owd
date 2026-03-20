const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const keyId = process.env.SKIPCASH_KEY_ID;
const secret = process.env.SKIPCASH_SECRET;
const clientId = process.env.SKIPCASH_CLIENT_ID;

console.log('=== COMPLETE SKIPCASH TEST ===\n');

// Simulate what frontend sends
const frontendPayload = {
  items: [
    {
      product: '507f1f77bcf86cd799439011',
      name: 'Test Product',
      nameAr: 'منتج اختبار',
      price: 100,
      quantity: 1,
      image: 'test.jpg'
    }
  ],
  shippingAddress: 'John Doe, 123 Main St, Downtown, Doha',
  paymentMethod: 'skipcash',
  customer: {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+974 5555 1234'
  }
};

console.log('Frontend Payload:', JSON.stringify(frontendPayload.customer, null, 2));

// Simulate backend processing (createSkipCashCheckoutSession)
const draftReference = `SKP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
const amount = (100 * 1 + 0).toFixed(2); // subtotal + shipping

const backendPayload = {
  clientId: clientId || '',
  amount: amount,
  currency: 'QAR',
  orderId: draftReference,
  orderNumber: draftReference,
  customer: {
    name: frontendPayload.customer?.name || 'Unknown',
    email: frontendPayload.customer?.email || '',
    phone: frontendPayload.customer?.phone || '',
  },
};

console.log('\nBackend Payload (to requestSkipCashSession):', JSON.stringify(backendPayload, null, 2));

// Simulate requestSkipCashSession processing
const uid = uuidv4();
const amountStr = String(backendPayload.amount).padEnd(2, '0') || '0.00';
const fullName = String(backendPayload.customer?.name || '').trim();
const names = fullName ? fullName.split(/\s+/) : [];
const firstName = names.length > 0 ? names[0] : '';
const lastName = names.length > 1 ? names.slice(1).join(' ') : '';
const phone = String(backendPayload.customer?.phone || '').trim();
const email = String(backendPayload.customer?.email || '').trim();
const transactionId = String(backendPayload.orderId || backendPayload.orderNumber || '');

console.log('\n=== EXTRACTED VALUES ===');
console.log('Uid:', uid);
console.log('Amount:', amountStr);
console.log('FullName:', fullName);
console.log('FirstName:', firstName);
console.log('LastName:', lastName);
console.log('Phone:', phone);
console.log('Email:', email);
console.log('TransactionId:', transactionId);

// Validate
console.log('\n=== VALIDATION ===');
console.log('✓ FirstName present:', !!firstName);
console.log('✓ LastName present:', !!lastName);
console.log('✓ Phone present:', !!phone);
console.log('✓ Email present:', !!email, '(includes @:', email.includes('@'), ')');
console.log('✓ TransactionId present:', !!transactionId);

// Build combined data (ONLY non-empty fields)
const combinedDataParts = [
  `Uid=${uid}`,
  `KeyId=${keyId}`,
  `Amount=${amountStr}`,
  `FirstName=${firstName}`,
  `LastName=${lastName}`,
  `Phone=${phone}`,
  `Email=${email}`,
];

if (transactionId) combinedDataParts.push(`TransactionId=${transactionId}`);

const combinedData = combinedDataParts.join(',');

console.log('\n=== HMAC COMPUTATION ===');
console.log('Combined Data:', combinedData);

const hash = CryptoJS.HmacSHA256(combinedData, secret);
const signature = CryptoJS.enc.Base64.stringify(hash);

console.log('Signature:', signature);

// Build request body (ONLY non-empty fields)
const bodyToSend = {
  Uid: uid,
  KeyId: keyId,
  Amount: amountStr,
  FirstName: firstName,
  LastName: lastName,
  Phone: phone,
  Email: email,
};
if (transactionId) bodyToSend.TransactionId = transactionId;

console.log('\n=== REQUEST BODY ===');
console.log(JSON.stringify(bodyToSend, null, 2));

// Test request
console.log('\n=== SENDING TO SKIPCASH ===');

(async () => {
  try {
    const response = await fetch('https://api.skipcash.app/api/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': signature
      },
      body: JSON.stringify(bodyToSend)
    });

    const data = await response.json();
    
    if (response.ok || data.returnCode === 200) {
      console.log('✅ SUCCESS!');
      console.log('Payment ID:', data.resultObj?.id);
      console.log('Checkout URL:', data.resultObj?.payUrl);
    } else {
      console.log('❌ Request failed with status', response.status);
      console.log('Error:', data.errorMessage || data.error || data.message);
      console.log('\nFull Response:');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
})();
