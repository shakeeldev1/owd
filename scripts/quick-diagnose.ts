import mongoose from 'mongoose';

async function quickDiagnose() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const categoriesCollection = db.collection('categories');
    const productsCollection = db.collection('products');
    
    console.log('\n==================== QUICK DIAGNOSIS ====================\n');
    
    // Show ALL categories
    console.log('📂 ALL CATEGORIES IN DATABASE:');
    const allCats = await categoriesCollection.find({}).sort({ createdAt: -1 }).toArray();
    
    if (allCats.length === 0) {
      console.log('   ⚠️  No categories found');
    } else {
      for (const cat of allCats) {
        const productCount = await productsCollection.countDocuments({ category: cat._id });
        console.log(`   - "${cat.name}" (slug: ${cat.slug})`);
        console.log(`     ID: ${cat._id}`);
        console.log(`     isActive: ${cat.isActive}, featured: ${cat.featured}`);
        console.log(`     Products: ${productCount}`);
      }
    }
    
    // Show ALL products
    console.log('\n📦 ALL PRODUCTS IN DATABASE:');
    const allProducts = await productsCollection.find({}).sort({ createdAt: -1 }).limit(10).toArray();
    
    if (allProducts.length === 0) {
      console.log('   ⚠️  No products found');
    } else {
      for (const prod of allProducts) {
        const cat = await categoriesCollection.findOne({ _id: prod.category });
        console.log(`   - "${prod.name}"`);
        console.log(`     Status: ${prod.status}`);
        console.log(`     Category ObjectId: ${prod.category}`);
        console.log(`     Category Name: ${prod.categoryName}`);
        console.log(`     Actual Category: ${cat?.name || 'NOT FOUND'}`);
      }
      
      if (allProducts.length >= 10) {
        console.log(`   ... and more`);
      }
    }
    
    // Test OUD filtering specifically
    console.log('\n🔍 TESTING OUD FILTER:');
    const oudCat = await categoriesCollection.findOne({
      $or: [
        { name: 'OUD' },
        { name: 'Oud' },
        { name: 'oud' },
        { slug: 'oud' },
      ]
    });
    
    if (oudCat) {
      console.log(`   Found: "${oudCat.name}" (slug: ${oudCat.slug})`);
      console.log(`   isActive: ${oudCat.isActive}`);
      
      const productos = await productsCollection.find({ category: oudCat._id }).toArray();
      console.log(`   Products with this category: ${productos.length}`);
      
      if (oudCat.isActive) {
        console.log(`   ✅ Should work for filtering`);
      } else {
        console.log(`   ❌ isActive is FALSE - filtering will fail!`);
      }
    } else {
      console.log(`   ❌ No OUD category found`);
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

quickDiagnose();
