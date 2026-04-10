import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function check() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
  console.log('Connecting to:', mongoUri);
  
  try {
    const connection = await mongoose.connect(mongoUri);
    console.log('✓ Connected successfully');
    
    const collections = await connection.connection.db?.listCollections().toArray() || [];
    console.log('\nCollections found:', collections.length);
    collections.forEach((col: any) => {
      console.log('  -', col.name);
    });
    
    // Count documents in some key collections
    for (const collName of ['products', 'categories', 'users']) {
      try {
        const count = await connection.connection.db?.collection(collName).countDocuments() || 0;
        console.log(`\n${collName}: ${count} documents`);
      } catch (e) {
        console.log(`${collName}: Not found`);
      }
    }
    
    await mongoose.disconnect();
  } catch (error: any) {
    console.error('✗ Connection failed:', error.message);
  }
}

check();
