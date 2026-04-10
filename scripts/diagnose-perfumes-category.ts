import mongoose from 'mongoose';

async function diagnose() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const productsCollection = db.collection('products');
    const categoriesCollection = db.collection('categories');
    
    // First, list all categories
    const allCategories = await categoriesCollection.find({}).toArray();
    console.log('\n📂 ALL CATEGORIES:');
    allCategories.forEach((cat: any) => {
      console.log(`   - ${cat.name} (slug: ${cat.slug}) - ID: ${cat._id}`);
    });
    
    // Find Perfumes & Sprays category (try different variations)
    const perfumesCategory = await categoriesCollection.findOne({
      $or: [
        { name: 'Perfumes & Sprays' },
        { name: /perfume/i },
        { slug: 'perfumes-sprays' },
        { slug: /perfume/i },
      ],
    });
    
    if (!perfumesCategory) {
      console.log('\n❌ Perfumes & Sprays category not found');
      
      // Try to find category with most products
      const categoriesWithCounts = await productsCollection.aggregate([
        { $match: { status: 'active', category: { $exists: true, $ne: null } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]).toArray();
      
      console.log('\n📊 TOP 5 CATEGORIES BY PRODUCT COUNT:');
      for (const item of categoriesWithCounts) {
        const cat = await categoriesCollection.findOne({ _id: item._id });
        console.log(`   ${cat?.name} - ${item.count} products (ID: ${item._id})`);
      }
      
      process.exit(1);
    }
    
    console.log('\n📦 PERFUMES & SPRAYS CATEGORY INFO:');
    console.log('   ID: ', perfumesCategory._id);
    console.log('   Name: ', perfumesCategory.name);
    console.log('   Slug: ', perfumesCategory.slug);
    
    // Count products by different methods
    const countByObjectId = await productsCollection.countDocuments({
      category: perfumesCategory._id,
      status: 'active',
    });
    
    const countByName = await productsCollection.countDocuments({
      categoryName: perfumesCategory.name,
      status: 'active',
    });
    
    const countBoth = await productsCollection.countDocuments({
      $or: [
        { category: perfumesCategory._id },
        { categoryName: perfumesCategory.name },
      ],
      status: 'active',
    });
    
    console.log('\n📊 PRODUCT COUNTS:');
    console.log('   By ObjectId only (active): ', countByObjectId);
    console.log('   By name only (active): ', countByName);
    console.log('   By either (active): ', countBoth);
    
    // Count all regardless of status
    const allByObjectId = await productsCollection.countDocuments({
      category: perfumesCategory._id,
    });
    
    console.log('   By ObjectId (all statuses): ', allByObjectId);
    
    // Get ALL products in this category (regardless of status)
    const allProducts = await productsCollection
      .find({
        category: perfumesCategory._id,
      })
      .project({ _id: 1, name: 1, status: 1, category: 1, categoryName: 1 })
      .toArray();
    
    console.log('\n📋 ALL PRODUCTS WITH MATCHING OBJECTID:');
    console.log(`   Total: ${allProducts.length}`);
    allProducts.forEach((p: any, i: number) => {
      console.log(`   ${i + 1}. ${p.name}`);
      console.log(`      Status: ${p.status}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      CategoryName: ${p.categoryName}`);
    });
    
    // Get products with only categoryName
    const nameOnlyProducts = await productsCollection
      .find({
        $and: [
          { categoryName: perfumesCategory.name },
          { category: { $ne: perfumesCategory._id } },
        ],
      })
      .project({ _id: 1, name: 1, status: 1, category: 1, categoryName: 1 })
      .toArray();
    
    if (nameOnlyProducts.length > 0) {
      console.log('\n⚠️  PRODUCTS WITH NAME ONLY (NOT OBJECTID):');
      console.log(`   Total: ${nameOnlyProducts.length}`);
      nameOnlyProducts.forEach((p: any, i: number) => {
        console.log(`   ${i + 1}. ${p.name}`);
        console.log(`      Status: ${p.status}`);
        console.log(`      Category: ${p.category}`);
        console.log(`      CategoryName: ${p.categoryName}`);
      });
    }
    
    console.log('\n✅ Diagnosis complete.\n');
    
  } catch (error) {
    console.error('Database error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

diagnose();
