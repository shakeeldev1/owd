import mongoose from 'mongoose';

async function diagnoseProductStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const productsCollection = db.collection('products');
    const categoriesCollection = db.collection('categories');
    
    console.log('\n==================== PRODUCT STATUS DIAGNOSIS ====================\n');
    
    // Find OUD category
    const oudCat = await categoriesCollection.findOne({
      $or: [{ slug: 'oud' }, { name: /^oud$/i }]
    });
    
    if (!oudCat) {
      console.log('❌ OUD category not found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`📂 Found OUD category: "${oudCat.name}" (ID: ${oudCat._id})\n`);
    
    // Count products by status
    console.log('📊 PRODUCT COUNT BREAKDOWN:');
    const allOudProducts = await productsCollection.find({ category: oudCat._id }).toArray();
    console.log(`   Total with OUD category: ${allOudProducts.length}`);
    
    const statusGroups = {
      active: allOudProducts.filter(p => p.status === 'active').length,
      draft: allOudProducts.filter(p => p.status === 'draft').length,
      archived: allOudProducts.filter(p => p.status === 'archived').length,
      undefined: allOudProducts.filter(p => !p.status).length,
    };
    
    console.log(`   - Active: ${statusGroups.active}`);
    console.log(`   - Draft: ${statusGroups.draft}`);
    console.log(`   - Archived: ${statusGroups.archived}`);
    console.log(`   - No status: ${statusGroups.undefined}`);
    
    // List all products
    console.log(`\n📋 ALL ${allOudProducts.length} OUD PRODUCTS:`);
    allOudProducts.forEach((p, i) => {
      console.log(`   ${i + 1}. "${p.name}"`);
      console.log(`      Status: ${p.status || 'NONE'}`);
      console.log(`      Section: ${p.section || 'NONE'}`);
      console.log(`      Price: ${p.price}`);
    });
    
    // Show only ACTIVE products
    console.log(`\n✅ ACTIVE PRODUCTS ONLY (what filter should show):`);
    const activeOnly = allOudProducts.filter(p => p.status === 'active');
    
    if (activeOnly.length === 0) {
      console.log('   ❌ NO ACTIVE PRODUCTS FOUND!');
    } else {
      activeOnly.forEach((p, i) => {
        console.log(`   ${i + 1}. "${p.name}" (Status: ${p.status})`);
      });
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

diagnoseProductStatus();
