// One-off: apply the Meta "EXPO" catalog deals (meta-catalog-EXPO-prices.csv) to the
// matching products in the live DB, using the schema's existing offer fields
// (isOnOffer / offerPrice / offerDiscountPercent / offerStartDate / offerEndDate).
// Front-end + cart already gate display/pricing on offerStartDate/offerEndDate
// (see client-react/src/utils/offerDates.ts and server cart.service.ts), so no code
// changes are needed — this just writes the data.
const mongoose = require('mongoose');
const fs = require('fs');

const mongoUri = process.env.MONGODB_URI_ATLAS
  || 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

const CSV_PATH = process.argv[2] || 'C:/Users/Meta Tech/Downloads/meta-catalog-EXPO-prices.csv';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const money = (s) => Number(String(s).replace(/[^0-9.]/g, ''));

// "2026-09-25T00:00+04:00/2026-10-05T23:59+04:00" -> [Date, Date]
function parseEffectiveDateRange(value) {
  const [start, end] = String(value || '').split('/');
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  return [
    startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
    endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
  ];
}

async function main() {
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(content);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const data = rows.slice(1).filter((r) => r.length === header.length);
  const deals = data.filter((r) => r[idx.sale_price].trim());

  console.log(`Found ${deals.length} deal rows in ${CSV_PATH}`);

  await mongoose.connect(mongoUri);
  const products = mongoose.connection.db.collection('products');

  let updated = 0;
  let skipped = 0;
  const summary = [];

  for (const r of deals) {
    const id = r[idx.id].trim();
    const price = money(r[idx.price]);
    const salePrice = money(r[idx.sale_price]);
    const [offerStartDate, offerEndDate] = parseEffectiveDateRange(r[idx.sale_price_effective_date]);

    if (!price || !salePrice || salePrice >= price || !offerStartDate || !offerEndDate) {
      skipped++;
      console.warn('SKIP (bad data):', r[idx.title], { price, salePrice, offerStartDate, offerEndDate });
      continue;
    }

    const offerDiscountPercent = Math.round(((price - salePrice) / price) * 100);

    const result = await products.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      {
        $set: {
          isOnOffer: true,
          offerPrice: salePrice,
          offerDiscountPercent,
          offerStartDate,
          offerEndDate,
        },
      },
    );

    if (result.matchedCount === 0) {
      skipped++;
      console.warn('SKIP (not found in DB):', id, r[idx.title]);
      continue;
    }

    updated++;
    summary.push({
      title: r[idx.title],
      price,
      offerPrice: salePrice,
      offerDiscountPercent,
      offerStartDate: offerStartDate.toISOString(),
      offerEndDate: offerEndDate.toISOString(),
    });
  }

  console.log('\n--- Applied deals ---');
  summary.forEach((s) => {
    console.log(`${s.title}: ${s.price} -> ${s.offerPrice} QAR (-${s.offerDiscountPercent}%) [${s.offerStartDate} .. ${s.offerEndDate}]`);
  });

  console.log(`\nUpdated: ${updated}, Skipped: ${skipped}, Total deal rows: ${deals.length}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
