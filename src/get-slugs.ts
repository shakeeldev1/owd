/* eslint-disable @typescript-eslint/no-require-imports */
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

const ProductSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.model('Product', ProductSchema, 'products');

async function getSlugs() {
  try {
    await mongoose.connect(MONGODB_URI);
    const products = await Product.find({}, { slug: 1, name: 1 });
    
    console.log('All product slugs:');
    console.log(JSON.stringify({ slugs: products.map(p => p.slug) }, null, 2));
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

getSlugs();
