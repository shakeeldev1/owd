import mongoose from 'mongoose';

async function cleanupAndRename() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const productsCollection = db.collection('products');
    const categoriesCollection = db.collection('categories');
    
    console.log('\n==================== CLEANUP & RENAME ====================\n');
    
    // Find all OUD categories
    const oudCategories = await categoriesCollection.find({
      $or: [
        { slug: 'oud' },
        { slug: { $regex: '^oud' } },
        { name: /^oud$/i },
        { name: { $regex: '^oud' } }
      ]
    }).toArray();
    
    console.log(`📂 Found ${oudCategories.length} OUD categories to delete:`);
    const oudIds = [];
    for (const cat of oudCategories) {
      console.log(`   - ${cat.name} (${cat.slug})`);
      oudIds.push(cat._id);
    }
    
    if (oudIds.length > 0) {
      // Delete all OUD products
      const deletedProducts = await productsCollection.deleteMany({
        category: { $in: oudIds }
      });
      console.log(`\n🗑️  Deleted ${deletedProducts.deletedCount} products in OUD categories`);
      
      // Delete all OUD categories
      const deletedCategories = await categoriesCollection.deleteMany({
        _id: { $in: oudIds }
      });
      console.log(`🗑️  Deleted ${deletedCategories.deletedCount} OUD categories`);
    }
    
    // Find "test" category
    const testCat = await categoriesCollection.findOne({
      $or: [{ slug: 'test' }, { name: /^test$/i }]
    });
    
    if (testCat) {
      console.log(`\n✅ Found "test" category: ${testCat.name} (${testCat.slug})`);
      console.log(`   Products in test: ${(await productsCollection.countDocuments({ category: testCat._id }))}`);
      
      // Rename to OUD
      const result = await categoriesCollection.updateOne(
        { _id: testCat._id },
        { 
          $set: { 
            name: 'OUD',
            slug: 'oud',
            nameAr: 'العود'
          }
        }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`\n✨ Successfully renamed "test" to "OUD"`);
        console.log(`   Slug: test -> oud`);
      }
    } else {
      console.log('\n❌ No "test" category found to rename');
    }
    
    // Show final state
    const finalOud = await categoriesCollection.findOne({ slug: 'oud' });
    if (finalOud) {
      const productCount = await productsCollection.countDocuments({ category: finalOud._id });
      console.log(`\n📊 Final OUD Category:`);
      console.log(`   Name: ${finalOud.name}`);
      console.log(`   Slug: ${finalOud.slug}`);
      console.log(`   Products: ${productCount}`);
      console.log(`   ID: ${finalOud._id}`);
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

cleanupAndRename();
