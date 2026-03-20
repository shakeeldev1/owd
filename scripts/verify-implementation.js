const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const keyId = process.env.SKIPCASH_KEY_ID;
const secret = process.env.SKIPCASH_SECRET;

console.log('=== FINAL VERIFICATION TEST ===\n');
console.log('Testing updated implementation logic...\n');

// Simulate payload like orders.service.ts computes
const uid = uuidv4();
const amountStr = '150.00';
const firstName = 'John';
const lastName = 'Doe';
const phone = '1234567890';
const email = 'john@example.com';
const transactionId = 'ORDER-123456';
const custom1 = uuidv4();

// Build combined data with ONLY NON-EMPTY FIELDS (new implementation)
const combinedDataParts = [
  `Uid=${uid}`,
  `KeyId=${keyId}`,
  `Amount=${amountStr}`,
  `FirstName=${firstName}`,
  `LastName=${lastName}`,
  `Phone=${phone}`,
  `Email=${email}`,
];

// Only add optional fields if they have values
if (transactionId) combinedDataParts.push(`TransactionId=${transactionId}`);
if (custom1) combinedDataParts.push(`Custom1=${custom1}`);

const combinedData = combinedDataParts.join(',');

console.log('Combined Data (non-empty fields only):');
console.log(combinedData);
console.log(`\nLength: ${combinedData.length} characters`);

// Compute hash
const hash = CryptoJS.HmacSHA256(combinedData, secret);
const hashInBase64 = CryptoJS.enc.Base64.stringify(hash);

console.log(`\nHMAC-SHA256 (Base64): ${hashInBase64}`);

// Test request
const requestBody = {
  Uid: uid,
  KeyId: keyId,
  Amount: amountStr,
  FirstName: firstName,
  LastName: lastName,
  Phone: phone,
  Email: email,
  Street: '',
  City: '',
  State: '',
  Country: '',
  PostalCode: '',
  TransactionId: transactionId,
  Custom1: custom1,
};

console.log('\n=== SENDING REQUEST ===\n');

(async () => {
  try {
    const response = await fetch('https://api.skipcash.app/api/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': hashInBase64
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    
    if (response.ok || data.returnCode === 200) {
      console.log('✅ SUCCESS! Payment session created.');
      console.log(`\nPayment Details:`);
      console.log(`- ID: ${data.resultObj?.id || 'N/A'}`);
      console.log(`- Amount: ${data.resultObj?.amount || 'N/A'}`);
      console.log(`- Status: ${data.resultObj?.status || 'N/A'}`);
      console.log(`- Checkout URL: ${data.resultObj?.payUrl || 'N/A'}`);
    } else {
      console.log(`❌ Error ${data.returnCode}: ${data.errorMessage}`);
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
})();
