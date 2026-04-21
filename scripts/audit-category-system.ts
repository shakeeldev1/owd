import mongoose from 'mongoose';
import { Types } from 'mongoose';

async function auditCategorySystem() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const categoriesCollection = db.collection('categories');
    const productsCollection = db.collection('products');
    
    console.log('\n==================== CATEGORY SYSTEM AUDIT ====================\n');
    
    // 1. Check all categories exist and are properly configured
    console.log('📋 1. CATEGORY CONFIGURATION CHECK');
    const allCategories = await categoriesCollection.find({}).toArray();
    console.log(`   Total categories: ${allCategories.length}`);
    
    for (const cat of allCategories) {
      const issues: string[] = [];
      
      // Check required fields
      if (!cat.name) issues.push('Missing name');
      if (!cat.nameAr) issues.push('Missing nameAr');
      if (!cat.slug) issues.push('Missing slug');
      if (cat.isActive === undefined) issues.push('Missing isActive flag');
      if (cat.displayOrder === undefined) issues.push('Missing displayOrder');
      
      // Check slug format
      if (cat.slug && !/^[a-z0-9-]+$/.test(cat.slug)) {
        issues.push(`Invalid slug format: "${cat.slug}"`);
      }
      
      // Check slug matches name
      const expectedSlug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (cat.slug !== expectedSlug) {
        issues.push(`Slug mismatch: expected "${expectedSlug}", got "${cat.slug}"`);
      }
      
      if (issues.length > 0) {
        console.log(`   ⚠️  "${cat.name}" (${cat._id}): ${issues.join(', ')}`);
      } else {
        console.log(`   ✅ "${cat.name}" (slug: ${cat.slug}, isActive: ${cat.isActive})`);
      }
    }
    
    // 2. Check products have proper category assignments
    console.log('\n📦 2. PRODUCT CATEGORY ASSIGNMENT CHECK');
    const allProducts = await productsCollection.find({ status: 'active' }).toArray();
    const productsWithoutCategory = allProducts.filter(p => !p.category);
    const productsWithInvalidCategory = allProducts.filter(p => p.category && !Types.ObjectId.isValid(String(p.category)));
    const productsWithMismatchedCategoryName: Array<{ name: string; storedName: string; actualName: string }> = [];
    
    for (const product of allProducts) {
      if (product.category) {
        const cat = await categoriesCollection.findOne({ _id: product.category });
        if (cat && product.categoryName !== cat.name) {
          productsWithMismatchedCategoryName.push({
            name: product.name,
            storedName: product.categoryName,
            actualName: cat.name,
          });
        }
      }
    }
    
    console.log(`   Total active products: ${allProducts.length}`);
    console.log(`   Products with valid category: ${allProducts.length - productsWithoutCategory.length - productsWithInvalidCategory.length}`);
    
    if (productsWithoutCategory.length > 0) {
      console.log(`   ⚠️  Products WITHOUT category (${productsWithoutCategory.length}):`);
      productsWithoutCategory.slice(0, 5).forEach(p => {
        console.log(`       - ${p.name} (ID: ${p._id})`);
      });
      if (productsWithoutCategory.length > 5) {
        console.log(`       ... and ${productsWithoutCategory.length - 5} more`);
      }
    }
    
    if (productsWithInvalidCategory.length > 0) {
      console.log(`   ❌ Products with INVALID category ObjectId (${productsWithInvalidCategory.length}):`);
      productsWithInvalidCategory.slice(0, 5).forEach(p => {
        console.log(`       - ${p.name} (category: ${p.category})`);
      });
    }
    
    if (productsWithMismatchedCategoryName.length > 0) {
      console.log(`   ⚠️  Products with MISMATCHED categoryName (${productsWithMismatchedCategoryName.length}):`);
      productsWithMismatchedCategoryName.slice(0, 5).forEach(p => {
        console.log(`       - ${p.name} (stored: "${p.storedName}", actual: "${p.actualName}")`);
      });
    }
    
    if (productsWithoutCategory.length === 0 && productsWithInvalidCategory.length === 0 && productsWithMismatchedCategoryName.length === 0) {
      console.log(`   ✅ All products have valid category assignments`);
    }
    
    // 3. Check category counts vs actual product counts
    console.log('\n📊 3. CATEGORY PRODUCT COUNT VERIFICATION');
    for (const cat of allCategories) {
      if (!cat.isActive) continue;
      
      const actualCount = await productsCollection.countDocuments({
        category: cat._id,
        status: 'active',
      });
      
      // Note: We don't rely on productCount field anymore, just verify actual counts
      if (actualCount > 0 || cat.featured) {
        console.log(`   "${cat.name}": ${actualCount} products`);
      }
    }
    
    // 4. Check for orphaned categories (deleted categories referenced in products)
    console.log('\n🔍 4. ORPHANED CATEGORY CHECK');
    const categoryIds = new Set(allCategories.map(c => c._id.toString()));
    const productsWithOrphanedCategories = await productsCollection.aggregate([
      { $match: { category: { $exists: true, $ne: null }, status: 'active' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]).toArray();
    
    let orphanedCount = 0;
    for (const item of productsWithOrphanedCategories) {
      if (!categoryIds.has(item._id.toString())) {
        console.log(`   ⚠️  Orphaned category ID found: ${item._id} (${item.count} products)`);
        orphanedCount += item.count;
      }
    }
    
    if (orphanedCount === 0) {
      console.log(`   ✅ No orphaned categories found`);
    }
    
    // 5. Verify filter resolution logic
    console.log('\n🔎 5. FILTER RESOLUTION TEST');
    const testSlugs = ['oud', 'other-products', 'perfumes-sprays', 'bakhoor'];
    
    for (const slug of testSlugs) {
      const resolved = await categoriesCollection.findOne({
        isActive: true,
        $or: [
          { slug: slug.toLowerCase() },
          { slug: slug.replace(/[-_]+/g, ' ').toLowerCase() },
          { name: { $regex: '^' + slug.replace(/[-_]+/g, ' ') + '$', $options: 'i' } },
        ],
      });
      
      if (resolved) {
        const productCount = await productsCollection.countDocuments({
          category: resolved._id,
          status: 'active',
        });
        console.log(`   ✅ "${slug}" → ${resolved.name} (${productCount} products)`);
      } else {
        console.log(`   ❌ "${slug}" → NOT FOUND`);
      }
    }
    
    // 6. Check "Other Products" category exists
    console.log('\n🗂️  6. OTHER PRODUCTS CATEGORY CHECK');
    const otherProducts = await categoriesCollection.findOne({ slug: 'other-products' });
    if (otherProducts) {
      const count = await productsCollection.countDocuments({ category: otherProducts._id, status: 'active' });
      console.log(`   ✅ "Other Products" exists (ID: ${otherProducts._id}, ${count} products)`);
    } else {
      console.log(`   ❌ "Other Products" category NOT FOUND - will be created on first deletion`);
    }
    
    // 7. Summary and recommendations
    console.log('\n✅ AUDIT COMPLETE\n');
    console.log('📝 RECOMMENDATIONS:');
    console.log('   1. All categories should have isActive: true for filtering');
    console.log('   2. All active products should reference a valid category ObjectId');
    console.log('   3. categoryName should match the actual category name');
    console.log('   4. displayOrder determines sort order in sidebar');
    console.log('   5. Slug format: lowercase, no spaces, hyphens only');
    
  } catch (error: any) {
    console.error('❌ Audit error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

auditCategorySystem();
