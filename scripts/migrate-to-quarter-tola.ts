import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/alfursan-oud';

interface Product {
  _id?: string;
  name?: string;
  nameAr?: string;
  unit?: string;
  price?: number;
  pricePerTola?: number;
  pricePerQuarterTola?: number;
  stock?: number;
}

async function migrateToQuarterTola() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database connection not established');

    const productsCollection = db.collection('products');

    // Find Oud Oil and Musk products
    console.log('\n--- Searching for Oud Oil and Musk products ---');
    
    // Define products to migrate - find by name
    const productsToMigrate = [
      { namePattern: 'Oud Oil' },
      { namePattern: 'Musk' },
    ];

    for (const { namePattern } of productsToMigrate) {
      const regex = new RegExp(namePattern, 'i'); // Case-insensitive search
      
      const products = await productsCollection
        .find({
          $or: [
            { name: regex },
            { nameAr: regex },
          ],
        })
        .toArray() as Product[];

      console.log(`\nFound ${products.length} product(s) matching "${namePattern}":`);
      
      for (const product of products) {
        console.log(`\n📦 Product: ${product.name} (${product.nameAr})`);
        console.log(`   Current Unit: ${product.unit || 'Grams'}`);
        console.log(`   Current Price: ${product.price}`);
        console.log(`   Current Price per Tola: ${product.pricePerTola || 'N/A'}`);
        console.log(`   Stock: ${product.stock} grams`);

        // Migration logic:
        // 1. If currently sold in Tola, convert to Quarter Tola
        // 2. If pricePerTola exists, set pricePerQuarterTola = pricePerTola / 4
        // 3. Inventory stays in grams (already correct)

        let updateData = {};

        if (product.unit === 'Tola' && product.pricePerTola) {
          // Migrate from Tola to Quarter Tola
          const pricePerQuarterTola = Math.round((product.pricePerTola / 4) * 100) / 100;
          
          updateData = {
            unit: 'Quarter Tola',
            pricePerQuarterTola: pricePerQuarterTola,
            // Keep pricePerTola for backwards compatibility
            pricePerTola: product.pricePerTola,
          };

          console.log(`   ✅ Migration Plan:`);
          console.log(`      → Unit: Tola → Quarter Tola`);
          console.log(`      → Price per Quarter Tola: ${pricePerQuarterTola}`);
          console.log(`      → Stock in grams: ${product.stock} (unchanged)`);

          // Perform update
          const result = await productsCollection.updateOne(
            { _id: product._id },
            { $set: updateData },
          );

          if (result.modifiedCount > 0) {
            console.log(`   ✓ Successfully updated!`);
          } else {
            console.log(`   ⚠ No changes made`);
          }
        } else if (product.unit === 'Quarter Tola') {
          console.log(`   ℹ Product already using Quarter Tola unit`);
        } else {
          console.log(`   ⚠ Product unit is "${product.unit}" - skipping migration`);
        }
      }
    }

    console.log('\n--- Migration complete ---\n');

    // Display updated products
    console.log('Final product state:');
    const updatedProducts = await productsCollection
      .find({
        $or: [
          { name: /Oud Oil/i },
          { nameAr: /Oud Oil/i },
          { name: /Musk/i },
          { nameAr: /Musk/i },
        ],
      })
      .toArray() as Product[];

    for (const product of updatedProducts) {
      console.log(`\n📦 ${product.name}`);
      console.log(`   Unit: ${product.unit || 'Grams'}`);
      console.log(`   Price: ${product.price}`);
      console.log(`   Price per Quarter Tola: ${product.pricePerQuarterTola || 'N/A'}`);
      console.log(`   Stock: ${product.stock} grams`);
    }

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
  }
}

migrateToQuarterTola();
