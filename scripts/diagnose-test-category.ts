import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

async function diagnose() {
  try {
    console.log('🔍 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const Products = db.collection('products');
    const Categories = db.collection('categories');
    
    // Find "test" category
    const testCategory = await Categories.findOne({ name: { $regex: /^test$/i } });
    
    if (!testCategory) {
      console.log('❌ "test" category not found');
      const allCats = await Categories.find({}).limit(5).toArray();
      console.log('💾 All categories:', allCats.map((c: any) => ({ name: c.name, slug: c.slug, _id: c._id })));
      await mongoose.disconnect();
      return;
    }
    
    console.log('\n📦 TEST CATEGORY INFO:');
    console.log('   Name:', testCategory.name);
    console.log('   Slug:', testCategory.slug);
    console.log('   ID:', testCategory._id);
    
    // Find products with this category ObjectId
    const byObjectId = await Products.countDocuments({ category: testCategory._id });
    console.log('\n📊 PRODUCTS COUNT:');
    console.log('   By ObjectId:', byObjectId);
    
    // Get the actual products
    const products = await Products
      .find({ category: testCategory._id })
      .project({ _id: 1, name: 1, category: 1, categoryName: 1, status: 1 })
      .toArray();
    
    console.log('\n📋 PRODUCTS WITH THIS CATEGORY:');
    products.forEach((p: any, i: number) => {
      console.log(`   ${i + 1}. ${p.name}`);
      console.log(`      Category ObjectId: ${p.category}`);
      console.log(`      CategoryName: ${p.categoryName}`);
      console.log(`      Status: ${p.status}`);
    });
    
    // Test category resolution
    const slugToFind = testCategory.slug.toLowerCase();
    const categoryBySlug = await Categories.findOne({ slug: slugToFind });
    console.log('\n🔎 SLUG RESOLUTION TEST:');
    console.log(`   Looking for slug: "${slugToFind}"`);
    console.log(`   Found: ${categoryBySlug ? '✓ YES' : '❌ NO'}`);
    if (categoryBySlug) {
      console.log(`   Resolved to ID: ${categoryBySlug._id}`);
      console.log(`   Match: ${categoryBySlug._id.toString() === testCategory._id.toString() ? '✓ CORRECT' : '❌ WRONG'}`);
    }
    
    console.log('\n✅ Diagnosis complete\n');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

diagnose();
